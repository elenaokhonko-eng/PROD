-- Complete Pattern C ownership, least-privilege RLS, and trusted mutation RPCs.
-- Clerk JWT `sub` remains a Clerk identifier. Application ownership always uses
-- the signed `supabase_uuid` claim and public.profiles(id).

BEGIN;

-- Normalize recoverable legacy invitation data before enforcing stricter invariants.
UPDATE public.invitations i
SET
  invitee_email = CASE
    WHEN btrim(i.invitee_email) = ''
      THEN 'cancelled+' || i.id::text || '@invalid.guidebuoy.local'
    ELSE lower(btrim(i.invitee_email))
  END,
  invitation_token = CASE
    WHEN i.invitation_token IS NULL OR length(btrim(i.invitation_token)) < 32
      THEN pg_catalog.encode(extensions.gen_random_bytes(32), 'hex')
    ELSE i.invitation_token
  END,
  status = CASE
    WHEN i.status IS NULL
      OR btrim(i.invitee_email) = ''
      OR (
        i.status = 'pending'
        AND (i.invitation_token IS NULL OR length(btrim(i.invitation_token)) < 32)
      )
      THEN 'cancelled'
    ELSE i.status
  END,
  expires_at = COALESCE(
    i.expires_at,
    COALESCE(i.sent_at, i.created_at, pg_catalog.now()) + interval '7 days'
  );

