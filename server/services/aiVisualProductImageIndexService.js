import crypto from "node:crypto";

import db from "../database/db.js";
import { resolvePublicProductImageUrl } from "./aiProductCards.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const json = (value) => JSON.stringify(value === undefined ? null : value);
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

let schemaReadyPromise = null;

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

const columnExpr = (alias, columns, names, fallback = "''") => {
  const column = names.find((name) => columns.has(name));
  return column ? `${alias}.${column}` : fallback;
};

const normalizeVisualText = (value = "") =>
  lower(value)
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const unique = (items = [], limit = 60) =>
  [...new Set((Array.isArray(items) ? items : [items]).flatMap((item) => {
    if (Array.isArray(item)) return item;
    if (item && typeof item === "object") return Object.values(item);
    return String(item ?? "").split(/[,\s/|]+/);
  }).map(normalizeVisualText).filter(Boolean))].slice(0, limit);

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const firstImageValue = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(firstImageValue).find(Boolean) || "";
  if (typeof value === "object") {
    return text(value.secure_url || value.image_url || value.url || value.src || value.path || value.file_path || value.image || value.thumbnail_url);
  }
  return "";
};

const imageIdentity = (url = "") =>
  lower(url)
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+/g, "/");

const imagePublicId = (url = "") => {
  const clean = imageIdentity(url);
  const uploadIndex = clean.indexOf("/upload/");
  const afterUpload = uploadIndex >= 0 ? clean.slice(uploadIndex + "/upload/".length) : clean;
  return afterUpload
    .replace(/^v\d+\//, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/^\/+|\/+$/g, "");
};

const imageFileTokens = (url = "") =>
  unique(
    imageIdentity(url)
      .split("/")
      .pop()
      ?.replace(/\.[a-z0-9]{2,5}$/i, "")
      .split(/[-_\s.]+/) || []
  );

const hashBuffer = (buffer) =>
  buffer?.length ? crypto.createHash("sha256").update(buffer).digest("hex") : "";

const detectedBlob = (detected = {}) =>
  normalizeVisualText([
    detected.product_type,
    detected.category,
    detected.brand_guess,
    detected.brand_family,
    detected.brand,
    detected.likely_brand,
    detected.likely_model,
    detected.model_guess,
    detected.model_family,
    detected.model_keywords,
    detected.colors,
    detected.main_colors,
    detected.secondary_colors,
    detected.silhouette,
    detected.silhouette_style,
    detected.high_top_low_top,
    detected.sole_shape,
    detected.features,
    detected.distinctive_features,
    detected.english_keywords,
    detected.arabic_keywords,
  ].flatMap((item) => (Array.isArray(item) ? item : [item])).filter(Boolean).join(" "));

const deriveVisualMetadata = (row = {}) => {
  const imageUrl = resolvePublicProductImageUrl(row.image_url || row.secure_url || "");
  const blob = normalizeVisualText([
    row.product_name,
    row.product_slug,
    row.brand,
    row.category,
    row.product_type,
    row.style,
    row.tags,
    row.color,
    imagePublicId(imageUrl),
    ...imageFileTokens(imageUrl),
  ].filter(Boolean).join(" "));
  const visualTags = unique([
    blob,
    /\bjordan\b/.test(blob) ? "jordan air jordan" : "",
    /\bjordan\b/.test(blob) && /\b4\b|iv\b/.test(blob) ? "jordan 4 air jordan 4 aj4 j4" : "",
    /\bdunk\b|\blow\b|\bskate\b|\bcasual\b|\bcourt\b/.test(blob) ? "low low-top casual skate dunk style" : "",
    /\bblack\b/.test(blob) ? "black" : "",
    /\bwhite\b/.test(blob) ? "white" : "",
    /\bblack\b/.test(blob) && /\bwhite\b/.test(blob) ? "black white" : "",
    /\bgraphic\b|\bprinted\b|\bpattern\b|\bcomic\b|\bcartoon\b|\bpanel\b/.test(blob) ? "graphic side printed side pattern side panel" : "",
    /\bterrex\b|\btrail\b|\brunning\b|\bgoretex\b|\bhiking\b/.test(blob) ? "trail running outdoor chunky sole" : "",
  ]);
  return {
    visual_tags: visualTags,
    detected: {
      brand: text(row.brand),
      model: text(row.product_name),
      category: text(row.category || row.product_type),
      colors: unique([row.color, blob.includes("black") ? "black" : "", blob.includes("white") ? "white" : ""]).slice(0, 6),
      silhouette: /\bdunk\b|\blow\b|\bskate\b|\bcasual\b/.test(blob) ? "low casual skate sneaker" : /\bterrex\b|\btrail\b|\brunning\b/.test(blob) ? "trail running sneaker" : "",
      features: visualTags,
    },
    visual_text: normalizeVisualText(visualTags.join(" ")),
  };
};

export const ensureAiProductImageVisualIndexSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_product_image_visual_index (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          product_id BIGINT NOT NULL,
          variant_id BIGINT NULL,
          color TEXT NOT NULL DEFAULT '',
          image_url TEXT NOT NULL,
          image_public_id TEXT NOT NULL DEFAULT '',
          image_hash TEXT NOT NULL DEFAULT '',
          visual_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          detected_brand TEXT NOT NULL DEFAULT '',
          detected_model TEXT NOT NULL DEFAULT '',
          detected_category TEXT NOT NULL DEFAULT '',
          detected_colors TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          detected_silhouette TEXT NOT NULL DEFAULT '',
          detected_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          visual_text TEXT NOT NULL DEFAULT '',
          visual_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          image_embedding JSONB NULL,
          source TEXT NOT NULL DEFAULT 'erp',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_product_image_visual_index_tenant ON ai_product_image_visual_index (tenant_id, product_id, variant_id)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_product_image_visual_index_public_id ON ai_product_image_visual_index (tenant_id, image_public_id)`);
      await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ai_product_image_visual_index_unique_url ON ai_product_image_visual_index (tenant_id, product_id, COALESCE(variant_id, 0), LOWER(TRIM(image_url)))`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const loadProductImageRows = async (clientOrPool = db, { tenantId = null, productId = null } = {}) => {
  const [productColumns, variantColumns] = await Promise.all([
    tableColumns(clientOrPool, "products"),
    tableColumns(clientOrPool, "product_variants").catch(() => new Set()),
  ]);
  if (!productColumns.has("id") || !productColumns.has("tenant_id")) return [];
  const productName = columnExpr("p", productColumns, ["name", "title", "name_en", "name_ar"], "''");
  const productSlug = columnExpr("p", productColumns, ["slug", "product_slug"], "''");
  const brand = columnExpr("p", productColumns, ["brand", "brand_name", "manufacturer"], "''");
  const category = columnExpr("p", productColumns, ["category", "category_name"], "''");
  const productType = columnExpr("p", productColumns, ["product_type", "type"], "''");
  const style = columnExpr("p", productColumns, ["style", "silhouette"], "''");
  const tags = columnExpr("p", productColumns, ["tags", "seo_keywords", "keywords"], "''");
  const productImages = columnExpr("p", productColumns, ["gallery_images", "product_images", "images"], "'[]'::jsonb");
  const productImageFields = ["image_url", "image", "photo_url", "thumbnail_url", "main_image", "product_image_url"]
    .filter((column) => productColumns.has(column))
    .map((column) => `p.${column}`);
  const variantImageExpr = variantColumns.has("image_url") ? "pv.image_url" : "''";
  const variantColorExpr = columnExpr("pv", variantColumns, ["color", "color_name", "color_value"], "''");
  const tenantFilter = tenantId ? "AND p.tenant_id = $1::bigint" : "";
  const productFilter = productId ? `AND p.id = $${tenantId ? 2 : 1}::bigint` : "";
  const params = [tenantId, productId].filter((value) => value !== null && value !== undefined);
  const rows = [];

  const productResult = await clientOrPool.query(
    `
    SELECT
      p.tenant_id,
      p.id AS product_id,
      NULL::bigint AS variant_id,
      '' AS color,
      ${productName} AS product_name,
      ${productSlug} AS product_slug,
      ${brand} AS brand,
      ${category} AS category,
      ${productType} AS product_type,
      ${style} AS style,
      ${tags} AS tags,
      ${productImages} AS gallery_images,
      ARRAY[${productImageFields.length ? productImageFields.join(", ") : "''"}] AS image_fields
    FROM products p
    WHERE 1=1 ${tenantFilter} ${productFilter}
    `,
    params
  );
  for (const row of productResult.rows) {
    const imageFields = Array.isArray(row.image_fields) ? row.image_fields : [];
    for (const image of [...imageFields, ...parseJsonArray(row.gallery_images)]) {
      const imageUrl = firstImageValue(image);
      if (imageUrl) rows.push({ ...row, gallery_images: undefined, image_fields: undefined, image_url: imageUrl, source: "product" });
    }
  }

  if (variantColumns.has("product_id")) {
    const variantTenantClause = variantColumns.has("tenant_id") ? "AND (pv.tenant_id = p.tenant_id OR pv.tenant_id IS NULL)" : "";
    const variantResult = await clientOrPool.query(
      `
      SELECT
        p.tenant_id,
        p.id AS product_id,
        pv.id AS variant_id,
        ${variantColorExpr} AS color,
        ${productName} AS product_name,
        ${productSlug} AS product_slug,
        ${brand} AS brand,
        ${category} AS category,
        ${productType} AS product_type,
        ${style} AS style,
        ${tags} AS tags,
        ${variantImageExpr} AS image_url
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id ${variantTenantClause}
      WHERE 1=1 ${tenantFilter} ${productFilter}
        AND NULLIF(${variantImageExpr}, '') IS NOT NULL
      `,
      params
    );
    rows.push(...variantResult.rows.map((row) => ({ ...row, source: "variant" })));
  }

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS product_variant_images (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL,
      variant_id BIGINT NULL,
      color_name VARCHAR(255) NOT NULL DEFAULT '',
      color_value VARCHAR(255) NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const pviResult = await clientOrPool.query(
    `
    SELECT
      p.tenant_id,
      p.id AS product_id,
      pvi.variant_id,
      COALESCE(NULLIF(pvi.color_name, ''), NULLIF(pvi.color_value, ''), '') AS color,
      ${productName} AS product_name,
      ${productSlug} AS product_slug,
      ${brand} AS brand,
      ${category} AS category,
      ${productType} AS product_type,
      ${style} AS style,
      ${tags} AS tags,
      pvi.image_url
    FROM products p
    JOIN product_variant_images pvi ON pvi.product_id = p.id
    WHERE 1=1 ${tenantFilter} ${productFilter}
      AND NULLIF(pvi.image_url, '') IS NOT NULL
    `,
    params
  );
  rows.push(...pviResult.rows.map((row) => ({ ...row, source: "product_variant_images" })));

  const seen = new Set();
  return rows.filter((row) => {
    const imageUrl = resolvePublicProductImageUrl(row.image_url);
    const key = `${row.tenant_id}:${row.product_id}:${row.variant_id || 0}:${imageIdentity(imageUrl)}`;
    if (!imageUrl || seen.has(key)) return false;
    seen.add(key);
    row.image_url = imageUrl;
    return true;
  });
};

const upsertImageIndexRow = async (clientOrPool, row = {}) => {
  const metadata = deriveVisualMetadata(row);
  const imageUrl = resolvePublicProductImageUrl(row.image_url);
  await clientOrPool.query(
    `
    INSERT INTO ai_product_image_visual_index (
      tenant_id, product_id, variant_id, color, image_url, image_public_id, image_hash,
      visual_tags, detected_brand, detected_model, detected_category, detected_colors,
      detected_silhouette, detected_features, visual_text, visual_json, source, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12::text[],$13,$14::text[],$15,$16::jsonb,$17,NOW())
    ON CONFLICT (tenant_id, product_id, COALESCE(variant_id, 0), LOWER(TRIM(image_url)))
    DO UPDATE SET
      color = EXCLUDED.color,
      image_public_id = EXCLUDED.image_public_id,
      image_hash = COALESCE(NULLIF(EXCLUDED.image_hash, ''), ai_product_image_visual_index.image_hash),
      visual_tags = EXCLUDED.visual_tags,
      detected_brand = EXCLUDED.detected_brand,
      detected_model = EXCLUDED.detected_model,
      detected_category = EXCLUDED.detected_category,
      detected_colors = EXCLUDED.detected_colors,
      detected_silhouette = EXCLUDED.detected_silhouette,
      detected_features = EXCLUDED.detected_features,
      visual_text = EXCLUDED.visual_text,
      visual_json = EXCLUDED.visual_json,
      source = EXCLUDED.source,
      updated_at = NOW()
    `,
    [
      row.tenant_id,
      row.product_id,
      row.variant_id ?? null,
      text(row.color),
      imageUrl,
      imagePublicId(imageUrl),
      text(row.image_hash),
      metadata.visual_tags,
      metadata.detected.brand,
      metadata.detected.model,
      metadata.detected.category,
      metadata.detected.colors,
      metadata.detected.silhouette,
      metadata.detected.features,
      metadata.visual_text,
      json(metadata.detected),
      row.source || "erp",
    ]
  );
};

export const indexProductImagesForProduct = async (clientOrPool = db, { productId } = {}) => {
  const id = numberOrNull(productId);
  if (!id) return { indexed: 0 };
  await ensureAiProductImageVisualIndexSchema(clientOrPool);
  await clientOrPool.query("DELETE FROM ai_product_image_visual_index WHERE product_id = $1", [id]);
  const rows = await loadProductImageRows(clientOrPool, { productId: id });
  for (const row of rows) await upsertImageIndexRow(clientOrPool, row);
  console.log("[ai-visual-index] product indexed", { product_id: id, indexed_images: rows.length });
  return { indexed: rows.length };
};

export const reindexAllProductImages = async ({ tenantId = null, clientOrPool = db } = {}) => {
  await ensureAiProductImageVisualIndexSchema(clientOrPool);
  const rows = await loadProductImageRows(clientOrPool, { tenantId: numberOrNull(tenantId) });
  if (tenantId) await clientOrPool.query("DELETE FROM ai_product_image_visual_index WHERE tenant_id = $1", [numberOrNull(tenantId)]);
  else await clientOrPool.query("DELETE FROM ai_product_image_visual_index");
  for (const row of rows) await upsertImageIndexRow(clientOrPool, row);
  console.log("[ai-visual-index] backfill complete", {
    tenant_id: tenantId || null,
    indexed_images: rows.length,
  });
  return { indexed: rows.length };
};

const tokenOverlapScore = (detectedTokens = [], indexedTokens = []) => {
  if (!detectedTokens.length || !indexedTokens.length) return 0;
  const indexed = new Set(indexedTokens);
  const matches = detectedTokens.filter((token) => indexed.has(token));
  return matches.length / Math.max(1, detectedTokens.length);
};

const scoreIndexedImage = ({ row = {}, detected = {}, visualQuery = "", uploadedImageUrl = "", uploadedImageHash = "" } = {}) => {
  const queryBlob = detectedBlob(detected) || normalizeVisualText(visualQuery);
  const queryTokens = unique(queryBlob);
  const indexedTokens = unique([row.visual_text, row.visual_tags, row.detected_colors, row.detected_features, row.color, row.image_public_id]);
  const rowBlob = normalizeVisualText(indexedTokens.join(" "));
  const exactUrl = Boolean(uploadedImageUrl && imageIdentity(uploadedImageUrl) && imageIdentity(uploadedImageUrl) === imageIdentity(row.image_url));
  const exactPublicId = Boolean(uploadedImageUrl && imagePublicId(uploadedImageUrl) && imagePublicId(uploadedImageUrl) === row.image_public_id);
  const exactHash = Boolean(uploadedImageHash && row.image_hash && uploadedImageHash === row.image_hash);
  const overlap = tokenOverlapScore(queryTokens, indexedTokens);
  const brandTokens = unique([detected.brand_guess, detected.brand_family, detected.brand, detected.likely_brand]);
  const modelTokens = unique([detected.likely_model, detected.model_guess, detected.model_family, detected.model_keywords]);
  const colorTokens = unique([detected.colors, detected.main_colors, detected.secondary_colors]);
  const featureTokens = unique([detected.features, detected.distinctive_features, detected.english_keywords]);
  const silhouetteTokens = unique([detected.silhouette, detected.silhouette_style, detected.high_top_low_top, detected.sole_shape]);
  const scoreBreakdown = {
    exact_image_score: exactHash ? 1 : exactUrl || exactPublicId ? 0.95 : 0,
    brand_score: tokenOverlapScore(brandTokens, indexedTokens) * 0.18,
    model_score: tokenOverlapScore(modelTokens, indexedTokens) * 0.26,
    color_score: tokenOverlapScore(colorTokens, indexedTokens) * 0.2,
    silhouette_score: tokenOverlapScore(silhouetteTokens, indexedTokens) * 0.18,
    feature_score: tokenOverlapScore(featureTokens, indexedTokens) * 0.18,
    token_overlap_score: overlap * 0.22,
    penalties: 0,
  };
  const queryLow = /\blow\b|\bskate\b|\bcasual\b|\bdunk\b/.test(queryBlob);
  const queryGraphic = /\bgraphic\b|\bprinted\b|\bpattern\b|\bside panel\b|\bcomic\b|\bcartoon\b/.test(queryBlob);
  const rowTrail = /\bterrex\b|\btrail\b|\brunning\b|\bgoretex\b|\bhiking\b/.test(rowBlob);
  if ((queryLow || queryGraphic) && rowTrail) scoreBreakdown.penalties -= 0.28;
  const finalScore = Math.max(0, Math.min(1, Object.values(scoreBreakdown).reduce((sum, value) => sum + Number(value || 0), 0)));
  const strongTagMatch = finalScore >= 0.82 &&
    scoreBreakdown.model_score >= 0.18 &&
    scoreBreakdown.color_score >= 0.12 &&
    scoreBreakdown.silhouette_score >= 0.1 &&
    (scoreBreakdown.feature_score >= 0.08 || scoreBreakdown.token_overlap_score >= 0.16);
  return {
    score: finalScore,
    exact_image_match: exactHash || exactUrl || exactPublicId,
    strong_tag_match: strongTagMatch,
    score_breakdown: { ...scoreBreakdown, final_score: finalScore },
  };
};

export const searchIndexedProductImageMatches = async ({
  tenantId,
  detected = {},
  visualQuery = "",
  uploadedImageUrl = "",
  uploadedImageBuffer = null,
  limit = 8,
} = {}) => {
  const tenant = numberOrNull(tenantId);
  if (!tenant) return { exactMatch: null, closeMatches: [], searchedCount: 0, topMatches: [], fallbackReason: "missing_tenant" };
  await ensureAiProductImageVisualIndexSchema(db);
  const result = await db.query(
    `
    SELECT *
    FROM ai_product_image_visual_index
    WHERE tenant_id = $1
    ORDER BY updated_at DESC, id DESC
    LIMIT 2000
    `,
    [tenant]
  );
  const uploadedImageHash = hashBuffer(uploadedImageBuffer);
  const scored = result.rows
    .map((row) => {
      const scoredRow = scoreIndexedImage({ row, detected, visualQuery, uploadedImageUrl, uploadedImageHash });
      return { ...row, ...scoredRow };
    })
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  const topMatches = scored.slice(0, limit).map((row) => ({
    product_id: row.product_id,
    variant_id: row.variant_id,
    color: row.color,
    image_url: row.image_url,
    image_public_id: row.image_public_id,
    score: row.score,
    exact_image_match: row.exact_image_match,
    strong_tag_match: row.strong_tag_match,
    score_breakdown: row.score_breakdown,
  }));
  const exactMatch = scored.find((row) => row.exact_image_match || row.strong_tag_match) || null;
  return {
    exactMatch,
    closeMatches: scored.filter((row) => row !== exactMatch).slice(0, limit),
    searchedCount: result.rows.length,
    topMatches,
    fallbackReason: exactMatch ? "" : result.rows.length ? "no_indexed_image_met_exact_threshold" : "visual_index_empty",
  };
};
