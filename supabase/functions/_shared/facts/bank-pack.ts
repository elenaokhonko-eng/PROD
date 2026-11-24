// The bank pack (S$18): a complaint to the bank, written as the person, from the confirmed bank facts (design K1:
// today's report template, with the snapshot as input and the free evaluation's prompt rules). The model writes only
// the prose (title, summary, requested resolution); every other section is built here from the confirmed facts. The
// prose goes through the same ladder as the free evaluation (summary-ladder.ts produceChecked): checked, repaired,
// regenerated once, and otherwise replaced by fixed wording, never "failed". Shared by run_bank_pack_v1 and its tests.

import { formatFactValue, formatMoney } from "./display.ts";
import { type EvidenceFinding, evidenceLists } from "./free-sections.ts";
import type { FactKey, Money, ReportedEvent, Transaction } from "./keys.ts";
import { assessSrf, srfAssessmentText, srfFactsFromSnapshot } from "./rules/srf.ts";
import { buildTier0Input, SRF_VERDICT, TIER0_EXTRA_DATES, type Tier0Finding } from "./tier0.ts";
import type { SnapshotFacts, ValidateOptions } from "./validate-output.ts";
import type { BankPackUpdate } from "./update/bank-pack-update.ts";
import { factsForModel, redactServerOnly } from "./update/model-guard.ts";

export const BANK_PACK_VERSION = "bank_pack_v1";
export const BANK_PACK_MIN_WORDS = 120;
export const BANK_PACK_MAX_WORDS = 900;

export const BANK_PACK_CHECKS: ValidateOptions = {
  extraDates: TIER0_EXTRA_DATES,
  firstPerson: true,
  forbidden: [{ pattern: SRF_VERDICT, detail: "the rules section is written by the server" }],
  userFacing: { minWords: BANK_PACK_MIN_WORDS, maxWords: BANK_PACK_MAX_WORDS },
};

/** The parts the model writes. */
export interface BankPackProse {
  title: string;
  executive_summary: string;
  requested_resolution: string;
}

export function parseBankPackProse(parsed: unknown): BankPackProse | null {
  const row = (parsed ?? {}) as Record<string, unknown>;
  const text = (key: keyof BankPackProse) => (typeof row[key] === "string" ? (row[key] as string).trim() : "");
  const prose = { title: text("title"), executive_summary: text("executive_summary"), requested_resolution: text("requested_resolution") };
  return prose.title && prose.executive_summary && prose.requested_resolution ? prose : null;
}

export const mapBankPackProse = (prose: BankPackProse, fn: (text: string) => string): BankPackProse => ({
  title: fn(prose.title),
  executive_summary: fn(prose.executive_summary),
  requested_resolution: fn(prose.requested_resolution),
});

export const bankPackTexts = (prose: BankPackProse) => [prose.title, prose.executive_summary, prose.requested_resolution];

/**
 * The free evaluation's input without its FIDReC signal: the confirmed facts, which facts lack a document, the story.
 * With the update's sections on (`redact` given), the record facts are left out and record values in the story are
 * replaced (condition B); otherwise unchanged.
 */
export function buildBankPackInput(args: {
  facts: SnapshotFacts;
  findings: readonly Tier0Finding[];
  storyText: string | null;
  update?: { redact: readonly string[] } | null;
}) {
  const update = args.update ?? null;
  const { fidrec_check: _fidrec, ...input } = buildTier0Input({
    facts: update ? factsForModel(args.facts) : args.facts,
    findings: args.findings,
    storyText: update && args.storyText !== null ? redactServerOnly(args.storyText, update.redact) : args.storyText,
    fidrecCheck: null,
  });
  return input;
}

