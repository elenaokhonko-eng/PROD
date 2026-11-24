-- Tests for 20261204120100_standards_published_pages.sql. Synthetic data only; everything is rolled back.
-- Run after all migrations: psql -v ON_ERROR_STOP=1 -f scripts/sql/tests/test_standards_published_pages.sql
-- Covers: a published page names its institution and is only read for that institution; it is not a contract; a web
-- archive capture needs its archive date and nothing else has one; the archive date is fixed once verified; the
-- wallet_provisioning purpose and what a person records on it; those fields stay empty on every other purpose.

BEGIN;

DO $$
DECLARE
  c_sha constant text := repeat('e', 64);
  v_page uuid;
  v_v1 uuid;
  v_v2 uuid;
  v_count integer;
  v_level text;
BEGIN
  INSERT INTO public.standard_institutions (code, name) VALUES
    ('synthetic_bank_p', 'Synthetic Bank P'), ('synthetic_bank_q', 'Synthetic Bank Q');

  -- A published page names its institution.
  BEGIN
    INSERT INTO public.standard_documents (document_key, title, publisher, binding_level)
    VALUES ('test.unnamed_page', 'Unnamed page', 'Unnamed', 'published_page');
    RAISE EXCEPTION 'published page without an institution was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Only a contract or a published page names an institution.
  BEGIN
    INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, institution)
    VALUES ('test.named_guideline', 'Named guideline', 'Synthetic', 'guideline', 'synthetic_bank_p');
    RAISE EXCEPTION 'guideline naming an institution was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope, institution)
  VALUES ('test.bank_p_wallet', 'Adding your card to a mobile wallet', 'Synthetic Bank P', 'published_page', '{bank}', '{sg_card}', 'synthetic_bank_p')
  RETURNING id INTO v_page;

  -- A web archive capture needs the archive's capture date; a capture by us has none.
  BEGIN
    INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
    VALUES (v_page, 'archive 2025-10-01', '2025-10-01', 'web_archive');
    RAISE EXCEPTION 'web archive version without archived_at was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance, archived_at)
    VALUES (v_page, 'captured 2026-11-24', '2026-11-24', 'publisher_site', '2026-11-24');
    RAISE EXCEPTION 'archived_at accepted on a publisher_site capture';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance, archived_at)
  VALUES (v_page, 'archive 2025-10-01', '2025-10-01', 'web_archive', '2025-10-01') RETURNING id INTO v_v1;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, tags)
  VALUES (v_v1, 'test.bank_p_wallet/q1', 'Synthetic answer on adding a card.', '', '{bank_may_block}');
  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/archive/page', snapshot_path = 'synthetic/page.html',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id = v_v1;

  -- The archive date is fixed once verified.
  BEGIN
    UPDATE public.standard_document_versions SET archived_at = '2025-09-30' WHERE id = v_v1;
    RAISE EXCEPTION 'archived_at changed on a verified version';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Read only for its own institution, and labelled as a published page, never a contract.
  SELECT count(*) INTO v_count FROM public.get_clauses_by_tag_v1('bank_may_block', 'synthetic_bank_q', '2025-11-01');
  IF v_count <> 0 THEN RAISE EXCEPTION 'one institution''s page was read for another institution'; END IF;
  SELECT binding_level INTO v_level FROM public.get_clauses_by_tag_v1('bank_may_block', 'synthetic_bank_p', '2025-11-01');
  IF v_level IS DISTINCT FROM 'published_page' THEN RAISE EXCEPTION 'page read back as %', v_level; END IF;

  -- wallet_provisioning: a row a person has not read yet, then what they record.
  INSERT INTO public.institution_term_requests (institution, product, purpose, document_key, selector)
  VALUES ('synthetic_bank_p', 'credit_card', 'wallet_provisioning', 'test.bank_p_wallet', '{"tags": ["bank_may_block"]}');
  BEGIN
    UPDATE public.institution_term_requests SET confirmed_by = 'synthetic reviewer', confirmed_at = now()
    WHERE institution = 'synthetic_bank_p' AND purpose = 'wallet_provisioning';
    RAISE EXCEPTION 'wallet row confirmed without what the page states';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A waiting period is stated with its hours, or not stated without hours.
  BEGIN
    UPDATE public.institution_term_requests SET wallet_waiting_period_stated = true
    WHERE institution = 'synthetic_bank_p' AND purpose = 'wallet_provisioning';
    RAISE EXCEPTION 'stated waiting period without hours accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.institution_term_requests SET wallet_waiting_period_stated = false, wallet_waiting_period_hours = 12
    WHERE institution = 'synthetic_bank_p' AND purpose = 'wallet_provisioning';
    RAISE EXCEPTION 'hours accepted with no waiting period stated';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.institution_term_requests SET wallet_authentication_required = 'face_scan'
    WHERE institution = 'synthetic_bank_p' AND purpose = 'wallet_provisioning';
    RAISE EXCEPTION 'unknown authentication accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.institution_term_requests
  SET wallet_waiting_period_stated = true, wallet_waiting_period_hours = 12, wallet_authentication_required = 'digital_token',
      wallet_applies_from = '2025-07-01', confirmed_by = 'synthetic reviewer', confirmed_at = now()
  WHERE institution = 'synthetic_bank_p' AND purpose = 'wallet_provisioning';
  INSERT INTO public.institution_term_requests (institution, product, purpose, document_key, selector,
    wallet_waiting_period_stated, wallet_authentication_required, confirmed_by, confirmed_at)
  VALUES ('synthetic_bank_p', 'debit_card', 'wallet_provisioning', 'test.bank_p_wallet', '{"tags": ["bank_may_block"]}',
    false, 'none_stated', 'synthetic reviewer', now());

  -- The wallet fields stay empty on every other purpose.
  BEGIN
    INSERT INTO public.institution_term_requests (institution, product, purpose, document_key, selector, wallet_applies_from)
    VALUES ('synthetic_bank_p', 'account', 'customer_security_duty', 'test.bank_p_wallet', '{"tags": []}', '2025-07-01');
    RAISE EXCEPTION 'wallet field accepted on another purpose';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- An unknown purpose is still refused.
  BEGIN
    INSERT INTO public.institution_term_requests (institution, product, purpose, document_key, selector)
    VALUES ('synthetic_bank_p', 'account', 'wallet_cooling_off', 'test.bank_p_wallet', '{"tags": []}');
    RAISE EXCEPTION 'unknown purpose accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'standards published pages: all checks passed' AS result;

ROLLBACK;
