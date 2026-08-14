import db from "../database/db.js";
import { resolveSocialPostLinkKey as resolveSharedSocialPostLinkKey } from "../../shared/socialPostProductLinkIdentity.js";
import { resolveSocialPostCanonicalIdentity } from "./socialPostIdentityService.js";
import { collectDirectLinkIdentity } from "./postProductMappingService.js";

const text = (value = "") => String(value ?? "").trim();
const toTenantId = (value) => Number(value) || 0;
const normalizePlatform = (value = "") => (text(value).toLowerCase().includes("instagram") ? "instagram" : "facebook");
const stockValue = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return 0;
};

// Part of the catalogue prices only its variants, so a product-only lookup returns 0 for
// them. The pricing contract says a variant beats the product at every tier; this picks
// the cheapest priced variant, which is what a shopper is quoted as "starting from".
const fetchCheapestPricedVariants = async ({ tenantId = null, productIds = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : [])
    .map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  if (!safeTenantId || !safeProductIds.length) return new Map();
  const result = await db.query(
    `
    SELECT DISTINCT ON (v.product_id) v.*
    FROM product_variants v
    WHERE v.tenant_id = $1::bigint
      AND v.product_id = ANY($2::bigint[])
      AND COALESCE(
        NULLIF(v.purchase_selling_price, 0), NULLIF(v.selling_price, 0),
        NULLIF(v.price, 0), NULLIF(v.regular_price, 0)
      ) IS NOT NULL
    ORDER BY v.product_id ASC,
      COALESCE(NULLIF(v.purchase_selling_price, 0), NULLIF(v.selling_price, 0),
               NULLIF(v.price, 0), NULLIF(v.regular_price, 0)) ASC
    `,
    [safeTenantId, safeProductIds]
  ).catch(() => ({ rows: [] }));
  return new Map((Array.isArray(result.rows) ? result.rows : []).map((row) => [Number(row.product_id), row]));
};

// The catalogue's live price lives in purchase_selling_price / sale_price (+ the global
// sale-mode gate), NOT in the legacy price / selling_price columns, which are 0.00 for
// most products. Reading those legacy columns is what made linked products show
// "— PRICE" here and quote "السعر: 0.00" to customers. resolveEffectiveCustomerPrice is
// the same authority POS and the AI grounding gate use.
const resolveRowPricing = async ({ tenantId = null, rows = [] } = {}) => {
  const pricingById = new Map();
  if (!Array.isArray(rows) || !rows.length) return pricingById;
  try {
    const [{ resolveEffectiveCustomerPrice }, { loadTenantSaleModeSettings }] = await Promise.all([
      import("../../src/shared/lib/effectiveCustomerPrice.js"),
      import("../utils/customerDisplayPrice.js"),
    ]);
    const saleModeSettings = await loadTenantSaleModeSettings({ tenantId }).catch(() => ({ sale_mode_enabled: false }));
    const variantsByProductId = await fetchCheapestPricedVariants({
      tenantId,
      productIds: rows.map((row) => Number(row.id)),
    });
    for (const row of rows) {
      const productOnly = resolveEffectiveCustomerPrice({ product: row, variant: null, saleModeSettings });
      // Only reach for a variant when the product itself carries no price, so a normally
      // priced product keeps quoting its own price rather than its cheapest variant.
      const resolved = productOnly.has_price
        ? productOnly
        : resolveEffectiveCustomerPrice({
            product: row,
            variant: variantsByProductId.get(Number(row.id)) || null,
            saleModeSettings,
          });
      pricingById.set(Number(row.id), resolved);
    }
  } catch {
    // Pricing is best-effort: a failure leaves the legacy columns in place rather than
    // breaking the whole product-link listing.
  }
  return pricingById;
};

