DROP INDEX public.case_purchases_provider_payment_intent_unique_idx;

INSERT INTO public.case_purchases (
  id, case_id, user_id, product_code, payment_provider,
  provider_payment_intent_id, amount, currency, payment_status
)
VALUES
  (
    '92000000-0000-4000-8000-000000000021',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'self_serve_report', 'stripe', 'pi_conflict', 18, 'SGD', 'cancelled'
  ),
  (
    '92000000-0000-4000-8000-000000000022',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'escalation_pack', 'stripe', 'pi_conflict', 188, 'SGD', 'cancelled'
  );
