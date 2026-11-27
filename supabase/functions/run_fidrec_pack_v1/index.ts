import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  authorizeHarborEdgeRequest,
  HarborEdgeAuthError,
  verifyHarborEdgeRequest,
} from "../_shared/edge-auth.ts";
import { safeErrorText } from "../_shared/safe-error.ts";
import { checkPackEvidence, EVIDENCE_DOCUMENT_SELECT, type EvidenceDocument } from "../_shared/evidence-minimums.ts";
import { openAiUsage, OUTPUT_CAPS, recordModelUsage, type UsageClient, usageEnvironment } from "../_shared/model-usage.ts";
import { DEFAULT_OPENAI_MODEL } from "../_shared/openai-params.ts";
import {
  assembleFidrecPack,
  buildEvidenceIndex,
  buildFidrecPackInput,
  type CaseDocument,
  documentExcerpts,
  documentQuotables,
  dutyFailures,
  numberClauses,
  regulatoryQuery,
  caseInstruments,
  routeClauses,
  chatJson,
  describeReferenceSource,
  documentedFacts,
  type EvidenceFinding,
  evidenceIdFailures,
  allDocumentsRead,
  listLengthFailures,
  factDates,
  fidrecPackChecks,
  fidrecPackFallback,
  fidrecPackSystem,
  fidrecPackTexts,
  fidrecRouteFromFacts,
  mapFidrecPackProse,
  parseFidrecPackProse,
  produceChecked,
  referenceKinds,
  qualifyingFinalReplyDocumentId,
  type SnapshotFacts,
} from "../_shared/facts/index.ts";

// The FIDReC pack (S$188), generated once the person has paid and confirmed the FIDReC facts (stage2-plan §3a,
// milestone 3; design C4). Called by the case owner through /api/edge/fidrec-pack, like run_bank_pack_v1. The model
// writes the summary, each side's position and arguments tied to evidence IDs; the rest comes from the confirmed
// "fidrec" snapshot (_shared/facts/fidrec-pack.ts). Exempt from the daily model cap (Elena, 13 Nov); metered.
// CR-2 (27 Nov): nothing is generated while there is no written complaint, or one under four weeks old with no answer
// (rules/fidrec.ts fidrecPackCheck). A final reply older than six months still generates; the pack states both dates.

const PROJECT_URL = Deno.env.get("GUIDEBUOY_URL");
const SERVICE_ROLE_KEY = Deno.env.get("GUIDEBUOY_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction");
const FIDREC_PACK_MODEL = (Deno.env.get("FIDREC_PACK_MODEL") ?? DEFAULT_OPENAI_MODEL).trim().toLowerCase();
// Used straight away when the main model is rate-limited (cost-controls spec §5 B8).
const FIDREC_PACK_SECONDARY_MODEL = (Deno.env.get("FIDREC_PACK_SECONDARY_MODEL") ?? "gpt-6.1-terra").trim().toLowerCase();
const FIDREC_PACK_BUDGET_MS = 140_000;
// The clauses for the duties section come from the regulatory_clauses table (SRF, E-Payments Guidelines, ABS Code,
// MAS notices), by similarity to the case.
const EMBEDDING_MODEL = "text-embedding-3-small";
const CLAUSE_COUNT = 12;
const CLAUSE_SIMILARITY = 0.25;

