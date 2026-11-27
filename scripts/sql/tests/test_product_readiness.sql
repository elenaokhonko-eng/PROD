/**
 * Stage 2 buying rules (migrations 20261120120000, 20261128120000; docs/release/stage2-plan.md §3a). Synthetic rows only. Rolls back.
 *
 *   psql "$LOCAL_OR_STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/sql/tests/test_product_readiness.sql
 *
 * Covers every readiness reason the database decides, independent products (the FIDReC pack first leaves the bank
 * pack for sale, and grants nothing else), checkout refusing with the reason, and commit_bank_pack_v1's fences.
 * product_not_available for a switched-off product is decided in the app (BANK_PACK_ENABLED, PAID_STAGES_ENABLED).
 */

BEGIN;

INSERT INTO public.profiles (id, email) VALUES ('00000000-0000-4000-8000-00000000a001', 'synthetic@example.test');
INSERT INTO public.cases (id, user_id, claim_type, primary_narrative) VALUES
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000a001', 'phishing_scam', NULL),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000a001', 'phishing_scam',
   'A synthetic story about a fake parcel delivery message.');

CREATE FUNCTION pg_temp.check_readiness(p_case uuid, p_product text, p_expected jsonb, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_got jsonb := public.get_case_product_readiness_v1(p_case, p_product);
BEGIN
  IF v_got <> p_expected THEN
    RAISE EXCEPTION '%: expected %, got %', p_label, p_expected, v_got;
  END IF;
END;
$$;

DO $$
DECLARE
  c_empty constant uuid := '00000000-0000-4000-8000-00000000c001';
  c_case constant uuid := '00000000-0000-4000-8000-00000000c002';
BEGIN
  PERFORM pg_temp.check_readiness(c_empty, 'self_serve_report', '{"ready": false, "reason": "story_missing"}', 'no story');
  PERFORM pg_temp.check_readiness(c_case, 'self_serve_report', '{"ready": true, "reason": null}', 'bank pack needs only a story');
  PERFORM pg_temp.check_readiness(c_case, 'human_consult_30m', '{"ready": false, "reason": "product_not_available"}', 'unknown product');
  PERFORM pg_temp.check_readiness(c_case, 'fidrec_tier2_pack', '{"ready": true, "reason": null}', 'sold upfront, no question first');
  PERFORM pg_temp.check_readiness(c_empty, 'fidrec_tier2_pack', '{"ready": false, "reason": "story_missing"}', 'FIDReC with no story');

  -- Checkout refuses with the readiness reason.
  BEGIN
    PERFORM public.reserve_checkout_purchase_v1(c_empty, 'self_serve_report', '00000000-0000-4000-8000-00000000a001');
    RAISE EXCEPTION 'checkout without a story was not refused';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'reserve_checkout_purchase_v1: not ready: story_missing' THEN RAISE; END IF;
  END;

  -- The FIDReC pack bought first grants only itself; the bank pack stays for sale.
  PERFORM public.grant_fidrec_pack_capability_v1(c_case, 'cs_test_synthetic_fidrec');
  PERFORM pg_temp.check_readiness(c_case, 'fidrec_tier2_pack', '{"ready": false, "reason": "already_purchased"}', 'FIDReC bought');
  PERFORM pg_temp.check_readiness(c_case, 'self_serve_report', '{"ready": true, "reason": null}', 'bank pack after FIDReC');
  IF (public.get_effective_entitlement(c_case) -> 'features' ->> 'allow_self_serve_report')::boolean THEN
    RAISE EXCEPTION 'the FIDReC pack granted the bank pack';
  END IF;

  -- No snapshot yet, and the bank pack is not bought: commit refuses.
  BEGIN
    PERFORM public.commit_bank_pack_v1(c_case, gen_random_uuid(), '{"title": "synthetic"}');
    RAISE EXCEPTION 'commit without the bank pack was not refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM public.grant_self_serve_report_capability_v1(c_case, 'cs_test_synthetic_bank');
  PERFORM pg_temp.check_readiness(c_case, 'self_serve_report', '{"ready": false, "reason": "already_purchased"}', 'bank pack bought');
  IF (SELECT plan FROM public.case_entitlements WHERE case_id = c_case) <> 'escalation_pack' THEN
    RAISE EXCEPTION 'the bank grant replaced the FIDReC plan';
  END IF;
END;
$$;

-- commit_bank_pack_v1: only the latest bank snapshot, and once per case.
INSERT INTO public.case_fact_snapshots (id, case_id, stage, facts, hash) VALUES
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000c002', 'bank', '{}', 'synthetic-1');
INSERT INTO public.case_fact_snapshots (id, case_id, stage, facts, hash, created_at) VALUES
  ('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000c002', 'bank', '{}', 'synthetic-2', now() + interval '1 second');

DO $$
DECLARE
  c_case constant uuid := '00000000-0000-4000-8000-00000000c002';
  v_first public.reports;
  v_second public.reports;
BEGIN
  BEGIN
    PERFORM public.commit_bank_pack_v1(c_case, '00000000-0000-4000-8000-00000000f001', '{"title": "synthetic"}');
    RAISE EXCEPTION 'an older snapshot was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_pack_snapshot_not_current' THEN RAISE; END IF;
  END;

  v_first := public.commit_bank_pack_v1(c_case, '00000000-0000-4000-8000-00000000f002', '{"title": "synthetic"}');
  v_second := public.commit_bank_pack_v1(c_case, '00000000-0000-4000-8000-00000000f002', '{"title": "again"}');
  IF v_first.id <> v_second.id OR v_first.report_type <> 'bank_pack_v1' OR v_first.status <> 'COMPLETED'
     OR v_first.fact_snapshot_id <> '00000000-0000-4000-8000-00000000f002' THEN
    RAISE EXCEPTION 'bank pack commit is not once-only with its snapshot';
  END IF;
END;
$$;

SELECT 'product readiness: all checks passed' AS result;

ROLLBACK;