const normalizeProductRow = (row = {}, pricing = null) => {
  const currentStock = stockValue(
    row.current_stock,
    row.total_stock,
    row.variant_total_stock,
    row.available_stock,
    row.stock,
    row.inventory_stock,
    row.stock_quantity,
    row.variant_stock
  );
  const stockLabel = currentStock > 0 ? "IN STOCK" : "OUT OF STOCK";
  const legacyPrice = Number(row.price ?? row.selling_price ?? row.regular_price ?? 0) || 0;
  const activePrice = Number(pricing?.active_price ?? 0) || 0;
  const normalPrice = Number(pricing?.normal_price ?? 0) || 0;
  const effectivePrice = activePrice || legacyPrice;
  return {
    id: Number(row.id ?? row.product_id ?? 0) || 0,
    product_id: Number(row.id ?? row.product_id ?? 0) || 0,
    name: text(row.name || row.title || row.product_name || ""),
    title: text(row.title || row.name || row.product_name || ""),
    image_url: text(row.image_url || row.product_image_url || row.cover_image_url || row.primary_image_url || row.thumbnail_url || ""),
    price: effectivePrice,
    final_price: effectivePrice,
    sale_price: Number(pricing?.sale_price ?? row.sale_price ?? 0) || 0,
    regular_price: normalPrice || Number(row.regular_price ?? 0) || 0,
    selling_price: effectivePrice || Number(row.selling_price ?? row.price ?? 0) || 0,
    compare_price: Number(pricing?.compare_price ?? 0) || 0,
    sale_mode_applied: Boolean(pricing?.sale_mode_applied),
    has_price: pricing ? Boolean(pricing.has_price) : effectivePrice > 0,
    // Identity/spec fields the linked-product card shows next to the price.
    sku: text(row.sku || row.product_code || row.code || row.article || row.article_no || ""),
    model: text(row.model || row.model_name || ""),
    product_type: text(row.product_type || row.type || ""),
    gender: text(row.gender || ""),
    color: text(row.color || row.colour || ""),
    stock: currentStock,
    current_stock: currentStock,
    total_stock: currentStock,
    available_stock: currentStock,
    in_stock: currentStock > 0,
    stock_label: stockLabel,
    stock_status: stockLabel,
    slug: text(row.slug || row.canonical_slug || ""),
    product_url: text(row.product_url || (row.slug ? `/shop/product/${encodeURIComponent(text(row.slug))}` : "")),
    storefront_url: text(row.storefront_url || row.product_url || ""),
    brand_name: text(row.brand_name || row.brand || ""),
  };
};

