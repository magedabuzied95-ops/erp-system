import db from "../database/db.js";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachGroupedColorImages,
  attachVariantImages,
  ensureProductVariantImagesSchema,
  loadProductVariantImages,
} from "../services/productVariantImagesService.js";
import { detectMarketingAttribution, logAttributionEvent } from "../services/marketingAttributionService.js";
import {
  generateProductOgImage,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  buildAbsolutePublicUrl,
} from "../services/productOgImageService.js";
import sharp from "sharp";
import { resolvePublicProductImageUrl } from "../services/aiProductCards.js";
import { formatCurrency } from "../../src/shared/lib/currency.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import { normalizeAttributionPlatform } from "../utils/marketingAttribution.js";
import { isMirrorProduct, mirrorProductTitle, slugifyEdition } from "../utils/mirrorProduct.js";
import {
  DEFAULT_TENANT_ID,
  queryProductsWithSql,
  storefrontProductsSql,
  storefrontQualityAliases,
} from "./storefrontController.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const SHARE_AVAILABLE_OG_VERSION = "V8";

const normalizeAudienceValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["men", "man", "male", "mens", "رجال", "رجالي"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies", "lady", "نساء", "نسائي", "حريمي"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "اطفال", "أطفال", "طفل"].includes(normalized)) return "kids";
  return "";
};

const normalizeProductAudiences = (...sources) => {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|]+/)
      .map(normalizeAudienceValue)
      .filter(Boolean)
      .forEach((audience) => seen.add(audience));
  };
  sources.forEach(visit);
  return ["men", "women", "kids"].filter((audience) => seen.has(audience));
};

const normalizeProductRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id || null,
  name: row.name || "",
  sku: row.sku || "",
  product_code: row.product_code || "",
  slug: row.slug || "",
  barcode: row.barcode || "",
  qr_token: row.qr_token || "",
  image_url: row.image_url || "",
  public_image_url: row.public_image_url || row.image_url || "",
  description: row.description || "",
  description_ar: row.description_ar || "",
  description_en: row.description_en || "",
  meta_title: row.meta_title || "",
  seo_description: row.seo_description || row.description_en || row.description_ar || row.description || "",
  seo_keywords: row.seo_keywords || "",
  canonical_slug: row.canonical_slug || "",
  updated_at: row.updated_at || null,
  created_at: row.created_at || null,
  price: Number(row.price || row.sale_price || 0),
  sale_price: Number(row.sale_price || row.price || 0),
  cost_price: Number(row.cost_price || 0),
  stock: Number(row.stock || 0),
  gender: row.gender || normalizeProductAudiences(row.audiences, row.product_audiences)[0] || "",
  audiences: normalizeProductAudiences(row.audiences, row.product_audiences, row.gender),
  product_audiences: normalizeProductAudiences(row.audiences, row.product_audiences, row.gender),
  product_type: row.product_type || "",
  style: row.style || "",
  grade: row.grade || "",
  purchase_alerts_enabled: row.purchase_alerts_enabled === true || String(row.purchase_alerts_enabled || "").toLowerCase() === "true",
  purchase_alert_by_color: row.purchase_alert_by_color === true || String(row.purchase_alert_by_color || "").toLowerCase() === "true",
  carton_size: row.carton_size === null || row.carton_size === undefined || row.carton_size === "" ? null : Number(row.carton_size),
  suggested_purchase_cartons:
    Number.isFinite(Number(row.suggested_purchase_cartons)) && Number(row.suggested_purchase_cartons) >= 1
      ? Math.floor(Number(row.suggested_purchase_cartons))
      : 1,
});

const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";
const variantHasStock = (variant = {}) => Number(variant?.stock || 0) > 0;
const variantColorKey = (variant = {}) => String(variant?.color || variant?.color_name || "").trim().toLowerCase();
const firstDisplayVariant = (variants = []) =>
  variants.find((variant) => variantHasStock(variant) && (variant?.primary_image_url || variant?.image_url)) ||
  variants.find((variant) => variantHasStock(variant)) ||
  variants.find((variant) => variant?.primary_image_url || variant?.image_url) ||
  variants[0] ||
  null;
const escapeHtml = (value = "") =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const slugifyProductName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
const decodeIdentifier = (value = "") => {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
};
const productIdentifierCandidates = (value = "") => {
  const raw = String(value || "").trim();
  const decoded = decodeIdentifier(raw).trim();
  const candidates = [raw, decoded];
  if (decoded.includes("-")) {
    candidates.push(decoded.replace(/\s*-\s*/g, "-").replace(/-+/g, "-").trim());
  }
  return [...new Set(candidates.filter(Boolean))];
};
const productLookupFields = ["slug", "canonical_slug", "id", "sku", "product_code", "barcode", "qr_token", "variant.sku", "variant.barcode", "variant.edition_slug"];
const productLookupFilters = [
  "LOWER(slug) = LOWER(identifier)",
  "LOWER(canonical_slug) = LOWER(identifier)",
  "id = numeric identifier",
  "LOWER(sku) = LOWER(identifier)",
  "LOWER(product_code) = LOWER(identifier)",
  "LOWER(barcode) = LOWER(identifier)",
  "LOWER(qr_token) = LOWER(identifier)",
  "variant sku/barcode/edition_slug",
];

