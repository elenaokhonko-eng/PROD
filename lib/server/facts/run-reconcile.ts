import type { SupabaseClient } from "@supabase/supabase-js"

import {
  answerCandidates,
  type AnswerRow,
  buildFactExtractionPrompt,
  carryOverStatus,
  type CurrentFinding,
  FACT_EXTRACTION_PROMPT_VERSION,
  type FactCandidate,
  type FactKey,
  type FindingStatus,
  parseFactExtraction,
  reconcile,
  type Resolution,
  type SourceType,
  sha256Hex,
} from "@/lib/facts"
import { generateJson, getOpenAiModel } from "@/lib/server/ai/generate-json"
import { isEvidenceItem } from "@/lib/billing/evidence-minimums"
import { ModelBudgetExceeded, OUTPUT_CAPS } from "@/lib/server/model-usage"
import { logger } from "@/lib/logger"

const log = logger.withContext({ module: "facts-reconcile" })

import { mergeDocumentParts, splitIntoParts } from "./document-parts"

const STORY_LIMIT = 20_000
// "All transactions must be pulled" (Elena, 27 Nov 2026): the whole of a long statement is read, and the answer has
// room for every payment (about 100 tokens each). An answer that is still cut off fails the check rather than losing
// payments quietly.
// About two pages: even a page full of payments fits the answer.
const DOCUMENT_PART_CHARS = 5_000
const DOCUMENT_OUTPUT_CAP = 8_192
const DOCUMENT_TIMEOUT_MS = 90_000
const MODEL_CONCURRENCY = 4
// The confirm screen waits on this run, so each model call is bounded: 30 s and one retry, about two minutes at worst.
const MODEL_TIMEOUT_MS = 30_000
const MODEL_RETRIES = 1
const RUNNING_STALE_MS = 5 * 60_000
const SCANNED_MARKER = "_source_scanned"

export type ExtractJson = (prompt: string, schemaName: string) => Promise<unknown>

export class FactsUnavailableError extends Error {}
/** Today's model budget is used up (cost-controls spec §5 B4): the story is kept and checked once it reopens. */
export class FactsPausedError extends FactsUnavailableError {}
/** A reading did not finish in time (requirements 8.3). */
export class FactsTimedOutError extends FactsUnavailableError {}
export class FactsInProgressError extends Error {}

interface Source {
  sourceKey: string
  sourceType: SourceType
  text: string
  sourceRef: Record<string, unknown>
}

interface StoredFindingRow {
  id: string
  fact_key: string
  finding_type: CurrentFinding["findingType"]
  values: CurrentFinding["values"]
  values_hash: string
  status: FindingStatus
  resolution: Resolution | null
}

export interface ReconcileResult {
  runId: string
  findings: CurrentFinding[]
  documentsProcessing: number
}

function toCurrent(row: StoredFindingRow): CurrentFinding {
  return {
    id: row.id,
    factKey: row.fact_key as FactKey,
    findingType: row.finding_type,
    values: row.values,
    status: row.status,
    resolution: row.resolution,
  }
}

