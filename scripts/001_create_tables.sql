-- Create core tables for GuideBuoy AI platform

-- Waitlist table for landing page signups
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source TEXT DEFAULT 'landing_page'
);

-- User profiles table (references auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PDPA consent logging
CREATE TABLE IF NOT EXISTS consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  consent_purposes TEXT[] NOT NULL,
  policy_version TEXT DEFAULT '1.0',
  consented_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Cases table for dispute management
CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_type TEXT NOT NULL CHECK (claim_type IN ('phishing_scam', 'mis_sold_product', 'denied_insurance')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'triage', 'intake', 'evidence', 'generation', 'filed', 'tracking', 'completed')),
  claim_amount DECIMAL(12,2),
  institution_name TEXT,
  incident_date DATE,
  case_summary TEXT,
  eligibility_status TEXT CHECK (eligibility_status IN ('eligible', 'out_of_scope', 'pending')),
  strength_score TEXT CHECK (strength_score IN ('low', 'medium', 'high')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Case responses for triage questionnaire
CREATE TABLE IF NOT EXISTS case_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  response_value TEXT,
  response_type TEXT DEFAULT 'text' CHECK (response_type IN ('text', 'boolean', 'number', 'date', 'file')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Evidence/documents storage
CREATE TABLE IF NOT EXISTS case_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  document_type TEXT, -- 'statement', 'correspondence', 'policy', 'medical', etc.
  exhibit_label TEXT, -- 'Exhibit A', 'Exhibit B', etc.
  upload_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  file_url TEXT,
  is_processed BOOLEAN DEFAULT FALSE
);

-- Payment records
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'SGD',
  service_type TEXT NOT NULL CHECK (service_type IN ('standard', 'nominee')),
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Case outcomes tracking
CREATE TABLE IF NOT EXISTS case_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  outcome_type TEXT CHECK (outcome_type IN ('settled', 'adjudicated', 'withdrawn')),
  amount_recovered DECIMAL(12,2),
  outcome_date DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Analytics events
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  event_name TEXT NOT NULL,
  event_data JSONB,
  page_url TEXT,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security on all tables
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Waitlist policies (public access for signup)
CREATE POLICY "Allow public insert on waitlist" ON waitlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public select on waitlist" ON waitlist FOR SELECT USING (true);

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Consent logs policies
CREATE POLICY "Users can view own consent logs" ON consent_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own consent logs" ON consent_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Cases policies
CREATE POLICY "Users can view own cases" ON cases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cases" ON cases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cases" ON cases FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cases" ON cases FOR DELETE USING (auth.uid() = user_id);

-- Case responses policies
CREATE POLICY "Users can view own case responses" ON case_responses FOR SELECT USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_responses.case_id AND cases.user_id = auth.uid())
);
CREATE POLICY "Users can insert own case responses" ON case_responses FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_responses.case_id AND cases.user_id = auth.uid())
);
CREATE POLICY "Users can update own case responses" ON case_responses FOR UPDATE USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_responses.case_id AND cases.user_id = auth.uid())
);

-- Case documents policies
CREATE POLICY "Users can view own case documents" ON case_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_documents.case_id AND cases.user_id = auth.uid())
);
CREATE POLICY "Users can insert own case documents" ON case_documents FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_documents.case_id AND cases.user_id = auth.uid())
);
CREATE POLICY "Users can update own case documents" ON case_documents FOR UPDATE USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_documents.case_id AND cases.user_id = auth.uid())
);
CREATE POLICY "Users can delete own case documents" ON case_documents FOR DELETE USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_documents.case_id AND cases.user_id = auth.uid())
);

-- Payments policies
CREATE POLICY "Users can view own payments" ON payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own payments" ON payments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Case outcomes policies
CREATE POLICY "Users can view own case outcomes" ON case_outcomes FOR SELECT USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_outcomes.case_id AND cases.user_id = auth.uid())
);
CREATE POLICY "Users can insert own case outcomes" ON case_outcomes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_outcomes.case_id AND cases.user_id = auth.uid())
);
CREATE POLICY "Users can update own case outcomes" ON case_outcomes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = case_outcomes.case_id AND cases.user_id = auth.uid())
);

-- Analytics events policies (users can only insert, not view others' data)
CREATE POLICY "Users can insert analytics events" ON analytics_events FOR INSERT WITH CHECK (
  auth.uid() = user_id OR user_id IS NULL
);
CREATE POLICY "Users can view own analytics events" ON analytics_events FOR SELECT USING (
  auth.uid() = user_id
);
