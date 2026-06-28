import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const toTenantId = (value) => Number(value) || 0;

const normalizePlatform = (value = "") => (lower(value) === "instagram" ? "instagram" : "facebook");

const isNotEmpty = (value = "") => Boolean(text(value));

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";

const getPostIdentityCandidates = ({ postId = "", row = {}, post = {} } = {}) => {
  const safeRow = row && typeof row === "object" ? row : {};
  const safePost = post && typeof post === "object" ? post : {};
  const safeRowMetadata = safeRow.metadata && typeof safeRow.metadata === "object" ? safeRow.metadata : {};
  const safePostMetadata = safePost.metadata && typeof safePost.metadata === "object" ? safePost.metadata : {};
  return Array.from(
    new Set(
      [
        postId,
        safeRow.canonical_post_id,
        safeRow.platform_post_id,
        safeRow.post_id,
        safeRow.wrapper_post_id,
        safeRow.internal_post_id,
        safeRow.source_post_id,
        safeRow.conversation_id,
        safeRow.external_conversation_id,
        safeRowMetadata.post_id,
        safeRowMetadata.platform_post_id,
        safeRowMetadata.external_post_id,
        safeRowMetadata.wrapper_post_id,
        safeRowMetadata.internal_post_id,
        safeRowMetadata.conversation_id,
        safePost.canonical_post_id,
        safePost.platform_post_id,
        safePost.post_id,
        safePost.wrapper_post_id,
        safePost.internal_post_id,
        safePost.source_post_id,
        safePost.conversation_id,
        safePost.external_conversation_id,
        safePostMetadata.post_id,
        safePostMetadata.platform_post_id,
        safePostMetadata.external_post_id,
        safePostMetadata.wrapper_post_id,
        safePostMetadata.internal_post_id,
        safePostMetadata.conversation_id,
      ]
        .map(text)
        .filter(Boolean)
    )
  );
};

const getPlatformPostId = ({ postId = "", row = {}, post = {}, platform = "" } = {}) =>
  firstText(
    postId,
    row?.canonical_post_id,
    row?.platform_post_id,
    row?.post_id,
    row?.metadata?.post_id,
    row?.metadata?.platform_post_id,
    post?.canonical_post_id,
    post?.platform_post_id,
    post?.post_id,
    post?.metadata?.post_id,
    post?.metadata?.platform_post_id
  ) || text(postId || row?.post_id || post?.post_id || "");

