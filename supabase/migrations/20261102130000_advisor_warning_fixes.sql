-- Fix the Supabase advisor warnings left after 20261102120000 so a new project starts clean.
--
-- 1) fidrec_eligible: read by the Tier-0 bright-function through the service role but never created by a
--    migration (old staging had it as drift, without RLS and with anon ALL). Created here, service role only.
-- 2) Pin search_path on the ten public functions that had none.
-- 3) Analytics materialized views are read only by the service role (app/analytics); anon and authenticated
--    lose SELECT.
-- 4) Drop always-true write policies on router_sessions and waitlist. Both are written only by the service role.
-- 5) Legacy referrals / analytics_events / consent_logs policies compared auth.uid() with profile ids, which never
--    matches under Pattern C. Only service-role routes write these tables (api/referral/track, api/analytics/track,
--    api/cases/create-from-session) and nothing reads them as the signed-in user, so the user policies are dropped
--    and the tables stay service-role only.
-- 6) Cover every foreign key with an index.
--
-- Accepted, not changed: vector stays in public (moving it rewrites column types and operator lookups);
-- rls_enabled_no_policy tables are service-role-only by design; unused_index needs real traffic to judge.

CREATE TABLE IF NOT EXISTS public.fidrec_eligible (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name text NOT NULL,
  institution_name_normalized text NOT NULL,
  category text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  source_name text NOT NULL DEFAULT 'FIDReC',
  source_page text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fidrec_eligible OWNER TO postgres;
CREATE INDEX IF NOT EXISTS ix_fidrec_eligible_institution_name_normalized
  ON public.fidrec_eligible (institution_name_normalized);
ALTER TABLE public.fidrec_eligible ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fidrec_eligible FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fidrec_eligible TO service_role;

ALTER FUNCTION public.get_latest_decision_run() SET search_path = public, pg_temp;
ALTER FUNCTION public."has_feature (feature_key text)"() SET search_path = public, pg_temp;
ALTER FUNCTION public.match_public_decisions(vector, integer, double precision) SET search_path = public, pg_temp;
ALTER FUNCTION public.match_public_decisions_threshold(vector, integer, double precision) SET search_path = public, pg_temp;
ALTER FUNCTION public.match_regulatory_clauses(vector, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.match_regulatory_clauses(vector, integer, double precision) SET search_path = public, pg_temp;
ALTER FUNCTION public.match_regulatory_clauses_threshold(vector, integer, double precision) SET search_path = public, pg_temp;
ALTER FUNCTION public.set_case_intake_version() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_case_document_from_storage() SET search_path = public, pg_temp;

REVOKE SELECT ON
  public.mv_complaint_status_counts,
  public.mv_country_rollup,
  public.mv_funnel_durations,
  public.mv_pages_per_session,
  public.mv_report_status_counts,
  public.mv_session_counts,
  public.mv_session_counts_periods
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Allow anonymous insert for router sessions" ON public.router_sessions;
DROP POLICY IF EXISTS "Allow anonymous update for router sessions" ON public.router_sessions;
DROP POLICY IF EXISTS "Allow public insert on waitlist" ON public.waitlist;

DROP POLICY IF EXISTS "Users can create referrals" ON public.referrals;
DROP POLICY IF EXISTS "Users can read their own referrals" ON public.referrals;
DROP POLICY IF EXISTS "Users can insert analytics events" ON public.analytics_events;
DROP POLICY IF EXISTS "Users can view own analytics events" ON public.analytics_events;
DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON public.consent_logs;
DROP POLICY IF EXISTS "Users can view own consent logs" ON public.consent_logs;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.referrals, public.analytics_events, public.consent_logs FROM authenticated;

CREATE INDEX IF NOT EXISTS ix_analytics_events_user_id ON public.analytics_events (user_id);
CREATE INDEX IF NOT EXISTS ix_case_bank_assertions_source_document_id ON public.case_bank_assertions (source_document_id);
CREATE INDEX IF NOT EXISTS ix_case_bootstrap_idempotency_case_id ON public.case_bootstrap_idempotency (case_id);
CREATE INDEX IF NOT EXISTS ix_case_collaborators_invited_by ON public.case_collaborators (invited_by);
CREATE INDEX IF NOT EXISTS ix_case_consultations_created_by_profile_id ON public.case_consultations (created_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_case_consultations_inserted_document_id ON public.case_consultations (inserted_document_id);
CREATE INDEX IF NOT EXISTS ix_case_consultations_inserted_narrative_id ON public.case_consultations (inserted_narrative_id);
CREATE INDEX IF NOT EXISTS ix_case_consultations_updated_by_profile_id ON public.case_consultations (updated_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_case_decision_runs_extract_run_id ON public.case_decision_runs (extract_run_id);
CREATE INDEX IF NOT EXISTS ix_case_document_extractions_content_id ON public.case_document_extractions (content_id);
CREATE INDEX IF NOT EXISTS ix_case_document_verifications_content_id ON public.case_document_verifications (content_id);
CREATE INDEX IF NOT EXISTS ix_case_evidence_requests_source_assertion_id ON public.case_evidence_requests (source_assertion_id);
CREATE INDEX IF NOT EXISTS ix_case_evidence_requests_source_finding_id ON public.case_evidence_requests (source_finding_id);
CREATE INDEX IF NOT EXISTS ix_case_evidence_requests_source_link_id ON public.case_evidence_requests (source_link_id);
CREATE INDEX IF NOT EXISTS ix_case_extract_runs_intake_id ON public.case_extract_runs (intake_id);
CREATE INDEX IF NOT EXISTS ix_case_narratives_decision_run_id ON public.case_narratives (decision_run_id);
CREATE INDEX IF NOT EXISTS ix_case_narratives_extract_run_id ON public.case_narratives (extract_run_id);
CREATE INDEX IF NOT EXISTS ix_case_narratives_intake_id ON public.case_narratives (intake_id);
CREATE INDEX IF NOT EXISTS ix_case_outcomes_case_id ON public.case_outcomes (case_id);
CREATE INDEX IF NOT EXISTS ix_case_purchases_created_by_profile_id ON public.case_purchases (created_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_case_purchases_purchased_by_profile_id ON public.case_purchases (purchased_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_case_purchases_updated_by_profile_id ON public.case_purchases (updated_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_case_validation_runs_intake_id ON public.case_validation_runs (intake_id);
CREATE INDEX IF NOT EXISTS ix_cases_user_id ON public.cases (user_id);
CREATE INDEX IF NOT EXISTS ix_consent_logs_user_id ON public.consent_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_consultation_consents_actor_profile_id ON public.consultation_consents (actor_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_consents_user_id ON public.consultation_consents (user_id);
CREATE INDEX IF NOT EXISTS ix_consultation_consents_verbal_confirmed_by_profile_id ON public.consultation_consents (verbal_confirmed_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_events_actor_profile_id ON public.consultation_events (actor_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_operations_assigned_by_profile_id ON public.consultation_operations (assigned_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_operations_created_by_profile_id ON public.consultation_operations (created_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_operations_last_ops_actor_profile_id ON public.consultation_operations (last_ops_actor_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_operations_updated_by_profile_id ON public.consultation_operations (updated_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_recordings_created_by_profile_id ON public.consultation_recordings (created_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_recordings_recording_started_by_profile_id ON public.consultation_recordings (recording_started_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_recordings_updated_by_profile_id ON public.consultation_recordings (updated_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_recordings_user_id ON public.consultation_recordings (user_id);
CREATE INDEX IF NOT EXISTS ix_consultation_reviews_created_by_profile_id ON public.consultation_reviews (created_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_reviews_inserted_document_id ON public.consultation_reviews (inserted_document_id);
CREATE INDEX IF NOT EXISTS ix_consultation_reviews_inserted_narrative_id ON public.consultation_reviews (inserted_narrative_id);
CREATE INDEX IF NOT EXISTS ix_consultation_reviews_recording_id ON public.consultation_reviews (recording_id);
CREATE INDEX IF NOT EXISTS ix_consultation_reviews_reviewed_by_profile_id ON public.consultation_reviews (reviewed_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_consultation_reviews_updated_by_profile_id ON public.consultation_reviews (updated_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_invitations_accepted_by ON public.invitations (accepted_by);
CREATE INDEX IF NOT EXISTS ix_invitations_inviter_user_id ON public.invitations (inviter_user_id);
CREATE INDEX IF NOT EXISTS ix_jobs_user_id ON public.jobs (user_id);
CREATE INDEX IF NOT EXISTS ix_payments_case_id ON public.payments (case_id);
CREATE INDEX IF NOT EXISTS ix_payments_user_id ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS ix_privacy_deletion_requests_reviewed_by ON public.privacy_deletion_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS ix_staff_roles_granted_by_profile_id ON public.staff_roles (granted_by_profile_id);
CREATE INDEX IF NOT EXISTS ix_validation_reconciliation_events_validation_run_id ON public.validation_reconciliation_events (validation_run_id);
