-- AI Studio Phase 7 — variant-level Restock Intents (additive). Mirrors
-- ensureRestockIntentSchema() + the ai_restock_recoveries columns added in this phase.
-- Does NOT touch customer_wishlist or any existing table. New system starts clean; existing
-- wishlist rows remain a legacy product-only fallback (never converted).

CREATE TABLE IF NOT EXISTS restock_intents (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NULL,
  phone TEXT NULL,
  product_id BIGINT NOT NULL,
  variant_id BIGINT NULL,
  size TEXT NULL,
  color TEXT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  source TEXT NOT NULL DEFAULT 'storefront',
  source_reference TEXT NULL,
  last_restock_event_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  customer_notified_at TIMESTAMP NULL,
  fulfilled_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restock_intents_active
  ON restock_intents (tenant_id, COALESCE(phone, ''), product_id, COALESCE(variant_id, 0))
  WHERE status IN ('waiting','recovery_created','customer_notified');
CREATE INDEX IF NOT EXISTS idx_restock_intents_match ON restock_intents (tenant_id, product_id, variant_id, status);
CREATE INDEX IF NOT EXISTS idx_restock_intents_tenant ON restock_intents (tenant_id, created_at DESC);

-- Recovery ledger gains intent linkage + source + match quality; dedup keys additionally on source
-- so an intent-id and a wishlist-id in the same event never collide.
ALTER TABLE ai_restock_recoveries ADD COLUMN IF NOT EXISTS restock_intent_id BIGINT NULL;
ALTER TABLE ai_restock_recoveries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy_wishlist';
ALTER TABLE ai_restock_recoveries ADD COLUMN IF NOT EXISTS match_quality TEXT NULL;
DROP INDEX IF EXISTS uq_ai_restock_recoveries_event_req;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_restock_recoveries_event_src_req
  ON ai_restock_recoveries (tenant_id, restock_event_id, source, request_id);
