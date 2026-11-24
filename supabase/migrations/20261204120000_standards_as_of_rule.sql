-- FIDReC lanes review of 24 Nov 2026, Decision 6: which date a document is read for.
-- 1) standard_documents.as_of_rule: 'event_date' (the default; every document so far) or 'any_date' (MAS written
--    replies and other official clarifications only, so only on an 'announcement'). Fixed once a version of the
--    document is verified, because it changes what a pack prints.
-- 2) get_document_as_of_rule_v1: the rule for a document key; 'event_date' when the document is not held.
-- 3) read_clause_under_as_of_rule_v1: the clause read under its document's rule, as the contract's readUnderAsOfRule
--    does it. Event-date documents are read on the event date, exactly as get_clause_as_of_v1 (unchanged), so an EUPG
--    paragraph that starts on 16 June 2025 is never returned for an earlier event. An any_date document is read on
--    the day the pack is generated; the outcome says when its version is dated after the event.
-- 4) get_statement_for_case_v1: a statement resting only on any_date documents is read on the generation day; any
--    other statement on the event date. get_statement_as_of_v1 is unchanged.
-- Service role only, like the rest of the corpus.

ALTER TABLE public.standard_documents
  ADD COLUMN as_of_rule text NOT NULL DEFAULT 'event_date' CHECK (as_of_rule IN ('event_date', 'any_date')),
  ADD CONSTRAINT standard_documents_any_date_announcement CHECK (as_of_rule = 'event_date' OR binding_level = 'announcement');

CREATE OR REPLACE FUNCTION public.standard_documents_as_of_rule_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.as_of_rule IS DISTINCT FROM OLD.as_of_rule AND EXISTS (
    SELECT 1 FROM public.standard_document_versions v WHERE v.document_id = OLD.id AND v.status <> 'draft'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_document_as_of_rule_fixed',
      DETAIL = 'A version of this document is verified; its as-of rule is fixed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER standard_documents_as_of_rule_guard
  BEFORE UPDATE OF as_of_rule ON public.standard_documents
  FOR EACH ROW EXECUTE FUNCTION public.standard_documents_as_of_rule_guard();

CREATE OR REPLACE FUNCTION public.get_document_as_of_rule_v1(p_document_key text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT d.as_of_rule FROM public.standard_documents d WHERE d.document_key = p_document_key), 'event_date')
$$;

-- outcome: 'held', 'not_held' or 'held_after_the_events' (contract AS_OF_RULE_OUTCOMES). Always one row.
CREATE OR REPLACE FUNCTION public.read_clause_under_as_of_rule_v1(p_clause_key text, p_event_date date, p_generated_on date)
RETURNS TABLE (
  outcome text, as_of_rule text, read_on date,
  clause_id uuid, clause_key text, clause_ref text, heading_path text[], text_content text, text_sha256 text,
  tags text[], version_id uuid, version_label text, effective_from date, effective_to date, document_key text,
  title text, publisher text, binding_level text, institution text, card_scheme text, source_url text,
  coverage text, instrument_scope text[]
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT rule, CASE WHEN rule = 'any_date' THEN p_generated_on ELSE p_event_date END AS read_on
    FROM (SELECT public.get_document_as_of_rule_v1(split_part(p_clause_key, '/', 1)) AS rule) x
  )
  SELECT
    CASE
      WHEN c.clause_id IS NULL THEN 'not_held'
      WHEN r.rule = 'any_date' AND c.effective_from > p_event_date THEN 'held_after_the_events'
      ELSE 'held'
    END,
    r.rule, r.read_on,
    c.clause_id, c.clause_key, c.clause_ref, c.heading_path, c.text_content, c.text_sha256, c.tags, c.version_id,
    c.version_label, c.effective_from, c.effective_to, c.document_key, c.title, c.publisher, c.binding_level,
    c.institution, c.card_scheme, c.source_url, c.coverage, c.instrument_scope
  FROM r
  LEFT JOIN LATERAL public.get_clause_as_of_v1(p_clause_key, r.read_on) c ON true
  LIMIT 1
$$;

-- as_of_rule is 'any_date' when every clause the statement's approved revisions rest on is in an any_date document.
CREATE OR REPLACE FUNCTION public.get_statement_for_case_v1(p_statement_key text, p_event_date date, p_generated_on date)
RETURNS TABLE (
  as_of_rule text, read_on date,
  statement_id uuid, statement_key text, revision integer, framework text, applies_to_instrument text[], text text,
  clause_keys text[], clauses_as_of date, approved_by text, approved_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH keys AS (
    SELECT DISTINCT split_part(k, '/', 1) AS document_key
    FROM public.definition_statements s, unnest(s.clause_keys) k
    WHERE s.statement_key = p_statement_key AND s.status = 'approved'
  ),
  r AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM keys)
       AND NOT EXISTS (SELECT 1 FROM keys WHERE public.get_document_as_of_rule_v1(keys.document_key) <> 'any_date')
      THEN 'any_date' ELSE 'event_date' END AS rule
  )
  SELECT r.rule, CASE WHEN r.rule = 'any_date' THEN p_generated_on ELSE p_event_date END,
    g.statement_id, g.statement_key, g.revision, g.framework, g.applies_to_instrument, g.text, g.clause_keys,
    g.clauses_as_of, g.approved_by, g.approved_at
  FROM r
  CROSS JOIN LATERAL public.get_statement_as_of_v1(
    p_statement_key, CASE WHEN r.rule = 'any_date' THEN p_generated_on ELSE p_event_date END
  ) g
$$;

REVOKE ALL ON FUNCTION public.standard_documents_as_of_rule_guard(), public.get_document_as_of_rule_v1(text),
  public.read_clause_under_as_of_rule_v1(text, date, date), public.get_statement_for_case_v1(text, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_document_as_of_rule_v1(text), public.read_clause_under_as_of_rule_v1(text, date, date),
  public.get_statement_for_case_v1(text, date, date)
  TO service_role;
