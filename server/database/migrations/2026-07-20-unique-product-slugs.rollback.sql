BEGIN;

DROP INDEX IF EXISTS idx_products_slug_unique_lower;

UPDATE products p
SET
  slug = b.old_slug,
  canonical_slug = b.old_canonical_slug,
  updated_at = NOW()
FROM product_slug_migration_backup_20260720 b
WHERE b.product_id = p.id;

DO $$
DECLARE
  restored_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO restored_count FROM product_slug_migration_backup_20260720;
  RAISE NOTICE 'product slug rollback restored rows: %', restored_count;
END $$;

COMMIT;
