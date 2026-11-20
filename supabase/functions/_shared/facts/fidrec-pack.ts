// The FIDReC pack (S$188): the case for FIDReC's case officer, written in the third person from the confirmed "fidrec"
// facts (stage2-plan §3a, milestone 3; design C4). Built like the bank pack (bank-pack.ts): the model writes the summary,
// each side's position and the arguments for each side, each argument tied to evidence IDs from the index below; the
// rest is built here from the confirmed facts. The same ladder (summary-ladder.ts produceChecked) checks, repairs,
// regenerates once, and otherwise uses fixed wording. Shared by run_fidrec_pack_v1 and its tests.

import { formatMoney } from "./display.ts";
import { DOCUMENT_CONFIDENCE_THRESHOLD } from "./extraction.ts";
import { DOCUMENT_LABELS, type EvidenceFinding, evidenceLists } from "./free-sections.ts";
import type { BankReply, FactKey, Money, ReportedEvent, Transaction } from "./keys.ts";
import { type FidrecAvailability, fidrecAvailability, FIDREC_RULES } from "./rules/fidrec.ts";
import { assessSrf, srfAssessmentText, srfFactsFromSnapshot } from "./rules/srf.ts";
import { bankPackTransactions } from "./bank-pack.ts";
import { buildTier0Input, SRF_VERDICT, TIER0_EXTRA_DATES, type Tier0Finding } from "./tier0.ts";
import { normaliseDate } from "./normalise.ts";
import {
  DATE_PATTERN,
  MONEY_PATTERN,
  type OutputFailure,
  referencesMentioned,
  type SnapshotFacts,
  validateOutput,
  type ValidateOptions,
} from "./validate-output.ts";

export const FIDREC_PACK_VERSION = "fidrec_pack_v1";
export const FIDREC_PACK_MIN_WORDS = 250;
export const FIDREC_PACK_MAX_WORDS = 1_600;
// The letter text the model may quote is capped: the institution's position needs the reasons, not the whole file.
export const FINAL_REPLY_MAX_CHARS = 12_000;

// Amounts FIDReC's rules put in the text (the S$50 fee, the S$150,000 award cap).
const RULE_AMOUNTS = [FIDREC_RULES.adjudicationFeeSgd.individual, FIDREC_RULES.awardCapSgd.value];

export function fidrecPackChecks(extraDates: string[], documents: DocumentQuotables = EMPTY_QUOTABLES): ValidateOptions {
  return {
    extraAmounts: [...RULE_AMOUNTS, ...documents.amounts],
    extraDates: [...TIER0_EXTRA_DATES, ...extraDates, ...documents.dates],
    extraReferences: documents.references,
    thirdPerson: true,
    forbidden: [{ pattern: SRF_VERDICT, detail: "the rules section is written by the server" }],
    userFacing: { minWords: FIDREC_PACK_MIN_WORDS, maxWords: FIDREC_PACK_MAX_WORDS },
  };
}

export interface FidrecArgument {
  text: string;
  evidence_ids: string[];
}

/** A duty the institution had, from a retrieved clause (R1…), set against what the evidence (E1…) shows. */
export interface FidrecDuty {
  text: string;
  clause_ids: string[];
  evidence_ids: string[];
}

/** The parts the model writes. */
export interface FidrecPackProse {
  title: string;
  executive_summary: string;
  claimant_position: string;
  institution_position: string;
  arguments_for_claimant: FidrecArgument[];
  arguments_for_institution: FidrecArgument[];
  institution_duties: FidrecDuty[];
}

function parseDuties(value: unknown): FidrecDuty[] {
  if (!Array.isArray(value)) return [];
  const ids = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((id): id is string => typeof id === "string").map((id) => id.trim().toUpperCase()))] : [];
  return value.slice(0, 10).flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    return text ? [{ text, clause_ids: ids(row.clause_ids), evidence_ids: ids(row.evidence_ids) }] : [];
  });
}

