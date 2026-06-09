import db from "../database/db.js";
import { recordInventoryMovement } from "./inventoryMovementService.js";
import logActivity from "../utils/logActivity.js";

const SESSION_STATUSES = new Set(["draft", "in_progress", "completed", "cancelled"]);
export const INVENTORY_COUNT_REASONS = [
  "خطأ بيع",
  "خطأ استلام",
  "تالف",
  "فقد",
  "تسوية يدوية",
  "أخرى",
];

let schemaReadyPromise = null;

const queryable = (clientOrPool = db) => clientOrPool || db;
const isTransactionClient = (clientOrPool) => typeof clientOrPool?.release === "function";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeStatus = (value = "draft") => {
  const normalized = String(value || "").trim().toLowerCase();
  return SESSION_STATUSES.has(normalized) ? normalized : "draft";
};

const normalizeText = (value = "") => String(value || "").trim();

const normalizeNullableId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const ensureColumn = async (client, table, columnSql) => {
  await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${columnSql}`);
};

const ensureIndex = async (client, indexSql) => {
  await client.query(indexSql);
};

const withTransaction = async (clientOrPool, handler) => {
  if (isTransactionClient(clientOrPool)) {
    return handler(clientOrPool);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const ensureInventoryCountItemsCompatibility = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_count_sessions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
      warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
      title VARCHAR(255) NOT NULL DEFAULT 'جرد جديد',
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      notes TEXT NOT NULL DEFAULT '',
      opened_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      cancelled_at TIMESTAMP NULL,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      opened_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      completed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      cancelled_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumn(client, "inventory_count_sessions", "tenant_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "branch_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "warehouse_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "title VARCHAR(255) NOT NULL DEFAULT 'جرد جديد'");
  await ensureColumn(client, "inventory_count_sessions", "status VARCHAR(30) NOT NULL DEFAULT 'draft'");
  await ensureColumn(client, "inventory_count_sessions", "notes TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, "inventory_count_sessions", "opened_at TIMESTAMP NULL");
  await ensureColumn(client, "inventory_count_sessions", "completed_at TIMESTAMP NULL");
  await ensureColumn(client, "inventory_count_sessions", "cancelled_at TIMESTAMP NULL");
  await ensureColumn(client, "inventory_count_sessions", "created_by BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "opened_by BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "completed_by BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "cancelled_by BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await ensureColumn(client, "inventory_count_sessions", "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");

  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_count_items (
      id BIGSERIAL PRIMARY KEY,
      inventory_count_id BIGINT NULL,
      inventory_count_session_id BIGINT NULL,
      product_id BIGINT NULL,
      product_variant_id BIGINT NULL,
      variant_id BIGINT NULL,
      system_quantity INTEGER NOT NULL DEFAULT 0,
      counted_quantity INTEGER NOT NULL DEFAULT 0,
      difference_quantity INTEGER NOT NULL DEFAULT 0,
      expected_qty INTEGER NOT NULL DEFAULT 0,
      actual_qty INTEGER NOT NULL DEFAULT 0,
      difference_qty INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumn(client, "inventory_count_items", "inventory_count_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_items", "inventory_count_session_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_items", "product_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_items", "product_variant_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_items", "variant_id BIGINT NULL");
  await ensureColumn(client, "inventory_count_items", "system_quantity INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "inventory_count_items", "counted_quantity INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "inventory_count_items", "difference_quantity INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "inventory_count_items", "expected_qty INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "inventory_count_items", "actual_qty INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "inventory_count_items", "difference_qty INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "inventory_count_items", "reason TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, "inventory_count_items", "notes TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, "inventory_count_items", "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await ensureColumn(client, "inventory_count_items", "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'inventory_count_sessions'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'inventory_count_items_session_fk'
      ) THEN
        ALTER TABLE inventory_count_items
          ADD CONSTRAINT inventory_count_items_session_fk
          FOREIGN KEY (inventory_count_session_id) REFERENCES inventory_count_sessions(id) ON DELETE CASCADE NOT VALID;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'product_variants'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'inventory_count_items_variant_fk'
      ) THEN
        ALTER TABLE inventory_count_items
          ADD CONSTRAINT inventory_count_items_variant_fk
          FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
  `);

  await ensureIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_tenant_created ON inventory_count_sessions (tenant_id, created_at DESC, id DESC)");
  await ensureIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_status ON inventory_count_sessions (status, created_at DESC, id DESC)");
  await ensureIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_branch_id ON inventory_count_sessions (branch_id)");
  await ensureIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_warehouse_id ON inventory_count_sessions (warehouse_id)");
  await ensureIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_count_items_session_id ON inventory_count_items (inventory_count_session_id)");
  await ensureIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_count_items_variant_id ON inventory_count_items (product_variant_id)");
  await ensureIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_count_items_inventory_count_id ON inventory_count_items (inventory_count_id)");
};

