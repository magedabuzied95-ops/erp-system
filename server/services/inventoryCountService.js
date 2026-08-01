import db from "../database/db.js";
import {
  attachVariantImages,
  ensureProductVariantImagesSchema,
  loadProductVariantImages,
} from "./productVariantImagesService.js";
import { recordInventoryMovement } from "./inventoryMovementService.js";
import { createNotification } from "./notificationsService.js";
import logActivity from "../utils/logActivity.js";

const SESSION_STATUSES = new Set(["draft", "in_progress", "pending_review", "completed", "cancelled", "rejected"]);
const REVIEW_ROLES = new Set(["admin", "super admin", "superadmin", "super_admin", "platform admin", "manager", "branch manager"]);
export const INVENTORY_COUNT_REASONS = [
  "خطأ بيع",
  "خطأ استلام",
  "تالف",
  "فقد",
  "تسوية يدوية",
  "أخرى",
];

let schemaReadyPromise = null;
const tableColumnsCache = new Map();
const tableExistsCache = new Map();

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

const normalizeImageValue = (value = "") => {
  if (!value) return "";
  if (Array.isArray(value)) return normalizeImageValue(value[0]);
  if (typeof value === "object") {
    return normalizeImageValue(
      value.image_url ||
        value.imageUrl ||
        value.url ||
        value.path ||
        value.src ||
        value.image ||
        value.photo_url ||
        value.thumbnail_url ||
        value.secure_url ||
        ""
    );
  }
  return normalizeText(value);
};

const getTableColumns = async (client, tableName) => {
  const cacheKey = String(tableName || "");
  if (tableColumnsCache.has(cacheKey)) return tableColumnsCache.get(cacheKey);
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [cacheKey]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnsCache.set(cacheKey, columns);
  return columns;
};

