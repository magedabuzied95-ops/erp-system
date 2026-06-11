import db from "../database/db.js";
import { sendEmployeePortalPush } from "./employeePortalPushService.js";

const SALES_OPPORTUNITY_TTL_MS = 24 * 60 * 60 * 1000;
const tableColumnsCache = new Map();
const SALES_OPPORTUNITY_TYPES = {
  LAST_ONE: {
    badge: "آخر قطعة",
    title: "فرصة بيع",
  },
  LAST_TWO: {
    badge: "آخر قطعتين",
    title: "فرصة بيع",
  },
  LAST_SIZE: {
    badge: "آخر مقاس",
    title: "فرصة بيع",
  },
};

const clean = (value = "") => String(value || "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};
const toPositiveInt = (value, fallback = 0) => {
  const parsed = toInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
};
const firstNonEmpty = (...values) => values.map((value) => clean(value)).find(Boolean) || "";
const opportunityKey = ({ tenantId, branchId, productVariantId, type }) => `${tenantId || 0}:${branchId || 0}:${productVariantId || 0}:${type || ""}`;
const imageSourceName = (row = {}) => {
  if (clean(row.variant_image_url)) return "variant";
  if (clean(row.color_image_url)) return "color";
  if (clean(row.product_image_url)) return "product";
  return "";
};
const opportunityTypeMeta = (type = "") => SALES_OPPORTUNITY_TYPES[type] || SALES_OPPORTUNITY_TYPES.LAST_ONE;
const normalizeMetadata = (value = {}) => {
  if (!value || typeof value !== "object") return {};
  return value;
};
const tableColumns = async (clientOrPool = db, tableName = "") => {
  const safeTableName = clean(tableName).toLowerCase();
  if (!safeTableName) return new Set();
  if (tableColumnsCache.has(safeTableName)) return tableColumnsCache.get(safeTableName);
  const client = clientOrPool || db;
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [safeTableName]
  );
  const columns = new Set((result.rows || []).map((row) => clean(row.column_name).toLowerCase()).filter(Boolean));
  tableColumnsCache.set(safeTableName, columns);
  return columns;
};

