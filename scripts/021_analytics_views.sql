-- Materialized views for analytics rollups.
-- Run with a service role. Refresh as needed (e.g., cron or trigger).

-- 1) Distinct sessions (last 30 days example)
DROP MATERIALIZED VIEW IF EXISTS mv_session_counts;
CREATE MATERIALIZED VIEW mv_session_counts AS
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  COUNT(DISTINCT session_id) AS unique_sessions,
  COUNT(*) AS total_events
FROM analytics_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

CREATE INDEX IF NOT EXISTS idx_mv_session_counts_day ON mv_session_counts(day);

-- 2) Pages per session (assumes page_view events)
DROP MATERIALIZED VIEW IF EXISTS mv_pages_per_session;
CREATE MATERIALIZED VIEW mv_pages_per_session AS
SELECT
  session_id,
  COUNT(*) FILTER (WHERE event_name = 'page_view') AS page_views,
  COUNT(*) AS total_events,
  MIN(created_at) AS first_event_at,
  MAX(created_at) AS last_event_at
FROM analytics_events
GROUP BY session_id;

CREATE INDEX IF NOT EXISTS idx_mv_pages_per_session_session ON mv_pages_per_session(session_id);

-- 3) Country rollup (relies on ip_country or country fields in event_data)
DROP MATERIALIZED VIEW IF EXISTS mv_country_rollup;
CREATE MATERIALIZED VIEW mv_country_rollup AS
SELECT
  COALESCE(event_data->>'ip_country', event_data->>'country', event_data->>'country_code', 'UNKNOWN') AS country,
  COUNT(*) AS events
FROM analytics_events
GROUP BY 1
ORDER BY 2 DESC;

-- 4) Funnel durations (earliest timestamps per session/user)
DROP MATERIALIZED VIEW IF EXISTS mv_funnel_durations;
CREATE MATERIALIZED VIEW mv_funnel_durations AS
WITH first_events AS (
  SELECT
    COALESCE(session_id, user_id::text) AS key,
    MIN(created_at) FILTER (WHERE event_name = 'story_submitted') AS story_submitted,
    MIN(created_at) FILTER (WHERE event_name = 'signup_complete') AS signup_complete,
    MIN(created_at) FILTER (WHERE event_name = 'documents_uploaded') AS documents_uploaded,
    MIN(created_at) FILTER (WHERE event_name = 'report_generated') AS report_generated,
    MIN(created_at) FILTER (WHERE event_name = 'report_downloaded') AS report_downloaded
  FROM analytics_events
  WHERE event_name IN ('story_submitted','signup_complete','documents_uploaded','report_generated','report_downloaded')
  GROUP BY 1
)
SELECT
  AVG(EXTRACT(EPOCH FROM (signup_complete - story_submitted)) / 60.0) AS avg_story_to_signup_minutes,
  AVG(EXTRACT(EPOCH FROM (documents_uploaded - signup_complete)) / 60.0) AS avg_signup_to_docs_minutes,
  AVG(EXTRACT(EPOCH FROM (report_generated - documents_uploaded)) / 60.0) AS avg_docs_to_report_minutes,
  AVG(EXTRACT(EPOCH FROM (report_downloaded - report_generated)) / 60.0) AS avg_report_to_download_minutes
FROM first_events;

-- To refresh:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_session_counts;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pages_per_session;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_country_rollup;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_funnel_durations;
