// Server-side check of generated text against the confirmed facts (design 4.4). Deterministic: amounts, dates and
// institutions must come from the snapshot, and phrase lists catch direct contradictions of yes/no facts and
// unqualified statements of facts the user marked "not sure" or kept without a document. It catches direct
// contradictions, not every paraphrase.

import type { BankReply, FactKey, Institution, Money, ReportedEvent, TotalLoss, Transaction } from "./keys.ts";
import { institutionsMentioned } from "./institutions.ts";
import { daysBetween, normaliseDate } from "./normalise.ts";
import type { SnapshotFact } from "./snapshot.ts";

export type SnapshotFacts = Partial<Record<FactKey, SnapshotFact>>;

export interface OutputFailure {
  check: "amount" | "date" | "institution" | "contradiction" | "unqualified" | "person" | "forbidden";
  detail: string;
}

export interface ValidateOptions {
  // Amounts the stage may state that are not case facts (prices, the S$150,000 FIDReC cap, fees).
  extraAmounts?: number[];
  // Dates the stage may state that are not case facts (SRF dates, a computed deadline, today).
  extraDates?: string[];
  // Text addressed to the claimant ("you"); "the user" or "the claimant" fails (free evaluation).
  secondPerson?: boolean;
  // Topics this output may not cover, e.g. an SRF verdict the server writes itself.
  forbidden?: Array<{ pattern: RegExp; detail: string }>;
}

const THIRD_PERSON = /\bthe (?:user|claimant|complainant|customer|consumer|victim)\b/i;

export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function factValue<T>(facts: SnapshotFacts, key: FactKey, labels: SnapshotFact["label"][] = ["confirmed", "claimant_only"]): T | null {
  const fact = facts[key];
  return fact && labels.includes(fact.label) ? (fact.value as T) : null;
}

function allowedAmounts(facts: SnapshotFacts, extra: number[]): number[] {
  const amounts = [...extra];
  for (const key of ["total_loss", "amount_recovered_or_offered"] as const) {
    const money = factValue<TotalLoss>(facts, key);
    if (money) amounts.push(money.amount);
    // A loss confirmed as several amounts (one per account) may be stated part by part (staging, 8 Nov).
    for (const portion of money?.portions ?? []) amounts.push(portion.amount.amount);
  }
  const transactions = factValue<Transaction[]>(facts, "transactions") ?? [];
  amounts.push(...transactions.map((t) => t.amount.amount));
  if (transactions.length) {
    const byInstrument = new Map<string, number>();
    for (const t of transactions) byInstrument.set(t.instrument ?? "other", (byInstrument.get(t.instrument ?? "other") ?? 0) + t.amount.amount);
    amounts.push(transactions.reduce((s, t) => s + t.amount.amount, 0), ...byInstrument.values());
    const loss = factValue<Money>(facts, "total_loss");
    const recovered = factValue<Money>(facts, "amount_recovered_or_offered");
    if (loss && recovered) amounts.push(loss.amount - recovered.amount);
  }
  return amounts;
}

const MONEY_PATTERN = /(?:S\$|SGD\s?|US\$|USD\s?|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})\b/gi;

function factDates(facts: SnapshotFacts): string[] {
  const dates: string[] = [];
  for (const t of factValue<Transaction[]>(facts, "transactions") ?? []) if (t.date) dates.push(t.date);
  for (const key of ["reported_to_bank", "reported_to_police", "written_complaint_sent", "fidrec_filed"] as const) {
    const event = factValue<ReportedEvent>(facts, key);
    if (event?.date) dates.push(event.date);
  }
  const reply = factValue<BankReply>(facts, "bank_reply");
  if (reply?.date) dates.push(reply.date);
  const discovered = factValue<string>(facts, "date_discovered");
  if (discovered) dates.push(discovered);
  return dates;
}

