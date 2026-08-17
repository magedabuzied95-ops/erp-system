import OpenAI, { toFile } from "openai";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

import db from "../database/db.js";
import { cloudinaryUploadsEnabled } from "../utils/cloudinaryUploads.js";
import { getAISettings } from "./aiSettingsService.js";

const AI_SHOE_COVER_PROMPT = [
  "Edit this product image conservatively into a clean ecommerce cover.",
  "",
  "This is a cleanup task, not a redesign task.",
  "",
  "Preserve the exact shoe from the source image.",
  "Keep the original camera angle and perspective as much as possible.",
  "",
  "Do not force a new side-profile angle.",
  "Do not convert the shoe into an Adidas-style angle.",
  "Do not invent hidden parts of the shoe.",
  "",
  "The final image must preserve the same:",
  "- silhouette",
  "- proportions",
  "- outsole",
  "- midsole",
  "- sole pattern",
  "- upper panels",
  "- mesh texture",
  "- stitching",
  "- material texture",
  "- logos",
  "- printed text",
  "- laces",
  "- lace positions",
  "- heel details",
  "- toe shape",
  "- color distribution",
  "",
  "Allowed edits:",
  "- center the shoe",
  "- clean the background to white or very light gray",
  "- improve lighting slightly",
  "- add a subtle natural shadow",
  "- crop/resize for ecommerce cover",
  "- remove tags, hands, stickers, watermarks, and distracting objects only if removal does not change the shoe",
  "- if there is a second shoe behind the main shoe, remove it only if it can be removed without inventing or changing the main shoe; otherwise keep it, blur it slightly, or make it less dominant",
  "",
  "Strictly forbidden:",
  "- redesigning the shoe",
  "- changing the shoe shape",
  "- changing the sole",
  "- changing the logo",
  "- changing printed text",
  "- changing lace pattern",
  "- changing colors",
  "- inventing new panels or details",
  "- making the product look like a different model",
  "",
  "Accuracy is more important than perfect catalog styling.",
  "",
  "Return a faithful cleaned cover of the original product.",
].join("\n");

const AI_SHOE_COVER_PUBLIC_DIR = "/uploads/products/ai-shoe-covers";
const AI_SHOE_COVER_LOCAL_DIR = path.resolve(process.cwd(), "uploads", "products", "ai-shoe-covers");
const AI_SHOE_COVER_BATCH_SIZE = Math.max(1, Number(process.env.AI_SHOE_COVER_BATCH_SIZE || 3));
const AI_SHOE_COVER_POLL_MS = Math.max(1000, Number(process.env.AI_SHOE_COVER_POLL_MS || 4000));
const AI_SHOE_COVER_MAX_ATTEMPTS = Math.max(1, Number(process.env.AI_SHOE_COVER_MAX_ATTEMPTS || 5));
const AI_SHOE_COVER_MAX_SOURCE_BYTES = Math.max(512_000, Number(process.env.AI_SHOE_COVER_MAX_SOURCE_BYTES || 8 * 1024 * 1024));
const AI_SHOE_COVER_MODEL = String(process.env.OPENAI_SHOE_COVER_MODEL || "gpt-image-1").trim();
const AI_SHOE_COVER_TIMEOUT_MS = Math.max(15_000, Number(process.env.OPENAI_SHOE_COVER_TIMEOUT_MS || 120_000));
const RETRY_BASE_MS = Math.max(1000, Number(process.env.AI_SHOE_COVER_RETRY_BASE_MS || 30_000));
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, Number(process.env.AI_SHOE_COVER_RETRY_MAX_MS || 30 * 60_000));

const FOOTWEAR_PRODUCT_TYPE_KEYWORDS = [
  "sneaker",
  "sneakers",
  "running",
  "casual",
  "boot",
  "boots",
  "slipper",
  "slippers",
  "sandal",
  "sandals",
  "crocs",
  "croc",
  "shoe",
  "shoes",
  "trainer",
  "trainers",
];

const EXCLUDED_PRODUCT_TYPE_KEYWORDS = [
  "bag",
  "bags",
  "accessory",
  "accessories",
];

const AI_STATUS_VALUES = new Set(["pending", "processing", "completed", "failed"]);
const TARGET_TYPE_VALUES = new Set(["product", "color"]);

let schemaPromise = null;
let openaiClient = null;
let workerStarted = false;
let workerTimer = null;
let workerRunning = false;

const cleanText = (value = "") => String(value || "").trim();
const cleanLower = (value = "") => cleanText(value).toLowerCase();
const boolEnv = (value) => ["1", "true", "yes", "on"].includes(cleanLower(value));
const normalizeColorKey = (value = "") => cleanLower(value) || "default";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex");
const unique = (values = []) => [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];

const cloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_AI_SHOE_COVER_FOLDER || "erp/products/ai-shoe-covers",
});

const getOpenAiClient = () => {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: AI_SHOE_COVER_TIMEOUT_MS,
    });
  }
  return openaiClient;
};

export const isAiShoeCoverGenerationEnabled = () =>
  boolEnv(process.env.ENABLE_AI_SHOE_COVER_GENERATION) && Boolean(cleanText(process.env.OPENAI_API_KEY));

