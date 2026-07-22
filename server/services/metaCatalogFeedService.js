import db from "../database/db.js";
import { storefrontBaseUrl } from "./storefrontProductUrlService.js";

const FEED_URL = "https://api.m1store-egy.com/feeds/meta.xml";
const DEFAULT_STOREFRONT_URL = "https://m1store-egy.com";
const DEFAULT_BACKEND_URL = "https://api.m1store-egy.com";
const DEFAULT_PRODUCT_IMAGE_PATH = "/branding/m-one-logo-dark-fixed.png";

const text = (value = "") => String(value ?? "").trim();

const xml = (value = "") =>
  text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const absoluteUrl = (value = "", fallbackBase = "") => {
  const url = text(value);
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = text(fallbackBase).replace(/\/+$/g, "");
  if (!base) return url;
  return `${base}/${url.replace(/^\/+/g, "")}`;
};

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const formatPrice = (value) => `${numberValue(value).toFixed(2)} EGP`;

const pickPrice = (...values) => {
  for (const value of values) {
    const price = numberValue(value);
    if (price > 0) return price;
  }
  return 0;
};

const parseGalleryImages = (value) => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const slugBelongsToProduct = (slug = "", product = {}) => {
  const safeSlug = text(slug);
  if (!safeSlug || /^[0-9]+$/.test(safeSlug)) return true;
  const productName = text(product.product_name || product.name);
  if (!productName) return true;
  const slugTokens = new Set(safeSlug.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
  const nameTokens = productName.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (!nameTokens.length) return true;
  const overlap = nameTokens.filter((token) => slugTokens.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, nameTokens.length));
};

const productIdentifier = (row = {}) => {
  const slug = text(row.slug);
  if (slug && slugBelongsToProduct(slug, row)) return slug;
  const canonicalSlug = text(row.canonical_slug);
  if (canonicalSlug && slugBelongsToProduct(canonicalSlug, row)) return canonicalSlug;
  return text(row.product_id);
};

const buildMetaProductUrl = (row = {}, { storefrontUrl = "" } = {}) => {
  const identifier = productIdentifier(row);
  if (!identifier) return "";
  const base = text(storefrontUrl).replace(/\/+$/g, "");
  const path = `/product/${encodeURIComponent(identifier)}`;
  return base ? `${base}${path}` : path;
};

const queryMetaCatalogRows = async () => {
  const result = await db.query(`
    WITH variant_sku_counts AS (
      SELECT LOWER(TRIM(sku)) AS sku_key, COUNT(*) AS sku_count
      FROM product_variants
      WHERE COALESCE(TRIM(sku), '') <> ''
      GROUP BY LOWER(TRIM(sku))
    ),
    color_images AS (
      SELECT
        product_id,
        LOWER(TRIM(color_name)) AS color_key,
        (ARRAY_AGG(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC))[1] AS primary_color_image,
        ARRAY_AGG(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC) AS color_gallery
      FROM product_variant_images
      WHERE COALESCE(TRIM(image_url), '') <> ''
      GROUP BY product_id, LOWER(TRIM(color_name))
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.description,
      p.slug,
      p.canonical_slug,
      p.image_url AS product_image_url,
      p.gallery_images,
      p.selling_price AS product_selling_price,
      p.regular_price AS product_regular_price,
      p.price AS product_price,
      p.sale_price AS product_sale_price,
      p.sale_price_enabled AS product_sale_price_enabled,
      p.sale_start_at AS product_sale_start_at,
      p.sale_end_at AS product_sale_end_at,
      p.use_custom_compare_price,
      p.custom_compare_price,
      p.brand_id,
      b.name AS brand_name,
      pv.id AS variant_id,
      pv.sku AS variant_sku,
      vsc.sku_count,
      pv.color,
      pv.size,
      pv.image_url AS variant_image_url,
      pv.stock AS variant_stock,
      pv.selling_price AS variant_selling_price,
      pv.regular_price AS variant_regular_price,
      pv.price AS variant_price,
      pv.sale_price AS variant_sale_price,
      pv.sale_price_enabled AS variant_sale_price_enabled,
      ci.primary_color_image,
      ci.color_gallery
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN variant_sku_counts vsc ON vsc.sku_key = LOWER(TRIM(pv.sku))
    LEFT JOIN color_images ci ON ci.product_id = p.id AND ci.color_key = LOWER(TRIM(pv.color))
    WHERE p.is_active IS DISTINCT FROM FALSE
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') = 'active'
      AND p.is_storefront_visible IS DISTINCT FROM FALSE
      AND pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
    ORDER BY p.id ASC, pv.color_sort_order ASC, pv.id ASC
  `);
  return result.rows || [];
};

const validDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const saleEffectiveDate = (row = {}) => {
  const start = validDate(row.product_sale_start_at);
  const end = validDate(row.product_sale_end_at);
  if (!start || !end || end <= start) return "";
  return `${start.toISOString()}/${end.toISOString()}`;
};

