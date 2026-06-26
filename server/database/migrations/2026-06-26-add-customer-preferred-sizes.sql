ALTER TABLE customers
ADD COLUMN IF NOT EXISTS preferred_sizes JSONB DEFAULT '{}'::jsonb;
