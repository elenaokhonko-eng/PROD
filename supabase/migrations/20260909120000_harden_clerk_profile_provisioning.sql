-- Establish one atomic, service-role-only Clerk-to-Pattern-C profile mapping path.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS clerk_id text;

UPDATE public.profiles
SET clerk_id = NULL
WHERE clerk_id IS NOT NULL
  AND btrim(clerk_id) = '';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE clerk_id IS NOT NULL
      AND clerk_id <> btrim(clerk_id)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Clerk profile preflight failed: whitespace-padded Clerk identities exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE clerk_id IS NOT NULL
    GROUP BY clerk_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Clerk profile preflight failed: duplicate Clerk identities exist';
  END IF;
END;
$preflight$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_clerk_id_shape_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_clerk_id_shape_check
  CHECK (clerk_id IS NULL OR (clerk_id = btrim(clerk_id) AND clerk_id <> ''));

CREATE UNIQUE INDEX IF NOT EXISTS profiles_clerk_id_unique_idx
  ON public.profiles (clerk_id);

CREATE OR REPLACE FUNCTION public.provision_clerk_profile_v1(
  p_clerk_id text,
  p_email text,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text := btrim(p_clerk_id);
  v_email text := lower(btrim(p_email));
  v_profile_id uuid;
BEGIN
  IF p_clerk_id IS NULL
    OR v_clerk_id = ''
    OR p_clerk_id <> v_clerk_id
    OR length(v_clerk_id) > 128
    OR v_clerk_id !~ '^user_[A-Za-z0-9]{3,}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Clerk identity';
  END IF;

  IF p_email IS NULL
    OR v_email = ''
    OR length(v_email) > 320
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Clerk primary email';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    first_name,
    last_name,
    full_name,
    clerk_id
  ) VALUES (
    extensions.gen_random_uuid(),
    v_email,
    NULLIF(btrim(p_first_name), ''),
    NULLIF(btrim(p_last_name), ''),
    NULLIF(concat_ws(' ', NULLIF(btrim(p_first_name), ''), NULLIF(btrim(p_last_name), '')), ''),
    v_clerk_id
  )
  ON CONFLICT (clerk_id) DO UPDATE
    SET clerk_id = EXCLUDED.clerk_id
  RETURNING id INTO v_profile_id;

  RETURN v_profile_id;
END;
$$;

COMMENT ON FUNCTION public.provision_clerk_profile_v1(text, text, text, text) IS
  'Atomically returns the stable Pattern C profile UUID for one Clerk identity. Service role only.';

REVOKE ALL ON FUNCTION public.provision_clerk_profile_v1(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_clerk_profile_v1(text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.provision_clerk_profile_v1(text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_clerk_profile_v1(text, text, text, text) TO service_role;

COMMIT;
