import db from "../database/db.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
import { resolvePublicProductImageUrl } from "../services/aiProductCards.js";
import { formatCurrency } from "../../src/shared/lib/currency.js";
import { normalizeAttributionPlatform } from "../utils/marketingAttribution.js";
import { isMirrorProduct, mirrorProductTitle, slugifyEdition } from "../utils/mirrorProduct.js";

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
      url: buildAbsolutePublicUrl(req, productPagePath(product)),
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
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, audience),
      CHECK (audience IN ('men', 'women', 'kids'))
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_product_id ON product_audiences (product_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_audience ON product_audiences (audience, product_id)`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_name TEXT`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_slug TEXT`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`);
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

let storefrontShellPromise = null;
const loadStorefrontShell = async () => {
  if (!storefrontShellPromise) {
    storefrontShellPromise = (async () => {
      const candidates = [
        path.join(process.cwd(), "dist", "index.html"),
        path.join(process.cwd(), "index.html"),
      ];
      for (const candidate of candidates) {
        try {
          return await readFile(candidate, "utf8");
        } catch {
          // Try the next candidate.
        }
      }
      return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"><title>M1 Employee Portal</title></head><body><div id="root"></div></body></html>`;
    })();
  }
  return storefrontShellPromise;
};

const getSelectedPublicProductImage = ({ product = {}, variants = [], query = {} } = {}) => {
  const normalizedVariant = String(query.variant || query.variantId || query.variant_id || "").trim();
  const normalizedColor = String(query.color || query.colorName || query.color_name || "").trim().toLowerCase();
  const normalizedSize = String(query.size || query.sizeLabel || "").trim().toLowerCase();
  const selectedVariant =
    (normalizedVariant && variants.find((variant) => String(variant.id || variant.variant_id || "").trim() === normalizedVariant)) ||
    (normalizedColor && variants.find((variant) => String(variant.color || variant.color_name || "").trim().toLowerCase() === normalizedColor)) ||
    (normalizedSize && variants.find((variant) => String(variant.size || "").trim().toLowerCase() === normalizedSize)) ||
    variants.find((variant) => variant.primary_image_url || variant.image_url) ||
    null;

  const rawImage = selectedVariant?.primary_image_url || selectedVariant?.image_url || product.public_image_url || product.image_url || product.image || product.photo_url || product.thumbnail_url || "";
  const resolved = resolvePublicProductImageUrl(rawImage, { baseUrl: process.env.STORE_FRONT_URL || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "" });
  if (resolved) return resolved.replace(/^http:\/\//i, "https://");
  const fallback = resolvePublicProductImageUrl(product.public_image_url || product.image_url || product.image || "", { baseUrl: process.env.STORE_FRONT_URL || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "" });
  return fallback.replace(/^http:\/\//i, "https://");
};

const renderProductShareHtml = async ({ req, product, imageUrl, description }) => {
  const shell = await loadStorefrontShell();
  const title = escapeHtml(firstText(product.meta_title, product.seo_title, product.name, "Product"));
  const descriptionText = escapeHtml(description || firstText(product.seo_description, product.description_en, product.description_ar, product.description, product.name));
  const absoluteUrl = escapeHtml(buildAbsolutePublicUrl(req, req.originalUrl || req.url || `/shop/product/${product.slug || product.canonical_slug || product.id || ""}`));
  const absoluteImage = escapeHtml((imageUrl || "").replace(/^http:\/\//i, "https://"));
  const metaBlock = `
    <title>${title}</title>
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${descriptionText}" />
    <meta property="og:image" content="${absoluteImage}" />
    <meta property="og:image:secure_url" content="${absoluteImage}" />
    <meta property="og:type" content="product" />
    <meta property="og:url" content="${absoluteUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${descriptionText}" />
    <meta name="twitter:image" content="${absoluteImage}" />
  `;
  const normalizedShell = shell.replace(/<title>[\s\S]*?<\/title>/i, "").replace("</head>", `${metaBlock}\n  </head>`);
  return normalizedShell.includes('<div id="root"></div>')
    ? normalizedShell
    : normalizedShell.replace("</body>", '<div id="root"></div></body>');
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
      ORDER BY id ASC
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
      ORDER BY id ASC
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
    attachGroupedColorImages(deriveColorGroupsFromVariants(normalizedVariants), imageBundle);

    const selectedImage = getSelectedPublicProductImage({ product: row, variants: normalizedVariants, query: req.query || {} });
    const normalizedProduct = normalizeProductRow({ ...row, image_url: selectedImage, public_image_url: selectedImage });
    const description = buildProductShareDescription({ product: normalizedProduct, variants: normalizedVariants, query: req.query || {} });
    const html = await renderProductShareHtml({
      req,
      product: normalizedProduct,
      imageUrl: selectedImage,
      description,
    });
    return res.status(200).type("html").send(html);
  } catch (error) {
    console.error("[public-products] share page error", error);
    return res.status(500).send("Failed to load product page");
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

