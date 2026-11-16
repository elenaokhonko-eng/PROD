// Server-side check of generated text against the confirmed facts (design 4.4). Deterministic: amounts, dates and
// institutions must come from the snapshot, and phrase lists catch direct contradictions of yes/no facts and
// unqualified statements of facts the user marked "not sure" or kept without a document. It catches direct
// contradictions, not every paraphrase.

import type { BankReply, FactKey, Institution, Money, ReportedEvent, TotalLoss, Transaction } from "./keys.ts";
import { INSTITUTION_NAME_SOURCE, institutionsMentioned } from "./institutions.ts";
import { daysBetween, normaliseDate } from "./normalise.ts";
import type { SnapshotFact } from "./snapshot.ts";

export type SnapshotFacts = Partial<Record<FactKey, SnapshotFact>>;

export interface OutputFailure {
  check: OutputCheck;
  detail: string;
}

// Hard rules protect the facts: a summary that breaks one after a retry is never shown. Soft rules are style: the
// text is regenerated with the violation fed back (free-evaluation hardening, 8 Nov).
export const HARD_CHECKS = ["amount", "date", "institution", "reference", "contradiction", "unqualified", "forbidden"] as const;
export const SOFT_CHECKS = ["person", "internal", "length"] as const;
export type OutputCheck = (typeof HARD_CHECKS)[number] | (typeof SOFT_CHECKS)[number];
export const isHardCheck = (check: OutputCheck) => (HARD_CHECKS as readonly string[]).includes(check);

export interface ValidateOptions {
  // Amounts the stage may state that are not case facts (prices, the S$150,000 FIDReC cap, fees).
  extraAmounts?: number[];
  // Dates the stage may state that are not case facts (SRF dates, a computed deadline, today).
  extraDates?: string[];
  // Text addressed to the claimant ("you"); "the user" or "the claimant" fails (free evaluation).
  secondPerson?: boolean;
  // Topics this output may not cover, e.g. an SRF verdict the server writes itself.
  forbidden?: Array<{ pattern: RegExp; detail: string }>;
  // Text shown to the person: no internal names or input field names, and a sensible length in words.
  userFacing?: { minWords: number; maxWords: number };
  // Facts whose value comes from a document (snapshot.ts documentedFacts).
  documented?: readonly FactKey[];
}

// Internal names and the input's field names ("Tier-0", "Lumi", "confirmed_facts", any snake_case key).
const INTERNAL = /\bTier[- ]?0\b|\bLumi\b|\bserver\b|\bJSON\b|\b[a-z]+(?:_[a-z]+)+\b/i;

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
export const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})\b/gi;

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
// Also "filing a police report" and a visit to a police station; advice ("consider filing a police report") is not a
// statement that it happened (corpus, 8 Nov).
const NOT_ADVICE = String.raw`(?<!\b(?:consider(?:ing)?|recommend(?:ed)?|suggest(?:ed)?|should|could|can|may|might|need to|want to|whether to|whether)\s+(?:\w+\s+){0,2})`;
const POLICE_AFFIRMED = new RegExp(
  String.raw`\b(?:reported|filed|lodged|made)\b[^.]{0,60}\bpolice\b|\bpolice report\b[^.]{0,40}\b(?:was|were|has been|had been)\s+(?:filed|lodged|made)\b|\bpolice report (?:no\.?|number|reference)` +
    String.raw`|${NOT_ADVICE}\b(?:filing|lodging|making)\b[^.]{0,20}\bpolice report\b|\b(?:contacted|called|informed|told)\s+the\s+police\b|\b(?:went|accompanied|brought|took)\b[^.]{0,60}\bpolice (?:station|centre|center|post)\b`,
  "i",
);
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
// "It is not confirmed whether you reported it to your bank" qualifies the report; "You reported it to your bank, but
// it is not confirmed whether the bank replied" does not. These phrases count only before the statement (corpus, 8 Nov).
const QUALIFIER_BEFORE = /\b(?:not (?:yet )?confirmed|not known|no confirmed|no confirmation|unknown|not clear|cannot be confirmed)\b/i;
const ASSERT_PATTERNS: Partial<Record<FactKey, RegExp>> = {};
// "You reported a loss of S$9,000" attributes an amount; it does not attribute an event, so it is not in ATTRIBUTED.
const AMOUNT_ATTRIBUTED = /\byou (?:reported|indicated|estimated|believe)\b/i;

