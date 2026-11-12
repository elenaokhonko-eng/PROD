ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_clerk_id_shape_check;

UPDATE public.profiles
SET clerk_id = ' user_whitespacefixture '
WHERE id = '10000000-0000-0000-0000-000000000001';
