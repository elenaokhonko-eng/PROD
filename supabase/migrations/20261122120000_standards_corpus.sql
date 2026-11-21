-- FIDReC standards brief v5, Phase 1 (section 3.2, 4d, 4e): a versioned corpus of the documents the packs cite.
-- 1) standard_documents, standard_document_versions, standard_clauses: one row per document, per version, per clause
--    per version. A version records when it was in force and where its text came from; cited text never changes.
-- 2) definition_statements and institution_term_requests, with standard_dependant_reviews: a version that changes a
--    clause cannot be verified until every statement and term request resting on that clause is reviewed for it.
-- 3) match_standards_v1, get_clause_as_of_v1, get_clauses_by_tag_v1 (as-of reads) and standard_version_diff_v1.
-- 4) Repairs to the legacy rows: the "FMS-N08" and "(2025))" keys, and the N06 and N13 titles.
-- 5) The 10 legacy documents are copied in as draft versions (provenance legacy_import). Nothing reads a draft, so no
--    pack or evaluation changes until a version is checked against its source and verified.
-- Service role only, like regulatory_documents today (RLS on, no policies). Earlier migrations are not edited; the
-- legacy tables and their match functions stay until the old pipeline is retired.

-- 1) Documents, versions, clauses -------------------------------------------------------------------------------------

CREATE TABLE public.standard_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_key text NOT NULL UNIQUE CHECK (document_key ~ '^[a-z0-9]+(\.[a-z0-9_-]+)+$'),
  title text NOT NULL CHECK (btrim(title) <> ''),
  publisher text NOT NULL CHECK (btrim(publisher) <> ''),
  binding_level text NOT NULL
    CHECK (binding_level IN ('guideline', 'notice', 'industry_code', 'announcement', 'contract', 'scheme_rule', 'forum_rules')),
  applies_to text[] NOT NULL DEFAULT '{}'
    CHECK (applies_to <@ ARRAY['bank', 'card_issuer', 'payment_service_provider', 'telco']::text[]),
  instrument_scope text[] NOT NULL DEFAULT '{}'
    CHECK (instrument_scope <@ ARRAY['account_transfer', 'sg_card', 'ewallet']::text[]),
  institution text,
  card_scheme text CHECK (card_scheme IN ('visa', 'mastercard')),
  canonical_url text CHECK (canonical_url ~ '^https://'),
  legacy_document_id uuid UNIQUE REFERENCES public.regulatory_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A contract names its institution and a scheme rulebook its scheme, so retrieval can keep them to the right case.
  CONSTRAINT standard_documents_contract_institution CHECK ((binding_level = 'contract') = (institution IS NOT NULL)),
  CONSTRAINT standard_documents_scheme_named CHECK ((binding_level = 'scheme_rule') = (card_scheme IS NOT NULL))
);

CREATE TABLE public.standard_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.standard_documents(id),
  version_label text NOT NULL CHECK (btrim(version_label) <> ''),
  effective_from date,
  effective_to date,
  issued_on date,
  retrieved_at timestamptz,
  source_url text CHECK (source_url ~ '^https://'),
  snapshot_path text,
  content_sha256 text CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  provenance text NOT NULL
    CHECK (provenance IN ('publisher_site', 'web_archive', 'provided_by_user', 'provided_by_institution', 'legacy_import')),
  supersedes_version_id uuid REFERENCES public.standard_document_versions(id),
  coverage text NOT NULL DEFAULT 'full' CHECK (coverage IN ('full', 'selected_sections')),
  manifest_path text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'withdrawn')),
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_label),
  CONSTRAINT standard_versions_dates CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Verified means: in force from a known date, the exact file we read is kept and hashed, its origin is known,
  -- and a person checked it. A legacy import has none of that, so it stays a draft.
  CONSTRAINT standard_versions_verified_complete CHECK (
    status <> 'verified' OR (
      effective_from IS NOT NULL AND retrieved_at IS NOT NULL AND snapshot_path IS NOT NULL
      AND content_sha256 IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL
      AND provenance <> 'legacy_import'
      AND (source_url IS NOT NULL OR provenance IN ('provided_by_user', 'provided_by_institution'))
      AND (coverage = 'full' OR manifest_path IS NOT NULL)
    )
  )
);

