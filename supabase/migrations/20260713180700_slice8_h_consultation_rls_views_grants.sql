-- Slice 8H: claimant-safe views + exact grant matrix
--
-- Draft only — do not apply until explicit approval.
--
-- Permission model:
-- 1) Tables with NO staff-only columns may grant authenticated SELECT + RLS
--    (case_purchases, case_consultations, consultation_consents,
--     consultation_recordings). Views with security_invoker then inherit RLS.
-- 2) Tables WITH staff-only columns (consultation_reviews.reviewer_notes,
--    consultation_operations.*, consultation_events, staff_roles,
--    payment_webhook_events) must NOT grant authenticated SELECT.
--    Claimants read approved reviews only via security_barrier view that
--    filters ownership + status and omits reviewer_notes.
-- 3) security_invoker views require the invoker to have SELECT on the base
--    table; therefore they are used only where base SELECT is safe to grant.

-- ---------------------------------------------------------------------------
-- case_consultations_claimant (security_invoker)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.case_consultations_claimant
WITH (security_invoker = true)
AS
SELECT
  cc.id,
  cc.case_id,
  cc.purchase_id,
  cc.consultation_number,
  cc.consultation_sequence,
  cc.duration_minutes,
  cc.fulfilment_status,
  cc.recording_status,
  cc.transcription_status,
  cc.case_insertion_status,
  cc.scheduled_starts_at,
  cc.scheduled_ends_at,
  cc.timezone,
  cc.provider_type,
  cc.provider_session_id,
  cc.provider_join_url,
  cc.completed_at,
  cc.cancelled_at,
  cc.cancellation_reason,
  cc.no_show_at,
  cc.created_at,
  cc.updated_at
FROM public.case_consultations AS cc;

COMMENT ON VIEW public.case_consultations_claimant IS
  'Claimant API surface for consultations. security_invoker + RLS on case_consultations. Staff-only meeting_host_url / assignment live on consultation_operations (no grant).';

REVOKE ALL ON public.case_consultations_claimant FROM PUBLIC;
REVOKE ALL ON public.case_consultations_claimant FROM anon;
GRANT SELECT ON public.case_consultations_claimant TO authenticated;
GRANT SELECT ON public.case_consultations_claimant TO service_role;

-- ---------------------------------------------------------------------------
-- consultation_reviews_claimant
-- Base table: NO authenticated SELECT (blocks reviewer_notes + draft bypass).
-- View is security_barrier (definer rights) with explicit ownership filter.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.consultation_reviews_claimant
WITH (security_barrier = true)
AS
SELECT
  r.id,
  r.consultation_id,
  r.case_id,
  r.recording_id,
  r.review_version,
  r.status,
  r.summary_text,
  r.advice_topics,
  r.agreed_next_steps,
  r.client_corrections,
  r.approved_at,
  r.created_at,
  r.updated_at
FROM public.consultation_reviews AS r
WHERE r.status = 'approved'
  AND EXISTS (
    SELECT 1
    FROM public.cases AS c
    WHERE c.id = r.case_id
      AND c.user_id = public.current_app_user_id()
  );

COMMENT ON VIEW public.consultation_reviews_claimant IS
  'Approved reviews only; omits reviewer_notes. security_barrier + current_app_user_id() predicate. authenticated has zero privileges on consultation_reviews base table.';

REVOKE ALL ON public.consultation_reviews_claimant FROM PUBLIC;
REVOKE ALL ON public.consultation_reviews_claimant FROM anon;
GRANT SELECT ON public.consultation_reviews_claimant TO authenticated;
GRANT SELECT ON public.consultation_reviews_claimant TO service_role;

