-- Validation reconciliation RPCs + nullable skip_validation + lock down run_validation_v1.
-- Approved apply path. No backfill of historical skip_validation (remain NULL = unknown).

-- ---------------------------------------------------------------------------
-- A. skip_validation: true | false | NULL (historical/unknown)
-- ---------------------------------------------------------------------------
ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS skip_validation boolean;

-- If a prior draft added NOT NULL DEFAULT false, normalize to nullable with no default.
ALTER TABLE public.case_extract_runs
  ALTER COLUMN skip_validation DROP NOT NULL;

ALTER TABLE public.case_extract_runs
  ALTER COLUMN skip_validation DROP DEFAULT;

COMMENT ON COLUMN public.case_extract_runs.skip_validation IS
  'true = intentionally skipped validation; false = validation explicitly requested; NULL = historical/unknown (do not auto-repair). New extracts from run_case_extract_v4 must write true or false.';

-- ---------------------------------------------------------------------------
-- B. Audit events (service_role / admin only; no claimant access)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.validation_reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extract_run_id uuid NOT NULL REFERENCES public.case_extract_runs(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  action text NOT NULL,
  validation_run_id uuid REFERENCES public.case_validation_runs(id) ON DELETE SET NULL,
  error_code text,
  error_message text,
  invoked_by text NOT NULL DEFAULT 'service_role',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_validation_reconciliation_events_action CHECK (
    action = ANY (ARRAY[
      'created'::text,
      'already_present'::text,
      'skipped_intentionally'::text,
      'skipped_unknown'::text,
      'would_create'::text,
      'error'::text,
      'race_resolved'::text
    ])
  )
);

CREATE INDEX IF NOT EXISTS validation_reconciliation_events_created_at_idx
  ON public.validation_reconciliation_events (created_at DESC);

