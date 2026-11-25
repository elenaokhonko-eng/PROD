// Deterministic reconciliation (design section 2): candidate values from the story, answers and documents are
// compared per fact key and turned into findings. The model never takes part here; it only extracted the candidates.

import {
  ANSWER_ONLY_FACT_KEYS,
  type BankReply,
  type FactKey,
  type FactValues,
  type Institution,
  type Money,
  RECONCILED_FACT_KEYS,
  type ReportedEvent,
  type SourceType,
  type TotalLoss,
  type Transaction,
} from "./keys.ts";
import { daysBetween } from "./normalise.ts";

export interface FactCandidate<K extends FactKey = FactKey> {
  factKey: K;
  value: FactValues[K];
  sourceType: SourceType;
  sourceRef: Record<string, unknown>;
}

export type FindingType = "conflict" | "unsupported" | "missing" | "agreed";

export interface FindingValue {
  value: unknown;
  sources: Array<{ sourceType: SourceType; sourceRef: Record<string, unknown> }>;
}

export interface ReconciledFinding {
  factKey: FactKey;
  findingType: FindingType;
  values: FindingValue[];
  valuesHash: string;
}

// Facts that normally come with a document. A "yes" here with no document behind it is `unsupported`.
const DOCUMENT_EXPECTED: ReadonlySet<FactKey> = new Set(["transactions", "total_loss", "reported_to_police", "bank_reply"]);

const MONEY_TOLERANCE = 1;
const DATE_TOLERANCE_DAYS = 1;
const TRANSACTION_AMOUNT_TOLERANCE = 0.01;

function sameMoney(a: Money, b: Money, tolerance = MONEY_TOLERANCE): boolean {
  if (a.currency !== b.currency) return false;
  return Math.abs(a.amount - b.amount) <= tolerance;
}

function sameDate(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return Math.abs(daysBetween(a, b)) <= DATE_TOLERANCE_DAYS;
}

// References are compared as their own facts (bank_case_reference, police_report_number), so a missing or different
// reference never turns "Yes" into a conflict (finding A2).
function sameEvent(a: ReportedEvent, b: ReportedEvent): boolean {
  return a.value === b.value && sameDate(a.date, b.date);
}

function sameReference(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return key(a) === key(b);
}

function sameLoss(a: TotalLoss, b: TotalLoss): boolean {
  return sameMoney(a, b) && (!a.account || !b.account || a.account === b.account);
}

function sameBankReply(a: BankReply, b: BankReply): boolean {
  // "No final reply yet" (the FIDReC route answer) agrees with any reply that is not final and conflicts only with a
  // final reply, so a final-reply letter is put to the person on the confirm screen (PB-24).
  if (a.status === "not_final" || b.status === "not_final") return a.status !== "final_reply" && b.status !== "final_reply";
  return a.status === b.status && sameDate(a.date, b.date) && (!a.outcome || !b.outcome || a.outcome === b.outcome);
}

function setKey(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.toLowerCase()))].sort();
}

function isSubset(a: readonly string[], b: readonly string[]): boolean {
  return a.every((v) => b.includes(v));
}

function setValues(key: FactKey, value: unknown): string[] | null {
  if (key === "institution_names") return setKey((value as Institution[]).map((i) => i.name));
  if (key === "account_types" || key === "scam_type") return setKey(value as string[]);
  return null;
}

// "Unsure" adds no information when another source gives a definite value.
function isUnsure(key: FactKey, value: unknown): boolean {
  if (value === "unsure") return true;
  if (key === "reported_to_bank" || key === "reported_to_police" || key === "written_complaint_sent" || key === "fidrec_filed") {
    return (value as ReportedEvent).value === "unsure";
  }
  return false;
}

// Matching for transactions: date within a day and amount within 1%, one-to-one, largest amounts first.
export function matchTransactions(a: readonly Transaction[], b: readonly Transaction[]) {
  const pairs: Array<[number, number]> = [];
  const usedB = new Set<number>();
  const order = a.map((_, i) => i).sort((x, y) => a[y].amount.amount - a[x].amount.amount);
  for (const i of order) {
    const ta = a[i];
    const j = b.findIndex((tb, idx) =>
      !usedB.has(idx) &&
      ta.amount.currency === tb.amount.currency &&
      Math.abs(ta.amount.amount - tb.amount.amount) <= Math.max(TRANSACTION_AMOUNT_TOLERANCE * ta.amount.amount, 0.01) &&
      sameDate(ta.date, tb.date) &&
      (!ta.last4 || !tb.last4 || ta.last4 === tb.last4)
    );
    if (j >= 0) {
      usedB.add(j);
      pairs.push([i, j]);
    }
  }
  return {
    pairs,
    unmatchedA: a.map((_, i) => i).filter((i) => !pairs.some(([x]) => x === i)),
    unmatchedB: b.map((_, j) => j).filter((j) => !usedB.has(j)),
  };
}