export function bankPackSystem(previousFailures: string | null): string {
  return `You are writing a complaint to a bank's complaints team on behalf of someone who lost money to a scam. Write it as them, in the first person ("I", "my"). It must be factual, respectful and calm. It is not legal advice and makes no legal conclusion.

GROUND RULES
Use only facts explicitly present in the provided JSON. Do not infer, assume, invent facts, or introduce external knowledge. If something is missing, leave it out or say it is not known. Never write "the user", "the claimant", "the complainant" or "the customer".
Do not say whether the bank is liable, whether a refund is likely, or whether any rule was breached. Do not assert what the bank or the scammer did unless the confirmed facts say so. Do not say who added a payee unless the facts say so.
Do not use the word "unauthorised"; say "disputed payments" or "payments made as a result of the scam". If a password or one-time code was shared, say neutrally that you were deceived into giving the details.
Do not assess or mention the Shared Responsibility Framework (SRF), IMDA, telcos or mobile operators: GuideBuoy adds that section separately from fixed rules.

CONFIRMED FACTS (these override everything else in the input)
confirmed_facts holds the facts the person confirmed, each with a status.
- status "confirmed" or "claimant_only": state as fact, in the first person.
- status "not_sure" or "not_known": say it is not confirmed; never state a value for it.
Never state a date, amount, institution or reference that differs from confirmed_facts. primary_narrative is the person's own story: use it only for the order of events and context, never for a fact that confirmed_facts covers. If primary_narrative is null, write only from confirmed_facts. A fact listed in facts_not_confirmed, or missing from confirmed_facts, has no value in the complaint.
Never use the input's field names or internal names; describe the facts in ordinary words.

OUTPUT
Return STRICT JSON only, with exactly these keys:
{
"title": "a short, plain title for the complaint",
"executive_summary": "the complaint: what happened, in order (how the contact started, what I did, the payments, what I did afterwards)",
"requested_resolution": "what I ask the bank to do: review the disputed payments and restore my funds; give me the findings of its investigation; and confirm which alerts, checks or holds applied to these payments"
}
Write ${BANK_PACK_MIN_WORDS + 80} to ${BANK_PACK_MAX_WORDS - 200} words in total, in plain prose.${previousFailures ? `

YOUR PREVIOUS ANSWER WAS REJECTED for these problems:
${previousFailures}
Fix these points and keep everything else faithful to the confirmed facts.` : ""}`;
}

// The fixed-wording version used when the model's prose can't be shown: the confirmed facts in plain first-person
// sentences, with nothing added.
export const BANK_PACK_FALLBACK_TITLE = "Complaint about disputed payments";

const LETTER_LABELS: Partial<Record<FactKey, string>> = {
  institution_names: "Bank or payment provider",
  account_types: "Accounts or cards the money was taken from",
  scam_type: "Type of scam",
  phishing_channel: "How the scammer first contacted me",
  credentials_or_otp_shared: "Whether I shared a password or one-time code",
  transactions: "The payments I dispute",
  total_loss: "Amount lost",
  date_discovered: "When I found out",
  reported_to_bank: "When I told the bank",
  bank_case_reference: "Case reference",
  written_complaint_sent: "Written complaint",
  reported_to_police: "Police report",
  police_report_number: "Police report number",
};

export function bankPackFallback(facts: SnapshotFacts): BankPackProse {
  const lines = (Object.keys(LETTER_LABELS) as FactKey[]).flatMap((key) => {
    const fact = facts[key];
    if (!fact) return [];
    const value = fact.label === "not_sure" || fact.label === "not_known" ? "not confirmed" : formatFactValue(key, fact.value);
    return [`- ${LETTER_LABELS[key]}: ${value}`];
  });
  return {
    title: BANK_PACK_FALLBACK_TITLE,
    executive_summary: [
      "I am writing to complain about payments made from my account as a result of a scam. These are the facts as I have confirmed them:",
      ...lines,
    ].join("\n"),
    requested_resolution:
      "I ask the bank to review the disputed payments and restore my funds, to give me the findings of its investigation, " +
      "and to confirm which alerts, checks or holds applied to these payments.",
  };
}

type ReportedKey = "reported_to_bank" | "written_complaint_sent" | "reported_to_police";
const REPORTED_EVENTS: Array<[ReportedKey, string]> = [
  ["reported_to_bank", "I reported the scam to the bank"],
  ["written_complaint_sent", "I sent a written complaint"],
  ["reported_to_police", "I reported the scam to the police"],
];