function parseArguments(value: unknown): FidrecArgument[] | null {
  if (!Array.isArray(value)) return null;
  const out: FidrecArgument[] = [];
  for (const item of value.slice(0, 12)) {
    const row = (item ?? {}) as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    const ids = Array.isArray(row.evidence_ids) ? row.evidence_ids.filter((id): id is string => typeof id === "string") : [];
    out.push({ text, evidence_ids: [...new Set(ids.map((id) => id.trim().toUpperCase()))] });
  }
  return out;
}

export function parseFidrecPackProse(parsed: unknown): FidrecPackProse | null {
  const row = (parsed ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string).trim() : "");
  const forClaimant = parseArguments(row.arguments_for_claimant);
  const forInstitution = parseArguments(row.arguments_for_institution);
  const prose = {
    title: text("title"),
    executive_summary: text("executive_summary"),
    claimant_position: text("claimant_position"),
    institution_position: text("institution_position"),
  };
  if (!prose.title || !prose.executive_summary || !prose.claimant_position || !prose.institution_position) return null;
  if (!forClaimant?.length || !forInstitution) return null;
  return {
    ...prose,
    arguments_for_claimant: forClaimant,
    arguments_for_institution: forInstitution,
    institution_duties: parseDuties(row.institution_duties),
  };
}

export const mapFidrecPackProse = (prose: FidrecPackProse, fn: (text: string) => string): FidrecPackProse => ({
  title: fn(prose.title),
  executive_summary: fn(prose.executive_summary),
  claimant_position: fn(prose.claimant_position),
  institution_position: fn(prose.institution_position),
  arguments_for_claimant: prose.arguments_for_claimant.map((a) => ({ ...a, text: fn(a.text) })),
  arguments_for_institution: prose.arguments_for_institution.map((a) => ({ ...a, text: fn(a.text) })),
  institution_duties: prose.institution_duties.map((d) => ({ ...d, text: fn(d.text) })),
});

export const fidrecPackTexts = (prose: FidrecPackProse) => [
  prose.title,
  prose.executive_summary,
  prose.claimant_position,
  prose.institution_position,
  ...prose.arguments_for_claimant.map((a) => a.text),
  ...prose.arguments_for_institution.map((a) => a.text),
];

/** Every argument cites at least one evidence ID, and only IDs from the index (design: arguments tied to evidence). */
export function evidenceIdFailures(prose: FidrecPackProse, index: readonly EvidenceIndexEntry[]): OutputFailure[] {
  const known = new Set(index.map((e) => e.id));
  const failures: OutputFailure[] = [];
  for (const argument of [...prose.arguments_for_claimant, ...prose.arguments_for_institution, ...prose.institution_duties]) {
    const unknown = argument.evidence_ids.filter((id) => !known.has(id));
    if (unknown.length) failures.push({ check: "reference", detail: `evidence IDs not in the index: ${unknown.join(", ")}` });
    if (known.size && !argument.evidence_ids.length) {
      failures.push({ check: "reference", detail: `argument without evidence IDs: ${argument.text.slice(0, 120)}` });
    }
  }
  return failures;
}

// The duties section may name the SRF, the E-Payments Guidelines and the MAS notices: that is its job. It may not
// decide the dispute: FIDReC does.
export const DUTY_CONCLUSION = /\b(?:is|was|are|were)\s+(?:therefore\s+)?liable\b|\bmust\s+(?:refund|reimburse|repay|compensate)\b|\bis entitled to (?:a )?(?:refund|reimbursement)\b/i;

