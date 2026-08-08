ALTER TABLE IF EXISTS customers
  ADD COLUMN IF NOT EXISTS purchase_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

