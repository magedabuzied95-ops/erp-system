import crypto from "node:crypto";

import db from "../database/db.js";
import {
  ensureAiProductImageVisualIndexSchema,
  reindexAllProductImages,
} from "./aiVisualProductImageIndexService.js";
import { aiProductSqlExclusionClause, filterAiEligibleProducts } from "./aiProductEligibilityService.js";
import {
  detectSalesProductUnderstanding,
  gateRelevantProducts,
} from "./aiSalesOrchestratorService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const json = (value) => JSON.stringify(value === undefined ? null : value);
const positiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const EMBEDDING_TIMEOUT_MS = positiveNumber(process.env.AI_VISUAL_EMBEDDING_TIMEOUT_MS, 15000);
const DEFAULT_OPENAI_IMAGE_EMBEDDING_MODEL = process.env.OPENAI_IMAGE_EMBEDDING_MODEL || process.env.AI_VISUAL_IMAGE_EMBEDDING_MODEL || "";
const tableColumnCache = new Map();

const tableColumns = async (tableName = "") => {
  const table = text(tableName);
  if (!table) return new Set();
  if (tableColumnCache.has(table)) return tableColumnCache.get(table);
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [table]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(table, columns);
  return columns;
};

const embeddingProviderConfigured = () =>
  Boolean(text(process.env.AI_VISUAL_IMAGE_EMBEDDING_ENDPOINT)) ||
  Boolean(text(DEFAULT_OPENAI_IMAGE_EMBEDDING_MODEL) && text(process.env.OPENAI_API_KEY));

const parseEmbeddingVector = (payload = {}) => {
  const candidate =
    payload?.embedding ||
    payload?.image_embedding ||
    payload?.vector ||
    payload?.data?.[0]?.embedding ||
    payload?.output?.[0]?.embedding ||
    payload;
  if (!Array.isArray(candidate)) return [];
  const vector = candidate.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return vector.length >= 8 ? vector : [];
};

const withTimeoutSignal = (timeoutMs = EMBEDDING_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
};

const cosineSimilarity = (left = [], right = []) => {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return Math.max(0, Math.min(1, (dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) + 1) / 2));
};

const stableEmbeddingKey = (row = {}) =>
  [
    row.tenant_id,
    row.product_id,
    row.variant_id || 0,
    imageIdentity(row.image_url || ""),
  ].join(":");

export const generateImageEmbedding = async (imageUrl = "", options = {}) => {
  const safeUrl = text(imageUrl);
  if (!safeUrl) return { embedding: [], model: "", generated: false, skipped: true, reason: "missing_image_url" };
  if (!embeddingProviderConfigured()) return { embedding: [], model: "", generated: false, skipped: true, reason: "embedding_provider_not_configured" };

  const endpoint = text(process.env.AI_VISUAL_IMAGE_EMBEDDING_ENDPOINT);
  const model = text(options.model || process.env.AI_VISUAL_IMAGE_EMBEDDING_MODEL || process.env.OPENAI_IMAGE_EMBEDDING_MODEL || "");
  const payload = options.imageBuffer
    ? { imageUrl: safeUrl, image_url: safeUrl, imageBase64: options.imageBuffer.toString("base64"), mimeType: options.mimeType || "image/jpeg", model }
    : { imageUrl: safeUrl, image_url: safeUrl, model };

  try {
    if (endpoint) {
      const { signal, done } = withTimeoutSignal();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(process.env.AI_VISUAL_IMAGE_EMBEDDING_API_KEY ? { authorization: `Bearer ${process.env.AI_VISUAL_IMAGE_EMBEDDING_API_KEY}` } : {}),
          },
          body: JSON.stringify(payload),
          signal,
        });
        if (!response.ok) return { embedding: [], model, generated: false, error: `embedding_endpoint_${response.status}` };
        const body = await response.json().catch(() => ({}));
        const embedding = parseEmbeddingVector(body);
        return embedding.length
          ? { embedding, model: text(body.model || body.embedding_model || model || "custom-image-embedding"), generated: true }
          : { embedding: [], model, generated: false, error: "embedding_endpoint_empty_vector" };
      } finally {
        done();
      }
    }

    const openaiModel = text(DEFAULT_OPENAI_IMAGE_EMBEDDING_MODEL);
    if (!openaiModel || !process.env.OPENAI_API_KEY) return { embedding: [], model: "", generated: false, skipped: true, reason: "openai_image_embedding_not_configured" };
    const { signal, done } = withTimeoutSignal();
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: openaiModel,
          input: options.imageBuffer
            ? [{ type: "input_image", image_url: `data:${options.mimeType || "image/jpeg"};base64,${options.imageBuffer.toString("base64")}` }]
            : [{ type: "input_image", image_url: safeUrl }],
        }),
        signal,
      });
      if (!response.ok) return { embedding: [], model: openaiModel, generated: false, error: `openai_embedding_${response.status}` };
      const body = await response.json().catch(() => ({}));
      const embedding = parseEmbeddingVector(body);
      return embedding.length
        ? { embedding, model: text(body.model || openaiModel), generated: true }
        : { embedding: [], model: openaiModel, generated: false, error: "openai_embedding_empty_vector" };
    } finally {
      done();
    }
  } catch (error) {
    return {
      embedding: [],
      model: model || text(DEFAULT_OPENAI_IMAGE_EMBEDDING_MODEL),
      generated: false,
      error: error?.name === "AbortError" ? "embedding_timeout" : error?.message || "embedding_failed",
    };
  }
};

