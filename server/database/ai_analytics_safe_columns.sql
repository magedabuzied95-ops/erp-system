-- Adds AI analytics columns idempotently for existing production databases.
-- The backend also runs equivalent checks during AI Support / AI Agent schema bootstrap.

ALTER TABLE IF EXISTS ai_conversations
  ADD COLUMN IF NOT EXISTS detected_intent TEXT,
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_support_sessions
  ADD COLUMN IF NOT EXISTS detected_intent TEXT,
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_support_messages
  ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_customer_interactions
  ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_channel_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT '';

UPDATE ai_customer_interactions
SET detected_intent = intent_type
WHERE COALESCE(detected_intent, '') = '' AND COALESCE(intent_type, '') <> '';
