-- Slice 8I: widen jobs.job_type CHECK for future consultation jobs
--
-- Draft only — do not apply until explicit approval.
-- Does NOT change worker behavior and does NOT enqueue these job types.

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname
    INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'jobs'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%job_type%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jobs DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_job_type_check
  CHECK (job_type IN (
    'post_payment_report_generation',
    'consultation_recording_ingest',
    'consultation_transcribe',
    'consultation_summarise',
    'consultation_case_insert'
  ));

COMMENT ON CONSTRAINT jobs_job_type_check ON public.jobs IS
  'Slice 8 adds consultation_* placeholders. Worker must continue to handle only post_payment_report_generation until a later slice branches on job_type.';
