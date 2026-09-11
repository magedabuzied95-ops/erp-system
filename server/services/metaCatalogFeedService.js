import db from "../database/db.js";
import { storefrontBaseUrl } from "./storefrontProductUrlService.js";
import { resolveCurrentSellingPrice } from "./currentSellingPriceResolver.js";
import { resolveMetaProductCategories } from "./metaProductCategoryResolver.js";
import { resolveProductAudience } from "./productAudienceResolver.js";
import { metaCatalogImageUrl, warmMetaCatalogImageRenditions } from "./metaImageCompatService.js";
import { resolveEffectiveCustomerPrice } from "../../src/shared/lib/effectiveCustomerPrice.js";
import { loadTenantSaleModeSettings } from "../utils/customerDisplayPrice.js";
import { AD_FEED_PURCHASE_COLUMNS, AD_FEED_PURCHASE_CTES, AD_FEED_PURCHASE_JOINS } from "./adFeedPurchaseLinesSql.js";

const FEED_URL = "https://api.m1store-egy.com/feeds/meta.xml";
const DEFAULT_STOREFRONT_URL = "https://m1store-egy.com";
const DEFAULT_BACKEND_URL = "https://api.m1store-egy.com";
const DEFAULT_PRODUCT_IMAGE_PATH = "/branding/m-one-logo-dark-fixed.png";
// The storefront's DEFAULT_TENANT_ID. Every product row is tenant 1 (checked in production).
const FEED_TENANT_ID = 1;

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

// Gallery entries are stored either as plain urls or as objects, and String({}) used to
// ship "[object Object]" to Meta as an image link.
const galleryImageUrl = (entry) => {
  if (typeof entry === "string") return text(entry);
  if (!entry || typeof entry !== "object") return "";
  return text(entry.url || entry.image_url || entry.imageUrl || entry.secure_url || entry.src || entry.path);
};

