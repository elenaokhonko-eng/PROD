WITH ins_case AS (
  INSERT INTO public.cases (id, claim_type)
  VALUES (gen_random_uuid(), 'phishing_scam')
  RETURNING id AS case_id
),
ins_extract AS (
  INSERT INTO public.case_extract_runs (
    case_id,
    extract_json,
    model_name,
    prompt_version
  )
  SELECT
    case_id,
    '{}'::jsonb,
    'sql_controlled_error_test',
    'v0'
  FROM ins_case
  RETURNING id AS extract_run_id, case_id
),
ins_validation AS (
  INSERT INTO public.case_validation_runs (
    case_id,
    extract_run_id,
    missing_fields,
    questions_to_user,
    status,
    source,
    schema_version,
    is_valid
  )
  SELECT
    case_id,
    extract_run_id,
    '[{"field":"incident_date","reason":"Required for timeline","severity":"required"}]'::jsonb,
    '[]'::jsonb,
    'needs_user',
    'rules',
    'v1',
    true
  FROM ins_extract
  RETURNING id AS validation_run_id, case_id
)
SELECT *
FROM ins_validation;
