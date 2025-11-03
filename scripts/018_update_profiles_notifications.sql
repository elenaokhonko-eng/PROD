-- Enhance profiles schema for onboarding preferences and metadata sync

-- Add new columns if they do not exist
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN,
  ADD COLUMN IF NOT EXISTS sms_notifications BOOLEAN;

-- Backfill derived full_name and notification defaults
UPDATE profiles
SET full_name = NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')
WHERE full_name IS NULL;

UPDATE profiles
SET email_notifications = TRUE
WHERE email_notifications IS NULL;

UPDATE profiles
SET sms_notifications = FALSE
WHERE sms_notifications IS NULL;

-- Enforce defaults and NOT NULL constraints
ALTER TABLE profiles
  ALTER COLUMN email_notifications SET DEFAULT TRUE,
  ALTER COLUMN email_notifications SET NOT NULL,
  ALTER COLUMN sms_notifications SET DEFAULT FALSE,
  ALTER COLUMN sms_notifications SET NOT NULL;

-- Update the handle_new_user trigger to populate the new columns
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role_text TEXT;
  first_name_text TEXT;
  last_name_text TEXT;
  full_name_text TEXT;
  phone_number_text TEXT;
  email_notifications_text TEXT;
  sms_notifications_text TEXT;
  email_notifications_value BOOLEAN := TRUE;
  sms_notifications_value BOOLEAN := FALSE;
BEGIN
  user_role_text := COALESCE(NEW.raw_user_meta_data ->> 'role', 'victim');

  first_name_text := NULLIF(NEW.raw_user_meta_data ->> 'first_name', '');
  last_name_text := NULLIF(NEW.raw_user_meta_data ->> 'last_name', '');
  full_name_text := NULLIF(NEW.raw_user_meta_data ->> 'full_name', '');
  phone_number_text := NULLIF(NEW.raw_user_meta_data ->> 'phone_number', '');

  IF full_name_text IS NULL THEN
    full_name_text := NULLIF(TRIM(COALESCE(first_name_text, '') || ' ' || COALESCE(last_name_text, '')), '');
  END IF;

  email_notifications_text := NEW.raw_user_meta_data ->> 'email_notifications';
  sms_notifications_text := NEW.raw_user_meta_data ->> 'sms_notifications';

  IF email_notifications_text IS NOT NULL THEN
    email_notifications_value := CASE
      WHEN LOWER(email_notifications_text) IN ('true', 't', '1', 'yes', 'y') THEN TRUE
      WHEN LOWER(email_notifications_text) IN ('false', 'f', '0', 'no', 'n') THEN FALSE
      ELSE TRUE
    END;
  END IF;

  IF sms_notifications_text IS NOT NULL THEN
    sms_notifications_value := CASE
      WHEN LOWER(sms_notifications_text) IN ('true', 't', '1', 'yes', 'y') THEN TRUE
      WHEN LOWER(sms_notifications_text) IN ('false', 'f', '0', 'no', 'n') THEN FALSE
      ELSE FALSE
    END;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    first_name,
    last_name,
    role,
    phone_number,
    full_name,
    email_notifications,
    sms_notifications
  )
  VALUES (
    NEW.id,
    NEW.email,
    first_name_text,
    last_name_text,
    CASE
      WHEN user_role_text IN ('victim','helper','lead_victim','defendant') THEN user_role_text::user_role
      ELSE 'victim'::user_role
    END,
    phone_number_text,
    full_name_text,
    email_notifications_value,
    sms_notifications_value
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
        last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
        role = EXCLUDED.role,
        phone_number = COALESCE(EXCLUDED.phone_number, profiles.phone_number),
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        email_notifications = EXCLUDED.email_notifications,
        sms_notifications = EXCLUDED.sms_notifications,
        updated_at = NOW();

  RETURN NEW;
END;
$$;
