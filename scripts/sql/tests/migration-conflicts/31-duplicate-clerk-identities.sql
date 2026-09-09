DROP INDEX IF EXISTS public.profiles_clerk_id_unique_idx;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_clerk_id_shape_check;

UPDATE public.profiles
SET clerk_id = 'user_duplicatefixture'
WHERE id IN (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002'
);
