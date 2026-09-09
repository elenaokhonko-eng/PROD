-- Pattern C migration and authorization integration tests.
-- Run through scripts/test-pattern-c-security.ts against local Supabase only.

BEGIN;

DO $$
DECLARE
  v_count integer;
  v_hash text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class source_table ON source_table.oid = c.conrelid
    JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
    WHERE c.contype = 'f'
      AND source_schema.nspname = 'public'
      AND c.confrelid = 'auth.users'::regclass
      AND source_table.relname <> 'user_entitlements'
  ) THEN
    RAISE EXCEPTION 'application identity foreign keys must not reference auth.users';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'cases',
      'case_documents',
      'case_collaborators',
      'case_intake',
      'evidence',
      'invitations',
      'profiles',
      'case_responses',
      'case_outcomes',
      'payments',
      'jobs',
      'case_document_extractions',
      'case_extract_runs',
      'case_narratives',
      'case_validation_runs',
      'case_validation_gap_items',
      'case_decision_runs',
      'reports',
      'case_entitlements',
      'privacy_deletion_requests'
    ]) AS expected(table_name)
    LEFT JOIN pg_class c
      ON c.oid = to_regclass(format('public.%I', expected.table_name))
    WHERE c.oid IS NULL OR NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'a Pattern C table is missing row-level security';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = ANY (ARRAY[
        'cases',
        'case_documents',
        'case_collaborators',
        'case_intake',
        'evidence',
        'invitations',
        'profiles',
        'case_responses',
        'case_outcomes',
        'payments',
        'jobs',
        'case_document_extractions',
        'case_extract_runs',
        'case_narratives',
        'case_validation_runs',
        'case_validation_gap_items',
        'case_decision_runs',
        'reports',
        'case_entitlements',
        'privacy_deletion_requests'
      ])
      AND (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~* 'auth\.uid\(|auth\.users'
  ) THEN
    RAISE EXCEPTION 'Pattern C policies must not depend on auth.uid() or auth.users';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'complaints',
      'v_case_validation_gap_items',
      'v_latest_validation',
      'v_latest_validation_run',
      'case_documents_enriched'
    ]) AS expected(view_name)
    JOIN pg_class c ON c.oid = to_regclass(format('public.%I', expected.view_name))
    WHERE NOT coalesce(c.reloptions @> ARRAY['security_invoker=true']::text[], false)
  ) THEN
    RAISE EXCEPTION 'a user-facing view is missing security_invoker=true';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'cases',
      'case_documents',
      'case_collaborators',
      'case_intake',
      'evidence',
      'invitations',
      'profiles',
      'case_responses',
      'case_outcomes',
      'payments',
      'jobs',
      'case_document_extractions',
      'case_extract_runs',
      'case_narratives',
      'case_validation_runs',
      'case_validation_gap_items',
      'case_decision_runs',
      'reports',
      'case_entitlements',
      'analytics_events',
      'consent_logs',
      'referrals',
      'router_sessions',
      'privacy_deletion_requests',
      'complaints',
      'v_case_validation_gap_items',
      'v_latest_validation',
      'v_latest_validation_run',
      'case_documents_enriched'
    ]) AS sensitive(relation_name)
    WHERE has_table_privilege('anon', format('public.%I', sensitive.relation_name), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', sensitive.relation_name), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', sensitive.relation_name), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', sensitive.relation_name), 'DELETE')
       OR has_any_column_privilege('anon', format('public.%I', sensitive.relation_name), 'SELECT')
       OR has_any_column_privilege('anon', format('public.%I', sensitive.relation_name), 'INSERT')
       OR has_any_column_privilege('anon', format('public.%I', sensitive.relation_name), 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'anon retains a privilege on a Pattern C relation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'case_documents',
      'jobs',
      'case_document_extractions',
      'case_extract_runs',
      'case_narratives',
      'case_validation_runs',
      'case_validation_gap_items',
      'case_decision_runs',
      'reports',
      'case_entitlements'
    ]) AS derived(table_name)
    WHERE NOT has_table_privilege('authenticated', format('public.%I', derived.table_name), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', derived.table_name), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', derived.table_name), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', derived.table_name), 'DELETE')
  ) THEN
    RAISE EXCEPTION 'authenticated pipeline-table grants are not read-only';
  END IF;

  IF has_function_privilege('anon', 'public.current_app_user_id()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bootstrap_case_v1(text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_case_invitation(uuid,text,public.user_role,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cancel_case_invitation(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.accept_case_invitation(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_case_collaborator_status(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ensure_my_referral_code()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_my_consent(text[],text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.request_privacy_deletion()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute Pattern C identity or mutation functions';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.current_app_user_id()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.bootstrap_case_v1(text,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_case_invitation(uuid,text,public.user_role,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cancel_case_invitation(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.accept_case_invitation(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_case_collaborator_status(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ensure_my_referral_code()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.record_my_consent(text[],text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.request_privacy_deletion()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated is missing a required Pattern C function grant';
  END IF;

  IF to_regprocedure('public.anonymize_my_cases()') IS NOT NULL THEN
    RAISE EXCEPTION 'immediate privacy anonymization function must not exist';
  END IF;

  IF pg_get_functiondef('public.claim_next_job()'::regprocedure)
       !~ 'post_payment_report_generation'
     OR pg_get_functiondef('public.claim_next_job()'::regprocedure)
       !~ 'evidence_document_processing'
     OR pg_get_functiondef('public.claim_next_job()'::regprocedure)
       ~ 'consultation_recording_ingest' THEN
    RAISE EXCEPTION 'worker claim function must include only supported report and evidence job types';
  END IF;

  IF pg_get_functiondef('public.claim_next_job()'::regprocedure)
       !~ 'Recovered abandoned worker lease'
     OR pg_get_functiondef('public.claim_next_job()'::regprocedure)
       !~ 'worker_lease_interval_v1' THEN
    RAISE EXCEPTION 'report worker claim function must recover abandoned leases using the canonical lease interval';
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.cases
  WHERE id = '20000000-0000-0000-0000-000000000001'
    AND user_id = '10000000-0000-0000-0000-000000000001'
    AND owner_user_id = user_id
    AND creator_user_id = '10000000-0000-0000-0000-000000000002';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'legacy case ownership was not reconciled safely';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs
    WHERE id = '30000000-0000-0000-0000-000000000001'
      AND user_id = '10000000-0000-0000-0000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.reports
    WHERE id = '40000000-0000-0000-0000-000000000001'
      AND user_id = '10000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'legacy child ownership was not reconciled from the case owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.case_collaborators
    WHERE id = '50000000-0000-0000-0000-000000000001'
      AND role = 'helper'
      AND can_view
      AND can_edit
      AND NOT can_invite
      AND invited_by = '10000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'legacy collaborator permissions were not normalized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.invitations
    WHERE id = '60000000-0000-0000-0000-000000000001'
      AND status = 'cancelled'
      AND invitee_email = 'cancelled+60000000-0000-0000-0000-000000000001@invalid.guidebuoy.local'
      AND invitation_token IS NULL
      AND invitation_token_hash ~ '^[0-9a-f]{64}$'
      AND expires_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'weak legacy invitation was not cancelled and normalized';
  END IF;

  SELECT pg_catalog.encode(extensions.digest(repeat('a', 64), 'sha256'), 'hex')
  INTO v_hash;
  IF NOT EXISTS (
    SELECT 1
    FROM public.invitations
    WHERE id = '60000000-0000-0000-0000-000000000002'
      AND status = 'pending'
      AND invitee_email = 'legacy.recipient@example.test'
      AND invitation_token IS NULL
      AND invitation_token_hash = v_hash
  ) THEN
    RAISE EXCEPTION 'valid legacy invitation token was not hashed and normalized';
  END IF;
END;
$$;

INSERT INTO public.profiles (id, email, full_name)
VALUES
  ('10000000-0000-0000-0000-000000000003', 'reader@example.test', 'Read Only'),
  ('10000000-0000-0000-0000-000000000004', 'new.owner@example.test', 'New Owner'),
  ('10000000-0000-0000-0000-000000000005', 'expired@example.test', 'Expired Invitee'),
  ('10000000-0000-0000-0000-000000000006', 'conflict@example.test', 'Conflict Invitee'),
  ('10000000-0000-0000-0000-000000000007', 'takeover@example.test', 'Takeover Owner');

INSERT INTO public.case_collaborators (
  case_id,
  user_id,
  invited_by,
  invited_email,
  role,
  permissions,
  can_view,
  can_edit,
  can_invite,
  status,
  accepted_at,
  expires_at
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'reader@example.test',
  'defendant',
  ARRAY['read']::text[],
  true,
  false,
  false,
  'active',
  now(),
  now() + interval '1 hour'
);

INSERT INTO public.case_extract_runs (
  id,
  case_id,
  extract_json,
  model_name,
  prompt_version,
  skip_validation
) VALUES (
  '70000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '{}'::jsonb,
  'pattern-c-test',
  'pattern-c-test-v1',
  true
);

INSERT INTO public.cases (id, user_id, claim_type, status, case_summary)
VALUES (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'phishing_scam',
  'draft',
  'Transfer conflict fixture'
);

INSERT INTO public.invitations (
  id,
  case_id,
  inviter_user_id,
  invitee_email,
  role,
  invitation_token,
  status,
  expires_at
) VALUES
  (
    '60000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'expired@example.test',
    'helper',
    repeat('e', 64),
    'pending',
    now() - interval '1 minute'
  ),
  (
    '60000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'conflict@example.test',
    'lead_victim',
    repeat('c', 64),
    'pending',
    now() + interval '1 day'
  );

UPDATE public.cases
SET user_id = '10000000-0000-0000-0000-000000000007'
WHERE id = '20000000-0000-0000-0000-000000000002';

UPDATE public.case_collaborators
SET status = 'revoked',
    revoked_at = now(),
    expires_at = now() - interval '1 hour'
WHERE id = '50000000-0000-0000-0000-000000000001';

INSERT INTO public.case_collaborators (
  id,
  case_id,
  user_id,
  invited_by,
  invited_email,
  role,
  permissions,
  can_view,
  can_edit,
  can_invite,
  status,
  accepted_at,
  revoked_at,
  expires_at
) VALUES (
  '50000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'legacy.owner@example.test',
  'helper',
  ARRAY['read', 'write']::text[],
  true,
  true,
  false,
  'revoked',
  now() - interval '2 hours',
  now() - interval '1 hour',
  now() - interval '1 hour'
);

INSERT INTO public.case_collaborators (
  case_id,
  user_id,
  invited_by,
  invited_email,
  role,
  permissions,
  can_view,
  can_edit,
  can_invite,
  status,
  accepted_at
) VALUES (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000007',
  'legacy.owner@example.test',
  'lead_victim',
  ARRAY['read', 'write', 'invite']::text[],
  true,
  true,
  true,
  'active',
  now()
);

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_case_id constant uuid := '20000000-0000-0000-0000-000000000001';
  v_owner constant uuid := '10000000-0000-0000-0000-000000000001';
  v_helper constant uuid := '10000000-0000-0000-0000-000000000002';
  v_reader constant uuid := '10000000-0000-0000-0000-000000000003';
  v_new_owner constant uuid := '10000000-0000-0000-0000-000000000004';
  v_expired constant uuid := '10000000-0000-0000-0000-000000000005';
  v_conflict constant uuid := '10000000-0000-0000-0000-000000000006';
  v_count integer;
  v_token text;
  v_helper_token text;
  v_consent_id uuid;
  v_request_id uuid;
  v_second_request_id uuid;
  v_bootstrap_case_id uuid;
  v_transferred boolean;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'clerk-owner',
      'role', 'authenticated',
      'supabase_uuid', v_owner::text
    )::text,
    true
  );

  IF public.current_app_user_id() IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'valid supabase_uuid claim was not resolved';
  END IF;

  SELECT count(*)::integer INTO v_count FROM public.cases WHERE id = v_case_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'owner cannot read own case';
  END IF;

  UPDATE public.cases SET case_summary = 'owner update' WHERE id = v_case_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'owner cannot update own case';
  END IF;

  SELECT public.bootstrap_case_v1(
    'Atomic Pattern C bootstrap test',
    NULL,
    'phishing_scam',
    repeat('a', 64),
    repeat('b', 64)
  ) INTO v_bootstrap_case_id;
  IF v_bootstrap_case_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.case_intake
    WHERE case_id = v_bootstrap_case_id
      AND narrative_text = 'Atomic Pattern C bootstrap test'
  ) THEN
    RAISE EXCEPTION 'atomic case bootstrap did not create its intake row';
  END IF;
  IF public.bootstrap_case_v1(
    'Atomic Pattern C bootstrap test',
    NULL,
    'phishing_scam',
    repeat('a', 64),
    repeat('b', 64)
  ) IS DISTINCT FROM v_bootstrap_case_id THEN
    RAISE EXCEPTION 'case bootstrap retry created a second case';
  END IF;

  BEGIN
    PERFORM public.bootstrap_case_v1(
      'Changed bootstrap payload',
      NULL,
      'phishing_scam',
      repeat('a', 64),
      repeat('e', 64)
    );
    RAISE EXCEPTION 'bootstrap idempotency key accepted a different payload';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%idempotency key reused with different request%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.bootstrap_case_v1(
      'Atomic Pattern C rollback test',
      NULL,
      'invalid_claim_type',
      repeat('c', 64),
      repeat('d', 64)
    );
    RAISE EXCEPTION 'invalid bootstrap unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  IF EXISTS (
    SELECT 1
    FROM public.cases
    WHERE primary_narrative = 'Atomic Pattern C rollback test'
  ) THEN
    RAISE EXCEPTION 'failed bootstrap left an orphan case';
  END IF;

  SELECT public.record_my_consent(ARRAY['analytics', 'privacy'], 'pattern-c-v1')
  INTO v_consent_id;
  IF v_consent_id IS NULL THEN
    RAISE EXCEPTION 'trusted consent RPC returned no identifier';
  END IF;

  SELECT request_id INTO v_request_id FROM public.request_privacy_deletion();
  SELECT request_id INTO v_second_request_id FROM public.request_privacy_deletion();
  IF v_request_id IS NULL OR v_request_id IS DISTINCT FROM v_second_request_id THEN
    RAISE EXCEPTION 'privacy deletion request is not idempotent';
  END IF;

  SELECT invitation_token
  INTO v_token
  FROM public.create_case_invitation(
    v_case_id,
    ' NEW.OWNER@EXAMPLE.TEST ',
    'lead_victim'::public.user_role,
    'Pattern C transfer test'
  );
  IF v_token IS NULL OR length(v_token) < 32 THEN
    RAISE EXCEPTION 'invitation RPC did not return a strong one-time token';
  END IF;

  SELECT invitation_token
  INTO v_helper_token
  FROM public.create_case_invitation(
    v_case_id,
    'legacy.helper@example.test',
    'helper'::public.user_role,
    'Expired collaborator reactivation test'
  );
  IF v_helper_token IS NULL THEN
    RAISE EXCEPTION 'helper reactivation invitation returned no token';
  END IF;

  IF NOT public.set_case_collaborator_status(
    (SELECT id FROM public.case_collaborators WHERE case_id = v_case_id AND user_id = v_reader),
    'revoked'
  ) OR NOT public.set_case_collaborator_status(
    (SELECT id FROM public.case_collaborators WHERE case_id = v_case_id AND user_id = v_reader),
    'active'
  ) THEN
    RAISE EXCEPTION 'collaborator status reactivation failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.case_collaborators
    WHERE case_id = v_case_id
      AND user_id = v_reader
      AND status = 'active'
      AND expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'status reactivation retained collaborator expiry';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'clerk-helper',
      'role', 'authenticated',
      'supabase_uuid', v_helper::text
    )::text,
    true
  );

  SELECT count(*)::integer INTO v_count
  FROM public.accept_case_invitation(v_helper_token);
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.case_collaborators
    WHERE case_id = v_case_id
      AND user_id = v_helper
      AND status = 'active'
      AND expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invitation reactivation retained collaborator expiry';
  END IF;

  SELECT count(*)::integer INTO v_count FROM public.cases WHERE id = v_case_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active helper cannot read the case';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.jobs
  WHERE id = '30000000-0000-0000-0000-000000000001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active helper cannot read an authorized job';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.case_extract_runs
  WHERE id = '70000000-0000-0000-0000-000000000001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active helper cannot read an authorized extract run';
  END IF;

  UPDATE public.cases SET case_summary = 'helper update' WHERE id = v_case_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active helper cannot edit the case';
  END IF;
  IF NOT public.app_case_permission(v_case_id, 'edit') THEN
    RAISE EXCEPTION 'active helper failed the edge mutation permission probe';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'clerk-reader',
      'role', 'authenticated',
      'supabase_uuid', v_reader::text
    )::text,
    true
  );

  SELECT count(*)::integer INTO v_count FROM public.cases WHERE id = v_case_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'read-only collaborator cannot read the case';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.jobs
  WHERE id = '30000000-0000-0000-0000-000000000001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'read-only collaborator cannot read an authorized job';
  END IF;

  UPDATE public.cases SET case_summary = 'reader must not update' WHERE id = v_case_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'read-only collaborator updated the case';
  END IF;
  IF public.app_case_permission(v_case_id, 'edit') THEN
    RAISE EXCEPTION 'read-only collaborator passed the edge mutation permission probe';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'clerk-new-owner',
      'role', 'authenticated',
      'supabase_uuid', v_new_owner::text
    )::text,
    true
  );

  SELECT count(*)::integer INTO v_count FROM public.cases WHERE id = v_case_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unrelated profile can read the case';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.cases WHERE id = v_bootstrap_case_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unrelated profile can read an atomically bootstrapped case';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.jobs
  WHERE id = '30000000-0000-0000-0000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unrelated profile can read a derived case row';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"clerk-missing"}', true);
  IF public.current_app_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'missing supabase_uuid claim did not fail closed';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.cases WHERE id = v_case_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'missing supabase_uuid claim can read a case';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"clerk-malformed","supabase_uuid":"not-a-uuid"}',
    true
  );
  IF public.current_app_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'malformed supabase_uuid claim did not fail closed';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.cases WHERE id = v_case_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'malformed supabase_uuid claim can read a case';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'clerk-expired',
      'role', 'authenticated',
      'supabase_uuid', v_expired::text
    )::text,
    true
  );
  SELECT count(*)::integer INTO v_count
  FROM public.accept_case_invitation(repeat('e', 64));
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'expired invitation was accepted';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'clerk-conflict',
      'role', 'authenticated',
      'supabase_uuid', v_conflict::text
    )::text,
    true
  );
  BEGIN
    PERFORM 1 FROM public.accept_case_invitation(repeat('c', 64));
    RAISE EXCEPTION 'stale ownership transfer should fail atomically';
  EXCEPTION
    WHEN SQLSTATE '40001' THEN
      NULL;
  END;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'clerk-new-owner',
      'role', 'authenticated',
      'supabase_uuid', v_new_owner::text
    )::text,
    true
  );
  SELECT count(*)::integer, bool_or(ownership_transferred)
  INTO v_count, v_transferred
  FROM public.accept_case_invitation(v_token);
  IF v_count <> 1 OR v_transferred IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'valid ownership invitation did not transfer ownership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = v_case_id
      AND user_id = v_new_owner
      AND owner_user_id = v_new_owner
  ) THEN
    RAISE EXCEPTION 'new owner cannot observe transferred canonical ownership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs
    WHERE id = '30000000-0000-0000-0000-000000000001'
      AND user_id = v_new_owner
  ) OR NOT EXISTS (
    SELECT 1 FROM public.reports
    WHERE id = '40000000-0000-0000-0000-000000000001'
      AND user_id = v_new_owner
  ) THEN
    RAISE EXCEPTION 'ownership transfer did not propagate to child owner columns';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.case_collaborators
    WHERE case_id = v_case_id AND user_id = v_new_owner
  ) THEN
    RAISE EXCEPTION 'new owner retained a redundant collaborator row';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.case_collaborators
    WHERE case_id = v_case_id
      AND user_id = v_owner
      AND role = 'helper'
      AND status = 'active'
      AND can_view
      AND can_edit
      AND NOT can_invite
      AND expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'former owner was not retained as a non-expiring active helper';
  END IF;
