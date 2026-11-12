BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.case_documents(id) ON DELETE CASCADE;

ALTER TABLE public.case_documents
  ADD COLUMN IF NOT EXISTS processing_request_id uuid,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT pg_catalog.now();

-- Stop before adding new constraints or indexes when historical data would
-- violate an invariant. Reconciliation must be performed provider-side; this
-- release candidate never guesses, deletes, or rewrites canonical jobs.
DO $preflight$
DECLARE
  v_count bigint;
  v_keys text;
BEGIN
  WITH conflicts AS (
    SELECT document_id
    FROM public.jobs
    WHERE job_type = 'evidence_document_processing'
      AND document_id IS NOT NULL
    GROUP BY document_id
    HAVING count(*) > 1
  )
  SELECT count(*),
         COALESCE((
           SELECT pg_catalog.string_agg(sample.document_id::text, ', ' ORDER BY sample.document_id)
           FROM (
             SELECT document_id
             FROM conflicts
             ORDER BY document_id
             LIMIT 5
           ) AS sample
         ), '')
  INTO v_count, v_keys
  FROM conflicts;
  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = pg_catalog.format(
        '20260830000000 preflight: %s duplicate evidence document job keys; reconcile before applying (samples: %s)',
        v_count, v_keys
      );
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.jobs
  WHERE job_type IS NULL
     OR job_type NOT IN (
       'post_payment_report_generation',
       'evidence_document_processing',
       'consultation_recording_ingest',
       'consultation_transcribe',
       'consultation_summarise',
       'consultation_case_insert'
     );
  SELECT COALESCE(pg_catalog.string_agg(sample.job_type, ', ' ORDER BY sample.job_type), '')
  INTO v_keys
  FROM (
    SELECT DISTINCT COALESCE(job_type, '<null>') AS job_type
    FROM public.jobs
    WHERE job_type IS NULL
       OR job_type NOT IN (
         'post_payment_report_generation',
         'evidence_document_processing',
         'consultation_recording_ingest',
         'consultation_transcribe',
         'consultation_summarise',
         'consultation_case_insert'
       )
    ORDER BY 1
    LIMIT 5
  ) AS sample;
  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = pg_catalog.format(
        '20260830000000 preflight: %s rows have unsupported job types; reconcile before applying (type samples: %s)',
        v_count, v_keys
      );
  END IF;

  SELECT count(*),
         COALESCE((
           SELECT pg_catalog.string_agg(sample.id::text, ', ' ORDER BY sample.id)
           FROM (
             SELECT id
             FROM public.jobs
             WHERE job_type = 'evidence_document_processing'
               AND document_id IS NULL
             ORDER BY id
             LIMIT 5
           ) AS sample
         ), '')
  INTO v_count, v_keys
  FROM public.jobs
  WHERE job_type = 'evidence_document_processing'
    AND document_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = pg_catalog.format(
        '20260830000000 preflight: %s evidence jobs lack document bindings; reconcile before applying (job samples: %s)',
        v_count, v_keys
      );
  END IF;

  SELECT count(*),
         COALESCE((
           SELECT pg_catalog.string_agg(sample.id::text, ', ' ORDER BY sample.id)
           FROM (
             SELECT id
             FROM public.jobs
             WHERE job_type = 'post_payment_report_generation'
               AND document_id IS NOT NULL
             ORDER BY id
             LIMIT 5
           ) AS sample
         ), '')
  INTO v_count, v_keys
  FROM public.jobs
  WHERE job_type = 'post_payment_report_generation'
    AND document_id IS NOT NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = pg_catalog.format(
        '20260830000000 preflight: %s report jobs have unexpected document bindings; reconcile before applying (job samples: %s)',
        v_count, v_keys
      );
  END IF;

  SELECT count(*),
         COALESCE((
           SELECT pg_catalog.string_agg(sample.id::text, ', ' ORDER BY sample.id)
           FROM (
             SELECT d.id
             FROM public.case_documents AS d
             WHERE (
                 d.is_processed = true
                 OR pg_catalog.lower(COALESCE(d.processing_status, '')) IN ('ready', 'processed', 'completed')
               )
               AND NOT (
                 d.is_processed = true
                 AND pg_catalog.lower(COALESCE(d.processing_status, '')) IN ('ready', 'processed', 'completed')
                 AND (
                   d.content_latest_id IS NOT NULL
                   OR EXISTS (
                     SELECT 1
                     FROM public.case_document_extractions AS extraction
                     WHERE extraction.document_id = d.id
                       AND extraction.case_id = d.case_id
                   )
                 )
               )
             ORDER BY d.id
             LIMIT 5
           ) AS sample
         ), '')
  INTO v_count, v_keys
  FROM public.case_documents AS d
  WHERE (
      d.is_processed = true
      OR pg_catalog.lower(COALESCE(d.processing_status, '')) IN ('ready', 'processed', 'completed')
    )
    AND NOT (
      d.is_processed = true
      AND pg_catalog.lower(COALESCE(d.processing_status, '')) IN ('ready', 'processed', 'completed')
      AND (
        d.content_latest_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.case_document_extractions AS extraction
          WHERE extraction.document_id = d.id
            AND extraction.case_id = d.case_id
        )
      )
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = pg_catalog.format(
        '20260830000000 preflight: %s documents have inconsistent ready markers or missing extraction content; reconcile before applying (document samples: %s)',
        v_count, v_keys
      );
  END IF;
END;
$preflight$;

DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT c.conname
  INTO v_constraint
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_class AS t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'jobs'
    AND c.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(c.oid) ILIKE '%job_type%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE pg_catalog.format('ALTER TABLE public.jobs DROP CONSTRAINT %I', v_constraint);
  END IF;
END;
$$;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_job_type_check
  CHECK (job_type IN (
    'post_payment_report_generation',
    'evidence_document_processing',
    'consultation_recording_ingest',
    'consultation_transcribe',
    'consultation_summarise',
    'consultation_case_insert'
  ));

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_worker_document_binding_check
  CHECK (
    (job_type = 'evidence_document_processing' AND document_id IS NOT NULL)
    OR (job_type = 'post_payment_report_generation' AND document_id IS NULL)
    OR job_type NOT IN ('evidence_document_processing', 'post_payment_report_generation')
  );

