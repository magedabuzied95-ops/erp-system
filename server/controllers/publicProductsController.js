import db from "../database/db.js";
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
import { normalizeAttributionPlatform } from "../utils/marketingAttribution.js";
import { isMirrorProduct, mirrorProductTitle, slugifyEdition } from "../utils/mirrorProduct.js";

const normalizeProductRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id || null,
  name: row.name || "",
  sku: row.sku || "",
  barcode: row.barcode || "",
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
  gender: row.gender || "",
  product_type: row.product_type || "",
  style: row.style || "",
  grade: row.grade || "",
});

const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";

const productSeoTitle = (product = {}) => firstText(product.meta_title, product.seo_title, product.name, "Product");
const productSeoDescription = (product = {}) => firstText(product.seo_description, product.description_en, product.description_ar, product.description, product.name);

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
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_name TEXT`);
  await db.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_slug TEXT`);
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

export const getPublicProductById = async (req, res) => {
  try {
    await ensurePublicProductEditionSchema();
    await ensureProductVariantImagesSchema();
    const result = await db.query(
      `
      SELECT
        p.*,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS public_image_url
      FROM products p
      WHERE p.id = $1::bigint
      LIMIT 1
      `,
      [req.params.id]
    );

    const product = result.rows[0];
    if (!product) {
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
      slug: `${normalizedProduct.id}-${encodeURIComponent(String(normalizedProduct.name || "product").replace(/\s+/g, "-"))}`,
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
    const result = await db.query(
      `
      SELECT
        p.*,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS public_image_url
      FROM products p
      WHERE (
          CASE WHEN split_part($1::text, '-', 1) ~ '^[0-9]+$'
            THEN p.id = split_part($1::text, '-', 1)::bigint
            ELSE FALSE
          END
        )
        OR p.canonical_slug = $1::text
      LIMIT 1
      `,
      [req.params.slug || req.params.id]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Product not found" });
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
    const result = await db.query(
      `
      SELECT
        p.*,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS public_image_url
      FROM products p
      WHERE (
          CASE WHEN split_part($1::text, '-', 1) ~ '^[0-9]+$'
            THEN p.id = split_part($1::text, '-', 1)::bigint
            ELSE FALSE
          END
        )
        OR p.canonical_slug = $1::text
      LIMIT 1
      `,
      [req.params.slug || req.params.id]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Product not found" });
    const normalizedProduct = normalizeProductRow(row);
    const product = await withSocialMetadata({
      ...normalizedProduct,
      slug: `${normalizedProduct.id}-${encodeURIComponent(String(normalizedProduct.name || "product").replace(/\s+/g, "-"))}`,
      seo_title: mirrorProductTitle(normalizedProduct),
    }, req);
    res.json({ success: true, product, meta: product.social_meta });
  } catch (error) {
    console.error("[public-products] share metadata error", error);
    res.status(500).json({ success: false, message: "Failed to load product share metadata" });
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