// Only auxiliary and filler words may sit between the negation and the verb, so "did not reply after I reported it
// to the police" is not read as a denial.
const FILLER = String.raw`(?:(?:yet|ever|even|have|has|had|been|be|a|any|the|this|it|that|so|to)\s+){0,3}`;
const POLICE_VERBS = String.raw`(?:report|reported|file|filed|lodge|lodged|make|made)\b[^.]{0,60}\bpolice\b`;
const BANK_VERBS = String.raw`(?:report|reported|contact|contacted|inform|informed|tell|told|notify|notified)\b[^.]{0,40}\bbank\b`;
const POLICE_DENIED = new RegExp(
  String.raw`(?:\b(?:not|never|yet to)|n't)\s+${FILLER}${POLICE_VERBS}|\bno police report\b|\bwithout (?:a |filing a )?police report\b`,
  "i",
);
const POLICE_AFFIRMED = /\b(?:reported|filed|lodged|made)\b[^.]{0,60}\bpolice\b|\bpolice report\b[^.]{0,40}\b(?:was|were|has been|had been)\s+(?:filed|lodged|made)\b|\bpolice report (?:no\.?|number|reference)/i;
const BANK_CONTACT_CLAIMED = /\b(?:I|you|we)\s+(?:(?!was\b|were\b|been\b|being\b)\w+\s+){0,2}?(?:reported|told|informed|contacted|notified|called)\b(?!\s+by\b)[^.]{0,40}\bbank\b/i;
const BANK_DENIED = new RegExp(String.raw`(?:\b(?:not|never|yet to)|n't)\s+${FILLER}${BANK_VERBS}`, "i");

// Phrases that contradict each confirmed yes/no value.
const CONTRADICTIONS: Array<{ key: FactKey; whenValue: "yes" | "no"; contradicts: (sentence: string) => boolean }> = [
  { key: "reported_to_police", whenValue: "yes", contradicts: (s) => POLICE_DENIED.test(s) },
  { key: "reported_to_police", whenValue: "no", contradicts: (s) => POLICE_AFFIRMED.test(s) && !POLICE_DENIED.test(s) },
  { key: "reported_to_bank", whenValue: "yes", contradicts: (s) => BANK_DENIED.test(s) },
  // Only the person themselves contacting the bank counts; "I was told by the bank" is not a report to the bank.
  { key: "reported_to_bank", whenValue: "no", contradicts: (s) => BANK_CONTACT_CLAIMED.test(s) && !BANK_DENIED.test(s) },
  // Dependency rule: the bank cannot have replied if it was never told.
  { key: "reported_to_bank", whenValue: "no", contradicts: (s) => BANK_REPLY_ASSERTED.test(s) },
];