export const normalizeVisualProText = (value = "") =>
  lower(value)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u0660\u06f0]/g, "0")
    .replace(/[\u0661\u06f1]/g, "1")
    .replace(/[\u0662\u06f2]/g, "2")
    .replace(/[\u0663\u06f3]/g, "3")
    .replace(/[\u0664\u06f4]/g, "4")
    .replace(/[\u0665\u06f5]/g, "5")
    .replace(/[\u0666\u06f6]/g, "6")
    .replace(/[\u0667\u06f7]/g, "7")
    .replace(/[\u0668\u06f8]/g, "8")
    .replace(/[\u0669\u06f9]/g, "9")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const VISUAL_ALIAS_GROUPS = Object.freeze([
  { canonical: "north face", kind: "brand", aliases: ["north face", "the north face", "northface", "\u0646\u0648\u0631\u062b \u0641\u064a\u0633", "\u0646\u0648\u0631\u062b\u0641\u064a\u0633", "\u0646\u0648\u0631\u062a \u0641\u064a\u0633", "\u0646\u0648\u0631\u062a\u0641\u064a\u0633"] },
  { canonical: "jordan 4", kind: "model", brand: "jordan", aliases: ["jordan 4", "air jordan 4", "jordan four", "jordan iv", "retro 4", "aj4", "j4", "\u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631", "\u062c\u0648\u0631\u062f\u0646 4", "\u062c\u0648\u0631\u062f\u0646 \u0664"] },
  { canonical: "superstar", kind: "model", brand: "adidas", aliases: ["superstar", "super star", "adidas superstar", "adidas super star", "\u0633\u0648\u0628\u0631 \u0633\u062a\u0627\u0631", "\u0633\u0648\u0628\u0631\u0633\u062a\u0627\u0631"] },
  { canonical: "samba", kind: "model", brand: "adidas", aliases: ["samba", "adidas samba", "\u0633\u0627\u0645\u0628\u0627"] },
  { canonical: "campus", kind: "model", brand: "adidas", aliases: ["campus", "adidas campus", "\u0643\u0627\u0645\u0628\u0633"] },
  { canonical: "air force 1", kind: "model", brand: "nike", aliases: ["air force 1", "air force one", "af1", "nike air force", "\u0627\u064a\u0631 \u0641\u0648\u0631\u0633", "\u0627\u064a\u0631\u0641\u0648\u0631\u0633"] },
  { canonical: "dunk", kind: "model", brand: "nike", aliases: ["dunk", "nike dunk", "dunks", "\u062f\u0627\u0646\u0643"] },
  { canonical: "jordan", kind: "brand", aliases: ["jordan", "air jordan", "\u062c\u0648\u0631\u062f\u0646"] },
  { canonical: "nike", kind: "brand", aliases: ["nike", "\u0646\u0627\u064a\u0643"] },
  { canonical: "adidas", kind: "brand", aliases: ["adidas", "\u0627\u062f\u064a\u062f\u0627\u0633", "\u0623\u062f\u064a\u062f\u0627\u0633"] },
  { canonical: "skechers", kind: "brand", aliases: ["skechers", "sketchers", "\u0633\u0643\u064a\u062a\u0634\u0631\u0632"] },
  { canonical: "crocs", kind: "brand", aliases: ["crocs", "\u0643\u0631\u0648\u0643\u0633"] },
]);

const COLOR_ALIAS_GROUPS = Object.freeze([
  { canonical: "black", aliases: ["black", "blk", "\u0628\u0644\u0627\u0643", "\u0627\u0633\u0648\u062f", "\u0623\u0633\u0648\u062f"] },
  { canonical: "white", aliases: ["white", "\u0648\u0627\u064a\u062a", "\u0627\u0628\u064a\u0636", "\u0623\u0628\u064a\u0636"] },
  { canonical: "grey", aliases: ["grey", "gray", "\u062c\u0631\u0627\u064a", "\u0631\u0645\u0627\u062f\u064a"] },
  { canonical: "green", aliases: ["green", "\u062c\u0631\u064a\u0646", "\u0627\u062e\u0636\u0631", "\u0623\u062e\u0636\u0631"] },
  { canonical: "red", aliases: ["red", "\u0631\u064a\u062f", "\u0627\u062d\u0645\u0631", "\u0623\u062d\u0645\u0631"] },
  { canonical: "blue", aliases: ["blue", "\u0628\u0644\u0648", "\u0627\u0632\u0631\u0642", "\u0623\u0632\u0631\u0642"] },
  { canonical: "brown", aliases: ["brown", "\u0628\u0631\u0627\u0648\u0646", "\u0628\u0646\u064a"] },
  { canonical: "beige", aliases: ["beige", "cream", "\u0628\u064a\u062c", "\u0643\u0631\u064a\u0645"] },
]);

const canonicalFromGroups = (value = "", groups = VISUAL_ALIAS_GROUPS) => {
  const normalized = normalizeVisualProText(value);
  if (!normalized) return "";
  for (const group of groups) {
    if (group.aliases.some((alias) => normalized.includes(normalizeVisualProText(alias)))) {
      return group.canonical;
    }
  }
  return "";
};

export const detectVisualProAlias = (value = "") => {
  const normalized = normalizeVisualProText(value);
  if (!normalized) return null;
  const matches = [];
  for (const group of VISUAL_ALIAS_GROUPS) {
    const alias = group.aliases.find((item) => normalized.includes(normalizeVisualProText(item)));
    if (alias) matches.push({ ...group, matched_alias: alias });
  }
  matches.sort((left, right) => normalizeVisualProText(right.matched_alias).length - normalizeVisualProText(left.matched_alias).length);
  const best = matches[0] || null;
  if (!best) return null;
  return {
    matched_alias: best.matched_alias,
    canonical: best.canonical,
    brand: best.kind === "brand" ? best.canonical : best.brand || "",
    model: best.kind === "model" ? best.canonical : "",
    confidence: 0.96,
  };
};

const detectColors = (...values) => {
  const normalized = normalizeVisualProText(values.flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join(" "));
  const colors = [];
  for (const group of COLOR_ALIAS_GROUPS) {
    if (group.aliases.some((alias) => normalized.includes(normalizeVisualProText(alias)))) colors.push(group.canonical);
  }
  return [...new Set(colors)];
};

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(/[,\s/|]+/).filter(Boolean);
    }
  }
  return [];
};

const tokens = (...values) =>
  [...new Set(
    values
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => normalizeVisualProText(value))
      .filter(Boolean)
      .join(" ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
  )];