async function loadSources(service: SupabaseClient, caseId: string) {
  const [story, responses, documents, extractions] = await Promise.all([
    service.from("case_story_revisions").select("id, revision, story_text").eq("case_id", caseId)
      .order("revision", { ascending: false }).limit(1).maybeSingle(),
    service.from("case_response_revisions").select("id, question_key, response_value, created_at").eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    service.from("case_documents").select("id, original_filename, processing_status, content_latest_id, complainant_item").eq("case_id", caseId),
    service.from("case_document_extractions").select("id, document_id, extracted_text, created_at").eq("case_id", caseId)
      .order("created_at", { ascending: false }),
  ])
  if (story.error || responses.error || documents.error || extractions.error) {
    throw new FactsUnavailableError("Failed to load case sources")
  }

  // The document's own parsed text. Extraction rows are a fallback only: some hold a pipeline-written summary and
  // structured extractions have no text, so they lose the document's actual words.
  const contentIds = (documents.data ?? []).map((d) => d.content_latest_id as string | null).filter((id): id is string => Boolean(id))
  const contents = contentIds.length
    ? await service.from("case_documents_content").select("id, text_content").in("id", contentIds)
    : { data: [] as Array<{ id: string; text_content: string | null }>, error: null }
  if (contents.error) throw new FactsUnavailableError("Failed to load document text")
  const contentText = new Map((contents.data ?? []).map((c) => [c.id as string, (c.text_content as string | null) ?? ""]))

  const answers: AnswerRow[] = (responses.data ?? []).map((r) => ({
    questionKey: r.question_key as string,
    value: (r.response_value as string | null) ?? null,
    revisionId: r.id as string,
  }))
  const latestAnswers = new Map<string, AnswerRow>()
  for (const a of answers) latestAnswers.set(a.questionKey, a)

  const readyDocuments = (documents.data ?? []).filter((d) => d.processing_status === "ready")
  const documentsProcessing = (documents.data ?? []).filter(
    (d) => d.processing_status !== "ready" && d.processing_status !== "failed",
  ).length
  const latestExtraction = new Map<string, { id: string; text: string }>()
  for (const e of extractions.data ?? []) {
    if (!latestExtraction.has(e.document_id as string) && typeof e.extracted_text === "string" && e.extracted_text.trim()) {
      latestExtraction.set(e.document_id as string, { id: e.id as string, text: e.extracted_text })
    }
  }

  const sources: Source[] = []
  if (story.data?.story_text) {
    sources.push({
      sourceKey: `story:${story.data.id}`,
      sourceType: "story",
      text: String(story.data.story_text).slice(0, STORY_LIMIT),
      sourceRef: { sourceKey: `story:${story.data.id}`, storyRevision: story.data.revision },
    })
  }
  for (const doc of readyDocuments) {
    const contentId = doc.content_latest_id as string | null
    const parsed = contentId ? contentText.get(contentId)?.trim() : null
    const extraction = latestExtraction.get(doc.id as string)
    const text = parsed || extraction?.text
    if (!text) continue
    // PB-22 (Part B walk-through, 25 Nov): a document the person marked ("This is my police report") is read as that
    // kind of document. The mark is part of the source key, so marking it reads it again and the facts are checked.
    const complainantItem = isEvidenceItem(doc.complainant_item) ? doc.complainant_item : null
    const sourceKey = `${parsed ? `document:content:${contentId}` : `document:${extraction!.id}`}${complainantItem ? `:marked:${complainantItem}` : ""}`
    sources.push({
      sourceKey,
      sourceType: "document",
      text,
      sourceRef: {
        sourceKey,
        documentId: doc.id,
        documentName: doc.original_filename,
        ...(complainantItem ? { complainantItem } : {}),
      },
    })
  }

  const { candidates: answerFacts, freeText } = answerCandidates([...latestAnswers.values()])
  for (const row of freeText) {
    sources.push({
      sourceKey: `answer:${row.revisionId}`,
      sourceType: "answer",
      text: String(row.value),
      sourceRef: { sourceKey: `answer:${row.revisionId}`, questionKeys: [row.questionKey], revisionIds: [row.revisionId] },
    })
  }

  const inputHash = await sha256Hex(
    [
      FACT_EXTRACTION_PROMPT_VERSION,
      ...sources.map((s) => s.sourceKey).sort(),
      ...[...latestAnswers.values()].map((a) => a.revisionId).sort(),
    ].join("\n"),
  )

  return {
    sources,
    answerFacts,
    inputHash,
    storyRevision: (story.data?.revision as number | undefined) ?? null,
    documentsProcessing,
  }
}

async function loadCurrentFindings(service: SupabaseClient, caseId: string, runId: string) {
  const { data, error } = await service
    .from("case_fact_findings")
    .select("id, fact_key, finding_type, values, values_hash, status, resolution")
    .eq("case_id", caseId)
    .eq("run_id", runId)
    .is("invalidated_at", null)
  if (error) throw new FactsUnavailableError("Failed to load findings")
  return (data ?? []) as StoredFindingRow[]
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  }
  return results
}

// Another request is already checking this case (for example the user left the page and came back). Callers answer
// "still checking" instead of starting a second run; a run older than RUNNING_STALE_MS is treated as abandoned.
async function assertNoRunningRun(service: SupabaseClient, caseId: string) {
  const { data, error } = await service
    .from("case_fact_reconcile_runs")
    .select("id")
    .eq("case_id", caseId)
    .eq("status", "running")
    .gte("created_at", new Date(Date.now() - RUNNING_STALE_MS).toISOString())
    .limit(1)
  if (error) throw new FactsUnavailableError("Failed to load reconcile runs")
  if (data?.length) throw new FactsInProgressError("Facts are still being checked")
}

