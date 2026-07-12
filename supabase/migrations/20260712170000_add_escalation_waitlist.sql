-- Layer 3 / Tier 2 contact-request storage.
--
-- The browser posts to /api/contact-requests. That route first performs a
-- user-scoped RLS ownership probe on public.cases, then writes this table with
-- the service role so server-owned snapshot columns cannot be mutated directly
-- by a browser Supabase client.

CREATE TABLE IF NOT EXISTS public.escalation_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,

  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  age int NOT NULL CHECK (age BETWEEN 13 AND 120),
  employment_status text NOT NULL CHECK (
    employment_status IN ('professional', 'retiree', 'student', 'other')
  ),
  thirty_days_since_last_fi_reply boolean NOT NULL,
  fi_issued_final_response boolean NOT NULL,
  message text,

  amount_lost_sgd numeric(14, 2),
  financial_institution text,

  status text NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'contacted', 'onboarded', 'declined', 'cancelled')
  ),
  notes text,
  contacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT escalation_waitlist_user_case_unique UNIQUE (user_id, case_id)
);

CREATE INDEX IF NOT EXISTS escalation_waitlist_status_idx
  ON public.escalation_waitlist (status, created_at DESC);

CREATE INDEX IF NOT EXISTS escalation_waitlist_case_id_idx
  ON public.escalation_waitlist (case_id);

CREATE INDEX IF NOT EXISTS escalation_waitlist_employment_idx
  ON public.escalation_waitlist (employment_status);

ALTER TABLE public.escalation_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_insert_own" ON public.escalation_waitlist;
DROP POLICY IF EXISTS "users_can_update_own" ON public.escalation_waitlist;
DROP POLICY IF EXISTS "users_can_read_own" ON public.escalation_waitlist;
DROP POLICY IF EXISTS "escalation_waitlist_select_own" ON public.escalation_waitlist;

CREATE POLICY "escalation_waitlist_select_own"
  ON public.escalation_waitlist
  FOR SELECT
  TO authenticated
  USING (
    user_id = NULLIF(auth.jwt()->>'supabase_uuid', '')::uuid
  );

GRANT SELECT ON public.escalation_waitlist TO authenticated;
GRANT ALL ON public.escalation_waitlist TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_escalation_waitlist_set_updated_at'
      AND tgrelid = 'public.escalation_waitlist'::regclass
  ) THEN
    CREATE TRIGGER trg_escalation_waitlist_set_updated_at
      BEFORE UPDATE ON public.escalation_waitlist
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
