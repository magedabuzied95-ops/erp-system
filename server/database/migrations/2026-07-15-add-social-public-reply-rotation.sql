ALTER TABLE IF EXISTS social_automation_settings
  ADD COLUMN IF NOT EXISTS public_reply_rotation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS public_reply_openers JSONB NOT NULL DEFAULT '[]'::jsonb;
