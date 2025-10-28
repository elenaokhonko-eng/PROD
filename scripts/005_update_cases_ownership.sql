-- Update cases table to support ownership transfer and collaboration
ALTER TABLE cases
ADD COLUMN owner_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
ADD COLUMN creator_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
ADD COLUMN dispute_category TEXT,
ADD COLUMN router_session_id TEXT,
ADD COLUMN is_anonymous BOOLEAN DEFAULT FALSE;

-- Migrate existing user_id to both owner and creator
UPDATE cases SET owner_user_id = user_id, creator_user_id = user_id WHERE user_id IS NOT NULL;

-- Add indexes for ownership queries
CREATE INDEX idx_cases_owner_user_id ON cases(owner_user_id);
CREATE INDEX idx_cases_creator_user_id ON cases(creator_user_id);
CREATE INDEX idx_cases_router_session_id ON cases(router_session_id);