const tableExists = async (client, tableName) => {
  const cacheKey = String(tableName || "");
  if (tableExistsCache.has(cacheKey)) return tableExistsCache.get(cacheKey);
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = $1
    LIMIT 1
    `,
    [cacheKey]
  );
  const exists = result.rows.length > 0;
  tableExistsCache.set(cacheKey, exists);
  return exists;
};

const firstAvailableColumnExpr = (alias, columns, candidates = [], fallback = "''") => {
  const parts = candidates
    .filter((column) => columns.has(column))
    .map((column) => `NULLIF(${alias}.${column}, '')`);
  return parts.length ? `COALESCE(${parts.join(", ")}, ${fallback})` : fallback;
};

const buildExactMatchParts = (alias, columns, fieldNames = [], paramRef = "$1") =>
  fieldNames
    .filter((fieldName) => columns.has(fieldName))
    .map((fieldName) => `LOWER(TRIM(COALESCE(${alias}.${fieldName}, ''))) = LOWER(TRIM(${paramRef}))`);

const buildLikeMatchParts = (alias, columns, fieldNames = [], paramRef = "$2") =>
  fieldNames
    .filter((fieldName) => columns.has(fieldName))
    .map((fieldName) => `COALESCE(${alias}.${fieldName}, '') ILIKE ${paramRef}`);

const buildInventoryCountVariantImageSelects = async (client, { variantAlias = "v", productAlias = "p" } = {}) => {
  const [variantColumns, productColumns, hasProductColorImages] = await Promise.all([
    getTableColumns(client, "product_variants"),
    getTableColumns(client, "products"),
    tableExists(client, "product_color_images"),
  ]);
  const productColorImageColumns = hasProductColorImages ? await getTableColumns(client, "product_color_images") : new Set();

  const productImageExpr = firstAvailableColumnExpr(
    productAlias,
    productColumns,
    ["product_image_url", "image_url", "image", "photo_url", "thumbnail_url", "main_image_url", "main_image"],
    "''"
  );

  const variantBaseImageExpr = firstAvailableColumnExpr(
    variantAlias,
    variantColumns,
    ["image_url", "image", "photo_url", "thumbnail_url", "secure_url"],
    productImageExpr
  );

  const colorImageColumnExpr = firstAvailableColumnExpr(
    variantAlias,
    variantColumns,
    ["color_image_url"],
    "''"
  );

  let productColorImageExpr = "";
  if (hasProductColorImages && productColorImageColumns.size > 0) {
    const whereParts = [];
    if (productColorImageColumns.has("product_id")) {
      whereParts.push(`pci.product_id = ${productAlias}.id`);
    }
    if (productColorImageColumns.has("variant_id")) {
      whereParts.push(`pci.variant_id = ${variantAlias}.id`);
    }

    const colorMatchParts = [];
    if (productColorImageColumns.has("color_name")) {
      colorMatchParts.push(`LOWER(TRIM(COALESCE(pci.color_name, ''))) = LOWER(TRIM(COALESCE(${variantAlias}.color, '')))`);
    }
    if (productColorImageColumns.has("color_value")) {
      colorMatchParts.push(`LOWER(TRIM(COALESCE(pci.color_value, ''))) = LOWER(TRIM(COALESCE(${variantAlias}.color, '')))`);
    }
    if (colorMatchParts.length) {
      whereParts.push(`(${colorMatchParts.join(" OR ")})`);
    }

    if (whereParts.length > 0) {
      const imageExpr = firstAvailableColumnExpr(
        "pci",
        productColorImageColumns,
        ["image_url", "image", "url", "path", "photo_url", "thumbnail_url", "secure_url"],
        "''"
      );
      const orderParts = [];
      if (productColorImageColumns.has("is_primary")) orderParts.push("pci.is_primary DESC");
      if (productColorImageColumns.has("sort_order")) orderParts.push("pci.sort_order ASC");
      if (productColorImageColumns.has("id")) orderParts.push("pci.id ASC");
      productColorImageExpr = `
        (
          SELECT ${imageExpr}
          FROM product_color_images pci
          WHERE ${whereParts.join(" AND ")}
          ${orderParts.length ? `ORDER BY ${orderParts.join(", ")}` : ""}
          LIMIT 1
        )
      `;
    }
  }

  const colorImageExpr = productColorImageExpr
    ? `COALESCE(${colorImageColumnExpr}, ${variantBaseImageExpr}, ${productColorImageExpr}, ${productImageExpr})`
    : `COALESCE(${colorImageColumnExpr}, ${variantBaseImageExpr}, ${productImageExpr})`;

  return {
    productImageExpr,
    productImageUrlExpr: productImageExpr,
    colorImageExpr,
    variantImageExpr: firstAvailableColumnExpr(
      variantAlias,
      variantColumns,
      ["variant_image_url", "image_url", "image", "photo_url", "thumbnail_url", "secure_url"],
      colorImageExpr
    ),
    imageUrlExpr: firstAvailableColumnExpr(
      variantAlias,
      variantColumns,
      ["image_url", "variant_image_url", "image", "photo_url", "thumbnail_url", "secure_url"],
      colorImageExpr
    ),
    mainImageUrlExpr: firstAvailableColumnExpr(
      variantAlias,
      variantColumns,
      ["main_image_url", "main_image"],
      colorImageExpr
    ),
    mainImageExpr: firstAvailableColumnExpr(
      variantAlias,
      variantColumns,
      ["main_image", "main_image_url"],
      colorImageExpr
    ),
    primaryImageUrlExpr: firstAvailableColumnExpr(
      variantAlias,
      variantColumns,
      ["primary_image_url", "main_image_url", "main_image"],
      colorImageExpr
    ),
  };
};

const buildInventoryCountLookupSelects = async (client, { variantAlias = "v", productAlias = "p" } = {}) => {
  const [variantColumns, productColumns] = await Promise.all([
    getTableColumns(client, "product_variants"),
    getTableColumns(client, "products"),
  ]);

  return {
    productCodeExpr: firstAvailableColumnExpr(productAlias, productColumns, ["product_code", "code"], "''"),
    variantCodeExpr: firstAvailableColumnExpr(variantAlias, variantColumns, ["product_code", "code"], "''"),
    productBarcodeLabelExpr: firstAvailableColumnExpr(productAlias, productColumns, ["barcode_label"], "''"),
    variantBarcodeLabelExpr: firstAvailableColumnExpr(variantAlias, variantColumns, ["barcode_label"], "''"),
  };
};

const resolveInventoryCountImageFields = (row = {}) => {
  const colorImage = normalizeImageValue(
    row.color_image_url ||
      row.primary_image_url ||
      row.color?.main_image_url ||
      row.color?.main_image ||
      row.color?.image_url ||
      row.color?.image ||
      row.color?.url ||
      ""
  );
  const variantImage = normalizeImageValue(
    row.variant_image_url ||
      row.image_url ||
      row.product_variant_image_url ||
      row.main_image_url ||
      row.main_image ||
      row.variant?.image_url ||
      row.variant?.main_image_url ||
      row.variant?.main_image ||
      row.variant?.image ||
      row.variant?.url ||
      ""
  );
  const productImage = normalizeImageValue(
    row.product_image ||
      row.product_image_url ||
      row.product_main_image ||
      row.product_main_image_url ||
      row.main_image ||
      row.main_image_url ||
      row.product?.image_url ||
      row.product?.main_image_url ||
      row.product?.main_image ||
      row.product?.image ||
      row.product?.url ||
      ""
  );
  const firstProductImage = normalizeImageValue(
    row.product_images?.[0] ||
      row.gallery_images?.[0] ||
      row.product?.images?.[0] ||
      row.images?.[0] ||
      row.product?.gallery_images?.[0] ||
      ""
  );
  const imageUrl = colorImage || variantImage || productImage || firstProductImage || "";
  const mainImage = normalizeImageValue(
    row.main_image ||
      row.main_image_url ||
      row.product_main_image ||
      row.product_main_image_url ||
      productImage ||
      variantImage ||
      colorImage ||
      firstProductImage ||
      ""
  );

  return {
    ...row,
    color_image_url: colorImage || variantImage || productImage || firstProductImage || "",
    variant_image_url: variantImage || colorImage || productImage || firstProductImage || "",
    product_image: productImage || "",
    product_image_url: row.product_image_url || productImage || "",
    main_image: mainImage || "",
    main_image_url: mainImage || "",
    image_url: imageUrl,
    primary_image_url: row.primary_image_url || colorImage || variantImage || productImage || firstProductImage || "",
  };
};

const hydrateInventoryCountVariants = async (clientOrPool, variants = []) => {
  const rows = Array.isArray(variants) ? variants : [];
  if (!rows.length) return [];

  const productIds = [...new Set(rows.map((row) => normalizeNullableId(row.product_id)).filter((value) => value !== null))];
  if (!productIds.length) {
    return rows.map((row) => resolveInventoryCountImageFields(row));
  }

  await ensureProductVariantImagesSchema(clientOrPool).catch((error) => {
    console.warn("[inventory-count:images] ensure product variant images schema failed", error?.message || error);
  });

  const imageBundle = await loadProductVariantImages(clientOrPool, productIds).catch((error) => {
    console.warn("[inventory-count:images] load product variant images failed", error?.message || error);
    return new Map();
  });

  return rows.map((row) => {
    const variantKey = normalizeNullableId(row.product_variant_id ?? row.variant_id ?? row.id);
    const productKey = normalizeNullableId(row.product_id);
    const bundle = productKey ? imageBundle.get(String(productKey)) || null : null;
    const hydrated = bundle ? attachVariantImages([row], bundle)[0] || row : row;
    return resolveInventoryCountImageFields({
      ...hydrated,
      product_variant_id: hydrated.product_variant_id ?? variantKey ?? null,
      product_id: hydrated.product_id ?? productKey ?? null,
    });
  });
};

const normalizeRoleName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

const isInventoryCountReviewer = (user = {}) =>
  Boolean(user?.is_super_admin) || REVIEW_ROLES.has(normalizeRoleName(user?.role || user?.role_name));

const inventoryCountSessionUrl = (sessionId) => `/inventory/count/${encodeURIComponent(String(sessionId || ""))}`;

const sendInventoryCountNotification = async (payload = {}) => {
  try {
    return await createNotification(payload);
  } catch (error) {
    console.warn("[inventory-count:notification]", error?.message || error);
    return null;
  }
};

const notifyInventoryCountSubmitted = async ({ session, actor = {} } = {}) => {
  if (!session?.id) return;
  const basePayload = {
    tenant_id: session.tenant_id ?? actor.tenantId ?? null,
    branch_id: session.branch_id ?? null,
    action_url: inventoryCountSessionUrl(session.id),
    action_label: "فتح الجرد",
    entity_type: "inventory_count_session",
    entity_id: String(session.id),
    metadata: {
      session_id: session.id,
      branch_id: session.branch_id ?? null,
      warehouse_id: session.warehouse_id ?? null,
      status: session.status,
    },
  };

  await Promise.all([
    sendInventoryCountNotification({
      ...basePayload,
      type: "inventory_count_submitted_manager",
      role_key: "manager",
      category: "inventory",
      priority: "high",
      title: "طلب اعتماد جرد جديد",
      message: `يوجد جرد جديد${session.branch_name ? ` من فرع ${session.branch_name}` : ""}${session.warehouse_name ? ` / مخزن ${session.warehouse_name}` : ""} في انتظار المراجعة.`,
    }),
    sendInventoryCountNotification({
      ...basePayload,
      type: "inventory_count_submitted_admin",
      role_key: "admin",
      category: "inventory",
      priority: "high",
      title: "طلب اعتماد جرد جديد",
      message: `يوجد جرد جديد${session.branch_name ? ` من فرع ${session.branch_name}` : ""}${session.warehouse_name ? ` / مخزن ${session.warehouse_name}` : ""} في انتظار المراجعة.`,
    }),
  ]);
};

const notifyInventoryCountCreator = async ({ session, type, title, message, actionLabel = "فتح الجرد" } = {}) => {
  const userId = session?.submitted_by ?? session?.created_by ?? null;
  if (!session?.id || !userId) return;
  await sendInventoryCountNotification({
    tenant_id: session.tenant_id ?? null,
    user_id: userId,
    branch_id: session.branch_id ?? null,
    type,
    category: "inventory",
    priority: "high",
    title,
    message,
    action_url: inventoryCountSessionUrl(session.id),
    action_label: actionLabel,
    entity_type: "inventory_count_session",
    entity_id: String(session.id),
    metadata: {
      session_id: session.id,
      branch_id: session.branch_id ?? null,
      warehouse_id: session.warehouse_id ?? null,
      status: session.status,
    },
  });
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
      submitted_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TIMESTAMP NULL,
      approved_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMP NULL,
      rejected_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      rejected_at TIMESTAMP NULL,
      rejection_reason TEXT NULL,
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
  await ensureColumn(client, "inventory_count_sessions", "submitted_by BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "submitted_at TIMESTAMP NULL");
  await ensureColumn(client, "inventory_count_sessions", "approved_by BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "approved_at TIMESTAMP NULL");
  await ensureColumn(client, "inventory_count_sessions", "rejected_by BIGINT NULL");
  await ensureColumn(client, "inventory_count_sessions", "rejected_at TIMESTAMP NULL");
  await ensureColumn(client, "inventory_count_sessions", "rejection_reason TEXT NULL");
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
  const readOnlyResult = await dbClient.query(`SELECT current_setting('transaction_read_only') AS transaction_read_only`);
  console.log("[inventory-count:create:tx]", JSON.stringify({
    transaction_read_only: readOnlyResult.rows[0]?.transaction_read_only ?? null,
  }));
  const result = await dbClient.query(
    `
    SELECT
      s.*,
      b.name AS branch_name,
      w.name AS warehouse_name,
      uc.name AS created_by_name,
      uo.name AS opened_by_name,
      uu.name AS completed_by_name,
      ux.name AS cancelled_by_name,
      us.name AS submitted_by_name,
      ua.name AS approved_by_name,
      ur.name AS rejected_by_name
    FROM inventory_count_sessions s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN users uc ON uc.id = s.created_by
    LEFT JOIN users uo ON uo.id = s.opened_by
    LEFT JOIN users uu ON uu.id = s.completed_by
    LEFT JOIN users ux ON ux.id = s.cancelled_by
    LEFT JOIN users us ON us.id = s.submitted_by
    LEFT JOIN users ua ON ua.id = s.approved_by
    LEFT JOIN users ur ON ur.id = s.rejected_by
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
  const imageSelects = await buildInventoryCountVariantImageSelects(dbClient);
  const result = await dbClient.query(
    `
    SELECT
      i.*,
      p.name AS product_name,
      ${imageSelects.productImageExpr} AS product_image,
      ${imageSelects.productImageUrlExpr} AS product_image_url,
      v.color AS variant_color,
      v.size AS variant_size,
      COALESCE(NULLIF(v.audience, ''), p.gender, '') AS gender,
      v.sku AS variant_sku,
      v.barcode AS variant_barcode,
      v.article_code AS variant_article_code,
      ${imageSelects.variantImageExpr} AS variant_image_url,
      ${imageSelects.colorImageExpr} AS color_image_url,
      ${imageSelects.imageUrlExpr} AS image_url,
      ${imageSelects.mainImageUrlExpr} AS main_image_url,
      ${imageSelects.mainImageExpr} AS main_image,
      ${imageSelects.primaryImageUrlExpr} AS primary_image_url
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
    return hydrateInventoryCountVariants(
      dbClient,
      result.rows.map((row) => applyRowAliases(row))
    );
  });
};

const fetchVariantForSession = async (clientOrPool, { tenantId, productVariantId }) => {
  return withTransaction(clientOrPool, async (dbClient) => {
  const imageSelects = await buildInventoryCountVariantImageSelects(dbClient);
  const result = await dbClient.query(
    `
    SELECT
      v.id AS product_variant_id,
      v.product_id,
      v.color,
      v.size,
      COALESCE(NULLIF(v.audience, ''), p.gender, '') AS gender,
      v.sku,
      v.barcode,
      v.article_code,
      COALESCE(v.stock, 0)::int AS stock,
      p.name AS product_name,
      ${imageSelects.productImageExpr} AS product_image,
      ${imageSelects.productImageUrlExpr} AS product_image_url,
      ${imageSelects.colorImageExpr} AS color_image_url,
      ${imageSelects.variantImageExpr} AS variant_image_url,
      ${imageSelects.imageUrlExpr} AS image_url,
      ${imageSelects.mainImageUrlExpr} AS main_image_url,
      ${imageSelects.mainImageExpr} AS main_image,
      ${imageSelects.primaryImageUrlExpr} AS primary_image_url
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.id = $1
      AND ($2::bigint IS NULL OR v.tenant_id = $2::bigint OR v.tenant_id IS NULL)
    LIMIT 1
    `,
    [productVariantId, tenantId]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return (await hydrateInventoryCountVariants(dbClient, [row]))[0] || null;
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
        us.name AS submitted_by_name,
        ua.name AS approved_by_name,
        ur.name AS rejected_by_name,
        COALESCE(items.item_count, 0)::int AS item_count,
        COALESCE(items.adjusted_items, 0)::int AS adjusted_items,
        COALESCE(items.difference_total, 0)::int AS difference_total
      FROM inventory_count_sessions s
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN users uc ON uc.id = s.created_by
      LEFT JOIN users us ON us.id = s.submitted_by
      LEFT JOIN users ua ON ua.id = s.approved_by
      LEFT JOIN users ur ON ur.id = s.rejected_by
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
  return withTransaction(clientOrPool, async (dbClient) => {
  const readOnlyResult = await dbClient.query(`SELECT current_setting('transaction_read_only') AS transaction_read_only`);
  console.log("[inventory-count:create:tx]", JSON.stringify({
    transaction_read_only: readOnlyResult.rows[0]?.transaction_read_only ?? null,
  }));
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
  });
};

export const updateInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const completedBy = data.completedBy ?? data.completed_by ?? data.userId ?? data.user_id ?? null;
  console.log("[inventory-count:update]", JSON.stringify({ tenantId, sessionId, completedBy }));
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }

  if (session.status === "pending_review" || session.status === "completed" || session.status === "cancelled") {
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

export const submitInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const submittedBy = data.submittedBy ?? data.submitted_by ?? data.userId ?? data.user_id ?? null;
  console.log("[inventory-count:submit]", JSON.stringify({ tenantId, sessionId, submittedBy }));
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status === "completed" || session.status === "cancelled") {
    const error = new Error("Finished inventory count sessions cannot be submitted");
    error.status = 409;
    throw error;
  }
  if (session.status === "pending_review") {
    return { session, submitted: false };
  }

  const result = await dbClient.query(
    `
    UPDATE inventory_count_sessions
    SET status = 'pending_review',
        submitted_by = COALESCE(submitted_by, $2),
        submitted_at = COALESCE(submitted_at, NOW()),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, submittedBy]
  );

  const submittedSession = applyRowAliases(result.rows[0]);
  await notifyInventoryCountSubmitted({ session: submittedSession, actor: { tenantId } });
  return { session: submittedSession, submitted: true };
  });
};

