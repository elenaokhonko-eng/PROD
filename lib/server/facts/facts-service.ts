import type { SupabaseClient } from "@supabase/supabase-js"

import {
  answerDevices,
  buildSnapshot,
  type CurrentFinding,
  type FactKey,
  factLabel,
  formatFactValue,
  linkRecordsToTransactions,
  MULTI_SELECT_FACT_KEYS,
  openCount,
  PAID_STAGE_ONLY_FACT_KEYS,
  type RecordedDevice,
  relevantFindings,
  type Resolution,
  sha256Hex,
  type SnapshotBlock,
  type SnapshotResult,
  type Stage,
  type Transaction,
  validateFactValue,
} from "@/lib/facts"
import type { AccessEvent, CardAuthEvent, DeviceRecognition } from "../../../supabase/functions/_shared/facts/update/contract"
import { ensureReconciled, type ExtractJson, FactsUnavailableError } from "./run-reconcile"

export const STAGES: readonly Stage[] = ["free", "bank", "fidrec"]

export function parseStage(value: unknown): Stage | null {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value) ? (value as Stage) : null
}

function sourceLabel(source: { sourceType: string; sourceRef: Record<string, unknown> }): string {
  if (source.sourceType === "story") return "Your story"
  if (source.sourceType === "answer") return "Your answer"
  const name = source.sourceRef.documentName
  return typeof name === "string" && name ? name : "An uploaded document"
}

// The FIDReC update's facts belong to the paid stages (brief 3b): the free stage neither shows nor freezes them, so
// device identifiers and IP addresses never reach the free evaluation.
export function findingsForStage<T extends { factKey: FactKey }>(findings: readonly T[], stage: Stage): T[] {
  return stage === "free" ? findings.filter((f) => !PAID_STAGE_ONLY_FACT_KEYS.has(f.factKey)) : [...findings]
}

// The snapshot a stage freezes. Record lines are linked to the confirmed payments where exactly one fits, so the
// snapshot (and its hash) is the same every time it is built from the same findings.
export function stageSnapshot(findings: readonly CurrentFinding[], stage: Stage): SnapshotResult {
  const snapshot = buildSnapshot(findingsForStage(findings, stage), stage)
  const facts = snapshot.facts
  const transactions = facts.transactions?.label === "confirmed" ? (facts.transactions.value as Transaction[] | null) : null
  const access = facts.access_events?.label === "confirmed" ? (facts.access_events.value as AccessEvent[] | null) : null
  const card = facts.card_auth_events?.label === "confirmed" ? (facts.card_auth_events.value as CardAuthEvent[] | null) : null
  if (transactions?.length && (access?.length || card?.length)) {
    const linked = linkRecordsToTransactions(transactions, access ?? [], card ?? [])
    if (access?.length) facts.access_events = { ...facts.access_events!, value: linked.access }
    if (card?.length) facts.card_auth_events = { ...facts.card_auth_events!, value: linked.card }
  }
  return snapshot
}

/** "Is this one of your devices?": the devices the records show, and the answers given so far. */
export interface DeviceStep {
  findingId: string
  status: CurrentFinding["status"]
  devices: RecordedDevice[]
  answers: DeviceRecognition[] | null
}

function deviceStep(findings: readonly CurrentFinding[]): DeviceStep | null {
  const finding = findings.find((f) => f.factKey === "device_recognition")
  const devices = finding?.values[0]?.value as RecordedDevice[] | undefined
  if (!finding || !devices?.length) return null
  const answers = finding.resolution?.kind === "value" ? (finding.resolution.value as DeviceRecognition[]) : null
  return { findingId: finding.id, status: finding.status, devices, answers }
}

export interface FactsView {
  stage: Stage
  runId: string
  openCount: number
  documentsProcessing: number
  findings: Array<{
    id: string
    factKey: FactKey
    label: string
    findingType: CurrentFinding["findingType"]
    status: CurrentFinding["status"]
    resolution: Resolution | null
    values: Array<{ display: string; value: unknown; sources: Array<{ sourceType: string; label: string; quotes: string[] }> }>
  }>
  latestSnapshot: { id: string; createdAt: string; unchanged: boolean } | null
  // Answered on its own screen, not as a finding card; still counted in openCount until answered.
  devices: DeviceStep | null
  // Answers that cannot all be true together, with the facts involved so the page can point at them; the facts
  // cannot be confirmed until one is changed (walkthrough 7 Nov).
  consistencyIssues: Array<{ message: string; factKeys: FactKey[] }>
}

function consistencyMessages(blocks: readonly SnapshotBlock[]): FactsView["consistencyIssues"] {
  return blocks.flatMap((block) => {
    if (block.reason === "inconsistent_facts") {
      return [{
        message: "You told us you haven’t contacted your bank, but also that your bank has replied. Please change one of these answers.",
        factKeys: [block.factKey, block.relatedFactKey],
      }]
    }
    if (block.reason === "total_differs_from_transactions") {
      return [{
        message: `The amount you lost (S$${block.total.toLocaleString("en-SG")}) doesn’t match the payments you confirmed (S$${block.sum.toLocaleString("en-SG")} in total). Please check one of them.`,
        factKeys: ["total_loss", "transactions"],
      }]
    }
    return []
  })
}

