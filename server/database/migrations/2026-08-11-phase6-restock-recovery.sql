-- AI Studio Phase 6 — Restock Customer Recovery ledger (additive). Mirrors
-- ensureRestockRecoverySchema(); safe to re-run. No changes to customer_wishlist or any
-- existing table. Records why each waiting customer was (or was not) turned into an internal
-- employee follow-up after a restock event.

CREATE TABLE IF NOT EXISTS ai_restock_recoveries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  restock_event_id TEXT NOT NULL,
  request_id BIGINT NULL,            -- customer_wishlist.id
  customer_id BIGINT NULL,
  phone TEXT NULL,
  product_id BIGINT NULL,
  variant_id BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',  -- followup_created | skipped_duplicate | skipped_no_stock | skipped_inactive | failed
  followup_task_id BIGINT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  reason TEXT NULL,
  workflow_id BIGINT NULL,
  run_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Business-level dedup: at most one recovery per (restock event, waiting request).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_restock_recoveries_event_req
  ON ai_restock_recoveries (tenant_id, restock_event_id, request_id);
CREATE INDEX IF NOT EXISTS idx_ai_restock_recoveries_tenant
  ON ai_restock_recoveries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_restock_recoveries_cooldown
  ON ai_restock_recoveries (tenant_id, product_id, phone, created_at DESC);