-- At most one open-ended verified version per document; verifying a newer one closes the older (trigger below).
CREATE UNIQUE INDEX standard_versions_one_current_idx
  ON public.standard_document_versions (document_id) WHERE status = 'verified' AND effective_to IS NULL;
CREATE INDEX standard_versions_supersedes_idx ON public.standard_document_versions (supersedes_version_id);

CREATE TABLE public.standard_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.standard_document_versions(id),
  -- Stable across versions: the document key, then the paragraph, e.g. mas.eupg/4.7 or mas.eupg/fn20.
  clause_key text NOT NULL CHECK (clause_key ~ '^[a-z0-9]+(\.[a-z0-9_-]+)+/[a-z0-9._()~-]+$'),
  clause_ref text,
  heading_path text[] NOT NULL DEFAULT '{}',
  text_content text NOT NULL CHECK (btrim(text_content) <> ''),
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  tags text[] NOT NULL DEFAULT '{}',
  effective_from_override date,
  embedding public.vector(1536),
  embedding_model text,
  legacy_clause_id uuid UNIQUE REFERENCES public.regulatory_clauses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, clause_key),
  CONSTRAINT standard_clauses_embedding_model CHECK ((embedding IS NULL) = (embedding_model IS NULL))
);

CREATE INDEX standard_clauses_clause_key_idx ON public.standard_clauses (clause_key);
CREATE INDEX standard_clauses_tags_idx ON public.standard_clauses USING gin (tags);

-- 2) Statements, term requests, reviews ------------------------------------------------------------------------------

-- A fixed sentence the pack prints, tied to the clauses it rests on. Rewording is a new revision; an approved
-- revision is never edited, so a pack dated under an older version keeps printing the wording reviewed for it.
CREATE TABLE public.definition_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_key text NOT NULL CHECK (statement_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  framework text NOT NULL
    CHECK (framework IN ('eupg', 'srf', 'abs_card_code', 'mas_reply', 'scheme', 'institution_terms')),
  applies_to_instrument text[] NOT NULL DEFAULT '{}'
    CHECK (applies_to_instrument <@ ARRAY['account_transfer', 'sg_card', 'ewallet']::text[]),
  text text NOT NULL CHECK (btrim(text) <> ''),
  clause_keys text[] NOT NULL CHECK (cardinality(clause_keys) >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_key, revision),
  CONSTRAINT definition_statements_approval CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE INDEX definition_statements_clause_keys_idx ON public.definition_statements USING gin (clause_keys);

-- Which of an institution's own clauses the pack reads, per product and purpose. A new institution is a row, not code.
CREATE TABLE public.institution_term_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution text NOT NULL CHECK (btrim(institution) <> ''),
  product text NOT NULL CHECK (product IN ('account', 'digital_banking', 'credit_card', 'debit_card', 'ewallet')),
  purpose text NOT NULL CHECK (purpose IN (
    'fault_definition', 'customer_security_duty', 'liability_unauthorised',
    'notification_deadline', 'dispute_chargeback', 'conclusive_evidence'
  )),
  document_key text NOT NULL REFERENCES public.standard_documents(document_key),
  -- {"clause_keys": [...]} once a person has confirmed the clauses, otherwise {"tags": [...]}.
  selector jsonb NOT NULL CHECK (
    jsonb_typeof(selector) = 'object'
    AND (jsonb_typeof(selector -> 'clause_keys') = 'array' OR jsonb_typeof(selector -> 'tags') = 'array')
  ),
  quote_mode text NOT NULL DEFAULT 'quote' CHECK (quote_mode IN ('quote', 'reference_only')),
  -- For fault_definition, set by a person at ingestion: the clause defines the term, uses it without defining it,
  -- or the terms do not use negligence, gross negligence or recklessness.
  term_outcome text CHECK (term_outcome IN ('defines', 'uses_undefined', 'not_used')),
  term text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution, product, purpose),
  CONSTRAINT institution_term_requests_confirmed CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT institution_term_requests_term CHECK (term_outcome IS NULL OR term_outcome = 'not_used' OR term IS NOT NULL)
);