// Reference codes ("G/20261004/0000", "DBS-SYN-0001"; capitals, so "mid-2026" is not one) and labelled references
// ("report number 123456").
const REFERENCE_CODE = /\b(?=[A-Z0-9/-]*\d)[A-Z][A-Z0-9]*(?:[/-][A-Z0-9]+)+\b/g;
const REFERENCE_LABELLED = /\b(?:report|reference|case|ref)(?:\s+(?:number|no\.?))?(?:\s+(?:of|is))?:?\s+(?=[A-Z0-9/-]*\d)([A-Z0-9][A-Z0-9/-]{3,})\b/gi;
const normaliseRef = (ref: string) => ref.toUpperCase().replace(/\s+/g, "");

function referencesMentioned(text: string): string[] {
  const found = [...text.matchAll(REFERENCE_CODE)].map((m) => m[0]).concat([...text.matchAll(REFERENCE_LABELLED)].map((m) => m[1]));
  return [...new Set(found.map(normaliseRef))]
    // Dates and amounts are checked on their own.
    .filter((ref) => !/^\d{4}-\d{2}-\d{2}$/.test(ref) && !/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(ref));
}

function factReferences(facts: SnapshotFacts): string[] {
  const refs: string[] = [];
  for (const key of ["bank_case_reference", "police_report_number"] as const) {
    const value = factValue<string>(facts, key);
    if (value) refs.push(normaliseRef(String(value)));
  }
  for (const key of ["reported_to_bank", "reported_to_police", "written_complaint_sent", "fidrec_filed"] as const) {
    const ref = factValue<ReportedEvent>(facts, key)?.reference;
    if (ref) refs.push(normaliseRef(ref));
  }
  return refs;
}
const sameAmount = (a: number, b: number) => Math.abs(a - b) <= 1;

function confirmedAmounts(facts: SnapshotFacts): number[] {
  const out: number[] = [];
  for (const key of ["total_loss", "amount_recovered_or_offered"] as const) {
    const money = factValue<TotalLoss>(facts, key, ["confirmed"]);
    if (money) out.push(money.amount, ...(money.portions ?? []).map((p) => p.amount.amount));
  }
  const paid = factValue<Transaction[]>(facts, "transactions", ["confirmed"]) ?? [];
  if (paid.length) out.push(...paid.map((t) => t.amount.amount), paid.reduce((s, t) => s + t.amount.amount, 0));
  return out;
}

function claimedAmounts(facts: SnapshotFacts): number[] {
  const out: number[] = [];
  const loss = factValue<TotalLoss>(facts, "total_loss", ["claimant_only"]);
  if (loss) out.push(loss.amount, ...(loss.portions ?? []).map((p) => p.amount.amount));
  const recovered = factValue<Money>(facts, "amount_recovered_or_offered", ["claimant_only"]);
  if (recovered) out.push(recovered.amount);
  const paid = factValue<Transaction[]>(facts, "transactions", ["claimant_only"]) ?? [];
  if (paid.length) out.push(...paid.map((t) => t.amount.amount), paid.reduce((s, t) => s + t.amount.amount, 0));
  const confirmed = confirmedAmounts(facts);
  return out.filter((a) => !confirmed.some((c) => sameAmount(a, c)));
}

