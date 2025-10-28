-- Create function to increment referral count
CREATE OR REPLACE FUNCTION increment_referral_count(user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET referral_count = COALESCE(referral_count, 0) + 1
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check and reward referrals
CREATE OR REPLACE FUNCTION check_and_reward_referral(referred_user_id UUID)
RETURNS void AS $$
DECLARE
  referrer_id UUID;
  referral_record RECORD;
BEGIN
  -- Find the referral record
  SELECT * INTO referral_record
  FROM referrals
  WHERE referrals.referre
