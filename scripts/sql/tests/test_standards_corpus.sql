/**
 * The versioned standards corpus (migration 20261122120000; FIDReC standards brief v5, section 3.2 rules 3, 7, 8).
 * Synthetic documents only. Rolls back.
 *
 *   psql "$LOCAL_OR_STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/sql/tests/test_standards_corpus.sql
 *
 * A payment dated before a version's start never retrieves it; one institution's contract never reaches another's
 * case; verified text cannot change; a version that changes a clause cannot be verified until what rests on it is
 * reviewed; the legacy corpus was copied in as drafts; anon and authenticated read nothing.
 */

BEGIN;

DO $$
DECLARE
  c_vec constant public.vector := array_fill(0.01::real, ARRAY[1536])::public.vector;
  c_sha constant text := repeat('a', 64);
  v_guideline uuid;
  v_bank_a uuid;
  v_bank_b uuid;
  v_g1 uuid;
  v_g2 uuid;
  v_g3 uuid;
  v_a1 uuid;
  v_b1 uuid;
  v_statement uuid;
  v_term uuid;
  v_text text;
  v_count integer;
BEGIN
  INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope)
  VALUES ('test.guideline', 'Synthetic guideline', 'Synthetic regulator', 'guideline', '{bank}', '{account_transfer}')
  RETURNING id INTO v_guideline;
  INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope, institution)
  VALUES ('test.bank_a_terms', 'Synthetic Bank A terms', 'Synthetic Bank A', 'contract', '{bank}', '{account_transfer}', 'Synthetic Bank A')
  RETURNING id INTO v_bank_a;
  INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope, institution)
  VALUES ('test.bank_b_terms', 'Synthetic Bank B terms', 'Synthetic Bank B', 'contract', '{bank}', '{account_transfer}', 'Synthetic Bank B')
  RETURNING id INTO v_bank_b;

  -- A contract must name its institution.
  BEGIN
    INSERT INTO public.standard_documents (document_key, title, publisher, binding_level)
    VALUES ('test.unnamed_terms', 'Unnamed', 'Unnamed', 'contract');
    RAISE EXCEPTION 'contract without an institution was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Version 1 of the guideline, in force from 1 Jan 2025.
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
  VALUES (v_guideline, 'v1', '2025-01-01', 'publisher_site') RETURNING id INTO v_g1;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, tags, embedding, embedding_model) VALUES
    (v_g1, 'test.guideline/4.7', 'Synthetic cooling-off duty, first wording.', '', '{cooling_off}', c_vec, 'synthetic'),
    (v_g1, 'test.guideline/4.9', 'Synthetic alert duty.', '', '{alerts}', c_vec, 'synthetic');

  -- A clause key from another document is refused.
  BEGIN
    INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256)
    VALUES (v_g1, 'test.bank_a_terms/1', 'Wrong document.', '');
    RAISE EXCEPTION 'clause key of another document was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A draft is never read.
  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2025-03-01');
  IF v_count <> 0 THEN RAISE EXCEPTION 'draft version was retrieved'; END IF;

  -- Verifying needs the kept file, its hash and a person.
  BEGIN
    UPDATE public.standard_document_versions SET status = 'verified' WHERE id = v_g1;
    RAISE EXCEPTION 'version verified without source details';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/guideline-v1.pdf', snapshot_path = 'synthetic/v1.pdf',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id = v_g1;

  -- Verified text is fixed; nothing is added to or removed from a verified version.
  BEGIN
    UPDATE public.standard_clauses SET text_content = 'Rewritten.' WHERE clause_key = 'test.guideline/4.7' AND version_id = v_g1;
    RAISE EXCEPTION 'verified clause text was changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256) VALUES (v_g1, 'test.guideline/9.9', 'Late.', '');
    RAISE EXCEPTION 'clause added to a verified version';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.standard_clauses WHERE version_id = v_g1;
    RAISE EXCEPTION 'clause deleted from a verified version';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.standard_document_versions SET source_url = 'https://example.test/other.pdf' WHERE id = v_g1;
    RAISE EXCEPTION 'verified version source was changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- The embedding may be redone: it finds the text, it is not the text.
  UPDATE public.standard_clauses SET embedding = c_vec, embedding_model = 'synthetic-2' WHERE version_id = v_g1;

  -- An approved statement and a term request resting on 4.7.
  INSERT INTO public.definition_statements (statement_key, framework, applies_to_instrument, text, clause_keys, status, approved_by, approved_at)
  VALUES ('test.cooling.term', 'eupg', '{account_transfer}', 'Synthetic statement.', '{test.guideline/4.7}', 'approved', 'synthetic reviewer', now())
  RETURNING id INTO v_statement;
  BEGIN
    UPDATE public.definition_statements SET text = 'Silently reworded.' WHERE id = v_statement;
    RAISE EXCEPTION 'approved statement was reworded in place';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Version 2 from 16 Jun 2025 changes 4.7 and adds 4.21, which starts later (1 Sep 2025). 4.9 is unchanged.
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance, supersedes_version_id)
  VALUES (v_guideline, 'v2', '2025-06-16', 'publisher_site', v_g1) RETURNING id INTO v_g2;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, embedding, embedding_model, effective_from_override) VALUES
    (v_g2, 'test.guideline/4.7', 'Synthetic cooling-off duty, second wording.', '', c_vec, 'synthetic', NULL),
    (v_g2, 'test.guideline/4.9', 'Synthetic alert duty.', '', c_vec, 'synthetic', NULL),
    (v_g2, 'test.guideline/4.21', 'Synthetic surveillance duty.', '', c_vec, 'synthetic', '2025-09-01');

  SELECT count(*) INTO v_count FROM public.standard_version_diff_v1(v_g2)
  WHERE clause_key = 'test.guideline/4.7' AND change = 'changed' AND statements = ARRAY['test.cooling.term r1'];
  IF v_count <> 1 THEN RAISE EXCEPTION 'diff did not list the statement on the changed clause'; END IF;
  SELECT count(*) INTO v_count FROM public.standard_version_diff_v1(v_g2) WHERE clause_key = 'test.guideline/4.9';
  IF v_count <> 0 THEN RAISE EXCEPTION 'unchanged clause listed in the diff'; END IF;

  -- Not verifiable until the statement is reviewed for v2.
  BEGIN
    UPDATE public.standard_document_versions
    SET status = 'verified', source_url = 'https://example.test/guideline-v2.pdf', snapshot_path = 'synthetic/v2.pdf',
        content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
    WHERE id = v_g2;
    RAISE EXCEPTION 'version verified with an unreviewed statement';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.standard_dependant_reviews (version_id, statement_id, clause_text_sha256, outcome, reviewed_by)
  SELECT v_g2, v_statement, ARRAY[text_sha256], 'unchanged', 'synthetic reviewer'
  FROM public.standard_clauses WHERE version_id = v_g2 AND clause_key = 'test.guideline/4.7';
  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/guideline-v2.pdf', snapshot_path = 'synthetic/v2.pdf',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id = v_g2;

  -- Verifying v2 closed v1 on v2's start date.
  IF (SELECT effective_to FROM public.standard_document_versions WHERE id = v_g1) <> '2025-06-16' THEN
    RAISE EXCEPTION 'previous version was not closed';
  END IF;

  -- As-of reads: before v1 nothing; under v1 the first wording; under v2 the second; 4.21 only from 1 Sep.
  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2024-12-31');
  IF v_count <> 0 THEN RAISE EXCEPTION 'a payment before the first version retrieved it'; END IF;
  SELECT text_content INTO v_text FROM public.get_clause_as_of_v1('test.guideline/4.7', '2025-03-01');
  IF v_text IS DISTINCT FROM 'Synthetic cooling-off duty, first wording.' THEN RAISE EXCEPTION 'wrong wording under v1: %', v_text; END IF;
  SELECT text_content INTO v_text FROM public.get_clause_as_of_v1('test.guideline/4.7', '2025-06-16');
  IF v_text IS DISTINCT FROM 'Synthetic cooling-off duty, second wording.' THEN RAISE EXCEPTION 'wrong wording on v2 start: %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2025-07-01') WHERE clause_key = 'test.guideline/4.21';
  IF v_count <> 0 THEN RAISE EXCEPTION 'paragraph retrieved before its own start date'; END IF;
  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2025-09-01') WHERE clause_key = 'test.guideline/4.21';
  IF v_count <> 1 THEN RAISE EXCEPTION 'paragraph not retrieved from its own start date'; END IF;
  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2025-03-01', p_instrument_scope => '{sg_card}');
  IF v_count <> 0 THEN RAISE EXCEPTION 'instrument filter ignored'; END IF;

  -- A new version may not start on or before the current one.
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
  VALUES (v_guideline, 'v0 late', '2025-02-01', 'publisher_site') RETURNING id INTO v_g3;
  BEGIN
    UPDATE public.standard_document_versions
    SET status = 'verified', source_url = 'https://example.test/v0.pdf', snapshot_path = 'synthetic/v0.pdf',
        content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
    WHERE id = v_g3;
    RAISE EXCEPTION 'older version verified over the current one';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Contracts: one per bank, both verified.
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
  VALUES (v_bank_a, '2025-01', '2025-01-01', 'publisher_site') RETURNING id INTO v_a1;
  INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
  VALUES (v_bank_b, '2025-01', '2025-01-01', 'publisher_site') RETURNING id INTO v_b1;
  INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256, tags, embedding, embedding_model) VALUES
    (v_a1, 'test.bank_a_terms/12.3', 'Synthetic Bank A gross negligence clause.', '', '{fault_definition}', c_vec, 'synthetic'),
    (v_b1, 'test.bank_b_terms/8', 'Synthetic Bank B gross negligence clause.', '', '{fault_definition}', c_vec, 'synthetic');

  -- A tag-selected term request needs a review whenever its document changes.
  INSERT INTO public.institution_term_requests (institution, product, purpose, document_key, selector)
  VALUES ('Synthetic Bank A', 'account', 'fault_definition', 'test.bank_a_terms', '{"tags": ["fault_definition"]}')
  RETURNING id INTO v_term;
  BEGIN
    UPDATE public.standard_document_versions
    SET status = 'verified', source_url = 'https://example.test/a.pdf', snapshot_path = 'synthetic/a.pdf',
        content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
    WHERE id = v_a1;
    RAISE EXCEPTION 'contract verified with an unreviewed term request';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.standard_dependant_reviews (version_id, term_request_id, outcome, reviewed_by)
  VALUES (v_a1, v_term, 'unchanged', 'synthetic reviewer');
  UPDATE public.standard_document_versions
  SET status = 'verified', source_url = 'https://example.test/a.pdf', snapshot_path = 'synthetic/a.pdf',
      content_sha256 = c_sha, retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
  WHERE id IN (v_a1, v_b1);

  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2025-03-01', p_institution => 'Synthetic Bank A')
  WHERE institution IS NOT NULL AND institution <> 'Synthetic Bank A';
  IF v_count <> 0 THEN RAISE EXCEPTION 'another institution''s contract was retrieved'; END IF;
  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2025-03-01', p_institution => 'Synthetic Bank A')
  WHERE institution = 'Synthetic Bank A';
  IF v_count <> 1 THEN RAISE EXCEPTION 'the case''s own contract was not retrieved'; END IF;
  SELECT count(*) INTO v_count FROM public.match_standards_v1(c_vec, '2025-03-01') WHERE institution IS NOT NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'a contract was retrieved with no institution given'; END IF;
  SELECT count(*) INTO v_count FROM public.get_clauses_by_tag_v1('fault_definition', 'Synthetic Bank B', '2025-03-01');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.get_clauses_by_tag_v1('fault_definition', 'Synthetic Bank B', '2025-03-01')
                                 WHERE clause_key = 'test.bank_b_terms/8') THEN
    RAISE EXCEPTION 'tag read crossed institutions';
  END IF;

  -- A verified version can be withdrawn, and is then not read.
  UPDATE public.standard_document_versions SET status = 'withdrawn' WHERE id = v_b1;
  SELECT count(*) INTO v_count FROM public.get_clauses_by_tag_v1('fault_definition', 'Synthetic Bank B', '2025-03-01');
  IF v_count <> 0 THEN RAISE EXCEPTION 'withdrawn version was read'; END IF;

  -- The legacy corpus: every mapped document copied once, as a draft, clause for clause.
  IF EXISTS (
    SELECT 1 FROM public.standard_documents s
    JOIN public.standard_document_versions v ON v.document_id = s.id
    WHERE s.legacy_document_id IS NOT NULL AND (v.status <> 'draft' OR v.provenance <> 'legacy_import')
  ) THEN
    RAISE EXCEPTION 'a legacy document was copied as other than a draft legacy import';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.standard_documents s
    WHERE s.legacy_document_id IS NOT NULL
      AND (SELECT count(*) FROM public.regulatory_clauses c WHERE c.document_id = s.legacy_document_id)
       <> (SELECT count(*) FROM public.standard_clauses c JOIN public.standard_document_versions v ON v.id = c.version_id
           WHERE v.document_id = s.id)
  ) THEN
    RAISE EXCEPTION 'legacy clause counts differ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.regulatory_documents WHERE document_key IN ('MAS Notice FMS-N08 (2024)', 'ABS MEDIA RELEASE ENHANCED SAFEGUARDS (2025))')) THEN
    RAISE EXCEPTION 'legacy key typos remain';
  END IF;
END;
$$;

-- No read for anon or authenticated, on the tables or the functions.
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.standard_clauses LIMIT 1;
    RAISE EXCEPTION 'anon read standard_clauses';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_clause_as_of_v1('test.guideline/4.7', '2025-03-01');
    RAISE EXCEPTION 'anon called get_clause_as_of_v1';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.definition_statements LIMIT 1;
    RAISE EXCEPTION 'authenticated read definition_statements';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SELECT 'standards corpus: all checks passed' AS result;

ROLLBACK;
