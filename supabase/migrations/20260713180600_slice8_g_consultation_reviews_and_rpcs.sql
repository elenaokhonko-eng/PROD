-- Slice 8G: consultation_reviews + transactional RPCs
--
-- Draft only — do not apply until explicit approval.
--
-- RPCs are SECURITY DEFINER, service_role execute only.
-- They derive ownership from DB relationships; never trust body user_id.
-- human_consult fulfilment MUST NOT mutate case_entitlements.

-- ---------------------------------------------------------------------------
-- consultation_reviews
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.consultation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL
    REFERENCES public.case_consultations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  recording_id uuid REFERENCES public.consultation_recordings(id) ON DELETE SET NULL,

  review_version int NOT NULL CHECK (review_version >= 1),

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'in_review',
      'approved',
      'rejected',
      'superseded'
    )),

  summary_text text NOT NULL DEFAULT '',
  advice_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  agreed_next_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_corrections text,
  reviewer_notes text,

  reviewed_by_profile_id uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  approved_at timestamptz,
  superseded_at timestamptz,

  source_model text,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  inserted_narrative_id uuid REFERENCES public.case_narratives(id) ON DELETE SET NULL,
  inserted_document_id uuid REFERENCES public.case_documents(id) ON DELETE SET NULL,

  created_by_profile_id uuid REFERENCES public.profiles(id),
  updated_by_profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consultation_reviews_consultation_version_unique
    UNIQUE (consultation_id, review_version)
);

COMMENT ON TABLE public.consultation_reviews IS
  'Versioned human-reviewed consultation output (not raw transcript). reviewer_notes is staff-only — excluded from claimant view.';

COMMENT ON COLUMN public.consultation_reviews.reviewer_notes IS
  'Staff-only. Never expose via consultation_reviews_claimant.';

CREATE UNIQUE INDEX IF NOT EXISTS consultation_reviews_one_approved_uidx
  ON public.consultation_reviews (consultation_id)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS consultation_reviews_case_id_idx
  ON public.consultation_reviews (case_id);

CREATE INDEX IF NOT EXISTS consultation_reviews_status_idx
  ON public.consultation_reviews (consultation_id, status);

DROP TRIGGER IF EXISTS trg_consultation_reviews_set_updated_at ON public.consultation_reviews;
CREATE TRIGGER trg_consultation_reviews_set_updated_at
  BEFORE UPDATE ON public.consultation_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.consultation_reviews ENABLE ROW LEVEL SECURITY;
-- No broad authenticated SELECT on base table (drafts would leak reviewer_notes).
-- Claimant access via consultation_reviews_claimant in 8H.

REVOKE ALL ON TABLE public.consultation_reviews FROM PUBLIC;
REVOKE ALL ON TABLE public.consultation_reviews FROM anon, authenticated;
GRANT ALL ON TABLE public.consultation_reviews TO service_role;

