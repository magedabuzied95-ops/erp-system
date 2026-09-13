-- "Pairs well with" bundles on the storefront product page.
--
-- The server also creates these at boot (ensureProductBundleSchema in
-- server/services/productBundleService.js); both statements are metadata-only
-- CREATE TABLE IF NOT EXISTS, so running this file first is optional and safe.
-- New tables rather than new columns on products/orders, so no lock is taken
-- on either hot table.
SET lock_timeout = '5s';

-- The pair the owner pinned for a product in the ERP. No row = automatic pick.
CREATE TABLE IF NOT EXISTS product_pairings (
  product_id BIGINT PRIMARY KEY,
  tenant_id BIGINT,
  pair_product_id BIGINT NOT NULL,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- What each bundle on an order was discounted. The amount is also inside
-- orders.discount_amount; this row is the breakdown.
CREATE TABLE IF NOT EXISTS order_bundle_discounts (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL,
  tenant_id BIGINT,
  bundle_id TEXT NOT NULL,
  product_ids BIGINT[] NOT NULL,
  sets INTEGER NOT NULL DEFAULT 1,
  base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_bundle_discounts_order ON order_bundle_discounts (order_id);
