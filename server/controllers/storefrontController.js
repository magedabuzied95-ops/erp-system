import crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import db from "../database/db.js";
import { adjustVariantStock } from "../services/inventoryService.js";
import { createSystemNotification } from "../services/notificationsService.js";
import {
  attachGroupedColorImages,
  attachVariantImages,
  ensureProductVariantImagesSchema,
  loadProductVariantImages,
} from "../services/productVariantImagesService.js";
import { getShippingProvider, shippingProviders } from "../services/shippingProviders/index.js";
import { ensureLoyaltySchema, getCustomerLoyaltySummary, resolveOrCreateCustomerAccount } from "../services/loyaltyService.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";
import { fetchProductClassificationGroupByKey, getClassificationFilterAliases } from "../services/productClassificationsService.js";
import { generateProductOgImage, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, buildAbsolutePublicUrl } from "../services/productOgImageService.js";
import { isMirrorProduct, mirrorProductTitle, slugifyEdition } from "../utils/mirrorProduct.js";

const DEFAULT_TENANT_ID = 1;
const LOW_STOCK_LIMIT = 2;
let storefrontSchemaReadyPromise = null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value = "") => String(value || "").trim();
const publicToken = () => crypto.randomBytes(18).toString("hex");
const orderNumber = () => `WEB-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

const getProductLowStockSnapshot = async (clientOrPool, { productId, tenantId }) => {
  if (!productId) return null;
  const result = await clientOrPool.query(
    `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      CASE
        WHEN COUNT(v.id) > 0 THEN COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0)), 0)
        ELSE GREATEST(COALESCE(p.stock, 0), 0)
      END::int AS total_stock,
      COALESCE(
        NULLIF(p.image_url, ''),
        NULLIF(p.image, ''),
        NULLIF(p.photo_url, ''),
        NULLIF(p.thumbnail_url, ''),
        NULLIF((ARRAY_AGG(v.image_url ORDER BY v.id) FILTER (WHERE v.image_url IS NOT NULL AND v.image_url <> ''))[1], ''),
        ''
      ) AS image_url
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
    WHERE p.id = $1
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
    GROUP BY p.id, p.name, p.stock, p.image_url, p.image, p.photo_url, p.thumbnail_url
    LIMIT 1
    `,
    [productId, tenantId]
  );
  return result.rows[0] || null;
};

const lowStockMessage = (productName, totalStock) =>
  Number(totalStock) === 1
    ? `متبقي قطعة واحدة فقط من ${productName}`
    : `متبقي قطعتين فقط من ${productName}`;

const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;
  const text = toText(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const isValidShippingProofFile = (file) => {
  if (!file) return false;
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  return allowedTypes.has(file.mimetype) && Number(file.size || 0) >= 5 * 1024;
};

const removeUploadedFile = async (filePath) => {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // ignore cleanup errors
  }
};

const tenantFromRequest = (req) => {
  const tenantId = Number(req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : DEFAULT_TENANT_ID;
};

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

const attachDbContext = (error, context = {}) => {
  error.checkoutDbContext = { ...(error.checkoutDbContext || {}), ...context };
  return error;
};

const queryWithContext = async (client, query, params = [], context = {}) => {
  try {
    return await client.query(query, params);
  } catch (error) {
    throw attachDbContext(error, { ...context, query });
  }
};

const insertReturning = async (client, tableName, values, columns, context = {}) => {
  const entries = Object.entries(values).filter(([column]) => columns.has(column));
  if (!entries.length) throw new Error(`No compatible columns found for ${tableName}`);
  const columnSql = entries.map(([column]) => column).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const params = entries.map(([, value]) => value);
  const query = `INSERT INTO ${tableName} (${columnSql}) VALUES (${placeholders}) RETURNING *`;
  const result = await queryWithContext(client, query, params, { table: tableName, operation: "insert", ...context });
  return result.rows[0];
};

const logCheckoutStep = (step, details = {}) => {
  if (process.env.NODE_ENV === "production") return;
  console.log("[storefront-order-confirm] step:", step, details);
};

const ensureStorefrontSchemaNow = async (clientOrPool = db) => {
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_name TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_slug TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS website_notifications ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customer_wishlist ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS recently_viewed_products ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS inventory_movements ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_points NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_tier VARCHAR(50) NOT NULL DEFAULT 'Bronze'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_updated_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT false`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS cod_enabled BOOLEAN DEFAULT false`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS completed_orders INTEGER DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'pos'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50) NOT NULL DEFAULT 'walk_in'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_address TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS governorate VARCHAR(120)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS city_area VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS landmark TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS order_notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_method VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_screenshot TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_reference TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_by INTEGER NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_trust_counted_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cod_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(80) NOT NULL DEFAULT 'manual'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_status VARCHAR(80) NOT NULL DEFAULT 'pending'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_url TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS last_shipping_sync_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS expected_delivery_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_image TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS size VARCHAR(100)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS color VARCHAR(100)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS customer_wishlist (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NULL,
      phone VARCHAR(80),
      product_id BIGINT NOT NULL,
      notify_price_drop BOOLEAN NOT NULL DEFAULT TRUE,
      notify_back_in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, phone, product_id)
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS recently_viewed_products (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NULL,
      session_id TEXT,
      phone VARCHAR(80),
      product_id BIGINT NOT NULL,
      viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS website_notifications (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NULL,
      phone VARCHAR(80),
      type VARCHAR(80) NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_source_created ON orders (source, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_phone_created ON orders (customer_phone, created_at DESC)`);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_storefront_active_tenant_id
    ON products (tenant_id, id DESC)
    WHERE COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_storefront_filters
    ON products (tenant_id, gender, product_type, style, grade, id DESC)
    WHERE COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_variants_product_stock
    ON product_variants (product_id, stock, id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_variants_tenant_product_stock
    ON product_variants (tenant_id, product_id, stock, id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_wishlist_tenant_phone_created
    ON customer_wishlist (tenant_id, phone, created_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_recently_viewed_tenant_phone_viewed
    ON recently_viewed_products (tenant_id, phone, viewed_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_recently_viewed_tenant_session_viewed
    ON recently_viewed_products (tenant_id, session_id, viewed_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_recently_viewed_tenant_product_lookup
    ON recently_viewed_products (tenant_id, product_id, phone, session_id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_website_notifications_tenant_phone_created
    ON website_notifications (tenant_id, phone, created_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_tenant_created
    ON orders (tenant_id, created_at DESC, id DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_tenant_channel_created
    ON orders (tenant_id, channel, created_at DESC, id DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id
    ON order_items (order_id, id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order_id
    ON order_items (tenant_id, order_id, id)
  `);
};

export const ensureStorefrontSchema = async (clientOrPool = db) => {
  if (clientOrPool !== db) {
    return ensureStorefrontSchemaNow(clientOrPool);
  }
  if (!storefrontSchemaReadyPromise) {
    storefrontSchemaReadyPromise = ensureStorefrontSchemaNow(db).catch((error) => {
      storefrontSchemaReadyPromise = null;
      throw error;
    });
  }
  return storefrontSchemaReadyPromise;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const firstText = (...values) => values.map((value) => toText(value)).find(Boolean) || "";

const normalizeProduct = (row = {}) => {
  const galleryImages = parseJsonArray(row.gallery_images).filter(Boolean);
  const productImage = firstText(row.public_image_url, row.image_url, row.image, row.photo_url, row.thumbnail_url, galleryImages[0]);
  const variants = parseJsonArray(row.variants).map((variant) => {
    const variantPrice = toNumber(variant.price || row.price);
    const variantSalePrice = toNumber(variant.sale_price || variant.price || row.sale_price || row.price);
    return {
      ...variant,
      id: variant.id,
      edition_name: firstText(variant.edition_name),
      edition_slug: firstText(variant.edition_slug, slugifyEdition(variant.edition_name)),
      image_url: firstText(variant.image_url, productImage),
      price: variantPrice,
      sale_price: variantSalePrice || variantPrice,
      stock: Math.max(0, toNumber(variant.stock)),
    };
  });
  const totalStock = variants.length
    ? variants.reduce((sum, variant) => sum + toNumber(variant.stock), 0)
    : Math.max(0, toNumber(row.stock));
  const variantPriceOptions = variants
    .filter((variant) => variant.price > 0 || variant.sale_price > 0)
    .sort((a, b) => (b.stock > 0) - (a.stock > 0) || (a.sale_price || a.price) - (b.sale_price || b.price));
  const bestVariantPrice = variantPriceOptions[0];
  const rowPrice = toNumber(row.price);
  const rowSalePrice = toNumber(row.sale_price);
  const productPrice = rowPrice || bestVariantPrice?.price || rowSalePrice || bestVariantPrice?.sale_price || 0;
  const productSalePrice = rowSalePrice || bestVariantPrice?.sale_price || productPrice;
  const variantDeals = variants
    .filter((variant) => variant.sale_price > 0 && variant.price > variant.sale_price)
    .sort((a, b) => a.sale_price - b.sale_price);
  const bestVariantDeal = variantDeals[0];
  const salePrice = bestVariantDeal?.sale_price || productSalePrice || productPrice;
  const price = bestVariantDeal?.price || productPrice || salePrice;
  const discount = price > salePrice && salePrice > 0;

  const product = {
    id: row.id,
    slug: `${row.id}-${encodeURIComponent(String(row.name || "product").replace(/\s+/g, "-"))}`,
    name: row.name || "",
    sku: row.sku || "",
    barcode: row.barcode || "",
    category: row.category_name || row.product_type || "",
    category_id: row.category_id || null,
    gender: row.gender || "",
    product_type: row.product_type || "",
    productType: row.product_type || "",
    style: row.style || "",
    grade: row.grade || "",
    brand: row.brand_name || "",
    image_url: firstText(productImage, variants.find((variant) => variant.image_url)?.image_url),
    gallery_images: [...new Set([productImage, ...galleryImages, ...variants.map((variant) => variant.image_url)].filter(Boolean))],
    description: row.description || "",
    description_ar: row.description_ar || "",
    description_en: row.description_en || "",
    meta_title: row.meta_title || "",
    seo_description: row.seo_description || row.description_en || row.description_ar || row.description || "",
    seo_keywords: row.seo_keywords || "",
    canonical_slug: row.canonical_slug || "",
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
    price,
    sale_price: salePrice || price,
    old_price: discount ? price : 0,
    total_stock: totalStock,
    badge: discount ? "عرض" : totalStock <= 1 ? "آخر قطعة" : totalStock <= LOW_STOCK_LIMIT ? "سريع النفاذ" : "جديد",
    sizes: [...new Set(variants.filter((v) => v.stock > 0 && v.size).map((v) => v.size))],
    colors: [...new Set(variants.filter((v) => v.stock > 0 && v.color).map((v) => v.color))],
    variants,
    low_stock: totalStock > 0 && totalStock <= LOW_STOCK_LIMIT,
  };
  return {
    ...product,
    is_mirror: isMirrorProduct(product),
    seo_title: mirrorProductTitle(product, variants[0]),
  };
};

const productSeoTitle = (product = {}) => firstText(product.meta_title, product.seo_title, product.name, "Product");
const productSeoDescription = (product = {}) => firstText(product.seo_description, product.description_en, product.description_ar, product.description, product.name);

const attachSocialMetadata = async (product = {}, req = null) => {
  const ogImage = await generateProductOgImage({ product, req });
  const pageSlug = product.slug || `${product.id}-${encodeURIComponent(String(product.name || "product").replace(/\s+/g, "-"))}`;
  return {
    ...product,
    og_image_url: ogImage.url,
    og_image_width: OG_IMAGE_WIDTH,
    og_image_height: OG_IMAGE_HEIGHT,
    og_image_cache_key: ogImage.cacheKey,
    social_meta: {
      title: productSeoTitle(product),
      description: productSeoDescription(product),
      image: ogImage.url,
      image_width: OG_IMAGE_WIDTH,
      image_height: OG_IMAGE_HEIGHT,
      twitter_card: "summary_large_image",
      url: buildAbsolutePublicUrl(req, `/shop/product/${pageSlug}`),
    },
  };
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
        image_url: variant?.image_url || "",
      });
    }
  }
  return Array.from(seen.values());
};

const catalogQuery = `
  SELECT
    p.*,
    c.name AS category_name,
    b.name AS brand_name,
    COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS public_image_url,
    COALESCE(SUM(CASE WHEN pv.id IS NOT NULL THEN GREATEST(COALESCE(pv.stock, 0), 0) ELSE 0 END), 0) AS variant_total_stock,
    COALESCE(BOOL_OR(pv.sale_price > 0 AND pv.sale_price < pv.price) FILTER (WHERE pv.id IS NOT NULL), FALSE) AS has_variant_discount,
    COALESCE(
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'id', pv.id,
          'product_id', pv.product_id,
          'size', pv.size,
          'color', pv.color,
          'sku', pv.sku,
          'barcode', pv.barcode,
          'edition_name', pv.edition_name,
          'edition_slug', pv.edition_slug,
          'image_url', COALESCE(NULLIF(pv.image_url, ''), NULLIF(pv.image, ''), NULLIF(pv.photo_url, ''), NULLIF(pv.thumbnail_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), ''),
          'price', pv.price,
          'sale_price', pv.sale_price,
          'stock', pv.stock
        )
      ) FILTER (WHERE pv.id IS NOT NULL),
      '[]'::jsonb
    ) AS variants
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN product_variants pv ON pv.product_id = p.id
  WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
    AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
`;

const queryProducts = (tenantId, q, category, filters, saleOnly, limit, offset) =>
  db.query(
    `
    ${catalogQuery}
      AND ($2 = '' OR LOWER(CONCAT_WS(' ', p.name, p.sku, p.barcode, p.gender, p.product_type, p.style, c.name, b.name, pv.size, pv.color, pv.sku, pv.edition_name, pv.edition_slug)) LIKE '%' || $2 || '%')
      AND ($3 = '' OR LOWER(CONCAT_WS(' ', c.name, p.gender, p.product_type, p.style)) LIKE '%' || $3 || '%')
      AND ($4::boolean = FALSE OR (p.sale_price > 0 AND p.sale_price < p.price) OR (pv.sale_price > 0 AND pv.sale_price < pv.price))
      AND (COALESCE(array_length($5::text[], 1), 0) = 0 OR LOWER(TRIM(COALESCE(p.gender, ''))) = ANY($5::text[]))
      AND (COALESCE(array_length($6::text[], 1), 0) = 0 OR LOWER(TRIM(COALESCE(p.product_type, ''))) = ANY($6::text[]))
      AND (COALESCE(array_length($7::text[], 1), 0) = 0 OR LOWER(TRIM(COALESCE(p.style, ''))) = ANY($7::text[]))
      AND (COALESCE(array_length($8::text[], 1), 0) = 0 OR LOWER(TRIM(COALESCE(p.grade, ''))) = ANY($8::text[]))
    GROUP BY p.id, c.name, b.name
    ORDER BY p.id DESC
    LIMIT $9 OFFSET $10
    `,
    [tenantId, q, category, saleOnly, filters.gender, filters.productType, filters.style, filters.grade, limit, offset]
  );

const hydrateProductsWithImages = async (products = []) => {
  const rows = Array.isArray(products) ? products : [];
  const productIds = rows.map((product) => Number(product.id)).filter((value) => Number.isFinite(value) && value > 0);
  if (!productIds.length) {
    return rows;
  }

  const imageBundleMap = await loadProductVariantImages(db, productIds).catch(() => new Map());

  return rows.map((product) => {
    const imageBundle = imageBundleMap.get(String(product.id)) || null;
    const variants = attachVariantImages(Array.isArray(product.variants) ? product.variants : [], imageBundle);
    const colorImages = attachGroupedColorImages(deriveColorGroupsFromVariants(variants), imageBundle);
    const primaryVariant = variants.find((variant) => Array.isArray(variant.images) && variant.images.some((image) => image.is_primary)) || variants.find((variant) => variant.image_url) || null;
    const primaryImage = primaryVariant?.primary_image_url || primaryVariant?.image_url || product.image_url || product.product_image_url || product.gallery_images?.[0] || "";
    return {
      ...product,
      variants,
      colors: colorImages,
      color_images: colorImages,
      image_url: primaryImage || product.image_url || product.product_image_url || "",
      product_image_url: primaryImage || product.product_image_url || product.image_url || "",
    };
  });
};

export const listProducts = async (req, res) => {
  try {
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();
    const tenantId = tenantFromRequest(req);
    const q = toText(req.query.q).toLowerCase();
    const category = toText(req.query.category).toLowerCase();
    const [gender, productType, style, grade] = await Promise.all([
      getClassificationFilterAliases("gender", req.query.gender),
      getClassificationFilterAliases("product_type", req.query.product_type || req.query.productType),
      getClassificationFilterAliases("style", req.query.style),
      getClassificationFilterAliases("grade", req.query.grade),
    ]);
    const saleOnly = String(req.query.sale || "") === "1";
    const limit = Math.min(Math.max(Number(req.query.limit || 24), 1), 80);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    let result = await queryProducts(tenantId, q, category, { gender, productType, style, grade }, saleOnly, limit, offset);
    let usedTenantFallback = false;
    if (!result.rows.length && tenantId !== null) {
      const fallback = await queryProducts(null, q, category, { gender, productType, style, grade }, saleOnly, limit, offset);
      if (fallback.rows.length) {
        result = fallback;
        usedTenantFallback = true;
      }
    }
    let products = result.rows.map(normalizeProduct);
    if (!products.some((product) => product.total_stock > 0) && tenantId !== null) {
      const fallback = await queryProducts(null, q, category, { gender, productType, style, grade }, saleOnly, limit, offset);
      const fallbackProducts = fallback.rows.map(normalizeProduct);
      if (fallbackProducts.some((product) => product.total_stock > 0)) {
        products = fallbackProducts;
        usedTenantFallback = true;
      }
    }
    products = await hydrateProductsWithImages(products);
    if (process.env.NODE_ENV !== "production") {
      console.log("[storefront] products", { tenantId, usedTenantFallback, q, category, saleOnly, filters: { gender, productType, style, grade }, count: products.length });
    }
    res.json({ success: true, products });
  } catch (error) {
    console.error("[storefront] list products", error);
    res.status(500).json({ success: false, message: "Failed to load products" });
  }
};

const countActiveProductsByGender = async (tenantId, aliases = []) => {
  const normalizedAliases = (Array.isArray(aliases) ? aliases : [])
    .map((value) => toText(value).toLowerCase())
    .filter(Boolean);
  if (!normalizedAliases.length) return 0;

  const result = await db.query(
    `
    SELECT COUNT(DISTINCT p.id)::int AS total
    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
      AND LOWER(TRIM(COALESCE(p.gender, ''))) = ANY($2::text[])
      AND COALESCE(pv.stock, p.stock, 0) > 0
    `,
    [tenantId, normalizedAliases]
  );
  return Number(result.rows[0]?.total || 0);
};

export const listGenderClassifications = async (req, res) => {
  try {
    const tenantId = tenantFromRequest(req);
    const group = await fetchProductClassificationGroupByKey("gender", { includeInactive: false });
    const options = [];

    for (const option of group?.options || []) {
      const aliases = await getClassificationFilterAliases("gender", option.value);
      let product_count = await countActiveProductsByGender(tenantId, aliases);
      if (product_count === 0 && tenantId !== null) {
        product_count = await countActiveProductsByGender(null, aliases);
      }
      options.push({
        id: option.id,
        value: option.value,
        name_ar: option.name_ar || option.label_ar || "",
        name_en: option.name_en || option.label_en || "",
        label_ar: option.label_ar,
        label_en: option.label_en,
        english_name: option.english_name || option.label_en || "",
        icon: option.icon,
        color: option.color,
        sort_order: option.sort_order,
        is_active: option.is_active,
        product_count,
      });
    }

    res.json({ success: true, group: "gender", options });
  } catch (error) {
    console.error("[storefront] gender classifications", error);
    res.status(500).json({ success: false, message: "Failed to load gender classifications" });
  }
};

const lastPieceCategorySql = `
  CASE
    WHEN LOWER(CONCAT_WS(' ', p.gender, p.product_type, p.style, c.name)) LIKE ANY (ARRAY['%رجال%', '%male%', '%men%']) THEN 'رجالي'
    WHEN LOWER(CONCAT_WS(' ', p.gender, p.product_type, p.style, c.name)) LIKE ANY (ARRAY['%حريمي%', '%نساء%', '%نسائي%', '%female%', '%women%']) THEN 'حريمي'
    WHEN LOWER(CONCAT_WS(' ', p.gender, p.product_type, p.style, c.name)) LIKE ANY (ARRAY['%أطفال%', '%اطفال%', '%طفل%', '%kids%', '%children%']) THEN 'أطفال'
    ELSE COALESCE(NULLIF(c.name, ''), NULLIF(p.product_type, ''), NULLIF(p.gender, ''), '')
  END
`;

const queryLastPieceProducts = async (tenantId, category, size, limit) => {
  const variantColumns = await tableColumns(db, "product_variants");
  const variantStatusClause = variantColumns.has("status")
    ? "AND COALESCE(NULLIF(LOWER(TRIM(pv.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')"
    : "";

  return db.query(
    `
    WITH low_variants AS (
      SELECT
        pv.*,
        ${lastPieceCategorySql} AS last_piece_category
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
        AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
        ${variantStatusClause}
        AND GREATEST(COALESCE(pv.stock, 0), 0) BETWEEN 1 AND 2
        AND COALESCE(NULLIF(TRIM(pv.size), ''), '') <> ''
        AND ($2 = '' OR ${lastPieceCategorySql} = $2)
        AND ($3 = '' OR LOWER(TRIM(pv.size)) = LOWER(TRIM($3)))
    )
    SELECT
      p.*,
      c.name AS category_name,
      b.name AS brand_name,
      COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS public_image_url,
      COALESCE(SUM(GREATEST(COALESCE(lv.stock, 0), 0)), 0) AS variant_total_stock,
      COALESCE(BOOL_OR(lv.sale_price > 0 AND lv.sale_price < lv.price), FALSE) AS has_variant_discount,
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'id', lv.id,
          'product_id', lv.product_id,
          'size', lv.size,
          'color', lv.color,
          'sku', lv.sku,
          'barcode', lv.barcode,
          'edition_name', lv.edition_name,
          'edition_slug', lv.edition_slug,
          'image_url', COALESCE(NULLIF(lv.image_url, ''), NULLIF(lv.image, ''), NULLIF(lv.photo_url, ''), NULLIF(lv.thumbnail_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), ''),
          'price', lv.price,
          'sale_price', lv.sale_price,
          'stock', lv.stock,
          'last_piece_category', lv.last_piece_category
        )
      ) AS variants
    FROM low_variants lv
    JOIN products p ON p.id = lv.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    GROUP BY p.id, c.name, b.name
    ORDER BY MIN(lv.stock) ASC, MAX(p.updated_at) DESC NULLS LAST, p.id DESC
    LIMIT $4
    `,
    [tenantId, toText(category), toText(size), limit]
  );
};

export const listLastPieceProducts = async (req, res) => {
  try {
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();
    const tenantId = tenantFromRequest(req);
    const category = toText(req.query.category);
    const size = toText(req.query.size);
    const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 120);
    let result = await queryLastPieceProducts(tenantId, category, size, limit);
    let usedTenantFallback = false;
    if (!result.rows.length && tenantId !== null) {
      const fallback = await queryLastPieceProducts(null, category, size, limit);
      if (fallback.rows.length) {
        result = fallback;
        usedTenantFallback = true;
      }
    }

    const products = await hydrateProductsWithImages(result.rows.map(normalizeProduct)).then((rows) => rows.map((product) => {
      const lowVariants = (product.variants || []).filter((variant) => {
        const stock = toNumber(variant.stock);
        return stock > 0 && stock <= 2;
      });
      const categoryLabel = firstText(lowVariants[0]?.last_piece_category, product.category);
      return {
        ...product,
        category: categoryLabel,
        total_stock: lowVariants.reduce((sum, variant) => sum + toNumber(variant.stock), 0),
        variants: lowVariants,
        sizes: [...new Set(lowVariants.map((variant) => variant.size).filter(Boolean))],
        colors: [...new Set(lowVariants.map((variant) => variant.color).filter(Boolean))],
        low_stock: true,
      };
    }).filter((product) => product.variants.length));

    const categories = ["رجالي", "حريمي", "أطفال"]
      .map((label) => ({
        label,
        count: products.filter((product) => product.category === label).reduce((sum, product) => sum + product.variants.length, 0),
      }))
      .filter((item) => item.count > 0);
    const sizes = [...new Set(
      products
        .filter((product) => !category || product.category === category)
        .flatMap((product) => product.variants.map((variant) => variant.size).filter(Boolean))
    )].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b), "ar"));

    if (process.env.NODE_ENV !== "production") {
      console.log("[storefront] last-piece", { tenantId, usedTenantFallback, category, size, products: products.length });
    }
    res.json({
      success: true,
      categories,
      sizes,
      products,
      hooks: {
        story_export: "reserved",
        telegram_posting: "reserved",
        whatsapp_status_export: "reserved",
        countdown_timers: "reserved",
        size_view_counts: "reserved",
      },
    });
  } catch (error) {
    console.error("[storefront] last-piece", error);
    res.status(500).json({ success: false, message: "Failed to load last piece products" });
  }
};

export const getProduct = async (req, res) => {
  try {
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();
    const tenantId = tenantFromRequest(req);
    const id = String(req.params.id || "").split("-")[0];
    let result = await db.query(`${catalogQuery} AND p.id = $2::bigint GROUP BY p.id, c.name, b.name LIMIT 1`, [tenantId, id]);
    if (!result.rows[0] && tenantId !== null) {
      result = await db.query(`${catalogQuery} AND p.id = $2::bigint GROUP BY p.id, c.name, b.name LIMIT 1`, [null, id]);
    }
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Product not found" });
    const [product] = await hydrateProductsWithImages([normalizeProduct(result.rows[0])]);
    res.json({ success: true, product: await attachSocialMetadata(product, req) });
  } catch (error) {
    console.error("[storefront] product", error);
    res.status(500).json({ success: false, message: "Failed to load product" });
  }
};

export const searchProducts = listProducts;

const resolveCustomer = async (client, tenantId, checkout = {}, customerColumns = null, runQuery = queryWithContext) => {
  void customerColumns;
  void runQuery;
  return resolveOrCreateCustomerAccount(client, {
    tenantId,
    customerId: checkout.customer_id || checkout.customerId || null,
    name: toText(checkout.full_name || checkout.customer_name || "Online Customer"),
    phone: checkout.primary_phone || checkout.customer_phone || checkout.phone || "",
    email: checkout.email || checkout.customer_email || "",
    address: checkout.detailed_address || checkout.address || "",
  });
};

const isDamiettaGovernorate = (value = "") => {
  const text = toText(value).toLowerCase();
  return text.includes("دمياط") || text.includes("damietta") || text.includes("دمياط");
};

const canUseCod = (customer = {}, checkout = {}) =>
  isDamiettaGovernorate(checkout.governorate) ||
  Number(customer?.completed_orders || 0) >= 1 ||
  customer?.is_trusted === true ||
  customer?.cod_enabled === true;

export const createWebsiteOrder = async (req, res) => {
  const client = await db.connect();
  let checkoutStep = "start";
  let checkoutQueryContext = {};
  const markCheckoutStep = (step, details = {}) => {
    checkoutStep = step;
    checkoutQueryContext = { step, ...details };
    logCheckoutStep(step, details);
  };
  const runCheckoutQuery = (queryClient, query, params = [], context = {}) =>
    queryWithContext(queryClient, query, params, { ...checkoutQueryContext, step: checkoutStep, ...context });
  try {
    const tenantId = tenantFromRequest(req);
    await ensureStorefrontSchema(client);
    const checkout = parseJsonField(req.body?.checkout, req.body || {});
    const items = parseJsonField(req.body?.items, Array.isArray(req.body?.items) ? req.body.items : []);
    if (!items.length) return res.status(400).json({ success: false, message: "Cart is empty" });
    if (!toText(checkout.full_name) || !toText(checkout.primary_phone) || !toText(checkout.governorate) || !toText(checkout.city_area) || !toText(checkout.detailed_address)) {
      return res.status(400).json({ success: false, message: "Name, phone, governorate, city and address are required" });
    }

    await client.query("BEGIN");
    const checkoutColumns = {
      customers: await tableColumns(client, "customers"),
      orders: await tableColumns(client, "orders"),
      orderItems: await tableColumns(client, "order_items"),
      products: await tableColumns(client, "products"),
      variants: await tableColumns(client, "product_variants"),
      notifications: await tableColumns(client, "website_notifications"),
    };
    markCheckoutStep("schema-columns", {
      customersTenant: checkoutColumns.customers.has("tenant_id"),
      ordersTenant: checkoutColumns.orders.has("tenant_id"),
      orderItemsTenant: checkoutColumns.orderItems.has("tenant_id"),
      variantsTenant: checkoutColumns.variants.has("tenant_id"),
    });

    markCheckoutStep("upsert customer", { table: "customers", phone: checkout.primary_phone });
    const customer = await resolveCustomer(client, tenantId, checkout, checkoutColumns.customers, runCheckoutQuery);
    markCheckoutStep("upsert customer:done", { table: "customers", customerId: customer?.id });
    let subtotal = 0;
    const normalizedItems = [];

    for (const item of items) {
      const variantId = Number(item.variant_id || item.variantId || 0);
      const quantity = Math.max(1, Number(item.quantity || 1));
      if (!variantId) throw new Error("Select an available size and color");
      const variantTenantClause = checkoutColumns.variants.has("tenant_id")
        ? "AND ($2::bigint IS NULL OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)"
        : "";
      const productTenantClause = checkoutColumns.products.has("tenant_id")
        ? "AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)"
        : "";
      markCheckoutStep("decrement stock:lock variant", { table: "product_variants", variantId, quantity, variantTenantScoped: checkoutColumns.variants.has("tenant_id") });
      const variantResult = await runCheckoutQuery(
        client,
        `
        SELECT pv.*, p.name AS product_name, p.image_url AS product_image, p.sale_price AS product_sale_price, p.price AS product_price
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.id = $1
          ${variantTenantClause}
          ${productTenantClause}
        FOR UPDATE
        `,
        [variantId, tenantId],
        { table: "product_variants", operation: "select variant for update" }
      );
      const variant = variantResult.rows[0];
      if (!variant) throw new Error("Selected variant is unavailable");
      if (Number(variant.stock || 0) < quantity) throw new Error(`باقي ${variant.stock || 0} فقط من ${variant.product_name}`);
      const price = toNumber(variant.sale_price || variant.price || variant.product_sale_price || variant.product_price);
      subtotal += price * quantity;
      normalizedItems.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        product_name: variant.product_name,
        variant_name: [variant.color, variant.size].filter(Boolean).join(" / "),
        sku: variant.sku || "",
        barcode: variant.barcode || "",
        color: variant.color || "",
        size: variant.size || "",
        image_url: variant.image_url || variant.product_image || "",
        price,
        quantity,
      });
      markCheckoutStep("decrement stock:lock variant:done", { table: "product_variants", variantId, productId: variant.product_id, stockBefore: variant.stock });
    }

    const deliveryFee = toNumber(checkout.delivery_fee, toNumber(req.body?.delivery_fee, 60));
    const discount = toNumber(req.body?.discount || checkout.discount, 0);
    const total = Math.max(0, subtotal - discount + deliveryFee);
    const requestedPaymentMethod = toText(checkout.payment_method || "shipping_confirmation").toLowerCase();
    const paymentMethod = requestedPaymentMethod === "cod" || requestedPaymentMethod === "cash" ? "cod" : "shipping_confirmation";
    if (paymentMethod === "cod" && !canUseCod(customer, checkout)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "الدفع عند الاستلام متاح للعملاء الحاليين ومحافظة دمياط فقط" });
    }
    const shippingPaymentFile = req.file || null;
    if (paymentMethod === "shipping_confirmation" && !shippingPaymentFile) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "يرجى رفع صورة إثبات تحويل صالحة" });
    }
    if (shippingPaymentFile && !isValidShippingProofFile(shippingPaymentFile)) {
      await removeUploadedFile(shippingPaymentFile.path);
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "يرجى رفع صورة إثبات تحويل صالحة" });
    }
    const paymentStatus = paymentMethod === "cod" ? "cod" : "awaiting_verification";
    const orderStatus = paymentMethod === "cod" ? "pending" : "awaiting_verification";
    const codAmount = paymentMethod === "cod" ? total : Math.max(0, total - deliveryFee);
    const token = publicToken();
    const invoiceNumber = orderNumber();
    markCheckoutStep("create order", { table: "orders", invoiceNumber, total, orderTenantScoped: checkoutColumns.orders.has("tenant_id") });
    const order = await insertReturning(client, "orders", {
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      public_token: token,
      invoice_public_enabled: true,
      customer_id: customer?.id || null,
      customer_name: checkout.full_name,
      customer_phone: customer?.phone || normalizePhone(checkout.primary_phone),
      channel: "website",
      source: "website",
      customer_type: "online",
      status: orderStatus,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      shipping_payment_method: toText(checkout.shipping_payment_method || req.body?.shipping_payment_method || ""),
      subtotal,
      discount_amount: discount,
      delivery_fee: deliveryFee,
      shipping_fee: deliveryFee,
      service_fee: deliveryFee,
      total_amount: total,
      total_price: total,
      total,
      paid_amount: 0,
      cod_amount: codAmount,
      shipping_payment_screenshot: shippingPaymentFile ? `/uploads/payment-proofs/${shippingPaymentFile.filename}` : "",
      shipping_payment_reference: toText(checkout.shipping_payment_reference),
      customer_address: checkout.detailed_address,
      governorate: checkout.governorate,
      city_area: checkout.city_area,
      landmark: checkout.landmark || "",
      delivery_notes: checkout.delivery_notes || "",
      order_notes: checkout.order_notes || "",
      notes: checkout.order_notes || "",
      shipping_provider: checkout.shipping_provider || "manual",
      shipping_status: "pending",
    }, checkoutColumns.orders, { step: "create order" });
    markCheckoutStep("create order:done", { table: "orders", orderId: order?.id, invoiceNumber: order?.invoice_number });

    const lowStockProductIds = new Set();
    for (const item of normalizedItems) {
      markCheckoutStep("create order items", { table: "order_items", orderId: order.id, variantId: item.variant_id });
      await insertReturning(client, "order_items", {
        tenant_id: tenantId,
        order_id: order.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.product_name,
        variant_name: item.variant_name,
        sku: item.sku,
        barcode: item.barcode,
        quantity: item.quantity,
        sale_price: item.price,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: item.price * item.quantity,
        product_image: item.image_url,
        size: item.size,
        color: item.color,
      }, checkoutColumns.orderItems, { step: "create order items" });
      markCheckoutStep("create order items:done", { table: "order_items", orderId: order.id, variantId: item.variant_id });
      markCheckoutStep("decrement stock", { table: "product_variants", orderId: order.id, variantId: item.variant_id, quantity: item.quantity });
      await adjustVariantStock(client, {
        tenantId: checkoutColumns.variants.has("tenant_id") ? tenantId : null,
        variantId: item.variant_id,
        quantityChange: item.quantity * -1,
        movementType: "website_order",
        referenceType: "order",
        referenceId: order.id,
        reason: "Website order",
        notes: `Website order #${order.invoice_number}`,
      });
      lowStockProductIds.add(item.product_id);
      markCheckoutStep("create inventory movement:done", { table: "inventory_movements", orderId: order.id, variantId: item.variant_id });
      markCheckoutStep("decrement stock:done", { table: "product_variants", orderId: order.id, variantId: item.variant_id });
    }

    const lowStockEvents = [];
    for (const productId of lowStockProductIds) {
      const snapshot = await getProductLowStockSnapshot(client, { productId, tenantId });
      const totalStock = Number(snapshot?.total_stock || 0);
      if (totalStock >= 1 && totalStock <= LOW_STOCK_LIMIT) {
        lowStockEvents.push(snapshot);
      }
    }

    if (checkoutColumns.notifications.has("type") && checkoutColumns.notifications.has("title")) {
      markCheckoutStep("create payment/shipping records if used", { table: "website_notifications", orderId: order.id });
      await insertReturning(client, "website_notifications", {
        tenant_id: tenantId,
        customer_id: customer?.id || null,
        phone: customer?.phone || normalizePhone(checkout.primary_phone),
        type: "order_confirmed",
        title: "تم تأكيد طلبك",
        body: "طلبك دخل مرحلة التجهيز الآن",
        metadata: JSON.stringify({ order_id: order.id, invoice_number: order.invoice_number }),
      }, checkoutColumns.notifications, { step: "create payment/shipping records if used" });
      markCheckoutStep("create payment/shipping records if used:done", { table: "website_notifications", orderId: order.id });
    }
    await client.query("COMMIT");
    createSystemNotification("website_order_created", {
      tenant_id: tenantId,
      message: `طلب جديد ${order.invoice_number || order.id} من ${checkout.full_name}`,
      action_url: `/orders/${order.id}`,
      entity_type: "order",
      entity_id: order.id,
      metadata: { order_id: order.id, invoice_number: order.invoice_number, channel: "website" },
      customer_notification_ready: true,
    }).catch((error) => console.warn("[notifications] website order skipped", error?.message || error));
    if (shippingPaymentFile) {
      createSystemNotification("payment_proof_uploaded", {
        tenant_id: tenantId,
        message: `طلب ${order.invoice_number || order.id} يحتوي على صورة تحويل تحتاج مراجعة`,
        action_url: `/orders/${order.id}`,
        entity_type: "order",
        entity_id: order.id,
        metadata: { order_id: order.id, invoice_number: order.invoice_number, proof: order.shipping_payment_screenshot },
        customer_notification_ready: true,
      }).catch((error) => console.warn("[notifications] payment proof skipped", error?.message || error));
    }
    lowStockEvents.forEach((item) => {
      const stock = Number(item.total_stock || 0);
      const productName = item.product_name || "Product";
      createSystemNotification("low_stock", {
        tenant_id: tenantId,
        priority: stock === 1 ? "critical" : "high",
        title: "آخر قطع متاحة",
        message: lowStockMessage(productName, stock),
        action_url: `/inventory?productId=${encodeURIComponent(String(item.product_id || ""))}`,
        entity_type: "product",
        entity_id: item.product_id,
        metadata: { product_id: item.product_id, stock, image_url: item.image_url || "", badge: "عاجل", source: "website_order" },
      }).catch((error) => console.warn("[notifications] low stock skipped", error?.message || error));
    });
    res.status(201).json({ success: true, order, items: normalizedItems, track_token: token });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (req.file?.path) {
      await removeUploadedFile(req.file.path);
    }
    console.error("[storefront-order-confirm] error:", {
      step: error?.checkoutDbContext?.step || checkoutStep,
      table: error?.checkoutDbContext?.table || checkoutQueryContext.table || null,
      operation: error?.checkoutDbContext?.operation || null,
      query: error?.checkoutDbContext?.query || null,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      stack: error?.stack,
    });
    res.status(400).json({ success: false, message: "حصلت مشكلة أثناء تأكيد الطلب. جرب تاني أو كلمنا على واتساب." });
  } finally {
    client.release();
  }
};

const loadPublicOrder = async ({ tenantId, orderNumber: number, phone }) => {
  const result = await db.query(
    `
    SELECT *
    FROM orders
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND (invoice_number = $2 OR id::text = $2 OR public_token = $2)
      AND ($3 = '' OR customer_phone = $3)
    LIMIT 1
    `,
    [tenantId, toText(number), toText(phone)]
  );
  const order = result.rows[0];
  if (!order) return null;
  const items = await db.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`, [order.id]);
  return { order, items: items.rows };
};

export const trackOrder = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const orderNumberValue = req.query.order_number || req.body?.order_number || req.params.orderNumber;
    const phone = req.query.phone || req.body?.phone || "";
    const loaded = await loadPublicOrder({ tenantId, orderNumber: orderNumberValue, phone });
    if (!loaded) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true, ...loaded, timeline: buildOrderTimeline(loaded.order) });
  } catch (error) {
    console.error("[storefront] track", error);
    res.status(500).json({ success: false, message: "Failed to track order" });
  }
};

const buildOrderTimeline = (order = {}) => {
  const status = String(order.status || "").toLowerCase();
  const shipping = String(order.shipping_status || "").toLowerCase();
  return [
    { key: "received", label: "تم استلام الطلب", done: true },
    { key: "review", label: "جاري المراجعة", done: !["cancelled", "canceled"].includes(status) },
    { key: "packing", label: "جاري التجهيز", done: ["confirmed", "processing", "packed", "shipped", "delivered"].includes(status) || ["packed", "shipped", "delivered"].includes(shipping) },
    { key: "shipping", label: "خرج للشحن", done: ["shipped", "in_transit", "out_for_delivery", "delivered"].includes(shipping) || ["shipped", "delivered"].includes(status) },
    { key: "delivered", label: "تم التسليم", done: status === "delivered" || shipping === "delivered" },
  ];
};

export const accountByPhone = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    await ensureLoyaltySchema(db);
    const tenantId = tenantFromRequest(req);
    const phone = normalizePhone(toText(req.query.phone || req.params.phone));
    if (!phone) return res.status(400).json({ success: false, message: "Phone is required" });
    const phoneVariants = getPhoneSearchVariants(phone);
    const customer = await db.query(
      `
      SELECT *
      FROM customers
      WHERE tenant_id = $1
        AND ${phoneSqlDigits("phone")} = ANY($2::text[])
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [tenantId, phoneVariants]
    );
    const customerId = customer.rows[0]?.id || null;
    const orders = await db.query(
      `
      SELECT *
      FROM orders
      WHERE tenant_id = $1
        AND (
          ($3::bigint IS NOT NULL AND customer_id = $3::bigint)
          OR ${phoneSqlDigits("customer_phone")} = ANY($2::text[])
        )
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [tenantId, phoneVariants, customerId]
    );
    const wishlist = await db.query(
      `
      SELECT
        p.id,
        p.name,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS image_url,
        COALESCE(NULLIF(p.sale_price, 0), p.price, 0) AS price,
        cw.created_at
      FROM customer_wishlist cw
      JOIN products p ON p.id = cw.product_id
      WHERE cw.tenant_id = $1 AND cw.phone = $2
      ORDER BY cw.created_at DESC
      LIMIT 50
      `,
      [tenantId, phone]
    );
    const recent = await db.query(
      `
      SELECT DISTINCT ON (rv.product_id)
        p.id,
        p.name,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS image_url,
        COALESCE(NULLIF(p.sale_price, 0), p.price, 0) AS price,
        rv.viewed_at
      FROM recently_viewed_products rv
      JOIN products p ON p.id = rv.product_id
      WHERE rv.tenant_id = $1 AND rv.phone = $2
      ORDER BY rv.product_id, rv.viewed_at DESC
      LIMIT 20
      `,
      [tenantId, phone]
    );
    const loyalty = customerId ? await getCustomerLoyaltySummary(db, customerId, tenantId) : null;
    const addresses = [
      ...new Set(
        orders.rows
          .map((order) => [order.governorate, order.city_area, order.customer_address].filter(Boolean).join(" - "))
          .filter(Boolean)
      ),
    ].slice(0, 6);
    res.json({
      success: true,
      customer: customer.rows[0] || null,
      orders: orders.rows,
      loyalty,
      addresses,
      wishlist: wishlist.rows.map((row) => ({ product_id: row.id })),
      wishlist_products: wishlist.rows,
      recent_products: recent.rows.sort((a, b) => new Date(b.viewed_at || 0) - new Date(a.viewed_at || 0)),
    });
  } catch (error) {
    console.error("[storefront] account", error);
    res.status(500).json({ success: false, message: "Failed to load account" });
  }
};

export const saveWishlist = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const phone = toText(req.body.phone || "");
    const productId = Number(req.body.product_id);
    if (!phone || !productId) return res.status(400).json({ success: false, message: "Phone and product are required" });
    if (req.method === "DELETE" || req.body.remove) {
      await db.query(`DELETE FROM customer_wishlist WHERE tenant_id = $1 AND phone = $2 AND product_id = $3`, [tenantId, phone, productId]);
    } else {
      await db.query(`INSERT INTO customer_wishlist (tenant_id, phone, product_id) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, phone, product_id) DO NOTHING`, [tenantId, phone, productId]);
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update wishlist" });
  }
};

export const saveRecentlyViewed = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const sessionId = toText(req.body.session_id);
    const phone = toText(req.body.phone);
    const productId = Number(req.body.product_id);
    if (!productId) return res.status(400).json({ success: false, message: "Product is required" });
    await db.query(
      `DELETE FROM recently_viewed_products WHERE tenant_id = $1 AND product_id = $2 AND (($3 <> '' AND phone = $3) OR ($4 <> '' AND session_id = $4))`,
      [tenantId, productId, phone, sessionId]
    );
    await db.query(
      `INSERT INTO recently_viewed_products (tenant_id, session_id, phone, product_id) VALUES ($1,$2,$3,$4)`,
      [tenantId, sessionId, phone, productId]
    );
    await db.query(
      `
      DELETE FROM recently_viewed_products
      WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY tenant_id, COALESCE(NULLIF(phone, ''), session_id) ORDER BY viewed_at DESC) AS rn
          FROM recently_viewed_products
          WHERE tenant_id = $1 AND (($2 <> '' AND phone = $2) OR ($3 <> '' AND session_id = $3))
        ) ranked
        WHERE rn > 20
      )
      `,
      [tenantId, phone, sessionId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error("[storefront] recently viewed", error);
    res.status(500).json({ success: false, message: "Failed to save recently viewed" });
  }
};

export const listNotifications = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const phone = toText(req.query.phone);
    const result = await db.query(
      `SELECT * FROM website_notifications WHERE tenant_id = $1 AND ($2 = '' OR phone = $2) ORDER BY created_at DESC LIMIT 30`,
      [tenantId, phone]
    );
    res.json({ success: true, notifications: result.rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to load notifications" });
  }
};

export const listShippingProviders = async (_req, res) => {
  res.json({
    success: true,
    providers: Object.values(shippingProviders).map((provider) => ({
      key: provider.key,
      name: provider.name,
      configured: provider.isConfigured(),
    })),
  });
};

export const createShipment = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const orderResult = await db.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [req.params.orderId]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    const provider = getShippingProvider(req.body.provider || order.shipping_provider || "manual");
    const result = await provider.createShipment(order);
    if (result.success) {
      await db.query(
        `UPDATE orders SET shipping_provider = $1, shipping_status = $2, shipment_id = $3, tracking_number = $4, tracking_url = $5, last_shipping_sync_at = NOW() WHERE id = $6`,
        [result.provider, result.shipping_status, result.shipment_id, result.tracking_number, result.tracking_url, order.id]
      );
    }
    res.json(result);
  } catch {
    res.status(500).json({ success: false, message: "Failed to create shipment" });
  }
};

