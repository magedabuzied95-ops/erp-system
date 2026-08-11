-- AI Studio Phase 9 — Messaging Lifecycle & Delivery Reconciliation.
-- Additive only. Mirrors ensureMessageDeliverySchema in messageDeliveryReconciliationService.js.
-- Provider delivery-event ledger: persistent idempotency + unmatched-event observability (no raw bodies).

CREATE TABLE IF NOT EXISTS message_delivery_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  channel TEXT NOT NULL,
  provider_message_id TEXT NULL,
  provider_event_id TEXT NULL,
  status TEXT NOT NULL,
  previous_status TEXT NULL,
  new_status TEXT NULL,
  occurred_at TIMESTAMP NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  matched_message_id BIGINT NULL,
  notification_id BIGINT NULL,
  reason TEXT NULL,
  dedup_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_delivery_events_dedup ON message_delivery_events (tenant_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_message_delivery_events_pmid ON message_delivery_events (tenant_id, channel, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_message_delivery_events_unmatched ON message_delivery_events (tenant_id, matched, received_at DESC);

-- Notification delivery projection (monotonic view for the operator UI). customer_notified_at is
-- unchanged (it means "provider accepted the send", Phase 8); these are separate delivery timestamps.
ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS delivery_status TEXT NULL;
ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP NULL;
ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL;
ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS provider_failed_at TIMESTAMP NULL;
ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS provider_failure_code TEXT NULL;
ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS provider_failure_reason TEXT NULL;
ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS last_provider_event_at TIMESTAMP NULL;
