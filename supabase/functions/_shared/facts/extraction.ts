// Model extraction of candidate facts from ONE source at a time (design 4.1). The model sees a single story, answer
// or document and is told not to reconcile. Its output is untrusted: every value is normalised, and a value whose
// quote does not appear in the source text is dropped.

import {
  type AccountType,
  type BankReplyOutcome,
  type BankReplyStatus,
  CREDENTIALS_OPTIONS,
  type CredentialsShared,
  type FactKey,
  type ImpersonatedEntityType,
  type Instrument,
  PHISHING_CHANNEL_OPTIONS,
  type PhishingChannel,
  SCAM_TYPE_OPTIONS,
  type ScamType,
  type SourceType,
  type Transaction,
} from "./keys.ts";
import type { FactCandidate } from "./reconcile.ts";
import { normaliseInstitution } from "./institutions.ts";
import { normaliseDate, normaliseMoney, normaliseYesNo } from "./normalise.ts";
import {
  ACCESS_EVENT_KINDS,
  type AccessEvent,
  CARD_AUTHENTICATION_RESULTS,
  CARD_AUTHENTICATIONS,
  CARD_DISPUTE_STATUSES,
  CARD_SCHEMES,
  type CardAuthEvent,
  ENTRY_MODES,
  type IsoDateTime,
  TECHNICAL_RECORD_DOCUMENT_TYPES,
  type TechnicalRecordDocumentType,
  TOKEN_ACTIVATION_METHODS,
  WALLET_PROVISIONING_AUTHENTICATIONS,
} from "./update/contract.ts";

// v4: the FIDReC update's facts and the two technical-record document types (brief v5, Phase 3).
export const FACT_EXTRACTION_PROMPT_VERSION = "fact-extract-v4";

const ACCOUNT_TYPES: AccountType[] = ["savings_or_current", "debit_card", "credit_card", "ewallet", "investment", "other"];
const SCAM_TYPES: readonly ScamType[] = SCAM_TYPE_OPTIONS;
const CHANNELS: readonly PhishingChannel[] = PHISHING_CHANNEL_OPTIONS;
const CREDENTIALS: readonly CredentialsShared[] = [...CREDENTIALS_OPTIONS, "unsure"];

