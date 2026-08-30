DROP INDEX public.jobs_evidence_document_unique_idx;

INSERT INTO public.case_documents (
  id, case_id, filename, original_filename, processing_status, is_processed
)
VALUES (
  '93000000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'duplicate-job.pdf', 'duplicate-job.pdf', 'queued', false
);

INSERT INTO public.jobs (
  id, case_id, user_id, document_id, job_type, status, payload
)
VALUES
  (
    '94000000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    'evidence_document_processing', 'queued', '{}'::jsonb
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    'evidence_document_processing', 'queued', '{}'::jsonb
  );
