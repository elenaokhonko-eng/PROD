-- Migration: Supabase Auth -> Clerk
-- Adds clerk_id to profiles and drops FK constraints to auth.users

-- Add clerk_id column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_id ON profiles (clerk_id);

-- Drop the auto-create profile trigger (profile creation moves to Clerk webhook)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Drop FK constraints from auth.users(id)
-- profiles: drop PK reference to auth.users
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- cases: drop user_id FK
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_user_id_fkey;

-- consent_logs: drop user_id FK
ALTER TABLE consent_logs DROP CONSTRAINT IF EXISTS consent_logs_user_id_fkey;

-- payments: drop user_id FK
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;

-- analytics_events: drop user_id FK
ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_user_id_fkey;

-- evidence: drop user_id FK (if exists)
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_user_id_fkey;

-- router_sessions: drop user_id FK (if exists)
ALTER TABLE router_sessions DROP CONSTRAINT IF EXISTS router_sessions_user_id_fkey;
