-- CR-2, amended by Elena on 27 Nov 2026: the FIDReC pack is sold upfront. Buying it needs only what the bank pack needs
-- (a story, or a case opened for the pack) and that the case does not already have it. The route answer no longer
-- gates the sale; whether the pack can be generated is checked after payment (rules/fidrec.ts fidrecPackCheck).
-- Forward only. To undo, re-run the get_case_product_readiness_v1 definition in 20261127120000_pack_first_cases.sql.

CREATE OR REPLACE FUNCTION public.get_case_product_readiness_v1(
  p_case_id uuid,
  p_checkout_product_key text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_story boolean;
  v_entitlement public.case_entitlements;
BEGIN
  IF p_checkout_product_key NOT IN ('self_serve_report', 'fidrec_tier2_pack') THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'product_not_available');
  END IF;

  SELECT COALESCE(pg_catalog.btrim(c.primary_narrative), '') <> ''
      OR EXISTS (SELECT 1 FROM public.case_story_revisions AS r WHERE r.case_id = c.id)
      OR c.pack_first_at IS NOT NULL
  INTO v_has_story
  FROM public.cases AS c
  WHERE c.id = p_case_id;

  IF NOT COALESCE(v_has_story, false) THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'story_missing');
  END IF;

  SELECT * INTO v_entitlement FROM public.case_entitlements AS ce WHERE ce.case_id = p_case_id;

  IF p_checkout_product_key = 'self_serve_report' THEN
    IF COALESCE(v_entitlement.plan = 'self_serve_report', false)
      OR COALESCE(v_entitlement.features @> '{"allow_self_serve_report": true}'::jsonb, false) THEN
      RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'already_purchased');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ready', true, 'reason', null);
  END IF;

  IF COALESCE(v_entitlement.plan = 'escalation_pack', false)
    OR COALESCE(v_entitlement.features @> '{"allow_escalation_pack": true}'::jsonb, false) THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'reason', 'already_purchased');
  END IF;

  -- Sold upfront: the timeline is checked after payment, never here.
  RETURN pg_catalog.jsonb_build_object('ready', true, 'reason', null);
END;
$$;

REVOKE ALL ON FUNCTION public.get_case_product_readiness_v1(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_case_product_readiness_v1(uuid, text) TO service_role;