const ensureSalesOpportunitySchema = async (clientOrPool = db) => {
  const client = clientOrPool || db;
  await client.query(`
    CREATE TABLE IF NOT EXISTS sales_opportunities (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      product_variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      type VARCHAR(40) NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      stock_snapshot INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NULL,
      notification_sent_at TIMESTAMP NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS product_id BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS product_variant_id BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS type VARCHAR(40) NOT NULL DEFAULT 'LAST_ONE'`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS stock_snapshot INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS sales_opportunities ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_opportunities_active_scope
    ON sales_opportunities (tenant_id, COALESCE(branch_id, 0), product_variant_id, type)
    WHERE is_active = TRUE
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_opportunities_scope_status ON sales_opportunities (tenant_id, branch_id, is_active, expires_at DESC, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_opportunities_variant_type ON sales_opportunities (tenant_id, product_variant_id, type)`);
};

const normalizeOpportunityRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  branch_id: row.branch_id,
  branch_name: row.branch_name || "",
  product_id: row.product_id,
  product_variant_id: row.product_variant_id,
  type: row.type,
  badge_label: opportunityTypeMeta(row.type).badge,
  title: row.title || opportunityTypeMeta(row.type).title,
  message: row.message || "",
  product_name: row.product_name || "",
  color: row.color || "",
  size: row.size || "",
  stock_snapshot: toInt(row.stock_snapshot, 0),
  image_url: row.image_url || "",
  is_active: Boolean(row.is_active),
  created_at: row.created_at,
  expires_at: row.expires_at,
  notification_sent_at: row.notification_sent_at,
  metadata: normalizeMetadata(row.metadata),
});

const buildOpportunityMessage = ({ type, productName, color, size, stockSnapshot } = {}) => {
  const safeProduct = productName || "منتج";
  const safeColor = color ? ` - ${color}` : "";
  if (type === "LAST_SIZE") {
    return `باقي آخر مقاس متاح من ${safeProduct}${safeColor}${size ? ` وهو مقاس ${size}` : ""}.`;
  }
  const stockText = type === "LAST_ONE" ? "آخر قطعة" : "آخر قطعتين";
  return `باقي ${stockText}${size ? ` مقاس ${size}` : ""} من ${safeProduct}${safeColor}.`;
};

const buildOpportunityCandidate = (row = {}, type = "LAST_ONE", metadata = {}) => {
  const productName = firstNonEmpty(row.product_name, row.name, "منتج");
  const color = firstNonEmpty(row.color, "بدون لون");
  const size = firstNonEmpty(row.size, "بدون مقاس");
  const stockSnapshot = Math.max(0, toInt(row.stock_snapshot ?? row.stock, 0));
  return {
    tenantId: row.tenant_id,
    branchId: row.branch_id || null,
    branchName: row.branch_name || "",
    productId: row.product_id,
    productVariantId: row.product_variant_id,
    type,
    title: opportunityTypeMeta(type).title,
    message: buildOpportunityMessage({ type, productName, color, size, stockSnapshot }),
    productName,
    color,
    size,
    stockSnapshot,
    imageUrl: firstNonEmpty(row.image_url, row.variant_image_url, row.color_image_url, row.product_image_url),
    metadata: {
      ...metadata,
      image_url: firstNonEmpty(row.image_url, row.variant_image_url, row.color_image_url, row.product_image_url),
      image_source: imageSourceName(row),
      branch_name: row.branch_name || "",
    },
  };
};

const buildOpportunityCandidates = (rows = []) => {
  const groups = new Map();

  for (const row of rows) {
    const tenantId = toPositiveInt(row.tenant_id, 0);
    const branchId = toPositiveInt(row.branch_id, 0);
    const productId = toPositiveInt(row.product_id, 0);
    const productVariantId = toPositiveInt(row.product_variant_id, 0);
    if (!tenantId || !branchId || !productId || !productVariantId) continue;

    const colorKey = lower(row.color);
    const key = `${tenantId}:${branchId}:${productId}:${colorKey}`;
    const current = groups.get(key) || {
      tenant_id: tenantId,
      branch_id: branchId,
      branch_name: row.branch_name || "",
      product_id: productId,
      product_name: firstNonEmpty(row.product_name, row.name, "منتج"),
      color: firstNonEmpty(row.color, ""),
      rows: [],
    };

    current.rows.push({
      tenant_id: tenantId,
      branch_id: branchId,
      branch_name: row.branch_name || "",
      product_id: productId,
      product_variant_id: productVariantId,
      product_name: firstNonEmpty(row.product_name, row.name, "منتج"),
      color: firstNonEmpty(row.color, ""),
      size: firstNonEmpty(row.size, ""),
      stock_snapshot: Math.max(0, toInt(row.stock_snapshot ?? row.stock, 0)),
      image_url: firstNonEmpty(row.image_url, row.variant_image_url, row.color_image_url, row.product_image_url),
      variant_image_url: firstNonEmpty(row.variant_image_url, ""),
      color_image_url: firstNonEmpty(row.color_image_url, ""),
      product_image_url: firstNonEmpty(row.product_image_url, ""),
    });

    groups.set(key, current);
  }

  const candidates = [];
  for (const group of groups.values()) {
    const positiveRows = group.rows.filter((row) => row.stock_snapshot > 0);
    const uniqueSizes = [...new Set(group.rows.map((row) => lower(row.size)).filter(Boolean))];
    const sizeStats = group.rows.map((row) => ({ size: row.size, stock: row.stock_snapshot })).filter((row) => row.size);
    const groupStock = group.rows.reduce((sum, row) => sum + row.stock_snapshot, 0);

    if (positiveRows.length === 1 && uniqueSizes.length > 1 && positiveRows[0].stock_snapshot <= 2) {
      const row = positiveRows[0];
      candidates.push(
        buildOpportunityCandidate(row, "LAST_SIZE", {
          size_options: sizeStats,
          positive_sizes: positiveRows.map((item) => item.size),
          group_stock: groupStock,
          group_size_count: uniqueSizes.length,
          qualifying_variant_id: row.product_variant_id,
        })
      );
      continue;
    }

    for (const row of group.rows) {
      if (row.stock_snapshot === 1) {
        candidates.push(
          buildOpportunityCandidate(row, "LAST_ONE", {
            size_options: sizeStats,
            group_stock: groupStock,
            group_size_count: uniqueSizes.length,
          })
        );
      } else if (row.stock_snapshot === 2) {
        candidates.push(
          buildOpportunityCandidate(row, "LAST_TWO", {
            size_options: sizeStats,
            group_stock: groupStock,
            group_size_count: uniqueSizes.length,
          })
        );
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = opportunityKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
};

const loadCurrentStockRows = async ({ clientOrPool = db, tenantId = null, branchId = null } = {}) => {
  const client = clientOrPool || db;
  const [inventoryColumns, warehouseColumns] = await Promise.all([
    tableColumns(client, "warehouse_inventory"),
    tableColumns(client, "warehouses"),
  ]);
  const inventoryHasBranchId = inventoryColumns.has("branch_id");
  const warehouseHasBranchId = warehouseColumns.has("branch_id");
  const warehouseHasBranchName = warehouseColumns.has("branch_name");
  const resolvedBranchIdExpr = inventoryHasBranchId
    ? "wi.branch_id"
    : warehouseHasBranchId
      ? "w.branch_id"
      : warehouseHasBranchName
        ? "resolved_branch.id"
        : "NULL::bigint";
  const resolvedBranchNameExpr = inventoryHasBranchId
    ? "resolved_branch.name"
    : warehouseHasBranchId
      ? "resolved_branch.name"
      : warehouseHasBranchName
        ? "COALESCE(resolved_branch.name, w.branch_name)"
        : "''::text";
  const params = [tenantId];
  const branchClause = branchId ? (params.push(branchId), ` AND ${resolvedBranchIdExpr} = $${params.length}::bigint`) : "";
  try {
    const result = await client.query(
      `
    SELECT
      ${resolvedBranchIdExpr} AS branch_id,
      ${resolvedBranchNameExpr} AS branch_name,
      v.product_id,
      v.id AS product_variant_id,
      p.name AS product_name,
      COALESCE(NULLIF(v.color, ''), '') AS color,
      COALESCE(NULLIF(v.size, ''), '') AS size,
      COALESCE(SUM(COALESCE(wi.stock, 0)), 0)::int AS stock_snapshot,
      COALESCE(
        NULLIF(v.image_url, ''),
        NULLIF(color_image.image_url, ''),
        NULLIF(p.image_url, ''),
        NULLIF(p.image, ''),
        NULLIF(p.photo_url, ''),
        NULLIF(p.thumbnail_url, ''),
        ''
      ) AS image_url,
      COALESCE(NULLIF(color_image.image_url, ''), '') AS color_image_url,
      COALESCE(NULLIF(v.image_url, ''), '') AS variant_image_url,
      COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS product_image_url
    FROM warehouse_inventory wi
    JOIN warehouses w ON w.id = wi.warehouse_id
    JOIN product_variants v ON v.id = wi.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN branches resolved_branch ON ${
      inventoryHasBranchId
        ? "resolved_branch.id = wi.branch_id"
        : warehouseHasBranchId
          ? "resolved_branch.id = w.branch_id"
          : warehouseHasBranchName
            ? "LOWER(TRIM(COALESCE(resolved_branch.name, ''))) = LOWER(TRIM(COALESCE(w.branch_name, '')))"
            : "FALSE"
    }
      AND ($1::bigint IS NULL OR resolved_branch.tenant_id = $1::bigint)
    LEFT JOIN LATERAL (
      SELECT pi.image_url
      FROM product_variant_images pi
      WHERE pi.product_id = p.id
        AND (
          pi.variant_id = v.id
          OR LOWER(TRIM(COALESCE(pi.color_name, ''))) = LOWER(TRIM(COALESCE(v.color, '')))
        )
      ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC
      LIMIT 1
    ) color_image ON TRUE
    WHERE ($1::bigint IS NULL OR wi.tenant_id = $1::bigint)
      AND COALESCE(wi.stock, 0) > 0
      AND ${resolvedBranchIdExpr} IS NOT NULL
      ${branchClause}
      AND COALESCE(v.is_active, TRUE) = TRUE
      AND v.deleted_at IS NULL
      AND COALESCE(p.is_active, TRUE) = TRUE
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
    GROUP BY
      ${resolvedBranchIdExpr},
      ${resolvedBranchNameExpr},
      v.product_id,
      v.id,
      p.name,
      v.color,
      v.size,
      v.image_url,
      color_image.image_url,
      p.image_url,
      p.image,
      p.photo_url,
      p.thumbnail_url
    ORDER BY ${resolvedBranchIdExpr} ASC, p.name ASC, v.color ASC NULLS LAST, v.size ASC NULLS LAST, v.id ASC
    `,
      params
    );

    return Array.isArray(result.rows) ? result.rows : [];
  } catch (error) {
    console.error("[sales-opportunity] loadCurrentStockRows failed", {
      route: "employee-portal-sales-opportunities",
      tenantId: tenantId ?? null,
      branchId: branchId ?? null,
      inventoryHasBranchId,
      warehouseHasBranchId,
      warehouseHasBranchName,
      error: error?.message || String(error),
    });
    throw error;
  }
};

const loadBranchEmployees = async ({ clientOrPool = db, tenantId = null, branchId = null } = {}) => {
  if (!tenantId || !branchId) return [];
  const client = clientOrPool || db;
  const result = await client.query(
    `
    SELECT id, tenant_id, branch_id, full_name, employee_portal_token
    FROM employees
    WHERE tenant_id = $1::bigint
      AND branch_id = $2::bigint
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND NULLIF(employee_portal_token, '') IS NOT NULL
      AND COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'active') NOT IN ('inactive', 'disabled', 'deleted', 'terminated')
    ORDER BY LOWER(COALESCE(full_name, '')) ASC, id ASC
    `,
    [tenantId, branchId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
};

const parseSalesOpportunityMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata;
};

const loadActiveSalesOpportunities = async ({ clientOrPool = db, tenantId = null, branchId = null } = {}) => {
  const client = clientOrPool || db;
  const params = [tenantId];
  const branchClause = branchId ? (params.push(branchId), ` AND so.branch_id = $${params.length}::bigint`) : "";
  const result = await client.query(
    `
    SELECT
      so.*,
      b.name AS branch_name,
      COALESCE(NULLIF(so.metadata, '{}'::jsonb), '{}'::jsonb) AS metadata
    FROM sales_opportunities so
    LEFT JOIN branches b ON b.id = so.branch_id
    WHERE ($1::bigint IS NULL OR so.tenant_id = $1::bigint)
      ${branchClause}
      AND so.is_active = TRUE
      AND (so.expires_at IS NULL OR so.expires_at > NOW())
    ORDER BY so.created_at DESC, so.id DESC
    `,
    params
  );
  return (result.rows || []).map((row) => normalizeOpportunityRow({
    ...row,
    metadata: parseSalesOpportunityMetadata(row.metadata),
  }));
};

const upsertSalesOpportunity = async (client, candidate, currentTimestamp) => {
  const existingResult = await client.query(
    `
    SELECT *
    FROM sales_opportunities
    WHERE tenant_id = $1::bigint
      AND COALESCE(branch_id, 0) = COALESCE($2::bigint, 0)
      AND product_variant_id = $3::bigint
      AND type = $4
      AND is_active = TRUE
    FOR UPDATE
    `,
    [candidate.tenantId, candidate.branchId, candidate.productVariantId, candidate.type]
  );

  const existing = existingResult.rows[0] || null;
  const shouldSend = !existing?.notification_sent_at || (new Date(currentTimestamp).getTime() - new Date(existing.notification_sent_at).getTime() >= SALES_OPPORTUNITY_TTL_MS);
  const expiresAt = new Date(new Date(currentTimestamp).getTime() + SALES_OPPORTUNITY_TTL_MS);
  const baseValues = [
    candidate.tenantId,
    candidate.branchId,
    candidate.productId,
    candidate.productVariantId,
    candidate.type,
    candidate.title,
    candidate.message,
    candidate.productName,
    candidate.color,
    candidate.size,
    candidate.stockSnapshot,
    expiresAt.toISOString(),
    shouldSend ? currentTimestamp : existing?.notification_sent_at || null,
    JSON.stringify(candidate.metadata || {}),
  ];

  if (existing) {
    const updateResult = await client.query(
      `
      UPDATE sales_opportunities
      SET branch_id = $2::bigint,
          product_id = $3::bigint,
          product_variant_id = $4::bigint,
          type = $5,
          title = $6,
          message = $7,
          product_name = $8,
          color = $9,
          size = $10,
          stock_snapshot = $11::int,
          expires_at = $12::timestamp,
          notification_sent_at = $13::timestamp,
          metadata = $14::jsonb,
          is_active = TRUE
      WHERE id = $15::bigint
      RETURNING *
      `,
      [...baseValues, existing.id]
    );
    return { opportunity: updateResult.rows[0] || existing, shouldSend };
  }

  try {
    const insertResult = await client.query(
      `
      INSERT INTO sales_opportunities (
        tenant_id,
        branch_id,
        product_id,
        product_variant_id,
        type,
        title,
        message,
        product_name,
        color,
        size,
        stock_snapshot,
        is_active,
        expires_at,
        notification_sent_at,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12::timestamp,$13::timestamp,$14::jsonb)
      RETURNING *
      `,
      baseValues
    );
    return { opportunity: insertResult.rows[0], shouldSend };
  } catch (error) {
    if (String(error?.code) !== "23505") throw error;
    const retryResult = await client.query(
      `
      SELECT *
      FROM sales_opportunities
      WHERE tenant_id = $1::bigint
        AND COALESCE(branch_id, 0) = COALESCE($2::bigint, 0)
        AND product_variant_id = $3::bigint
        AND type = $4
        AND is_active = TRUE
      LIMIT 1
      `,
      [candidate.tenantId, candidate.branchId, candidate.productVariantId, candidate.type]
    );
    if (retryResult.rows[0]) {
      return {
        opportunity: retryResult.rows[0],
        shouldSend,
      };
    }
    throw error;
  }
};

export const syncSalesOpportunities = async ({ tenantId = null, branchId = null, clientOrPool = db } = {}) => {
  if (!tenantId) {
    return { opportunities: [], activeCount: 0, sentCount: 0, deactivatedCount: 0 };
  }

  await ensureSalesOpportunitySchema(clientOrPool);
  const client = typeof clientOrPool?.query === "function" && typeof clientOrPool?.release === "function" ? clientOrPool : await db.connect();
  const shouldRelease = client !== clientOrPool;
  const now = new Date();
  const nowIso = now.toISOString();
  const sendQueue = [];

  try {
    await client.query("BEGIN");
    const stockRows = await loadCurrentStockRows({ clientOrPool: client, tenantId, branchId });
    const candidates = buildOpportunityCandidates(stockRows);
    const candidateKeys = new Set(candidates.map((candidate) => opportunityKey(candidate)));
    const activeResult = await client.query(
      `
      SELECT *
      FROM sales_opportunities
      WHERE tenant_id = $1::bigint
        ${branchId ? "AND branch_id = $2::bigint" : ""}
        AND is_active = TRUE
      FOR UPDATE
      `,
      branchId ? [tenantId, branchId] : [tenantId]
    );
    const activeRows = activeResult.rows || [];
    const activeMap = new Map(activeRows.map((row) => [opportunityKey({
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      productVariantId: row.product_variant_id,
      type: row.type,
    }), row]));

    let deactivatedCount = 0;
    for (const row of activeRows) {
      const key = opportunityKey({
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        productVariantId: row.product_variant_id,
        type: row.type,
      });
      if (candidateKeys.has(key)) continue;
      await client.query(
        `
        UPDATE sales_opportunities
        SET is_active = FALSE,
            expires_at = NOW()
        WHERE id = $1::bigint
        `,
        [row.id]
      );
      deactivatedCount += 1;
      activeMap.delete(key);
    }

    let sentCount = 0;
    for (const candidate of candidates) {
      const { opportunity, shouldSend } = await upsertSalesOpportunity(client, candidate, nowIso);
      if (shouldSend) {
        sendQueue.push({
          opportunity: normalizeOpportunityRow({
            ...opportunity,
            metadata: parseSalesOpportunityMetadata(opportunity?.metadata),
          }),
        });
        sentCount += 1;
      }
    }

    await client.query("COMMIT");

    const employeesByBranch = new Map();
    for (const job of sendQueue) {
      const branchKey = String(job.opportunity.branch_id || "");
      if (!branchKey) continue;
      if (!employeesByBranch.has(branchKey)) {
        const employees = await loadBranchEmployees({ clientOrPool: db, tenantId, branchId: job.opportunity.branch_id });
        employeesByBranch.set(branchKey, employees);
      }
      const employees = employeesByBranch.get(branchKey) || [];
      const body = job.opportunity.message || buildOpportunityMessage(job.opportunity);
      await Promise.all(
        employees.map((employee) =>
          sendEmployeePortalPush({
            tenantId,
            employeeId: employee.id,
            title: "فرصة بيع",
            body,
            url: employee.employee_portal_token ? `/employee-portal/${encodeURIComponent(employee.employee_portal_token)}` : "/employee-app/",
            tag: `sales-opportunity-${job.opportunity.id}`,
            data: {
              event: "sales_opportunity",
              opportunity_id: job.opportunity.id,
              branch_id: job.opportunity.branch_id,
              product_id: job.opportunity.product_id,
              product_variant_id: job.opportunity.product_variant_id,
              type: job.opportunity.type,
              tab: "home",
            },
          }).catch((error) => console.warn("[sales-opportunity] push skipped", error?.message || error))
        )
      );
    }

    const opportunities = await loadActiveSalesOpportunities({ clientOrPool: db, tenantId, branchId });
    return { opportunities, activeCount: opportunities.length, sentCount, deactivatedCount };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures.
    }
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
};

export const getSalesOpportunitiesForScope = async ({ tenantId = null, branchId = null, clientOrPool = db } = {}) => {
  await syncSalesOpportunities({ tenantId, branchId, clientOrPool });
  return loadActiveSalesOpportunities({ clientOrPool, tenantId, branchId });
};

export const listActiveSalesOpportunities = loadActiveSalesOpportunities;
export const buildSalesOpportunityMessage = buildOpportunityMessage;
