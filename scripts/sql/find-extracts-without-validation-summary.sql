-- Phase 1 diagnostic: extracts without matching validation (read-only).
-- Do not mutate data.

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
      SELECT 1
      FROM public.case_validation_runs v2
      WHERE v2.case_id = e.case_id
    ) AS case_has_any_validation,
    (
      SELECT v3.id
      FROM public.case_validation_runs v3
      WHERE v3.case_id = e.case_id
      ORDER BY v3.created_at DESC
      LIMIT 1
    ) AS latest_validation_any_id,
    (
      SELECT v3.extract_run_id
      FROM public.case_validation_runs v3
      WHERE v3.case_id = e.case_id
      ORDER BY v3.created_at DESC
      LIMIT 1
    ) AS latest_validation_extract_id,
    EXISTS (
      SELECT 1
      FROM public.case_decision_runs d
      WHERE d.case_id = e.case_id
    ) AS case_has_decision,
    now() - e.created_at AS age
  FROM public.case_extract_runs e
  LEFT JOIN public.case_validation_runs v ON v.extract_run_id = e.id
  LEFT JOIN public.cases c ON c.id = e.case_id
  WHERE v.id IS NULL
)
SELECT json_build_object(
  'orphan_count', count(*)::int,
  'latest_orphan_count', count(*) FILTER (WHERE extract_run_id = latest_extract_id)::int,
  'obsolete_orphan_count', count(*) FILTER (WHERE extract_run_id IS DISTINCT FROM latest_extract_id)::int,
  'null_owner_orphans', count(*) FILTER (WHERE NOT ownership_present)::int,
  'orphans_on_cases_with_other_validation', count(*) FILTER (WHERE case_has_any_validation)::int,
  'orphans_on_cases_with_zero_validation', count(*) FILTER (WHERE NOT case_has_any_validation)::int,
  'orphans_older_than_5_minutes', count(*) FILTER (WHERE age > interval '5 minutes')::int,
  'latest_orphans_older_than_5_minutes', count(*) FILTER (
    WHERE extract_run_id = latest_extract_id AND age > interval '5 minutes'
  )::int
) AS summary
FROM orphans;
