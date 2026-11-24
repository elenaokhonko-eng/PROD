-- FIDReC standards brief v5, 4d: statements that say a paragraph does not apply to a payment type can be approved.
-- eupg.fault.cards ("Section 5 ... does not apply to credit, charge or debit card transactions (paragraph 5.1)") and
-- srf.fault.cards (SRF footnote 1) speak for card payments and rest on clauses whose scope leaves cards out. The
-- approval check of 20261202120000 refused them: every clause had to cover every payment type the statement speaks for.
-- 1) definition_statements.exclusion_clause_keys: the clauses the statement cites as not applying to its payment
--    types. Set explicitly, a subset of clause_keys, fixed once the revision is approved.
-- 2) On approval a clause listed there must leave out every payment type the statement speaks for (the reverse of the
--    usual check, so a flag cannot hide a clause that does apply). Every other clause keeps the usual check.
-- Earlier migrations are not edited; the two functions are replaced in full.

ALTER TABLE public.definition_statements ADD COLUMN exclusion_clause_keys text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.definition_statements
  ADD CONSTRAINT definition_statements_exclusions_cited CHECK (exclusion_clause_keys <@ clause_keys);

-- The approved wording, its date and its exclusions are fixed (replaces the 20261202120000 guard).
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
     NEW.approved_by, NEW.approved_at, NEW.clauses_as_of, NEW.exclusion_clause_keys)
    IS DISTINCT FROM
    (OLD.statement_key, OLD.revision, OLD.framework, OLD.applies_to_instrument, OLD.text, OLD.clause_keys,
     OLD.approved_by, OLD.approved_at, OLD.clauses_as_of, OLD.exclusion_clause_keys)
    OR (NEW.status <> OLD.status AND NEW.status <> 'retired')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'definition_statement_immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- On approval (replaces the 20261202120000 function): every clause must be verified and in force on clauses_as_of.
-- A clause the statement cites as an exclusion must leave out every payment type the statement speaks for; every
-- other clause must cover them. The wording found is recorded.
CREATE OR REPLACE FUNCTION public.definition_statements_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_missing text;
  v_narrower text;
  v_not_excluded text;
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
  WHERE NOT (k = ANY (NEW.exclusion_clause_keys))
    AND NOT NEW.applies_to_instrument <@ c.instrument_scope;
  IF v_narrower IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'definition_statement_scope_wider_than_clause', DETAIL = v_narrower;
  END IF;

  SELECT string_agg(c.clause_key, ', ' ORDER BY c.clause_key) INTO v_not_excluded
  FROM unnest(NEW.exclusion_clause_keys) k CROSS JOIN LATERAL public.get_clause_as_of_v1(k, NEW.clauses_as_of) c
  WHERE NEW.applies_to_instrument && c.instrument_scope;
  IF v_not_excluded IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'definition_statement_exclusion_clause_applies',
      DETAIL = v_not_excluded;
  END IF;

  INSERT INTO public.definition_statement_clauses (statement_id, clause_key, text_sha256, version_id)
  SELECT NEW.id, c.clause_key, c.text_sha256, c.version_id
  FROM unnest(NEW.clause_keys) k CROSS JOIN LATERAL public.get_clause_as_of_v1(k, NEW.clauses_as_of) c
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.definition_statements_guard(), public.definition_statements_link()
  FROM PUBLIC, anon, authenticated;
