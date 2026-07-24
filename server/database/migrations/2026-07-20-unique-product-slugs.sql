BEGIN;

CREATE TABLE IF NOT EXISTS product_slug_migration_backup_20260720 (
  product_id BIGINT PRIMARY KEY,
  old_slug TEXT NOT NULL DEFAULT '',
  old_canonical_slug TEXT NOT NULL DEFAULT '',
  new_slug TEXT NOT NULL DEFAULT '',
  backed_up_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH normalized AS (
  SELECT
    p.id,
    COALESCE(NULLIF(TRIM(p.slug), ''), NULLIF(TRIM(p.canonical_slug), '')) AS current_slug,
    NULLIF(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          LOWER(TRIM(COALESCE(NULLIF(b.name, ''), NULLIF(p.brand, ''), '') || ' ' || COALESCE(p.name, ''))),
          '[^a-z0-9]+',
          '-',
          'g'
        ),
        '(^-+|-+$)',
        '',
        'g'
      ),
      ''
    ) AS brand_name_slug
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
),
ranked AS (
  SELECT
    p.id,
    COALESCE(NULLIF(TRIM(p.slug), ''), '') AS old_slug,
    COALESCE(NULLIF(TRIM(p.canonical_slug), ''), '') AS old_canonical_slug,
    COALESCE(n.current_slug, n.brand_name_slug, 'product-' || p.id) AS base_slug,
    COUNT(*) OVER (PARTITION BY LOWER(TRIM(COALESCE(n.current_slug, '')))) AS duplicate_count,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(COALESCE(n.current_slug, ''))) ORDER BY p.id ASC) AS duplicate_rank
  FROM products p
  JOIN normalized n ON n.id = p.id
),
targets AS (
  SELECT
    id,
    old_slug,
    old_canonical_slug,
    CASE
      WHEN old_slug = '' OR old_canonical_slug = '' OR duplicate_count > 1
        THEN REGEXP_REPLACE(base_slug, '-[0-9]+$', '') || '-' || id
      ELSE base_slug
    END AS new_slug,
    duplicate_count,
    duplicate_rank
  FROM ranked
),
changed AS (
  SELECT *
  FROM targets
  WHERE duplicate_count > 1
    AND (
      LOWER(TRIM(old_slug)) <> LOWER(TRIM(new_slug))
     OR LOWER(TRIM(old_canonical_slug)) <> LOWER(TRIM(new_slug))
    )
)
INSERT INTO product_slug_migration_backup_20260720 (product_id, old_slug, old_canonical_slug, new_slug)
SELECT id, old_slug, old_canonical_slug, new_slug
FROM changed
ON CONFLICT (product_id) DO NOTHING;

UPDATE products p
SET
  slug = b.new_slug,
  canonical_slug = b.new_slug,
  updated_at = NOW()
FROM product_slug_migration_backup_20260720 b
WHERE b.product_id = p.id
  AND (
    LOWER(TRIM(COALESCE(p.slug, ''))) <> LOWER(TRIM(b.new_slug))
    OR LOWER(TRIM(COALESCE(p.canonical_slug, ''))) <> LOWER(TRIM(b.new_slug))
  );

DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO affected_count FROM product_slug_migration_backup_20260720;
  RAISE NOTICE 'product slug migration affected rows: %', affected_count;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug_unique_lower
  ON products (LOWER(TRIM(slug)))
  WHERE slug IS NOT NULL AND TRIM(slug) <> '';

COMMIT;
