CREATE TABLE IF NOT EXISTS storefront_customer_carts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  customer_id BIGINT NULL,
  customer_phone VARCHAR(80) NOT NULL,
  cart JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS storefront_customer_carts
  ADD COLUMN IF NOT EXISTS customer_id BIGINT NULL;

ALTER TABLE IF EXISTS storefront_customer_carts
  ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(80) NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS storefront_customer_carts
  ADD COLUMN IF NOT EXISTS cart JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS storefront_customer_carts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS storefront_customer_carts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_storefront_customer_carts_tenant_phone
ON storefront_customer_carts (tenant_id, customer_phone);

CREATE INDEX IF NOT EXISTS idx_storefront_customer_carts_updated_at
ON storefront_customer_carts (updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_storefront_customer_carts_tenant_phone_unique
ON storefront_customer_carts (tenant_id, customer_phone);
