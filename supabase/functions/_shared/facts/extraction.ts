// Model extraction of candidate facts from ONE source at a time (design 4.1). The model sees a single story, answer
// or document and is told not to reconcile. Its output is untrusted: every value is normalised, and a value whose
// quote does not appear in the source text is dropped.

import type {
  AccountType,
  BankReplyOutcome,
  BankReplyStatus,
  CredentialsShared,
  ImpersonatedEntityType,
  Instrument,
  PhishingChannel,
  ScamType,
  SourceType,
  Transaction,
} from "./keys.ts";
import type { FactCandidate } from "./reconcile.ts";
import { normaliseInstitution } from "./institutions.ts";
import { normaliseDate, normaliseMoney, normaliseYesNo } from "./normalise.ts";

export const FACT_EXTRACTION_PROMPT_VERSION = "fact-extract-v1";

const ACCOUNT_TYPES: AccountType[] = ["savings_or_current", "credit_card", "debit_card", "ewallet", "investment", "other"];
const SCAM_TYPES: ScamType[] = ["digital_phishing", "malware", "non_digital_phishing", "impersonation", "investment", "job", "romance", "ecommerce", "other"];
const CHANNELS: PhishingChannel[] = ["sms", "email", "messaging_app", "social_media", "website_or_ad", "phone_call", "other"];
const CREDENTIALS: CredentialsShared[] = ["entered_on_fake_site_or_app", "given_directly", "installed_app_or_malware", "not_shared", "unsure"];
const INSTRUMENTS: Instrument[] = ["account_transfer", "sg_card", "ewallet", "other"];
const REPLY_STATUSES: BankReplyStatus[] = ["none", "acknowledged", "interim", "final_reply"];
const REPLY_OUTCOMES: BankReplyOutcome[] = ["rejected", "partial_offer", "full_offer", "other"];
const IMPERSONATED: ImpersonatedEntityType[] = ["bank_or_fi", "government", "other_business", "private_person", "unsure"];

const TEMPLATE = {
  institutions: [{ name: "string", quote: "string" }],
  account_types: [{ value: ACCOUNT_TYPES.join("|"), quote: "string" }],
  scam_types: [{ value: SCAM_TYPES.join("|"), quote: "string" }],
  phishing_channel: { value: CHANNELS.join("|"), quote: "string" },
  credentials: { value: CREDENTIALS.join("|"), quote: "string" },
  transactions: [{ date: "YYYY-MM-DD|null", amount: "number", currency: "SGD|USD|...", payee: "string|null", card_last4: "string|null", instrument: INSTRUMENTS.join("|"), quote: "string" }],
  total_loss: { amount: "number", currency: "string", quote: "string" },
  reported_to_bank: { value: "yes|no", date: "YYYY-MM-DD|null", reference: "string|null", quote: "string" },
  written_complaint: { value: "yes|no", date: "YYYY-MM-DD|null", quote: "string" },
  bank_reply: { status: REPLY_STATUSES.join("|"), date: "YYYY-MM-DD|null", outcome: `${REPLY_OUTCOMES.join("|")}|null`, quote: "string" },
  reported_to_police: { value: "yes|no", date: "YYYY-MM-DD|null", reference: "string|null", quote: "string" },
  amount_recovered_or_offered: { amount: "number", currency: "string", quote: "string" },
  date_discovered: { date: "YYYY-MM-DD", quote: "string" },
  impersonated_entity_type: { value: IMPERSONATED.join("|"), quote: "string" },
};

const SOURCE_DESCRIPTIONS: Record<SourceType, string> = {
  story: "the claimant's own account of what happened",
  answer: "one answer the claimant typed into a form",
  document: "the text of one document the claimant uploaded",
};

export function buildFactExtractionPrompt(sourceType: SourceType, sourceText: string): string {
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
    "  an OTP or password was told or sent to the scammer; installed_app_or_malware when an app was installed.",
    "",
    `TEMPLATE: ${JSON.stringify(TEMPLATE)}`,
    "",
    "SOURCE:",
    sourceText,
  ].join("\n");
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

function quoted(sourceText: string, item: unknown): string | null {
  const quote = (item as { quote?: unknown } | null)?.quote;
  if (typeof quote !== "string" || !quote.trim()) return null;
  return squash(sourceText).includes(squash(quote)) ? quote.trim().slice(0, 300) : null;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseFactExtraction(
  raw: unknown,
  sourceText: string,
  source: { sourceType: SourceType; sourceRef: Record<string, unknown> },
): FactCandidate[] {
  const out = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const candidates: FactCandidate[] = [];
  const add = (factKey: FactCandidate["factKey"], value: unknown, quotes: string[]) => {
    candidates.push({
      factKey,
      value,
      sourceType: source.sourceType,
      sourceRef: { ...source.sourceRef, quotes },
    } as FactCandidate);
  };

  const institutions = list(out.institutions)
    .map((i) => ({ institution: normaliseInstitution((i as { name?: unknown })?.name), quote: quoted(sourceText, i) }))
    .filter((i) => i.institution && i.quote);
  if (institutions.length) {
    const byName = new Map(institutions.map((i) => [i.institution!.name.toLowerCase(), i.institution!]));
    add("institution_names", [...byName.values()], institutions.map((i) => i.quote!));
  }

  for (const [field, factKey, allowed] of [
    ["account_types", "account_types", ACCOUNT_TYPES],
    ["scam_types", "scam_type", SCAM_TYPES],
  ] as const) {
    const items = list(out[field])
      .map((i) => ({ value: oneOf(allowed as readonly string[], (i as { value?: unknown })?.value), quote: quoted(sourceText, i) }))
      .filter((i) => i.value && i.quote);
    if (items.length) add(factKey, [...new Set(items.map((i) => i.value!))], items.map((i) => i.quote!));
  }

  for (const [field, factKey, allowed] of [
    ["phishing_channel", "phishing_channel", CHANNELS],
    ["credentials", "credentials_or_otp_shared", CREDENTIALS],
    ["impersonated_entity_type", "impersonated_entity_type", IMPERSONATED],
  ] as const) {
    const value = oneOf(allowed as readonly string[], (out[field] as { value?: unknown } | null)?.value);
    const quote = quoted(sourceText, out[field]);
    if (value && quote) add(factKey, value, [quote]);
  }

  const transactions: Transaction[] = [];
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
  }
  if (transactions.length) add("transactions", transactions, transactionQuotes);

  for (const [field, factKey] of [
    ["total_loss", "total_loss"],
    ["amount_recovered_or_offered", "amount_recovered_or_offered"],
  ] as const) {
    const item = out[field] as Record<string, unknown> | null;
    const quote = quoted(sourceText, item);
    const amount = item ? normaliseMoney(typeof item.amount === "number" ? item.amount : String(item.amount ?? ""), typeof item.currency === "string" ? item.currency.toUpperCase() : "SGD") : null;
    if (quote && amount) add(factKey, amount, [quote]);
  }

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
    }, [quote]);
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
    }, [replyQuote]);
  }

  const discovered = out.date_discovered as Record<string, unknown> | null;
  const discoveredDate = normaliseDate(discovered?.date);
  const discoveredQuote = quoted(sourceText, discovered);
  if (discoveredDate && discoveredQuote) add("date_discovered", discoveredDate, [discoveredQuote]);

  return candidates;
}
