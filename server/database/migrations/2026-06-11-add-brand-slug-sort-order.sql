ALTER TABLE IF EXISTS brands
  ADD COLUMN IF NOT EXISTS slug VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE brands
SET
  slug = COALESCE(NULLIF(slug, ''), id::text),
  image_url = COALESCE(NULLIF(image_url, ''), NULLIF(logo_url, '')),
  logo_url = COALESCE(NULLIF(logo_url, ''), NULLIF(image_url, ''))
WHERE COALESCE(NULLIF(slug, ''), '') = ''
   OR COALESCE(NULLIF(image_url, ''), NULLIF(logo_url, '')) IS NOT NULL;
