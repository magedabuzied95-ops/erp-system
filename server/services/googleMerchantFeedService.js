import { createHash } from "node:crypto";
import db from "../database/db.js";
import { resolveCurrentSellingPrice } from "./currentSellingPriceResolver.js";
import { resolveMetaProductCategories } from "./metaProductCategoryResolver.js";

export const GOOGLE_FEED_URL = "https://m1store-egy.com/feeds/google.xml";
export const GOOGLE_FEED_TTL_MS = 24 * 60 * 60 * 1000;
const STOREFRONT_URL = "https://m1store-egy.com";
const BACKEND_URL = "https://api.m1store-egy.com";
const FALLBACK_IMAGE = `${STOREFRONT_URL}/branding/m-one-logo-dark-fixed.png`;
const PAGE_SIZE = 1000;

const text = (value = "") => String(value ?? "").trim();
const positive = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const enabled = (value) =>
  value === true || value === 1 || ["true", "1", "yes", "on"].includes(text(value).toLowerCase());
const escapeXml = (value = "") =>
  text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const formatPrice = (value) => `${positive(value).toFixed(2)} EGP`;

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const publicHttpsUrl = (value = "", base = BACKEND_URL) => {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, `${base.replace(/\/+$/, "")}/`);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
};

const slugBelongsToProduct = (slug = "", row = {}) => {
  const candidate = text(slug);
  if (!candidate || /^[0-9]+$/.test(candidate)) return true;
  const nameTokens = text(row.product_name).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (!nameTokens.length) return true;
  const slugTokens = new Set(candidate.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
  const overlap = nameTokens.filter((token) => slugTokens.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, nameTokens.length));
};

const productIdentifier = (row = {}) => {
  if (text(row.slug) && slugBelongsToProduct(row.slug, row)) return text(row.slug);
  if (text(row.canonical_slug) && slugBelongsToProduct(row.canonical_slug, row)) return text(row.canonical_slug);
  return text(row.product_id);
};

const productLink = (row = {}) => {
  const identifier = productIdentifier(row);
  return identifier ? `${STOREFRONT_URL}/product/${encodeURIComponent(identifier)}` : "";
};

const normalizeAudience = (row = {}) => {
  const raw = text(row.variant_audience || row.product_gender || parseArray(row.product_audiences)[0]).toLowerCase();
  if (["men", "man", "male", "mens", "رجال", "رجالي"].includes(raw)) return { gender: "male", age_group: "adult" };
  if (["women", "woman", "female", "ladies", "lady", "نساء", "نسائي", "حريمي"].includes(raw)) return { gender: "female", age_group: "adult" };
  if (["kids", "kid", "children", "child", "boys", "girls", "اطفال", "أطفال", "طفل"].includes(raw)) {
    return { gender: "unisex", age_group: "kids" };
  }
  return { gender: "", age_group: "" };
};

const gtinIsValid = (value = "") => {
  const digits = text(value).replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length) || digits !== text(value)) return false;
  const values = [...digits].map(Number);
  const checkDigit = values.pop();
  const sum = values.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
};

const currentSellingPrice = (row = {}) => resolveCurrentSellingPrice({
  product: {
    manual_selling_price: row.product_manual_selling_price,
    manual_price_override_active: row.product_manual_price_override_active,
    purchase_selling_price: row.product_purchase_selling_price,
    selling_price: row.product_selling_price,
    price: row.product_price,
    regular_price: row.product_regular_price,
  },
  variant: {
    manual_selling_price: row.variant_manual_selling_price,
    manual_price_override_active: row.variant_manual_price_override_active,
    purchase_selling_price: row.variant_purchase_selling_price,
    selling_price: row.variant_selling_price,
    price: row.variant_price,
    regular_price: row.variant_regular_price,
  },
}).value;

