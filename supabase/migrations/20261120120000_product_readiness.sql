-- Stage 2 buying rules (Elena, 13 Nov 2026; docs/release/stage2-plan.md §3a). The bank pack (S$18) and the FIDReC
-- pack (S$188) are sold on their own: neither needs the other or the free evaluation. People pay first, then confirm
-- the pack's facts, so readiness to buy asks only for a story, plus the FIDReC route question for the FIDReC pack.
--
-- 1) cases.workflow_type: one value for now, the bank-scam dispute pathway.
-- 2) get_case_product_readiness_v1(case, product): ready, or the reason it can't be bought.
-- 3) reserve_checkout_purchase_v1 refuses with that reason; the "FI Guide purchase required" chain check is gone.
-- 4) grant_fidrec_pack_capability_v1 no longer needs, or grants, the bank pack.
-- Earlier migrations are not edited; the two functions are replaced here. No data changes.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS workflow_type text NOT NULL DEFAULT 'bank_scam_dispute'
    CONSTRAINT cases_workflow_type_check CHECK (workflow_type IN ('bank_scam_dispute'));

COMMENT ON COLUMN public.cases.workflow_type IS
  'The dispute pathway: free evaluation, then a bank complaint, then a FIDReC adjudication-ready complaint. Other case types (for example Small Claims Tribunal deposits) get their own value with their own design.';

-- The FIDReC route answers live in case_responses (latest row per key wins):
--   fidrec_route: 'final_reply' | 'no_reply' | 'not_complained'
--   fidrec_final_reply_date, fidrec_complaint_date: ISO dates (YYYY-MM-DD)
-- Final reply no more than 6 months old (F3), or a written complaint with no reply after 4 weeks (F2).
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

