DROP INDEX public.case_purchases_one_pending_checkout_idx;
DROP INDEX public.case_purchases_one_active_product_idx;

INSERT INTO public.payments (id, user_id, case_id, amount, currency, service_type, payment_status)
VALUES
  ('91000000-0000-4000-8000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 18, 'SGD', 'standard', 'pending'),
  ('91000000-0000-4000-8000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 18, 'SGD', 'standard', 'pending');

INSERT INTO public.case_purchases (
  id, case_id, user_id, purchased_by_profile_id, product_code,
  payment_provider, amount, currency, payment_status, metadata
)
VALUES
  (
    '92000000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'self_serve_report', 'stripe', 18, 'SGD', 'pending',
    jsonb_build_object('legacy_payment_id', '91000000-0000-4000-8000-000000000001')
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'self_serve_report', 'stripe', 18, 'SGD', 'pending',
    jsonb_build_object('legacy_payment_id', '91000000-0000-4000-8000-000000000002')
  );
