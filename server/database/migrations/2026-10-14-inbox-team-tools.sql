-- AI Inbox team tools (2026-10-14): customer tags, quick replies with photos,
-- hand-set reminders (rows in ai_followup_tasks, no new table) and message
-- sequences. Every statement is also ensured lazily by its service on first
-- use, the house pattern, so this file is the record rather than the gate.

-- Tags on the PERSON, so they follow the customer across channels.
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_customers_tags_gin ON customers USING GIN (tags jsonb_path_ops);

-- Quick replies: a word may be a shortcut ("/مقاسات"), and a reply may carry photos.
ALTER TABLE IF EXISTS ai_inbox_quick_replies ALTER COLUMN shortcut TYPE VARCHAR(40);
ALTER TABLE IF EXISTS ai_inbox_quick_replies ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Message sequences: "wait N minutes, then send this", per conversation.
CREATE TABLE IF NOT EXISTS message_sequences (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  trigger_type VARCHAR(40) NOT NULL DEFAULT 'manual',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  channels JSONB NOT NULL DEFAULT '["whatsapp","instagram","facebook_messenger","telegram"]'::jsonb,
  cooldown_days INTEGER NOT NULL DEFAULT 14,
  stop_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
  stop_on_purchase BOOLEAN NOT NULL DEFAULT TRUE,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_sequences_tenant ON message_sequences (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS message_sequence_enrollments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  sequence_id BIGINT NOT NULL REFERENCES message_sequences(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  channel VARCHAR(40) NOT NULL DEFAULT '',
  customer_phone VARCHAR(40) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  current_step INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  stopped_reason VARCHAR(60) NOT NULL DEFAULT '',
  source VARCHAR(20) NOT NULL DEFAULT 'auto',
  created_by BIGINT NULL,
  locked_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_sequence_enrollments_status_check CHECK (status IN ('active', 'completed', 'stopped'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_sequence_enrollments_active
  ON message_sequence_enrollments (tenant_id, sequence_id, session_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_message_sequence_enrollments_due ON message_sequence_enrollments (status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_message_sequence_enrollments_session ON message_sequence_enrollments (tenant_id, session_id);
