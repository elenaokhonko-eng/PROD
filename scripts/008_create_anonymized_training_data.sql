-- Create anonymized_training_data table for AI model training (PDPA compliant)
CREATE TABLE anonymized_training_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_case_id UUID,
  anonymized_narrative TEXT,
  dispute_category TEXT,
  outcome_type TEXT,
  anonymization_method TEXT,
  anonymized_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for training data queries
CREATE INDEX idx_anonymized_training_data_category ON anonymized_training_data(dispute_category);
CREATE INDEX idx_anonymized_training_data_outcome ON anonymized_training_data(outcome_type);

-- Add privacy tracking to cases
ALTER TABLE cases
ADD COLUMN data_retention_policy TEXT DEFAULT 'standard',
ADD COLUMN anonymization_requested BOOLEAN DEFAULT FALSE,
ADD COLUMN anonymization_completed_at TIMESTAMP WITH TIME ZONE;