function equivalent(key: FactKey, a: unknown, b: unknown): boolean {
  switch (key) {
    case "institution_names":
    case "account_types":
    case "scam_type": {
      const sa = setValues(key, a)!;
      const sb = setValues(key, b)!;
      return isSubset(sa, sb) || isSubset(sb, sa);
    }
    case "total_loss":
      return sameLoss(a as TotalLoss, b as TotalLoss);
    case "amount_recovered_or_offered":
      return sameMoney(a as Money, b as Money);
    case "bank_case_reference":
    case "police_report_number":
      return sameReference(a as string, b as string);
    case "reported_to_bank":
    case "reported_to_police":
    case "written_complaint_sent":
    case "fidrec_filed":
      return sameEvent(a as ReportedEvent, b as ReportedEvent);
    case "bank_reply":
      return sameBankReply(a as BankReply, b as BankReply);
    case "transactions": {
      const m = matchTransactions(a as Transaction[], b as Transaction[]);
      return m.unmatchedA.length === 0 && m.unmatchedB.length === 0;
    }
    default:
      return JSON.stringify(a) === JSON.stringify(b);
  }
}

// Merging equivalent values: sets take the union, events and replies keep the most complete record.
function merge(key: FactKey, a: unknown, b: unknown): unknown {
  if (key === "institution_names") {
    const byName = new Map<string, Institution>();
    for (const i of [...(a as Institution[]), ...(b as Institution[])]) byName.set(i.name.toLowerCase(), i);
    return [...byName.values()];
  }
  if (key === "account_types" || key === "scam_type") return [...new Set([...(a as string[]), ...(b as string[])])];
  if (key === "total_loss") {
    const x = a as TotalLoss;
    const y = b as TotalLoss;
    const portions = x.portions?.length ? x.portions : y.portions;
    return { ...x, account: x.account ?? y.account ?? null, ...(portions?.length ? { portions } : {}) };
  }
  if (key === "reported_to_bank" || key === "reported_to_police" || key === "written_complaint_sent" || key === "fidrec_filed") {
    const x = a as ReportedEvent;
    const y = b as ReportedEvent;
    return { value: x.value, date: x.date ?? y.date, reference: x.reference ?? y.reference, channel: x.channel ?? y.channel };
  }
  if (key === "bank_reply") {
    const x = a as BankReply;
    const y = b as BankReply;
    // The more specific reply wins over "no final reply yet".
    if (x.status === "not_final") return y;
    if (y.status === "not_final") return x;
    return {
      status: x.status,
      date: x.date ?? y.date,
      outcome: x.outcome ?? y.outcome,
      qualifies: x.qualifies ?? y.qualifies,
      reference: x.reference ?? y.reference,
    };
  }
  return a;
}

