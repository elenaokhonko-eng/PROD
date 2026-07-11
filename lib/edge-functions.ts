/**
 * Edge function + server-route constants — single source of truth.
 *
 * Every call site (server routes, client hooks) imports from this file.
 * **Never** inline an edge-function name as a string literal elsewhere.
 *
 * Contract source:
 * - docs/Front-to-Back-End-Integration-Summary.md §9.1
 * - docs/2026-04-21-Masha-Feedback-Reconciliation.md (active function set
 *   and canonical sequence verified 2026-04-21)
 *
 * **Active Supabase edge functions called from the frontend** (Masha-confirmed
 * 2026-04-21). The canonical sequence is:
 *
 *   Tier-0 (free):
 *     1. evidence_processed_v2   — per uploaded document
 *     2. run_case_extract_v4     — structured extraction + loss calculation;
 *                                  may fire multiple times through the
 *                                  gap-question loop. "Validation" is a
 *                                  Postgres-level trigger on case_extract_runs,
 *                                  not a separate function call.
 *     3. bright-function         — Tier-0 narrative generator
 *
 *   Tier-1 (after Stripe → plan = 'self_serve_report'):
 *     4. run_case_decision_v1    — decision engine
 *     5. run_report_selfserve_v1 — paid report
 *
 * Every other historical function is archived / admin-only and is NOT part of
 * the frontend call graph:
 * - run_case_extract_v1 / _v2 / _v3 — archived in Supabase 2026-04-21.
 * - gemini-task                     — archived. Do not call.
 * - candidate-transactions          — Masha-internal fallback only. Fires
 *                                     from the Supabase Dashboard (by Masha)
 *                                     ONLY when run_case_extract_v4 fails to
 *                                     compute the loss amount. The frontend
 *                                     does not call it. Not wired here.
 * - compute-loss                    — Masha-internal fallback only (see above).
 * - backfill_embeddings_v1          — admin-only cron job.
 * - url_catalogue (decision_url_inbox) — admin-only.
 *
 * NOTE on the version-number trap: the live extract function is the
 * Supabase folder `run_case_extract_v4`. Its INTERNAL version string
 * reads `"v3.2555…"` which is a source-level semver unrelated to the
 * deployed folder name. Ignore the internal string; the folder name is
 * the contract. See the reconciliation doc §2.
 */

// ---------------------------------------------------------------------------
// Supabase edge-function folder names (the path after /functions/v1/)
// ---------------------------------------------------------------------------

/** Tier-0 step 2 — structured extraction + loss calculation.
 *  Fires multiple times per case through the gap-question loop:
 *  (a) after minimum intake is complete,
 *  (b) after each new gap-question answer or evidence upload,
 *  (c) one freshness-check pass before Tier-0 narrative / Tier-1 decision.
 *  Writes to `case_extract_runs`; a Postgres trigger then emits the
 *  validation run row (no separate validation function call from here). */
export const EXTRACT_FN = 'run_case_extract_v4'

/** Tier-0 step 3 — Tier-0 narrative generator. Labelled
 *  "tier-0 narrative generator" in the Supabase Dashboard; the deployed
 *  folder slug is `bright-function`. Produces `tier0_summary`,
 *  `tier0_evidence_checklist`, and (when applicable) the minimal
 *  `tier0_srf_signal` (bank/telco path-relevant flags + potential FIDReC
 *  match). Fires once the gap loop has settled. */
export const TIER0_FN = 'bright-function'

/** Tier-0 step 1 — per-document evidence processor. The only
 *  evidence-processing function (Masha confirmed 2026-04-21). Can be
 *  re-run on the same document / case. NOT auto-triggered by the
 *  database — the server route calls it explicitly after each upload. */
export const EVIDENCE_FN = 'evidence_processed_v2'

/** Tier-1 step 4 — case decision engine. Fires after Stripe webhook
 *  upgrades the case to `plan = 'self_serve_report'`, BEFORE the report
 *  generator. Never called in Tier-0 (Masha confirmed 2026-04-21). */
export const DECISION_FN = 'run_case_decision_v1'

/** Tier-1 step 5 — self-serve report generator.
 *  Requires the server-only `simulation_key` to be injected in the body. */
export const REPORT_FN = 'run_report_selfserve_v1'

// ---------------------------------------------------------------------------
// Server-route paths the browser hits. The browser never fetches Supabase
// edge functions directly — every arrow in the State Machine is 3-hop:
// browser → Next.js route → Supabase edge function. (SM R1, IS §9.2)
// ---------------------------------------------------------------------------

export const EDGE_ROUTES = {
  extract: '/api/edge/extract',
  evidence: '/api/edge/evidence',
  tier0: '/api/edge/tier0',
  decision: '/api/edge/decision',
  report: '/api/edge/report',
} as const

export type EdgeRouteKey = keyof typeof EDGE_ROUTES

/** Canonical mapping from server-route key to edge-function folder name.
 *  Used by lib/server/edge-proxy.ts so the wrapper has one dispatch table. */
export const EDGE_ROUTE_TO_FN: Record<EdgeRouteKey, string> = {
  extract: EXTRACT_FN,
  evidence: EVIDENCE_FN,
  tier0: TIER0_FN,
  decision: DECISION_FN,
  report: REPORT_FN,
}

// ---------------------------------------------------------------------------
// Archived / not-called-from-frontend functions. Kept here ONLY so grep
// finds them when auditing; never import these from application code.
// See docs/2026-04-21-Masha-Feedback-Reconciliation.md §4 (archived list).
// ---------------------------------------------------------------------------

/** @deprecated archived in Supabase 2026-04-21. Use EXTRACT_FN (v4). */
export const LEGACY_EXTRACT_FNS = [
  'run_case_extract_v1',
  'run_case_extract_v2',
  'run_case_extract_v3',
] as const

/** @deprecated archived 2026-04-21. Do NOT call from the frontend. */
export const ARCHIVED_GEMINI_TASK_FN = 'gemini-task'

/** @deprecated Masha-internal fallback only — fires from the Supabase
 *  Dashboard ONLY when `run_case_extract_v4` fails to compute the loss
 *  amount. Do NOT call from the frontend. Kept here for audit visibility. */
export const FALLBACK_ONLY_FNS = [
  'candidate-transactions',
  'compute-loss',
] as const