export function dutyFailures(
  prose: FidrecPackProse,
  clauses: readonly RegulatoryClause[],
  facts: SnapshotFacts,
  options: ValidateOptions,
): OutputFailure[] {
  const known = new Set(clauses.map((c) => c.id));
  const failures: OutputFailure[] = [];
  for (const duty of prose.institution_duties) {
    const unknown = duty.clause_ids.filter((id) => !known.has(id));
    if (unknown.length) failures.push({ check: "reference", detail: `clause IDs not provided: ${unknown.join(", ")}` });
    if (!duty.clause_ids.length) failures.push({ check: "reference", detail: `duty without a clause: ${duty.text.slice(0, 120)}` });
  }
  const texts = prose.institution_duties.map((d) => d.text);
  if (!texts.length) return failures;
  const dutyOptions: ValidateOptions = {
    ...options,
    forbidden: [{ pattern: DUTY_CONCLUSION, detail: "describe the duty and what the records show; FIDReC decides liability" }],
    userFacing: undefined,
  };
  return [...failures, ...validateOutput(texts, facts, dutyOptions)];
}

// ---------------------------------------------------------------------------------------------------------------
// Regulatory clauses (the regulatory_clauses table: SRF, E-Payments Guidelines, ABS Code, MAS notices)
// ---------------------------------------------------------------------------------------------------------------

export interface RegulatoryClause {
  /** R1, R2, … for the duties to cite. */
  id: string;
  source: string;
  clause_ref: string | null;
  title: string | null;
  text: string;
}

export const CLAUSE_TEXT_MAX_CHARS = 1_500;

/** What the retrieval asks for: the institution's duties on the confirmed facts of this case. */
export function regulatoryQuery(facts: SnapshotFacts): string {
  const parts = [
    "Duties of a bank or payment institution to protect customer accounts from unauthorised access, scams and fraud:",
    "authentication, new device and digital token activation, cooling periods, transaction and limit alerts,",
    "fraud surveillance and blocking of suspicious transactions, kill switch, handling of customer reports and disputes.",
  ];
  const scam = facts.scam_type?.value;
  if (Array.isArray(scam) && scam.length) parts.push(`Scam type: ${scam.join(", ")}.`);
  const channel = facts.phishing_channel?.value;
  if (typeof channel === "string") parts.push(`First contact by ${channel}.`);
  const transactions = (facts.transactions?.value as Transaction[] | null) ?? [];
  const instruments = [...new Set(transactions.map((t) => t.instrument).filter(Boolean))];
  if (instruments.length) parts.push(`Payment types: ${instruments.join(", ")}.`);
  if (instruments.some((i) => /card/.test(String(i)))) parts.push("Card transactions, chargebacks and card scheme disputes.");
  return parts.join(" ");
}

