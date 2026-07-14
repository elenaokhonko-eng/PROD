-- Diagnostic: case_extract_runs with no matching case_validation_runs.
-- Prefer this script over a public view. Read-only.
--
-- Usage (hosted, read-only):
--   npx supabase db query --linked -f scripts/sql/find-extracts-without-validation.sql

WITH orphans AS (
  SELECT
    e.id AS extract_run_id,
    e.case_id,
    e.created_at,
    e.model_name,
    e.prompt_version,
    e.intake_id,
    c.user_id AS case_owner_id,
    (c.user_id IS NOT NULL) AS ownership_present,
    (
      SELECT e2.id
      FROM public.case_extract_runs e2
      WHERE e2.case_id = e.case_id
      ORDER BY e2.created_at DESC
      LIMIT 1
    ) AS latest_extract_id,
    EXISTS (
      SELECT 1 FROM public.case_validation_runs v2 WHERE v2.case_id = e.case_id
    ) AS case_has_any_validation,
    (
      SELECT v3.id
      FROM public.case_validation_runs v3
      WHERE v3.case_id = e.case_id
      ORDER BY v3.created_at DESC
      LIMIT 1
    ) AS older_or_other_validation_id,
    (
      SELECT v3.extract_run_id
      FROM public.case_validation_runs v3
      WHERE v3.case_id = e.case_id
      ORDER BY v3.created_at DESC
      LIMIT 1
    ) AS latest_validation_extract_id,
    EXISTS (
      SELECT 1 FROM public.case_decision_runs d WHERE d.case_id = e.case_id
    ) AS case_has_decision,
    now() - e.created_at AS age,
    CASE
      WHEN c.id IS NULL THEN jsonb_build_object('error', 'case_row_missing')
      WHEN c.user_id IS NULL THEN jsonb_build_object('error', 'case_owner_null_eligibility_unavailable')
      ELSE public.get_case_eligibility(e.case_id)
    END AS eligibility
  FROM public.case_extract_runs e
  LEFT JOIN public.case_validation_runs v ON v.extract_run_id = e.id
  LEFT JOIN public.cases c ON c.id = e.case_id
  WHERE v.id IS NULL
)
SELECT
  extract_run_id,
  case_id,
  created_at,
  age,
  model_name,
  prompt_version,
  ownership_present,
  case_owner_id,
  (extract_run_id = latest_extract_id) AS is_latest_extract,
  case_has_any_validation,
  older_or_other_validation_id,
  case_has_decision,
  eligibility->'resolved_ids' AS resolved_ids,
  eligibility->'prerequisites' AS prerequisites,
  eligibility->'eligible_actions' AS eligible_actions,
  -- Intentional skip is not retrospectively knowable until skip_validation
  -- column exists (migration 20260714120000). All latest orphans >5m are
  -- repair candidates pending operator review.
  (
    extract_run_id = latest_extract_id
    AND age > interval '5 minutes'
  ) AS eligible_for_repair
FROM orphans
ORDER BY
  (extract_run_id = latest_extract_id) DESC,
  created_at DESC;