export const resolveGoogleFeedPricing = (row = {}) => {
  const storedSellingPrice = currentSellingPrice(row);
  const storedSalePrice = positive(row.variant_sale_price) || positive(row.product_sale_price);
  const saleEnabled =
    enabled(row.variant_sale_price_enabled) ||
    enabled(row.product_sale_price_enabled) ||
    enabled(row.is_offer_story);
  const activePrice =
    saleEnabled && storedSalePrice > 0 && storedSalePrice < storedSellingPrice
      ? storedSalePrice
      : storedSellingPrice;
  if (!(activePrice > 0)) return { price: 0, sale_price: 0, active_price: 0 };

  const compareCandidates = [
    enabled(row.use_custom_compare_price) ? row.custom_compare_price : 0,
    saleEnabled ? storedSellingPrice : 0,
    saleEnabled ? row.variant_regular_price : 0,
    saleEnabled ? row.product_regular_price : 0,
  ].map(positive);
  const comparePrice = compareCandidates.find((value) => value > activePrice) || 0;
  return comparePrice
    ? { price: comparePrice, sale_price: activePrice, active_price: activePrice }
    : { price: activePrice, sale_price: 0, active_price: activePrice };
};

const isBag = (row = {}) => resolveMetaProductCategories(row).matchedBy === "bags";
const isFootwear = (row = {}) => {
  const category = resolveMetaProductCategories(row);
  return ["sneakers", "crocs", "slippers", "footwear-fallback"].includes(category.matchedBy);
};

export const buildGoogleMerchantItem = (row = {}) => {
  const productId = text(row.product_id);
  const variantId = text(row.variant_id);
  const color = text(row.color);
  const size = text(row.size);
  const bag = isBag(row);
  if (!productId || !productLink(row)) return null;
  if (variantId && isFootwear(row) && (!color || !size)) return null;
  if (variantId && bag && !color) return null;

  const pricing = resolveGoogleFeedPricing(row);
  if (!(pricing.active_price > 0)) return null;

  const primaryImage = publicHttpsUrl(
    row.primary_color_image || row.variant_image_url || row.product_image_url,
  ) || FALLBACK_IMAGE;
  const additionalImages = [
    ...parseArray(row.color_gallery),
    ...parseArray(row.gallery_images),
  ]
    .map((url) => publicHttpsUrl(url))
    .filter((url) => url && url !== primaryImage);
  const categories = resolveMetaProductCategories(row);
  const audience = normalizeAudience(row);
  const gtin = gtinIsValid(row.variant_barcode) ? text(row.variant_barcode) : "";
  const mpn = text(row.variant_article_code);
  const brand = text(row.brand_name);
  const identifierExists = Boolean(gtin || (brand && mpn));
  const item = {
    id: variantId ? `${productId}-${variantId}` : `p-${productId}`,
    item_group_id: variantId ? productId : "",
    title: [row.product_name, color, bag ? "" : size].map(text).filter(Boolean).join(" - "),
    description: text(row.description || row.product_name),
    link: productLink(row),
    image_link: primaryImage,
    additional_image_link: [...new Set(additionalImages)].slice(0, 10),
    availability: Number(variantId ? row.variant_stock : row.product_stock) > 0 ? "in_stock" : "out_of_stock",
    price: formatPrice(pricing.price),
    sale_price: pricing.sale_price ? formatPrice(pricing.sale_price) : "",
    brand: brand || "M1 Store",
    condition: "new",
    google_product_category: categories.googleProductCategory,
    product_type: text(row.category_name || row.product_type),
    color,
    size: bag ? "" : size,
    gender: audience.gender,
    age_group: audience.age_group,
    identifier_exists: identifierExists ? "yes" : "no",
    gtin,
    mpn: gtin ? "" : mpn,
  };
  return item;
};

const tag = (name, value, indent = "      ") =>
  text(value) ? `${indent}<g:${name}>${escapeXml(value)}</g:${name}>` : "";

export const googleMerchantItemXml = (item = {}) => {
  const lines = [
    "    <item>",
    tag("id", item.id),
    tag("item_group_id", item.item_group_id),
    tag("title", item.title),
    tag("description", item.description),
    tag("link", item.link),
    tag("image_link", item.image_link),
    ...(item.additional_image_link || []).map((url) => tag("additional_image_link", url)),
    tag("availability", item.availability),
    tag("price", item.price),
    tag("sale_price", item.sale_price),
    tag("brand", item.brand),
    tag("condition", item.condition),
    tag("google_product_category", item.google_product_category),
    tag("product_type", item.product_type),
    tag("color", item.color),
    tag("size", item.size),
    tag("gender", item.gender),
    tag("age_group", item.age_group),
    tag("identifier_exists", item.identifier_exists),
    tag("gtin", item.gtin),
    tag("mpn", item.mpn),
    "    </item>",
  ];
  return lines.filter(Boolean).join("\n");
};