function confirmedValue<T>(facts: SnapshotFacts, key: FactKey): T | null {
  const fact = facts[key];
  return fact && (fact.label === "confirmed" || fact.label === "claimant_only") ? (fact.value as T) : null;
}

/** Timeline from the confirmed facts: each payment, when the person found out, and who they told. Dated items first. */
export function bankPackTimeline(facts: SnapshotFacts): Array<{ date?: string; event: string }> {
  const items: Array<{ date?: string; event: string }> = [];
  for (const t of confirmedValue<Transaction[]>(facts, "transactions") ?? []) {
    items.push({ ...(t.date ? { date: t.date } : {}), event: `Payment of ${formatMoney(t.amount)}${t.payee ? ` to ${t.payee}` : ""}` });
  }
  const discovered = confirmedValue<string>(facts, "date_discovered");
  if (discovered) items.push({ date: discovered, event: "I found out about the scam" });
  for (const [key, event] of REPORTED_EVENTS) {
    const reported = confirmedValue<ReportedEvent>(facts, key);
    if (reported?.value === "yes") items.push({ ...(reported.date ? { date: reported.date } : {}), event });
  }
  return items.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : 0));
}

export function bankPackTransactions(facts: SnapshotFacts): Array<Record<string, string>> {
  return (confirmedValue<Transaction[]>(facts, "transactions") ?? []).map((t) => ({
    date: t.date ?? "Not known",
    amount: formatMoney(t.amount),
    paid_to: t.payee ?? "Not known",
    method: t.channel ?? t.instrument ?? "Not known",
  }));
}

export interface BankPackReport {
  report_version: typeof BANK_PACK_VERSION;
  title: string;
  executive_summary: string;
  requested_resolution: string;
  timeline: Array<{ date?: string; event: string }>;
  disputed_transactions: Array<Record<string, string>>;
  total_loss: string | null;
  evidence_checklist: Array<{ label: string; present: boolean }>;
  /** How the rules may apply, per portion of the loss: the free evaluation's server-written section (rules/srf.ts). */
  rules_assessment: string;
  /** "model" or "fallback" (the fixed-wording version). */
  prose_source: "model" | "fallback";
  /** Only with FIDREC_UPDATE_SECTIONS_ENABLED on (absent otherwise, so the report is as before): the requests for
   * missing technical records (brief v5, decision 9). */
  update_record_requests?: string[];
  /** Only with the switch on: what EUPG Section 8 says, for a dispute reported on or after 16 June 2025 (Decision 8). */
  update_section8?: BankPackUpdate["section8"];
  /** Only with the switch on: pinned citations and statement revisions (3.2 rule 4), and run flags. */
  update_citations?: BankPackUpdate["citations"];
  update_statements?: BankPackUpdate["statements"];
  update_flags?: BankPackUpdate["flags"];
  update_generated_on?: string;
}

export function assembleBankPack(args: {
  prose: BankPackProse;
  source: "model" | "fallback";
  facts: SnapshotFacts;
  findings: readonly EvidenceFinding[];
  /** The update's lines, when FIDREC_UPDATE_SECTIONS_ENABLED is on. Absent: the report is unchanged. */
  update?: BankPackUpdate | null;
}): BankPackReport {
  const { facts } = args;
  const { shown, missing } = evidenceLists(facts, args.findings);
  const loss = confirmedValue<Money>(facts, "total_loss");
  const update = args.update
    ? {
      update_record_requests: args.update.requests,
      update_section8: args.update.section8,
      update_citations: args.update.citations,
      update_statements: args.update.statements,
      update_flags: args.update.flags,
      update_generated_on: args.update.generatedOn,
    }
    : {};
  return {
    report_version: BANK_PACK_VERSION,
    ...args.prose,
    timeline: bankPackTimeline(facts),
    disputed_transactions: bankPackTransactions(facts),
    total_loss: loss ? formatMoney(loss) : null,
    evidence_checklist: [
      ...shown.map((label) => ({ label, present: true })),
      ...missing.map((label) => ({ label, present: false })),
    ],
    rules_assessment: srfAssessmentText(assessSrf(srfFactsFromSnapshot(facts))),
    prose_source: args.source,
    ...update,
  };
}