// What kind of document a source is, and which facts that kind of document can speak to (finding A7). A bank's
// email about a card dispute can say what the bank was told or replied; it cannot say how the scam happened.
// The two technical-record types (brief 3a) are the institution's own records: logins, devices and alerts; and how
// each card payment was authenticated. Only they can supply or contradict access_events and card_auth_events.
export const DOCUMENT_TYPES = [
  "bank_statement",
  "card_statement",
  "bank_correspondence",
  "police_report",
  "scam_message",
  ...TECHNICAL_RECORD_DOCUMENT_TYPES,
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const MONEY_FACTS: FactKey[] = ["institution_names", "account_types", "transactions", "total_loss", "amount_recovered_or_offered"];
const SCAM_FACTS: FactKey[] = ["scam_type", "phishing_channel", "credentials_or_otp_shared", "impersonated_entity_type", "date_discovered"];
// A record from the institution can hold both lists (a combined export), so either type supplies either list.
const TECHNICAL_RECORD_FACTS: FactKey[] = [
  "institution_names",
  "access_events",
  "card_auth_events",
  "token_activation_method",
  "transaction_alert_threshold",
];
const DOCUMENT_FACTS: Record<DocumentType, ReadonlySet<FactKey>> = {
  // The balance before the first disputed payment is read from a bank statement only (brief 3b, 4a).
  bank_statement: new Set([...MONEY_FACTS, "balance_before_first_disputed_payment"]),
  card_statement: new Set(MONEY_FACTS),
  bank_correspondence: new Set([
    ...MONEY_FACTS,
    "reported_to_bank",
    "bank_case_reference",
    "written_complaint_sent",
    "bank_reply",
    "access_record_requested",
    "card_dispute_requested",
    "card_dispute_response",
    "institution_fault_label",
    "transaction_alert_threshold",
    "token_activation_method",
  ]),
  // A police report is first of all evidence of the police report: its number and date (walkthrough, 8 Nov).
  police_report: new Set(["reported_to_police", "police_report_number", ...SCAM_FACTS, "transactions", "total_loss", "account_types", "reported_to_bank"]),
  scam_message: new Set(["scam_type", "phishing_channel", "impersonated_entity_type"]),
  bank_access_record: new Set(TECHNICAL_RECORD_FACTS),
  card_authentication_record: new Set([...TECHNICAL_RECORD_FACTS, "transactions", "account_types"]),
  other: new Set(),
};

export function isTechnicalRecordType(type: DocumentType | null): type is TechnicalRecordDocumentType {
  return type !== null && (TECHNICAL_RECORD_DOCUMENT_TYPES as readonly string[]).includes(type);
}

// A record is a list of time-stamped lines. A letter that only describes logins or payments in prose stays
// bank_correspondence (brief 3a), so a technical type needs at least two lines carrying a time of day.
const RECORD_LINE_TIME = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/;
export const MIN_RECORD_LINES = 2;

export function looksLikeRecord(text: string): boolean {
  return text.split(/\r?\n/).filter((line) => RECORD_LINE_TIME.test(line)).length >= MIN_RECORD_LINES;
}

export const DOCUMENT_CONFIDENCE_THRESHOLD = 0.7;

// A police report retells the scam, so the model can take it for a scam message; then its police facts were only
// context and a different report number raised no conflict (walkthrough, 8 Nov). Police-report markers in the opening
// lines decide. A bank letter that asks for a police report does not open with them.
const POLICE_REPORT_OPENING = /singapore police force|police report (?:acknowledg(?:e)?ment|receipt|no\.?|number)|\breport no\.?\s*[:#]?\s*[A-Z]{0,2}\/?\d{6,}/i;

// The report's own number, near the top of a police report: "Report No: G/20241031/0000", "Police report no. A2026...".
const POLICE_REPORT_NUMBER = /\breport\s+(?:no\.?|number)\s*[:#.]?\s*([A-Z]{0,2}\/?\d{6,}(?:\/\d{1,6})?)/i;

export function documentTypeOf(modelType: unknown, text: string): DocumentType {
  const declared = oneOf(DOCUMENT_TYPES, modelType) ?? "other";
  if (declared !== "police_report" && declared !== "bank_correspondence" && POLICE_REPORT_OPENING.test(text.slice(0, 600))) {
    return "police_report";
  }
  if (isTechnicalRecordType(declared) && !looksLikeRecord(text)) return "bank_correspondence";
  return declared;
}

export function documentCanContradict(documentType: DocumentType, factKey: FactKey, confidence: number | null): boolean {
  return DOCUMENT_FACTS[documentType].has(factKey) && confidence !== null && confidence >= DOCUMENT_CONFIDENCE_THRESHOLD;
}
const INSTRUMENTS: Instrument[] = ["account_transfer", "sg_card", "ewallet", "other"];
const REPLY_STATUSES: BankReplyStatus[] = ["none", "acknowledged", "interim", "final_reply"];
const REPLY_OUTCOMES: BankReplyOutcome[] = ["rejected", "partial_offer", "full_offer", "other"];
const IMPERSONATED: ImpersonatedEntityType[] = ["bank_or_fi", "government", "other_business", "private_person", "unsure"];

const TEMPLATE = {
  document_type: `${DOCUMENT_TYPES.join("|")} (documents only)`,
  institutions: [{ name: "string", quote: "string" }],
  account_types: [{ value: ACCOUNT_TYPES.join("|"), quote: "string" }],
  scam_types: [{ value: SCAM_TYPES.join("|"), quote: "string" }],
  phishing_channel: { value: CHANNELS.join("|"), quote: "string" },
  credentials: { value: CREDENTIALS.join("|"), quote: "string" },
  transactions: [{ date: "YYYY-MM-DD|null", amount: "number", currency: "SGD|USD|...", payee: "string|null", card_last4: "string|null", instrument: INSTRUMENTS.join("|"), quote: "string" }],
  total_loss: [{ amount: "number", currency: "string", account: `${ACCOUNT_TYPES.join("|")}|null`, quote: "string" }],
  reported_to_bank: { value: "yes|no", date: "YYYY-MM-DD|null", reference: "string|null", quote: "string" },
  written_complaint: { value: "yes|no", date: "YYYY-MM-DD|null", quote: "string" },
  bank_reply: { status: REPLY_STATUSES.join("|"), date: "YYYY-MM-DD|null", outcome: `${REPLY_OUTCOMES.join("|")}|null`, quote: "string" },
  reported_to_police: { value: "yes|no", date: "YYYY-MM-DD|null", reference: "string|null", quote: "string" },
  amount_recovered_or_offered: { amount: "number", currency: "string", quote: "string" },
  date_discovered: { date: "YYYY-MM-DD", quote: "string" },
  impersonated_entity_type: { value: IMPERSONATED.join("|"), quote: "string" },
  access_record_requested: { value: "yes|no", date: "YYYY-MM-DD|null", quote: "string" },
  card_dispute_requested: { value: "yes|no", date: "YYYY-MM-DD|null", channel: "string|null", quote: "string" },
};

const DATE_TIME = "YYYY-MM-DDTHH:MM:SS+HH:MM|null";

// Only a document can state these (brief 3b), so stories and answers are not asked for them.
const DOCUMENT_TEMPLATE = {
  access_events: [{
    timestamp: DATE_TIME,
    kind: ACCESS_EVENT_KINDS.join("|"),
    device_label: "string|null",
    device_ref: "string|null",
    ip: "string|null",
    channel: "string|null",
    authorised_by: "string|null",
    sent_to: "string|null",
    quote: "string",
  }],
  card_auth_events: [{
    timestamp: DATE_TIME,
    card_scheme: CARD_SCHEMES.join("|"),
    merchant: "string|null",
    merchant_country: "string|null",
    entry_mode: ENTRY_MODES.join("|"),
    authentication: CARD_AUTHENTICATIONS.join("|"),
    authentication_result: CARD_AUTHENTICATION_RESULTS.join("|"),
    sent_to: "string|null",
    device_label: "string|null",
    device_ref: "string|null",
    token_ref: "string|null",
    wallet_provisioned_at: DATE_TIME,
    wallet_device_label: "string|null",
    wallet_provisioning_authentication: `${WALLET_PROVISIONING_AUTHENTICATIONS.join("|")}|null`,
    wallet_provisioning_sent_to: "string|null",
    wallet_token_removed_at: DATE_TIME,
    quote: "string",
  }],
  card_dispute_response: { status: CARD_DISPUTE_STATUSES.join("|"), date: "YYYY-MM-DD|null", reason_stated: "string|null", outcome: "string|null", quote: "string" },
  institution_fault_label: { label: "string", conduct: "string|null", quote: "string" },
  balance_before_first_disputed_payment: { amount: "number", currency: "string", quote: "string" },
  transaction_alert_threshold: { amount: "number", currency: "string", set_by: "default|account_holder|not_known", quote: "string" },
  token_activation_method: { value: TOKEN_ACTIVATION_METHODS.join("|"), quote: "string" },
};

const SOURCE_DESCRIPTIONS: Record<SourceType, string> = {
  story: "the claimant's own account of what happened",
  answer: "one answer the claimant typed into a form",
  document: "the text of one document the claimant uploaded",
};

// Documents also give a confidence for every value; the template says so on each item.
function withConfidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withConfidence);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withConfidence(v)]);
    if ("quote" in (value as Record<string, unknown>)) entries.push(["confidence", "number 0-1"]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function buildFactExtractionPrompt(sourceType: SourceType, sourceText: string): string {
  const template = sourceType === "document" ? withConfidence({ ...TEMPLATE, ...DOCUMENT_TEMPLATE }) : TEMPLATE;
  const documentRules = sourceType === "document"
    ? [
      "- bank_access_record: a record produced by the institution that lists logins, sessions, devices, digital-token",
      "  activation, IP addresses, payee, limit or contact-detail changes, alerts or SMS sent, or the account block.",
      "  card_authentication_record: a record produced by the institution that lists, per card payment, the time,",
      "  merchant, entry mode, how it was authenticated, where a code was sent, the device or token that approved it,",
      "  or a card added to a mobile wallet. Use these types even when the record arrives inside a letter; a letter",
      "  that only describes such events in prose is bank_correspondence.",
      "- access_events and card_auth_events: one entry per line of such a record, in the record's order. quote is that",
      "  line word for word. Copy device_ref, token_ref and ip exactly as written; null when the line has none.",
      "  Timestamps with the offset the record gives; when it gives none, write the time as shown without an offset.",
      "- institution_fault_label: only the institution's own word or phrase for the claimant's conduct (for example",
      "  \"negligent\"), and the conduct it cites, from the institution's letter.",
      "- card_dispute_response: only what the institution's letter says it did about disputing the card payments.",
      "- balance_before_first_disputed_payment: only from a bank statement that shows a running balance: the balance",
      "  on the line immediately before the first of the transactions you listed.",
    ]
    : [];
  return [
    `You extract facts from ONE source: ${SOURCE_DESCRIPTIONS[sourceType]}. Return one JSON object shaped like TEMPLATE.`,
    "Rules:",
    "- Use only this source. Do not infer, do not use outside knowledge, and do not try to reconcile with anything else.",
    "- Every value needs \"quote\": the exact words from the source (at most 25 words) that state it.",
    "- If the source does not clearly state a fact, set it to null (or an empty list). Never guess.",
    "- Dates as YYYY-MM-DD; amounts as numbers without currency symbols; enum fields use only the listed values.",
    "- instrument: sg_card for a credit, debit or charge card issued in Singapore; account_transfer for bank transfers",
    "  (including PayNow/FAST); ewallet for payments from an e-wallet such as GrabPay or PayLah!.",
    "- credentials: entered_on_fake_site_or_app when details were typed into a fake website or app; given_directly when",
    "  an OTP or password was told to the scammer by phone; given_in_message when it was sent in a message;",
    "  installed_app_or_malware when an app was installed.",
    "- scam_types: the kind of scam the source describes, never the bank's later handling of it.",
    "- total_loss: one entry per amount stated as lost, with the account or card it left from when the source says so.",
    "- A police report is itself evidence that the scam was reported to the police: reported_to_police is yes, with the",
    "  report's own number as reference and its date.",
    "- For a document: set document_type, and give every value \"confidence\" (0 to 1) that the document states it about",
    "  this scam. Correspondence about the dispute is bank_correspondence, even when it repeats the claimant's words.",
    "- access_record_requested: whether the claimant asked the institution for its records of logins, devices or",
    "  card authentication. card_dispute_requested: whether the claimant asked the institution to dispute the card",
    "  payments (a chargeback), when, and how.",
    ...documentRules,
    "",
    `TEMPLATE: ${JSON.stringify(template)}`,
    "",
    "SOURCE:",
    sourceText,
  ].join("\n");
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

// A quote may join lines of the source with ";" or "…" (gpt-6-luna does, 20 Nov 2026). It counts only when every part
// is in the source word for word, so nothing the source does not say gets through.
function quoted(sourceText: string, item: unknown): string | null {
  const quote = (item as { quote?: unknown } | null)?.quote;
  if (typeof quote !== "string" || !quote.trim()) return null;
  const source = squash(sourceText);
  const parts = quote.split(/\s*(?:;|…|\.\.\.)\s*/).map(squash).filter((part) => part.length > 0);
  const found = source.includes(squash(quote)) || (parts.length > 1 && parts.every((part) => part.length >= 3 && source.includes(part)));
  return found ? quote.trim().slice(0, 300) : null;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function confidenceOf(item: unknown): number | null {
  const value = (item as { confidence?: unknown } | null)?.confidence;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : null;
}

export function parseFactExtraction(
  raw: unknown,
  sourceText: string,
  source: { sourceType: SourceType; sourceRef: Record<string, unknown> },
): FactCandidate[] {
  const out = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const candidates: FactCandidate[] = [];
  const documentType: DocumentType | null = source.sourceType === "document" ? documentTypeOf(out.document_type, sourceText) : null;
  // A document value outside what that kind of document can state, or below the confidence threshold, is kept as
  // context: stored for the record, never compared (finding A7).
  const add = (factKey: FactCandidate["factKey"], value: unknown, quotes: string[], items: unknown[] = []) => {
    const confidences = items.map(confidenceOf).filter((c): c is number => c !== null);
    const confidence = confidences.length ? Math.min(...confidences) : null;
    const document = documentType ? { documentType, confidence, context: !documentCanContradict(documentType, factKey, confidence) } : {};
    candidates.push({
      factKey,
      value,
      sourceType: source.sourceType,
      sourceRef: { ...source.sourceRef, quotes, ...document },
    } as FactCandidate);
  };

  const institutions = list(out.institutions)
    .map((i) => ({ institution: normaliseInstitution((i as { name?: unknown })?.name), quote: quoted(sourceText, i) }))
    .filter((i) => i.institution && i.quote);
  if (institutions.length) {
    const byName = new Map(institutions.map((i) => [i.institution!.name.toLowerCase(), i.institution!]));
    add("institution_names", [...byName.values()], institutions.map((i) => i.quote!), list(out.institutions));
  }

  for (const [field, factKey, allowed] of [
    ["account_types", "account_types", ACCOUNT_TYPES],
    ["scam_types", "scam_type", SCAM_TYPES],
  ] as const) {
    const items = list(out[field])
      .map((i) => ({ value: oneOf(allowed as readonly string[], (i as { value?: unknown })?.value), quote: quoted(sourceText, i), raw: i }))
      .filter((i) => i.value && i.quote);
    if (items.length) add(factKey, [...new Set(items.map((i) => i.value!))], items.map((i) => i.quote!), items.map((i) => i.raw));
  }

  for (const [field, factKey, allowed] of [
    ["phishing_channel", "phishing_channel", CHANNELS],
    ["credentials", "credentials_or_otp_shared", CREDENTIALS],
    ["impersonated_entity_type", "impersonated_entity_type", IMPERSONATED],
  ] as const) {
    const value = oneOf(allowed as readonly string[], (out[field] as { value?: unknown } | null)?.value);
    const quote = quoted(sourceText, out[field]);
    if (value && quote) add(factKey, value, [quote], [out[field]]);
  }

  const transactions: Transaction[] = [];
  const transactionItems: unknown[] = [];
  const transactionQuotes: string[] = [];
  for (const item of list(out.transactions)) {
    const t = item as Record<string, unknown>;
    const quote = quoted(sourceText, t);
    const amount = normaliseMoney(typeof t.amount === "number" ? t.amount : String(t.amount ?? ""), typeof t.currency === "string" ? t.currency.toUpperCase() : "SGD");
    if (!quote || !amount || amount.amount <= 0) continue;
    const last4 = typeof t.card_last4 === "string" && /^\d{4}$/.test(t.card_last4) ? t.card_last4 : null;
    transactions.push({
      date: normaliseDate(t.date),
      amount,
      channel: null,
      payee: typeof t.payee === "string" && t.payee.trim() ? t.payee.trim().slice(0, 120) : null,
      last4,
      instrument: oneOf(INSTRUMENTS, t.instrument),
    });
    transactionQuotes.push(quote);
    transactionItems.push(t);
  }
  if (transactions.length) add("transactions", transactions, transactionQuotes, transactionItems);

  const money = (item: Record<string, unknown> | null) =>
    item ? normaliseMoney(typeof item.amount === "number" ? item.amount : String(item.amount ?? ""), typeof item.currency === "string" ? item.currency.toUpperCase() : "SGD") : null;
  // Each amount lost is its own candidate, so amounts from different accounts or cards become separate boxes. An
  // older single-object answer is read the same way.
  const losses = Array.isArray(out.total_loss) ? out.total_loss : out.total_loss ? [out.total_loss] : [];
  for (const raw of losses) {
    const item = raw as Record<string, unknown> | null;
    const quote = quoted(sourceText, item);
    const amount = money(item);
    if (quote && amount && amount.amount > 0) add("total_loss", { ...amount, account: oneOf(ACCOUNT_TYPES, item?.account) }, [quote], [item]);
  }
  const recovered = out.amount_recovered_or_offered as Record<string, unknown> | null;
  const recoveredQuote = quoted(sourceText, recovered);
  const recoveredAmount = money(recovered);
  if (recoveredQuote && recoveredAmount) add("amount_recovered_or_offered", recoveredAmount, [recoveredQuote], [recovered]);

  for (const [field, factKey] of [
    ["reported_to_bank", "reported_to_bank"],
    ["written_complaint", "written_complaint_sent"],
    ["reported_to_police", "reported_to_police"],
  ] as const) {
    const item = out[field] as Record<string, unknown> | null;
    const quote = quoted(sourceText, item);
    const value = normaliseYesNo(item?.value);
    if (!quote || !value || value === "unsure") continue;
    add(factKey, {
      value,
      date: normaliseDate(item?.date),
      reference: typeof item?.reference === "string" && item.reference.trim() ? item.reference.trim().slice(0, 80) : null,
      channel: null,
    }, [quote], [item]);
  }

  // A police report states that a police report was made, whatever the model returned for it (walkthrough, 9 Nov:
  // the report was read, its number was not, so the number typed in the answers went unchecked).
  if (documentType === "police_report") {
    const number = POLICE_REPORT_NUMBER.exec(sourceText.slice(0, 1500));
    const police = candidates.find((c) => c.factKey === "reported_to_police");
    if (number && police && (police.value as { value: string }).value === "yes" && !(police.value as { reference: string | null }).reference) {
      (police.value as { reference: string | null }).reference = number[1];
    } else if (number && !police) {
      add("reported_to_police", { value: "yes", date: null, reference: number[1], channel: null }, [number[0]], [{ confidence: 1 }]);
    }
  }

  const reply = out.bank_reply as Record<string, unknown> | null;
  const replyStatus = oneOf(REPLY_STATUSES, reply?.status);
  const replyQuote = quoted(sourceText, reply);
  if (replyStatus && replyQuote) {
    add("bank_reply", {
      status: replyStatus,
      date: normaliseDate(reply?.date),
      outcome: oneOf(REPLY_OUTCOMES, reply?.outcome),
      qualifies: null,
      reference: null,
    }, [replyQuote], [reply]);
  }

  const discovered = out.date_discovered as Record<string, unknown> | null;
  const discoveredDate = normaliseDate(discovered?.date);
  const discoveredQuote = quoted(sourceText, discovered);
  if (discoveredDate && discoveredQuote) add("date_discovered", discoveredDate, [discoveredQuote], [discovered]);

  parseUpdateFacts(out, sourceText, source.sourceType, add);

  return candidates;
}

// ---------------------------------------------------------------------------------------------------------------
// FIDReC update facts (brief v5, 3b)
// ---------------------------------------------------------------------------------------------------------------

/** Singapore time. A record that gives a time without a zone is read as Singapore time (the institutions are in SG). */
export const RECORD_DEFAULT_OFFSET = "+08:00";

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

export function normaliseDateTime(value: unknown, defaultOffset = RECORD_DEFAULT_OFFSET): IsoDateTime | null {
  if (typeof value !== "string") return null;
  const m = DATE_TIME_PATTERN.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone] = m;
  const date = `${y}-${mo}-${d}`;
  if (normaliseDate(date) !== date || Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59) return null;
  const offset = !zone ? defaultOffset : zone.toUpperCase() === "Z" ? "+00:00" : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return `${date}T${h}:${mi}:${s ?? "00"}${offset}`;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9a-f:]+(?:\d{1,3}(?:\.\d{1,3}){3})?$/i;

/** An IPv4 or IPv6 address as written, or null. Syntax only; the lookup (ip-location) parses it fully. */
export function normaliseIpText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ip = value.trim();
  if (IPV4.test(ip)) return ip;
  if (ip.includes(":") && IPV6.test(ip) && ip.length <= 45 && (ip.match(/::/g) ?? []).length <= 1) return ip.toLowerCase();
  return null;
}

function shortText(value: unknown, max = 120): string | null {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, max) : null;
}

