-- Slice 8C: case_consultations + consultation_operations + numbering helpers
--
-- Draft only — do not apply until explicit approval.
--
-- Numbering:
--   consultation_number = CONS-YYYY-NNNNNN
--     YYYY = Asia/Singapore creation year (display only; NOT an annual reset)
--     NNNNNN = globally increasing public.consultation_number_seq (never resets)
--   consultation_sequence = per-case dense 1..N under
--     pg_advisory_xact_lock(hashtextextended(case_id::text, 87201408))
-- Constraints: UNIQUE(consultation_number), UNIQUE(case_id, consultation_sequence)
-- Consultant assignment lives ONLY on consultation_operations (staff-only).

CREATE SEQUENCE IF NOT EXISTS public.consultation_number_seq;

CREATE OR REPLACE FUNCTION public.next_consultation_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year text;
  v_n bigint;
BEGIN
  v_year := to_char(timezone('Asia/Singapore', now()), 'YYYY');
  v_n := nextval('public.consultation_number_seq'::regclass);
  RETURN 'CONS-' || v_year || '-' || lpad(v_n::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION public.next_consultation_number() IS
  'Returns CONS-YYYY-NNNNNN. Numeric component is globally increasing (no yearly reset). YYYY is creation-year label only. UNIQUE(consultation_number) enforces uniqueness.';

REVOKE ALL ON FUNCTION public.next_consultation_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_consultation_number() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_consultation_number() TO service_role;

-- ---------------------------------------------------------------------------
-- case_consultations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.case_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  purchase_id uuid NOT NULL REFERENCES public.case_purchases(id),

  consultation_number text NOT NULL,
  consultation_sequence int NOT NULL CHECK (consultation_sequence >= 1),

  duration_minutes int NOT NULL CHECK (duration_minutes > 0),

  fulfilment_status text NOT NULL DEFAULT 'purchased'
    CHECK (fulfilment_status IN (
      'purchased',
      'awaiting_scheduling',
      'scheduled',
      'in_progress',
      'completed',
      'no_show',
      'cancelled',
      'follow_up_required'
    )),

  recording_status text NOT NULL DEFAULT 'not_requested'
    CHECK (recording_status IN (
      'not_requested',
      'consent_pending',
      'consent_declined',
      'awaiting_recording',
      'available_at_provider',
      'ingesting',
      'stored',
      'failed',
      'deletion_scheduled',
      'deleted'
    )),

  transcription_status text NOT NULL DEFAULT 'not_requested'
    CHECK (transcription_status IN (
      'not_requested',
      'queued',
      'processing',
      'completed',
      'failed',
      'cancelled'
    )),

  case_insertion_status text NOT NULL DEFAULT 'not_ready'
    CHECK (case_insertion_status IN (
      'not_ready',
      'review_pending',
      'approved',
      'inserted',
      'rejected',
      'superseded'
    )),

  scheduled_starts_at timestamptz,
  scheduled_ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Asia/Singapore',

  provider_type text,
  provider_session_id text,
  provider_join_url text,

  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  no_show_at timestamptz,

  inserted_narrative_id uuid REFERENCES public.case_narratives(id) ON DELETE SET NULL,
  inserted_document_id uuid REFERENCES public.case_documents(id) ON DELETE SET NULL,

  created_by_profile_id uuid REFERENCES public.profiles(id),
  updated_by_profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT case_consultations_purchase_unique UNIQUE (purchase_id),
  CONSTRAINT case_consultations_case_sequence_unique UNIQUE (case_id, consultation_sequence),
  CONSTRAINT case_consultations_number_unique UNIQUE (consultation_number),
  CONSTRAINT case_consultations_schedule_order CHECK (
    scheduled_ends_at IS NULL
    OR scheduled_starts_at IS NULL
    OR scheduled_ends_at >= scheduled_starts_at
  )
);

COMMENT ON TABLE public.case_consultations IS
  'One paid human_consult_99 purchase allocates exactly one consultation (UNIQUE purchase_id). Multiple consultations per case are allowed via consultation_sequence.';

COMMENT ON COLUMN public.case_consultations.user_id IS
  'Denormalized application owner UUID (profiles.id / cases.user_id). Authoritative ownership is via case_id → cases.user_id = current_app_user_id().';

COMMENT ON COLUMN public.case_consultations.provider_type IS
  'Meeting/session vendor key: zoom | google_meet | teams | phone | manual | ...';

COMMENT ON COLUMN public.case_consultations.provider_session_id IS
  'Vendor meeting/session identifier (not Stripe).';

COMMENT ON COLUMN public.case_consultations.provider_join_url IS
  'Claimant-safe join URL. Host URL belongs on consultation_operations.';

CREATE INDEX IF NOT EXISTS case_consultations_case_id_idx
  ON public.case_consultations (case_id);

CREATE INDEX IF NOT EXISTS case_consultations_user_id_idx
  ON public.case_consultations (user_id);

CREATE INDEX IF NOT EXISTS case_consultations_fulfilment_idx
  ON public.case_consultations (fulfilment_status, created_at DESC);

DROP TRIGGER IF EXISTS trg_case_consultations_set_updated_at ON public.case_consultations;
CREATE TRIGGER trg_case_consultations_set_updated_at
  BEFORE UPDATE ON public.case_consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.case_consultations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- consultation_operations (staff-only 1:1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.consultation_operations (
  consultation_id uuid PRIMARY KEY
    REFERENCES public.case_consultations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,

  assigned_consultant_profile_id uuid REFERENCES public.profiles(id),
  assigned_at timestamptz,
  assigned_by_profile_id uuid REFERENCES public.profiles(id),

  internal_notes text,
  ops_labels text[] NOT NULL DEFAULT '{}'::text[],
  meeting_host_url text,

  last_ops_actor_profile_id uuid REFERENCES public.profiles(id),
  created_by_profile_id uuid REFERENCES public.profiles(id),
  updated_by_profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consultation_operations IS
  'Staff-only operational fields for a consultation. Claimants must never SELECT this table. Consultant assignment lives here only.';

CREATE INDEX IF NOT EXISTS consultation_operations_case_id_idx
  ON public.consultation_operations (case_id);

CREATE INDEX IF NOT EXISTS consultation_operations_consultant_idx
  ON public.consultation_operations (assigned_consultant_profile_id)
  WHERE assigned_consultant_profile_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_consultation_operations_set_updated_at ON public.consultation_operations;
CREATE TRIGGER trg_consultation_operations_set_updated_at
  BEFORE UPDATE ON public.consultation_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.consultation_operations ENABLE ROW LEVEL SECURITY;
-- Intentionally no authenticated policies.

REVOKE ALL ON TABLE public.consultation_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.consultation_operations FROM anon, authenticated;
GRANT ALL ON TABLE public.consultation_operations TO service_role;

-- Temporary grants for consultations; refined in 8H with views.
REVOKE ALL ON TABLE public.case_consultations FROM PUBLIC;
REVOKE ALL ON TABLE public.case_consultations FROM anon;
REVOKE ALL ON TABLE public.case_consultations FROM authenticated;
GRANT SELECT ON TABLE public.case_consultations TO authenticated;
GRANT ALL ON TABLE public.case_consultations TO service_role;

DROP POLICY IF EXISTS case_consultations_select_own ON public.case_consultations;
CREATE POLICY case_consultations_select_own
  ON public.case_consultations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = case_consultations.case_id
        AND c.user_id = public.current_app_user_id()
    )
  );