-- Refuse to rewrite ownership constraints when existing data cannot satisfy them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cases c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE c.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: cases.user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.evidence e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: evidence.user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payments pay
    LEFT JOIN public.profiles p ON p.id = pay.user_id
    WHERE pay.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: payments.user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.analytics_events ae
    LEFT JOIN public.profiles p ON p.id = ae.user_id
    WHERE ae.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: analytics_events.user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consent_logs cl
    LEFT JOIN public.profiles p ON p.id = cl.user_id
    WHERE cl.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: consent_logs.user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.referrals r
    LEFT JOIN public.profiles p ON p.id = r.referrer_user_id
    WHERE r.referrer_user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: referrals.referrer_user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.referrals r
    LEFT JOIN public.profiles p ON p.id = r.referred_user_id
    WHERE r.referred_user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: referrals.referred_user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.router_sessions rs
    LEFT JOIN public.profiles p ON p.id = rs.converted_to_user_id
    WHERE rs.converted_to_user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: router_sessions.converted_to_user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reports r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.case_id IS NULL AND r.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: unscoped reports.user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.case_collaborators cc
    LEFT JOIN public.profiles p ON p.id = cc.user_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: case_collaborators.user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.case_collaborators cc
    LEFT JOIN public.profiles p ON p.id = cc.inviter_user_id
    WHERE cc.inviter_user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: case_collaborators.inviter_user_id contains orphaned profile ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.cases c ON c.id = j.case_id
    WHERE c.user_id IS NULL
    UNION ALL
    SELECT 1 FROM public.escalation_waitlist ew
    JOIN public.cases c ON c.id = ew.case_id
    WHERE c.user_id IS NULL
    UNION ALL
    SELECT 1 FROM public.case_purchases cp
    JOIN public.cases c ON c.id = cp.case_id
    WHERE c.user_id IS NULL
    UNION ALL
    SELECT 1 FROM public.case_consultations cc
    JOIN public.cases c ON c.id = cc.case_id
    WHERE c.user_id IS NULL
    UNION ALL
    SELECT 1 FROM public.consultation_recordings cr
    JOIN public.cases c ON c.id = cr.case_id
    WHERE c.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: owner-required case records reference an ownerless case';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.case_collaborators
    GROUP BY case_id, user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: duplicate case collaborators exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invitations
    WHERE status = 'pending'
    GROUP BY case_id, lower(btrim(invitee_email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Pattern C preflight failed: duplicate pending invitations exist';
  END IF;
END;
$$;

-- A malformed or absent custom claim must deny access rather than raising 22P02.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_claim text;
BEGIN
  v_claim := NULLIF(auth.jwt() ->> 'supabase_uuid', '');
  IF v_claim IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v_claim::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NULL;
  END;
END;
$$;

COMMENT ON FUNCTION public.current_app_user_id() IS
  'Returns the application profile UUID from the signed Clerk JWT claim; malformed or missing claims return NULL.';

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated, service_role;

-- Pattern C profiles are provisioned by the Clerk webhook and are independent of auth.users.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_user_id_fkey;
ALTER TABLE public.cases
  ADD CONSTRAINT cases_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.evidence
  DROP CONSTRAINT IF EXISTS evidence_user_id_fkey;
ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_user_id_fkey;
ALTER TABLE public.analytics_events
  ADD CONSTRAINT analytics_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.consent_logs
  DROP CONSTRAINT IF EXISTS consent_logs_user_id_fkey;
ALTER TABLE public.consent_logs
  ADD CONSTRAINT consent_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.referrals
  DROP CONSTRAINT IF EXISTS referrals_referrer_user_id_fkey,
  DROP CONSTRAINT IF EXISTS referrals_referred_user_id_fkey;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_referrer_user_id_fkey
    FOREIGN KEY (referrer_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT referrals_referred_user_id_fkey
    FOREIGN KEY (referred_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.router_sessions
  DROP CONSTRAINT IF EXISTS router_sessions_converted_to_user_id_fkey;
ALTER TABLE public.router_sessions
  ADD CONSTRAINT router_sessions_converted_to_user_id_fkey
  FOREIGN KEY (converted_to_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Case-linked reports are safely reconciled from the canonical case owner below.
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_user_id_fkey;

-- Keep compatibility ownership columns aligned with the canonical cases.user_id.
UPDATE public.cases c
SET
  owner_user_id = c.user_id,
  creator_user_id = COALESCE(c.creator_user_id, c.user_id)
WHERE c.owner_user_id IS DISTINCT FROM c.user_id
   OR (c.creator_user_id IS NULL AND c.user_id IS NOT NULL);

UPDATE public.jobs j
SET user_id = c.user_id,
    updated_at = pg_catalog.now()
FROM public.cases c
WHERE c.id = j.case_id
  AND j.user_id IS DISTINCT FROM c.user_id;

UPDATE public.reports r
SET user_id = c.user_id,
    updated_at = pg_catalog.now()
FROM public.cases c
WHERE c.id = r.case_id
  AND r.user_id IS DISTINCT FROM c.user_id;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.escalation_waitlist ew
SET user_id = c.user_id,
    updated_at = pg_catalog.now()
FROM public.cases c
WHERE c.id = ew.case_id
  AND ew.user_id IS DISTINCT FROM c.user_id;

UPDATE public.case_purchases cp
SET user_id = c.user_id,
    updated_at = pg_catalog.now()
FROM public.cases c
WHERE c.id = cp.case_id
  AND cp.user_id IS DISTINCT FROM c.user_id;

UPDATE public.case_consultations cc
SET user_id = c.user_id,
    updated_at = pg_catalog.now()
FROM public.cases c
WHERE c.id = cc.case_id
  AND cc.user_id IS DISTINCT FROM c.user_id;

UPDATE public.consultation_recordings cr
SET user_id = c.user_id,
    updated_at = pg_catalog.now()
FROM public.cases c
WHERE c.id = cr.case_id
  AND cr.user_id IS DISTINCT FROM c.user_id;

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_owner_matches_user_check,
  ADD CONSTRAINT cases_owner_matches_user_check
    CHECK (owner_user_id IS NOT DISTINCT FROM user_id);

CREATE OR REPLACE FUNCTION public.synchronize_case_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.owner_user_id := NEW.user_id;
  IF TG_OP = 'INSERT' AND NEW.creator_user_id IS NULL THEN
    NEW.creator_user_id := NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.synchronize_case_ownership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cases_synchronize_ownership_before_write ON public.cases;
CREATE TRIGGER cases_synchronize_ownership_before_write
BEFORE INSERT OR UPDATE OF user_id, owner_user_id ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.synchronize_case_ownership();

CREATE OR REPLACE FUNCTION public.propagate_case_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NULL;
  END IF;

  IF NEW.user_id IS NULL AND EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.case_id = NEW.id
    UNION ALL
    SELECT 1 FROM public.escalation_waitlist ew WHERE ew.case_id = NEW.id
    UNION ALL
    SELECT 1 FROM public.case_purchases cp WHERE cp.case_id = NEW.id
    UNION ALL
    SELECT 1 FROM public.case_consultations cc WHERE cc.case_id = NEW.id
    UNION ALL
    SELECT 1 FROM public.consultation_recordings cr WHERE cr.case_id = NEW.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'case_owner_required_by_dependent_records';
  END IF;

  UPDATE public.jobs SET user_id = NEW.user_id, updated_at = pg_catalog.now()
  WHERE case_id = NEW.id;
  UPDATE public.reports SET user_id = NEW.user_id, updated_at = pg_catalog.now()
  WHERE case_id = NEW.id;
  UPDATE public.escalation_waitlist SET user_id = NEW.user_id, updated_at = pg_catalog.now()
  WHERE case_id = NEW.id;
  UPDATE public.case_purchases SET user_id = NEW.user_id, updated_at = pg_catalog.now()
  WHERE case_id = NEW.id;
  UPDATE public.case_consultations SET user_id = NEW.user_id, updated_at = pg_catalog.now()
  WHERE case_id = NEW.id;
  UPDATE public.consultation_recordings SET user_id = NEW.user_id, updated_at = pg_catalog.now()
  WHERE case_id = NEW.id;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_case_owner_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cases_propagate_owner_after_update ON public.cases;
CREATE TRIGGER cases_propagate_owner_after_update
AFTER UPDATE OF user_id ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.propagate_case_owner_change();

-- Reconcile the collaborator schema with application roles and permissions.
ALTER TABLE public.case_collaborators
  DROP CONSTRAINT IF EXISTS case_collaborators_inviter_user_id_fkey;
ALTER TABLE public.case_collaborators
  DROP CONSTRAINT IF EXISTS case_collaborators_user_id_fkey;
ALTER TABLE public.case_collaborators
  DROP CONSTRAINT IF EXISTS case_collaborators_role_check;

ALTER TABLE public.case_collaborators
  ADD COLUMN IF NOT EXISTS can_view boolean,
  ADD COLUMN IF NOT EXISTS can_edit boolean,
  ADD COLUMN IF NOT EXISTS can_invite boolean;

UPDATE public.case_collaborators
SET
  can_view = true,
  can_edit = role IN ('editor', 'owner'),
  can_invite = role = 'owner',
  permissions = CASE role
    WHEN 'owner' THEN ARRAY['read', 'write', 'invite']::text[]
    WHEN 'editor' THEN ARRAY['read', 'write']::text[]
    ELSE ARRAY['read']::text[]
  END,
  role = CASE role
    WHEN 'owner' THEN 'lead_victim'
    WHEN 'editor' THEN 'helper'
    ELSE 'defendant'
  END;

ALTER TABLE public.case_collaborators
  ALTER COLUMN role SET DEFAULT 'defendant',
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN can_view SET DEFAULT true,
  ALTER COLUMN can_view SET NOT NULL,
  ALTER COLUMN can_edit SET DEFAULT false,
  ALTER COLUMN can_edit SET NOT NULL,
  ALTER COLUMN can_invite SET DEFAULT false,
  ALTER COLUMN can_invite SET NOT NULL;

ALTER TABLE public.case_collaborators
  ADD CONSTRAINT case_collaborators_role_check
  CHECK (role IN ('victim', 'helper', 'lead_victim', 'defendant'));
ALTER TABLE public.case_collaborators
  ADD CONSTRAINT case_collaborators_permission_hierarchy_check
  CHECK ((NOT can_edit OR can_view) AND (NOT can_invite OR can_edit));

ALTER TABLE public.case_collaborators
  RENAME COLUMN inviter_user_id TO invited_by;

ALTER TABLE public.case_collaborators
  ADD CONSTRAINT case_collaborators_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.case_collaborators
  ADD CONSTRAINT case_collaborators_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.case_collaborators
  ADD CONSTRAINT case_collaborators_case_id_user_id_key
  UNIQUE (case_id, user_id);

-- Recursion-safe helpers are the only policy entry points for case authorization.
CREATE OR REPLACE FUNCTION public.app_case_is_owner(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_app_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = p_case_id
        AND c.user_id = public.current_app_user_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.app_case_permission(p_case_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE p_permission
    WHEN 'view' THEN
      public.app_case_is_owner(p_case_id)
      OR EXISTS (
        SELECT 1
        FROM public.case_collaborators cc
        WHERE cc.case_id = p_case_id
          AND cc.user_id = public.current_app_user_id()
          AND cc.status = 'active'
          AND cc.can_view
          AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
      )
    WHEN 'edit' THEN
      public.app_case_is_owner(p_case_id)
      OR EXISTS (
        SELECT 1
        FROM public.case_collaborators cc
        WHERE cc.case_id = p_case_id
          AND cc.user_id = public.current_app_user_id()
          AND cc.status = 'active'
          AND cc.can_edit
          AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
      )
    WHEN 'invite' THEN
      public.app_case_is_owner(p_case_id)
      OR EXISTS (
        SELECT 1
        FROM public.case_collaborators cc
        WHERE cc.case_id = p_case_id
          AND cc.user_id = public.current_app_user_id()
          AND cc.status = 'active'
          AND cc.can_invite
          AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
      )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.app_case_is_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_case_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_case_is_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_case_permission(uuid, text) TO authenticated, service_role;

-- Hash every existing invitation token, and never persist future plaintext tokens.
ALTER TABLE public.invitations
  ADD COLUMN invitation_token_hash text,
  ADD COLUMN referral_counted_at timestamptz;
ALTER TABLE public.invitations
  ALTER COLUMN invitation_token DROP NOT NULL;
ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_invitation_token_key;
DROP INDEX IF EXISTS public.idx_invitations_invitation_token;

UPDATE public.invitations
SET
  invitee_email = lower(btrim(invitee_email)),
  invitation_token_hash = pg_catalog.encode(extensions.digest(invitation_token, 'sha256'), 'hex'),
  invitation_token = NULL;

ALTER TABLE public.invitations
  ALTER COLUMN invitation_token_hash SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_invitee_email_normalized_check
    CHECK (invitee_email = lower(btrim(invitee_email)) AND invitee_email <> ''),
  ADD CONSTRAINT invitations_token_hash_format_check
    CHECK (invitation_token_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX invitations_token_hash_key
  ON public.invitations(invitation_token_hash);
CREATE UNIQUE INDEX invitations_one_pending_case_email_key
  ON public.invitations(case_id, lower(invitee_email))
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.hash_invitation_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.invitation_token IS NOT NULL THEN
    NEW.invitation_token_hash := pg_catalog.encode(
      extensions.digest(NEW.invitation_token, 'sha256'),
      'hex'
    );
    NEW.invitation_token := NULL;
  END IF;

  IF NEW.invitation_token_hash IS NULL THEN
    RAISE EXCEPTION 'invitation_token_hash is required';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.hash_invitation_token() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invitations_hash_token_before_write
BEFORE INSERT OR UPDATE OF invitation_token ON public.invitations
FOR EACH ROW EXECUTE FUNCTION public.hash_invitation_token();

-- Replace all permissive or auth.uid()-based policies on Harbor-owned tables.
DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
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
        'case_entitlements'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.%I',
      policy_row.policyname,
      policy_row.tablename
    );
  END LOOP;
END;
$$;

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_extract_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_narratives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_validation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_validation_gap_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_decision_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY cases_select_authorized
  ON public.cases FOR SELECT TO authenticated
  USING (public.app_case_permission(id, 'view'));
CREATE POLICY cases_insert_self
  ON public.cases FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_app_user_id() AND public.current_app_user_id() IS NOT NULL);
CREATE POLICY cases_update_authorized
  ON public.cases FOR UPDATE TO authenticated
  USING (public.app_case_permission(id, 'edit'))
  WITH CHECK (public.app_case_permission(id, 'edit'));
CREATE POLICY cases_delete_owner
  ON public.cases FOR DELETE TO authenticated
  USING (public.app_case_is_owner(id));

CREATE POLICY case_documents_select_authorized
  ON public.case_documents FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_documents_insert_authorized
  ON public.case_documents FOR INSERT TO authenticated
  WITH CHECK (public.app_case_permission(case_id, 'edit'));
CREATE POLICY case_documents_update_authorized
  ON public.case_documents FOR UPDATE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'))
  WITH CHECK (public.app_case_permission(case_id, 'edit'));
CREATE POLICY case_documents_delete_authorized
  ON public.case_documents FOR DELETE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'));

CREATE POLICY case_collaborators_select_authorized
  ON public.case_collaborators FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR public.app_case_permission(case_id, 'invite')
  );

CREATE POLICY case_intake_select_authorized
  ON public.case_intake FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_intake_insert_authorized
  ON public.case_intake FOR INSERT TO authenticated
  WITH CHECK (public.app_case_permission(case_id, 'edit'));

CREATE POLICY evidence_select_authorized
  ON public.evidence FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY evidence_insert_authorized
  ON public.evidence FOR INSERT TO authenticated
  WITH CHECK (
    public.app_case_permission(case_id, 'edit')
    AND user_id = public.current_app_user_id()
  );
CREATE POLICY evidence_update_authorized
  ON public.evidence FOR UPDATE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'))
  WITH CHECK (public.app_case_permission(case_id, 'edit'));
CREATE POLICY evidence_delete_authorized
  ON public.evidence FOR DELETE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'));

CREATE POLICY invitations_select_inviter
  ON public.invitations FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'invite'));

CREATE POLICY profiles_select_self
  ON public.profiles FOR SELECT TO authenticated
  USING (id = public.current_app_user_id());
CREATE POLICY profiles_update_self
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = public.current_app_user_id())
  WITH CHECK (id = public.current_app_user_id());

CREATE POLICY case_responses_select_authorized
  ON public.case_responses FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_responses_insert_authorized
  ON public.case_responses FOR INSERT TO authenticated
  WITH CHECK (public.app_case_permission(case_id, 'edit'));
CREATE POLICY case_responses_update_authorized
  ON public.case_responses FOR UPDATE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'))
  WITH CHECK (public.app_case_permission(case_id, 'edit'));
CREATE POLICY case_responses_delete_authorized
  ON public.case_responses FOR DELETE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'));

CREATE POLICY case_outcomes_select_authorized
  ON public.case_outcomes FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_outcomes_insert_authorized
  ON public.case_outcomes FOR INSERT TO authenticated
  WITH CHECK (public.app_case_permission(case_id, 'edit'));
CREATE POLICY case_outcomes_update_authorized
  ON public.case_outcomes FOR UPDATE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'))
  WITH CHECK (public.app_case_permission(case_id, 'edit'));
CREATE POLICY case_outcomes_delete_authorized
  ON public.case_outcomes FOR DELETE TO authenticated
  USING (public.app_case_permission(case_id, 'edit'));

CREATE POLICY payments_select_self
  ON public.payments FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id());
CREATE POLICY jobs_select_authorized
  ON public.jobs FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));

