-- AI Studio Phase 8 — human-approved customer restock messaging (additive). Mirrors
-- ensureRestockNotificationSchema(). Default production state is OFF (no sends possible).
-- Draft/create/edit/reject have zero side effects; customer_notified_at is set ONLY on confirmed send.

ALTER TABLE ai_workflow_tenant_settings ADD COLUMN IF NOT EXISTS restock_messaging_mode TEXT NOT NULL DEFAULT 'off';

CREATE TABLE IF NOT EXISTS restock_notifications (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  restock_intent_id BIGINT NOT NULL,
  recovery_id BIGINT NULL,
  restock_event_id TEXT NOT NULL,
  customer_id BIGINT NULL,
  phone TEXT NULL,
  product_id BIGINT NULL,
  variant_id BIGINT NULL,
  channel TEXT NULL,
  conversation_id TEXT NULL,
  recipient_reference TEXT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft|pending_approval|approved|sending|sent|rejected|failed|cancelled
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_text TEXT NULL,
  approved_text TEXT NULL,
  provider_message_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  drafted_at TIMESTAMP NULL,
  approved_at TIMESTAMP NULL,
  approved_by BIGINT NULL,
  rejected_at TIMESTAMP NULL,
  rejected_by BIGINT NULL,
  rejection_reason TEXT NULL,
  sent_at TIMESTAMP NULL,
  failed_at TIMESTAMP NULL,
  failure_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- One notification per (intent, restock event); replay never creates a second. Plus send idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restock_notifications_intent_event ON restock_notifications (tenant_id, restock_intent_id, restock_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restock_notifications_idem ON restock_notifications (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_restock_notifications_tenant ON restock_notifications (tenant_id, status, created_at DESC);
