-- Phase 2 verification (E–I applied)
select to_regclass('public.consultation_recordings') is not null as recordings,
       to_regclass('public.consultation_events') is not null as events,
       to_regclass('public.consultation_reviews') is not null as reviews,
       to_regclass('public.case_consultations_claimant') is not null as consult_view,
       to_regclass('public.consultation_reviews_claimant') is not null as reviews_view;

SELECT column_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='consultation_recordings'
  AND column_name='recording_started_by_profile_id';

SELECT column_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='case_consultations'
  AND column_name LIKE '%provider%'
ORDER BY 1;

SELECT pg_get_constraintdef(c.oid) AS jobs_check
FROM pg_constraint c
JOIN pg_class t ON t.oid=c.conrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname='jobs' AND c.conname='jobs_job_type_check';

SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND grantee='authenticated'
  AND table_name IN (
    'staff_roles','payment_webhook_events','consultation_operations',
    'consultation_events','consultation_reviews',
    'case_purchases','case_consultations','consultation_consents',
    'consultation_recordings'
  )
GROUP BY table_name
ORDER BY 1;

SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE routine_schema='public'
  AND routine_name IN (
    'create_consultation_from_paid_purchase',
    'assign_consultant',
    'transition_consultation_status',
    'approve_consultation_review',
    'insert_consultation_consent'
  )
  AND grantee IN ('anon','authenticated','service_role','PUBLIC')
ORDER BY routine_name, grantee;

-- hashtextextended lock present in create function body
SELECT position('hashtextextended' IN pg_get_functiondef(p.oid)) > 0 AS uses_hashtextextended
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='create_consultation_from_paid_purchase';
