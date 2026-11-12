ALTER TABLE public.jobs DROP CONSTRAINT jobs_job_type_check;

INSERT INTO public.jobs (id, case_id, user_id, job_type, status, payload)
VALUES (
  '94000000-0000-4000-8000-000000000011',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'stale_provider_job', 'queued', '{}'::jsonb
);