END;
$$;

RESET ROLE;

DO $$
DECLARE
  v_count integer;
  v_index integer;
  v_payment public.payments;
  v_upload_case_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.consent_logs
    WHERE user_id = '10000000-0000-0000-0000-000000000001'
      AND email = 'legacy.owner@example.test'
      AND consent_purposes = ARRAY['analytics', 'privacy']::text[]
      AND policy_version = 'pattern-c-v1'
  ) THEN
    RAISE EXCEPTION 'trusted consent RPC did not derive canonical identity and email';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.privacy_deletion_requests
  WHERE user_id = '10000000-0000-0000-0000-000000000001'
    AND status = 'pending';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'privacy workflow did not retain one pending reviewed request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = '20000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'privacy request deleted case data';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invitations
    WHERE id = '60000000-0000-0000-0000-000000000003'
      AND status = 'expired'
      AND accepted_at IS NULL
      AND accepted_by IS NULL
  ) THEN
    RAISE EXCEPTION 'expired invitation was not closed safely';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invitations
    WHERE id = '60000000-0000-0000-0000-000000000004'
      AND status = 'pending'
      AND accepted_at IS NULL
      AND accepted_by IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.case_collaborators
    WHERE case_id = '20000000-0000-0000-0000-000000000002'
      AND user_id = '10000000-0000-0000-0000-000000000006'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = '20000000-0000-0000-0000-000000000002'
      AND user_id = '10000000-0000-0000-0000-000000000007'
  ) THEN
    RAISE EXCEPTION 'failed ownership transfer did not roll back atomically';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = '20000000-0000-0000-0000-000000000001'
      AND creator_user_id = '10000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'ownership transfer rewrote historical creator identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '10000000-0000-0000-0000-000000000001'
      AND referral_count = 2
  ) THEN
    RAISE EXCEPTION 'accepted invitation referrals were not counted exactly once each';
  END IF;

  SELECT id INTO v_upload_case_id
  FROM public.cases
  WHERE primary_narrative = 'Atomic Pattern C bootstrap test';
  IF v_upload_case_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap case is unavailable for upload quota testing';
  END IF;

  FOR v_index IN 1..10 LOOP
    PERFORM public.register_evidence_upload_v1(
      v_upload_case_id,
      '10000000-0000-0000-0000-000000000001',
      format('quota-%s.pdf', v_index),
      format('%s/evidence/quota-%s.pdf', v_upload_case_id, v_index),
      'application/pdf',
      52428800,
      'Quota boundary test',
      'evidence'
    );
  END LOOP;

  BEGIN
    PERFORM public.register_evidence_upload_v1(
      v_upload_case_id,
      '10000000-0000-0000-0000-000000000001',
      'quota-overflow.pdf',
      format('%s/evidence/quota-overflow.pdf', v_upload_case_id),
      'application/pdf',
      1,
      'Quota overflow test',
      'evidence'
    );
    RAISE EXCEPTION 'case upload quota allowed more than 500 MiB';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%case storage quota exceeded%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.payments (
    id, user_id, case_id, amount, currency, service_type, payment_status
  ) VALUES (
    '70000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    18,
    'SGD',
    'standard',
    'pending'
  );

  -- Hosted Checkout may not expose a PaymentIntent when the session is created.
  -- The signed completion atomically binds its final PaymentIntent below.
  INSERT INTO public.case_purchases (
    id, case_id, user_id, purchased_by_profile_id, product_code,
    payment_provider, amount, currency, payment_status,
    provider_checkout_session_id, metadata,
    created_by_profile_id, updated_by_profile_id
  ) VALUES (
    '70000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000004',
    'self_serve_report', 'stripe', 18, 'SGD', 'pending',
    'cs_pattern_c_completion',
    jsonb_build_object(
      'legacy_payment_id', '70000000-0000-0000-0000-000000000001',
      'checkout_product_key', 'self_serve_report'
    ),
    '10000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000004'
  );
  PERFORM public.mark_case_purchase_paid_v1(
    '70000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    'self_serve_report', 18, 'SGD',
    'cs_pattern_c_completion', 'pi_pattern_c_completion',
    'evt_pattern_c_completion', '{}'::jsonb
  );

  SELECT * INTO v_payment
  FROM public.complete_legacy_payment_v1(
    '70000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    18,
    'SGD',
    'standard',
    'pi_pattern_c_completion'
  );
  IF v_payment.payment_status <> 'completed'
    OR v_payment.stripe_payment_intent_id <> 'pi_pattern_c_completion' THEN
    RAISE EXCEPTION 'legacy completion did not assign the final PaymentIntent';
  END IF;

  BEGIN
    PERFORM public.complete_legacy_payment_v1(
      '70000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000004',
      18,
      'SGD',
      'standard',
      'pi_conflicting_completion'
    );
    RAISE EXCEPTION 'legacy completion accepted a conflicting PaymentIntent';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%canonical purchase linkage mismatch%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.payments (
      id, user_id, case_id, amount, currency, service_type, payment_status,
      stripe_payment_intent_id
    ) VALUES (
      '70000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000001',
      18,
      'SGD',
      'standard',
      'completed',
      'pi_pattern_c_completion'
    );
    RAISE EXCEPTION 'duplicate PaymentIntent identity was accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.payments (
    id, user_id, case_id, amount, currency, service_type, payment_status
  ) VALUES (
    '70000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    99,
    'SGD',
    'human_consult_30m',
    'pending'
  );
  INSERT INTO public.case_purchases (
    id, case_id, user_id, purchased_by_profile_id, product_code,
    payment_provider, amount, currency, payment_status,
    provider_checkout_session_id, metadata,
    created_by_profile_id, updated_by_profile_id
  ) VALUES (
    '70000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000004',
    'human_consult_99', 'stripe', 99, 'SGD', 'pending',
    'cs_pattern_c_historic_consult',
    jsonb_build_object(
      'legacy_payment_id', '70000000-0000-0000-0000-000000000004',
      'checkout_product_key', 'human_consult_30m'
    ),
    '10000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000004'
  );
  PERFORM public.mark_case_purchase_paid_v1(
    '70000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    'human_consult_99', 99, 'SGD',
    'cs_pattern_c_historic_consult', 'pi_pattern_c_historic_consult',
    'evt_pattern_c_historic_consult', '{}'::jsonb
  );
  SELECT * INTO v_payment
  FROM public.complete_legacy_payment_v1(
    '70000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    99,
    'SGD',
    'human_consult_30m',
    'pi_pattern_c_historic_consult'
  );
  IF v_payment.payment_status <> 'completed'
    OR v_payment.stripe_payment_intent_id <> 'pi_pattern_c_historic_consult' THEN
    RAISE EXCEPTION 'historic consultation completion did not record the verified payment';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.case_consultations
    WHERE purchase_id = '70000000-0000-0000-0000-000000000005'
  ) THEN
    RAISE EXCEPTION 'historic consultation completion allocated a consultation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.case_entitlements
    WHERE case_id = '20000000-0000-0000-0000-000000000001'
      AND purchase_ref = 'cs_pattern_c_historic_consult'
  ) THEN
    RAISE EXCEPTION 'historic consultation completion created an entitlement';
  END IF;

  BEGIN
    UPDATE public.cases
    SET user_id = NULL
    WHERE id = '20000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'owner-required case accepted NULL ownership';
  EXCEPTION
    WHEN not_null_violation THEN
      IF SQLERRM NOT LIKE '%case_owner_required_by_dependent_records%' THEN
        RAISE;
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = '20000000-0000-0000-0000-000000000001'
      AND user_id = '10000000-0000-0000-0000-000000000004'
  ) THEN
    RAISE EXCEPTION 'rejected NULL ownership mutation changed the case owner';
  END IF;

  RAISE NOTICE 'Pattern C migration and authorization integration tests passed';
