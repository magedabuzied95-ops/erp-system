import db from "../database/db.js";
import { ensureSingleBranchMode } from "./singleBranchMode.js";
import { ensureForeignKeyConstraint } from "./schemaConstraints.js";

let schemaReadyPromise = null;
const transientLockCodes = new Set(["40P01", "55P03", "57014"]);

const isTransientLockError = (error) => transientLockCodes.has(error?.code);

const applyBootstrapDdlTimeouts = async (client) => {
  await client.query(`SET LOCAL lock_timeout = '2s'`);
  await client.query(`SET LOCAL statement_timeout = '5s'`);
};

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
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
    attendance_radius_meters INTEGER NOT NULL DEFAULT 100,
    allowed_radius_meters INTEGER NOT NULL DEFAULT 100,
    qr_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
    attendance_qr_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    attendance_public_code VARCHAR(32) UNIQUE,
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
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_radius_meters INTEGER NOT NULL DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS allowed_radius_meters INTEGER NOT NULL DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS qr_token TEXT;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_qr_token TEXT;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_public_code VARCHAR(32);`,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN attendance_radius_meters SET DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN allowed_radius_meters SET DEFAULT 100;`,
  `
  UPDATE branches
  SET attendance_radius_meters = COALESCE(attendance_radius_meters, allowed_radius_meters, 100),
      allowed_radius_meters = COALESCE(allowed_radius_meters, attendance_radius_meters, 100)
  WHERE attendance_radius_meters IS NULL
     OR allowed_radius_meters IS NULL;
  `,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN qr_token SET DEFAULT gen_random_uuid()::text;`,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN attendance_qr_token SET DEFAULT encode(gen_random_bytes(32), 'hex');`,
  `
  UPDATE branches
  SET qr_token = COALESCE(qr_token, gen_random_uuid()::text)
  WHERE qr_token IS NULL;
  `,
  `
  UPDATE branches
  SET attendance_qr_token = COALESCE(attendance_qr_token, encode(gen_random_bytes(32), 'hex'))
  WHERE attendance_qr_token IS NULL;
  `,
  `
  UPDATE branches
  SET attendance_public_code = 'b' || id
  WHERE attendance_public_code IS NULL
     OR TRIM(attendance_public_code) = '';
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_qr_token ON branches (qr_token);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_qr_token ON branches (attendance_qr_token);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_public_code ON branches (attendance_public_code);`,
  `CREATE INDEX IF NOT EXISTS idx_branches_tenant_active ON branches (tenant_id, is_active, name);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_tenant_code_unique ON branches (tenant_id, code) WHERE code IS NOT NULL AND code <> '';`,
];

const ensureBranchForeignKeys = async (client) => {
  await ensureForeignKeyConstraint(
    client,
    "employees",
    "employees_branch_id_fkey",
    `
    ALTER TABLE employees
    ADD CONSTRAINT employees_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID
    `
  );
  await ensureForeignKeyConstraint(
    client,
    "attendance_logs",
    "attendance_logs_branch_id_fkey",
    `
    ALTER TABLE attendance_logs
    ADD CONSTRAINT attendance_logs_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID
    `
  );
};

export const ensureBranchSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await applyBootstrapDdlTimeouts(client);
        for (const statement of statements) {
          await client.query(statement);
        }
        await ensureBranchForeignKeys(client);
        console.log("[single-branch-mode:startup]");
        try {
          await ensureSingleBranchMode(client);
        } catch (error) {
          if (!isTransientLockError(error)) throw error;

          console.warn("[single-branch-mode:startup-skipped-transient-lock]", {
            code: error.code,
            message: error.message,
          });
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