const UNCERTAIN = /\b(not sure|unsure|unconfirmed|unclear|may have|might have|cannot confirm|can't confirm|does not recall|do not recall)\b/i;
const ATTRIBUTED = /\b(according to|the claimant (states|says|reports)|i state|i do not have|no copy|not (yet )?provided|unable to provide|without a (copy|document)|you (say|said|told us|have told us|mentioned|state|stated)|based on what you told us)\b/i;
// Only sentences that say the event happened need a qualifier; "provide a copy of your police report" asserts nothing.
const BANK_AFFIRMED = /\b(?:reported|told|informed|contacted|notified)\b[^.]{0,40}\bbank\b/i;
// A reply from the bank stated as having happened ("the bank rejected my claim", "the final reply was ...").
const BANK_REPLY_PATTERN = /\b(?:bank|institution)\b[^.]{0,60}\b(?:rejected|refused|declined|turned down|replied|responded|offered)\b|\bfinal reply\b[^.]{0,40}\b(?:was|is|said|stated)\b/i;
// "You have not received any reply", "no amount has been offered": a denied reply is not a reply (staging, 5 Nov).
const REPLY_NEGATED = /(?:\b(?:no|not|never|yet to|without)\b|n't)[^.]{0,40}\b(?:reply|replies|replied|response|responded|offer|offered|decision)\b/i;
const BANK_REPLY_ASSERTED = { test: (s: string) => BANK_REPLY_PATTERN.test(s) && !REPLY_NEGATED.test(s) };
const ASSERTS: Array<[FactKey, { test(sentence: string): boolean }]> = [
  ["reported_to_police", POLICE_AFFIRMED],
  ["reported_to_bank", BANK_AFFIRMED],
  ["bank_reply", BANK_REPLY_ASSERTED],
];

// A police report number confirmed from a document shows the report was made, even when the "reported to police"
// answer itself came without one (staging, 8 Nov): saying so needs no "You told us that".
function documentedElsewhere(facts: SnapshotFacts, key: FactKey): boolean {
  return key === "reported_to_police" && facts.police_report_number?.label === "confirmed";
}

export function validateOutput(output: unknown, facts: SnapshotFacts, options: ValidateOptions = {}): OutputFailure[] {
  const text = collectStrings(output).join("\n");
  const failures: OutputFailure[] = [];

  const amounts = allowedAmounts(facts, options.extraAmounts ?? []);
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const amount = Number(match[1].replace(/,/g, ""));
    if (!amounts.some((a) => Math.abs(a - amount) <= 1)) failures.push({ check: "amount", detail: match[0].trim() });
  }

  const dates = [...factDates(facts), ...(options.extraDates ?? [])];
  for (const match of text.matchAll(DATE_PATTERN)) {
    const iso = normaliseDate(match[1].replace(/(\d)(st|nd|rd|th)/, "$1"));
    if (iso && !dates.some((d) => Math.abs(daysBetween(d, iso)) <= 1)) failures.push({ check: "date", detail: match[0] });
  }

  const confirmedInstitutions = (factValue<Institution[]>(facts, "institution_names") ?? []).map((i) => i.name.toLowerCase());
  for (const named of institutionsMentioned(text)) {
    if (!confirmedInstitutions.includes(named.name.toLowerCase())) failures.push({ check: "institution", detail: named.name });
  }

  for (const sentence of sentences(text)) {
    for (const rule of CONTRADICTIONS) {
      const event = factValue<ReportedEvent>(facts, rule.key, ["confirmed"]);
      if (event?.value === rule.whenValue && rule.contradicts(sentence)) {
        failures.push({ check: "contradiction", detail: `${rule.key}: ${sentence.slice(0, 160)}` });
      }
    }
    for (const [key, asserts] of ASSERTS) {
      const fact = facts[key];
      if (!fact || !asserts.test(sentence)) continue;
      if (fact.label === "not_sure" && !UNCERTAIN.test(sentence)) {
        failures.push({ check: "unqualified", detail: `${key} is not confirmed: ${sentence.slice(0, 160)}` });
      }
      if (fact.label === "claimant_only" && !documentedElsewhere(facts, key) && !ATTRIBUTED.test(sentence) && !UNCERTAIN.test(sentence)) {
        failures.push({ check: "unqualified", detail: `${key} has no document: ${sentence.slice(0, 160)}` });
      }
    }
    if (options.secondPerson && THIRD_PERSON.test(sentence)) {
      failures.push({ check: "person", detail: `write to the person as "you": ${sentence.slice(0, 160)}` });
    }
    for (const rule of options.forbidden ?? []) {
      if (rule.pattern.test(sentence)) failures.push({ check: "forbidden", detail: `${rule.detail}: ${sentence.slice(0, 160)}` });
    }
  }

  // Self-contradiction: the text says the bank was not told and also that the bank replied.
  const all = sentences(text);
  const denied = all.find((s) => BANK_DENIED.test(s));
  const replied = all.find((s) => BANK_REPLY_ASSERTED.test(s) && !BANK_DENIED.test(s));
  if (denied && replied) {
    failures.push({ check: "contradiction", detail: `says the bank was not told but also that it replied: ${replied.slice(0, 160)}` });
  }

  return failures;
}

export function describeFailures(failures: readonly OutputFailure[]): string {
  return failures.map((f) => `- ${f.check}: ${f.detail}`).join("\n");
}

// Fallback when the model keeps stating a fact the user marked "not sure", or kept without a document, as certain:
// the server prefixes exactly those sentences ("You told us that ...", "It is not confirmed that ..."). Only the
// "unqualified" check is repaired this way; any other failure still refuses the output.
export function qualifyUnsupportedStatements(text: string, facts: SnapshotFacts): string {
  let out = text;
  for (const sentence of sentences(text)) {
    for (const [key, asserts] of ASSERTS) {
      const fact = facts[key];
      if (!fact || !asserts.test(sentence) || ATTRIBUTED.test(sentence) || UNCERTAIN.test(sentence)) continue;
      if (fact.label !== "claimant_only" && fact.label !== "not_sure") continue;
      if (fact.label === "claimant_only" && documentedElsewhere(facts, key)) continue;
      const prefix = fact.label === "claimant_only" ? "You told us that " : "It is not confirmed that ";
      const rest = /^[A-Z][a-z]/.test(sentence) && !/^I\b/.test(sentence) ? sentence[0].toLowerCase() + sentence.slice(1) : sentence;
      out = out.replace(sentence, prefix + rest);
      break;
    }
  }
  return out;
}
