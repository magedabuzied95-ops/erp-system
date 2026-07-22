BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS manual_selling_price NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS manual_price_override_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS purchase_selling_price NUMERIC(12,2) NULL;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS manual_selling_price NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS manual_price_override_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS purchase_selling_price NUMERIC(12,2) NULL;

COMMIT;