export const ensureInventoryCountSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await ensureInventoryCountItemsCompatibility(client);
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

const applyRowAliases = (row = {}) => {
  const systemQuantity = toNumber(row.system_quantity ?? row.expected_qty ?? row.quantity_before ?? 0);
  const countedQuantity = toNumber(row.counted_quantity ?? row.actual_qty ?? row.quantity_after ?? 0);
  const differenceQuantity = toNumber(row.difference_quantity ?? row.difference_qty ?? row.quantity_change ?? countedQuantity - systemQuantity);
  return {
    ...row,
    system_quantity: systemQuantity,
    counted_quantity: countedQuantity,
    difference_quantity: differenceQuantity,
    expected_qty: systemQuantity,
    actual_qty: countedQuantity,
    difference_qty: differenceQuantity,
    product_variant_id: row.product_variant_id ?? row.variant_id ?? null,
    variant_id: row.variant_id ?? row.product_variant_id ?? null,
    inventory_count_session_id: row.inventory_count_session_id ?? row.inventory_count_id ?? null,
    notes: row.notes || "",
    reason: row.reason || "",
  };
};

const getTenantClause = (alias = "s", tenantId = null, params = []) => {
  if (tenantId === null || tenantId === undefined) return "";
  params.push(tenantId);
  return `${alias}.tenant_id = $${params.length}`;
};

const fetchSessionRow = async (clientOrPool, { tenantId, sessionId, lock = false }) => {
  return withTransaction(clientOrPool, async (dbClient) => {
  if (lock) {
    const lockParams = [sessionId];
    let tenantClause = "";
    if (tenantId !== null && tenantId !== undefined) {
      lockParams.push(tenantId);
      tenantClause = `AND (tenant_id = $2::bigint OR tenant_id IS NULL)`;
    }

    const lockResult = await dbClient.query(
      `
      SELECT *
      FROM inventory_count_sessions
      WHERE id = $1
        ${tenantClause}
      FOR UPDATE
      LIMIT 1
      `,
      lockParams
    );
    const lockedRow = lockResult.rows[0];
    if (!lockedRow) return null;
  }

  const params = [sessionId];
  let tenantClause = "";
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    tenantClause = `AND (s.tenant_id = $2::bigint OR s.tenant_id IS NULL)`;
  }
  const result = await dbClient.query(
    `
    SELECT
      s.*,
      b.name AS branch_name,
      w.name AS warehouse_name,
      uc.name AS created_by_name,
      uo.name AS opened_by_name,
      uu.name AS completed_by_name,
      ux.name AS cancelled_by_name
    FROM inventory_count_sessions s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN users uc ON uc.id = s.created_by
    LEFT JOIN users uo ON uo.id = s.opened_by
    LEFT JOIN users uu ON uu.id = s.completed_by
    LEFT JOIN users ux ON ux.id = s.cancelled_by
    WHERE s.id = $1
      ${tenantClause}
    LIMIT 1
    `,
    params
  );
  const row = result.rows[0];
  if (!row) return null;

  const totalsResult = await dbClient.query(
    `
    SELECT
      COUNT(*)::int AS item_count,
      COALESCE(SUM(ABS(difference_quantity)), 0)::int AS difference_total
    FROM inventory_count_items
    WHERE inventory_count_session_id = $1
       OR inventory_count_id = $1
    `,
    [sessionId]
  );

  return applyRowAliases({
    ...row,
    item_count: totalsResult.rows[0]?.item_count || 0,
    difference_total: totalsResult.rows[0]?.difference_total || 0,
  });
  });
};