/** The run that goes ahead when several start together: the earliest, then the lowest id. */
export function firstRunningRun(rows: Array<{ id: string; created_at: string }>): string | null {
  const sorted = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
  return sorted[0]?.id ?? null
}

// Two requests can pass assertNoRunningRun together: removing a document refetched the facts twice, and the later run
// found the earlier one's findings already retired, so it lost every resolution and the user had to confirm conflicts
// again (G3b re-check, 11 Nov). Only the first run goes on; the others stand down and the caller answers "still checking".
async function standDownUnlessFirst(service: SupabaseClient, caseId: string, runId: string) {
  const { data, error } = await service
    .from("case_fact_reconcile_runs")
    .select("id, created_at")
    .eq("case_id", caseId)
    .eq("status", "running")
    .gte("created_at", new Date(Date.now() - RUNNING_STALE_MS).toISOString())
  if (error) throw new FactsUnavailableError("Failed to load reconcile runs")
  const first = firstRunningRun((data ?? []) as Array<{ id: string; created_at: string }>)
  if (first && first !== runId) {
    await service
      .from("case_fact_reconcile_runs")
      .update({ status: "failed", error_code: "superseded", completed_at: new Date().toISOString() })
      .eq("id", runId)
    throw new FactsInProgressError("Facts are still being checked")
  }
}

