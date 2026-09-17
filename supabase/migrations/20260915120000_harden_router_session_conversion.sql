-- Harden router-session conversion around the signed Pattern C profile identity.
-- Public clients may update only the anonymous intake fields; ownership and case
-- conversion are claimed and completed atomically by the RPC below.

BEGIN;

LOCK TABLE public.router_sessions, public.cases IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.router_sessions rs
    WHERE rs.status = 'IMPORTED'
      AND rs.converted_to_case_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Router-session preflight failed: imported sessions must reference a case';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.router_sessions rs
    LEFT JOIN public.cases c ON c.id = rs.converted_to_case_id
    WHERE rs.converted_to_case_id IS NOT NULL
      AND c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Router-session preflight failed: converted sessions reference missing cases';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.router_sessions rs
    WHERE rs.status IN ('CONVERTED', 'IMPORTED')
      AND rs.converted_to_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Router-session preflight failed: converted sessions must have an owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.router_sessions rs
    JOIN public.cases c ON c.id = rs.converted_to_case_id
    WHERE rs.converted_to_case_id IS NOT NULL
      AND c.user_id IS DISTINCT FROM rs.converted_to_user_id
  ) THEN
    RAISE EXCEPTION 'Router-session preflight failed: session and case owners differ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.router_sessions rs
    WHERE rs.status = 'ACTIVE'
      AND rs.converted_to_case_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Router-session preflight failed: active sessions cannot reference cases';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.convert_router_session_to_case_v1(
  p_session_token text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.router_sessions%ROWTYPE;
  v_owner_id uuid := public.current_app_user_id();
  v_case_id uuid;
  v_claim_type text;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'router_session_unauthorized';
  END IF;

  IF p_session_token IS NULL OR length(btrim(p_session_token)) = 0 OR length(p_session_token) > 512 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'router_session_invalid_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_owner_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'router_session_profile_missing';
  END IF;

  SELECT rs.*
  INTO v_session
  FROM public.router_sessions rs
  WHERE rs.session_token = p_session_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'router_session_not_found';
  END IF;

  IF v_session.converted_to_user_id IS NOT NULL
     AND v_session.converted_to_user_id <> v_owner_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'router_session_owner_mismatch';
  END IF;

  IF v_session.status = 'EXPIRED'
     OR (
       v_session.status IN ('ACTIVE', 'CONVERTED')
       AND v_session.expires_at IS NOT NULL
       AND v_session.expires_at <= pg_catalog.now()
     ) THEN
    IF v_session.status <> 'EXPIRED' THEN
      UPDATE public.router_sessions
      SET status = 'EXPIRED'
      WHERE id = v_session.id;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'router_session_expired';
  END IF;

  IF v_session.status = 'IMPORTED' THEN
    SELECT c.id
    INTO v_case_id
    FROM public.cases c
    WHERE c.id = v_session.converted_to_case_id
      AND c.user_id = v_owner_id;

    IF v_case_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'router_session_inconsistent';
    END IF;

    RETURN v_case_id;
  END IF;

  IF v_session.converted_to_case_id IS NOT NULL THEN
    SELECT c.id
    INTO v_case_id
    FROM public.cases c
    WHERE c.id = v_session.converted_to_case_id
      AND c.user_id = v_owner_id;

    IF v_case_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'router_session_inconsistent';
    END IF;

    UPDATE public.router_sessions
    SET converted_to_user_id = v_owner_id,
        converted_at = COALESCE(converted_at, pg_catalog.now()),
        status = 'IMPORTED'
    WHERE id = v_session.id;

    RETURN v_case_id;
  END IF;

  v_claim_type := CASE lower(
    COALESCE(
      v_session.classification_result ->> 'claimType',
      v_session.classification_result ->> 'claim_type',
      ''
    )
  )
    WHEN 'mis-sold product' THEN 'mis_sold_product'
    WHEN 'mis_sold_product' THEN 'mis_sold_product'
    WHEN 'denied insurance' THEN 'denied_insurance'
    WHEN 'denied_insurance' THEN 'denied_insurance'
    ELSE 'phishing_scam'
  END;

  UPDATE public.router_sessions
  SET converted_to_user_id = v_owner_id,
      converted_at = COALESCE(converted_at, pg_catalog.now()),
      status = 'CONVERTED'
  WHERE id = v_session.id;

  INSERT INTO public.cases (
    user_id,
    claim_type,
    case_summary
  )
  VALUES (
    v_owner_id,
    v_claim_type,
    v_session.dispute_narrative
  )
  RETURNING id INTO v_case_id;

  UPDATE public.router_sessions
  SET status = 'IMPORTED',
      converted_to_case_id = v_case_id
  WHERE id = v_session.id;

  RETURN v_case_id;
END;
$$;

COMMENT ON FUNCTION public.convert_router_session_to_case_v1(text) IS
  'Atomically claims a router session for the signed Pattern C profile and creates or returns its case.';

REVOKE ALL ON FUNCTION public.convert_router_session_to_case_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_router_session_to_case_v1(text) TO authenticated, service_role;

COMMIT;
