-- Tighten evidence RLS to align with current case_collaborators schema
-- Run after 014_add_case_collaborators_status.sql

-- Ensure RLS is enabled (noop if already enabled)
ALTER TABLE IF EXISTS evidence ENABLE ROW LEVEL SECURITY;

-- Drop outdated policies if they exist (names from initial migration)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'evidence' AND policyname = 'Users can view evidence for their cases'
  ) THEN
    DROP POLICY "Users can view evidence for their cases" ON evidence;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'evidence' AND policyname = 'Users can upload evidence to their cases'
  ) THEN
    DROP POLICY "Users can upload evidence to their cases" ON evidence;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'evidence' AND policyname = 'Users can delete their own evidence'
  ) THEN
    DROP POLICY "Users can delete their own evidence" ON evidence;
  END IF;
END$$;

-- View: owners, creators, or active collaborators with view permission
CREATE POLICY "evidence_select_cases_and_active_collaborators"
  ON evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = evidence.case_id
        AND (
          cases.owner_user_id = auth.uid()
          OR cases.creator_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM case_collaborators cc
            WHERE cc.case_id = cases.id
              AND cc.user_id = auth.uid()
              AND cc.status = 'active'
              AND cc.can_view = TRUE
          )
        )
    )
  );

-- Insert: owners, creators, or active collaborators with edit permission
CREATE POLICY "evidence_insert_cases_and_active_editors"
  ON evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = evidence.case_id
        AND (
          cases.owner_user_id = auth.uid()
          OR cases.creator_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM case_collaborators cc
            WHERE cc.case_id = cases.id
              AND cc.user_id = auth.uid()
              AND cc.status = 'active'
              AND cc.can_edit = TRUE
          )
        )
    )
  );

-- Delete: owner of the evidence or case owner
CREATE POLICY "evidence_delete_owner_or_case_owner"
  ON evidence FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = evidence.case_id
        AND cases.owner_user_id = auth.uid()
    )
  );

-- Update Evidence RLS to use JSONB permissions (can_edit) and collaborator status

-- Drop previous policies if they exist
DROP POLICY IF EXISTS "Users can upload evidence to their cases" ON evidence;
DROP POLICY IF EXISTS "Users can view evidence for their cases" ON evidence;
DROP POLICY IF EXISTS "Users can delete their own evidence" ON evidence;

-- Recreate with JSONB checks
CREATE POLICY "Users can view evidence for their cases"
  ON evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = evidence.case_id
      AND (
        cases.owner_user_id = auth.uid()
        OR cases.creator_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM case_collaborators
          WHERE case_collaborators.case_id = cases.id
          AND case_collaborators.user_id = auth.uid()
          AND case_collaborators.status = 'active'
        )
      )
    )
  );

CREATE POLICY "Users can upload evidence to their cases"
  ON evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = evidence.case_id
      AND (
        cases.owner_user_id = auth.uid()
        OR cases.creator_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM case_collaborators
          WHERE case_collaborators.case_id = cases.id
          AND case_collaborators.user_id = auth.uid()
          AND case_collaborators.status = 'active'
          AND COALESCE((case_collaborators.permissions->>'can_edit')::boolean, false) = true
        )
      )
    )
  );

CREATE POLICY "Users can delete their own evidence"
  ON evidence FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = evidence.case_id
      AND cases.owner_user_id = auth.uid()
    )
  );

