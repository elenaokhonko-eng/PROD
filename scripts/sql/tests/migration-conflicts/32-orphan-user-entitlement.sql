ALTER TABLE public.user_entitlements
  DROP CONSTRAINT user_entitlements_user_id_fkey;

INSERT INTO public.user_entitlements (user_id, plan, features)
VALUES (
  '32000000-0000-4000-8000-000000000001',
  'free',
  '{"orphan_preflight_fixture": true}'::jsonb
);
