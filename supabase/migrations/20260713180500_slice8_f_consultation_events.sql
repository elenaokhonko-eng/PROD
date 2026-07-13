-- Slice 8F: consultation_events (append-only audit)
--
-- Draft only — do not apply until explicit approval.
-- Claimants: no SELECT/INSERT in MVP (staff/service-role only).
-- Product may later expose a filtered claimant view of selected event types.

CREATE TABLE IF NOT EXISTS public.consultation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL
    REFERENCES public.case_consultations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,

  event_type text NOT NULL CHECK (event_type IN (
    'purchased',
    'awaiting_scheduling',
    'scheduled',
    'rescheduled',
    'consultant_assigned',
    'in_progress',
    'completed',
    'no_show',
    'cancelled',
    'follow_up_required',
    'recording_consent_granted',
    'recording_consent_declined',
    'recording_started',
    'recording_stopped',
    'transcription_queued',
    'transcription_completed',
    'transcription_failed',
    'review_created',
    'review_approved',
    'review_superseded',
    'inserted_into_case',
    -- dimension-status transitions not covered by the named aliases above
    'fulfilment_status_changed',
    'recording_status_changed',
    'transcription_status_changed',
    'case_insertion_status_changed'
  )),

  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN (
      'system',
      'claimant',
      'consultant',
      'consult_operations',
      'admin'
    )),
  actor_profile_id uuid REFERENCES public.profiles(id),

  from_value text,
  to_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consultation_events IS
  'Append-only consultation lifecycle audit. Written in the same transaction as status/assignment mutations by service-role RPCs. No updated_at.';

CREATE INDEX IF NOT EXISTS consultation_events_consultation_created_idx
  ON public.consultation_events (consultation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS consultation_events_case_id_idx
  ON public.consultation_events (case_id);

CREATE INDEX IF NOT EXISTS consultation_events_type_idx
  ON public.consultation_events (event_type, created_at DESC);

ALTER TABLE public.consultation_events ENABLE ROW LEVEL SECURITY;
-- No authenticated policies (MVP staff/service only).

REVOKE ALL ON TABLE public.consultation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.consultation_events FROM anon;
REVOKE ALL ON TABLE public.consultation_events FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.consultation_events TO service_role;

DROP TRIGGER IF EXISTS trg_consultation_events_append_only ON public.consultation_events;
CREATE TRIGGER trg_consultation_events_append_only
  BEFORE UPDATE OR DELETE ON public.consultation_events
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_append_only_mutation();
