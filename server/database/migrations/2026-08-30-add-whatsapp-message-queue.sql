-- The WhatsApp outbound queue (additive; mirrors ensureWhatsappQueueSchema()).
--
-- Before this, nothing on our side held an outbound automation: every one was POSTed straight at
-- Evolution, which accepts over HTTP while its WhatsApp socket is dead and buffers in Baileys'
-- own queue — then flushes the whole day's backlog in minutes on reconnect. This table is that
-- queue, moved to where we can see it, pace it, expire it and cancel it.
--
-- Safe on existing data: two new tables and one counter table. Nothing existing is altered, and
-- with whatsapp.queue.enabled = false every automation keeps its current direct-send path.
--
-- TIMESTAMPTZ, not the TIMESTAMP used elsewhere in this schema, and deliberately so. Every
-- decision this table drives is "is this too old" — and a naive TIMESTAMP compares NOW() (the
-- database session's wall clock) against a JS Date the driver serialises as UTC. On a host at
-- UTC+3 that made every message look three hours older than it was, which silently expired
-- receipts that were still perfectly fresh. There is no legacy data here to migrate, so the
-- correct type is simply the one used.

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_message_queue (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,

  -- What this message is, and which rulebook it answers to.
  automation_type VARCHAR(60) NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'engagement',

  -- Who it goes to, and what it is about.
  customer_id BIGINT NULL,
  order_id BIGINT NULL,
  invoice_number VARCHAR(80) NULL,
  recipient_phone VARCHAR(40) NOT NULL,
  instance VARCHAR(120) NULL,

  -- The message itself. rendered_body is written ONCE at enqueue: a retry re-sends this exact
  -- text rather than re-rendering, so one event can never reach a customer in two wordings.
  message_variant_id VARCHAR(80) NULL,
  rendered_body TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  -- The same event must never produce a second message for the same customer.
  idempotency_key VARCHAR(200) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Written at enqueue, not evaluated at send: what "too old" means is decided by the settings
  -- in force when the event happened, not by whatever they were changed to during the outage.
  expires_at TIMESTAMPTZ NULL,
  sent_at TIMESTAMPTZ NULL,
  expired_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,

  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ NULL,
  next_retry_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  error_code VARCHAR(80) NULL,

  -- Claim bookkeeping: two workers must never send the same row.
  locked_at TIMESTAMPTZ NULL,
  locked_by VARCHAR(120) NULL,

  provider_message_id VARCHAR(200) NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT whatsapp_message_queue_status_check
    CHECK (status IN ('pending','scheduled','sending','sent','failed','expired','cancelled')),
  CONSTRAINT whatsapp_message_queue_category_check
    CHECK (category IN ('transactional','engagement')),
  CONSTRAINT whatsapp_message_queue_idempotency_unique UNIQUE (idempotency_key)
);

-- The worker's claim query: ready rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_ready
  ON whatsapp_message_queue (status, scheduled_at, id);
-- The dashboard's counters and the "messages in the last hour" rate check.
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_sent_at
  ON whatsapp_message_queue (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_lookup
  ON whatsapp_message_queue (tenant_id, automation_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_order
  ON whatsapp_message_queue (order_id);

-- Singleton runtime state. One row per tenant (tenant_id 0 = the single-tenant install).
-- This is where paused_for_review lives: a queue-wide latch, not a per-row status.
CREATE TABLE IF NOT EXISTS whatsapp_queue_runtime (
  tenant_id BIGINT PRIMARY KEY,
  state VARCHAR(40) NOT NULL DEFAULT 'running',
  pause_reason VARCHAR(80) NULL,
  pause_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  paused_at TIMESTAMPTZ NULL,
  resumed_at TIMESTAMPTZ NULL,
  connection_state VARCHAR(40) NULL,
  last_connected_at TIMESTAMPTZ NULL,
  last_disconnected_at TIMESTAMPTZ NULL,
  last_drain_at TIMESTAMPTZ NULL,
  offline_alerted_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_queue_runtime_state_check
    CHECK (state IN ('running','paused','paused_for_review'))
);

-- Added after the first deploy, so installs that already have the table need the ALTER too.
ALTER TABLE IF EXISTS whatsapp_queue_runtime ADD COLUMN IF NOT EXISTS offline_alerted_at TIMESTAMPTZ NULL;

-- Round-robin position per automation type. A counter in the database rather than in memory,
-- so a restart does not reset every customer back to variant A.
CREATE TABLE IF NOT EXISTS whatsapp_variant_rotation (
  tenant_id BIGINT NOT NULL,
  automation_type VARCHAR(60) NOT NULL,
  position BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, automation_type)
);

COMMIT;
