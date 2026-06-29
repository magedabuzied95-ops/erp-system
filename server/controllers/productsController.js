import db from "../database/db.js";
import { ensureInventorySchema } from "../services/inventoryService.js";
import {
  attachGroupedColorImages,
  attachVariantImages,
  ensureProductVariantImagesSchema,
  loadProductVariantImages,
  replaceProductVariantImages,
} from "../services/productVariantImagesService.js";
import { regenerateThermalImageForProductImage } from "../services/thermalArtworkService.js";
import { normalizeClassificationInput } from "../services/productClassificationsService.js";
import { getTenantId, isSuperAdminUser, tenantContextMissingResponse } from "../utils/requestScope.js";
import { slugifyEdition } from "../utils/mirrorProduct.js";
import { ensureSingleBranchMode } from "../utils/singleBranchMode.js";

let productVariantSchemaReadyPromise = null;
let productSchemaReadyPromise = null;
let productColumnsReadyPromise = null;
const tableColumnsCache = new Map();
const tableExistsCache = new Map();
const PRODUCTS_QUERY_TIMEOUT_MS = Number(process.env.PRODUCTS_QUERY_TIMEOUT_MS || 900);

const VARIATION_MODES = new Set(["full_variations", "color_only", "simple"]);
const PRODUCT_AUDIENCES = ["men", "women", "kids"];
const PRODUCT_AUDIENCE_SET = new Set(PRODUCT_AUDIENCES);
const PRODUCT_AUDIENCE_ALIASES = new Map([
  ["men", "men"],
  ["man", "men"],
  ["male", "men"],
  ["mens", "men"],
  ["رجال", "men"],
  ["رجالي", "men"],
  ["women", "women"],
  ["woman", "women"],
  ["female", "women"],
  ["ladies", "women"],
  ["lady", "women"],
  ["نساء", "women"],
  ["نسائي", "women"],
  ["حريمي", "women"],
  ["kids", "kids"],
  ["kid", "kids"],
  ["children", "kids"],
  ["child", "kids"],
  ["boys", "kids"],
  ["girls", "kids"],
  ["اطفال", "kids"],
  ["أطفال", "kids"],
  ["طفل", "kids"],
]);

const normalizeClassificationValue = (field, value) => normalizeClassificationInput(field, value);

const normalizeAudienceText = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeAudienceValue = (value) => {
  const normalized = normalizeAudienceText(value);
  if (!normalized) return "";
  const compact = normalized.replace(/\s+/g, "");
  return PRODUCT_AUDIENCE_ALIASES.get(normalized) || PRODUCT_AUDIENCE_ALIASES.get(compact) || (PRODUCT_AUDIENCE_SET.has(normalized) ? normalized : "");
};

const flattenAudienceInput = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenAudienceInput);
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return flattenAudienceInput(parsed);
    } catch {
      // Plain comma-separated strings are accepted below.
    }
    return text.split(/[,\n|]+/);
  }
  return [value];
};

const normalizeProductAudiences = (...sources) => {
  const seen = new Set();
  for (const source of sources) {
    for (const value of flattenAudienceInput(source)) {
      const audience = normalizeAudienceValue(value);
      if (audience) seen.add(audience);
    }
  }
  return PRODUCT_AUDIENCES.filter((audience) => seen.has(audience));
};

const normalizeGalleryImages = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const containsDataImageValue = (value) => {
  if (typeof value === "string") return value.trim().startsWith("data:image/");
  if (Array.isArray(value)) return value.some(containsDataImageValue);
  if (value && typeof value === "object") return Object.values(value).some(containsDataImageValue);
  return false;
};

const normalizeOptionalForeignKey = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const asciiSkuText = (value = "") =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();

const compactSkuToken = (value = "", max = 4) => asciiSkuText(value).replace(/\s+/g, "").slice(0, max);

const abbreviateSkuWords = (value = "", max = 3) => {
  const words = asciiSkuText(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, max);
  return words.map((word) => word[0]).join("").slice(0, max);
};

const detectSkuModelCode = (...values) => {
  const source = values.map((value) => String(value || "")).join(" ");
  const patterns = [
    [/super\s*star|superstar/i, "SUP"],
    [/air\s*force|af\s*1|airforce/i, "AF"],
    [/jordan\s*4|j4\b/i, "J4"],
    [/jordan\s*1|j1\b/i, "J1"],
    [/\bjordan\b/i, "JDN"],
    [/\bsamba\b/i, "SAM"],
    [/\bcampus\b/i, "CAM"],
    [/\bgazelle\b/i, "GAZ"],
    [/\bdunk\b/i, "DNK"],
    [/\bye?ezy\b/i, "YZY"],
    [/new\s*balance\s*530|\bnb\s*530\b|\b530\b/i, "NB530"],
    [/new\s*balance\s*327|\bnb\s*327\b|\b327\b/i, "NB327"],
    [/new\s*balance\s*9060|\bnb\s*9060\b|\b9060\b/i, "NB9060"],
  ];
  return patterns.find(([pattern]) => pattern.test(source))?.[1] || "";
};

const buildSmartSkuPrefix = (context = {}) => {
  const brandSource = asciiSkuText(context.brand || context.manufacturer);
  const brandCode =
    /^ADIDAS$/.test(brandSource) ? "ADS" :
    /^NIKE$/.test(brandSource) ? "NK" :
    /^NEW\s*BALANCE$/.test(brandSource) ? "NB" :
    /^PUMA$/.test(brandSource) ? "PMA" :
    /^REEBOK$/.test(brandSource) ? "RBK" :
    abbreviateSkuWords(brandSource || context.name, 3) || "PRD";
  const modelCode = detectSkuModelCode(context.detected_model, context.model, context.name, context.meta_title, context.seo_keywords);
  const typeSource = asciiSkuText(`${context.product_type || ""} ${context.category || ""}`);
  const typeCode = modelCode || /SNEAKER|SHOE|TRAINER|FOOTWEAR/.test(typeSource)
    ? ""
    : /BOOT/.test(typeSource)
      ? "BT"
      : /SLIPPER|SLIDE|SANDAL/.test(typeSource)
        ? "SLD"
        : abbreviateSkuWords(context.product_type || context.category, 3);
  const genderSource = asciiSkuText(context.gender);
  const genderCode = /WOMEN|FEMALE|WOMAN|LAD/.test(genderSource)
    ? "W"
    : /MEN|MALE|MAN/.test(genderSource)
      ? "M"
      : /KID|CHILD|BOY|GIRL/.test(genderSource)
        ? "K"
        : /UNISEX/.test(genderSource)
          ? "U"
          : "";
  const gradeSource = asciiSkuText(context.grade);
  const gradeCode = /MIRROR|MIR/.test(gradeSource)
    ? "MIR"
    : /ORIGINAL|AUTHENTIC/.test(gradeSource)
      ? "ORG"
      : /PREMIUM/.test(gradeSource)
        ? "PRM"
        : compactSkuToken(gradeSource, 3);
  const parts =
    brandCode === "NB" && modelCode.startsWith("NB")
      ? [modelCode, genderCode, gradeCode].filter(Boolean)
      : [brandCode, modelCode || typeCode, genderCode, gradeCode].filter(Boolean);
  return parts.join("-").slice(0, 28) || "PRD";
};

const colorCodeFromName = (color = "") => {
  const source = asciiSkuText(color);
  if (/BLACK|BLK/.test(source)) return "BLK";
  if (/WHITE|WHT/.test(source)) return "WHT";
  if (/RED/.test(source)) return "RED";
  if (/BLUE/.test(source)) return "BLU";
  if (/GREEN/.test(source)) return "GRN";
  if (/GRAY|GREY/.test(source)) return "GRY";
  if (/SILVER/.test(source)) return "SLV";
  if (/GOLD/.test(source)) return "GLD";
  if (/BROWN/.test(source)) return "BRN";
  if (/BEIGE/.test(source)) return "BEG";
  return abbreviateSkuWords(source, 3) || "CLR";
};

const normalizeSku = (value = "") =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const slugifyProductSlug = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

const buildVariantSku = ({ prefix = "", color = "", size = "" } = {}) =>
  normalizeSku([normalizeSku(prefix || "PRD"), colorCodeFromName(color), compactSkuToken(size, 8)].filter(Boolean).join("-"));

const isDevelopment = () => process.env.NODE_ENV !== "production";

const dbErrorDetails = (error) => ({
  message: error?.publicMessage || error?.message || "Request failed",
  detail: error?.detail || error?.detailMessage || null,
  constraint: error?.constraint || null,
  column: error?.column || null,
});

const dbValidationStatus = (error) => {
  if (error?.status) return error.status;
  if (isUniqueViolation(error)) return 409;
  if (["22P02", "23502", "23503", "23514"].includes(error?.code)) return 400;
  return 500;
};

const buildCreateProductErrorResponse = (error, statusCode) => {
  const details = dbErrorDetails(error);
  if (isDevelopment()) {
    return {
      success: false,
      ...details,
    };
  }

  return {
    success: false,
    message:
      statusCode === 409
        ? error?.publicMessage || "Duplicate SKU or barcode"
        : statusCode === 400
          ? details.message
          : "Failed to create product",
  };
};

const resolveDefaultCategoryId = async (client, { categoryId, category, tenantId }) => {
  if (categoryId) return categoryId;
  const categoryName = String(category || "").trim();
  if (categoryName && categoryName.toLowerCase() !== "uncategorized") return null;

  const result = await client.query(
    `
    SELECT id
    FROM categories
    WHERE LOWER(TRIM(name)) = 'uncategorized'
      AND ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
    ORDER BY CASE WHEN tenant_id = $1::bigint THEN 0 ELSE 1 END, id ASC
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0]?.id || null;
};

const getTableColumns = async (client, tableName) => {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnsCache.set(tableName, columns);
  return columns;
};

const tableExists = async (client, tableName) => {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
    ) AS exists
    `,
    [tableName]
  );
  const exists = result.rows[0]?.exists === true;
  tableExistsCache.set(tableName, exists);
  return exists;
};

const toPriceValue = (value, { nullable = false } = {}) => {
  if (value === "" || value === null || value === undefined) return nullable ? null : 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error("Prices must be non-negative");
    error.status = 400;
    throw error;
  }
  return parsed;
};

const insertProductPriceAuditLog = async (client, { tenantId, userId, productId, details }) => {
  try {
    if (!(await tableExists(client, "audit_logs"))) return;
    const columns = await getTableColumns(client, "audit_logs");
    const insertColumns = [];
    const values = [];
    const add = (column, value) => {
      if (!columns.has(column)) return;
      insertColumns.push(column);
      values.push(value);
    };
    add("tenant_id", tenantId);
    add("user_id", userId || null);
    add("action", "product.prices_updated");
    add("entity_type", "product");
    add("entity_id", productId);
    add("details", JSON.stringify(details || {}));
    if (!insertColumns.length) return;
    const params = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(`INSERT INTO audit_logs (${insertColumns.join(", ")}) VALUES (${params})`, values);
  } catch (error) {
    console.warn("[products:price-update] audit log skipped", { productId, message: error.message });
  }
};

const archiveProductForDelete = async (client, productId) => {
  const productColumns = await getTableColumns(client, "products");
  const productSets = [];
  if (productColumns.has("is_active")) productSets.push("is_active = FALSE");
  if (productColumns.has("deleted_at")) productSets.push("deleted_at = COALESCE(deleted_at, NOW())");
  if (productColumns.has("status")) productSets.push("status = 'archived'");
  if (productColumns.has("updated_at")) productSets.push("updated_at = NOW()");
  if (productSets.length) {
    await client.query(`UPDATE products SET ${productSets.join(", ")} WHERE id = $1`, [productId]);
  }

  if (await tableExists(client, "product_variants")) {
    const variantColumns = await getTableColumns(client, "product_variants");
    const variantSets = [];
    if (variantColumns.has("is_active")) variantSets.push("is_active = FALSE");
    if (variantColumns.has("deleted_at")) variantSets.push("deleted_at = COALESCE(deleted_at, NOW())");
    if (variantColumns.has("status")) variantSets.push("status = 'archived'");
    if (variantColumns.has("updated_at")) variantSets.push("updated_at = NOW()");
    if (variantSets.length) {
      await client.query(`UPDATE product_variants SET ${variantSets.join(", ")} WHERE product_id = $1`, [productId]);
    }
  }
};

const resolveDefaultUnitId = async (client, { unitId, tenantId }) => {
  if (unitId) return unitId;
  const columns = await getTableColumns(client, "units");
  if (!columns.has("id") || !columns.has("is_default")) return null;

  const tenantClause = columns.has("tenant_id")
    ? "AND ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)"
    : "";
  const statusClause = columns.has("status") ? "AND COALESCE(status, 'active') = 'active'" : "";
  const orderByTenant = columns.has("tenant_id") ? "CASE WHEN tenant_id = $1::bigint THEN 0 ELSE 1 END," : "";
  const result = await client.query(
    `
    SELECT id
    FROM units
    WHERE is_default = TRUE
      ${tenantClause}
      ${statusClause}
    ORDER BY ${orderByTenant} id ASC
    LIMIT 1
    `,
    columns.has("tenant_id") ? [tenantId] : []
  );
  return result.rows[0]?.id || null;
};

const productPayloadLogKeys = (payload = {}) => Object.keys(payload || {}).sort();

const logProductUpdateError = ({ error, productId, payload = {}, normalizedForeignKeys = {}, normalizedVariants = [] }) => {
  console.error("[products:update] failed", {
    productId,
    message: error?.message,
    code: error?.code || null,
    constraint: error?.constraint || null,
    table: error?.table || null,
    column: error?.column || null,
    detail: error?.detail || null,
    schema: error?.schema || null,
    payloadKeys: productPayloadLogKeys(payload),
    foreignKeys: normalizedForeignKeys,
    variantCount: Array.isArray(normalizedVariants) ? normalizedVariants.length : 0,
    variantKeys: Array.isArray(normalizedVariants)
      ? [...new Set(normalizedVariants.flatMap((variant) => Object.keys(variant || {})))].sort()
      : [],
    stack: error?.stack,
  });
};

const isUniqueViolation = (error) => error?.code === "23505";

const duplicateConflictError = (message, detail = {}) => {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  error.detail = detail;
  return error;
};

const normalizeVariationMode = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (VARIATION_MODES.has(normalized)) return normalized;
  return "full_variations";
};

const normalizeLowStockTrackingMode = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "product_total" ? "product_total" : "variant";
};

const normalizeNonNegativeInteger = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

const normalizeNullablePositiveInteger = (value, { fieldName = "value" } = {}) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be greater than 0`);
    error.status = 400;
    throw error;
  }
  return Math.floor(parsed);
};

const normalizePositiveInteger = (value, { fieldName = "value", fallback = 1 } = {}) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    const error = new Error(`${fieldName} must be at least 1`);
    error.status = 400;
    throw error;
  }
  return Math.floor(parsed);
};

const normalizePurchaseAlertsEnabled = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizePurchaseAlertByColor = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const ensureProductVariantManufacturerColumn = async () => {
  if (!productVariantSchemaReadyPromise) {
    productVariantSchemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS manufacturer_id BIGINT`);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  return productVariantSchemaReadyPromise;
};