CREATE UNIQUE INDEX IF NOT EXISTS jobs_evidence_document_unique_idx
  ON public.jobs (document_id)
  WHERE job_type = 'evidence_document_processing';

CREATE OR REPLACE FUNCTION public.is_case_document_ready_v1(
  p_case_id uuid,
  p_document_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT d.is_processed = true
      AND pg_catalog.lower(COALESCE(d.processing_status, '')) IN ('ready', 'processed', 'completed')
      AND (
        d.content_latest_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.case_document_extractions AS extraction
          WHERE extraction.document_id = d.id
            AND extraction.case_id = d.case_id
        )
      )
    FROM public.case_documents AS d
    WHERE d.id = p_document_id
      AND d.case_id = p_case_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_case_document_ready_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_case_document_ready_v1(uuid, uuid)
  TO service_role;

CREATE TABLE public.edge_request_nonces (
  request_id uuid PRIMARY KEY,
  audience text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'worker', 'admin')),
  actor_id text NOT NULL,
  case_id uuid,
  document_id uuid,
  job_id uuid,
  job_locked_at timestamptz,
  signed_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  retain_until timestamptz NOT NULL DEFAULT (pg_catalog.now() + interval '24 hours')
);

CREATE INDEX edge_request_nonces_retain_until_idx
  ON public.edge_request_nonces (retain_until, consumed_at);

ALTER TABLE public.edge_request_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.edge_request_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.edge_request_nonces TO service_role;

