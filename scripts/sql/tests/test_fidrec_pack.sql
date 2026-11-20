/**
 * The FIDReC pack's storage (migration 20261121120000). Synthetic rows only. Rolls back.
 *
 *   psql "$LOCAL_OR_STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/sql/tests/test_fidrec_pack.sql
 *
 * commit_fidrec_pack_v1 needs the FIDReC pack (not the bank pack), the case's latest fidrec snapshot, and stores one
 * pack per case; run_fidrec_pack_v1 is accepted as a user audience.
 */

BEGIN;

INSERT INTO public.profiles (id, email) VALUES ('00000000-0000-4000-8000-00000000a002', 'synthetic-fidrec@example.test');
INSERT INTO public.cases (id, user_id, claim_type, primary_narrative) VALUES
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000a002', 'phishing_scam', 'A synthetic story.');
INSERT INTO public.case_fact_snapshots (id, case_id, stage, facts, hash) VALUES
  ('00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000c003', 'bank', '{}', 'synthetic-bank'),
  ('00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000c003', 'fidrec', '{}', 'synthetic-fidrec');

DO $$
DECLARE
  c_case constant uuid := '00000000-0000-4000-8000-00000000c003';
  v_first public.reports;
  v_second public.reports;
BEGIN
  -- The bank pack alone doesn't allow it.
  PERFORM public.grant_self_serve_report_capability_v1(c_case, 'cs_test_synthetic_bank');
  BEGIN
    PERFORM public.commit_fidrec_pack_v1(c_case, '00000000-0000-4000-8000-00000000f004', '{"title": "synthetic"}');
    RAISE EXCEPTION 'commit without the FIDReC pack was not refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM public.grant_fidrec_pack_capability_v1(c_case, 'cs_test_synthetic_fidrec');

  -- A bank snapshot is not a FIDReC snapshot.
  BEGIN
    PERFORM public.commit_fidrec_pack_v1(c_case, '00000000-0000-4000-8000-00000000f003', '{"title": "synthetic"}');
    RAISE EXCEPTION 'a bank snapshot was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'fidrec_pack_snapshot_not_current' THEN RAISE; END IF;
  END;

  v_first := public.commit_fidrec_pack_v1(c_case, '00000000-0000-4000-8000-00000000f004', '{"title": "synthetic"}');
  v_second := public.commit_fidrec_pack_v1(c_case, '00000000-0000-4000-8000-00000000f004', '{"title": "again"}');
  IF v_first.id <> v_second.id OR v_first.report_type <> 'fidrec_pack_v1' OR v_first.status <> 'COMPLETED'
     OR v_first.fact_snapshot_id <> '00000000-0000-4000-8000-00000000f004' THEN
    RAISE EXCEPTION 'FIDReC pack commit is not once-only with its snapshot';
  END IF;

  -- The bank pack is stored separately: its own commit still works on the same case.
  IF (public.commit_bank_pack_v1(c_case, '00000000-0000-4000-8000-00000000f003', '{"title": "bank"}')).report_type <> 'bank_pack_v1' THEN
    RAISE EXCEPTION 'the bank pack was not stored separately';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE proname = 'consume_edge_request_v1' AND pg_catalog.pg_get_functiondef(oid) LIKE '%''run_fidrec_pack_v1''%'
  ) THEN
    RAISE EXCEPTION 'run_fidrec_pack_v1 is not an accepted user audience';
  END IF;
END;
$$;

SELECT 'fidrec pack storage: all checks passed' AS result;

ROLLBACK;
