-- Update handle_new_user trigger to set role from auth.user metadata if provided
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role_text TEXT;
BEGIN
  user_role_text := COALESCE(NEW.raw_user_meta_data ->> 'role', 'victim');

  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', NULL),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name', NULL),
    CASE
      WHEN user_role_text IN ('victim','helper','lead_victim','defendant') THEN user_role_text::user_role
      ELSE 'victim'::user_role
    END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