const normalizeProductRow = (row = {}) => {
  const stock = Number(row.stock ?? row.total_stock ?? row.available_stock ?? 0);
  const primarySlug = text(row.canonical_slug || row.slug || "");
  const productUrl = primarySlug ? `/shop/product/${encodeURIComponent(primarySlug)}` : (text(row.id) ? `/shop/product/${encodeURIComponent(text(row.id))}` : "");
  return {
    id: row.id ?? row.product_id ?? null,
    product_id: row.product_id ?? row.id ?? null,
    name: text(row.name || row.product_name || ""),
    brand_name: text(row.brand_name || row.brand || row.manufacturer_name || row.manufacturer || ""),
    brand: text(row.brand_name || row.brand || row.manufacturer_name || row.manufacturer || ""),
    image_url: text(row.image_url || row.product_image_url || row.primary_image_url || row.cover_image_url || row.thumbnail_url || ""),
    price: Number(row.price ?? row.selling_price ?? row.regular_price ?? 0) || 0,
    sale_price: Number(row.sale_price ?? 0) || 0,
    selling_price: Number(row.selling_price ?? row.price ?? 0) || 0,
    stock,
    stock_status: stock > 0 ? "in_stock" : "out_of_stock",
    sizes: Array.isArray(row.available_sizes)
      ? row.available_sizes.map(text).filter(Boolean)
      : text(row.product_sizes || row.sizes || "").split(",").map(text).filter(Boolean),
    available_sizes: Array.isArray(row.available_sizes)
      ? row.available_sizes.map(text).filter(Boolean)
      : text(row.product_sizes || row.sizes || "").split(",").map(text).filter(Boolean),
    colors: Array.isArray(row.available_colors)
      ? row.available_colors.map(text).filter(Boolean)
      : text(row.product_colors || row.colors || "").split(",").map(text).filter(Boolean),
    available_colors: Array.isArray(row.available_colors)
      ? row.available_colors.map(text).filter(Boolean)
      : text(row.product_colors || row.colors || "").split(",").map(text).filter(Boolean),
    product_url: text(row.product_url || productUrl),
    slug: text(row.slug || ""),
    canonical_slug: primarySlug,
    priority: Number(row.priority ?? 1) || 1,
    is_primary: Boolean(row.is_primary),
    platform: normalizePlatform(row.platform || ""),
    platform_post_id: text(row.platform_post_id || row.post_id || row.media_id || ""),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

const ensurePostProductMappingSchema = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketing_post_product_links (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      platform TEXT NOT NULL,
      platform_post_id TEXT NOT NULL,
      product_id BIGINT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      is_primary BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, platform, platform_post_id, product_id)
    )
  `);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS platform_post_id TEXT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS business_id BIGINT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS post_id TEXT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS media_id TEXT`);
  await db.query(`ALTER TABLE IF EXISTS marketing_post_product_links ADD COLUMN IF NOT EXISTS created_by BIGINT`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_post_product_links_unique_canonical
    ON marketing_post_product_links (tenant_id, platform, platform_post_id, product_id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_marketing_post_product_links_lookup
    ON marketing_post_product_links (tenant_id, platform, platform_post_id, priority, is_primary, updated_at DESC, id DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_marketing_post_product_links_legacy_lookup
    ON marketing_post_product_links (business_id, platform, post_id, media_id, product_id)
  `);
};

const fetchProductsByIds = async ({ tenantId = null, productIds = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  if (!safeTenantId || !safeProductIds.length) return [];
  const query = `
    SELECT
      p.id,
      p.name,
      p.slug,
      p.canonical_slug,
      p.image_url,
      p.price,
      p.sale_price,
      p.selling_price,
      p.stock,
      p.tenant_id,
      b.name AS brand_name,
      b.slug AS brand_slug,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
        FROM product_variants v
        WHERE v.tenant_id = p.tenant_id
          AND v.product_id = p.id
      ), '') AS product_sizes,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
        FROM product_variants v
        WHERE v.tenant_id = p.tenant_id
          AND v.product_id = p.id
      ), '') AS product_colors
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.tenant_id = $1::bigint
      AND p.id = ANY($2::bigint[])
    ORDER BY p.id ASC
  `;
  const primaryRows = await db.query(query, [safeTenantId, safeProductIds]).catch(() => ({ rows: [] }));
  if (primaryRows.rows?.length) return primaryRows.rows;
  const fallbackRows = await db.query(query.replace("WHERE p.tenant_id = $1::bigint", "WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)"), [null, safeProductIds]).catch(() => ({ rows: [] }));
  return fallbackRows.rows || [];
};

const fetchLinkRows = async ({ tenantId = null, platform = "", post = {}, postId = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform || post?.platform || "");
  const candidatePostIds = getPostIdentityCandidates({ postId, row: post, post });
  if (!safeTenantId || !candidatePostIds.length) return [];
  const result = await db.query(
    `
    SELECT *
    FROM marketing_post_product_links
    WHERE (
        tenant_id = $1::bigint
        OR business_id = $1::bigint
      )
      AND platform = $2::text
      AND (
        platform_post_id = ANY($3::text[])
        OR post_id = ANY($3::text[])
        OR media_id = ANY($3::text[])
      )
    ORDER BY is_primary DESC, priority ASC, updated_at DESC, id DESC
    `,
    [safeTenantId, normalizedPlatform, candidatePostIds]
  ).catch(() => ({ rows: [] }));
  return result.rows || [];
};

const mapRowsToLinkedProducts = async ({ tenantId = null, platform = "", post = {}, postId = "" } = {}) => {
  const rows = await fetchLinkRows({ tenantId, platform, post, postId });
  if (!rows.length) {
    return {
      linked_products: [],
      primary_product: null,
      count: 0,
      post_id: getPlatformPostId({ tenantId, platform, post, postId }),
      platform: normalizePlatform(platform || post?.platform || ""),
      tenant_id: toTenantId(tenantId) || null,
    };
  }

  const products = await fetchProductsByIds({
    tenantId,
    productIds: rows.map((row) => row.product_id),
  });
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const linkedProducts = rows.map((row) => {
    const product = normalizeProductRow({
      ...(productById.get(String(row.product_id)) || {}),
      id: row.product_id,
      product_id: row.product_id,
      platform: row.platform,
      platform_post_id: row.platform_post_id || row.post_id || row.media_id || "",
      priority: row.priority,
      is_primary: row.is_primary,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    return {
      ...product,
      priority: Number(row.priority ?? 1) || 1,
      is_primary: Boolean(row.is_primary),
      platform: normalizePlatform(row.platform || platform || ""),
      platform_post_id: text(row.platform_post_id || row.post_id || row.media_id || ""),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    };
  });

  const primaryProduct = linkedProducts.find((item) => item.is_primary) || linkedProducts[0] || null;
  return {
    linked_products: linkedProducts,
    primary_product: primaryProduct,
    count: linkedProducts.length,
    post_id: getPlatformPostId({ tenantId, platform, post, postId }),
    platform: normalizePlatform(platform || post?.platform || ""),
    tenant_id: toTenantId(tenantId) || null,
  };
};

export const getMappings = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {} } = {}) => {
  await ensurePostProductMappingSchema();
  const safeTenantId = toTenantId(tenantId || row?.tenant_id || post?.tenant_id || 0);
  const normalizedPlatform = normalizePlatform(platform || row?.platform || post?.platform || "");
  const identityPostId = getPlatformPostId({ tenantId: safeTenantId, platform: normalizedPlatform, post: post || row || {}, postId: postId || row?.post_id || "" });
  return mapRowsToLinkedProducts({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    post: row || post || {},
    postId: identityPostId,
  });
};

export const resolveMappedProducts = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {} } = {}) => {
  const mappings = await getMappings({ tenantId, platform, postId, row, post });
  return mappings.linked_products || [];
};

export const resolvePrimaryProduct = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {} } = {}) => {
  const mappings = await getMappings({ tenantId, platform, postId, row, post });
  return mappings.primary_product || null;
};

export const saveMappings = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {}, productIds = [], primaryProductId = null, userId = null } = {}) => {
  await ensurePostProductMappingSchema();
  const safeTenantId = toTenantId(tenantId || row?.tenant_id || post?.tenant_id || 0);
  const normalizedPlatform = normalizePlatform(platform || row?.platform || post?.platform || "");
  const platformPostId = getPlatformPostId({ tenantId: safeTenantId, platform: normalizedPlatform, post: post || row || {}, postId: postId || row?.post_id || "" });
  const safeProductIds = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
  const primaryId = Number(primaryProductId ?? safeProductIds[0] ?? 0) || null;
  const candidatePostIds = getPostIdentityCandidates({ postId: platformPostId, row, post });
  if (!safeTenantId || !platformPostId) return mapRowsToLinkedProducts({ tenantId: safeTenantId, platform: normalizedPlatform, post, postId: platformPostId });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (candidatePostIds.length) {
      await client.query(
        `
        DELETE FROM marketing_post_product_links
        WHERE (
            tenant_id = $1::bigint
            OR business_id = $1::bigint
          )
          AND platform = $2::text
          AND (
            platform_post_id = ANY($3::text[])
            OR post_id = ANY($3::text[])
            OR media_id = ANY($3::text[])
          )
        `,
        [safeTenantId, normalizedPlatform, candidatePostIds]
      );
    }

    for (let index = 0; index < safeProductIds.length; index += 1) {
      const productId = safeProductIds[index];
      const isPrimary = primaryId ? Number(primaryId) === Number(productId) : index === 0;
      await client.query(
        `
        INSERT INTO marketing_post_product_links (
          tenant_id,
          business_id,
          platform,
          platform_post_id,
          post_id,
          media_id,
          product_id,
          priority,
          is_primary,
          created_by,
          updated_at,
          created_at
        )
        VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::text, $7::bigint, $8::integer, $9::boolean, $10::bigint, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, platform, platform_post_id, product_id)
        DO UPDATE SET
          business_id = EXCLUDED.business_id,
          post_id = EXCLUDED.post_id,
          media_id = EXCLUDED.media_id,
          priority = EXCLUDED.priority,
          is_primary = EXCLUDED.is_primary,
          created_by = COALESCE(marketing_post_product_links.created_by, EXCLUDED.created_by),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          safeTenantId,
          safeTenantId,
          normalizedPlatform,
          platformPostId,
          platformPostId,
          normalizedPlatform === "instagram" ? platformPostId : "",
          productId,
          index + 1,
          isPrimary,
          userId ? Number(userId) : null,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return getMappings({ tenantId: safeTenantId, platform: normalizedPlatform, postId: platformPostId, row, post });
};