const parseGalleryImages = (value) => {
  if (Array.isArray(value)) return value.map(galleryImageUrl).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(galleryImageUrl).filter(Boolean) : [];
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

// A colourway is what an ad promotes: its own photo, its own title, its sizes as the
// variants inside it. Grouping by product alone let Meta pick one colour and bury the rest.
const colorGroupKey = (value = "") => {
  const color = text(value).toLowerCase();
  if (!color) return "";
  const ascii = color.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (ascii) return ascii;
  return Buffer.from(color, "utf8").toString("hex").slice(0, 16);
};

export const metaItemGroupId = (row = {}) => {
  const productId = text(row.product_id);
  const colorKey = colorGroupKey(row.color);
  return colorKey ? `${productId}-${colorKey}` : productId;
};

const buildMetaProductUrl = (row = {}, { storefrontUrl = "" } = {}) => {
  const identifier = productIdentifier(row);
  if (!identifier) return "";
  const base = text(storefrontUrl).replace(/\/+$/g, "");
  // The storefront honours ?color=, so the card lands on the colourway it advertised
  // instead of whichever colour the product page defaults to.
  const color = text(row.color);
  // ...and ?variant= lands it on the exact size: within one colour, sizes can carry their own
  // prices (Skechers Max Run 46-48 sell at 1,450 while the colour opens on 1,350), and the page
  // already selects a requested variant when it is in stock.
  const parts = [];
  if (color) parts.push(`color=${encodeURIComponent(color)}`);
  if (text(row.variant_id)) parts.push(`variant=${encodeURIComponent(text(row.variant_id))}`);
  const query = parts.length ? `?${parts.join("&")}` : "";
  const path = `/product/${encodeURIComponent(identifier)}${query}`;
  return base ? `${base}${path}` : path;
};

const queryMetaCatalogRows = async () => {
  const result = await db.query(`
    WITH
    -- A SKU is only "taken twice" when two PUBLISHED rows carry it. The pixel reports every
    -- view by SKU (metaCatalogContentId), so a SKU the feed swaps for product-variant is a view
    -- Meta cannot match. Counting archived colours, deleted sizes and hidden products here sent
    -- 21 live sizes as 391-6818 while the pixel said ADS-LOC-8-WHT-41. Same filter as below.
    variant_sku_counts AS (
      SELECT LOWER(TRIM(v.sku)) AS sku_key, COUNT(*) AS sku_count
      FROM product_variants v
      JOIN products vp ON vp.id = v.product_id
      WHERE COALESCE(TRIM(v.sku), '') <> ''
        AND vp.is_active IS DISTINCT FROM FALSE
        AND COALESCE(NULLIF(LOWER(TRIM(vp.status)), ''), 'active') = 'active'
        AND vp.is_storefront_visible IS DISTINCT FROM FALSE
        AND v.is_active IS DISTINCT FROM FALSE
        AND v.deleted_at IS NULL
      GROUP BY LOWER(TRIM(v.sku))
    ),
    ${AD_FEED_PURCHASE_CTES},
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
      to_jsonb(p)->>'purchase_selling_price' AS product_purchase_selling_price,
      to_jsonb(p)->>'manual_selling_price' AS product_manual_selling_price,
      to_jsonb(p)->>'manual_price_override_active' AS product_manual_price_override_active,
      p.regular_price AS product_regular_price,
      p.price AS product_price,
      p.use_custom_compare_price,
      p.custom_compare_price,
      -- A curated offer is charged at its sale price with the global toggle off, so an ad that
      -- quotes the normal price advertises more than the shop takes. Plain column references on
      -- purpose: every to_jsonb(row) here serialises the WHOLE row, and adding these through it
      -- pushed the 8,760-row build past the query read timeout. is_offer_story is the only
      -- offer flag that exists as a column — the aliases the resolver also accepts do not.
      p.sale_price AS product_sale_price,
      pv.sale_price AS variant_sale_price,
      ${AD_FEED_PURCHASE_COLUMNS},
      p.is_offer_story AS product_is_offer_story,
      -- Sale Mode's own inputs, so the day the global toggle goes on the feed decides with the
      -- same per-record flag, window and margin floor as POS instead of quoting a stale price.
      p.sale_price_enabled AS product_sale_price_enabled,
      p.sale_start_at AS product_sale_start_at,
      p.sale_end_at AS product_sale_end_at,
      p.cost_price AS product_cost_price,
      pv.sale_price_enabled AS variant_sale_price_enabled,
      pv.sale_start_at AS variant_sale_start_at,
      pv.sale_end_at AS variant_sale_end_at,
      pv.cost_price AS variant_cost_price,
      p.category_id,
      p.product_type,
      c.name AS category_name,
      COALESCE(
        NULLIF(TRIM(to_jsonb(pv)->>'google_product_category'), ''),
        NULLIF(TRIM(to_jsonb(p)->>'google_product_category'), '')
      ) AS google_product_category,
      COALESCE(
        NULLIF(TRIM(to_jsonb(pv)->>'facebook_product_category'), ''),
        NULLIF(TRIM(to_jsonb(pv)->>'fb_product_category'), ''),
        NULLIF(TRIM(to_jsonb(p)->>'facebook_product_category'), ''),
        NULLIF(TRIM(to_jsonb(p)->>'fb_product_category'), '')
      ) AS facebook_product_category,
      p.brand_id,
      b.name AS brand_name,
      -- Read through to_jsonb so a tenant whose lazy column ensure never ran keeps a
      -- working feed instead of a 500 on every Meta crawl.
      to_jsonb(p)->>'gender' AS product_gender,
      to_jsonb(pv)->>'audience' AS variant_audience,
      pv.id AS variant_id,
      pv.sku AS variant_sku,
      vsc.sku_count,
      pv.color,
      pv.size,
      pv.image_url AS variant_image_url,
      pv.stock AS variant_stock,
      pv.selling_price AS variant_selling_price,
      to_jsonb(pv)->>'purchase_selling_price' AS variant_purchase_selling_price,
      to_jsonb(pv)->>'manual_selling_price' AS variant_manual_selling_price,
      to_jsonb(pv)->>'manual_price_override_active' AS variant_manual_price_override_active,
      pv.regular_price AS variant_regular_price,
      pv.price AS variant_price,
      ci.primary_color_image,
      ci.color_gallery
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN variant_sku_counts vsc ON vsc.sku_key = LOWER(TRIM(pv.sku))
    LEFT JOIN color_images ci ON ci.product_id = p.id AND ci.color_key = LOWER(TRIM(pv.color))
    ${AD_FEED_PURCHASE_JOINS}
    WHERE p.is_active IS DISTINCT FROM FALSE
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') = 'active'
      AND p.is_storefront_visible IS DISTINCT FROM FALSE
      AND pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
    ORDER BY p.id ASC, pv.color_sort_order ASC, pv.id ASC
  `);
  return result.rows || [];
};

// The size's own price, by the canonical Phase 1 contract — the same answer the storefront,
// POS, the AI and the Google feed give. This used to swap a size's legacy price for the
// PRODUCT's, to match the back-office ProductDetails page; owner decision 2026-09-10 is that the
// size's own price is correct, and product 293 was advertised at 400 on every size while its
// sizes sell at 650. Sale prices are decided later, by resolveMetaCatalogActivePrice.
export const resolveMetaCatalogCurrentPrice = (row = {}) => {
  const product = {
    manual_selling_price: row.product_manual_selling_price,
    manual_price_override_active: row.product_manual_price_override_active,
    purchase_selling_price: row.product_purchase_selling_price,
    selling_price: row.product_selling_price,
    price: row.product_price,
    regular_price: row.product_regular_price,
  };
  const variant = {
    manual_selling_price: row.variant_manual_selling_price,
    manual_price_override_active: row.variant_manual_price_override_active,
    // The invoice line the storefront prices this size from (adFeedPurchaseLinesSql).
    purchase_selling_price: row.variant_line_purchase_selling_price ?? row.variant_purchase_selling_price,
    selling_price: row.variant_selling_price,
    price: row.variant_price,
    regular_price: row.variant_regular_price,
  };
  return resolveCurrentSellingPrice({ product, variant }).value;
};

/*
  What the customer actually pays. The feed used to send the NORMAL price, so a product sitting in
  العروض — charged at its sale price in POS, on the storefront and in every AI quote, with the global
  toggle off — was advertised at the higher price. Google reads that as a landing-page mismatch and
  Meta sends the customer to a cheaper page than the ad promised.

  The decision is delegated to the canonical resolver, never re-implemented here: it is the thing
  that separates a live offer from a stored-but-dormant sale price. Only the normal price is ours,
  handed in as the product's selling price so the Phase 1 contract above still decides it.
*/
// The resolver merges variant over product to evaluate the Sale Mode rules, so a variant key that
// is merely absent from the row would shadow the product's own value with undefined.
const definedOnly = (record = {}) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null));