Deno.serve(async (req) => {
  try {
    const verified = await verifyHarborEdgeRequest(req, "run_fidrec_pack_v1");
    if (!PROJECT_URL) return new Response("Project URL Missing", { status: 500 });
    if (!SERVICE_ROLE_KEY) return new Response("Service Role Key Missing", { status: 500 });
    if (!OPENAI_API_KEY) return new Response("OpenAI API Key Missing", { status: 500 });

    const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    await authorizeHarborEdgeRequest(supabase, verified.context);
    const body = verified.body;
    const case_id = verified.context.caseId ?? undefined;
    if (!case_id) return json({ ok: false, error: "Missing case_id" }, 400);

    // Paid for: checked before any model call (commit_fidrec_pack_v1 checks again).
    const { data: entitlement, error: entitlementErr } = await supabase.rpc("get_effective_entitlement", { p_case_id: case_id });
    if (entitlementErr) return json({ ok: false, error: "entitlement_unavailable", code: entitlementErr.code ?? null }, 500);
    if ((entitlement as { features?: Record<string, unknown> } | null)?.features?.allow_escalation_pack !== true) {
      return json({ ok: false, reason: "not_purchased", error: "The FIDReC pack has not been bought for this case" }, 403);
    }

    // One pack per case: a repeat request returns the stored one without another model call.
    const { data: existing, error: existingErr } = await supabase
      .from("reports")
      .select("id")
      .eq("case_id", case_id)
      .eq("report_type", "fidrec_pack_v1")
      .not("report_json", "is", null)
      .limit(1)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: "report_unavailable", code: existingErr.code ?? null }, 500);
    if (existing) return json({ ok: true, case_id, report_id: existing.id, reused: true }, 200);

    const fact_snapshot_id = typeof body.fact_snapshot_id === "string" ? body.fact_snapshot_id : null;
    if (!fact_snapshot_id) return json({ ok: false, reason: "facts_unconfirmed", error: "Confirm your facts first" }, 409);
    const { data: snapshot, error: snapshotErr } = await supabase
      .from("case_fact_snapshots")
      .select("id, facts")
      .eq("case_id", case_id)
      .eq("stage", "fidrec")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotErr) return json({ ok: false, error: "snapshot_unavailable", code: snapshotErr.code ?? null }, 500);
    if (!snapshot || snapshot.id !== fact_snapshot_id) {
      return json({ ok: false, reason: "facts_unconfirmed", error: "These facts are no longer the latest confirmed facts" }, 409);
    }
    const facts = snapshot.facts as SnapshotFacts;

    // Decision 7, as amended by CR-2 (27 Nov): nothing is generated while the bank has not had its chance to answer.
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const route = fidrecRouteFromFacts(facts, today);
    if (!route.available) {
      return json({
        ok: false,
        reason: route.reason,
        ...(route.reason === "fidrec_too_early" ? { opensOn: route.availableFrom, complaintDate: route.complaintDate } : {}),
        error: "FIDReC can't take this complaint on the confirmed facts yet",
      }, 409);
    }

    // Evidence minimums (Elena, 23 Nov 2026): the same check as the generate screen and the web route.
    const { data: evidenceRows, error: evidenceErr } = await supabase
      .from("case_documents")
      .select(EVIDENCE_DOCUMENT_SELECT)
      .eq("case_id", case_id);
    if (evidenceErr) return json({ ok: false, error: "documents_unavailable", code: evidenceErr.code ?? null }, 500);
    const evidence = checkPackEvidence("fidrec", (evidenceRows ?? []) as EvidenceDocument[]);
    if (!evidence.ready) {
      return json({ ok: false, reason: "evidence_missing", missing: evidence.missing, error: "Add the documents this pack needs first" }, 409);
    }

    const { data: storyRow, error: storyErr } = await supabase
      .from("case_story_revisions")
      .select("story_text")
      .eq("case_id", case_id)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (storyErr) return json({ ok: false, error: "story_unavailable", code: storyErr.code ?? null }, 500);

    const { data: findings, error: findingsErr } = await supabase
      .from("case_fact_findings")
      .select("fact_key, finding_type, values, resolution")
      .eq("case_id", case_id)
      .is("invalidated_at", null);
    if (findingsErr) return json({ ok: false, error: "findings_unavailable", code: findingsErr.code ?? null }, 500);

    // The institution's own final reply, only from a letter read as a bank letter with confidence above 0.7.
    let finalReplyText: string | null = null;
    const finalReplyDocumentId = qualifyingFinalReplyDocumentId(findings ?? []);
    if (finalReplyDocumentId) {
      const { data: document, error: documentErr } = await supabase
        .from("case_documents")
        .select("content_latest_id")
        .eq("id", finalReplyDocumentId)
        .eq("case_id", case_id)
        .maybeSingle();
      if (documentErr) return json({ ok: false, error: "document_unavailable", code: documentErr.code ?? null }, 500);
      if (document?.content_latest_id) {
        const { data: content, error: contentErr } = await supabase
          .from("case_documents_content")
          .select("text_content")
          .eq("id", document.content_latest_id)
          .maybeSingle();
        if (contentErr) return json({ ok: false, error: "document_unavailable", code: contentErr.code ?? null }, 500);
        finalReplyText = content?.text_content?.trim() || null;
      }
    }

    // Every ready document is evidence: those behind the confirmed facts first, then the rest (such as the bank's
    // device and IP records). The model gets a capped excerpt of each.
    const { data: documentRows, error: documentsErr } = await supabase
      .from("case_documents")
      .select("id, verified_document_type, complainant_item, content_latest_id, processing_status, upload_date")
      .eq("case_id", case_id)
      .eq("processing_status", "ready")
      .order("upload_date", { ascending: true });
    if (documentsErr) return json({ ok: false, error: "documents_unavailable", code: documentsErr.code ?? null }, 500);
    const contentIds = (documentRows ?? []).map((d) => d.content_latest_id).filter((id): id is string => Boolean(id));
    const { data: contents, error: contentsErr } = contentIds.length
      ? await supabase.from("case_documents_content").select("id, text_content").in("id", contentIds)
      : { data: [] as Array<{ id: string; text_content: string | null }>, error: null };
    if (contentsErr) return json({ ok: false, error: "documents_unavailable", code: contentsErr.code ?? null }, 500);
    const contentText = new Map((contents ?? []).map((c) => [c.id as string, (c.text_content as string | null) ?? null]));
    const caseDocuments: CaseDocument[] = (documentRows ?? []).map((d) => ({
      id: d.id as string,
      evidenceType: (d.verified_document_type as string | null) ?? null,
      complainantItem: (d.complainant_item as string | null) ?? null,
      text: d.content_latest_id ? contentText.get(d.content_latest_id as string) ?? null : null,
    }));

    const evidenceIndex = buildEvidenceIndex(findings ?? [], caseDocuments);
    const excerpts = documentExcerpts(evidenceIndex, caseDocuments);
    // Requirements 8.1: never written from part of the documents.
    if (!allDocumentsRead(evidenceIndex, excerpts, caseDocuments)) {
      console.warn(`FIDReC pack not completed: documents_too_long ${case_id}`);
      return json({ ok: false, reason: "output_validation_failed", error: "The FIDReC pack could not be completed", fault: "documents_too_long", checks: [] }, 422);
    }

    const usageEnv = usageEnvironment(Deno.env.toObject());
    const usageClient = supabase as unknown as UsageClient;
    const meter = { caller: "edge" as const, purpose: "fidrec_pack", provider: "openai" as const, caseId: case_id };

    // The duties section's clauses. If they cannot be looked up, no pack is delivered without its duties section
    // (item 16, Elena, 27 Nov 2026): nothing is generated or saved, and the person can try again.
    let clauses: ReturnType<typeof numberClauses> = [];
    try {
      clauses = await retrieveClauses(regulatoryQuery(facts), caseInstruments(facts), (call) =>
        recordModelUsage(usageClient, usageEnv, { ...meter, purpose: "fidrec_pack_retrieval", model: EMBEDDING_MODEL, ...call })
      );
    } catch (error) {
      console.warn(`FIDReC pack clause retrieval failed: ${safeErrorText(error)}`);
      const { error: logErr } = await supabase.from("analytics_events").insert({
        event_name: "fidrec_pack_rules_unavailable",
        event_data: { case_id, fact_snapshot_id, release: typeof body.release === "string" ? body.release.slice(0, 40) : null },
      });
      if (logErr) console.error(`FIDReC pack review log failed: ${logErr.code ?? "unknown"}`);
      return json({ ok: false, reason: "output_validation_failed", error: "The FIDReC pack could not be completed", checks: [] }, 422);
    }

    const quotables = documentQuotables(excerpts);
    const checkDates = [...(route.route === "final_reply" ? [route.deadline] : []), ...quotables.dates, ...clauses.flatMap((c) => c.dates)];
    const input = buildFidrecPackInput({
      facts,
      findings: findings ?? [],
      storyText: storyRow?.story_text ?? null,
      finalReplyText,
      evidenceIndex,
      documents: excerpts,
      clauses,
      allowedDates: [...factDates(facts), ...checkDates],
    });
    const checks = {
      ...fidrecPackChecks(checkDates, quotables),
      documented: documentedFacts(findings ?? []),
    };
    const user = `INPUT JSON:
${JSON.stringify(input, null, 2)}`;
    const deadline = Date.now() + FIDREC_PACK_BUDGET_MS;
    const result = await produceChecked({
      facts,
      options: checks,
      sanitize: sanitizeProse,
      mapText: mapFidrecPackProse,
      texts: fidrecPackTexts,
      fallback: fidrecPackFallback,
      describeReference: (ref) => describeReferenceSource(ref, {
        documents: evidenceIndex.map((e) => {
          const document = caseDocuments.find((d) => d.id === e.documentId);
          return { id: e.id, label: e.label, type: document?.evidenceType ?? null, text: document?.text ?? null };
        }),
        story: (storyRow?.story_text as string | null) ?? "",
        voice: "complainant",
      }),
      extraChecks: (prose) => [...listLengthFailures(prose), ...evidenceIdFailures(prose, evidenceIndex), ...dutyFailures(prose, clauses, facts, checks)],
      generate: (previousFailures) =>
        chatJson(
          {
            fetch,
            apiKey: OPENAI_API_KEY,
            model: FIDREC_PACK_MODEL,
            secondaryModel: FIDREC_PACK_SECONDARY_MODEL,
            maxTokens: OUTPUT_CAPS.fidrec_pack,
            system: fidrecPackSystem(previousFailures),
            user,
            deadline,
            // Whole documents take longer to read than excerpts did.
            callTimeoutMs: 90_000,
            onCall: (call) =>
              recordModelUsage(usageClient, usageEnv, {
                ...meter,
                model: call.model,
                usage: call.usage ?? undefined,
                latencyMs: call.latencyMs,
                httpStatus: call.httpStatus,
                outcome: call.kind === "ok" ? "ok" : call.kind === "refusal" ? "refused" : "error",
              }),
          },
          parseFidrecPackProse,
        ),
    });

    // Review log: IDs, check names and the release only, never the story, the letter or the generated text.
    const review = {
      case_id,
      fact_snapshot_id,
      source: result.source,
      fallback_reason: result.fallbackReason,
      attempts: result.attempts,
      fired_checks: result.firedChecks,
      hard_checks: result.hardChecks,
      final_reply_used: Boolean(finalReplyText),
      evidence_documents: evidenceIndex.length,
      clauses_retrieved: clauses.length,
      duties: result.output.institution_duties.length,
      model: FIDREC_PACK_MODEL,
      release: typeof body.release === "string" ? body.release.slice(0, 40) : null,
      // Where a rejected reference came from, never the reference itself.
      reference_kinds: referenceKinds(result.rejectedReferences ?? [], {
        documents: [...excerpts.map((e) => e.excerpt), finalReplyText ?? ""].join("\n"),
        story: storyRow?.story_text ?? "",
        ruleClauses: clauses.map((c) => `${c.source} ${c.clause_ref ?? ""} ${c.title ?? ""} ${c.text}`).join("\n"),
      }),
    };
    if (result.source === "fallback") console.warn(`FIDReC pack not completed: ${JSON.stringify(review)}`);
    const { error: reviewErr } = await supabase.from("analytics_events").insert({
      event_name: result.source === "fallback" ? "fidrec_pack_fixed_wording" : "fidrec_pack_generated",
      event_data: review,
    });
    if (reviewErr) console.error(`FIDReC pack review log failed: ${reviewErr.code ?? "unknown"}`);

    // Elena, 27 Nov 2026: the fixed wording has no arguments for either side, so it is never delivered as the pack.
    // Nothing is committed: the person is told it could not be completed and can generate again.
    if (result.source === "fallback") {
      return json({ ok: false, reason: "output_validation_failed", error: "The FIDReC pack could not be completed", checks: result.hardChecks.map((check) => ({ check })) }, 422);
    }

    const report = assembleFidrecPack({
      prose: result.output,
      source: result.source,
      facts,
      findings: (findings ?? []).map((f) => ({
        factKey: f.fact_key,
        values: (f.values ?? []) as EvidenceFinding["values"],
        resolution: f.resolution as EvidenceFinding["resolution"],
      })),
      evidenceIndex,
      route,
      finalReplyUsed: Boolean(finalReplyText),
      clauses,
      today,
    });
    const { data: committed, error: commitErr } = await supabase.rpc("commit_fidrec_pack_v1", {
      p_case_id: case_id,
      p_fact_snapshot_id: fact_snapshot_id,
      p_report_json: report,
    });
    if (commitErr) {
      const reason = commitErr.message === "fidrec_pack_snapshot_not_current" ? "facts_unconfirmed" : null;
      return json({ ok: false, ...(reason ? { reason } : {}), error: "report_not_saved", code: commitErr.code ?? null }, reason ? 409 : 500);
    }

    return json({ ok: true, case_id, report_id: (committed as { id?: string } | null)?.id ?? null, source: result.source }, 200);
  } catch (e) {
    // No case content in logs or responses (hardening item 6): name, code and a scrubbed message only.
    console.error(`FIDReC pack error: ${safeErrorText(e)}`);
    if (e instanceof HarborEdgeAuthError) return json({ ok: false, error: e.message }, e.status);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});