export const ensureProductSchema = async () => {
  if (!productSchemaReadyPromise) {
    productSchemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`
          CREATE TABLE IF NOT EXISTS categories (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT,
            name VARCHAR(255) NOT NULL DEFAULT '',
            parent_id BIGINT,
            status VARCHAR(50) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS brands (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT,
            name VARCHAR(255) NOT NULL DEFAULT '',
            slug VARCHAR(255) NOT NULL DEFAULT '',
            logo_url TEXT,
            image_url TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(50) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS manufacturers (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT,
            name VARCHAR(255) NOT NULL DEFAULT '',
            status VARCHAR(50) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await client.query(`
          ALTER TABLE IF EXISTS categories
            ADD COLUMN IF NOT EXISTS parent_id BIGINT,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active'
        `);
        await client.query(`
          ALTER TABLE IF EXISTS brands
            ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
            ADD COLUMN IF NOT EXISTS slug VARCHAR(255) NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS logo_url TEXT,
            ADD COLUMN IF NOT EXISTS image_url TEXT,
            ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
        `);
        await client.query(`
          UPDATE brands
          SET
            slug = COALESCE(NULLIF(slug, ''), id::text),
            image_url = COALESCE(NULLIF(image_url, ''), NULLIF(logo_url, '')),
            logo_url = COALESCE(NULLIF(logo_url, ''), NULLIF(image_url, ''))
          WHERE COALESCE(NULLIF(slug, ''), '') = '' OR COALESCE(NULLIF(image_url, ''), NULLIF(logo_url, '')) IS NOT NULL
        `);
        await client.query(`
          ALTER TABLE IF EXISTS products
            ADD COLUMN IF NOT EXISTS brand VARCHAR(255) DEFAULT '',
            ADD COLUMN IF NOT EXISTS category VARCHAR(255) DEFAULT '',
            ADD COLUMN IF NOT EXISTS main_category VARCHAR(255) DEFAULT '',
            ADD COLUMN IF NOT EXISTS sub_category VARCHAR(255) DEFAULT '',
            ADD COLUMN IF NOT EXISTS child_category VARCHAR(255) DEFAULT '',
            ADD COLUMN IF NOT EXISTS gender TEXT,
            ADD COLUMN IF NOT EXISTS product_type TEXT,
            ADD COLUMN IF NOT EXISTS style TEXT,
            ADD COLUMN IF NOT EXISTS grade TEXT,
            ADD COLUMN IF NOT EXISTS is_offer_story BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_storefront_visible BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS description_ar TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS description_en TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS meta_title TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS seo_description TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS seo_keywords TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS slug TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS canonical_slug TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS regular_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sale_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS sale_reason VARCHAR(40) DEFAULT '',
            ADD COLUMN IF NOT EXISTS sale_start_at TIMESTAMP NULL,
            ADD COLUMN IF NOT EXISTS sale_end_at TIMESTAMP NULL,
            ADD COLUMN IF NOT EXISTS use_custom_compare_price BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS custom_compare_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(12,2) NULL,
            ADD COLUMN IF NOT EXISTS last_purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS average_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS low_stock_alert INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS low_stock_tracking_mode VARCHAR(30) NOT NULL DEFAULT 'variant',
            ADD COLUMN IF NOT EXISTS product_low_stock_threshold INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS minimum_distinct_sizes_required INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS sku VARCHAR(120) DEFAULT '',
            ADD COLUMN IF NOT EXISTS barcode VARCHAR(120) DEFAULT '',
            ADD COLUMN IF NOT EXISTS category_id BIGINT,
            ADD COLUMN IF NOT EXISTS brand_id BIGINT,
            ADD COLUMN IF NOT EXISTS unit_id BIGINT,
            ADD COLUMN IF NOT EXISTS manufacturer_id BIGINT,
            ADD COLUMN IF NOT EXISTS supplier_id BIGINT,
            ADD COLUMN IF NOT EXISTS warehouse_id BIGINT,
            ADD COLUMN IF NOT EXISTS purchase_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS purchase_alert_by_color BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS carton_size INTEGER NULL,
            ADD COLUMN IF NOT EXISTS suggested_purchase_cartons INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS image TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS thermal_image_url TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS thermal_image_status TEXT NOT NULL DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS thermal_image_generated_at TIMESTAMP NULL,
            ADD COLUMN IF NOT EXISTS thermal_image_error TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS variation_mode VARCHAR(30) NOT NULL DEFAULT 'full_variations',
            ADD COLUMN IF NOT EXISTS fixed_size_label VARCHAR(80) DEFAULT '',
            ADD COLUMN IF NOT EXISTS qr_token TEXT,
            ADD COLUMN IF NOT EXISTS tenant_id BIGINT
        `);
        await client.query(`
          UPDATE products
          SET thermal_image_status = 'ready'
          WHERE COALESCE(NULLIF(thermal_image_url, ''), '') <> ''
            AND COALESCE(NULLIF(thermal_image_status, ''), 'pending') = 'pending'
        `);
        await client.query(`UPDATE products SET is_storefront_visible = TRUE WHERE is_storefront_visible IS NULL`);
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'selling_price'
            ) THEN
              UPDATE products SET regular_price = selling_price WHERE COALESCE(regular_price, 0) = 0 AND COALESCE(selling_price, 0) > 0;
            END IF;
          END $$;
        `);
        await client.query(`UPDATE products SET regular_price = price WHERE COALESCE(regular_price, 0) = 0 AND COALESCE(price, 0) > 0`);
        await client.query(`UPDATE products SET price = regular_price WHERE COALESCE(price, 0) = 0 AND COALESCE(regular_price, 0) > 0`);
        await client.query(`
          DO $$
          DECLARE
            nullable_column_name text;
          BEGIN
            FOREACH nullable_column_name IN ARRAY ARRAY['manufacturer_id', 'manufacturer', 'manufacturer_name']
            LOOP
              IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'products'
                  AND columns.column_name = nullable_column_name
              ) THEN
                EXECUTE format('ALTER TABLE products ALTER COLUMN %I DROP NOT NULL', nullable_column_name);
              END IF;
            END LOOP;
          END $$;
        `);
        await client.query(`
          ALTER TABLE IF EXISTS products
            ALTER COLUMN gender TYPE TEXT,
            ALTER COLUMN gender DROP DEFAULT,
            ALTER COLUMN product_type TYPE TEXT,
            ALTER COLUMN product_type DROP DEFAULT,
            ALTER COLUMN style TYPE TEXT,
            ALTER COLUMN style DROP DEFAULT,
            ALTER COLUMN grade TYPE TEXT,
            ALTER COLUMN grade DROP DEFAULT
        `);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS products_qr_token_unique
          ON products(qr_token)
          WHERE qr_token IS NOT NULL
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_gender ON products (gender)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_product_type ON products (product_type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_style ON products (style)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_grade ON products (grade)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_tenant_id_desc ON products (tenant_id, id DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_tenant_status_id ON products (tenant_id, status, id DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_brand_id ON products (brand_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_sku_lower ON products (LOWER(sku))`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode_lower ON products (LOWER(barcode))`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS product_audiences (
            id BIGSERIAL PRIMARY KEY,
            product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            audience VARCHAR(30) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(product_id, audience),
            CHECK (audience IN ('men', 'women', 'kids'))
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_product_id ON product_audiences (product_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_audience ON product_audiences (audience, product_id)`);
        await client.query(`
          INSERT INTO product_audiences (product_id, audience)
          SELECT p.id,
            CASE
              WHEN LOWER(TRIM(COALESCE(p.gender, ''))) IN ('men', 'man', 'male', 'mens', 'رجال', 'رجالي') THEN 'men'
              WHEN LOWER(TRIM(COALESCE(p.gender, ''))) IN ('women', 'woman', 'female', 'ladies', 'lady', 'نساء', 'نسائي', 'حريمي') THEN 'women'
              WHEN LOWER(TRIM(COALESCE(p.gender, ''))) IN ('kids', 'kid', 'children', 'child', 'boys', 'girls', 'اطفال', 'أطفال', 'طفل') THEN 'kids'
              ELSE NULL
            END AS audience
          FROM products p
          WHERE COALESCE(TRIM(p.gender), '') <> ''
            AND LOWER(TRIM(COALESCE(p.gender, ''))) IN ('men', 'man', 'male', 'mens', 'رجال', 'رجالي', 'women', 'woman', 'female', 'ladies', 'lady', 'نساء', 'نسائي', 'حريمي', 'kids', 'kid', 'children', 'child', 'boys', 'girls', 'اطفال', 'أطفال', 'طفل')
            AND NOT EXISTS (SELECT 1 FROM product_audiences pa WHERE pa.product_id = p.id)
          ON CONFLICT (product_id, audience) DO NOTHING
        `);
        await client.query(`
          UPDATE products
          SET variation_mode = 'full_variations'
          WHERE variation_mode IS NULL OR TRIM(variation_mode) = ''
        `);
        await client.query(`
          UPDATE products
          SET low_stock_tracking_mode = 'variant'
          WHERE low_stock_tracking_mode IS NULL OR TRIM(low_stock_tracking_mode) NOT IN ('variant', 'product_total')
        `);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  return productSchemaReadyPromise;
};

const ensureProductQrTokens = async () => {
  await ensureProductSchema();
  await db.query(`
    UPDATE products
    SET qr_token = 'SHOP-PROD-' || id || '-' || SUBSTRING(MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text), 1, 10)
    WHERE qr_token IS NULL OR qr_token = ''
  `);
};

export const ensureProductVariantSchema = async () => {
  await ensureProductVariantManufacturerColumn();
  await db.query(`
    ALTER TABLE IF EXISTS product_variants
      ADD COLUMN IF NOT EXISTS color VARCHAR(100),
      ADD COLUMN IF NOT EXISTS size VARCHAR(100),
      ADD COLUMN IF NOT EXISTS sku VARCHAR(120) DEFAULT '',
      ADD COLUMN IF NOT EXISTS barcode VARCHAR(120) DEFAULT '',
      ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS image TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS thermal_image_url TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS thermal_image_status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS thermal_image_generated_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS thermal_image_error TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS regular_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sale_reason VARCHAR(40) DEFAULT '',
      ADD COLUMN IF NOT EXISTS sale_start_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS sale_end_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS last_purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS average_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS default_purchase_qty INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS low_stock_alert INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS supplier_id BIGINT,
      ADD COLUMN IF NOT EXISTS warehouse_id BIGINT,
      ADD COLUMN IF NOT EXISTS branch_id BIGINT,
      ADD COLUMN IF NOT EXISTS edition_name TEXT,
      ADD COLUMN IF NOT EXISTS edition_slug TEXT,
      ADD COLUMN IF NOT EXISTS article_code TEXT
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id, id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_tenant_product_id ON product_variants (tenant_id, product_id, id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_stock_product ON product_variants (stock, product_id, id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_active_product ON product_variants (product_id, is_active, deleted_at, id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_sku_lower ON product_variants (LOWER(sku))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_barcode_lower ON product_variants (LOWER(barcode))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_article_code_lower ON product_variants (LOWER(TRIM(article_code))) WHERE article_code IS NOT NULL AND TRIM(article_code) <> ''`);
  await db.query(`
    UPDATE product_variants
    SET thermal_image_status = 'ready'
    WHERE COALESCE(NULLIF(thermal_image_url, ''), '') <> ''
      AND COALESCE(NULLIF(thermal_image_status, ''), 'pending') = 'pending'
  `);
  await db.query(`
    DO $$
    DECLARE
      nullable_column_name text;
    BEGIN
      FOREACH nullable_column_name IN ARRAY ARRAY['manufacturer_id', 'manufacturer', 'manufacturer_name']
      LOOP
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'product_variants'
            AND columns.column_name = nullable_column_name
        ) THEN
          EXECUTE format('ALTER TABLE product_variants ALTER COLUMN %I DROP NOT NULL', nullable_column_name);
        END IF;
      END LOOP;
    END $$;
  `);
  await ensureSingleBranchMode(db);
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value ?? 0);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

const normalizeThermalImageStatus = (value, thermalImageUrl = "") => {
  const status = String(value || "").trim().toLowerCase();
  if (["pending", "processing", "ready", "failed"].includes(status)) return status;
  return String(thermalImageUrl || "").trim() ? "ready" : "pending";
};

const normalizeThermalTimestamp = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const normalizeThermalError = (value) => String(value || "").trim();

const normalizeProductRow = (row = {}) => {
  const regularPrice = firstPositiveNumber(row.selling_price, row.regular_price, row.price, row.sale_price);
  const audiences = normalizeProductAudiences(row.audiences, row.product_audiences, row.gender);
  const imageUrl = row.image_url || "";
  const thumbnailUrl = row.thumbnail_url || "";
  const photoUrl = row.photo_url || "";
  const thermalImageUrl = row.thermal_image_url || "";
  const thermalImageStatus = normalizeThermalImageStatus(row.thermal_image_status, thermalImageUrl);
  const thermalImageGeneratedAt = normalizeThermalTimestamp(row.thermal_image_generated_at);
  const thermalImageError = normalizeThermalError(row.thermal_image_error);
  const image = row.image || "";
  const galleryImages = normalizeGalleryImages(row.gallery_images);
  const variantColorThermalImageUrl = row.variant_color_thermal_image_url || row.color_thermal_image_url || row.thermal_image_url || "";
  return ({
  ...row,
  selling_price: regularPrice,
  regular_price: regularPrice,
  price: regularPrice,
  sale_price: Number(row.sale_price || 0),
  sale_price_enabled: row.sale_price_enabled === true || String(row.sale_price_enabled || "").toLowerCase() === "true",
  sale_reason: row.sale_reason || "",
  sale_start_at: row.sale_start_at || null,
  sale_end_at: row.sale_end_at || null,
  use_custom_compare_price: row.use_custom_compare_price === true || String(row.use_custom_compare_price || "").toLowerCase() === "true",
  custom_compare_price: Number(row.custom_compare_price || 0),
  cost_price: Number(row.cost_price ?? row.last_purchase_price ?? row.last_purchase_cost ?? row.average_cost ?? row.purchase_price ?? 0),
  purchase_price: Number(row.purchase_price ?? row.last_purchase_price ?? row.last_purchase_cost ?? row.cost_price ?? 0),
  last_purchase_price: Number(row.last_purchase_price ?? row.last_purchase_cost ?? row.purchase_price ?? row.cost_price ?? 0),
  average_cost: Number(row.average_cost ?? row.cost_price ?? row.purchase_price ?? 0),
  wholesale_price: Number(row.wholesale_price || row.price || 0),
  purchase_alerts_enabled: row.purchase_alerts_enabled === true || String(row.purchase_alerts_enabled || "").toLowerCase() === "true",
  purchase_alert_by_color: row.purchase_alert_by_color === true || String(row.purchase_alert_by_color || "").toLowerCase() === "true",
  carton_size: row.carton_size === null || row.carton_size === undefined || row.carton_size === "" ? null : Number(row.carton_size),
  suggested_purchase_cartons:
    Number.isFinite(Number(row.suggested_purchase_cartons)) && Number(row.suggested_purchase_cartons) >= 1
      ? Math.floor(Number(row.suggested_purchase_cartons))
      : 1,
  stock: Number(row.stock ?? row.quantity ?? row.qty ?? row.available_quantity ?? row.inventory_quantity ?? row.current_stock ?? 0),
  low_stock_threshold: Number(row.low_stock_threshold || 10),
  low_stock_alert: Number(row.low_stock_alert ?? row.low_stock_threshold ?? 0),
  low_stock_tracking_mode: normalizeLowStockTrackingMode(row.low_stock_tracking_mode),
  product_low_stock_threshold: normalizeNonNegativeInteger(row.product_low_stock_threshold, 0),
  minimum_distinct_sizes_required: normalizeNonNegativeInteger(row.minimum_distinct_sizes_required, 0),
  status: row.status || "active",
  sku: row.sku || "",
  barcode: row.barcode || "",
  qr_token: row.qr_token || "",
  article_code:
    row.article_code ||
    row.articleCode ||
    row.color_article_code ||
    row.colorArticleCode ||
    "",
  articleCode:
    row.articleCode ||
    row.article_code ||
    row.colorArticleCode ||
    row.color_article_code ||
    "",
  color_article_code: row.color_article_code || row.colorArticleCode || row.article_code || "",
  colorArticleCode: row.colorArticleCode || row.color_article_code || row.articleCode || "",
  category_id: row.category_id ?? "",
  parent_category_id: row.parent_category_id ?? null,
  category_name: row.category_name || row.category || "Uncategorized",
  category_path: row.category_path || row.category || "Uncategorized",
  main_category_id: row.main_category_id ?? null,
  main_category_name: row.main_category_name || row.main_category || row.category || "Uncategorized",
  sub_category_id: row.sub_category_id ?? null,
  sub_category_name: row.sub_category_name || row.sub_category || "",
  child_category_id: row.child_category_id ?? null,
  child_category_name: row.child_category_name || row.child_category || "",
  main_category: row.main_category_name || row.main_category || "",
  sub_category: row.sub_category_name || row.sub_category || "",
  child_category: row.child_category_name || row.child_category || "",
  gender: row.gender || audiences[0] || "",
  audiences,
  product_audiences: audiences,
  product_type: row.product_type || "",
  style: row.style || "",
  grade: row.grade || "",
  is_offer_story: row.is_offer_story === true || String(row.is_offer_story || "").toLowerCase() === "true",
  is_storefront_visible: row.is_storefront_visible === true || String(row.is_storefront_visible ?? "").toLowerCase() === "true" || row.is_storefront_visible === undefined || row.is_storefront_visible === null || row.is_storefront_visible === "",
  variation_mode: normalizeVariationMode(row.variation_mode),
  fixed_size_label: row.fixed_size_label || "",
  brand_id: row.brand_id ?? "",
  brand_name: row.brand_name || row.brand || "Unbranded",
  unit_id: row.unit_id ?? "",
  unit_name: row.unit_name || row.unit || row.unit_abbreviation || "",
  unit_abbreviation: row.unit_abbreviation || "",
  image_url: imageUrl,
  thumbnail_url: thumbnailUrl,
  photo_url: photoUrl,
  thermal_image_url: thermalImageUrl,
  thermal_image_status: thermalImageStatus,
  thermal_image_generated_at: thermalImageGeneratedAt,
  thermal_image_error: thermalImageError,
  variant_color_thermal_image_url: variantColorThermalImageUrl,
  color_thermal_image_url: row.color_thermal_image_url || variantColorThermalImageUrl,
  product_thermal_image_url: row.product_thermal_image_url || thermalImageUrl,
  image,
  product_image_url: row.product_image_url || thumbnailUrl || imageUrl || photoUrl || image || "",
  gallery_images: galleryImages,
  category: row.category || "Uncategorized",
  brand: row.brand || "Unbranded",
});
};

const loadProductAudienceMap = async (clientOrPool, productIds = []) => {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];
  if (!ids.length) return new Map();
  const result = await clientOrPool.query(
    `
    SELECT product_id, audience
    FROM product_audiences
    WHERE product_id = ANY($1::bigint[])
    ORDER BY product_id ASC, audience ASC
    `,
    [ids]
  );
  const map = new Map();
  for (const row of result.rows || []) {
    const key = String(row.product_id);
    const current = map.get(key) || [];
    const audience = normalizeAudienceValue(row.audience);
    if (audience && !current.includes(audience)) current.push(audience);
    map.set(key, current);
  }
  return map;
};

const withProductAudiences = async (clientOrPool, products = []) => {
  const rows = Array.isArray(products) ? products : [];
  const ids = rows.map((product) => product.id ?? product.product_id).filter(Boolean);
  const audienceMap = await loadProductAudienceMap(clientOrPool, ids);
  return rows.map((product) => {
    const productId = String(product.id ?? product.product_id ?? "");
    const audiences = audienceMap.get(productId) || normalizeProductAudiences(product.audiences, product.product_audiences, product.gender);
    return {
      ...product,
      gender: product.gender || audiences[0] || "",
      audiences,
      product_audiences: audiences,
    };
  });
};

const replaceProductAudiences = async (client, productId, audiences = []) => {
  const normalizedAudiences = normalizeProductAudiences(audiences);
  await client.query(`DELETE FROM product_audiences WHERE product_id = $1`, [productId]);
  for (const audience of normalizedAudiences) {
    await client.query(
      `
      INSERT INTO product_audiences (product_id, audience)
      VALUES ($1, $2)
      ON CONFLICT (product_id, audience) DO NOTHING
      `,
      [productId, audience]
    );
  }
  return normalizedAudiences;
};

const scheduleThermalImageGeneration = ({
  entityType = "product",
  productId = null,
  variantId = null,
  tenantId = null,
  sourceImageUrl = "",
  existingThermalImageUrl = "",
  productName = "",
  regenerate = false,
} = {}) => {
  const normalizedSourceImageUrl = String(sourceImageUrl || "").trim();
  if (!normalizedSourceImageUrl) return;

  setImmediate(() => {
    void regenerateThermalImageForProductImage({
      entityType,
      productId,
      variantId,
      tenantId,
      sourceImageUrl: normalizedSourceImageUrl,
      existingThermalImageUrl,
      productName,
      regenerate,
    }).catch((error) => {
      console.warn("[products] thermal image generation enqueue failed", {
        entityType,
        productId,
        variantId,
        tenantId,
        sourceImageUrl: normalizedSourceImageUrl,
        message: error?.message || String(error),
      });
    });
  });
};

const normalizeVariantRow = (row = {}) => {
  const regularPrice = firstPositiveNumber(row.variant_selling_price, row.selling_price, row.regular_price, row.variant_price, row.variant_sale_price, row.price);
  const thermalImageUrl = row.thermal_image_url || "";
  const thermalImageStatus = normalizeThermalImageStatus(row.thermal_image_status, thermalImageUrl);
  const thermalImageGeneratedAt = normalizeThermalTimestamp(row.thermal_image_generated_at);
  const thermalImageError = normalizeThermalError(row.thermal_image_error);
  return ({
  ...row,
  selling_price: regularPrice,
  regular_price: regularPrice,
  price: regularPrice,
  sale_price: Number(row.sale_price ?? 0),
  sale_price_enabled: row.sale_price_enabled === true || String(row.sale_price_enabled || "").toLowerCase() === "true",
  compare_at_price: Number(row.compare_at_price ?? row.variant_compare_at_price ?? 0),
  original_price: Number(row.original_price ?? row.variant_original_price ?? 0),
  list_price: Number(row.list_price ?? row.variant_list_price ?? 0),
  compare_base_price: Number(row.compare_base_price ?? row.variant_compare_base_price ?? 0),
  wholesale_price: Number(row.variant_wholesale_price ?? row.wholesale_price ?? 0),
  cost_price: Number(row.variant_cost_price ?? row.cost_price ?? row.variant_last_purchase_price ?? row.last_purchase_price ?? row.last_purchase_cost ?? row.variant_average_cost ?? row.average_cost ?? row.variant_purchase_price ?? row.purchase_price ?? 0),
  purchase_price: Number(row.variant_purchase_price ?? row.purchase_price ?? row.variant_last_purchase_price ?? row.last_purchase_price ?? row.last_purchase_cost ?? row.variant_cost_price ?? row.cost_price ?? 0),
  last_purchase_price: Number(row.variant_last_purchase_price ?? row.last_purchase_price ?? row.last_purchase_cost ?? row.variant_purchase_price ?? row.purchase_price ?? row.variant_cost_price ?? row.cost_price ?? 0),
  average_cost: Number(row.variant_average_cost ?? row.average_cost ?? row.variant_cost_price ?? row.cost_price ?? row.variant_purchase_price ?? row.purchase_price ?? 0),
  stock: Number(row.variant_stock ?? row.stock ?? row.quantity ?? row.qty ?? row.available_quantity ?? row.inventory_quantity ?? row.current_stock ?? 0),
  default_purchase_qty: Number(row.variant_default_purchase_qty ?? row.default_purchase_qty ?? 0),
  low_stock_alert: Number(row.variant_low_stock_alert ?? row.low_stock_alert ?? 0),
  variant_image_url:
    row.variant_image_url ||
    row.color_image_url ||
    row.image_url ||
    row.image ||
    row.photo_url ||
    row.thumbnail_url ||
    "",
  color_image_url:
    row.color_image_url ||
    row.variant_image_url ||
    row.image_url ||
    row.image ||
    row.photo_url ||
    row.thumbnail_url ||
    "",
  product_image_url: row.product_image_url || "",
  image_url:
    row.variant_image_url ||
    row.color_image_url ||
    row.image_url ||
    row.image ||
    row.photo_url ||
    row.thumbnail_url ||
    "",
  thermal_image_url: thermalImageUrl,
  thermal_image_status: thermalImageStatus,
  thermal_image_generated_at: thermalImageGeneratedAt,
  thermal_image_error: thermalImageError,
  thermalImageStatus,
  sku: row.variant_sku || row.sku || "",
  barcode: row.variant_barcode || row.barcode || "",
  article_code:
    row.variant_article_code ||
    row.article_code ||
    row.articleCode ||
    row.color_article_code ||
    row.colorArticleCode ||
    "",
  articleCode:
    row.variant_article_code ||
    row.article_code ||
    row.articleCode ||
    row.color_article_code ||
    row.colorArticleCode ||
    "",
  color_article_code: row.color_article_code || row.colorArticleCode || row.variant_article_code || row.article_code || "",
  colorArticleCode: row.colorArticleCode || row.color_article_code || row.variant_article_code || row.article_code || "",
  manufacturer_id: row.variant_manufacturer_id ?? row.manufacturer_id ?? null,
  variant_manufacturer_name: row.variant_manufacturer_name ?? row.manufacturer_name ?? "",
  manufacturer_name: row.variant_manufacturer_name ?? row.manufacturer_name ?? "",
  edition_name: row.variant_edition_name ?? row.edition_name ?? "",
  edition_slug: row.variant_edition_slug ?? row.edition_slug ?? slugifyEdition(row.variant_edition_name ?? row.edition_name ?? ""),
});
};

const isSimpleNoVariantProduct = (product = {}) => {
  const mode = String(product.variation_mode || "").trim().toLowerCase();
  const type = String(product.product_type || product.type || "").trim().toLowerCase();
  return mode === "simple" || type === "simple";
};

const logProductsPriceRead = (products = []) => {
  for (const product of Array.isArray(products) ? products : []) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const hasVariants = variants.length > 0 && !isSimpleNoVariantProduct(product);
    if (hasVariants) {
      for (const variant of variants) {
        console.log("[products-price-read]", {
          product_id: product.id ?? product.product_id ?? null,
          sku: product.sku || "",
          type: product.product_type || product.variation_mode || "",
          variant_id: variant.id ?? variant.variant_id ?? null,
          has_variants: true,
          source: "variant",
          cost_price: variant.cost_price ?? null,
          selling_price: variant.selling_price ?? variant.regular_price ?? variant.price ?? null,
          sale_price: variant.sale_price ?? null,
        });
      }
    } else {
      console.log("[products-price-read]", {
        product_id: product.id ?? product.product_id ?? null,
        sku: product.sku || "",
        type: product.product_type || product.variation_mode || "",
        variant_id: null,
        has_variants: false,
        source: "product",
        cost_price: product.cost_price ?? null,
        selling_price: product.selling_price ?? product.regular_price ?? product.price ?? null,
        sale_price: product.sale_price ?? null,
      });
    }
  }
};

const logProductDetailsPriceDebug = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const defaultVariant = variants.find((variant) => Number(variant.stock || 0) > 0) || variants[0] || {};
  const resolvedRegularPrice = firstPositiveNumber(
    product.selling_price,
    product.price,
    product.regular_price,
    defaultVariant.selling_price,
    defaultVariant.price,
    defaultVariant.regular_price,
    product.sale_price,
    defaultVariant.sale_price
  );
  const resolvedComparePrice = firstPositiveNumber(
    product.use_custom_compare_price ? product.custom_compare_price : null,
    product.compare_at_price,
    product.original_price,
    product.list_price,
    product.compare_base_price,
    defaultVariant.compare_at_price,
    defaultVariant.original_price,
    defaultVariant.list_price,
    defaultVariant.compare_base_price
  );
  const storedSalePrice = firstPositiveNumber(product.sale_price, defaultVariant.sale_price);
  const resolvedSalePrice =
    storedSalePrice ||
    (resolvedComparePrice > resolvedRegularPrice && resolvedRegularPrice > 0 ? resolvedRegularPrice : 0);
  console.log("[product-details-price-debug]", {
    product_id: product.id ?? product.product_id ?? null,
    product_fields: {
      selling_price: product.selling_price,
      price: product.price,
      regular_price: product.regular_price,
      sale_price: product.sale_price,
      sale_price_enabled: product.sale_price_enabled,
      use_custom_compare_price: product.use_custom_compare_price,
      custom_compare_price: product.custom_compare_price,
      compare_at_price: product.compare_at_price,
      original_price: product.original_price,
      list_price: product.list_price,
      compare_base_price: product.compare_base_price,
      cost_price: product.cost_price,
      wholesale_price: product.wholesale_price,
      last_purchase_price: product.last_purchase_price,
    },
    default_variant_fields: {
      id: defaultVariant.id ?? defaultVariant.variant_id ?? null,
      selling_price: defaultVariant.selling_price,
      price: defaultVariant.price,
      regular_price: defaultVariant.regular_price,
      sale_price: defaultVariant.sale_price,
      sale_price_enabled: defaultVariant.sale_price_enabled,
      cost_price: defaultVariant.cost_price,
      wholesale_price: defaultVariant.wholesale_price,
      last_purchase_price: defaultVariant.last_purchase_price,
    },
    resolved_regular_price: resolvedRegularPrice,
    resolved_sale_price: resolvedSalePrice,
    resolved_compare_price: resolvedComparePrice,
    audiences: product.audiences || [],
  });
};

const deriveColorGroupsFromVariants = (variants = []) => {
  const seen = new Map();
  for (const variant of Array.isArray(variants) ? variants : []) {
    const color = String(variant?.color || variant?.color_name || "").trim();
    const key = color.toLowerCase() || "default";
    if (!seen.has(key)) {
      seen.set(key, {
        color,
        color_name: color,
        color_value: color,
        article_code: variant?.color_article_code || variant?.colorArticleCode || variant?.article_code || variant?.articleCode || "",
        articleCode: variant?.colorArticleCode || variant?.color_article_code || variant?.articleCode || variant?.article_code || "",
        color_article_code: variant?.color_article_code || variant?.colorArticleCode || variant?.article_code || variant?.articleCode || "",
        colorArticleCode: variant?.colorArticleCode || variant?.color_article_code || variant?.articleCode || variant?.article_code || "",
        image_url: variant?.image_url || "",
        colorPrimaryImageUrl: variant?.colorPrimaryImageUrl || variant?.image_url || "",
        color_image_url: variant?.color_image_url || variant?.image_url || "",
        thermal_image_url: variant?.thermal_image_url || variant?.variant_color_thermal_image_url || variant?.color_thermal_image_url || "",
        color_thermal_image_url: variant?.color_thermal_image_url || variant?.variant_color_thermal_image_url || variant?.thermal_image_url || "",
        variant_color_thermal_image_url: variant?.variant_color_thermal_image_url || variant?.color_thermal_image_url || variant?.thermal_image_url || "",
      });
    }
  }
  return Array.from(seen.values());
};

const normalizeResponse = (rows = []) => ({
  success: true,
  data: rows,
  products: rows,
});

const getProductColumns = async () => {
  if (!productColumnsReadyPromise) {
    productColumnsReadyPromise = (async () => {
      const result = await db.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'products'
        `
      );
      const columns = new Set(result.rows.map((row) => row.column_name));

      return {
        companyIdColumn: columns.has("company_id") ? "company_id" : null,
        workspaceIdColumn: columns.has("workspace_id") ? "workspace_id" : null,
        tenantIdColumn: columns.has("tenant_id") ? "tenant_id" : null,
        isActiveColumn: columns.has("is_active") ? "is_active" : null,
        deletedAtColumn: columns.has("deleted_at") ? "deleted_at" : null,
        statusColumn: columns.has("status") ? "status" : null,
      };
    })().catch((error) => {
      productColumnsReadyPromise = null;
      throw error;
    });
  }

  return productColumnsReadyPromise;
};

export const warmProductsMetadataCache = async (clientOrPool = db) => {
  await Promise.all([
    getTableColumns(clientOrPool, "products"),
    getTableColumns(clientOrPool, "product_variants"),
    getTableColumns(clientOrPool, "units"),
    getTableColumns(clientOrPool, "audit_logs"),
    tableExists(clientOrPool, "product_variants"),
    tableExists(clientOrPool, "audit_logs"),
    tableExists(clientOrPool, "journal_entries"),
    tableExists(clientOrPool, "storefront_customer_sessions"),
    tableExists(clientOrPool, "product_variant_images"),
    getProductColumns(),
  ]);
};

const resolveProductRequestScope = (req) => {
  const companyId = req.user?.company_id ?? req.user?.companyId ?? null;
  const workspaceId = req.user?.workspace_id ?? req.user?.workspaceId ?? null;
  const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

  return {
    userId: req.user?.id ?? null,
    role: req.user?.role || req.user?.role_name || null,
    tenantId,
    tenant_id: req.user?.tenant_id ?? null,
    company_id: companyId,
    workspace_id: workspaceId,
    isSuperAdmin: Boolean(isSuperAdminUser(req.user)),
  };
};

const buildProductScopeClause = ({ columns, scope }) => {
  const activeParts = [];
  if (columns.deletedAtColumn) activeParts.push("p.deleted_at IS NULL");
  if (columns.statusColumn) activeParts.push("COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('archived', 'deleted')");

  if (scope.isSuperAdmin) {
    return {
      whereSql: activeParts.length ? `WHERE ${activeParts.join(" AND ")}` : "",
      values: [],
      whereScope: activeParts.length ? activeParts.join(" AND ") : "super admin bypass",
    };
  }

  const values = [];
  const parts = [];
  const companyId = scope.company_id;
  const workspaceId = scope.workspace_id;

  if (columns.companyIdColumn && companyId !== null && companyId !== undefined && companyId !== "") {
    values.push(companyId);
    parts.push(`(p.company_id IS NULL OR p.company_id = $${values.length})`);
  }

  if (columns.workspaceIdColumn && workspaceId !== null && workspaceId !== undefined && workspaceId !== "") {
    values.push(workspaceId);
    parts.push(`(p.workspace_id IS NULL OR p.workspace_id = $${values.length})`);
  }

  parts.push(...activeParts);

  return {
    whereSql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    values,
    whereScope: parts.length > 0 ? parts.join(" AND ") : "no company/workspace filter",
  };
};

const buildProductSearchClause = ({ values, search }) => {
  const rawSearch = String(search ?? "").trim();
  if (!rawSearch) return "";

  values.push(rawSearch);
  const exactParam = `$${values.length}`;
  values.push(`%${rawSearch}%`);
  const partialParam = `$${values.length}`;

  const productFields = [
    "p.name",
    "p.sku",
    "p.barcode",
    "p.qr_token",
  ];
  const variantFields = [
    "sv.sku",
    "sv.barcode",
    "sv.color",
    "sv.size",
    "sv.article_code",
  ];
  const fieldMatch = (field) => `
    LOWER(TRIM(COALESCE(${field}, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(${field}, '') ILIKE ${partialParam}
  `;

  return `
    (
      ${productFields.map((field) => `(${fieldMatch(field)})`).join(" OR ")}
      OR EXISTS (
        SELECT 1
        FROM product_variants sv
        WHERE sv.product_id = p.id
          AND sv.is_active IS DISTINCT FROM FALSE
          AND sv.deleted_at IS NULL
          AND (
            ${variantFields.map((field) => `(${fieldMatch(field)})`).join(" OR ")}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM product_audiences pa
        WHERE pa.product_id = p.id
          AND (
            LOWER(TRIM(COALESCE(pa.audience, ''))) = LOWER(TRIM(${exactParam}))
            OR COALESCE(pa.audience, '') ILIKE ${partialParam}
          )
      )
    )
  `;
};

const runTimedProductQuery = async ({
  route,
  label,
  text,
  values = [],
  timeoutMs = PRODUCTS_QUERY_TIMEOUT_MS,
  scope = {},
}) => {
  const startedAt = Date.now();
  const safeTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 5000)
    : PRODUCTS_QUERY_TIMEOUT_MS;

  console.log("[products] db query start", {
    route,
    label,
    timeoutMs: safeTimeoutMs,
    filters: scope,
  });

  let client;

  try {
    client = await db.connect();

    console.log("[products] db query client acquired", {
      route,
      label,
    });

    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${safeTimeoutMs}ms'`);

    const result = await client.query(text, values);

    await client.query("COMMIT");

    console.log("[products] db query rows", {
      route,
      label,
      rows: result.rows?.length ?? 0,
    });

    return result;
  } catch (error) {
    try {
      if (client) {
        await client.query("ROLLBACK");
      }
    } catch (rollbackError) {
      console.error("[products] db rollback failed", {
        route,
        label,
        message: rollbackError.message,
      });
    }

    console.error("[products] db query failed", {
      route,
      label,
      message: error.message,
      code: error.code || null,
    });

    throw error;
  } finally {
    if (client) {
      client.release();
    }
    console.log("[products] db query complete", {
      route,
      label,
      durationMs: Date.now() - startedAt,
    });
  }
};

const normalizeIncomingManufacturerId = normalizeOptionalForeignKey;

const normalizeIncomingVariant = (variant = {}, group = {}) => {
  const regularPrice = Number(
    variant.regular_price ??
      variant.regularPrice ??
      variant.price ??
      variant.variant_price ??
      group.regular_price ??
      group.regularPrice ??
      group.price ??
      0
  );
  const salePriceEnabled = variant.sale_price_enabled === true || String(variant.sale_price_enabled || "").toLowerCase() === "true";
  const salePrice = Number(variant.sale_price ?? variant.salePrice ?? 0);

  return {
    id: normalizeOptionalForeignKey(variant.id ?? variant.variant_id ?? variant.variantId),
    color: String(variant.color ?? variant.color_name ?? variant.colorName ?? group.color ?? group.color_name ?? "").trim(),
    size: String(variant.size ?? variant.size_name ?? variant.sizeName ?? "").trim(),
    sku: String(variant.sku ?? variant.variant_sku ?? "").trim(),
    barcode: String(variant.barcode ?? variant.variant_barcode ?? "").trim(),
    article_code: String(
      variant.article_code ??
        variant.articleCode ??
        variant.variant_article_code ??
        variant.model_code ??
        variant.modelCode ??
        variant.factory_model ??
        variant.factoryModel ??
        variant.factory_code ??
        variant.factoryCode ??
        group.article_code ??
        group.articleCode ??
        group.model_code ??
        group.modelCode ??
        group.factory_model ??
        group.factoryModel ??
        group.factory_code ??
        group.factoryCode ??
        ""
    ).trim(),
    default_purchase_qty: Number(
      variant.default_purchase_qty ??
        variant.defaultPurchaseQty ??
        variant.initial_display_qty ??
        variant.initialDisplayQty ??
        variant.stock ??
        variant.quantity ??
        variant.qty ??
        0
    ),
    purchase_price: Number(
      variant.purchase_price ??
        variant.purchasePrice ??
        variant.cost_price ??
        variant.costPrice ??
        group.purchase_price ??
        group.cost_price ??
        0
    ),
    sale_price: salePriceEnabled && salePrice > 0 && salePrice < regularPrice ? salePrice : 0,
    price: regularPrice,
    image_url: String(
      variant.variant_image_url ??
        variant.color_image_url ??
        variant.image_url ??
        variant.imageUrl ??
        variant.url ??
        variant.path ??
        variant.file_path ??
        variant.image ??
        group.image_url ??
        group.url ??
        group.path ??
        group.file_path ??
        group.imageUrl ??
        ""
    ).trim(),
    manufacturer_id: normalizeIncomingManufacturerId(
      variant.manufacturer_id ?? variant.manufacturerId ?? group.manufacturer_id ?? group.manufacturerId
    ),
    supplier_id: normalizeOptionalForeignKey(variant.supplier_id ?? variant.supplierId ?? group.supplier_id ?? group.supplierId),
    warehouse_id: normalizeOptionalForeignKey(variant.warehouse_id ?? variant.warehouseId ?? group.warehouse_id ?? group.warehouseId),
    branch_id: normalizeOptionalForeignKey(variant.branch_id ?? variant.branchId ?? group.branch_id ?? group.branchId),
    edition_name: String(variant.edition_name ?? variant.editionName ?? group.edition_name ?? group.editionName ?? "").trim(),
    edition_slug: slugifyEdition(variant.edition_name ?? variant.editionName ?? group.edition_name ?? group.editionName ?? variant.edition_slug ?? variant.editionSlug ?? ""),
    warehouse_stock: variant.warehouse_stock ?? variant.warehouseStock ?? variant.warehouses ?? null,
  };
};

const normalizeIncomingVariants = (variants = []) => {
  if (!Array.isArray(variants)) return [];

  return variants.flatMap((entry) => {
    const sizes = Array.isArray(entry?.sizes) ? entry.sizes : null;
    if (!sizes) return [normalizeIncomingVariant(entry)];

    return sizes.map((sizeRow) => normalizeIncomingVariant(sizeRow, entry));
  }).filter((variant) => variant.color || variant.size || variant.sku || variant.barcode || variant.article_code);
};

const normalizeVariantsForMode = ({ variationMode, variants = [], fixedSizeLabel = "" }) => {
  const mode = normalizeVariationMode(variationMode);
  const normalizedVariants = normalizeIncomingVariants(variants);

  if (mode === "simple") {
    return [];
  }

  if (mode === "color_only") {
    const fixedSize = String(fixedSizeLabel || "One Size").trim() || "One Size";
    return normalizedVariants
      .map((variant) => ({
        ...variant,
        size: fixedSize,
      }))
      .filter((variant) => variant.color || variant.sku || variant.barcode || variant.image_url);
  }

  return normalizedVariants;
};

const resolveExistingVariantId = async (client, { productId, tenantId, variant }) => {
  if (variant.id) return variant.id;
  const color = String(variant.color || "").trim();
  const size = String(variant.size || "").trim();
  if (!color && !size) return null;

  const result = await client.query(
    `
    SELECT id
    FROM product_variants
    WHERE product_id = $1
      AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
      AND LOWER(TRIM(COALESCE(color, ''))) = LOWER(TRIM($3))
      AND LOWER(TRIM(COALESCE(size, ''))) = LOWER(TRIM($4))
    ORDER BY CASE WHEN is_active IS DISTINCT FROM FALSE AND deleted_at IS NULL THEN 0 ELSE 1 END, id ASC
    LIMIT 1
    FOR UPDATE
    `,
    [productId, tenantId, color, size]
  );

  return result.rows[0]?.id || null;
};

const assertVariantSkuBarcodeAvailable = async (client, { tenantId, productId, variant }) => {
  const sku = String(variant.sku || "").trim();
  const barcode = String(variant.barcode || "").trim();
  if (!sku && !barcode) return;

  const result = await client.query(
    `
    SELECT id, product_id, sku, barcode
    FROM product_variants
    WHERE ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
      AND ($2::bigint IS NULL OR id <> $2::bigint)
      AND is_active IS DISTINCT FROM FALSE
      AND deleted_at IS NULL
      AND (
        ($3::text <> '' AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM($3::text)))
        OR ($4::text <> '' AND LOWER(TRIM(COALESCE(barcode, ''))) = LOWER(TRIM($4::text)))
      )
    LIMIT 1
    `,
    [tenantId, variant.id || null, sku, barcode]
  );

  const duplicate = result.rows[0];
  if (!duplicate) {
    const productResult = await client.query(
      `
      SELECT id, sku, barcode
      FROM products
      WHERE ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
        AND ($2::bigint IS NULL OR id <> $2::bigint)
        AND (
          ($3::text <> '' AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM($3::text)))
          OR ($4::text <> '' AND LOWER(TRIM(COALESCE(barcode, ''))) = LOWER(TRIM($4::text)))
        )
      LIMIT 1
      `,
      [tenantId, productId || null, sku, barcode]
    );
    const duplicateProduct = productResult.rows[0];
    if (!duplicateProduct) return;

    const duplicateField =
      barcode && String(duplicateProduct.barcode || "").trim().toLowerCase() === barcode.toLowerCase()
        ? "barcode"
        : "sku";
    throw duplicateConflictError(`Variant ${duplicateField} is already used by another product`, {
      field: duplicateField,
      product_id: duplicateProduct.id,
    });
  }

  const duplicateField =
    barcode && String(duplicate.barcode || "").trim().toLowerCase() === barcode.toLowerCase()
      ? "barcode"
      : "sku";
  throw duplicateConflictError(`Variant ${duplicateField} is already used by another product variant`, {
    field: duplicateField,
    variant_id: duplicate.id,
    product_id: duplicate.product_id,
  });
};

const skuExists = async (client, { tenantId, sku, productId = null, variantId = null }) => {
  const normalizedSku = normalizeSku(sku);
  if (!normalizedSku) return false;
  const productResult = await client.query(
    `
    SELECT id
    FROM products
    WHERE ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
      AND ($2::bigint IS NULL OR id <> $2::bigint)
      AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM($3::text))
    LIMIT 1
    `,
    [tenantId, productId, normalizedSku]
  );
  if (productResult.rows.length > 0) return true;

  const variantResult = await client.query(
    `
    SELECT id
    FROM product_variants
    WHERE ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
      AND ($2::bigint IS NULL OR id <> $2::bigint)
      AND is_active IS DISTINCT FROM FALSE
      AND deleted_at IS NULL
      AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM($3::text))
    LIMIT 1
    `,
    [tenantId, variantId, normalizedSku]
  );
  return variantResult.rows.length > 0;
};

const makeUniqueSku = async (client, { tenantId, sku, productId = null, variantId = null, reservedSkus = new Set() }) => {
  const base = normalizeSku(sku) || "PRD";
  let candidate = base;
  let sequence = 2;
  while (
    reservedSkus.has(candidate.toLowerCase()) ||
    (await skuExists(client, { tenantId, sku: candidate, productId, variantId }))
  ) {
    candidate = `${base}-${sequence}`.slice(0, 60);
    sequence += 1;
  }
  reservedSkus.add(candidate.toLowerCase());
  return candidate;
};

const insertProductVariant = async (client, { productId, tenantId, variant, skuPrefix = "", reservedSkus = new Set() }) => {
  if (!tenantId) {
    throw Object.assign(new Error("Tenant context missing"), { status: 400, code: "TENANT_CONTEXT_MISSING" });
  }
  const normalizedVariantImageUrl = String(variant.image_url || variant.variant_image_url || variant.color_image_url || variant.image || "").trim();
  const normalizedThermalImageUrl = String(variant.thermal_image_url || variant.variant_thermal_image_url || variant.color_thermal_image_url || "").trim();
  const nextVariantThermalImageStatus = normalizedVariantImageUrl ? "pending" : normalizedThermalImageUrl ? "ready" : "pending";
  const nextVariantThermalImageUrl = normalizedVariantImageUrl ? "" : normalizedThermalImageUrl;
  const nextVariantThermalImageGeneratedAt = normalizedVariantImageUrl ? null : normalizedThermalImageUrl ? new Date().toISOString() : null;
  const nextVariantThermalImageError = "";
  const nextVariant = {
    ...variant,
    sku: await makeUniqueSku(client, {
      tenantId,
      sku: variant.sku || buildVariantSku({ prefix: skuPrefix, color: variant.color, size: variant.size }),
      productId,
      reservedSkus,
    }),
  };
  await assertVariantSkuBarcodeAvailable(client, { tenantId, productId, variant: nextVariant });
  const created = await client.query(
    `
    INSERT INTO product_variants (
      tenant_id,
      product_id,
      manufacturer_id,
      supplier_id,
      warehouse_id,
      branch_id,
      color,
      size,
      sku,
      barcode,
      article_code,
      image_url,
      thermal_image_url,
      thermal_image_status,
      thermal_image_generated_at,
      thermal_image_error,
      cost_price,
      price,
      sale_price,
      edition_name,
      edition_slug,
      default_purchase_qty,
      is_active,
      deleted_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, ''), $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, TRUE, NULL)
    RETURNING *
    `,
    [
      tenantId,
      productId,
      nextVariant.manufacturer_id,
      nextVariant.supplier_id,
      nextVariant.warehouse_id,
      nextVariant.branch_id,
      nextVariant.color,
      nextVariant.size,
      nextVariant.sku,
      nextVariant.barcode,
      nextVariant.article_code || "",
      normalizedVariantImageUrl,
      nextVariantThermalImageUrl,
      nextVariantThermalImageStatus,
      nextVariantThermalImageGeneratedAt,
      nextVariantThermalImageError,
      nextVariant.purchase_price,
      nextVariant.price,
      nextVariant.sale_price,
      nextVariant.edition_name || null,
      nextVariant.edition_slug || slugifyEdition(nextVariant.edition_name) || null,
      Math.max(0, Number(nextVariant.default_purchase_qty || 0)),
    ]
  );

  const createdVariant = created.rows[0];
  console.log("[product-save] persisted variant image", {
    productId,
    variantId: createdVariant.id,
    color: createdVariant.color,
    size: createdVariant.size,
    image_url: createdVariant.image_url,
  });
  return {
    ...createdVariant,
    thermal_image_generation_needed: Boolean(normalizedVariantImageUrl),
  };
};

const updateProductVariant = async (client, { productId, tenantId, variant, userId, skuPrefix = "", reservedSkus = new Set() }) => {
  const requestedVariantId = normalizeOptionalForeignKey(variant.id);
  const resolvedVariantId = await resolveExistingVariantId(client, {
    productId,
    tenantId,
    variant: {
      ...variant,
      id: requestedVariantId,
    },
  });
  const hasExistingVariantId = Boolean(requestedVariantId);
  const nextVariant = {
    ...variant,
    id: resolvedVariantId,
  };
  const currentResult = await client.query(
    `
    SELECT id, product_id, stock, tenant_id, image_url, thermal_image_url, thermal_image_status, thermal_image_generated_at, thermal_image_error
    FROM product_variants
    WHERE id = $1
      AND product_id = $2
      AND ($3::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $3::bigint)
    FOR UPDATE
    `,
    [resolvedVariantId, productId, tenantId]
  );

  if (currentResult.rows.length === 0) {
    if (hasExistingVariantId) {
      throw new Error(`Variant ${requestedVariantId} was not found for product ${productId}`);
    }

    return insertProductVariant(client, { productId, tenantId, variant: nextVariant, userId, referenceType: "product_edit", skuPrefix, reservedSkus });
  }

  nextVariant.sku = await makeUniqueSku(client, {
    tenantId,
    sku: nextVariant.sku || buildVariantSku({ prefix: skuPrefix, color: nextVariant.color, size: nextVariant.size }),
    productId,
    variantId: nextVariant.id,
    reservedSkus,
  });
  await assertVariantSkuBarcodeAvailable(client, { tenantId, productId, variant: nextVariant });
  const currentVariantRow = currentResult.rows[0] || {};
  const incomingVariantImageUrl = String(variant.image_url || variant.variant_image_url || variant.color_image_url || variant.image || "").trim();
  const currentImageUrl = String(currentVariantRow.image_url || "").trim();
  const imageChanged = Boolean(incomingVariantImageUrl && incomingVariantImageUrl !== currentImageUrl);
  const nextVariantImageUrl = imageChanged ? incomingVariantImageUrl : currentImageUrl;
  const nextVariantThermalImageUrl = imageChanged ? "" : String(currentVariantRow.thermal_image_url || "").trim();
  const nextVariantThermalImageStatus = imageChanged
    ? "pending"
    : normalizeThermalImageStatus(currentVariantRow.thermal_image_status, currentVariantRow.thermal_image_url || "");
  const nextVariantThermalImageGeneratedAt = imageChanged ? null : normalizeThermalTimestamp(currentVariantRow.thermal_image_generated_at);
  const nextVariantThermalImageError = imageChanged ? "" : normalizeThermalError(currentVariantRow.thermal_image_error);
  if (imageChanged) {
    console.log("THERMAL_IMAGE_STALE_RESET", {
      entityType: "variant",
      productId,
      variantId: resolvedVariantId,
      tenantId,
      previousImageUrl: currentImageUrl,
      nextImageUrl: nextVariantImageUrl,
    });
  }
  const updated = await client.query(
    `
    UPDATE product_variants
    SET
      manufacturer_id = $1,
      supplier_id = $2,
      warehouse_id = $3,
      branch_id = $4,
      color = $5,
      size = $6,
      sku = $7,
      barcode = $8,
      article_code = NULLIF($9, ''),
      image_url = $10,
      thermal_image_url = $11,
      thermal_image_status = $12,
      thermal_image_generated_at = $13,
      thermal_image_error = $14,
      cost_price = $15,
      price = $16,
      sale_price = $17,
      edition_name = $18,
      edition_slug = $19,
      default_purchase_qty = COALESCE($20, default_purchase_qty),
      is_active = TRUE,
      deleted_at = NULL
    WHERE id = $21
      AND product_id = $22
      AND ($23::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $23::bigint)
    RETURNING *
    `,
    [
      nextVariant.manufacturer_id,
      nextVariant.supplier_id,
      nextVariant.warehouse_id,
      nextVariant.branch_id,
      nextVariant.color,
      nextVariant.size,
      nextVariant.sku,
      nextVariant.barcode,
      nextVariant.article_code || "",
      nextVariantImageUrl,
      nextVariantThermalImageUrl,
      nextVariantThermalImageStatus,
      nextVariantThermalImageGeneratedAt,
      nextVariantThermalImageError,
      nextVariant.purchase_price,
      nextVariant.price,
      nextVariant.sale_price,
      nextVariant.edition_name || null,
      nextVariant.edition_slug || slugifyEdition(nextVariant.edition_name) || null,
      nextVariant.default_purchase_qty === undefined || nextVariant.default_purchase_qty === null || nextVariant.default_purchase_qty === ""
        ? null
        : Math.max(0, Number(nextVariant.default_purchase_qty || 0)),
      nextVariant.id,
      productId,
      tenantId,
    ]
  );
  console.log("[product-save] persisted variant image", {
    productId,
    variantId: updated.rows[0]?.id,
    color: updated.rows[0]?.color,
    size: updated.rows[0]?.size,
    image_url: updated.rows[0]?.image_url,
  });

  return {
    ...updated.rows[0],
    thermal_image_generation_needed: imageChanged,
  };
};

const archiveMissingProductVariants = async (client, { productId, tenantId, savedVariantIds = [] }) => {
  const ids = [...new Set((Array.isArray(savedVariantIds) ? savedVariantIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];
  const result = await client.query(
    `
    UPDATE product_variants
    SET
      is_active = FALSE,
      deleted_at = COALESCE(deleted_at, NOW())
    WHERE product_id = $1
      AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
      AND is_active IS DISTINCT FROM FALSE
      AND deleted_at IS NULL
      AND NOT (id = ANY($3::bigint[]))
    RETURNING id, color, size
    `,
    [productId, tenantId, ids]
  );

  if (result.rows.length > 0) {
    await client.query(
      `
      DELETE FROM product_variant_images
      WHERE product_id = $1
        AND variant_id = ANY($2::bigint[])
        AND tenant_id = $3
      `,
      [productId, result.rows.map((row) => row.id), tenantId]
    );
  }

  return result.rows;
};

const archiveProductVariantsByIds = async (client, { productId, tenantId, variantIds = [] }) => {
  const ids = [...new Set((Array.isArray(variantIds) ? variantIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];

  if (!ids.length) return [];

  const result = await client.query(
    `
    UPDATE product_variants
    SET
      is_active = FALSE,
      deleted_at = COALESCE(deleted_at, NOW())
    WHERE product_id = $1
      AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
      AND id = ANY($3::bigint[])
      AND is_active IS DISTINCT FROM FALSE
      AND deleted_at IS NULL
    RETURNING id, color, size
    `,
    [productId, tenantId, ids]
  );

  if (result.rows.length > 0) {
    await client.query(
      `
      DELETE FROM product_variant_images
      WHERE product_id = $1
        AND variant_id = ANY($2::bigint[])
        AND tenant_id = $3
      `,
      [productId, result.rows.map((row) => row.id), tenantId]
    );
  }

  return result.rows;
};

const loadActiveProductVariantSnapshot = async (client, { productId, tenantId }) => {
  const result = await client.query(
    `
    SELECT id, color, size, stock, default_purchase_qty, image_url, is_active, deleted_at
    FROM product_variants
    WHERE product_id = $1
      AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
      AND is_active IS DISTINCT FROM FALSE
      AND deleted_at IS NULL
    ORDER BY color ASC NULLS LAST, size ASC NULLS LAST, id ASC
    `,
    [productId, tenantId]
  );
  return result.rows || [];
};

export const getProducts = async (req, res) => {
  const scope = resolveProductRequestScope(req);

  console.log("[products] request start", {
    route: "GET /api/products",
    method: req.method,
    url: req.originalUrl,
    userAvailable: Boolean(req.user),
    ...scope,
    query: {
      page: req.query.page ?? null,
      limit: req.query.limit ?? null,
      search: req.query.search ?? null,
    },
  });

  try {
    await ensureProductSchema();
    const columns = await getProductColumns();
    const scopeClause = buildProductScopeClause({ columns, scope });

    console.log("[products] final where scope", {
      route: "GET /api/products",
      userId: scope.userId,
      company_id: scope.company_id,
      workspace_id: scope.workspace_id,
      whereScope: scopeClause.whereScope,
    });

    const result = await runTimedProductQuery({
      route: "GET /api/products",
      label: "list-products",
      text: `
        SELECT
          p.*,
          COALESCE(p.image_url, '') AS image_url,
          COALESCE(p.thumbnail_url, '') AS thumbnail_url,
          COALESCE(p.photo_url, '') AS photo_url,
          COALESCE(p.image, '') AS image,
          COALESCE(p.gallery_images, '[]'::jsonb) AS gallery_images,
          c.name AS category_name,
          b.name AS brand_name,
          u.name AS unit_name,
          u.abbreviation AS unit_abbreviation
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN units u ON u.id = p.unit_id
        ${scopeClause.whereSql}
        ORDER BY p.id DESC
      `,
      values: scopeClause.values,
      scope,
    });

    const normalizedRows = await withProductAudiences(db, result.rows.map(normalizeProductRow));
    logProductsPriceRead(normalizedRows);
    const payload = normalizeResponse(normalizedRows);
    res.json(payload);

    console.log("[products] response sent", {
      route: "GET /api/products",
      rows: result.rows.length,
      count: payload.products.length,
    });
    return;
  } catch (error) {
    console.error("[products] request error", {
      route: "GET /api/products",
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: error.message,
    });
  }
};

export const getProductsWithVariants = async (req, res) => {
  const scope = resolveProductRequestScope(req);

  console.log("[products] request start", {
    route: "GET /api/products/with-variants",
    method: req.method,
    url: req.originalUrl,
    userAvailable: Boolean(req.user),
    ...scope,
    query: {
      page: req.query.page ?? null,
      limit: req.query.limit ?? null,
      search: req.query.search ?? null,
    },
  });

  try {
    await ensureProductSchema();
    try {
      await ensureProductVariantSchema();
      await ensureProductVariantManufacturerColumn();
      await ensureProductVariantImagesSchema();
    } catch (schemaError) {
      console.error("[products/with-variants] variant schema ensure failed:", schemaError);
    }

    const columns = await getProductColumns();
    const scopeClause = buildProductScopeClause({ columns, scope });
    const productQueryValues = [...scopeClause.values];
    const productSearchClause = buildProductSearchClause({
      values: productQueryValues,
      search: req.query.search ?? req.query.q ?? "",
    });
    let productWhereSql = [
      scopeClause.whereSql,
      productSearchClause ? `${scopeClause.whereSql ? "AND" : "WHERE"} ${productSearchClause}` : "",
    ].filter(Boolean).join("\n");
    const requestedProductId = Number(req.query.productId ?? req.query.product_id ?? 0);
    if (Number.isFinite(requestedProductId) && requestedProductId > 0) {
      productQueryValues.push(requestedProductId);
      productWhereSql = [
        productWhereSql,
        `${productWhereSql ? "AND" : "WHERE"} p.id = $${productQueryValues.length}`,
      ].filter(Boolean).join("\n");
    }
    console.log("[products] final where scope", {
      route: "GET /api/products/with-variants",
      userId: scope.userId,
      company_id: scope.company_id,
      workspace_id: scope.workspace_id,
      whereScope: scopeClause.whereScope,
      search: req.query.search ?? req.query.q ?? null,
    });

    const productsResult = await runTimedProductQuery({
      route: "GET /api/products/with-variants",
      label: "list-products-base",
      text: `
        SELECT
          p.*,
          COALESCE(p.image_url, '') AS image_url,
          COALESCE(p.thumbnail_url, '') AS thumbnail_url,
          COALESCE(p.photo_url, '') AS photo_url,
          COALESCE(p.image, '') AS image,
          COALESCE(p.gallery_images, '[]'::jsonb) AS gallery_images,
          c.name AS category_name,
          b.name AS brand_name,
          u.name AS unit_name,
          u.abbreviation AS unit_abbreviation
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN units u ON u.id = p.unit_id
        ${productWhereSql}
        ORDER BY p.id DESC
      `,
      values: productQueryValues,
      scope,
    });

    let variantRows = [];
    const variantProductIds = (Array.isArray(productsResult.rows) ? productsResult.rows : [])
      .map((product) => Number(product.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    try {
      if (variantProductIds.length) {
        const variantsResult = await runTimedProductQuery({
          route: "GET /api/products/with-variants",
          label: "list-product-variants",
          text: `
            SELECT
              v.*,
              v.id AS variant_id,
              v.manufacturer_id AS variant_manufacturer_id,
              m.name AS variant_manufacturer_name,
              m.name AS manufacturer_name
            FROM product_variants v
            LEFT JOIN manufacturers m ON m.id = v.manufacturer_id
            WHERE v.product_id = ANY($1::bigint[])
              AND v.is_active IS DISTINCT FROM FALSE
              AND v.deleted_at IS NULL
            ORDER BY v.product_id DESC, v.id ASC
          `,
          values: [variantProductIds],
          scope,
        });
        variantRows = Array.isArray(variantsResult.rows) ? variantsResult.rows : [];
      }
    } catch (variantError) {
      console.error("[products/with-variants] failed to fetch variants:", variantError);
      variantRows = [];
    }

    const grouped = new Map();
    for (const productRow of Array.isArray(productsResult.rows) ? productsResult.rows : []) {
      const normalizedProduct = normalizeProductRow(productRow);
      const productId = String(normalizedProduct.product_id ?? normalizedProduct.id ?? "");
      if (!productId) continue;
      grouped.set(productId, {
        ...normalizedProduct,
        id: normalizedProduct.id ?? normalizedProduct.product_id ?? null,
        product_id: normalizedProduct.product_id ?? normalizedProduct.id ?? null,
        variants: [],
      });
    }

    for (const variantRow of variantRows) {
      const productId = String(variantRow.product_id ?? variantRow.id ?? "");
      if (!productId) continue;
      const existing = grouped.get(productId);
      if (!existing) continue;
      existing.variants.push(normalizeVariantRow(variantRow));
    }

    const productIds = Array.from(grouped.keys()).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
    const imageBundleMap = productIds.length ? await loadProductVariantImages(db, productIds).catch(() => new Map()) : new Map();

    const normalizedProducts = await withProductAudiences(db, Array.from(grouped.values()).map((product) => ({
        ...product,
        variants: attachVariantImages(Array.isArray(product.variants) ? product.variants : [], imageBundleMap.get(String(product.id ?? product.product_id ?? "")) || null),
        color_images: attachGroupedColorImages(
          deriveColorGroupsFromVariants(Array.isArray(product.variants) ? product.variants : []),
          imageBundleMap.get(String(product.id ?? product.product_id ?? "")) || null
        ),
        image_url:
          product.image_url ||
          product.product_image_url ||
          product.variants?.[0]?.image_url ||
          product.variants?.[0]?.variant_image_url ||
          "",
        product_image_url:
          product.product_image_url ||
          product.image_url ||
          product.variants?.[0]?.image_url ||
          product.variants?.[0]?.variant_image_url ||
          "",
      })));
    logProductsPriceRead(normalizedProducts);
    if (Number.isFinite(requestedProductId) && requestedProductId > 0) {
      normalizedProducts.forEach(logProductDetailsPriceDebug);
    }
    const payload = normalizeResponse(normalizedProducts);

    res.json(payload);
    console.log("[products] response sent", {
      route: "GET /api/products/with-variants",
      rows: Array.isArray(productsResult.rows) ? productsResult.rows.length : 0,
      variantsRows: variantRows.length,
      count: payload.products.length,
    });
    return;
  } catch (error) {
    console.error("[with-variants] crash:", error, error?.stack);
    return res.status(500).json({
      message: "Failed to fetch variants",
      error: error.message,
      stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
    });
  }
};

export const loadProductsWithVariantsPayload = async ({ query = {}, user = null, requestId = "employee-portal-products" } = {}) => {
  let statusCode = 200;
  let payload = null;

  const mockReq = {
    id: requestId,
    method: "GET",
    originalUrl: "/api/products/with-variants",
    query,
    user,
  };
  const mockRes = {
    status(code) {
      statusCode = Number(code || 500);
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };

  await getProductsWithVariants(mockReq, mockRes);

  if (statusCode >= 400) {
    const error = new Error(payload?.message || payload?.error || "Failed to fetch products with variants");
    error.status = statusCode;
    error.payload = payload;
    throw error;
  }

  return payload;
};

export const getProductByQrToken = async (req, res) => {
  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await ensureProductVariantManufacturerColumn();
    await ensureProductVariantImagesSchema();
    await ensureInventorySchema();
    await ensureProductQrTokens();

    const token = String(req.params.token || "").trim();
    if (!token) {
      return res.status(404).json({
        success: false,
        message: "Product QR not found",
      });
    }

    const result = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.brand,
        p.category,
        p.gender,
        p.variation_mode,
        p.fixed_size_label,
        p.purchase_alerts_enabled,
        p.purchase_alert_by_color,
        p.carton_size,
        p.suggested_purchase_cartons,
        p.qr_token,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS product_image_url,
        COALESCE(NULLIF(p.thermal_image_url, ''), '') AS thermal_image_url,
        COALESCE(NULLIF(p.thermal_image_status, ''), CASE WHEN COALESCE(NULLIF(p.thermal_image_url, ''), '') <> '' THEN 'ready' ELSE 'pending' END) AS thermal_image_status,
        v.id AS variant_id,
        v.color,
        v.size,
        v.sku,
        v.barcode,
        v.price AS sale_price,
        v.stock AS stock_quantity,
        COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, ''), NULLIF(v.photo_url, ''), NULLIF(v.thumbnail_url, ''), '') AS variant_image_url,
        COALESCE(NULLIF(v.thermal_image_url, ''), '') AS variant_thermal_image_url,
        COALESCE(NULLIF(v.thermal_image_status, ''), CASE WHEN COALESCE(NULLIF(v.thermal_image_url, ''), '') <> '' THEN 'ready' ELSE 'pending' END) AS variant_thermal_image_status
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
        AND v.is_active IS DISTINCT FROM FALSE
        AND v.deleted_at IS NULL
      WHERE p.qr_token = $1
        AND p.is_active IS DISTINCT FROM FALSE
        AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
      ORDER BY v.color ASC NULLS LAST, v.size ASC NULLS LAST, v.id ASC
      `,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product QR not found. Please scan a valid Barcode Shop label.",
      });
    }

    const first = result.rows[0];
    const audienceMap = await loadProductAudienceMap(db, [first.id]).catch(() => new Map());
    const audiences = audienceMap.get(String(first.id)) || normalizeProductAudiences(first.gender);
    const imageBundleMap = await loadProductVariantImages(db, [first.id]).catch(() => new Map());
    const imageBundle = imageBundleMap.get(String(first.id)) || null;
    const normalizedVariants = attachVariantImages(
      result.rows
        .filter((row) => row.variant_id)
        .map((row) => ({
          id: row.variant_id,
          variant_id: row.variant_id,
          product_id: row.id,
          color: row.color || "",
          size: row.size || "",
          sku: row.sku || "",
          barcode: row.barcode || "",
          price: Number(row.sale_price || 0),
          sale_price: Number(row.sale_price || 0),
          stock: Number(row.stock_quantity || 0),
          image_url: row.variant_image_url || first.product_image_url || "",
          thermal_image_url: row.variant_thermal_image_url || first.thermal_image_url || "",
          thermal_image_status: row.variant_thermal_image_status || first.thermal_image_status || "pending",
        })),
      imageBundle
    );
    const colorMap = new Map();

    normalizedVariants.forEach((variant) => {
      const color = variant.color || "Default";
      const key = String(color).trim().toLowerCase() || "default";
      if (!colorMap.has(key)) {
        colorMap.set(key, {
          color,
          image_url: variant.primary_image_url || variant.image_url || first.product_image_url || "",
          colorPrimaryImageUrl: variant.primary_image_url || variant.image_url || first.product_image_url || "",
          color_image_url: variant.color_image_url || variant.primary_image_url || variant.image_url || first.product_image_url || "",
          thermal_image_url: variant.thermal_image_url || variant.variant_color_thermal_image_url || variant.color_thermal_image_url || first.thermal_image_url || "",
          thermal_image_status: variant.thermal_image_status || first.thermal_image_status || "pending",
          color_thermal_image_url: variant.color_thermal_image_url || variant.variant_color_thermal_image_url || variant.thermal_image_url || first.thermal_image_url || "",
          variant_color_thermal_image_url: variant.variant_color_thermal_image_url || variant.color_thermal_image_url || variant.thermal_image_url || first.thermal_image_url || "",
          product_thermal_image_url: first.thermal_image_url || "",
          images: variant.images || [],
          sizes: [],
        });
      }

      const group = colorMap.get(key);
      if (!group.image_url) {
        group.image_url = variant.primary_image_url || variant.image_url || first.product_image_url || "";
      }
      if (Array.isArray(variant.images) && variant.images.length) {
        group.images = [...new Map([...group.images, ...variant.images].map((item) => [item.image_url, item])).values()];
      }

      group.sizes.push({
        variant_id: variant.variant_id,
        size: variant.size || "One size",
        sku: variant.sku || "",
        barcode: variant.barcode || "",
        sale_price: Number(variant.price || 0),
        stock_quantity: Number(variant.stock || 0),
        available: Number(variant.stock || 0) > 0,
        image_url: variant.primary_image_url || variant.image_url || first.product_image_url || "",
        variant_image_url: variant.primary_image_url || variant.image_url || "",
        colorPrimaryImageUrl: variant.primary_image_url || variant.image_url || first.product_image_url || "",
        color_image_url: variant.color_image_url || variant.primary_image_url || variant.image_url || "",
        thermal_image_url: variant.thermal_image_url || variant.variant_color_thermal_image_url || variant.color_thermal_image_url || first.thermal_image_url || "",
        thermal_image_status: variant.thermal_image_status || first.thermal_image_status || "pending",
        color_thermal_image_url: variant.color_thermal_image_url || variant.variant_color_thermal_image_url || variant.thermal_image_url || first.thermal_image_url || "",
        variant_color_thermal_image_url: variant.variant_color_thermal_image_url || variant.color_thermal_image_url || variant.thermal_image_url || first.thermal_image_url || "",
        product_thermal_image_url: first.thermal_image_url || "",
        images: variant.images || [],
      });
    });

    return res.json({
      success: true,
      product: {
        id: first.id,
        name: first.name,
        image_url: first.product_image_url || "",
        product_image_url: first.product_image_url || "",
        thermal_image_url: first.thermal_image_url || "",
        thermal_image_status: first.thermal_image_status || "pending",
        qr_token: first.qr_token,
        brand: first.brand || "Unbranded",
        category: first.category || "Uncategorized",
        gender: first.gender || audiences[0] || "",
        audiences,
        product_audiences: audiences,
        variation_mode: first.variation_mode || "full_variations",
        fixed_size_label: first.fixed_size_label || "",
        purchase_alerts_enabled: first.purchase_alerts_enabled === true || String(first.purchase_alerts_enabled || "").toLowerCase() === "true",
        purchase_alert_by_color: first.purchase_alert_by_color === true || String(first.purchase_alert_by_color || "").toLowerCase() === "true",
        carton_size: first.carton_size === null || first.carton_size === undefined || first.carton_size === "" ? null : Number(first.carton_size),
        suggested_purchase_cartons:
          Number.isFinite(Number(first.suggested_purchase_cartons)) && Number(first.suggested_purchase_cartons) >= 1
            ? Math.floor(Number(first.suggested_purchase_cartons))
            : 1,
        colors: Array.from(colorMap.values()),
        variants: normalizedVariants,
        color_images: Array.from(colorMap.values()),
      },
    });
  } catch (error) {
    console.error("[products] qr lookup error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load Barcode Shop product",
      error: error.message,
    });
  }
};

export const createProduct = async (req, res) => {
  const client = await db.connect();
  let transactionStarted = false;

  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await ensureProductVariantManufacturerColumn();
    await ensureProductVariantImagesSchema();
    const {
      name,
      description,
      description_ar,
      description_en,
      meta_title,
      seo_description,
      seo_keywords,
      canonical_slug,
      regular_price,
      price,
      sale_price,
      offer_price,
      sale_price_enabled,
      sale_reason,
      sale_start_at,
      sale_end_at,
      purchase_alerts_enabled,
      purchase_alert_by_color,
      carton_size,
      suggested_purchase_cartons,
      use_custom_compare_price,
      custom_compare_price,
      cost_price,
      purchase_price,
      wholesale_price,
      category_id,
      sub_category_id,
      child_category_id,
      brand_id,
      unit_id,
      manufacturer_id,
      supplier_id,
      warehouse_id,
      brand,
      category,
      main_category,
      sub_category,
      child_category,
      gender,
      audiences,
      product_audiences,
      product_type,
      style,
      grade,
      is_offer_story,
      is_storefront_visible,
      status,
      sku,
      barcode,
      image_url,
      thermal_image_url,
      gallery,
      gallery_images,
      variation_mode,
      fixed_size_label,
      low_stock_threshold,
      low_stock_alert,
      low_stock_tracking_mode,
      product_low_stock_threshold,
      minimum_distinct_sizes_required,
      tax_rate,
      variants,
      colorImages,
      variant_groups_count,
      variant_rows_count,
    } = req.body || {};
    const normalizedForeignKeys = {
      category_id: normalizeOptionalForeignKey(category_id),
      sub_category_id: normalizeOptionalForeignKey(sub_category_id),
      child_category_id: normalizeOptionalForeignKey(child_category_id),
      brand_id: normalizeOptionalForeignKey(brand_id),
      unit_id: normalizeOptionalForeignKey(unit_id),
      manufacturer_id: normalizeOptionalForeignKey(manufacturer_id),
      supplier_id: normalizeOptionalForeignKey(supplier_id),
      warehouse_id: normalizeOptionalForeignKey(warehouse_id),
    };
    const normalizedVariationMode = normalizeVariationMode(variation_mode);
    const normalizedLowStockTrackingMode = normalizeLowStockTrackingMode(low_stock_tracking_mode);
    const normalizedProductLowStockThreshold = normalizeNonNegativeInteger(product_low_stock_threshold, 0);
    const normalizedMinimumDistinctSizesRequired = normalizeNonNegativeInteger(minimum_distinct_sizes_required, 0);
    const normalizedFixedSizeLabel = String(fixed_size_label || "").trim();
    const normalizedPurchaseAlertsEnabled = normalizePurchaseAlertsEnabled(purchase_alerts_enabled, true);
    const normalizedPurchaseAlertByColor = normalizePurchaseAlertByColor(purchase_alert_by_color, false);
    const normalizedCartonSize = normalizeNullablePositiveInteger(carton_size, { fieldName: "carton_size" });
    const normalizedSuggestedPurchaseCartons = normalizePositiveInteger(suggested_purchase_cartons, {
      fieldName: "suggested_purchase_cartons",
      fallback: 1,
    });
    const normalizedVariants = normalizeVariantsForMode({
      variationMode: normalizedVariationMode,
      variants,
      fixedSizeLabel: normalizedFixedSizeLabel,
    });
    const normalizedAudiences = normalizeProductAudiences(audiences, product_audiences, gender);
    const normalizedGender = await normalizeClassificationValue("gender", gender || normalizedAudiences[0] || "");
    const normalizedProductType = await normalizeClassificationValue("product_type", product_type);
    const normalizedStyle = await normalizeClassificationValue("style", style);
    const normalizedGrade = await normalizeClassificationValue("grade", grade);
    const normalizedGalleryImages = Array.isArray(gallery_images)
      ? gallery_images
      : Array.isArray(gallery)
        ? gallery
        : [];

    console.log("[create-product] received variants", variants || []);
    console.log("[create-product] received variants count", Array.isArray(variants) ? variants.length : 0);
    console.log("[create-product] normalized variants", normalizedVariants);
    console.log("[create-product] normalized variants count", normalizedVariants.length);
    console.log("[product:create] payload variants", normalizedVariants);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }
    if (containsDataImageValue(image_url) || containsDataImageValue(gallery) || containsDataImageValue(gallery_images)) {
      return res.status(400).json({
        success: false,
        message: "Upload product images before saving",
      });
    }

    const expectedVariantGroups = Number(variant_groups_count || 0);
    const expectedVariantRows = Number(variant_rows_count || 0);
    const variantsKeyProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "variants");
    if (
      normalizedVariationMode !== "simple" &&
      (variantsKeyProvided || expectedVariantGroups > 0 || expectedVariantRows > 0) &&
      normalizedVariants.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "No variants provided",
      });
    }

    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    await client.query("BEGIN");
    transactionStarted = true;
    normalizedForeignKeys.category_id = await resolveDefaultCategoryId(client, {
      categoryId: normalizedForeignKeys.category_id,
      category,
      tenantId,
    });
    normalizedForeignKeys.unit_id = await resolveDefaultUnitId(client, {
      unitId: normalizedForeignKeys.unit_id,
      tenantId,
    });
    const normalizedRegularPrice = Number(regular_price || price || cost_price || purchase_price || wholesale_price || 0);
    const normalizedSalePrice = Number(sale_price || offer_price || 0);
    const normalizedSaleEnabled =
      (sale_price_enabled === true || String(sale_price_enabled || "").toLowerCase() === "true") &&
      normalizedSalePrice > 0 &&
      normalizedRegularPrice > 0 &&
      normalizedSalePrice < normalizedRegularPrice;
    const basePrice = normalizedRegularPrice;
    const normalizedDescriptionAr = String(description_ar || "").trim();
    const normalizedDescriptionEn = String(description_en || "").trim();
    const normalizedDescription = String(description || normalizedDescriptionEn || normalizedDescriptionAr || "").trim();
    const normalizedSeoDescription = String(seo_description || normalizedDescriptionEn || normalizedDescriptionAr || normalizedDescription || "").trim();
    const normalizedMetaTitle = String(meta_title || name || "").trim();
    const normalizedSeoKeywords = String(seo_keywords || "").trim();
    const normalizedCanonicalSlug = String(canonical_slug || "").trim();
    const finalProductSku = await makeUniqueSku(client, {
      tenantId,
      sku: sku || buildSmartSkuPrefix({
        name,
        brand,
        manufacturer_id,
        category,
        product_type: normalizedProductType,
        gender: normalizedGender,
        grade: normalizedGrade,
        meta_title: normalizedMetaTitle,
        seo_keywords: normalizedSeoKeywords,
      }),
    });
    const reservedVariantSkus = new Set([finalProductSku.toLowerCase()]);
    const parsedPayload = {
      name: String(name || "").trim(),
      category: category || "Uncategorized",
      brand: brand || "",
      unit_id: normalizedForeignKeys.unit_id,
      category_id: normalizedForeignKeys.category_id,
      sub_category_id: normalizedForeignKeys.sub_category_id,
      child_category_id: normalizedForeignKeys.child_category_id,
      brand_id: normalizedForeignKeys.brand_id,
      manufacturer_id: normalizedForeignKeys.manufacturer_id,
      supplier_id: normalizedForeignKeys.supplier_id,
      warehouse_id: normalizedForeignKeys.warehouse_id,
      variation_mode: normalizedVariationMode,
      variants_count: normalizedVariants.length,
    };
    console.log("[product:create] validation before insert", {
      category_id: normalizedForeignKeys.category_id,
      brand_id: normalizedForeignKeys.brand_id,
      unit_id: normalizedForeignKeys.unit_id,
      parsedPayload,
    });
    const finalProductSlug = normalizedCanonicalSlug || slugifyProductSlug(name) || slugifyProductSlug(finalProductSku) || "";
    const finalQrToken = `SHOP-PROD-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const normalizedProductImageUrl = String(image_url || "").trim();
    const normalizedThermalImageUrl = String(thermal_image_url || "").trim();
    const nextThermalImageStatus = normalizedProductImageUrl ? "pending" : normalizedThermalImageUrl ? "ready" : "pending";
    const nextThermalImageUrl = normalizedProductImageUrl ? "" : normalizedThermalImageUrl;
    const nextThermalImageGeneratedAt = normalizedProductImageUrl ? null : normalizedThermalImageUrl ? new Date().toISOString() : null;
    const nextThermalImageError = "";
    const insertColumns = [
      "tenant_id",
      "name",
      "description",
      "description_ar",
      "description_en",
      "meta_title",
      "seo_description",
      "seo_keywords",
      "slug",
      "canonical_slug",
      "qr_token",
      "regular_price",
      "price",
      "sale_price",
      "sale_price_enabled",
      "sale_reason",
      "sale_start_at",
      "sale_end_at",
      "use_custom_compare_price",
      "custom_compare_price",
      "cost_price",
      "wholesale_price",
      "brand",
      "category",
      "main_category",
      "sub_category",
      "child_category",
      "gender",
      "product_type",
      "style",
      "grade",
      "is_offer_story",
      "is_storefront_visible",
      "category_id",
      "brand_id",
      "unit_id",
      "manufacturer_id",
      "supplier_id",
      "warehouse_id",
      "status",
      "sku",
      "barcode",
      "image_url",
      "thermal_image_url",
      "thermal_image_status",
      "thermal_image_generated_at",
      "thermal_image_error",
      "gallery_images",
      "variation_mode",
      "fixed_size_label",
      "purchase_alerts_enabled",
      "purchase_alert_by_color",
      "carton_size",
      "suggested_purchase_cartons",
      "stock",
      "low_stock_alert",
      "low_stock_tracking_mode",
      "product_low_stock_threshold",
      "minimum_distinct_sizes_required",
      "tax_rate",
    ];
    const insertParams = [
      tenantId,
      String(name || "").trim(),
      normalizedDescription,
      normalizedDescriptionAr,
      normalizedDescriptionEn,
      normalizedMetaTitle,
      normalizedSeoDescription,
      normalizedSeoKeywords,
      finalProductSlug,
      normalizedCanonicalSlug || finalProductSlug,
      finalQrToken,
      basePrice,
      basePrice,
      normalizedSaleEnabled ? normalizedSalePrice : 0,
      normalizedSaleEnabled,
      normalizedSaleEnabled ? String(sale_reason || "").trim() : "",
      normalizedSaleEnabled && sale_start_at ? sale_start_at : null,
      normalizedSaleEnabled && sale_end_at ? sale_end_at : null,
      use_custom_compare_price === true || String(use_custom_compare_price || "").toLowerCase() === "true",
      Math.max(0, Number(custom_compare_price || 0)),
      Number(cost_price || purchase_price || 0),
      Number(wholesale_price || 0),
      brand || "",
      category || "",
      main_category || "",
      sub_category || "",
      child_category || "",
      normalizedGender || "",
      normalizedProductType || "",
      normalizedStyle || "",
      normalizedGrade || "",
      Boolean(is_offer_story === true || String(is_offer_story || "").toLowerCase() === "true"),
      is_storefront_visible === undefined || is_storefront_visible === null || String(is_storefront_visible).trim() === ""
        ? true
        : is_storefront_visible === true || String(is_storefront_visible || "").toLowerCase() === "true",
      normalizedForeignKeys.category_id,
      normalizedForeignKeys.brand_id,
      normalizedForeignKeys.unit_id,
      normalizedForeignKeys.manufacturer_id,
      normalizedForeignKeys.supplier_id,
      normalizedForeignKeys.warehouse_id,
      status || "active",
      finalProductSku,
      barcode || "",
      normalizedProductImageUrl,
      nextThermalImageUrl,
      nextThermalImageStatus,
      nextThermalImageGeneratedAt,
      nextThermalImageError,
      JSON.stringify(normalizedGalleryImages),
      normalizedVariationMode,
      normalizedFixedSizeLabel,
      normalizedPurchaseAlertsEnabled,
      normalizedPurchaseAlertByColor,
      normalizedCartonSize,
      normalizedSuggestedPurchaseCartons,
      0,
      Number(low_stock_alert || low_stock_threshold || 0),
      normalizedLowStockTrackingMode,
      normalizedProductLowStockThreshold,
      normalizedMinimumDistinctSizesRequired,
      Number(tax_rate || 0),
    ];
    const insertPlaceholders = insertColumns.map((_, index) => `$${index + 1}`);
    if (isDevelopment()) {
      console.log("[product:create] insert shape", {
        insertColumnCount: insertColumns.length,
        placeholderCount: insertPlaceholders.length,
        paramsLength: insertParams.length,
      });
    }
    const created = await client.query(
      `
      INSERT INTO products (${insertColumns.join(", ")})
      VALUES (${insertPlaceholders.join(", ")})
      RETURNING *
      `,
      insertParams
    );
    const productId = created.rows[0].id;
    await replaceProductAudiences(client, productId, normalizedAudiences);
    const insertedVariants = [];

    for (const variant of normalizedVariants) {
      insertedVariants.push(
        await insertProductVariant(client, {
          productId,
          tenantId,
          variant,
          skuPrefix: finalProductSku,
          reservedSkus: reservedVariantSkus,
          userId: req.user?.id || null,
          referenceType: "product",
        })
      );
    }

    const persistedVariantImageRows = await replaceProductVariantImages(client, {
      tenantId,
      productId,
      variants: Array.isArray(variants) ? variants : [],
      colorImages: Array.isArray(colorImages) ? colorImages : [],
    });

    const imageBundleMap = await loadProductVariantImages(client, [productId]).catch(() => new Map());
    const imageBundle = imageBundleMap.get(String(productId)) || null;
    const hydratedVariants = attachVariantImages(insertedVariants.map(normalizeVariantRow), imageBundle);
    const colorImagesPayload = attachGroupedColorImages(
      deriveColorGroupsFromVariants(hydratedVariants),
      imageBundle
    );

    console.log("[product:create] inserted variants", hydratedVariants);
    console.log("[create-product] inserted variants count", insertedVariants.length);

    const persistedVariantCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM product_variants WHERE product_id = $1",
      [productId]
    );
    const persistedVariantCount = Number(persistedVariantCountResult.rows[0]?.count || 0);
    console.log("[create-product] persisted variants db count", {
      productId,
      count: persistedVariantCount,
    });

    if (normalizedVariants.length > 0 && persistedVariantCount === 0) {
      throw new Error("No variants inserted for product");
    }

    await client.query("COMMIT");
    transactionStarted = false;
    const createdProduct = normalizeProductRow(created.rows[0]);

    scheduleThermalImageGeneration({
      entityType: "product",
      productId,
      tenantId,
      sourceImageUrl: createdProduct.image_url || createdProduct.product_image_url || "",
      existingThermalImageUrl: createdProduct.thermal_image_url || "",
      productName: createdProduct.name || "",
      regenerate: true,
    });
    for (const variant of insertedVariants) {
      if (!variant?.thermal_image_generation_needed) continue;
      scheduleThermalImageGeneration({
        entityType: "variant",
        productId,
        variantId: variant?.variant_id ?? variant?.id ?? null,
        tenantId,
        sourceImageUrl: variant?.image_url || variant?.variant_image_url || variant?.color_image_url || "",
        existingThermalImageUrl: variant?.thermal_image_url || "",
        productName: `${createdProduct.name || ""} ${variant?.color || ""}`.trim(),
        regenerate: true,
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        ...createdProduct,
        audiences: normalizedAudiences,
        product_audiences: normalizedAudiences,
        variants: hydratedVariants,
        color_images: colorImagesPayload,
      },
      product: {
        ...createdProduct,
        audiences: normalizedAudiences,
        product_audiences: normalizedAudiences,
        variants: hydratedVariants,
        color_images: colorImagesPayload,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[products:create] rollback failed:", rollbackError);
      }
    }
    console.error("[products] error:", error);
    const statusCode = dbValidationStatus(error);
    return res.status(statusCode).json(buildCreateProductErrorResponse(error, statusCode));
  } finally {
    client.release();
  }
};

export const updateProduct = async (req, res) => {
  const client = await db.connect();
  let transactionStarted = false;

  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await ensureProductVariantManufacturerColumn();
    const productColumns = await getTableColumns(client, "products");
    const supportsThermalImageUrl = productColumns.has("thermal_image_url");
    const {
      name,
        description,
        description_ar,
        description_en,
        meta_title,
        seo_description,
        seo_keywords,
        canonical_slug,
        regular_price,
        price,
      sale_price,
      offer_price,
      sale_price_enabled,
      sale_reason,
      sale_start_at,
      sale_end_at,
      purchase_alerts_enabled,
      purchase_alert_by_color,
      carton_size,
      suggested_purchase_cartons,
      use_custom_compare_price,
      custom_compare_price,
      cost_price,
      purchase_price,
        wholesale_price,
        category_id,
        brand_id,
        unit_id,
        manufacturer_id,
        supplier_id,
        warehouse_id,
        brand,
        category,
        main_category,
        sub_category,
        child_category,
        gender,
        audiences,
        product_audiences,
        product_type,
        style,
        grade,
      is_offer_story,
      is_storefront_visible,
      sku,
      barcode,
      status,
      image_url,
      thermal_image_url,
      gallery,
      gallery_images,
      variation_mode,
      fixed_size_label,
      low_stock_threshold,
      low_stock_alert,
      low_stock_tracking_mode,
      product_low_stock_threshold,
      minimum_distinct_sizes_required,
      tax_rate,
      variants,
      colorImages,
      variantImages,
      variant_images,
      variantImagePayload,
      variant_image_payload,
      deleted_variant_ids,
    } = req.body || {};
    const normalizedForeignKeys = {
      category_id: normalizeOptionalForeignKey(category_id),
      brand_id: normalizeOptionalForeignKey(brand_id),
      unit_id: normalizeOptionalForeignKey(unit_id),
      manufacturer_id: normalizeOptionalForeignKey(manufacturer_id),
      supplier_id: normalizeOptionalForeignKey(supplier_id),
      warehouse_id: normalizeOptionalForeignKey(warehouse_id),
    };
    const normalizedVariationMode = normalizeVariationMode(variation_mode);
    const normalizedLowStockTrackingMode =
      low_stock_tracking_mode === undefined || low_stock_tracking_mode === null || low_stock_tracking_mode === ""
        ? null
        : normalizeLowStockTrackingMode(low_stock_tracking_mode);
    const normalizedProductLowStockThreshold =
      product_low_stock_threshold === undefined || product_low_stock_threshold === null || product_low_stock_threshold === ""
        ? null
        : normalizeNonNegativeInteger(product_low_stock_threshold, 0);
    const normalizedMinimumDistinctSizesRequired =
      minimum_distinct_sizes_required === undefined || minimum_distinct_sizes_required === null || minimum_distinct_sizes_required === ""
        ? null
        : normalizeNonNegativeInteger(minimum_distinct_sizes_required, 0);
    const normalizedFixedSizeLabel = String(fixed_size_label || "").trim();
    const purchaseAlertsEnabledProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "purchase_alerts_enabled");
    const purchaseAlertByColorProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "purchase_alert_by_color");
    const cartonSizeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "carton_size");
    const suggestedPurchaseCartonsProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "suggested_purchase_cartons");
    const normalizedPurchaseAlertsEnabled = purchaseAlertsEnabledProvided
      ? normalizePurchaseAlertsEnabled(purchase_alerts_enabled, true)
      : null;
    const normalizedPurchaseAlertByColor = purchaseAlertByColorProvided
      ? normalizePurchaseAlertByColor(purchase_alert_by_color, false)
      : null;
    const normalizedCartonSize = cartonSizeProvided
      ? normalizeNullablePositiveInteger(carton_size, { fieldName: "carton_size" })
      : null;
    const normalizedSuggestedPurchaseCartons = suggestedPurchaseCartonsProvided
      ? normalizePositiveInteger(suggested_purchase_cartons, {
          fieldName: "suggested_purchase_cartons",
          fallback: 1,
        })
      : null;
    const normalizedVariants = normalizeVariantsForMode({
      variationMode: normalizedVariationMode,
      variants,
      fixedSizeLabel: normalizedFixedSizeLabel,
    });
    const normalizedAudiences = normalizeProductAudiences(audiences, product_audiences, gender);
    const normalizedGender = await normalizeClassificationValue("gender", gender || normalizedAudiences[0] || "");
    const normalizedProductType = await normalizeClassificationValue("product_type", product_type);
    const normalizedStyle = await normalizeClassificationValue("style", style);
    const normalizedGrade = await normalizeClassificationValue("grade", grade);
    const normalizedOfferStory = is_offer_story === true || String(is_offer_story || "").toLowerCase() === "true";
    const normalizedStorefrontVisible =
      is_storefront_visible === undefined || is_storefront_visible === null || String(is_storefront_visible).trim() === ""
        ? null
        : is_storefront_visible === true || String(is_storefront_visible || "").toLowerCase() === "true";
    const normalizedDescriptionAr = String(description_ar || "").trim();
    const normalizedDescriptionEn = String(description_en || "").trim();
    const normalizedDescription = String(description || normalizedDescriptionEn || normalizedDescriptionAr || "").trim();
    const normalizedSeoDescription = String(seo_description || normalizedDescriptionEn || normalizedDescriptionAr || normalizedDescription || "").trim();
    const normalizedMetaTitle = String(meta_title || name || "").trim();
    const normalizedSeoKeywords = String(seo_keywords || "").trim();
    const normalizedCanonicalSlug = String(canonical_slug || "").trim();
    const productPricingProvided = [
      "regular_price",
      "price",
      "sale_price",
      "offer_price",
      "sale_price_enabled",
      "sale_reason",
      "sale_start_at",
      "sale_end_at",
      "cost_price",
      "purchase_price",
      "wholesale_price",
    ].some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
    const normalizedRegularPrice = Number(regular_price || price || cost_price || purchase_price || wholesale_price || 0);
    const normalizedSalePrice = Number(sale_price || offer_price || 0);
    const normalizedSaleEnabled =
      (sale_price_enabled === true || String(sale_price_enabled || "").toLowerCase() === "true") &&
      normalizedSalePrice > 0 &&
      normalizedRegularPrice > 0 &&
      normalizedSalePrice < normalizedRegularPrice;
    const imageUrlProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "image_url");
    const thermalImageUrlProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "thermal_image_url");
    const normalizedProductImageUrl = String(image_url || "").trim();
    const normalizedThermalImageUrl = String(thermal_image_url || "").trim();
    let nextThermalImageStatus = imageUrlProvided && normalizedProductImageUrl
      ? "pending"
      : thermalImageUrlProvided
        ? "ready"
        : null;
    let nextThermalImageUrl = imageUrlProvided && normalizedProductImageUrl
      ? ""
      : thermalImageUrlProvided
        ? normalizedThermalImageUrl
        : null;
    let nextThermalImageGeneratedAt = imageUrlProvided && normalizedProductImageUrl
      ? null
      : thermalImageUrlProvided
        ? new Date().toISOString()
        : null;
    let nextThermalImageError = thermalImageUrlProvided ? "" : null;
    const galleryImagesProvided =
      Object.prototype.hasOwnProperty.call(req.body || {}, "gallery_images") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "gallery");
    if (
      (imageUrlProvided && containsDataImageValue(image_url)) ||
      (galleryImagesProvided && (containsDataImageValue(gallery) || containsDataImageValue(gallery_images)))
    ) {
      return res.status(400).json({
        success: false,
        message: "Upload product images before saving",
      });
    }
    const normalizedGalleryImages = Array.isArray(gallery_images)
      ? gallery_images
      : Array.isArray(gallery)
        ? gallery
        : [];
    const variantImagePayloads = [
      ...(Array.isArray(variantImages) ? variantImages : []),
      ...(Array.isArray(variant_images) ? variant_images : []),
      ...(Array.isArray(variantImagePayload) ? variantImagePayload : []),
      ...(Array.isArray(variant_image_payload) ? variant_image_payload : []),
    ];

    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    await client.query("BEGIN");
    transactionStarted = true;
    const productId = req.params.id;
    const currentProductResult = await client.query(
      `
      SELECT id, image_url, thermal_image_url, thermal_image_status, thermal_image_generated_at, thermal_image_error
      FROM products
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
      FOR UPDATE
      `,
      [productId, tenantId]
    );
    if (currentProductResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }
    const currentProductRow = currentProductResult.rows[0] || {};
    const currentProductImageUrl = String(currentProductRow.image_url || "").trim();
    const productImageChanged = Boolean(imageUrlProvided && normalizedProductImageUrl && normalizedProductImageUrl !== currentProductImageUrl);
    const thermalImageMetadataResetNeeded = productImageChanged;
    if (productImageChanged) {
      console.log("THERMAL_IMAGE_STALE_RESET", {
        entityType: "product",
        productId,
        tenantId,
        previousImageUrl: currentProductImageUrl,
        nextImageUrl: normalizedProductImageUrl,
      });
      nextThermalImageStatus = "pending";
      nextThermalImageUrl = "";
      nextThermalImageGeneratedAt = null;
      nextThermalImageError = "";
    } else if (imageUrlProvided && normalizedProductImageUrl) {
      nextThermalImageStatus = normalizeThermalImageStatus(currentProductRow.thermal_image_status, currentProductRow.thermal_image_url || "");
      nextThermalImageUrl = String(currentProductRow.thermal_image_url || "").trim();
      nextThermalImageGeneratedAt = normalizeThermalTimestamp(currentProductRow.thermal_image_generated_at);
      nextThermalImageError = normalizeThermalError(currentProductRow.thermal_image_error);
    }
    const finalProductSku = await makeUniqueSku(client, {
      tenantId,
      productId,
      sku: sku || buildSmartSkuPrefix({
        name,
        brand,
        category,
        product_type: normalizedProductType,
        gender: normalizedGender,
        grade: normalizedGrade,
        meta_title: normalizedMetaTitle,
        seo_keywords: normalizedSeoKeywords,
      }),
    });
    const reservedVariantSkus = new Set([finalProductSku.toLowerCase()]);
    const activeVariantsBeforeSave = await loadActiveProductVariantSnapshot(client, { productId, tenantId });
    console.log("[products:update] variant sync start", {
      productId,
      tenantId,
      activeVariantsBeforeCount: activeVariantsBeforeSave.length,
      activeVariantsBefore: activeVariantsBeforeSave.map((variant) => ({
        id: variant.id,
        color: variant.color,
        size: variant.size,
        stock: Number(variant.stock || 0),
      })),
      incomingVariantsCount: normalizedVariants.length,
      incomingVariantIds: normalizedVariants.map((variant) => variant.id || variant.variant_id || null).filter(Boolean),
      incomingColors: Array.from(new Set(normalizedVariants.map((variant) => String(variant.color || "").trim()).filter(Boolean))),
      routeProductId: productId,
    });
    const updateValues = [];
    const addUpdateValue = (value) => {
      updateValues.push(value);
      return `$${updateValues.length}`;
    };
    const updateFields = [
      `name = ${addUpdateValue(name)}`,
      `description = ${addUpdateValue(normalizedDescription)}`,
      `description_ar = ${addUpdateValue(normalizedDescriptionAr)}`,
      `description_en = ${addUpdateValue(normalizedDescriptionEn)}`,
      `meta_title = ${addUpdateValue(normalizedMetaTitle)}`,
      `seo_description = ${addUpdateValue(normalizedSeoDescription)}`,
      `seo_keywords = ${addUpdateValue(normalizedSeoKeywords)}`,
      `canonical_slug = ${addUpdateValue(normalizedCanonicalSlug)}`,
      `regular_price = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(normalizedRegularPrice)} ELSE regular_price END`,
      `price = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(normalizedRegularPrice)} ELSE price END`,
      `sale_price = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(normalizedSaleEnabled ? normalizedSalePrice : 0)} ELSE sale_price END`,
      `sale_price_enabled = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(normalizedSaleEnabled)} ELSE sale_price_enabled END`,
      `sale_reason = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(normalizedSaleEnabled ? String(sale_reason || "").trim() : "")} ELSE sale_reason END`,
      `sale_start_at = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(normalizedSaleEnabled && sale_start_at ? sale_start_at : null)} ELSE sale_start_at END`,
      `sale_end_at = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(normalizedSaleEnabled && sale_end_at ? sale_end_at : null)} ELSE sale_end_at END`,
      `use_custom_compare_price = ${addUpdateValue(use_custom_compare_price === true || String(use_custom_compare_price || "").toLowerCase() === "true")}`,
      `custom_compare_price = ${addUpdateValue(Math.max(0, Number(custom_compare_price || 0)))}`,
      `cost_price = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(Number(cost_price || purchase_price || 0))} ELSE cost_price END`,
      `wholesale_price = CASE WHEN ${addUpdateValue(productPricingProvided)} THEN ${addUpdateValue(Number(wholesale_price || 0))} ELSE wholesale_price END`,
      `brand = ${addUpdateValue(brand || "")}`,
      `category = ${addUpdateValue(category || "")}`,
      `main_category = ${addUpdateValue(main_category || "")}`,
      `sub_category = ${addUpdateValue(sub_category || "")}`,
      `child_category = ${addUpdateValue(child_category || "")}`,
      `gender = ${addUpdateValue(normalizedGender)}`,
      `product_type = ${addUpdateValue(normalizedProductType)}`,
      `style = ${addUpdateValue(normalizedStyle)}`,
      `grade = ${addUpdateValue(normalizedGrade)}`,
      `is_storefront_visible = COALESCE(${addUpdateValue(normalizedStorefrontVisible)}, is_storefront_visible)`,
      `is_offer_story = ${addUpdateValue(normalizedOfferStory)}`,
      `category_id = ${addUpdateValue(normalizedForeignKeys.category_id)}`,
      `brand_id = ${addUpdateValue(normalizedForeignKeys.brand_id)}`,
      `unit_id = ${addUpdateValue(normalizedForeignKeys.unit_id)}`,
      `manufacturer_id = ${addUpdateValue(normalizedForeignKeys.manufacturer_id)}`,
      `supplier_id = ${addUpdateValue(normalizedForeignKeys.supplier_id)}`,
      `warehouse_id = ${addUpdateValue(normalizedForeignKeys.warehouse_id)}`,
      `status = ${addUpdateValue(status || "active")}`,
      `sku = ${addUpdateValue(finalProductSku)}`,
      `barcode = ${addUpdateValue(barcode || "")}`,
      `image_url = COALESCE(${addUpdateValue(imageUrlProvided ? image_url || "" : null)}, image_url)`,
      `thermal_image_status = CASE WHEN ${addUpdateValue(thermalImageMetadataResetNeeded)} THEN ${addUpdateValue("pending")} ELSE COALESCE(${addUpdateValue(nextThermalImageStatus)}, thermal_image_status) END`,
      `thermal_image_generated_at = CASE WHEN ${addUpdateValue(thermalImageMetadataResetNeeded)} THEN NULL ELSE COALESCE(${addUpdateValue(nextThermalImageGeneratedAt)}, thermal_image_generated_at) END`,
      `thermal_image_error = CASE WHEN ${addUpdateValue(thermalImageMetadataResetNeeded)} THEN ${addUpdateValue("")} ELSE COALESCE(${addUpdateValue(nextThermalImageError)}, thermal_image_error) END`,
      `gallery_images = COALESCE(${addUpdateValue(galleryImagesProvided ? JSON.stringify(normalizedGalleryImages) : null)}::jsonb, gallery_images)`,
      `variation_mode = ${addUpdateValue(normalizedVariationMode)}`,
      `fixed_size_label = ${addUpdateValue(normalizedFixedSizeLabel)}`,
      `purchase_alerts_enabled = CASE WHEN ${addUpdateValue(purchaseAlertsEnabledProvided)} THEN ${addUpdateValue(normalizedPurchaseAlertsEnabled)} ELSE purchase_alerts_enabled END`,
      `purchase_alert_by_color = CASE WHEN ${addUpdateValue(purchaseAlertByColorProvided)} THEN ${addUpdateValue(normalizedPurchaseAlertByColor)} ELSE purchase_alert_by_color END`,
      `carton_size = CASE WHEN ${addUpdateValue(cartonSizeProvided)} THEN ${addUpdateValue(normalizedCartonSize)} ELSE carton_size END`,
      `suggested_purchase_cartons = CASE WHEN ${addUpdateValue(suggestedPurchaseCartonsProvided)} THEN ${addUpdateValue(normalizedSuggestedPurchaseCartons)} ELSE suggested_purchase_cartons END`,
      `low_stock_alert = COALESCE(${addUpdateValue((low_stock_alert ?? low_stock_threshold) === undefined || (low_stock_alert ?? low_stock_threshold) === null || (low_stock_alert ?? low_stock_threshold) === "" ? null : Number(low_stock_alert ?? low_stock_threshold))}, low_stock_alert)`,
      `tax_rate = COALESCE(${addUpdateValue(tax_rate === undefined || tax_rate === null || tax_rate === "" ? null : Number(tax_rate))}, 0)`,
      `low_stock_tracking_mode = COALESCE(${addUpdateValue(normalizedLowStockTrackingMode)}, low_stock_tracking_mode)`,
      `product_low_stock_threshold = COALESCE(${addUpdateValue(normalizedProductLowStockThreshold)}, product_low_stock_threshold)`,
      `minimum_distinct_sizes_required = COALESCE(${addUpdateValue(normalizedMinimumDistinctSizesRequired)}, minimum_distinct_sizes_required)`,
    ];

    if (supportsThermalImageUrl) {
      updateFields.push(`thermal_image_url = COALESCE(${addUpdateValue(nextThermalImageUrl)}, thermal_image_url)`);
    }

    const updated = await client.query(
      `
      UPDATE products
      SET
        ${updateFields.join(",\n        ")}
      WHERE id = ${addUpdateValue(productId)}
        AND tenant_id = ${addUpdateValue(tenantId)}
      RETURNING *
      `,
      updateValues
    );
    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }
    await replaceProductAudiences(client, productId, normalizedAudiences);
    const deletedIds = Array.isArray(deleted_variant_ids) ? deleted_variant_ids : [];
    const deletedVariantIdSet = new Set(
      deletedIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    );
    const variantsToSave = normalizedVariants.filter((variant) => {
      const variantId = Number(variant?.id ?? variant?.variant_id ?? variant?.variantId ?? 0);
      return !(Number.isFinite(variantId) && deletedVariantIdSet.has(variantId));
    });
    const existingVariantsResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM product_variants
      WHERE product_id = $1
        AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
        AND is_active IS DISTINCT FROM FALSE
        AND deleted_at IS NULL
      `,
      [productId, tenantId]
    );
    const existingVariantsCount = Number(existingVariantsResult.rows[0]?.count || 0);

    console.log("[products:update] existing variants count", existingVariantsCount);
    console.log("[products:update] incoming variants count", normalizedVariants.length);
    console.log("[products:update] variants queued for save after explicit deletion filter", {
      productId,
      variantsToSaveCount: variantsToSave.length,
      variantsToSaveIds: variantsToSave.map((variant) => variant.id || variant.variant_id || null).filter(Boolean),
      requestedDeletedVariantIds: deletedIds,
    });

    const savedVariants = [];
    for (const variant of variantsToSave) {
      savedVariants.push(
        await updateProductVariant(client, {
          productId,
          tenantId,
          variant,
          skuPrefix: finalProductSku,
          reservedSkus: reservedVariantSkus,
          userId: req.user?.id || null,
        })
      );
    }
    const explicitlyArchivedVariants = await archiveProductVariantsByIds(client, {
      productId,
      tenantId,
      variantIds: deletedIds,
    });
    const missingArchivedVariants = await archiveMissingProductVariants(client, {
      productId,
      tenantId,
      savedVariantIds: savedVariants.map((variant) => variant.id),
    });
    const archivedVariants = [...explicitlyArchivedVariants, ...missingArchivedVariants];
    const activeVariantsAfterSave = await loadActiveProductVariantSnapshot(client, { productId, tenantId });

    console.log("[products:update] variant sync complete", {
      productId,
      existingVariantsCount,
      incomingVariantsCount: normalizedVariants.length,
      incomingVariantIds: normalizedVariants.map((variant) => variant.id || variant.variant_id || null).filter(Boolean),
      incomingColors: Array.from(new Set(normalizedVariants.map((variant) => String(variant.color || "").trim()).filter(Boolean))),
      variantsToSaveCount: variantsToSave.length,
      savedVariantIds: savedVariants.map((variant) => variant.id),
      archivedVariantIds: archivedVariants.map((variant) => variant.id),
      explicitlyArchivedVariantIds: explicitlyArchivedVariants.map((variant) => variant.id),
      missingArchivedVariantIds: missingArchivedVariants.map((variant) => variant.id),
      archivedVariants: archivedVariants.map((variant) => ({
        id: variant.id,
        color: variant.color,
        size: variant.size,
      })),
      requestedDeletedVariantIds: deletedIds,
      activeVariantsAfterCount: activeVariantsAfterSave.length,
      activeVariantsAfter: activeVariantsAfterSave.map((variant) => ({
        id: variant.id,
        color: variant.color,
        size: variant.size,
        stock: Number(variant.stock || 0),
      })),
    });

    const activeColorKeys = new Set(
      variantsToSave
        .map((variant) => String(variant.color || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const activeColorImages = Array.isArray(colorImages)
      ? colorImages.filter((group) => {
          const colorKey = String(group?.color_name || group?.colorName || group?.color_value || group?.colorValue || group?.color || "").trim().toLowerCase();
          return colorKey && activeColorKeys.has(colorKey);
        })
      : [];
    const sanitizeColorImageGroupForPersistence = (group = {}) => {
      const { thermal_image_url: _thermalImageUrl, thermalImageUrl: _thermalArtworkUrl, ...safeGroup } = group || {};
      const safeImages = Array.isArray(safeGroup.images)
        ? safeGroup.images.map((image) => {
            if (!image || typeof image !== "object") return image;
            const {
              thermal_image_url: _imageThermalImageUrl,
              thermalImageUrl: _imageThermalArtworkUrl,
              ...safeImage
            } = image;
            return safeImage;
          })
        : safeGroup.images;
      return {
        ...safeGroup,
        images: safeImages,
      };
    };
    const persistedColorImages = activeColorImages.map(sanitizeColorImageGroupForPersistence);
    const activeVariantImagePayloads = variantImagePayloads.filter((entry) => {
      const variantId = Number(entry?.variant_id ?? entry?.variantId ?? entry?.id ?? 0);
      if (Number.isFinite(variantId) && deletedVariantIdSet.has(variantId)) return false;
      const colorKey = String(entry?.color_name || entry?.colorName || entry?.color_value || entry?.colorValue || entry?.color || "").trim().toLowerCase();
      return !colorKey || activeColorKeys.has(colorKey);
    });
    const persistedVariantImagePayloads = activeVariantImagePayloads.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const { thermal_image_url: _thermalImageUrl, thermalImageUrl: _thermalArtworkUrl, ...safeEntry } = entry;
      return safeEntry;
    });

    const persistedVariantImageRows = await replaceProductVariantImages(client, {
      tenantId,
      productId,
      variants: [...variantsToSave, ...persistedVariantImagePayloads],
      colorImages: persistedColorImages,
    });

    const imageBundleMap = await loadProductVariantImages(client, [productId]).catch(() => new Map());
    const imageBundle = imageBundleMap.get(String(productId)) || null;
    const hydratedVariants = attachVariantImages(savedVariants.map(normalizeVariantRow), imageBundle);
    const colorImagesPayload = attachGroupedColorImages(
      deriveColorGroupsFromVariants(hydratedVariants),
      imageBundle
    );

    await client.query("COMMIT");
    transactionStarted = false;
    console.log("[products:update] transaction commit", {
      productId,
      savedVariantsCount: savedVariants.length,
    });
    const updatedProduct = normalizeProductRow(updated.rows[0]);

    if (imageUrlProvided && normalizedProductImageUrl) {
      scheduleThermalImageGeneration({
        entityType: "product",
        productId,
        tenantId,
        sourceImageUrl: normalizedProductImageUrl,
        existingThermalImageUrl: updatedProduct.thermal_image_url || "",
        productName: updatedProduct.name || "",
        regenerate: true,
      });
    }
    for (const variant of savedVariants) {
      if (!variant?.thermal_image_generation_needed) continue;
      scheduleThermalImageGeneration({
        entityType: "variant",
        productId,
        variantId: variant?.variant_id ?? variant?.id ?? null,
        tenantId,
        sourceImageUrl: variant?.image_url || variant?.variant_image_url || variant?.color_image_url || "",
        existingThermalImageUrl: variant?.thermal_image_url || "",
        productName: `${updatedProduct.name || ""} ${variant?.color || ""}`.trim(),
        regenerate: true,
      });
    }

    return res.json({
      success: true,
      data: {
        ...updatedProduct,
        audiences: normalizedAudiences,
        product_audiences: normalizedAudiences,
        variants: hydratedVariants,
        color_images: colorImagesPayload,
        variant_sync: {
          active_before_count: activeVariantsBeforeSave.length,
          incoming_count: normalizedVariants.length,
          archived_count: archivedVariants.length,
          active_after_count: activeVariantsAfterSave.length,
        },
      },
      product: {
        ...updatedProduct,
        audiences: normalizedAudiences,
        product_audiences: normalizedAudiences,
        variants: hydratedVariants,
        color_images: colorImagesPayload,
        variant_sync: {
          active_before_count: activeVariantsBeforeSave.length,
          incoming_count: normalizedVariants.length,
          archived_count: archivedVariants.length,
          active_after_count: activeVariantsAfterSave.length,
        },
      },
    });
  } catch (error) {
    console.error("PRODUCT_UPDATE_FAILED", {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      column: error?.column,
    });
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
        console.log("[products:update] transaction rollback", {
          productId: req.params.id,
          error: error.message,
        });
      } catch (rollbackError) {
        console.error("[products:update] transaction rollback failed:", rollbackError);
      }
    }
    logProductUpdateError({
      error,
      productId: req.params.id,
      payload: req.body || {},
      normalizedForeignKeys: {
        category_id: normalizeOptionalForeignKey(req.body?.category_id),
        brand_id: normalizeOptionalForeignKey(req.body?.brand_id),
        unit_id: normalizeOptionalForeignKey(req.body?.unit_id),
        manufacturer_id: normalizeOptionalForeignKey(req.body?.manufacturer_id),
        supplier_id: normalizeOptionalForeignKey(req.body?.supplier_id),
        warehouse_id: normalizeOptionalForeignKey(req.body?.warehouse_id),
      },
      normalizedVariants: normalizeVariantsForMode({
        variationMode: req.body?.variation_mode,
        variants: req.body?.variants,
        fixedSizeLabel: req.body?.fixed_size_label,
      }),
    });
    const statusCode = error.status || (isUniqueViolation(error) ? 409 : 500);
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 409 ? error.publicMessage || "Duplicate SKU or barcode" : "Failed to update product",
    });
  } finally {
    client.release();
  }
};

export const updateProductStatus = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureProductSchema();
    const productColumns = await getTableColumns(client, "products");
    const productId = normalizeOptionalForeignKey(req.params.id);
    if (!productId) return res.status(400).json({ success: false, message: "Invalid product id" });

    const statusProvided =
      Object.prototype.hasOwnProperty.call(req.body || {}, "status") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "is_active") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "active");
    const offerStoryProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "is_offer_story");
    const storefrontVisibleProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "is_storefront_visible");
    const requestedStatus = String(req.body?.status || "").trim().toLowerCase();
    const requestedActive =
      req.body?.is_active === true ||
      req.body?.active === true ||
      requestedStatus === "active";
    const nextStatus = requestedActive ? "active" : "inactive";
    if (statusProvided && requestedStatus && !["active", "inactive"].includes(requestedStatus)) {
      return res.status(400).json({ success: false, message: "Product status can only be active or inactive" });
    }
    if (!statusProvided && !offerStoryProvided && !storefrontVisibleProvided) {
      return res.status(400).json({ success: false, message: "No status fields provided" });
    }

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const selectParams = [productId];
    let tenantClause = "";
    if (productColumns.has("tenant_id") && tenantId !== null && tenantId !== undefined && tenantId !== "") {
      selectParams.push(tenantId);
      tenantClause = `AND (tenant_id IS NULL OR tenant_id = $${selectParams.length}::bigint)`;
    }

    const existing = await client.query(
      `
      SELECT id, status
      FROM products
      WHERE id = $1
        ${tenantClause}
      `,
      selectParams
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const currentStatus = String(existing.rows[0]?.status || "active").trim().toLowerCase();
    if (statusProvided && ["draft", "archived", "deleted"].includes(currentStatus)) {
      return res.status(409).json({
        success: false,
        message: "Draft, archived, and deleted products keep their own status workflow",
      });
    }

    const setParts = [];
    const values = [];
    if (statusProvided && productColumns.has("status")) {
      values.push(nextStatus);
      setParts.push(`status = $${values.length}`);
    }
    if (statusProvided && productColumns.has("is_active")) {
      values.push(requestedActive);
      setParts.push(`is_active = $${values.length}`);
    }
    if (offerStoryProvided && productColumns.has("is_offer_story")) {
      const nextOfferStory = req.body?.is_offer_story === true || String(req.body?.is_offer_story || "").toLowerCase() === "true";
      values.push(nextOfferStory);
      setParts.push(`is_offer_story = $${values.length}`);
    }
    if (storefrontVisibleProvided && productColumns.has("is_storefront_visible")) {
      const nextStorefrontVisible = req.body?.is_storefront_visible === true || String(req.body?.is_storefront_visible || "").toLowerCase() === "true";
      values.push(nextStorefrontVisible);
      setParts.push(`is_storefront_visible = $${values.length}`);
    }
    if (productColumns.has("updated_at")) setParts.push("updated_at = NOW()");
    values.push(productId);
    const productParam = `$${values.length}`;
    let updateTenantClause = "";
    if (productColumns.has("tenant_id") && tenantId !== null && tenantId !== undefined && tenantId !== "") {
      values.push(tenantId);
      updateTenantClause = `AND (tenant_id IS NULL OR tenant_id = $${values.length}::bigint)`;
    }

    const updated = await client.query(
      `
      UPDATE products
      SET ${setParts.join(", ")}
      WHERE id = ${productParam}
        ${updateTenantClause}
      RETURNING *
      `,
      values
    );

    const refreshed = updated.rows[0] ? normalizeProductRow(updated.rows[0]) : null;

    console.log("[products-status-toggle]", {
      product_id: productId,
      previous_status: currentStatus,
      status: statusProvided ? nextStatus : currentStatus,
      is_active: statusProvided ? requestedActive : null,
      is_offer_story: offerStoryProvided ? (req.body?.is_offer_story === true || String(req.body?.is_offer_story || "").toLowerCase() === "true") : null,
      is_storefront_visible: storefrontVisibleProvided ? (req.body?.is_storefront_visible === true || String(req.body?.is_storefront_visible || "").toLowerCase() === "true") : null,
      affected_rows: updated.rowCount,
      db_snapshot: refreshed
        ? {
            id: refreshed.id,
            name: refreshed.name,
            is_offer_story: refreshed.is_offer_story,
            is_storefront_visible: refreshed.is_storefront_visible,
            active: refreshed.active,
          }
        : null,
    });

    return res.json({
      success: true,
      data: refreshed,
      product: refreshed,
      db_snapshot: refreshed
        ? {
            id: refreshed.id,
            name: refreshed.name,
            is_offer_story: refreshed.is_offer_story,
            is_storefront_visible: refreshed.is_storefront_visible,
            active: refreshed.active,
          }
        : null,
      id: refreshed?.id,
      name: refreshed?.name,
      is_offer_story: refreshed?.is_offer_story,
      is_storefront_visible: refreshed?.is_storefront_visible,
      active: refreshed?.active,
    });
  } catch (error) {
    console.error("[products-status-toggle] failed", {
      productId: req.params.id,
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ success: false, message: "Failed to update product status" });
  } finally {
    client.release();
  }
};

export const updateProductPrices = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    const tenantId = isSuperAdminUser(req.user) ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id) : getTenantId(req, req.user?.tenant_id);
    const productId = normalizeOptionalForeignKey(req.params.id);
    if (!productId) return res.status(400).json({ success: false, message: "Invalid product id" });

    const productColumns = await getTableColumns(client, "products");
    const variantColumns = await getTableColumns(client, "product_variants");
    const variants = Array.isArray(req.body?.variants) ? req.body.variants : [];
    const hasSimpleProductPricePayload = ["selling_price", "sellingPrice", "variant_sale_price", "variantSalePrice", "sale_price", "salePrice", "regular_price", "price"].some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
    const variantOnly = (req.body?.variant_only === true || req.body?.variantOnly === true) && variants.length > 0 && !hasSimpleProductPricePayload;
    const hasProductPrice = !variantOnly && hasSimpleProductPricePayload;
    const hasProductDiscount = !variantOnly && ["discount_price", "discountPrice", "offer_price", "offerPrice"].some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
    const productPrice = hasProductPrice ? toPriceValue(req.body?.selling_price ?? req.body?.sellingPrice ?? req.body?.variant_sale_price ?? req.body?.variantSalePrice ?? req.body?.sale_price ?? req.body?.salePrice ?? req.body?.regular_price ?? req.body?.price) : null;
    const productDiscount = hasProductDiscount
      ? toPriceValue(req.body?.discount_price ?? req.body?.discountPrice ?? req.body?.offer_price ?? req.body?.offerPrice, { nullable: true })
      : null;
    const auditChanges = [];

    await client.query("BEGIN");
    const existingProduct = await client.query(
      `
      SELECT id, name, price, regular_price, sale_price, sale_price_enabled
      FROM products
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [productId, tenantId]
    );
    if (!existingProduct.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const oldProduct = existingProduct.rows[0];

    const productSets = [];
    const productValues = [];
    const pushProduct = (value) => {
      productValues.push(value);
      return `$${productValues.length}`;
    };
    if (hasProductPrice && productColumns.has("price")) productSets.push(`price = ${pushProduct(productPrice)}`);
    if (hasProductPrice && productColumns.has("selling_price")) productSets.push(`selling_price = ${pushProduct(productPrice)}`);
    if (hasProductPrice && productColumns.has("regular_price")) productSets.push(`regular_price = ${pushProduct(productPrice)}`);
    if (hasProductDiscount && productColumns.has("sale_price")) productSets.push(`sale_price = ${pushProduct(productDiscount ?? 0)}`);
    if (hasProductDiscount && productColumns.has("offer_price")) productSets.push(`offer_price = ${pushProduct(productDiscount)}`);
    if (hasProductDiscount && productColumns.has("sale_price_enabled")) productSets.push(`sale_price_enabled = ${pushProduct(productDiscount !== null && productDiscount > 0)}`);
    if (productColumns.has("updated_at")) productSets.push("updated_at = NOW()");
    if (productSets.length) {
      productValues.push(productId, tenantId);
      await client.query(
        `
        UPDATE products
        SET ${productSets.join(", ")}
        WHERE id = $${productValues.length - 1}
          AND ($${productValues.length}::bigint IS NULL OR tenant_id = $${productValues.length}::bigint OR tenant_id IS NULL)
        `,
        productValues
      );
      auditChanges.push({
        variant_id: null,
        old_sale_price: Number(oldProduct.regular_price ?? oldProduct.price ?? 0),
        new_sale_price: hasProductPrice ? productPrice : Number(oldProduct.regular_price ?? oldProduct.price ?? 0),
        old_discount_price: Number(oldProduct.sale_price || 0) > 0 ? Number(oldProduct.sale_price || 0) : null,
        new_discount_price: hasProductDiscount ? productDiscount : (Number(oldProduct.sale_price || 0) > 0 ? Number(oldProduct.sale_price || 0) : null),
        updated_by: req.user?.id || null,
      });
    }

    for (const variant of variants) {
      const variantId = normalizeOptionalForeignKey(variant.id ?? variant.variant_id ?? variant.variantId);
      if (!variantId) continue;
      const hasVariantPrice = ["variant_sale_price", "sale_price", "salePrice", "regular_price", "price"].some((key) => Object.prototype.hasOwnProperty.call(variant || {}, key));
      const hasVariantDiscount = ["variant_discount_price", "discount_price", "discountPrice", "offer_price", "offerPrice"].some((key) => Object.prototype.hasOwnProperty.call(variant || {}, key));
      if (!hasVariantPrice && !hasVariantDiscount) continue;
      const existingVariant = await client.query(
        `
        SELECT id, price, regular_price, sale_price, sale_price_enabled
        FROM product_variants
        WHERE id = $1
          AND product_id = $2
          AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
        FOR UPDATE
        `,
        [variantId, productId, tenantId]
      );
      if (!existingVariant.rowCount) continue;
      const oldVariant = existingVariant.rows[0];
      const variantPrice = hasVariantPrice ? toPriceValue(variant.variant_sale_price ?? variant.sale_price ?? variant.salePrice ?? variant.regular_price ?? variant.price) : null;
      const variantDiscount = hasVariantDiscount
        ? toPriceValue(variant.variant_discount_price ?? variant.discount_price ?? variant.discountPrice ?? variant.offer_price ?? variant.offerPrice, { nullable: true })
        : null;
      const variantSets = [];
      const variantValues = [];
      const pushVariant = (value) => {
        variantValues.push(value);
        return `$${variantValues.length}`;
      };
      if (hasVariantPrice && variantColumns.has("price")) variantSets.push(`price = ${pushVariant(variantPrice)}`);
      if (hasVariantPrice && variantColumns.has("regular_price")) variantSets.push(`regular_price = ${pushVariant(variantPrice)}`);
      if (hasVariantDiscount && variantColumns.has("sale_price")) variantSets.push(`sale_price = ${pushVariant(variantDiscount ?? 0)}`);
      if (hasVariantDiscount && variantColumns.has("offer_price")) variantSets.push(`offer_price = ${pushVariant(variantDiscount)}`);
      if (hasVariantDiscount && variantColumns.has("sale_price_enabled")) variantSets.push(`sale_price_enabled = ${pushVariant(variantDiscount !== null && variantDiscount > 0)}`);
      if (variantColumns.has("updated_at")) variantSets.push("updated_at = NOW()");
      if (!variantSets.length) continue;
      variantValues.push(variantId, productId, tenantId);
      await client.query(
        `
        UPDATE product_variants
        SET ${variantSets.join(", ")}
        WHERE id = $${variantValues.length - 2}
          AND product_id = $${variantValues.length - 1}
          AND ($${variantValues.length}::bigint IS NULL OR tenant_id = $${variantValues.length}::bigint OR tenant_id IS NULL)
        `,
        variantValues
      );
      auditChanges.push({
        variant_id: variantId,
        old_sale_price: Number(oldVariant.regular_price ?? oldVariant.price ?? 0),
        new_sale_price: hasVariantPrice ? variantPrice : Number(oldVariant.regular_price ?? oldVariant.price ?? 0),
        old_discount_price: Number(oldVariant.sale_price || 0) > 0 ? Number(oldVariant.sale_price || 0) : null,
        new_discount_price: hasVariantDiscount ? variantDiscount : (Number(oldVariant.sale_price || 0) > 0 ? Number(oldVariant.sale_price || 0) : null),
        updated_by: req.user?.id || null,
      });
    }

    await insertProductPriceAuditLog(client, {
      tenantId,
      userId: req.user?.id || null,
      productId,
      details: {
        updated_by: req.user?.id || null,
        changes: auditChanges,
      },
    });
    await client.query("COMMIT");
    console.log("[products:price-update]", { product_id: productId, tenant_id: tenantId, changed_rows: auditChanges.length });
    return res.json({ success: true, message: "Product prices updated", product_id: productId });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[products:price-update] failed", { productId: req.params.id, message: error.message, stack: error.stack });
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update product prices" });
  } finally {
    client.release();
  }
};