function statesClaimedAmount(sentence: string, facts: SnapshotFacts): boolean {
  const claimed = claimedAmounts(facts);
  return claimed.length > 0 && [...sentence.matchAll(MONEY_PATTERN)].some((m) => claimed.some((a) => sameAmount(a, Number(m[1].replace(/,/g, "")))));
}

const amountAttributed = (sentence: string) => ATTRIBUTED.test(sentence) || AMOUNT_ATTRIBUTED.test(sentence) || UNCERTAIN.test(sentence);

const ATTRIBUTED = /\b(according to|the claimant (states|says|reports)|i state|i do not have|no copy|not (yet )?provided|unable to provide|without a (copy|document)|you (say|said|told us|have told us|mentioned|state|stated)|based on what you told us)\b/i;
// Only sentences that say the event happened need a qualifier; "provide a copy of your police report" asserts nothing.
// The bank is the one told ("reported it to your bank", "called the bank"), not "a loss from your bank account".
// The bank may be named ("reported it to DBS", "called OCBC"; corpus, 8 Nov).
const BANK_OR_NAMED = String.raw`(?:(?:your|the)\s+bank\b(?!\s+account)|(?:${INSTITUTION_NAME_SOURCE}))`;
const BANK_AFFIRMED = new RegExp(
  String.raw`\b(?:told|informed|contacted|notified|called)\s+${BANK_OR_NAMED}|\b(?:reported|reporting)\b[^.]{0,40}\bto\s+${BANK_OR_NAMED}`,
  "i",
);
// A reply from the bank stated as having happened ("the bank rejected my claim", "the final reply was ...").
const BANK_REPLY_PATTERN = new RegExp(
  String.raw`\b(?:bank|institution|${INSTITUTION_NAME_SOURCE})[^.]{0,60}\b(?:rejected|refused|declined|turned down|replied|responded|offered|provided (?:a |its |an )?(?:final )?(?:reply|response))\b` +
    String.raw`|\b(?:rejected|refused|declined) by ${BANK_OR_NAMED}|\bfinal reply\b[^.]{0,40}\b(?:was|is|said|stated)\b`,
  "i",
);
// "You have not received any reply", "no amount has been offered": a denied reply is not a reply (staging, 5 Nov).
const REPLY_NEGATED = /(?:\b(?:no|not|never|yet to|without)\b|n't)[^.]{0,40}\b(?:reply|replies|replied|response|responded|offer|offered|decision)\b/i;
// The negation must reach the reply itself: "OCBC offered you S$1,500, which you have not accepted" still asserts the
// offer (corpus, 8 Nov).
const BANK_REPLY_ASSERTED = {
  test: (s: string) => {
    const reply = BANK_REPLY_PATTERN.exec(s);
    if (!reply) return false;
    const negation = REPLY_NEGATED.exec(s);
    return !negation || negation.index >= reply.index + reply[0].length;
  },
};
const ASSERTS: Array<[FactKey, { test(sentence: string): boolean }]> = [
  ["reported_to_police", POLICE_AFFIRMED],
  ["reported_to_bank", BANK_AFFIRMED],
  ["bank_reply", BANK_REPLY_ASSERTED],
];
ASSERT_PATTERNS.reported_to_police = POLICE_AFFIRMED;
ASSERT_PATTERNS.reported_to_bank = BANK_AFFIRMED;
ASSERT_PATTERNS.bank_reply = BANK_REPLY_PATTERN;

function qualified(sentence: string, key: FactKey): boolean {
  if (UNCERTAIN.test(sentence)) return true;
  const at = ASSERT_PATTERNS[key]?.exec(sentence)?.index ?? -1;
  return at > 0 && QUALIFIER_BEFORE.test(sentence.slice(0, at));
}

// A police report number confirmed from a document shows the report was made, even when the "reported to police"
// answer itself came without one (staging, 8 Nov): saying so needs no "You told us that".
function documentedElsewhere(facts: SnapshotFacts, key: FactKey, documented: readonly FactKey[] = []): boolean {
  return key === "reported_to_police" && facts.police_report_number?.label === "confirmed" && documented.includes("police_report_number");
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

  // Bank, police and FIDReC references must be ones the person confirmed (corpus, 8 Nov: a report number taken from
  // the story that the confirm screen never showed).
  const references = factReferences(facts);
  for (const ref of referencesMentioned(text)) {
    if (!references.includes(ref)) failures.push({ check: "reference", detail: ref });
  }

  // Amounts kept without a document (the total or the payments) are attributed ("you told us"), unless a confirmed
  // amount is the same (corpus, 8 Nov).
  for (const sentence of sentences(text)) {
    if (statesClaimedAmount(sentence, facts) && !amountAttributed(sentence)) {
      failures.push({ check: "unqualified", detail: `amount has no document: ${sentence.slice(0, 160)}` });
    }
  }

  const confirmedInstitutions = (factValue<Institution[]>(facts, "institution_names") ?? []).map((i) => i.name.toLowerCase());
  // A payee on a payment the person confirmed ("SHOPEEPAY*SG") is where the money went, not an institution claim.
  const payees = (factValue<Transaction[]>(facts, "transactions") ?? []).map((t) => (t.payee ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const named of institutionsMentioned(text)) {
    const key = named.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (payees.some((p) => p && (p.includes(key) || key.includes(p)))) continue;
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
      if (fact.label === "not_sure" && !qualified(sentence, key)) {
        failures.push({ check: "unqualified", detail: `${key} is not confirmed: ${sentence.slice(0, 160)}` });
      }
      if (fact.label === "claimant_only" && !documentedElsewhere(facts, key, options.documented) && !ATTRIBUTED.test(sentence) && !qualified(sentence, key)) {
        failures.push({ check: "unqualified", detail: `${key} has no document: ${sentence.slice(0, 160)}` });
      }
    }
    if (options.userFacing && INTERNAL.test(sentence)) {
      failures.push({ check: "internal", detail: `internal wording: ${sentence.slice(0, 160)}` });
    }
    if (options.secondPerson && THIRD_PERSON.test(sentence)) {
      failures.push({ check: "person", detail: `write to the person as "you": ${sentence.slice(0, 160)}` });
    }
    for (const rule of options.forbidden ?? []) {
      if (rule.pattern.test(sentence)) failures.push({ check: "forbidden", detail: `${rule.detail}: ${sentence.slice(0, 160)}` });
    }
  }

  if (options.userFacing) {
    const words = text.split(/\s+/).filter(Boolean).length;
    const { minWords, maxWords } = options.userFacing;
    if (words < minWords || words > maxWords) {
      failures.push({ check: "length", detail: `${words} words; write between ${minWords} and ${maxWords}` });
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
export function qualifyUnsupportedStatements(text: string, facts: SnapshotFacts, documented: readonly FactKey[] = []): string {
  let out = text;
  const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  for (const sentence of sentences(text)) {
    if (statesClaimedAmount(sentence, facts) && !amountAttributed(sentence)) {
      out = out.replace(sentence, "You told us that " + lowerFirst(sentence));
      continue;
    }
    for (const [key, asserts] of ASSERTS) {
      const fact = facts[key];
      if (!fact || !asserts.test(sentence) || ATTRIBUTED.test(sentence) || qualified(sentence, key)) continue;
      if (fact.label !== "claimant_only" && fact.label !== "not_sure") continue;
      if (fact.label === "claimant_only" && documentedElsewhere(facts, key, documented)) continue;
      const prefix = fact.label === "claimant_only" ? "You told us that " : "It is not confirmed that ";
      const rest = /^[A-Z][a-z]/.test(sentence) && !/^I\b/.test(sentence) ? sentence[0].toLowerCase() + sentence.slice(1) : sentence;
      out = out.replace(sentence, prefix + rest);
      break;
    }
  }
  return out;
}
