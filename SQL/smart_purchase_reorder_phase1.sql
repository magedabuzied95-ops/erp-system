-- Smart Purchase Reorder Phase 1
-- Adds shoe purchase pack metadata to variants without changing existing stock/order flows.

ALTER TABLE IF EXISTS product_variants
  ADD COLUMN IF NOT EXISTS purchase_pack_type VARCHAR(20) NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS purchase_pack_qty INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reorder_trigger_percent NUMERIC(6,2) NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS size_distribution_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(12,2) NULL;

UPDATE product_variants
SET
  purchase_pack_type = COALESCE(NULLIF(purchase_pack_type, ''), 'unit'),
  purchase_pack_qty = GREATEST(COALESCE(purchase_pack_qty, 1), 1),
  reorder_trigger_percent = COALESCE(reorder_trigger_percent, 70)
WHERE purchase_pack_type IS NULL
   OR purchase_pack_type = ''
   OR purchase_pack_qty IS NULL
   OR purchase_pack_qty < 1
   OR reorder_trigger_percent IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_variants_purchase_pack_type_chk'
  ) THEN
    ALTER TABLE product_variants
      ADD CONSTRAINT product_variants_purchase_pack_type_chk
      CHECK (purchase_pack_type IN ('unit', 'carton'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_variants_purchase_pack
  ON product_variants (purchase_pack_type, purchase_pack_qty);

CREATE INDEX IF NOT EXISTS idx_product_variants_supplier
  ON product_variants (supplier_id);
