DROP INDEX public.payments_stripe_payment_intent_unique_idx;

INSERT INTO public.payments (
  id, user_id, case_id, amount, currency, service_type,
  payment_status, stripe_payment_intent_id
)
VALUES
  (
    '91000000-0000-4000-8000-000000000061',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    18, 'SGD', 'standard', 'failed', 'pi_legacy_conflict'
  ),
  (
    '91000000-0000-4000-8000-000000000062',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    18, 'SGD', 'standard', 'failed', 'pi_legacy_conflict'
  );
