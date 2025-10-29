-- Align router_sessions table with application conversion workflow
ALTER TABLE router_sessions
  ADD COLUMN IF NOT EXISTS converted_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE router_sessions
  ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE router_sessions
  ALTER COLUMN status SET DEFAULT 'ACTIVE';

UPDATE router_sessions
SET status = 'CONVERTED'
WHERE converted_to_user_id IS NOT NULL
  AND (status IS NULL OR status <> 'CONVERTED');

UPDATE router_sessions
SET status = 'ACTIVE'
WHERE converted_to_user_id IS NULL
  AND status IS NULL;

ALTER TABLE router_sessions
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE router_sessions
    ADD CONSTRAINT router_sessions_status_check CHECK (status IN ('ACTIVE', 'CONVERTED', 'EXPIRED'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_router_sessions_converted_to_user_id
  ON router_sessions(converted_to_user_id);