const productSeoTitle = (product = {}) => firstText(product.meta_title, product.seo_title, product.name, "Product");
const productSeoDescription = (product = {}) => firstText(product.seo_description, product.description_en, product.description_ar, product.description, product.name);
const storefrontSaleModeOn = (product = {}, variant = {}) => {
  const source = variant && Object.keys(variant || {}).length ? variant : product;
  const flag = source?.sale_mode_enabled ?? source?.sale_price_enabled ?? source?.global_sale_enabled ?? source?.sale_prices_enabled;
  if (flag === true || flag === 1 || flag === "1") return true;
  if (typeof flag === "string" && ["true", "yes", "on", "sale", "active"].includes(flag.trim().toLowerCase())) return true;
  return Number(source?.sale_price || 0) > 0;
};
const resolveStorefrontPrice = (product = {}, variant = {}) => {
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const productOriginal =
    num(product?.custom_compare_price) ||
    num(product?.compare_base_price) ||
    num(product?.original_price) ||
    num(product?.base_price) ||
    num(product?.list_price) ||
    num(product?.regular_price) ||
    num(product?.compare_at_price);
  const variantOriginal =
    num(variant?.custom_compare_price) ||
    num(variant?.compare_base_price) ||
    num(variant?.original_price) ||
    num(variant?.base_price) ||
    num(variant?.list_price) ||
    num(variant?.regular_price) ||
    num(variant?.compare_at_price);
  const saleModeOn = storefrontSaleModeOn(product, variant);
  const salePrice = num(variant?.sale_price ?? product?.sale_price);
  const activePrice = saleModeOn && salePrice > 0
    ? salePrice
    : num(variant?.selling_price ?? variant?.price ?? product?.selling_price ?? product?.price ?? product?.regular_price);
  const originalPrice = productOriginal || variantOriginal;
  const comparePrice = originalPrice && originalPrice > activePrice ? originalPrice : 0;
  return { originalPrice, activePrice, comparePrice, saleModeOn };
};
const getSelectedPublicProductVariant = ({ product = {}, variants = [], query = {} } = {}) => {
  const normalizedVariant = String(query.variant || query.variantId || query.variant_id || "").trim();
  const normalizedColor = String(query.color || query.colorName || query.color_name || "").trim().toLowerCase();
  const normalizedColorId = String(query.colorId || query.color_id || "").trim();
  const normalizedSize = String(query.size || query.sizeLabel || "").trim();
  const requestedColorKey = normalizedColor || normalizedColorId.toLowerCase();
  const findById = (candidate) =>
    candidate &&
    variants.find((variant) => String(variant.id || variant.variant_id || "").trim() === candidate && variantHasStock(variant)) ||
    candidate &&
    variants.find((variant) => String(variant.id || variant.variant_id || "").trim() === candidate);
  const findByEditionSlug = (candidate) =>
    candidate &&
    variants.find((variant) => String(variant.edition_slug || "").trim() === candidate && variantHasStock(variant)) ||
    candidate &&
    variants.find((variant) => String(variant.edition_slug || "").trim() === candidate);
  const findByColorId = (candidate) =>
    candidate &&
    variants.find((variant) => String(variant.color_id || "").trim() === candidate && variantHasStock(variant)) ||
    candidate &&
    variants.find((variant) => String(variant.color_id || "").trim() === candidate);
  const findBySizeAndColor = (size, colorKey) =>
    size &&
    variants.find(
      (variant) =>
        String(variant.size || "").trim() === size &&
        (!colorKey || variantColorKey(variant) === colorKey) &&
        variantHasStock(variant)
    ) ||
    size &&
    variants.find(
      (variant) =>
        String(variant.size || "").trim() === size &&
        (!colorKey || variantColorKey(variant) === colorKey)
    );
  const findByColor = (colorKey) =>
    colorKey &&
    variants.find((variant) => variantColorKey(variant) === colorKey && variantHasStock(variant)) ||
    colorKey &&
    variants.find((variant) => variantColorKey(variant) === colorKey);

  return (
    findById(normalizedVariant) ||
    findByEditionSlug(normalizedVariant) ||
    findByColorId(normalizedColorId) ||
    findBySizeAndColor(normalizedSize, requestedColorKey) ||
    findByColor(requestedColorKey) ||
    findBySizeAndColor(normalizedSize, "") ||
    firstDisplayVariant(variants)
  );
};
const getShareAvailableSizes = ({ variants = [], query = {}, selectedVariant = null } = {}) => {
  const hasVariantSelection = Boolean(String(query.variant || query.variantId || query.variant_id || query.color || query.colorName || query.color_name || query.colorId || query.color_id || "").trim());
  const selectedKey = selectedVariant ? variantColorKey(selectedVariant) : "";
  const scopeVariants = hasVariantSelection && selectedKey
    ? variants.filter((variant) => variantColorKey(variant) === selectedKey)
    : variants;
  return [...new Set(
    scopeVariants
      .filter(variantHasStock)
      .map((variant) => String(variant.size || "").trim())
      .filter(Boolean)
  )];
};
const buildProductShareDescription = ({ product = {}, variants = [], query = {} } = {}) => {
  const selectedVariant = getSelectedPublicProductVariant({ product, variants, query });
  const selectedPrice = resolveStorefrontPrice(product, selectedVariant);
  const priceText = selectedPrice.activePrice > 0 ? formatCurrency(selectedPrice.activePrice, { language: "en" }) : "";
  const availableSizes = getShareAvailableSizes({ variants, query, selectedVariant });
  const lines = [];
  if (availableSizes.length) {
    lines.push(`Available sizes: ${availableSizes.join(", ")}`);
  }
  if (priceText) {
    lines.push(`Price: ${priceText}`);
  }
  return lines.join("\n");
};

const productPagePath = (product = {}) => `/shop/product/${String(product.slug || product.canonical_slug || product.id || "")}`;

const withSocialMetadata = async (product = {}, req = null) => {
  const ogImage = await generateProductOgImage({ product, req });
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
      url: buildAbsolutePublicUrl(req, `/share/product/${firstText(product.slug, product.canonical_slug, product.id)}`),
    },
  };
};

const ensurePublicProductEditionSchema = async () => {
  await db.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS slug TEXT DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS canonical_slug TEXT DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS product_code TEXT DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS qr_token TEXT`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS product_audiences (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      audience VARCHAR(30) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, audience),
      CHECK (audience IN ('men', 'women', 'kids'))
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_product_id ON product_audiences (product_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_audience ON product_audiences (audience, product_id)`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_name TEXT`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_slug TEXT`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS color_sort_order INTEGER NOT NULL DEFAULT 0`);
  await db.query(`
    UPDATE products
    SET canonical_slug = COALESCE(
      NULLIF(TRIM(canonical_slug), ''),
      NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(name, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''),
      'product-' || id
    )
    WHERE canonical_slug IS NULL OR TRIM(canonical_slug) = ''
  `);
  await db.query(`
    UPDATE products
    SET slug = COALESCE(
      NULLIF(TRIM(slug), ''),
      NULLIF(TRIM(canonical_slug), ''),
      NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(name, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''),
      'product-' || id
    )
    WHERE slug IS NULL OR TRIM(slug) = ''
  `);
};

const lookupAny = (fieldSql, identifierParam) => `EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE LOWER(TRIM(COALESCE(${fieldSql}, ''))) = LOWER(TRIM(lookup.value)))`;
const lookupFirst = (fieldSql, identifierParam) => `LOWER(TRIM(COALESCE(${fieldSql}, ''))) = LOWER(TRIM((${identifierParam}::text[])[1]))`;
const publicProductIdentifierClause = (identifierParam = "$1") => `
  (
    ${lookupAny("p.slug", identifierParam)}
    OR ${lookupAny("p.canonical_slug", identifierParam)}
    OR EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE TRIM(lookup.value) ~ '^[0-9]+$' AND TRIM(lookup.value)::bigint = p.id)
    OR ${lookupAny("p.sku", identifierParam)}
    OR ${lookupAny("p.product_code", identifierParam)}
    OR ${lookupAny("p.barcode", identifierParam)}
    OR ${lookupAny("p.qr_token", identifierParam)}
    OR EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE substring(TRIM(lookup.value) from '^SHOP-PROD-([0-9]+)') IS NOT NULL AND substring(TRIM(lookup.value) from '^SHOP-PROD-([0-9]+)')::bigint = p.id)
    OR EXISTS (
      SELECT 1
      FROM product_variants pv_lookup
      WHERE pv_lookup.product_id = p.id
        AND pv_lookup.is_active IS DISTINCT FROM FALSE
        AND pv_lookup.deleted_at IS NULL
        AND (
          ${lookupAny("pv_lookup.sku", identifierParam)}
          OR ${lookupAny("pv_lookup.barcode", identifierParam)}
          OR ${lookupAny("pv_lookup.edition_slug", identifierParam)}
        )
    )
  )
`;

const publicProductVisibilityClause = `
  COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
`;

const publicProductIdentifierOrder = (identifierParam = "$1") => `
  ORDER BY
    CASE
      WHEN ${lookupFirst("p.slug", identifierParam)} THEN 0
      WHEN ${lookupAny("p.slug", identifierParam)} THEN 1
      WHEN ${lookupFirst("p.canonical_slug", identifierParam)} THEN 2
      WHEN ${lookupAny("p.canonical_slug", identifierParam)} THEN 3
      WHEN EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE TRIM(lookup.value) ~ '^[0-9]+$' AND TRIM(lookup.value)::bigint = p.id) THEN 4
      WHEN ${lookupAny("p.sku", identifierParam)} THEN 5
      WHEN ${lookupAny("p.product_code", identifierParam)} THEN 6
      WHEN ${lookupAny("p.barcode", identifierParam)} THEN 7
      WHEN ${lookupAny("p.qr_token", identifierParam)} THEN 8
      ELSE 9
    END,
    p.id ASC
