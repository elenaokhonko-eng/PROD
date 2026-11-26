-- CR-2 (Elena, 26 Nov 2026): a pack chosen first is paid for before the story is told. An empty case is created before
-- Stripe; the purchase and the FIDReC route answer attach to it; "Add a new case" fills it afterwards.
--
-- 1) cases.pack_first_at marks such a case. Signed-in users have column-level INSERT and UPDATE grants on cases
--    (20260828120000) that don't include it, so only the server can set it.
-- 2) open_pack_case_v1 (server only): the account's case still waiting for its story, or a new one.
-- 3) fill_pack_case_v1 (signed-in user): puts the story on that case, writing the rows bootstrap_case_v1 writes.
-- 4) get_case_product_readiness_v1: a marked case may buy without a story. Every other case still needs one.
-- Earlier migrations are not edited; the readiness function is replaced here. No data changes.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS pack_first_at timestamptz;

COMMENT ON COLUMN public.cases.pack_first_at IS
  'Set when the case was created empty for a pack bought before the story (open_pack_case_v1). Written only by the server.';

CREATE OR REPLACE FUNCTION public.open_pack_case_v1(
  p_owner_profile_id uuid,
  p_create boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case_id uuid;
BEGIN
  IF p_owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'open_pack_case_v1: owner required';
  END IF;

  -- One waiting case per account, also when two tabs ask at once.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_profile_id::text || ':pack_case', 0)
  );

  SELECT c.id INTO v_case_id
  FROM public.cases AS c
  WHERE c.user_id = p_owner_profile_id
    AND c.pack_first_at IS NOT NULL
    AND COALESCE(pg_catalog.btrim(c.primary_narrative), '') = ''
    AND NOT EXISTS (SELECT 1 FROM public.case_story_revisions AS r WHERE r.case_id = c.id)
  ORDER BY c.pack_first_at, c.id
  LIMIT 1;

  IF v_case_id IS NULL AND p_create THEN
    INSERT INTO public.cases (user_id, claim_type, pack_first_at)
    VALUES (p_owner_profile_id, 'phishing_scam', pg_catalog.now())
    RETURNING id INTO v_case_id;
  END IF;

  RETURN v_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_pack_case_v1(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_pack_case_v1(uuid, boolean) TO service_role;

-- Returns NULL when no case is waiting for a story; the caller then starts a new case with bootstrap_case_v1.
CREATE OR REPLACE FUNCTION public.fill_pack_case_v1(
  p_narrative text,
  p_transcript text,
  p_claim_type text,
  p_idempotency_key_hash text,
  p_request_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := public.current_app_user_id();
  v_case_id uuid;
  v_recorded_request_hash text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'fill_pack_case_v1: authenticated profile claim required';
  END IF;

  IF p_narrative IS NULL OR length(trim(p_narrative)) = 0 OR length(p_narrative) > 20000 THEN
    RAISE EXCEPTION 'fill_pack_case_v1: invalid narrative';
  END IF;

  IF p_transcript IS NOT NULL AND length(p_transcript) > 20000 THEN
    RAISE EXCEPTION 'fill_pack_case_v1: invalid transcript';
  END IF;

  IF p_idempotency_key_hash !~ '^[0-9a-f]{64}$' OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'fill_pack_case_v1: invalid idempotency identity';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':pack_case', 0)
  );

  SELECT i.case_id, i.request_hash
  INTO v_case_id, v_recorded_request_hash
  FROM public.case_bootstrap_idempotency AS i
  WHERE i.owner_profile_id = v_user_id
    AND i.idempotency_key_hash = p_idempotency_key_hash;

  IF v_case_id IS NOT NULL THEN
    IF v_recorded_request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'fill_pack_case_v1: idempotency key reused with different request';
    END IF;
    RETURN v_case_id;
  END IF;

  SELECT c.id INTO v_case_id
  FROM public.cases AS c
  WHERE c.user_id = v_user_id
    AND c.pack_first_at IS NOT NULL
    AND COALESCE(pg_catalog.btrim(c.primary_narrative), '') = ''
    AND NOT EXISTS (SELECT 1 FROM public.case_story_revisions AS r WHERE r.case_id = c.id)
  ORDER BY c.pack_first_at, c.id
  LIMIT 1
  FOR UPDATE;

  IF v_case_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- cases_record_story_revision writes revision 1; it is the case's first story, as at onboarding.
  UPDATE public.cases AS c
  SET primary_narrative = p_narrative,
      claim_type = COALESCE(NULLIF(trim(p_claim_type), ''), 'phishing_scam'),
      updated_at = pg_catalog.now()
  WHERE c.id = v_case_id;

  UPDATE public.case_story_revisions AS r
  SET origin = 'onboarding'
  WHERE r.case_id = v_case_id AND r.revision = 1;

  INSERT INTO public.case_intake (case_id, intake_type, narrative_text, source)
  VALUES (v_case_id, 'initial', p_narrative, CASE WHEN p_transcript IS NULL THEN 'text' ELSE 'voice' END);

  INSERT INTO public.case_bootstrap_idempotency (owner_profile_id, idempotency_key_hash, request_hash, case_id)
  VALUES (v_user_id, p_idempotency_key_hash, p_request_hash, v_case_id);

  RETURN v_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_pack_case_v1(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fill_pack_case_v1(text, text, text, text, text) TO authenticated;

-- As 20261120120000, with one change: a case created for a pack (pack_first_at) may buy before it has a story.
CREATE OR REPLACE FUNCTION public.get_case_product_readiness_v1(
  p_case_id uuid,
  p_checkout_product_key text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (pg_catalog.now() AT TIME ZONE 'Asia/Singapore')::date;
  v_has_story boolean;
  v_entitlement public.case_entitlements;
  v_route text;
  v_date_text text;
  v_date date;
BEGIN
  IF p_checkout_product_key NOT IN ('self_serve_report', 'fidrec_tier2_pack') THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'product_not_available');
  END IF;

  SELECT COALESCE(pg_catalog.btrim(c.primary_narrative), '') <> ''
      OR EXISTS (SELECT 1 FROM public.case_story_revisions AS r WHERE r.case_id = c.id)
      OR c.pack_first_at IS NOT NULL
  INTO v_has_story
  FROM public.cases AS c
  WHERE c.id = p_case_id;

  IF NOT COALESCE(v_has_story, false) THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'story_missing');
  END IF;

  SELECT * INTO v_entitlement FROM public.case_entitlements AS ce WHERE ce.case_id = p_case_id;

  IF p_checkout_product_key = 'self_serve_report' THEN
    IF COALESCE(v_entitlement.plan = 'self_serve_report', false)
      OR COALESCE(v_entitlement.features @> '{"allow_self_serve_report": true}'::jsonb, false) THEN
      RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'already_purchased');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ready', true, 'reason', null);
  END IF;

  IF COALESCE(v_entitlement.plan = 'escalation_pack', false)
    OR COALESCE(v_entitlement.features @> '{"allow_escalation_pack": true}'::jsonb, false) THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'already_purchased');
  END IF;

  SELECT cr.response_value INTO v_route
  FROM public.case_responses AS cr
  WHERE cr.case_id = p_case_id AND cr.question_key = 'fidrec_route'
  ORDER BY cr.created_at DESC NULLS LAST, cr.id DESC
  LIMIT 1;

  IF v_route NOT IN ('final_reply', 'no_reply') OR v_route IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'complaint_not_raised');
  END IF;

  SELECT cr.response_value INTO v_date_text
  FROM public.case_responses AS cr
  WHERE cr.case_id = p_case_id
    AND cr.question_key = CASE v_route WHEN 'final_reply' THEN 'fidrec_final_reply_date' ELSE 'fidrec_complaint_date' END
  ORDER BY cr.created_at DESC NULLS LAST, cr.id DESC
  LIMIT 1;

  IF v_date_text ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      v_date := v_date_text::date;
    EXCEPTION WHEN others THEN
      v_date := NULL;
    END;
  END IF;

  -- A missing, unreadable or future date can't show the route is open.
  IF v_date IS NULL OR v_date > v_today THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'complaint_not_raised');
  END IF;

  IF v_route = 'final_reply' THEN
    IF v_date + INTERVAL '6 months' < v_today THEN
      RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'fidrec_window_expired');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ready', true, 'reason', null);
  END IF;

  IF v_date + 28 > v_today THEN
    RETURN pg_catalog.jsonb_build_object(
      'ready', false, 'reason', 'fidrec_too_early', 'opens_on', pg_catalog.to_char(v_date + 28, 'YYYY-MM-DD')
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('ready', true, 'reason', null);
END;
$$;

REVOKE ALL ON FUNCTION public.get_case_product_readiness_v1(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_case_product_readiness_v1(uuid, text) TO service_role;