function assertsExistence(key: FactKey, value: unknown): boolean {
  if (key === "transactions") return (value as Transaction[]).length > 0;
  if (key === "total_loss") return (value as Money).amount > 0;
  if (key === "reported_to_police") return (value as ReportedEvent).value === "yes";
  if (key === "bank_reply") return (value as BankReply).status === "final_reply";
  return false;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The hash covers the competing values only, not where they came from, so a resolution survives a re-run that
// finds the same values (design 2.3).
export async function valuesHash(values: readonly FindingValue[]): Promise<string> {
  return sha256Hex(values.map((v) => stableStringify(v.value)).sort().join("\n"));
}

// A source that names several amounts lost (S$4,250 from savings, S$780 on the card) is stating one total in parts.
// Kept apart, the parts were offered beside the total and ticking all three counted the loss twice (walkthrough,
// 9 Nov), so each source's amounts become one total with its portions before comparing.
function oneLossPerSource(candidates: readonly FactCandidate[]): FactCandidate[] {
  const bySource = new Map<string, FactCandidate[]>();
  const single: FactCandidate[] = [];
  for (const c of candidates) {
    const sourceKey = c.sourceRef.sourceKey;
    if (typeof sourceKey !== "string") single.push(c);
    else bySource.set(sourceKey, [...(bySource.get(sourceKey) ?? []), c]);
  }
  const combined = [...bySource.values()].map((group) => {
    if (group.length === 1 || group.some((c) => (c.value as Money).currency !== (group[0].value as Money).currency)) return group;
    const value = combineChoices("total_loss", group.map((c) => c.value));
    const quotes = group.flatMap((c) => (Array.isArray(c.sourceRef.quotes) ? c.sourceRef.quotes : []));
    return [{ ...group[0], value, sourceRef: { ...group[0].sourceRef, quotes } } as FactCandidate];
  });
  return [...single, ...combined.flat()];
}

function reconcileKey(key: FactKey, input: readonly FactCandidate[]): { findingType: FindingType; values: FindingValue[] } {
  const candidates = key === "total_loss" ? oneLossPerSource(input) : input;
  const definite = candidates.filter((c) => !isUnsure(key, c.value));
  const usable = definite.length ? definite : candidates;
  if (!usable.length) return { findingType: "missing", values: [] };

  const groups: FindingValue[] = [];
  for (const candidate of usable) {
    const source = { sourceType: candidate.sourceType, sourceRef: candidate.sourceRef };
    const group = groups.find((g) => equivalent(key, g.value, candidate.value));
    if (group) {
      group.value = merge(key, group.value, candidate.value);
      group.sources.push(source);
    } else {
      groups.push({ value: candidate.value, sources: [source] });
    }
  }

  if (groups.length > 1) return { findingType: "conflict", values: groups };

  const only = groups[0];
  if (
    DOCUMENT_EXPECTED.has(key) &&
    assertsExistence(key, only.value) &&
    !only.sources.some((s) => s.sourceType === "document")
  ) {
    return { findingType: "unsupported", values: groups };
  }
  return { findingType: "agreed", values: groups };
}

// Each source's list of payments is compared as a whole (one-to-one matching), so a statement that lists a payment
// the user did not mention, or the reverse, becomes a conflict for the user to settle. The same payment named by
// two of the user's own sources (story and an answer) is one value, not two.
function reconcileTransactions(candidates: readonly FactCandidate[]): { findingType: FindingType; values: FindingValue[] } {
  return reconcileKey("transactions", candidates);
}

// Dependency rules (Elena, 2026-11-05): a reply from the bank means the bank was told, and a final reply needs a
// report or written complaint. Each reply candidate therefore implies "reported to the bank: yes" from the same
// source, so a "No" elsewhere becomes an ordinary conflict for the user to settle.
const REPLY_STATUSES: ReadonlySet<string> = new Set(["acknowledged", "interim", "final_reply"]);

// A reference given with "told the bank" or "police report" becomes a candidate for its own fact, from the same
// source (finding A2).
const REFERENCE_FACTS: ReadonlyArray<[FactKey, FactKey]> = [
  ["reported_to_bank", "bank_case_reference"],
  ["reported_to_police", "police_report_number"],
];

export function withImpliedCandidates(candidates: readonly FactCandidate[]): FactCandidate[] {
  const implied: FactCandidate[] = candidates
    .filter((c) => c.factKey === "bank_reply" && REPLY_STATUSES.has((c.value as BankReply).status))
    .map((c) => ({
      factKey: "reported_to_bank",
      value: { value: "yes", date: null, reference: null, channel: null },
      sourceType: c.sourceType,
      sourceRef: { ...c.sourceRef, impliedBy: "bank_reply" },
    }));
  const references: FactCandidate[] = [];
  for (const [eventKey, referenceKey] of REFERENCE_FACTS) {
    for (const c of candidates.filter((c) => c.factKey === eventKey)) {
      const event = c.value as ReportedEvent;
      // A case or report number has digits; "morning" typed in the reference box is not one (walkthrough, 9 Nov).
      if (event.value === "yes" && event.reference?.trim() && /\d/.test(event.reference)) {
        references.push({ factKey: referenceKey, value: event.reference.trim(), sourceType: c.sourceType, sourceRef: { ...c.sourceRef, impliedBy: eventKey } } as FactCandidate);
      }
    }
  }
  return [...candidates, ...implied, ...references];
}

// A document value the extraction marked as context (wrong kind of document for the fact, or low confidence) is
// kept for the record but never compared (finding A7).
export function isContext(candidate: FactCandidate): boolean {
  return candidate.sourceRef.context === true;
}

// The value of a multi-select answer: several chosen value boxes combined into one (finding A1).
export function combineChoices(key: FactKey, values: readonly unknown[]): unknown {
  if (!values.length) return null;
  if (key === "transactions") return values.flatMap((v) => v as Transaction[]);
  if (key === "total_loss") {
    // A total ticked together with its own parts counts once: the parts are kept as its portions.
    if (values.length >= 3) {
      const losses = values as TotalLoss[];
      const whole = losses.findIndex((v, i) => {
        const others = losses.filter((_, j) => j !== i);
        return !v.portions?.length && others.every((o) => o.currency === v.currency) &&
          Math.abs(others.reduce((s, o) => s + o.amount, 0) - v.amount) <= MONEY_TOLERANCE;
      });
      if (whole >= 0) return combineChoices(key, values.filter((_, i) => i !== whole));
    }
    const portions = values.flatMap((v) => {
      const loss = v as TotalLoss;
      return loss.portions?.length ? loss.portions : [{ account: loss.account ?? null, amount: { amount: loss.amount, currency: loss.currency, amountSgd: loss.amountSgd } }];
    });
    const currency = portions[0].amount.currency;
    const amount = Math.round(portions.reduce((s, p) => s + p.amount.amount, 0) * 100) / 100;
    return { amount, currency, amountSgd: currency === "SGD" ? amount : null, account: null, portions };
  }
  return values.slice(1).reduce((acc, v) => merge(key, acc, v), values[0]);
}

export async function reconcile(input: readonly FactCandidate[]): Promise<ReconciledFinding[]> {
  const candidates = withImpliedCandidates(input.filter((c) => !isContext(c)));
  const findings: ReconciledFinding[] = [];
  for (const key of RECONCILED_FACT_KEYS) {
    const forKey = candidates.filter((c) => c.factKey === key);
    const { findingType, values } = key === "transactions" ? reconcileTransactions(forKey) : reconcileKey(key, forKey);
    findings.push({ factKey: key, findingType, values, valuesHash: await valuesHash(values) });
  }
  // Answer-only facts are not compared at launch (design 2.2a): the latest answer wins, otherwise the first source.
  for (const key of ANSWER_ONLY_FACT_KEYS) {
    const forKey = candidates.filter((c) => c.factKey === key);
    const chosen = forKey.find((c) => c.sourceType === "answer") ?? forKey[0];
    const values: FindingValue[] = chosen ? [{ value: chosen.value, sources: [{ sourceType: chosen.sourceType, sourceRef: chosen.sourceRef }] }] : [];
    findings.push({ factKey: key, findingType: chosen ? "agreed" : "missing", values, valuesHash: await valuesHash(values) });
  }
  return findings;
}

export interface StoredFinding {
  factKey: FactKey;
  valuesHash: string;
  status: "open" | "resolved" | "not_sure" | "acknowledged";
  resolution: unknown;
}

// A resolution carries over to a new run only when the values it chose between are unchanged; otherwise the
// finding reopens (design 2.3). Agreed findings need no action and are never "open"; a correction the person made
// to one (walkthrough 7 Nov) carries over on the same terms.
export function carryOverStatus(next: ReconciledFinding, previous: readonly StoredFinding[]) {
  const prior = previous.find((p) => p.factKey === next.factKey);
  const sameValues = Boolean(prior && prior.status !== "open" && prior.valuesHash === next.valuesHash);
  if (next.findingType === "agreed") {
    const corrected = sameValues && (prior!.resolution as { kind?: string } | null)?.kind !== "agreed";
    if (corrected) return { status: prior!.status, resolution: prior!.resolution, reopened: false };
    return { status: "resolved" as const, resolution: { kind: "agreed" }, reopened: false };
  }
  if (prior && sameValues) {
    return { status: prior.status, resolution: prior.resolution, reopened: false };
  }
  return { status: "open" as const, resolution: null, reopened: Boolean(prior && prior.status !== "open") };
}
