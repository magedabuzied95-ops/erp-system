import db from "../database/db.js";
import { getTenantId } from "../utils/requestScope.js";

const getTenantScope = (req) => getTenantId(req, req.user?.tenant_id) ?? 1;

const slugifyBrandName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "";

const normalizeStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "inactive" ? "inactive" : "active";
};

const normalizeBrand = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id ?? null,
  name: row.name || "",
  slug: row.slug || slugifyBrandName(row.name),
  logo_url: row.logo_url || row.image_url || "",
  image_url: row.image_url || row.logo_url || "",
  logo: row.logo_url || row.image_url || "",
  sort_order: Number(row.sort_order || 0) || 0,
  status: normalizeStatus(row.status),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

let brandsTableReady = false;
let brandsTableReadyPromise = null;

const ensureBrandsTableNow = async (executor = db) => {
  await executor.query(`
    CREATE TABLE IF NOT EXISTS brands (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      name VARCHAR(255) NOT NULL DEFAULT '',
      slug VARCHAR(255) NOT NULL DEFAULT '',
      logo_url TEXT,
      image_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await executor.query(`
    ALTER TABLE IF EXISTS brands
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS slug VARCHAR(255) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS logo_url TEXT,
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await executor.query(`
    UPDATE brands
    SET
      slug = COALESCE(NULLIF(slug, ''), id::text),
      image_url = COALESCE(NULLIF(image_url, ''), NULLIF(logo_url, '')),
      logo_url = COALESCE(NULLIF(logo_url, ''), NULLIF(image_url, ''))
    WHERE COALESCE(NULLIF(slug, ''), '') = '' OR COALESCE(NULLIF(image_url, ''), NULLIF(logo_url, '')) IS NOT NULL
  `);
};

// Storefront request-path DDL fix: GET /api/storefront/brands previously executed
// CREATE TABLE + ALTER TABLE + a full-table UPDATE on every public request, which
// takes ACCESS EXCLUSIVE locks and contends with live traffic. This mirrors the
// established guard in storefrontController.ensureStorefrontSchema: one shared
// in-flight promise, then a pure in-memory no-op with zero database queries.
// Failure never marks the schema ready.
export const ensureBrandsTable = async (executor = db) => {
  if (brandsTableReady) return;
  if (!brandsTableReadyPromise) {
    brandsTableReadyPromise = ensureBrandsTableNow(executor)
      .then(() => {
        brandsTableReady = true;
      })
      .catch((error) => {
        brandsTableReadyPromise = null;
        throw error;
      });
  }
  return brandsTableReadyPromise;
};

const buildBrandPayload = (body = {}) => {
  const logoUrl = String(body.logo_url ?? body.logoUrl ?? body.logo ?? body.image_url ?? body.imageUrl ?? "").trim();
  const slug = String(body.slug ?? body.brand_slug ?? body.brandSlug ?? "").trim();
  const sortOrder = Number(body.sort_order ?? body.sortOrder ?? 0);
  return {
    name: String(body.name || "").trim(),
    slug: slug || slugifyBrandName(body.name || ""),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    status: normalizeStatus(body.status),
    logo_url: logoUrl,
  };
};

const findDuplicateByName = async ({ tenantId, name, excludeId = null }) => {
  const result = await db.query(
    `
    SELECT id
    FROM brands
    WHERE LOWER(name) = LOWER($1)
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      AND ($3::bigint IS NULL OR id <> $3::bigint)
    LIMIT 1
    `,
    [name, tenantId, excludeId]
  );
  return result.rows[0] || null;
};

const ensureDefaultBrands = async (tenantId) => {
  const existing = await db.query(
    `
    SELECT id
    FROM brands
    WHERE $1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL
    LIMIT 1
    `,
    [tenantId]
  );
  if (existing.rows[0]) return;

  await db.query(
    `
    INSERT INTO brands (tenant_id, name, slug, logo_url, image_url, sort_order, status)
    VALUES
      ($1::bigint, 'Nike', 'nike', '', '', 1, 'active'),
      ($1::bigint, 'Adidas', 'adidas', '', '', 2, 'active'),
      ($1::bigint, 'Puma', 'puma', '', '', 3, 'active')
    `,
    [tenantId]
  );
};

export const getBrands = async (req, res) => {
  try {
    await ensureBrandsTable();
    const tenantId = getTenantScope(req);
    await ensureDefaultBrands(tenantId);
    const result = await db.query(
      `
    SELECT
      id,
      tenant_id,
      name,
      slug,
      logo_url,
      image_url,
      sort_order,
      status,
      created_at,
      updated_at
    FROM brands
    WHERE $1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL
    ORDER BY COALESCE(sort_order, 0) ASC, LOWER(TRIM(name)) ASC, id ASC
      `,
      [tenantId]
    );

    const brands = result.rows.map(normalizeBrand);
    return res.json({ success: true, data: brands, brands });
  } catch (error) {
    console.error("[brands] load error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch brands",
      error: error.message,
    });
  }
};