-- ===========================================================================
-- RPC: create_consultation_from_paid_purchase
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_consultation_from_paid_purchase(
  p_purchase_id uuid,
  p_duration_minutes int DEFAULT 30,
  p_actor_profile_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'system'
)
RETURNS public.case_consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purchase public.case_purchases;
  v_owner uuid;
  v_seq int;
  v_row public.case_consultations;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RAISE EXCEPTION 'create_consultation_from_paid_purchase: duration_minutes must be > 0';
  END IF;

  IF p_actor_type IS NULL OR p_actor_type NOT IN (
    'system', 'claimant', 'consultant', 'consult_operations', 'admin'
  ) THEN
    RAISE EXCEPTION 'create_consultation_from_paid_purchase: invalid actor_type';
  END IF;

  SELECT * INTO v_purchase
  FROM public.case_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_consultation_from_paid_purchase: purchase % not found', p_purchase_id;
  END IF;

  IF v_purchase.product_code <> 'human_consult_99' THEN
    RAISE EXCEPTION
      'create_consultation_from_paid_purchase: product_code % is not human_consult_99',
      v_purchase.product_code;
  END IF;

  IF v_purchase.payment_status <> 'paid' THEN
    RAISE EXCEPTION
      'create_consultation_from_paid_purchase: payment_status must be paid (got %)',
      v_purchase.payment_status;
  END IF;

  -- Idempotent: one purchase → one consultation
  SELECT * INTO v_row
  FROM public.case_consultations
  WHERE purchase_id = p_purchase_id;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT c.user_id INTO v_owner
  FROM public.cases c
  WHERE c.id = v_purchase.case_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION
      'create_consultation_from_paid_purchase: case % missing owner',
      v_purchase.case_id;
  END IF;

  -- Serialize per-case sequence allocation (concurrent paid fulfilments).
  -- 64-bit advisory lock key from hashtextextended (seed 87201408).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_purchase.case_id::text, 87201408)
  );

  -- Re-check after lock (concurrent fulfil of same purchase).
  SELECT * INTO v_row
  FROM public.case_consultations
  WHERE purchase_id = p_purchase_id;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT COALESCE(MAX(cc.consultation_sequence), 0) + 1
    INTO v_seq
  FROM public.case_consultations cc
  WHERE cc.case_id = v_purchase.case_id;

  BEGIN
    INSERT INTO public.case_consultations (
      case_id,
      user_id,
      purchase_id,
      consultation_number,
      consultation_sequence,
      duration_minutes,
      fulfilment_status,
      created_by_profile_id,
      updated_by_profile_id
    )
    VALUES (
      v_purchase.case_id,
      v_owner,
      p_purchase_id,
      public.next_consultation_number(),
      v_seq,
      p_duration_minutes,
      'purchased',
      p_actor_profile_id,
      p_actor_profile_id
    )
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_row
      FROM public.case_consultations
      WHERE purchase_id = p_purchase_id;
      IF NOT FOUND THEN
        RAISE;
      END IF;
      RETURN v_row;
  END;

  INSERT INTO public.consultation_operations (
    consultation_id,
    case_id,
    created_by_profile_id,
    updated_by_profile_id,
    last_ops_actor_profile_id
  )
  VALUES (
    v_row.id,
    v_row.case_id,
    p_actor_profile_id,
    p_actor_profile_id,
    p_actor_profile_id
  );

  INSERT INTO public.consultation_events (
    consultation_id,
    case_id,
    event_type,
    actor_type,
    actor_profile_id,
    from_value,
    to_value,
    metadata
  )
  VALUES (
    v_row.id,
    v_row.case_id,
    'purchased',
    p_actor_type,
    p_actor_profile_id,
    NULL,
    'purchased',
    jsonb_build_object(
      'purchase_id', p_purchase_id,
      'product_code', v_purchase.product_code,
      'consultation_sequence', v_seq,
      'consultation_number', v_row.consultation_number
    )
  );

  -- Intentionally does NOT touch public.case_entitlements.
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.create_consultation_from_paid_purchase(uuid, int, uuid, text) IS
  'Allocates a case_consultations row for a paid human_consult_99 purchase. Idempotent on purchase_id. Uses advisory xact lock for per-case sequence. Never mutates case_entitlements.';

