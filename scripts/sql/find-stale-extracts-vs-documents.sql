-- Diagnostic: stale extracts vs documents (works pre/post readiness columns).
-- Read-only.

WITH extracts AS (
  SELECT
    e.id AS extract_run_id,
    e.case_id,
    e.created_at AS extract_created_at,
    NULLIF(to_jsonb(e)->>'allow_partial_evidence', '')::boolean AS allow_partial_evidence,
    NULLIF(to_jsonb(e)->>'total_document_count', '')::int AS total_document_count,
    NULLIF(to_jsonb(e)->>'evidence_document_count', '')::int AS evidence_document_count,
    NULLIF(to_jsonb(e)->>'ready_document_count', '')::int AS ready_document_count,
    NULLIF(to_jsonb(e)->>'processed_document_count', '')::int AS processed_document_count_legacy,
    e.prompt_version,
    e.model_name,
    (
      SELECT e2.id
      FROM public.case_extract_runs e2
      WHERE e2.case_id = e.case_id
      ORDER BY e2.created_at DESC
      LIMIT 1
    ) AS latest_extract_id
  FROM public.case_extract_runs e
),
doc_ready AS (
  SELECT
    d.case_id,
    d.id AS document_id,
    d.is_processed,
    d.processing_status,
    coalesce(c.parsed_at, d.upload_date) AS ready_proxy_at,
    (
      lower(coalesce(d.processing_status, '')) = 'ready'
      AND coalesce(d.is_processed, false) = true
      AND (
        d.content_latest_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.case_document_extractions x WHERE x.document_id = d.id
        )
      )
    ) AS is_usable_ready
  FROM public.case_documents d
  LEFT JOIN public.case_documents_content c ON c.id = d.content_latest_id
)
SELECT
  x.extract_run_id,
  x.case_id,
  x.extract_created_at,
  (x.extract_run_id = x.latest_extract_id) AS is_latest_extract,
  x.allow_partial_evidence,
  coalesce(x.ready_document_count, x.evidence_document_count, x.processed_document_count_legacy) AS snapshot_ready,
  (
    SELECT count(*)::int FROM doc_ready dr
    WHERE dr.case_id = x.case_id AND dr.is_usable_ready
  ) AS current_ready,
  EXISTS (
    SELECT 1 FROM doc_ready dr
    WHERE dr.case_id = x.case_id
      AND dr.is_usable_ready
      AND dr.ready_proxy_at > x.extract_created_at
  ) AS has_doc_processed_after_extract,
  (
    coalesce(x.ready_document_count, x.evidence_document_count, x.processed_document_count_legacy) IS NOT NULL
    AND (
      SELECT count(*)::int FROM doc_ready dr
      WHERE dr.case_id = x.case_id AND dr.is_usable_ready
    ) > coalesce(x.ready_document_count, x.evidence_document_count, x.processed_document_count_legacy)
  ) AS current_ready_exceeds_snapshot,
  EXISTS (
    SELECT 1 FROM public.case_validation_runs v WHERE v.extract_run_id = x.extract_run_id
  ) AS has_validation,
  x.model_name,
  x.prompt_version
FROM extracts x
WHERE
  EXISTS (
    SELECT 1 FROM doc_ready dr
    WHERE dr.case_id = x.case_id
      AND dr.is_usable_ready
      AND dr.ready_proxy_at > x.extract_created_at
  )
  OR (
    coalesce(x.ready_document_count, x.evidence_document_count, x.processed_document_count_legacy) IS NOT NULL
    AND (
      SELECT count(*)::int FROM doc_ready dr
      WHERE dr.case_id = x.case_id AND dr.is_usable_ready
    ) > coalesce(x.ready_document_count, x.evidence_document_count, x.processed_document_count_legacy)
  )
ORDER BY
  (x.extract_run_id = x.latest_extract_id) DESC,
  x.extract_created_at DESC;
