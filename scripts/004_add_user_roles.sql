-- Add user_role enum type and update profiles table
CREATE TYPE user_role AS ENUM ('victim', 'helper', 'lead_victim', 'defendant');

-- Add role column to profiles table
ALTER TABLE profiles
ADD COLUMN role user_role DEFAULT 'victim',
ADD COLUMN phone_number TEXT,
ADD COLUMN is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN verification_date TIMESTAMP WITH TIME ZONE;

-- Add index for role-based queries
CREATE INDEX idx_profiles_role ON profiles(role);
