-- Add status column to case_collaborators and backfill
ALTER TABLE case_collaborators
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed'));

-- Backfill existing rows to active if they have accepted_at
UPDATE case_collaborators
SET status = CASE WHEN accepted_at IS NOT NULL THEN 'active' ELSE 'pending' END
WHERE status IS NULL OR status = 'pending';

-- Index for status
CREATE INDEX IF NOT EXISTS idx_case_collaborators_status ON case_collaborators(status);