END;
$$;

DO $$
DECLARE
  v_owner_id constant uuid := '10000000-0000-0000-0000-000000000004';
  v_scenario record;
  v_event text;
  v_case_id uuid;
  v_purchase_id uuid;
  v_payment_id uuid;
  v_payment_intent_id text;
  v_checkout_session_id text;
  v_fulfilment_event_id text;
  v_idempotency_key text;
  v_count integer;
  v_status text;
  v_refunded_amount numeric;
BEGIN
  FOR v_scenario IN
    SELECT *
    FROM (
      VALUES
        ('partial', ARRAY['partial']::text[], 'partially_refunded', 5::numeric),
        ('full', ARRAY['full']::text[], 'refunded', 18::numeric),
        ('dispute', ARRAY['dispute']::text[], 'disputed', 0::numeric),
        ('partial_dispute', ARRAY['partial', 'dispute']::text[], 'disputed', 5::numeric),
        ('dispute_partial', ARRAY['dispute', 'partial']::text[], 'disputed', 5::numeric),
        ('full_dispute', ARRAY['full', 'dispute']::text[], 'refunded', 18::numeric),
        ('dispute_full', ARRAY['dispute', 'full']::text[], 'refunded', 18::numeric)
    ) AS scenarios(name, events, expected_status, expected_refund)
  LOOP
    v_case_id := gen_random_uuid();
    v_purchase_id := gen_random_uuid();
    v_payment_id := gen_random_uuid();
    v_payment_intent_id := 'pi_lifecycle_' || v_scenario.name;
    v_checkout_session_id := 'cs_lifecycle_' || v_scenario.name;
    v_fulfilment_event_id := 'evt_lifecycle_' || v_scenario.name;
    v_idempotency_key := 'lifecycle:' || v_scenario.name;

    INSERT INTO public.cases (
      id, user_id, owner_user_id, creator_user_id, claim_type, status, case_summary
    ) VALUES (
      v_case_id, v_owner_id, v_owner_id, v_owner_id,
      'phishing_scam', 'draft', 'Lifecycle permutation ' || v_scenario.name
    );
    INSERT INTO public.payments (
      id, user_id, case_id, amount, currency, service_type, payment_status
    ) VALUES (
      v_payment_id, v_owner_id, v_case_id, 18, 'SGD', 'standard', 'pending'
    );
    INSERT INTO public.case_purchases (
      id, case_id, user_id, purchased_by_profile_id, product_code,
      payment_provider, amount, currency, payment_status, metadata,
      created_by_profile_id, updated_by_profile_id
    ) VALUES (
      v_purchase_id, v_case_id, v_owner_id, v_owner_id, 'self_serve_report',
      'stripe', 18, 'SGD', 'pending',
      jsonb_build_object(
        'legacy_payment_id', v_payment_id::text,
        'checkout_product_key', 'self_serve_report'
      ),
      v_owner_id, v_owner_id
    );
    INSERT INTO public.reports (case_id, user_id, status, report_json)
    VALUES (v_case_id, v_owner_id, 'DRAFT', jsonb_build_object('immutable_test', true));

    PERFORM public.mark_case_purchase_paid_v1(
      v_purchase_id, v_case_id, 'self_serve_report', 18, 'SGD',
      v_checkout_session_id, v_payment_intent_id, v_fulfilment_event_id, '{}'::jsonb
    );
    PERFORM public.complete_legacy_payment_v1(
      v_payment_id, v_case_id, v_owner_id, 18, 'SGD', 'standard', v_payment_intent_id
    );
    PERFORM public.enqueue_post_payment_report_generation(
      v_case_id, v_owner_id, v_idempotency_key, v_payment_id
    );

    -- Duplicate completion delivery must be harmless at every durable boundary.
    PERFORM public.mark_case_purchase_paid_v1(
      v_purchase_id, v_case_id, 'self_serve_report', 18, 'SGD',
      v_checkout_session_id, v_payment_intent_id, v_fulfilment_event_id, '{}'::jsonb
    );
    PERFORM public.complete_legacy_payment_v1(
      v_payment_id, v_case_id, v_owner_id, 18, 'SGD', 'standard', v_payment_intent_id
    );
    PERFORM public.enqueue_post_payment_report_generation(
      v_case_id, v_owner_id, v_idempotency_key, v_payment_id
    );

    FOREACH v_event IN ARRAY v_scenario.events LOOP
      IF v_event = 'partial' THEN
        PERFORM public.record_case_purchase_refund_v1(
          v_purchase_id, v_payment_intent_id, 5, 'SGD'
        );
        PERFORM public.record_case_purchase_refund_v1(
          v_purchase_id, v_payment_intent_id, 5, 'SGD'
        );
      ELSIF v_event = 'full' THEN
        PERFORM public.record_case_purchase_refund_v1(
          v_purchase_id, v_payment_intent_id, 18, 'SGD'
        );
        PERFORM public.record_case_purchase_refund_v1(
          v_purchase_id, v_payment_intent_id, 18, 'SGD'
        );
      ELSIF v_event = 'dispute' THEN
        PERFORM public.record_case_purchase_dispute_v1(
          v_purchase_id, v_payment_intent_id, pg_catalog.now()
        );
        PERFORM public.record_case_purchase_dispute_v1(
          v_purchase_id, v_payment_intent_id, pg_catalog.now()
        );
      END IF;
    END LOOP;

    -- A completion retry after refund/dispute repairs a failed legacy side effect
    -- without moving the canonical monetary lifecycle backward.
    UPDATE public.payments
    SET payment_status = 'failed'
    WHERE id = v_payment_id;
    PERFORM public.mark_case_purchase_paid_v1(
      v_purchase_id, v_case_id, 'self_serve_report', 18, 'SGD',
      v_checkout_session_id, v_payment_intent_id, v_fulfilment_event_id, '{}'::jsonb
    );
    PERFORM public.complete_legacy_payment_v1(
      v_payment_id, v_case_id, v_owner_id, 18, 'SGD', 'standard', v_payment_intent_id
    );
    PERFORM public.enqueue_post_payment_report_generation(
      v_case_id, v_owner_id, v_idempotency_key, v_payment_id
    );

    SELECT payment_status, COALESCE(refunded_amount, 0)
    INTO v_status, v_refunded_amount
    FROM public.case_purchases
    WHERE id = v_purchase_id;
    IF v_status IS DISTINCT FROM v_scenario.expected_status
       OR v_refunded_amount IS DISTINCT FROM v_scenario.expected_refund THEN
      RAISE EXCEPTION 'lifecycle % regressed: status %, refund %',
        v_scenario.name, v_status, v_refunded_amount;
    END IF;

    SELECT count(*)::integer INTO v_count
    FROM public.case_purchases
    WHERE case_id = v_case_id AND product_code = 'self_serve_report';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'lifecycle % created % canonical purchases', v_scenario.name, v_count;
    END IF;
    SELECT count(*)::integer INTO v_count
    FROM public.jobs
    WHERE case_id = v_case_id
      AND job_type = 'post_payment_report_generation'
      AND idempotency_key = v_idempotency_key;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'lifecycle % created % report jobs', v_scenario.name, v_count;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE id = v_payment_id
        AND payment_status = 'completed'
        AND stripe_payment_intent_id = v_payment_intent_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.case_entitlements
      WHERE case_id = v_case_id
        AND plan IN ('self_serve_report', 'escalation_pack')
        AND features @> '{"allow_self_serve_report":true}'::jsonb
    ) OR NOT EXISTS (
      SELECT 1 FROM public.reports
      WHERE case_id = v_case_id
        AND report_json @> '{"immutable_test":true}'::jsonb
    ) THEN
      RAISE EXCEPTION 'lifecycle % revoked fulfilment capability or artefact state', v_scenario.name;
    END IF;

    DELETE FROM public.jobs WHERE case_id = v_case_id;
    DELETE FROM public.case_entitlements WHERE case_id = v_case_id;
    DELETE FROM public.reports WHERE case_id = v_case_id;
    DELETE FROM public.case_purchases WHERE case_id = v_case_id;
    DELETE FROM public.payments WHERE case_id = v_case_id;
    DELETE FROM public.cases WHERE id = v_case_id;
  END LOOP;

  RAISE NOTICE 'Payment lifecycle precedence and duplicate-delivery tests passed';
