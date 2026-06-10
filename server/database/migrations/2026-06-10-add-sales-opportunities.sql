CREATE TABLE IF NOT EXISTS sales_opportunities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  stock_snapshot INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  notification_sent_at TIMESTAMP NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL;
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS product_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS product_variant_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS type VARCHAR(40) NOT NULL DEFAULT 'LAST_ONE';
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS stock_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_opportunities_active_scope
  ON sales_opportunities (tenant_id, COALESCE(branch_id, 0), product_variant_id, type)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_scope_status
  ON sales_opportunities (tenant_id, branch_id, is_active, expires_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_variant_type
  ON sales_opportunities (tenant_id, product_variant_id, type);