export const removeMapping = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {}, productId = null } = {}) => {
  await ensurePostProductMappingSchema();
  const safeTenantId = toTenantId(tenantId || row?.tenant_id || post?.tenant_id || 0);
  const normalizedPlatform = normalizePlatform(platform || row?.platform || post?.platform || "");
  const platformPostId = getPlatformPostId({ tenantId: safeTenantId, platform: normalizedPlatform, post: post || row || {}, postId: postId || row?.post_id || "" });
  const candidatePostIds = getPostIdentityCandidates({ postId: platformPostId, row, post });
  if (!safeTenantId || !platformPostId || !candidatePostIds.length) {
    return mapRowsToLinkedProducts({ tenantId: safeTenantId, platform: normalizedPlatform, post, postId: platformPostId });
  }
  const productIdValue = Number(productId || 0);
  if (Number.isFinite(productIdValue) && productIdValue > 0) {
    await db.query(
      `
      DELETE FROM marketing_post_product_links
      WHERE (
          tenant_id = $1::bigint
          OR business_id = $1::bigint
        )
        AND platform = $2::text
        AND product_id = $3::bigint
        AND (
          platform_post_id = ANY($4::text[])
          OR post_id = ANY($4::text[])
          OR media_id = ANY($4::text[])
        )
      `,
      [safeTenantId, normalizedPlatform, productIdValue, candidatePostIds]
    );
  } else {
    await db.query(
      `
      DELETE FROM marketing_post_product_links
      WHERE (
          tenant_id = $1::bigint
          OR business_id = $1::bigint
        )
        AND platform = $2::text
        AND (
          platform_post_id = ANY($3::text[])
          OR post_id = ANY($3::text[])
          OR media_id = ANY($3::text[])
        )
      `,
      [safeTenantId, normalizedPlatform, candidatePostIds]
    );
  }
  return mapRowsToLinkedProducts({ tenantId: safeTenantId, platform: normalizedPlatform, post, postId: platformPostId });
};

export default {
  ensurePostProductMappingSchema,
  getMappings,
  saveMappings,
  removeMapping,
  resolveMappedProducts,
  resolvePrimaryProduct,
};
