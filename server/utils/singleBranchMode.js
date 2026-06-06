import db from "../database/db.js";
import { reconcileMoneyAccountUniqueness } from "../services/accountingService.js";

export const SINGLE_BRANCH_NAME = "فرع البشبيشي";
export const SINGLE_BRANCH_CODE = "BESHBISHI";

let singleBranchReadyPromise = null;
let singleBranchEnsured = false;
let singleBranchResult = null;
let singleBranchRuntimeWarningLogged = false;

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const transientLockCodes = new Set(["40P01", "55P03", "57014"]);

const isTransientLockError = (error) => transientLockCodes.has(error?.code);

const applyBootstrapDdlTimeouts = async (clientOrPool) => {
  try {
    await clientOrPool.query(`SET LOCAL lock_timeout = '2s'`);
    await clientOrPool.query(`SET LOCAL statement_timeout = '5s'`);
  } catch (error) {
    if (error?.code !== "25001") throw error;

    await clientOrPool.query(`SET lock_timeout = '2s'`);
    await clientOrPool.query(`SET statement_timeout = '5s'`);
  }
};

async function safeRequiredDdl(client, sql, label) {
  await client.query(sql);
  console.log("[single-branch-ddl:ok]", { label });
  return true;
}

async function safeOptionalDdl(client, sql, label) {
  const savepointName = "before_optional_ddl";
  try {
    await client.query(`SAVEPOINT ${savepointName}`);
    await client.query(sql);
    await client.query(`RELEASE SAVEPOINT ${savepointName}`);
    console.log("[single-branch-ddl:ok]", { label });
    return true;
  } catch (error) {
    const savepointError = error?.code === "25P01" || error?.code === "25P02";

    if (savepointError) {
      try {
        await client.query(sql);
        console.log("[single-branch-ddl:ok]", { label });
        return true;
      } catch (fallbackError) {
        if (isTransientLockError(fallbackError)) {
          console.warn("[single-branch-ddl:skipped-transient-lock]", {
            label,
            code: fallbackError.code,
            message: fallbackError.message,
          });
          return false;
        }

        throw fallbackError;
      }
    }

    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    } catch (savepointRollbackError) {
      if (savepointRollbackError?.code !== "3B001" && savepointRollbackError?.code !== "25P01") {
        throw savepointRollbackError;
      }
    }

    try {
      await client.query(`RELEASE SAVEPOINT ${savepointName}`);
    } catch (savepointReleaseError) {
      if (savepointReleaseError?.code !== "3B001" && savepointReleaseError?.code !== "25P01") {
        throw savepointReleaseError;
      }
    }

    if (isTransientLockError(error)) {
      console.warn("[single-branch-ddl:skipped-transient-lock]", {
        label,
        code: error.code,
        message: error.message,
      });
      return false;
    }

    throw error;
  }
}

const getBranchIdTables = async (clientOrPool) => {
  const result = await clientOrPool.query(
    `
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = current_schema()
      AND c.column_name = 'branch_id'
      AND c.table_name <> 'branches'
      AND t.table_type = 'BASE TABLE'
    ORDER BY table_name
    `
  );

  return result.rows;
};

const warnRuntimeSingleBranchSchemaExecution = () => {
  if (globalThis.__SCHEMA_STARTUP_RUNNING || singleBranchRuntimeWarningLogged) return;
  singleBranchRuntimeWarningLogged = true;
  console.warn("[schema-warning] runtime schema execution detected", { name: "singleBranchMode" });
};

