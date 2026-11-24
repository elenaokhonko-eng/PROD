-- Tests for 20261203120000_standards_statement_exclusions.sql. Synthetic data only; everything is rolled back.
-- Run after all migrations: psql -v ON_ERROR_STOP=1 -f scripts/sql/tests/test_standards_statement_exclusions.sql
-- Covers: a card statement that cites an account-only paragraph as not applying to cards is approved when that
-- paragraph is flagged as an exclusion; without the flag it is still refused; the flag cannot be put on a paragraph
-- that does apply to cards, or on a clause the statement does not cite; the other clauses keep the usual check; the
-- flag is fixed once the revision is approved.

BEGIN;

DO $$
DECLARE
  c_sha constant text := repeat('c', 64);
  v_doc uuid;
  v_v1 uuid;
  v_id uuid;
  v_row record;
  v_count integer;
BEGIN
  -- A synthetic guideline for accounts and cards: 5.1 says section 5 does not apply to cards and covers accounts
  -- only; fn3 points card holders elsewhere and covers both; 4.2 covers both.
  INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope)
  VALUES ('test.excl', 'Synthetic exclusions guideline', 'Synthetic regulator', 'guideline', '{bank}',
          '{account_transfer,sg_card,ewallet}')
  RETURNING id INTO v_doc;
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
  VALUES (v_doc, 'v1', '2025-01-01', 'publisher_site') RETURNING id INTO v_v1;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, instrument_scope) VALUES
    (v_v1, 'test.excl/5.1', 'Synthetic: this section does not apply to card transactions.', '', '{account_transfer,ewallet}'),
    (v_v1, 'test.excl/fn3', 'Synthetic: card holders are referred to another code.', '', NULL),
    (v_v1, 'test.excl/4.2', 'Synthetic duty that applies to cards too.', '', NULL);
  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/excl-v1.pdf', snapshot_path = 'synthetic/excl-v1.pdf',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id = v_v1;

  -- Without the flag the card statement is still refused on the account-only paragraph.
  BEGIN
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys,
      status, approved_by, approved_at, clauses_as_of)
    VALUES ('test.excl.cards', 'eupg', '{sg_card}', 'Synthetic: section 5 does not apply to cards.',
            '{test.excl/5.1,test.excl/fn3}', 'approved', 'synthetic reviewer', now(), '2025-03-01');
    RAISE EXCEPTION 'card statement approved on an account-only paragraph without the exclusion flag';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'definition_statement_scope_wider_than_clause' THEN RAISE; END IF;
  END;

  -- The flag must name a clause the statement cites.
  BEGIN
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys,
      exclusion_clause_keys)
    VALUES ('test.excl.cards', 'eupg', '{sg_card}', 'Synthetic.', '{test.excl/fn3}', '{test.excl/5.1}');
    RAISE EXCEPTION 'exclusion flag accepted on a clause the statement does not cite';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The flag cannot be put on a paragraph that applies to cards.
  BEGIN
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys,
      exclusion_clause_keys, status, approved_by, approved_at, clauses_as_of)
    VALUES ('test.excl.wrong', 'eupg', '{sg_card}', 'Synthetic.', '{test.excl/4.2}', '{test.excl/4.2}',
            'approved', 'synthetic reviewer', now(), '2025-03-01');
    RAISE EXCEPTION 'exclusion flag accepted on a paragraph that applies to cards';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'definition_statement_exclusion_clause_applies' THEN RAISE; END IF;
  END;

  -- Nor where the statement speaks for a payment type the paragraph does cover (accounts and cards together).
  BEGIN
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys,
      exclusion_clause_keys, status, approved_by, approved_at, clauses_as_of)
    VALUES ('test.excl.mixed', 'eupg', '{account_transfer,sg_card}', 'Synthetic.', '{test.excl/5.1}', '{test.excl/5.1}',
            'approved', 'synthetic reviewer', now(), '2025-03-01');
    RAISE EXCEPTION 'exclusion flag accepted where the paragraph covers one of the statement''s payment types';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'definition_statement_exclusion_clause_applies' THEN RAISE; END IF;
  END;

  -- A clause that is not flagged keeps the usual check, even beside a flagged one.
  BEGIN
    INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope)
    VALUES ('test.excl2', 'Synthetic accounts-only guideline', 'Synthetic regulator', 'guideline', '{bank}',
            '{account_transfer}');
    INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
    SELECT id, 'v1', '2025-01-01', 'publisher_site' FROM public.standard_documents WHERE document_key = 'test.excl2';
    INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256)
    SELECT v.id, 'test.excl2/1', 'Synthetic accounts-only paragraph.', ''
    FROM public.standard_document_versions v JOIN public.standard_documents d ON d.id = v.document_id
    WHERE d.document_key = 'test.excl2';
    UPDATE public.standard_document_versions v
    SET status = 'verified', source_url = 'https://example.test/excl2.pdf', snapshot_path = 'synthetic/excl2.pdf',
        content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
    FROM public.standard_documents d WHERE d.id = v.document_id AND d.document_key = 'test.excl2';
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys,
      exclusion_clause_keys, status, approved_by, approved_at, clauses_as_of)
    VALUES ('test.excl.partial', 'eupg', '{sg_card}', 'Synthetic.', '{test.excl/5.1,test.excl2/1}', '{test.excl/5.1}',
            'approved', 'synthetic reviewer', now(), '2025-03-01');
    RAISE EXCEPTION 'an unflagged account-only clause was accepted beside a flagged one';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'definition_statement_scope_wider_than_clause' THEN RAISE; END IF;
  END;

  -- With the flag on 5.1 the card statement is approved, as a draft first and then on approval.
  INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys,
    exclusion_clause_keys)
  VALUES ('test.excl.cards', 'eupg', '{sg_card}', 'Synthetic: section 5 does not apply to cards.',
          '{test.excl/5.1,test.excl/fn3}', '{test.excl/5.1}')
  RETURNING id INTO v_id;
  UPDATE public.definition_statements
  SET status = 'approved', approved_by = 'synthetic reviewer', approved_at = now(), clauses_as_of = '2025-03-01'
  WHERE id = v_id;

  -- The wording of both clauses is recorded, and the statement is read for a date under v1.
  SELECT count(*) INTO v_count FROM public.definition_statement_clauses WHERE statement_id = v_id AND version_id = v_v1;
  IF v_count <> 2 THEN RAISE EXCEPTION 'approval did not record the wording of both clauses'; END IF;
  SELECT * INTO v_row FROM public.get_statement_as_of_v1('test.excl.cards', '2025-03-01');
  IF v_row.statement_id IS DISTINCT FROM v_id THEN RAISE EXCEPTION 'approved exclusion statement not read'; END IF;

  -- The flag is fixed once approved.
  BEGIN
    UPDATE public.definition_statements SET exclusion_clause_keys = '{}' WHERE id = v_id;
    RAISE EXCEPTION 'exclusion flag changed on an approved revision';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A draft's flag can still be edited.
  INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys,
    exclusion_clause_keys)
  VALUES ('test.excl.draft', 'srf', '{sg_card}', 'Synthetic draft.', '{test.excl/5.1}', '{test.excl/5.1}')
  RETURNING id INTO v_id;
  UPDATE public.definition_statements SET exclusion_clause_keys = '{}' WHERE id = v_id;
END;
$$;

SELECT 'standards statement exclusions: all checks passed' AS result;

ROLLBACK;