CREATE INDEX IF NOT EXISTS validation_reconciliation_events_case_id_idx
  ON public.validation_reconciliation_events (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS validation_reconciliation_events_extract_run_id_idx
  ON public.validation_reconciliation_events (extract_run_id);

ALTER TABLE public.validation_reconciliation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.validation_reconciliation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.validation_reconciliation_events FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.validation_reconciliation_events TO service_role;

COMMENT ON TABLE public.validation_reconciliation_events IS
  'Operational audit for extract→validation reconciliation. Not claimant-facing.';

-- ---------------------------------------------------------------------------
-- C. Harden run_validation_v1 (behaviour unchanged; search_path + grants)
-- Only normal runtime callers: service-role Edge Function + reconcile RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_validation_v1(p_extract_run_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
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

REVOKE ALL ON FUNCTION public.run_validation_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_validation_v1(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_validation_v1(uuid) TO service_role;

COMMENT ON FUNCTION public.run_validation_v1(uuid) IS
  'Rule-based validation insert for an extract. Service-role only. Behaviour unchanged; hardened search_path.';

-- ---------------------------------------------------------------------------
-- D. Single-extract reconcile RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_validation_for_extract(
  p_extract_run_id uuid,
  p_force boolean DEFAULT false,
  p_dry_run boolean DEFAULT false,
  p_invoked_by text DEFAULT 'service_role'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_extract public.case_extract_runs%ROWTYPE;
  v_existing_id uuid;
  v_validation_id uuid;
  v_status text;
  v_action text;
  v_result jsonb;
  v_err_code text;
  v_err_msg text;
BEGIN
  IF p_extract_run_id IS NULL THEN
    RAISE EXCEPTION 'reconcile_validation_for_extract: extract_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_extract
  FROM public.case_extract_runs
  WHERE id = p_extract_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconcile_validation_for_extract: extract_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT cvr.id
  INTO v_existing_id
  FROM public.case_validation_runs cvr
  WHERE cvr.extract_run_id = p_extract_run_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT cvr.status INTO v_status
    FROM public.case_validation_runs cvr
    WHERE cvr.id = v_existing_id;

    v_action := 'already_present';
    v_result := jsonb_build_object(
      'action', v_action,
      'extract_run_id', v_extract.id,
      'case_id', v_extract.case_id,
      'validation_run_id', v_existing_id,
      'validation_status', v_status,
      'error_code', null,
      'error_message', null,
      'dry_run', p_dry_run,
      'skip_validation', to_jsonb(v_extract.skip_validation)
    );

    IF NOT coalesce(p_dry_run, false) THEN
      INSERT INTO public.validation_reconciliation_events (
        extract_run_id, case_id, action, validation_run_id, invoked_by, metadata
      ) VALUES (
        v_extract.id, v_extract.case_id, v_action, v_existing_id, coalesce(p_invoked_by, 'service_role'),
        jsonb_build_object('force', p_force, 'skip_validation', v_extract.skip_validation)
      );
    END IF;

    RETURN v_result;
  END IF;

  -- Intentional skip: true and not forced
  IF v_extract.skip_validation IS TRUE AND NOT coalesce(p_force, false) THEN
    v_action := 'skipped_intentionally';
    v_result := jsonb_build_object(
      'action', v_action,
      'extract_run_id', v_extract.id,
      'case_id', v_extract.case_id,
      'validation_run_id', null,
      'validation_status', null,
      'error_code', null,
      'error_message', null,
      'dry_run', p_dry_run,
      'skip_validation', true
    );

    IF NOT coalesce(p_dry_run, false) THEN
      INSERT INTO public.validation_reconciliation_events (
        extract_run_id, case_id, action, invoked_by, metadata
      ) VALUES (
        v_extract.id, v_extract.case_id, v_action, coalesce(p_invoked_by, 'service_role'),
        jsonb_build_object('force', p_force)
      );
    END IF;

    RETURN v_result;
  END IF;

  -- Historical/unknown: NULL and not forced — require explicit approval/force
  IF v_extract.skip_validation IS NULL AND NOT coalesce(p_force, false) THEN
    v_action := 'skipped_unknown';
    v_result := jsonb_build_object(
      'action', v_action,
      'extract_run_id', v_extract.id,
      'case_id', v_extract.case_id,
      'validation_run_id', null,
      'validation_status', null,
      'error_code', null,
      'error_message', null,
      'dry_run', p_dry_run,
      'skip_validation', null
    );

    IF NOT coalesce(p_dry_run, false) THEN
      INSERT INTO public.validation_reconciliation_events (
        extract_run_id, case_id, action, invoked_by, metadata
      ) VALUES (
        v_extract.id, v_extract.case_id, v_action, coalesce(p_invoked_by, 'service_role'),
        jsonb_build_object('force', p_force)
      );
    END IF;

    RETURN v_result;
  END IF;

  IF coalesce(p_dry_run, false) THEN
    RETURN jsonb_build_object(
      'action', 'would_create',
      'extract_run_id', v_extract.id,
      'case_id', v_extract.case_id,
      'validation_run_id', null,
      'validation_status', null,
      'error_code', null,
      'error_message', null,
      'dry_run', true,
      'skip_validation', to_jsonb(v_extract.skip_validation),
      'force', coalesce(p_force, false)
    );
  END IF;

  BEGIN
    v_validation_id := public.run_validation_v1(p_extract_run_id);

    SELECT cvr.status INTO v_status
    FROM public.case_validation_runs cvr
    WHERE cvr.id = v_validation_id;

    v_action := 'created';
    v_result := jsonb_build_object(
      'action', v_action,
      'extract_run_id', v_extract.id,
      'case_id', v_extract.case_id,
      'validation_run_id', v_validation_id,
      'validation_status', v_status,
      'error_code', null,
      'error_message', null,
      'dry_run', false,
      'skip_validation', to_jsonb(v_extract.skip_validation),
      'force', coalesce(p_force, false)
    );

    INSERT INTO public.validation_reconciliation_events (
      extract_run_id, case_id, action, validation_run_id, invoked_by, metadata
    ) VALUES (
      v_extract.id, v_extract.case_id, v_action, v_validation_id, coalesce(p_invoked_by, 'service_role'),
      jsonb_build_object('force', p_force, 'skip_validation', v_extract.skip_validation)
    );

    RETURN v_result;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT cvr.id, cvr.status
      INTO v_existing_id, v_status
      FROM public.case_validation_runs cvr
      WHERE cvr.extract_run_id = p_extract_run_id
      LIMIT 1;

      v_result := jsonb_build_object(
        'action', 'already_present',
        'extract_run_id', v_extract.id,
        'case_id', v_extract.case_id,
        'validation_run_id', v_existing_id,
        'validation_status', v_status,
        'error_code', null,
        'error_message', null,
        'dry_run', false,
        'race_resolved', true,
        'skip_validation', to_jsonb(v_extract.skip_validation)
      );

      INSERT INTO public.validation_reconciliation_events (
        extract_run_id, case_id, action, validation_run_id, invoked_by, metadata
      ) VALUES (
        v_extract.id, v_extract.case_id, 'race_resolved', v_existing_id, coalesce(p_invoked_by, 'service_role'),
        jsonb_build_object('force', p_force)
      );

      RETURN v_result;
    WHEN OTHERS THEN
      v_err_code := SQLSTATE;
      v_err_msg := left(SQLERRM, 2000);
      v_result := jsonb_build_object(
        'action', 'error',
        'extract_run_id', v_extract.id,
        'case_id', v_extract.case_id,
        'validation_run_id', null,
        'validation_status', null,
        'error_code', v_err_code,
        'error_message', v_err_msg,
        'dry_run', false,
        'skip_validation', to_jsonb(v_extract.skip_validation)
      );

      INSERT INTO public.validation_reconciliation_events (
        extract_run_id, case_id, action, error_code, error_message, invoked_by, metadata
      ) VALUES (
        v_extract.id, v_extract.case_id, 'error', v_err_code, v_err_msg, coalesce(p_invoked_by, 'service_role'),
        jsonb_build_object('force', p_force)
      );

      RETURN v_result;
  END;
END;
$$;

COMMENT ON FUNCTION public.reconcile_validation_for_extract(uuid, boolean, boolean, text) IS
  'Idempotent service-role repair for a single extract. null skip_validation requires p_force=true. Derives case_id from the extract only.';

REVOKE ALL ON FUNCTION public.reconcile_validation_for_extract(uuid, boolean, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_validation_for_extract(uuid, boolean, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_validation_for_extract(uuid, boolean, boolean, text) TO service_role;

-- ---------------------------------------------------------------------------
-- E. Batch reconcile RPC (default dry-run; auto-only skip_validation=false)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_missing_validations(
  p_limit integer DEFAULT 50,
  p_older_than interval DEFAULT interval '5 minutes',
  p_latest_only boolean DEFAULT true,
  p_dry_run boolean DEFAULT true,
  p_force boolean DEFAULT false,
  p_invoked_by text DEFAULT 'service_role'
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  r record;
  v_row jsonb;
BEGIN
  v_limit := LEAST(GREATEST(coalesce(p_limit, 50), 1), 100);

  FOR r IN
    WITH candidates AS (
      SELECT
        e.id AS extract_run_id,
        e.case_id,
        e.created_at,
        e.skip_validation,
        (
          SELECT e2.id
          FROM public.case_extract_runs e2
          WHERE e2.case_id = e.case_id
          ORDER BY e2.created_at DESC
          LIMIT 1
        ) AS latest_extract_id
      FROM public.case_extract_runs e
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.case_validation_runs v
        WHERE v.extract_run_id = e.id
      )
      AND e.created_at < (now() - coalesce(p_older_than, interval '5 minutes'))
      AND (
        coalesce(p_force, false)
        OR e.skip_validation IS FALSE
      )
    )
    SELECT c.extract_run_id
    FROM candidates c
    WHERE (
      NOT coalesce(p_latest_only, true)
      OR c.extract_run_id = c.latest_extract_id
    )
    ORDER BY c.created_at ASC
    LIMIT v_limit
  LOOP
    BEGIN
      v_row := public.reconcile_validation_for_extract(
        r.extract_run_id,
        p_force,
        p_dry_run,
        p_invoked_by
      );
      RETURN NEXT v_row;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN NEXT jsonb_build_object(
          'action', 'error',
          'extract_run_id', r.extract_run_id,
          'case_id', null,
          'validation_run_id', null,
          'error_code', SQLSTATE,
          'error_message', left(SQLERRM, 2000),
          'dry_run', p_dry_run
        );
    END;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.reconcile_missing_validations(integer, interval, boolean, boolean, boolean, text) IS
  'Batch reconciliation. Auto-candidates require skip_validation=false. NULL/true require p_force or individual approve. Default dry_run=true. Hard cap 100.';

REVOKE ALL ON FUNCTION public.reconcile_missing_validations(integer, interval, boolean, boolean, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_missing_validations(integer, interval, boolean, boolean, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_missing_validations(integer, interval, boolean, boolean, boolean, text) TO service_role;
