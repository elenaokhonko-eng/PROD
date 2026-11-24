-- FIDReC lanes review of 24 Nov 2026, Decisions 5 and 7: an institution's own published web page (for example its
-- page on adding its cards to mobile wallets) is a versioned document of its own kind, never printed as a contract.
-- 1) binding_level 'published_page'. Like a contract it names its institution, so retrieval keeps it to that
--    institution's case: one institution's page is never set against another institution.
-- 2) A version captured from a web archive records the archive's capture date (archived_at). provenance already has
--    'publisher_site' (captured by us) and 'web_archive'. archived_at is set exactly when the provenance is
--    'web_archive', and is fixed once the version is verified.
-- 3) Term-request purpose 'wallet_provisioning' (contract TERM_REQUEST_PURPOSES), with what a person records from the
--    page on that row (contract WalletProvisioningPractice): the waiting period after the digital token is set up
--    (hours, or none stated), the authentication the page says is required, and the date it says this applies from.

ALTER TABLE public.standard_documents
  DROP CONSTRAINT standard_documents_binding_level_check,
  ADD CONSTRAINT standard_documents_binding_level_check CHECK (binding_level IN (
    'guideline', 'notice', 'circular', 'industry_code', 'announcement', 'contract', 'scheme_rule', 'forum_rules',
    'published_page'
  )),
  DROP CONSTRAINT standard_documents_contract_institution,
  ADD CONSTRAINT standard_documents_institution_named
    CHECK ((binding_level IN ('contract', 'published_page')) = (institution IS NOT NULL));

ALTER TABLE public.standard_document_versions
  ADD COLUMN archived_at date,
  ADD CONSTRAINT standard_versions_archive_date CHECK ((provenance = 'web_archive') = (archived_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.standard_versions_archived_at_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'draft' AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_version_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER standard_versions_archived_at_guard
  BEFORE UPDATE OF archived_at ON public.standard_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.standard_versions_archived_at_guard();

ALTER TABLE public.institution_term_requests
  DROP CONSTRAINT institution_term_requests_purpose_check,
  ADD CONSTRAINT institution_term_requests_purpose_check CHECK (purpose IN (
    'fault_definition', 'customer_security_duty', 'liability_unauthorised',
    'notification_deadline', 'dispute_chargeback', 'conclusive_evidence', 'wallet_provisioning'
  )),
  -- Null until a person has read the page. waiting_period_stated false = the page states no waiting period.
  ADD COLUMN wallet_waiting_period_stated boolean,
  ADD COLUMN wallet_waiting_period_hours numeric CHECK (wallet_waiting_period_hours > 0),
  ADD COLUMN wallet_authentication_required text CHECK (wallet_authentication_required IN (
    'sms_otp', 'in_app', 'digital_token', 'not_known', 'none_stated'
  )),
  ADD COLUMN wallet_applies_from date,
  ADD CONSTRAINT institution_term_requests_wallet_only CHECK (
    purpose = 'wallet_provisioning'
    OR (wallet_waiting_period_stated IS NULL AND wallet_waiting_period_hours IS NULL
        AND wallet_authentication_required IS NULL AND wallet_applies_from IS NULL)
  ),
  ADD CONSTRAINT institution_term_requests_wallet_hours CHECK (
    (wallet_waiting_period_stated IS TRUE) = (wallet_waiting_period_hours IS NOT NULL)
  ),
  -- A confirmed wallet row says what the page states, including "none stated".
  ADD CONSTRAINT institution_term_requests_wallet_confirmed CHECK (
    purpose <> 'wallet_provisioning' OR confirmed_at IS NULL
    OR (wallet_waiting_period_stated IS NOT NULL AND wallet_authentication_required IS NOT NULL)
  );

REVOKE ALL ON FUNCTION public.standard_versions_archived_at_guard() FROM PUBLIC, anon, authenticated;
