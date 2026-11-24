-- FIDReC pack update, Lane 6 (assembly): the "nearest version held" read (brief v5 3.2 rule 6; lanes review of
-- 24 Nov 2026, Decision 12). Needs Elena's approval before it is merged or applied anywhere.
--
-- get_clause_nearest_v1(p_clause_key, p_on_date): exactly what the contract's fake provider does
-- (supabase/functions/_shared/facts/update/contract.ts, nearestClause):
-- - the clause in force on the date, as get_clause_as_of_v1 returns it, with relation 'in_force';
-- - otherwise the clause from the verified version nearest the date, before or after it: relation 'later_version'
--   when the clause starts after the date (distance = start - date, in days), 'earlier_version' when its version
--   ended on or before the date (distance = date - (effective_to - 1)); on a tie the earlier version wins;
-- - no row when no verified version holds the clause at all.
-- A section that prints a result other than 'in_force' prints the fallback line first and never presents that version
-- as the one that applied. Read-only; service role only, like the rest of the corpus. Nothing else is changed.

CREATE OR REPLACE FUNCTION public.get_clause_nearest_v1(p_clause_key text, p_on_date date)
RETURNS TABLE (
  relation text,
  clause_id uuid, clause_key text, clause_ref text, heading_path text[], text_content text, text_sha256 text,
  tags text[], version_id uuid, version_label text, effective_from date, effective_to date, document_key text,
  title text, publisher text, binding_level text, institution text, card_scheme text, source_url text,
  coverage text, instrument_scope text[]
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH in_force AS (
    SELECT 'in_force'::text AS relation, 0 AS distance, 0 AS tie, a.*
    FROM public.get_clause_as_of_v1(p_clause_key, p_on_date) a
  ),
  other AS (
    SELECT
      CASE WHEN p_on_date < COALESCE(c.effective_from_override, v.effective_from) THEN 'later_version' ELSE 'earlier_version' END AS relation,
      CASE WHEN p_on_date < COALESCE(c.effective_from_override, v.effective_from)
        THEN COALESCE(c.effective_from_override, v.effective_from) - p_on_date
        ELSE p_on_date - v.effective_to + 1
      END AS distance,
      CASE WHEN p_on_date < COALESCE(c.effective_from_override, v.effective_from) THEN 1 ELSE 0 END AS tie,
      c.id AS clause_id, c.clause_key, c.clause_ref, c.heading_path, c.text_content, c.text_sha256, c.tags,
      v.id AS version_id, v.version_label, v.effective_from, v.effective_to, d.document_key, d.title, d.publisher, d.binding_level,
      d.institution, d.card_scheme, v.source_url, v.coverage, COALESCE(c.instrument_scope, d.instrument_scope) AS instrument_scope
    FROM public.standard_clauses c
    JOIN public.standard_document_versions v ON v.id = c.version_id
    JOIN public.standard_documents d ON d.id = v.document_id
    WHERE c.clause_key = p_clause_key
      AND v.status = 'verified'
      AND COALESCE(c.effective_from_override, v.effective_from) IS NOT NULL
      AND (p_on_date < COALESCE(c.effective_from_override, v.effective_from) OR v.effective_to <= p_on_date)
      AND NOT EXISTS (SELECT 1 FROM in_force)
  )
  SELECT relation, clause_id, clause_key, clause_ref, heading_path, text_content, text_sha256, tags, version_id,
    version_label, effective_from, effective_to, document_key, title, publisher, binding_level, institution,
    card_scheme, source_url, coverage, instrument_scope
  FROM (
    SELECT * FROM in_force
    UNION ALL
    SELECT * FROM other
  ) x
  ORDER BY distance, tie
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_clause_nearest_v1(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_clause_nearest_v1(text, date) TO service_role;