CREATE INDEX institution_term_requests_document_key_idx ON public.institution_term_requests (document_key);

-- A person's review of one dependant for one version: the clause texts it was checked against and the outcome.
CREATE TABLE public.standard_dependant_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.standard_document_versions(id),
  statement_id uuid REFERENCES public.definition_statements(id),
  term_request_id uuid REFERENCES public.institution_term_requests(id),
  -- A server rule's citation (file and clause_key); rules live in code, so the review is recorded by the cite.
  rule_cite text,
  clause_text_sha256 text[] NOT NULL DEFAULT '{}',
  outcome text NOT NULL CHECK (outcome IN ('unchanged', 'reworded', 'retired')),
  reviewed_by text NOT NULL CHECK (btrim(reviewed_by) <> ''),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT standard_dependant_reviews_one_target CHECK (
    (statement_id IS NOT NULL)::int + (term_request_id IS NOT NULL)::int + (rule_cite IS NOT NULL)::int = 1
  )
);

CREATE UNIQUE INDEX standard_dependant_reviews_statement_idx
  ON public.standard_dependant_reviews (version_id, statement_id) WHERE statement_id IS NOT NULL;
CREATE UNIQUE INDEX standard_dependant_reviews_term_idx
  ON public.standard_dependant_reviews (version_id, term_request_id) WHERE term_request_id IS NOT NULL;
CREATE UNIQUE INDEX standard_dependant_reviews_rule_idx
  ON public.standard_dependant_reviews (version_id, rule_cite) WHERE rule_cite IS NOT NULL;
CREATE INDEX standard_dependant_reviews_version_idx ON public.standard_dependant_reviews (version_id);
CREATE INDEX standard_dependant_reviews_statement_fk_idx ON public.standard_dependant_reviews (statement_id);
CREATE INDEX standard_dependant_reviews_term_fk_idx ON public.standard_dependant_reviews (term_request_id);

-- 3) Integrity triggers ----------------------------------------------------------------------------------------------

