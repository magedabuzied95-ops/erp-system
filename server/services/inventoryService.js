import db from "../database/db.js";
import {
  ensureInventoryMovementSchema,
  getInventoryMovements,
  recordInventoryMovement,
} from "./inventoryMovementService.js";

export const ensureInventorySchema = ensureInventoryMovementSchema;
export { getInventoryMovements, recordInventoryMovement };

const UNDOABLE_MOVEMENT_TYPES = new Set(["ADJUSTMENT", "MANUAL_ADJUSTMENT", "PRODUCT_STOCK_EDIT"]);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const queryable = (clientOrPool = db) => clientOrPool || db;
const shouldLockRows = (clientOrPool) => typeof clientOrPool?.release === "function";
const isInventoryTimeoutError = (error = {}) =>
  String(error?.message || error?.code || "").toLowerCase().includes("timeout") ||
  String(error?.message || error?.code || "").toLowerCase().includes("timed out");
const inventoryDbLogMeta = ({ queryName = "", orderId = null, variantId = null, tokenCode = "", rowCount = null } = {}) => ({
  query_name: queryName,
  order_id: orderId ?? null,
  variant_id: variantId ?? null,
  token_code: tokenCode || "",
  row_count: rowCount,
});
const timedInventoryQuery = async ({ client, queryName, sql, params = [], orderId = null, variantId = null, tokenCode = "" }) => {
  const startedAt = Date.now();
  console.info("[order-confirmation-db-start]", inventoryDbLogMeta({ queryName, orderId, variantId, tokenCode }));
  try {
    const result = await client.query(sql, params);
    console.info("[order-confirmation-db-success]", {
      ...inventoryDbLogMeta({ queryName, orderId, variantId, tokenCode, rowCount: result?.rowCount ?? null }),
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    if (isInventoryTimeoutError(error)) {
      console.warn("[order-confirmation-db-timeout]", {
        ...inventoryDbLogMeta({ queryName, orderId, variantId, tokenCode }),
        duration_ms: Date.now() - startedAt,
        error_message: error?.message || String(error),
      });
    }
    throw error;
  }
};

const tableColumns = async (clientOrPool, tableName, tokenCode = "") => {
  const result = await timedInventoryQuery({
    client: clientOrPool,
    queryName: `inventory_table_columns_${tableName}`,
    sql: `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    params: [tableName],
    tokenCode,
  });
  return new Set(result.rows.map((row) => row.column_name));
};

export const adjustVariantStock = async (clientOrPool, data = {}) => {
  try {
    if (!shouldLockRows(clientOrPool)) {
      await ensureInventoryMovementSchema();
    }

    const dbClient = queryable(clientOrPool);
    let quantityDelta = data.quantityChange ?? data.quantity_change ?? data.quantityDelta ?? data.quantity_delta;
    let quantityBefore = data.quantityBefore ?? data.quantity_before;
    let quantityAfter = data.quantityAfter ?? data.quantity_after;

    if ((quantityDelta === undefined || quantityDelta === null) && quantityAfter !== undefined && quantityAfter !== null) {
      const tenantId = data.tenantId ?? data.tenant_id ?? null;
      const variantId = data.variantId ?? data.variant_id;
      const variantColumns = await tableColumns(dbClient, "product_variants", data.tokenCode || "");
      const tenantClause = variantColumns.has("tenant_id")
        ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)"
        : "";
      const variantResult = await timedInventoryQuery({
        client: dbClient,
        queryName: "product_variant_lookup_for_adjust_variant_stock",
        sql: `
        SELECT id, product_id, stock
        FROM product_variants
        WHERE id = $1
          ${tenantClause}
        ${shouldLockRows(clientOrPool) ? "FOR UPDATE" : ""}
        `,
        params: tenantClause ? [variantId, tenantId] : [variantId],
        variantId,
        tokenCode: data.tokenCode || "",
      });
      const variant = variantResult.rows[0] || null;
      if (!variant) {
        const error = new Error("Variant not found");
        error.status = 404;
        throw error;
      }
      quantityBefore = toNumber(variant.stock, 0);
      quantityAfter = toNumber(quantityAfter, quantityBefore);
      quantityDelta = quantityAfter - quantityBefore;
      data.productId = data.productId ?? data.product_id ?? variant.product_id;
    }

    const movement = await recordInventoryMovement(dbClient, {
      ...data,
      movementType: data.movementType ?? data.movement_type ?? "ADJUSTMENT",
      quantityDelta: toNumber(quantityDelta, 0),
    });
    const resultQuantityBefore = toNumber(movement?.quantityBefore ?? movement?.quantity_before, 0);
    const quantityChange = toNumber(movement?.quantityChange ?? movement?.quantity_change, 0);
    const resultQuantityAfter = toNumber(movement?.quantityAfter ?? movement?.quantity_after, resultQuantityBefore + quantityChange);
    const variant = movement?.variant || null;

    return {
      variantId: data.variantId ?? data.variant_id,
      productId: movement?.productId ?? data.productId ?? data.product_id ?? variant?.product_id ?? null,
      variant,
      quantityBefore: resultQuantityBefore,
      quantityChange,
      quantityAfter: resultQuantityAfter,
      movement,
    };
  } catch (error) {
    console.error("[inventory] adjustVariantStock error", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      variantId: data.variantId ?? data.variant_id,
      tenantId: data.tenantId ?? data.tenant_id ?? null,
    });
    throw error;
  }
};

export const undoInventoryMovement = async (clientOrPool, data = {}) => {
  await ensureInventoryMovementSchema();

  const dbClient = queryable(clientOrPool);
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const movementId = data.movementId ?? data.movement_id;
  const createdBy = data.createdBy ?? data.created_by ?? null;

  if (!movementId) {
    const error = new Error("Movement id is required");
    error.status = 400;
    throw error;
  }

  const movementResult = await dbClient.query(
    `
    SELECT *
    FROM inventory_movements
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    ${shouldLockRows(clientOrPool) ? "FOR UPDATE" : ""}
    `,
    [movementId, tenantId]
  );

  const movement = movementResult.rows[0];
  if (!movement) {
    const error = new Error("Inventory movement not found");
    error.status = 404;
    throw error;
  }

  if (!UNDOABLE_MOVEMENT_TYPES.has(String(movement.movement_type || "").toUpperCase())) {
    const error = new Error("This inventory movement cannot be undone");
    error.status = 400;
    throw error;
  }

  if (movement.undone_at) {
    const error = new Error("Inventory movement has already been undone");
    error.status = 409;
    throw error;
  }

  const newerMovementResult = await dbClient.query(
    `
    SELECT id
    FROM inventory_movements
    WHERE variant_id = $1
      AND id <> $2
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
      AND (
        created_at > $4
        OR (created_at = $4 AND id > $2)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [movement.variant_id, movement.id, tenantId, movement.created_at]
  );

  if (newerMovementResult.rows[0]) {
    const error = new Error("Only the latest stock movement for this variant can be undone");
    error.status = 409;
    throw error;
  }

  const variantResult = await dbClient.query(
    `
    SELECT id, product_id, stock, cost_price
    FROM product_variants
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    ${shouldLockRows(clientOrPool) ? "FOR UPDATE" : ""}
    `,
    [movement.variant_id, tenantId]
  );

  const variant = variantResult.rows[0];
  if (!variant) {
    const error = new Error("Variant not found");
    error.status = 404;
    throw error;
  }

  const quantityBefore = toNumber(variant.stock, 0);
  const quantityChange = -toNumber(movement.quantity_change, 0);
  const quantityAfter = quantityBefore + quantityChange;

  await dbClient.query(
    `
    UPDATE product_variants
    SET stock = $1,
        updated_at = NOW()
    WHERE id = $2
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
    `,
    [quantityAfter, variant.id, tenantId]
  );

  const undoMovement = await recordInventoryMovement(dbClient, {
    tenantId: movement.tenant_id ?? tenantId,
    productId: movement.product_id ?? variant.product_id,
    variantId: variant.id,
    warehouseId: movement.warehouse_id ?? null,
    branchId: movement.branch_id ?? null,
    movementType: "undo_adjustment",
    quantityBefore,
    quantityChange,
    quantityAfter,
    unitCost: movement.unit_cost ?? variant.cost_price ?? null,
    totalCost: movement.total_cost ?? null,
    referenceType: "inventory_movement",
    referenceId: movement.id,
    reason: "Undo stock adjustment",
    notes: `Undo movement #${movement.id}`,
    createdBy,
  });

  await dbClient.query(
    `
    UPDATE inventory_movements
    SET undone_at = NOW(),
        undone_by = $2
    WHERE id = $1
    `,
    [movement.id, createdBy]
  );

  return {
    movement,
    undoMovement,
    variant: {
      ...variant,
      stock: quantityAfter,
    },
    quantityBefore,
    quantityChange,
    quantityAfter,
  };
};

export const getVariantStockHistory = getInventoryMovements;
