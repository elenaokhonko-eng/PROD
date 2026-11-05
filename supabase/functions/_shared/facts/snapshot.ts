// From stored findings to the confirmed facts a stage is generated from (design 4.2). Nothing is frozen while a
// finding the stage depends on is open; the server enforces this before any report is generated.

import { type FactKey, type Money, requiredFactsFor, type ScamType, type Stage, type Transaction } from "./keys.ts";
import type { FindingType, FindingValue } from "./reconcile.ts";

export type FindingStatus = "open" | "resolved" | "not_sure" | "acknowledged";

export type Resolution =
  | { kind: "agreed" }
  | { kind: "choice"; index: number; note?: string }
  | { kind: "value"; value: unknown; note?: string }
  | { kind: "not_sure"; note?: string }
  | { kind: "not_known"; note?: string }
  | { kind: "acknowledged"; note?: string };

export interface CurrentFinding {
  id: string;
  factKey: FactKey;
  findingType: FindingType;
  values: FindingValue[];
  status: FindingStatus;
  resolution: Resolution | null;
}

// How a fact may be written in a report (design 4.3).
export type FactLabel = "confirmed" | "not_sure" | "claimant_only" | "not_known";

export interface SnapshotFact {
  value: unknown;
  label: FactLabel;
}

export type SnapshotBlock =
  | { reason: "open_finding"; factKey: FactKey; findingId: string }
  | { reason: "total_differs_from_transactions"; factKey: "total_loss"; total: number; sum: number }
  | { reason: "inconsistent_facts"; factKey: FactKey; relatedFactKey: FactKey };

export interface SnapshotResult {
  facts: Partial<Record<FactKey, SnapshotFact>>;
  blocks: SnapshotBlock[];
}

function effective(finding: CurrentFinding): SnapshotFact | null {
  const first = finding.values[0]?.value;
  const resolution = finding.resolution;
  if (finding.findingType === "agreed") return { value: first, label: "confirmed" };
  if (finding.status === "open" || !resolution) return null;
  switch (resolution.kind) {
    case "choice":
      return { value: finding.values[resolution.index]?.value ?? null, label: "confirmed" };
    case "value":
      return { value: resolution.value, label: "confirmed" };
    case "not_sure":
      return { value: null, label: "not_sure" };
    case "not_known":
      return { value: null, label: "not_known" };
    case "acknowledged":
      return { value: first, label: "claimant_only" };
    default:
      return null;
  }
}

// Conflicts and unsupported claims block every stage; a missing fact blocks only the stages that require it.
export function relevantFindings(findings: readonly CurrentFinding[], stage: Stage): CurrentFinding[] {
  const scam = findings.find((f) => f.factKey === "scam_type");
  const scamValue = scam ? (effective(scam)?.value as ScamType[] | null) ?? null : null;
  const required = new Set(requiredFactsFor(stage, scamValue));
  return findings.filter((f) => f.findingType !== "missing" || required.has(f.factKey));
}

export function buildSnapshot(findings: readonly CurrentFinding[], stage: Stage): SnapshotResult {
  const facts: SnapshotResult["facts"] = {};
  const blocks: SnapshotBlock[] = [];

  for (const finding of relevantFindings(findings, stage)) {
    const fact = effective(finding);
    if (fact) facts[finding.factKey] = fact;
    else if (finding.findingType !== "missing" || finding.status === "open") {
      blocks.push({ reason: "open_finding", factKey: finding.factKey, findingId: finding.id });
    }
  }

  const total = facts.total_loss?.label === "confirmed" ? (facts.total_loss.value as Money | null) : null;
  const transactions = facts.transactions?.label === "confirmed" ? (facts.transactions.value as Transaction[] | null) : null;
  if (total && transactions?.length) {
    const same = transactions.filter((t) => t.amount.currency === total.currency);
    if (same.length === transactions.length) {
      const sum = Math.round(same.reduce((s, t) => s + t.amount.amount, 0) * 100) / 100;
      if (Math.abs(sum - total.amount) > 1) {
        blocks.push({ reason: "total_differs_from_transactions", factKey: "total_loss", total: total.amount, sum });
      }
    }
  }

  // Dependency rule: a reply from the bank (kept as fact or as the user's own account) needs "reported to the bank:
  // yes". Resolutions can still combine "No" with a reply, so the snapshot refuses that combination.
  const reply = facts.bank_reply && facts.bank_reply.label !== "not_sure" && facts.bank_reply.label !== "not_known"
    ? (facts.bank_reply.value as { status?: string } | null)
    : null;
  const reported = facts.reported_to_bank?.value as { value?: string } | null | undefined;
  if (reply?.status && reply.status !== "none" && reported?.value !== "yes") {
    blocks.push({ reason: "inconsistent_facts", factKey: "reported_to_bank", relatedFactKey: "bank_reply" });
  }

  return { facts, blocks };
}

export function openCount(findings: readonly CurrentFinding[], stage: Stage): number {
  return relevantFindings(findings, stage).filter((f) => f.findingType !== "agreed" && f.status === "open").length;
}
