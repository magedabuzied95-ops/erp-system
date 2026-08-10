ALTER TABLE IF EXISTS returns
  ADD COLUMN IF NOT EXISTS disposition VARCHAR(50) NOT NULL DEFAULT 'restock';

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id BIGINT NULL REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_return_id BIGINT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  return_item_id BIGINT NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (return_item_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_return_items_supplier_status
  ON supplier_return_items (tenant_id, supplier_id, status, created_at DESC);