REVOKE ALL ON FUNCTION public.create_consultation_from_paid_purchase(uuid, int, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_consultation_from_paid_purchase(uuid, int, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_consultation_from_paid_purchase(uuid, int, uuid, text) TO service_role;

-- ===========================================================================
-- RPC: assign_consultant
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.assign_consultant(
  p_consultation_id uuid,
  p_consultant_profile_id uuid,
  p_actor_profile_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'consult_operations'
)
RETURNS public.consultation_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_consult public.case_consultations;
  v_ops public.consultation_operations;
BEGIN
  IF p_consultant_profile_id IS NULL THEN
    RAISE EXCEPTION 'assign_consultant: p_consultant_profile_id required';
  END IF;

  IF p_actor_type IS NULL OR p_actor_type NOT IN (
    'system', 'claimant', 'consultant', 'consult_operations', 'admin'
  ) THEN
    RAISE EXCEPTION 'assign_consultant: invalid actor_type';
  END IF;

  SELECT * INTO v_consult
  FROM public.case_consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_consultant: consultation % not found', p_consultation_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_consultant_profile_id) THEN
    RAISE EXCEPTION 'assign_consultant: consultant profile % not found', p_consultant_profile_id;
  END IF;

  INSERT INTO public.consultation_operations (
    consultation_id,
    case_id,
    assigned_consultant_profile_id,
    assigned_at,
    assigned_by_profile_id,
    last_ops_actor_profile_id,
    created_by_profile_id,
    updated_by_profile_id
  )
  VALUES (
    v_consult.id,
    v_consult.case_id,
    p_consultant_profile_id,
    now(),
    p_actor_profile_id,
    p_actor_profile_id,
    p_actor_profile_id,
    p_actor_profile_id
  )
  ON CONFLICT (consultation_id) DO UPDATE
  SET
    assigned_consultant_profile_id = EXCLUDED.assigned_consultant_profile_id,
    assigned_at = EXCLUDED.assigned_at,
    assigned_by_profile_id = EXCLUDED.assigned_by_profile_id,
    last_ops_actor_profile_id = EXCLUDED.last_ops_actor_profile_id,
    updated_by_profile_id = EXCLUDED.updated_by_profile_id,
    updated_at = now()
  RETURNING * INTO v_ops;

  INSERT INTO public.consultation_events (
    consultation_id,
    case_id,
    event_type,
    actor_type,
    actor_profile_id,
    from_value,
    to_value,
    metadata
  )
  VALUES (
    v_consult.id,
    v_consult.case_id,
    'consultant_assigned',
    p_actor_type,
    p_actor_profile_id,
    NULL,
    p_consultant_profile_id::text,
    jsonb_build_object(
      'assigned_consultant_profile_id', p_consultant_profile_id
    )
  );

  -- case_consultations is intentionally not updated (no consultant column).
  RETURN v_ops;
END;
$$;

COMMENT ON FUNCTION public.assign_consultant(uuid, uuid, uuid, text) IS
  'Sets assigned_consultant_profile_id on consultation_operations only and appends consultant_assigned event.';

REVOKE ALL ON FUNCTION public.assign_consultant(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_consultant(uuid, uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_consultant(uuid, uuid, uuid, text) TO service_role;

-- ===========================================================================
-- Allowed status transitions (explicit graph)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.consultation_status_transition_allowed(
  p_dimension text,
  p_from text,
  p_to text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_dimension = 'fulfilment' THEN
      (p_from, p_to) IN (
        ('purchased', 'awaiting_scheduling'),
        ('purchased', 'cancelled'),
        ('awaiting_scheduling', 'scheduled'),
        ('awaiting_scheduling', 'cancelled'),
        ('scheduled', 'scheduled'),          -- reschedule in place
        ('scheduled', 'in_progress'),
        ('scheduled', 'cancelled'),
        ('scheduled', 'no_show'),
        ('in_progress', 'completed'),
        ('in_progress', 'no_show'),
        ('in_progress', 'follow_up_required'),
        ('in_progress', 'cancelled'),
        ('completed', 'follow_up_required'),
        ('no_show', 'awaiting_scheduling'),
        ('no_show', 'follow_up_required'),
        ('no_show', 'cancelled'),
        ('follow_up_required', 'awaiting_scheduling'),
        ('follow_up_required', 'scheduled'),
        ('follow_up_required', 'completed'),
        ('follow_up_required', 'cancelled')
      )
    WHEN p_dimension = 'recording' THEN
      (p_from, p_to) IN (
        ('not_requested', 'consent_pending'),
        ('not_requested', 'consent_declined'),
        ('consent_pending', 'consent_declined'),
        ('consent_pending', 'awaiting_recording'),
        ('awaiting_recording', 'available_at_provider'),
        ('awaiting_recording', 'failed'),
        ('available_at_provider', 'ingesting'),
        ('available_at_provider', 'failed'),
        ('ingesting', 'stored'),
        ('ingesting', 'failed'),
        ('stored', 'deletion_scheduled'),
        ('failed', 'awaiting_recording'),
        ('failed', 'available_at_provider'),
        ('deletion_scheduled', 'deleted')
      )
    WHEN p_dimension = 'transcription' THEN
      (p_from, p_to) IN (
        ('not_requested', 'queued'),
        ('queued', 'processing'),
        ('queued', 'cancelled'),
        ('processing', 'completed'),
        ('processing', 'failed'),
        ('failed', 'queued'),
        ('cancelled', 'queued')
      )
    WHEN p_dimension = 'case_insertion' THEN
      (p_from, p_to) IN (
        ('not_ready', 'review_pending'),
        ('review_pending', 'approved'),
        ('review_pending', 'rejected'),
        ('approved', 'inserted'),
        ('approved', 'superseded'),
        ('rejected', 'review_pending'),
        ('inserted', 'superseded'),
        ('superseded', 'review_pending')
      )
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.consultation_status_transition_allowed(text, text, text) IS
  'Pure transition graph for consultation status dimensions. Used by transition_consultation_status.';

REVOKE ALL ON FUNCTION public.consultation_status_transition_allowed(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consultation_status_transition_allowed(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultation_status_transition_allowed(text, text, text) TO service_role;

-- ===========================================================================
-- RPC: transition_consultation_status
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.transition_consultation_status(
  p_consultation_id uuid,
  p_dimension text,
  p_to_status text,
  p_actor_profile_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'system',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_cancellation_reason text DEFAULT NULL,
  p_scheduled_starts_at timestamptz DEFAULT NULL,
  p_scheduled_ends_at timestamptz DEFAULT NULL,
  p_provider_type text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_provider_join_url text DEFAULT NULL
)
RETURNS public.case_consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.case_consultations;
  v_from text;
  v_event text;
  v_named_event text;
BEGIN
  IF p_dimension IS NULL OR p_dimension NOT IN (
    'fulfilment', 'recording', 'transcription', 'case_insertion'
  ) THEN
    RAISE EXCEPTION 'transition_consultation_status: invalid dimension %', p_dimension;
  END IF;

  IF p_actor_type IS NULL OR p_actor_type NOT IN (
    'system', 'claimant', 'consultant', 'consult_operations', 'admin'
  ) THEN
    RAISE EXCEPTION 'transition_consultation_status: invalid actor_type';
  END IF;

  SELECT * INTO v_row
  FROM public.case_consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition_consultation_status: consultation % not found', p_consultation_id;
  END IF;

  IF p_dimension = 'fulfilment' THEN
    v_from := v_row.fulfilment_status;
    IF NOT public.consultation_status_transition_allowed('fulfilment', v_from, p_to_status) THEN
      RAISE EXCEPTION
        'transition_consultation_status: fulfilment % → % not allowed',
        v_from, p_to_status;
    END IF;

    UPDATE public.case_consultations
    SET
      fulfilment_status = p_to_status,
      updated_by_profile_id = p_actor_profile_id,
      scheduled_starts_at = COALESCE(p_scheduled_starts_at, scheduled_starts_at),
      scheduled_ends_at = COALESCE(p_scheduled_ends_at, scheduled_ends_at),
      provider_type = COALESCE(p_provider_type, provider_type),
      provider_session_id = COALESCE(p_provider_session_id, provider_session_id),
      provider_join_url = COALESCE(p_provider_join_url, provider_join_url),
      completed_at = CASE WHEN p_to_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
      cancelled_at = CASE WHEN p_to_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
      cancellation_reason = CASE WHEN p_to_status = 'cancelled' THEN COALESCE(p_cancellation_reason, cancellation_reason) ELSE cancellation_reason END,
      no_show_at = CASE WHEN p_to_status = 'no_show' THEN COALESCE(no_show_at, now()) ELSE no_show_at END,
      updated_at = now()
    WHERE id = p_consultation_id
    RETURNING * INTO v_row;

    v_event := 'fulfilment_status_changed';
    v_named_event := CASE p_to_status
      WHEN 'awaiting_scheduling' THEN 'awaiting_scheduling'
      WHEN 'scheduled' THEN CASE WHEN v_from = 'scheduled' THEN 'rescheduled' ELSE 'scheduled' END
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'completed' THEN 'completed'
      WHEN 'no_show' THEN 'no_show'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'follow_up_required' THEN 'follow_up_required'
      ELSE NULL
    END;

  ELSIF p_dimension = 'recording' THEN
    v_from := v_row.recording_status;
    IF NOT public.consultation_status_transition_allowed('recording', v_from, p_to_status) THEN
      RAISE EXCEPTION
        'transition_consultation_status: recording % → % not allowed',
        v_from, p_to_status;
    END IF;

    UPDATE public.case_consultations
    SET
      recording_status = p_to_status,
      updated_by_profile_id = p_actor_profile_id,
      updated_at = now()
    WHERE id = p_consultation_id
    RETURNING * INTO v_row;

    v_event := 'recording_status_changed';
    v_named_event := CASE p_to_status
      WHEN 'consent_declined' THEN 'recording_consent_declined'
      WHEN 'awaiting_recording' THEN CASE WHEN v_from = 'consent_pending' THEN 'recording_consent_granted' ELSE NULL END
      ELSE NULL
    END;

  ELSIF p_dimension = 'transcription' THEN
    v_from := v_row.transcription_status;
    IF NOT public.consultation_status_transition_allowed('transcription', v_from, p_to_status) THEN
      RAISE EXCEPTION
        'transition_consultation_status: transcription % → % not allowed',
        v_from, p_to_status;
    END IF;

    UPDATE public.case_consultations
    SET
      transcription_status = p_to_status,
      updated_by_profile_id = p_actor_profile_id,
      updated_at = now()
    WHERE id = p_consultation_id
    RETURNING * INTO v_row;

    v_event := 'transcription_status_changed';
    v_named_event := CASE p_to_status
      WHEN 'queued' THEN 'transcription_queued'
      WHEN 'completed' THEN 'transcription_completed'
      WHEN 'failed' THEN 'transcription_failed'
      ELSE NULL
    END;

  ELSE
    -- case_insertion
    v_from := v_row.case_insertion_status;
    IF NOT public.consultation_status_transition_allowed('case_insertion', v_from, p_to_status) THEN
      RAISE EXCEPTION
        'transition_consultation_status: case_insertion % → % not allowed',
        v_from, p_to_status;
    END IF;

    UPDATE public.case_consultations
    SET
      case_insertion_status = p_to_status,
      updated_by_profile_id = p_actor_profile_id,
      updated_at = now()
    WHERE id = p_consultation_id
    RETURNING * INTO v_row;

    v_event := 'case_insertion_status_changed';
    v_named_event := CASE WHEN p_to_status = 'inserted' THEN 'inserted_into_case' ELSE NULL END;
  END IF;

  INSERT INTO public.consultation_events (
    consultation_id,
    case_id,
    event_type,
    actor_type,
    actor_profile_id,
    from_value,
    to_value,
    metadata
  )
  VALUES (
    v_row.id,
    v_row.case_id,
    v_event,
    p_actor_type,
    p_actor_profile_id,
    v_from,
    p_to_status,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('dimension', p_dimension)
  );

  IF v_named_event IS NOT NULL THEN
    INSERT INTO public.consultation_events (
      consultation_id,
      case_id,
      event_type,
      actor_type,
      actor_profile_id,
      from_value,
      to_value,
      metadata
    )
    VALUES (
      v_row.id,
      v_row.case_id,
      v_named_event,
      p_actor_type,
      p_actor_profile_id,
      v_from,
      p_to_status,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('dimension', p_dimension)
    );
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.transition_consultation_status(uuid, text, text, uuid, text, jsonb, text, timestamptz, timestamptz, text, text, text) IS
  'Atomically updates one status dimension on case_consultations and appends consultation_events. Service-role only.';

REVOKE ALL ON FUNCTION public.transition_consultation_status(uuid, text, text, uuid, text, jsonb, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_consultation_status(uuid, text, text, uuid, text, jsonb, text, timestamptz, timestamptz, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_consultation_status(uuid, text, text, uuid, text, jsonb, text, timestamptz, timestamptz, text, text, text) TO service_role;

-- ===========================================================================
-- RPC: approve_consultation_review
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.approve_consultation_review(
  p_review_id uuid,
  p_actor_profile_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'consult_operations'
)
RETURNS public.consultation_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_review public.consultation_reviews;
  v_prior public.consultation_reviews;
BEGIN
  IF p_actor_type IS NULL OR p_actor_type NOT IN (
    'system', 'claimant', 'consultant', 'consult_operations', 'admin'
  ) THEN
    RAISE EXCEPTION 'approve_consultation_review: invalid actor_type';
  END IF;

  SELECT * INTO v_review
  FROM public.consultation_reviews
  WHERE id = p_review_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_consultation_review: review % not found', p_review_id;
  END IF;

  IF v_review.status NOT IN ('draft', 'in_review', 'rejected') THEN
    RAISE EXCEPTION
      'approve_consultation_review: cannot approve review in status %',
      v_review.status;
  END IF;

  -- Lock sibling reviews for this consultation.
  PERFORM 1
  FROM public.consultation_reviews
  WHERE consultation_id = v_review.consultation_id
  FOR UPDATE;

  SELECT * INTO v_prior
  FROM public.consultation_reviews
  WHERE consultation_id = v_review.consultation_id
    AND status = 'approved'
    AND id <> p_review_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.consultation_reviews
    SET
      status = 'superseded',
      superseded_at = now(),
      updated_by_profile_id = p_actor_profile_id,
      updated_at = now()
    WHERE id = v_prior.id;

    INSERT INTO public.consultation_events (
      consultation_id,
      case_id,
      event_type,
      actor_type,
      actor_profile_id,
      from_value,
      to_value,
      metadata
    )
    VALUES (
      v_prior.consultation_id,
      v_prior.case_id,
      'review_superseded',
      p_actor_type,
      p_actor_profile_id,
      'approved',
      'superseded',
      jsonb_build_object(
        'review_id', v_prior.id,
        'review_version', v_prior.review_version,
        'superseded_by_review_id', p_review_id
      )
    );
  END IF;

  UPDATE public.consultation_reviews
  SET
    status = 'approved',
    approved_at = now(),
    reviewed_at = COALESCE(reviewed_at, now()),
    reviewed_by_profile_id = COALESCE(p_actor_profile_id, reviewed_by_profile_id),
    updated_by_profile_id = p_actor_profile_id,
    updated_at = now()
  WHERE id = p_review_id
  RETURNING * INTO v_review;

  INSERT INTO public.consultation_events (
    consultation_id,
    case_id,
    event_type,
    actor_type,
    actor_profile_id,
    from_value,
    to_value,
    metadata
  )
  VALUES (
    v_review.consultation_id,
    v_review.case_id,
    'review_approved',
    p_actor_type,
    p_actor_profile_id,
    NULL,
    'approved',
    jsonb_build_object(
      'review_id', v_review.id,
      'review_version', v_review.review_version
    )
  );

  UPDATE public.case_consultations
  SET
    case_insertion_status = CASE
      WHEN case_insertion_status IN ('not_ready', 'review_pending', 'rejected', 'superseded')
        THEN 'approved'
      ELSE case_insertion_status
    END,
    updated_by_profile_id = p_actor_profile_id,
    updated_at = now()
  WHERE id = v_review.consultation_id;

  RETURN v_review;
END;
$$;

COMMENT ON FUNCTION public.approve_consultation_review(uuid, uuid, text) IS
  'Approves a review, supersedes any prior approved review for the same consultation, appends events, and advances case_insertion_status to approved when applicable. Atomic. Does not write case_narratives/documents (deferred to insertion step).';

REVOKE ALL ON FUNCTION public.approve_consultation_review(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_consultation_review(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_consultation_review(uuid, uuid, text) TO service_role;

-- ===========================================================================
-- RPC: insert_consultation_consent
-- Derives case_id + user_id from the consultation; no ownership args.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.insert_consultation_consent(
  p_consultation_id uuid,
  p_consent_type text,
  p_decision text,
  p_notice_version text,
  p_notice_text_hash text,
  p_method text,
  p_consented_at timestamptz DEFAULT NULL,
  p_withdrawn_at timestamptz DEFAULT NULL,
  p_verbal_confirmed boolean DEFAULT false,
  p_verbal_confirmed_by_profile_id uuid DEFAULT NULL,
  p_actor_profile_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.consultation_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_consult public.case_consultations;
  v_row public.consultation_consents;
BEGIN
  SELECT *
    INTO v_consult
  FROM public.case_consultations AS cc
  WHERE cc.id = p_consultation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insert_consultation_consent: consultation % not found', p_consultation_id;
  END IF;

  INSERT INTO public.consultation_consents (
    consultation_id,
    case_id,
    user_id,
    consent_type,
    decision,
    notice_version,
    notice_text_hash,
    method,
    consented_at,
    withdrawn_at,
    verbal_confirmed,
    verbal_confirmed_by_profile_id,
    actor_profile_id,
    metadata
  )
  VALUES (
    v_consult.id,
    v_consult.case_id,
    v_consult.user_id,
    p_consent_type,
    p_decision,
    p_notice_version,
    p_notice_text_hash,
    p_method,
    CASE
      WHEN p_decision = 'granted' THEN COALESCE(p_consented_at, now())
      ELSE p_consented_at
    END,
    CASE
      WHEN p_decision = 'withdrawn' THEN COALESCE(p_withdrawn_at, now())
      ELSE p_withdrawn_at
    END,
    COALESCE(p_verbal_confirmed, false),
    p_verbal_confirmed_by_profile_id,
    p_actor_profile_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.insert_consultation_consent(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  boolean, uuid, uuid, jsonb
) IS
  'Append-only consent event. Derives case_id and user_id from case_consultations. No caller-supplied ownership ids.';

REVOKE ALL ON FUNCTION public.insert_consultation_consent(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  boolean, uuid, uuid, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_consultation_consent(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  boolean, uuid, uuid, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_consultation_consent(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  boolean, uuid, uuid, jsonb
) TO service_role;
