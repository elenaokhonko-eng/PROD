-- Create case_collaborators table for multi-user case access
CREATE TABLE case_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  -- Discrete permission flags for performance and indexing
  can_view BOOLEAN NOT NULL DEFAULT TRUE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_invite BOOLEAN NOT NULL DEFAULT FALSE,
  -- Lifecycle status for collaborator membership
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'removed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(case_id, user_id)
);

-- Add indexes for collaborator queries
CREATE INDEX idx_case_collaborators_case_id ON case_collaborators(case_id);
CREATE INDEX idx_case_collaborators_user_id ON case_collaborators(user_id);
CREATE INDEX idx_case_collaborators_role ON case_collaborators(role);
CREATE INDEX idx_case_collaborators_status ON case_collaborators(status);