const fetchSessionItems = async (clientOrPool, { tenantId, sessionId, lock = false }) => {
  return withTransaction(clientOrPool, async (dbClient) => {
  if (lock) {
    const lockParams = [sessionId];
    try {
      await dbClient.query(
        `
        SELECT id
        FROM inventory_count_items
        WHERE inventory_count_session_id = $1
           OR inventory_count_id = $1
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
        `,
        lockParams
      );
    } catch (error) {
      error.checkoutDbContext = {
        ...(error.checkoutDbContext || {}),
        table: "inventory_count_items",
        operation: "lock inventory count items",
      };
      throw error;
    }
  }

  const params = [sessionId];
  let tenantClause = "";
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    tenantClause = "AND (s.tenant_id = $2::bigint OR s.tenant_id IS NULL)";
  }
  const result = await dbClient.query(
    `
    SELECT
      i.*,
      p.name AS product_name,
      v.color AS variant_color,
      v.size AS variant_size,
      v.sku AS variant_sku,
      v.barcode AS variant_barcode,
      v.article_code AS variant_article_code,
      COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), '') AS variant_image_url
    FROM inventory_count_items i
    LEFT JOIN inventory_count_sessions s ON s.id = COALESCE(i.inventory_count_session_id, i.inventory_count_id)
    LEFT JOIN product_variants v ON v.id = COALESCE(i.product_variant_id, i.variant_id)
    LEFT JOIN products p ON p.id = COALESCE(i.product_id, v.product_id)
    WHERE i.inventory_count_session_id = $1
       OR i.inventory_count_id = $1
      ${tenantClause}
    ORDER BY i.created_at ASC, i.id ASC
    `,
    params
  );
    return result.rows.map((row) => applyRowAliases(row));
  });
};

const fetchVariantForSession = async (clientOrPool, { tenantId, productVariantId }) => {
  return withTransaction(clientOrPool, async (dbClient) => {
  const result = await dbClient.query(
    `
    SELECT
      v.id AS product_variant_id,
      v.product_id,
      v.color,
      v.size,
      v.sku,
      v.barcode,
      v.article_code,
      COALESCE(v.stock, 0)::int AS stock,
      p.name AS product_name,
      COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), '') AS image_url
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.id = $1
      AND ($2::bigint IS NULL OR v.tenant_id = $2::bigint OR v.tenant_id IS NULL)
    LIMIT 1
    `,
    [productVariantId, tenantId]
  );
  return result.rows[0] || null;
  });
};