END;
$$;

DO $$
DECLARE
  v_owner_id constant uuid := '10000000-0000-0000-0000-000000000004';
  v_status text;
  v_case_id uuid;
  v_purchase_id uuid;
  v_payment_id uuid;
  v_payment_intent_id text;
  v_checkout_session_id text;
  v_reservation record;
  v_actual_status text;
  v_count integer;
BEGIN
  -- Established monetary states must reconcile exactly once and must never
  -- release the case for another checkout reservation.
  FOREACH v_status IN ARRAY ARRAY['paid', 'partially_refunded', 'refunded', 'disputed'] LOOP
    v_case_id := gen_random_uuid();
    v_purchase_id := gen_random_uuid();
    v_payment_id := gen_random_uuid();
    v_payment_intent_id := 'pi_unfulfilled_' || v_status || '_' || replace(v_purchase_id::text, '-', '');
    v_checkout_session_id := 'cs_unfulfilled_' || v_status || '_' || replace(v_purchase_id::text, '-', '');

    INSERT INTO public.cases (
      id, user_id, owner_user_id, creator_user_id, claim_type, status, case_summary
    ) VALUES (
      v_case_id, v_owner_id, v_owner_id, v_owner_id,
      'phishing_scam', 'draft', 'Established purchase recovery ' || v_status
    );
    INSERT INTO public.payments (
      id, user_id, case_id, amount, currency, service_type, payment_status
    ) VALUES (
      v_payment_id, v_owner_id, v_case_id, 18, 'SGD', 'standard', 'pending'
    );
    INSERT INTO public.case_purchases (
      id, case_id, user_id, purchased_by_profile_id, product_code,
      payment_provider, amount, currency, payment_status, metadata,
      created_by_profile_id, updated_by_profile_id
    ) VALUES (
      v_purchase_id, v_case_id, v_owner_id, v_owner_id, 'self_serve_report',
      'stripe', 18, 'SGD', 'pending',
      jsonb_build_object('legacy_payment_id', v_payment_id::text),
      v_owner_id, v_owner_id
    );
    PERFORM public.mark_case_purchase_paid_v1(
      v_purchase_id, v_case_id, 'self_serve_report', 18, 'SGD',
      v_checkout_session_id, v_payment_intent_id,
      'evt_unfulfilled_' || v_status || '_' || replace(v_purchase_id::text, '-', ''),
      '{}'::jsonb
    );

    IF v_status = 'partially_refunded' THEN
      PERFORM public.record_case_purchase_refund_v1(
        v_purchase_id, v_payment_intent_id, 5, 'SGD'
      );
    ELSIF v_status = 'refunded' THEN
      PERFORM public.record_case_purchase_refund_v1(
        v_purchase_id, v_payment_intent_id, 18, 'SGD'
      );
    ELSIF v_status = 'disputed' THEN
      PERFORM public.record_case_purchase_dispute_v1(
        v_purchase_id, v_payment_intent_id, pg_catalog.now()
      );
    END IF;

    SELECT * INTO v_reservation
    FROM public.reserve_checkout_purchase_v1(v_case_id, 'self_serve_report', v_owner_id);
    IF v_reservation.reservation_disposition IS DISTINCT FROM 'reconcile_established'
      OR v_reservation.case_purchase_id IS DISTINCT FROM v_purchase_id THEN
      RAISE EXCEPTION 'established % purchase was made eligible for another checkout', v_status;
    END IF;
    SELECT count(*)::integer INTO v_count
    FROM public.payments
    WHERE case_id = v_case_id;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'established % purchase created % legacy payment rows', v_status, v_count;
    END IF;

    PERFORM public.reconcile_established_case_purchase_fulfilment_v1(v_purchase_id, v_owner_id);
    PERFORM public.reconcile_established_case_purchase_fulfilment_v1(v_purchase_id, v_owner_id);

    SELECT payment_status INTO v_actual_status
    FROM public.case_purchases
    WHERE id = v_purchase_id;
    IF v_actual_status IS DISTINCT FROM v_status THEN
      RAISE EXCEPTION 'reconciliation regressed established % lifecycle to %', v_status, v_actual_status;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE id = v_payment_id
        AND payment_status = 'completed'
        AND stripe_payment_intent_id = v_payment_intent_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.case_entitlements
      WHERE case_id = v_case_id
        AND features @> '{"allow_self_serve_report":true}'::jsonb
    ) THEN
      RAISE EXCEPTION 'reconciliation did not restore established % fulfilment', v_status;
    END IF;
    SELECT count(*)::integer INTO v_count
    FROM public.jobs
    WHERE case_id = v_case_id
      AND job_type = 'post_payment_report_generation'
      AND idempotency_key = v_checkout_session_id;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'reconciliation created % report jobs for established % purchase', v_count, v_status;
    END IF;

    DELETE FROM public.jobs WHERE case_id = v_case_id;
    DELETE FROM public.case_entitlements WHERE case_id = v_case_id;
    DELETE FROM public.case_purchases WHERE case_id = v_case_id;
    DELETE FROM public.payments WHERE case_id = v_case_id;
    DELETE FROM public.cases WHERE id = v_case_id;
  END LOOP;

  RAISE NOTICE 'Established purchase reconciliation and duplicate-charge tests passed';