export const createBrand = async (req, res) => {
  try {
    await ensureBrandsTable();
    const tenantId = getTenantScope(req);
    const payload = buildBrandPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({ success: false, message: "Brand name is required" });
    }

    const duplicate = await findDuplicateByName({ tenantId, name: payload.name });
    if (duplicate) {
      return res.status(409).json({ success: false, message: "A brand with this name already exists" });
    }

    const created = await db.query(
      `
      INSERT INTO brands (tenant_id, name, slug, logo_url, image_url, sort_order, status)
      VALUES ($1::bigint, $2, $3, $4, $4, $5, $6)
      RETURNING id, tenant_id, name, slug, logo_url, image_url, sort_order, status, created_at, updated_at
      `,
      [tenantId, payload.name, payload.slug, payload.logo_url, payload.sort_order, payload.status]
    );

    const brand = normalizeBrand(created.rows[0]);
    return res.status(201).json({ success: true, data: brand, brand });
  } catch (error) {
    console.error("[brands] create error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create brand",
      error: error.message,
    });
  }
};

export const updateBrand = async (req, res) => {
  try {
    await ensureBrandsTable();
    const tenantId = getTenantScope(req);
    const payload = buildBrandPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({ success: false, message: "Brand name is required" });
    }

    const duplicate = await findDuplicateByName({ tenantId, name: payload.name, excludeId: req.params.id });
    if (duplicate) {
      return res.status(409).json({ success: false, message: "A brand with this name already exists" });
    }

    const updated = await db.query(
      `
      UPDATE brands
      SET
        name = $1,
        slug = $2,
        logo_url = $3,
        image_url = $3,
        sort_order = $4,
        status = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6::bigint
        AND ($7::bigint IS NULL OR tenant_id = $7::bigint OR tenant_id IS NULL)
      RETURNING id, tenant_id, name, slug, logo_url, image_url, sort_order, status, created_at, updated_at
      `,
      [payload.name, payload.slug, payload.logo_url, payload.sort_order, payload.status, req.params.id, tenantId]
    );

    if (!updated.rows[0]) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    const brand = normalizeBrand(updated.rows[0]);
    return res.json({ success: true, data: brand, brand });
  } catch (error) {
    console.error("[brands] update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update brand",
      error: error.message,
    });
  }
};

export const deleteBrand = async (req, res) => {
  try {
    await ensureBrandsTable();
    const tenantId = getTenantScope(req);
    const deleted = await db.query(
      `
      DELETE FROM brands
      WHERE id = $1::bigint
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      RETURNING id
      `,
      [req.params.id, tenantId]
    );

    if (!deleted.rows[0]) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    return res.json({ success: true, id: deleted.rows[0].id });
  } catch (error) {
    console.error("[brands] delete error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete brand",
      error: error.message,
    });
  }
};
