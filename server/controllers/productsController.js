import db from "../database/db.js";
import { ensureInventorySchema } from "../services/inventoryService.js";
import {
  attachGroupedColorImages,
  attachVariantImages,
  ensureProductVariantImagesSchema,
  loadProductVariantImages,
  replaceProductVariantImages,
} from "../services/productVariantImagesService.js";
import { normalizeClassificationInput } from "../services/productClassificationsService.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { slugifyEdition } from "../utils/mirrorProduct.js";
import { ensureSingleBranchMode } from "../utils/singleBranchMode.js";

let productVariantSchemaReadyPromise = null;
let productSchemaReadyPromise = null;
let productColumnsReadyPromise = null;
const PRODUCTS_QUERY_TIMEOUT_MS = Number(process.env.PRODUCTS_QUERY_TIMEOUT_MS || 900);

const VARIATION_MODES = new Set(["full_variations", "color_only", "simple"]);

const normalizeClassificationValue = (field, value) => normalizeClassificationInput(field, value);

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
  const result = await client.query(
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
            logo_url TEXT,
            image_url TEXT,
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
            ADD COLUMN IF NOT EXISTS logo_url TEXT,
            ADD COLUMN IF NOT EXISTS image_url TEXT,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
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
            ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS description_ar TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS description_en TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS meta_title TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS seo_description TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS seo_keywords TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS canonical_slug TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS low_stock_alert INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS sku VARCHAR(120) DEFAULT '',
            ADD COLUMN IF NOT EXISTS barcode VARCHAR(120) DEFAULT '',
            ADD COLUMN IF NOT EXISTS category_id BIGINT,
            ADD COLUMN IF NOT EXISTS brand_id BIGINT,
            ADD COLUMN IF NOT EXISTS unit_id BIGINT,
            ADD COLUMN IF NOT EXISTS manufacturer_id BIGINT,
            ADD COLUMN IF NOT EXISTS supplier_id BIGINT,
            ADD COLUMN IF NOT EXISTS warehouse_id BIGINT,
            ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS image TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS variation_mode VARCHAR(30) NOT NULL DEFAULT 'full_variations',
            ADD COLUMN IF NOT EXISTS fixed_size_label VARCHAR(80) DEFAULT '',
            ADD COLUMN IF NOT EXISTS qr_token TEXT,
            ADD COLUMN IF NOT EXISTS tenant_id BIGINT
        `);
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
          UPDATE products
          SET variation_mode = 'full_variations'
          WHERE variation_mode IS NULL OR TRIM(variation_mode) = ''
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
      ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS default_purchase_qty INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS low_stock_alert INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS supplier_id BIGINT,
      ADD COLUMN IF NOT EXISTS warehouse_id BIGINT,
      ADD COLUMN IF NOT EXISTS branch_id BIGINT,
      ADD COLUMN IF NOT EXISTS edition_name TEXT,
      ADD COLUMN IF NOT EXISTS edition_slug TEXT
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id, id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_tenant_product_id ON product_variants (tenant_id, product_id, id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_stock_product ON product_variants (stock, product_id, id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_sku_lower ON product_variants (LOWER(sku))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_barcode_lower ON product_variants (LOWER(barcode))`);
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

const normalizeProductRow = (row = {}) => ({
  ...row,
  price: Number(row.price || row.sale_price || 0),
  sale_price: Number(row.sale_price || row.price || 0),
  cost_price: Number(row.cost_price || row.price || 0),
  wholesale_price: Number(row.wholesale_price || row.price || 0),
  stock: Number(row.stock ?? row.quantity ?? row.qty ?? row.available_quantity ?? row.inventory_quantity ?? row.current_stock ?? 0),
  low_stock_threshold: Number(row.low_stock_threshold || 10),
  status: row.status || "active",
  sku: row.sku || "",
  barcode: row.barcode || "",
  qr_token: row.qr_token || "",
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
  gender: row.gender || "",
  product_type: row.product_type || "",
  style: row.style || "",
  grade: row.grade || "",
  variation_mode: normalizeVariationMode(row.variation_mode),
  fixed_size_label: row.fixed_size_label || "",
  brand_id: row.brand_id ?? "",
  brand_name: row.brand_name || row.brand || "Unbranded",
  unit_id: row.unit_id ?? "",
  product_image_url: row.product_image_url || row.image_url || row.image || row.photo_url || row.thumbnail_url || "",
  image_url: row.image_url || row.product_image_url || row.image || row.photo_url || row.thumbnail_url || "",
  gallery_images: Array.isArray(row.gallery_images) ? row.gallery_images : [],
  category: row.category || "Uncategorized",
  brand: row.brand || "Unbranded",
});

