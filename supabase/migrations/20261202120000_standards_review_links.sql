-- FIDReC standards brief v5, Phase 1 follow-up: the three items from the review of 20261201120000, needed before
-- any statement is approved.
-- 1) Institutions get one fixed code. standard_documents.institution and institution_term_requests.institution
--    hold that code (foreign key), so a contract and the case it is read for name the bank the same way.
-- 2) A statement is tied to the clause wording it was checked against. Approval records that wording (by hash) for
--    every clause the statement rests on; get_statement_as_of_v1 returns the revision whose recorded wording is the
--    wording in force on the date asked. A version that changes the wording needs a review before it is verified,
--    and the review must cover the version's final text. A review is fixed once its version is verified.
-- 3) Server rules that cite a clause are registered in standard_rule_citations, and the verify check covers them
--    like statements and term requests. standard_version_diff_v2 lists them (it replaces v1, which nothing calls).
-- Service role only, like the rest of the corpus. Nothing is read from these tables until statements are approved.

-- 1) Institutions ----------------------------------------------------------------------------------------------------

CREATE TABLE public.standard_institutions (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  name text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  -- Other names a case may give for the institution, matched without regard to case.
  aliases text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.standard_documents
  ADD CONSTRAINT standard_documents_institution_fkey FOREIGN KEY (institution) REFERENCES public.standard_institutions(code);
ALTER TABLE public.institution_term_requests
  ADD CONSTRAINT institution_term_requests_institution_fkey FOREIGN KEY (institution) REFERENCES public.standard_institutions(code);
CREATE INDEX standard_documents_institution_idx ON public.standard_documents (institution);

-- The code for a name as a case gives it, or null when no institution, or more than one, has that name.
CREATE OR REPLACE FUNCTION public.standard_institution_code_v1(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(i.code) END
  FROM public.standard_institutions i
  WHERE lower(i.name) = lower(btrim(p_name))
     OR EXISTS (SELECT 1 FROM unnest(i.aliases) a WHERE lower(a) = lower(btrim(p_name)))
$$;

-- 2) Statements tied to wording --------------------------------------------------------------------------------------

-- The date whose wording the approver checked the statement against.
ALTER TABLE public.definition_statements ADD COLUMN clauses_as_of date;
ALTER TABLE public.definition_statements
  ADD CONSTRAINT definition_statements_clauses_as_of CHECK (status = 'draft' OR clauses_as_of IS NOT NULL);

-- One row per clause wording a statement was checked against: at approval, and at each "unchanged" review.
CREATE TABLE public.definition_statement_clauses (
  statement_id uuid NOT NULL REFERENCES public.definition_statements(id),
  clause_key text NOT NULL,
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  -- The version the wording was read from: verified for an approval, possibly still a draft for a review.
  version_id uuid NOT NULL REFERENCES public.standard_document_versions(id),
  review_id uuid REFERENCES public.standard_dependant_reviews(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (statement_id, clause_key, text_sha256)
);

CREATE INDEX definition_statement_clauses_version_idx ON public.definition_statement_clauses (version_id);
CREATE INDEX definition_statement_clauses_review_idx ON public.definition_statement_clauses (review_id);

-- A recorded wording is never changed or removed.
CREATE OR REPLACE FUNCTION public.definition_statement_clauses_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'definition_statement_clause_immutable';
END;
$$;

CREATE TRIGGER definition_statement_clauses_guard
  BEFORE UPDATE OR DELETE ON public.definition_statement_clauses
  FOR EACH ROW EXECUTE FUNCTION public.definition_statement_clauses_guard();

-- The approved wording and its date are fixed too (replaces the 20261201120000 guard, adding clauses_as_of).
CREATE OR REPLACE FUNCTION public.definition_statements_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'definition_statement_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
    (NEW.statement_key, NEW.revision, NEW.framework, NEW.applies_to_instrument, NEW.text, NEW.clause_keys,
     NEW.approved_by, NEW.approved_at, NEW.clauses_as_of)
    IS DISTINCT FROM
    (OLD.statement_key, OLD.revision, OLD.framework, OLD.applies_to_instrument, OLD.text, OLD.clause_keys,
     OLD.approved_by, OLD.approved_at, OLD.clauses_as_of)
    OR (NEW.status <> OLD.status AND NEW.status <> 'retired')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'definition_statement_immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- On approval: every clause the statement rests on must be verified and in force on clauses_as_of, and must cover
-- every payment type the statement speaks for. The wording found is recorded.
CREATE OR REPLACE FUNCTION public.definition_statements_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_missing text;
  v_narrower text;
BEGIN
  IF NEW.status <> 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved') THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k) INTO v_missing
  FROM unnest(NEW.clause_keys) k
  WHERE NOT EXISTS (SELECT 1 FROM public.get_clause_as_of_v1(k, NEW.clauses_as_of));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'definition_statement_clause_not_in_force', DETAIL = v_missing;
  END IF;

  SELECT string_agg(c.clause_key, ', ' ORDER BY c.clause_key) INTO v_narrower
  FROM unnest(NEW.clause_keys) k CROSS JOIN LATERAL public.get_clause_as_of_v1(k, NEW.clauses_as_of) c
  WHERE NOT NEW.applies_to_instrument <@ c.instrument_scope;
  IF v_narrower IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'definition_statement_scope_wider_than_clause', DETAIL = v_narrower;
  END IF;

  INSERT INTO public.definition_statement_clauses (statement_id, clause_key, text_sha256, version_id)
  SELECT NEW.id, c.clause_key, c.text_sha256, c.version_id
  FROM unnest(NEW.clause_keys) k CROSS JOIN LATERAL public.get_clause_as_of_v1(k, NEW.clauses_as_of) c
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER definition_statements_link
  AFTER INSERT OR UPDATE OF status ON public.definition_statements
  FOR EACH ROW EXECUTE FUNCTION public.definition_statements_link();

-- Reviews: done again (updated) while the version is a draft, fixed once it is verified or withdrawn.
CREATE OR REPLACE FUNCTION public.standard_dependant_reviews_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.standard_document_versions v WHERE v.id = OLD.version_id AND v.status <> 'draft'
  ) OR (TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_dependant_review_immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER standard_dependant_reviews_guard
  BEFORE UPDATE OR DELETE ON public.standard_dependant_reviews
  FOR EACH ROW EXECUTE FUNCTION public.standard_dependant_reviews_guard();

-- An "unchanged" review of a statement records the version's wording of the clauses it rests on; doing the review
-- again after the draft's text changed records the new wording.
CREATE OR REPLACE FUNCTION public.standard_dependant_reviews_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.statement_id IS NOT NULL AND NEW.outcome = 'unchanged' THEN
    INSERT INTO public.definition_statement_clauses (statement_id, clause_key, text_sha256, version_id, review_id)
    SELECT s.id, c.clause_key, c.text_sha256, c.version_id, NEW.id
    FROM public.definition_statements s
    JOIN public.standard_clauses c ON c.version_id = NEW.version_id AND c.clause_key = ANY (s.clause_keys)
    WHERE s.id = NEW.statement_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER standard_dependant_reviews_link
  AFTER INSERT OR UPDATE ON public.standard_dependant_reviews
  FOR EACH ROW EXECUTE FUNCTION public.standard_dependant_reviews_link();

-- The statement to print for a date: the highest approved revision whose recorded wording is the wording in force on
-- that date for every clause it rests on. No row means no statement was checked against that wording.
CREATE OR REPLACE FUNCTION public.get_statement_as_of_v1(p_statement_key text, p_on_date date)
RETURNS TABLE (
  statement_id uuid, statement_key text, revision integer, framework text, applies_to_instrument text[], text text,
  clause_keys text[], clauses_as_of date, approved_by text, approved_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT s.id, s.statement_key, s.revision, s.framework, s.applies_to_instrument, s.text, s.clause_keys,
    s.clauses_as_of, s.approved_by, s.approved_at
  FROM public.definition_statements s
  WHERE s.statement_key = p_statement_key
    AND s.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM unnest(s.clause_keys) k
      WHERE NOT EXISTS (
        SELECT 1 FROM public.get_clause_as_of_v1(k, p_on_date) c
        JOIN public.definition_statement_clauses l
          ON l.statement_id = s.id AND l.clause_key = c.clause_key AND l.text_sha256 = c.text_sha256
      )
    )
  ORDER BY s.revision DESC
  LIMIT 1
$$;

-- 3) Server rules ----------------------------------------------------------------------------------------------------

-- A server rule (code) that cites a clause. The rule's id is what a review records in standard_dependant_reviews.rule_cite.
CREATE TABLE public.standard_rule_citations (
  rule_id text NOT NULL CHECK (rule_id ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  clause_key text NOT NULL CHECK (clause_key ~ '^[a-z0-9]+(\.[a-z0-9_-]+)+/[a-z0-9._()~-]+$'),
  source_file text NOT NULL CHECK (btrim(source_file) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, clause_key)
);

CREATE INDEX standard_rule_citations_clause_key_idx ON public.standard_rule_citations (clause_key);

-- Versions (replaces the 20261201120000 guard). Verifying now also needs: a review for every server rule citing a
-- changed clause, and, for a statement reviewed as unchanged, its recorded wording to be this version's final text.
CREATE OR REPLACE FUNCTION public.standard_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_document_key text;
  v_missing text;
  v_previous public.standard_document_versions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_version_immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_version_starts_as_draft';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'draft' THEN
    IF (NEW.document_id, NEW.version_label, NEW.effective_from, NEW.issued_on, NEW.retrieved_at, NEW.source_url,
        NEW.snapshot_path, NEW.content_sha256, NEW.provenance, NEW.supersedes_version_id, NEW.coverage,
        NEW.manifest_path, NEW.verified_by, NEW.verified_at)
       IS DISTINCT FROM
       (OLD.document_id, OLD.version_label, OLD.effective_from, OLD.issued_on, OLD.retrieved_at, OLD.source_url,
        OLD.snapshot_path, OLD.content_sha256, OLD.provenance, OLD.supersedes_version_id, OLD.coverage,
        OLD.manifest_path, OLD.verified_by, OLD.verified_at)
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)
       OR (NEW.status <> OLD.status AND NEW.status <> 'withdrawn') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_version_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'verified' THEN
    SELECT d.document_key INTO v_document_key FROM public.standard_documents d WHERE d.id = NEW.document_id;

    -- Every statement, term request and server rule resting on a changed clause needs a review for this version.
    WITH changed AS (SELECT k.clause_key FROM public.standard_version_changed_keys(NEW.id) k)
    SELECT string_agg(item, ', ' ORDER BY item) INTO v_missing FROM (
      SELECT 'statement ' || s.statement_key || ' r' || s.revision AS item
      FROM public.definition_statements s
      WHERE s.status <> 'retired'
        AND s.clause_keys && ARRAY(SELECT clause_key FROM changed)
        AND NOT EXISTS (
          SELECT 1 FROM public.standard_dependant_reviews r WHERE r.version_id = NEW.id AND r.statement_id = s.id
        )
      UNION ALL
      -- Reviewed as unchanged, but the draft's text was edited after the review.
      SELECT 'statement ' || s.statement_key || ' r' || s.revision || ' (text changed after review)'
      FROM public.definition_statements s
      JOIN public.standard_dependant_reviews r ON r.version_id = NEW.id AND r.statement_id = s.id AND r.outcome = 'unchanged'
      WHERE EXISTS (
        SELECT 1 FROM public.standard_clauses c
        WHERE c.version_id = NEW.id AND c.clause_key = ANY (s.clause_keys)
          AND NOT EXISTS (
            SELECT 1 FROM public.definition_statement_clauses l
            WHERE l.statement_id = s.id AND l.clause_key = c.clause_key AND l.text_sha256 = c.text_sha256
          )
      )
      UNION ALL
      SELECT 'term request ' || t.institution || '/' || t.product || '/' || t.purpose
      FROM public.institution_term_requests t
      WHERE t.document_key = v_document_key
        AND EXISTS (SELECT 1 FROM changed)
        AND (
          jsonb_typeof(t.selector -> 'clause_keys') IS DISTINCT FROM 'array'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(t.selector -> 'clause_keys') k
            WHERE k IN (SELECT clause_key FROM changed)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.standard_dependant_reviews r WHERE r.version_id = NEW.id AND r.term_request_id = t.id
        )
      UNION ALL
      SELECT DISTINCT 'rule ' || rc.rule_id
      FROM public.standard_rule_citations rc
      WHERE rc.clause_key IN (SELECT clause_key FROM changed)
        AND NOT EXISTS (
          SELECT 1 FROM public.standard_dependant_reviews r WHERE r.version_id = NEW.id AND r.rule_cite = rc.rule_id
        )
    ) missing;

    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'standard_version_dependants_unreviewed',
        DETAIL = v_missing;
    END IF;

    -- An open-ended version follows the current one, which closes on its start date. An earlier version loaded
    -- later (a bank's previous terms, the EUPG before 16 Dec 2024) carries its own end date and must fit a gap.
    IF NEW.effective_to IS NULL THEN
      SELECT * INTO v_previous FROM public.standard_document_versions p
      WHERE p.document_id = NEW.document_id AND p.status = 'verified' AND p.effective_to IS NULL AND p.id <> NEW.id;
      IF FOUND THEN
        IF NEW.effective_from <= v_previous.effective_from THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'standard_version_not_after_current',
            HINT = 'An earlier version needs its own effective_to.';
        END IF;
        UPDATE public.standard_document_versions SET effective_to = NEW.effective_from WHERE id = v_previous.id;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.standard_document_versions p
      WHERE p.document_id = NEW.document_id AND p.status = 'verified' AND p.id <> NEW.id
        AND daterange(p.effective_from, p.effective_to) && daterange(NEW.effective_from, NEW.effective_to)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'standard_version_overlaps';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- For the person verifying a draft: each changed clause and the statements, term requests and rules resting on it.
DROP FUNCTION public.standard_version_diff_v1(uuid);

CREATE OR REPLACE FUNCTION public.standard_version_diff_v2(p_version_id uuid)
RETURNS TABLE (clause_key text, change text, statements text[], term_requests text[], rules text[])
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT k.clause_key, k.change,
    ARRAY(SELECT s.statement_key || ' r' || s.revision FROM public.definition_statements s
          WHERE s.status <> 'retired' AND k.clause_key = ANY (s.clause_keys) ORDER BY 1),
    ARRAY(SELECT t.institution || '/' || t.product || '/' || t.purpose FROM public.institution_term_requests t
          WHERE t.document_key = split_part(k.clause_key, '/', 1)
            AND (jsonb_typeof(t.selector -> 'clause_keys') IS DISTINCT FROM 'array'
                 OR t.selector -> 'clause_keys' ? k.clause_key)
          ORDER BY 1),
    ARRAY(SELECT rc.rule_id FROM public.standard_rule_citations rc WHERE rc.clause_key = k.clause_key ORDER BY 1)
  FROM public.standard_version_changed_keys(p_version_id) k
  ORDER BY k.clause_key
$$;

-- 4) Access: service role only ---------------------------------------------------------------------------------------

ALTER TABLE public.standard_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.definition_statement_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_rule_citations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.standard_institutions, public.definition_statement_clauses, public.standard_rule_citations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.standard_institutions, public.definition_statement_clauses,
  public.standard_rule_citations TO service_role;

REVOKE ALL ON FUNCTION public.standard_institution_code_v1(text), public.get_statement_as_of_v1(text, date),
  public.standard_version_diff_v2(uuid), public.definition_statement_clauses_guard(), public.definition_statements_link(),
  public.standard_dependant_reviews_guard(), public.standard_dependant_reviews_link()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.standard_institution_code_v1(text), public.get_statement_as_of_v1(text, date),
  public.standard_version_diff_v2(uuid)
  TO service_role;