export const resolveMetaCatalogActivePrice = (
  row = {},
  { saleModeSettings = {}, normalPrice = resolveMetaCatalogCurrentPrice(row) } = {}
) => {
  if (!(normalPrice > 0)) return 0;
  const effective = resolveEffectiveCustomerPrice({
    product: definedOnly({
      id: row.product_id,
      product_id: row.product_id,
      category_id: row.category_id,
      brand_id: row.brand_id,
      selling_price: normalPrice,
      sale_price: row.product_sale_price,
      sale_price_enabled: row.product_sale_price_enabled,
      sale_start_at: row.product_sale_start_at,
      sale_end_at: row.product_sale_end_at,
      cost_price: row.product_cost_price,
      is_offer_story: row.product_is_offer_story,
      is_offer: row.product_is_offer,
      show_in_offers: row.product_show_in_offers,
      promotion_enabled: row.product_promotion_enabled,
    }),
    variant: definedOnly({
      // The winning invoice line's sale price, else the column — exactly the storefront payload.
      sale_price: row.variant_line_sale_price ?? row.variant_sale_price,
      sale_price_enabled: row.variant_sale_price_enabled,
      sale_start_at: row.variant_sale_start_at,
      sale_end_at: row.variant_sale_end_at,
      cost_price: row.variant_cost_price,
    }),
    saleModeSettings,
  });
  return effective.has_price ? effective.active_price : normalPrice;
};

const enabledFlag = (value) =>
  value === true || value === 1 || String(value || "").trim().toLowerCase() === "true";

// Keep compare-at priority in parity with resolveProductDetailsPricing.
export const resolveMetaCatalogComparePrice = (row = {}, currentPrice = resolveMetaCatalogCurrentPrice(row)) => {
  const comparePrice = pickPrice(
    enabledFlag(row.use_custom_compare_price) ? row.custom_compare_price : 0,
    row.product_compare_at_price,
    row.product_original_price,
    row.product_list_price,
    row.product_compare_base_price,
    row.variant_compare_at_price,
    row.variant_original_price,
    row.variant_list_price,
    row.variant_compare_base_price
  );
  return comparePrice > currentPrice ? comparePrice : 0;
};

