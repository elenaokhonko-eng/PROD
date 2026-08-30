-- Release hardening: atomic case bootstrap, read-only case documents, and
-- monotonic one-time purchase capabilities.

-- Authenticated clients read case documents. Mutations are owned by the
-- authorized server registration/processing routes.
DROP POLICY IF EXISTS case_documents_insert_authorized ON public.case_documents;
DROP POLICY IF EXISTS case_documents_update_authorized ON public.case_documents;
DROP POLICY IF EXISTS case_documents_delete_authorized ON public.case_documents;
REVOKE ALL PRIVILEGES ON TABLE public.case_documents FROM anon, authenticated;
GRANT SELECT ON TABLE public.case_documents TO authenticated;

CREATE TABLE IF NOT EXISTS public.case_bootstrap_idempotency (
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key_hash text NOT NULL CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_profile_id, idempotency_key_hash)
);

ALTER TABLE public.case_bootstrap_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.case_bootstrap_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.case_bootstrap_idempotency TO service_role;

CREATE OR REPLACE FUNCTION public.bootstrap_case_v1(
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
  v_case_id uuid := pg_catalog.gen_random_uuid();
  v_recorded_case_id uuid;
  v_recorded_request_hash text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_case_v1: authenticated profile claim required';
  END IF;

  IF p_narrative IS NULL OR length(trim(p_narrative)) = 0 OR length(p_narrative) > 20000 THEN
    RAISE EXCEPTION 'bootstrap_case_v1: invalid narrative';
  END IF;

  IF p_transcript IS NOT NULL AND length(p_transcript) > 20000 THEN
    RAISE EXCEPTION 'bootstrap_case_v1: invalid transcript';
  END IF;

  IF p_idempotency_key_hash !~ '^[0-9a-f]{64}$' OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'bootstrap_case_v1: invalid idempotency identity';
  END IF;

  INSERT INTO public.cases (id, claim_type, user_id, primary_narrative)
  VALUES (
    v_case_id,
    COALESCE(NULLIF(trim(p_claim_type), ''), 'phishing_scam'),
    v_user_id,
    p_narrative
  );

  INSERT INTO public.case_intake (case_id, intake_type, narrative_text, source)
  VALUES (v_case_id, 'initial', p_narrative, CASE WHEN p_transcript IS NULL THEN 'text' ELSE 'voice' END);

  INSERT INTO public.case_bootstrap_idempotency (
    owner_profile_id,
    idempotency_key_hash,
    request_hash,
    case_id
  ) VALUES (
    v_user_id,
    p_idempotency_key_hash,
    p_request_hash,
    v_case_id
  )
  ON CONFLICT (owner_profile_id, idempotency_key_hash) DO NOTHING
  RETURNING case_id INTO v_recorded_case_id;

  IF v_recorded_case_id IS NULL THEN
    DELETE FROM public.cases WHERE id = v_case_id;
    SELECT i.case_id, i.request_hash
    INTO v_recorded_case_id, v_recorded_request_hash
    FROM public.case_bootstrap_idempotency AS i
    WHERE i.owner_profile_id = v_user_id
      AND i.idempotency_key_hash = p_idempotency_key_hash;

    IF v_recorded_case_id IS NULL OR v_recorded_request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'bootstrap_case_v1: idempotency key reused with different request';
    END IF;
  END IF;

  RETURN v_recorded_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_case_v1(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_case_v1(text, text, text, text, text) TO authenticated;

DO $preflight$
DECLARE
  v_conflict_count bigint;
  v_conflict_keys text;
BEGIN
  WITH conflicts AS (
    SELECT cp.case_id, cp.product_code, count(*) AS row_count
    FROM public.case_purchases AS cp
    WHERE cp.payment_provider = 'stripe'
      AND cp.payment_status IN ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
    GROUP BY cp.case_id, cp.product_code
    HAVING count(*) > 1
  ), sampled AS (
    SELECT conflicts.*, count(*) OVER () AS conflict_count
    FROM conflicts
    ORDER BY case_id, product_code
    LIMIT 20
  )
  SELECT COALESCE(max(conflict_count), 0),
         string_agg(format('%s/%s (%s rows)', case_id, product_code, row_count), ', ')
  INTO v_conflict_count, v_conflict_keys
  FROM sampled;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'release preflight: %s case/product key(s) have duplicate pending or established Stripe purchases',
        v_conflict_count
      ),
      DETAIL = 'case/product keys (first 20): ' || v_conflict_keys,
      HINT = 'Reconcile each key against Stripe, retain the canonical purchase, and explicitly resolve the others before reapplying. This migration does not cancel or delete provider-backed rows.';
  END IF;

  WITH conflicts AS (
    SELECT string_agg(cp.id::text, ',' ORDER BY cp.id) AS row_ids
    FROM public.case_purchases AS cp
    WHERE cp.provider_payment_intent_id IS NOT NULL
    GROUP BY cp.payment_provider, cp.provider_payment_intent_id
    HAVING count(*) > 1
  ), sampled AS (
    SELECT conflicts.*, count(*) OVER () AS conflict_count
    FROM conflicts
    ORDER BY row_ids
    LIMIT 20
  )
  SELECT COALESCE(max(conflict_count), 0), string_agg(row_ids, '; ')
  INTO v_conflict_count, v_conflict_keys
  FROM sampled;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'release preflight: %s duplicate case-purchase payment-intent identity group(s)',
        v_conflict_count
      ),
      DETAIL = 'conflicting case_purchase row ids (first 20 groups): ' || v_conflict_keys,
      HINT = 'Compare these rows with Stripe before choosing a canonical row. Do not delete or rewrite provider identities without provider-backed reconciliation.';
  END IF;

  WITH conflicts AS (
    SELECT string_agg(cp.id::text, ',' ORDER BY cp.id) AS row_ids
    FROM public.case_purchases AS cp
    WHERE cp.provider_checkout_session_id IS NOT NULL
    GROUP BY cp.payment_provider, cp.provider_checkout_session_id
    HAVING count(*) > 1
  ), sampled AS (
    SELECT conflicts.*, count(*) OVER () AS conflict_count
    FROM conflicts
    ORDER BY row_ids
    LIMIT 20
  )
  SELECT COALESCE(max(conflict_count), 0), string_agg(row_ids, '; ')
  INTO v_conflict_count, v_conflict_keys
  FROM sampled;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format('release preflight: %s duplicate Stripe Checkout identity group(s)', v_conflict_count),
      DETAIL = 'conflicting case_purchase row ids (first 20 groups): ' || v_conflict_keys,
      HINT = 'Reconcile the Checkout Sessions in Stripe before reapplying; no historical row is modified automatically.';
  END IF;

  WITH conflicts AS (
    SELECT string_agg(cp.id::text, ',' ORDER BY cp.id) AS row_ids
    FROM public.case_purchases AS cp
    WHERE cp.fulfilment_provider_event_id IS NOT NULL
    GROUP BY cp.payment_provider, cp.fulfilment_provider_event_id
    HAVING count(*) > 1
  ), sampled AS (
    SELECT conflicts.*, count(*) OVER () AS conflict_count
    FROM conflicts
    ORDER BY row_ids
    LIMIT 20
  )
  SELECT COALESCE(max(conflict_count), 0), string_agg(row_ids, '; ')
  INTO v_conflict_count, v_conflict_keys
  FROM sampled;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format('release preflight: %s duplicate Stripe fulfilment-event identity group(s)', v_conflict_count),
      DETAIL = 'conflicting case_purchase row ids (first 20 groups): ' || v_conflict_keys,
      HINT = 'Reconcile the signed Stripe events and purchases before reapplying; no historical row is modified automatically.';
  END IF;

  WITH conflicts AS (
    SELECT string_agg(p.id::text, ',' ORDER BY p.id) AS row_ids
    FROM public.payments AS p
    WHERE p.stripe_payment_intent_id IS NOT NULL
    GROUP BY p.stripe_payment_intent_id
    HAVING count(*) > 1
  ), sampled AS (
    SELECT conflicts.*, count(*) OVER () AS conflict_count
    FROM conflicts
    ORDER BY row_ids
    LIMIT 20
  )
  SELECT COALESCE(max(conflict_count), 0), string_agg(row_ids, '; ')
  INTO v_conflict_count, v_conflict_keys
  FROM sampled;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format('release preflight: %s duplicate legacy-payment Stripe identity group(s)', v_conflict_count),
      DETAIL = 'conflicting payment row ids (first 20 groups): ' || v_conflict_keys,
      HINT = 'Compare the legacy payment rows with Stripe and their case purchases before reapplying.';
  END IF;

  WITH conflicts AS (
    SELECT cp.id
    FROM public.case_purchases AS cp
    WHERE cp.payment_provider = 'stripe'
      AND cp.payment_status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM public.payments AS p
        WHERE p.id::text = cp.metadata ->> 'legacy_payment_id'
          AND p.case_id = cp.case_id
          AND p.user_id = cp.user_id
          AND p.amount = cp.amount
          AND pg_catalog.upper(p.currency) = pg_catalog.upper(cp.currency)
      )
  ), sampled AS (
    SELECT conflicts.*, count(*) OVER () AS conflict_count
    FROM conflicts
    ORDER BY id
    LIMIT 20
  )
  SELECT COALESCE(max(conflict_count), 0), string_agg(id::text, ', ')
  INTO v_conflict_count, v_conflict_keys
  FROM sampled;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('release preflight: %s pending Stripe purchase(s) lack a matching resumable legacy payment', v_conflict_count),
      DETAIL = 'case_purchase row ids (first 20): ' || v_conflict_keys,
      HINT = 'Reconcile each pending Checkout Session and legacy payment against Stripe before reapplying.';
  END IF;
