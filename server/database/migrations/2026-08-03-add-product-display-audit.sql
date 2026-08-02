ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_displayed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_products_display_audit
  ON products (tenant_id, is_displayed, is_active)
  WHERE status = 'active';