const overlap = (left = [], right = []) => {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length / Math.max(1, left.length);
};

// The Arabic halves of both patterns were wrapped in \b, which cannot match at the
// edge of an Arabic word — so an Arabic description of a trail shoe or a casual shoe
// matched nothing and only the English half of each list was ever doing any work.
// Unicode lookarounds behave correctly for both scripts.
const TRAIL_OUTDOOR_PATTERN =
  /(?<![\p{L}\p{N}])(?:trail|running|runner|outdoor|hiking|hike|trek|trekking|mountain|rugged|chunky|aggressive|lug|lugs|tread|outsole|sole|terrex|goretex|gore tex|north face|tnf|تريل|جري|جرى|هايكنج|هايكينج|اوتدور|أوتدور|جبل|نعل|سول|نورث\s*فيس|نورت\s*فيس)(?![\p{L}\p{N}])/u;
const CASUAL_FLAT_PATTERN =
  /(?<![\p{L}\p{N}])(?:dc|casual|lifestyle|skate|skater|court|flat|flat sole|low profile|dunk|air force|af1|samba|campus|gazelle|vans|converse|كاجوال|سكيت|فلات|دانك)(?![\p{L}\p{N}])/u;

const hasTrailOutdoorIntent = (attributes = {}) =>
  TRAIL_OUTDOOR_PATTERN.test(normalizeVisualProText([
    attributes.brand,
    attributes.model,
    attributes.productType,
    attributes.silhouette,
    attributes.soleType,
    attributes.material,
    attributes.visibleFeatures,
    attributes.categoryTokens,
  ].flat().filter(Boolean).join(" ")));

const rowTrailOutdoorScore = (rowBlob = "") =>
  TRAIL_OUTDOOR_PATTERN.test(rowBlob)
    ? 1
    : /\b(running|outdoor|sport|shoe|sneaker)\b/.test(rowBlob) ? 0.35 : 0;

const rowCasualFlatScore = (rowBlob = "") =>
  CASUAL_FLAT_PATTERN.test(rowBlob) ? 1 : 0;

const uniqueList = (items = [], limit = 20) =>
  [...new Set((Array.isArray(items) ? items : [items]).flatMap((item) => Array.isArray(item) ? item : [item]).map(text).filter(Boolean))].slice(0, limit);