CREATE OR REPLACE FUNCTION public.purge_edge_request_nonces_v1(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH expired AS (
    SELECT nonce.request_id
    FROM public.edge_request_nonces AS nonce
    WHERE nonce.retain_until <= pg_catalog.now()
    ORDER BY nonce.retain_until, nonce.consumed_at, nonce.request_id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 10000)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.edge_request_nonces AS nonce
  USING expired
  WHERE nonce.request_id = expired.request_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_edge_request_nonces_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_edge_request_nonces_v1(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.consume_edge_request_v1(
  p_request_id uuid,
  p_audience text,
  p_body_sha256 text,
  p_actor_kind text,
  p_actor_id text,
  p_case_id uuid,
  p_document_id uuid,
  p_job_id uuid,
  p_job_locked_at timestamptz,
  p_signed_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_actor_uuid uuid;
BEGIN
  IF p_signed_at IS NULL
     OR pg_catalog.abs(pg_catalog.date_part('epoch', pg_catalog.now() - p_signed_at)) > 300 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'stale_edge_request';
  END IF;
  IF p_body_sha256 IS NULL OR p_body_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_edge_body_hash';
  END IF;

  IF p_actor_kind = 'admin' THEN
    IF p_audience NOT IN ('backfill_embeddings_v1', 'url_catalogue')
       OR p_case_id IS NOT NULL OR p_document_id IS NOT NULL
       OR p_job_id IS NOT NULL OR p_job_locked_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_admin_edge_scope';
    END IF;
  ELSIF p_actor_kind = 'user' THEN
    IF p_audience NOT IN ('run_case_extract_v4', 'bright-function')
       OR p_case_id IS NULL OR p_job_id IS NOT NULL OR p_job_locked_at IS NOT NULL
       OR p_document_id IS NOT NULL
       OR p_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_user_edge_scope';
    END IF;
    v_actor_uuid := p_actor_id::uuid;
    IF NOT EXISTS (
      SELECT 1
      FROM public.cases AS c
      WHERE c.id = p_case_id
        AND (
          c.user_id = v_actor_uuid
          OR EXISTS (
            SELECT 1
            FROM public.case_collaborators AS cc
            WHERE cc.case_id = c.id
              AND cc.user_id = v_actor_uuid
              AND cc.status = 'active'
              AND cc.can_edit = true
              AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
          )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'edge_case_edit_denied';
    END IF;
  ELSIF p_actor_kind = 'worker' THEN
    IF p_audience NOT IN (
      'evidence_processed_v2',
      'run_case_extract_v4',
      'run_case_decision_v1',
      'run_report_selfserve_v1'
    )
       OR p_case_id IS NULL OR p_job_id IS NULL OR p_job_locked_at IS NULL
       OR p_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_worker_edge_scope';
    END IF;

    -- The lease function is defined later in this migration; dynamic SQL
    -- intentionally defers resolution until this transaction is complete.
    EXECUTE 'SELECT * FROM public.assert_active_worker_lease_v1($1, $2, $3, $4, $5)'
    INTO v_job
    USING
      p_job_id,
      p_case_id,
      p_job_locked_at,
      p_document_id,
      CASE p_audience
        WHEN 'evidence_processed_v2' THEN ARRAY['evidence_document_processing']::text[]
        ELSE ARRAY['post_payment_report_generation']::text[]
      END;

    IF v_job.user_id IS DISTINCT FROM p_actor_id::uuid THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'edge_worker_lease_denied';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_edge_actor';
  END IF;

  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.case_documents AS d
    WHERE d.id = p_document_id AND d.case_id = p_case_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'edge_document_case_mismatch';
  END IF;

  BEGIN
    INSERT INTO public.edge_request_nonces (
      request_id, audience, body_sha256, actor_kind, actor_id,
      case_id, document_id, job_id, job_locked_at, signed_at
    ) VALUES (
      p_request_id, p_audience, p_body_sha256, p_actor_kind, p_actor_id,
      p_case_id, p_document_id, p_job_id, p_job_locked_at, p_signed_at
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'replayed_edge_request';
  END;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_edge_request_v1(
  uuid, text, text, text, text, uuid, uuid, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_edge_request_v1(
  uuid, text, text, text, text, uuid, uuid, uuid, timestamptz, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.worker_lease_interval_v1()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT interval '15 minutes';
$$;

CREATE OR REPLACE FUNCTION public.assert_active_worker_lease_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_document_id uuid,
  p_allowed_job_types text[]
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
BEGIN
  -- This is the sole worker-claim fence. The row lock makes the assertion and
  -- caller mutation one transaction; an expired attempt cannot self-renew.
  SELECT j.*
  INTO v_job
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL
     OR p_case_id IS NULL
     OR p_job_locked_at IS NULL
     OR COALESCE(array_length(p_allowed_job_types, 1), 0) = 0
     OR v_job.status <> 'running'
     OR v_job.locked_at IS DISTINCT FROM p_job_locked_at
     OR v_job.case_id IS DISTINCT FROM p_case_id
     OR v_job.document_id IS DISTINCT FROM p_document_id
     OR v_job.updated_at IS NULL
     OR v_job.updated_at <= pg_catalog.now() - public.worker_lease_interval_v1()
     OR NOT (v_job.job_type = ANY(p_allowed_job_types))
     OR NOT EXISTS (
       SELECT 1
       FROM public.cases AS c
       WHERE c.id = v_job.case_id
         AND c.user_id = v_job.user_id
     )
     OR (
       v_job.job_type = 'evidence_document_processing'
       AND (
         p_document_id IS NULL
         OR v_job.document_id IS DISTINCT FROM p_document_id
         OR NOT EXISTS (
           SELECT 1
           FROM public.case_documents AS d
           WHERE d.id = v_job.document_id
             AND d.case_id = v_job.case_id
         )
       )
     )
     OR (
       v_job.job_type <> 'evidence_document_processing'
       AND p_document_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker_lease_lost';
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.worker_lease_interval_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_lease_interval_v1() TO service_role;
REVOKE ALL ON FUNCTION public.assert_active_worker_lease_v1(
  uuid, uuid, timestamptz, uuid, text[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_active_worker_lease_v1(
  uuid, uuid, timestamptz, uuid, text[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_worker_job_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_document_id uuid
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.assert_active_worker_lease_v1(
    p_job_id,
    p_case_id,
    p_job_locked_at,
    p_document_id,
    ARRAY['post_payment_report_generation', 'evidence_document_processing']::text[]
  );

  UPDATE public.jobs AS j
  SET updated_at = pg_catalog.now()
  WHERE j.id = v_job.id
  RETURNING j.* INTO v_job;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_worker_job_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_document_id uuid,
  p_error text
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_document_ready boolean := false;
BEGIN
  SELECT * INTO v_job
  FROM public.assert_active_worker_lease_v1(
    p_job_id,
    p_case_id,
    p_job_locked_at,
    p_document_id,
    ARRAY['post_payment_report_generation', 'evidence_document_processing']::text[]
  );

  IF v_job.job_type = 'evidence_document_processing' THEN
    PERFORM 1
    FROM public.case_documents AS d
    WHERE d.id = v_job.document_id
      AND d.case_id = v_job.case_id
    FOR UPDATE;
    v_document_ready := public.is_case_document_ready_v1(v_job.case_id, v_job.document_id);
  END IF;

  UPDATE public.jobs AS j
  SET status = CASE
        WHEN v_document_ready THEN 'completed'
        WHEN j.retry_count < 2 THEN 'queued'
        ELSE 'failed'
      END,
      retry_count = CASE WHEN v_document_ready THEN j.retry_count ELSE j.retry_count + 1 END,
      error = CASE
        WHEN v_document_ready THEN NULL
        ELSE pg_catalog.left(COALESCE(p_error, 'Worker recovery deferred'), 2000)
      END,
      locked_at = NULL,
      started_at = CASE WHEN v_document_ready THEN j.started_at ELSE NULL END,
      completed_at = CASE
        WHEN v_document_ready OR j.retry_count >= 2 THEN pg_catalog.now()
        ELSE NULL
      END,
      updated_at = pg_catalog.now()
  WHERE j.id = v_job.id
  RETURNING j.* INTO v_job;

  IF v_job.job_type = 'evidence_document_processing' AND NOT v_document_ready THEN
    UPDATE public.case_documents AS d
    SET processing_status = CASE WHEN v_job.status = 'queued' THEN 'queued' ELSE 'failed' END,
        processing_error = CASE WHEN v_job.status = 'queued' THEN NULL ELSE v_job.error END,
        processed_at = CASE WHEN v_job.status = 'failed' THEN pg_catalog.now() ELSE d.processed_at END,
        updated_at = pg_catalog.now()
    WHERE d.id = v_job.document_id
      AND d.case_id = v_job.case_id
      AND NOT public.is_case_document_ready_v1(v_job.case_id, v_job.document_id);
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_worker_job_v1(uuid, uuid, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_worker_job_v1(uuid, uuid, timestamptz, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.defer_worker_job_v1(uuid, uuid, timestamptz, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_worker_job_v1(uuid, uuid, timestamptz, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_evidence_processing_job_v1(
  p_case_id uuid,
  p_document_id uuid,
  p_owner_id uuid
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_document public.case_documents%ROWTYPE;
  v_document_ready boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.cases AS c
    WHERE c.id = p_case_id
      AND c.user_id = p_owner_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'evidence_job_owner_mismatch';
  END IF;

  SELECT d.*
  INTO v_document
  FROM public.case_documents AS d
  WHERE d.id = p_document_id
    AND d.case_id = p_case_id
  FOR UPDATE;

  IF v_document.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence_document_not_found';
  END IF;

  v_document_ready := public.is_case_document_ready_v1(p_case_id, p_document_id);

  SELECT j.*
  INTO v_job
  FROM public.jobs AS j
  WHERE j.job_type = 'evidence_document_processing'
    AND j.document_id = p_document_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    INSERT INTO public.jobs (
      case_id, user_id, document_id, job_type, idempotency_key, status,
      payload, completed_at
    ) VALUES (
      p_case_id,
      p_owner_id,
      p_document_id,
      'evidence_document_processing',
      'evidence-document:' || p_document_id::text,
      CASE WHEN v_document_ready THEN 'completed' ELSE 'queued' END,
      pg_catalog.jsonb_build_object('document_id', p_document_id),
      CASE WHEN v_document_ready THEN pg_catalog.now() ELSE NULL END
    )
    RETURNING * INTO v_job;
  ELSIF v_job.case_id IS DISTINCT FROM p_case_id
        OR v_job.user_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'evidence_job_binding_mismatch';
  ELSIF v_document_ready AND v_job.status <> 'completed' THEN
    UPDATE public.jobs AS j
    SET status = 'completed', error = NULL, locked_at = NULL,
        completed_at = COALESCE(j.completed_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    WHERE j.id = v_job.id
    RETURNING j.* INTO v_job;
  ELSIF NOT v_document_ready AND v_job.status IN ('failed', 'completed') THEN
    UPDATE public.jobs AS j
    SET status = 'queued', retry_count = 0, error = NULL, locked_at = NULL,
        started_at = NULL, completed_at = NULL, updated_at = pg_catalog.now()
    WHERE j.id = v_job.id
    RETURNING j.* INTO v_job;
  END IF;

  IF NOT v_document_ready AND v_job.status = 'queued' THEN
    UPDATE public.case_documents AS d
    SET processing_status = 'queued', processing_error = NULL,
        processing_request_id = NULL, updated_at = pg_catalog.now()
    WHERE d.id = p_document_id
      AND d.case_id = p_case_id
      AND NOT public.is_case_document_ready_v1(p_case_id, p_document_id);
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_evidence_processing_v1(
  p_case_id uuid,
  p_document_id uuid,
  p_actor_profile_id uuid
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_access record;
BEGIN
  SELECT *
  INTO v_access
  FROM public.case_actor_access_v1(p_case_id, p_actor_profile_id, true);

  IF v_access.access_result <> 'ok' OR v_access.owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'evidence_enqueue_denied';
  END IF;

  RETURN public.ensure_evidence_processing_job_v1(
    p_case_id,
    p_document_id,
    v_access.owner_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_and_enqueue_evidence_v1(
  p_case_id uuid,
  p_evidence_id uuid,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_access record;
  v_evidence public.evidence%ROWTYPE;
  v_document public.case_documents%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_created boolean := false;
  v_segments text[];
  v_document_type text;
BEGIN
  SELECT *
  INTO v_access
  FROM public.case_actor_access_v1(p_case_id, p_actor_profile_id, true);

  IF v_access.access_result <> 'ok' OR v_access.owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'evidence_dispatch_denied';
  END IF;

  SELECT e.*
  INTO v_evidence
  FROM public.evidence AS e
  WHERE e.id = p_evidence_id
    AND e.case_id = p_case_id
  FOR UPDATE;

  IF v_evidence.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence_not_found';
  END IF;

  v_segments := pg_catalog.string_to_array(v_evidence.file_path, '/');
  IF pg_catalog.cardinality(v_segments) <> 3
     OR v_segments[1] <> p_case_id::text
     OR v_segments[2] <> v_evidence.category
     OR v_segments[2] !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$'
     OR v_segments[3] !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$'
     OR v_segments[3] IN ('.', '..')
     OR v_evidence.category !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$'
     OR v_evidence.filename IS NULL
     OR pg_catalog.length(pg_catalog.btrim(v_evidence.filename)) NOT BETWEEN 1 AND 255
     OR v_evidence.file_type NOT IN ('application/pdf', 'image/png', 'image/jpeg')
     OR v_evidence.file_size NOT BETWEEN 1 AND 52428800 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_evidence_storage_binding';
  END IF;

  v_document_type := CASE
    WHEN pg_catalog.lower(v_evidence.category) = 'evidence' THEN NULL
    ELSE pg_catalog.lower(v_evidence.category)
  END;

  INSERT INTO public.case_documents (
    case_id, filename, original_filename, file_size, mime_type, document_type,
    storage_bucket, storage_path, processing_status, is_processed
  ) VALUES (
    p_case_id,
    v_evidence.filename,
    v_evidence.filename,
    v_evidence.file_size,
    v_evidence.file_type,
    v_document_type,
    'evidence',
    v_evidence.file_path,
    'uploaded',
    false
  )
  ON CONFLICT (storage_bucket, storage_path) DO NOTHING
  RETURNING * INTO v_document;

  IF v_document.id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT d.*
    INTO v_document
    FROM public.case_documents AS d
    WHERE d.storage_bucket = 'evidence'
      AND d.storage_path = v_evidence.file_path
    FOR UPDATE;
  END IF;

  IF v_document.id IS NULL
     OR v_document.case_id IS DISTINCT FROM p_case_id
     OR v_document.storage_bucket IS DISTINCT FROM 'evidence'
     OR v_document.storage_path IS DISTINCT FROM v_evidence.file_path THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'evidence_document_binding_mismatch';
  END IF;

  v_job := public.ensure_evidence_processing_job_v1(
    p_case_id,
    v_document.id,
    v_access.owner_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'evidence_id', v_evidence.id,
    'document_id', v_document.id,
    'job_id', v_job.id,
    'job_status', v_job.status,
    'created_document', v_created,
    'queued', v_job.status = 'queued',
    'skipped', v_job.status IN ('running', 'completed')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_evidence_processing_job_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_evidence_processing_job_v1(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_evidence_processing_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_evidence_processing_v1(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.register_and_enqueue_evidence_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_and_enqueue_evidence_v1(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_post_payment_report_generation(
  p_case_id uuid,
  p_user_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_payment_row_id uuid DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case_owner uuid;
  v_job public.jobs%ROWTYPE;
  v_document record;
BEGIN
  SELECT c.user_id
  INTO v_case_owner
  FROM public.cases AS c
  WHERE c.id = p_case_id
  FOR KEY SHARE;

  IF v_case_owner IS NULL OR v_case_owner <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'report_job_case_owner_mismatch';
  END IF;

  INSERT INTO public.case_entitlements (
    case_id, plan, features, purchased_at, source, purchase_ref, updated_at
  ) VALUES (
    p_case_id,
    'self_serve_report',
    pg_catalog.jsonb_build_object('allow_self_serve_report', true),
    pg_catalog.now(),
    'stripe',
    p_idempotency_key,
    pg_catalog.now()
  )
  ON CONFLICT (case_id) DO UPDATE
  SET plan = CASE
        WHEN public.case_entitlements.plan = 'escalation_pack' THEN 'escalation_pack'
        ELSE 'self_serve_report'
      END,
      features = COALESCE(public.case_entitlements.features, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('allow_self_serve_report', true),
      purchased_at = COALESCE(public.case_entitlements.purchased_at, EXCLUDED.purchased_at),
      source = 'stripe',
      purchase_ref = COALESCE(public.case_entitlements.purchase_ref, EXCLUDED.purchase_ref),
      updated_at = pg_catalog.now();

  INSERT INTO public.jobs (
    case_id, user_id, job_type, idempotency_key, status, payload
  ) VALUES (
    p_case_id,
    p_user_id,
    'post_payment_report_generation',
    p_idempotency_key,
    'queued',
    pg_catalog.jsonb_build_object(
      'stripe_checkout_session_id', p_idempotency_key,
      'payment_row_id', p_payment_row_id
    )
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_job;

  IF v_job.id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT j.*
    INTO v_job
    FROM public.jobs AS j
    WHERE j.idempotency_key = p_idempotency_key
      AND j.case_id = p_case_id
      AND j.user_id = p_user_id
      AND j.job_type = 'post_payment_report_generation'
    FOR UPDATE;

    IF v_job.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'report_job_idempotency_collision';
    END IF;
  END IF;

  FOR v_document IN
    SELECT d.id
    FROM public.case_documents AS d
    WHERE d.case_id = p_case_id
      AND NOT public.is_case_document_ready_v1(p_case_id, d.id)
      AND pg_catalog.lower(COALESCE(d.processing_status, '')) <> 'failed'
    ORDER BY d.upload_date, d.id
    FOR UPDATE
  LOOP
    PERFORM public.ensure_evidence_processing_job_v1(
      p_case_id,
      v_document.id,
      p_user_id
    );
  END LOOP;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_evidence_processing_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_document_id uuid,
  p_request_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_active_worker_lease_v1(
    p_job_id, p_case_id, p_job_locked_at, p_document_id,
    ARRAY['evidence_document_processing']::text[]
  );

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'evidence_request_id_required';
  END IF;

  UPDATE public.case_documents AS d
  SET processing_status = 'parsing', processing_error = NULL,
      processing_request_id = p_request_id, updated_at = pg_catalog.now()
  WHERE d.id = p_document_id
    AND d.case_id = p_case_id
    AND NOT public.is_case_document_ready_v1(p_case_id, p_document_id);

  IF NOT FOUND AND NOT public.is_case_document_ready_v1(p_case_id, p_document_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence_document_not_found';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_evidence_processing_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_document_id uuid,
  p_request_id uuid,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_active_worker_lease_v1(
    p_job_id, p_case_id, p_job_locked_at, p_document_id,
    ARRAY['evidence_document_processing']::text[]
  );

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'evidence_request_id_required';
  END IF;

  UPDATE public.case_documents AS d
  SET processing_status = 'failed', processing_error = pg_catalog.left(p_error, 2000),
      is_processed = false, processing_request_id = NULL,
      processed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  WHERE d.id = p_document_id
    AND d.case_id = p_case_id
    AND d.processing_request_id = p_request_id
    AND NOT public.is_case_document_ready_v1(p_case_id, p_document_id);

  IF NOT FOUND AND NOT public.is_case_document_ready_v1(p_case_id, p_document_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'evidence_attempt_superseded';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_evidence_processing_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_document_id uuid,
  p_request_id uuid,
  p_existing_content_id uuid,
  p_content jsonb,
  p_verification jsonb,
  p_chunks jsonb,
  p_summary_extraction jsonb,
  p_transactions_extraction jsonb,
  p_document_patch jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_content_id uuid;
  v_document public.case_documents%ROWTYPE;
BEGIN
  PERFORM public.assert_active_worker_lease_v1(
    p_job_id, p_case_id, p_job_locked_at, p_document_id,
    ARRAY['evidence_document_processing']::text[]
  );

  SELECT d.*
  INTO v_document
  FROM public.case_documents AS d
  WHERE d.id = p_document_id
    AND d.case_id = p_case_id
  FOR UPDATE;

  IF v_document.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence_document_not_found';
  END IF;
  IF public.is_case_document_ready_v1(p_case_id, p_document_id) THEN
    RETURN v_document.content_latest_id;
  END IF;
  IF p_request_id IS NULL OR v_document.processing_request_id IS DISTINCT FROM p_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'evidence_attempt_superseded';
  END IF;

  IF p_existing_content_id IS NOT NULL THEN
    SELECT c.id INTO v_content_id
    FROM public.case_documents_content AS c
    WHERE c.id = p_existing_content_id AND c.document_id = p_document_id;
    IF v_content_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'evidence_content_not_found';
    END IF;
  ELSE
    INSERT INTO public.case_documents_content (
      document_id, model, prompt_version, pipeline_version, text_content,
      content_json, language, page_count, parse_status, parse_errors, content_sha256
    ) VALUES (
      p_document_id,
      p_content->>'model',
      p_content->>'prompt_version',
      p_content->>'pipeline_version',
      p_content->>'text_content',
      p_content->'content_json',
      p_content->>'language',
      NULLIF(p_content->>'page_count', '')::integer,
      COALESCE(p_content->>'parse_status', 'success'),
      p_content->'parse_errors',
      p_content->>'content_sha256'
    )
    ON CONFLICT (document_id, model, prompt_version, pipeline_version)
    DO UPDATE SET
      text_content = EXCLUDED.text_content,
      content_json = EXCLUDED.content_json,
      language = EXCLUDED.language,
      page_count = EXCLUDED.page_count,
      parse_status = EXCLUDED.parse_status,
      parse_errors = EXCLUDED.parse_errors,
      content_sha256 = EXCLUDED.content_sha256,
      parsed_at = pg_catalog.now()
    RETURNING id INTO v_content_id;
  END IF;

  INSERT INTO public.case_document_verifications (
    document_id, content_id, declared_document_type, predicted_document_type,
    confidence, decision, reason, evidence_spans, model, prompt_version
  ) VALUES (
    p_document_id,
    v_content_id,
    p_verification->>'declared_document_type',
    p_verification->>'predicted_document_type',
    NULLIF(p_verification->>'confidence', '')::numeric,
    p_verification->>'decision',
    p_verification->>'reason',
    p_verification->'evidence_spans',
    p_verification->>'model',
    p_verification->>'prompt_version'
  )
  ON CONFLICT (document_id, content_id, model, prompt_version)
  DO UPDATE SET
    declared_document_type = EXCLUDED.declared_document_type,
    predicted_document_type = EXCLUDED.predicted_document_type,
    confidence = EXCLUDED.confidence,
    decision = EXCLUDED.decision,
    reason = EXCLUDED.reason,
    evidence_spans = EXCLUDED.evidence_spans,
    verified_at = pg_catalog.now();

  DELETE FROM public.case_document_chunks AS c WHERE c.content_id = v_content_id;
  INSERT INTO public.case_document_chunks (
    content_id, chunk_index, chunk_text, page_start, page_end,
    char_start, char_end, section_title, chunk_type, metadata
  )
  SELECT
    v_content_id,
    (item->>'chunk_index')::integer,
    item->>'chunk_text',
    NULLIF(item->>'page_start', '')::integer,
    NULLIF(item->>'page_end', '')::integer,
    NULLIF(item->>'char_start', '')::integer,
    NULLIF(item->>'char_end', '')::integer,
    item->>'section_title',
    item->>'chunk_type',
    item->'metadata'
  FROM pg_catalog.jsonb_array_elements(COALESCE(p_chunks, '[]'::jsonb)) AS item;

  INSERT INTO public.case_document_extractions (
    case_id, document_id, content_id, extraction_type, schema_version,
    extracted_json, extracted_text, confidence, citations, model, prompt_version
  ) VALUES (
    p_case_id,
    p_document_id,
    v_content_id,
    p_summary_extraction->>'extraction_type',
    p_summary_extraction->>'schema_version',
    p_summary_extraction->'extracted_json',
    p_summary_extraction->>'extracted_text',
    NULLIF(p_summary_extraction->>'confidence', '')::numeric,
    p_summary_extraction->'citations',
    p_summary_extraction->>'model',
    p_summary_extraction->>'prompt_version'
  )
  ON CONFLICT (document_id, extraction_type, schema_version)
  DO UPDATE SET
    case_id = EXCLUDED.case_id,
    content_id = EXCLUDED.content_id,
    extracted_json = EXCLUDED.extracted_json,
    extracted_text = EXCLUDED.extracted_text,
    confidence = EXCLUDED.confidence,
    citations = EXCLUDED.citations,
    model = EXCLUDED.model,
    prompt_version = EXCLUDED.prompt_version,
    created_at = pg_catalog.now();

  IF p_transactions_extraction IS NOT NULL THEN
    INSERT INTO public.case_document_extractions (
      case_id, document_id, content_id, extraction_type, schema_version,
      extracted_json, extracted_text, confidence, citations, model, prompt_version
    ) VALUES (
      p_case_id,
      p_document_id,
      v_content_id,
      p_transactions_extraction->>'extraction_type',
      p_transactions_extraction->>'schema_version',
      p_transactions_extraction->'extracted_json',
      p_transactions_extraction->>'extracted_text',
      NULLIF(p_transactions_extraction->>'confidence', '')::numeric,
      p_transactions_extraction->'citations',
      p_transactions_extraction->>'model',
      p_transactions_extraction->>'prompt_version'
    )
    ON CONFLICT (document_id, extraction_type, schema_version)
    DO UPDATE SET
      case_id = EXCLUDED.case_id,
      content_id = EXCLUDED.content_id,
      extracted_json = EXCLUDED.extracted_json,
      extracted_text = EXCLUDED.extracted_text,
      confidence = EXCLUDED.confidence,
      citations = EXCLUDED.citations,
      model = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version,
      created_at = pg_catalog.now();
  END IF;

  UPDATE public.case_documents AS d
  SET content_latest_id = v_content_id,
      processing_status = 'ready',
      processing_error = NULL,
      is_processed = true,
      verified_document_type = p_document_patch->>'verified_document_type',
      verification_status = p_document_patch->>'verification_status',
      verification_confidence = NULLIF(p_document_patch->>'verification_confidence', '')::numeric,
      processing_request_id = NULL,
      processed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE d.id = p_document_id
    AND d.case_id = p_case_id
    AND d.processing_request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'evidence_attempt_superseded';
  END IF;
  RETURN v_content_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_extract_run_v1(
  p_actor_kind text,
  p_actor_id uuid,
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_extract jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.case_extract_runs%ROWTYPE;
  v_validation_id uuid;
  v_validation_error text;
BEGIN
  IF p_actor_kind = 'worker' THEN
    PERFORM public.assert_active_worker_lease_v1(
      p_job_id, p_case_id, p_job_locked_at, NULL,
      ARRAY['post_payment_report_generation']::text[]
    );
  ELSIF p_actor_kind = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cases AS c
      WHERE c.id = p_case_id
        AND (
          c.user_id = p_actor_id
          OR EXISTS (
            SELECT 1 FROM public.case_collaborators AS cc
            WHERE cc.case_id = c.id AND cc.user_id = p_actor_id
              AND cc.status = 'active' AND cc.can_edit = true
              AND (cc.expires_at IS NULL OR cc.expires_at > pg_catalog.now())
          )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'extract_commit_denied';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'extract_actor_denied';
  END IF;

  INSERT INTO public.case_extract_runs (
    case_id, extract_json, missing_fields, model_name, prompt_version, intake_id,
    skip_validation, allow_partial_evidence, total_document_count,
    evidence_document_count, ready_document_count, queued_document_count,
    processing_document_count, uploaded_document_count, failed_document_count,
    not_ready_document_count, document_snapshot_at, evidence_snapshot
  ) VALUES (
    p_case_id,
    p_extract->'extract_json',
    p_extract->'missing_fields',
    p_extract->>'model_name',
    p_extract->>'prompt_version',
    NULLIF(p_extract->>'intake_id', '')::uuid,
    COALESCE((p_extract->>'skip_validation')::boolean, false),
    COALESCE((p_extract->>'allow_partial_evidence')::boolean, false),
    NULLIF(p_extract->>'total_document_count', '')::integer,
    NULLIF(p_extract->>'evidence_document_count', '')::integer,
    NULLIF(p_extract->>'ready_document_count', '')::integer,
    NULLIF(p_extract->>'queued_document_count', '')::integer,
    NULLIF(p_extract->>'processing_document_count', '')::integer,
    NULLIF(p_extract->>'uploaded_document_count', '')::integer,
    NULLIF(p_extract->>'failed_document_count', '')::integer,
    NULLIF(p_extract->>'not_ready_document_count', '')::integer,
    NULLIF(p_extract->>'document_snapshot_at', '')::timestamptz,
    p_extract->'evidence_snapshot'
  )
  RETURNING * INTO v_run;

  IF v_run.skip_validation IS NOT TRUE THEN
    BEGIN
      v_validation_id := public.run_validation_v1(v_run.id);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_validation_error = MESSAGE_TEXT;
    END;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'extract_run', pg_catalog.to_jsonb(v_run),
    'extract_run_id', v_run.id,
    'validation_run_id', v_validation_id,
    'validation_error', v_validation_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_decision_run_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_extract_run_id uuid,
  p_decision_json jsonb,
  p_eligibility_status text,
  p_strength_score_value integer,
  p_model_name text,
  p_prompt_version text
)
RETURNS public.case_decision_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.case_decision_runs%ROWTYPE;
BEGIN
  PERFORM public.assert_active_worker_lease_v1(
    p_job_id, p_case_id, p_job_locked_at, NULL,
    ARRAY['post_payment_report_generation']::text[]
  );

  SELECT d.* INTO v_run
  FROM public.case_decision_runs AS d
  WHERE d.case_id = p_case_id AND d.extract_run_id = p_extract_run_id
  ORDER BY d.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    INSERT INTO public.case_decision_runs (
      case_id, extract_run_id, decision_json, eligibility_status,
      strength_score_value, model_name, prompt_version
    ) VALUES (
      p_case_id, p_extract_run_id, p_decision_json, p_eligibility_status,
      p_strength_score_value, p_model_name, p_prompt_version
    )
    RETURNING * INTO v_run;
  END IF;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_report_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_report_json jsonb
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report public.reports%ROWTYPE;
  v_owner_id uuid;
BEGIN
  PERFORM public.assert_active_worker_lease_v1(
    p_job_id, p_case_id, p_job_locked_at, NULL,
    ARRAY['post_payment_report_generation']::text[]
  );

  SELECT c.user_id INTO v_owner_id FROM public.cases AS c WHERE c.id = p_case_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'report_case_not_found';
  END IF;

  SELECT r.* INTO v_report
  FROM public.reports AS r
  WHERE r.case_id = p_case_id AND r.report_json IS NOT NULL
  ORDER BY r.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_report.id IS NULL THEN
    INSERT INTO public.reports (user_id, case_id, status, report_json)
    VALUES (v_owner_id, p_case_id, 'COMPLETED', p_report_json)
    RETURNING * INTO v_report;
  END IF;

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_evidence_processing_jobs_v1(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
  v_candidate record;
  v_job public.jobs%ROWTYPE;
BEGIN
  FOR v_candidate IN
    SELECT d.id AS document_id, d.case_id, c.user_id
    FROM public.case_documents AS d
    JOIN public.cases AS c ON c.id = d.case_id
    WHERE pg_catalog.lower(COALESCE(d.processing_status, '')) = 'queued'
      AND d.is_processed = false
    ORDER BY d.upload_date ASC
    FOR UPDATE OF d SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  LOOP
    v_job := public.ensure_evidence_processing_job_v1(
      v_candidate.case_id,
      v_candidate.document_id,
      v_candidate.user_id
    );
    IF v_job.status IN ('queued', 'running') THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_worker_job_v1(
  p_job_id uuid,
  p_case_id uuid,
  p_job_locked_at timestamptz,
  p_document_id uuid,
  p_outcome text,
  p_error text DEFAULT NULL,
  p_retryable boolean DEFAULT false,
  p_payload_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs;
  v_next_status text;
  v_document_ready boolean := false;
BEGIN
  SELECT * INTO v_job
  FROM public.assert_active_worker_lease_v1(
    p_job_id, p_case_id, p_job_locked_at, p_document_id,
    ARRAY['post_payment_report_generation', 'evidence_document_processing']::text[]
  );

  IF v_job.job_type = 'evidence_document_processing' THEN
    PERFORM 1
    FROM public.case_documents AS d
    WHERE d.id = v_job.document_id
      AND d.case_id = v_job.case_id
    FOR UPDATE;
    v_document_ready := public.is_case_document_ready_v1(v_job.case_id, v_job.document_id);
  END IF;

  IF v_document_ready THEN
    UPDATE public.jobs AS j
    SET status = 'completed', completed_at = COALESCE(j.completed_at, pg_catalog.now()),
        updated_at = pg_catalog.now(), error = NULL, locked_at = NULL,
        payload = COALESCE(j.payload, '{}'::jsonb) || COALESCE(p_payload_patch, '{}'::jsonb)
    WHERE j.id = p_job_id
    RETURNING j.* INTO v_job;
    RETURN v_job;
  END IF;

  IF p_outcome = 'completed' THEN
    IF v_job.job_type = 'evidence_document_processing' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'evidence_job_not_ready';
    END IF;

    UPDATE public.jobs AS j
    SET status = 'completed', completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now(), error = NULL, locked_at = NULL,
        payload = COALESCE(j.payload, '{}'::jsonb) || COALESCE(p_payload_patch, '{}'::jsonb)
    WHERE j.id = p_job_id
    RETURNING j.* INTO v_job;
    RETURN v_job;
  END IF;

  IF p_outcome <> 'failed' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_worker_job_outcome';
  END IF;

  v_next_status := CASE
    WHEN p_retryable AND v_job.retry_count < 2 THEN 'queued'
    ELSE 'failed'
  END;

  UPDATE public.jobs AS j
  SET status = v_next_status,
      retry_count = j.retry_count + 1,
      error = pg_catalog.left(COALESCE(p_error, 'Worker job failed'), 2000),
      locked_at = NULL,
      started_at = CASE WHEN v_next_status = 'queued' THEN NULL ELSE j.started_at END,
      completed_at = CASE WHEN v_next_status = 'failed' THEN pg_catalog.now() ELSE NULL END,
      updated_at = pg_catalog.now(),
      payload = COALESCE(j.payload, '{}'::jsonb) || COALESCE(p_payload_patch, '{}'::jsonb)
  WHERE j.id = p_job_id
  RETURNING j.* INTO v_job;

  IF v_job.job_type = 'evidence_document_processing' THEN
    UPDATE public.case_documents AS d
    SET processing_status = CASE WHEN v_next_status = 'queued' THEN 'queued' ELSE 'failed' END,
        processing_error = CASE
          WHEN v_next_status = 'queued' THEN NULL
          ELSE pg_catalog.left(COALESCE(p_error, 'Worker job failed'), 2000)
        END,
        processing_request_id = NULL,
        is_processed = false,
        processed_at = CASE WHEN v_next_status = 'failed' THEN pg_catalog.now() ELSE d.processed_at END,
        updated_at = pg_catalog.now()
    WHERE d.id = v_job.document_id
      AND d.case_id = v_job.case_id
      AND NOT public.is_case_document_ready_v1(v_job.case_id, v_job.document_id);
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  PERFORM public.reconcile_evidence_processing_jobs_v1(100);

  WITH recovered AS (
    UPDATE public.jobs AS stale
    SET status = CASE
          WHEN stale.job_type = 'evidence_document_processing'
               AND public.is_case_document_ready_v1(stale.case_id, stale.document_id) THEN 'completed'
          WHEN stale.retry_count < 2 THEN 'queued'
          ELSE 'failed'
        END,
        retry_count = CASE
          WHEN stale.job_type = 'evidence_document_processing'
               AND public.is_case_document_ready_v1(stale.case_id, stale.document_id) THEN stale.retry_count
          ELSE stale.retry_count + 1
        END,
        error = CASE
          WHEN stale.job_type = 'evidence_document_processing'
               AND public.is_case_document_ready_v1(stale.case_id, stale.document_id) THEN NULL
          ELSE 'Recovered abandoned worker lease'
        END,
        locked_at = NULL,
        started_at = CASE WHEN stale.retry_count < 2 THEN NULL ELSE stale.started_at END,
        completed_at = CASE
          WHEN stale.job_type = 'evidence_document_processing'
               AND public.is_case_document_ready_v1(stale.case_id, stale.document_id)
            THEN COALESCE(stale.completed_at, pg_catalog.now())
          WHEN stale.retry_count >= 2 THEN pg_catalog.now()
          ELSE NULL
        END,
        updated_at = pg_catalog.now()
    WHERE stale.status = 'running'
      AND (
        stale.updated_at IS NULL
        OR stale.updated_at <= pg_catalog.now() - public.worker_lease_interval_v1()
      )
    RETURNING stale.case_id, stale.document_id, stale.job_type, stale.status
  )
  UPDATE public.case_documents AS d
  SET processing_status = CASE WHEN r.status = 'queued' THEN 'queued' ELSE 'failed' END,
      processing_error = CASE WHEN r.status = 'queued' THEN NULL ELSE 'Recovered abandoned worker lease' END,
      processing_request_id = NULL,
      is_processed = false,
      processed_at = CASE WHEN r.status = 'failed' THEN pg_catalog.now() ELSE d.processed_at END,
      updated_at = pg_catalog.now()
  FROM recovered AS r
  WHERE r.job_type = 'evidence_document_processing'
    AND r.status IN ('queued', 'failed')
    AND d.id = r.document_id
    AND d.case_id = r.case_id
    AND NOT public.is_case_document_ready_v1(r.case_id, r.document_id);

  SELECT j.* INTO v_job
  FROM public.jobs AS j
  WHERE j.status = 'queued'
    AND j.job_type IN ('post_payment_report_generation', 'evidence_document_processing')
    AND (
      j.job_type = 'evidence_document_processing'
      OR NOT EXISTS (
        SELECT 1
        FROM public.case_documents AS pending_document
        WHERE pending_document.case_id = j.case_id
          AND pg_catalog.lower(COALESCE(pending_document.processing_status, '')) <> 'failed'
          AND NOT public.is_case_document_ready_v1(j.case_id, pending_document.id)
      )
    )
  ORDER BY j.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.jobs AS j
  SET status = 'running', started_at = pg_catalog.now(), locked_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE j.id = v_job.id
  RETURNING j.* INTO v_job;

  RETURN v_job;
END;
$$;

DO $$
DECLARE
  v_signature regprocedure;
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'begin_evidence_processing_v1',
        'fail_evidence_processing_v1',
        'commit_evidence_processing_v1',
        'commit_extract_run_v1',
        'commit_decision_run_v1',
        'commit_report_v1',
        'reconcile_evidence_processing_jobs_v1',
        'settle_worker_job_v1',
        'claim_next_job'
      )
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$$;

COMMIT;
