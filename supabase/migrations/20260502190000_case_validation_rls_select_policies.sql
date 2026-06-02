-- RLS select policies for validation tables (client reads via user-scoped Supabase JWT).
-- Prior state: RLS enabled with zero policies → default deny for authenticated reads.

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
