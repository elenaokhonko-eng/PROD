ALTER TABLE public.jobs DROP CONSTRAINT jobs_worker_document_binding_check;

INSERT INTO public.jobs (id, case_id, user_id, job_type, status, payload)
VALUES (
  '94000000-0000-4000-8000-000000000021',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'evidence_document_processing', 'queued', '{}'::jsonb
);
