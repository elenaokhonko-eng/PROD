/**
 * Static / contract tests for extract↔validation reconciliation.
 *
 * Run: pnpm test:validation-recon
 * Does not apply migrations or mutate hosted data.
 *
 * DB integration coverage lives in:
 *   scripts/sql/tests/test_validation_reconciliation.sql
 * (run locally after applying 20260714120000).
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const migration = readFileSync(
  path.join(root, "supabase/migrations/20260714120000_validation_reconciliation_rpcs.sql"),
  "utf8",
)
const edge = readFileSync(
  path.join(root, "supabase/functions/run_case_extract_v4/index.ts"),
  "utf8",
)
const diagnostic = readFileSync(
  path.join(root, "scripts/sql/find-extracts-without-validation.sql"),
  "utf8",
)

describe("validation reconciliation migration contract", () => {
  it("adds nullable skip_validation without backfill default", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS skip_validation boolean/)
    assert.match(migration, /ALTER COLUMN skip_validation DROP NOT NULL/)
    assert.match(migration, /ALTER COLUMN skip_validation DROP DEFAULT/)
  })

  it("creates audit table validation_reconciliation_events", () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.validation_reconciliation_events/)
  })

  it("defines single-extract reconcile RPC", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reconcile_validation_for_extract/)
  })

  it("defines batch reconcile RPC with dry_run default true", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reconcile_missing_validations/)
    assert.match(migration, /p_dry_run boolean DEFAULT true/)
  })

  it("uses SECURITY DEFINER + empty search_path", () => {
    assert.match(migration, /SECURITY DEFINER/)
    assert.match(migration, /SET search_path = ''/)
  })

  it("revokes anon/authenticated and grants service_role only", () => {
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.reconcile_validation_for_extract[\s\S]*FROM anon, authenticated/,
    )
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.reconcile_validation_for_extract[\s\S]*TO service_role/,
    )
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.reconcile_missing_validations[\s\S]*FROM anon, authenticated/,
    )
  })

  it("handles unique_violation race without failing as operational duplicate", () => {
    assert.match(migration, /WHEN unique_violation THEN/)
    assert.match(migration, /race_resolved/)
  })

  it("returns skipped_intentionally / skipped_unknown when not forced", () => {
    assert.match(migration, /skipped_intentionally/)
    assert.match(migration, /skipped_unknown/)
    assert.match(migration, /v_extract\.skip_validation IS TRUE/)
    assert.match(migration, /v_extract\.skip_validation IS NULL/)
  })

  it("batch auto-candidates require skip_validation IS FALSE unless forced", () => {
    assert.match(migration, /e\.skip_validation IS FALSE/)
  })

  it("locks down run_validation_v1 to service_role", () => {
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.run_validation_v1\(uuid\) FROM PUBLIC/)
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.run_validation_v1\(uuid\) FROM anon, authenticated/)
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.run_validation_v1\(uuid\) TO service_role/)
  })

  it("calls public.run_validation_v1 from reconcile (no duplicate invent path outside hardened fn)", () => {
    assert.match(migration, /v_validation_id := public\.run_validation_v1\(p_extract_run_id\)/)
    // reconcile RPCs must not INSERT validation rows themselves
    const afterReconcile = migration.split("CREATE OR REPLACE FUNCTION public.reconcile_validation_for_extract")[1] ?? ""
    assert.doesNotMatch(afterReconcile, /INSERT INTO public\.case_validation_runs/)
  })

  it("does not add AFTER INSERT trigger on case_extract_runs", () => {
    assert.doesNotMatch(migration, /AFTER INSERT ON public\.case_extract_runs/)
    assert.doesNotMatch(migration, /CREATE TRIGGER.*case_extract_runs/)
  })

  it("does not introduce auth.uid() / auth.users ownership", () => {
    assert.doesNotMatch(migration, /auth\.uid\(/)
    assert.doesNotMatch(migration, /auth\.users/)
  })

  it("caps batch size and filters older_than + latest_only", () => {
    assert.match(migration, /LEAST\(GREATEST\(coalesce\(p_limit, 50\), 1\), 100\)/)
    assert.match(migration, /p_older_than/)
    assert.match(migration, /p_latest_only/)
  })
})

describe("run_case_extract_v4 partial-failure contract", () => {
  it("persists skip_validation on extract insert", () => {
    assert.match(edge, /skip_validation/)
  })

  it("surfaces partial_success when the atomic commit reports a validation error", () => {
    assert.match(edge, /const partial_success = !skip_validation && !!validation_error/)
    assert.match(edge, /partial_success,/)
    assert.match(edge, /rpc_error:\s*validation_error/)
    assert.match(edge, /extract_run_id:\s*extract_run\.id/)
  })

  it("keeps HTTP 200 on validation failure for caller compatibility", () => {
    assert.match(edge, /return jsonResp\(\{[\s\S]*?warning:\s*partial_success[\s\S]*?\}, 200\)/)
  })

  it("logs structured validation attempt fields", () => {
    assert.match(edge, /validation_attempted/)
    assert.match(edge, /\[extract_validation\]/)
  })

  it("does not delete extract row on validation failure", () => {
    assert.doesNotMatch(edge, /\.from\("case_extract_runs"\)\.delete\(/)
  })
})

describe("diagnostic script", () => {
  it("identifies orphans and repair eligibility", () => {
    assert.match(diagnostic, /LEFT JOIN public\.case_validation_runs v ON v\.extract_run_id = e\.id/)
    assert.match(diagnostic, /eligible_for_repair/)
    assert.match(diagnostic, /get_case_eligibility/)
    assert.match(diagnostic, /is_latest_extract/)
  })
})
