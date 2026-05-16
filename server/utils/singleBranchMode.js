import db from "../database/db.js";

export const SINGLE_BRANCH_NAME = "فرع البشبيشي";
export const SINGLE_BRANCH_CODE = "BESHBISHI";

let singleBranchReadyPromise = null;

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

const getBranchIdTables = async (clientOrPool) => {
  const result = await clientOrPool.query(
    `
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = 'branch_id'
      AND table_name <> 'branches'
    ORDER BY table_name
    `
  );

  return result.rows;
};

export const ensureSingleBranchMode = async (clientOrPool = db) => {
  await clientOrPool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(120) NOT NULL UNIQUE,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      plan VARCHAR(50) NOT NULL DEFAULT 'trial',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    INSERT INTO tenants (name, slug, status, plan)
    SELECT 'Default Company', 'default-company', 'active', 'trial'
    WHERE NOT EXISTS (SELECT 1 FROM tenants)
    ON CONFLICT (slug) DO NOTHING
  `);

  const tenantResult = await clientOrPool.query(`
    SELECT id
    FROM tenants
    ORDER BY CASE WHEN slug = 'default-company' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `);
  const tenantId = tenantResult.rows[0]?.id || 1;

  await clientOrPool.query(`
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
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);

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

  await clientOrPool.query(`
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
  `);

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
  for (const { table_schema: schema, table_name: table } of branchTables) {
    await clientOrPool.query(
      `UPDATE ${q(schema)}.${q(table)} SET branch_id = $1 WHERE branch_id IS DISTINCT FROM $1`,
      [branchId]
    );
  }

  await clientOrPool.query(`DELETE FROM branches WHERE id <> $1`, [branchId]);
  await clientOrPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_single_system_branch
    ON branches ((TRUE))
  `);

  await clientOrPool.query(`
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
  `);

  for (const { table_schema: schema, table_name: table } of branchTables) {
    const triggerName = `trg_single_branch_${table}`.slice(0, 63);
    await clientOrPool.query(`DROP TRIGGER IF EXISTS ${q(triggerName)} ON ${q(schema)}.${q(table)}`);
    await clientOrPool.query(`
      CREATE TRIGGER ${q(triggerName)}
      BEFORE INSERT OR UPDATE OF branch_id ON ${q(schema)}.${q(table)}
      FOR EACH ROW
      EXECUTE FUNCTION enforce_single_system_branch_id()
    `);
  }

  return {
    branchId,
    branchName: SINGLE_BRANCH_NAME,
    branchTables: branchTables.map((row) => `${row.table_schema}.${row.table_name}`),
  };
};

export const ensureSingleBranchModeOnce = async () => {
  if (!singleBranchReadyPromise) {
    singleBranchReadyPromise = ensureSingleBranchMode().catch((error) => {
      singleBranchReadyPromise = null;
      throw error;
    });
  }

  return singleBranchReadyPromise;
};

export default ensureSingleBranchModeOnce;
