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

const normalizeMovementType = (value, fallback = "ADJUSTMENT") => {
  const text = String(value ?? fallback).trim();
  return text ? text.toUpperCase() : fallback;
};

const buildMovementPayload = (data = {}, { quantityBefore, quantityChange, quantityAfter }) => {
  const reason = String(data.reason ?? "").trim();
  const notes = String(data.notes ?? data.note ?? "").trim();

  return {
    tenant_id: data.tenantId ?? data.tenant_id ?? null,
    product_id: data.productId ?? data.product_id ?? null,
    variant_id: data.variantId ?? data.variant_id ?? null,
    branch_id: data.branchId ?? data.branch_id ?? null,
    warehouse_id: data.warehouseId ?? data.warehouse_id ?? null,
    movement_type: normalizeMovementType(data.movementType ?? data.movement_type),
    quantity: quantityChange,
    before_qty: quantityBefore,
    after_qty: quantityAfter,
    quantity_before: quantityBefore,
    quantity_delta: quantityChange,
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
};

const maybeBackfillOpeningBalances = async (client) => {
  const movementsCount = await client.query(`SELECT COUNT(*)::int AS count FROM inventory_movements`);
  if (Number(movementsCount.rows[0]?.count || 0) > 0) return;

  await client.query(
    `
    INSERT INTO inventory_movements (
      tenant_id,
      product_id,
      variant_id,
      warehouse_id,
      branch_id,
      movement_type,
      quantity,
      quantity_before,
      quantity_delta,
      quantity_change,
      quantity_after,
      reference_type,
      reference_id,
      reason,
      notes,
      created_by,
      created_at
    )
    SELECT
      v.tenant_id,
      v.product_id,
      v.id,
      NULL::bigint,
      NULL::bigint,
      'OPENING_BALANCE',
      COALESCE(v.stock, 0)::int,
      0,
      COALESCE(v.stock, 0)::int,
      COALESCE(v.stock, 0)::int,
      COALESCE(v.stock, 0)::int,
      'opening_balance',
      v.id,
      'رصيد افتتاحي',
      'Backfilled from existing product variant stock',
      NULL,
      NOW()
    FROM product_variants v
    WHERE COALESCE(v.stock, 0) > 0
    `
  );
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
      quantity_before INTEGER NOT NULL DEFAULT 0,
      quantity_delta INTEGER NOT NULL DEFAULT 0,
      quantity_change INTEGER NOT NULL DEFAULT 0,
      quantity_after INTEGER NOT NULL DEFAULT 0,
      before_qty INTEGER NOT NULL DEFAULT 0,
      after_qty INTEGER NOT NULL DEFAULT 0,
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
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity_before INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity_delta INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity_change INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantity_after INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS before_qty INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS after_qty INTEGER NOT NULL DEFAULT 0`);
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
  await maybeBackfillOpeningBalances(client);
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
  const quantityDelta = toNumber(data.quantityDelta ?? data.quantity_delta ?? data.quantityChange ?? data.quantity_change, 0);
  const hasExplicitQuantities =
    data.quantityBefore !== undefined ||
    data.quantity_before !== undefined ||
    data.quantityAfter !== undefined ||
    data.quantity_after !== undefined;

  let quantityBefore = toNumber(data.quantityBefore ?? data.quantity_before, 0);
  let quantityAfter = toNumber(data.quantityAfter ?? data.quantity_after, quantityBefore + quantityDelta);
  let movementVariant = null;
  let movementProductId = data.productId ?? data.product_id ?? null;

  if (data.variantId ?? data.variant_id) {
    movementProductId = data.productId ?? data.product_id ?? movementProductId;
  }

  if (!hasExplicitQuantities && (data.variantId ?? data.variant_id) !== undefined && (data.variantId ?? data.variant_id) !== null && Number.isFinite(quantityDelta)) {
    const tenantId = data.tenantId ?? data.tenant_id ?? null;
    const variantId = data.variantId ?? data.variant_id;
    const variantColumns = await tableColumns(dbClient, "product_variants");
    const tenantClause = variantColumns.has("tenant_id")
      ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)"
      : "";
    const activeClause = variantColumns.has("is_active") && variantColumns.has("deleted_at")
      ? "AND is_active IS DISTINCT FROM FALSE AND deleted_at IS NULL"
      : "";
    const updateTimestamp = variantColumns.has("updated_at") ? ", updated_at = NOW()" : "";

    const variantResult = await dbClient.query(
      `
      SELECT id, product_id, stock, ${variantColumns.has("cost_price") ? "cost_price" : "0 AS cost_price"}
      FROM product_variants
      WHERE id = $1
        ${tenantClause}
        ${activeClause}
      FOR UPDATE
      `,
      [variantId, tenantId]
    );

    const variant = variantResult.rows[0];
    if (!variant) {
      const error = new Error("Variant not found");
      error.status = 404;
      throw error;
    }

    quantityBefore = toNumber(variant.stock, 0);
    quantityAfter = quantityBefore + quantityDelta;
    if (quantityAfter < 0) {
      const error = new Error("Not enough stock");
      error.status = 400;
      throw error;
    }

    await dbClient.query(
      `
      UPDATE product_variants
      SET stock = $1
          ${updateTimestamp}
      WHERE id = $2
        ${tenantClause ? "AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)" : ""}
      `,
      tenantClause
        ? [quantityAfter, variantId, tenantId]
        : [quantityAfter, variantId]
    );

    movementVariant = {
      ...variant,
      stock: quantityAfter,
    };
    movementProductId = movementProductId ?? variant.product_id;
  }

  const values = buildMovementPayload(data, {
    quantityBefore,
    quantityChange: quantityDelta,
    quantityAfter,
  });

  if (!values.tenant_id && !columns.has("tenant_id")) {
    values.tenant_id = null;
  }

  if (movementProductId !== null && movementProductId !== undefined) {
    values.product_id = movementProductId;
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

  const movement = result.rows[0] || null;
  return movement
    ? {
        ...movement,
        quantity_before: toNumber(movement.quantity_before ?? movement.before_qty, quantityBefore),
        quantity_delta: toNumber(movement.quantity_delta ?? movement.quantity_change, quantityDelta),
        quantity_change: toNumber(movement.quantity_change ?? movement.quantity_delta, quantityDelta),
        quantity_after: toNumber(movement.quantity_after ?? movement.after_qty, quantityAfter),
        quantityBefore: toNumber(movement.quantity_before ?? movement.before_qty, quantityBefore),
        quantityChange: toNumber(movement.quantity_change ?? movement.quantity_delta, quantityDelta),
        quantityAfter: toNumber(movement.quantity_after ?? movement.after_qty, quantityAfter),
        variant: movementVariant,
        productId: movementProductId,
      }
    : null;
};

export const getInventoryMovements = async (clientOrPool, data = {}) => {
  await ensureInventoryMovementSchema();

  const dbClient = queryable(clientOrPool);
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const variantId = data.variantId ?? data.variant_id ?? null;
  const productId = data.productId ?? data.product_id ?? null;
  const branchId = data.branchId ?? data.branch_id ?? null;
  const warehouseId = data.warehouseId ?? data.warehouse_id ?? null;
  const movementType = String(data.movementType ?? data.movement_type ?? "").trim();
  const search = String(data.search ?? "").trim();
  const category = String(data.category ?? data.category_name ?? data.categoryName ?? "").trim();
  const grade = String(data.grade ?? data.product_grade ?? data.productGrade ?? "").trim();
  const manufacturer = String(data.manufacturer ?? data.manufacturer_name ?? data.manufacturerName ?? "").trim();
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
  const searchParam = search ? push(`%${search}%`) : null;

  if (tenantId !== null && tenantId !== undefined) clauses.push(`m.tenant_id = ${push(tenantId)}`);
  if (variantId) clauses.push(`m.variant_id = ${push(variantId)}`);
  if (productId) clauses.push(`m.product_id = ${push(productId)}`);
  if (branchId) clauses.push(`m.branch_id = ${push(branchId)}`);
  if (warehouseId) clauses.push(`m.warehouse_id = ${push(warehouseId)}`);
  if (movementType) clauses.push(`UPPER(m.movement_type) = UPPER(${push(movementType)})`);
  if (category) clauses.push(`LOWER(TRIM(COALESCE(c.name, ''))) = LOWER(TRIM(${push(category)}))`);
  if (grade) clauses.push(`LOWER(TRIM(COALESCE(p.grade, ''))) = LOWER(TRIM(${push(grade)}))`);
  if (manufacturer) clauses.push(`LOWER(TRIM(COALESCE(pm.name, vm.name, ''))) = LOWER(TRIM(${push(manufacturer)}))`);
  if (dateFrom) clauses.push(`m.created_at::date >= ${push(dateFrom)}`);
  if (dateTo) clauses.push(`m.created_at::date <= ${push(dateTo)}`);
  if (search) {
    clauses.push(
      `(
        COALESCE(p.name, '') ILIKE ${searchParam} OR
        COALESCE(p.product_code, '') ILIKE ${searchParam} OR
        COALESCE(p.sku, '') ILIKE ${searchParam} OR
        COALESCE(p.barcode, '') ILIKE ${searchParam} OR
        COALESCE(p.grade, '') ILIKE ${searchParam} OR
        COALESCE(c.name, '') ILIKE ${searchParam} OR
        COALESCE(pm.name, vm.name, '') ILIKE ${searchParam} OR
        COALESCE(v.color, '') ILIKE ${searchParam} OR
        COALESCE(v.size, '') ILIKE ${searchParam} OR
        COALESCE(v.sku, '') ILIKE ${searchParam} OR
        COALESCE(v.barcode, '') ILIKE ${searchParam} OR
        COALESCE(v.article_code, '') ILIKE ${searchParam} OR
        COALESCE(m.movement_type, '') ILIKE ${searchParam} OR
        COALESCE(m.reference_type, '') ILIKE ${searchParam} OR
        COALESCE(m.reason, '') ILIKE ${searchParam} OR
        COALESCE(m.notes, '') ILIKE ${searchParam} OR
        COALESCE(u.name, '') ILIKE ${searchParam} OR
        COALESCE(w.name, '') ILIKE ${searchParam} OR
        COALESCE(b.name, '') ILIKE ${searchParam}
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
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN manufacturers pm ON pm.id = p.manufacturer_id
      LEFT JOIN manufacturers vm ON vm.id = v.manufacturer_id
      LEFT JOIN warehouses w ON w.id = m.warehouse_id
      LEFT JOIN branches b ON b.id = m.branch_id
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
        p.product_code AS product_code,
        p.grade AS product_grade,
        COALESCE(c.name, '') AS category_name,
        COALESCE(pm.name, vm.name, '') AS manufacturer_name,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(v.image_url, ''), '') AS product_image_url,
        COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), '') AS variant_image_url,
        COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), '') AS color_image_url,
        COALESCE(v.article_code, '') AS variant_article_code,
        COALESCE(v.color, '') AS color,
        COALESCE(v.size, '') AS size,
        COALESCE(v.sku, '') AS sku,
        COALESCE(v.barcode, '') AS barcode,
        COALESCE(w.name, '') AS warehouse_name,
        COALESCE(b.name, '') AS branch_name,
        COALESCE(u.name, u.email, '') AS created_by_name
      FROM inventory_movements m
      LEFT JOIN products p ON p.id = m.product_id
      LEFT JOIN product_variants v ON v.id = m.variant_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN manufacturers pm ON pm.id = p.manufacturer_id
      LEFT JOIN manufacturers vm ON vm.id = v.manufacturer_id
      LEFT JOIN warehouses w ON w.id = m.warehouse_id
      LEFT JOIN branches b ON b.id = m.branch_id
      LEFT JOIN users u ON u.id = m.created_by
      ${whereClause}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    ),
  ]);

  const rows = rowsResult.rows.map((row) => ({
    ...row,
    quantity_before: toNumber(row.quantity_before ?? row.before_qty ?? 0),
    quantity_delta: toNumber(row.quantity_delta ?? row.quantity_change ?? row.quantity ?? 0),
    quantity_change: toNumber(row.quantity_change ?? row.quantity_delta ?? row.quantity ?? 0),
    quantity_after: toNumber(row.quantity_after ?? row.after_qty ?? 0),
    quantityBefore: toNumber(row.quantity_before ?? row.before_qty ?? 0),
    quantityChange: toNumber(row.quantity_change ?? row.quantity_delta ?? row.quantity ?? 0),
    quantityAfter: toNumber(row.quantity_after ?? row.after_qty ?? 0),
  }));

  return {
    rows,
    total: Number(countResult.rows[0]?.count || 0),
    limit,
    offset,
    page,
    totalPages: Math.ceil(Number(countResult.rows[0]?.count || 0) / limit),
  };
};
