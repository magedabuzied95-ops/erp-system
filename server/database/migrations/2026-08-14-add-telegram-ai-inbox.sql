-- Telegram AI Inbox durable webhook intake.
-- Additive only: no existing table, column, index, or data is removed or rewritten.

CREATE TABLE IF NOT EXISTS telegram_webhook_updates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  update_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMP NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, update_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_webhook_updates_pending
  ON telegram_webhook_updates (processing_status, next_attempt_at, received_at)
  WHERE processing_status IN ('pending', 'failed', 'processing');