async function snapshotHash(facts: unknown): Promise<string> {
  const stable = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
        : JSON.stringify(v ?? null)
  return sha256Hex(stable(facts))
}

async function latestSnapshotFor(service: SupabaseClient, caseId: string, stage: Stage) {
  const { data, error } = await service
    .from("case_fact_snapshots")
    .select("id, hash, facts, created_at")
    .eq("case_id", caseId)
    .eq("stage", stage)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new FactsUnavailableError("Failed to load snapshots")
  return data as { id: string; hash: string; facts: unknown; created_at: string } | null
}

export async function loadFactsView(
  service: SupabaseClient,
  caseId: string,
  stage: Stage,
  extractJson?: ExtractJson,
): Promise<FactsView> {
  const { runId, findings: all, documentsProcessing } = await ensureReconciled(service, caseId, extractJson)
  const findings = findingsForStage(all, stage)
  const relevant = relevantFindings(findings, stage)
  const latest = await latestSnapshotFor(service, caseId, stage)
  const snapshot = stageSnapshot(findings, stage)
  const unchanged = Boolean(latest && !snapshot.blocks.length && (await snapshotHash(snapshot.facts)) === latest.hash)

  return {
    stage,
    runId,
    openCount: openCount(findings, stage),
    documentsProcessing,
    findings: relevant.filter((f) => f.factKey !== "device_recognition").map((f) => ({
      id: f.id,
      factKey: f.factKey,
      label: factLabel(f.factKey),
      findingType: f.findingType,
      status: f.status,
      resolution: f.resolution,
      values: f.values.map((v) => ({
        display: formatFactValue(f.factKey, v.value),
        value: v.value,
        sources: v.sources.map((s) => ({
          sourceType: s.sourceType,
          label: sourceLabel(s),
          quotes: Array.isArray(s.sourceRef.quotes) ? (s.sourceRef.quotes as string[]) : [],
        })),
      })),
    })),
    latestSnapshot: latest ? { id: latest.id, createdAt: latest.created_at, unchanged } : null,
    consistencyIssues: consistencyMessages(snapshot.blocks),
    devices: deviceStep(relevant),
  }
}

export type ResolutionInput =
  | { kind: "choice"; index: number; note?: string }
  | { kind: "choices"; indices: number[]; note?: string }
  | { kind: "value"; value: unknown; note?: string }
  | { kind: "not_sure"; note?: string }
  | { kind: "not_known"; note?: string }
  | { kind: "acknowledged"; note?: string }

export class ResolutionRejectedError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
  }
}

// Which resolutions each finding type accepts (design 3.3 / 7).
const ALLOWED: Record<CurrentFinding["findingType"], ReadonlyArray<ResolutionInput["kind"]>> = {
  conflict: ["choice", "choices", "value", "not_sure"],
  unsupported: ["acknowledged", "value", "not_sure"],
  missing: ["value", "not_known"],
  // A fact the sources agree on can still be wrong (both answers that don't fit together may come from the story),
  // so the person can correct it (walkthrough 7 Nov).
  agreed: ["choice", "choices", "value", "not_sure"],
}