export const buildMetaCatalogItem = (
  row,
  { storefrontUrl = DEFAULT_STOREFRONT_URL, backendUrl = DEFAULT_BACKEND_URL, saleModeSettings = {} } = {}
) => {
  const productId = text(row.product_id);
  const variantId = text(row.variant_id);
  const sku = text(row.variant_sku);
  const id = sku && Number(row.sku_count || 0) === 1 ? sku : `${productId}-${variantId}`;
  const brand = text(row.brand_name || "M1 Store");
  const color = text(row.color);
  const size = text(row.size);
  // The size lives in <g:size>, never in the title: Meta prints the title on the ad card,
  // and "Nike V2K - White & Pink - 39" reads like a stockroom row to a customer.
  const titleParts = [row.product_name, color].map(text).filter(Boolean);
  const audience = resolveProductAudience(row);
  const normalPrice = resolveMetaCatalogCurrentPrice(row);
  const sellingPrice = resolveMetaCatalogActivePrice(row, { saleModeSettings, normalPrice });
  // A live offer makes the normal price the strikethrough, even where no custom compare is set.
  const comparePrice = Math.max(
    resolveMetaCatalogComparePrice(row, sellingPrice),
    sellingPrice < normalPrice ? normalPrice : 0
  );
  const categories = resolveMetaProductCategories(row);
  const fallbackImage = absoluteUrl(DEFAULT_PRODUCT_IMAGE_PATH, storefrontUrl);
  const productImage = absoluteUrl(row.product_image_url, backendUrl);
  const image = absoluteUrl(row.primary_color_image || row.variant_image_url || row.product_image_url, backendUrl) || fallbackImage;
  const gallery = [
    ...(Array.isArray(row.color_gallery) ? row.color_gallery.map(galleryImageUrl).filter(Boolean) : []),
    ...parseGalleryImages(row.gallery_images),
  ]
    .map((url) => absoluteUrl(url, backendUrl))
    .filter((url) => url && url !== image && url !== productImage);

  const item = {
    id,
    // Not emitted: what the customer pays, so a size with no price anywhere can be dropped.
    active_price: sellingPrice,
    item_group_id: metaItemGroupId(row),
    title: titleParts.join(" - "),
    description: text(row.description || row.product_name),
    link: buildMetaProductUrl(row, { storefrontUrl }),
    image_link: image || productImage,
    additional_image_link: [...new Set(gallery)].slice(0, 10),
    availability: Number(row.variant_stock || 0) > 0 ? "in stock" : "out of stock",
    price: formatPrice(comparePrice || sellingPrice),
    currency: "EGP",
    brand,
    color,
    size,
    gender: audience.gender,
    age_group: audience.age_group,
    google_product_category: categories.googleProductCategory,
    fb_product_category: categories.facebookProductCategory,
  };
  if (comparePrice > sellingPrice && sellingPrice > 0) {
    item.sale_price = formatPrice(sellingPrice);
  }
  return item;
};