// Memoized: this ran three DDL statements on every call, and the posts list calls the
// lookup once per post, so listing 25 posts issued 75 CREATE ... IF NOT EXISTS round trips
// and took the matching locks each time.
let schemaReadyPromise = null;
const ensureSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchemaOnce().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const ensureSchemaOnce = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_post_product_links_v2 (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      business_id BIGINT NOT NULL,
      platform TEXT NOT NULL,
      post_link_key TEXT NOT NULL,
      canonical_post_id TEXT NULL,
      source_post_id TEXT NULL,
      permalink_post_id TEXT NULL,
      product_id BIGINT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_product_links_v2_unique ON social_post_product_links_v2 (business_id, platform, post_link_key, product_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_post_product_links_v2_lookup ON social_post_product_links_v2 (business_id, platform, post_link_key, is_primary, updated_at DESC, id DESC)`);
};

const fetchProductsByIds = async ({ tenantId = null, productIds = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  if (!safeTenantId || !safeProductIds.length) return [];
  const result = await db.query(
    `
    SELECT
      p.*,
      b.name AS brand_name,
      COALESCE(vs.current_stock, 0) AS current_stock,
      COALESCE(vs.current_stock, 0) AS variant_total_stock,
      COALESCE(vs.current_stock, 0) AS total_stock,
      COALESCE(vs.current_stock, 0) AS available_stock,
      CASE WHEN COALESCE(vs.current_stock, 0) > 0 THEN TRUE ELSE FALSE END AS in_stock,
      CASE WHEN COALESCE(vs.current_stock, 0) > 0 THEN 'IN STOCK' ELSE 'OUT OF STOCK' END AS stock_label,
      CASE WHEN COALESCE(vs.current_stock, 0) > 0 THEN 'IN STOCK' ELSE 'OUT OF STOCK' END AS stock_status
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(COALESCE(NULLIF(pv.stock::text, '')::numeric, 0)), 0) AS current_stock
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
    ) vs ON TRUE
    WHERE p.tenant_id = $1::bigint
      AND p.id = ANY($2::bigint[])
    ORDER BY p.id ASC
    `,
    [safeTenantId, safeProductIds]
  ).catch(() => ({ rows: [] }));
  return Array.isArray(result.rows) ? result.rows : [];
};

const hydrateProducts = async ({ tenantId = null, productIds = [] } = {}) => {
  const rows = await fetchProductsByIds({ tenantId, productIds });
  const pricingById = await resolveRowPricing({ tenantId, rows });
  const byId = new Map(rows.map((row) => [Number(row.id), normalizeProductRow(row, pricingById.get(Number(row.id)) || null)]));
  return Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)))
    .map((productId) => byId.get(Number(productId)))
    .filter(Boolean);
};

const readV2Rows = async ({ tenantId = null, platform = "", postLinkKeys = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safePostLinkKeys = uniqueTextValues(postLinkKeys);
  if (!safeTenantId || !safePostLinkKeys.length) return [];
  const result = await db.query(
    `
    SELECT *
    FROM social_post_product_links_v2
    WHERE business_id = $1::bigint
      AND platform = $2::text
      AND post_link_key = ANY($3::text[])
    ORDER BY array_position($3::text[], post_link_key) ASC NULLS LAST, is_primary DESC, updated_at DESC, id DESC
    `,
    [safeTenantId, normalizedPlatform, safePostLinkKeys]
  ).catch(() => ({ rows: [] }));
  return Array.isArray(result.rows) ? result.rows : [];
};

const uniqueTextValues = (values = []) => Array.from(new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean)));

const buildV2LookupIdentity = async ({ tenantId = null, platform = "", post = {}, postId = "", selectedPostId = "", postLinkKey = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const canonicalIdentity = await resolveSocialPostCanonicalIdentity({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: postId || post?.post_id || "",
    row: post,
    post,
    source: "socialPostProductLinksV2:getPostProductLinksV2",
  }).catch(() => null);
  const directIdentity = collectDirectLinkIdentity({
    postId: postId || post?.post_id || "",
    selectedPostId: selectedPostId || postId || post?.selected_post_id || "",
    canonicalPostId: canonicalIdentity?.canonical_post_id || "",
    row: post,
    post,
  });
  const requestedKey = text(postLinkKey || post?.post_link_key || directIdentity.primaryExactId || canonicalIdentity?.canonical_post_id || postId || selectedPostId || "");
  const candidateKeys = Array.from(new Set((directIdentity.lookupIds || []).map((value) => text(value)).filter(Boolean)));
  const allCandidateKeys = Array.from(new Set([
    requestedKey,
    canonicalIdentity?.canonical_post_id || "",
    ...(directIdentity.exactCandidates || []),
    ...(directIdentity.fallbackCandidates || []),
  ].map((value) => text(value)).filter(Boolean)));
  return {
    canonicalIdentity,
    directIdentity,
    requestedKey,
    candidateKeys: candidateKeys.length ? candidateKeys : allCandidateKeys,
    allCandidateKeys,
    platformPostId: text(directIdentity?.exactPlatformPostIds?.[0] || ""),
    sourcePostId: text(directIdentity?.exactSourcePostIds?.[0] || ""),
    permalinkPostId: text(directIdentity?.exactPermalinkPostIds?.[0] || ""),
  };
};

const mergeAliasRowsToPostLinkKey = async ({ tenantId = null, platform = "", authoritativePostLinkKey = "", aliasPostLinkKeys = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safeAuthoritativePostLinkKey = text(authoritativePostLinkKey);
  const safeAliasPostLinkKeys = uniqueTextValues(aliasPostLinkKeys).filter((value) => value !== safeAuthoritativePostLinkKey);
  if (!safeTenantId || !safeAuthoritativePostLinkKey || !safeAliasPostLinkKeys.length) {
    return { merged: 0, alias_post_link_keys: safeAliasPostLinkKeys, authoritative_post_link_key: safeAuthoritativePostLinkKey };
  }

  const client = await db.connect();
  let merged = 0;
  try {
    await client.query("BEGIN");
    for (const aliasPostLinkKey of safeAliasPostLinkKeys) {
      const aliasRows = await client.query(
        `
        SELECT tenant_id, business_id, platform, post_link_key, canonical_post_id, source_post_id, permalink_post_id, product_id, is_primary, created_at, updated_at
        FROM social_post_product_links_v2
        WHERE business_id = $1::bigint
          AND platform = $2::text
          AND post_link_key = $3::text
        `,
        [safeTenantId, normalizedPlatform, aliasPostLinkKey]
      ).catch(() => ({ rows: [] }));
      if (!Array.isArray(aliasRows.rows) || !aliasRows.rows.length) continue;
      await client.query(
        `
        INSERT INTO social_post_product_links_v2 (
          tenant_id,
          business_id,
          platform,
          post_link_key,
          canonical_post_id,
          source_post_id,
          permalink_post_id,
          product_id,
          is_primary,
          created_at,
          updated_at
        )
        SELECT
          tenant_id,
          business_id,
          platform,
          $4::text,
          canonical_post_id,
          source_post_id,
          permalink_post_id,
          product_id,
          is_primary,
          created_at,
          updated_at
        FROM social_post_product_links_v2
        WHERE business_id = $1::bigint
          AND platform = $2::text
          AND post_link_key = $3::text
        ON CONFLICT (business_id, platform, post_link_key, product_id) DO NOTHING
        `,
        [safeTenantId, normalizedPlatform, aliasPostLinkKey, safeAuthoritativePostLinkKey]
      );
      await client.query(
        `
        DELETE FROM social_post_product_links_v2
        WHERE business_id = $1::bigint
          AND platform = $2::text
          AND post_link_key = $3::text
        `,
        [safeTenantId, normalizedPlatform, aliasPostLinkKey]
      );
      merged += aliasRows.rows.length;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    merged,
    alias_post_link_keys: safeAliasPostLinkKeys,
    authoritative_post_link_key: safeAuthoritativePostLinkKey,
  };
};

export const ensureSocialPostProductLinksV2Schema = ensureSchema;
export const resolveSocialPostLinkKey = (input = {}) => resolveSharedSocialPostLinkKey(input);

// The posts list calls this once per post, and each call resolves the post identity, merges
// alias rows (a write), reads the link rows and hydrates the products — so listing 25 posts
// meant 25 of those. Results are cached per tenant+platform+post for a short window and any
// write invalidates the tenant, so linking a product still shows up immediately.
const POST_PRODUCT_LINKS_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.SOCIAL_POST_PRODUCT_LINKS_CACHE_TTL_MS || 30_000) || 30_000
);
const postProductLinksCache = new Map();
let postProductLinksCacheHits = 0;
let postProductLinksCacheMisses = 0;

const postProductLinksCacheKey = ({ tenantId, platform, postId, postLinkKey, selectedPostId, post }) => [
  toTenantId(tenantId) || 0,
  text(platform).toLowerCase(),
  text(postLinkKey || post?.post_link_key || ""),
  text(postId || post?.post_id || ""),
  text(selectedPostId || ""),
].join("|");

export const invalidatePostProductLinksCache = (tenantId = null) => {
  const safeTenantId = toTenantId(tenantId) || 0;
  if (!safeTenantId) {
    postProductLinksCache.clear();
    return;
  }
  const prefix = `${safeTenantId}|`;
  for (const key of postProductLinksCache.keys()) {
    if (key.startsWith(prefix)) postProductLinksCache.delete(key);
  }
};

export const getPostProductLinksCacheStats = () => ({
  entries: postProductLinksCache.size,
  hits: postProductLinksCacheHits,
  misses: postProductLinksCacheMisses,
  ttl_ms: POST_PRODUCT_LINKS_CACHE_TTL_MS,
});

export const getPostProductLinksV2 = async (input = {}) => {
  if (POST_PRODUCT_LINKS_CACHE_TTL_MS <= 0) return getPostProductLinksV2Uncached(input);
  const key = postProductLinksCacheKey(input);
  const entry = postProductLinksCache.get(key);
  const now = Date.now();
  // Share an in-flight lookup so one list request issues one query per post, not one per
  // caller that happens to want the same post.
  if (entry?.promise) {
    postProductLinksCacheHits += 1;
    return entry.promise;
  }
  if (entry && now - entry.at < POST_PRODUCT_LINKS_CACHE_TTL_MS) {
    postProductLinksCacheHits += 1;
    return entry.value;
  }
  postProductLinksCacheMisses += 1;
  const promise = getPostProductLinksV2Uncached(input);
  postProductLinksCache.set(key, { promise, at: now });
  try {
    const value = await promise;
    postProductLinksCache.set(key, { value, at: Date.now() });
    return value;
  } catch (error) {
    postProductLinksCache.delete(key);
    throw error;
  }
};

const getPostProductLinksV2Uncached = async ({ tenantId = null, platform = "", post = {}, postId = "", postLinkKey = "", selectedPostId = "", aliasPostLinkKeys = [] } = {}) => {
  await ensureSchema();
  const identity = resolveSocialPostLinkKey({
    tenant_id: tenantId,
    platform,
    ...post,
    post_id: postId || post?.post_id || "",
    selected_post_id: selectedPostId,
  });
  const lookupIdentity = await buildV2LookupIdentity({
    tenantId,
    platform,
    post,
    postId,
    selectedPostId,
    postLinkKey,
  });
  const authoritativePostLinkKey = text(postLinkKey || post?.post_link_key || lookupIdentity.requestedKey || identity.post_link_key);
  if (authoritativePostLinkKey) {
    await mergeAliasRowsToPostLinkKey({
      tenantId,
      platform,
      authoritativePostLinkKey,
      aliasPostLinkKeys: [identity.post_link_key, ...lookupIdentity.allCandidateKeys, postId, selectedPostId, ...aliasPostLinkKeys],
    }).catch(() => {});
  }
  const lookupKeys = uniqueTextValues([
    authoritativePostLinkKey,
    ...lookupIdentity.candidateKeys,
    identity.post_link_key,
  ]);
  const rows = await readV2Rows({ tenantId, platform, postLinkKeys: lookupKeys });
  const productIds = rows.map((row) => Number(row.product_id || 0)).filter((value) => Number.isFinite(value) && value > 0);
  console.info("SOCIAL_V2_PRODUCT_LINK_SQL_TRACE", {
    post_link_key: authoritativePostLinkKey || identity.post_link_key,
    canonical_post_id: text(lookupIdentity.canonicalIdentity?.canonical_post_id || identity.canonical_post_id || ""),
    platform_post_id: lookupIdentity.platformPostId,
    source_post_id: lookupIdentity.sourcePostId || text(identity.source_post_id || ""),
    permalink_post_id: lookupIdentity.permalinkPostId || text(identity.permalink_post_id || ""),
    queried_table: "social_post_product_links_v2",
    sql_matched_row_count: rows.length,
    matched_keys: uniqueTextValues(rows.map((row) => row.post_link_key)),
    product_ids: productIds,
  });
  if (text(lookupIdentity.canonicalIdentity?.canonical_post_id || "") && !rows.length) {
    console.info("SOCIAL_V2_PRODUCT_LINK_LOOKUP_MISS", {
      requested_key: authoritativePostLinkKey || identity.post_link_key,
      canonical_post_id: text(lookupIdentity.canonicalIdentity?.canonical_post_id || ""),
      all_candidate_keys: lookupKeys,
      queried_table: "social_post_product_links_v2",
      matched_rows: 0,
    });
  }
  const linkedProducts = await hydrateProducts({ tenantId, productIds });
  const primaryProduct = linkedProducts.find((item) => rows.find((row) => Number(row.product_id || 0) === Number(item.id) && row.is_primary)) || linkedProducts[0] || null;
  console.info("SOCIAL_V2_PRODUCT_LINK_READ_TRACE", {
    post_link_key: authoritativePostLinkKey || identity.post_link_key,
    canonical_post_id: text(lookupIdentity.canonicalIdentity?.canonical_post_id || identity.canonical_post_id || ""),
    platform_post_id: lookupIdentity.platformPostId,
    source_post_id: lookupIdentity.sourcePostId || text(identity.source_post_id || ""),
    permalink_post_id: lookupIdentity.permalinkPostId || text(identity.permalink_post_id || ""),
    returned_product_ids: productIds,
    source: "v2",
  });
  return {
    linked_products: linkedProducts,
    primary_product: primaryProduct,
    count: linkedProducts.length,
    product_ids: productIds,
    post_link_key: authoritativePostLinkKey || identity.post_link_key,
    canonical_post_id: text(lookupIdentity.canonicalIdentity?.canonical_post_id || identity.canonical_post_id || ""),
    platform: normalizePlatform(platform),
    tenant_id: toTenantId(tenantId) || null,
    post_identity: identity,
    linked_products_source: linkedProducts.length ? "v2" : "none",
    rejected_sources: [],
  };
};

export const savePostProductLinksV2 = async ({ tenantId = null, platform = "", post = {}, postId = "", postLinkKey = "", selectedPostId = "", aliasPostLinkKeys = [], productIds = [], primaryProductId = null } = {}) => {
  // A stale read here would leave the gear the wrong colour after linking a product.
  invalidatePostProductLinksCache(tenantId);
  await ensureSchema();
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const identity = resolveSocialPostLinkKey({
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    ...post,
    post_id: postId || post?.post_id || "",
    selected_post_id: selectedPostId,
  });
  const authoritativePostLinkKey = text(postLinkKey || post?.post_link_key || identity.post_link_key);
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  const primaryId = Number(primaryProductId ?? safeProductIds[0] ?? 0) || null;
  const client = await db.connect();
  let rowsAffected = 0;
  try {
    await client.query("BEGIN");
    if (authoritativePostLinkKey) {
      await mergeAliasRowsToPostLinkKey({
        tenantId: safeTenantId,
        platform: normalizedPlatform,
        authoritativePostLinkKey,
        aliasPostLinkKeys: [identity.post_link_key, postId, selectedPostId, ...aliasPostLinkKeys],
      }).catch(() => {});
    }
    await client.query(
      `
      DELETE FROM social_post_product_links_v2
      WHERE business_id = $1::bigint
        AND platform = $2::text
        AND post_link_key = $3::text
        AND product_id <> ALL($4::bigint[])
      `,
      [safeTenantId, normalizedPlatform, authoritativePostLinkKey || identity.post_link_key, safeProductIds.length ? safeProductIds : [0]]
    );
    if (!safeProductIds.length) {
      await client.query(
        `
        DELETE FROM social_post_product_links_v2
        WHERE business_id = $1::bigint
          AND platform = $2::text
          AND post_link_key = $3::text
        `,
        [safeTenantId, normalizedPlatform, authoritativePostLinkKey || identity.post_link_key]
      );
    } else {
      for (let index = 0; index < safeProductIds.length; index += 1) {
        const productId = safeProductIds[index];
        const isPrimary = primaryId ? Number(primaryId) === Number(productId) : index === 0;
        const result = await client.query(
          `
          INSERT INTO social_post_product_links_v2 (
            tenant_id,
            business_id,
            platform,
            post_link_key,
            canonical_post_id,
            source_post_id,
            permalink_post_id,
            product_id,
            is_primary,
            created_at,
            updated_at
          )
          VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::text, $7::text, $8::bigint, $9::boolean, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (business_id, platform, post_link_key, product_id) DO UPDATE SET
            canonical_post_id = EXCLUDED.canonical_post_id,
            source_post_id = EXCLUDED.source_post_id,
            permalink_post_id = EXCLUDED.permalink_post_id,
            is_primary = EXCLUDED.is_primary,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
          `,
          [
            safeTenantId,
            safeTenantId,
            normalizedPlatform,
            authoritativePostLinkKey || identity.post_link_key,
            identity.canonical_post_id || null,
            identity.source_post_id || null,
            identity.permalink_post_id || null,
            productId,
            isPrimary,
          ]
        );
        rowsAffected += Number(result.rowCount || 0) || 0;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const linkedProducts = await hydrateProducts({ tenantId: safeTenantId, productIds: safeProductIds });
  const primaryProduct = linkedProducts.find((item) => Number(item.id) === Number(primaryId)) || linkedProducts[0] || null;
  console.info("SOCIAL_V2_PRODUCT_LINK_SAVE_TRACE", {
    post_link_key: authoritativePostLinkKey || identity.post_link_key,
    submitted_product_ids: safeProductIds,
    saved_product_ids: linkedProducts.map((item) => Number(item.id)).filter((value) => Number.isFinite(value) && value > 0),
  });
  return {
    linked_products: linkedProducts,
    primary_product: primaryProduct,
    count: linkedProducts.length,
    product_ids: linkedProducts.map((item) => Number(item.id)).filter((value) => Number.isFinite(value) && value > 0),
    post_link_key: authoritativePostLinkKey || identity.post_link_key,
    canonical_post_id: identity.canonical_post_id,
    platform: normalizedPlatform,
    tenant_id: safeTenantId || null,
    post_identity: identity,
    linked_products_source: linkedProducts.length ? "v2" : "none",
    rejected_sources: [],
    rows_affected: rowsAffected,
  };
};

export const removePostProductLinksV2 = async ({ tenantId = null, platform = "", post = {}, postId = "", selectedPostId = "", productId = null } = {}) => {
  invalidatePostProductLinksCache(tenantId);
  await ensureSchema();
  const identity = resolveSocialPostLinkKey({
    tenant_id: tenantId,
    platform,
    ...post,
    post_id: postId || post?.post_id || "",
    selected_post_id: selectedPostId,
  });
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const postLinkKey = identity.post_link_key;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (productId) {
      await client.query(
        `
        DELETE FROM social_post_product_links_v2
        WHERE business_id = $1::bigint
          AND platform = $2::text
          AND post_link_key = $3::text
          AND product_id = $4::bigint
        `,
        [safeTenantId, normalizedPlatform, postLinkKey, Number(productId)]
      );
    } else {
      await client.query(
        `
        DELETE FROM social_post_product_links_v2
        WHERE business_id = $1::bigint
          AND platform = $2::text
          AND post_link_key = $3::text
        `,
        [safeTenantId, normalizedPlatform, postLinkKey]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getPostProductLinksV2({ tenantId, platform, post, postId, selectedPostId });
};

export const resolveMappedProductsV2 = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {} } = {}) => {
  const mapping = await getPostProductLinksV2({ tenantId, platform, post: post || row || {}, postId, selectedPostId: postId });
  return mapping.linked_products || [];
};

export const resolvePrimaryProductV2 = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {} } = {}) => {
  const mapping = await getPostProductLinksV2({ tenantId, platform, post: post || row || {}, postId, selectedPostId: postId });
  return mapping.primary_product || null;
};
