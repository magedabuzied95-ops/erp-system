ALTER TABLE products ADD COLUMN IF NOT EXISTS bag_type TEXT;

INSERT INTO product_classification_groups (key, name_ar, name_en, sort_order, is_active, deleted_at)
VALUES ('bag_type', 'نوع الشنطة', 'Bag Type', 5, TRUE, NULL)
ON CONFLICT (key) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  deleted_at = NULL,
  updated_at = CURRENT_TIMESTAMP;

