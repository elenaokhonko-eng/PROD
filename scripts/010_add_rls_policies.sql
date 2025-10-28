-- Enable Row Level Security on new tables
ALTER TABLE case_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE router_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymized_training_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for case_collaborators
CREATE POLICY "Users can view their own collaborations"
  ON case_collaborators FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Case owners can manage collaborators"
  ON case_collaborators FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = case_collaborators.case_id
      AND cases.owner_user_id = auth.uid()
    )
  );

-- RLS Policies for router_sessions (anonymous access)
CREATE POLICY "Anyone can create router sessions"
  ON router_sessions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can view their own router sessions"
  ON router_sessions FOR SELECT
  USING (session_token = current_setting('app.session_token', true));

-- RLS Policies for invitations
CREATE POLICY "Users can view invitations they sent"
  ON invitations FOR SELECT
  USING (auth.uid() = inviter_user_id);

CREATE POLICY "Users can view invitations sent to them"
  ON invitations FOR SELECT
  USING (
    auth.jwt() ->> 'email' = invitee_email
  );

CREATE POLICY "Case owners can create invitations"
  ON invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = invitations.case_id
      AND cases.owner_user_id = auth.uid()
    )
  );

-- Update cases RLS to include collaborators
DROP POLICY IF EXISTS "Users can view their own cases" ON cases;
CREATE POLICY "Users can view their own cases or collaborated cases"
  ON cases FOR SELECT
  USING (
    auth.uid() = user_id 
    OR auth.uid() = owner_user_id
    OR auth.uid() = creator_user_id
    OR EXISTS (
      SELECT 1 FROM case_collaborators
      WHERE case_collaborators.case_id = cases.id
      AND case_collaborators.user_id = auth.uid()
    )
  );
