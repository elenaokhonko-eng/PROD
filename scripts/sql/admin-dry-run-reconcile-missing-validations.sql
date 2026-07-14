-- Admin helper: dry-run batch reconcile preview (calls RPC after migration applied).
-- Default is dry_run — does NOT create validation rows.
--
--   select * from public.reconcile_missing_validations(
--     50,                  -- p_limit
--     interval '5 minutes',-- p_older_than
--     true,                -- p_latest_only
--     true,                -- p_dry_run  << keep true until approved
--     false,               -- p_force
--     'admin_dry_run'
--   );
--
-- Live repair (requires explicit approval):
--   select * from public.reconcile_missing_validations(10, interval '5 minutes', true, false, false, 'admin_repair');
--
-- Single extract:
--   select public.reconcile_validation_for_extract('<extract_uuid>'::uuid, false, true);

SELECT *
FROM public.reconcile_missing_validations(
  50,
  interval '5 minutes',
  true,
  true,
  false,
  'admin_dry_run'
);
