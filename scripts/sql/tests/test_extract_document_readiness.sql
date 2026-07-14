/**
 * Integration-style SQL tests for document readiness extract gate.
 * Requires migration 20260714140000. Rolls back. Do not run live repair.
 *
 *   npx supabase db query --linked -f scripts/sql/tests/test_extract_document_readiness.sql
 *
 * Note: Edge behaviour (409 / OpenAI) is covered by TS unit tests + deploy smoke.
 * This script asserts persistence column shape + no auth.uid in related functions.
 */

BEGIN;

DO $$
DECLARE
  v_cols text[];
BEGIN
  SELECT array_agg(column_name::text ORDER BY column_name)
  INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'case_extract_runs'
    AND column_name IN (
      'allow_partial_evidence',
      'total_document_count',
      'evidence_document_count',
      'ready_document_count',
      'queued_document_count',
      'processing_document_count',
      'uploaded_document_count',
      'failed_document_count',
      'not_ready_document_count',
      'document_snapshot_at',
      'evidence_snapshot'
    );

  IF coalesce(array_length(v_cols, 1), 0) <> 11 THEN
    RAISE EXCEPTION 'missing readiness columns on case_extract_runs: %', v_cols;
  END IF;

  -- Historical nullability: no NOT NULL / DEFAULT backfill on allow_partial_evidence
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'case_extract_runs'
      AND column_name = 'allow_partial_evidence'
      AND (is_nullable = 'NO' OR column_default IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'allow_partial_evidence must remain nullable without default backfill';
  END IF;

  RAISE NOTICE 'extract document readiness schema checks passed';
END;
$$;

ROLLBACK;
