-- State-machine browser reads for user-owned Layer 1 rows.
--
-- The dashboard uses a Clerk-signed Supabase JWT, so RLS must allow the case
-- owner to read the extract, validation, gap, narrative, and entitlement rows
-- that drive the state resolver. These policies are intentionally SELECT-only.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_extract_runs'
      AND policyname = 'Users can view own case_extract_runs'
  ) THEN
    CREATE POLICY "Users can view own case_extract_runs"
      ON public.case_extract_runs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.cases
          WHERE cases.id = case_extract_runs.case_id
            AND cases.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_validation_runs'
      AND policyname = 'Users can view own case_validation_runs'
  ) THEN
    CREATE POLICY "Users can view own case_validation_runs"
      ON public.case_validation_runs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.cases
          WHERE cases.id = case_validation_runs.case_id
            AND cases.user_id = auth.uid()
        )
      );
  END IF;

  IF to_regclass('public.case_validation_gap_items') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'case_validation_gap_items'
        AND policyname = 'Users can view own case_validation_gap_items'
    )
  THEN
    CREATE POLICY "Users can view own case_validation_gap_items"
      ON public.case_validation_gap_items
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.cases
          WHERE cases.id = case_validation_gap_items.case_id
            AND cases.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_narratives'
      AND policyname = 'Users can view own case_narratives'
  ) THEN
    CREATE POLICY "Users can view own case_narratives"
      ON public.case_narratives
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.cases
          WHERE cases.id = case_narratives.case_id
            AND cases.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_entitlements'
      AND policyname = 'Users can view own case_entitlements'
  ) THEN
    CREATE POLICY "Users can view own case_entitlements"
      ON public.case_entitlements
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.cases
          WHERE cases.id = case_entitlements.case_id
            AND cases.user_id = auth.uid()
        )
      );
  END IF;
END $$;
