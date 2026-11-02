-- Close the gaps the Supabase security advisor reported after the 2026-11-02 staging reset.
--
-- 1) The seven FIDReC tier-2 case-analysis tables (migrations 20260602194500-20260606120000) were created
--    without row level security, and default privileges gave anon and authenticated full DML on them.
--    The app reads and writes them only through the service role after assertCaseAccess, so authenticated
--    gets case-scoped SELECT (the same app_case_permission rule as case_documents) and nothing else.
-- 2) consultation_reviews_claimant ran with definer rights, and default privileges left authenticated with
--    UPDATE/DELETE on it, which reached approved reviews through the auto-updatable view. It now runs as the
--    caller: authenticated may SELECT the claimant-safe columns of consultation_reviews (never reviewer_notes or
--    reviewer identity), limited by RLS to approved reviews on cases the caller owns, as the view did before.
-- 3) anon held INSERT/UPDATE/DELETE/TRUNCATE on 20 public tables. Every writer uses the service role, so anon
--    keeps no write privilege anywhere in public, now or for tables created by later migrations.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'case_bank_assertions',
    'case_findings',
    'case_assertion_finding_links',
    'case_investigation_questions',
    'case_evidence_requests',
    'case_themes',
    'case_theme_links'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_authorized', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_case_permission(case_id, %L))',
      t || '_select_authorized', t, 'view'
    );
  END LOOP;
END $$;

-- consultation_reviews_claimant: caller rights, read-only.
REVOKE ALL ON public.consultation_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  consultation_id,
  case_id,
  recording_id,
  review_version,
  status,
  summary_text,
  advice_topics,
  agreed_next_steps,
  client_corrections,
  approved_at,
  created_at,
  updated_at
) ON public.consultation_reviews TO authenticated;

DROP POLICY IF EXISTS consultation_reviews_select_claimant_approved ON public.consultation_reviews;
CREATE POLICY consultation_reviews_select_claimant_approved
  ON public.consultation_reviews
  FOR SELECT
  TO authenticated
  USING (status = 'approved' AND public.app_case_is_owner(case_id));

ALTER VIEW public.consultation_reviews_claimant SET (security_invoker = true, security_barrier = true);
REVOKE ALL ON public.consultation_reviews_claimant FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consultation_reviews_claimant TO authenticated;
GRANT SELECT ON public.consultation_reviews_claimant TO service_role;

COMMENT ON VIEW public.consultation_reviews_claimant IS
  'Approved reviews only; omits reviewer_notes. security_invoker: authenticated has column-level SELECT on consultation_reviews (no reviewer_notes) and RLS limits rows to approved reviews on owned cases.';

-- anon writes nothing in public.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
