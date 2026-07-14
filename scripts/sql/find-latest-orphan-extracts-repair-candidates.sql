-- Repair-candidate dry-run: latest orphan extracts only, older than 5 minutes.
-- Read-only. get_case_eligibility returns jsonb.
WITH orphans AS (
  SELECT
    e.id AS extract_run_id,
    e.case_id,
    e.created_at,
    e.model_name,
    e.prompt_version,
    c.user_id AS case_owner_id,
    (c.user_id IS NOT NULL) AS ownership_present,
    (
      SELECT e2.id FROM public.case_extract_runs e2
      WHERE e2.case_id = e.case_id
      ORDER BY e2.created_at DESC LIMIT 1
    ) AS latest_extract_id,
    EXISTS (
      SELECT 1 FROM public.case_validation_runs v2 WHERE v2.case_id = e.case_id
    ) AS case_has_any_validation,
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
  model_name,
  prompt_version,
  ownership_present,
  case_has_any_validation,
  case_has_decision,
  age,
  eligibility->'resolved_ids' AS resolved_ids,
  eligibility->'eligible_actions' AS eligible_actions,
  eligibility->'prerequisites' AS prerequisites,
  true AS eligible_for_repair_candidate
FROM orphans
WHERE extract_run_id = latest_extract_id
  AND age > interval '5 minutes'
ORDER BY created_at DESC;
