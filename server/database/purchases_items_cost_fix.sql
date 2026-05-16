ALTER TABLE IF EXISTS purchase_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) DEFAULT 0;

ALTER TABLE IF EXISTS purchase_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) DEFAULT 0;

UPDATE purchase_items
SET cost_price = unit_cost
WHERE cost_price IS NULL
  AND unit_cost IS NOT NULL;

UPDATE purchase_items
SET unit_cost = cost_price
WHERE unit_cost IS NULL
  AND cost_price IS NOT NULL;

UPDATE purchase_items
SET cost_price = 0
WHERE cost_price IS NULL;

UPDATE purchase_items
SET unit_cost = 0
WHERE unit_cost IS NULL;

ALTER TABLE IF EXISTS purchase_items
  ALTER COLUMN cost_price SET DEFAULT 0;

ALTER TABLE IF EXISTS purchase_items
  ALTER COLUMN unit_cost SET DEFAULT 0;
