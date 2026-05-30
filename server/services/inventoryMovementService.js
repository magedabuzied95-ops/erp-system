import db from "../database/db.js";
import { ensureSingleBranchMode } from "../utils/singleBranchMode.js";

let schemaReadyPromise = null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const queryable = (clientOrPool = db) => clientOrPool || db;
const isTransactionClient = (clientOrPool) => typeof clientOrPool?.release === "function";

const tableColumns = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const runSchema = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      product_id BIGINT NULL,
      variant_id BIGINT NULL,
      branch_id BIGINT NULL,
      warehouse_id BIGINT NULL,
      section_id BIGINT NULL,
      movement_type VARCHAR(50) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      before_qty INTEGER NOT NULL DEFAULT 0,
      after_qty INTEGER NOT NULL DEFAULT 0,
      quantity_before INTEGER NOT NULL DEFAULT 0,
      quantity_change INTEGER NOT NULL DEFAULT 0,
      quantity_after INTEGER NOT NULL DEFAULT 0,
      unit_cost NUMERIC(12,2) NULL,
      total_cost NUMERIC(12,2) NULL,
      reference_type VARCHAR(100),
      reference_id BIGINT,
      reason TEXT,
      notes TEXT,
      note TEXT,
      undone_at TIMESTAMP NULL,
      undone_by BIGINT NULL,
      created_by BIGINT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ALTER COLUMN tenant_id DROP NOT NULL`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS product_id BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS variant_id BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS warehouse_id BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS section_id BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS movement_type VARCHAR(50)`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS before_qty INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS after_qty INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity_before INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity_change INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity_after INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2)`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2)`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS reference_type VARCHAR(100)`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS reference_id BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS reason TEXT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS notes TEXT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS note TEXT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS undone_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS undone_by BIGINT NULL`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS created_by BIGINT`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`
    DO $$
    DECLARE
      branch_constraint TEXT;
    BEGIN
      SELECT pg_get_constraintdef(c.oid)
      INTO branch_constraint
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'inventory_movements'
        AND c.conname = 'inventory_movements_branch_id_fkey'
      LIMIT 1;

      IF branch_constraint IS NOT NULL AND branch_constraint LIKE '%REFERENCES warehouses%' THEN
        ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_branch_id_fkey;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'branches'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'inventory_movements'
          AND c.conname = 'inventory_movements_branch_id_fkey'
      ) THEN
        ALTER TABLE inventory_movements
          ADD CONSTRAINT inventory_movements_branch_id_fkey
          FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL NOT VALID;
      END IF;
    END $$;
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements (product_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant_id ON inventory_movements (variant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_id ON inventory_movements (branch_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse_id ON inventory_movements (warehouse_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_section_id ON inventory_movements (section_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_movement_type ON inventory_movements (movement_type)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements (created_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_created ON inventory_movements (tenant_id, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_product_created ON inventory_movements (tenant_id, product_id, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_variant_created ON inventory_movements (tenant_id, variant_id, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_type_created ON inventory_movements (tenant_id, movement_type, created_at DESC, id DESC)`);
  await ensureSingleBranchMode(client);
};

export const ensureInventoryMovementSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await runSchema(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        schemaReadyPromise = null;
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  return schemaReadyPromise;
};

export const recordInventoryMovement = async (clientOrPool, data = {}) => {
  if (!isTransactionClient(clientOrPool)) {
    await ensureInventoryMovementSchema();
  }

  const dbClient = queryable(clientOrPool);
  const columns = await tableColumns(dbClient, "inventory_movements");
  const quantityBefore = toNumber(data.quantityBefore ?? data.quantity_before, 0);
  const quantityChange = toNumber(data.quantityChange ?? data.quantity_change, 0);
  const quantityAfter = toNumber(data.quantityAfter ?? data.quantity_after, quantityBefore + quantityChange);
  const reason = String(data.reason ?? "").trim();
  const notes = String(data.notes ?? data.note ?? "").trim();

  const values = {
    tenant_id: data.tenantId ?? data.tenant_id ?? null,
    product_id: data.productId ?? data.product_id ?? null,
    variant_id: data.variantId ?? data.variant_id ?? null,
    branch_id: data.branchId ?? data.branch_id ?? null,
    warehouse_id: data.warehouseId ?? data.warehouse_id ?? null,
    section_id: data.sectionId ?? data.section_id ?? null,
    movement_type: data.movementType ?? data.movement_type ?? "manual_adjustment",
    quantity: quantityChange,
    before_qty: quantityBefore,
    after_qty: quantityAfter,
    quantity_before: quantityBefore,
    quantity_change: quantityChange,
    quantity_after: quantityAfter,
    unit_cost: data.unitCost ?? data.unit_cost ?? null,
    total_cost: data.totalCost ?? data.total_cost ?? null,
    reference_type: data.referenceType ?? data.reference_type ?? null,
    reference_id: data.referenceId ?? data.reference_id ?? null,
    reason,
    notes,
    note: notes,
    created_by: data.createdBy ?? data.created_by ?? null,
  };
  if (columns.has("tenant_id") && !values.tenant_id) {
    throw Object.assign(new Error("Tenant context missing"), { status: 400, code: "TENANT_CONTEXT_MISSING" });
  }
  const entries = Object.entries(values).filter(([column]) => columns.has(column));
  const columnSql = entries.map(([column]) => column).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const params = entries.map(([, value]) => value);
  const query = `INSERT INTO inventory_movements (${columnSql}, created_at) VALUES (${placeholders}, NOW()) RETURNING *`;
  let result;
  try {
    result = await dbClient.query(query, params);
  } catch (error) {
    error.checkoutDbContext = {
      ...(error.checkoutDbContext || {}),
      step: "create inventory movement",
      table: "inventory_movements",
      operation: "insert inventory movement",
      query,
    };
    throw error;
  }

  return result.rows[0] || null;
};

export const getInventoryMovements = async (clientOrPool, data = {}) => {
  await ensureInventoryMovementSchema();

  const dbClient = queryable(clientOrPool);
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const variantId = data.variantId ?? data.variant_id ?? null;
  const productId = data.productId ?? data.product_id ?? null;
  const movementType = String(data.movementType ?? data.movement_type ?? "").trim();
  const search = String(data.search ?? "").trim();
  const dateFrom = data.dateFrom ?? data.date_from ?? null;
  const dateTo = data.dateTo ?? data.date_to ?? null;
  const limit = Math.min(Math.max(toNumber(data.limit ?? 100, 100), 1), 500);
  const page = Math.max(toNumber(data.page ?? 1, 1), 1);
  const offset = data.offset !== undefined && data.offset !== null
    ? Math.max(toNumber(data.offset, 0), 0)
    : (page - 1) * limit;

  const clauses = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (tenantId !== null && tenantId !== undefined) clauses.push(`m.tenant_id = ${push(tenantId)}`);
  if (variantId) clauses.push(`m.variant_id = ${push(variantId)}`);
  if (productId) clauses.push(`m.product_id = ${push(productId)}`);
  if (movementType) clauses.push(`m.movement_type = ${push(movementType)}`);
  if (dateFrom) clauses.push(`DATE(m.created_at) >= ${push(dateFrom)}`);
  if (dateTo) clauses.push(`DATE(m.created_at) <= ${push(dateTo)}`);
  if (search) {
    clauses.push(
      `(
        COALESCE(p.name, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(v.color, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(v.size, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(m.movement_type, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(m.reference_type, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(m.reason, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(m.notes, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(u.name, '') ILIKE ${push(`%${search}%`)}
      )`
    );
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [countResult, rowsResult] = await Promise.all([
    dbClient.query(
      `
      SELECT COUNT(*)::int AS count
      FROM inventory_movements m
      LEFT JOIN products p ON p.id = m.product_id
      LEFT JOIN product_variants v ON v.id = m.variant_id
      LEFT JOIN users u ON u.id = m.created_by
      ${whereClause}
      `,
      params
    ),
    dbClient.query(
      `
      SELECT
        m.*,
        p.name AS product_name,
        p.brand AS product_brand,
        v.color AS variant_color,
        v.size AS variant_size,
        v.sku AS variant_sku,
        v.image_url AS variant_image_url,
        u.name AS created_by_name
      FROM inventory_movements m
      LEFT JOIN products p ON p.id = m.product_id
      LEFT JOIN product_variants v ON v.id = m.variant_id
      LEFT JOIN users u ON u.id = m.created_by
      ${whereClause}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    ),
  ]);

  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.count || 0),
    limit,
    offset,
    page,
    totalPages: Math.ceil(Number(countResult.rows[0]?.count || 0) / limit),
  };
};
