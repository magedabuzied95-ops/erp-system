import db from "../database/db.js";
import { getTenantId, isSuperAdminUser, tenantContextMissingResponse } from "../utils/requestScope.js";
import { ensureInventoryMovementSchema, recordInventoryMovement } from "../services/inventoryMovementService.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { SINGLE_BRANCH_NAME, ensureSingleBranchMode } from "../utils/singleBranchMode.js";

const ensureWarehouseSchema = async () => {
  await db.query("ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS tenant_id BIGINT");
  await db.query("ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS code VARCHAR(50)");
  await db.query("ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255)");
  await db.query("ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS location TEXT");
  await db.query("ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active'");
  await db.query("ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS qr_token TEXT");
  await ensureSingleBranchMode(db);
};

const normalizeName = (value = "") => String(value || "").trim().replace(/\s+/g, " ");

const tableExists = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists
    `,
    [tableName]
  );
  return Boolean(result.rows[0]?.exists);
};

const tableColumns = async (client, tableName) => {
  if (!(await tableExists(client, tableName))) return new Set();
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const usageDefaults = (warehouse = {}) => ({
  ...warehouse,
  products_count: 0,
  stock_qty: 0,
  stock_quantity: 0,
  transfers_count: 0,
  transfer_references: 0,
  active_transfers_count: 0,
  active_transfer_references: 0,
  default_references: 0,
  duplicate_name_count: 1,
  is_protected: false,
  can_delete: true,
});

const tenantClause = ({ columns, alias = "", tenantId, params, includeNull = false }) => {
  if (tenantId === null || !columns.has("tenant_id")) return "";
  params.push(tenantId);
  const prefix = alias ? `${alias}.` : "";
  const operator = includeNull ? `(${prefix}tenant_id = $${params.length} OR ${prefix}tenant_id IS NULL)` : `${prefix}tenant_id = $${params.length}`;
  return ` AND ${operator}`;
};

const formatWarehouseRow = (warehouse = {}, usage = {}) => {
  const productsCount = Number(usage.products_count || 0);
  const stockQty = Number(usage.stock_qty ?? usage.stock_quantity ?? 0);
  const transfersCount = Number(usage.transfers_count ?? usage.transfer_references ?? 0);
  const activeTransfersCount = Number(usage.active_transfers_count ?? usage.active_transfer_references ?? 0);
  const defaultReferences = Number(usage.default_references || 0);
  const isProtected = Boolean(usage.is_protected || defaultReferences > 0);
  const canDelete = !isProtected && productsCount === 0 && stockQty === 0 && activeTransfersCount === 0;

  return {
    ...warehouse,
    branch_name: warehouse.branch_name || warehouse.branch || "",
    location: warehouse.location || "",
    status: warehouse.status || "active",
    products_count: productsCount,
    stock_qty: stockQty,
    stock_quantity: stockQty,
    transfers_count: transfersCount,
    transfer_references: transfersCount,
    active_transfers_count: activeTransfersCount,
    active_transfer_references: activeTransfersCount,
    default_references: defaultReferences,
    can_delete: canDelete,
    is_protected: isProtected,
  };
};

const computeWarehouseUsage = async (client, warehouse, tenantId) => {
  const usage = usageDefaults(warehouse);
  const warehouseId = Number(warehouse?.id);
  if (!Number.isFinite(warehouseId)) return usage;

  const warehouseColumns = await tableColumns(client, "warehouses");
  usage.is_protected =
    (warehouseColumns.has("is_system") && Boolean(warehouse.is_system)) ||
    (warehouseColumns.has("is_default") && Boolean(warehouse.is_default));

  try {
    const inventoryColumns = await tableColumns(client, "warehouse_inventory");
    if (inventoryColumns.has("warehouse_id")) {
      const params = [warehouseId];
      const stockColumn = inventoryColumns.has("stock") ? "stock" : inventoryColumns.has("quantity") ? "quantity" : null;
      const productColumn = inventoryColumns.has("variant_id") ? "variant_id" : inventoryColumns.has("product_id") ? "product_id" : null;
      const tenantSql = tenantClause({ columns: inventoryColumns, tenantId, params });
      const productsExpr = productColumn
        ? `COUNT(DISTINCT ${productColumn}) FILTER (WHERE ${stockColumn ? `COALESCE(${stockColumn}, 0) > 0` : "TRUE"})`
        : `COUNT(*) FILTER (WHERE ${stockColumn ? `COALESCE(${stockColumn}, 0) > 0` : "TRUE"})`;
      const stockExpr = stockColumn ? `COALESCE(SUM(GREATEST(COALESCE(${stockColumn}, 0), 0)), 0)` : "0";
      const result = await client.query(
        `
        SELECT
          ${productsExpr}::int AS products_count,
          ${stockExpr}::int AS stock_qty
        FROM warehouse_inventory
        WHERE warehouse_id = $1
          ${tenantSql}
        `,
        params
      );
      usage.products_count = Number(result.rows[0]?.products_count || 0);
      usage.stock_qty = Number(result.rows[0]?.stock_qty || 0);
      usage.stock_quantity = usage.stock_qty;
    }
  } catch (error) {
    console.warn("[warehouses:list] usage inventory fallback", { warehouseId, error: error.message });
  }

  try {
    const transferColumns = await tableColumns(client, "stock_transfers");
    if (transferColumns.has("from_warehouse") || transferColumns.has("to_warehouse")) {
      const params = [warehouseId];
      const tenantSql = tenantClause({ columns: transferColumns, tenantId, params });
      const fromSelect = transferColumns.has("from_warehouse")
        ? `SELECT ${transferColumns.has("status") ? "status" : "NULL::text AS status"}, ${transferColumns.has("tenant_id") ? "tenant_id" : "NULL::bigint AS tenant_id"} FROM stock_transfers WHERE from_warehouse = $1`
        : "";
      const toSelect = transferColumns.has("to_warehouse")
        ? `SELECT ${transferColumns.has("status") ? "status" : "NULL::text AS status"}, ${transferColumns.has("tenant_id") ? "tenant_id" : "NULL::bigint AS tenant_id"} FROM stock_transfers WHERE to_warehouse = $1`
        : "";
      const unionSql = [fromSelect, toSelect].filter(Boolean).join(" UNION ALL ");
      const activeExpr = transferColumns.has("status")
        ? "COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'completed')) IN ('pending', 'draft', 'in_transit'))"
        : "COUNT(*)";
      const result = await client.query(
        `
        SELECT
          COUNT(*)::int AS transfers_count,
          ${activeExpr}::int AS active_transfers_count
        FROM (${unionSql}) st
        WHERE 1 = 1
          ${tenantSql}
        `,
        params
      );
      usage.transfers_count = Number(result.rows[0]?.transfers_count || 0);
      usage.transfer_references = usage.transfers_count;
      usage.active_transfers_count = Number(result.rows[0]?.active_transfers_count || 0);
      usage.active_transfer_references = usage.active_transfers_count;
    }
  } catch (error) {
    console.warn("[warehouses:list] usage transfers fallback", { warehouseId, error: error.message });
  }

  try {
    const branchColumns = await tableColumns(client, "branches");
    if (branchColumns.has("default_warehouse_id")) {
      const params = [warehouseId];
      const tenantSql = tenantClause({ columns: branchColumns, tenantId, params });
      const result = await client.query(
        `
        SELECT COUNT(*)::int AS default_references
        FROM branches
        WHERE default_warehouse_id = $1
          ${tenantSql}
        `,
        params
      );
      usage.default_references = Number(result.rows[0]?.default_references || 0);
      usage.is_protected = usage.is_protected || usage.default_references > 0;
    }
  } catch (error) {
    console.warn("[warehouses:list] usage defaults fallback", { warehouseId, error: error.message });
  }

  usage.can_delete =
    !usage.is_protected &&
    Number(usage.products_count || 0) === 0 &&
    Number(usage.stock_qty || 0) === 0 &&
    Number(usage.active_transfers_count || 0) === 0;

  return usage;
};

const getWarehouseUsage = async (client, warehouseId, tenantId) => {
  const params = [warehouseId];
  const warehouseColumns = await tableColumns(client, "warehouses");
  const tenantSql = tenantClause({ columns: warehouseColumns, alias: "w", tenantId, params, includeNull: true });
  const result = await client.query(
    `
    SELECT w.*
    FROM warehouses w
    WHERE w.id = $1
      ${tenantSql}
    LIMIT 1
    `,
    params
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  const usage = await computeWarehouseUsage(client, row, tenantId);
  return formatWarehouseRow(row, usage);
};

const uniqueWarehouseName = async (tenantId, requestedName) => {
  const baseName = normalizeName(requestedName);
  const existing = await db.query(
    `
    SELECT name
    FROM warehouses
    WHERE (
        LOWER(TRIM(name)) = LOWER(TRIM($1))
        OR LOWER(TRIM(name)) LIKE LOWER(TRIM($1) || ' (%)')
      )
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    `,
    [baseName, tenantId]
  );
  if (!existing.rows.length) return baseName;

  const existingNames = new Set(existing.rows.map((row) => normalizeName(row.name).toLowerCase()));
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName} (${index})`;
    if (!existingNames.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseName} (${Date.now()})`;
};

export const getWarehouses = async (req, res) => {
  try {
    await ensureWarehouseSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const warehouseColumns = await tableColumns(db, "warehouses");
    const params = [];
    const tenantSql = tenantClause({ columns: warehouseColumns, alias: "w", tenantId, params, includeNull: true });
    const loadWarehouses = () =>
      db.query(
        `
        SELECT w.*
        FROM warehouses w
        WHERE 1 = 1
          ${tenantSql}
        ORDER BY w.id DESC
        `,
        params
      );
    let result = await loadWarehouses();

    if (tenantId !== null && result.rows.length === 0) {
      await db.query(
        `
        INSERT INTO warehouses (tenant_id, name, code, branch_name, location, qr_token, status)
        VALUES ($1, 'Main Warehouse', 'MAIN', $2, '', $3, 'active')
        ON CONFLICT DO NOTHING
        `,
        [tenantId, SINGLE_BRANCH_NAME, `main-warehouse-${tenantId}-${Date.now()}`]
      );
      result = await loadWarehouses();
    }

    const rows = await Promise.all(
      (Array.isArray(result.rows) ? result.rows : []).map(async (warehouse) => {
        try {
          const usage = await computeWarehouseUsage(db, warehouse, tenantId);
          return formatWarehouseRow(warehouse, usage);
        } catch (usageError) {
          console.warn("[warehouses:list] usage row fallback", { warehouseId: warehouse?.id, error: usageError.message });
          return formatWarehouseRow(warehouse, usageDefaults(warehouse));
        }
      })
    );
    res.status(200).json({ success: true, data: rows, warehouses: rows });
  } catch (error) {
    console.error("[warehouses:list] GET /api/warehouses failed:", error, error.stack);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
      details: process.env.NODE_ENV === "production" ? undefined : error.stack,
    });
  }
};

export const createWarehouse = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    await ensureWarehouseSchema();
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const {
      name,
      location,
      latitude = null,
      longitude = null,
      allowed_radius_meters = 100,
      qr_token = null,
    } = req.body;

    if (!normalizeName(name)) {
      return res.status(400).json({ message: "Warehouse name required" });
    }
    const safeName = await uniqueWarehouseName(tenantId, name);

    const result = await db.query(
      `
      INSERT INTO warehouses (
        tenant_id,
        name,
        branch_name,
        location,
        latitude,
        longitude,
        allowed_radius_meters,
        qr_token
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, gen_random_uuid()::text))
      RETURNING *
      `,
      [
        tenantId,
        safeName,
        SINGLE_BRANCH_NAME,
        location || "",
        latitude,
        longitude,
        Number(allowed_radius_meters || 100),
        qr_token,
      ]
    );

    res.status(201).json({ message: "Warehouse created", warehouse: result.rows[0] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const updateWarehouse = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureWarehouseSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

    await client.query("BEGIN");
    const warehouseId = Number(req.params.id);
    if (!Number.isFinite(warehouseId)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Invalid warehouse id" });
    }

    const current = await getWarehouseUsage(client, warehouseId, tenantId);
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Warehouse not found" });
    }

    const name = normalizeName(req.body?.name);
    const branchName = normalizeName(req.body?.branch_name ?? req.body?.branch ?? current.branch_name ?? current.branch ?? "");
    const location = String(req.body?.location ?? current.location ?? "").trim();
    const status = String(req.body?.status ?? current.status ?? "active").trim().toLowerCase() === "inactive" ? "inactive" : "active";

    if (!name) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Warehouse name required" });
    }

    if (current.is_protected && status !== "active") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Default warehouse cannot be made inactive", details: current });
    }

    const warehouseColumns = await tableColumns(client, "warehouses");
    const duplicateParams = [warehouseId, name, branchName || ""];
    const duplicateTenantSql = tenantClause({ columns: warehouseColumns, tenantId, params: duplicateParams, includeNull: true });
    const duplicate = await client.query(
      `
      SELECT id
      FROM warehouses
      WHERE id <> $1
        AND LOWER(TRIM(name)) = LOWER(TRIM($2))
        AND LOWER(TRIM(COALESCE(branch_name, ''))) = LOWER(TRIM($3))
        ${duplicateTenantSql}
      LIMIT 1
      `,
      duplicateParams
    );

    if (duplicate.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Warehouse name already exists in this branch" });
    }

    const updateParams = [warehouseId];
    const updates = [];
    const addUpdate = (column, value) => {
      if (!warehouseColumns.has(column)) return;
      updateParams.push(value);
      updates.push(`${column} = $${updateParams.length}`);
    };

    addUpdate("name", name);
    addUpdate("location", location);
    addUpdate("branch_name", branchName);
    addUpdate("status", status);
    if (warehouseColumns.has("updated_at")) updates.push("updated_at = NOW()");

    if (!updates.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "No editable warehouse fields available" });
    }

    const updateTenantSql = tenantClause({ columns: warehouseColumns, tenantId, params: updateParams, includeNull: true });
    const updated = await client.query(
      `
      UPDATE warehouses
      SET ${updates.join(", ")}
      WHERE id = $1
        ${updateTenantSql}
      RETURNING *
      `,
      updateParams
    );

    await client.query("COMMIT");
    const usage = await computeWarehouseUsage(db, updated.rows[0], tenantId);
    return res.status(200).json({ success: true, warehouse: formatWarehouseRow(updated.rows[0], usage) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[warehouses] update error:", error, error.stack);
    return res.status(500).json({ success: false, message: "Warehouse could not be updated", error: error.message });
  } finally {
    client.release();
  }
};

export const deleteWarehouse = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureWarehouseSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

    await client.query("BEGIN");
    const warehouseId = Number(req.params.id);
    if (!Number.isFinite(warehouseId)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Invalid warehouse id" });
    }

    const usage = await getWarehouseUsage(client, warehouseId, tenantId);
    if (!usage) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Warehouse not found" });
    }

    if (usage.is_protected) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Default warehouse cannot be deleted", details: usage });
    }

    if (usage.stock_quantity > 0 || usage.products_count > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Warehouse still contains inventory", details: usage });
    }

    if (usage.transfer_references > 0 || usage.active_transfer_references > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Warehouse is used in active transfers", details: usage });
    }

    const inventoryColumns = await tableColumns(client, "warehouse_inventory");
    if (inventoryColumns.has("warehouse_id")) {
      const inventoryParams = [warehouseId];
      const inventoryTenantSql = tenantClause({ columns: inventoryColumns, tenantId, params: inventoryParams });
      const stockColumn = inventoryColumns.has("stock") ? "stock" : inventoryColumns.has("quantity") ? "quantity" : null;
      await client.query(
        `
        DELETE FROM warehouse_inventory
        WHERE warehouse_id = $1
          ${stockColumn ? `AND COALESCE(${stockColumn}, 0) = 0` : ""}
          ${inventoryTenantSql}
        `,
        inventoryParams
      );
    }

    const warehouseColumns = await tableColumns(client, "warehouses");
    const deleteParams = [warehouseId];
    const deleteTenantSql = tenantClause({ columns: warehouseColumns, tenantId, params: deleteParams, includeNull: true });
    const deleted = await client.query(
      `
      DELETE FROM warehouses
      WHERE id = $1
        ${deleteTenantSql}
      RETURNING *
      `,
      deleteParams
    );

    await client.query("COMMIT");
    return res.status(200).json({ success: true, deleted_id: warehouseId, warehouse: deleted.rows[0], details: usage });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[warehouses] delete error:", error, error.stack);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  } finally {
    client.release();
  }
};

export const prepareWarehouseMerge = async (req, res) => {
  try {
    await ensureWarehouseSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const sourceWarehouseId = Number(req.body?.source_warehouse_id ?? req.body?.sourceWarehouseId);
    const targetWarehouseId = Number(req.body?.target_warehouse_id ?? req.body?.targetWarehouseId);

    if (!Number.isFinite(sourceWarehouseId) || !Number.isFinite(targetWarehouseId) || sourceWarehouseId === targetWarehouseId) {
      return res.status(400).json({ success: false, message: "Valid source and target warehouses are required" });
    }

    const source = await getWarehouseUsage(db, sourceWarehouseId, tenantId);
    const target = await getWarehouseUsage(db, targetWarehouseId, tenantId);
    if (!source || !target) {
      return res.status(404).json({ success: false, message: "Source or target warehouse not found" });
    }

    return res.status(200).json({
      success: true,
      merge: {
        source_warehouse_id: sourceWarehouseId,
        target_warehouse_id: targetWarehouseId,
        source,
        target,
        can_move_inventory: source.stock_quantity > 0,
        can_delete_after_merge: !source.is_protected && source.transfer_references === 0,
      },
    });
  } catch (error) {
    console.error("[warehouses] merge prepare error:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

export const transferStock = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureInventoryMovementSchema();
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    await client.query("BEGIN");
    const { variant_id, from_warehouse, to_warehouse, quantity } = req.body;

    if (!variant_id || !from_warehouse || !to_warehouse || !quantity) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Missing required fields" });
    }

    const sourceStock = await client.query(
      `
      SELECT *
      FROM warehouse_inventory
      WHERE warehouse_id = $1
        AND variant_id = $2
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
      `,
      [from_warehouse, variant_id, tenantId]
    );

    if (sourceStock.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Source stock not found" });
    }

    if (sourceStock.rows[0].stock < quantity) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Not enough stock" });
    }

    const quantityValue = Number(quantity || 0);
    const sourceBefore = Number(sourceStock.rows[0].stock || 0);
    const variantResult = await client.query(
      `
      SELECT id, product_id
      FROM product_variants
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [variant_id, tenantId]
    );
    const productId = variantResult.rows[0]?.product_id || null;

    await client.query(
      `
      UPDATE warehouse_inventory
      SET stock = stock - $1
      WHERE warehouse_id = $2
        AND variant_id = $3
        AND ($4::bigint IS NULL OR tenant_id = $4::bigint)
      `,
      [quantity, from_warehouse, variant_id, tenantId]
    );

    const destinationStock = await client.query(
      `
      SELECT *
      FROM warehouse_inventory
      WHERE warehouse_id = $1
        AND variant_id = $2
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
      `,
      [to_warehouse, variant_id, tenantId]
    );

    const destinationBefore = Number(destinationStock.rows[0]?.stock || 0);

    if (destinationStock.rows.length > 0) {
      await client.query(
        `
        UPDATE warehouse_inventory
        SET stock = stock + $1
        WHERE warehouse_id = $2
          AND variant_id = $3
          AND ($4::bigint IS NULL OR tenant_id = $4::bigint)
        `,
        [quantity, to_warehouse, variant_id, tenantId]
      );
    } else {
      await client.query(
        `
        INSERT INTO warehouse_inventory (tenant_id, warehouse_id, variant_id, stock)
        VALUES ($1,$2,$3,$4)
        `,
        [tenantId, to_warehouse, variant_id, quantity]
      );
    }

    const transferResult = await client.query(
      `
      INSERT INTO stock_transfers (tenant_id, variant_id, from_warehouse, to_warehouse, quantity)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id
      `,
      [tenantId, variant_id, from_warehouse, to_warehouse, quantity]
    );
    const transferId = transferResult.rows[0]?.id || null;

    await recordInventoryMovement(client, {
      tenantId,
      productId,
      variantId: variant_id,
      warehouseId: from_warehouse,
      movementType: "transfer_out",
      quantityBefore: sourceBefore,
      quantityChange: quantityValue * -1,
      quantityAfter: sourceBefore - quantityValue,
      referenceType: "stock_transfer",
      referenceId: transferId,
      reason: "Stock transfer out",
      notes: `Transfer to warehouse ${to_warehouse}`,
      createdBy: req.user?.id || null,
    });

    await recordInventoryMovement(client, {
      tenantId,
      productId,
      variantId: variant_id,
      warehouseId: to_warehouse,
      movementType: "transfer_in",
      quantityBefore: destinationBefore,
      quantityChange: quantityValue,
      quantityAfter: destinationBefore + quantityValue,
      referenceType: "stock_transfer",
      referenceId: transferId,
      reason: "Stock transfer in",
      notes: `Transfer from warehouse ${from_warehouse}`,
      createdBy: req.user?.id || null,
    });

    await client.query("COMMIT");
    res.status(200).json({ success: true, message: "Stock transferred successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  } finally {
    client.release();
  }
};
