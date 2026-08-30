INSERT INTO public.case_purchases (
  id, case_id, user_id, purchased_by_profile_id, product_code,
  payment_provider, amount, currency, payment_status, metadata
)
VALUES (
  '92000000-0000-4000-8000-000000000071',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'self_serve_report', 'stripe', 18, 'SGD', 'pending', '{}'::jsonb
);