const normalizeVariantRow = (row = {}) => ({
  ...row,
  price: Number(row.variant_price ?? row.variant_sale_price ?? row.price ?? 0),
  sale_price: Number(row.variant_sale_price ?? row.variant_price ?? row.sale_price ?? 0),
  cost_price: Number(row.variant_cost_price ?? row.cost_price ?? 0),
  purchase_price: Number(row.variant_purchase_price ?? row.purchase_price ?? row.variant_cost_price ?? row.cost_price ?? 0),
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
  sku: row.variant_sku || row.sku || "",
  barcode: row.variant_barcode || row.barcode || "",
  manufacturer_id: row.variant_manufacturer_id ?? row.manufacturer_id ?? null,
  variant_manufacturer_name: row.variant_manufacturer_name ?? row.manufacturer_name ?? "",
  manufacturer_name: row.variant_manufacturer_name ?? row.manufacturer_name ?? "",
  edition_name: row.variant_edition_name ?? row.edition_name ?? "",
  edition_slug: row.variant_edition_slug ?? row.edition_slug ?? slugifyEdition(row.variant_edition_name ?? row.edition_name ?? ""),
});

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
        image_url: variant?.image_url || "",
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
      };
    })().catch((error) => {
      productColumnsReadyPromise = null;
      throw error;
    });
  }

  return productColumnsReadyPromise;
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
  if (scope.isSuperAdmin) {
    return {
      whereSql: "",
      values: [],
      whereScope: "super admin bypass",
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

  return {
    whereSql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    values,
    whereScope: parts.length > 0 ? parts.join(" AND ") : "no company/workspace filter",
  };
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
  const salePrice = Number(
    variant.sale_price ??
      variant.salePrice ??
      variant.price ??
      variant.variant_price ??
      group.sale_price ??
      group.price ??
      0
  );

  return {
    id: normalizeOptionalForeignKey(variant.id ?? variant.variant_id ?? variant.variantId),
    color: String(variant.color ?? variant.color_name ?? variant.colorName ?? group.color ?? group.color_name ?? "").trim(),
    size: String(variant.size ?? variant.size_name ?? variant.sizeName ?? "").trim(),
    sku: String(variant.sku ?? variant.variant_sku ?? "").trim(),
    barcode: String(variant.barcode ?? variant.variant_barcode ?? "").trim(),
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
    sale_price: salePrice,
    price: salePrice,
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
  }).filter((variant) => variant.color || variant.size || variant.sku || variant.barcode);
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
    ORDER BY id ASC
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
      image_url,
      cost_price,
      price,
      sale_price,
      edition_name,
      edition_slug,
      default_purchase_qty
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
      nextVariant.image_url,
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
  return createdVariant;
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
    SELECT id, product_id, stock, tenant_id
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
      default_purchase_qty = COALESCE($15, default_purchase_qty)
    WHERE id = $16
      AND product_id = $17
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
      nextVariant.image_url,
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
    ]
  );
  console.log("[product-save] persisted variant image", {
    productId,
    variantId: updated.rows[0]?.id,
    color: updated.rows[0]?.color,
    size: updated.rows[0]?.size,
    image_url: updated.rows[0]?.image_url,
  });

  return updated.rows[0];
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
          p.*
        FROM products p
        ${scopeClause.whereSql}
        ORDER BY p.id DESC
      `,
      values: scopeClause.values,
      scope,
    });

    const payload = normalizeResponse(result.rows.map(normalizeProductRow));
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
    console.log("[products] final where scope", {
      route: "GET /api/products/with-variants",
      userId: scope.userId,
      company_id: scope.company_id,
      workspace_id: scope.workspace_id,
      whereScope: scopeClause.whereScope,
    });

    const productsResult = await runTimedProductQuery({
      route: "GET /api/products/with-variants",
      label: "list-products-base",
      text: `
        SELECT
          p.*
        FROM products p
        ${scopeClause.whereSql}
        ORDER BY p.id DESC
      `,
      values: scopeClause.values,
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

    const payload = normalizeResponse(
      Array.from(grouped.values()).map((product) => ({
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
      }))
    );

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
        p.variation_mode,
        p.fixed_size_label,
        p.qr_token,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS product_image_url,
        v.id AS variant_id,
        v.color,
        v.size,
        v.sku,
        v.barcode,
        v.price AS sale_price,
        v.stock AS stock_quantity,
        COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, ''), NULLIF(v.photo_url, ''), NULLIF(v.thumbnail_url, ''), '') AS variant_image_url
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE p.qr_token = $1
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
        qr_token: first.qr_token,
        brand: first.brand || "Unbranded",
        category: first.category || "Uncategorized",
        variation_mode: first.variation_mode || "full_variations",
        fixed_size_label: first.fixed_size_label || "",
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
      price,
      sale_price,
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
      product_type,
      style,
      grade,
      status,
      sku,
      barcode,
      image_url,
      gallery,
      gallery_images,
      variation_mode,
      fixed_size_label,
      low_stock_threshold,
      low_stock_alert,
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
    const normalizedFixedSizeLabel = String(fixed_size_label || "").trim();
    const normalizedVariants = normalizeVariantsForMode({
      variationMode: normalizedVariationMode,
      variants,
      fixedSizeLabel: normalizedFixedSizeLabel,
    });
    const normalizedGender = await normalizeClassificationValue("gender", gender);
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

    await client.query("BEGIN");
    transactionStarted = true;
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    normalizedForeignKeys.category_id = await resolveDefaultCategoryId(client, {
      categoryId: normalizedForeignKeys.category_id,
      category,
      tenantId,
    });
    normalizedForeignKeys.unit_id = await resolveDefaultUnitId(client, {
      unitId: normalizedForeignKeys.unit_id,
      tenantId,
    });
    const basePrice = Number(price || sale_price || cost_price || purchase_price || wholesale_price || 0);
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
    const created = await client.query(
      `
      INSERT INTO products (
        tenant_id,
        name,
        description,
        description_ar,
        description_en,
        meta_title,
        seo_description,
        seo_keywords,
        canonical_slug,
        price,
        sale_price,
        cost_price,
        wholesale_price,
        brand,
        category,
        main_category,
        sub_category,
        child_category,
        gender,
        product_type,
        style,
        grade,
        category_id,
        brand_id,
        unit_id,
        manufacturer_id,
        supplier_id,
        warehouse_id,
        status,
        sku,
        barcode,
        image_url,
        gallery_images,
        variation_mode,
        fixed_size_label,
        stock,
        low_stock_alert,
        tax_rate
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)
      RETURNING *
      `,
      [
        tenantId,
        name,
        normalizedDescription,
        normalizedDescriptionAr,
        normalizedDescriptionEn,
        normalizedMetaTitle,
        normalizedSeoDescription,
        normalizedSeoKeywords,
        normalizedCanonicalSlug,
        basePrice,
        Number(sale_price || price || 0),
        Number(cost_price || purchase_price || 0),
        Number(wholesale_price || 0),
        brand || "",
        category || "",
        main_category || "",
        sub_category || "",
        child_category || "",
        normalizedGender,
        normalizedProductType,
        normalizedStyle,
        normalizedGrade,
        normalizedForeignKeys.category_id,
        normalizedForeignKeys.brand_id,
        normalizedForeignKeys.unit_id,
        normalizedForeignKeys.manufacturer_id,
        normalizedForeignKeys.supplier_id,
        normalizedForeignKeys.warehouse_id,
        status || "active",
        finalProductSku,
        barcode || "",
        image_url || "",
        JSON.stringify(normalizedGalleryImages),
        normalizedVariationMode,
        normalizedFixedSizeLabel,
        0,
        Number(low_stock_alert || low_stock_threshold || 0),
        Number(tax_rate || 0),
      ]
    );
    const productId = created.rows[0].id;
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

    await replaceProductVariantImages(client, {
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

    return res.status(201).json({
      success: true,
      data: {
        ...normalizeProductRow(created.rows[0]),
        variants: hydratedVariants,
        color_images: colorImagesPayload,
      },
      product: {
        ...normalizeProductRow(created.rows[0]),
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
    const {
      name,
        description,
        description_ar,
        description_en,
        meta_title,
        seo_description,
        seo_keywords,
        canonical_slug,
        price,
      sale_price,
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
        product_type,
        style,
        grade,
      sku,
      barcode,
      status,
      image_url,
      gallery,
      gallery_images,
      variation_mode,
      fixed_size_label,
      low_stock_threshold,
      low_stock_alert,
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
    const normalizedFixedSizeLabel = String(fixed_size_label || "").trim();
    const normalizedVariants = normalizeVariantsForMode({
      variationMode: normalizedVariationMode,
      variants,
      fixedSizeLabel: normalizedFixedSizeLabel,
    });
    const normalizedGender = await normalizeClassificationValue("gender", gender);
    const normalizedProductType = await normalizeClassificationValue("product_type", product_type);
    const normalizedStyle = await normalizeClassificationValue("style", style);
    const normalizedGrade = await normalizeClassificationValue("grade", grade);
    const normalizedDescriptionAr = String(description_ar || "").trim();
    const normalizedDescriptionEn = String(description_en || "").trim();
    const normalizedDescription = String(description || normalizedDescriptionEn || normalizedDescriptionAr || "").trim();
    const normalizedSeoDescription = String(seo_description || normalizedDescriptionEn || normalizedDescriptionAr || normalizedDescription || "").trim();
    const normalizedMetaTitle = String(meta_title || name || "").trim();
    const normalizedSeoKeywords = String(seo_keywords || "").trim();
    const normalizedCanonicalSlug = String(canonical_slug || "").trim();
    const imageUrlProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "image_url");
    const galleryImagesProvided =
      Object.prototype.hasOwnProperty.call(req.body || {}, "gallery_images") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "gallery");
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

    await client.query("BEGIN");
    transactionStarted = true;
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const productId = req.params.id;
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
    const updated = await client.query(
      `
      UPDATE products
      SET
        name = $1,
        description = $2,
        description_ar = $3,
        description_en = $4,
        meta_title = $5,
        seo_description = $6,
        seo_keywords = $7,
        canonical_slug = $8,
        price = $9,
        sale_price = $10,
        cost_price = $11,
        wholesale_price = $12,
        brand = $13,
        category = $14,
        main_category = $15,
        sub_category = $16,
        child_category = $17,
        gender = $18,
        product_type = $19,
        style = $20,
        grade = $21,
        category_id = $22,
        brand_id = $23,
        unit_id = $24,
        manufacturer_id = $25,
        supplier_id = $26,
        warehouse_id = $27,
        status = $28,
        sku = $29,
        barcode = $30,
        image_url = COALESCE($31, image_url),
        gallery_images = COALESCE($32::jsonb, gallery_images),
        variation_mode = $33,
        fixed_size_label = $34,
        low_stock_alert = COALESCE($35, low_stock_alert),
        tax_rate = COALESCE($36, 0)
      WHERE id = $37
      RETURNING *
      `,
      [
        name,
        normalizedDescription,
        normalizedDescriptionAr,
        normalizedDescriptionEn,
        normalizedMetaTitle,
        normalizedSeoDescription,
        normalizedSeoKeywords,
        normalizedCanonicalSlug,
        Number(price || sale_price || cost_price || purchase_price || wholesale_price || 0),
        Number(sale_price || price || 0),
        Number(cost_price || purchase_price || 0),
        Number(wholesale_price || 0),
        brand || "",
        category || "",
        main_category || "",
        sub_category || "",
        child_category || "",
        normalizedGender,
        normalizedProductType,
        normalizedStyle,
        normalizedGrade,
        normalizedForeignKeys.category_id,
        normalizedForeignKeys.brand_id,
        normalizedForeignKeys.unit_id,
        normalizedForeignKeys.manufacturer_id,
        normalizedForeignKeys.supplier_id,
        normalizedForeignKeys.warehouse_id,
        status || "active",
        finalProductSku,
        barcode || "",
        imageUrlProvided ? image_url || "" : null,
        galleryImagesProvided ? JSON.stringify(normalizedGalleryImages) : null,
        normalizedVariationMode,
        normalizedFixedSizeLabel,
        (low_stock_alert ?? low_stock_threshold) === undefined || (low_stock_alert ?? low_stock_threshold) === null || (low_stock_alert ?? low_stock_threshold) === ""
          ? null
          : Number(low_stock_alert ?? low_stock_threshold),
        tax_rate === undefined || tax_rate === null || tax_rate === "" ? null : Number(tax_rate),
        productId,
      ]
    );
    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }
    const deletedIds = Array.isArray(deleted_variant_ids) ? deleted_variant_ids : [];
    const existingVariantsResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM product_variants
      WHERE product_id = $1
        AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
      `,
      [productId, tenantId]
    );
    const existingVariantsCount = Number(existingVariantsResult.rows[0]?.count || 0);

    console.log("[products:update] existing variants count", existingVariantsCount);
    console.log("[products:update] incoming variants count", normalizedVariants.length);

    if (normalizedVariants.length < existingVariantsCount) {
      console.warn("[products:update] skipped destructive variant delete because payload is smaller than existing variant count", {
        productId,
        existingVariantsCount,
        incomingVariantsCount: normalizedVariants.length,
        deletedVariantIds: deletedIds,
      });
    }

    if (deletedIds.length > 0) {
      console.warn("[products:update] skipped destructive variant delete because Edit Product variant deletion is temporarily disabled", {
        productId,
        deletedVariantIds: deletedIds,
      });
    }

    const savedVariants = [];
    for (const variant of normalizedVariants) {
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

    await replaceProductVariantImages(client, {
      productId,
      variants: [...(Array.isArray(variants) ? variants : []), ...variantImagePayloads],
      colorImages: Array.isArray(colorImages) ? colorImages : [],
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

    return res.json({
      success: true,
      data: {
        ...normalizeProductRow(updated.rows[0]),
        variants: hydratedVariants,
        color_images: colorImagesPayload,
      },
      product: {
        ...normalizeProductRow(updated.rows[0]),
        variants: hydratedVariants,
        color_images: colorImagesPayload,
      },
    });
  } catch (error) {
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

export const deleteProduct = async (req, res) => {
  try {
    await ensureProductSchema();
    await ensureProductVariantSchema();
    await db.query(
      `
      DELETE FROM product_variants
      WHERE product_id = $1
      `,
      [req.params.id]
    );

    await db.query(
      `
      DELETE FROM products
      WHERE id = $1
      `,
      [req.params.id]
    );

    return res.json({
      success: true,
      message: "Product deleted",
    });
  } catch (error) {
    console.error("[products] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete product",
      error: error.message,
    });
  }
};

export const createVariant = async (req, res) => {
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
    const productResult = await client.query(
      `SELECT sku, name, brand, category, product_type, gender, grade FROM products WHERE id = $1 LIMIT 1`,
      [req.params.id]
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

    return res.status(201).json({
      success: true,
      data: normalizeVariantRow(createdVariant),
      variant: normalizeVariantRow(createdVariant),
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
        default_purchase_qty = COALESCE($15, default_purchase_qty)
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

    return res.json({
      success: true,
      data: normalizeVariantRow(updated.rows[0]),
      variant: normalizeVariantRow(updated.rows[0]),
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
      DELETE FROM product_variants
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
