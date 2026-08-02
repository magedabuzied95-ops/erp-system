BEGIN;

CREATE TABLE IF NOT EXISTS transactional_email_outbox (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  template_key VARCHAR(80) NOT NULL,
  recipient_type VARCHAR(30) NOT NULL,
  dedupe_key VARCHAR(180) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transactional_email_outbox_recipient_type_check CHECK (recipient_type IN ('admin','customer')),
  CONSTRAINT transactional_email_outbox_status_check CHECK (status IN ('pending','processing','retry','sent','failed')),
  CONSTRAINT transactional_email_outbox_dedupe_key_unique UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_transactional_email_outbox_ready
  ON transactional_email_outbox (status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS idx_transactional_email_outbox_order
  ON transactional_email_outbox (order_id, template_key);

COMMIT;