export const listInventoryCountSessions = async (clientOrPool, { tenantId = null, search = "", status = "", branchId = null, warehouseId = null, page = 1, limit = 25 } = {}) => {
  await ensureInventoryCountSchema();
  const dbClient = queryable(clientOrPool);
  const params = [];
  const clauses = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (tenantId !== null && tenantId !== undefined) clauses.push(`(s.tenant_id = ${push(tenantId)} OR s.tenant_id IS NULL)`);
  if (status) clauses.push(`s.status = ${push(normalizeStatus(status))}`);
  if (branchId) clauses.push(`s.branch_id = ${push(branchId)}`);
  if (warehouseId) clauses.push(`s.warehouse_id = ${push(warehouseId)}`);
  if (search) {
    const like = `%${normalizeText(search)}%`;
    clauses.push(
      `(
        COALESCE(s.title, '') ILIKE ${push(like)} OR
        COALESCE(s.notes, '') ILIKE ${push(like)} OR
        COALESCE(b.name, '') ILIKE ${push(like)} OR
        COALESCE(w.name, '') ILIKE ${push(like)} OR
        COALESCE(uc.name, '') ILIKE ${push(like)}
      )`
    );
  }

  const limitValue = Math.min(Math.max(toNumber(limit, 25), 1), 200);
  const pageValue = Math.max(toNumber(page, 1), 1);
  const offset = (pageValue - 1) * limitValue;
  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [countResult, rowsResult] = await Promise.all([
    dbClient.query(
      `
      SELECT COUNT(*)::int AS count
      FROM inventory_count_sessions s
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN users uc ON uc.id = s.created_by
      ${whereClause}
      `,
      params
    ),
    dbClient.query(
      `
      SELECT
        s.*,
        b.name AS branch_name,
        w.name AS warehouse_name,
        uc.name AS created_by_name,
        COALESCE(items.item_count, 0)::int AS item_count,
        COALESCE(items.adjusted_items, 0)::int AS adjusted_items,
        COALESCE(items.difference_total, 0)::int AS difference_total
      FROM inventory_count_sessions s
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN users uc ON uc.id = s.created_by
      LEFT JOIN (
        SELECT
          inventory_count_session_id,
          COUNT(*)::int AS item_count,
          COUNT(*) FILTER (WHERE difference_quantity <> 0)::int AS adjusted_items,
          COALESCE(SUM(ABS(difference_quantity)), 0)::int AS difference_total
        FROM inventory_count_items
        GROUP BY inventory_count_session_id
      ) items ON items.inventory_count_session_id = s.id
      ${whereClause}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limitValue, offset]
    ),
  ]);

  const sessions = rowsResult.rows.map((row) => applyRowAliases(row));
  return {
    sessions,
    total: Number(countResult.rows[0]?.count || 0),
    page: pageValue,
    limit: limitValue,
    totalPages: Math.max(1, Math.ceil(Number(countResult.rows[0]?.count || 0) / limitValue)),
  };
};

export const createInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  const dbClient = queryable(clientOrPool);
  const result = await dbClient.query(
    `
    INSERT INTO inventory_count_sessions (
      tenant_id,
      branch_id,
      warehouse_id,
      title,
      status,
      notes,
      created_by,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    RETURNING *
    `,
    [
      data.tenantId ?? data.tenant_id ?? null,
      normalizeNullableId(data.branchId ?? data.branch_id),
      normalizeNullableId(data.warehouseId ?? data.warehouse_id),
      normalizeText(data.title || data.session_title || "جرد جديد") || "جرد جديد",
      normalizeStatus(data.status || "draft"),
      normalizeText(data.notes || ""),
      data.createdBy ?? data.created_by ?? null,
    ]
  );
  return applyRowAliases(result.rows[0]);
};

export const updateInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const completedBy = data.completedBy ?? data.completed_by ?? data.userId ?? data.user_id ?? null;
  console.log("[inventory-count:approve:start]", JSON.stringify({ tenantId, sessionId, completedBy }));
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }

  if (session.status === "completed" || session.status === "cancelled") {
    const error = new Error("Cannot update a finished inventory count session");
    error.status = 409;
    throw error;
  }

  const patch = {
    branchId: data.branchId ?? data.branch_id ?? session.branch_id ?? null,
    warehouseId: data.warehouseId ?? data.warehouse_id ?? session.warehouse_id ?? null,
    title: normalizeText(data.title ?? data.session_title ?? session.title ?? "جرد جديد") || "جرد جديد",
    notes: normalizeText(data.notes ?? session.notes ?? ""),
  };

  const result = await dbClient.query(
    `
    UPDATE inventory_count_sessions
    SET branch_id = $2,
        warehouse_id = $3,
        title = $4,
        notes = $5,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, normalizeNullableId(patch.branchId), normalizeNullableId(patch.warehouseId), patch.title, patch.notes]
  );

  return applyRowAliases(result.rows[0]);
  });
};