const ensureSingleBranchModeNow = async (clientOrPool = db) => {
  await applyBootstrapDdlTimeouts(clientOrPool);
  await safeRequiredDdl(clientOrPool, `CREATE EXTENSION IF NOT EXISTS pgcrypto;`, "create_pgcrypto_extension");
  await safeRequiredDdl(
    clientOrPool,
    `
    CREATE TABLE IF NOT EXISTS tenants (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(120) NOT NULL UNIQUE,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      plan VARCHAR(50) NOT NULL DEFAULT 'trial',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
    "create_tenants_table"
  );
  await safeRequiredDdl(
    clientOrPool,
    `
    INSERT INTO tenants (name, slug, status, plan)
    SELECT 'Default Company', 'default-company', 'active', 'trial'
    WHERE NOT EXISTS (SELECT 1 FROM tenants)
    ON CONFLICT (slug) DO NOTHING
  `,
    "seed_default_tenant"
  );

  const tenantResult = await clientOrPool.query(`
    SELECT id
    FROM tenants
    ORDER BY CASE WHEN slug = 'default-company' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `);
  const tenantId = tenantResult.rows[0]?.id || 1;

  await safeRequiredDdl(
    clientOrPool,
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
    )
  `,
    "create_branches_table"
  );
  await safeRequiredDdl(
    clientOrPool,
    `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS notes TEXT`,
    "alter_branches_add_notes"
  );
  await safeRequiredDdl(
    clientOrPool,
    `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
    "alter_branches_add_is_active"
  );
  await safeRequiredDdl(
    clientOrPool,
    `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_public_code VARCHAR(32)`,
    "alter_branches_add_attendance_public_code"
  );

  const keeperResult = await clientOrPool.query(
    `
    WITH existing AS (
      SELECT id
      FROM branches
      WHERE name = $1
      ORDER BY id ASC
      LIMIT 1
    ),
    inserted AS (
      INSERT INTO branches (tenant_id, name, code, is_active)
      SELECT $2, $1, $3, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    )
    SELECT id FROM inserted
    UNION ALL
    SELECT id FROM existing
    LIMIT 1
    `,
    [SINGLE_BRANCH_NAME, tenantId, SINGLE_BRANCH_CODE]
  );
  const branchId = keeperResult.rows[0]?.id;

  if (!branchId) {
    throw new Error("Unable to resolve the single system branch");
  }

  await clientOrPool.query(
    `
    UPDATE branches
    SET attendance_public_code = COALESCE(NULLIF(TRIM(attendance_public_code), ''), 'b' || id)
    WHERE attendance_public_code IS NULL
       OR TRIM(attendance_public_code) = ''
    `
  );
  await safeOptionalDdl(
    clientOrPool,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_public_code ON branches (attendance_public_code)`,
    "create_branches_attendance_public_code_index"
  );

  await safeRequiredDdl(
    clientOrPool,
    `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'warehouses'
          AND column_name = 'branch_name'
      ) THEN
        UPDATE warehouses
        SET branch_name = '${SINGLE_BRANCH_NAME.replaceAll("'", "''")}'
        WHERE branch_name IS DISTINCT FROM '${SINGLE_BRANCH_NAME.replaceAll("'", "''")}';
      END IF;
    END $$;
  `,
    "sync_warehouse_branch_name"
  );

  await clientOrPool.query(
    `
    UPDATE branches
    SET
      tenant_id = $2,
      name = $3,
      code = COALESCE(NULLIF(code, ''), $4),
      is_active = TRUE,
      updated_at = NOW()
    WHERE id = $1
    `,
    [branchId, tenantId, SINGLE_BRANCH_NAME, SINGLE_BRANCH_CODE]
  );

  const branchTables = await getBranchIdTables(clientOrPool);
  await reconcileMoneyAccountUniqueness(clientOrPool, { branchId });
  for (const { table_schema: schema, table_name: table } of branchTables) {
    await clientOrPool.query(
      `UPDATE ${q(schema)}.${q(table)} SET branch_id = $1 WHERE branch_id IS DISTINCT FROM $1`,
      [branchId]
    );
  }

  await clientOrPool.query(`DELETE FROM branches WHERE id <> $1`, [branchId]);
  await safeOptionalDdl(
    clientOrPool,
    `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_single_system_branch
    ON branches ((TRUE))
  `,
    "create_single_system_branch_index"
  );

  await safeRequiredDdl(
    clientOrPool,
    `
    CREATE OR REPLACE FUNCTION enforce_single_system_branch_id()
    RETURNS trigger AS $$
    DECLARE
      keeper_id BIGINT;
    BEGIN
      SELECT id INTO keeper_id
      FROM branches
      WHERE name = '${SINGLE_BRANCH_NAME.replaceAll("'", "''")}'
      ORDER BY id ASC
      LIMIT 1;

      IF keeper_id IS NOT NULL AND NEW.branch_id IS DISTINCT FROM keeper_id THEN
        NEW.branch_id := keeper_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `,
    "create_enforce_single_system_branch_id_function"
  );

  for (const { table_schema: schema, table_name: table } of branchTables) {
    const triggerName = `trg_single_branch_${table}`.slice(0, 63);
    await safeOptionalDdl(
      clientOrPool,
      `DROP TRIGGER IF EXISTS ${q(triggerName)} ON ${q(schema)}.${q(table)}`,
      table === "employees" ? "drop_single_branch_employees_trigger" : `drop_single_branch_${table}_trigger`
    );
    try {
      await safeOptionalDdl(
        clientOrPool,
        `
        CREATE TRIGGER ${q(triggerName)}
        BEFORE INSERT OR UPDATE OF branch_id ON ${q(schema)}.${q(table)}
        FOR EACH ROW
        EXECUTE FUNCTION enforce_single_system_branch_id()
      `,
        `create_single_branch_trigger_${schema}.${table}`
      );
    } catch (error) {
      if (error?.code !== "42710") throw error;
    }
  }

  return {
    branchId,
    branchName: SINGLE_BRANCH_NAME,
    branchTables: branchTables.map((row) => `${row.table_schema}.${row.table_name}`),
  };
};

export const ensureSingleBranchMode = async (clientOrPool = db) => {
  if (singleBranchEnsured) return singleBranchResult;
  warnRuntimeSingleBranchSchemaExecution();
  if (!singleBranchReadyPromise) {
    singleBranchReadyPromise = ensureSingleBranchModeNow(clientOrPool)
      .then((result) => {
        singleBranchEnsured = true;
        singleBranchResult = result;
        return result;
      })
      .catch((error) => {
        singleBranchReadyPromise = null;
        throw error;
      });
  }

  return singleBranchReadyPromise;
};

export const ensureSingleBranchModeOnce = async () => ensureSingleBranchMode();

export default ensureSingleBranchModeOnce;
