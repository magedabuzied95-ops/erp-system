ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_token_expires_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_tenant_email_lower
ON customers (tenant_id, LOWER(email))
WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_customers_password_reset_token_hash ON customers (password_reset_token_hash);
