ALTER TABLE IF EXISTS product_variants
  ADD COLUMN IF NOT EXISTS audience VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_audience
  ON product_variants (product_id, audience, is_active)
  WHERE deleted_at IS NULL;
