-- Create router_sessions table for anonymous pre-signup router
CREATE TABLE router_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT UNIQUE NOT NULL,
  dispute_narrative TEXT,
  voice_transcript TEXT,
  audio_file_url TEXT,
  classification_result JSONB,
  clarifying_questions JSONB,
  user_responses JSONB,
  eligibility_assessment JSONB,
  recommended_path TEXT,
  converted_to_case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  converted_at TIMESTAMP WITH TIME ZONE,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '7 days'
);

-- Add indexes for router session queries
CREATE INDEX idx_router_sessions_session_token ON router_sessions(session_token);
CREATE INDEX idx_router_sessions_converted_to_case_id ON router_sessions(converted_to_case_id);
CREATE INDEX idx_router_sessions_created_at ON router_sessions(created_at);
