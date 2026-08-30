ALTER TABLE public.jobs DROP CONSTRAINT jobs_worker_document_binding_check;

INSERT INTO public.case_documents (
  id, case_id, filename, original_filename, processing_status, is_processed
)
VALUES (
  '93000000-0000-4000-8000-000000000031',
  '20000000-0000-0000-0000-000000000001',
  'report-binding.pdf', 'report-binding.pdf', 'uploaded', false
);

INSERT INTO public.jobs (
  id, case_id, user_id, document_id, job_type, status, payload
)
VALUES (
  '94000000-0000-4000-8000-000000000031',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '93000000-0000-4000-8000-000000000031',
  'post_payment_report_generation', 'queued', '{}'::jsonb
);
