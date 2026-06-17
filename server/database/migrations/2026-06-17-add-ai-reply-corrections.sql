CREATE TABLE IF NOT EXISTS ai_reply_corrections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  customer_question TEXT NOT NULL DEFAULT '',
  ai_wrong_answer TEXT NOT NULL DEFAULT '',
  employee_correct_answer TEXT NOT NULL DEFAULT '',
  correction_type TEXT NOT NULL DEFAULT 'other',
  product_id BIGINT NULL,
  channel TEXT NOT NULL DEFAULT 'web_chat',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE IF EXISTS ai_reply_corrections
  ADD COLUMN IF NOT EXISTS tenant_id BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversation_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS message_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_question TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_wrong_answer TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS employee_correct_answer TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS correction_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS created_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_tenant_id
  ON ai_reply_corrections (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_conversation_id
  ON ai_reply_corrections (tenant_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_product_id
  ON ai_reply_corrections (tenant_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_correction_type
  ON ai_reply_corrections (tenant_id, correction_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_created_at
  ON ai_reply_corrections (created_at DESC);