`;

const loadPublicProductRow = async (identifier) => {
  const identifiers = productIdentifierCandidates(identifier);
  console.log("[public-products] product lookup", { identifier, identifiers, filters: productLookupFilters });
  const result = await db.query(
    `
    SELECT
      p.*,
      COALESCE((SELECT jsonb_agg(pa.audience ORDER BY pa.audience) FROM product_audiences pa WHERE pa.product_id = p.id), '[]'::jsonb) AS audiences,
      COALESCE(NULLIF(p.image_url, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS public_image_url
    FROM products p
    WHERE ${publicProductVisibilityClause}
      AND ${publicProductIdentifierClause("$1")}
    ${publicProductIdentifierOrder("$1")}
    LIMIT 1
    `,
    [identifiers]
  );
  if (result.rows[0]) {
    console.log("[public-products] product matched", { identifier, matched_product_id: result.rows[0].id });
  }
  return result.rows[0] || null;
};

const logPublicProductNotFound = (req, identifier) => {
  console.warn("[public-products] product not found", {
    identifier,
    identifiers: productIdentifierCandidates(identifier),
    tenant_id: req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || null,
    checked_fields: productLookupFields,
    filters: productLookupFilters,
  });
};

const deriveColorGroupsFromVariants = (variants = []) => {
  const seen = new Map();
  const orderedVariants = [...(Array.isArray(variants) ? variants : [])].sort((left, right) =>
    Number(left?.color_sort_order ?? left?.colorSortOrder ?? 0) - Number(right?.color_sort_order ?? right?.colorSortOrder ?? 0) ||
    Number(left?.id ?? left?.variant_id ?? 0) - Number(right?.id ?? right?.variant_id ?? 0)
  );
  for (const variant of orderedVariants) {
    const color = String(variant?.color || variant?.color_name || "").trim();
    const key = color.toLowerCase() || "default";
    if (!seen.has(key)) {
      seen.set(key, {
        color,
        color_name: color,
        color_value: color,
        color_sort_order: Math.max(0, Number(variant?.color_sort_order ?? variant?.colorSortOrder ?? 0) || 0),
        image_url: variant?.image_url || "",
      });
    }
  }
  return Array.from(seen.values());
};

let storefrontShellPromise = null;
const DEFAULT_PUBLIC_APP_URL = "https://m1store-egy.com";
const resolveStorefrontShellCandidates = () => {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "dist", "index.html"),
    path.resolve(cwd, "index.html"),
    path.resolve(currentDir, "..", "..", "dist", "index.html"),
    path.resolve(currentDir, "..", "..", "index.html"),
    path.resolve(currentDir, "..", "..", "..", "dist", "index.html"),
  ];
};

const getRequestHost = (req) => {
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "").trim();
  const host = String(req?.headers?.host || "").trim();
  return forwardedHost || host || "";
};

const isVercelHost = (value = "") => String(value || "").toLowerCase().includes("vercel.app");
const isRenderHost = (value = "") => String(value || "").toLowerCase().includes("onrender.com");

const resolveStorefrontFallbackUrl = (req) => {
  const baseUrl = getPublicAppUrl() || DEFAULT_PUBLIC_APP_URL;
  const pathname = req?.originalUrl || req?.url || `/shop/product/${req?.params?.identifier || ""}`;
  return new URL(pathname, baseUrl).toString();
};

const renderStorefrontShellMissingHtml = ({ req, title = "Product", message = "This product page is temporarily unavailable." } = {}) => {
  const productPath = String(req?.originalUrl || req?.url || `/shop/product/${req?.params?.identifier || ""}` || "");
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safePath = escapeHtml(productPath);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${safeTitle}</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      .wrap {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: min(100%, 560px);
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        background: white;
        padding: 24px;
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
      }
      h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
      p { margin: 0 0 12px; color: #475569; line-height: 1.6; }
      code { display: block; padding: 12px 14px; border-radius: 12px; background: #f1f5f9; color: #0f172a; overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${safeTitle}</h1>
        <p>${safeMessage}</p>
        <p>Requested path:</p>
        <code>${safePath}</code>
      </div>
    </div>
  </body>
</html>`;
};

const normalizeImageUrlCandidate = (value = "") => {
  const raw = value && typeof value === "object"
    ? String(
        value.image_url ||
        value.imageUrl ||
        value.url ||
        value.path ||
        value.preview ||
        value.src ||
        value.image ||
        value.photo_url ||
        value.thumbnail_url ||
        value.main_image ||
        value.mainImage ||
        ""
      ).trim()
    : String(value || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  const resolved = resolvePublicProductImageUrl(raw, {
    baseUrl: process.env.STORE_FRONT_URL || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "",
  });
  return String(resolved || "").replace(/^http:\/\//i, "https://").trim();
};

const firstPublicImageCandidate = (...values) => {
  for (const value of values.flat(Infinity)) {
    const resolved = normalizeImageUrlCandidate(value);
    if (resolved) return resolved;
  }
  return "";
};

const loadStorefrontShell = async () => {
  if (!storefrontShellPromise) {
    storefrontShellPromise = (async () => {
      const candidates = resolveStorefrontShellCandidates();
      console.info("[public-products] storefront shell resolution", {
        cwd: process.cwd(),
        dirname: currentDir,
        candidates,
      });
      for (const candidate of candidates) {
        try {
          await access(candidate, fsConstants.R_OK);
          console.info("[public-products] storefront shell candidate ok", { candidate });
          return await readFile(candidate, "utf8");
        } catch (error) {
          console.warn("[public-products] storefront shell candidate failed", {
            candidate,
            code: error?.code || "",
            message: error?.message || "",
          });
          // Try the next candidate.
        }
      }
      console.warn("[public-products] storefront shell missing", {
        candidates,
        public_app_url: getPublicAppUrl() || DEFAULT_PUBLIC_APP_URL,
      });
      return null;
    })();
  }
  return storefrontShellPromise;
};

const getSelectedPublicProductImage = ({ product = {}, variants = [], colorImages = [], query = {} } = {}) => {
  const normalizedVariant = String(query.variant || query.variantId || query.variant_id || "").trim();
  const normalizedColor = String(query.color || query.colorName || query.color_name || "").trim().toLowerCase();
  const normalizedSize = String(query.size || query.sizeLabel || "").trim().toLowerCase();
  const selectedVariant =
    (normalizedVariant && variants.find((variant) => String(variant.id || variant.variant_id || "").trim() === normalizedVariant)) ||
    (normalizedColor && variants.find((variant) => String(variant.color || variant.color_name || "").trim().toLowerCase() === normalizedColor)) ||
    (normalizedSize && variants.find((variant) => String(variant.size || "").trim().toLowerCase() === normalizedSize)) ||
    variants.find((variant) => variant.primary_image_url || variant.image_url) ||
    null;

  const firstColorImage = (Array.isArray(colorImages) ? colorImages : []).find((color) => normalizeImageUrlCandidate(color?.primary_image_url || color?.image_url));
  const imageCandidates = [
    selectedVariant?.primary_image_url,
    selectedVariant?.image_url,
    selectedVariant?.color_image_url,
    selectedVariant?.images?.[0]?.image_url,
    selectedVariant?.images?.[0]?.url,
    firstColorImage?.primary_image_url,
    firstColorImage?.image_url,
    product.main_image,
    product.main_image_url,
    product.public_image_url,
    product.image_url,
    product.image,
    product.photo_url,
    product.thumbnail_url,
    Array.isArray(product.images) ? product.images[0] : "",
    Array.isArray(product.gallery_images) ? product.gallery_images[0] : "",
    Array.isArray(product.color_images) ? product.color_images[0]?.image_url || product.color_images[0]?.url || "" : "",
  ];
  return firstPublicImageCandidate(imageCandidates);
};

const renderProductShareHtml = async ({ req, product, imageUrl, description }) => {
  const title = escapeHtml(firstText(product.meta_title, product.seo_title, product.name, "Product"));
  const descriptionText = escapeHtml(description || firstText(product.seo_description, product.description_en, product.description_ar, product.description, product.name));
  const absoluteUrl = escapeHtml(buildAbsolutePublicUrl(req, req.originalUrl || req.url || `/shop/product/${product.slug || product.canonical_slug || product.id || ""}`));
  const absoluteImage = escapeHtml((imageUrl || "").replace(/^http:\/\//i, "https://"));
  const productPath = escapeHtml(req.originalUrl || req.url || `/shop/product/${product.slug || product.canonical_slug || product.id || ""}`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${descriptionText}" />
    <meta property="og:image" content="${absoluteImage}" />
    <meta property="og:image:secure_url" content="${absoluteImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="M1 Store" />
    <meta property="og:url" content="${absoluteUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${absoluteImage}" />
    <title>${title}</title>
    <meta http-equiv="refresh" content="1;url=${absoluteUrl}" />
  </head>
  <body style="margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b0f19;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;">
    <main style="max-width:720px;padding:24px;text-align:center;line-height:1.6;">
      <p style="margin:0 0 16px;font-size:18px;">Opening product page...</p>
      <p style="margin:0 0 20px;opacity:.8;">${descriptionText}</p>
      <a href="${productPath}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#fff;color:#0b0f19;text-decoration:none;font-weight:700;">Open product</a>
    </main>
    <script>setTimeout(function(){window.location.href=${JSON.stringify(String(absoluteUrl))};}, 1000);</script>
  </body>
</html>`;
};

const parseShareParamList = (value = "") =>
  Array.isArray(value)
    ? value.flatMap((item) => parseShareParamList(item))
    : String(value || "")
        .split(",")
        .map((item) => String(item || "").trim())
        .filter(Boolean);

const normalizeShareFilterValue = (value = "") => String(value || "").trim();

const normalizeSharePriceValue = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeShareFlag = (value = "") =>
  ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());

const normalizeShareAvailableFilters = (query = {}) => {
  const sizes = [...new Set(
    parseShareParamList(query.size || query.sizes).map((item) => String(item).trim()).filter(Boolean)
  )].sort((a, b) => {
    const left = Number(a);
    const right = Number(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    return a.localeCompare(b, "ar");
  });
  return {
    sizes,
    gender: normalizeShareFilterValue(query.gender || query.audience || query.target_audience),
    type: normalizeShareFilterValue(query.type || query.product_type || query.productType),
    offerStory: normalizeShareFlag(query.offer_story || query.offerStory),
    brand: normalizeShareFilterValue(query.brand || query.brandId || query.brand_id),
    minPrice: normalizeSharePriceValue(query.minPrice || query.min_price),
    maxPrice: normalizeSharePriceValue(query.maxPrice || query.max_price),
    inStock: String(query.inStock || query.in_stock || query.stock || "1").trim() !== "0",
    quality: normalizeShareFilterValue(query.quality || ""),
    q: normalizeShareFilterValue(query.q || ""),
  };
};

export const buildShareAvailableTargetUrl = (req, filters = {}) => {
  const params = new URLSearchParams();
  parseShareParamList(filters.sizes).forEach((size) => params.append("size", size));
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.type) params.set("type", filters.type);
  if (filters.offerStory) params.set("offer_story", "1");
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.minPrice !== null && filters.minPrice !== undefined && filters.minPrice !== "") params.set("min_price", String(filters.minPrice));
  if (filters.maxPrice !== null && filters.maxPrice !== undefined && filters.maxPrice !== "") params.set("max_price", String(filters.maxPrice));
  if (filters.q) params.set("q", filters.q);
  if (filters.quality) params.set("quality", filters.quality);
  params.set("inStock", filters.inStock === false ? "0" : "1");
  // The deployed storefront treats /offers as the canonical offers catalog.
  // Keep offer_story in the query as well so both current and older clients
  // preserve the scope while applying the remaining filters (size, stock, ...).
  const catalogPath = filters.offerStory ? "/offers" : "/shop/products";
  const pathname = `${catalogPath}${params.toString() ? `?${params.toString()}` : ""}`;
  const publicBaseUrl = getPublicAppUrl() || DEFAULT_PUBLIC_APP_URL;
  const targetUrl = publicBaseUrl ? new URL(pathname, publicBaseUrl).toString() : pathname;
  return targetUrl;
};

const buildShareAvailableFallbackImageUrl = (req) => buildAbsolutePublicUrl(req, "/favicon.svg");

export const resolveShareAvailablePreviewImage = (products = []) =>
  firstPublicImageCandidate(
    products[0]?.public_image_url,
    products[0]?.image_url
  );

export const buildShareAvailableOgImageUrl = (req, filters = {}, format = "png") => {
  const params = new URLSearchParams();
  parseShareParamList(filters.sizes).forEach((size) => params.append("size", size));
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.type) params.set("type", filters.type);
  if (filters.offerStory) params.set("offer_story", "1");
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.minPrice !== null && filters.minPrice !== undefined && filters.minPrice !== "") params.set("min_price", String(filters.minPrice));
  if (filters.maxPrice !== null && filters.maxPrice !== undefined && filters.maxPrice !== "") params.set("max_price", String(filters.maxPrice));
  if (filters.q) params.set("q", filters.q);
  if (filters.quality) params.set("quality", filters.quality);
  // Version the generated asset so social crawlers do not reuse an older broken preview.
  params.set("v", SHARE_AVAILABLE_OG_VERSION.toLowerCase());
  params.set("inStock", filters.inStock === false ? "0" : "1");
  const suffix = format === "png" ? "/share/available/og-image.png" : "/share/available/og-image";
  const publicBaseUrl = getPublicAppUrl() || DEFAULT_PUBLIC_APP_URL;
  return new URL(`${suffix}${params.toString() ? `?${params.toString()}` : ""}`, publicBaseUrl).toString();
};

const fetchImageDataUrl = async (imageUrl = "") => {
  const url = normalizeImageUrlCandidate(imageUrl);
  if (!url) return "";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return "";
    const contentType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return "";
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn("[share-available-image-embed]", { imageUrl: url, message: error?.message });
    return "";
  }
};

const buildShareAvailablePreviewPngBuffer = async ({ req = null, filters = {}, products = [], count = 0 } = {}) => {
  const firstImageProduct = products.find((product) => normalizeImageUrlCandidate(product.public_image_url || product.image_url || "")) || null;
  const remoteImageUrl = normalizeImageUrlCandidate(firstImageProduct?.public_image_url || firstImageProduct?.image_url || "");
  const embeddedImageUrl = await fetchImageDataUrl(remoteImageUrl);
  const svg = buildShareAvailablePreviewSvg({ req, filters, products, count, embeddedImageUrl });
  console.log("[share-available-svg-debug]", {
    svgRectCount: (svg.match(/<rect/g) || []).length,
    svgImageCount: (svg.match(/<image/g) || []).length,
    svgTextCount: (svg.match(/<text/g) || []).length,
    svgFirst500: svg.slice(0, 500),
  });
  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
};

const buildShareAvailableWhereClause = ({ includeSizes = true } = {}) => `
  WHERE ${publicProductVisibilityClause}
    AND (
      COALESCE(array_length($1::text[], 1), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM product_audiences pa_filter
        WHERE pa_filter.product_id = p.id
          AND pa_filter.audience = ANY($1::text[])
      )
      OR (
        NOT EXISTS (SELECT 1 FROM product_audiences pa_any WHERE pa_any.product_id = p.id)
        AND LOWER(TRIM(COALESCE(p.gender, ''))) = ANY($1::text[])
      )
    )
    AND (
      $2 = ''
      OR LOWER(TRIM(COALESCE(p.product_type, ''))) = LOWER(TRIM($2))
    )
    AND (
      $3 = ''
      OR LOWER(TRIM(COALESCE(b.slug, ''))) = LOWER(TRIM($3))
      OR LOWER(TRIM(COALESCE(b.name, ''))) = LOWER(TRIM($3))
      OR LOWER(TRIM(COALESCE(p.brand, ''))) = LOWER(TRIM($3))
      OR TRIM(COALESCE(p.brand_id::text, '')) = TRIM($3)
    )
    AND ($4::numeric IS NULL OR COALESCE(NULLIF(p.sale_price, 0), NULLIF(p.selling_price, 0), NULLIF(p.price, 0), 0) >= $4::numeric)
    AND ($5::numeric IS NULL OR COALESCE(NULLIF(p.sale_price, 0), NULLIF(p.selling_price, 0), NULLIF(p.price, 0), 0) <= $5::numeric)
    AND (
      $6::boolean = FALSE
      OR COALESCE(p.stock, 0) > 0
      OR EXISTS (
        SELECT 1
        FROM product_variants pv_stock
        WHERE pv_stock.product_id = p.id
          AND pv_stock.is_active IS DISTINCT FROM FALSE
          AND pv_stock.deleted_at IS NULL
        AND COALESCE(pv_stock.stock, 0) > 0
      )
    )
    ${includeSizes
      ? `
    AND (
      COALESCE(array_length($7::text[], 1), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM product_variants pv_size
        WHERE pv_size.product_id = p.id
          AND pv_size.is_active IS DISTINCT FROM FALSE
          AND pv_size.deleted_at IS NULL
          AND LOWER(TRIM(COALESCE(pv_size.size, ''))) = ANY($7::text[])
          AND ($6::boolean = FALSE OR COALESCE(pv_size.stock, 0) > 0)
      )
    )
    `
      : ""}
`;

const shareTenantFromRequest = (req = {}) => {
  const tenantId = Number(req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : DEFAULT_TENANT_ID;
};

export const buildShareAvailableStorefrontFilters = ({ filters = {}, normalizedSizes = [] } = {}) => ({
  brand: normalizeShareFilterValue(filters.brand || ""),
  gender: normalizeAudienceValue(filters.gender || "") || normalizeShareFilterValue(filters.gender || ""),
  productType: normalizeShareFilterValue(filters.type || ""),
  grade: "",
  // The link preview counts/pictures the SAME products the shopper will land on,
  // so the grade the picker chose has to reach this query as well.
  quality: storefrontQualityAliases(filters.quality || ""),
  size: normalizedSizes.length === 1 ? String(normalizedSizes[0] || "").trim() : "",
  inStock: Boolean(filters.inStock),
  offerStory: Boolean(filters.offerStory),
});

const loadShareAvailableProducts = async (req = {}, filters = {}) => {
  const normalizedSizes = parseShareParamList(filters.sizes).map((item) => String(item).trim()).filter(Boolean);
  const minPrice = normalizeSharePriceValue(filters.minPrice);
  const maxPrice = normalizeSharePriceValue(filters.maxPrice);
  const tenantId = shareTenantFromRequest(req);
  const branchId = normalizeShareFilterValue(filters.branchId || filters.branch_id || "");
  const language = normalizeShareFilterValue(filters.language || filters.lang || filters.locale || "");
  const storefrontFilters = buildShareAvailableStorefrontFilters({ filters, normalizedSizes });
  console.log("[share-available-query-debug]", {
    requestUrl: req.originalUrl || req.url || "",
    filters,
    tenantId,
    branchId,
    language,
    storefrontFilters,
    normalizedSizes,
    inStock: storefrontFilters.inStock,
    size: storefrontFilters.size,
    generatedSql: storefrontProductsSql,
    source: "storefrontController.queryProductsWithSql",
  });
  const rowsResult = await queryProductsWithSql(
    storefrontProductsSql,
    tenantId,
    "",
    "",
    storefrontFilters,
    false,
    1000,
    0
  );
  console.log("[share-available-query-helper]", {
    rowCount: rowsResult.rowCount,
    firstIds: rowsResult.rows.slice(0, 5).map((row) => row.id),
  });
  const rawProducts = rowsResult.rows.map((row) => ({
    ...row,
    image_url: firstPublicImageCandidate(row.image_url, row.photo_url, row.thumbnail_url),
    public_image_url: firstPublicImageCandidate(row.image_url, row.photo_url, row.thumbnail_url),
    audiences: Array.isArray(row.audiences) ? row.audiences : [],
    variants: Array.isArray(row.variants) ? row.variants : [],
  }));
  const priceFilteredProducts = rawProducts.filter((product) => {
    const price = Number(product.sale_price || product.selling_price || product.price || product.regular_price || product.compare_at_price || 0) || 0;
    if (minPrice !== null && price < minPrice) {
      return false;
    }
    if (maxPrice !== null && price > maxPrice) {
      return false;
    }
    return true;
  });
  const countBefore = priceFilteredProducts.length;
  const sizeFilteredProducts = normalizedSizes.length
    ? priceFilteredProducts.filter((product) => {
        const productSizes = new Set(
          (Array.isArray(product.variants) ? product.variants : [])
            .map((variant) => String(variant?.size || "").trim())
            .filter(Boolean)
            .map((size) => size.toLowerCase())
        );
        return normalizedSizes.some((size) => productSizes.has(String(size).trim().toLowerCase()));
      })
    : priceFilteredProducts;
  const countAfter = sizeFilteredProducts.length;
  console.log("[share-available-query-result]", {
    countBefore,
    countAfter,
    firstFiveProducts: sizeFilteredProducts.slice(0, 5).map((product) => ({
      id: product.id,
      name: product.name,
      public_image_url: product.public_image_url || "",
      image_url: product.image_url || "",
      sizes: Array.isArray(product.variants) ? product.variants.map((variant) => variant?.size).filter(Boolean) : [],
    })),
  });
  return {
    countBefore,
    countAfter,
    count: countAfter,
    products: sizeFilteredProducts,
  };
};

export const buildShareAvailablePreviewSvg = ({ req = null, filters = {}, products = [], count = 0, embeddedImageUrl = "" } = {}) => {
  const imageGeneratorVersion = SHARE_AVAILABLE_OG_VERSION;
  const firstImageProduct = products.find((product) => normalizeImageUrlCandidate(product.public_image_url || product.image_url || "")) || null;
  const primaryImage = normalizeImageUrlCandidate(firstImageProduct?.public_image_url || firstImageProduct?.image_url || "");
  // Sharp/librsvg does not reliably fetch remote URLs while rasterising SVG.
  // Only render an image after it has been fetched and embedded as a data URL.
  const selectedImage = embeddedImageUrl || "";
  const routeBranch = embeddedImageUrl ? "embedded-product" : primaryImage ? "product-image-unavailable" : "empty";
  const selectedTitle = firstText(firstImageProduct?.name, "M1 Store");
  const imageTag = selectedImage
    ? `<image href="${escapeHtml(selectedImage)}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid meet" />`
    : "";
  console.log("[share-available-og-image]", {
    routeHandler: "getPublicAvailableOgImage",
    sourceFile: "server/controllers/publicProductsController.js",
    imageGeneratorVersion,
    routeBranch,
    selectedTitle,
    primaryImage,
    selectedImage,
    firstImageProductId: firstImageProduct?.id || null,
    firstImageProductName: firstImageProduct?.name || "",
    imageTagPreview: imageTag.slice(0, 300),
    requestedUrl: req?.originalUrl || req?.url || "",
  });
  if (!primaryImage) {
    console.log("[share-available-og-image-no-primary-image]", {
      firstProducts: products.slice(0, 5).map((product) => ({
        id: product.id,
        name: product.name,
        public_image_url: product.public_image_url || "",
        image_url: product.image_url || "",
      })),
    });
  } else {
    console.log("[share-available-og-image-primary-image]", {
      primaryImage,
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg" direction="rtl" xml:lang="ar">
  <defs>
    <linearGradient id="emptyGradient" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#111827" />
      <stop offset="100%" stop-color="#080d18" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="${selectedImage ? "#ffffff" : "url(#emptyGradient)"}" />
  ${selectedImage
    ? `
      ${imageTag}
    `
    : `
      <path d="M520 250h160v130H520z" fill="#ffffff" fill-opacity="0.08" />
    `}
</svg>`;
};

const buildShareAvailableFallbackSvg = (options = {}) => buildShareAvailablePreviewSvg(options);

export const renderShareAvailableHtml = ({ req, filters = {}, count = 0, ogImageUrl = "", targetUrl = "", products = [] } = {}) => {
  const firstProduct = products[0] || null;
  const title = escapeHtml(firstText(firstProduct?.name, "M1 Store"));
  const description = escapeHtml(count > 0
    ? `${count} منتج متاح حاليًا من M1 Store`
    : "تسوق المنتجات المتاحة الآن من M1 Store");
  const publicBaseUrl = getPublicAppUrl() || DEFAULT_PUBLIC_APP_URL;
  const absoluteUrl = escapeHtml(new URL(req.originalUrl || req.url || "/share/available", publicBaseUrl).toString());
  const absoluteImage = escapeHtml(ogImageUrl || buildShareAvailableOgImageUrl(req, filters, "png"));
  const imageType = /\.png(?:[?#]|$)/i.test(absoluteImage) ? "image/png" : "image/jpeg";
  const fallbackTarget = escapeHtml(targetUrl || buildShareAvailableTargetUrl(req, filters));
  return `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${title}</title>
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="M1 Store" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${absoluteImage}" />
    <meta property="og:image:secure_url" content="${absoluteImage}" />
    <meta property="og:image:type" content="${imageType}" />
    <meta property="og:url" content="${absoluteUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${absoluteImage}" />
    <link rel="canonical" href="${fallbackTarget}" />
    <script>window.location.replace(${JSON.stringify(String(targetUrl || fallbackTarget))});</script>
    <style>
      html, body { margin: 0; min-height: 100%; background: #050505; color-scheme: dark; }
    </style>
  </head>
  <body>
    <noscript><a href="${fallbackTarget}">Open products</a></noscript>
  </body>
</html>`;
};

export const getPublicAvailableSharePage = async (req, res) => {
  try {
    await ensurePublicProductEditionSchema();
    await ensureProductVariantImagesSchema();
    const filters = normalizeShareAvailableFilters(req.query || {});
    const { count, products } = await loadShareAvailableProducts(req, filters);
    const targetUrl = buildShareAvailableTargetUrl(req, filters);
    const ogImageUrl = resolveShareAvailablePreviewImage(products) || buildShareAvailableOgImageUrl(req, filters, "png");
    console.log("shareAvailableTargetUrl", targetUrl);
    console.log("[share-available]", {
      query: req.query,
      matchedProductsCount: count,
      ogImageUrl,
      finalTargetUrl: targetUrl,
    });
    const html = renderShareAvailableHtml({ req, filters, count, ogImageUrl, targetUrl, products });
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    console.error("[share-available]", {
      query: req.query,
      error: error?.message,
      stack: error?.stack,
    });
    const filters = normalizeShareAvailableFilters(req.query || {});
    const targetUrl = buildShareAvailableTargetUrl(req, filters);
    const html = renderShareAvailableHtml({
      req,
      filters,
      count: 0,
      ogImageUrl: buildShareAvailableOgImageUrl(req, filters, "png"),
      targetUrl,
      products: [],
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  }
};

export const getPublicAvailableOgImage = async (req, res) => {
  res.setHeader("X-OG-Image-Version", SHARE_AVAILABLE_OG_VERSION);
  res.setHeader("X-Route-Handler", "getPublicAvailableOgImage");
  res.setHeader("X-Source-File", "server/controllers/publicProductsController.js");
  console.log("ogImageHandlerReached", {
    imageGeneratorVersion: SHARE_AVAILABLE_OG_VERSION,
    routeHandler: "getPublicAvailableOgImage",
    sourceFile: "server/controllers/publicProductsController.js",
    routeBranch: "unknown",
    matchedProductsCount: null,
    selectedImage: "",
    selectedTitle: "",
    requestedUrl: req?.originalUrl || req?.url || "",
  });
  try {
    await ensurePublicProductEditionSchema();
    await ensureProductVariantImagesSchema();
    const filters = normalizeShareAvailableFilters(req.query || {});
    const { count, products } = await loadShareAvailableProducts(req, filters);
    const ogProductsCount = Number(count || 0) > 0 ? Number(count || 0) : products.length;
    const ogImageUrls = products
      .map((product) => normalizeImageUrlCandidate(product.public_image_url || product.image_url || ""))
      .filter(Boolean);
    const ogTitle = filters.sizes?.length > 1
      ? `المنتجات المتاحة للمقاسات ${filters.sizes.join("، ")}`
      : `المنتجات المتاحة للمقاس ${filters.sizes?.[0] || ""}`.trim();
    const ogDescription = `${ogProductsCount} منتج متاح حاليًا من M1 Store`;
    const ogImageUrl = buildShareAvailableOgImageUrl(req, filters, "png");
    const routeBranch = ogImageUrls[0] ? "single-product" : (buildShareAvailableFallbackImageUrl(req) ? "fallback" : "empty");
    const selectedImage = ogImageUrls[0] || buildShareAvailableFallbackImageUrl(req) || "";
    const selectedTitle = ogTitle;
    console.log("ogImageHandlerReached", {
      imageGeneratorVersion: SHARE_AVAILABLE_OG_VERSION,
      routeHandler: "getPublicAvailableOgImage",
      sourceFile: "server/controllers/publicProductsController.js",
      routeBranch,
      matchedProductsCount: count,
      ogProductsCount,
      selectedImage,
      selectedTitle,
      requestedUrl: req?.originalUrl || req?.url || "",
    });
    if (selectedImage) {
      try {
        const response = await fetch(selectedImage, { method: "GET" });
        const contentType = response.headers.get("content-type") || "";
        const contentLength = response.headers.get("content-length") || "";
        console.log("[share-available-image-fetch]", {
          imageFetchStatus: response.status,
          imageContentType: contentType,
          imageContentLength: contentLength,
          selectedImage,
        });
      } catch (error) {
        console.error("[share-available-image-fetch:error]", {
          selectedImage,
          message: error?.message,
          stack: error?.stack,
        });
      }
    } else {
      console.log("[share-available-image-missing]", {
        selectedImage: "",
        selectedTitle,
        routeBranch,
        firstProducts: products.slice(0, 5).map((product) => ({
          id: product.id,
          name: product.name,
          public_image_url: product.public_image_url || "",
          image_url: product.image_url || "",
        })),
      });
    }
    const png = await buildShareAvailablePreviewPngBuffer({ req, filters, products, count: ogProductsCount });
    console.log("shareAvailableTargetUrl", buildShareAvailableTargetUrl(req, filters));
    console.log("[share-available]", {
      query: req.query,
      matchedProductsCount: count,
      ogProductsCount,
      ogImageUrls,
      ogTitle,
      ogDescription,
      ogImageUrl,
      imageGeneratorVersion: SHARE_AVAILABLE_OG_VERSION,
      routeHandler: "getPublicAvailableOgImage",
      sourceFile: "server/controllers/publicProductsController.js",
      routeBranch,
      selectedTitle,
      selectedImage,
      finalTargetUrl: buildShareAvailableTargetUrl(req, filters),
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(png);
  } catch (error) {
    console.error("[share-available]", {
      query: req.query,
      error: error?.message,
      stack: error?.stack,
    });
    const filters = normalizeShareAvailableFilters(req.query || {});
    const targetUrl = buildShareAvailableTargetUrl(req, filters);
    const ogProductsCount = 0;
    const svg = buildShareAvailableFallbackSvg({
      req,
      title: filters.sizes?.length ? `المنتجات المتاحة للمقاس ${filters.sizes.join("، ")}` : "المنتجات المتاحة",
      description: "كل المنتجات المتاحة حاليًا من M1 Store",
      targetUrl,
    });
    const png = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(png);
  }
};

export const getPublicAvailableOgImagePng = getPublicAvailableOgImage;

export const getPublicAvailableOgDebugSvg = async (req, res) => {
  try {
    await ensurePublicProductEditionSchema();
    await ensureProductVariantImagesSchema();
    const filters = normalizeShareAvailableFilters(req.query || {});
    const { count, countBefore, countAfter, products } = await loadShareAvailableProducts(req, filters);
    const svg = buildShareAvailablePreviewSvg({ req, filters, products, count });
    const firstImageProduct = products.find((product) => normalizeImageUrlCandidate(product.public_image_url || product.image_url || "")) || null;
    const primaryImage = normalizeImageUrlCandidate(firstImageProduct?.public_image_url || firstImageProduct?.image_url || "");
    const svgImageCount = typeof svg === "string" ? (svg.match(/<image/g) || []).length : 0;
    const svgRectCount = typeof svg === "string" ? (svg.match(/<rect/g) || []).length : 0;
    const svgTextCount = typeof svg === "string" ? (svg.match(/<text/g) || []).length : 0;
    if (String(req.query?.debug || "").trim() === "1") {
      return res.status(200).json({
        primaryImage,
        firstImageProductId: firstImageProduct?.id || null,
        firstImageProductName: firstImageProduct?.name || "",
        countBefore,
        countAfter,
        productsCount: Array.isArray(products) ? products.length : 0,
        firstFiveProducts: (Array.isArray(products) ? products : []).slice(0, 5).map((product) => ({
          id: product.id,
          name: product.name,
          public_image_url: product.public_image_url || "",
          image_url: product.image_url || "",
        })),
        svgImageCount,
        svgRectCount,
        svgTextCount,
      });
    }
    const svgStartsWith = typeof svg === "string" ? svg.slice(0, 20) : "";
    console.log("[share-available-debug-svg]", {
      svgStartsWith,
      svgType: typeof svg,
      svgRectCount,
      svgImageCount,
      svgTextCount,
      query: req.query,
    });
    if (typeof svg !== "string") {
      console.error("[share-available-debug-svg]", {
        reason: "svg is not a string",
        typeofSvg: typeof svg,
      });
    }
    res.type("image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).send(svg);
  } catch (error) {
    console.error("[share-available-debug-svg]", {
      query: req.query,
      error: error?.message,
      stack: error?.stack,
    });
    const filters = normalizeShareAvailableFilters(req.query || {});
    const svg = buildShareAvailablePreviewSvg({ req, filters, products: [], count: 0 });
    const firstImageProduct = null;
    const primaryImage = "";
    const svgImageCount = typeof svg === "string" ? (svg.match(/<image/g) || []).length : 0;
    const svgRectCount = typeof svg === "string" ? (svg.match(/<rect/g) || []).length : 0;
    const svgTextCount = typeof svg === "string" ? (svg.match(/<text/g) || []).length : 0;
    if (String(req.query?.debug || "").trim() === "1") {
      return res.status(200).json({
        primaryImage,
        firstImageProductId: firstImageProduct?.id || null,
        firstImageProductName: firstImageProduct?.name || "",
        countBefore: 0,
        countAfter: 0,
        productsCount: 0,
        firstFiveProducts: [],
        svgImageCount,
        svgRectCount,
        svgTextCount,
      });
    }
    const svgStartsWith = typeof svg === "string" ? svg.slice(0, 20) : "";
    console.log("[share-available-debug-svg]", {
      svgStartsWith,
      svgType: typeof svg,
      svgRectCount,
      svgImageCount,
      svgTextCount,
      query: req.query,
    });
    res.type("image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).send(svg);
  }
};

export const getPublicProductById = async (req, res) => {
  try {
    await ensurePublicProductEditionSchema();
    await ensureProductVariantImagesSchema();
    const identifier = String(req.params.identifier || req.params.id || "").trim();
    const product = identifier ? await loadPublicProductRow(identifier) : null;
    if (!product) {
      logPublicProductNotFound(req, identifier);
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const variantsResult = await db.query(
      `
      SELECT
        id,
        product_id,
        color,
        color_sort_order,
        size,
        sku,
        barcode,
        image_url,
        cost_price,
        price,
        sale_price,
        stock,
        edition_name,
        edition_slug
      FROM product_variants
      WHERE product_id = $1::bigint
        AND is_active IS DISTINCT FROM FALSE
        AND deleted_at IS NULL
      ORDER BY color_sort_order ASC, id ASC
      `,
      [product.id]
    );

    const imageBundleMap = await loadProductVariantImages(db, [product.id]).catch(() => new Map());
    const imageBundle = imageBundleMap.get(String(product.id)) || null;
    const normalizedVariants = attachVariantImages(
      (variantsResult.rows || []).map((variant) => ({
        ...variant,
        id: variant.id,
        variant_id: variant.id,
        stock: variant.stock,
        price: variant.price,
        sale_price: variant.sale_price,
        edition_name: variant.edition_name || "",
        edition_slug: variant.edition_slug || slugifyEdition(variant.edition_name),
        image_url: variant.image_url || "",
      })),
      imageBundle
    );
    const colorImages = attachGroupedColorImages(deriveColorGroupsFromVariants(normalizedVariants), imageBundle);

    const primaryVariant = normalizedVariants.find((variant) => variant.primary_image_url || variant.image_url) || null;
    const primaryImage = firstText(primaryVariant?.primary_image_url, primaryVariant?.image_url, product.public_image_url, product.image_url);
    const normalizedProduct = normalizeProductRow({ ...product, image_url: primaryImage, public_image_url: primaryImage });
    const publicProduct = await withSocialMetadata({
      ...normalizedProduct,
      slug: firstText(normalizedProduct.slug, normalizedProduct.canonical_slug, slugifyProductName(normalizedProduct.name), normalizedProduct.id),
      is_mirror: isMirrorProduct(normalizedProduct),
      seo_title: mirrorProductTitle(normalizedProduct, normalizedVariants[0]),
    }, req);
    res.json({
      success: true,
      product: publicProduct,
      variants: normalizedVariants,
      color_images: colorImages,
    });
  } catch (error) {
    console.error("[public-products] load error", error);
    res.status(500).json({ success: false, message: error.message || "Failed to load public product" });
  }
};

export const getPublicProductOgImage = async (req, res) => {
  try {
    await ensurePublicProductEditionSchema();
    const identifier = String(req.params.identifier || req.params.slug || req.params.id || "").trim();
    const row = identifier ? await loadPublicProductRow(identifier) : null;
    if (!row) {
      logPublicProductNotFound(req, identifier);
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const product = normalizeProductRow(row);
    const ogImage = await generateProductOgImage({ product, req });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.sendFile(ogImage.path);
  } catch (error) {
    console.error("[public-products] og image error", error);
    res.status(500).json({ success: false, message: "Failed to generate product preview image" });
  }
};

export const getPublicProductShareMetadata = async (req, res) => {
  try {
    await ensurePublicProductEditionSchema();
    const identifier = String(req.params.identifier || req.params.slug || req.params.id || "").trim();
    const row = identifier ? await loadPublicProductRow(identifier) : null;
    if (!row) {
      logPublicProductNotFound(req, identifier);
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const normalizedProduct = normalizeProductRow(row);
    const product = await withSocialMetadata({
      ...normalizedProduct,
      slug: firstText(normalizedProduct.slug, normalizedProduct.canonical_slug, slugifyProductName(normalizedProduct.name), normalizedProduct.id),
      seo_title: mirrorProductTitle(normalizedProduct),
    }, req);
    res.json({ success: true, product, meta: product.social_meta });
  } catch (error) {
    console.error("[public-products] share metadata error", error);
    res.status(500).json({ success: false, message: "Failed to load product share metadata" });
  }
};

export const getPublicProductSharePage = async (req, res) => {
  try {
    await ensurePublicProductEditionSchema();
    await ensureProductVariantImagesSchema();
    const identifier = String(req.params.identifier || req.params.slug || req.params.id || "").trim();
    const row = identifier ? await loadPublicProductRow(identifier) : null;
    if (!row) {
      logPublicProductNotFound(req, identifier);
      return res.status(404).send("Product not found");
    }

    const variantsResult = await db.query(
      `
      SELECT
        id,
        product_id,
        color,
        color_sort_order,
        size,
        sku,
        barcode,
        image_url,
        cost_price,
        price,
        sale_price,
        stock,
        edition_name,
        edition_slug
      FROM product_variants
      WHERE product_id = $1::bigint
        AND is_active IS DISTINCT FROM FALSE
        AND deleted_at IS NULL
      ORDER BY color_sort_order ASC, id ASC
      `,
      [row.id]
    );

    const imageBundleMap = await loadProductVariantImages(db, [row.id]).catch(() => new Map());
    const imageBundle = imageBundleMap.get(String(row.id)) || null;
    const normalizedVariants = attachVariantImages(
      (variantsResult.rows || []).map((variant) => ({
        ...variant,
        id: variant.id,
        variant_id: variant.id,
        stock: variant.stock,
        price: variant.price,
        sale_price: variant.sale_price,
        edition_name: variant.edition_name || "",
        edition_slug: variant.edition_slug || slugifyEdition(variant.edition_name),
        image_url: variant.image_url || "",
      })),
      imageBundle
    );
    const colorImages = attachGroupedColorImages(deriveColorGroupsFromVariants(normalizedVariants), imageBundle);

    const selectedImage = getSelectedPublicProductImage({ product: row, variants: normalizedVariants, colorImages, query: req.query || {} });
    const normalizedProduct = normalizeProductRow({ ...row, image_url: selectedImage, public_image_url: selectedImage });
    const description = buildProductShareDescription({ product: normalizedProduct, variants: normalizedVariants, query: req.query || {} });
    console.log("[product-share-og]", {
      productId: normalizedProduct.id,
      title: firstText(normalizedProduct.meta_title, normalizedProduct.seo_title, normalizedProduct.name, "Product"),
      imageUrl: selectedImage,
      finalOgImage: selectedImage || "",
    });
    const html = await renderProductShareHtml({
      req,
      product: normalizedProduct,
      imageUrl: selectedImage,
      description,
    });
    if (!html) {
      const requestHost = getRequestHost(req);
      const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").trim();
      const shouldRedirect = isRenderHost(requestHost) && !isVercelHost(forwardedHost || requestHost);
      console.warn("[public-products] storefront shell unavailable", {
        original_url: req.originalUrl || req.url || "",
        request_host: requestHost,
        forwarded_host: forwardedHost,
        should_redirect: shouldRedirect,
      });
      if (shouldRedirect) {
        const redirectUrl = resolveStorefrontFallbackUrl(req);
        console.warn("[public-products] storefront shell unavailable, redirecting direct render request", {
          original_url: req.originalUrl || req.url || "",
          redirect_url: redirectUrl,
        });
        return res.redirect(302, redirectUrl);
      }
      return res.status(503).type("html").send(
        renderStorefrontShellMissingHtml({
          req,
          title: "Product page unavailable",
          message: "The storefront shell could not be loaded on this request. Please try again from the storefront URL or open the product from the app.",
        })
      );
    }
    return res.status(200).type("html").send(html);
  } catch (error) {
    console.error("[public-products] share page error", error);
    const requestHost = getRequestHost(req);
    const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").trim();
    const shouldRedirect = isRenderHost(requestHost) && !isVercelHost(forwardedHost || requestHost);
    console.warn("[public-products] share page fallback", {
      original_url: req.originalUrl || req.url || "",
      request_host: requestHost,
      forwarded_host: forwardedHost,
      should_redirect: shouldRedirect,
      message: error?.message || "",
    });
    if (shouldRedirect) {
      const redirectUrl = resolveStorefrontFallbackUrl(req);
      console.warn("[public-products] share page fallback redirect", {
        original_url: req.originalUrl || req.url || "",
        redirect_url: redirectUrl,
      });
      return res.redirect(302, redirectUrl);
    }
    return res.status(503).type("html").send(
      renderStorefrontShellMissingHtml({
        req,
        title: "Product page unavailable",
        message: "The storefront shell could not be loaded on this request. Please try again later.",
      })
    );
  }
};

export const logPublicMarketingEvent = async (req, res) => {
  try {
    const { event_type, product_id = null, post_id = null, campaign = null, platform = null, source = null, tracking_code = null, attribution_type = null, metadata = {} } = req.body || {};
    const eventType = String(event_type || "").trim();
    if (!eventType) {
      return res.status(400).json({ success: false, message: "event_type is required" });
    }

    const detected = detectMarketingAttribution(req);
    const tenantId = Number(req.body?.tenant_id || req.query?.tenant_id || req.headers?.["x-tenant-id"] || 1) || 1;
    const event = await logAttributionEvent({
      tenantId,
      eventType,
      sessionId: detected.session_id,
      source: source || detected.marketing_source,
      platform: normalizeAttributionPlatform(platform || detected.marketing_platform || detected.marketing_source),
      postId: post_id || detected.marketing_post_id,
      campaign: campaign || detected.marketing_campaign,
      productId: product_id || null,
      trackingCode: tracking_code || detected.marketing_tracking_code,
      attributionType: attribution_type || detected.attribution_type || eventType,
      referrer: detected.referrer,
      userAgent: detected.userAgent,
      ipAddress: detected.ipAddress,
      metadata,
    });

    res.json({ success: true, event });
  } catch (error) {
    console.error("[public-products] event log error", error);
    res.status(500).json({ success: false, message: error.message || "Failed to log public event" });
  }
};



