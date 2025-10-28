-- Create referrals table for viral growth tracking
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT UNIQUE NOT NULL,
  referred_email TEXT,
  referred_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT CHECK (status IN ('pending', 'converted', 'rewarded')) DEFAULT 'pending',
  reward_type TEXT,
  reward_amount NUMERIC,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  converted_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ
);

-- Create indexes for referral queries
CREATE INDEX idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX idx_referrals_code ON referrals(referral_code);
CREATE INDEX idx_referrals_referred_user ON referrals(referred_user_id);
CREATE INDEX idx_referrals_status ON referrals(status);

-- Enable RLS
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own referrals
CREATE POLICY "Users can read their own referrals"
  ON referrals
  FOR SELECT
  USING (auth.uid() = referrer_user_id OR auth.uid() = referred_user_id);

-- Policy: Users can create referrals
CREATE POLICY "Users can create referrals"
  ON referrals
  FOR INSERT
  WITH CHECK (auth.uid() = referrer_user_id);

-- Add referral_code to profiles
ALTER TABLE profiles
ADD COLUMN referral_code TEXT UNIQUE,
ADD COLUMN referred_by_code TEXT,
ADD COLUMN referral_count INTEGER DEFAULT 0;

-- Create index for referral code lookups
CREATE INDEX idx_profiles_referral_code ON profiles(referral_code);