export const rejectInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const rejectedBy = data.rejectedBy ?? data.rejected_by ?? data.userId ?? data.user_id ?? null;
  const rejectionReason = normalizeText(data.rejectionReason ?? data.rejection_reason ?? data.reason ?? "");
  console.log("[inventory-count:reject]", JSON.stringify({ tenantId, sessionId, rejectedBy, rejectionReason }));
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status !== "pending_review") {
    const error = new Error("Only pending review sessions can be rejected");
    error.status = 409;
    throw error;
  }

  const result = await dbClient.query(
    `
    UPDATE inventory_count_sessions
    SET status = 'rejected',
        rejected_by = $2,
        rejected_at = NOW(),
        rejection_reason = $3,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, rejectedBy, rejectionReason]
  );

  const rejectedSession = applyRowAliases(result.rows[0]);
  await notifyInventoryCountCreator({
    session: rejectedSession,
    type: "inventory_count_rejected",
    title: "تم رفض الجرد",
    message: rejectionReason ? `تم رفض الجرد بسبب: ${rejectionReason}` : "تم رفض الجرد ويحتاج إلى تعديل.",
    actionLabel: "فتح الجرد",
  });
  return { session: rejectedSession, rejected: true };
  });
};

export const reopenInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const reopenedBy = data.reopenedBy ?? data.reopened_by ?? data.userId ?? data.user_id ?? null;
  console.log("[inventory-count:reopen]", JSON.stringify({ tenantId, sessionId, reopenedBy }));
  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status !== "rejected") {
    const error = new Error("Only rejected sessions can be reopened");
    error.status = 409;
    throw error;
  }

  const result = await dbClient.query(
    `
    UPDATE inventory_count_sessions
    SET status = 'draft',
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId]
  );

  const reopenedSession = applyRowAliases(result.rows[0]);
  await notifyInventoryCountCreator({
    session: reopenedSession,
    type: "inventory_count_reopened",
    title: "طھظ… ط¥ط¹ط§ط¯ط© ط¤ظپطھط­ ط§ظ„ط¬ط±ط¯",
    message: "طھظ… ط¥ط¹ط§ط¯ط© ط§ظ„ط¬ط±ط¯ ظ„ظ„طھط¹ط¯ظٹظ„ ظ…ط±ط© ط£ط®ط±ظ‰.",
    actionLabel: "ط§ظپطھط­ ط§ظ„ط¬ط±ط¯",
  });
  return { session: reopenedSession, reopened: true };
  });
};

