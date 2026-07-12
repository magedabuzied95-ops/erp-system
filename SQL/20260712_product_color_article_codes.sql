BEGIN;

CREATE TABLE IF NOT EXISTS product_color_groups (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color_name VARCHAR(255) NOT NULL DEFAULT '',
  color_article_code TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS product_color_groups_product_color_unique
  ON product_color_groups (product_id, LOWER(TRIM(color_name)));

CREATE INDEX IF NOT EXISTS product_color_groups_article_code_lower
  ON product_color_groups (LOWER(TRIM(color_article_code)))
  WHERE color_article_code IS NOT NULL AND TRIM(color_article_code) <> '';

-- Existing screens stored a shared color Article Code on every size variant.
-- Only backfill colors whose non-empty variant values agree, preserving every
-- product_variants.article_code exactly as-is for backward compatibility.
INSERT INTO product_color_groups (tenant_id, product_id, color_name, color_article_code)
SELECT
  MIN(pv.tenant_id),
  pv.product_id,
  MIN(TRIM(COALESCE(pv.color, ''))),
  MIN(TRIM(pv.article_code))
FROM product_variants pv
WHERE pv.deleted_at IS NULL
  AND TRIM(COALESCE(pv.color, '')) <> ''
  AND TRIM(COALESCE(pv.article_code, '')) <> ''
GROUP BY pv.product_id, LOWER(TRIM(COALESCE(pv.color, '')))
HAVING COUNT(DISTINCT TRIM(pv.article_code)) = 1
ON CONFLICT (product_id, LOWER(TRIM(color_name))) DO NOTHING;

COMMIT;