const isAiShoeCoverGenerationAllowedAtRuntime = async () => {
  try {
    const settings = await getAISettings();
    return settings.ai_shoe_cover_enabled !== false && Boolean(cleanText(process.env.OPENAI_API_KEY));
  } catch (error) {
    console.warn("[ai-shoe-cover] runtime setting read failed; skipping new job creation", {
      message: error?.message || String(error),
    });
    return false;
  }
};

export const isEligibleFootwearProductType = (productType = "") => {
  const normalized = cleanLower(productType);
  if (!normalized) return false;
  if (EXCLUDED_PRODUCT_TYPE_KEYWORDS.some((keyword) => normalized.includes(keyword))) return false;
  return FOOTWEAR_PRODUCT_TYPE_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const normalizeStatus = (value = "", fallback = "pending") => {
  const normalized = cleanLower(value);
  return AI_STATUS_VALUES.has(normalized) ? normalized : fallback;
};

const normalizeTargetType = (value = "", fallback = "product") => {
  const normalized = cleanLower(value);
  return TARGET_TYPE_VALUES.has(normalized) ? normalized : fallback;
};

const retryDelayMsForAttempt = (attempt = 1) => {
  const exponent = Math.max(0, Number(attempt || 1) - 1);
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** exponent));
};

const getLocalPathFromUploadUrl = (value = "") => {
  const source = cleanText(value);
  if (!source) return "";
  if (path.isAbsolute(source)) return source;
  if (source.startsWith("/uploads/")) return path.resolve(process.cwd(), source.replace(/^\/+/, ""));
  if (source.startsWith("uploads/")) return path.resolve(process.cwd(), source);
  return "";
};

const readSourceBuffer = async (sourceImageUrl = "") => {
  const source = cleanText(sourceImageUrl);
  if (!source) return null;

  if (source.startsWith("data:image/")) {
    const commaIndex = source.indexOf(",");
    if (commaIndex === -1) return null;
    const meta = source.slice(0, commaIndex);
    const payload = source.slice(commaIndex + 1);
    return Buffer.from(meta.includes(";base64") ? payload : decodeURIComponent(payload), meta.includes(";base64") ? "base64" : "utf8");
  }

  const localPath = getLocalPathFromUploadUrl(source);
  if (localPath) {
    return fs.readFile(localPath);
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch source image (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return null;
};

const saveGeneratedAsset = async ({ buffer, tenantId = null, productId = null, targetType = "product", targetKey = "product" } = {}) => {
  const safeProductId = Number(productId) > 0 ? Number(productId) : "draft";
  const safeTarget = normalizeColorKey(targetKey || targetType);
  const fileName = `shoe-cover-${safeProductId}-${safeTarget}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;

  try {
    const config = cloudinaryConfig();
    if (cloudinaryUploadsEnabled() && config.cloudName && config.apiKey && config.apiSecret && typeof fetch === "function" && typeof FormData !== "undefined") {
      const timestamp = Math.floor(Date.now() / 1000);
      const paramsToSign = { folder: config.folder, timestamp };
      const signatureBase = Object.keys(paramsToSign)
        .sort()
        .map((key) => `${key}=${paramsToSign[key]}`)
        .join("&");
      const signature = sha1(`${signatureBase}${config.apiSecret}`);
      const blob = new Blob([buffer], { type: "image/png" });
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("api_key", config.apiKey);
      formData.append("timestamp", String(timestamp));
      formData.append("folder", config.folder);
      formData.append("signature", signature);

      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`, {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error?.message || body?.message || "Cloudinary upload failed");
      }
      return {
        imageUrl: cleanText(body?.secure_url || body?.url),
        storage: "cloudinary",
      };
    }
  } catch (error) {
    console.warn("[ai-shoe-cover] cloudinary upload failed; falling back to local storage", {
      tenantId,
      productId,
      targetType,
      targetKey,
      message: error?.message || String(error),
    });
  }

  await fs.mkdir(AI_SHOE_COVER_LOCAL_DIR, { recursive: true });
  const outputPath = path.join(AI_SHOE_COVER_LOCAL_DIR, fileName);
  await fs.writeFile(outputPath, buffer);
  return {
    imageUrl: `${AI_SHOE_COVER_PUBLIC_DIR}/${fileName}`,
    storage: "local",
  };
};

const normalizeProductGalleryImage = (image = {}) => {
  if (typeof image === "string") {
    const imageUrl = cleanText(image);
    return imageUrl ? { image_url: imageUrl, preview: imageUrl } : null;
  }
  const imageUrl = cleanText(image?.image_url || image?.url || image?.preview);
  if (!imageUrl) return null;
  return {
    ...image,
    image_url: imageUrl,
    preview: cleanText(image?.preview || imageUrl),
  };
};

const normalizeGalleryImages = (value) => {
  const source = Array.isArray(value) ? value : [];
  return source.map(normalizeProductGalleryImage).filter(Boolean);
};

const imageItemSourceUrl = (image = {}) => cleanText(image?.image_url || image?.url || image?.preview);

const imageItemGeneratedByAi = (image = {}) =>
  image?.generated_by_ai === true ||
  image?.generatedByAi === true ||
  String(image?.image_role || image?.imageRole || "").trim().toLowerCase() === "ai_cover";

const uniqueImageItems = (items = []) => {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const imageUrl = imageItemSourceUrl(item).toLowerCase();
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    result.push(item);
  }
  return result;
};