-- Clauses: the hash is computed here, the key must belong to the version's document, and once the version leaves
-- draft only the embedding may change (it is how the text is found, not what is printed).
CREATE OR REPLACE FUNCTION public.standard_clauses_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_document_key text;
BEGIN
  SELECT v.status, d.document_key INTO v_status, v_document_key
  FROM public.standard_document_versions v JOIN public.standard_documents d ON d.id = v.document_id
  WHERE v.id = COALESCE(NEW.version_id, OLD.version_id);

  IF TG_OP = 'DELETE' THEN
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_clause_immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND v_status <> 'draft' AND (
    NEW.version_id, NEW.clause_key, NEW.clause_ref, NEW.heading_path, NEW.text_content, NEW.tags, NEW.effective_from_override
  ) IS DISTINCT FROM (
    OLD.version_id, OLD.clause_key, OLD.clause_ref, OLD.heading_path, OLD.text_content, OLD.tags, OLD.effective_from_override
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_clause_immutable';
  END IF;

  IF TG_OP = 'INSERT' AND v_status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'standard_version_not_draft';
  END IF;

  IF split_part(NEW.clause_key, '/', 1) <> v_document_key THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'standard_clause_key_document_mismatch';
  END IF;

  NEW.text_sha256 := encode(sha256(convert_to(NEW.text_content, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER standard_clauses_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.standard_clauses
  FOR EACH ROW EXECUTE FUNCTION public.standard_clauses_guard();

-- The clauses a version adds, removes or changes against the verified version it follows.
CREATE OR REPLACE FUNCTION public.standard_version_changed_keys(p_version_id uuid)
RETURNS TABLE (clause_key text, change text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH v AS (
    SELECT v.id, v.document_id,
      COALESCE(v.supersedes_version_id, (
        SELECT p.id FROM public.standard_document_versions p
        WHERE p.document_id = v.document_id AND p.status = 'verified' AND p.effective_to IS NULL AND p.id <> v.id
      )) AS previous_id
    FROM public.standard_document_versions v WHERE v.id = p_version_id
  ),
  new_clauses AS (SELECT c.clause_key, c.text_sha256 FROM public.standard_clauses c JOIN v ON c.version_id = v.id),
  old_clauses AS (SELECT c.clause_key, c.text_sha256 FROM public.standard_clauses c JOIN v ON c.version_id = v.previous_id)
  SELECT COALESCE(n.clause_key, o.clause_key),
    CASE WHEN o.clause_key IS NULL THEN 'added' WHEN n.clause_key IS NULL THEN 'removed' ELSE 'changed' END
  FROM new_clauses n FULL JOIN old_clauses o ON o.clause_key = n.clause_key
  WHERE n.text_sha256 IS DISTINCT FROM o.text_sha256
$$;

-- Versions: verifying checks the dependants and closes the previous version; a verified version's content is fixed,
-- and afterwards only its end date (once) and a move to withdrawn are allowed.
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

    -- Every statement and term request resting on a changed clause needs a review for this version.
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
    ) missing;

    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'standard_version_dependants_unreviewed',
        DETAIL = v_missing;
    END IF;

    SELECT * INTO v_previous FROM public.standard_document_versions p
    WHERE p.document_id = NEW.document_id AND p.status = 'verified' AND p.effective_to IS NULL AND p.id <> NEW.id;
    IF FOUND THEN
      IF NEW.effective_from <= v_previous.effective_from THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'standard_version_not_after_current';
      END IF;
      UPDATE public.standard_document_versions SET effective_to = NEW.effective_from WHERE id = v_previous.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER standard_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.standard_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.standard_versions_guard();

-- Statements: an approved revision's wording and clauses are fixed; it may only be retired.
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
     NEW.approved_by, NEW.approved_at)
    IS DISTINCT FROM
    (OLD.statement_key, OLD.revision, OLD.framework, OLD.applies_to_instrument, OLD.text, OLD.clause_keys,
     OLD.approved_by, OLD.approved_at)
    OR (NEW.status <> OLD.status AND NEW.status <> 'retired')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'definition_statement_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER definition_statements_guard
  BEFORE UPDATE OR DELETE ON public.definition_statements
  FOR EACH ROW EXECUTE FUNCTION public.definition_statements_guard();

-- 4) As-of reads -----------------------------------------------------------------------------------------------------

-- A clause is in force on a date when its version is verified and covers the date, and any later start for the
-- paragraph itself (effective_from_override) has passed. Another institution's contract is never returned.
CREATE OR REPLACE FUNCTION public.match_standards_v1(
  query_embedding public.vector,
  p_on_date date,
  p_layers text[] DEFAULT NULL,
  p_applies_to text[] DEFAULT NULL,
  p_instrument_scope text[] DEFAULT NULL,
  p_institution text DEFAULT NULL,
  p_card_scheme text DEFAULT NULL,
  match_count integer DEFAULT 10,
  similarity_threshold double precision DEFAULT 0.15
)
RETURNS TABLE (
  clause_id uuid, clause_key text, clause_ref text, heading_path text[], text_content text, text_sha256 text,
  tags text[], version_id uuid, version_label text, effective_from date, effective_to date, document_key text,
  title text, publisher text, binding_level text, institution text, card_scheme text, source_url text,
  coverage text, similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.id, c.clause_key, c.clause_ref, c.heading_path, c.text_content, c.text_sha256, c.tags, v.id,
    v.version_label, v.effective_from, v.effective_to, d.document_key, d.title, d.publisher, d.binding_level,
    d.institution, d.card_scheme, v.source_url, v.coverage,
    1 - (c.embedding OPERATOR(public.<=>) query_embedding) AS similarity
  FROM public.standard_clauses c
  JOIN public.standard_document_versions v ON v.id = c.version_id
  JOIN public.standard_documents d ON d.id = v.document_id
  WHERE p_on_date IS NOT NULL
    AND v.status = 'verified'
    AND COALESCE(c.effective_from_override, v.effective_from) <= p_on_date
    AND (v.effective_to IS NULL OR v.effective_to > p_on_date)
    AND c.embedding IS NOT NULL
    AND (p_layers IS NULL OR d.binding_level = ANY (p_layers))
    AND (p_applies_to IS NULL OR d.applies_to && p_applies_to)
    AND (p_instrument_scope IS NULL OR d.instrument_scope && p_instrument_scope)
    AND (d.institution IS NULL OR d.institution = p_institution)
    AND (d.card_scheme IS NULL OR d.card_scheme = p_card_scheme)
    AND 1 - (c.embedding OPERATOR(public.<=>) query_embedding) >= similarity_threshold
  ORDER BY c.embedding OPERATOR(public.<=>) query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 50)
$$;

CREATE OR REPLACE FUNCTION public.get_clause_as_of_v1(p_clause_key text, p_on_date date)
RETURNS TABLE (
  clause_id uuid, clause_key text, clause_ref text, heading_path text[], text_content text, text_sha256 text,
  tags text[], version_id uuid, version_label text, effective_from date, effective_to date, document_key text,
  title text, publisher text, binding_level text, institution text, card_scheme text, source_url text,
  coverage text
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.id, c.clause_key, c.clause_ref, c.heading_path, c.text_content, c.text_sha256, c.tags, v.id,
    v.version_label, v.effective_from, v.effective_to, d.document_key, d.title, d.publisher, d.binding_level,
    d.institution, d.card_scheme, v.source_url, v.coverage
  FROM public.standard_clauses c
  JOIN public.standard_document_versions v ON v.id = c.version_id
  JOIN public.standard_documents d ON d.id = v.document_id
  WHERE c.clause_key = p_clause_key
    AND v.status = 'verified'
    AND COALESCE(c.effective_from_override, v.effective_from) <= p_on_date
    AND (v.effective_to IS NULL OR v.effective_to > p_on_date)
$$;

CREATE OR REPLACE FUNCTION public.get_clauses_by_tag_v1(p_tag text, p_institution text, p_on_date date)
RETURNS TABLE (
  clause_id uuid, clause_key text, clause_ref text, heading_path text[], text_content text, text_sha256 text,
  tags text[], version_id uuid, version_label text, effective_from date, effective_to date, document_key text,
  title text, publisher text, binding_level text, institution text, card_scheme text, source_url text,
  coverage text
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.id, c.clause_key, c.clause_ref, c.heading_path, c.text_content, c.text_sha256, c.tags, v.id,
    v.version_label, v.effective_from, v.effective_to, d.document_key, d.title, d.publisher, d.binding_level,
    d.institution, d.card_scheme, v.source_url, v.coverage
  FROM public.standard_clauses c
  JOIN public.standard_document_versions v ON v.id = c.version_id
  JOIN public.standard_documents d ON d.id = v.document_id
  WHERE p_tag = ANY (c.tags)
    AND (d.institution IS NULL OR d.institution = p_institution)
    AND v.status = 'verified'
    AND COALESCE(c.effective_from_override, v.effective_from) <= p_on_date
    AND (v.effective_to IS NULL OR v.effective_to > p_on_date)
  ORDER BY d.document_key, c.clause_key
$$;

-- For the person verifying a draft: each changed clause and what rests on it.
CREATE OR REPLACE FUNCTION public.standard_version_diff_v1(p_version_id uuid)
RETURNS TABLE (clause_key text, change text, statements text[], term_requests text[])
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
          ORDER BY 1)
  FROM public.standard_version_changed_keys(p_version_id) k
  ORDER BY k.clause_key
$$;

-- 5) Access: service role only ---------------------------------------------------------------------------------------

ALTER TABLE public.standard_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.definition_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_term_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_dependant_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.standard_documents, public.standard_document_versions, public.standard_clauses,
  public.definition_statements, public.institution_term_requests, public.standard_dependant_reviews
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.standard_documents, public.standard_document_versions,
  public.standard_clauses, public.definition_statements, public.institution_term_requests,
  public.standard_dependant_reviews TO service_role;

REVOKE ALL ON FUNCTION public.match_standards_v1(public.vector, date, text[], text[], text[], text, text, integer, double precision),
  public.get_clause_as_of_v1(text, date), public.get_clauses_by_tag_v1(text, text, date),
  public.standard_version_diff_v1(uuid), public.standard_version_changed_keys(uuid),
  public.standard_clauses_guard(), public.standard_versions_guard(), public.definition_statements_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_standards_v1(public.vector, date, text[], text[], text[], text, text, integer, double precision),
  public.get_clause_as_of_v1(text, date), public.get_clauses_by_tag_v1(text, text, date),
  public.standard_version_diff_v1(uuid), public.standard_version_changed_keys(uuid)
  TO service_role;

-- 6) Repairs to the legacy rows (brief 1.1, 1.2) ---------------------------------------------------------------------
-- The pack prints document_key as the document's name, so the misspelt keys reach users today.

UPDATE public.regulatory_documents SET document_key = 'MAS Notice FSM-N08 (2024)', updated_at = now()
WHERE document_key = 'MAS Notice FMS-N08 (2024)';
UPDATE public.regulatory_documents SET document_key = 'ABS MEDIA RELEASE ENHANCED SAFEGUARDS (2025)', updated_at = now()
WHERE document_key = 'ABS MEDIA RELEASE ENHANCED SAFEGUARDS (2025))';
-- FSM-N06 is banks' cyber hygiene notice; FSM-N13 is the technology risk management notice for payment system
-- operators, settlement institutions and DPT service providers (MAS cyber-security page, since 10 May 2024).
UPDATE public.regulatory_documents SET document_title = 'NOTICE ON CYBER HYGIENE', updated_at = now()
WHERE document_key = 'MAS Notice FSM-N06 (2024)' AND document_title = 'NOTICE ON TECHNOLOGY RISK MANAGEMENT';
UPDATE public.regulatory_documents SET document_title = 'NOTICE ON TECHNOLOGY RISK MANAGEMENT', updated_at = now()
WHERE document_key = 'MAS Notice FSM-N13 (2024)' AND document_title = 'NOTICE ON CYBER HYGIENE';

-- 7) Copy the legacy corpus in as drafts -----------------------------------------------------------------------------

INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope,
  legacy_document_id)
SELECT m.document_key, m.title, m.publisher, m.binding_level, m.applies_to::text[], m.instrument_scope::text[], d.id
FROM (VALUES
  ('MAS E-Payments User Protection Guidelines (2018, revised 2024)', 'mas.eupg', 'E-Payments User Protection Guidelines',
   'Monetary Authority of Singapore', 'guideline', '{bank,payment_service_provider}', '{account_transfer,sg_card,ewallet}'),
  ('MAS SRF Guidelines (2024)', 'mas.srf', 'Guidelines on Shared Responsibility Framework',
   'Monetary Authority of Singapore', 'guideline', '{bank,payment_service_provider,telco}', '{account_transfer,ewallet}'),
  ('MAS Anti-Scam Measures for MPI E-Wallets (2024)', 'mas.mpi_ewallet_antiscam',
   'Anti-Scam Measures by Major Payment Institutions that Issue Personal Payment Accounts Containing E-Money',
   'Monetary Authority of Singapore', 'guideline', '{payment_service_provider}', '{ewallet}'),
  ('MAS Notice FSM-N05 (2024)', 'mas.fsm-n05', 'Notice on Technology Risk Management (FSM-N05)',
   'Monetary Authority of Singapore', 'notice', '{bank}', '{account_transfer,sg_card,ewallet}'),
  ('MAS Notice FSM-N06 (2024)', 'mas.fsm-n06', 'Notice on Cyber Hygiene (FSM-N06)',
   'Monetary Authority of Singapore', 'notice', '{bank}', '{account_transfer,sg_card,ewallet}'),
  ('MAS Notice FSM-N08 (2024)', 'mas.fsm-n08', 'Notice on Cyber Hygiene (FSM-N08)',
   'Monetary Authority of Singapore', 'notice', '{card_issuer}', '{sg_card}'),
  ('MAS Notice FSM-N13 (2024)', 'mas.fsm-n13', 'Notice on Technology Risk Management (FSM-N13)',
   'Monetary Authority of Singapore', 'notice', '{payment_service_provider}', '{account_transfer,ewallet}'),
  ('MAS Notice FSM-N14 (2024)', 'mas.fsm-n14', 'Notice on Cyber Hygiene (FSM-N14)',
   'Monetary Authority of Singapore', 'notice', '{payment_service_provider}', '{account_transfer,ewallet}'),
  ('ABS CODE OF PRACTICE BANKS CREDIT CARDS 2020', 'abs.card_code', 'Code of Practice for Banks – Credit Cards',
   'The Association of Banks in Singapore', 'industry_code', '{bank,card_issuer}', '{sg_card}'),
  ('ABS MEDIA RELEASE ENHANCED SAFEGUARDS (2025)', 'abs.media_2025_10_safeguards',
   'Enhanced Safeguards to Better Protect Accounts from Being Emptied by Scammers',
   'The Association of Banks in Singapore', 'announcement', '{bank}', '{account_transfer}')
) AS m (legacy_key, document_key, title, publisher, binding_level, applies_to, instrument_scope)
JOIN public.regulatory_documents d ON d.document_key = m.legacy_key;

