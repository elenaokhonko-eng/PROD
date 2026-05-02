-- run_validation_v1: after each case_validation_runs insert, persist row-level gaps
-- in case_validation_gap_items (additive; missing_fields / questions_to_user unchanged).
--
-- Gap writes use a nested BEGIN ... EXCEPTION block (subtransaction). PostgreSQL
-- documents that PL/pgSQL does not support SAVEPOINT / ROLLBACK TO SAVEPOINT /
-- RELEASE SAVEPOINT inside functions (see docs §41.8 Transaction Management).

CREATE OR REPLACE FUNCTION public.run_validation_v1(p_extract_run_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_case_id uuid;
  v_intake_id uuid;
  v_extract jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_questions jsonb := '[]'::jsonb;
  v_status text := 'valid';
  v_validation_id uuid;
  i int;
  n int;
  m_elem jsonb;
  q_match jsonb;
  v_field_key text;
  v_severity text;
  v_qtext text;
  v_eat text;
  v_aopts jsonb;
  v_inserted int;
BEGIN
  SELECT case_id, intake_id, extract_json
  INTO v_case_id, v_intake_id, v_extract
  FROM public.case_extract_runs
  WHERE id = p_extract_run_id;

  IF (v_extract->>'incident_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object(
      'field', 'incident_date',
      'reason', 'Not found in extracted fields',
      'severity', 'required',
      'suggested_question', 'What date did the incident occur?'
    );
    v_questions := v_questions || jsonb_build_object(
      'id', 'q_incident_date',
      'question', 'What date did the incident occur?',
      'field', 'incident_date',
      'answer_type', 'date',
      'required', true,
      'options', null
    );
  END IF;

  IF (v_extract->'reported_loss'->>'amount') IS NULL THEN
    v_missing := v_missing || jsonb_build_object(
      'field', 'reported_loss.amount',
      'reason', 'Loss amount missing',
      'severity', 'required',
      'suggested_question', 'What is the total amount lost?'
    );
    v_questions := v_questions || jsonb_build_object(
      'id', 'q_loss_amount',
      'question', 'What is the total amount lost?',
      'field', 'reported_loss.amount',
      'answer_type', 'money',
      'required', true,
      'options', null
    );
  END IF;

  IF jsonb_array_length(v_missing) > 0 OR jsonb_array_length(v_questions) > 0 THEN
    v_status := 'needs_user';
  END IF;

  INSERT INTO public.case_validation_runs (
    case_id,
    extract_run_id,
    intake_id,
    missing_fields,
    ambiguities,
    questions_to_user,
    status,
    source,
    schema_version,
    is_valid
  )
  VALUES (
    v_case_id,
    p_extract_run_id,
    v_intake_id,
    v_missing,
    '[]'::jsonb,
    v_questions,
    v_status,
    'rules',
    'v1',
    true
  )
  RETURNING id INTO v_validation_id;

  n := COALESCE(jsonb_array_length(v_missing), 0);

  IF n > 0 THEN
    BEGIN
      FOR i IN 0 .. n - 1 LOOP
        m_elem := v_missing -> i;
        v_field_key := btrim(m_elem->>'field');
        IF v_field_key = '' THEN
          RAISE EXCEPTION 'run_validation_v1: blank field in missing_fields at index %', i;
        END IF;

        v_severity := COALESCE(NULLIF(btrim(m_elem->>'severity'), ''), 'required');
        IF v_severity NOT IN ('required', 'recommended', 'optional') THEN
          v_severity := 'required';
        END IF;

        SELECT e.v
        INTO q_match
        FROM jsonb_array_elements(v_questions) WITH ORDINALITY AS e(v, ord)
        WHERE btrim(e.v->>'field') = v_field_key
        ORDER BY e.ord
        LIMIT 1;

        IF q_match IS NOT NULL AND btrim(COALESCE(q_match->>'question', '')) <> '' THEN
          v_qtext := btrim(q_match->>'question');
          v_eat := NULLIF(btrim(q_match->>'answer_type'), '');
          IF v_eat IS NULL
             OR v_eat NOT IN (
               'text', 'date', 'datetime', 'money', 'number', 'boolean',
               'single_choice', 'multi_choice', 'file_upload', 'textarea'
             )
          THEN
            v_eat := 'text';
          END IF;
          IF jsonb_typeof(q_match->'options') = 'array' THEN
            v_aopts := q_match->'options';
          ELSE
            v_aopts := '[]'::jsonb;
          END IF;
          INSERT INTO public.case_validation_gap_items (
            validation_run_id,
            case_id,
            extract_run_id,
            field_key,
            field_label,
            gap_type,
            severity,
            question_text,
            help_text,
            expected_answer_type,
            answer_options,
            source,
            sort_order,
            raw_gap,
            raw_question
          )
          VALUES (
            v_validation_id,
            v_case_id,
            p_extract_run_id,
            v_field_key,
            NULL,
            'missing_required_field',
            v_severity,
            v_qtext,
            NULLIF(btrim(m_elem->>'reason'), ''),
            v_eat,
            v_aopts,
            'run_validation_v1',
            i,
            m_elem,
            q_match
          );
        ELSE
          v_qtext := format('Please provide more information about: %s', v_field_key);
          INSERT INTO public.case_validation_gap_items (
            validation_run_id,
            case_id,
            extract_run_id,
            field_key,
            field_label,
            gap_type,
            severity,
            question_text,
            help_text,
            expected_answer_type,
            answer_options,
            source,
            sort_order,
            raw_gap,
            raw_question
          )
          VALUES (
            v_validation_id,
            v_case_id,
            p_extract_run_id,
            v_field_key,
            NULL,
            'missing_required_field',
            v_severity,
            v_qtext,
            NULLIF(btrim(m_elem->>'reason'), ''),
            'text',
            '[]'::jsonb,
            'run_validation_v1',
            i,
            m_elem,
            CASE WHEN q_match IS NULL THEN NULL ELSE q_match END
          );
        END IF;
      END LOOP;

      SELECT count(*)::int
      INTO v_inserted
      FROM public.case_validation_gap_items
      WHERE validation_run_id = v_validation_id;

      IF v_inserted <> n THEN
        RAISE EXCEPTION 'run_validation_v1: expected % gap_item row(s), inserted %', n, v_inserted;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        UPDATE public.case_validation_runs
        SET
          status = 'error',
          error_message = left(SQLERRM, 10000),
          is_valid = false
        WHERE id = v_validation_id;
        RETURN v_validation_id;
    END;
  END IF;

  RETURN v_validation_id;
END;
$function$;

ALTER FUNCTION public.run_validation_v1(uuid) OWNER TO postgres;
