-- Create evidence table for file uploads
CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_evidence_case_id ON evidence(case_id);
CREATE INDEX idx_evidence_user_id ON evidence(user_id);
CREATE INDEX idx_evidence_category ON evidence(category);

-- Enable RLS
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;

-- RLS Policies
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
          AND 'write' = ANY(case_collaborators.permissions)
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

-- Create storage bucket for evidence
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence', 'evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload evidence to their cases"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidence'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Users can view evidence from their cases"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Users can delete their own evidence"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'evidence'
    AND auth.role() = 'authenticated'
  );
