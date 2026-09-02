import db from "../../database/db.js";

/*
 * Schema for the WhatsApp outbound queue. Mirrors
 * server/database/migrations/2026-08-30-add-whatsapp-message-queue.sql exactly.
 *
 * Lazily ensured on first use, the house pattern — a startup migration that fails takes the whole
 * boot with it, and an outbound queue is not worth bricking the ERP for.
 *
 * TIMESTAMPTZ, not the TIMESTAMP used elsewhere in this schema, and deliberately so. Every
 * decision this table drives is "is this too old" — and a naive TIMESTAMP compares NOW() (the
 * database session's wall clock) against a JS Date the driver serialises as UTC. On a host at
 * UTC+3 that made every message look three hours older than it was, silently expiring receipts
 * that were still perfectly fresh. No legacy data here, so the correct type is simply the one used.
 */

let schemaReadyPromise = null;

const run = async (clientOrPool) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_message_queue (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      automation_type VARCHAR(60) NOT NULL,
      category VARCHAR(30) NOT NULL DEFAULT 'engagement',
      customer_id BIGINT NULL,
      order_id BIGINT NULL,
      invoice_number VARCHAR(80) NULL,
      recipient_phone VARCHAR(40) NOT NULL,
      instance VARCHAR(120) NULL,
      message_variant_id VARCHAR(80) NULL,
      rendered_body TEXT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      idempotency_key VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
      locked_at TIMESTAMPTZ NULL,
      locked_by VARCHAR(120) NULL,
      provider_message_id VARCHAR(200) NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT whatsapp_message_queue_status_check
        CHECK (status IN ('pending','scheduled','sending','sent','failed','expired','cancelled')),
      CONSTRAINT whatsapp_message_queue_category_check
        CHECK (category IN ('transactional','engagement')),
      CONSTRAINT whatsapp_message_queue_idempotency_unique UNIQUE (idempotency_key)
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_ready ON whatsapp_message_queue (status, scheduled_at, id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_sent_at ON whatsapp_message_queue (sent_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_lookup ON whatsapp_message_queue (tenant_id, automation_type, status, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_message_queue_order ON whatsapp_message_queue (order_id)`);

  await clientOrPool.query(`
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
    )
  `);

  /*
   * For installs that already have the table: CREATE TABLE IF NOT EXISTS is a no-op on them, so a
   * column added after the first deploy needs its own ALTER or the alert below never has anywhere
   * to record that it fired.
   */
  await clientOrPool.query(`ALTER TABLE IF EXISTS whatsapp_queue_runtime ADD COLUMN IF NOT EXISTS offline_alerted_at TIMESTAMPTZ NULL`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_variant_rotation (
      tenant_id BIGINT NOT NULL,
      automation_type VARCHAR(60) NOT NULL,
      position BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, automation_type)
    )
  `);
};

export const ensureWhatsappQueueSchema = async (clientOrPool = db) => {
  if (clientOrPool !== db) return run(clientOrPool);
  if (!schemaReadyPromise) {
    schemaReadyPromise = run(db).catch((error) => {
      // A failed ensure must not become a cached rejection: the next caller has to be able
      // to try again, or one transient DB blip disables the queue until the next deploy.
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

export const resetWhatsappQueueSchemaCache = () => {
  schemaReadyPromise = null;
};