// Identifiers are personal data and the record is the only source for them: one that is not in the line's own words
// (its quote, itself checked against the source) is dropped, never guessed or borrowed from another line.
function verbatim(line: string, value: string | null): string | null {
  return value && squash(line).includes(squash(value)) ? value : null;
}

type Add = (factKey: FactCandidate["factKey"], value: unknown, quotes: string[], items?: unknown[]) => void;

export function parseAccessEvent(item: unknown, sourceText: string): AccessEvent | null {
  const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const kind = oneOf(ACCESS_EVENT_KINDS, e.kind);
  const line = quoted(sourceText, e);
  if (!kind || !line) return null;
  return {
    timestamp: normaliseDateTime(e.timestamp),
    kind,
    deviceLabel: shortText(e.device_label),
    deviceRef: verbatim(line, shortText(e.device_ref, 80)),
    ip: verbatim(line, normaliseIpText(e.ip)),
    channel: shortText(e.channel, 60),
    authorisedBy: shortText(e.authorised_by),
    sentTo: shortText(e.sent_to),
    relatedTransactionIndex: null,
  };
}

export function parseCardAuthEvent(item: unknown, sourceText: string): CardAuthEvent | null {
  const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const line = quoted(sourceText, e);
  if (!line) return null;
  const walletProvisionedAt = normaliseDateTime(e.wallet_provisioned_at);
  return {
    timestamp: normaliseDateTime(e.timestamp),
    transactionIndex: null,
    cardScheme: oneOf(CARD_SCHEMES, e.card_scheme) ?? "not_known",
    merchant: shortText(e.merchant),
    merchantCountry: shortText(e.merchant_country, 60),
    entryMode: oneOf(ENTRY_MODES, e.entry_mode) ?? "not_known",
    authentication: oneOf(CARD_AUTHENTICATIONS, e.authentication) ?? "not_known",
    authenticationResult: oneOf(CARD_AUTHENTICATION_RESULTS, e.authentication_result) ?? "not_known",
    sentTo: shortText(e.sent_to),
    deviceLabel: shortText(e.device_label),
    deviceRef: verbatim(line, shortText(e.device_ref, 80)),
    tokenRef: verbatim(line, shortText(e.token_ref, 80)),
    walletProvisionedAt,
    walletDeviceLabel: shortText(e.wallet_device_label),
    walletProvisioningAuthentication: oneOf(WALLET_PROVISIONING_AUTHENTICATIONS, e.wallet_provisioning_authentication) ??
      (walletProvisionedAt ? "not_known" : null),
    walletProvisioningSentTo: shortText(e.wallet_provisioning_sent_to),
    walletTokenRemovedAt: normaliseDateTime(e.wallet_token_removed_at),
  };
}