// One embedding of the case's duty question, then the nearest clauses with their documents' titles.
async function retrieveClauses(
  query: string,
  instruments: ReturnType<typeof caseInstruments>,
  onCall: (call: { usage?: ReturnType<typeof openAiUsage>; latencyMs: number; httpStatus: number | null; outcome: "ok" | "error" }) => unknown,
) {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: query }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => null);
  await onCall({ usage: openAiUsage(data), latencyMs: Date.now() - started, httpStatus: res.status, outcome: res.ok ? "ok" : "error" });
  const embedding = data?.data?.[0]?.embedding;
  if (!res.ok || !Array.isArray(embedding)) throw new Error(`embedding failed (${res.status})`);

  const supabase = createClient(PROJECT_URL!, SERVICE_ROLE_KEY!);
  const { data: matches, error } = await supabase.rpc("match_regulatory_clauses_threshold", {
    query_embedding: embedding,
    // Twice the clauses kept, so the payment-kind filter below still leaves enough.
    match_count: CLAUSE_COUNT * 2,
    similarity_threshold: CLAUSE_SIMILARITY,
  });
  if (error) throw new Error(`clause search failed (${error.code ?? "unknown"})`);
  const rows = (matches ?? []) as Array<{ document_id: string | null; clause_ref: string | null; title: string | null; text_content: string }>;
  const documentIds = [...new Set(rows.map((r) => r.document_id).filter((id): id is string => Boolean(id)))];
  const { data: documents, error: documentsError } = documentIds.length
    ? await supabase.from("regulatory_documents").select("id, document_title, document_key, issue_date, effective_date").in("id", documentIds)
    : { data: [] as Array<{ id: string; document_title: string; document_key: string | null; issue_date: string | null; effective_date: string | null }>, error: null };
  if (documentsError) throw new Error(`clause sources failed (${documentsError.code ?? "unknown"})`);
  const titles = new Map((documents ?? []).map((d) => [d.id, (d.document_key as string | null) ?? (d.document_title as string)]));
  const dates = new Map((documents ?? []).map((d) => [d.id, [d.issue_date as string | null, d.effective_date as string | null]]));
  // Only clauses that apply to the case's kinds of payment (brief v5 Phase 0b: no SRF clause and no EUPG paragraph
  // outside 4.2-4.6, 4.10-4.12 and 4.14-4.16 for card payments), each labelled with the payments it covers.
  return numberClauses(routeClauses(rows.map((r) => ({
    ...r,
    source: (r.document_id && titles.get(r.document_id)) || "Regulatory source",
    dates: (r.document_id && dates.get(r.document_id)) || [],
  })), instruments, CLAUSE_COUNT));
}

// The old report's wording rule, kept: "disputed", never "unauthorised" (run_report_selfserve_v1).
function sanitizeProse(text: string): string {
  return text.replace(/\bunauthori[sz]ed\b/gi, "disputed").replace(/[ \t]{2,}/g, " ").trim();
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