END;
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS case_purchases_one_pending_checkout_idx
  ON public.case_purchases (case_id, product_code)
  WHERE payment_provider = 'stripe' AND payment_status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS case_purchases_one_active_product_idx
  ON public.case_purchases (case_id, product_code)
  WHERE payment_provider = 'stripe'
    AND payment_status IN ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed');

CREATE UNIQUE INDEX IF NOT EXISTS case_purchases_provider_payment_intent_unique_idx
  ON public.case_purchases (payment_provider, provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_unique_idx
  ON public.payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

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
  v_entitlement public.case_entitlements;
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

  SELECT * INTO v_entitlement
  FROM public.case_entitlements AS ce
  WHERE ce.case_id = p_case_id
  FOR UPDATE;

  IF p_checkout_product_key = 'self_serve_report'
    AND (
      COALESCE(v_entitlement.plan IN ('self_serve_report', 'escalation_pack'), false)
      OR COALESCE(
        v_entitlement.features @> pg_catalog.jsonb_build_object('allow_self_serve_report', true),
        false
      )
    ) THEN
    RAISE EXCEPTION 'reserve_checkout_purchase_v1: report capability already purchased';
  END IF;

  IF p_checkout_product_key = 'fidrec_tier2_pack'
    AND NOT (
      COALESCE(v_entitlement.plan IN ('self_serve_report', 'escalation_pack'), false)
      OR COALESCE(
        v_entitlement.features @> pg_catalog.jsonb_build_object('allow_self_serve_report', true),
        false
      )
    ) THEN
    RAISE EXCEPTION 'reserve_checkout_purchase_v1: FI Guide purchase required';
  END IF;

  IF p_checkout_product_key = 'fidrec_tier2_pack'
    AND (
      COALESCE(v_entitlement.plan = 'escalation_pack', false)
      OR COALESCE(
        v_entitlement.features @> pg_catalog.jsonb_build_object('allow_escalation_pack', true),
        false
      )
    ) THEN
    RAISE EXCEPTION 'reserve_checkout_purchase_v1: FIDReC Pack already purchased';
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

CREATE OR REPLACE FUNCTION public.attach_checkout_session_v1(
  p_purchase_id uuid,
  p_legacy_payment_id uuid,
  p_actor_profile_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text DEFAULT NULL
)
RETURNS public.case_purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purchase public.case_purchases;
  v_payment public.payments;
BEGIN
  IF p_checkout_session_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'attach_checkout_session_v1: checkout session required';
  END IF;

  SELECT * INTO v_purchase
  FROM public.case_purchases AS cp
  WHERE cp.id = p_purchase_id
  FOR UPDATE;

  IF v_purchase.id IS NULL
    OR v_purchase.user_id <> p_actor_profile_id
    OR v_purchase.payment_provider <> 'stripe'
    OR v_purchase.payment_status NOT IN ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
    OR v_purchase.metadata ->> 'legacy_payment_id' <> p_legacy_payment_id::text
    OR (
      v_purchase.provider_checkout_session_id IS NOT NULL
      AND v_purchase.provider_checkout_session_id <> p_checkout_session_id
    )
    OR (
      p_payment_intent_id IS NOT NULL
      AND v_purchase.provider_payment_intent_id IS NOT NULL
      AND v_purchase.provider_payment_intent_id <> p_payment_intent_id
    ) THEN
    RAISE EXCEPTION 'attach_checkout_session_v1: canonical reservation mismatch';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments AS p
  WHERE p.id = p_legacy_payment_id
  FOR UPDATE;

  IF v_payment.id IS NULL
    OR v_payment.case_id <> v_purchase.case_id
    OR v_payment.user_id <> v_purchase.user_id
    OR v_payment.amount <> v_purchase.amount
    OR pg_catalog.upper(v_payment.currency) <> pg_catalog.upper(v_purchase.currency)
    OR v_payment.payment_status NOT IN ('pending', 'completed')
    OR (
      p_payment_intent_id IS NOT NULL
      AND v_payment.stripe_payment_intent_id IS NOT NULL
      AND v_payment.stripe_payment_intent_id <> p_payment_intent_id
    ) THEN
    RAISE EXCEPTION 'attach_checkout_session_v1: legacy payment mismatch';
  END IF;

  UPDATE public.case_purchases AS cp
  SET provider_checkout_session_id = COALESCE(cp.provider_checkout_session_id, p_checkout_session_id),
      provider_payment_intent_id = COALESCE(cp.provider_payment_intent_id, p_payment_intent_id),
      updated_by_profile_id = p_actor_profile_id,
      updated_at = pg_catalog.now()
  WHERE cp.id = p_purchase_id
  RETURNING * INTO v_purchase;

  UPDATE public.payments AS p
  SET stripe_payment_intent_id = COALESCE(p.stripe_payment_intent_id, p_payment_intent_id)
  WHERE p.id = p_legacy_payment_id;

  RETURN v_purchase;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_checkout_session_v1(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_checkout_session_v1(uuid, uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_checkout_reservation_v1(
  p_purchase_id uuid,
  p_legacy_payment_id uuid,
  p_checkout_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purchase public.case_purchases;
  v_payment public.payments;
BEGIN
  IF p_checkout_session_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'cancel_checkout_reservation_v1: checkout session required';
  END IF;

  SELECT * INTO v_purchase
  FROM public.case_purchases AS cp
  WHERE cp.id = p_purchase_id
  FOR UPDATE;

  IF v_purchase.id IS NULL
    OR v_purchase.payment_provider <> 'stripe'
    OR v_purchase.metadata ->> 'legacy_payment_id' <> p_legacy_payment_id::text
    OR (
      v_purchase.provider_checkout_session_id IS NOT NULL
      AND v_purchase.provider_checkout_session_id <> p_checkout_session_id
    ) THEN
    RAISE EXCEPTION 'cancel_checkout_reservation_v1: canonical reservation mismatch';
  END IF;

  IF v_purchase.payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed') THEN
    RETURN false;
  END IF;
  IF v_purchase.payment_status NOT IN ('pending', 'cancelled') THEN
    RAISE EXCEPTION 'cancel_checkout_reservation_v1: invalid purchase lifecycle';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments AS p
  WHERE p.id = p_legacy_payment_id
  FOR UPDATE;

  IF v_payment.id IS NULL
    OR v_payment.case_id <> v_purchase.case_id
    OR v_payment.user_id <> v_purchase.user_id
    OR v_payment.amount <> v_purchase.amount
    OR pg_catalog.upper(v_payment.currency) <> pg_catalog.upper(v_purchase.currency)
    OR v_payment.payment_status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'cancel_checkout_reservation_v1: legacy payment mismatch';
  END IF;

  UPDATE public.payments AS p
  SET payment_status = 'failed'
  WHERE p.id = p_legacy_payment_id
    AND p.payment_status = 'pending';

  UPDATE public.case_purchases AS cp
  SET payment_status = 'cancelled',
      cancelled_at = COALESCE(cp.cancelled_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  WHERE cp.id = p_purchase_id
    AND cp.payment_status = 'pending';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_checkout_reservation_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_checkout_reservation_v1(uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_case_purchase_paid_v1(
  p_purchase_id uuid,
  p_case_id uuid,
  p_product_code text,
  p_amount numeric,
  p_currency text,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_fulfilment_event_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.case_purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purchase public.case_purchases;
BEGIN
  IF p_payment_intent_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_payment_intent_id)) = 0
    OR p_fulfilment_event_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_fulfilment_event_id)) = 0
    OR p_checkout_session_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'mark_case_purchase_paid_v1: provider identities required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_case_id::text || ':' || p_product_code, 0)
  );

  UPDATE public.case_purchases AS cp
  SET provider_checkout_session_id = COALESCE(cp.provider_checkout_session_id, p_checkout_session_id),
      provider_payment_intent_id = COALESCE(cp.provider_payment_intent_id, p_payment_intent_id),
      fulfilment_provider_event_id = COALESCE(cp.fulfilment_provider_event_id, p_fulfilment_event_id),
      payment_status = CASE
        WHEN cp.payment_status IN ('refunded', 'partially_refunded', 'disputed')
          THEN cp.payment_status
        ELSE 'paid'
      END,
      paid_at = COALESCE(cp.paid_at, pg_catalog.now()),
      metadata = COALESCE(cp.metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      updated_at = pg_catalog.now()
  WHERE cp.id = p_purchase_id
    AND cp.case_id = p_case_id
    AND cp.product_code = p_product_code
    AND cp.amount = p_amount
    AND pg_catalog.upper(cp.currency) = pg_catalog.upper(p_currency)
    AND cp.payment_provider = 'stripe'
    AND cp.payment_status IN ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
    AND (
      cp.provider_checkout_session_id IS NULL
      OR cp.provider_checkout_session_id = p_checkout_session_id
    )
    AND (cp.provider_payment_intent_id IS NULL OR cp.provider_payment_intent_id = p_payment_intent_id)
    AND EXISTS (
      SELECT 1
      FROM public.cases AS c
      WHERE c.id = cp.case_id
        AND c.user_id = cp.user_id
    )
  RETURNING * INTO v_purchase;

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'mark_case_purchase_paid_v1: canonical purchase mismatch';
  END IF;

  RETURN v_purchase;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_case_purchase_paid_v1(
  uuid, uuid, text, numeric, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_case_purchase_paid_v1(
  uuid, uuid, text, numeric, text, text, text, text, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_legacy_payment_v1(
  p_payment_id uuid,
  p_case_id uuid,
  p_owner_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_service_type text,
  p_payment_intent_id text
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.payments;
  v_purchase public.case_purchases;
BEGIN
  IF p_payment_intent_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'complete_legacy_payment_v1: payment intent required';
  END IF;

  -- Stripe hosts the PaymentIntent only after Checkout completion.  Bind that
  -- completion-time identifier to the reservation rather than requiring it at
  -- Checkout-session creation time.
  SELECT * INTO v_purchase
  FROM public.case_purchases AS cp
  WHERE cp.case_id = p_case_id
    AND cp.user_id = p_owner_user_id
    AND cp.amount = p_amount
    AND pg_catalog.upper(cp.currency) = pg_catalog.upper(p_currency)
    AND cp.payment_provider = 'stripe'
    AND cp.provider_checkout_session_id IS NOT NULL
    AND cp.provider_payment_intent_id = p_payment_intent_id
    AND cp.metadata ->> 'legacy_payment_id' = p_payment_id::text
    AND cp.payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed')
    AND (
      (cp.product_code = 'self_serve_report' AND p_service_type = 'standard')
      OR (cp.product_code = 'escalation_pack' AND p_service_type = 'fidrec_tier2_pack')
      OR (cp.product_code = 'human_consult_99' AND p_service_type = 'human_consult_30m')
    )
  FOR UPDATE;

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'complete_legacy_payment_v1: canonical purchase linkage mismatch';
  END IF;

  UPDATE public.payments AS p
  SET stripe_payment_intent_id = COALESCE(p.stripe_payment_intent_id, p_payment_intent_id),
      payment_status = 'completed'
  WHERE p.id = p_payment_id
    AND p.case_id = p_case_id
    AND p.user_id = p_owner_user_id
    AND p.amount = p_amount
    AND pg_catalog.upper(p.currency) = pg_catalog.upper(p_currency)
    AND p.service_type = p_service_type
    -- A verified canonical Stripe purchase may arrive after cancellation or a
    -- transient failed side effect. Monetary lifecycle remains on case_purchases.
    AND p.payment_status IN ('pending', 'failed', 'completed')
    AND (p.stripe_payment_intent_id IS NULL OR p.stripe_payment_intent_id = p_payment_intent_id)
  RETURNING * INTO v_payment;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'complete_legacy_payment_v1: canonical payment mismatch';
  END IF;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_legacy_payment_v1(
  uuid, uuid, uuid, numeric, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_legacy_payment_v1(
  uuid, uuid, uuid, numeric, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_case_purchase_refund_v1(
  p_purchase_id uuid,
  p_payment_intent_id text,
  p_refunded_amount numeric,
  p_currency text
)
RETURNS public.case_purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purchase public.case_purchases;
BEGIN
  IF p_refunded_amount IS NULL
    OR p_refunded_amount <= 0
    OR p_payment_intent_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_payment_intent_id)) = 0
    OR p_currency IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_currency)) = 0 THEN
    RAISE EXCEPTION 'record_case_purchase_refund_v1: invalid refund facts';
  END IF;

  UPDATE public.case_purchases AS cp
  SET refunded_amount = greatest(COALESCE(cp.refunded_amount, 0), p_refunded_amount),
      payment_status = CASE
        WHEN greatest(COALESCE(cp.refunded_amount, 0), p_refunded_amount) >= cp.amount
          THEN 'refunded'
        WHEN cp.payment_status = 'disputed' THEN 'disputed'
        ELSE 'partially_refunded'
      END,
      updated_at = pg_catalog.now()
  WHERE cp.id = p_purchase_id
    AND cp.payment_provider = 'stripe'
    AND cp.provider_payment_intent_id = p_payment_intent_id
    AND pg_catalog.upper(cp.currency) = pg_catalog.upper(p_currency)
    AND p_refunded_amount <= cp.amount
  RETURNING * INTO v_purchase;

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'record_case_purchase_refund_v1: canonical purchase mismatch';
  END IF;

  RETURN v_purchase;
END;
$$;

REVOKE ALL ON FUNCTION public.record_case_purchase_refund_v1(uuid, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_case_purchase_refund_v1(uuid, text, numeric, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_case_purchase_dispute_v1(
  p_purchase_id uuid,
  p_payment_intent_id text,
  p_disputed_at timestamptz
)
RETURNS public.case_purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purchase public.case_purchases;
BEGIN
  IF p_payment_intent_id IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'record_case_purchase_dispute_v1: invalid dispute facts';
  END IF;

  UPDATE public.case_purchases AS cp
  SET payment_status = CASE
        WHEN cp.payment_status = 'refunded' THEN 'refunded'
        ELSE 'disputed'
      END,
      disputed_at = COALESCE(cp.disputed_at, p_disputed_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  WHERE cp.id = p_purchase_id
    AND cp.payment_provider = 'stripe'
    AND cp.provider_payment_intent_id = p_payment_intent_id
  RETURNING * INTO v_purchase;

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'record_case_purchase_dispute_v1: canonical purchase mismatch';
  END IF;

  RETURN v_purchase;
END;
$$;

REVOKE ALL ON FUNCTION public.record_case_purchase_dispute_v1(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_case_purchase_dispute_v1(uuid, text, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_post_payment_report_generation(
  p_case_id uuid,
  p_user_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_payment_row_id uuid DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case_owner uuid;
  v_job public.jobs;
BEGIN
  SELECT c.user_id INTO v_case_owner
  FROM public.cases AS c
  WHERE c.id = p_case_id;

  IF v_case_owner IS NULL OR v_case_owner <> p_user_id THEN
    RAISE EXCEPTION 'enqueue_post_payment_report_generation: case owner mismatch';
  END IF;

  INSERT INTO public.case_entitlements (
    case_id,
    plan,
    features,
    purchased_at,
    source,
    purchase_ref,
    updated_at
  )
  VALUES (
    p_case_id,
    'self_serve_report',
    jsonb_build_object('allow_self_serve_report', true),
    now(),
    'stripe',
    p_idempotency_key,
    now()
  )
  ON CONFLICT (case_id) DO UPDATE
  SET plan = CASE
        WHEN public.case_entitlements.plan = 'escalation_pack' THEN 'escalation_pack'
        ELSE 'self_serve_report'
      END,
      features = COALESCE(public.case_entitlements.features, '{}'::jsonb)
        || jsonb_build_object('allow_self_serve_report', true),
      purchased_at = COALESCE(public.case_entitlements.purchased_at, EXCLUDED.purchased_at),
      source = 'stripe',
      purchase_ref = COALESCE(public.case_entitlements.purchase_ref, EXCLUDED.purchase_ref),
      updated_at = now();

  INSERT INTO public.jobs (
    case_id,
    user_id,
    job_type,
    idempotency_key,
    status,
    payload
  )
  VALUES (
    p_case_id,
    p_user_id,
    'post_payment_report_generation',
    p_idempotency_key,
    'queued',
    jsonb_build_object(
      'stripe_checkout_session_id', p_idempotency_key,
      'payment_row_id', p_payment_row_id
    )
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_job;

  IF v_job IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_job
    FROM public.jobs AS j
    WHERE j.idempotency_key = p_idempotency_key
      AND j.case_id = p_case_id
      AND j.user_id = p_user_id
      AND j.job_type = 'post_payment_report_generation'
    LIMIT 1;

    IF v_job IS NULL THEN
      RAISE EXCEPTION 'enqueue_post_payment_report_generation: idempotency key collision';
    END IF;
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid)
  TO service_role;

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
  UPDATE public.case_entitlements AS ce
  SET plan = 'escalation_pack',
      features = COALESCE(ce.features, '{}'::jsonb)
        || jsonb_build_object(
          'allow_self_serve_report', true,
          'allow_escalation_pack', true
        ),
      source = 'stripe',
      purchase_ref = COALESCE(ce.purchase_ref, p_purchase_ref),
      updated_at = now()
  WHERE ce.case_id = p_case_id
    AND (
      ce.plan IN ('self_serve_report', 'escalation_pack')
      OR ce.features @> jsonb_build_object('allow_self_serve_report', true)
    )
  RETURNING * INTO v_entitlement;

  IF v_entitlement.case_id IS NULL THEN
    RAISE EXCEPTION 'grant_fidrec_pack_capability_v1: qualifying FI capability required';
  END IF;

  RETURN v_entitlement;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_fidrec_pack_capability_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_fidrec_pack_capability_v1(uuid, text)
  TO service_role;

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
      PERFORM public.enqueue_post_payment_report_generation(
        v_purchase.case_id,
        v_owner_user_id,
        v_purchase.provider_checkout_session_id,
        v_legacy_payment_id
      );
    WHEN 'escalation_pack' THEN
      IF v_purchase.amount <> 188 OR v_payment.service_type <> 'fidrec_tier2_pack' THEN
        RAISE EXCEPTION 'reconcile_established_case_purchase_fulfilment_v1: product mismatch';
      END IF;
      v_legacy_service_type := 'fidrec_tier2_pack';
      -- A confirmed Tier 2 purchase is itself durable evidence that the
      -- prerequisite passed at reservation time. Restore both retained
      -- capabilities when a prior side effect is absent; do not create a
      -- second report-generation job during this repair.
      INSERT INTO public.case_entitlements (
        case_id, plan, features, purchased_at, source, purchase_ref, updated_at
      ) VALUES (
        v_purchase.case_id,
        'escalation_pack',
        jsonb_build_object(
          'allow_self_serve_report', true,
          'allow_escalation_pack', true
        ),
        pg_catalog.now(),
        'stripe',
        v_purchase.provider_checkout_session_id,
        pg_catalog.now()
      )
      ON CONFLICT (case_id) DO UPDATE
      SET plan = 'escalation_pack',
          features = COALESCE(public.case_entitlements.features, '{}'::jsonb)
            || jsonb_build_object(
              'allow_self_serve_report', true,
              'allow_escalation_pack', true
            ),
          purchased_at = COALESCE(
            public.case_entitlements.purchased_at,
            EXCLUDED.purchased_at
          ),
          source = 'stripe',
          purchase_ref = COALESCE(
            public.case_entitlements.purchase_ref,
            EXCLUDED.purchase_ref
          ),
          updated_at = pg_catalog.now();
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

CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (storage_bucket, storage_path)
);

ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storage_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.storage_cleanup_queue TO service_role;

CREATE OR REPLACE FUNCTION public.case_actor_access_v1(
  p_case_id uuid,
  p_actor_profile_id uuid,
  p_require_edit boolean DEFAULT false
)
RETURNS TABLE(access_result text, owner_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid;
  v_collaborator_id uuid;
BEGIN
  SELECT c.user_id
  INTO v_owner_id
  FROM public.cases AS c
  WHERE c.id = p_case_id
  FOR KEY SHARE;

  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_owner_id = p_actor_profile_id THEN
    RETURN QUERY SELECT 'ok'::text, v_owner_id;
    RETURN;
  END IF;

  SELECT cc.user_id
  INTO v_collaborator_id
  FROM public.case_collaborators AS cc
  WHERE cc.case_id = p_case_id
    AND cc.user_id = p_actor_profile_id
    AND cc.status = 'active'
    AND (NOT p_require_edit OR cc.can_edit = true)
    AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
  FOR KEY SHARE;

  IF v_collaborator_id IS NOT NULL THEN
    RETURN QUERY SELECT 'ok'::text, v_owner_id;
  ELSE
    RETURN QUERY SELECT 'forbidden'::text, NULL::uuid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.case_actor_access_v1(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.case_actor_access_v1(uuid, uuid, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.register_evidence_upload_v1(
  p_case_id uuid,
  p_actor_profile_id uuid,
  p_filename text,
  p_file_path text,
  p_file_type text,
  p_file_size bigint,
  p_description text,
  p_category text
)
RETURNS public.evidence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_size bigint;
  v_evidence public.evidence;
  v_access record;
BEGIN
  IF p_file_size IS NULL OR p_file_size <= 0 OR p_file_size > 52428800 THEN
    RAISE EXCEPTION 'register_evidence_upload_v1: file size outside 50 MiB limit';
  END IF;
  IF p_file_type NOT IN ('application/pdf', 'image/png', 'image/jpeg') THEN
    RAISE EXCEPTION 'register_evidence_upload_v1: unsupported file type';
  END IF;
  IF length(p_filename) = 0 OR length(p_filename) > 255 THEN
    RAISE EXCEPTION 'register_evidence_upload_v1: invalid filename';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'register_evidence_upload_v1: description too long';
  END IF;
  IF p_category IS NULL
     OR p_category !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$'
     OR p_file_path !~ ('^' || p_case_id::text || '/' || p_category || '/[A-Za-z0-9-]+[.](pdf|png|jpg)$')
     OR (p_file_type = 'application/pdf' AND p_file_path !~ '[.]pdf$')
     OR (p_file_type = 'image/png' AND p_file_path !~ '[.]png$')
     OR (p_file_type = 'image/jpeg' AND p_file_path !~ '[.]jpg$') THEN
    RAISE EXCEPTION 'register_evidence_upload_v1: invalid storage path';
  END IF;

  SELECT *
  INTO v_access
  FROM public.case_actor_access_v1(p_case_id, p_actor_profile_id, true);
  IF v_access.access_result <> 'ok' OR v_access.owner_id IS NULL THEN
    RAISE EXCEPTION 'register_evidence_upload_v1: case edit access required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_case_id::text, 20260829)
  );

  SELECT COALESCE(sum(e.file_size), 0)::bigint
  INTO v_total_size
  FROM public.evidence AS e
  WHERE e.case_id = p_case_id;

  IF v_total_size + p_file_size > 524288000 THEN
    RAISE EXCEPTION 'register_evidence_upload_v1: case storage quota exceeded';
  END IF;

  INSERT INTO public.evidence (
    case_id,
    user_id,
    filename,
    file_path,
    file_type,
    file_size,
    description,
    category
  ) VALUES (
    p_case_id,
    p_actor_profile_id,
    p_filename,
    p_file_path,
    p_file_type,
    p_file_size,
    p_description,
    p_category
  )
  RETURNING * INTO v_evidence;

  RETURN v_evidence;
END;
$$;

REVOKE ALL ON FUNCTION public.register_evidence_upload_v1(
  uuid, uuid, text, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_evidence_upload_v1(
  uuid, uuid, text, text, text, bigint, text, text
) TO service_role;

-- Recover abandoned leases before claiming the oldest eligible job. The
-- locked_at value is also the lease token checked by the app and worker.
CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  UPDATE public.jobs AS stale
  SET status = CASE WHEN stale.retry_count < 2 THEN 'queued' ELSE 'failed' END,
      retry_count = stale.retry_count + 1,
      error = 'Recovered abandoned worker lease',
      locked_at = NULL,
      updated_at = pg_catalog.now()
  WHERE stale.status = 'running'
    AND stale.updated_at < pg_catalog.now() - interval '15 minutes';

  SELECT j.*
  INTO v_job
  FROM public.jobs AS j
  WHERE j.status = 'queued'
    AND j.job_type = 'post_payment_report_generation'
  ORDER BY j.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.jobs AS j
  SET status = 'running',
      started_at = pg_catalog.now(),
      locked_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE j.id = v_job.id
  RETURNING j.* INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_job() TO service_role;