export const deleteProduct = async (req, res) => {
  const client = await db.connect();
  let productId = Number(req.params.id);
  let tenantId = null;
  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await client.query("BEGIN");

    if (!Number.isInteger(productId) || productId <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const productResult = await client.query(
      `
      SELECT id
      FROM products
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [productId, tenantId]
    );
    if (!productResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const referenceChecks = [
      { table: "purchase_items", label: "purchase items", column: "product_id" },
      { table: "inventory_movements", label: "inventory movements", column: "product_id" },
      { table: "order_items", label: "order items", column: "product_id" },
      { table: "product_variants", label: "product variants", column: "product_id" },
      { table: "accounting_order_item_cost_overrides", label: "accounting cost overrides", column: "product_id" },
      { table: "inventory_valuation_layers", label: "inventory valuation records", column: "product_id" },
      { table: "stock_valuation_layers", label: "stock valuation records", column: "product_id" },
    ];
    const references = {};
    for (const check of referenceChecks) {
      if (!(await tableExists(client, check.table))) {
        references[check.table] = 0;
        continue;
      }
      const columns = await getTableColumns(client, check.table);
      if (!columns.has(check.column)) {
        references[check.table] = 0;
        continue;
      }
      const tenantClause = columns.has("tenant_id") ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)" : "";
      const result = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM ${check.table}
        WHERE ${check.column} = $1
          ${tenantClause}
        `,
        columns.has("tenant_id") ? [productId, tenantId] : [productId]
      );
      references[check.table] = Number(result.rows[0]?.count || 0);
    }

    if (await tableExists(client, "journal_entries")) {
      const columns = await getTableColumns(client, "journal_entries");
      if (columns.has("reference_type") && columns.has("reference_id")) {
        const tenantClause = columns.has("tenant_id") ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)" : "";
        const result = await client.query(
          `
          SELECT COUNT(*)::int AS count
          FROM journal_entries
          WHERE reference_id = $1
            AND LOWER(COALESCE(reference_type, '')) IN ('product', 'products', 'inventory_product')
            ${tenantClause}
          `,
          columns.has("tenant_id") ? [productId, tenantId] : [productId]
        );
        references.journal_entries = Number(result.rows[0]?.count || 0);
      }
    }

    if (await tableExists(client, "storefront_customer_sessions")) {
      const columns = await getTableColumns(client, "storefront_customer_sessions");
      if (columns.has("cart_items") || columns.has("wishlist_items")) {
        const tenantClause = columns.has("tenant_id") ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)" : "";
        const jsonChecks = [];
        if (columns.has("cart_items")) {
          jsonChecks.push(`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(cart_items, '[]'::jsonb)) item
            WHERE item->>'product_id' = $1::text OR item->>'productId' = $1::text OR item->>'id' = $1::text
          )`);
        }
        if (columns.has("wishlist_items")) {
          jsonChecks.push(`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(wishlist_items, '[]'::jsonb)) item
            WHERE item->>'product_id' = $1::text OR item->>'productId' = $1::text OR item->>'id' = $1::text
          )`);
        }
        const result = await client.query(
          `
          SELECT COUNT(*)::int AS count
          FROM storefront_customer_sessions
          WHERE (${jsonChecks.join(" OR ")})
            ${tenantClause}
          `,
          columns.has("tenant_id") ? [productId, tenantId] : [productId]
        );
        references.storefront_customer_sessions = Number(result.rows[0]?.count || 0);
      }
    }

    const hasReferences = Object.values(references).some((count) => Number(count) > 0);
    if (hasReferences) {
      await archiveProductForDelete(client, productId);
      await client.query("COMMIT");
      return res.json({
        success: true,
        status: "soft_deleted",
        action: "soft_deleted",
        message: "Product archived because it has stock/order history.",
        references,
      });
    }

    if (await tableExists(client, "product_variant_images")) {
      await client.query("DELETE FROM product_variant_images WHERE product_id = $1", [productId]);
    }
    await client.query("DELETE FROM product_variants WHERE product_id = $1", [productId]);
    await client.query("DELETE FROM products WHERE id = $1", [productId]);
    await client.query("COMMIT");

    return res.json({
      success: true,
      status: "deleted",
      action: "deleted",
      message: "Product deleted",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[product-delete-failed]", {
      productId,
      message: error.message,
      detail: error.detail,
      code: error.code,
      constraint: error.constraint,
    });
    const isForeignKeyReference = error.code === "23503";
    if (isForeignKeyReference && Number.isInteger(productId) && productId > 0) {
      try {
        await client.query("BEGIN");
        const productResult = await client.query(
          `
          SELECT id
          FROM products
          WHERE id = $1
            AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
          FOR UPDATE
          `,
          [productId, tenantId]
        );
        if (productResult.rows[0]) {
          await archiveProductForDelete(client, productId);
          await client.query("COMMIT");
          return res.json({
            success: true,
            status: "soft_deleted",
            action: "soft_deleted",
            message: "Product archived because it has stock/order history.",
            references: { foreign_key_constraint: error.constraint || "unknown" },
          });
        }
        await client.query("ROLLBACK");
      } catch (archiveError) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("[product-delete-failed]", {
          productId,
          message: archiveError.message,
          detail: archiveError.detail,
          code: archiveError.code,
          constraint: archiveError.constraint,
        });
      }
    }
    return res.status(isForeignKeyReference ? 409 : 500).json({
      success: false,
      message: isForeignKeyReference
        ? "Product has stock/order history and could not be archived automatically."
        : "Failed to delete product",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const createVariant = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await ensureProductVariantManufacturerColumn();
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    await client.query("BEGIN");
    const {
      color,
      size,
      sku,
      barcode,
      image_url,
      variant_image_url,
      color_image_url,
      image,
      price,
      sale_price,
      purchase_price,
      cost_price,
      default_purchase_qty,
      manufacturer_id,
      supplier_id,
      warehouse_id,
      branch_id,
      edition_name,
      edition_slug,
    } = req.body || {};
    const normalizedManufacturerId = normalizeOptionalForeignKey(manufacturer_id);
    const productResult = await client.query(
      `SELECT sku, name, brand, category, product_type, gender, grade FROM products WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [req.params.id, tenantId]
    );
    const productForSku = productResult.rows[0] || {};
    const skuPrefix = productForSku.sku || buildSmartSkuPrefix(productForSku);

    const createdVariant = await insertProductVariant(client, {
      productId: req.params.id,
      tenantId,
      variant: normalizeIncomingVariant({
        color,
        size,
        sku,
        barcode,
        image_url: variant_image_url || color_image_url || image_url || image,
        price,
        sale_price,
        purchase_price,
        cost_price,
        default_purchase_qty,
        manufacturer_id: normalizedManufacturerId,
        supplier_id,
        warehouse_id,
        branch_id,
        edition_name,
        edition_slug,
      }),
      skuPrefix,
      userId: req.user?.id || null,
      referenceType: "product",
    });

    console.log("CREATE VARIANT INSERTED:", {
      productId: req.params.id,
      variant: normalizeVariantRow(createdVariant),
    });

    await client.query("COMMIT");
    const createdVariantRow = normalizeVariantRow(createdVariant);
    if (createdVariantRow.thermal_image_generation_needed) {
      scheduleThermalImageGeneration({
        entityType: "variant",
        productId: req.params.id,
        variantId: createdVariantRow.variant_id ?? createdVariantRow.id ?? null,
        tenantId,
        sourceImageUrl: createdVariantRow.image_url || createdVariantRow.variant_image_url || createdVariantRow.color_image_url || "",
        existingThermalImageUrl: createdVariantRow.thermal_image_url || "",
        productName: `${createdVariantRow.product_name || ""} ${createdVariantRow.color || ""}`.trim(),
        regenerate: true,
      });
    }

    return res.status(201).json({
      success: true,
      data: createdVariantRow,
      variant: createdVariantRow,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[products] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create variant",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const updateVariant = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await ensureProductVariantManufacturerColumn();
    await client.query("BEGIN");
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const {
      color,
      size,
      sku,
      barcode,
      image_url,
      variant_image_url,
      color_image_url,
      image,
      price,
      sale_price,
      purchase_price,
      cost_price,
      default_purchase_qty,
      manufacturer_id,
      supplier_id,
      warehouse_id,
      branch_id,
      edition_name,
      edition_slug,
    } = req.body || {};
    const normalizedManufacturerId = normalizeOptionalForeignKey(manufacturer_id);
    const normalizedSupplierId = normalizeOptionalForeignKey(supplier_id);
    const normalizedWarehouseId = normalizeOptionalForeignKey(warehouse_id);
    const normalizedBranchId = normalizeOptionalForeignKey(branch_id);

    const currentResult = await client.query(
      `
      SELECT id, product_id, stock, tenant_id
      FROM product_variants
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
        AND is_active IS DISTINCT FROM FALSE
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [req.params.id, tenantId]
    );

    if (currentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    const currentVariant = currentResult.rows[0];
    const productResult = await client.query(
      `SELECT sku, name, brand, category, product_type, gender, grade FROM products WHERE id = $1 LIMIT 1`,
      [currentVariant.product_id]
    );
    const productForSku = productResult.rows[0] || {};
    const skuPrefix = productForSku.sku || buildSmartSkuPrefix(productForSku);
    const finalSku = await makeUniqueSku(client, {
      tenantId,
      sku: sku || buildVariantSku({ prefix: skuPrefix, color, size }),
      productId: currentVariant.product_id,
      variantId: req.params.id,
    });
    await assertVariantSkuBarcodeAvailable(client, {
      tenantId,
      productId: currentVariant.product_id,
      variant: {
        id: req.params.id,
        sku: finalSku,
        barcode,
      },
    });

    const updated = await client.query(
      `
      UPDATE product_variants
      SET
        manufacturer_id = $1,
        supplier_id = $2,
        warehouse_id = $3,
        branch_id = $4,
        color = $5,
        size = $6,
        sku = $7,
        barcode = $8,
        image_url = $9,
        cost_price = $10,
        price = $11,
        sale_price = $12,
        edition_name = $13,
        edition_slug = $14,
        default_purchase_qty = COALESCE($15, default_purchase_qty),
        is_active = TRUE,
        deleted_at = NULL
      WHERE id = $16
      RETURNING *
      `,
      [
        normalizedManufacturerId,
        normalizedSupplierId,
        normalizedWarehouseId,
        normalizedBranchId,
        color || "",
        size || "",
        finalSku,
        barcode || "",
        variant_image_url || color_image_url || image_url || image || "",
        Number(cost_price || purchase_price || 0),
        Number(price || sale_price || 0),
        Number(sale_price || price || 0),
        String(edition_name || "").trim() || null,
        slugifyEdition(edition_name || edition_slug) || null,
        default_purchase_qty === undefined || default_purchase_qty === null || default_purchase_qty === ""
          ? null
          : Math.max(0, Number(default_purchase_qty || 0)),
        req.params.id,
      ]
    );

    await client.query("COMMIT");
    const updatedVariantRow = normalizeVariantRow(updated.rows[0]);
    if (updatedVariantRow.thermal_image_generation_needed) {
      scheduleThermalImageGeneration({
        entityType: "variant",
        productId: currentVariant.product_id,
        variantId: updatedVariantRow.variant_id ?? updatedVariantRow.id ?? req.params.id,
        tenantId,
        sourceImageUrl: updatedVariantRow.image_url || updatedVariantRow.variant_image_url || updatedVariantRow.color_image_url || "",
        existingThermalImageUrl: updatedVariantRow.thermal_image_url || "",
        productName: `${updatedVariantRow.product_name || ""} ${updatedVariantRow.color || ""}`.trim(),
        regenerate: true,
      });
    }

    return res.json({
      success: true,
      data: updatedVariantRow,
      variant: updatedVariantRow,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[products] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update variant",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const deleteVariant = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await ensureProductVariantManufacturerColumn();
    await client.query("BEGIN");
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

    const variantResult = await client.query(
      `
      SELECT id, product_id, stock
      FROM product_variants
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
        AND is_active IS DISTINCT FROM FALSE
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [req.params.id, tenantId]
    );

    const variant = variantResult.rows[0];
    if (!variant) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    const currentStock = Number(variant.stock || 0);
    if (currentStock !== 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Variant has stock. Adjust or transfer inventory before deleting the variant.",
      });
    }

    await client.query(
      `
      UPDATE product_variants
      SET is_active = FALSE,
          deleted_at = COALESCE(deleted_at, NOW())
      WHERE id = $1
      `,
      [req.params.id]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Variant deleted",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[products] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete variant",
      error: error.message,
    });
  } finally {
    client.release();
  }
};