export const searchInventoryCountVariants = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const queryText = normalizeText(data.query ?? data.search ?? data.term ?? "");
  const limit = Math.min(Math.max(toNumber(data.limit ?? 10, 10), 1), 25);

  if (!queryText) {
    return {
      items: [],
      resolvedProductId: null,
      resolvedVariantId: null,
      matchedBy: "",
      resolutionType: "",
      queryText: "",
    };
  }

  const [variantColumns, productColumns, imageSelects, lookupSelects, hasProductColorGroups] = await Promise.all([
    getTableColumns(dbClient, "product_variants"),
    getTableColumns(dbClient, "products"),
    buildInventoryCountVariantImageSelects(dbClient),
    buildInventoryCountLookupSelects(dbClient),
    tableExists(dbClient, "product_color_groups"),
  ]);

  const executeSearch = async (searchText) => {
    const like = `%${searchText}%`;
    const exactVariantParts = buildExactMatchParts("v", variantColumns, ["barcode", "sku", "article_code", "product_code", "code", "barcode_label"], "$2");
    const exactProductParts = buildExactMatchParts("p", productColumns, ["barcode", "sku", "product_code", "code", "barcode_label"], "$2");
    const likeVariantParts = buildLikeMatchParts("v", variantColumns, ["barcode", "sku", "article_code", "product_code", "code", "barcode_label"], "$3");
    const likeProductParts = buildLikeMatchParts("p", productColumns, ["barcode", "sku", "product_code", "code", "barcode_label"], "$3");
    const exactMatchParts = [...exactVariantParts, ...exactProductParts];
    const likeMatchParts = [...likeVariantParts, ...likeProductParts];
    const colorGroupIdentitySql = `
      pcg.product_id = v.product_id
      AND (
        (NULLIF(TRIM(COALESCE(v.color_group_key, '')), '') IS NOT NULL AND LOWER(TRIM(pcg.color_group_key)) = LOWER(TRIM(v.color_group_key)))
        OR LOWER(TRIM(COALESCE(pcg.color_name, ''))) = LOWER(TRIM(COALESCE(v.color, '')))
      )
    `;
    const exactColorArticleSql = hasProductColorGroups
      ? `EXISTS (
          SELECT 1
          FROM product_color_groups pcg
          WHERE ${colorGroupIdentitySql}
            AND (
              LOWER(TRIM(COALESCE(pcg.color_article_code, ''))) = LOWER(TRIM($2))
              OR EXISTS (
                SELECT 1 FROM unnest(COALESCE(pcg.article_codes, '{}'::text[])) AS article_code
                WHERE LOWER(TRIM(article_code)) = LOWER(TRIM($2))
              )
            )
        )`
      : "FALSE";
    const likeColorArticleSql = hasProductColorGroups
      ? `EXISTS (
          SELECT 1
          FROM product_color_groups pcg
          WHERE ${colorGroupIdentitySql}
            AND (
              COALESCE(pcg.color_article_code, '') ILIKE $3
              OR EXISTS (
                SELECT 1 FROM unnest(COALESCE(pcg.article_codes, '{}'::text[])) AS article_code
                WHERE article_code ILIKE $3
              )
            )
        )`
      : "FALSE";
    const effectiveArticleCodeSql = hasProductColorGroups
      ? `COALESCE(
          NULLIF(v.article_code, ''),
          (
            SELECT COALESCE(NULLIF(pcg.color_article_code, ''), pcg.article_codes[1], '')
            FROM product_color_groups pcg
            WHERE ${colorGroupIdentitySql}
            ORDER BY pcg.id ASC
            LIMIT 1
          ),
          ''
        )`
      : "COALESCE(v.article_code, '')";
    const result = await dbClient.query(
      `
      SELECT
        v.id AS product_variant_id,
        v.product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        p.barcode AS product_barcode,
        ${lookupSelects.productCodeExpr} AS product_code,
        ${lookupSelects.productBarcodeLabelExpr} AS product_barcode_label,
        v.color,
        v.size,
        COALESCE(NULLIF(v.audience, ''), p.gender, '') AS gender,
        v.sku,
        v.barcode,
        ${lookupSelects.variantCodeExpr} AS variant_code,
        ${lookupSelects.variantBarcodeLabelExpr} AS variant_barcode_label,
        ${effectiveArticleCodeSql} AS article_code,
        COALESCE(v.stock, 0)::int AS stock,
        ${imageSelects.productImageExpr} AS product_image,
        ${imageSelects.productImageUrlExpr} AS product_image_url,
        ${imageSelects.imageUrlExpr} AS image_url,
        CASE
          WHEN (${exactMatchParts.length ? exactMatchParts.join(" OR ") : "FALSE"}) OR ${exactColorArticleSql} THEN 0
          WHEN (${likeMatchParts.length ? likeMatchParts.join(" OR ") : "FALSE"}) OR ${likeColorArticleSql} THEN 1
          ELSE 2
        END AS match_rank
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
        AND (
          ${exactMatchParts.length ? exactMatchParts.join(" OR ") : "FALSE"}
          OR ${exactColorArticleSql}
          OR ${likeColorArticleSql}
          OR p.name ILIKE $3
          OR COALESCE(v.color, '') ILIKE $3
          OR COALESCE(v.size, '') ILIKE $3
        )
      ORDER BY match_rank ASC, p.name ASC, v.color ASC NULLS LAST, v.size ASC NULLS LAST, v.id ASC
      LIMIT $4
      `,
      [tenantId, searchText, like, limit]
    );

    return result.rows.map((row) => ({
      ...row,
      product_variant_id: row.product_variant_id ?? row.id,
      stock: toNumber(row.stock, 0),
    }));
  };

  const findExactRow = (rows, searchText) => {
    const normalizedSearch = normalizeText(searchText).toLowerCase();
    return rows.find((row) => Number(row.match_rank) === 0 && [
      row.barcode,
      row.sku,
      row.article_code,
      row.variant_code,
      row.product_barcode,
      row.product_sku,
      row.product_code,
      row.product_barcode_label,
      row.variant_barcode_label,
    ].some((value) => normalizeText(value).toLowerCase() === normalizedSearch));
  };

  let rows = await executeSearch(queryText);
  let exactRow = findExactRow(rows, queryText);
  let matchedBy = exactRow
    ? [
        [exactRow.barcode, "variant.barcode"],
        [exactRow.sku, "variant.sku"],
        [exactRow.article_code, "variant.article_code"],
        [exactRow.variant_code, "variant.product_code"],
        [exactRow.variant_code, "variant.code"],
        [exactRow.variant_barcode_label, "variant.barcode_label"],
        [exactRow.product_barcode, "product.barcode"],
        [exactRow.product_sku, "product.sku"],
        [exactRow.product_code, "product.product_code"],
        [exactRow.product_code, "product.code"],
        [exactRow.product_barcode_label, "product.barcode_label"],
      ].find(([value]) => normalizeText(value).toLowerCase() === normalizeText(queryText).toLowerCase())?.[1] || "unknown"
    : "";

  const digitsOnly = String(queryText).replace(/\D/g, "");
  if (!exactRow && digitsOnly.length === 13) {
    const fallbackQuery = digitsOnly.slice(0, -1);
    const fallbackRows = await executeSearch(fallbackQuery);
    const fallbackExactRow = findExactRow(fallbackRows, fallbackQuery);
    if (fallbackExactRow) {
      rows = fallbackRows;
      exactRow = fallbackExactRow;
      matchedBy = "barcode_without_check_digit";
      console.log("[inventory-count:lookup:fallback]", {
        scannedCode: queryText,
        fallbackQuery,
        productVariantId: fallbackExactRow.product_variant_id ?? fallbackExactRow.id ?? null,
      });
    }
  }

  if (exactRow) {
    console.log("[inventory-count:lookup:exact]", {
      scannedCode: queryText,
      matchedBy,
      productVariantId: exactRow.product_variant_id ?? exactRow.id ?? null,
    });
  }

  const items = exactRow?.product_id
    ? await fetchInventoryCountProductVariants(dbClient, {
        tenantId,
        productId: exactRow.product_id,
      })
    : await hydrateInventoryCountVariants(dbClient, rows);

  return {
    items,
    resolvedProductId: exactRow?.product_id ?? null,
    resolvedVariantId: exactRow?.product_variant_id ?? exactRow?.id ?? null,
    matchedBy,
    resolutionType: exactRow ? (String(matchedBy).startsWith("product.") ? "product" : "variant") : "",
    expandedProduct: Boolean(exactRow?.product_id),
    queryText,
  };
};

