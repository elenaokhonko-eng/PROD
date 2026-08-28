-- Representative pre-Pattern-C rows used by test-pattern-c-security.ts.
-- Apply only after resetting through migration 20260827190000 on local Supabase.

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'legacy.owner@example.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'legacy.helper@example.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.profiles (id, email, full_name)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'legacy.owner@example.test',
    'Legacy Owner'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'legacy.helper@example.test',
    'Legacy Helper'
  );

INSERT INTO public.cases (
  id,
  user_id,
  owner_user_id,
  creator_user_id,
  claim_type,
  status,
  case_summary
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'phishing_scam',
  'draft',
  'Pattern C legacy fixture'
);

INSERT INTO public.jobs (
  id,
  case_id,
  user_id,
  job_type,
  status,
  payload
) VALUES (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'post_payment_report_generation',
  'queued',
  '{}'::jsonb
);

INSERT INTO public.reports (
  id,
  case_id,
  user_id,
  status,
  report_json
) VALUES (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'DRAFT',
  '{}'::jsonb
);

INSERT INTO public.case_collaborators (
  id,
  case_id,
  user_id,
  inviter_user_id,
  invited_email,
  role,
  permissions,
  status,
  accepted_at
) VALUES (
  '50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'legacy.helper@example.test',
  'editor',
  ARRAY['read', 'write']::text[],
  'active',
  now()
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
    '60000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '',
    'helper',
    'short',
    'pending',
    NULL
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    ' Legacy.Recipient@Example.Test ',
    'helper',
    repeat('a', 64),
    'pending',
    now() + interval '2 days'
  );
