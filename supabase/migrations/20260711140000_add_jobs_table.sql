-- Background job queue for Tier-1 report generation (Slice 6).
-- The Stripe webhook inserts rows with status='queued'.
-- The Render worker polls, locks with FOR UPDATE SKIP LOCKED, runs the
-- canonical Tier-1 sequence, and updates status to 'completed' or 'failed'.
--
-- Compatibility: jobs.user_id stores the application ownership UUID
-- (public.profiles.id / Clerk JWT claim supabase_uuid / cases.user_id).
-- That UUID is created by the Clerk webhook and is NOT guaranteed to exist
-- in auth.users.id (Third-Party Auth may use JWT sub / Clerk user id instead).
-- Therefore jobs.user_id references public.profiles(id), not auth.users(id).

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('post_payment_report_generation')),
  idempotency_key text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  retry_count int NOT NULL DEFAULT 0,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_queued_created_at_idx
  ON public.jobs (created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS jobs_case_id_idx
  ON public.jobs (case_id);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_key_idx
  ON public.jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read jobs for cases they own.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'jobs'
      AND policyname = 'jobs_select_own'
  ) THEN
    CREATE POLICY "jobs_select_own"
      ON public.jobs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.cases c
          WHERE c.id = jobs.case_id
            AND c.user_id = NULLIF(auth.jwt()->>'supabase_uuid', '')::uuid
        )
      );
  END IF;
END $$;

-- Service role bypasses RLS by default and manages jobs via webhook + worker.
-- No insert/update/delete policies are created for authenticated/anon roles.

-- Atomic claim-and-lock helper used by the Render worker.
-- SELECT FOR UPDATE SKIP LOCKED prevents multiple workers from picking up the
-- same queued job; the UPDATE happens in the same transaction and RETURNING
-- refreshes the local record so callers see status='running'.
CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS public.jobs
LANGUAGE plpgsql
AS $$
DECLARE
  job public.jobs;
BEGIN
  SELECT * INTO job
  FROM public.jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF job IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.jobs
  SET
    status = 'running',
    started_at = now(),
    locked_at = now(),
    updated_at = now()
  WHERE id = job.id
  RETURNING * INTO job;

  RETURN job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_job() TO service_role;

-- Stripe webhook helper: entitlement upgrade and job enqueue must commit
-- together, and repeated Stripe deliveries must not enqueue duplicate jobs.
CREATE OR REPLACE FUNCTION public.enqueue_post_payment_report_generation(
  p_case_id uuid,
  p_user_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_payment_row_id uuid DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.jobs;
BEGIN
  INSERT INTO public.case_entitlements (
    case_id,
    plan,
    purchased_at,
    source,
    purchase_ref,
    updated_at
  )
  VALUES (
    p_case_id,
    'self_serve_report',
    now(),
    'stripe',
    p_idempotency_key,
    now()
  )
  ON CONFLICT (case_id) DO UPDATE
  SET plan = 'self_serve_report',
      purchased_at = COALESCE(public.case_entitlements.purchased_at, EXCLUDED.purchased_at),
      source = 'stripe',
      purchase_ref = COALESCE(EXCLUDED.purchase_ref, public.case_entitlements.purchase_ref),
      updated_at = now();

  INSERT INTO public.jobs (
    case_id,
    user_id,
    job_type,
    idempotency_key,
    status,
    payload
  )
  VALUES (
    p_case_id,
    p_user_id,
    'post_payment_report_generation',
    p_idempotency_key,
    'queued',
    jsonb_build_object(
      'stripe_checkout_session_id', p_idempotency_key,
      'payment_row_id', p_payment_row_id
    )
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO job;

  IF job IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO job
    FROM public.jobs
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
  END IF;

  RETURN job;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid) TO service_role;

-- Auto-update updated_at.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_jobs_set_updated_at'
      AND tgrelid = 'public.jobs'::regclass
  ) THEN
    CREATE TRIGGER trg_jobs_set_updated_at
      BEFORE UPDATE ON public.jobs
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