export const metaCatalogItemXml = (item) => {
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
${item.sale_price ? `      <g:sale_price>${xml(item.sale_price)}</g:sale_price>\n` : ""}      <g:brand>${xml(item.brand)}</g:brand>
${item.google_product_category ? `      <g:google_product_category>${xml(item.google_product_category)}</g:google_product_category>\n` : ""}${item.fb_product_category ? `      <g:fb_product_category>${xml(item.fb_product_category)}</g:fb_product_category>\n` : ""}      <g:currency>${xml(item.currency)}</g:currency>
      <g:color>${xml(item.color)}</g:color>
      <g:size>${xml(item.size)}</g:size>
${item.gender ? `      <g:gender>${xml(item.gender)}</g:gender>\n` : ""}${item.age_group ? `      <g:age_group>${xml(item.age_group)}</g:age_group>\n` : ""}      <g:condition>new</g:condition>
    </item>`;
};

/*
  Meta downloads and decodes every image itself, and it cannot read WebP — a
  perfectly reachable .webp master reads to Meta as a missing or corrupt file,
  which is an ineligible item with no useful error. Swap in the JPEG rendition
  of anything it cannot read. The swap only ever serves renditions that already
  exist; the ones still missing are made in the background so no crawl waits on
  sharp, and the next build picks them up.
*/
let warmUpInFlight = false;

export const applyMetaReadableImages = async (items = [], { warm = true } = {}) => {
  const sources = new Set();
  for (const item of items) {
    if (item.image_link) sources.add(item.image_link);
    for (const url of item.additional_image_link || []) sources.add(url);
  }

  const mapping = new Map();
  await Promise.all([...sources].map(async (url) => {
    mapping.set(url, await metaCatalogImageUrl(url));
  }));

  const readable = (url) => mapping.get(url) || url;
  for (const item of items) {
    if (item.image_link) item.image_link = readable(item.image_link);
    if (Array.isArray(item.additional_image_link)) {
      item.additional_image_link = [...new Set(item.additional_image_link.map(readable))];
    }
  }

  if (warm && !warmUpInFlight) {
    // Deliberately not awaited: the crawl gets today's renditions, tomorrow's
    // crawl gets the ones being made right now. One at a time, so overlapping
    // crawls cannot stack sharp runs on top of each other.
    warmUpInFlight = true;
    warmMetaCatalogImageRenditions([...sources])
      .finally(() => {
        warmUpInFlight = false;
      })
      .then((summary) => {
        if (summary.converted || summary.failed) console.log("[meta-catalog-feed] jpeg renditions warmed", summary);
      })
      .catch((error) => {
        console.error("[meta-catalog-feed] jpeg rendition warm-up failed", { error: error?.message || String(error) });
      });
  }

  return items;
};

/*
  A build is ~9s of query plus the XML for 8,760 items, and Meta re-crawls on its own schedule
  while our own checks pull the same url. Without a cache every one of those pays the full build,
  and a build that drifts past the query read timeout answers 500 — which is exactly what happened
  once. The TTL matches the Cache-Control the route already sends.
*/
export const META_FEED_TTL_MS = 15 * 60 * 1000;
let feedCache = null;

export const clearMetaCatalogFeedCache = () => {
  feedCache = null;
};

export const buildMetaCatalogFeed = async ({ warmImages = true, force = false } = {}) => {
  if (!force && feedCache && Date.now() - feedCache.generatedAt < META_FEED_TTL_MS) return feedCache;
  try {
    return await rebuildMetaCatalogFeed({ warmImages });
  } catch (error) {
    // A stale catalogue beats a 500: Meta treats a failed fetch as an error against the feed,
    // and the rows it already has are still mostly true.
    if (feedCache) {
      console.error("[meta-catalog-feed] rebuild failed; serving the last good copy", {
        error: error?.message || String(error),
        generated_at: new Date(feedCache.generatedAt).toISOString(),
      });
      return feedCache;
    }
    throw error;
  }
};

const rebuildMetaCatalogFeed = async ({ warmImages = true } = {}) => {
  const storefrontUrl = storefrontBaseUrl() || DEFAULT_STOREFRONT_URL;
  const backendUrl = text(process.env.PUBLIC_BACKEND_URL || process.env.API_PUBLIC_URL || DEFAULT_BACKEND_URL).replace(/\/+$/g, "");
  const rows = await queryMetaCatalogRows();
  // Loaded once: without it every row falls back to "Sale OFF" and a running sale is under-quoted.
  // Every catalogue row belongs to tenant 1 and the storefront serves the same default, so the
  // feed and the shop answer "is a sale running" from one row of website_settings.
  const saleModeSettings = await loadTenantSaleModeSettings({ tenantId: FEED_TENANT_ID });
  // A size with no price anywhere — not its own, not its product's, not its colour's invoice —
  // cannot be bought online, and the only number left to print is its strikethrough price: product
  // 221 was advertised at 950 while its sizes sell at 700. Google's feed already drops these.
  const items = rows
    .map((row) => buildMetaCatalogItem(row, { storefrontUrl, backendUrl, saleModeSettings }))
    .filter((item) => item.active_price > 0);
  await applyMetaReadableImages(items, { warm: warmImages });
  const body = items.map(metaCatalogItemXml).join("\n");

  feedCache = {
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
    generatedAt: Date.now(),
  };
  return feedCache;
};