export const resolveMetaCatalogPricing = (row = {}) => {
  const variantBase = pickPrice(row.variant_selling_price, row.variant_price, row.variant_regular_price);
  const productBase = pickPrice(row.product_selling_price, row.product_price, row.product_regular_price);
  const baseSellingPrice = variantBase || productBase;
  const variantSale = numberValue(row.variant_sale_price);
  const productSale = numberValue(row.product_sale_price);
  const legacySalePrice = row.variant_sale_price_enabled && variantSale > 0 && variantSale < baseSellingPrice
    ? variantSale
    : row.product_sale_price_enabled && productSale > 0 && productSale < baseSellingPrice
      ? productSale
      : 0;
  const sellingPrice = legacySalePrice || baseSellingPrice;
  const explicitOriginalPrice = pickPrice(
    row.variant_original_price,
    row.variant_compare_at_price,
    row.product_original_price,
    row.product_compare_at_price,
    row.use_custom_compare_price ? row.custom_compare_price : 0
  );
  const originalPrice = explicitOriginalPrice > sellingPrice
    ? explicitOriginalPrice
    : legacySalePrice > 0 && baseSellingPrice > sellingPrice
      ? baseSellingPrice
      : 0;
  const hasDiscount = originalPrice > sellingPrice && sellingPrice > 0;

  return { sellingPrice, originalPrice, hasDiscount };
};

export const buildMetaCatalogItem = (row, { storefrontUrl = DEFAULT_STOREFRONT_URL, backendUrl = DEFAULT_BACKEND_URL } = {}) => {
  const productId = text(row.product_id);
  const variantId = text(row.variant_id);
  const sku = text(row.variant_sku);
  const id = sku && Number(row.sku_count || 0) === 1 ? sku : `${productId}-${variantId}`;
  const brand = text(row.brand_name || "M1 Store");
  const color = text(row.color);
  const size = text(row.size);
  const titleParts = [row.product_name, color, size].map(text).filter(Boolean);
  const { sellingPrice, originalPrice, hasDiscount } = resolveMetaCatalogPricing(row);
  const fallbackImage = absoluteUrl(DEFAULT_PRODUCT_IMAGE_PATH, storefrontUrl);
  const productImage = absoluteUrl(row.product_image_url, backendUrl);
  const image = absoluteUrl(row.primary_color_image || row.variant_image_url || row.product_image_url, backendUrl) || fallbackImage;
  const gallery = [
    ...(Array.isArray(row.color_gallery) ? row.color_gallery : []),
    ...parseGalleryImages(row.gallery_images),
  ]
    .map((url) => absoluteUrl(url, backendUrl))
    .filter((url) => url && url !== image && url !== productImage);

  const item = {
    id,
    item_group_id: productId,
    title: titleParts.join(" - "),
    description: text(row.description || row.product_name),
    link: buildMetaProductUrl(row, { storefrontUrl }),
    image_link: image || productImage,
    additional_image_link: [...new Set(gallery)].slice(0, 10),
    availability: Number(row.variant_stock || 0) > 0 ? "in stock" : "out of stock",
    price: formatPrice(hasDiscount ? originalPrice : sellingPrice),
    currency: "EGP",
    brand,
    color,
    size,
  };
  if (hasDiscount) {
    item.sale_price = formatPrice(sellingPrice);
    const effectiveDate = saleEffectiveDate(row);
    if (effectiveDate) item.sale_price_effective_date = effectiveDate;
  }
  return item;
};

const itemXml = (item) => {
  const additionalImages = item.additional_image_link
    .map((url) => `      <g:additional_image_link>${xml(url)}</g:additional_image_link>`)
    .join("\n");
  return `    <item>
      <g:id>${xml(item.id)}</g:id>
      <g:item_group_id>${xml(item.item_group_id)}</g:item_group_id>
      <title>${xml(item.title)}</title>
      <description>${xml(item.description)}</description>
      <link>${xml(item.link)}</link>
      <g:image_link>${xml(item.image_link)}</g:image_link>
${additionalImages ? `${additionalImages}\n` : ""}      <g:availability>${xml(item.availability)}</g:availability>
      <g:price>${xml(item.price)}</g:price>
${item.sale_price ? `      <g:sale_price>${xml(item.sale_price)}</g:sale_price>\n` : ""}${item.sale_price_effective_date ? `      <g:sale_price_effective_date>${xml(item.sale_price_effective_date)}</g:sale_price_effective_date>\n` : ""}      <g:brand>${xml(item.brand)}</g:brand>
      <g:currency>${xml(item.currency)}</g:currency>
      <g:color>${xml(item.color)}</g:color>
      <g:size>${xml(item.size)}</g:size>
      <g:condition>new</g:condition>
    </item>`;
};

export const buildMetaCatalogFeed = async () => {
  const storefrontUrl = storefrontBaseUrl() || DEFAULT_STOREFRONT_URL;
  const backendUrl = text(process.env.PUBLIC_BACKEND_URL || process.env.API_PUBLIC_URL || DEFAULT_BACKEND_URL).replace(/\/+$/g, "");
  const rows = await queryMetaCatalogRows();
  const items = rows.map((row) => buildMetaCatalogItem(row, { storefrontUrl, backendUrl }));
  const body = items.map(itemXml).join("\n");

  return {
    feedUrl: FEED_URL,
    items,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>M1 Store Meta Catalog</title>
    <link>${xml(storefrontUrl)}</link>
    <description>M1 Store product catalog feed for Meta Commerce</description>
${body}
  </channel>
</rss>`,
  };
};
