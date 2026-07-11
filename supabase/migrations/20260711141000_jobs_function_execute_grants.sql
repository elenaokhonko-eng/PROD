-- Tighten Slice 6 job helper EXECUTE grants.
-- Default Supabase role grants can leave anon/authenticated able to EXECUTE
-- even after REVOKE FROM PUBLIC. Worker helpers must be service_role-only.

REVOKE ALL ON FUNCTION public.claim_next_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_job() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_job() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_post_payment_report_generation(uuid, uuid, text, uuid) TO service_role;
