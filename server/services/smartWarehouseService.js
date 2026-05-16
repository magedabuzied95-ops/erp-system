import db from "../database/db.js";
import { ensureSingleBranchMode } from "../utils/singleBranchMode.js";
import { ensureInventoryMovementSchema, recordInventoryMovement } from "./inventoryMovementService.js";

let schemaReadyPromise = null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const queryable = (clientOrPool = db) => clientOrPool || db;

export const ensureSmartWarehouseSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await ensureInventoryMovementSchema();

        await client.query(`
          CREATE TABLE IF NOT EXISTS warehouse_sections (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            branch_id BIGINT NULL,
            warehouse_id BIGINT NULL,
            code VARCHAR(120) NOT NULL,
            name VARCHAR(255) NOT NULL DEFAULT '',
            qr_code TEXT,
            barcode VARCHAR(160),
            color VARCHAR(40) DEFAULT '#2563eb',
            notes TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS inventory_counts (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            branch_id BIGINT NULL,
            warehouse_id BIGINT NULL,
            section_id BIGINT NULL,
            count_type VARCHAR(50) NOT NULL DEFAULT 'quick_scan',
            status VARCHAR(50) NOT NULL DEFAULT 'draft',
            created_by BIGINT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS inventory_count_items (
            id BIGSERIAL PRIMARY KEY,
            inventory_count_id BIGINT NOT NULL,
            product_id BIGINT NULL,
            variant_id BIGINT NULL,
            expected_qty INTEGER NOT NULL DEFAULT 0,
            actual_qty INTEGER NOT NULL DEFAULT 0,
            difference_qty INTEGER NOT NULL DEFAULT 0,
            notes TEXT
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS master_qr_models (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            product_id BIGINT NOT NULL,
            qr_value TEXT NOT NULL,
            generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await client.query(`ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
        await client.query(`ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
        await client.query(`ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS warehouse_id BIGINT`);
        await client.query(`ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS qr_code TEXT`);
        await client.query(`ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS barcode VARCHAR(160)`);
        await client.query(`ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS color VARCHAR(40) DEFAULT '#2563eb'`);
        await client.query(`ALTER TABLE inventory_count_items ADD COLUMN IF NOT EXISTS notes TEXT`);
        await client.query(`ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
        await client.query(`ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS section_id BIGINT`);
        await client.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);

        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_sections_scope_code ON warehouse_sections (COALESCE(tenant_id, 0), COALESCE(warehouse_id, 0), code)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_warehouse_sections_branch_id ON warehouse_sections (branch_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_warehouse_sections_warehouse_id ON warehouse_sections (warehouse_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_warehouse_sections_barcode ON warehouse_sections (barcode)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_counts_section_id ON inventory_counts (section_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_counts_status ON inventory_counts (status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count_id ON inventory_count_items (inventory_count_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_count_items_variant_id ON inventory_count_items (variant_id)`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_master_qr_models_product_id ON master_qr_models (product_id)`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_master_qr_models_qr_value ON master_qr_models (qr_value)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_sku_perf ON products (sku)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode_perf ON products (barcode)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_sku_perf ON product_variants (sku)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_barcode_perf ON product_variants (barcode)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_branch_id ON warehouse_inventory (branch_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_section_id ON warehouse_inventory (section_id)`);
        await ensureSingleBranchMode(client);

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

export const createMasterQrValue = (productId) =>
  `MODEL-${productId}-${Date.now().toString(36).toUpperCase()}`;

export const getOrCreateMasterQr = async (clientOrPool, { tenantId, productId }) => {
  const dbClient = queryable(clientOrPool);
  const existing = await dbClient.query(
    `SELECT * FROM master_qr_models WHERE product_id = $1 LIMIT 1`,
    [productId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const result = await dbClient.query(
    `
    INSERT INTO master_qr_models (tenant_id, product_id, qr_value)
    VALUES ($1, $2, $3)
    ON CONFLICT (product_id) DO UPDATE SET product_id = EXCLUDED.product_id
    RETURNING *
    `,
    [tenantId, productId, createMasterQrValue(productId)]
  );
  return result.rows[0];
};

export const getMasterQrProduct = async (clientOrPool, { tenantId, qrValue }) => {
  await ensureSmartWarehouseSchema();
  const dbClient = queryable(clientOrPool);
  const result = await dbClient.query(
    `
    SELECT p.*, mq.qr_value
    FROM master_qr_models mq
    JOIN products p ON p.id = mq.product_id
    WHERE mq.qr_value = $1
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
    LIMIT 1
    `,
    [qrValue, tenantId]
  );
  const product = result.rows[0];
  if (!product) return null;

  const variantsResult = await dbClient.query(
    `
    SELECT
      v.id,
      v.product_id,
      v.color,
      v.size,
      v.sku,
      v.barcode,
      v.stock,
      COALESCE(v.image_url, p.image_url, p.image, p.photo_url, p.thumbnail_url, '') AS image_url,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'warehouse_id', wi.warehouse_id,
        'branch_id', wi.branch_id,
        'section_id', wi.section_id,
        'section_code', ws.code,
        'section_name', ws.name,
        'stock', wi.stock
      )) FILTER (WHERE wi.id IS NOT NULL), '[]'::jsonb) AS locations
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN warehouse_inventory wi ON wi.variant_id = v.id
    LEFT JOIN warehouse_sections ws ON ws.id = wi.section_id
    WHERE v.product_id = $1
      AND ($2::bigint IS NULL OR v.tenant_id = $2::bigint OR v.tenant_id IS NULL)
    GROUP BY v.id, p.id
    ORDER BY v.color NULLS LAST, v.size NULLS LAST, v.id ASC
    `,
    [product.id, tenantId]
  );

  return {
    product,
    variants: variantsResult.rows,
    colors: [...new Set(variantsResult.rows.map((row) => row.color).filter(Boolean))],
    sizes: [...new Set(variantsResult.rows.map((row) => row.size).filter(Boolean))],
    totalStock: variantsResult.rows.reduce((sum, row) => sum + toNumber(row.stock, 0), 0),
  };
};

export const completeInventoryCount = async (client, { tenantId, branchId, warehouseId, sectionId, countType, items, createdBy, notes }) => {
  const countResult = await client.query(
    `
    INSERT INTO inventory_counts (tenant_id, branch_id, warehouse_id, section_id, count_type, status, created_by, completed_at)
    VALUES ($1,$2,$3,$4,$5,'completed',$6,NOW())
    RETURNING *
    `,
    [tenantId, branchId, warehouseId, sectionId, countType || "quick_scan", createdBy]
  );
  const count = countResult.rows[0];
  const savedItems = [];

  for (const item of items) {
    const variantId = item.variant_id ?? item.variantId;
    if (!variantId) continue;

    const variantResult = await client.query(
      `
      SELECT id, product_id, stock, tenant_id
      FROM product_variants
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [variantId, tenantId]
    );
    const variant = variantResult.rows[0];
    if (!variant) continue;

    const expectedQty = toNumber(item.expected_qty ?? item.expectedQty ?? variant.stock, 0);
    const actualQty = toNumber(item.actual_qty ?? item.actualQty, expectedQty);
    const differenceQty = actualQty - expectedQty;
    const effectiveTenantId = tenantId ?? variant.tenant_id ?? null;

    const itemResult = await client.query(
      `
      INSERT INTO inventory_count_items (
        inventory_count_id,
        product_id,
        variant_id,
        expected_qty,
        actual_qty,
        difference_qty,
        notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [count.id, variant.product_id, variant.id, expectedQty, actualQty, differenceQty, item.notes || ""]
    );
    savedItems.push(itemResult.rows[0]);

    if (differenceQty !== 0) {
      await client.query(
        `
        UPDATE product_variants
        SET stock = $1, updated_at = NOW()
        WHERE id = $2
        `,
        [actualQty, variant.id]
      );

      await client.query(
        `
        INSERT INTO warehouse_inventory (tenant_id, branch_id, warehouse_id, section_id, variant_id, stock)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id, warehouse_id, variant_id)
        DO UPDATE SET stock = EXCLUDED.stock, branch_id = EXCLUDED.branch_id, section_id = EXCLUDED.section_id, updated_at = NOW()
        `,
        [effectiveTenantId, branchId, warehouseId, sectionId, variant.id, actualQty]
      );

      await recordInventoryMovement(client, {
        tenantId: effectiveTenantId,
        productId: variant.product_id,
        variantId: variant.id,
        branchId,
        warehouseId,
        sectionId,
        movementType: "inventory_count",
        quantityBefore: expectedQty,
        quantityChange: differenceQty,
        quantityAfter: actualQty,
        referenceType: "inventory_count",
        referenceId: count.id,
        reason: "Inventory count difference",
        notes: notes || item.notes || "Quick count saved",
        createdBy,
      });
    }
  }

  return { count, items: savedItems };
};
