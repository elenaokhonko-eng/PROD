-- Pattern C: report ownership is case-scoped, not auth.users-scoped.
--
-- Problem: reports.user_id still FK'd to auth.users(id). The worker/report path
-- inserts the case owner application UUID (profiles.id / JWT supabase_uuid /
-- cases.user_id). That UUID is not guaranteed to exist in auth.users under
-- Clerk Third-Party Auth (JWT sub may remain Clerk user_xxx).
--
-- Required ownership chain:
--   reports.case_id → cases.id → cases.user_id → public.current_app_user_id()
--
-- reports.user_id remains a denormalized copy of cases.user_id for indexes /
-- legacy readers, but is NOT an authoritative ownership source and must not
-- reference auth.users.
--
-- Mirror of the jobs.user_id → profiles(id) fix in 20260711140000_add_jobs_table.sql.
-- Do not edit previously applied migrations.

-- ---------------------------------------------------------------------------
-- 1) Retarget reports.user_id FK: auth.users → public.profiles
-- ---------------------------------------------------------------------------

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_user_id_fkey;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT reports_user_id_fkey ON public.reports IS
  'Denormalized application owner UUID (profiles.id / cases.user_id). Authoritative report ownership is via reports.case_id → cases.user_id = current_app_user_id().';

-- ---------------------------------------------------------------------------
-- 2) Case-scoped RLS on reports (RLS was enabled with zero policies)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own reports" ON public.reports;

CREATE POLICY "Users can view own reports"
  ON public.reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases
      WHERE cases.id = reports.case_id
        AND cases.user_id = public.current_app_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Replace mangled upsert_report_selfserve_v1 stub
--
-- remote_schema dumped a void 0-arg stub whose body was a nested CREATE that
-- inserted auth.uid() into reports.user_id. Recreate the real signature and
-- resolve owner from cases.user_id (Pattern C), never auth.uid() / JWT sub.
-- Active writers today use the edge function + service role; this keeps the
-- SQL helper consistent if called later.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.upsert_report_selfserve_v1();
DROP FUNCTION IF EXISTS public.upsert_report_selfserve_v1(uuid, text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.upsert_report_selfserve_v1(
  p_case_id uuid,
  p_inputs_hash text,
  p_source_decision_run_id uuid,
  p_report_json jsonb
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_row public.reports;
BEGIN
  SELECT c.user_id
    INTO v_owner
  FROM public.cases c
  WHERE c.id = p_case_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'upsert_report_selfserve_v1: case % not found or has null user_id', p_case_id;
  END IF;

  INSERT INTO public.reports (
    id,
    user_id,
    case_id,
    report_type,
    status,
    inputs_hash,
    source_decision_run_id,
    report_json,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    v_owner,
    p_case_id,
    'self_serve_v1',
    'COMPLETED',
    p_inputs_hash,
    p_source_decision_run_id,
    p_report_json,
    now(),
    now()
  )
  ON CONFLICT (user_id, case_id, report_type, inputs_hash)
  DO UPDATE SET
    updated_at = now(),
    report_json = EXCLUDED.report_json,
    source_decision_run_id = EXCLUDED.source_decision_run_id,
    status = EXCLUDED.status
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.upsert_report_selfserve_v1(uuid, text, uuid, jsonb) IS
  'Upserts a self-serve report. Owner is taken from cases.user_id (Pattern C application UUID), never auth.uid().';

GRANT EXECUTE ON FUNCTION public.upsert_report_selfserve_v1(uuid, text, uuid, jsonb) TO service_role;
