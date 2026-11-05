// Deterministic reconciliation (design section 2): candidate values from the story, answers and documents are
// compared per fact key and turned into findings. The model never takes part here; it only extracted the candidates.

import {
  type BankReply,
  type FactKey,
  type FactValues,
  type Institution,
  type Money,
  RECONCILED_FACT_KEYS,
  type ReportedEvent,
  type SourceType,
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

function sameText(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameEvent(a: ReportedEvent, b: ReportedEvent): boolean {
  return a.value === b.value && sameDate(a.date, b.date) && sameText(a.reference, b.reference);
}

function sameBankReply(a: BankReply, b: BankReply): boolean {
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
    case "amount_recovered_or_offered":
      return sameMoney(a as Money, b as Money);
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
  if (key === "reported_to_bank" || key === "reported_to_police" || key === "written_complaint_sent" || key === "fidrec_filed") {
    const x = a as ReportedEvent;
    const y = b as ReportedEvent;
    return { value: x.value, date: x.date ?? y.date, reference: x.reference ?? y.reference, channel: x.channel ?? y.channel };
  }
  if (key === "bank_reply") {
    const x = a as BankReply;
    const y = b as BankReply;
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

function reconcileKey(key: FactKey, candidates: readonly FactCandidate[]): { findingType: FindingType; values: FindingValue[] } {
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

// Transactions get a checklist finding whenever the user's account and the documents do not match one to one.
// A statement often lists payments the user does not dispute, so only the user can say which ones count.
function reconcileTransactions(candidates: readonly FactCandidate[]): { findingType: FindingType; values: FindingValue[] } {
  if (!candidates.length) return { findingType: "missing", values: [] };
  const fromUser = candidates.filter((c) => c.sourceType !== "document");
  const fromDocuments = candidates.filter((c) => c.sourceType === "document");
  const userList = fromUser.flatMap((c) => c.value as Transaction[]);
  const documentList = fromDocuments.flatMap((c) => c.value as Transaction[]);

  const result = reconcileKey("transactions", candidates);
  if (result.findingType !== "agreed" && result.findingType !== "unsupported") return result;
  if (!fromUser.length || !fromDocuments.length) return result;
  const match = matchTransactions(userList, documentList);
  return match.unmatchedA.length || match.unmatchedB.length ? { ...result, findingType: "conflict" } : result;
}

export async function reconcile(candidates: readonly FactCandidate[]): Promise<ReconciledFinding[]> {
  const findings: ReconciledFinding[] = [];
  for (const key of RECONCILED_FACT_KEYS) {
    const forKey = candidates.filter((c) => c.factKey === key);
    const { findingType, values } = key === "transactions" ? reconcileTransactions(forKey) : reconcileKey(key, forKey);
    findings.push({ factKey: key, findingType, values, valuesHash: await valuesHash(values) });
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
// finding reopens (design 2.3). Agreed findings need no action and are never "open".
export function carryOverStatus(next: ReconciledFinding, previous: readonly StoredFinding[]) {
  if (next.findingType === "agreed") return { status: "resolved" as const, resolution: { kind: "agreed" }, reopened: false };
  const prior = previous.find((p) => p.factKey === next.factKey);
  if (prior && prior.status !== "open" && prior.valuesHash === next.valuesHash) {
    return { status: prior.status, resolution: prior.resolution, reopened: false };
  }
  return { status: "open" as const, resolution: null, reopened: Boolean(prior && prior.status !== "open") };
}
