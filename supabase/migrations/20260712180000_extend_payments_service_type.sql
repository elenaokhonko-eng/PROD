-- Slice 8: extend payments.service_type to accept Tier 2 pack and consult products.
-- The existing 'standard' value remains for the self-serve report product.
ALTER TABLE public.payments
DROP CONSTRAINT IF EXISTS payments_service_type_check;

ALTER TABLE public.payments
ADD CONSTRAINT payments_service_type_check
CHECK (service_type IN ('standard', 'nominee', 'fidrec_tier2_pack', 'human_consult_30m'));
