-- Slice 8B: case_purchases + payment_webhook_events + provider upsert RPC
--
-- Draft only — do not apply until explicit approval.
--
-- Ownership:
--   case_purchases.case_id → cases.id → cases.user_id → current_app_user_id()
-- user_id is ALWAYS derived from cases.user_id (see upsert RPC). Never trust
-- request body user_id. Never auth.users.
--
-- Payment event model:
--   fulfilment_provider_event_id on case_purchases = first successful paid
--   fulfilment webhook event only (not a complete event history).
--   public.payment_webhook_events = append-only idempotency ledger for ALL
--   provider events (checkout completed, refunds, disputes, etc.).

CREATE TABLE IF NOT EXISTS public.case_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  purchased_by_profile_id uuid REFERENCES public.profiles(id),

  product_code text NOT NULL CHECK (product_code IN (
    'self_serve_report',
    'human_consult_99',
    'escalation_pack'
  )),

  payment_provider text NOT NULL DEFAULT 'stripe'
    CHECK (payment_provider IN ('stripe')),

  provider_checkout_session_id text,
  provider_payment_intent_id text,

  -- First successful paid-fulfilment provider event id only.
  -- Later refund/dispute events live in payment_webhook_events, not here.
  fulfilment_provider_event_id text,

  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'SGD',

  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN (
      'pending',
      'paid',
      'refunded',
      'partially_refunded',
      'disputed',
      'cancelled'
    )),

  refunded_amount numeric(10, 2)
    CHECK (refunded_amount IS NULL OR refunded_amount >= 0),

  paid_at timestamptz,
  disputed_at timestamptz,
  cancelled_at timestamptz,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by_profile_id uuid REFERENCES public.profiles(id),
  updated_by_profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.case_purchases IS
  'Multi-SKU purchase ledger. Catalogue/price IDs live in app config. human_consult_99 must not mutate case_entitlements.plan.';

COMMENT ON COLUMN public.case_purchases.user_id IS
  'Denormalized from cases.user_id via upsert_case_purchase_from_provider. Not an ownership authority input.';

COMMENT ON COLUMN public.case_purchases.fulfilment_provider_event_id IS
  'Provider event id for the first successful payment fulfilment only. Full webhook idempotency uses public.payment_webhook_events.';

CREATE UNIQUE INDEX IF NOT EXISTS case_purchases_provider_session_uidx
  ON public.case_purchases (payment_provider, provider_checkout_session_id)
  WHERE provider_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS case_purchases_fulfilment_event_uidx
  ON public.case_purchases (payment_provider, fulfilment_provider_event_id)
  WHERE fulfilment_provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS case_purchases_case_id_idx
  ON public.case_purchases (case_id);

CREATE INDEX IF NOT EXISTS case_purchases_user_id_idx
  ON public.case_purchases (user_id);

CREATE INDEX IF NOT EXISTS case_purchases_product_status_idx
  ON public.case_purchases (product_code, payment_status);

CREATE INDEX IF NOT EXISTS case_purchases_case_product_idx
  ON public.case_purchases (case_id, product_code, created_at DESC);

DROP TRIGGER IF EXISTS trg_case_purchases_set_updated_at ON public.case_purchases;
CREATE TRIGGER trg_case_purchases_set_updated_at
  BEFORE UPDATE ON public.case_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.case_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_purchases_select_own ON public.case_purchases;
CREATE POLICY case_purchases_select_own
  ON public.case_purchases
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases AS c
      WHERE c.id = case_purchases.case_id
        AND c.user_id = public.current_app_user_id()
    )
  );

REVOKE ALL ON TABLE public.case_purchases FROM PUBLIC;
REVOKE ALL ON TABLE public.case_purchases FROM anon;
REVOKE ALL ON TABLE public.case_purchases FROM authenticated;
GRANT SELECT ON TABLE public.case_purchases TO authenticated;
GRANT ALL ON TABLE public.case_purchases TO service_role;

-- ---------------------------------------------------------------------------
-- payment_webhook_events — complete provider-event idempotency ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_provider text NOT NULL DEFAULT 'stripe'
    CHECK (payment_provider IN ('stripe')),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  case_purchase_id uuid REFERENCES public.case_purchases(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN (
      'received',
      'processed',
      'ignored',
      'failed'
    )),
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT payment_webhook_events_provider_event_unique
    UNIQUE (payment_provider, provider_event_id)
);