export function numberClauses(
  rows: ReadonlyArray<{ clause_ref: string | null; title: string | null; text_content: string; source: string }>,
): RegulatoryClause[] {
  return rows.map((row, i) => ({
    id: `R${i + 1}`,
    source: row.source,
    clause_ref: row.clause_ref,
    title: row.title,
    text: row.text_content.slice(0, CLAUSE_TEXT_MAX_CHARS),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence index and the final reply
// ---------------------------------------------------------------------------------------------------------------

export interface EvidenceIndexEntry {
  /** E1, E2, … in the order the documents first support a confirmed fact. */
  id: string;
  documentId: string;
  /** The document's kind, never its file name (file names can carry other people's names; free-sections.ts). */
  label: string;
  facts: FactKey[];
}

type StoredSource = { sourceType?: string; sourceRef?: Record<string, unknown> };
type StoredValue = { value?: unknown; sources?: StoredSource[] };

function chosenValues(finding: Tier0Finding): StoredValue[] {
  const values = (finding.values ?? []) as StoredValue[];
  const r = finding.resolution as { kind?: string; index?: number; indices?: number[] } | null;
  if (!r || r.kind === "agreed" || r.kind === "acknowledged") return values.slice(0, 1);
  if (r.kind === "choice") return values[r.index ?? -1] ? [values[r.index ?? -1]] : [];
  if (r.kind === "choices") return (r.indices ?? []).map((i) => values[i]).filter(Boolean);
  return [];
}

// The evidence pipeline's document types (evidence_processed_v2), named by kind.
const EVIDENCE_KIND_LABELS: Record<string, string> = {
  PHISHING_EMAIL_COPY_OR_DESCRIPTION: "the scam message (uploaded)",
  BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS: "your bank statement (uploaded)",
  CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS: "your card statement (uploaded)",
  SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS: "your SMS alerts (uploaded)",
  SMS_LOG_TOKEN_BINDING_NOTIFICATIONS: "your SMS alerts (uploaded)",
  SMS_LOG_BANK_ACCOUNT_LIMIT_NOTIFICATIONS: "your SMS alerts (uploaded)",
  SMS_LOG_CREDIT_CARD_BLOCKING_NOTIFICATIONS: "your SMS alerts (uploaded)",
  BANK_SCAM_FRAUD_HOTLINE_CALL_LOG: "your call log with the bank (uploaded)",
  POLICE_REPORT_OF_FRAUD_SCAM: "your police report (uploaded)",
  TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK: "your transaction dispute with the bank (uploaded)",
  BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY: "the bank's reply on the disputed transactions (uploaded)",
  BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE: "the bank's investigation reply (uploaded)",
  BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL: "a letter or email from your bank (uploaded)",
  RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA: "the bank's login, device and IP records (uploaded)",
  TIMELINE_NOTES: "your timeline notes (uploaded)",
  CYBER_EXPERT_REPORT: "a technical expert's report (uploaded)",
};

export interface CaseDocument {
  id: string;
  /** evidence_processed_v2's type, when known. */
  evidenceType: string | null;
  text: string | null;
}

/**
 * The documents behind the confirmed facts, numbered E1… for the arguments to cite, then every other ready document
 * (such as the bank's device and IP records, which support no single fact but show who accessed the account).
 */
export function buildEvidenceIndex(findings: readonly Tier0Finding[], documents: readonly CaseDocument[] = []): EvidenceIndexEntry[] {
  const byDocument = new Map<string, EvidenceIndexEntry>();
  for (const finding of findings) {
    for (const value of chosenValues(finding)) {
      for (const source of value.sources ?? []) {
        const documentId = source.sourceType === "document" ? source.sourceRef?.documentId : null;
        if (typeof documentId !== "string" || !documentId) continue;
        let entry = byDocument.get(documentId);
        if (!entry) {
          const type = String(source.sourceRef?.documentType ?? "");
          entry = { id: `E${byDocument.size + 1}`, documentId, label: DOCUMENT_LABELS[type] ?? "an uploaded document", facts: [] };
          byDocument.set(documentId, entry);
        }
        const key = finding.fact_key as FactKey;
        if (!entry.facts.includes(key)) entry.facts.push(key);
      }
    }
  }
  for (const document of documents) {
    if (byDocument.has(document.id)) continue;
    const label = (document.evidenceType && EVIDENCE_KIND_LABELS[document.evidenceType]) ?? "an uploaded document";
    byDocument.set(document.id, { id: `E${byDocument.size + 1}`, documentId: document.id, label, facts: [] });
  }
  return [...byDocument.values()];
}

export const DOCUMENT_EXCERPT_MAX_CHARS = 4_000;
export const DOCUMENTS_TOTAL_MAX_CHARS = 24_000;

/** The documents' own words for the model, capped per document and in total; the index order decides what fits. */
export function documentExcerpts(index: readonly EvidenceIndexEntry[], documents: readonly CaseDocument[]) {
  let budget = DOCUMENTS_TOTAL_MAX_CHARS;
  return index.flatMap((entry) => {
    const text = documents.find((d) => d.id === entry.documentId)?.text?.trim();
    if (!text || budget <= 0) return [];
    const excerpt = text.slice(0, Math.min(DOCUMENT_EXCERPT_MAX_CHARS, budget));
    budget -= excerpt.length;
    return [{ id: entry.id, document: entry.label, excerpt }];
  });
}

export interface DocumentQuotables {
  dates: string[];
  amounts: number[];
  references: string[];
}

const EMPTY_QUOTABLES: DocumentQuotables = { dates: [], amounts: [], references: [] };

/** Dates, amounts and reference codes written in the documents the model was given, which it may quote. */
export function documentQuotables(excerpts: ReadonlyArray<{ excerpt: string }>): DocumentQuotables {
  const text = excerpts.map((e) => e.excerpt).join("\n");
  const dates = [...text.matchAll(DATE_PATTERN)]
    .map((m) => normaliseDate(m[1].replace(/(\d)(st|nd|rd|th)/, "$1")))
    .filter((d): d is string => Boolean(d));
  const amounts = [...text.matchAll(MONEY_PATTERN)].map((m) => Number(m[1].replace(/,/g, ""))).filter(Number.isFinite);
  return { dates: [...new Set(dates)], amounts: [...new Set(amounts)], references: referencesMentioned(text) };
}

/**
 * The bank's final-reply letter, whose text the model may use for the institution's position: only a document read as
 * a bank letter with confidence above 0.7 that gave the confirmed "final reply" answer (stage2-plan milestone 3).
 */
export function qualifyingFinalReplyDocumentId(findings: readonly Tier0Finding[]): string | null {
  const finding = findings.find((f) => f.fact_key === "bank_reply");
  if (!finding) return null;
  for (const value of chosenValues(finding)) {
    if ((value.value as BankReply | null)?.status !== "final_reply") continue;
    for (const source of value.sources ?? []) {
      const ref = source.sourceRef ?? {};
      const confidence = typeof ref.confidence === "number" ? ref.confidence : 0;
      if (source.sourceType === "document" && ref.documentType === "bank_correspondence" && confidence > DOCUMENT_CONFIDENCE_THRESHOLD) {
        if (typeof ref.documentId === "string" && ref.documentId) return ref.documentId;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Route (decision 7) and input
// ---------------------------------------------------------------------------------------------------------------

function confirmedValue<T>(facts: SnapshotFacts, key: FactKey): T | null {
  const fact = facts[key];
  return fact && (fact.label === "confirmed" || fact.label === "claimant_only") ? (fact.value as T) : null;
}

/** Whether FIDReC can be approached today on the confirmed facts (rules/fidrec.ts F2, F3). */
export function fidrecRouteFromFacts(facts: SnapshotFacts, today: string): FidrecAvailability {
  return fidrecAvailability(
    {
      reportedToBank: confirmedValue<ReportedEvent>(facts, "reported_to_bank"),
      writtenComplaint: confirmedValue<ReportedEvent>(facts, "written_complaint_sent"),
      bankReply: confirmedValue<BankReply>(facts, "bank_reply"),
    },
    today,
  );
}

export function buildFidrecPackInput(args: {
  facts: SnapshotFacts;
  findings: readonly Tier0Finding[];
  storyText: string | null;
  finalReplyText: string | null;
  evidenceIndex: readonly EvidenceIndexEntry[];
  documents?: ReadonlyArray<{ id: string; document: string; excerpt: string }>;
  clauses?: readonly RegulatoryClause[];
  /** Every date the text may state: the confirmed facts', the documents' and the filing deadline. */
  allowedDates?: readonly string[];
}) {
  const { fidrec_check: _fidrec, ...input } = buildTier0Input({ facts: args.facts, findings: args.findings, storyText: args.storyText, fidrecCheck: null });
  return {
    ...input,
    // The institution's own words, from a qualifying final-reply letter only; null when there is none.
    final_reply_letter: args.finalReplyText ? args.finalReplyText.slice(0, FINAL_REPLY_MAX_CHARS) : null,
    evidence_index: args.evidenceIndex.map((e) => ({ id: e.id, document: e.label, supports: e.facts })),
    documents: args.documents ?? [],
    allowed_dates: [...new Set(args.allowedDates ?? [])].sort(),
    regulatory_clauses: (args.clauses ?? []).map((c) => ({ id: c.id, source: c.source, clause: c.clause_ref, title: c.title, text: c.text })),
  };
}

export function fidrecPackSystem(previousFailures: string | null): string {
  return `You are preparing a complaint for FIDReC, Singapore's dispute resolution centre for financial services, on behalf of someone who lost money to a scam. The reader is FIDReC's case officer. Write in the third person: "the complainant" and "the institution". Be factual, neutral and precise. It is not legal advice and makes no legal conclusion.

GROUND RULES
Use only facts explicitly present in the provided JSON. Do not infer, assume, invent facts, or introduce external knowledge.
Do not say whether the institution is liable, whether a refund is likely, or whether any rule was breached. Present each side's points fairly; the arguments for the institution must be the strongest fair points it could make on these facts.
Do not use the word "unauthorised"; say "disputed payments".
Outside institution_duties, do not assess or mention the Shared Responsibility Framework (SRF), IMDA, telcos or mobile operators: GuideBuoy adds that assessment separately from fixed rules.

CONFIRMED FACTS (these override everything else in the input)
- status "confirmed": state as fact.
- status "claimant_only": attribute it ("the complainant states that"); there is no document for it.
- status "not_sure" or "not_known": say it is not confirmed; never state a value for it.
Never state a date, amount, institution or reference that differs from confirmed_facts. State only dates listed in allowed_dates; describe any other timing without a date (for example "the same evening" or "the next day"). primary_narrative is the complainant's own story: use it only for the order of events and context. If primary_narrative is null, write only from confirmed_facts.
final_reply_letter is the institution's own final reply. If it is present, base institution_position on it and quote no more than a short phrase. If it is null, say the institution's written position is not available.
evidence_index lists the documents, each with an ID (E1, E2, …); documents gives their text. Every argument must cite the IDs of the documents that support it, and only IDs from evidence_index. If evidence_index is empty, cite none. Use what the documents show, including the institution's own records of logins, devices, IP addresses, alerts and limits.

INSTITUTION DUTIES
regulatory_clauses lists clauses (R1, R2, …) from the SRF Guidelines, the E-Payments User Protection Guidelines, the ABS Code and MAS notices on technology risk and cyber hygiene. In institution_duties, set out each duty these clauses give the institution that is relevant to what happened, and what the evidence shows about it: for example a cooling period after a new device or token, alerts, fraud surveillance, transaction limits, blocking, or handling of the report. Cite the clause IDs and the evidence IDs for each. Only use clauses from regulatory_clauses; do not cite any other rule. Describe; do not conclude: never say the institution is liable or must refund. A duty may be met on paper under one framework and not under another: say so where the evidence shows it. For card transactions: under the card schemes' rules (Visa, Mastercard, American Express) a chargeback is the card issuer's right against the scheme, not a duty it owes the cardholder, so do not say the institution had to raise one. Set out its card duties from the cardholder agreement and the ABS Code of Practice for credit cards where those are in regulatory_clauses. If regulatory_clauses is empty, return an empty list.
Never use the input's field names or internal names; describe the facts in ordinary words.

OUTPUT
Return STRICT JSON only, with exactly these keys:
{
"title": "a short, plain title",
"executive_summary": "what happened and what the complainant asks FIDReC to consider, in order",
"claimant_position": "the complainant's position",
"institution_position": "the institution's position",
"arguments_for_claimant": [{ "text": "one point", "evidence_ids": ["E1"] }],
"arguments_for_institution": [{ "text": "one point", "evidence_ids": ["E2"] }],
"institution_duties": [{ "text": "the duty and what the records show", "clause_ids": ["R1"], "evidence_ids": ["E3"] }]
}
Write ${FIDREC_PACK_MIN_WORDS + 150} to ${FIDREC_PACK_MAX_WORDS - 400} words in total, with 2 to 6 arguments for each side.${previousFailures ? `

YOUR PREVIOUS ANSWER WAS REJECTED for these problems:
${previousFailures}
Fix these points and keep everything else faithful to the confirmed facts.` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed wording and the sections built from the facts
// ---------------------------------------------------------------------------------------------------------------

export const FIDREC_PACK_FALLBACK_TITLE = "Complaint about disputed payments";

const CASE_LABELS: Partial<Record<FactKey, string>> = {
  institution_names: "Institution",
  scam_type: "Type of scam",
  phishing_channel: "How the scammer first made contact",
  credentials_or_otp_shared: "Whether a password or one-time code was shared",
  transactions: "Disputed payments",
  total_loss: "Amount lost",
  amount_recovered_or_offered: "Amount recovered or offered",
  reported_to_bank: "Reported to the institution",
  written_complaint_sent: "Written complaint",
  bank_reply: "The institution's reply",
  reported_to_police: "Police report",
};

export function fidrecPackFallback(facts: SnapshotFacts): FidrecPackProse {
  const lines = (Object.keys(CASE_LABELS) as FactKey[]).flatMap((key) => {
    const fact = facts[key];
    if (!fact) return [];
    const value = fact.label === "not_sure" || fact.label === "not_known"
      ? "not confirmed"
      : key === "transactions" || key === "total_loss" || key === "amount_recovered_or_offered"
        ? formatAmount(key, fact.value)
        : summariseValue(fact.value);
    return [`- ${CASE_LABELS[key]}: ${value}${fact.label === "claimant_only" ? " (stated by the complainant; no document)" : ""}`];
  });
  return {
    title: FIDREC_PACK_FALLBACK_TITLE,
    executive_summary: ["The complainant disputes payments made as a result of a scam. The confirmed facts are:", ...lines].join("\n"),
    claimant_position: "The complainant asks FIDReC to review the disputed payments on the confirmed facts and the evidence listed.",
    institution_position: "The institution's written position is set out in its reply, where one has been provided.",
    arguments_for_claimant: [],
    arguments_for_institution: [],
    institution_duties: [],
  };
}

function formatAmount(key: FactKey, value: unknown): string {
  if (key === "transactions") {
    const list = (value as Transaction[] | null) ?? [];
    return list.map((t) => `${t.date ?? "date not known"}, ${formatMoney(t.amount)}`).join("; ") || "none";
  }
  const money = value as Money | null;
  return money ? formatMoney(money) : "not known";
}

function summariseValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => summariseValue(v)).join(", ");
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.name === "string") return row.name;
    if (typeof row.value === "string") return [row.value, typeof row.date === "string" ? `on ${row.date}` : ""].filter(Boolean).join(" ");
    if (typeof row.status === "string") return [row.status.replace(/_/g, " "), typeof row.date === "string" ? `on ${row.date}` : ""].filter(Boolean).join(" ");
    return "recorded";
  }
  return String(value ?? "not known").replace(/_/g, " ");
}

const EVENTS: Array<[FactKey, string]> = [
  ["reported_to_bank", "The complainant reported the scam to the institution"],
  ["written_complaint_sent", "The complainant sent a written complaint"],
  ["reported_to_police", "The complainant reported the scam to the police"],
];

/** Chronology from the confirmed facts, in the third person. Dated items first. */
export function fidrecChronology(facts: SnapshotFacts): Array<{ date?: string; event: string }> {
  const items: Array<{ date?: string; event: string }> = [];
  for (const t of confirmedValue<Transaction[]>(facts, "transactions") ?? []) {
    items.push({ ...(t.date ? { date: t.date } : {}), event: `Payment of ${formatMoney(t.amount)}${t.payee ? ` to ${t.payee}` : ""}` });
  }
  const discovered = confirmedValue<string>(facts, "date_discovered");
  if (discovered) items.push({ date: discovered, event: "The complainant found out about the scam" });
  for (const [key, event] of EVENTS) {
    const reported = confirmedValue<ReportedEvent>(facts, key);
    if (reported?.value === "yes") items.push({ ...(reported.date ? { date: reported.date } : {}), event });
  }
  const reply = confirmedValue<BankReply>(facts, "bank_reply");
  if (reply && reply.status !== "none") {
    items.push({ ...(reply.date ? { date: reply.date } : {}), event: reply.status === "final_reply" ? "The institution gave its final reply" : "The institution replied" });
  }
  return items.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : 0));
}

/** How and when FIDReC can be approached, with the fee: fixed wording from the Terms of Reference (rules/fidrec.ts). */
export function fidrecRouteText(route: FidrecAvailability): string {
  const fee = `If the case goes to adjudication, FIDReC charges individuals a S$${FIDREC_RULES.adjudicationFeeSgd.individual} case fee.`;
  if (route.available && route.route === "final_reply") {
    return `The institution gave its final reply. FIDReC must receive the complaint by ${route.deadline} (six months after the final reply). ${fee}`;
  }
  if (route.available) return `The complainant complained in writing more than four weeks ago and the complaint is not resolved. ${fee}`;
  return fee;
}

export interface FidrecPackReport {
  report_version: typeof FIDREC_PACK_VERSION;
  title: string;
  executive_summary: string;
  claimant_position: string;
  institution_position: string;
  arguments_for_claimant: FidrecArgument[];
  arguments_for_institution: FidrecArgument[];
  institution_duties: FidrecDuty[];
  /** The clauses the duties cite, with their source documents. */
  regulatory_sources: Array<{ id: string; source: string; clause_ref: string | null; title: string | null }>;
  timeline: Array<{ date?: string; event: string }>;
  disputed_transactions: Array<Record<string, string>>;
  total_loss: string | null;
  evidence_index: Array<{ id: string; document: string }>;
  evidence_checklist: Array<{ label: string; present: boolean }>;
  route: string;
  rules_assessment: string;
  /** Whether the institution's position was written from its final-reply letter. */
  final_reply_used: boolean;
  prose_source: "model" | "fallback";
}

export function assembleFidrecPack(args: {
  prose: FidrecPackProse;
  source: "model" | "fallback";
  facts: SnapshotFacts;
  findings: readonly EvidenceFinding[];
  evidenceIndex: readonly EvidenceIndexEntry[];
  route: FidrecAvailability;
  finalReplyUsed: boolean;
  clauses?: readonly RegulatoryClause[];
}): FidrecPackReport {
  const { facts } = args;
  const { shown, missing } = evidenceLists(facts, args.findings);
  const loss = confirmedValue<Money>(facts, "total_loss");
  return {
    report_version: FIDREC_PACK_VERSION,
    ...args.prose,
    regulatory_sources: (args.clauses ?? [])
      .filter((c) => args.prose.institution_duties.some((d) => d.clause_ids.includes(c.id)))
      .map((c) => ({ id: c.id, source: c.source, clause_ref: c.clause_ref, title: c.title })),
    timeline: fidrecChronology(facts),
    disputed_transactions: bankPackTransactions(facts),
    total_loss: loss ? formatMoney(loss) : null,
    evidence_index: args.evidenceIndex.map((e) => ({ id: e.id, document: e.label })),
    evidence_checklist: [...shown.map((label) => ({ label, present: true })), ...missing.map((label) => ({ label, present: false }))],
    route: fidrecRouteText(args.route),
    rules_assessment: srfAssessmentText(assessSrf(srfFactsFromSnapshot(facts))),
    final_reply_used: args.finalReplyUsed,
    prose_source: args.source,
  };
}