-- ===========================================================================
-- Exact grant matrix (reaffirm)
-- ===========================================================================
--
-- TABLE / VIEW                         | anon | authenticated      | service_role
-- -------------------------------------+------+--------------------+-------------
-- staff_roles                          | —    | —                  | ALL
-- case_purchases                       | —    | SELECT (RLS)       | ALL
-- payment_webhook_events               | —    | —                  | ALL
-- case_consultations                   | —    | SELECT (RLS)       | ALL
-- case_consultations_claimant (view)   | —    | SELECT             | SELECT
-- consultation_operations              | —    | —                  | ALL
-- consultation_consents                | —    | SELECT (RLS)       | SELECT,INSERT
-- consultation_consent_current (view)  | —    | SELECT             | SELECT
-- consultation_recordings              | —    | SELECT (RLS)       | ALL
-- consultation_events                  | —    | —                  | SELECT,INSERT
-- consultation_reviews                 | —    | —                  | ALL
-- consultation_reviews_claimant (view) | —    | SELECT             | SELECT
--
-- FUNCTION                             | anon | authenticated | service_role
-- current_app_has_role(text)           | —    | EXECUTE       | EXECUTE
-- next_consultation_number()           | —    | —             | EXECUTE
-- upsert_case_purchase_from_provider…  | —    | —             | EXECUTE
-- record_payment_webhook_event…        | —    | —             | EXECUTE
-- create_consultation_from_paid_purchase | —  | —             | EXECUTE
-- assign_consultant…                   | —    | —             | EXECUTE
-- transition_consultation_status…      | —    | —             | EXECUTE
-- approve_consultation_review…         | —    | —             | EXECUTE
-- insert_consultation_consent…         | —    | —             | EXECUTE
-- consultation_status_transition_allowed | —  | —             | EXECUTE
--
-- Bypass proofs (authenticated):
--   SELECT * FROM consultation_operations → permission denied
--   SELECT reviewer_notes FROM consultation_reviews → permission denied
--   SELECT * FROM consultation_reviews WHERE status='draft' → permission denied
--   SELECT meeting_host_url FROM consultation_operations → permission denied
--   consultation_reviews_claimant never projects reviewer_notes / non-approved

REVOKE ALL ON TABLE public.consultation_reviews FROM PUBLIC;
REVOKE ALL ON TABLE public.consultation_reviews FROM anon;
REVOKE ALL ON TABLE public.consultation_reviews FROM authenticated;
GRANT ALL ON TABLE public.consultation_reviews TO service_role;

REVOKE ALL ON TABLE public.consultation_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.consultation_operations FROM anon;
REVOKE ALL ON TABLE public.consultation_operations FROM authenticated;
GRANT ALL ON TABLE public.consultation_operations TO service_role;

REVOKE ALL ON TABLE public.consultation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.consultation_events FROM anon;
REVOKE ALL ON TABLE public.consultation_events FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.consultation_events TO service_role;

REVOKE ALL ON TABLE public.staff_roles FROM PUBLIC;
REVOKE ALL ON TABLE public.staff_roles FROM anon;
REVOKE ALL ON TABLE public.staff_roles FROM authenticated;
GRANT ALL ON TABLE public.staff_roles TO service_role;

REVOKE ALL ON TABLE public.payment_webhook_events FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_webhook_events FROM anon;
REVOKE ALL ON TABLE public.payment_webhook_events FROM authenticated;
GRANT ALL ON TABLE public.payment_webhook_events TO service_role;

-- Safe base tables: SELECT only for authenticated (RLS enforced).
REVOKE ALL ON TABLE public.case_consultations FROM authenticated;
REVOKE ALL ON TABLE public.case_purchases FROM authenticated;
REVOKE ALL ON TABLE public.consultation_consents FROM authenticated;
REVOKE ALL ON TABLE public.consultation_recordings FROM authenticated;
GRANT SELECT ON TABLE public.case_consultations TO authenticated;
GRANT SELECT ON TABLE public.case_purchases TO authenticated;
GRANT SELECT ON TABLE public.consultation_consents TO authenticated;
GRANT SELECT ON TABLE public.consultation_recordings TO authenticated;
