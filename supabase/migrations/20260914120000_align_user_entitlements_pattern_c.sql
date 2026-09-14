-- Align user entitlement ownership with the Pattern C application identity.
BEGIN;

-- Block profile, entitlement, and legacy-auth signup writes until the foreign key
-- and the single authoritative provisioning trigger are installed together.
LOCK TABLE auth.users, public.profiles, public.user_entitlements
  IN SHARE ROW EXCLUSIVE MODE;

-- Required operator preflight query:
-- SELECT ue.user_id
-- FROM public.user_entitlements ue
-- LEFT JOIN public.profiles p ON p.id = ue.user_id
-- WHERE p.id IS NULL;
DO $preflight$
DECLARE
  v_orphan_count bigint;
  v_orphan_sample text;
BEGIN
  SELECT count(*)
  INTO v_orphan_count
  FROM public.user_entitlements ue
  LEFT JOIN public.profiles p ON p.id = ue.user_id
  WHERE p.id IS NULL;

  IF v_orphan_count > 0 THEN
    SELECT string_agg(orphan.user_id::text, ', ' ORDER BY orphan.user_id)
    INTO v_orphan_sample
    FROM (
      SELECT ue.user_id
      FROM public.user_entitlements ue
      LEFT JOIN public.profiles p ON p.id = ue.user_id
      WHERE p.id IS NULL
      ORDER BY ue.user_id
      LIMIT 10
    ) AS orphan;

    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = format(
        'Pattern C entitlement preflight failed: %s user_entitlements rows have no matching profile',
        v_orphan_count
      ),
      DETAIL = format('Sample user_id values: %s', v_orphan_sample),
      HINT = 'Create or reconcile the matching public.profiles rows, then rerun the unchanged migration.';
  END IF;
END;
$preflight$;

-- Remove every legacy FK on this ownership column, including copied databases
-- where the auth.users constraint may have a nonstandard name.
DO $drop_legacy_entitlement_fks$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.user_entitlements'::regclass
      AND c.contype = 'f'
      AND a.attname = 'user_id'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.user_entitlements DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END;
$drop_legacy_entitlement_fks$;

ALTER TABLE public.user_entitlements
  ADD CONSTRAINT user_entitlements_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.profiles(id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.user_entitlements
  VALIDATE CONSTRAINT user_entitlements_user_id_fkey;

-- Remove only obsolete entitlement triggers. Preserve any auth.users trigger
-- that calls handle_new_user() for supported legacy Supabase Auth signup.
DO $drop_legacy_entitlement_triggers$
DECLARE
  v_trigger record;
BEGIN
  FOR v_trigger IN
    SELECT trigger_schema.nspname AS schema_name,
           trigger_table.relname AS table_name,
           t.tgname AS trigger_name
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class trigger_table
      ON trigger_table.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace trigger_schema
      ON trigger_schema.oid = trigger_table.relnamespace
    JOIN pg_catalog.pg_proc trigger_function
      ON trigger_function.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace function_schema
      ON function_schema.oid = trigger_function.pronamespace
    WHERE NOT t.tgisinternal
      AND function_schema.nspname = 'public'
      AND trigger_function.proname = 'handle_new_user_entitlement'
      AND pg_catalog.pg_get_function_identity_arguments(trigger_function.oid) = ''
      AND (
        (trigger_schema.nspname = 'auth' AND trigger_table.relname = 'users')
        OR (trigger_schema.nspname = 'public' AND trigger_table.relname = 'profiles')
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER %I ON %I.%I',
      v_trigger.trigger_name,
      v_trigger.schema_name,
      v_trigger.table_name
    );
  END LOOP;
END;
$drop_legacy_entitlement_triggers$;

CREATE OR REPLACE FUNCTION public.handle_new_user_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_entitlements (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user_entitlement() IS
  'Creates one idempotent free entitlement for a new Pattern C profile.';

REVOKE ALL ON FUNCTION public.handle_new_user_entitlement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_entitlement() TO service_role;

CREATE TRIGGER profiles_create_user_entitlement_after_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_entitlement();

-- Preserve all existing rows and plans; only add the missing default row for a
-- profile that predates the authoritative profile trigger.
INSERT INTO public.user_entitlements (user_id)
SELECT p.id
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entitlements_select_own ON public.user_entitlements;
CREATE POLICY entitlements_select_own
  ON public.user_entitlements
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_app_user_id());

REVOKE ALL ON TABLE public.user_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_entitlements TO authenticated;
GRANT ALL ON TABLE public.user_entitlements TO service_role;

-- Active entitlement consumers run as trusted service code. The authenticated
-- table policy above is the only direct end-user entitlement read path.
ALTER FUNCTION public.get_effective_entitlement(uuid) SET search_path = '';
REVOKE ALL ON FUNCTION public.get_effective_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_entitlement(uuid) TO service_role;

COMMENT ON TABLE public.user_entitlements IS
  'Pattern C entitlements keyed by public.profiles.id; one row per application identity.';

COMMIT;
