import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
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

export const getWarehouses = async (req, res) => {
  try {
    await ensureWarehouseSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    let result = await db.query(
      `
      SELECT *
      FROM warehouses
      ${tenantId === null ? "" : "WHERE tenant_id = $1 OR tenant_id IS NULL"}
      ORDER BY id DESC
      `,
      tenantId === null ? [] : [tenantId]
    );

    if (tenantId !== null && result.rows.length === 0) {
      await db.query(
        `
        INSERT INTO warehouses (tenant_id, name, code, branch_name, location, qr_token, status)
        VALUES ($1, 'Main Warehouse', 'MAIN', $2, '', $3, 'active')
        ON CONFLICT DO NOTHING
        `,
        [tenantId, SINGLE_BRANCH_NAME, `main-warehouse-${tenantId}-${Date.now()}`]
      );
      result = await db.query(
        `
        SELECT *
        FROM warehouses
        WHERE tenant_id = $1 OR tenant_id IS NULL
        ORDER BY id DESC
        `,
        [tenantId]
      );
    }

    const rows = Array.isArray(result.rows) ? result.rows : [];
    res.status(200).json({ success: true, data: rows, warehouses: rows });
  } catch (error) {
    console.error("[warehouses] error:", error, error.stack);
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
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const {
      name,
      location,
      latitude = null,
      longitude = null,
      allowed_radius_meters = 100,
      qr_token = null,
    } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Warehouse name required" });
    }

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
        name,
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

export const transferStock = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureInventoryMovementSchema();
    await client.query("BEGIN");

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
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