const selectColorSourceImage = (group = {}, existingJob = null) => {
  const images = Array.isArray(group?.images) ? group.images : [];
  const firstOriginal = images.find((item) => imageItemSourceUrl(item) && !imageItemGeneratedByAi(item));
  if (firstOriginal) return imageItemSourceUrl(firstOriginal);

  const primaryImageUrl = cleanText(group?.primary_image_url || group?.colorPrimaryImageUrl || group?.image_url || group?.color_image_url);
  if (primaryImageUrl && primaryImageUrl !== cleanText(existingJob?.generated_image_url)) return primaryImageUrl;

  return cleanText(existingJob?.source_image_url || "");
};

const selectProductSourceImage = ({ productImageUrl = "", galleryImages = [], existingJob = null } = {}) => {
  const primaryImageUrl = cleanText(productImageUrl);
  if (primaryImageUrl && primaryImageUrl !== cleanText(existingJob?.generated_image_url)) {
    return primaryImageUrl;
  }

  const firstOriginalGalleryImage = galleryImages.find((item) => imageItemSourceUrl(item) && !imageItemGeneratedByAi(item));
  if (firstOriginalGalleryImage) {
    return imageItemSourceUrl(firstOriginalGalleryImage);
  }

  return cleanText(existingJob?.source_image_url || "");
};

