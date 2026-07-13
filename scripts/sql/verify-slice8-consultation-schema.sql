-- Slice 8 verification plan (revised post Step-3 review).
-- Run ONLY after migrations are explicitly approved and applied.
-- Do not run against production without a review window.

-- =============================================================================
-- 0) Shape + Pattern C
-- =============================================================================

-- No FK to auth.users on Slice 8 tables
SELECT c.conname, c.conrelid::regclass, pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
    'case_purchases', 'payment_webhook_events', 'case_consultations',
    'consultation_operations', 'consultation_consents', 'consultation_recordings',
    'consultation_events', 'consultation_reviews', 'staff_roles'
  )
  AND c.contype = 'f'
  AND pg_get_constraintdef(c.oid) ILIKE '%auth.users%';
-- Expected: 0 rows

-- Provider columns on consultations
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'case_consultations'
  AND column_name LIKE '%provider%'
ORDER BY 1;
-- Expected: provider_join_url, provider_session_id, provider_type

-- fulfilment_provider_event_id (not provider_event_id) on purchases
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'case_purchases'
  AND column_name IN ('provider_event_id', 'fulfilment_provider_event_id');
-- Expected: fulfilment_provider_event_id only

-- payment_webhook_events unique ledger exists
SELECT 1
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'payment_webhook_events';

-- current_app_has_role is SECURITY DEFINER
SELECT p.proname, p.prosecdef, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'current_app_has_role';
-- Expect prosecdef = true and search_path = ''

-- =============================================================================
-- 1) Grant matrix proofs (as authenticated)
-- =============================================================================
-- SET ROLE authenticated;
-- SELECT * FROM public.staff_roles;                 -- FAIL
-- SELECT * FROM public.consultation_operations;     -- FAIL
-- SELECT * FROM public.consultation_events;         -- FAIL
-- SELECT * FROM public.payment_webhook_events;      -- FAIL
-- SELECT reviewer_notes FROM public.consultation_reviews; -- FAIL
-- SELECT * FROM public.consultation_reviews;        -- FAIL
-- SELECT meeting_host_url FROM public.consultation_operations; -- FAIL
-- SELECT * FROM public.consultation_reviews_claimant; -- OK (approved only; no reviewer_notes)
-- SELECT * FROM public.case_consultations_claimant;   -- OK (own cases via RLS)
-- RESET ROLE;

SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'staff_roles', 'case_purchases', 'payment_webhook_events',
    'case_consultations', 'consultation_operations', 'consultation_consents',
    'consultation_recordings', 'consultation_events', 'consultation_reviews'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'current_app_has_role',
    'upsert_case_purchase_from_provider',
    'record_payment_webhook_event',
    'create_consultation_from_paid_purchase',
    'assign_consultant',
    'transition_consultation_status',
    'approve_consultation_review',
    'insert_consultation_consent',
    'next_consultation_number'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
ORDER BY routine_name, grantee;

-- =============================================================================
-- 2) Purchase upsert derives owner (no user_id arg)
-- =============================================================================
-- SELECT public.upsert_case_purchase_from_provider(
--   p_case_id := :case_id,
--   p_product_code := 'human_consult_99',
--   p_amount := 99,
--   p_provider_checkout_session_id := 'cs_test_a',
--   p_payment_status := 'paid',
--   p_fulfilment_provider_event_id := 'evt_fulfil_1'
-- );
-- Assert user_id = (SELECT user_id FROM cases WHERE id = :case_id)

-- =============================================================================
-- 3) Webhook event ledger idempotency (refund/dispute)
-- =============================================================================
-- SELECT public.record_payment_webhook_event('stripe','evt_1','checkout.session.completed', ...);
-- SELECT public.record_payment_webhook_event('stripe','evt_1','checkout.session.completed', ...);
-- Assert single row for evt_1
-- SELECT public.record_payment_webhook_event('stripe','evt_refund_1','charge.refunded', purchase_id, ...);
-- Assert second distinct event; case_purchases.fulfilment_provider_event_id unchanged

-- =============================================================================
-- 4) Two consults + numbering
-- =============================================================================
--   consultation_sequence under:
--     pg_advisory_xact_lock(hashtextextended(case_id::text, 87201408))
-- Assert sequences 1,2; CONS-YYYY-NNNNNN distinct; NNNNNN globally increasing
-- Assert unique(case_id, consultation_sequence) and unique(consultation_number)

-- =============================================================================
-- 5) Transition graph enforcement
-- =============================================================================
-- purchased → completed directly must RAISE
-- purchased → awaiting_scheduling must succeed + events

-- =============================================================================
-- 6) Append-only consents/events
-- =============================================================================
-- UPDATE consultation_consents SET decision='withdrawn' WHERE id = ... → RAISE
-- DELETE FROM consultation_events WHERE id = ... → RAISE

-- =============================================================================
-- 7) Consent current-state ordering
-- =============================================================================
-- Insert two events same consultation_id+consent_type with identical recorded_at
-- (or near-identical); assert consultation_consent_current picks higher id
-- (ORDER BY recorded_at DESC, id DESC)

-- =============================================================================
-- 8) Assign / approve / RLS / entitlements (unchanged from prior plan)
-- =============================================================================
-- assign_consultant updates operations only + consultant_assigned event
-- approve second review supersedes first; partial unique holds
-- owner reads safe data; other user 0 rows
-- draft reviews invisible via claimant view
-- create_consultation does not change case_entitlements
-- cases.primary_narrative unchanged
-- authenticated cannot EXECUTE service-role RPCs