CREATE POLICY case_document_extractions_select_authorized
  ON public.case_document_extractions FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_extract_runs_select_authorized
  ON public.case_extract_runs FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_narratives_select_authorized
  ON public.case_narratives FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_validation_runs_select_authorized
  ON public.case_validation_runs FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_validation_gap_items_select_authorized
  ON public.case_validation_gap_items FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY case_decision_runs_select_authorized
  ON public.case_decision_runs FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));
CREATE POLICY reports_select_authorized
  ON public.reports FOR SELECT TO authenticated
  USING (case_id IS NOT NULL AND public.app_case_permission(case_id, 'view'));
CREATE POLICY case_entitlements_select_authorized
  ON public.case_entitlements FOR SELECT TO authenticated
  USING (public.app_case_permission(case_id, 'view'));

-- User-facing views must invoke underlying RLS instead of running as postgres.
ALTER VIEW public.complaints SET (security_invoker = true);
ALTER VIEW public.v_case_validation_gap_items SET (security_invoker = true);
ALTER VIEW public.v_latest_validation SET (security_invoker = true);
ALTER VIEW public.v_latest_validation_run SET (security_invoker = true);
ALTER VIEW public.case_documents_enriched SET (security_invoker = true);

-- Remove legacy broad grants, then expose only operations used by user-scoped APIs.
REVOKE ALL PRIVILEGES ON TABLE public.cases FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_documents FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_collaborators FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_intake FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.evidence FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.invitations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_responses FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_outcomes FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.jobs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_document_extractions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_extract_runs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_narratives FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_validation_runs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_validation_gap_items FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_decision_runs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.reports FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_entitlements FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.analytics_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.consent_logs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.referrals FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.router_sessions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.complaints FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.v_case_validation_gap_items FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.v_latest_validation FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.v_latest_validation_run FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.case_documents_enriched FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.consultation_consent_current FROM anon;

