-- Fix RLS policies for router_sessions to allow anonymous access
-- This is required for the pre-signup triage flow

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view their own router sessions" ON router_sessions;
DROP POLICY IF EXISTS "Anyone can create router sessions" ON router_sessions;

-- Create permissive policies for anonymous access
CREATE POLICY "Allow anonymous insert for router sessions"
  ON router_sessions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select for router sessions"
  ON router_sessions
  FOR SELECT
  USING (true);

CREATE POLICY "Allow anonymous update for router sessions"
  ON router_sessions
  FOR UPDATE
  USING (true);

-- Note: In production, you may want to add additional security measures like:
-- 1. Rate limiting at the application level
-- 2. IP-based restrictions
-- 3. Session token validation in application logic
-- 4. Automatic cleanup of expired sessions
