-- Align Clerk↔ Supabase RLS with the application ownership UUID.
--
-- Pattern C stores cases.user_id (and related ownership) as public.profiles.id,
-- which is carried in the Clerk `supabase` JWT custom claim `supabase_uuid`.
-- Supabase auth.uid() is derived from JWT `sub`, which may remain a Clerk user
-- id. This migration does NOT alter Clerk JWT `sub`; it keeps relying on
-- role=authenticated and the existing supabase_uuid claim.
--
-- Do not edit previously applied migrations; this file replaces the May
-- validation SELECT policies by dropping them and recreating equivalents.

-- ---------------------------------------------------------------------------
-- 1) Helper: application user id from Clerk JWT custom claim
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'supabase_uuid', '')::uuid;
$$;

COMMENT ON FUNCTION public.current_app_user_id() IS
  'Returns the application ownership UUID from the Clerk supabase JWT claim supabase_uuid. Used by RLS instead of auth.uid() when sub is the Clerk user id.';

GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Drop legacy May validation SELECT policies (auth.uid()-based)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own case_validation_runs"
  ON public.case_validation_runs;

DROP POLICY IF EXISTS "Users can view own case_validation_gap_items"
  ON public.case_validation_gap_items;

-- ---------------------------------------------------------------------------
-- 3) Drop / recreate Layer 1 owner SELECT policies using current_app_user_id()
-- ---------------------------------------------------------------------------

-- cases (ownership root for Layer 1 joins + dashboard reads)
DROP POLICY IF EXISTS "Users can view own cases" ON public.cases;

CREATE POLICY "Users can view own cases"
  ON public.cases
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_app_user_id());

-- case_documents
DROP POLICY IF EXISTS "Users can view own case documents" ON public.case_documents;

CREATE POLICY "Users can view own case documents"
  ON public.case_documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases
      WHERE cases.id = case_documents.case_id
        AND cases.user_id = public.current_app_user_id()
    )
  );

-- case_extract_runs (RLS was enabled with no SELECT policy in prior migrations)
DROP POLICY IF EXISTS "Users can view own case_extract_runs" ON public.case_extract_runs;

CREATE POLICY "Users can view own case_extract_runs"
  ON public.case_extract_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases
      WHERE cases.id = case_extract_runs.case_id
        AND cases.user_id = public.current_app_user_id()
    )
  );

-- case_narratives
DROP POLICY IF EXISTS "Users can view own case_narratives" ON public.case_narratives;

CREATE POLICY "Users can view own case_narratives"
  ON public.case_narratives
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases
      WHERE cases.id = case_narratives.case_id
        AND cases.user_id = public.current_app_user_id()
    )
  );

-- case_validation_runs (replacement for May policy)
CREATE POLICY "Users can view own case_validation_runs"
  ON public.case_validation_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases
      WHERE cases.id = case_validation_runs.case_id
        AND cases.user_id = public.current_app_user_id()
    )
  );

-- case_validation_gap_items (replacement for May policy)
CREATE POLICY "Users can view own case_validation_gap_items"
  ON public.case_validation_gap_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases
      WHERE cases.id = case_validation_gap_items.case_id
        AND cases.user_id = public.current_app_user_id()
    )
  );

-- case_entitlements (Slice 5 / Tier 2 entitlement checks)
ALTER TABLE public.case_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case owners can read entitlements"
  ON public.case_entitlements;

CREATE POLICY "case owners can read entitlements"
  ON public.case_entitlements
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = case_entitlements.case_id
        AND c.user_id = public.current_app_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 4–5) Inspect remote_schema.sql auth.uid() references (lines ~318 and ~650)
--
-- A) public.has_feature (dump stub around line 318)
--    Filters public.user_entitlements WHERE user_id = auth.uid().
--    user_entitlements rows are created from auth.users triggers using
--    auth.users.id, not cases.user_id / profiles.id. Not an application-UUID
--    ownership consumer for Layer 1 case reads. Also appears only as a mangled
--    pg_dump stub and is unused by application TypeScript. Not recreated.
--
-- B) public.upsert_report_selfserve_v1 (dump stub around line 650)
--    Would insert reports.user_id = auth.uid(). Appears only as a mangled
--    pg_dump stub; application report writes go through service-role edge
--    paths, not this function. Not an active Layer 1 ownership consumer.
--    Not recreated.
--
-- Neither object is redefined here.
-- ---------------------------------------------------------------------------