function parseUpdateFacts(out: Record<string, unknown>, sourceText: string, sourceType: SourceType, add: Add): void {
  const item = (key: string) => (out[key] && typeof out[key] === "object" ? out[key] : null) as Record<string, unknown> | null;

  for (const factKey of ["access_record_requested", "card_dispute_requested"] as const) {
    const event = item(factKey);
    const quote = quoted(sourceText, event);
    const value = normaliseYesNo(event?.value);
    if (!quote || !value || value === "unsure") continue;
    add(factKey, {
      value,
      date: normaliseDate(event?.date),
      reference: null,
      channel: factKey === "card_dispute_requested" ? shortText(event?.channel, 60) : null,
    }, [quote], [event]);
  }

  // Everything below is stated only by documents (brief 3b); a story or answer that returns it is ignored.
  if (sourceType !== "document") return;

  for (const [field, factKey, parse] of [
    ["access_events", "access_events", parseAccessEvent],
    ["card_auth_events", "card_auth_events", parseCardAuthEvent],
  ] as const) {
    const raw = list(out[field]);
    const events = raw.map((e) => ({ event: parse(e, sourceText), raw: e })).filter((e) => e.event !== null);
    if (!events.length) continue;
    add(factKey, events.map((e) => e.event), events.map((e) => quoted(sourceText, e.raw)!), events.map((e) => e.raw));
  }

  const response = item("card_dispute_response");
  const status = oneOf(CARD_DISPUTE_STATUSES, response?.status);
  const responseQuote = quoted(sourceText, response);
  if (status && responseQuote) {
    add("card_dispute_response", {
      status,
      date: normaliseDate(response?.date),
      reasonStated: shortText(response?.reason_stated, 300),
      outcome: shortText(response?.outcome, 300),
    }, [responseQuote], [response]);
  }

  // The institution's own word: it must be inside the quoted words, so the label printed is the letter's.
  const fault = item("institution_fault_label");
  const faultQuote = quoted(sourceText, fault);
  const label = shortText(fault?.label, 80);
  if (faultQuote && label && squash(faultQuote).includes(squash(label))) {
    add("institution_fault_label", { label, labelEvidenceId: null, conduct: shortText(fault?.conduct, 300), conductEvidenceId: null }, [faultQuote], [fault]);
  }

  const moneyOf = (m: Record<string, unknown> | null) =>
    m ? normaliseMoney(typeof m.amount === "number" ? m.amount : String(m.amount ?? ""), typeof m.currency === "string" ? m.currency.toUpperCase() : "SGD") : null;

  const balance = item("balance_before_first_disputed_payment");
  const balanceQuote = quoted(sourceText, balance);
  const balanceAmount = moneyOf(balance);
  if (balanceQuote && balanceAmount) add("balance_before_first_disputed_payment", balanceAmount, [balanceQuote], [balance]);

  const threshold = item("transaction_alert_threshold");
  const thresholdQuote = quoted(sourceText, threshold);
  const thresholdAmount = moneyOf(threshold);
  if (thresholdQuote && thresholdAmount && thresholdAmount.amount >= 0) {
    const setBy = oneOf(["default", "account_holder", "not_known"] as const, threshold?.set_by) ?? "not_known";
    add("transaction_alert_threshold", { amount: thresholdAmount, setBy }, [thresholdQuote], [threshold]);
  }

  const method = item("token_activation_method");
  const methodValue = oneOf(TOKEN_ACTIVATION_METHODS, method?.value);
  const methodQuote = quoted(sourceText, method);
  if (methodValue && methodValue !== "not_known" && methodQuote) add("token_activation_method", methodValue, [methodQuote], [method]);
}
