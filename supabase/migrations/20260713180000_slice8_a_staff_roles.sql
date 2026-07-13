-- Slice 8A: staff roles + current_app_has_role()
--
-- Draft only — do not apply until explicit approval.
-- Pattern C: roles bind to public.profiles(id), never auth.users / auth.uid().
-- No hard-coded staff emails.

CREATE TABLE IF NOT EXISTS public.staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('consultant', 'consult_operations', 'admin')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_roles_revoked_after_granted CHECK (
    revoked_at IS NULL OR revoked_at >= granted_at
  )
);

COMMENT ON TABLE public.staff_roles IS
  'Explicit staff role grants. Claimants have no SELECT. App checks roles via current_app_has_role(); mutations stay on service-role APIs.';

CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_active_profile_role_uidx
  ON public.staff_roles (profile_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_roles_profile_id_idx
  ON public.staff_roles (profile_id);

CREATE INDEX IF NOT EXISTS staff_roles_role_active_idx
  ON public.staff_roles (role)
  WHERE revoked_at IS NULL;

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
-- No authenticated policies. service_role bypasses RLS for admin tooling.

REVOKE ALL ON TABLE public.staff_roles FROM PUBLIC;
REVOKE ALL ON TABLE public.staff_roles FROM anon;
REVOKE ALL ON TABLE public.staff_roles FROM authenticated;
GRANT ALL ON TABLE public.staff_roles TO service_role;

-- SECURITY DEFINER so callers do not need SELECT on staff_roles.
-- search_path='' forces schema-qualified names (prevents search_path hijack).
CREATE OR REPLACE FUNCTION public.current_app_has_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_roles AS sr
    WHERE sr.profile_id = public.current_app_user_id()
      AND sr.role = p_role
      AND sr.revoked_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.current_app_has_role(text) IS
  'SECURITY DEFINER; search_path empty. Returns true iff JWT supabase_uuid (current_app_user_id) has an active public.staff_roles row. Does not expose other users'' roles. No email allowlists.';

REVOKE ALL ON FUNCTION public.current_app_has_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_has_role(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_app_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_has_role(text) TO service_role;
