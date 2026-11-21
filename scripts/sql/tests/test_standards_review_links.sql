-- Tests for 20261123120000_standards_review_links.sql. Synthetic data only; everything is rolled back.
-- Run after all migrations: psql -v ON_ERROR_STOP=1 -f scripts/sql/tests/test_standards_review_links.sql
-- Covers: institutions are named by a fixed code; a statement is approved against the wording in force on a date and
-- is read back only for dates under that wording; a server rule citing a changed clause blocks verification until
-- reviewed; recorded wording is never changed; anon and authenticated read nothing.

BEGIN;

DO $$
DECLARE
  c_vec constant public.vector := array_fill(0.01::real, ARRAY[1536])::public.vector;
  c_sha constant text := repeat('b', 64);
  v_doc uuid;
  v_v1 uuid;
  v_v2 uuid;
  v_v3 uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_row record;
  v_count integer;
BEGIN
  -- Institutions: one fixed code, found by name or alias whatever the case; an unknown code is refused.
  INSERT INTO public.standard_institutions (code, name, aliases)
  VALUES ('synthetic_bank_c', 'Synthetic Bank C', '{"SBC", "Synthetic Bank C Ltd"}');
  IF public.standard_institution_code_v1('  sbc ') IS DISTINCT FROM 'synthetic_bank_c' THEN
    RAISE EXCEPTION 'alias did not resolve to the code';
  END IF;
  IF public.standard_institution_code_v1('Unknown Bank') IS NOT NULL THEN
    RAISE EXCEPTION 'an unknown name resolved to a code';
  END IF;
  BEGIN
    INSERT INTO public.standard_institutions (code, name) VALUES ('Synthetic Bank D', 'Synthetic Bank D');
    RAISE EXCEPTION 'a free-text code was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, institution)
    VALUES ('test.unknown_terms', 'Unknown terms', 'Unknown', 'contract', 'unknown_bank');
    RAISE EXCEPTION 'a contract named an unknown institution';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- A synthetic guideline: v1 from 1 Jan 2025 covers accounts and cards; 5.1 covers accounts only.
  INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope)
  VALUES ('test.links', 'Synthetic links guideline', 'Synthetic regulator', 'guideline', '{bank}', '{account_transfer,sg_card}')
  RETURNING id INTO v_doc;
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
  VALUES (v_doc, 'v1', '2025-01-01', 'publisher_site') RETURNING id INTO v_v1;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, instrument_scope, embedding, embedding_model) VALUES
    (v_v1, 'test.links/5.1', 'Synthetic duty, first wording.', '', '{account_transfer}', c_vec, 'synthetic'),
    (v_v1, 'test.links/5.2', 'Synthetic definition.', '', NULL, c_vec, 'synthetic');

  -- A statement cannot be approved on a draft version's wording, or without the date it was checked against.
  BEGIN
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys, status, approved_by, approved_at, clauses_as_of)
    VALUES ('test.links.duty', 'eupg', '{account_transfer}', 'Synthetic statement.', '{test.links/5.1,test.links/5.2}', 'approved', 'synthetic reviewer', now(), '2025-03-01');
    RAISE EXCEPTION 'statement approved on draft wording';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys, status, approved_by, approved_at)
    VALUES ('test.links.duty', 'eupg', '{account_transfer}', 'Synthetic statement.', '{test.links/5.1}', 'approved', 'synthetic reviewer', now());
    RAISE EXCEPTION 'statement approved without the wording date';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/links-v1.pdf', snapshot_path = 'synthetic/links-v1.pdf',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id = v_v1;

  -- A card statement cannot rest on a paragraph that covers accounts only.
  BEGIN
    INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys, status, approved_by, approved_at, clauses_as_of)
    VALUES ('test.links.card', 'eupg', '{sg_card}', 'Synthetic card statement.', '{test.links/5.1}', 'approved', 'synthetic reviewer', now(), '2025-03-01');
    RAISE EXCEPTION 'card statement approved on an account-only paragraph';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Drafted, then approved: the wording of 5.1 and 5.2 under v1 is recorded.
  INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys)
  VALUES ('test.links.duty', 'eupg', '{account_transfer}', 'Synthetic statement, revision 1.', '{test.links/5.1,test.links/5.2}')
  RETURNING id INTO v_r1;
  UPDATE public.definition_statements
  SET status = 'approved', approved_by = 'synthetic reviewer', approved_at = now(), clauses_as_of = '2025-03-01'
  WHERE id = v_r1;
  SELECT count(*) INTO v_count FROM public.definition_statement_clauses l
  JOIN public.standard_clauses c ON c.version_id = l.version_id AND c.clause_key = l.clause_key AND c.text_sha256 = l.text_sha256
  WHERE l.statement_id = v_r1 AND l.version_id = v_v1;
  IF v_count <> 2 THEN RAISE EXCEPTION 'approval did not record the wording of both clauses'; END IF;
  BEGIN
    UPDATE public.definition_statements SET clauses_as_of = '2025-02-01' WHERE id = v_r1;
    RAISE EXCEPTION 'approved wording date was changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.definition_statement_clauses WHERE statement_id = v_r1;
    RAISE EXCEPTION 'recorded wording was deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- As-of read: nothing before v1; revision 1 under v1.
  IF EXISTS (SELECT 1 FROM public.get_statement_as_of_v1('test.links.duty', '2024-12-31')) THEN
    RAISE EXCEPTION 'statement read before its wording was in force';
  END IF;
  SELECT * INTO v_row FROM public.get_statement_as_of_v1('test.links.duty', '2025-03-01');
  IF v_row.revision IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'revision 1 not read under v1'; END IF;

  -- v2 from 1 Jul 2025 rewords 5.1. A server rule cites 5.1 too.
  INSERT INTO public.standard_rule_citations (rule_id, clause_key, source_file)
  VALUES ('synthetic.cooling_rule', 'test.links/5.1', 'lib/server/synthetic.ts');
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance, supersedes_version_id)
  VALUES (v_doc, 'v2', '2025-07-01', 'publisher_site', v_v1) RETURNING id INTO v_v2;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, instrument_scope, embedding, embedding_model) VALUES
    (v_v2, 'test.links/5.1', 'Synthetic duty, second wording.', '', '{account_transfer}', c_vec, 'synthetic'),
    (v_v2, 'test.links/5.2', 'Synthetic definition.', '', NULL, c_vec, 'synthetic');

  SELECT count(*) INTO v_count FROM public.standard_version_diff_v2(v_v2)
  WHERE clause_key = 'test.links/5.1' AND statements = ARRAY['test.links.duty r1'] AND rules = ARRAY['synthetic.cooling_rule'];
  IF v_count <> 1 THEN RAISE EXCEPTION 'diff did not list the statement and the rule on the changed clause'; END IF;

  -- The statement is reviewed as unchanged, but the rule is not: not verifiable.
  INSERT INTO public.standard_dependant_reviews (version_id, statement_id, outcome, reviewed_by)
  VALUES (v_v2, v_r1, 'unchanged', 'synthetic reviewer');
  BEGIN
    UPDATE public.standard_document_versions
    SET status = 'verified', source_url = 'https://example.test/links-v2.pdf', snapshot_path = 'synthetic/links-v2.pdf',
        content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
    WHERE id = v_v2;
    RAISE EXCEPTION 'version verified with an unreviewed server rule';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.standard_dependant_reviews (version_id, rule_cite, outcome, reviewed_by)
  VALUES (v_v2, 'synthetic.cooling_rule', 'unchanged', 'synthetic reviewer');

  -- The draft's text is edited after the statement's review: not verifiable until reviewed again.
  UPDATE public.standard_clauses SET text_content = 'Synthetic duty, second wording, corrected.'
  WHERE version_id = v_v2 AND clause_key = 'test.links/5.1';
  BEGIN
    UPDATE public.standard_document_versions
    SET status = 'verified', source_url = 'https://example.test/links-v2.pdf', snapshot_path = 'synthetic/links-v2.pdf',
        content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
    WHERE id = v_v2;
    RAISE EXCEPTION 'version verified with text changed after the statement review';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- The review is done again against the final text; the version can then be verified.
  UPDATE public.standard_dependant_reviews SET reviewed_at = now(), note = 'checked against the corrected text'
  WHERE version_id = v_v2 AND statement_id = v_r1;
  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/links-v2.pdf', snapshot_path = 'synthetic/links-v2.pdf',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id = v_v2;
  -- A review of a verified version is fixed.
  BEGIN
    UPDATE public.standard_dependant_reviews SET outcome = 'retired' WHERE version_id = v_v2 AND statement_id = v_r1;
    RAISE EXCEPTION 'review of a verified version was changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Reviewed as unchanged: revision 1 carries over to v2's wording; under v1 it is still read.
  SELECT * INTO v_row FROM public.get_statement_as_of_v1('test.links.duty', '2025-08-01');
  IF v_row.revision IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'revision 1 did not carry over after an unchanged review'; END IF;
  SELECT * INTO v_row FROM public.get_statement_as_of_v1('test.links.duty', '2025-03-01');
  IF v_row.revision IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'revision 1 not read for a date under v1'; END IF;

  -- v3 from 1 Jan 2026 changes 5.1's meaning: revision 1 is reviewed as reworded.
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance, supersedes_version_id)
  VALUES (v_doc, 'v3', '2026-01-01', 'publisher_site', v_v2) RETURNING id INTO v_v3;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, instrument_scope, embedding, embedding_model) VALUES
    (v_v3, 'test.links/5.1', 'Synthetic duty, third wording, new meaning.', '', '{account_transfer}', c_vec, 'synthetic'),
    (v_v3, 'test.links/5.2', 'Synthetic definition.', '', NULL, c_vec, 'synthetic');
  INSERT INTO public.standard_dependant_reviews (version_id, statement_id, outcome, reviewed_by)
  VALUES (v_v3, v_r1, 'reworded', 'synthetic reviewer');
  INSERT INTO public.standard_dependant_reviews (version_id, rule_cite, outcome, reviewed_by)
  VALUES (v_v3, 'synthetic.cooling_rule', 'unchanged', 'synthetic reviewer');
  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/links-v3.pdf', snapshot_path = 'synthetic/links-v3.pdf',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id = v_v3;

  -- Revision 1 is not read under wording it was not checked against, until revision 2 is approved against it.
  IF EXISTS (SELECT 1 FROM public.get_statement_as_of_v1('test.links.duty', '2026-02-01')) THEN
    RAISE EXCEPTION 'revision 1 read under wording it was not checked against';
  END IF;
  INSERT INTO public.definition_statements (statement_key, revision, framework, applies_to_instrument, text, clause_keys, status, approved_by, approved_at, clauses_as_of)
  VALUES ('test.links.duty', 2, 'eupg', '{account_transfer}', 'Synthetic statement, revision 2.', '{test.links/5.1,test.links/5.2}',
          'approved', 'synthetic reviewer', now(), '2026-02-01')
  RETURNING id INTO v_r2;
  SELECT * INTO v_row FROM public.get_statement_as_of_v1('test.links.duty', '2026-02-01');
  IF v_row.revision IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'revision 2 not read under the new wording'; END IF;
  -- A pack dated under v2 still prints revision 1, the wording checked for it.
  SELECT * INTO v_row FROM public.get_statement_as_of_v1('test.links.duty', '2025-08-01');
  IF v_row.revision IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'revision 1 not read for a date under v2'; END IF;

  -- A retired statement is not read.
  UPDATE public.definition_statements SET status = 'retired' WHERE id = v_r2;
  IF EXISTS (SELECT 1 FROM public.get_statement_as_of_v1('test.links.duty', '2026-02-01')) THEN
    RAISE EXCEPTION 'retired statement was read';
  END IF;
END;
$$;

-- No read for anon or authenticated.
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.definition_statement_clauses LIMIT 1;
    RAISE EXCEPTION 'anon read definition_statement_clauses';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_statement_as_of_v1('test.links.duty', '2025-03-01');
    RAISE EXCEPTION 'anon called get_statement_as_of_v1';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.standard_institutions LIMIT 1;
    RAISE EXCEPTION 'authenticated read standard_institutions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.standard_rule_citations LIMIT 1;
    RAISE EXCEPTION 'authenticated read standard_rule_citations';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SELECT 'standards review links: all checks passed' AS result;

ROLLBACK;
