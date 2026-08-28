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
       !~ 'job_type = ''post_payment_report_generation''' THEN
    RAISE EXCEPTION 'report worker claim function must filter unsupported job types';
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

ROLLBACK;
