ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS company_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS favicon_url TEXT;

ALTER TABLE IF EXISTS company_profiles
  ADD COLUMN IF NOT EXISTS favicon_url TEXT;

UPDATE tenants
SET company_name = COALESCE(NULLIF(TRIM(company_name), ''), NULLIF(TRIM(name), ''), 'MONE')
WHERE COALESCE(NULLIF(TRIM(company_name), ''), '') = '';

UPDATE company_profiles
SET favicon_url = COALESCE(NULLIF(TRIM(favicon_url), ''), '')
WHERE favicon_url IS NOT NULL;