GRANT SELECT, DELETE ON TABLE public.cases TO authenticated;
GRANT INSERT (user_id, claim_type, primary_narrative) ON TABLE public.cases TO authenticated;
GRANT UPDATE (
  status,
  claim_amount,
  institution_name,
  incident_date,
  case_summary,
  case_status,
  primary_narrative,
  updated_at
) ON TABLE public.cases TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_documents TO authenticated;
GRANT SELECT ON TABLE public.case_collaborators TO authenticated;
GRANT SELECT ON TABLE public.case_intake TO authenticated;
GRANT INSERT (
  case_id,
  narrative_text,
  source,
  intake_type,
  answers_json,
  language,
  timezone,
  is_user_confirmed
) ON TABLE public.case_intake TO authenticated;

GRANT SELECT, DELETE ON TABLE public.evidence TO authenticated;
GRANT INSERT (
  case_id,
  user_id,
  filename,
  file_path,
  file_type,
  file_size,
  description,
  category,
  tags
) ON TABLE public.evidence TO authenticated;
GRANT UPDATE (filename, description, category, tags, updated_at) ON TABLE public.evidence TO authenticated;

GRANT SELECT (
  id,
  case_id,
  inviter_user_id,
  invitee_email,
  role,
  invitation_message,
  status,
  accepted_by,
  sent_at,
  accepted_at,
  expires_at,
  created_at
) ON TABLE public.invitations TO authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (sensory_mode, updated_at) ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_responses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_outcomes TO authenticated;
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.jobs TO authenticated;
GRANT SELECT ON TABLE public.case_document_extractions TO authenticated;
GRANT SELECT ON TABLE public.case_extract_runs TO authenticated;
GRANT SELECT ON TABLE public.case_narratives TO authenticated;
GRANT SELECT ON TABLE public.case_validation_runs TO authenticated;
GRANT SELECT ON TABLE public.case_validation_gap_items TO authenticated;
GRANT SELECT ON TABLE public.case_decision_runs TO authenticated;
GRANT SELECT ON TABLE public.reports TO authenticated;
GRANT SELECT ON TABLE public.case_entitlements TO authenticated;
GRANT SELECT ON TABLE public.v_case_validation_gap_items TO authenticated;