END;
$$;

DO $$
DECLARE
  v_owner_id constant uuid := '10000000-0000-0000-0000-000000000004';
  v_case_id uuid := gen_random_uuid();
  v_purchase_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_payment_intent_id text := 'pi_tier2_recovery_' || replace(v_purchase_id::text, '-', '');
  v_checkout_session_id text := 'cs_tier2_recovery_' || replace(v_purchase_id::text, '-', '');
  v_count integer;
BEGIN
  INSERT INTO public.cases (
    id, user_id, owner_user_id, creator_user_id, claim_type, status, case_summary
  ) VALUES (
    v_case_id, v_owner_id, v_owner_id, v_owner_id,
    'phishing_scam', 'draft', 'Tier 2 established purchase recovery'
  );
  INSERT INTO public.payments (
    id, user_id, case_id, amount, currency, service_type, payment_status
  ) VALUES (
    v_payment_id, v_owner_id, v_case_id, 188, 'SGD', 'fidrec_tier2_pack', 'failed'
  );
  INSERT INTO public.case_purchases (
    id, case_id, user_id, purchased_by_profile_id, product_code,
    payment_provider, amount, currency, payment_status,
    provider_checkout_session_id, provider_payment_intent_id,
    fulfilment_provider_event_id, metadata,
    created_by_profile_id, updated_by_profile_id
  ) VALUES (
    v_purchase_id, v_case_id, v_owner_id, v_owner_id, 'escalation_pack',
    'stripe', 188, 'SGD', 'disputed',
    v_checkout_session_id, v_payment_intent_id,
    'evt_tier2_recovery_' || replace(v_purchase_id::text, '-', ''),
    jsonb_build_object('legacy_payment_id', v_payment_id::text),
    v_owner_id, v_owner_id
  );

  PERFORM public.reconcile_established_case_purchase_fulfilment_v1(v_purchase_id, v_owner_id);
  PERFORM public.reconcile_established_case_purchase_fulfilment_v1(v_purchase_id, v_owner_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.case_entitlements
    WHERE case_id = v_case_id
      AND plan = 'escalation_pack'
      AND features @> '{"allow_self_serve_report":true,"allow_escalation_pack":true}'::jsonb
  ) OR NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE id = v_payment_id
      AND payment_status = 'completed'
      AND stripe_payment_intent_id = v_payment_intent_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.case_purchases
    WHERE id = v_purchase_id
      AND payment_status = 'disputed'
  ) THEN
    RAISE EXCEPTION 'Tier 2 reconciliation did not preserve monetary state and retained capabilities';
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.jobs
  WHERE case_id = v_case_id
    AND job_type = 'post_payment_report_generation';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Tier 2 reconciliation created an unexpected report job';
  END IF;

  DELETE FROM public.case_entitlements WHERE case_id = v_case_id;
  DELETE FROM public.case_purchases WHERE case_id = v_case_id;
  DELETE FROM public.payments WHERE case_id = v_case_id;
  DELETE FROM public.cases WHERE id = v_case_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.reject_atomic_dispatch_test()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_type = 'evidence_document_processing'
     AND EXISTS (
       SELECT 1
       FROM public.case_documents AS d
       WHERE d.id = NEW.document_id
         AND d.storage_path LIKE '%/atomic-rollback.pdf'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'test_forced_dispatch_failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_worker_lease_denied(
  p_operation text,
  p_job_id uuid,
  p_case_id uuid,
  p_locked_at timestamptz,
  p_document_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    IF p_operation = 'heartbeat' THEN
      PERFORM public.heartbeat_worker_job_v1(
        p_job_id, p_case_id, p_locked_at, p_document_id
      );
    ELSIF p_operation = 'defer' THEN
      PERFORM public.defer_worker_job_v1(
        p_job_id, p_case_id, p_locked_at, p_document_id, 'stale worker defer'
      );
    ELSIF p_operation = 'edge' THEN
      PERFORM public.consume_edge_request_v1(
        gen_random_uuid(),
        'evidence_processed_v2',
        repeat('e', 64),
        'worker',
        p_actor_id::text,
        p_case_id,
        p_document_id,
        p_job_id,
        p_locked_at,
        pg_catalog.now()
      );
    ELSIF p_operation = 'write' THEN
      PERFORM public.commit_evidence_processing_v1(
        p_job_id,
        p_case_id,
        p_locked_at,
        p_document_id,
        gen_random_uuid(),
        NULL,
        '{}'::jsonb,
        '{}'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb
      );
    ELSIF p_operation = 'settle' THEN
      PERFORM public.settle_worker_job_v1(
        p_job_id, p_case_id, p_locked_at, p_document_id, 'completed'
      );
    ELSE
      RAISE EXCEPTION 'unknown worker lease test operation: %', p_operation;
    END IF;
    RAISE EXCEPTION 'stale worker operation was accepted: %', p_operation;
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%worker_lease_lost%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_case_id constant uuid := '20000000-0000-0000-0000-000000000001';
  v_owner_id constant uuid := '10000000-0000-0000-0000-000000000004';
  v_expired_actor_id constant uuid := '10000000-0000-0000-0000-000000000005';
  v_evidence_id constant uuid := '84000000-0000-4000-8000-000000000001';
  v_expired_evidence_id constant uuid := '84000000-0000-4000-8000-000000000002';
  v_rollback_evidence_id constant uuid := '84000000-0000-4000-8000-000000000003';
  v_bad_category_evidence_id constant uuid := '84000000-0000-4000-8000-000000000004';
  v_first_dispatch jsonb;
  v_second_dispatch jsonb;
  v_count integer;
BEGIN
  INSERT INTO public.case_collaborators (
    case_id, user_id, invited_by, invited_email, role, permissions, status,
    accepted_at, expires_at, can_view, can_edit, can_invite
  ) VALUES (
    v_case_id, v_expired_actor_id, v_owner_id, 'expired.helper@example.test',
    'helper', ARRAY['read', 'write']::text[], 'active',
    pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '1 hour',
    true, true, false
  )
  ON CONFLICT (case_id, user_id) DO UPDATE
  SET status = 'active', can_view = true, can_edit = true, can_invite = false,
      expires_at = pg_catalog.now() - interval '1 hour';

  BEGIN
    PERFORM public.register_evidence_upload_v1(
      v_case_id,
      v_expired_actor_id,
      'expired.pdf',
      v_case_id::text || '/evidence/expired.pdf',
      'application/pdf',
      128,
      'Expired collaborator upload denial',
      'evidence'
    );
    RAISE EXCEPTION 'expired collaborator registered an upload';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%case edit access required%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.evidence (
    id, case_id, user_id, filename, file_path, file_type, file_size, description, category
  ) VALUES
    (
      v_evidence_id, v_case_id, v_owner_id, 'atomic.pdf',
      v_case_id::text || '/evidence/atomic.pdf', 'application/pdf', 128,
      'Atomic dispatch success', 'evidence'
    ),
    (
      v_expired_evidence_id, v_case_id, v_expired_actor_id, 'expired-process.pdf',
      v_case_id::text || '/evidence/expired-process.pdf', 'application/pdf', 128,
      'Expired collaborator process denial', 'evidence'
    ),
    (
      v_rollback_evidence_id, v_case_id, v_owner_id, 'atomic-rollback.pdf',
      v_case_id::text || '/evidence/atomic-rollback.pdf', 'application/pdf', 128,
      'Atomic dispatch rollback', 'evidence'
    ),
    (
      v_bad_category_evidence_id, v_case_id, v_owner_id, 'category-mismatch.pdf',
      v_case_id::text || '/evidence/category-mismatch.pdf', 'application/pdf', 128,
      'Category binding denial', 'bank_communication'
    );

  BEGIN
    PERFORM public.register_and_enqueue_evidence_v1(
      v_case_id, v_expired_evidence_id, v_expired_actor_id
    );
    RAISE EXCEPTION 'expired collaborator dispatched evidence processing';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%evidence_dispatch_denied%' THEN
        RAISE;
      END IF;
  END;

  SELECT public.register_and_enqueue_evidence_v1(
    v_case_id, v_evidence_id, v_owner_id
  ) INTO v_first_dispatch;
  SELECT public.register_and_enqueue_evidence_v1(
    v_case_id, v_evidence_id, v_owner_id
  ) INTO v_second_dispatch;

  IF v_first_dispatch->>'document_id' IS DISTINCT FROM v_second_dispatch->>'document_id'
     OR v_first_dispatch->>'job_id' IS DISTINCT FROM v_second_dispatch->>'job_id'
     OR (v_first_dispatch->>'created_document')::boolean IS DISTINCT FROM true
     OR (v_second_dispatch->>'created_document')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'atomic evidence dispatch was not idempotent: first %, second %',
      v_first_dispatch, v_second_dispatch;
  END IF;

  BEGIN
    PERFORM public.register_and_enqueue_evidence_v1(
      v_case_id, v_bad_category_evidence_id, v_owner_id
    );
    RAISE EXCEPTION 'evidence category/path mismatch was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM NOT LIKE '%invalid_evidence_storage_binding%' THEN
        RAISE;
      END IF;
  END;

  EXECUTE 'CREATE TRIGGER trg_test_atomic_dispatch_failure
    BEFORE INSERT ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_atomic_dispatch_test()';
  BEGIN
    PERFORM public.register_and_enqueue_evidence_v1(
      v_case_id, v_rollback_evidence_id, v_owner_id
    );
    RAISE EXCEPTION 'forced evidence enqueue failure unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%test_forced_dispatch_failure%' THEN
        RAISE;
      END IF;
  END;
  EXECUTE 'DROP TRIGGER trg_test_atomic_dispatch_failure ON public.jobs';

  SELECT count(*)::integer INTO v_count
  FROM public.case_documents
  WHERE storage_bucket = 'evidence'
    AND storage_path = v_case_id::text || '/evidence/atomic-rollback.pdf';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'document registration survived failed atomic enqueue';
  END IF;

  DELETE FROM public.jobs
  WHERE id = (v_first_dispatch->>'job_id')::uuid;
  DELETE FROM public.case_documents
  WHERE id = (v_first_dispatch->>'document_id')::uuid;
  DELETE FROM public.evidence
  WHERE id IN (
    v_evidence_id,
    v_expired_evidence_id,
    v_rollback_evidence_id,
    v_bad_category_evidence_id
  );

  RAISE NOTICE 'Atomic evidence dispatch and expired collaborator tests passed';
END;
$$;

DO $$
DECLARE
  v_case_id constant uuid := '20000000-0000-0000-0000-000000000001';
  v_owner_id constant uuid := '10000000-0000-0000-0000-000000000004';
  v_outsider_id constant uuid := '10000000-0000-0000-0000-000000000005';
  v_document_id constant uuid := '80000000-0000-0000-0000-000000000001';
  v_unfinished_document_id constant uuid := '80000000-0000-0000-0000-000000000002';
  v_request_id constant uuid := '81000000-0000-4000-8000-000000000001';
  v_attempt_b constant uuid := '82000000-0000-4000-8000-000000000002';
  v_job_a public.jobs;
  v_job_b public.jobs;
  v_job_result public.jobs;
  v_count integer;
  v_operation text;
BEGIN
  IF has_function_privilege(
       'anon',
       'public.consume_edge_request_v1(uuid,text,text,text,text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.consume_edge_request_v1(uuid,text,text,text,text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.enqueue_evidence_processing_v1(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.enqueue_evidence_processing_v1(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.is_case_document_ready_v1(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.is_case_document_ready_v1(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.purge_edge_request_nonces_v1(integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.purge_edge_request_nonces_v1(integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'privileged Edge or evidence functions are callable by public roles';
  END IF;
  IF NOT has_function_privilege(
       'service_role',
       'public.is_case_document_ready_v1(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.purge_edge_request_nonces_v1(integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'service role lacks document-readiness or nonce-retention operations';
  END IF;

  BEGIN
    PERFORM public.consume_edge_request_v1(
      '81000000-0000-4000-8000-000000000099',
      'run_case_extract_v4',
      repeat('a', 64),
      'user',
      v_owner_id::text,
      v_case_id,
      NULL,
      NULL,
      NULL,
      now() - interval '10 minutes'
    );
    RAISE EXCEPTION 'stale signed Edge request was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%stale_edge_request%' THEN RAISE; END IF;
  END;

  PERFORM public.consume_edge_request_v1(
    v_request_id,
    'run_case_extract_v4',
    repeat('b', 64),
    'user',
    v_owner_id::text,
    v_case_id,
    NULL,
    NULL,
    NULL,
    now()
  );

  BEGIN
    PERFORM public.consume_edge_request_v1(
      v_request_id,
      'run_case_extract_v4',
      repeat('b', 64),
      'user',
      v_owner_id::text,
      v_case_id,
      NULL,
      NULL,
      NULL,
      now()
    );
    RAISE EXCEPTION 'replayed signed Edge request was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%replayed_edge_request%' THEN RAISE; END IF;
  END;

  UPDATE public.edge_request_nonces
  SET retain_until = pg_catalog.now() - interval '1 second'
  WHERE request_id = v_request_id;
  SELECT public.purge_edge_request_nonces_v1(1) INTO v_count;
  IF v_count <> 1 OR EXISTS (
    SELECT 1 FROM public.edge_request_nonces WHERE request_id = v_request_id
  ) THEN
    RAISE EXCEPTION 'bounded nonce retention purge did not remove exactly one expired request';
  END IF;

  BEGIN
    PERFORM public.consume_edge_request_v1(
      '81000000-0000-4000-8000-000000000098',
      'run_case_extract_v4',
      repeat('c', 64),
      'user',
      v_outsider_id::text,
      v_case_id,
      NULL,
      NULL,
      NULL,
      now()
    );
    RAISE EXCEPTION 'signed user request escaped canonical case authorization';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%edge_case_edit_denied%' THEN RAISE; END IF;
  END;

  INSERT INTO public.case_documents (
    id, case_id, filename, original_filename, processing_status, is_processed
  ) VALUES (
    v_document_id, v_case_id, 'durable-evidence.pdf', 'durable-evidence.pdf', 'uploaded', false
  );

  UPDATE public.jobs
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = '30000000-0000-0000-0000-000000000001';

  INSERT INTO public.jobs (
    id, case_id, user_id, job_type, status, payload, created_at
  ) VALUES (
    '83000000-0000-4000-8000-000000000001',
    v_case_id,
    v_owner_id,
    'consultation_transcribe',
    'queued',
    '{}'::jsonb,
    now() - interval '1 hour'
  );

  SELECT * INTO v_job_a
  FROM public.enqueue_evidence_processing_v1(v_case_id, v_document_id, v_owner_id);
  PERFORM public.enqueue_evidence_processing_v1(v_case_id, v_document_id, v_owner_id);

  SELECT count(*)::integer INTO v_count
  FROM public.jobs
  WHERE job_type = 'evidence_document_processing'
    AND document_id = v_document_id
    AND idempotency_key = 'evidence-document:' || v_document_id::text;
  IF v_count <> 1 OR v_job_a.status <> 'queued' THEN
    RAISE EXCEPTION 'duplicate durable evidence enqueue did not retain one queued logical job';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.case_documents
    WHERE id = v_document_id AND processing_status = 'queued'
  ) THEN
    RAISE EXCEPTION 'durable evidence enqueue did not persist document queue state';
  END IF;

  ALTER TABLE public.jobs DISABLE TRIGGER trg_jobs_set_updated_at;
  UPDATE public.jobs
  SET status = 'running',
      locked_at = now() - interval '20 minutes',
      started_at = now() - interval '20 minutes',
      updated_at = now() - interval '20 minutes'
  WHERE id = v_job_a.id
  RETURNING * INTO v_job_a;
  ALTER TABLE public.jobs ENABLE TRIGGER trg_jobs_set_updated_at;

  FOREACH v_operation IN ARRAY ARRAY['heartbeat', 'defer', 'edge', 'write', 'settle']::text[] LOOP
    PERFORM pg_temp.assert_worker_lease_denied(
      v_operation, v_job_a.id, v_case_id, v_job_a.locked_at, v_document_id, v_owner_id
    );
  END LOOP;
  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs
    WHERE id = v_job_a.id
      AND status = 'running'
      AND locked_at IS NOT DISTINCT FROM v_job_a.locked_at
      AND updated_at IS NOT DISTINCT FROM v_job_a.updated_at
  ) THEN
    RAISE EXCEPTION 'expired lease revived or mutated itself before reclaim';
  END IF;

  SELECT * INTO v_job_b FROM public.claim_next_job();
  IF v_job_b.id IS DISTINCT FROM v_job_a.id
     OR v_job_b.status <> 'running'
     OR v_job_b.locked_at IS NOT DISTINCT FROM v_job_a.locked_at
     OR v_job_b.retry_count <> v_job_a.retry_count + 1 THEN
    RAISE EXCEPTION 'expired evidence lease was not reclaimed with a new immutable fence (A %, B %, status %, locks % / %, retries % / %)',
      v_job_a.id, v_job_b.id, v_job_b.status, v_job_a.locked_at, v_job_b.locked_at,
      v_job_a.retry_count, v_job_b.retry_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.jobs
    WHERE id = '83000000-0000-4000-8000-000000000001'
      AND status = 'queued'
  ) THEN
    RAISE EXCEPTION 'worker claimed an unsupported consultation job';
  END IF;

  FOREACH v_operation IN ARRAY ARRAY['heartbeat', 'defer', 'edge', 'write', 'settle']::text[] LOOP
    PERFORM pg_temp.assert_worker_lease_denied(
      v_operation, v_job_a.id, v_case_id, v_job_a.locked_at, v_document_id, v_owner_id
    );
  END LOOP;
  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs
    WHERE id = v_job_b.id
      AND status = 'running'
      AND locked_at IS NOT DISTINCT FROM v_job_b.locked_at
  ) THEN
    RAISE EXCEPTION 'stale worker A mutated worker B lease state';
  END IF;

  PERFORM public.consume_edge_request_v1(
    '81000000-0000-4000-8000-000000000002',
    'evidence_processed_v2',
    repeat('d', 64),
    'worker',
    v_owner_id::text,
    v_case_id,
    v_document_id,
    v_job_b.id,
    v_job_b.locked_at,
    now()
  );

  BEGIN
    PERFORM public.begin_evidence_processing_v1(
      v_job_a.id, v_case_id, v_job_a.locked_at, v_document_id,
      '82000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'expired lease A wrote evidence state after lease B reclaimed the job';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%worker_lease_lost%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.settle_worker_job_v1(
      v_job_a.id, v_case_id, v_job_a.locked_at, v_document_id, 'completed'
    );
    RAISE EXCEPTION 'expired lease A completed the job after lease B reclaimed it';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%worker_lease_lost%' THEN RAISE; END IF;
  END;

  PERFORM public.begin_evidence_processing_v1(
    v_job_b.id, v_case_id, v_job_b.locked_at, v_document_id, v_attempt_b
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.case_documents
    WHERE id = v_document_id
      AND processing_status = 'parsing'
      AND processing_request_id = v_attempt_b
  ) THEN
    RAISE EXCEPTION 'current lease B could not persist evidence attempt state';
  END IF;

  BEGIN
    PERFORM public.fail_evidence_processing_v1(
      v_job_a.id, v_case_id, v_job_a.locked_at, v_document_id,
      v_attempt_b, 'stale worker overwrite'
    );
    RAISE EXCEPTION 'expired lease A overwrote lease B evidence attempt';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%worker_lease_lost%' THEN RAISE; END IF;
  END;

  INSERT INTO public.case_documents (
    id, case_id, filename, original_filename, processing_status, is_processed
  ) VALUES (
    v_unfinished_document_id,
    v_case_id,
    'unfinished-evidence.pdf',
    'unfinished-evidence.pdf',
    'uploaded',
    false
  );

  PERFORM public.commit_evidence_processing_v1(
    v_job_b.id,
    v_case_id,
    v_job_b.locked_at,
    v_document_id,
    v_attempt_b,
    NULL,
    jsonb_build_object(
      'model', 'test-model',
      'prompt_version', 'test-content-v1',
      'pipeline_version', 'test-pipeline-v1',
      'text_content', 'Ready evidence content',
      'content_json', '{}'::jsonb,
      'parse_status', 'success'
    ),
    jsonb_build_object(
      'decision', 'accepted',
      'model', 'test-model',
      'prompt_version', 'test-verification-v1'
    ),
    '[]'::jsonb,
    jsonb_build_object(
      'extraction_type', 'summary_v1',
      'schema_version', 'v1',
      'extracted_json', '{}'::jsonb,
      'model', 'test-model',
      'prompt_version', 'test-summary-v1'
    ),
    NULL,
    '{}'::jsonb
  );
  IF NOT public.is_case_document_ready_v1(v_case_id, v_document_id)
     OR public.is_case_document_ready_v1(v_case_id, v_unfinished_document_id) THEN
    RAISE EXCEPTION 'canonical document readiness disagrees with committed and unfinished evidence states';
  END IF;

  SELECT * INTO v_job_result
  FROM public.settle_worker_job_v1(
    v_job_b.id, v_case_id, v_job_b.locked_at, v_document_id, 'completed'
  );
  IF v_job_result.status <> 'completed' OR v_job_result.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'current lease B did not complete and release the durable evidence job';
  END IF;

  PERFORM public.enqueue_post_payment_report_generation(
    v_case_id, v_owner_id, 'test:ready-with-unfinished-document', NULL
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.case_documents AS d
    JOIN public.jobs AS j ON j.document_id = d.id
    WHERE d.id = v_document_id
      AND d.processing_status = 'ready'
      AND d.is_processed = true
      AND j.id = v_job_b.id
      AND j.status = 'completed'
      AND j.locked_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.case_documents AS d
    JOIN public.jobs AS j ON j.document_id = d.id
    WHERE d.id = v_unfinished_document_id
      AND d.processing_status = 'queued'
      AND d.is_processed = false
      AND j.job_type = 'evidence_document_processing'
      AND j.status = 'queued'
  ) THEN
    RAISE EXCEPTION 'successful evidence regressed while another document remained unfinished';
  END IF;

  RAISE NOTICE 'Privileged Edge, durable evidence, and lease fencing tests passed';
