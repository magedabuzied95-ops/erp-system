import db from "../database/db.js";

let schemaReadyPromise = null;

const statements = [
  `
  CREATE TABLE IF NOT EXISTS branches (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    phone VARCHAR(50),
    address TEXT,
    manager VARCHAR(255),
    notes TEXT,
    default_warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    latitude NUMERIC,
    longitude NUMERIC,
    allowed_radius_meters INTEGER NOT NULL DEFAULT 100,
    qr_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS address TEXT;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS manager VARCHAR(255);`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS notes TEXT;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS default_warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS latitude NUMERIC;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS longitude NUMERIC;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS allowed_radius_meters INTEGER NOT NULL DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS qr_token TEXT;`,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN allowed_radius_meters SET DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN qr_token SET DEFAULT gen_random_uuid()::text;`,
  `
  UPDATE branches
  SET qr_token = COALESCE(qr_token, gen_random_uuid()::text)
  WHERE qr_token IS NULL;
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_qr_token ON branches (qr_token);`,
  `CREATE INDEX IF NOT EXISTS idx_branches_tenant_active ON branches (tenant_id, is_active, name);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_tenant_code_unique ON branches (tenant_id, code) WHERE code IS NOT NULL AND code <> '';`,
  `ALTER TABLE IF EXISTS employees DROP CONSTRAINT IF EXISTS employees_branch_id_fkey;`,
  `
  ALTER TABLE IF EXISTS employees
    ADD CONSTRAINT employees_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID;
  `,
  `ALTER TABLE IF EXISTS attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_branch_id_fkey;`,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD CONSTRAINT attendance_logs_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID;
  `,
];

export const ensureBranchSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
};

export default ensureBranchSchema;