-- Invitation creation is authorized in the database and returns plaintext once.
CREATE OR REPLACE FUNCTION public.create_case_invitation(
  p_case_id uuid,
  p_invitee_email text,
  p_role public.user_role DEFAULT 'helper',
  p_message text DEFAULT NULL
)
RETURNS TABLE (
  invitation_id uuid,
  invitation_token text,
  normalized_email text,
  invitation_role public.user_role,
  invitation_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := public.current_app_user_id();
  v_email text := lower(btrim(p_invitee_email));
  v_token text;
  v_id uuid;
  v_expires_at timestamptz := pg_catalog.now() + interval '7 days';
  v_owns_case boolean;
  v_own_email text;
BEGIN
  IF v_user_id IS NULL
     OR v_email = ''
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR p_role IS NULL
     OR p_role NOT IN ('victim', 'helper', 'lead_victim', 'defendant') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invitation_not_authorized';
  END IF;

  v_owns_case := public.app_case_is_owner(p_case_id);
  IF NOT public.app_case_permission(p_case_id, 'invite')
     OR (p_role IN ('victim', 'lead_victim') AND NOT v_owns_case) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invitation_not_authorized';
  END IF;

  SELECT lower(p.email)
  INTO v_own_email
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_own_email IS NULL OR v_own_email = v_email THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_invitee';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invitations i
    WHERE i.case_id = p_case_id
      AND i.invitee_email = v_email
      AND i.status = 'pending'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'pending_invitation_exists';
  END IF;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.invitations (
    case_id,
    inviter_user_id,
    invitee_email,
    role,
    invitation_token_hash,
    invitation_message,
    status,
    expires_at
  ) VALUES (
    p_case_id,
    v_user_id,
    v_email,
    p_role,
    pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_message,
    'pending',
    v_expires_at
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_email, p_role, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_case_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cancelled_id uuid;
BEGIN
  UPDATE public.invitations i
  SET status = 'cancelled'
  WHERE i.id = p_invitation_id
    AND i.inviter_user_id = public.current_app_user_id()
    AND i.status = 'pending'
  RETURNING i.id INTO v_cancelled_id;

  RETURN v_cancelled_id IS NOT NULL;
END;
$$;

-- Acceptance locks and validates the invitation, then commits all mutations atomically.
CREATE OR REPLACE FUNCTION public.accept_case_invitation(p_token text)
RETURNS TABLE (
  invitation_id uuid,
  case_id uuid,
  role public.user_role,
  ownership_transferred boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := public.current_app_user_id();
  v_email text;
  v_invitation public.invitations%ROWTYPE;
  v_inviter_authorized boolean;
  v_transferred boolean := false;
BEGIN
  IF v_user_id IS NULL OR p_token IS NULL OR length(p_token) < 32 THEN
    RETURN;
  END IF;

  SELECT lower(p.email)
  INTO v_email
  FROM public.profiles p
  WHERE p.id = v_user_id
  FOR UPDATE;

  IF v_email IS NULL THEN
    RETURN;
  END IF;

  SELECT i.*
  INTO v_invitation
  FROM public.invitations i
  WHERE i.invitation_token_hash = pg_catalog.encode(
      extensions.digest(p_token, 'sha256'),
      'hex'
    )
  FOR UPDATE;

  IF NOT FOUND OR v_invitation.status <> 'pending' THEN
    RETURN;
  END IF;

  IF v_invitation.expires_at IS NULL
     OR v_invitation.expires_at <= pg_catalog.now() THEN
    UPDATE public.invitations i
    SET status = 'expired'
    WHERE i.id = v_invitation.id;
    RETURN;
  END IF;

  IF v_invitation.invitee_email <> v_email THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.cases c
    WHERE c.id = v_invitation.case_id
      AND c.user_id = v_invitation.inviter_user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.case_collaborators cc
    WHERE cc.case_id = v_invitation.case_id
      AND cc.user_id = v_invitation.inviter_user_id
      AND cc.status = 'active'
      AND cc.can_invite
      AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
  )
  INTO v_inviter_authorized;

  IF NOT v_inviter_authorized THEN
    UPDATE public.invitations i
    SET status = 'cancelled'
    WHERE i.id = v_invitation.id;
    RETURN;
  END IF;

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
    invited_at,
    accepted_at
  ) VALUES (
    v_invitation.case_id,
    v_user_id,
    v_invitation.inviter_user_id,
    v_invitation.invitee_email,
    v_invitation.role::text,
    CASE v_invitation.role
      WHEN 'lead_victim' THEN ARRAY['read', 'write', 'invite']::text[]
      WHEN 'victim' THEN ARRAY['read', 'write', 'invite']::text[]
      WHEN 'helper' THEN ARRAY['read', 'write']::text[]
      ELSE ARRAY['read']::text[]
    END,
    true,
    v_invitation.role IN ('victim', 'helper', 'lead_victim'),
    v_invitation.role IN ('victim', 'lead_victim'),
    'active',
    v_invitation.sent_at,
    pg_catalog.now()
  )
  ON CONFLICT ON CONSTRAINT case_collaborators_case_id_user_id_key DO UPDATE
  SET
    invited_by = EXCLUDED.invited_by,
    invited_email = EXCLUDED.invited_email,
    role = EXCLUDED.role,
    permissions = EXCLUDED.permissions,
    can_view = EXCLUDED.can_view,
    can_edit = EXCLUDED.can_edit,
    can_invite = EXCLUDED.can_invite,
    status = 'active',
    accepted_at = pg_catalog.now(),
    revoked_at = NULL,
    expires_at = NULL,
    updated_at = pg_catalog.now();

  IF v_invitation.role IN ('victim', 'lead_victim') THEN
    UPDATE public.cases c
    SET user_id = v_user_id,
        updated_at = pg_catalog.now()
    WHERE c.id = v_invitation.case_id
      AND c.user_id = v_invitation.inviter_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '40001',
        MESSAGE = 'ownership_transfer_conflict';
    END IF;

    DELETE FROM public.case_collaborators cc
    WHERE cc.case_id = v_invitation.case_id
      AND cc.user_id = v_user_id;

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
      invited_at,
      accepted_at
    ) VALUES (
      v_invitation.case_id,
      v_invitation.inviter_user_id,
      v_user_id,
      (SELECT p.email FROM public.profiles p WHERE p.id = v_invitation.inviter_user_id),
      'helper',
      ARRAY['read', 'write']::text[],
      true,
      true,
      false,
      'active',
      pg_catalog.now(),
      pg_catalog.now()
    )
    ON CONFLICT ON CONSTRAINT case_collaborators_case_id_user_id_key DO UPDATE
    SET
      invited_by = EXCLUDED.invited_by,
      invited_email = EXCLUDED.invited_email,
      role = EXCLUDED.role,
      permissions = EXCLUDED.permissions,
      can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit,
      can_invite = EXCLUDED.can_invite,
      status = 'active',
      accepted_at = pg_catalog.now(),
      revoked_at = NULL,
      expires_at = NULL,
      updated_at = pg_catalog.now();

    v_transferred := true;
  END IF;

  UPDATE public.invitations i
  SET
    status = 'accepted',
    accepted_by = v_user_id,
    accepted_at = pg_catalog.now(),
    referral_counted_at = pg_catalog.now()
  WHERE i.id = v_invitation.id;

  IF v_invitation.referral_counted_at IS NULL THEN
    UPDATE public.profiles p
    SET referral_count = COALESCE(p.referral_count, 0) + 1,
        updated_at = pg_catalog.now()
    WHERE p.id = v_invitation.inviter_user_id;
  END IF;

  RETURN QUERY
  SELECT v_invitation.id, v_invitation.case_id, v_invitation.role, v_transferred;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_case_collaborator_status(
  p_collaborator_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated_id uuid;
BEGIN
  IF p_status NOT IN ('active', 'revoked') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_collaborator_status';
  END IF;

  UPDATE public.case_collaborators cc
  SET
    status = p_status,
    revoked_at = CASE WHEN p_status = 'revoked' THEN pg_catalog.now() ELSE NULL END,
    expires_at = CASE WHEN p_status = 'active' THEN NULL ELSE cc.expires_at END,
    updated_at = pg_catalog.now()
  WHERE cc.id = p_collaborator_id
    AND public.app_case_permission(cc.case_id, 'invite')
    AND cc.user_id <> public.current_app_user_id()
  RETURNING cc.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

-- Referral codes can only be allocated to the current profile through this RPC.
CREATE OR REPLACE FUNCTION public.ensure_my_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := public.current_app_user_id();
  v_code text;
  v_attempt integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authenticated';
  END IF;

  SELECT p.referral_code
  INTO v_code
  FROM public.profiles p
  WHERE p.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'profile_not_found';
  END IF;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := upper(substr(pg_catalog.encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));

    BEGIN
      UPDATE public.profiles p
      SET referral_code = v_code,
          updated_at = pg_catalog.now()
      WHERE p.id = v_user_id;
      RETURN v_code;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt >= 5 THEN
          RAISE;
        END IF;
    END;
  END LOOP;
END;
$$;

-- Consent identity, email, and event time come from trusted server state.
CREATE OR REPLACE FUNCTION public.record_my_consent(
  p_consent_purposes text[],
  p_policy_version text DEFAULT '1.0'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := public.current_app_user_id();
  v_email text;
  v_consent_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authenticated';
  END IF;

  SELECT lower(btrim(p.email))
  INTO v_email
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'profile_email_not_found';
  END IF;

  IF p_consent_purposes IS NULL
     OR cardinality(p_consent_purposes) > 32
     OR EXISTS (
       SELECT 1
       FROM unnest(p_consent_purposes) AS purpose
       WHERE purpose IS NULL OR btrim(purpose) = '' OR length(purpose) > 100
     )
     OR p_policy_version IS NULL
     OR p_policy_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_consent_payload';
  END IF;

  INSERT INTO public.consent_logs (
    user_id,
    email,
    consent_purposes,
    policy_version,
    consented_at
  ) VALUES (
    v_user_id,
    v_email,
    p_consent_purposes,
    p_policy_version,
    pg_catalog.now()
  )
  RETURNING id INTO v_consent_id;

  RETURN v_consent_id;
END;
$$;

-- Privacy deletion is a reviewed workflow until legal retention rules and an
-- audited executor are approved. Submitting a request never deletes user data.
DROP FUNCTION IF EXISTS public.anonymize_my_cases();

CREATE TABLE public.privacy_deletion_requests (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'completed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE UNIQUE INDEX privacy_deletion_requests_one_active_per_user
  ON public.privacy_deletion_requests(user_id)
  WHERE status IN ('pending', 'under_review', 'approved');

ALTER TABLE public.privacy_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY privacy_deletion_requests_select_self
  ON public.privacy_deletion_requests FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id());

REVOKE ALL PRIVILEGES ON TABLE public.privacy_deletion_requests FROM anon, authenticated;
GRANT SELECT (id, status, requested_at, reviewed_at, completed_at)
  ON TABLE public.privacy_deletion_requests TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.privacy_deletion_requests TO service_role;

CREATE OR REPLACE FUNCTION public.request_privacy_deletion()
RETURNS TABLE (
  request_id uuid,
  request_status text,
  requested_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := public.current_app_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'profile_not_found';
  END IF;

  RETURN QUERY
  INSERT INTO public.privacy_deletion_requests AS pdr (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id)
    WHERE status IN ('pending', 'under_review', 'approved')
  DO UPDATE SET user_id = EXCLUDED.user_id
  RETURNING pdr.id, pdr.status, pdr.requested_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_case_invitation(uuid, text, public.user_role, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_case_invitation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_case_invitation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_case_collaborator_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_my_referral_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_my_consent(text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_privacy_deletion() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_case_invitation(uuid, text, public.user_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_case_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_case_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_case_collaborator_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_referral_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_my_consent(text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_privacy_deletion() TO authenticated;

-- The report worker must not consume consultation jobs it cannot process.
CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  SELECT j.*
  INTO v_job
  FROM public.jobs j
  WHERE j.status = 'queued'
    AND j.job_type = 'post_payment_report_generation'
  ORDER BY j.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.jobs j
  SET
    status = 'running',
    started_at = pg_catalog.now(),
    locked_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  WHERE j.id = v_job.id
  RETURNING j.* INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_job() TO service_role;

COMMIT;