export const buildCustomerPreferenceProfile = (memory = {}) => {
  const context = memory.customerContext || {};
  const preferredSizes = uniqueList([memory.preferredSizes, context.preferredSizes, memory.activeSize, memory.selectedSize], 10);
  const preferredBrands = uniqueList([memory.preferredBrands, context.preferredBrands, memory.selectedProductName, memory.lastProductQuery, memory.lastVisualQueryText], 16)
    .map((item) => canonicalFromGroups(item) || normalizeVisualProText(item))
    .filter(Boolean);
  const preferredColors = uniqueList([memory.preferredColors, context.preferredColors, memory.activeColor, memory.selectedColor], 12)
    .flatMap((item) => detectColors(item))
    .filter(Boolean);
  const preferredCategories = uniqueList([memory.preferredCategories, context.preferredCategories], 12).map(normalizeVisualProText).filter(Boolean);
  const lastViewedProducts = uniqueList([memory.lastViewedProducts, context.lastViewedProducts, memory.lastShownProductIds, memory.viewedProductIds], 30).map(String);
  const lastVisualMatches = uniqueList([memory.lastVisualMatches, context.lastVisualMatches], 24).map(String);
  const selectedProductHistory = uniqueList([memory.selectedProductId, memory.activeProductId, memory.selectedProductName, memory.selectedVariantTitle, memory.selectedColor, memory.selectedSize], 24);
  const previousOrders = uniqueList([context.lastPurchasedProducts, context.previousOrders, memory.previousOrders], 24);
  return {
    preferredSizes,
    preferredBrands: uniqueList(preferredBrands, 16),
    preferredColors: uniqueList(preferredColors, 12),
    preferredCategories,
    lastViewedProducts,
    lastVisualMatches,
    selectedProductHistory,
    previousOrders,
  };
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
  return afterUpload.replace(/^v\d+\//, "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/^\/+|\/+$/g, "");
};

const hashBuffer = (buffer) =>
  buffer?.length ? crypto.createHash("sha256").update(buffer).digest("hex") : "";

const fieldConfidence = (detected = {}, key = "") => {
  const confidence = detected?.field_confidence || {};
  return Math.max(Number(confidence[key] || 0), Number(confidence[`${key}_guess`] || 0), 0);
};

export const normalizeVisualAttributes = ({ detected = {}, visualQuery = "", correctionText = "", previousVisualAttributes = null } = {}) => {
  const previous = previousVisualAttributes?.raw || previousVisualAttributes || {};
  const correction = detectVisualProAlias(correctionText);
  const brandText = [
    correction?.brand,
    detected.brand_guess,
    detected.brand_family,
    detected.brand,
    detected.likely_brand,
    detected.logo_text,
    detected.visible_logo_text,
    detected.english_keywords,
    detected.arabic_keywords,
    previous.brand_guess,
    previous.brand,
    visualQuery,
  ].filter(Boolean).join(" ");
  const modelText = [
    correction?.model,
    detected.likely_model,
    detected.model_guess,
    detected.model_family,
    detected.model_keywords,
    detected.english_keywords,
    detected.arabic_keywords,
    detected.notable_features,
    detected.distinctive_features,
    previous.likely_model,
    previous.model_guess,
    visualQuery,
  ].filter(Boolean).join(" ");
  const modelAlias = canonicalFromGroups(modelText);
  const modelAliasGroup = VISUAL_ALIAS_GROUPS.find((group) => group.kind === "model" && group.canonical === modelAlias);
  const brand = correction?.brand || canonicalFromGroups(brandText) || modelAliasGroup?.brand || "";
  const model = correction?.model || (modelAliasGroup ? modelAliasGroup.canonical : "");
  const colors = detectColors(detected.colors, detected.main_colors, detected.secondary_colors, previous.colors, previous.main_colors, previous.secondary_colors, visualQuery, correctionText);
  const categoryTokens = tokens(detected.product_type, detected.category, detected.shoe_type, previous.product_type, previous.category, visualQuery);
  const genderTokens = tokens(detected.gender_style, detected.gender_audience, detected.gender, detected.target_audience, previous.gender_style, previous.gender);
  const baseAttributes = {
    brand,
    model,
    logoText: text(detected.logo_text || previous.logo_text || ""),
    productType: text(detected.product_type || detected.category || previous.product_type || previous.category || ""),
    gender: text(detected.gender_style || detected.gender_audience || detected.gender || previous.gender_style || previous.gender || ""),
    mainColors: colors,
    secondaryColors: detectColors(detected.secondary_colors, previous.secondary_colors),
    silhouette: text(detected.silhouette || detected.silhouette_style || detected.high_top_low_top || previous.silhouette || ""),
    soleType: text(detected.sole_shape || detected.sole_type || previous.sole_shape || ""),
    material: asArray(detected.materials || detected.material || previous.materials || previous.material).map(text).filter(Boolean),
    visibleFeatures: asArray([
      detected.features,
      detected.notable_features,
      detected.distinctive_features,
      detected.english_keywords,
      detected.arabic_keywords,
      previous.features,
      previous.notable_features,
    ].flat()).map(text).filter(Boolean).slice(0, 18),
    brandConfidence: correction ? 0.96 : Math.max(fieldConfidence(detected, "brand"), canonicalFromGroups(brandText) ? 0.82 : 0),
    modelConfidence: correction?.model ? 0.96 : Math.max(fieldConfidence(detected, "model"), model ? 0.84 : 0),
    colorConfidence: colors.length ? Math.max(fieldConfidence(detected, "colors"), 0.65) : 0,
    categoryTokens,
    genderTokens,
    correction,
    correctionUsed: Boolean(correctionText && correction),
  };
  return {
    ...baseAttributes,
    trailOutdoorIntent: hasTrailOutdoorIntent(baseAttributes),
  };
};

const rowTokens = (row = {}) =>
  tokens(
    row.visual_text,
    row.visual_tags,
    row.text_aliases,
    row.aliases,
    row.visual_attributes,
    row.brand,
    row.product_name,
    row.category,
    row.gender,
    row.color,
    row.detected_colors,
    row.detected_features,
    row.image_public_id
  );

const scoreCustomerPreferences = ({ row = {}, rowBlob = "", rowColors = [], availableSizes = [], customerPreferenceProfile = {} } = {}) => {
  const profile = customerPreferenceProfile || {};
  const rowBrand = canonicalFromGroups([row.brand, row.product_name, row.visual_text, row.text_aliases].join(" "));
  const rowCategoryTokens = tokens(row.category, row.detected_category, row.visual_text, row.text_aliases);
  const productIds = [row.product_id, row.productId, row.id].map((item) => String(item || "")).filter(Boolean);
  const preferredBrandScore = profile.preferredBrands?.length
    ? profile.preferredBrands.some((brand) => rowBrand === brand || rowBlob.includes(normalizeVisualProText(brand))) ? 1 : 0
    : 0;
  const preferredSizeScore = profile.preferredSizes?.length
    ? profile.preferredSizes.some((size) => availableSizes.map(lower).includes(lower(size))) ? 1 : 0
    : 0;
  const preferredColorScore = profile.preferredColors?.length ? overlap(profile.preferredColors, rowColors) : 0;
  const preferredCategoryScore = profile.preferredCategories?.length
    ? Math.max(overlap(profile.preferredCategories, rowCategoryTokens), profile.preferredCategories.some((category) => rowBlob.includes(normalizeVisualProText(category))) ? 1 : 0)
    : 0;
  const interestTokens = tokens(profile.selectedProductHistory, profile.previousOrders);
  const previousInterestScore = Math.max(
    productIds.some((id) => profile.lastViewedProducts?.includes(id) || profile.lastVisualMatches?.includes(id)) ? 1 : 0,
    interestTokens.length ? overlap(interestTokens, tokens(row.product_name, row.brand, row.color, row.category, row.visual_text)) : 0
  );
  const customerPreferenceScore = Math.max(0, Math.min(1,
    preferredBrandScore * 0.28 +
    preferredSizeScore * 0.24 +
    preferredColorScore * 0.2 +
    preferredCategoryScore * 0.12 +
    previousInterestScore * 0.16
  ));
  const whyCandidateWasBoosted = [
    preferredBrandScore ? "preferred brand" : "",
    preferredSizeScore ? "preferred size" : "",
    preferredColorScore ? "preferred color" : "",
    preferredCategoryScore ? "preferred category" : "",
    previousInterestScore ? "previous interest" : "",
  ].filter(Boolean).join(", ");
  return {
    preferredBrandScore,
    preferredSizeScore,
    preferredColorScore,
    preferredCategoryScore,
    previousInterestScore,
    customerPreferenceScore,
    whyCandidateWasBoosted,
  };
};

const scoreVisualRow = ({
  row = {},
  attributes = {},
  uploadedImageUrl = "",
  uploadedImageUrls = [],
  uploadedImageHash = "",
  uploadedImageHashes = [],
  preferredSize = "",
  queryEmbedding = [],
  queryEmbeddings = [],
  customerPreferenceProfile = {},
} = {}) => {
  const indexedTokens = rowTokens(row);
  const rowBlob = normalizeVisualProText(indexedTokens.join(" "));
  const rowBrand = canonicalFromGroups([row.brand, row.product_name, row.visual_text, row.text_aliases].join(" "));
  const rowModel = canonicalFromGroups([row.product_name, row.visual_text, row.text_aliases].join(" "));
  const rowColors = detectColors(row.color, row.detected_colors, row.visual_text, row.text_aliases, row.product_name);
  const imageUrls = uniqueList([uploadedImageUrls, uploadedImageUrl], 12);
  const imageHashes = uniqueList([uploadedImageHashes, uploadedImageHash], 12);
  const embeddingVectors = (Array.isArray(queryEmbeddings) && queryEmbeddings.length ? queryEmbeddings : [queryEmbedding])
    .map(parseEmbeddingVector)
    .filter((vector) => vector.length);
  const exactUrl = imageUrls.some((url) => imageIdentity(url) === imageIdentity(row.image_url));
  const exactPublicId = imageUrls.some((url) => imagePublicId(url) && imagePublicId(url) === row.image_public_id);
  const exactHash = imageHashes.some((hash) => hash && row.image_hash && hash === row.image_hash);
  const storedEmbedding = parseEmbeddingVector(row.image_embedding || row.embedding || []);
  const embeddingSimilarityScore = storedEmbedding.length
    ? Math.max(0, ...embeddingVectors.map((embedding) => cosineSimilarity(embedding, storedEmbedding)))
    : 0;
  const exactImageScore = exactHash ? 1 : exactUrl || exactPublicId ? 0.95 : 0;
  const imageSimilarityScore = Math.max(exactImageScore, embeddingSimilarityScore);
  const brandScore = attributes.brand ? (rowBrand === attributes.brand || rowBlob.includes(normalizeVisualProText(attributes.brand)) ? 1 : 0) : 0;
  const modelScore = attributes.model ? (rowModel === attributes.model || rowBlob.includes(normalizeVisualProText(attributes.model)) ? 1 : 0) : 0;
  const colorScore = attributes.mainColors?.length ? overlap(attributes.mainColors, rowColors) : 0;
  const categoryScore = Math.max(overlap(attributes.categoryTokens || [], indexedTokens), overlap(tokens(attributes.productType, attributes.silhouette, attributes.soleType), indexedTokens));
  const genderScore = overlap(attributes.genderTokens || [], indexedTokens);
  const availableSizes = asArray(row.available_sizes).map(text).filter(Boolean);
  const inStock = Number(row.stock || 0) > 0 || availableSizes.length > 0;
  const stockScore = preferredSize
    ? availableSizes.map(lower).includes(lower(preferredSize)) ? 1 : inStock ? 0.45 : 0
    : inStock ? 1 : 0;
  const priceScore = Number(row.price || 0) > 0 ? 1 : 0;
  const visualFeatureScore = Math.max(
    overlap(tokens(attributes.visibleFeatures), indexedTokens),
    overlap(tokens(attributes.silhouette, attributes.soleType, attributes.material), indexedTokens)
  );
  const northFaceIntent = attributes.brand === "north face" && attributes.brandConfidence >= 0.7;
  const rowIsNorthFace = rowBrand === "north face" || rowBlob.includes("north face") || rowBlob.includes("northface") || rowBlob.includes("نورث فيس") || rowBlob.includes("نورت فيس");
  const trailOutdoorIntent = Boolean(attributes.trailOutdoorIntent);
  const outsoleScore = trailOutdoorIntent ? rowTrailOutdoorScore(rowBlob) : 0;
  const casualFlatScore = rowCasualFlatScore(rowBlob);
  const brandPenalty = northFaceIntent && !rowIsNorthFace ? (inStock ? -0.78 : -0.52) : 0;
  const categoryPenalty = trailOutdoorIntent && casualFlatScore > 0 && outsoleScore < 0.5 ? -0.46 : 0;
  const outsoleBoost = trailOutdoorIntent ? outsoleScore * 0.18 : 0;
  let penalty = 0;
  if (attributes.brandConfidence >= 0.75 && attributes.brand && brandScore <= 0) penalty -= 0.42;
  if (attributes.modelConfidence >= 0.75 && attributes.model && modelScore <= 0) penalty -= 0.34;
  if (attributes.mainColors?.length && colorScore <= 0) penalty -= 0.14;
  if (!inStock) penalty -= 0.12;
  if (!row.image_url) penalty -= 0.2;
  const hasQueryEmbedding = queryEmbedding.length > 0;
  const embeddingWeight = hasQueryEmbedding ? 0.36 : 0.16;
  const brandModelWeight = attributes.correctionUsed ? 0.54 : hasQueryEmbedding ? 0.34 : 0.46;
  const visualMetadataWeight = hasQueryEmbedding ? 0.2 : 0.38;
  const brandModelScore = (brandScore * 0.48) + (modelScore * 0.52);
  if (hasQueryEmbedding && imageSimilarityScore < 0.45 && brandModelScore < 0.5 && !attributes.correctionUsed) penalty -= 0.18;
  if (attributes.correctionUsed && brandModelScore >= 0.8 && imageSimilarityScore < 0.45) penalty += 0.08;
  penalty += brandPenalty + categoryPenalty + outsoleBoost;
  const baseFinalScore = Math.max(0, Math.min(1,
    imageSimilarityScore * embeddingWeight +
    brandModelScore * brandModelWeight +
    (
      colorScore * 0.32 +
      categoryScore * 0.2 +
      genderScore * 0.08 +
      stockScore * 0.16 +
      priceScore * 0.04 +
      visualFeatureScore * 0.2
    ) * visualMetadataWeight +
    penalty
  ));
  const preference = scoreCustomerPreferences({ row, rowBlob, rowColors, availableSizes, customerPreferenceProfile });
  const preferenceGate = baseFinalScore >= 0.32 || imageSimilarityScore >= 0.45 || brandModelScore >= 0.55 || attributes.correctionUsed
    ? Math.min(0.14, Math.max(0.03, baseFinalScore * 0.16))
    : 0;
  const customerPreferenceBoost = preference.customerPreferenceScore * preferenceGate;
  const guardBoost = northFaceIntent && rowIsNorthFace && inStock ? 0.16 : trailOutdoorIntent && outsoleScore >= 1 && inStock ? 0.08 : 0;
  const guardedScore = Math.max(0, Math.min(1, baseFinalScore + customerPreferenceBoost + guardBoost));
  const rejectionReason = [
    brandPenalty <= -0.5 ? "brand_mismatch_for_high_confidence_north_face" : "",
    categoryPenalty <= -0.4 ? "casual_flat_sneaker_mismatch_for_trail_outdoor_image" : "",
    !inStock ? "out_of_stock" : "",
  ].filter(Boolean).join("; ");
  const finalScore = northFaceIntent && !rowIsNorthFace && (brandPenalty <= -0.5 || categoryPenalty <= -0.4)
    ? Math.min(guardedScore, trailOutdoorIntent && casualFlatScore > 0 ? 0.22 : 0.32)
    : guardedScore;
  const firstRankReason = modelScore >= 1
    ? "same model family"
    : brandScore >= 1
      ? "same brand"
      : colorScore > 0
        ? "matching color and inventory"
        : imageSimilarityScore > 0
          ? "same indexed image"
          : "closest metadata and visual attributes";
  return {
    imageSimilarityScore,
    embeddingSimilarityScore,
    exactImageScore,
    brandScore,
    modelScore,
    colorScore,
    categoryScore,
    genderScore,
    stockScore,
    priceScore,
    visualFeatureScore,
    brandPenalty,
    categoryPenalty,
    outsoleScore,
    outsoleBoost,
    rejectionReason,
    penalty,
    guardBoost,
    baseFinalScore,
    customerPreferenceBoost,
    ...preference,
    finalScore,
    reasonWhyRankedFirst: preference.whyCandidateWasBoosted && customerPreferenceBoost > 0 ? `${firstRankReason}; boosted by ${preference.whyCandidateWasBoosted}` : firstRankReason,
  };
};

const candidateFromRow = (row = {}, breakdown = {}) => ({
  ...row,
  product_id: row.product_id,
  variant_id: row.variant_id,
  productId: row.product_id,
  variantId: row.variant_id,
  productName: row.product_name || "",
  finalScore: breakdown.finalScore,
  score: breakdown.finalScore,
  exact_image_match: breakdown.imageSimilarityScore >= 0.95,
  strong_tag_match: breakdown.finalScore >= 0.78 && (breakdown.brandScore >= 1 || breakdown.modelScore >= 1),
  score_breakdown: {
    imageSimilarityScore: breakdown.imageSimilarityScore,
    embeddingSimilarityScore: breakdown.embeddingSimilarityScore,
    exactImageScore: breakdown.exactImageScore,
    brandScore: breakdown.brandScore,
    modelScore: breakdown.modelScore,
    colorScore: breakdown.colorScore,
    categoryScore: breakdown.categoryScore,
    genderScore: breakdown.genderScore,
    stockScore: breakdown.stockScore,
    priceScore: breakdown.priceScore,
    brandPenalty: breakdown.brandPenalty,
    categoryPenalty: breakdown.categoryPenalty,
    outsoleScore: breakdown.outsoleScore,
    outsoleBoost: breakdown.outsoleBoost,
    rejectionReason: breakdown.rejectionReason,
    guardBoost: breakdown.guardBoost,
    customerPreferenceScore: breakdown.customerPreferenceScore,
    preferredBrandScore: breakdown.preferredBrandScore,
    preferredSizeScore: breakdown.preferredSizeScore,
    preferredColorScore: breakdown.preferredColorScore,
    preferredCategoryScore: breakdown.preferredCategoryScore,
    previousInterestScore: breakdown.previousInterestScore,
    customerPreferenceBoost: breakdown.customerPreferenceBoost,
    whyCandidateWasBoosted: breakdown.whyCandidateWasBoosted,
    baseFinalScore: breakdown.baseFinalScore,
    finalScore: breakdown.finalScore,
    reasonWhyRankedFirst: breakdown.reasonWhyRankedFirst,
  },
});

export const ensureAiVisualSearchProSchema = async (clientOrPool = db) => {
  await ensureAiProductImageVisualIndexSchema(clientOrPool);
  await clientOrPool.query(`ALTER TABLE ai_product_image_visual_index ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`);
  await clientOrPool.query(`ALTER TABLE ai_product_image_visual_index ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE ai_product_image_visual_index ADD COLUMN IF NOT EXISTS embedding JSONB NULL`);
  await clientOrPool.query(`ALTER TABLE ai_product_image_visual_index ADD COLUMN IF NOT EXISTS image_embedding JSONB NULL`);
  await clientOrPool.query(`ALTER TABLE ai_product_image_visual_index ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE ai_product_image_visual_index ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP NULL`);
  await clientOrPool.query(`
    UPDATE ai_product_image_visual_index
    SET aliases = CASE WHEN COALESCE(array_length(aliases, 1), 0) = 0 THEN text_aliases ELSE aliases END,
        image_embedding = COALESCE(image_embedding, embedding),
        last_indexed_at = COALESCE(last_indexed_at, updated_at)
    WHERE COALESCE(array_length(aliases, 1), 0) = 0
       OR last_indexed_at IS NULL
       OR (image_embedding IS NULL AND embedding IS NOT NULL)
  `);
};

const loadExistingEmbeddings = async ({ tenantId = null, clientOrPool = db } = {}) => {
  await ensureAiVisualSearchProSchema(clientOrPool);
  const params = [];
  const tenantFilter = tenantId ? "WHERE tenant_id = $1::bigint" : "";
  if (tenantId) params.push(numberOrNull(tenantId));
  const result = await clientOrPool.query(
    `
    SELECT tenant_id, product_id, variant_id, image_url, image_embedding, embedding, embedding_model, embedding_updated_at
    FROM ai_product_image_visual_index
    ${tenantFilter}
    `,
    params
  );
  const map = new Map();
  for (const row of result.rows) {
    const embedding = parseEmbeddingVector(row.image_embedding || row.embedding || []);
    if (embedding.length) {
      map.set(stableEmbeddingKey(row), {
        embedding,
        model: text(row.embedding_model),
        updatedAt: row.embedding_updated_at || null,
      });
    }
  }
  return map;
};

const productImageUrlLooksUsable = (url = "") => {
  const value = text(url);
  if (!value) return false;
  if (value.startsWith("data:image/")) return false;
  return /^https?:\/\//i.test(value) || value.startsWith("/uploads/") || value.startsWith("uploads/") || value.startsWith("/products/") || value.startsWith("products/");
};

const embedIndexedImages = async ({ tenantId = null, force = false, existingEmbeddings = new Map(), clientOrPool = db } = {}) => {
  await ensureAiVisualSearchProSchema(clientOrPool);
  const params = [];
  const tenantFilter = tenantId ? "WHERE tenant_id = $1::bigint" : "";
  if (tenantId) params.push(numberOrNull(tenantId));
  const result = await clientOrPool.query(
    `
    SELECT id, tenant_id, product_id, variant_id, image_url, image_embedding, embedding_model
    FROM ai_product_image_visual_index
    ${tenantFilter}
    ORDER BY tenant_id, product_id, COALESCE(variant_id, 0), id
    `,
    params
  );
  const summary = { embedded: 0, skipped: 0, errors: 0, reused: 0, provider: embeddingProviderConfigured() ? "configured" : "not_configured" };
  for (const row of result.rows) {
    if (!productImageUrlLooksUsable(row.image_url)) {
      summary.skipped += 1;
      continue;
    }
    const currentEmbedding = parseEmbeddingVector(row.image_embedding || []);
    if (!force && currentEmbedding.length) {
      summary.reused += 1;
      continue;
    }
    const reusable = !force ? existingEmbeddings.get(stableEmbeddingKey(row)) : null;
    if (reusable?.embedding?.length) {
      await clientOrPool.query(
        `
        UPDATE ai_product_image_visual_index
        SET image_embedding = $2::jsonb,
            embedding = $2::jsonb,
            embedding_model = $3,
            embedding_updated_at = COALESCE($4::timestamp, embedding_updated_at, NOW())
        WHERE id = $1
        `,
        [row.id, json(reusable.embedding), reusable.model || "", reusable.updatedAt]
      );
      summary.reused += 1;
      continue;
    }
    const generated = await generateImageEmbedding(row.image_url);
    if (generated.generated && generated.embedding.length) {
      await clientOrPool.query(
        `
        UPDATE ai_product_image_visual_index
        SET image_embedding = $2::jsonb,
            embedding = $2::jsonb,
            embedding_model = $3,
            embedding_updated_at = NOW()
        WHERE id = $1
        `,
        [row.id, json(generated.embedding), generated.model || ""]
      );
      summary.embedded += 1;
    } else if (generated.error) {
      summary.errors += 1;
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
};

export const reindexAiVisualProducts = async ({ tenantId = null, clientOrPool = db, force = false } = {}) => {
  await ensureAiVisualSearchProSchema(clientOrPool);
  const existingEmbeddings = force ? new Map() : await loadExistingEmbeddings({ tenantId, clientOrPool });
  const result = await reindexAllProductImages({ tenantId, clientOrPool });
  await ensureAiVisualSearchProSchema(clientOrPool);
  const embeddingSummary = await embedIndexedImages({ tenantId, force, existingEmbeddings, clientOrPool });
  return {
    indexed: Number(result.indexed || 0),
    embedded: embeddingSummary.embedded,
    reused: embeddingSummary.reused,
    skipped: Number(result.skipped || 0) + embeddingSummary.skipped,
    errors: Number(result.errors || 0) + embeddingSummary.errors,
    embeddingProvider: embeddingSummary.provider,
  };
};

export const searchAiVisualProductsPro = async ({
  tenantId,
  detected = {},
  visualQuery = "",
  uploadedImageUrl = "",
  uploadedImageBuffer = null,
  uploadedImages = [],
  correctionText = "",
  previousVisualAttributes = null,
  preferredSize = "",
  customerPreferenceProfile = {},
  limit = 8,
} = {}) => {
  const tenant = numberOrNull(tenantId);
  if (!tenant) return { candidates: [], exactMatch: null, closeMatches: [], topMatches: [], searchedCount: 0, fallbackReason: "missing_tenant" };
  await ensureAiVisualSearchProSchema(db);
  const attributes = normalizeVisualAttributes({ detected, visualQuery, correctionText, previousVisualAttributes });
  const preferenceProfile = buildCustomerPreferenceProfile({
    ...customerPreferenceProfile,
    preferredSizes: uniqueList([customerPreferenceProfile.preferredSizes, preferredSize], 10),
  });
  const rawQueryImages = [
    ...(Array.isArray(uploadedImages) ? uploadedImages : []).map((item) => ({
      imageUrl: text(item?.imageUrl || item?.url || item?.image_url || ""),
      imageBuffer: item?.imageBuffer || item?.buffer || null,
      mimeType: item?.mimeType || item?.mime_type || "",
    })),
    ...((uploadedImageUrl || uploadedImageBuffer) ? [{ imageUrl: uploadedImageUrl || "uploaded-image", imageBuffer: uploadedImageBuffer || null }] : []),
  ];
  const seenQueryImages = new Set();
  const queryImages = [];
  for (const image of rawQueryImages) {
    const key = image.imageUrl ? imageIdentity(image.imageUrl) : `buffer:${queryImages.length}`;
    if (!key || seenQueryImages.has(key)) continue;
    seenQueryImages.add(key);
    queryImages.push(image);
    if (queryImages.length >= 12) break;
  }
  const queryEmbeddingResults = [];
  for (const image of queryImages) {
    const imageUrl = text(image.imageUrl || image.url || "uploaded-image");
    if (!imageUrl && !image.imageBuffer) continue;
    const result = await generateImageEmbedding(imageUrl || "uploaded-image", {
      imageBuffer: image.imageBuffer || null,
      mimeType: image.mimeType || "image/jpeg",
    }).catch((error) => ({
      embedding: [],
      model: "",
      generated: false,
      error: error?.message || "query_embedding_failed",
    }));
    queryEmbeddingResults.push(result);
  }
  const queryEmbeddings = queryEmbeddingResults.map((result) => parseEmbeddingVector(result.embedding || [])).filter((embedding) => embedding.length);
  const queryEmbeddingResult = queryEmbeddingResults.find((result) => parseEmbeddingVector(result.embedding || []).length) ||
    queryEmbeddingResults[0] ||
    { embedding: [], model: "", generated: false, skipped: true, reason: "missing_query_image" };
  const productColumns = await tableColumns("products");
  const productNameExpr = productColumns.has("name") ? "COALESCE(NULLIF(p.name, ''), idx.product_name)" : "idx.product_name";
  const productSlugExpr = productColumns.has("slug") ? "COALESCE(p.slug, '')" : productColumns.has("product_slug") ? "COALESCE(p.product_slug, '')" : "''";
  const canonicalSlugExpr = productColumns.has("canonical_slug") ? "COALESCE(p.canonical_slug, '')" : "''";
  const productEligibility = aiProductSqlExclusionClause("p", productColumns);
  const result = await db.query(
    `
    SELECT
      idx.*,
      ${productNameExpr} AS product_name,
      ${productSlugExpr} AS slug,
      ${canonicalSlugExpr} AS canonical_slug,
      ${productSlugExpr} AS product_slug
    FROM ai_product_image_visual_index idx
    JOIN products p ON p.id = idx.product_id
      AND p.tenant_id = idx.tenant_id
    WHERE idx.tenant_id = $1
      AND ${productEligibility}
    ORDER BY COALESCE(idx.last_indexed_at, idx.updated_at) DESC, idx.id DESC
    LIMIT 2500
    `,
    [tenant]
  );
  const uploadedImageHashes = queryImages.map((image) => hashBuffer(image.imageBuffer || null)).filter(Boolean);
  const uploadedImageHash = uploadedImageHashes[0] || hashBuffer(uploadedImageBuffer);
  const uploadedImageUrls = uniqueList([queryImages.map((image) => image.imageUrl || image.url), uploadedImageUrl], 12);
  const scored = filterAiEligibleProducts(result.rows, { requireProductUrl: false })
    .map((row) => candidateFromRow(row, scoreVisualRow({
      row,
      attributes,
      uploadedImageUrl,
      uploadedImageUrls,
      uploadedImageHash,
      uploadedImageHashes,
      preferredSize,
      queryEmbedding: queryEmbeddings[0] || [],
      queryEmbeddings,
      customerPreferenceProfile: preferenceProfile,
    })))
    .filter((row) => Number(row.finalScore || 0) >= 0.08 || row.exact_image_match)
    .sort((left, right) => {
      const scoreDiff = Number(right.finalScore || 0) - Number(left.finalScore || 0);
      if (scoreDiff) return scoreDiff;
      return Number(right.stock || 0) - Number(left.stock || 0);
    });
  const understanding = detectSalesProductUnderstanding({
    message: [
      visualQuery,
      correctionText,
      attributes.brand,
      attributes.model,
      attributes.productType,
      ...(attributes.mainColors || []),
      ...(attributes.visibleFeatures || []),
    ].filter(Boolean).join(" "),
    memory: { lastVisualQueryText: visualQuery, lastImageUrl: uploadedImageUrl || (queryImages[0]?.imageUrl || "") },
    source: "visual_search_pro",
  });
  const gatedScored = understanding.requires_relevance_gate
    ? gateRelevantProducts({ products: scored, understanding, limit, fallback: false })
    : scored;
  console.log("[ai-orchestrator:candidates]", {
    exact_count: gatedScored.filter((product) => product.exact_image_match).length,
    family_count: gatedScored.filter((product) => product.relevance_reasons?.includes("model_family_match")).length,
    similar_count: gatedScored.length,
    fallback_count: 0,
  });
  const topMatches = gatedScored.slice(0, limit).map((row, index) => ({
    product_id: row.product_id,
    productId: row.product_id,
    variant_id: row.variant_id,
    variantId: row.variant_id,
    sourceImageProductId: row.product_id,
    sourceImageVariantId: row.variant_id,
    sourceTitle: row.product_name || "",
    sourceBrand: row.brand || "",
    brand: row.brand || "",
    product_name: row.product_name || "",
    category: row.category || "",
    finalTitle: row.product_name || "",
    finalUrl: "",
    color: row.color,
    image_url: row.image_url,
    imageUrl: row.image_url,
    image_public_id: row.image_public_id,
    score: row.finalScore,
    imageSimilarityScore: row.score_breakdown?.imageSimilarityScore || 0,
    customerPreferenceScore: row.score_breakdown?.customerPreferenceScore || 0,
    whyCandidateWasBoosted: row.score_breakdown?.whyCandidateWasBoosted || "",
    finalScore: row.finalScore,
    exact_image_match: row.exact_image_match,
    strong_tag_match: row.strong_tag_match,
    score_breakdown: row.score_breakdown,
    rank: index + 1,
  }));
  const exactMatch = gatedScored.find((row) => row.exact_image_match || row.finalScore >= 0.82) || null;
  const topReason = topMatches[0]?.score_breakdown?.reasonWhyRankedFirst || "";
  return {
    attributes,
    customerPreferenceProfile: preferenceProfile,
    queryEmbeddingGenerated: Boolean(queryEmbeddings.length),
    queryImageCount: queryImages.length,
    queryEmbeddingCount: queryEmbeddings.length,
    embeddingModel: queryEmbeddingResult.model || "",
    embeddingError: queryEmbeddingResult.error || "",
    candidates: gatedScored.slice(0, limit),
    exactMatch,
    closeMatches: gatedScored.filter((row) => row !== exactMatch).slice(0, limit),
    searchedCount: result.rows.length,
    topMatches,
    correctionUsed: attributes.correctionUsed,
    reasonWhyFirstRanked: topReason,
    confidence: Number(topMatches[0]?.score || 0),
    fallbackReason: topMatches.length ? "" : "no_usable_visual_candidates",
  };
};
