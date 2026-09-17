-- Product history dialog (/products → click the product image).
--
-- Optional: the dialog works without these, they only keep it fast as the
-- tables grow. CONCURRENTLY, so run each statement on its own, outside a
-- transaction block (psql runs them one by one by default).
SET lock_timeout = '5s';

-- purchase_items is only indexed by purchase_id; the dialog reads it by product.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_items_product_variant
  ON purchase_items (product_id, variant_id);

-- "Who added this colour/size": one audit row per product save. Partial, so
-- the index only holds those rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_product_variants_created
  ON audit_logs (entity_id, id)
  WHERE action = 'product.variants_created' AND entity_type = 'product';
