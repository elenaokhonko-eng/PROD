-- Extract document-readiness snapshot columns on case_extract_runs.
-- Historical rows remain NULL (no backfill). No triggers.

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS allow_partial_evidence boolean;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS total_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS evidence_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS ready_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS queued_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS processing_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS uploaded_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS failed_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS not_ready_document_count integer;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS document_snapshot_at timestamptz;

ALTER TABLE public.case_extract_runs
  ADD COLUMN IF NOT EXISTS evidence_snapshot jsonb;

COMMENT ON COLUMN public.case_extract_runs.allow_partial_evidence IS
  'true when extract ran while not_ready docs existed. NULL=historical. New extracts write true/false.';

COMMENT ON COLUMN public.case_extract_runs.total_document_count IS
  'Snapshot: total case_documents at extract time.';

COMMENT ON COLUMN public.case_extract_runs.evidence_document_count IS
  'Snapshot: usable ready docs with extraction/content at extract time.';

COMMENT ON COLUMN public.case_extract_runs.ready_document_count IS
  'Snapshot: ready+processed+has_extraction docs at extract time (same as evidence_document_count).';

COMMENT ON COLUMN public.case_extract_runs.queued_document_count IS
  'Snapshot: queued docs at extract time.';

COMMENT ON COLUMN public.case_extract_runs.processing_document_count IS
  'Snapshot: in-flight processing docs at extract time.';

COMMENT ON COLUMN public.case_extract_runs.uploaded_document_count IS
  'Snapshot: uploaded (pre-queue) docs at extract time.';

COMMENT ON COLUMN public.case_extract_runs.failed_document_count IS
  'Snapshot: failed docs at extract time (settled, non-blocking).';

COMMENT ON COLUMN public.case_extract_runs.not_ready_document_count IS
  'Snapshot: docs that would block extract unless allow_partial_evidence.';

COMMENT ON COLUMN public.case_extract_runs.document_snapshot_at IS
  'When the document readiness snapshot was taken.';

COMMENT ON COLUMN public.case_extract_runs.evidence_snapshot IS
  'Optional JSON: counts + document id lists only (ready/failed/not_ready).';