-- One draft version each. "selected_sections": the legacy rows are extracts, not checked as complete.
INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, issued_on, provenance,
  coverage)
SELECT s.id, COALESCE(NULLIF(btrim(d.version), ''), 'legacy import'), COALESCE(d.effective_date, d.issue_date),
  d.issue_date, 'legacy_import', 'selected_sections'
FROM public.standard_documents s JOIN public.regulatory_documents d ON d.id = s.legacy_document_id;

-- Clause keys: the clause_ref where there is one, else the paragraph number the text opens with, else a key from
-- the legacy row's id. A repeated key gets ~2, ~3 in the legacy row's order. Embeddings are copied as they are.
INSERT INTO public.standard_clauses (version_id, clause_key, clause_ref, heading_path, text_content, text_sha256, tags,
  embedding, embedding_model, legacy_clause_id)
SELECT k.version_id,
  k.base_key || CASE WHEN k.n > 1 THEN '~' || k.n ELSE '' END,
  k.clause_ref, k.heading_path, k.text_content, '', k.tags, k.embedding,
  CASE WHEN k.embedding IS NULL THEN NULL ELSE 'text-embedding-3-small' END,
  k.legacy_clause_id
FROM (
  SELECT b.*, row_number() OVER (PARTITION BY b.version_id, b.base_key ORDER BY b.created_at, b.legacy_clause_id) AS n
  FROM (
    SELECT v.id AS version_id,
      s.document_key || '/' || COALESCE(
        NULLIF(lower(btrim(regexp_replace(btrim(c.clause_ref), '[^A-Za-z0-9.()]+', '-', 'g'), '-')), ''),
        substring(c.text_content FROM '^[[:space:]]*(?:[0-9]+[[:space:]]+[A-Za-z][^0-9]{0,120}[[:space:]]+)?([0-9]+(?:\.[0-9]+)+)'),
        'legacy-' || left(replace(c.id::text, '-', ''), 8)
      ) AS base_key,
      NULLIF(btrim(c.clause_ref), '') AS clause_ref,
      CASE WHEN NULLIF(btrim(c.title), '') IS NULL THEN '{}'::text[] ELSE ARRAY[btrim(c.title)] END AS heading_path,
      regexp_replace(c.text_content, '^[[:space:]]+|[[:space:]]+$', '', 'g') AS text_content,
      CASE WHEN c.clause_type IS NULL OR c.clause_type = 'other' THEN '{}'::text[] ELSE ARRAY[c.clause_type] END AS tags,
      c.embedding::public.vector(1536) AS embedding,
      c.created_at,
      c.id AS legacy_clause_id
    FROM public.regulatory_clauses c
    JOIN public.standard_documents s ON s.legacy_document_id = c.document_id
    JOIN public.standard_document_versions v ON v.document_id = s.id
  ) b
) k;

DO $$
DECLARE
  v_unmapped integer;
BEGIN
  SELECT count(*) INTO v_unmapped FROM public.regulatory_documents d
  WHERE NOT EXISTS (SELECT 1 FROM public.standard_documents s WHERE s.legacy_document_id = d.id);
  IF v_unmapped > 0 THEN
    RAISE NOTICE 'standards corpus: % legacy document(s) not copied (no mapping)', v_unmapped;
  END IF;
END;
$$;