export async function resolveFinding(
  service: SupabaseClient,
  caseId: string,
  findingId: string,
  input: ResolutionInput,
  actorProfileId: string,
): Promise<void> {
  const { data: row, error } = await service
    .from("case_fact_findings")
    .select("id, fact_key, finding_type, values, invalidated_at")
    .eq("id", findingId)
    .eq("case_id", caseId)
    .maybeSingle()
  if (error) throw new FactsUnavailableError("Failed to load finding")
  if (!row) throw new ResolutionRejectedError("finding_not_found")
  if (row.invalidated_at) throw new ResolutionRejectedError("finding_outdated")

  const findingType = row.finding_type as CurrentFinding["findingType"]
  if (!ALLOWED[findingType].includes(input.kind)) throw new ResolutionRejectedError("resolution_not_allowed")
  // Device answers: one per device the finding lists ("not sure" is an answer), checked against that list.
  const isDevices = row.fact_key === "device_recognition"
  if (isDevices && input.kind !== "value") throw new ResolutionRejectedError("resolution_not_allowed")

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : undefined
  let resolution: Resolution
  let status: "resolved" | "not_sure" | "acknowledged"
  switch (input.kind) {
    case "choice": {
      const count = Array.isArray(row.values) ? row.values.length : 0
      if (!Number.isInteger(input.index) || input.index < 0 || input.index >= count) throw new ResolutionRejectedError("invalid_choice")
      resolution = { kind: "choice", index: input.index, note }
      status = "resolved"
      break
    }
    case "choices": {
      // Several value boxes, only for facts that can have several values (finding A1).
      if (!MULTI_SELECT_FACT_KEYS.has(row.fact_key as FactKey)) throw new ResolutionRejectedError("single_select_fact")
      const values = Array.isArray(row.values) ? (row.values as Array<{ value: unknown }>) : []
      const indices = Array.isArray(input.indices) ? input.indices : []
      const valid = indices.length > 0 && new Set(indices).size === indices.length &&
        indices.every((i) => Number.isInteger(i) && i >= 0 && i < values.length)
      if (!valid) throw new ResolutionRejectedError("invalid_choice")
      if (row.fact_key === "total_loss") {
        const currencies = new Set(indices.map((i) => (values[i].value as { currency?: string }).currency))
        if (currencies.size > 1) throw new ResolutionRejectedError("mixed_currencies")
      }
      resolution = { kind: "choices", indices: [...indices].sort((a, b) => a - b), note }
      status = "resolved"
      break
    }
    case "value": {
      const recorded = isDevices ? ((row.values as Array<{ value: unknown }>)[0]?.value as RecordedDevice[] | undefined) ?? [] : []
      const value = isDevices ? answerDevices(recorded, input.value) : validateFactValue(row.fact_key as FactKey, input.value)
      if (value === null) throw new ResolutionRejectedError("invalid_value")
      resolution = { kind: "value", value, note }
      status = "resolved"
      break
    }
    case "not_sure":
      resolution = { kind: "not_sure", note }
      status = "not_sure"
      break
    case "not_known":
      resolution = { kind: "not_known", note }
      status = "resolved"
      break
    case "acknowledged":
      resolution = { kind: "acknowledged", note }
      status = "acknowledged"
      break
  }

  const now = new Date().toISOString()
  const { error: updateError } = await service
    .from("case_fact_findings")
    .update({ status, resolution, resolved_by_profile_id: actorProfileId, resolved_at: now })
    .eq("id", findingId)
    .is("invalidated_at", null)
  if (updateError) throw new FactsUnavailableError("Failed to save resolution")

  const { error: eventError } = await service.from("case_fact_confirmation_events").insert({
    case_id: caseId,
    finding_id: findingId,
    event: status,
    payload: { fact_key: row.fact_key, resolution },
    actor_profile_id: actorProfileId,
  })
  if (eventError) throw new FactsUnavailableError("Failed to record resolution")
}

export type SnapshotOutcome =
  | { ok: true; snapshotId: string; unchanged: boolean }
  | { ok: false; reason: "facts_unconfirmed"; blocks: SnapshotBlock[] }
  | { ok: false; reason: "documents_processing"; documentsProcessing: number }

export async function createSnapshot(
  service: SupabaseClient,
  caseId: string,
  stage: Stage,
  actorProfileId: string,
  extractJson?: ExtractJson,
): Promise<SnapshotOutcome> {
  const { runId, findings, documentsProcessing } = await ensureReconciled(service, caseId, extractJson)
  if (documentsProcessing > 0) return { ok: false, reason: "documents_processing", documentsProcessing }
  const snapshot = stageSnapshot(findings, stage)
  if (snapshot.blocks.length) return { ok: false, reason: "facts_unconfirmed", blocks: snapshot.blocks }

  const hash = await snapshotHash(snapshot.facts)
  const latest = await latestSnapshotFor(service, caseId, stage)
  if (latest?.hash === hash) return { ok: true, snapshotId: latest.id, unchanged: true }

  const { data, error } = await service
    .from("case_fact_snapshots")
    .insert({ case_id: caseId, stage, facts: snapshot.facts, hash, run_id: runId, created_by_profile_id: actorProfileId })
    .select("id")
    .single()
  if (error || !data) throw new FactsUnavailableError("Failed to store snapshot")
  await service.from("case_fact_confirmation_events").insert({
    case_id: caseId,
    snapshot_id: data.id,
    event: "snapshot_created",
    payload: { stage, hash },
    actor_profile_id: actorProfileId,
  })
  return { ok: true, snapshotId: data.id as string, unchanged: false }
}

// Generation accepts only a snapshot that is still the latest for its stage and still matches the current facts,
// so a report is never generated from facts that have since reopened (design 4.2).
export async function loadCurrentSnapshot(
  service: SupabaseClient,
  caseId: string,
  stage: Stage,
  snapshotId: string,
  extractJson?: ExtractJson,
): Promise<{ id: string; facts: Record<string, unknown> } | null> {
  const latest = await latestSnapshotFor(service, caseId, stage)
  if (!latest || latest.id !== snapshotId) return null
  const { findings } = await ensureReconciled(service, caseId, extractJson)
  const current = stageSnapshot(findings, stage)
  if (current.blocks.length || (await snapshotHash(current.facts)) !== latest.hash) return null
  return { id: latest.id, facts: latest.facts as Record<string, unknown> }
}
