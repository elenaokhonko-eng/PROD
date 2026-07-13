-- Phase 1 verification (A–D applied)
select to_regclass('public.staff_roles') as staff_roles,
       to_regclass('public.case_purchases') as case_purchases,
       to_regclass('public.payment_webhook_events') as payment_webhook_events,
       to_regclass('public.case_consultations') as case_consultations,
       to_regclass('public.consultation_operations') as consultation_operations,
       to_regclass('public.consultation_consents') as consultation_consents;

SELECT c.conname, c.conrelid::regclass::text AS table_name
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
    'case_purchases','payment_webhook_events','case_consultations',
    'consultation_operations','consultation_consents','staff_roles'
  )
  AND c.contype = 'f'
  AND pg_get_constraintdef(c.oid) ILIKE '%auth.users%';

SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND grantee='authenticated'
  AND table_name IN (
    'staff_roles','case_purchases','payment_webhook_events',
    'case_consultations','consultation_operations','consultation_consents'
  )
ORDER BY table_name, privilege_type;

SELECT p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='current_app_has_role';

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema='public'
  AND routine_name IN (
    'current_app_has_role',
    'upsert_case_purchase_from_provider',
    'record_payment_webhook_event',
    'next_consultation_number'
  )
  AND grantee IN ('anon','authenticated','service_role','PUBLIC')
ORDER BY routine_name, grantee;

SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='case_purchases'
  AND column_name IN ('provider_event_id','fulfilment_provider_event_id')
ORDER BY 1;
