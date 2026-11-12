-- Harbor v3 sensory preference. Pattern C ownership remains profiles.id and
-- existing profile SELECT/UPDATE RLS policies control access to this column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sensory_mode text NOT NULL DEFAULT 'steady';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_sensory_mode_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_sensory_mode_check
  CHECK (sensory_mode IN ('steady', 'quiet', 'grounding'));

COMMENT ON COLUMN public.profiles.sensory_mode IS
  'Harbor display intensity preference: steady, quiet, or grounding.';
