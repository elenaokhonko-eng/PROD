-- get_case_eligibility: audit + gating helper for self-serve report flows.
--
-- Product architecture (current):
-- - run_report_selfserve_v1 is downstream of case_decision_runs (same lineage: latest decision → its extract_run_id → validation on that extract).
-- - run_case_decision_v1 is NOT entitlement-gated via this RPC.
--
-- Enforced consumer today: run_report_selfserve_v1 uses eligible_actions.run_report_selfserve only.
-- resolved_ids matches that same lineage so the gate and report execution cannot drift.

CREATE OR REPLACE FUNCTION public.get_case_eligibility(p_case_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent jsonb;
  v_plan text;
  v_feat jsonb;
  v_decision_id uuid;
  v_decision_extract_id uuid;
  v_has_decision boolean := false;
  v_extract_id uuid;
  v_extract_json jsonb;
  v_has_extract_any boolean := false;
  v_extract_usable boolean := false;
  v_val_id uuid := NULL;
  v_val_status text;
  v_val_is_valid boolean;
  v_has_validation boolean := false;
  v_validation_blocking boolean := false;
  v_has_docs boolean := false;
  v_reasons jsonb := '[]'::jsonb;
  f_self boolean;
  f_dec boolean;
  f_esc boolean;
  e_report boolean := false;
  e_dec boolean := false;
  e_esc boolean := false;
  v_global_extract_id uuid;
  v_global_extract_json jsonb;
  v_gval_id uuid;
  v_gval_status text;
  v_gval_is_valid boolean;
  v_g_has_validation boolean := false;
  v_g_validation_blocking boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = p_case_id) THEN
    RETURN jsonb_build_object(
      'case_id', to_jsonb(p_case_id::text),
      'plan', null,
      'features', jsonb_build_object(
        'self_serve_report', false,
        'case_decision', false,
        'escalation_pack', false
      ),
      'prerequisites', jsonb_build_object(
        'has_extract_run', false,
        'has_validation_run', false,
        'has_processed_documents', false,
        'has_decision_run', false
      ),
      'eligible_actions', jsonb_build_object(
        'run_report_selfserve', false,
        'run_case_decision', false,
        'run_escalation_pack', false
      ),
      'reasons', jsonb_build_array('case_not_found'),
      'resolved_ids', jsonb_build_object(
        'latest_extract_run_id', 'null'::jsonb,
        'latest_validation_run_id', 'null'::jsonb,
        'latest_decision_run_id', 'null'::jsonb
      )
    );
  END IF;

  v_ent := public.get_effective_entitlement(p_case_id);
  v_plan := coalesce(v_ent->>'plan', 'free');
  v_feat := coalesce(v_ent->'features', '{}'::jsonb);

  f_self := coalesce((v_feat->>'allow_self_serve_report')::boolean, false);
  f_dec := coalesce((v_feat->>'allow_decisioning')::boolean, false);
  f_esc := coalesce((v_feat->>'allow_escalation_pack')::boolean, false);

  SELECT EXISTS (SELECT 1 FROM public.case_extract_runs cer WHERE cer.case_id = p_case_id LIMIT 1)
  INTO v_has_extract_any;

  -- Latest decision for case (same ordering as run_report_selfserve_v1: created_at desc).
  SELECT dr.id, dr.extract_run_id
  INTO v_decision_id, v_decision_extract_id
  FROM public.case_decision_runs dr
  WHERE dr.case_id = p_case_id
  ORDER BY dr.created_at DESC
  LIMIT 1;

  v_has_decision := (v_decision_id IS NOT NULL);

  -- Self-serve lineage: extract + validation anchored on the latest decision's extract_run_id.
  IF v_has_decision AND v_decision_extract_id IS NOT NULL THEN
    v_extract_id := v_decision_extract_id;
    SELECT cer.extract_json
    INTO v_extract_json
    FROM public.case_extract_runs cer
    WHERE cer.id = v_decision_extract_id
      AND cer.case_id = p_case_id;

    v_extract_usable := FOUND
      AND v_extract_json IS NOT NULL
      AND (v_extract_json <> '{}'::jsonb);

    SELECT cvr.id, cvr.status, cvr.is_valid
    INTO v_val_id, v_val_status, v_val_is_valid
    FROM public.case_validation_runs cvr
    WHERE cvr.extract_run_id = v_decision_extract_id
    ORDER BY cvr.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_has_validation := true;
      v_validation_blocking := (
        v_val_status IN ('invalid', 'error')
        OR coalesce(v_val_is_valid, false) = false
      );
    ELSE
      v_has_validation := false;
      v_validation_blocking := false;
    END IF;
  ELSE
    v_extract_id := NULL;
    v_extract_json := NULL;
    v_extract_usable := false;
    v_val_id := NULL;
    v_val_status := NULL;
    v_val_is_valid := NULL;
    v_has_validation := false;
    v_validation_blocking := false;
  END IF;

  -- Global latest extract + validation (for e_dec / e_esc readiness when no self-serve lineage or as fallback).
  SELECT cer.id, cer.extract_json
  INTO v_global_extract_id, v_global_extract_json
  FROM public.case_extract_runs cer
  WHERE cer.case_id = p_case_id
  ORDER BY cer.created_at DESC
  LIMIT 1;

  IF FOUND AND v_global_extract_id IS NOT NULL THEN
    SELECT cvr.id, cvr.status, cvr.is_valid
    INTO v_gval_id, v_gval_status, v_gval_is_valid
    FROM public.case_validation_runs cvr
    WHERE cvr.extract_run_id = v_global_extract_id
    ORDER BY cvr.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_g_has_validation := true;
      v_g_validation_blocking := (
        v_gval_status IN ('invalid', 'error')
        OR coalesce(v_gval_is_valid, false) = false
      );
    END IF;
  END IF;

  SELECT
    EXISTS (SELECT 1 FROM public.case_document_extractions e WHERE e.case_id = p_case_id LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.case_documents d WHERE d.case_id = p_case_id LIMIT 1)
  INTO v_has_docs;

  e_report := f_self
    AND v_has_decision
    AND (v_decision_extract_id IS NOT NULL)
    AND v_extract_usable
    AND (NOT v_validation_blocking);

  e_dec := (
    v_global_extract_id IS NOT NULL
    AND v_global_extract_json IS NOT NULL
    AND (v_global_extract_json <> '{}'::jsonb)
    AND (NOT v_g_validation_blocking)
    AND v_g_has_validation
    AND coalesce(v_gval_is_valid, false)
  );

  e_esc := f_esc
    AND (v_global_extract_id IS NOT NULL)
    AND v_global_extract_json IS NOT NULL
    AND (v_global_extract_json <> '{}'::jsonb)
    AND (NOT v_g_validation_blocking)
    AND v_g_has_validation
    AND coalesce(v_gval_is_valid, false);

  IF NOT f_self THEN
    v_reasons := v_reasons || jsonb_build_array('not_entitled_self_serve_report');
  END IF;
  IF NOT f_esc THEN
    v_reasons := v_reasons || jsonb_build_array('not_entitled_escalation_pack');
  END IF;
  IF NOT v_has_decision THEN
    v_reasons := v_reasons || jsonb_build_array('missing_decision_run');
  END IF;
  IF v_has_decision AND v_decision_extract_id IS NULL THEN
    v_reasons := v_reasons || jsonb_build_array('decision_missing_extract_run_id');
  END IF;
  IF v_has_decision AND v_decision_extract_id IS NOT NULL AND NOT v_extract_usable THEN
    v_reasons := v_reasons || jsonb_build_array('missing_usable_extract');
  END IF;
  IF v_validation_blocking THEN
    v_reasons := v_reasons || jsonb_build_array('validation_failed');
  END IF;
  IF v_has_decision AND v_decision_extract_id IS NOT NULL AND NOT v_has_validation THEN
    v_reasons := v_reasons || jsonb_build_array('missing_validation_run');
  END IF;

  RETURN jsonb_build_object(
    'case_id', to_jsonb(p_case_id::text),
    'plan', to_jsonb(v_plan),
    'features', jsonb_build_object(
      'self_serve_report', f_self,
      'case_decision', f_dec,
      'escalation_pack', f_esc
    ),
    'prerequisites', jsonb_build_object(
      'has_extract_run', v_has_extract_any,
      'has_validation_run', CASE WHEN v_has_decision AND v_decision_extract_id IS NOT NULL THEN v_has_validation ELSE v_g_has_validation END,
      'has_processed_documents', v_has_docs,
      'has_decision_run', v_has_decision
    ),
    'eligible_actions', jsonb_build_object(
      'run_report_selfserve', e_report,
      'run_case_decision', e_dec,
      'run_escalation_pack', e_esc
    ),
    'reasons', v_reasons,
    'resolved_ids', jsonb_build_object(
      'latest_decision_run_id', CASE WHEN v_decision_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_decision_id::text) END,
      'latest_extract_run_id', CASE WHEN v_decision_extract_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_decision_extract_id::text) END,
      'latest_validation_run_id', CASE WHEN v_val_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_val_id::text) END
    )
  );
END;
$$;

ALTER FUNCTION public.get_case_eligibility(p_case_id uuid) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.get_case_eligibility(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_case_eligibility(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_case_eligibility(uuid) TO service_role;
