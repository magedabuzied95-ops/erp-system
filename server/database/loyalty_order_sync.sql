ALTER TABLE IF EXISTS customers
  ADD COLUMN IF NOT EXISTS loyalty_points NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_tier VARCHAR(50) NOT NULL DEFAULT 'Bronze',
  ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS customer_loyalty_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'pos',
  points_change NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_loyalty_history_customer
  ON customer_loyalty_history (tenant_id, customer_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_loyalty_history_order_reason
  ON customer_loyalty_history (COALESCE(tenant_id, 0), customer_id, order_id, source, reason)
  WHERE order_id IS NOT NULL;
