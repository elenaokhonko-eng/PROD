DROP INDEX public.case_purchases_fulfilment_event_uidx;

INSERT INTO public.case_purchases (
  id, case_id, user_id, product_code, payment_provider,
  fulfilment_provider_event_id, amount, currency, payment_status
)
VALUES
  (
    '92000000-0000-4000-8000-000000000041',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'self_serve_report', 'stripe', 'evt_conflict', 18, 'SGD', 'cancelled'
  ),
  (
    '92000000-0000-4000-8000-000000000042',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'escalation_pack', 'stripe', 'evt_conflict', 188, 'SGD', 'cancelled'
  );