const fetchInventoryCountProductVariants = async (dbClient, { tenantId, productId }) => {
  const imageSelects = await buildInventoryCountVariantImageSelects(dbClient);
  const hasProductColorGroups = await tableExists(dbClient, "product_color_groups");
  const effectiveArticleCodeSql = hasProductColorGroups
    ? `COALESCE(
        NULLIF(v.article_code, ''),
        (
          SELECT COALESCE(NULLIF(pcg.color_article_code, ''), pcg.article_codes[1], '')
          FROM product_color_groups pcg
          WHERE pcg.product_id = v.product_id
            AND (
              (NULLIF(TRIM(COALESCE(v.color_group_key, '')), '') IS NOT NULL AND LOWER(TRIM(pcg.color_group_key)) = LOWER(TRIM(v.color_group_key)))
              OR LOWER(TRIM(COALESCE(pcg.color_name, ''))) = LOWER(TRIM(COALESCE(v.color, '')))
            )
          ORDER BY pcg.id ASC
          LIMIT 1
        ),
        ''
      )`
    : "COALESCE(v.article_code, '')";
  const result = await dbClient.query(
    `
    SELECT
      v.id AS product_variant_id,
      v.product_id,
      p.name AS product_name,
      p.sku AS product_sku,
      p.barcode AS product_barcode,
      v.color,
      v.size,
      COALESCE(NULLIF(v.audience, ''), p.gender, '') AS gender,
      v.sku,
      v.barcode,
      ${effectiveArticleCodeSql} AS article_code,
      COALESCE(v.stock, 0)::int AS stock,
      ${imageSelects.productImageExpr} AS product_image,
      ${imageSelects.productImageUrlExpr} AS product_image_url,
      ${imageSelects.colorImageExpr} AS color_image_url,
      ${imageSelects.variantImageExpr} AS variant_image_url,
      ${imageSelects.imageUrlExpr} AS image_url,
      ${imageSelects.mainImageUrlExpr} AS main_image_url,
      ${imageSelects.mainImageExpr} AS main_image,
      ${imageSelects.primaryImageUrlExpr} AS primary_image_url
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
      AND v.product_id = $2
    ORDER BY COALESCE(NULLIF(v.color, ''), ''), COALESCE(NULLIF(v.size, ''), ''), v.id ASC
    `,
    [tenantId, productId]
  );

  return hydrateInventoryCountVariants(
    dbClient,
    result.rows.map((row) => ({
      ...row,
      product_variant_id: row.product_variant_id ?? row.id,
      stock: toNumber(row.stock, 0),
    }))
  );
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
  if (session.status === "pending_review" || session.status === "completed" || session.status === "cancelled") {
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
    item: resolveInventoryCountImageFields(
      applyRowAliases({
        ...itemRow,
        product_name: variant.product_name,
        variant_color: variant.color,
        variant_size: variant.size,
        variant_sku: variant.sku,
        variant_barcode: variant.barcode,
        variant_article_code: variant.article_code,
        variant_image_url: variant.image_url,
        color_image_url: variant.color_image_url || variant.primary_image_url || variant.variant_image_url || variant.image_url || "",
        product_image: variant.product_image || variant.product_image_url || "",
        product_image_url: variant.product_image_url || variant.product_image || "",
        main_image: variant.main_image || variant.product_image || variant.image_url || variant.variant_image_url || "",
        main_image_url: variant.main_image_url || variant.main_image || variant.product_image_url || variant.product_image || variant.image_url || "",
        primary_image_url: variant.primary_image_url || variant.color_image_url || variant.variant_image_url || variant.image_url || "",
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
      })
    ),
  };
  });
};

