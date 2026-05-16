import db from "../database/db.js";
import {
  ensureInventoryMovementSchema,
  getInventoryMovements,
  recordInventoryMovement,
} from "./inventoryMovementService.js";

export const ensureInventorySchema = ensureInventoryMovementSchema;
export { getInventoryMovements, recordInventoryMovement };

const UNDOABLE_MOVEMENT_TYPES = new Set(["product_stock_edit", "manual_adjustment"]);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const queryable = (clientOrPool = db) => clientOrPool || db;
const shouldLockRows = (clientOrPool) => typeof clientOrPool?.release === "function";

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

export const adjustVariantStock = async (clientOrPool, data = {}) => {
  try {
    await ensureInventoryMovementSchema();

    const dbClient = queryable(clientOrPool);
    const tenantId = data.tenantId ?? data.tenant_id ?? null;
    const variantId = data.variantId ?? data.variant_id;
    const variantColumns = await tableColumns(dbClient, "product_variants");
    const variantTenantClause = variantColumns.has("tenant_id")
      ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)"
      : "";
    const updateTenantClause = variantColumns.has("tenant_id")
      ? "AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)"
      : "";
    const updateTimestampSet = variantColumns.has("updated_at") ? ", updated_at = NOW()" : "";
    const costPriceSelect = variantColumns.has("cost_price") ? "cost_price" : "0 AS cost_price";

    if (!variantId) {
      throw new Error("variantId is required");
    }

    const variantResult = await dbClient.query(
      `
      SELECT id, product_id, stock, ${costPriceSelect}
      FROM product_variants
      WHERE id = $1
        ${variantTenantClause}
      ${shouldLockRows(clientOrPool) ? "FOR UPDATE" : ""}
      `,
      [variantId, tenantId]
    );

    const variant = variantResult.rows[0];
    if (!variant) {
      throw new Error("Variant not found");
    }

    const quantityBefore = toNumber(data.quantityBefore ?? data.quantity_before ?? variant.stock, 0);
    const explicitAfter = data.quantityAfter ?? data.quantity_after;
    const quantityChange = explicitAfter !== undefined && explicitAfter !== null
      ? toNumber(explicitAfter, quantityBefore) - quantityBefore
      : toNumber(data.quantityChange ?? data.quantity_change, 0);
    const quantityAfter = explicitAfter !== undefined && explicitAfter !== null
      ? toNumber(explicitAfter, quantityBefore)
      : quantityBefore + quantityChange;

    await dbClient.query(
      `
      UPDATE product_variants
      SET stock = $1
          ${updateTimestampSet}
      WHERE id = $2
        ${updateTenantClause}
      `,
      [quantityAfter, variantId, tenantId]
    );

    const movement = quantityChange === 0
      ? null
      : await recordInventoryMovement(dbClient, {
          tenantId,
          productId: data.productId ?? variant.product_id,
          variantId,
          warehouseId: data.warehouseId ?? data.warehouse_id ?? null,
          branchId: data.branchId ?? data.branch_id ?? null,
          movementType: data.movementType ?? data.movement_type ?? "manual_adjustment",
          quantityBefore,
          quantityChange,
          quantityAfter,
          unitCost: data.unitCost ?? data.unit_cost ?? null,
          totalCost: data.totalCost ?? data.total_cost ?? null,
          referenceType: data.referenceType ?? data.reference_type ?? null,
          referenceId: data.referenceId ?? data.reference_id ?? null,
          reason: data.reason ?? "",
          notes: data.notes ?? data.note ?? "",
          createdBy: data.createdBy ?? data.created_by ?? null,
        });

    return {
      variantId,
      productId: variant.product_id,
      variant: {
        ...variant,
        stock: quantityAfter,
      },
      quantityBefore,
      quantityChange,
      quantityAfter,
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

  if (!UNDOABLE_MOVEMENT_TYPES.has(String(movement.movement_type || ""))) {
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