COMMENT ON TABLE public.payment_webhook_events IS
  'Append-oriented Stripe (etc.) webhook ledger. UNIQUE(provider, provider_event_id) makes every webhook delivery idempotent, including refunds and disputes. case_purchases.fulfilment_provider_event_id is only the first paid fulfilment pointer.';

CREATE INDEX IF NOT EXISTS payment_webhook_events_purchase_idx
  ON public.payment_webhook_events (case_purchase_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_webhook_events_case_idx
  ON public.payment_webhook_events (case_id, created_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
-- Staff/service only — claimants do not read raw webhook payloads.

REVOKE ALL ON TABLE public.payment_webhook_events FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_webhook_events FROM anon;
REVOKE ALL ON TABLE public.payment_webhook_events FROM authenticated;
GRANT ALL ON TABLE public.payment_webhook_events TO service_role;

-- ===========================================================================
-- RPC: upsert_case_purchase_from_provider
-- Derives user_id from cases.user_id. Does NOT accept p_user_id.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.upsert_case_purchase_from_provider(
  p_case_id uuid,
  p_product_code text,
  p_amount numeric,
  p_currency text DEFAULT 'SGD',
  p_payment_provider text DEFAULT 'stripe',
  p_provider_checkout_session_id text DEFAULT NULL,
  p_provider_payment_intent_id text DEFAULT NULL,
  p_payment_status text DEFAULT 'pending',
  p_purchased_by_profile_id uuid DEFAULT NULL,
  p_fulfilment_provider_event_id text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_refunded_amount numeric DEFAULT NULL,
  p_disputed_at timestamptz DEFAULT NULL,
  p_cancelled_at timestamptz DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_actor_profile_id uuid DEFAULT NULL
)
RETURNS public.case_purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_row public.case_purchases;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'upsert_case_purchase_from_provider: p_case_id required';
  END IF;

  IF p_product_code IS NULL OR p_product_code NOT IN (
    'self_serve_report', 'human_consult_99', 'escalation_pack'
  ) THEN
    RAISE EXCEPTION 'upsert_case_purchase_from_provider: invalid product_code';
  END IF;

  IF p_payment_status IS NULL OR p_payment_status NOT IN (
    'pending', 'paid', 'refunded', 'partially_refunded', 'disputed', 'cancelled'
  ) THEN
    RAISE EXCEPTION 'upsert_case_purchase_from_provider: invalid payment_status';
  END IF;

  SELECT c.user_id
    INTO v_owner
  FROM public.cases AS c
  WHERE c.id = p_case_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION
      'upsert_case_purchase_from_provider: case % not found or has null user_id',
      p_case_id;
  END IF;

  -- Prefer idempotent match on checkout session when present.
  IF p_provider_checkout_session_id IS NOT NULL THEN
    SELECT *
      INTO v_row
    FROM public.case_purchases AS cp
    WHERE cp.payment_provider = p_payment_provider
      AND cp.provider_checkout_session_id = p_provider_checkout_session_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.case_purchases AS cp
      SET
        product_code = p_product_code,
        amount = p_amount,
        currency = COALESCE(p_currency, cp.currency),
        provider_payment_intent_id = COALESCE(
          p_provider_payment_intent_id, cp.provider_payment_intent_id
        ),
        fulfilment_provider_event_id = COALESCE(
          cp.fulfilment_provider_event_id, p_fulfilment_provider_event_id
        ),
        payment_status = p_payment_status,
        refunded_amount = COALESCE(p_refunded_amount, cp.refunded_amount),
        paid_at = CASE
          WHEN p_payment_status = 'paid'
            THEN COALESCE(cp.paid_at, p_paid_at, now())
          ELSE cp.paid_at
        END,
        disputed_at = COALESCE(p_disputed_at, cp.disputed_at),
        cancelled_at = COALESCE(p_cancelled_at, cp.cancelled_at),
        purchased_by_profile_id = COALESCE(
          cp.purchased_by_profile_id, p_purchased_by_profile_id
        ),
        metadata = COALESCE(cp.metadata, '{}'::jsonb)
          || COALESCE(p_metadata, '{}'::jsonb),
        updated_by_profile_id = p_actor_profile_id,
        updated_at = now()
      WHERE cp.id = v_row.id
      RETURNING * INTO v_row;

      RETURN v_row;
    END IF;
  END IF;

  INSERT INTO public.case_purchases (
    case_id,
    user_id,
    purchased_by_profile_id,
    product_code,
    payment_provider,
    provider_checkout_session_id,
    provider_payment_intent_id,
    fulfilment_provider_event_id,
    amount,
    currency,
    payment_status,
    refunded_amount,
    paid_at,
    disputed_at,
    cancelled_at,
    metadata,
    created_by_profile_id,
    updated_by_profile_id
  )
  VALUES (
    p_case_id,
    v_owner,
    p_purchased_by_profile_id,
    p_product_code,
    COALESCE(p_payment_provider, 'stripe'),
    p_provider_checkout_session_id,
    p_provider_payment_intent_id,
    p_fulfilment_provider_event_id,
    p_amount,
    COALESCE(p_currency, 'SGD'),
    p_payment_status,
    p_refunded_amount,
    CASE
      WHEN p_payment_status = 'paid' THEN COALESCE(p_paid_at, now())
      ELSE NULL
    END,
    p_disputed_at,
    p_cancelled_at,
    COALESCE(p_metadata, '{}'::jsonb),
    p_actor_profile_id,
    p_actor_profile_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.upsert_case_purchase_from_provider(
  uuid, text, numeric, text, text, text, text, text, uuid, text,
  timestamptz, numeric, timestamptz, timestamptz, jsonb, uuid
) IS
  'Service-role purchase upsert. Derives user_id from public.cases.user_id. No p_user_id parameter. Sets fulfilment_provider_event_id only when first provided (not overwritten). Does not mutate case_entitlements.';

REVOKE ALL ON FUNCTION public.upsert_case_purchase_from_provider(
  uuid, text, numeric, text, text, text, text, text, uuid, text,
  timestamptz, numeric, timestamptz, timestamptz, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_case_purchase_from_provider(
  uuid, text, numeric, text, text, text, text, text, uuid, text,
  timestamptz, numeric, timestamptz, timestamptz, jsonb, uuid
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_case_purchase_from_provider(
  uuid, text, numeric, text, text, text, text, text, uuid, text,
  timestamptz, numeric, timestamptz, timestamptz, jsonb, uuid
) TO service_role;

-- ===========================================================================
-- RPC: record_payment_webhook_event
-- Idempotent insert by (payment_provider, provider_event_id).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.record_payment_webhook_event(
  p_payment_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_case_purchase_id uuid DEFAULT NULL,
  p_case_id uuid DEFAULT NULL,
  p_processing_status text DEFAULT 'received',
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_error text DEFAULT NULL
)
RETURNS public.payment_webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.payment_webhook_events;
  v_case_id uuid;
BEGIN
  IF p_provider_event_id IS NULL OR length(trim(p_provider_event_id)) = 0 THEN
    RAISE EXCEPTION 'record_payment_webhook_event: provider_event_id required';
  END IF;

  IF p_event_type IS NULL OR length(trim(p_event_type)) = 0 THEN
    RAISE EXCEPTION 'record_payment_webhook_event: event_type required';
  END IF;

  -- Derive case_id from purchase when omitted.
  v_case_id := p_case_id;
  IF v_case_id IS NULL AND p_case_purchase_id IS NOT NULL THEN
    SELECT cp.case_id
      INTO v_case_id
    FROM public.case_purchases AS cp
    WHERE cp.id = p_case_purchase_id;
  END IF;

  INSERT INTO public.payment_webhook_events (
    payment_provider,
    provider_event_id,
    event_type,
    case_purchase_id,
    case_id,
    processing_status,
    payload,
    error,
    processed_at
  )
  VALUES (
    COALESCE(p_payment_provider, 'stripe'),
    p_provider_event_id,
    p_event_type,
    p_case_purchase_id,
    v_case_id,
    COALESCE(p_processing_status, 'received'),
    COALESCE(p_payload, '{}'::jsonb),
    p_error,
    CASE
      WHEN COALESCE(p_processing_status, 'received') IN ('processed', 'ignored', 'failed')
        THEN now()
      ELSE NULL
    END
  )
  ON CONFLICT (payment_provider, provider_event_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT *
      INTO v_row
    FROM public.payment_webhook_events AS e
    WHERE e.payment_provider = COALESCE(p_payment_provider, 'stripe')
      AND e.provider_event_id = p_provider_event_id;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.record_payment_webhook_event(
  text, text, text, uuid, uuid, text, jsonb, text
) IS
  'Idempotent webhook ledger write. UNIQUE(payment_provider, provider_event_id). Use for checkout, refund, and dispute events. Service-role only.';

REVOKE ALL ON FUNCTION public.record_payment_webhook_event(
  text, text, text, uuid, uuid, text, jsonb, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payment_webhook_event(
  text, text, text, uuid, uuid, text, jsonb, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_webhook_event(
  text, text, text, uuid, uuid, text, jsonb, text
) TO service_role;
