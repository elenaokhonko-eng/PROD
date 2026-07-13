-- Slice 8E: consultation_recordings (thin metadata)
--
-- Draft only — do not apply until explicit approval.
--
-- Storage bucket NOT created here. Future private bucket:
--   consultation-recordings
-- Recommended object path:
--   cases/<case_id>/consultations/<consultation_id>/<recording_id>/source.<ext>
-- Ingestion should use service-role upload + signed URLs (same pattern as evidence).

CREATE TABLE IF NOT EXISTS public.consultation_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL
    REFERENCES public.case_consultations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),

  status text NOT NULL DEFAULT 'awaiting_recording'
    CHECK (status IN (
      'awaiting_recording',
      'available_at_provider',
      'ingesting',
      'stored',
      'failed',
      'deletion_scheduled',
      'deleted'
    )),

  storage_bucket text,
  storage_path text,
  provider_type text,
  provider_asset_id text,
  mime_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  checksum_sha256 text,
  recorded_duration_seconds int CHECK (
    recorded_duration_seconds IS NULL OR recorded_duration_seconds >= 0
  ),
  started_recording_at timestamptz,
  finished_recording_at timestamptz,
  recording_started_by_profile_id uuid REFERENCES public.profiles(id),
  is_active boolean NOT NULL DEFAULT true,

  created_by_profile_id uuid REFERENCES public.profiles(id),
  updated_by_profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consultation_recordings IS
  'Thin recording metadata. Multiple takes per consultation allowed. Bucket consultation-recordings is deferred; path convention documented in comments.';

COMMENT ON COLUMN public.consultation_recordings.storage_bucket IS
  'Expected future value: consultation-recordings';

COMMENT ON COLUMN public.consultation_recordings.storage_path IS
  'cases/<case_id>/consultations/<consultation_id>/<recording_id>/source.<ext>';

COMMENT ON COLUMN public.consultation_recordings.recording_started_by_profile_id IS
  'Optional profile that manually started the recording (consultant/ops). Nullable for provider-auto captures.';

CREATE INDEX IF NOT EXISTS consultation_recordings_consultation_idx
  ON public.consultation_recordings (consultation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS consultation_recordings_case_id_idx
  ON public.consultation_recordings (case_id);

CREATE INDEX IF NOT EXISTS consultation_recordings_active_idx
  ON public.consultation_recordings (consultation_id)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_consultation_recordings_set_updated_at ON public.consultation_recordings;
CREATE TRIGGER trg_consultation_recordings_set_updated_at
  BEFORE UPDATE ON public.consultation_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.consultation_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consultation_recordings_select_own ON public.consultation_recordings;
CREATE POLICY consultation_recordings_select_own
  ON public.consultation_recordings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = consultation_recordings.case_id
        AND c.user_id = public.current_app_user_id()
    )
  );

REVOKE ALL ON TABLE public.consultation_recordings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.consultation_recordings FROM anon, authenticated;
GRANT SELECT ON TABLE public.consultation_recordings TO authenticated;
GRANT ALL ON TABLE public.consultation_recordings TO service_role;