END;
$$;

DO $$
DECLARE
  v_first uuid;
  v_second uuid;
  v_count integer;
BEGIN
  IF has_function_privilege('anon', 'public.provision_clerk_profile_v1(text,text,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.provision_clerk_profile_v1(text,text,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.provision_clerk_profile_v1(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Clerk provisioning RPC is not restricted to service_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND indexname = 'profiles_clerk_id_unique_idx'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'profiles Clerk identity unique index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '10000000-0000-0000-0000-000000000001'
      AND clerk_id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy profile UUID or nullable Clerk mapping was not preserved';
  END IF;

  v_first := public.provision_clerk_profile_v1(
    'user_sqlfixture', 'SQL.Fixture@example.test', 'SQL', 'Fixture'
  );
  v_second := public.provision_clerk_profile_v1(
    'user_sqlfixture', 'changed@example.test', 'Changed', 'Name'
  );
  IF v_first <> v_second THEN
    RAISE EXCEPTION 'replayed Clerk provisioning changed the profile UUID';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.profiles
  WHERE clerk_id = 'user_sqlfixture'
    AND id = v_first
    AND email = 'sql.fixture@example.test';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Clerk provisioning did not preserve one canonical profile row';
  END IF;

  BEGIN
    PERFORM public.provision_clerk_profile_v1(
      ' user_sqlfixture ', 'fixture@example.test', 'SQL', 'Fixture'
    );
    RAISE EXCEPTION 'Clerk provisioning accepted a whitespace-padded identity';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'Clerk profile provisioning invariants passed';
END;
$$;

ROLLBACK;
