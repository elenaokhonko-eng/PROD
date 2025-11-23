-- Complaints/evidence alignment and status rollups
-- Run with a service role.

-- 1) Evidence links to both case (complaint) and report, with tagging.
ALTER TABLE IF EXISTS evidence
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'reports'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE evidence
      ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES reports(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE evidence
      ADD COLUMN IF NOT EXISTS report_id UUID;
  END IF;
END $$;

-- 2) Complaints view (alias for cases while keeping current code intact).
DROP VIEW IF EXISTS complaints;
CREATE VIEW complaints AS
SELECT * FROM cases;

-- 3) Complaint status rollup (pending vs completed).
DROP MATERIALIZED VIEW IF EXISTS mv_complaint_status_counts;
CREATE MATERIALIZED VIEW mv_complaint_status_counts AS
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE status <> 'completed') AS pending
FROM cases;

-- 4) Report status rollup (draft vs completed/exported/resolved).
DROP MATERIALIZED VIEW IF EXISTS mv_report_status_counts;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'reports'
      AND table_schema = 'public'
  ) THEN
    EXECUTE $mv$
      CREATE MATERIALIZED VIEW mv_report_status_counts AS
      SELECT
        COUNT(*) FILTER (WHERE status IN ('COMPLETED','EXPORTED','RESOLVED')) AS completed,
        COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED','EXPORTED','RESOLVED')) AS pending
      FROM reports;
    $mv$;
  ELSE
    EXECUTE $mv$
      CREATE MATERIALIZED VIEW mv_report_status_counts AS
      SELECT 0::bigint AS completed, 0::bigint AS pending;
    $mv$;
  END IF;
END $$;

-- Refresh helpers:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_complaint_status_counts;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_report_status_counts;
