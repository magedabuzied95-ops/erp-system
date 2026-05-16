CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT,
  supplier_code VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  whatsapp VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  tax_number VARCHAR(120),
  contact_person VARCHAR(255),
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  debt_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(50);
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(50);
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS tax_number VARCHAR(120);
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS current_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS debt_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active';
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE suppliers
SET
  supplier_code = COALESCE(
    NULLIF(supplier_code, ''),
    'SUP-' || LPAD(id::text, 4, '0')
  ),
  current_balance = COALESCE(NULLIF(current_balance, 0), debt_balance, opening_balance, 0),
  debt_balance = COALESCE(NULLIF(debt_balance, 0), current_balance, opening_balance, 0),
  status = LOWER(COALESCE(NULLIF(status, ''), 'active'))
WHERE supplier_code IS NULL
   OR supplier_code = ''
   OR current_balance IS NULL
   OR debt_balance IS NULL
   OR status IS NULL
   OR status = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_supplier_code_unique
  ON suppliers (supplier_code)
  WHERE supplier_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_status
  ON suppliers (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_suppliers_search
  ON suppliers (tenant_id, supplier_code, name, phone, email);

CREATE INDEX IF NOT EXISTS idx_suppliers_deleted_at
  ON suppliers (deleted_at);