export const openInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status === "completed" || session.status === "cancelled") {
    const error = new Error("Cannot open a finished inventory count session");
    error.status = 409;
    throw error;
  }
  if (session.status === "in_progress") return session;

  const result = await dbClient.query(
    `
    UPDATE inventory_count_sessions
    SET status = 'in_progress',
        opened_at = COALESCE(opened_at, NOW()),
        opened_by = COALESCE(opened_by, $2),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, data.openedBy ?? data.opened_by ?? null]
  );
  return applyRowAliases(result.rows[0]);
  });
};

export const searchInventoryCountVariants = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const queryText = normalizeText(data.query ?? data.search ?? data.term ?? "");
  const limit = Math.min(Math.max(toNumber(data.limit ?? 10, 10), 1), 25);

  if (!queryText) return [];

  const like = `%${queryText}%`;
  const result = await dbClient.query(
    `
    SELECT
      v.id AS product_variant_id,
      v.product_id,
      p.name AS product_name,
      v.color,
      v.size,
      v.sku,
      v.barcode,
      v.article_code,
      COALESCE(v.stock, 0)::int AS stock,
      COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), '') AS image_url,
      CASE
        WHEN LOWER(TRIM(COALESCE(v.barcode, ''))) = LOWER(TRIM($2))
          OR LOWER(TRIM(COALESCE(v.sku, ''))) = LOWER(TRIM($2))
          OR LOWER(TRIM(COALESCE(v.article_code, ''))) = LOWER(TRIM($2)) THEN 0
        WHEN COALESCE(v.barcode, '') ILIKE $3 OR COALESCE(v.sku, '') ILIKE $3 THEN 1
        ELSE 2
      END AS match_rank
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
      AND (
        LOWER(TRIM(COALESCE(v.barcode, ''))) = LOWER(TRIM($2))
        OR LOWER(TRIM(COALESCE(v.sku, ''))) = LOWER(TRIM($2))
        OR LOWER(TRIM(COALESCE(v.article_code, ''))) = LOWER(TRIM($2))
        OR p.name ILIKE $3
        OR COALESCE(v.color, '') ILIKE $3
        OR COALESCE(v.size, '') ILIKE $3
      )
    ORDER BY match_rank ASC, p.name ASC, v.color ASC NULLS LAST, v.size ASC NULLS LAST, v.id ASC
    LIMIT $4
    `,
    [tenantId, queryText, like, limit]
  );

  return result.rows.map((row) => ({
    ...row,
    product_variant_id: row.product_variant_id ?? row.id,
    stock: toNumber(row.stock, 0),
  }));
};

export const upsertInventoryCountItem = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = normalizeNullableId(
    data.sessionId ??
    data.session_id ??
    data.inventoryCountId ??
    data.inventory_count_id ??
    data.inventoryCountSessionId ??
    data.inventory_count_session_id
  );
  console.log("[inventory-count] upsert item payload", JSON.stringify({
    tenantId,
    sessionId,
    ...data,
  }));
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status === "completed" || session.status === "cancelled") {
    const error = new Error("Cannot modify a finished inventory count session");
    error.status = 409;
    throw error;
  }

  const variantId = normalizeNullableId(data.productVariantId ?? data.product_variant_id ?? data.variantId ?? data.variant_id);
  if (!variantId) {
    const error = new Error("productVariantId is required");
    error.status = 400;
    throw error;
  }

  const variant = await fetchVariantForSession(dbClient, { tenantId, productVariantId: variantId });
  if (!variant) {
    const error = new Error("Product variant not found");
    error.status = 404;
    throw error;
  }

  const sessionStatus = session.status === "draft" ? "in_progress" : session.status;
  if (session.status === "draft") {
    await dbClient.query(
      `
      UPDATE inventory_count_sessions
      SET status = 'in_progress',
          opened_at = COALESCE(opened_at, NOW()),
          opened_by = COALESCE(opened_by, $2),
          updated_at = NOW()
      WHERE id = $1
      `,
      [sessionId, data.userId ?? data.createdBy ?? data.created_by ?? null]
    );
  }

  const existingResult = await dbClient.query(
    `
    SELECT *
    FROM inventory_count_items
    WHERE inventory_count_session_id = $1
      AND product_variant_id = $2
    LIMIT 1
    FOR UPDATE
    `,
    [sessionId, variantId]
  );

  const existing = existingResult.rows[0] || null;
  const isNew = !existing;
  const systemQuantity = isNew
    ? toNumber(variant.stock, 0)
    : toNumber(data.systemQuantity ?? data.system_quantity ?? existing.system_quantity, 0);
  const countedQuantity = data.countedQuantity ?? data.counted_quantity;
  const nextCountedQuantity = countedQuantity === undefined || countedQuantity === null || countedQuantity === ""
    ? (isNew ? 1 : toNumber(existing.counted_quantity, systemQuantity))
    : toNumber(countedQuantity, systemQuantity);
  const differenceQuantity = nextCountedQuantity - systemQuantity;
  const reason = normalizeText(data.reason ?? existing?.reason ?? "");
  const notes = normalizeText(data.notes ?? existing?.notes ?? "");

  let itemRow;
  if (existing) {
    const result = await dbClient.query(
      `
      UPDATE inventory_count_items
      SET inventory_count_id = COALESCE($2, inventory_count_id),
          inventory_count_session_id = $1,
          product_id = $3,
          product_variant_id = $4,
          variant_id = $5,
          system_quantity = $6,
          counted_quantity = $7,
          difference_quantity = $8,
          expected_qty = $6,
          actual_qty = $7,
          difference_qty = $8,
          reason = $9,
          notes = $10,
          updated_at = NOW()
      WHERE id = $11
      RETURNING *
      `,
      [
        sessionId,
        sessionId,
        variant.product_id,
        variantId,
        variantId,
        systemQuantity,
        nextCountedQuantity,
        differenceQuantity,
        reason,
        notes,
        existing.id,
      ]
    );
    itemRow = result.rows[0];
  } else {
    const result = await dbClient.query(
      `
      INSERT INTO inventory_count_items (
        inventory_count_id,
        inventory_count_session_id,
        product_id,
        product_variant_id,
        variant_id,
        system_quantity,
        counted_quantity,
        difference_quantity,
        expected_qty,
        actual_qty,
        difference_qty,
        reason,
        notes,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$7,$8,$9,$10,NOW(),NOW())
      RETURNING *
      `,
      [
        sessionId,
        sessionId,
        variant.product_id,
        variantId,
        variantId,
        systemQuantity,
        nextCountedQuantity,
        differenceQuantity,
        reason,
        notes,
      ]
    );
    itemRow = result.rows[0];
  }

  return {
    sessionStatus,
    session: sessionStatus === session.status
      ? session
      : await fetchSessionRow(dbClient, { tenantId, sessionId, lock: false }),
    item: applyRowAliases({
      ...itemRow,
      product_name: variant.product_name,
      variant_color: variant.color,
      variant_size: variant.size,
      variant_sku: variant.sku,
      variant_barcode: variant.barcode,
      variant_article_code: variant.article_code,
      variant_image_url: variant.image_url,
      product_variant_id: variantId,
      product_id: variant.product_id,
      system_quantity: systemQuantity,
      counted_quantity: nextCountedQuantity,
      difference_quantity: differenceQuantity,
      expected_qty: systemQuantity,
      actual_qty: nextCountedQuantity,
      difference_qty: differenceQuantity,
      reason,
      notes,
    }),
  };
  });
};

export const approveInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  const effectiveTenantId = session.tenant_id ?? tenantId ?? null;
  console.log("[inventory-count:approve:tenant]", JSON.stringify({
    requestedTenantId: tenantId,
    sessionTenantId: session.tenant_id ?? null,
    effectiveTenantId,
  }));
  if (session.status === "completed") {
    return { session, adjustments: [] };
  }
  if (session.status === "cancelled") {
    const error = new Error("Cancelled inventory count sessions cannot be approved");
    error.status = 409;
    throw error;
  }

  const items = await fetchSessionItems(dbClient, { tenantId, sessionId, lock: true });
  const adjustments = [];

  for (const item of items) {
    const productVariantId = normalizeNullableId(item.product_variant_id ?? item.variant_id);
    if (!productVariantId) continue;

    const systemQuantity = toNumber(item.system_quantity ?? item.expected_qty ?? item.quantity_before ?? item.before_qty ?? 0, 0);
    const countedQuantity = toNumber(item.counted_quantity ?? item.actual_qty ?? item.quantity_after ?? item.after_qty ?? 0, 0);
    const differenceQuantity = countedQuantity - systemQuantity;

    console.log("[inventory-count:approve:item]", JSON.stringify({
      sessionId,
      itemId: item.id ?? null,
      productVariantId,
      systemQuantity,
      countedQuantity,
      differenceQuantity,
      reason: item.reason || "",
      notes: item.notes || "",
    }));

    if (differenceQuantity === 0) continue;

    const variantResult = await dbClient.query(
      `
      SELECT id, product_id, stock
      FROM product_variants
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [productVariantId, effectiveTenantId]
    );
    const variant = variantResult.rows[0];
    if (!variant) continue;

    const currentStock = toNumber(variant.stock, 0);
    const newStock = currentStock + differenceQuantity;
    const movementNotes = normalizeText(
      `جلسة جرد #${session.id}${item.reason ? ` - السبب: ${item.reason}` : ""}${item.notes ? ` - ملاحظات: ${item.notes}` : ""}`
    );

      const movement = await recordInventoryMovement(dbClient, {
      tenantId: effectiveTenantId,
      productId: variant.product_id,
      variantId: productVariantId,
      branchId: session.branch_id ?? null,
      warehouseId: session.warehouse_id ?? null,
      movementType: "inventory_adjustment",
      quantityBefore: currentStock,
      quantityChange: differenceQuantity,
      quantityAfter: newStock,
      referenceType: "inventory_count",
      referenceId: session.id,
      reason: normalizeText(item.reason || session.title || "جرد مخزون") || "جرد مخزون",
      notes: movementNotes,
      createdBy: completedBy,
    });

    console.log("[inventory-count:approve:movement-created]", JSON.stringify({
      sessionId,
      itemId: item.id ?? null,
      movementId: movement?.id ?? null,
      productVariantId,
      differenceQuantity,
    }));

    await dbClient.query(
      `
      UPDATE product_variants
      SET stock = $1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [newStock, productVariantId]
    );

    console.log("[inventory-count:approve:variant-updated]", JSON.stringify({
      sessionId,
      productVariantId,
      currentStock,
      newStock,
    }));

    adjustments.push({
      variant_id: productVariantId,
      system_quantity: systemQuantity,
      counted_quantity: countedQuantity,
      difference_quantity: differenceQuantity,
    });
  }

  const sessionUpdate = await dbClient.query(
    `
    UPDATE inventory_count_sessions
    SET status = 'completed',
        completed_at = NOW(),
        completed_by = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, completedBy]
  );

  const completedSession = applyRowAliases(sessionUpdate.rows[0]);
  await logActivity(
    dbClient,
    completedBy,
    "inventory_count.approve",
    "inventory_count_session",
    session.id,
    {
      session_id: session.id,
      session_title: session.title,
      branch_id: session.branch_id ?? null,
      warehouse_id: session.warehouse_id ?? null,
      adjustments,
    }
  );

  console.log("[inventory-count:approve:done]", JSON.stringify({
    sessionId: session.id,
    completedBy,
    adjustments: adjustments.length,
  }));

  return { session: completedSession, adjustments };
  });
};

