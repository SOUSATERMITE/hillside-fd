-- Add key_code column to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS key_code text;