// Reconciles the case if its story, answers or documents changed since the last completed run, then returns the
// current findings. Unchanged sources reuse their earlier candidates, so the model sees each source once.
export async function ensureReconciled(
  service: SupabaseClient,
  caseId: string,
  extractJson: ExtractJson = (prompt, schemaName) =>
    generateJson({
      prompt,
      schemaName,
      timeoutMs: schemaName === "facts_document" ? DOCUMENT_TIMEOUT_MS : MODEL_TIMEOUT_MS,
      maxRetries: MODEL_RETRIES,
      usage: { purpose: "fact_extraction", caseId, maxOutputTokens: schemaName === "facts_document" ? DOCUMENT_OUTPUT_CAP : OUTPUT_CAPS.fact_extraction },
    }),
): Promise<ReconcileResult> {
  await assertNoRunningRun(service, caseId)
  const { sources, answerFacts, inputHash, storyRevision, documentsProcessing } = await loadSources(service, caseId)

  const { data: lastRun, error: lastRunError } = await service
    .from("case_fact_reconcile_runs")
    .select("id, input_hash, prompt_version")
    .eq("case_id", caseId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastRunError) throw new FactsUnavailableError("Failed to load reconcile runs")

  // A run from an earlier extraction prompt is neither reused nor its candidates: the prompt decides what a document
  // may contradict (finding A7), so old candidates would skip the relevance filter.
  const sameExtraction = lastRun?.prompt_version === FACT_EXTRACTION_PROMPT_VERSION
  if (lastRun && sameExtraction && lastRun.input_hash === inputHash) {
    const rows = await loadCurrentFindings(service, caseId, lastRun.id as string)
    return { runId: lastRun.id as string, findings: rows.map(toCurrent), documentsProcessing }
  }

  const model = getOpenAiModel()
  const { data: run, error: runError } = await service
    .from("case_fact_reconcile_runs")
    .insert({ case_id: caseId, input_hash: inputHash, story_revision: storyRevision, model, prompt_version: FACT_EXTRACTION_PROMPT_VERSION })
    .select("id")
    .single()
  if (runError || !run) throw new FactsUnavailableError("Failed to start reconcile run")
  const runId = run.id as string
  await standDownUnlessFirst(service, caseId, runId)

  try {
    const reusable = new Map<string, FactCandidate[]>()
    if (lastRun && sameExtraction) {
      const { data: previous, error } = await service
        .from("case_fact_candidates")
        .select("fact_key, value, source_type, source_ref")
        .eq("run_id", lastRun.id)
      if (error) throw new FactsUnavailableError("Failed to load earlier candidates")
      for (const row of previous ?? []) {
        const key = (row.source_ref as { sourceKey?: string })?.sourceKey
        if (!key) continue
        const list = reusable.get(key) ?? []
        list.push({ factKey: row.fact_key, value: row.value, sourceType: row.source_type, sourceRef: row.source_ref } as FactCandidate)
        reusable.set(key, list)
      }
    }

    const extracted = await inBatches(sources, MODEL_CONCURRENCY, async (source) => {
      const cached = reusable.get(source.sourceKey)
      if (cached) return cached
      const parts = source.sourceType === "document" ? splitIntoParts(source.text, DOCUMENT_PART_CHARS) : [source.text]
      const answers = await inBatches(parts, MODEL_CONCURRENCY, async (part) =>
        (await extractJson(buildFactExtractionPrompt(source.sourceType, part), `facts_${source.sourceType}`)) as Record<string, unknown>)
      // The first part says what kind of document it is; later pages are read as that kind.
      const kind = answers[0]?.document_type
      const parsed = mergeDocumentParts(answers.map((raw, i) =>
        parseFactExtraction({ ...raw, document_type: kind }, parts[i], { sourceType: source.sourceType, sourceRef: source.sourceRef })))
      // A source with no facts records a marker so it is not sent to the model again.
      return parsed.length ? parsed : [{ factKey: SCANNED_MARKER, value: {}, sourceType: source.sourceType, sourceRef: source.sourceRef } as unknown as FactCandidate]
    })
    const stored = [...answerFacts, ...extracted.flat()]
    const candidates = stored.filter((c) => (c.factKey as string) !== SCANNED_MARKER)

    if (stored.length) {
      const { error } = await service.from("case_fact_candidates").insert(
        stored.map((c) => ({
          case_id: caseId,
          run_id: runId,
          fact_key: c.factKey,
          value: c.value,
          source_type: c.sourceType,
          source_ref: c.sourceRef,
          model: (c.sourceRef as { sourceKey?: string }).sourceKey ? model : null,
          prompt_version: FACT_EXTRACTION_PROMPT_VERSION,
        })),
      )
      if (error) throw new FactsUnavailableError("Failed to store candidates")
    }

    const previousRows = lastRun ? await loadCurrentFindings(service, caseId, lastRun.id as string) : []
    const previous = previousRows.map((r) => ({
      factKey: r.fact_key as FactKey,
      valuesHash: r.values_hash,
      status: r.status,
      resolution: r.resolution,
    }))
    const reconciled = await reconcile(candidates)
    const now = new Date().toISOString()
    const rows = reconciled.map((finding) => {
      const carried = carryOverStatus(finding, previous)
      return {
        row: {
          case_id: caseId,
          run_id: runId,
          fact_key: finding.factKey,
          finding_type: finding.findingType,
          values: finding.values,
          values_hash: finding.valuesHash,
          status: carried.status,
          resolution: carried.resolution,
          resolved_at: carried.status === "open" ? null : now,
        },
        reopened: carried.reopened,
      }
    })

    if (previousRows.length) {
      const { error } = await service
        .from("case_fact_findings")
        .update({ invalidated_at: now })
        .eq("case_id", caseId)
        .is("invalidated_at", null)
      if (error) throw new FactsUnavailableError("Failed to retire earlier findings")
    }
    const { data: inserted, error: insertError } = await service
      .from("case_fact_findings")
      .insert(rows.map((r) => r.row))
      .select("id, fact_key, finding_type, values, values_hash, status, resolution")
    if (insertError || !inserted) throw new FactsUnavailableError("Failed to store findings")

    const reopened: string[] = rows.filter((r) => r.reopened).map((r) => r.row.fact_key)
    if (reopened.length) {
      await service.from("case_fact_confirmation_events").insert(
        (inserted as StoredFindingRow[])
          .filter((f) => reopened.includes(f.fact_key))
          .map((f) => ({ case_id: caseId, finding_id: f.id, event: "reopened", payload: { fact_key: f.fact_key } })),
      )
    }

    await service.from("case_fact_reconcile_runs").update({ status: "completed", completed_at: now }).eq("id", runId)
    return { runId, findings: (inserted as StoredFindingRow[]).map(toCurrent), documentsProcessing }
  } catch (error) {
    log.error("Fact reconciliation failed", { caseId, runId, error: error instanceof Error ? error.message : String(error) })
    await service
      .from("case_fact_reconcile_runs")
      .update({ status: "failed", error_code: "reconcile_failed", completed_at: new Date().toISOString() })
      .eq("id", runId)
    if (error instanceof ModelBudgetExceeded) throw new FactsPausedError("Daily model budget reached")
    if (error instanceof Error && /timed out|timeout/i.test(error.message)) throw new FactsTimedOutError("Fact reading timed out")
    throw error instanceof FactsUnavailableError ? error : new FactsUnavailableError("Fact reconciliation failed")
  }
}
