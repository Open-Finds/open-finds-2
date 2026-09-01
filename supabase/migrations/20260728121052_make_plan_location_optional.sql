-- Make plans.location nullable so a plan can be created from vibes alone
-- without requiring a typed location (saved-venue picks still auto-fill it).
ALTER TABLE plans ALTER COLUMN location DROP NOT NULL;