const googleRowsSql = `
  WITH color_images AS (
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
    p.stock AS product_stock,
    p.gender AS product_gender,
    COALESCE((SELECT jsonb_agg(pa.audience ORDER BY pa.audience) FROM product_audiences pa WHERE pa.product_id = p.id), '[]'::jsonb) AS product_audiences,
    p.selling_price AS product_selling_price,
    to_jsonb(p)->>'purchase_selling_price' AS product_purchase_selling_price,
    to_jsonb(p)->>'manual_selling_price' AS product_manual_selling_price,
    to_jsonb(p)->>'manual_price_override_active' AS product_manual_price_override_active,
    p.regular_price AS product_regular_price,
    p.price AS product_price,
    p.sale_price AS product_sale_price,
    p.sale_price_enabled AS product_sale_price_enabled,
    p.is_offer_story,
    p.use_custom_compare_price,
    p.custom_compare_price,
    p.product_type,
    c.name AS category_name,
    COALESCE(NULLIF(TRIM(to_jsonb(pv)->>'google_product_category'), ''), NULLIF(TRIM(to_jsonb(p)->>'google_product_category'), '')) AS google_product_category,
    COALESCE(NULLIF(TRIM(to_jsonb(pv)->>'facebook_product_category'), ''), NULLIF(TRIM(to_jsonb(p)->>'facebook_product_category'), '')) AS facebook_product_category,
    b.name AS brand_name,
    pv.id AS variant_id,
    pv.color,
    pv.size,
    pv.audience AS variant_audience,
    pv.image_url AS variant_image_url,
    pv.stock AS variant_stock,
    pv.barcode AS variant_barcode,
    pv.article_code AS variant_article_code,
    pv.selling_price AS variant_selling_price,
    to_jsonb(pv)->>'purchase_selling_price' AS variant_purchase_selling_price,
    to_jsonb(pv)->>'manual_selling_price' AS variant_manual_selling_price,
    to_jsonb(pv)->>'manual_price_override_active' AS variant_manual_price_override_active,
    pv.regular_price AS variant_regular_price,
    pv.price AS variant_price,
    pv.sale_price AS variant_sale_price,
    to_jsonb(pv)->>'sale_price_enabled' AS variant_sale_price_enabled,
    ci.primary_color_image,
    ci.color_gallery
  FROM products p
  LEFT JOIN product_variants pv
    ON pv.product_id = p.id
    AND pv.is_active IS DISTINCT FROM FALSE
    AND pv.deleted_at IS NULL
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN color_images ci ON ci.product_id = p.id AND ci.color_key = LOWER(TRIM(pv.color))
  WHERE p.is_active IS DISTINCT FROM FALSE
    AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') = 'active'
    AND p.is_storefront_visible IS DISTINCT FROM FALSE
    AND (
      pv.id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM product_variants pv_any WHERE pv_any.product_id = p.id)
    )
  ORDER BY p.id ASC, pv.color_sort_order ASC, pv.id ASC
  LIMIT $1 OFFSET $2
`;

export const queryGoogleMerchantRowsPage = async ({ offset = 0, limit = PAGE_SIZE } = {}) => {
  const result = await db.query(googleRowsSql, [limit, offset]);
  return result.rows || [];
};

export const buildGoogleMerchantFeedFromRows = (rows = []) => {
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const item = buildGoogleMerchantItem(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const body = items.map(googleMerchantItemXml).join("\n");
  return {
    items,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>M1 Store Google Merchant Feed</title>
    <link>${STOREFRONT_URL}</link>
    <description>M1 Store product catalog for Google Merchant Center</description>
${body}
  </channel>
</rss>`,
  };
};

let feedCache = null;

export const clearGoogleMerchantFeedCache = () => {
  feedCache = null;
};

export const buildGoogleMerchantFeed = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && feedCache && now - feedCache.generatedAt < GOOGLE_FEED_TTL_MS) return feedCache;
  const rows = [];
  let offset = 0;
  while (true) {
    const page = await queryGoogleMerchantRowsPage({ offset, limit: PAGE_SIZE });
    if (!page.length) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }
  const generated = buildGoogleMerchantFeedFromRows(rows);
  const etag = `"${createHash("sha256").update(generated.xml).digest("hex")}"`;
  feedCache = {
    xml: generated.xml,
    itemCount: generated.items.length,
    etag,
    generatedAt: now,
    feedUrl: GOOGLE_FEED_URL,
  };
  return feedCache;
};
