-- Smoke test: cases → case_extract_runs → run_validation_v1 → case_validation_gap_items
-- Run as a role that bypasses RLS (e.g. postgres in SQL editor) or use service role.
-- Requires: pgcrypto for gen_random_uuid() (enabled by default on Supabase).

BEGIN;

DROP TABLE IF EXISTS _smoke_validation_gap_test;

CREATE TEMP TABLE _smoke_validation_gap_test ON COMMIT DROP AS
WITH ins_case AS (
  INSERT INTO public.cases (id, claim_type)
  VALUES (gen_random_uuid(), 'phishing_scam')
  RETURNING id AS case_id
),
ins_extract AS (
  INSERT INTO public.case_extract_runs (case_id, extract_json, model_name, prompt_version)
  SELECT
    c.case_id,
    jsonb_build_object(
      'incident_date', NULL,
      'reported_loss', jsonb_build_object(
        'amount', NULL,
        'currency', NULL
      ),
      'customer_actions', jsonb_build_object(
        'shared_otp', NULL,
        'provided_credentials', NULL
      )
    ),
    'sql_smoke_validation',
    'v0'
  FROM ins_case c
  RETURNING id AS extract_run_id, case_id
)
SELECT
  ie.case_id,
  ie.extract_run_id,
  public.run_validation_v1(ie.extract_run_id) AS validation_run_id
FROM ins_extract ie;

-- 1) IDs from this run (one row)
SELECT case_id, extract_run_id, validation_run_id
FROM _smoke_validation_gap_test;

-- 2) Validation row + counts (scoped to this run only)
SELECT
  v.id,
  v.status,
  jsonb_array_length(v.missing_fields) AS missing_count,
  (
    SELECT count(*)::bigint
    FROM public.case_validation_gap_items g
    WHERE g.validation_run_id = v.id
  ) AS gap_item_count
FROM public.case_validation_runs v
JOIN _smoke_validation_gap_test t ON v.id = t.validation_run_id;

-- 3) Gap items for this validation run
SELECT
  g.field_key,
  g.question_text,
  g.expected_answer_type,
  g.sort_order
FROM public.case_validation_gap_items g
JOIN _smoke_validation_gap_test t ON g.validation_run_id = t.validation_run_id
ORDER BY g.sort_order ASC, g.created_at ASC;

COMMIT;