CREATE OR REPLACE FUNCTION public.reserve_checkout_purchase_v1(
  p_case_id uuid,
  p_checkout_product_key text,
  p_actor_profile_id uuid
)
RETURNS TABLE (
  case_purchase_id uuid,
  legacy_payment_id uuid,
  owner_user_id uuid,
  amount numeric,
  currency text,
  reservation_disposition text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_product_code text;
  v_amount numeric;
  v_service_type text;
  v_case_purchase_id uuid;
  v_legacy_payment_id uuid;
  v_readiness jsonb;
  v_existing public.case_purchases;
BEGIN
  SELECT c.user_id INTO v_owner
  FROM public.cases AS c
  WHERE c.id = p_case_id;

  IF v_owner IS NULL OR v_owner <> p_actor_profile_id THEN
    RAISE EXCEPTION 'reserve_checkout_purchase_v1: case owner mismatch';
  END IF;

  CASE p_checkout_product_key
    WHEN 'self_serve_report' THEN
      v_product_code := 'self_serve_report';
      v_amount := 18;
      v_service_type := 'standard';
    WHEN 'fidrec_tier2_pack' THEN
      v_product_code := 'escalation_pack';
      v_amount := 188;
      v_service_type := 'fidrec_tier2_pack';
    WHEN 'human_consult_30m' THEN
      RAISE EXCEPTION 'reserve_checkout_purchase_v1: product is policy blocked';
    ELSE
      RAISE EXCEPTION 'reserve_checkout_purchase_v1: invalid product';
  END CASE;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_case_id::text || ':' || v_product_code, 0)
  );

  SELECT cp.* INTO v_existing
  FROM public.case_purchases AS cp
  WHERE cp.case_id = p_case_id
    AND cp.user_id = v_owner
    AND cp.product_code = v_product_code
    AND cp.payment_provider = 'stripe'
    AND cp.payment_status IN ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
  ORDER BY cp.created_at, cp.id
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    SELECT p.id INTO v_legacy_payment_id
    FROM public.payments AS p
    WHERE p.id::text = v_existing.metadata ->> 'legacy_payment_id'
      AND p.case_id = v_existing.case_id
      AND p.user_id = v_existing.user_id
      AND p.amount = v_existing.amount
      AND pg_catalog.upper(p.currency) = pg_catalog.upper(v_existing.currency);

    IF v_existing.payment_status = 'pending' THEN
      IF v_legacy_payment_id IS NULL THEN
        RAISE EXCEPTION 'reserve_checkout_purchase_v1: pending purchase requires provider reconciliation';
      END IF;

      RETURN QUERY
      SELECT v_existing.id,
             v_legacy_payment_id,
             v_existing.user_id,
             v_existing.amount,
             v_existing.currency,
             'resumed_pending'::text;
      RETURN;
    END IF;

    UPDATE public.case_purchases AS cp
    SET metadata = COALESCE(cp.metadata, '{}'::jsonb)
          || pg_catalog.jsonb_build_object(
            'fulfilment_reconciliation_required', true,
            'fulfilment_reconciliation_requested_at', pg_catalog.now()
          ),
        updated_at = pg_catalog.now()
    WHERE cp.id = v_existing.id
    RETURNING * INTO v_existing;

    RETURN QUERY
    SELECT v_existing.id,
           v_legacy_payment_id,
           v_existing.user_id,
           v_existing.amount,
           v_existing.currency,
           'reconcile_established'::text;
    RETURN;
  END IF;

  -- Lock the entitlement row (if any) so a concurrent grant can't slip between the check and the reservation.
  PERFORM 1 FROM public.case_entitlements AS ce WHERE ce.case_id = p_case_id FOR UPDATE;

  v_readiness := public.get_case_product_readiness_v1(p_case_id, p_checkout_product_key);
  IF NOT COALESCE((v_readiness ->> 'ready')::boolean, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'reserve_checkout_purchase_v1: not ready: ' || COALESCE(v_readiness ->> 'reason', 'unknown');
  END IF;

  BEGIN
    INSERT INTO public.case_purchases (
      case_id,
      user_id,
      purchased_by_profile_id,
      product_code,
      payment_provider,
      amount,
      currency,
      payment_status,
      metadata,
      created_by_profile_id,
      updated_by_profile_id
    )
    VALUES (
      p_case_id,
      v_owner,
      p_actor_profile_id,
      v_product_code,
      'stripe',
      v_amount,
      'SGD',
      'pending',
      pg_catalog.jsonb_build_object('checkout_product_key', p_checkout_product_key),
      p_actor_profile_id,
      p_actor_profile_id
    )
    RETURNING id INTO v_case_purchase_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'reserve_checkout_purchase_v1: active purchase requires reconciliation';
  END;

  INSERT INTO public.payments (
    user_id,
    case_id,
    amount,
    currency,
    service_type,
    payment_status
  )
  VALUES (
    v_owner,
    p_case_id,
    v_amount,
    'SGD',
    v_service_type,
    'pending'
  )
  RETURNING id INTO v_legacy_payment_id;

  UPDATE public.case_purchases AS cp
  SET metadata = COALESCE(cp.metadata, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('legacy_payment_id', v_legacy_payment_id),
      updated_at = pg_catalog.now()
  WHERE cp.id = v_case_purchase_id;

  RETURN QUERY
  SELECT v_case_purchase_id,
         v_legacy_payment_id,
         v_owner,
         v_amount,
         'SGD'::text,
         'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_checkout_purchase_v1(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_checkout_purchase_v1(uuid, text, uuid)
  TO service_role;

-- The FIDReC pack grants only itself. allow_self_serve_report is written out explicitly, because
-- get_effective_entitlement derives it as true for the escalation_pack plan when it is absent.
CREATE OR REPLACE FUNCTION public.grant_fidrec_pack_capability_v1(
  p_case_id uuid,
  p_purchase_ref text
)
RETURNS public.case_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entitlement public.case_entitlements;
BEGIN
  INSERT INTO public.case_entitlements (case_id, plan, features, purchased_at, source, purchase_ref, updated_at)
  VALUES (
    p_case_id,
    'escalation_pack',
    '{"allow_escalation_pack": true, "allow_self_serve_report": false}'::jsonb,
    pg_catalog.now(),
    'stripe',
    p_purchase_ref,
    pg_catalog.now()
  )
  ON CONFLICT (case_id) DO UPDATE
  SET plan = 'escalation_pack',
      features = COALESCE(public.case_entitlements.features, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'allow_escalation_pack', true,
          'allow_self_serve_report',
          public.case_entitlements.plan = 'self_serve_report'
            OR COALESCE(public.case_entitlements.features @> '{"allow_self_serve_report": true}'::jsonb, false)
        ),
      purchased_at = COALESCE(public.case_entitlements.purchased_at, EXCLUDED.purchased_at),
      source = 'stripe',
      purchase_ref = COALESCE(public.case_entitlements.purchase_ref, EXCLUDED.purchase_ref),
      updated_at = pg_catalog.now()
  RETURNING * INTO v_entitlement;

  RETURN v_entitlement;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_fidrec_pack_capability_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_fidrec_pack_capability_v1(uuid, text)
  TO service_role;

-- Paying for the bank pack grants it and nothing else. Generation waits until the person confirms the bank facts
-- (run_bank_pack_v1), so payment no longer queues the old post_payment_report_generation worker job, which wrote
-- a report from extract_json before any fact was confirmed.
CREATE OR REPLACE FUNCTION public.grant_self_serve_report_capability_v1(
  p_case_id uuid,
  p_purchase_ref text
)
RETURNS public.case_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entitlement public.case_entitlements;
BEGIN
  INSERT INTO public.case_entitlements (case_id, plan, features, purchased_at, source, purchase_ref, updated_at)
  VALUES (
    p_case_id,
    'self_serve_report',
    '{"allow_self_serve_report": true}'::jsonb,
    pg_catalog.now(),
    'stripe',
    p_purchase_ref,
    pg_catalog.now()
  )
  ON CONFLICT (case_id) DO UPDATE
  SET plan = CASE
        WHEN public.case_entitlements.plan = 'escalation_pack' THEN 'escalation_pack'
        ELSE 'self_serve_report'
      END,
      features = COALESCE(public.case_entitlements.features, '{}'::jsonb)
        || '{"allow_self_serve_report": true}'::jsonb,
      purchased_at = COALESCE(public.case_entitlements.purchased_at, EXCLUDED.purchased_at),
      source = 'stripe',
      purchase_ref = COALESCE(public.case_entitlements.purchase_ref, EXCLUDED.purchase_ref),
      updated_at = pg_catalog.now()
  RETURNING * INTO v_entitlement;

  RETURN v_entitlement;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_self_serve_report_capability_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_self_serve_report_capability_v1(uuid, text)
  TO service_role;

-- run_bank_pack_v1 is called by the case owner (or an editing collaborator), like bright-function.
CREATE OR REPLACE FUNCTION public.consume_edge_request_v1(
  p_request_id uuid,
  p_audience text,
  p_body_sha256 text,
  p_actor_kind text,
  p_actor_id text,
  p_case_id uuid,
  p_document_id uuid,
  p_job_id uuid,
  p_job_locked_at timestamptz,
  p_signed_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_uuid uuid;
BEGIN
  IF p_signed_at IS NULL
     OR pg_catalog.abs(pg_catalog.date_part('epoch', pg_catalog.now() - p_signed_at)) > 300 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'stale_edge_request';
  END IF;
  IF p_body_sha256 IS NULL OR p_body_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_edge_body_hash';
  END IF;

  IF p_actor_kind = 'admin' THEN
    IF p_audience NOT IN ('backfill_embeddings_v1', 'url_catalogue')
       OR p_case_id IS NOT NULL OR p_document_id IS NOT NULL
       OR p_job_id IS NOT NULL OR p_job_locked_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_admin_edge_scope';
    END IF;
  ELSIF p_actor_kind = 'user' THEN
    IF p_audience NOT IN ('run_case_extract_v4', 'bright-function', 'run_bank_pack_v1')
       OR p_case_id IS NULL OR p_job_id IS NOT NULL OR p_job_locked_at IS NOT NULL
       OR p_document_id IS NOT NULL
       OR p_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_user_edge_scope';
    END IF;
    v_actor_uuid := p_actor_id::uuid;
    IF NOT EXISTS (
      SELECT 1
      FROM public.cases AS c
      WHERE c.id = p_case_id
        AND (
          c.user_id = v_actor_uuid
          OR EXISTS (
            SELECT 1
            FROM public.case_collaborators AS cc
            WHERE cc.case_id = c.id
              AND cc.user_id = v_actor_uuid
              AND cc.status = 'active'
              AND cc.can_edit = true
              AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
          )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'edge_case_edit_denied';
    END IF;
  ELSIF p_actor_kind = 'worker' THEN
    IF p_audience NOT IN (
      'evidence_processed_v2',
      'run_case_extract_v4',
      'run_case_decision_v1',
      'run_report_selfserve_v1'
    )
       OR p_case_id IS NULL OR p_job_id IS NULL OR p_job_locked_at IS NULL
       OR p_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_worker_edge_scope';
    END IF;

    -- The lease function is defined later in this migration; dynamic SQL
    -- intentionally defers resolution until this transaction is complete.
    EXECUTE 'SELECT * FROM public.assert_active_worker_lease_v1($1, $2, $3, $4, $5)'
    INTO v_job
    USING
      p_job_id,
      p_case_id,
      p_job_locked_at,
      p_document_id,
      CASE p_audience
        WHEN 'evidence_processed_v2' THEN ARRAY['evidence_document_processing']::text[]
        ELSE ARRAY['post_payment_report_generation']::text[]
      END;

    IF v_job.user_id IS DISTINCT FROM p_actor_id::uuid THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'edge_worker_lease_denied';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_edge_actor';
  END IF;

  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.case_documents AS d
    WHERE d.id = p_document_id AND d.case_id = p_case_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'edge_document_case_mismatch';
  END IF;

  BEGIN
    INSERT INTO public.edge_request_nonces (
      request_id, audience, body_sha256, actor_kind, actor_id,
      case_id, document_id, job_id, job_locked_at, signed_at
    ) VALUES (
      p_request_id, p_audience, p_body_sha256, p_actor_kind, p_actor_id,
      p_case_id, p_document_id, p_job_id, p_job_locked_at, p_signed_at
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'replayed_edge_request';
  END;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_edge_request_v1(
  uuid, text, text, text, text, uuid, uuid, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_edge_request_v1(
  uuid, text, text, text, text, uuid, uuid, uuid, timestamptz, timestamptz
) TO service_role;

-- Reconciliation repairs a paid purchase with the same grants as the webhook: each product grants only itself.
CREATE OR REPLACE FUNCTION public.reconcile_established_case_purchase_fulfilment_v1(
  p_purchase_id uuid,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case_id uuid;
  v_product_code text;
  v_owner_user_id uuid;
  v_legacy_payment_id uuid;
  v_purchase public.case_purchases;
  v_payment public.payments;
  v_legacy_service_type text;
BEGIN
  IF p_purchase_id IS NULL OR p_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: invalid arguments';
  END IF;

  -- Use the same case/product lock as reservation and completion so a retry
  -- cannot create another Checkout reservation while fulfilment is repaired.
  SELECT cp.case_id, cp.product_code
  INTO v_case_id, v_product_code
  FROM public.case_purchases AS cp
  WHERE cp.id = p_purchase_id;

  IF v_case_id IS NULL OR v_product_code IS NULL THEN
    RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: purchase not found';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_case_id::text || ':' || v_product_code, 0)
  );

  SELECT * INTO v_purchase
  FROM public.case_purchases AS cp
  WHERE cp.id = p_purchase_id
  FOR UPDATE;

  SELECT c.user_id INTO v_owner_user_id
  FROM public.cases AS c
  WHERE c.id = v_purchase.case_id
  FOR KEY SHARE;

  IF v_owner_user_id IS NULL OR v_owner_user_id <> p_actor_profile_id
    OR v_purchase.user_id <> v_owner_user_id THEN
    RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: case owner mismatch';
  END IF;

  IF v_purchase.payment_provider <> 'stripe'
    OR v_purchase.payment_status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed')
    OR v_purchase.provider_checkout_session_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(v_purchase.provider_checkout_session_id)) = 0
    OR v_purchase.provider_payment_intent_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(v_purchase.provider_payment_intent_id)) = 0
    OR pg_catalog.upper(v_purchase.currency) <> 'SGD' THEN
    RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: provider-backed reconciliation required';
  END IF;

  IF COALESCE(v_purchase.metadata ->> 'legacy_payment_id', '') !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: legacy payment linkage required';
  END IF;
  v_legacy_payment_id := (v_purchase.metadata ->> 'legacy_payment_id')::uuid;

  SELECT * INTO v_payment
  FROM public.payments AS p
  WHERE p.id = v_legacy_payment_id
  FOR UPDATE;

  IF v_payment.id IS NULL
    OR v_payment.case_id <> v_purchase.case_id
    OR v_payment.user_id <> v_owner_user_id
    OR v_payment.amount <> v_purchase.amount
    OR pg_catalog.upper(v_payment.currency) <> pg_catalog.upper(v_purchase.currency)
    OR v_payment.payment_status NOT IN ('pending', 'failed', 'completed') THEN
    RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: legacy payment mismatch';
  END IF;

  CASE v_purchase.product_code
    WHEN 'self_serve_report' THEN
      IF v_purchase.amount <> 18 OR v_payment.service_type <> 'standard' THEN
        RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: product mismatch';
      END IF;
      v_legacy_service_type := 'standard';
      PERFORM public.grant_self_serve_report_capability_v1(
        v_purchase.case_id,
        v_purchase.provider_checkout_session_id
      );
    WHEN 'escalation_pack' THEN
      IF v_purchase.amount <> 188 OR v_payment.service_type <> 'fidrec_tier2_pack' THEN
        RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: product mismatch';
      END IF;
      v_legacy_service_type := 'fidrec_tier2_pack';
      PERFORM public.grant_fidrec_pack_capability_v1(
        v_purchase.case_id,
        v_purchase.provider_checkout_session_id
      );
    ELSE
      RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: unsupported product';
  END CASE;

  PERFORM public.complete_legacy_payment_v1(
    v_legacy_payment_id,
    v_purchase.case_id,
    v_owner_user_id,
    v_purchase.amount,
    v_purchase.currency,
    v_legacy_service_type,
    v_purchase.provider_payment_intent_id
  );

  UPDATE public.case_purchases AS cp
  SET metadata = COALESCE(cp.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'fulfilment_reconciliation_required', false,
          'fulfilment_reconciled_at', pg_catalog.now()
        ),
      updated_at = pg_catalog.now()
  WHERE cp.id = v_purchase.id;

  RETURN jsonb_build_object(
    'status', 'reconciled',
    'case_purchase_id', v_purchase.id,
    'product_code', v_purchase.product_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_established_case_purchase_fulfilment_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_established_case_purchase_fulfilment_v1(uuid, uuid)
  TO service_role;

-- run_bank_pack_v1 stores the bank pack once per case, tied to the confirmed bank snapshot it was written from.
-- The caller is the verified case owner or an editing collaborator (consume_edge_request_v1); this re-checks the
-- entitlement and that the snapshot is the case's latest bank snapshot.
CREATE OR REPLACE FUNCTION public.commit_bank_pack_v1(
  p_case_id uuid,
  p_fact_snapshot_id uuid,
  p_report_json jsonb
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report public.reports%ROWTYPE;
  v_owner_id uuid;
  v_latest uuid;
BEGIN
  IF p_report_json IS NULL OR pg_catalog.jsonb_typeof(p_report_json) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'bank_pack_invalid_report';
  END IF;

  SELECT c.user_id INTO v_owner_id FROM public.cases AS c WHERE c.id = p_case_id FOR KEY SHARE;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'report_case_not_found';
  END IF;

  IF NOT COALESCE(
    (public.get_effective_entitlement(p_case_id) -> 'features' ->> 'allow_self_serve_report')::boolean, false
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'bank_pack_not_purchased';
  END IF;

  SELECT s.id INTO v_latest
  FROM public.case_fact_snapshots AS s
  WHERE s.case_id = p_case_id AND s.stage = 'bank'
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1;
  IF v_latest IS NULL OR v_latest <> p_fact_snapshot_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'bank_pack_snapshot_not_current';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_case_id::text || ':bank_pack_v1', 0));

  SELECT r.* INTO v_report
  FROM public.reports AS r
  WHERE r.case_id = p_case_id AND r.report_type = 'bank_pack_v1' AND r.report_json IS NOT NULL
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_report.id IS NULL THEN
    INSERT INTO public.reports (user_id, case_id, status, report_json, report_type, fact_snapshot_id)
    VALUES (v_owner_id, p_case_id, 'COMPLETED', p_report_json, 'bank_pack_v1', p_fact_snapshot_id)
    RETURNING * INTO v_report;
  END IF;

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_bank_pack_v1(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_bank_pack_v1(uuid, uuid, jsonb) TO service_role;