export const addProductModelToCount = async (clientOrPool, data = {}) => {
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
  let productId = normalizeNullableId(data.productId ?? data.product_id ?? data.productID ?? data.product);
  const scanValue = normalizeText(data.scanValue ?? data.query ?? data.search ?? data.term ?? "");

  if (!sessionId) {
    const error = new Error("Inventory count session is required");
    error.status = 400;
    throw error;
  }
  if (!productId) {
    if (!scanValue) {
      const error = new Error("productId is required");
      error.status = 400;
      throw error;
    }
    const resolved = await searchInventoryCountVariants(dbClient, {
      tenantId,
      query: scanValue,
      limit: 25,
    });
    productId = normalizeNullableId(resolved?.resolvedProductId);
    console.log("[inventory-count:add-model:resolve]", JSON.stringify({
      sessionId,
      scanValue,
      resolvedProductId: productId,
      resolvedVariantId: resolved?.resolvedVariantId ?? null,
      matchedBy: resolved?.matchedBy || "",
      resolutionType: resolved?.resolutionType || "",
    }));
    if (!productId) {
      const error = new Error("productId is required");
      error.status = 400;
      throw error;
    }
  }

  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status === "pending_review" || session.status === "completed" || session.status === "cancelled") {
    const error = new Error("Cannot modify a finished inventory count session");
    error.status = 409;
    throw error;
  }

  const variants = await fetchInventoryCountProductVariants(dbClient, { tenantId, productId });
  console.log("[inventory-count:add-model]", JSON.stringify({
    sessionId,
    productId,
    variantCount: variants.length,
    scanValue,
  }));
  if (!variants.length) {
    const error = new Error("Product not found");
    error.status = 404;
    throw error;
  }

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
    SELECT DISTINCT COALESCE(product_variant_id, variant_id) AS variant_key
    FROM inventory_count_items
    WHERE (inventory_count_session_id = $1 OR inventory_count_id = $1)
      AND product_id = $2
    `,
    [sessionId, productId]
  );
  const existingVariantIds = new Set(
    existingResult.rows
      .map((row) => normalizeNullableId(row.variant_key))
      .filter((value) => value !== null)
      .map((value) => String(value))
  );

  const insertedVariants = [];
  for (const variant of variants) {
    const variantId = normalizeNullableId(variant.product_variant_id ?? variant.variant_id ?? variant.id);
    if (!variantId || existingVariantIds.has(String(variantId))) continue;
    const systemQuantity = toNumber(variant.stock, 0);
    const differenceQuantity = 0 - systemQuantity;
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
        0,
        differenceQuantity,
        "",
        "",
      ]
    );
    insertedVariants.push(
      resolveInventoryCountImageFields({
        ...applyRowAliases({
          ...result.rows[0],
          product_name: variant.product_name,
          variant_color: variant.color,
          variant_size: variant.size,
          variant_sku: variant.sku,
          variant_barcode: variant.barcode,
          variant_article_code: variant.article_code,
          variant_image_url: variant.variant_image_url || variant.image_url || "",
          color_image_url: variant.color_image_url || variant.primary_image_url || variant.variant_image_url || variant.image_url || "",
          product_image: variant.product_image || variant.product_image_url || "",
          product_image_url: variant.product_image_url || variant.product_image || "",
          main_image: variant.main_image || variant.product_image || variant.image_url || variant.variant_image_url || "",
          main_image_url: variant.main_image_url || variant.main_image || variant.product_image_url || variant.product_image || variant.image_url || "",
          image_url: variant.image_url || variant.variant_image_url || variant.product_image || variant.product_image_url || "",
          primary_image_url: variant.primary_image_url || variant.color_image_url || variant.variant_image_url || variant.image_url || "",
          product_variant_id: variantId,
          product_id: variant.product_id,
          system_quantity: systemQuantity,
          counted_quantity: 0,
          difference_quantity: differenceQuantity,
          expected_qty: systemQuantity,
          actual_qty: 0,
          difference_qty: differenceQuantity,
        }),
        product_variant_id: variantId,
        product_id: variant.product_id,
        system_quantity: systemQuantity,
        counted_quantity: 0,
        difference_quantity: differenceQuantity,
        expected_qty: systemQuantity,
        actual_qty: 0,
        difference_qty: differenceQuantity,
      })
    );
    existingVariantIds.add(String(variantId));
  }

  const updatedSession = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: false });
  const updatedItems = await fetchSessionItems(dbClient, { tenantId, sessionId, lock: false });

  return {
    session: updatedSession,
    items: updatedItems,
    insertedCount: insertedVariants.length,
    skippedCount: Math.max(variants.length - insertedVariants.length, 0),
  };
  });
};

export const deleteInventoryCountColorGroup = async (clientOrPool, data = {}) => {
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
  const productId = normalizeNullableId(data.productId ?? data.product_id ?? data.productID ?? data.product);
  const color = normalizeText(data.color ?? data.colorName ?? data.color_name ?? data.variantColor ?? data.groupColor ?? "");

  if (!sessionId) {
    const error = new Error("Inventory count session is required");
    error.status = 400;
    throw error;
  }
  if (!productId || !color) {
    const error = new Error("productId and color are required");
    error.status = 400;
    throw error;
  }

  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }
  if (session.status === "pending_review" || session.status === "completed" || session.status === "cancelled") {
    const error = new Error("Cannot modify a finished inventory count session");
    error.status = 409;
    throw error;
  }

  const matchingResult = await dbClient.query(
    `
    SELECT i.id
    FROM inventory_count_items i
    WHERE (i.inventory_count_session_id = $1 OR i.inventory_count_id = $1)
      AND i.product_id = $2
      AND EXISTS (
        SELECT 1
        FROM product_variants v
        WHERE v.id = COALESCE(i.product_variant_id, i.variant_id)
          AND LOWER(TRIM(COALESCE(v.color, ''))) = LOWER(TRIM($3))
      )
    `,
    [sessionId, productId, color]
  );

  const itemIds = matchingResult.rows
    .map((row) => normalizeNullableId(row.id))
    .filter((value) => value !== null);

  if (itemIds.length) {
    await dbClient.query(
      `
      DELETE FROM inventory_count_items
      WHERE id = ANY($1::bigint[])
      `,
      [itemIds]
    );
  }

  const updatedSession = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: false });
  const remainingItems = await fetchSessionItems(dbClient, { tenantId, sessionId, lock: false });

  return {
    session: updatedSession,
    items: remainingItems,
    deletedCount: itemIds.length,
  };
  });
};

export const deleteInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = normalizeNullableId(
    data.sessionId ?? data.session_id ?? data.inventoryCountId ?? data.inventory_count_id ?? data.inventoryCountSessionId ?? data.inventory_count_session_id
  );
  const deletedBy = data.deletedBy ?? data.deleted_by ?? data.userId ?? data.user_id ?? null;

  if (!sessionId) {
    const error = new Error("Inventory count session is required");
    error.status = 400;
    throw error;
  }

  const session = await fetchSessionRow(dbClient, { tenantId, sessionId, lock: true });
  if (!session) {
    const error = new Error("Inventory count session not found");
    error.status = 404;
    throw error;
  }

  if (session.status === "completed") {
    const error = new Error("Completed inventory count sessions cannot be deleted");
    error.status = 409;
    throw error;
  }

  const countResult = await dbClient.query(
    `
    SELECT COUNT(*)::int AS item_count
    FROM inventory_count_items
    WHERE inventory_count_session_id = $1
       OR inventory_count_id = $1
    `,
    [sessionId]
  );
  const deletedItemsCount = Number(countResult.rows[0]?.item_count || 0);

  if (deletedItemsCount > 0) {
    await dbClient.query(
      `
      DELETE FROM inventory_count_items
      WHERE inventory_count_session_id = $1
         OR inventory_count_id = $1
      `,
      [sessionId]
    );
  }

  const deletedSessionResult = await dbClient.query(
    `
    DELETE FROM inventory_count_sessions
    WHERE id = $1
    RETURNING *
    `,
    [sessionId]
  );

  const deletedSession = applyRowAliases(deletedSessionResult.rows[0] || session);

  await logActivity(
    dbClient,
    deletedBy,
    "inventory_count.delete",
    "inventory_count_session",
    session.id,
    {
      session_id: session.id,
      session_title: session.title,
      branch_id: session.branch_id ?? null,
      warehouse_id: session.warehouse_id ?? null,
      deleted_items_count: deletedItemsCount,
      status: session.status,
    }
  );

  return {
    session: deletedSession,
    deletedItemsCount,
    deleted: true,
  };
  });
};

export const approveInventoryCountSession = async (clientOrPool, data = {}) => {
  await ensureInventoryCountSchema();
  return withTransaction(clientOrPool, async (dbClient) => {
  const tenantId = data.tenantId ?? data.tenant_id ?? null;
  const sessionId = data.sessionId ?? data.session_id;
  const approvedBy = data.approvedBy ?? data.approved_by ?? data.completedBy ?? data.completed_by ?? data.userId ?? data.user_id ?? null;
  const actor = data.user || data.actor || {};
  console.log("[inventory-count:approve:start]", JSON.stringify({ tenantId, sessionId, approvedBy, actorRole: actor?.role || actor?.role_name || null }));
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
  if (session.status !== "pending_review") {
    const error = new Error("Inventory count session must be submitted for review before approval");
    error.status = 409;
    throw error;
  }
  if (!isInventoryCountReviewer(actor)) {
    const error = new Error("Manager approval required");
    error.status = 403;
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
      movementType: "COUNT_ADJUSTMENT",
      quantityDelta: differenceQuantity,
      referenceType: "inventory_count",
      referenceId: session.id,
      reason: normalizeText(item.reason || session.title || "جرد مخزون") || "جرد مخزون",
      notes: movementNotes,
      createdBy: approvedBy,
    });

    console.log("[inventory-count:approve:movement-created]", JSON.stringify({
      sessionId,
      itemId: item.id ?? null,
      movementId: movement?.id ?? null,
      productVariantId,
      differenceQuantity,
    }));

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
        approved_by = COALESCE(approved_by, $2),
        approved_at = COALESCE(approved_at, NOW()),
        completed_at = COALESCE(completed_at, NOW()),
        completed_by = COALESCE(completed_by, $2),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, approvedBy]
  );

  const completedSession = applyRowAliases(sessionUpdate.rows[0]);
  await logActivity(
    dbClient,
    approvedBy,
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

  await notifyInventoryCountCreator({
    session: completedSession,
    type: "inventory_count_approved",
    title: "تم اعتماد الجرد",
    message: "تم اعتماد الجرد وتحديث المخزون.",
    actionLabel: "فتح الجرد",
  });

  console.log("[inventory-count:approve:done]", JSON.stringify({
    sessionId: session.id,
    approvedBy,
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