export const ensureAiShoeCoverSchema = async () => {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_shoe_cover_jobs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
          target_type TEXT NOT NULL DEFAULT 'product',
          target_key TEXT NOT NULL DEFAULT 'product',
          product_type TEXT NOT NULL DEFAULT '',
          source_image_url TEXT NOT NULL DEFAULT '',
          source_image_hash TEXT NOT NULL DEFAULT '',
          generated_image_url TEXT NOT NULL DEFAULT '',
          generated_image_hash TEXT NOT NULL DEFAULT '',
          ai_cover_image_id BIGINT NULL REFERENCES product_variant_images(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMP NULL,
          generated_at TIMESTAMP NULL,
          completed_at TIMESTAMP NULL,
          next_retry_at TIMESTAMP NULL,
          last_requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`ALTER TABLE product_variant_images ADD COLUMN IF NOT EXISTS generated_by_ai BOOLEAN NOT NULL DEFAULT FALSE`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_shoe_cover_jobs_target_unique ON ai_shoe_cover_jobs (tenant_id, product_id, target_type, target_key)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_shoe_cover_jobs_status_retry ON ai_shoe_cover_jobs (status, next_retry_at, updated_at, id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_shoe_cover_jobs_product ON ai_shoe_cover_jobs (tenant_id, product_id, updated_at DESC, id DESC)`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      schemaPromise = null;
      throw error;
    } finally {
      client.release();
    }
  })();
  return schemaPromise;
};

const fetchJobMap = async (client, { tenantId, productId } = {}) => {
  const result = await client.query(
    `
    SELECT *
    FROM ai_shoe_cover_jobs
    WHERE tenant_id = $1
      AND product_id = $2
    `,
    [tenantId, productId]
  );
  const map = new Map();
  for (const row of result.rows || []) {
    map.set(`${normalizeTargetType(row.target_type)}:${cleanText(row.target_key) || "product"}`, row);
  }
  return map;
};

const upsertJob = async (client, payload = {}) => {
  const result = await client.query(
    `
    INSERT INTO ai_shoe_cover_jobs (
      tenant_id,
      product_id,
      variant_id,
      target_type,
      target_key,
      product_type,
      source_image_url,
      status,
      attempt_count,
      last_error,
      next_retry_at,
      last_requested_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, '', NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, product_id, target_type, target_key)
    DO UPDATE SET
      variant_id = EXCLUDED.variant_id,
      product_type = EXCLUDED.product_type,
      source_image_url = EXCLUDED.source_image_url,
      status = CASE
        WHEN ai_shoe_cover_jobs.source_image_url = EXCLUDED.source_image_url
          AND ai_shoe_cover_jobs.status IN ('pending', 'processing')
        THEN ai_shoe_cover_jobs.status
        ELSE 'pending'
      END,
      attempt_count = CASE
        WHEN ai_shoe_cover_jobs.source_image_url = EXCLUDED.source_image_url
          AND ai_shoe_cover_jobs.status IN ('pending', 'processing')
        THEN ai_shoe_cover_jobs.attempt_count
        ELSE 0
      END,
      last_error = CASE
        WHEN ai_shoe_cover_jobs.source_image_url = EXCLUDED.source_image_url
          AND ai_shoe_cover_jobs.status IN ('pending', 'processing')
        THEN ai_shoe_cover_jobs.last_error
        ELSE ''
      END,
      next_retry_at = CASE
        WHEN ai_shoe_cover_jobs.source_image_url = EXCLUDED.source_image_url
          AND ai_shoe_cover_jobs.status IN ('pending', 'processing')
        THEN ai_shoe_cover_jobs.next_retry_at
        ELSE NULL
      END,
      source_image_hash = ai_shoe_cover_jobs.source_image_hash,
      generated_image_hash = ai_shoe_cover_jobs.generated_image_hash,
      last_requested_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [
      Number(payload.tenantId),
      Number(payload.productId),
      payload.variantId ? Number(payload.variantId) : null,
      normalizeTargetType(payload.targetType),
      cleanText(payload.targetKey) || "product",
      cleanText(payload.productType),
      cleanText(payload.sourceImageUrl),
    ]
  );
  return result.rows[0] || null;
};

const resetJobForManualRegeneration = async (client, payload = {}) => {
  const result = await client.query(
    `
    INSERT INTO ai_shoe_cover_jobs (
      tenant_id,
      product_id,
      variant_id,
      target_type,
      target_key,
      product_type,
      source_image_url,
      source_image_hash,
      generated_image_url,
      generated_image_hash,
      ai_cover_image_id,
      status,
      attempt_count,
      last_error,
      queued_at,
      started_at,
      generated_at,
      completed_at,
      next_retry_at,
      last_requested_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', '', NULL, 'pending', 0, '', NOW(), NULL, NULL, NULL, NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, product_id, target_type, target_key)
    DO UPDATE SET
      variant_id = EXCLUDED.variant_id,
      product_type = EXCLUDED.product_type,
      source_image_url = EXCLUDED.source_image_url,
      source_image_hash = EXCLUDED.source_image_hash,
      generated_image_url = '',
      generated_image_hash = '',
      ai_cover_image_id = NULL,
      status = 'pending',
      attempt_count = 0,
      last_error = '',
      queued_at = NOW(),
      started_at = NULL,
      generated_at = NULL,
      completed_at = NULL,
      next_retry_at = NULL,
      last_requested_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [
      Number(payload.tenantId),
      Number(payload.productId),
      payload.variantId ? Number(payload.variantId) : null,
      normalizeTargetType(payload.targetType),
      cleanText(payload.targetKey) || "product",
      cleanText(payload.productType),
      cleanText(payload.sourceImageUrl),
      cleanText(payload.sourceImageHash),
    ]
  );
  return result.rows[0] || null;
};

export const scheduleAiShoeCoverJobs = async ({
  tenantId = null,
  productId = null,
  productType = "",
  productImageUrl = "",
  galleryImages = [],
  colorGroups = [],
} = {}) => {
  if (!(await isAiShoeCoverGenerationAllowedAtRuntime())) return [];
  if (!Number.isFinite(Number(tenantId)) || !Number.isFinite(Number(productId))) return [];
  if (!isEligibleFootwearProductType(productType)) return [];

  await ensureAiShoeCoverSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existingJobs = await fetchJobMap(client, {
      tenantId: Number(tenantId),
      productId: Number(productId),
    });
    const jobs = [];
    const normalizedGallery = normalizeGalleryImages(galleryImages);
    const productSourceImageUrl = selectProductSourceImage({
      productImageUrl,
      galleryImages: normalizedGallery,
      existingJob: existingJobs.get("product:product") || null,
    });

    if (productSourceImageUrl) {
      const existingJob = existingJobs.get("product:product") || null;
      if (!(existingJob && cleanText(existingJob.source_image_url) === productSourceImageUrl)) {
        const job = await upsertJob(client, {
          tenantId,
          productId,
          targetType: "product",
          targetKey: "product",
          productType,
          sourceImageUrl: productSourceImageUrl,
        });
        if (job) jobs.push(job);
      }
    }

    for (const group of Array.isArray(colorGroups) ? colorGroups : []) {
      const colorKey = normalizeColorKey(group?.color || group?.color_name || group?.color_value);
      if (!colorKey || colorKey === "default") continue;
      const existingJob = existingJobs.get(`color:${colorKey}`) || null;
      const sourceImageUrl = selectColorSourceImage(group, existingJob);
      if (!sourceImageUrl) continue;
      if (existingJob && cleanText(existingJob.source_image_url) === sourceImageUrl) {
        continue;
      }
      const variantIds = unique(
        (Array.isArray(group?.variantIds) ? group.variantIds : [])
          .concat(Array.isArray(group?.sizes) ? group.sizes.map((item) => item?.variantId || item?.variant_id) : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      );
      const job = await upsertJob(client, {
        tenantId,
        productId,
        variantId: variantIds[0] || null,
        targetType: "color",
        targetKey: colorKey,
        productType,
        sourceImageUrl,
      });
      if (job) jobs.push(job);
    }

    await client.query("COMMIT");
    return jobs;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const restoreProductSourceAsPrimary = async (client, { tenantId, productId, sourceImageUrl = "", generatedImageUrl = "" } = {}) => {
  const currentResult = await client.query(
    `
    SELECT image_url, gallery_images
    FROM products
    WHERE id = $1
      AND tenant_id = $2
    LIMIT 1
    `,
    [Number(productId), Number(tenantId)]
  );
  const current = currentResult.rows[0] || {};
  const currentGallery = normalizeGalleryImages(current.gallery_images);
  const galleryWithoutGenerated = currentGallery.filter((item) => imageItemSourceUrl(item) !== cleanText(generatedImageUrl));
  const nextGallery = uniqueImageItems([
    sourceImageUrl ? { image_url: sourceImageUrl, preview: sourceImageUrl } : null,
    ...galleryWithoutGenerated,
  ].filter(Boolean));

  await client.query(
    `
    UPDATE products
    SET image_url = $1,
        gallery_images = $2::jsonb,
        updated_at = NOW()
    WHERE id = $3
      AND tenant_id = $4
    `,
    [cleanText(sourceImageUrl), JSON.stringify(nextGallery), Number(productId), Number(tenantId)]
  );
};

const removeExistingColorAiCover = async (client, { tenantId, productId, colorKey = "", sourceImageUrl = "", variantId = null } = {}) => {
  const result = await client.query(
    `
    SELECT id, variant_id, image_url, sort_order, generated_by_ai
    FROM product_variant_images
    WHERE product_id = $1
      AND tenant_id = $2
      AND LOWER(TRIM(color_name)) = $3
    ORDER BY generated_by_ai DESC, sort_order ASC, id ASC
    `,
    [Number(productId), Number(tenantId), normalizeColorKey(colorKey)]
  );

  const rows = result.rows || [];
  const originalRows = rows.filter((row) => !row.generated_by_ai);
  const aiRows = rows.filter((row) => row.generated_by_ai);
  if (aiRows.length) {
    await client.query(
      `
      DELETE FROM product_variant_images
      WHERE id = ANY($1::bigint[])
      `,
      [aiRows.map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0)]
    );
  }

  let nextOriginalRows = originalRows;
  if (!nextOriginalRows.length && cleanText(sourceImageUrl)) {
    const inserted = await client.query(
      `
      INSERT INTO product_variant_images (
        tenant_id,
        product_id,
        variant_id,
        color_name,
        color_value,
        image_url,
        sort_order,
        is_primary,
        generated_by_ai
      )
      VALUES ($1, $2, $3, $4, $5, $6, 0, TRUE, FALSE)
      RETURNING id, variant_id, image_url, sort_order, generated_by_ai
      `,
      [Number(tenantId), Number(productId), variantId ? Number(variantId) : null, normalizeColorKey(colorKey), normalizeColorKey(colorKey), cleanText(sourceImageUrl)]
    );
    nextOriginalRows = inserted.rows || [];
  }

  for (let index = 0; index < nextOriginalRows.length; index += 1) {
    await client.query(
      `
      UPDATE product_variant_images
      SET sort_order = $1,
          is_primary = $2
      WHERE id = $3
      `,
      [index, index === 0, Number(nextOriginalRows[index].id)]
    );
  }

  if (cleanText(sourceImageUrl)) {
    await client.query(
      `
      UPDATE product_variants
      SET image_url = $1,
          updated_at = NOW()
      WHERE product_id = $2
        AND tenant_id = $3
        AND LOWER(TRIM(color)) = $4
        AND is_active IS DISTINCT FROM FALSE
        AND deleted_at IS NULL
      `,
      [cleanText(sourceImageUrl), Number(productId), Number(tenantId), normalizeColorKey(colorKey)]
    );
  }
};

export const regenerateAiShoeCoverTarget = async ({
  tenantId = null,
  productId = null,
  targetType = "product",
  color = "",
} = {}) => {
  if (!(await isAiShoeCoverGenerationAllowedAtRuntime())) {
    const error = new Error("AI shoe cover generation is disabled");
    error.status = 409;
    throw error;
  }
  if (!Number.isFinite(Number(tenantId)) || Number(tenantId) <= 0 || !Number.isFinite(Number(productId)) || Number(productId) <= 0) {
    const error = new Error("Invalid product target");
    error.status = 400;
    throw error;
  }

  await ensureAiShoeCoverSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      `
      SELECT id, tenant_id, product_type, image_url, gallery_images
      FROM products
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      [Number(productId), Number(tenantId)]
    );
    const product = productResult.rows[0] || null;
    if (!product) {
      const error = new Error("Product not found");
      error.status = 404;
      throw error;
    }
    if (!isEligibleFootwearProductType(product.product_type)) {
      const error = new Error("AI shoe covers are only available for footwear products");
      error.status = 400;
      throw error;
    }

    const normalizedTargetType = normalizeTargetType(targetType);
    const targetKey = normalizedTargetType === "product" ? "product" : normalizeColorKey(color);
    if (normalizedTargetType === "color" && (!targetKey || targetKey === "default")) {
      const error = new Error("A color target is required");
      error.status = 400;
      throw error;
    }

    const existingJobMap = await fetchJobMap(client, { tenantId: Number(tenantId), productId: Number(productId) });
    const existingJob = existingJobMap.get(`${normalizedTargetType}:${targetKey}`) || null;
    if (normalizeStatus(existingJob?.status || "") === "processing") {
      const error = new Error("AI cover generation is already processing for this target");
      error.status = 409;
      throw error;
    }

    let sourceImageUrl = "";
    let variantId = null;
    if (normalizedTargetType === "product") {
      sourceImageUrl = selectProductSourceImage({
        productImageUrl: product.image_url,
        galleryImages: normalizeGalleryImages(product.gallery_images),
        existingJob,
      });
      if (!sourceImageUrl) {
        const error = new Error("No original product image is available for regeneration");
        error.status = 400;
        throw error;
      }
      await restoreProductSourceAsPrimary(client, {
        tenantId,
        productId,
        sourceImageUrl,
        generatedImageUrl: cleanText(existingJob?.generated_image_url),
      });
    } else {
      const colorImagesResult = await client.query(
        `
        SELECT id, variant_id, image_url, sort_order, generated_by_ai
        FROM product_variant_images
        WHERE product_id = $1
          AND tenant_id = $2
          AND LOWER(TRIM(color_name)) = $3
        ORDER BY generated_by_ai DESC, sort_order ASC, id ASC
        `,
        [Number(productId), Number(tenantId), targetKey]
      );
      const colorImageRows = colorImagesResult.rows || [];
      const originalRows = colorImageRows.filter((row) => !row.generated_by_ai);
      sourceImageUrl = cleanText(originalRows[0]?.image_url || existingJob?.source_image_url);
      variantId = Number(originalRows[0]?.variant_id || 0) || null;

      if (!variantId) {
        const variantResult = await client.query(
          `
          SELECT id
          FROM product_variants
          WHERE product_id = $1
            AND tenant_id = $2
            AND LOWER(TRIM(color)) = $3
            AND is_active IS DISTINCT FROM FALSE
            AND deleted_at IS NULL
          ORDER BY id ASC
          LIMIT 1
          `,
          [Number(productId), Number(tenantId), targetKey]
        );
        variantId = Number(variantResult.rows[0]?.id || 0) || null;
      }

      if (!sourceImageUrl) {
        const error = new Error("No original color image is available for regeneration");
        error.status = 400;
        throw error;
      }

      await removeExistingColorAiCover(client, {
        tenantId,
        productId,
        colorKey: targetKey,
        sourceImageUrl,
        variantId,
      });
    }

    const sourceBuffer = await readSourceBuffer(sourceImageUrl);
    if (!sourceBuffer?.length) {
      const error = new Error("Source image could not be loaded");
      error.status = 400;
      throw error;
    }
    const sourceImageHash = sha256(sourceBuffer);

    const job = await resetJobForManualRegeneration(client, {
      tenantId,
      productId,
      variantId,
      targetType: normalizedTargetType,
      targetKey,
      productType: cleanText(product.product_type),
      sourceImageUrl,
      sourceImageHash,
    });

    await client.query("COMMIT");
    return normalizeJobRow(job);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const claimJobs = async (limit = AI_SHOE_COVER_BATCH_SIZE) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      WITH next_jobs AS (
        SELECT id
        FROM ai_shoe_cover_jobs
        WHERE (
          status = 'pending'
          OR (status = 'failed' AND COALESCE(next_retry_at, CURRENT_TIMESTAMP) <= CURRENT_TIMESTAMP)
        )
          AND attempt_count < $1
        ORDER BY updated_at ASC, id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ai_shoe_cover_jobs job
      SET status = 'processing',
          started_at = NOW(),
          attempt_count = job.attempt_count + 1,
          last_error = '',
          updated_at = NOW()
      FROM next_jobs
      WHERE job.id = next_jobs.id
      RETURNING job.*
      `,
      [AI_SHOE_COVER_MAX_ATTEMPTS, limit]
    );
    await client.query("COMMIT");
    return result.rows || [];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const recoverStaleProcessingJobs = async () => {
  await db.query(
    `
    UPDATE ai_shoe_cover_jobs
    SET status = 'failed',
        last_error = CASE
          WHEN COALESCE(NULLIF(last_error, ''), '') = '' THEN 'Worker recovered stale processing job'
          ELSE last_error
        END,
        next_retry_at = NOW(),
        updated_at = NOW()
    WHERE status = 'processing'
      AND started_at IS NOT NULL
      AND started_at < (NOW() - INTERVAL '15 minutes')
      AND attempt_count < $1
    `,
    [AI_SHOE_COVER_MAX_ATTEMPTS]
  );
};

const completeJob = async (client, {
  jobId,
  sourceImageHash = "",
  generatedImageUrl = "",
  generatedImageHash = "",
  aiCoverImageId = null,
} = {}) => {
  await client.query(
    `
    UPDATE ai_shoe_cover_jobs
    SET status = 'completed',
        source_image_hash = $2,
        generated_image_url = $3,
        generated_image_hash = $4,
        ai_cover_image_id = $5,
        last_error = '',
        generated_at = NOW(),
        completed_at = NOW(),
        next_retry_at = NULL,
        updated_at = NOW()
    WHERE id = $1
    `,
    [jobId, sourceImageHash, generatedImageUrl, generatedImageHash, aiCoverImageId]
  );
};

const failJob = async (job = {}, error = null) => {
  const attemptCount = Number(job.attempt_count || 0);
  const nextRetryAt = attemptCount >= AI_SHOE_COVER_MAX_ATTEMPTS ? null : new Date(Date.now() + retryDelayMsForAttempt(attemptCount)).toISOString();
  await db.query(
    `
    UPDATE ai_shoe_cover_jobs
    SET status = 'failed',
        last_error = $2,
        next_retry_at = $3,
        updated_at = NOW()
    WHERE id = $1
    `,
    [job.id, cleanText(error?.message || error || "AI shoe catalog cleanup failed"), nextRetryAt]
  );
};

const ensureProductCoverPlacement = async (client, job = {}, generatedImageUrl = "") => {
  const productId = Number(job.product_id || 0);
  const sourceImageUrl = cleanText(job.source_image_url);
  const productResult = await client.query(
    `
    SELECT image_url, gallery_images
    FROM products
    WHERE id = $1
      AND tenant_id = $2
    LIMIT 1
    `,
    [productId, Number(job.tenant_id)]
  );
  const current = productResult.rows[0] || {};
  const currentGallery = normalizeGalleryImages(current.gallery_images);
  const galleryWithoutGenerated = currentGallery.filter((item) => imageItemSourceUrl(item) !== cleanText(generatedImageUrl));
  const nextGallery = uniqueImageItems([
    sourceImageUrl ? { image_url: sourceImageUrl, preview: sourceImageUrl } : null,
    ...galleryWithoutGenerated,
  ].filter(Boolean));

  await client.query(
    `
    UPDATE products
    SET image_url = $1,
        gallery_images = $2::jsonb,
        updated_at = NOW()
    WHERE id = $3
      AND tenant_id = $4
    `,
    [generatedImageUrl, JSON.stringify(nextGallery), productId, Number(job.tenant_id)]
  );
  return null;
};

const ensureColorCoverPlacement = async (client, job = {}, generatedImageUrl = "") => {
  const productId = Number(job.product_id || 0);
  const tenantId = Number(job.tenant_id || 0);
  const colorKey = normalizeColorKey(job.target_key || "");
  const variantId = Number(job.variant_id || 0) || null;

  const result = await client.query(
    `
    SELECT id, variant_id, color_name, color_value, image_url, sort_order, is_primary, generated_by_ai
    FROM product_variant_images
    WHERE product_id = $1
      AND tenant_id = $2
      AND LOWER(TRIM(color_name)) = $3
    ORDER BY generated_by_ai DESC, sort_order ASC, id ASC
    `,
    [productId, tenantId, colorKey]
  );

  const rows = result.rows || [];
  const aiRow = rows.find((row) => row.generated_by_ai) || null;
  let originalRows = rows.filter((row) => !row.generated_by_ai);
  let aiCoverImageId = aiRow?.id || null;

  if (!originalRows.length && cleanText(job.source_image_url)) {
    const insertedOriginal = await client.query(
      `
      INSERT INTO product_variant_images (
        tenant_id,
        product_id,
        variant_id,
        color_name,
        color_value,
        image_url,
        sort_order,
        is_primary,
        generated_by_ai
      )
      VALUES ($1, $2, $3, $4, $5, $6, 1, FALSE, FALSE)
      RETURNING id, variant_id, color_name, color_value, image_url, sort_order, is_primary, generated_by_ai
      `,
      [tenantId, productId, variantId, colorKey, colorKey, cleanText(job.source_image_url)]
    );
    originalRows = insertedOriginal.rows || [];
  }

  if (aiRow) {
    await client.query(
      `
      UPDATE product_variant_images
      SET image_url = $1,
          sort_order = 0,
          is_primary = TRUE,
          generated_by_ai = TRUE
      WHERE id = $2
      `,
      [generatedImageUrl, aiRow.id]
    );
  } else {
    const inserted = await client.query(
      `
      INSERT INTO product_variant_images (
        tenant_id,
        product_id,
        variant_id,
        color_name,
        color_value,
        image_url,
        sort_order,
        is_primary,
        generated_by_ai
      )
      VALUES ($1, $2, $3, $4, $5, $6, 0, TRUE, TRUE)
      RETURNING id
      `,
      [tenantId, productId, variantId, colorKey, colorKey, generatedImageUrl]
    );
    aiCoverImageId = inserted.rows[0]?.id || null;
  }

  for (let index = 0; index < originalRows.length; index += 1) {
    const row = originalRows[index];
    await client.query(
      `
      UPDATE product_variant_images
      SET sort_order = $1,
          is_primary = FALSE
      WHERE id = $2
      `,
      [index + 1, row.id]
    );
  }

  await client.query(
    `
    UPDATE product_variants
    SET image_url = $1,
        updated_at = NOW()
    WHERE product_id = $2
      AND tenant_id = $3
      AND LOWER(TRIM(color)) = $4
      AND is_active IS DISTINCT FROM FALSE
      AND deleted_at IS NULL
    `,
    [generatedImageUrl, productId, tenantId, colorKey]
  );

  return aiCoverImageId;
};

const generateCoverBuffer = async ({ sourceImageUrl = "", productName = "" } = {}) => {
  const sourceBuffer = await readSourceBuffer(sourceImageUrl);
  if (!sourceBuffer?.length) {
    throw new Error("Source image could not be loaded");
  }
  if (sourceBuffer.length > AI_SHOE_COVER_MAX_SOURCE_BYTES) {
    throw new Error("Source image is too large for AI shoe catalog cleanup");
  }

  const imageFile = await toFile(sourceBuffer, `${cleanText(productName) || "shoe"}-source.png`, {
    type: "image/png",
  });
  const response = await getOpenAiClient().images.edit({
    model: AI_SHOE_COVER_MODEL,
    image: imageFile,
    prompt: AI_SHOE_COVER_PROMPT,
    quality: "high",
    size: "1024x1024",
    output_format: "png",
    n: 1,
  });
  const imageBase64 =
    response?.data?.[0]?.b64_json ||
    response?.data?.[0]?.base64 ||
    response?.output?.[0]?.b64_json ||
    response?.output?.[0]?.base64 ||
    "";
  if (!imageBase64) {
    throw new Error("OpenAI did not return an AI shoe catalog cleanup image");
  }
  return {
    sourceBuffer,
    generatedBuffer: Buffer.from(imageBase64, "base64"),
  };
};

const loadProductName = async (client, productId) => {
  const result = await client.query("SELECT name FROM products WHERE id = $1 LIMIT 1", [productId]);
  return cleanText(result.rows[0]?.name || "");
};

const processJob = async (job = {}) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const latestResult = await client.query(
      `
      SELECT *
      FROM ai_shoe_cover_jobs
      WHERE id = $1
      FOR UPDATE
      `,
      [job.id]
    );
    const lockedJob = latestResult.rows[0] || null;
    if (!lockedJob) {
      await client.query("ROLLBACK");
      return;
    }

    const productName = await loadProductName(client, lockedJob.product_id);
    const { sourceBuffer, generatedBuffer } = await generateCoverBuffer({
      sourceImageUrl: lockedJob.source_image_url,
      productName,
    });
    const sourceImageHash = sha256(sourceBuffer);

    if (cleanText(lockedJob.source_image_hash) === sourceImageHash && cleanText(lockedJob.generated_image_url)) {
      let aiCoverImageId = lockedJob.ai_cover_image_id || null;
      if (normalizeTargetType(lockedJob.target_type) === "product") {
        await ensureProductCoverPlacement(client, lockedJob, lockedJob.generated_image_url);
      } else {
        aiCoverImageId = await ensureColorCoverPlacement(client, lockedJob, lockedJob.generated_image_url);
      }
      await completeJob(client, {
        jobId: lockedJob.id,
        sourceImageHash,
        generatedImageUrl: lockedJob.generated_image_url,
        generatedImageHash: cleanText(lockedJob.generated_image_hash),
        aiCoverImageId,
      });
      await client.query("COMMIT");
      return;
    }

    const generatedImageHash = sha256(generatedBuffer);
    const stored = await saveGeneratedAsset({
      buffer: generatedBuffer,
      tenantId: lockedJob.tenant_id,
      productId: lockedJob.product_id,
      targetType: lockedJob.target_type,
      targetKey: lockedJob.target_key,
    });
    const generatedImageUrl = cleanText(stored.imageUrl);
    if (!generatedImageUrl) {
      throw new Error("Generated cover could not be stored");
    }

    let aiCoverImageId = null;
    if (normalizeTargetType(lockedJob.target_type) === "product") {
      await ensureProductCoverPlacement(client, lockedJob, generatedImageUrl);
    } else {
      aiCoverImageId = await ensureColorCoverPlacement(client, lockedJob, generatedImageUrl);
    }

    await completeJob(client, {
      jobId: lockedJob.id,
      sourceImageHash,
      generatedImageUrl,
      generatedImageHash,
      aiCoverImageId,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await failJob(job, error);
    console.error("[ai-shoe-cover] job failed", {
      id: job.id,
      tenantId: job.tenant_id,
      productId: job.product_id,
      targetType: job.target_type,
      targetKey: job.target_key,
      attemptCount: job.attempt_count,
      message: error?.message || String(error),
      stack: error?.stack,
    });
  } finally {
    client.release();
  }
};

const workerCycle = async () => {
  if (workerRunning) return;
  workerRunning = true;
  try {
    if (!(await isAiShoeCoverGenerationAllowedAtRuntime())) return;
    await ensureAiShoeCoverSchema();
    await recoverStaleProcessingJobs();
    const jobs = await claimJobs();
    if (!jobs.length) return;
    await Promise.all(jobs.map((job) => processJob(job)));
  } catch (error) {
    console.error("[ai-shoe-cover] worker cycle failed", {
      message: error?.message || String(error),
      stack: error?.stack,
    });
  } finally {
    workerRunning = false;
  }
};

export const startAiShoeCoverWorker = () => {
  if (workerStarted) return;
  workerStarted = true;
  workerTimer = setInterval(() => {
    void workerCycle();
  }, AI_SHOE_COVER_POLL_MS);
  void workerCycle();
};

export const stopAiShoeCoverWorker = () => {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerStarted = false;
};

const normalizeJobRow = (row = {}) => ({
  id: Number(row.id || 0) || null,
  target_type: normalizeTargetType(row.target_type),
  target_key: cleanText(row.target_key) || "product",
  status: normalizeStatus(row.status),
  source_image_url: cleanText(row.source_image_url),
  generated_image_url: cleanText(row.generated_image_url),
  ai_cover_image_id: Number(row.ai_cover_image_id || 0) || null,
  generated_at: row.generated_at || row.completed_at || null,
  last_error: cleanText(row.last_error),
  retry_count: Number(row.attempt_count || 0),
});

export const loadAiShoeCoverStateMap = async (clientOrPool, productIds = []) => {
  const ids = unique((Array.isArray(productIds) ? productIds : [productIds]).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
  if (!ids.length) return { productMap: new Map(), colorMap: new Map() };
  const client = clientOrPool && typeof clientOrPool.query === "function" ? clientOrPool : await db.connect();
  const release = !(clientOrPool && typeof clientOrPool.query === "function");
  try {
    await ensureAiShoeCoverSchema();
    const result = await client.query(
      `
      SELECT *
      FROM ai_shoe_cover_jobs
      WHERE product_id = ANY($1::bigint[])
      `,
      [ids]
    );
    const productMap = new Map();
    const colorMap = new Map();
    for (const row of result.rows || []) {
      const normalized = normalizeJobRow(row);
      if (normalized.target_type === "product") {
        productMap.set(String(row.product_id), normalized);
      } else {
        colorMap.set(`${row.product_id}:${normalized.target_key}`, normalized);
      }
    }
    return { productMap, colorMap };
  } finally {
    if (release) client.release();
  }
};