export const cancelInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status === "completed") {
    const error = new Error("Completed inventory count sessions cannot be cancelled");
    error.status = 409;
    throw error;
  }
  if (session.status === "cancelled") {
    return { session };
  }

  const cancelledBy = data.cancelledBy ?? data.cancelled_by ?? data.userId ?? data.user_id ?? null;
  const notes = normalizeText(data.notes ?? session.notes ?? "");
  const result = await dbClient.query(
    `
    UPDATE inventory_count_sessions
    SET status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = $2,
        notes = CASE
          WHEN $3::text = '' THEN notes
          ELSE TRIM(BOTH FROM CONCAT_WS(E'\n', notes, $3::text))
        END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, cancelledBy, notes]
  );

  const cancelledSession = applyRowAliases(result.rows[0]);
  await logActivity(
    dbClient,
    cancelledBy,
    "inventory_count.cancel",
    "inventory_count_session",
    session.id,
    {
      session_id: session.id,
      session_title: session.title,
      branch_id: session.branch_id ?? null,
      warehouse_id: session.warehouse_id ?? null,
      notes,
    }
  );

  return { session: cancelledSession };
  });
};

export const getInventoryCountSession = async (clientOrPool, { tenantId = null, sessionId } = {}) => {
  await ensureInventoryCountSchema();
  const session = await fetchSessionRow(clientOrPool, { tenantId, sessionId, lock: false });
  if (!session) return null;
  const items = await fetchSessionItems(clientOrPool, { tenantId, sessionId, lock: false });
  return { session, items };
};
