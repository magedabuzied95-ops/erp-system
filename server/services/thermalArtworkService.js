import OpenAI, { toFile } from "openai";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

import sharp from "sharp";

import db from "../database/db.js";

const THERMAL_IMAGE_DIR = path.resolve(process.cwd(), "uploads", "products", "thermal");
const THERMAL_IMAGE_PUBLIC_PREFIX = "/uploads/products/thermal";
const THERMAL_IMAGE_MAX_SIDE = Number(process.env.THERMAL_IMAGE_MAX_SIDE || 1400);
const THERMAL_IMAGE_FILE_FORMAT = "png";
const THERMAL_JOB_IN_FLIGHT = new Map();
const THERMAL_ARTWORK_BACKGROUND_THRESHOLD = 245;
const THERMAL_ARTWORK_FILL_TARGET = 0.9;
const THERMAL_ARTWORK_FILL_MIN = 0.84;
const THERMAL_ARTWORK_FILL_MAX = 0.94;
const DEFAULT_MODEL = process.env.OPENAI_THERMAL_ARTWORK_MODEL || "gpt-image-1.5";
const DEFAULT_TIMEOUT_MS = 90_000;

export const THERMAL_ARTWORK_VERSION = "v1-openai";
export const THERMAL_ARTWORK_PROMPT = [
  "Generate only the shoe artwork. Do not include any brand logo, product title, text, labels, numbers, frame, border, poster, or mockup.",
  "Create a clean monochrome thermal artwork for 203 dpi direct thermal label printing.",
  "",
  "Requirements:",
  "",
  "* Output only a single isolated shoe.",
  "* Use a plain white background.",
  "* Use black and gray line-art only.",
  "* Preserve shoe details as line-art, not a solid silhouette.",
  "* Keep the shoe large so it fills most of the image area.",
  "* Keep the exact shoe proportions.",
  "* Preserve outsole shape.",
  "* Preserve lace layout.",
  "* Remove background completely.",
  "* No logo.",
  "* No text.",
  "* No labels.",
  "* No numbers.",
  "* No border.",
  "* No card layout.",
  "* No poster layout.",
  "* No composition or mockup.",
  "* Suitable for 203 dpi direct thermal barcode label printing.",
].join("\n");

const thermalArtworkCache = new Map();
let openaiClient = null;

sharp.cache(false);
sharp.concurrency(1);

const normalizeText = (value = "") => String(value || "").trim();
const cleanText = (value = "") => {
  const text = String(value ?? "").trim();
  return text && !["null", "undefined", "n/a", "none"].includes(text.toLowerCase()) ? text : "";
};
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const sha1 = (value = "") => crypto.createHash("sha1").update(String(value || "")).digest("hex");
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const isHttpUrl = (value = "") => /^https?:\/\//i.test(normalizeText(value));

const isLocalUploadsPath = (value = "") => {
  const normalized = normalizeText(value).replace(/\\/g, "/");
  return normalized.startsWith("/uploads/") || normalized.startsWith("uploads/");
};

const resolveLocalSourcePath = (value = "") => {
  const normalized = normalizeText(value).replace(/\\/g, "/");
  if (!normalized) return "";
  if (path.isAbsolute(normalized)) return normalized;
  if (normalized.startsWith("/")) {
    return path.resolve(process.cwd(), normalized.replace(/^\/+/, ""));
  }
  if (normalized.startsWith("uploads/")) {
    return path.resolve(process.cwd(), normalized);
  }
  if (normalized.startsWith("/uploads/")) {
    return path.resolve(process.cwd(), normalized.replace(/^\/+/, ""));
  }
  return "";
};

const ensureDir = async (dirPath = THERMAL_IMAGE_DIR) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const fileExists = async (filePath = "") => {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readSourceBuffer = async (sourceImageUrl = "") => {
  const source = normalizeText(sourceImageUrl);
  if (!source) return null;

  if (source.startsWith("data:image/")) {
    const commaIndex = source.indexOf(",");
    if (commaIndex === -1) return null;
    const meta = source.slice(0, commaIndex);
    const payload = source.slice(commaIndex + 1);
    return Buffer.from(
      meta.includes(";base64") ? payload : decodeURIComponent(payload),
      meta.includes(";base64") ? "base64" : "utf8"
    );
  }

  const localPath = resolveLocalSourcePath(source);
  if (localPath && (await fileExists(localPath))) {
    return fs.readFile(localPath);
  }

  if (isLocalUploadsPath(source)) {
    const candidate = resolveLocalSourcePath(source);
    if (candidate && (await fileExists(candidate))) {
      return fs.readFile(candidate);
    }
  }

  if (isHttpUrl(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch source image (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return null;
};

const sourceFingerprint = async (sourceImageUrl = "") => {
  const source = normalizeText(sourceImageUrl);
  if (!source) return "";
  const localPath = resolveLocalSourcePath(source);
  if (localPath && (await fileExists(localPath))) {
    const stat = await fs.stat(localPath);
    return `${source}|${stat.size}|${stat.mtimeMs}`;
  }
  return source;
};

const jobKeyFor = async ({ entityType = "product", tenantId = null, productId = null, variantId = null, sourceImageUrl = "" } = {}) => {
  const fingerprint = await sourceFingerprint(sourceImageUrl);
  return crypto
    .createHash("sha1")
    .update(
      [
        entityType,
        tenantId ?? "",
        productId ?? "",
        variantId ?? "",
        fingerprint,
      ].join("|")
    )
    .digest("hex");
};

const outputFileNameFor = async ({ entityType = "product", productId = null, variantId = null, sourceImageUrl = "" } = {}) => {
  const jobKey = await jobKeyFor({ entityType, productId, variantId, sourceImageUrl });
  return `${entityType}-${productId || "product"}-${variantId || "base"}-${jobKey.slice(0, 16)}.${THERMAL_IMAGE_FILE_FORMAT}`;
};

const outputPathFor = async (options = {}) => {
  await ensureDir();
  return path.join(THERMAL_IMAGE_DIR, await outputFileNameFor(options));
};

const outputUrlFor = async (options = {}) => `${THERMAL_IMAGE_PUBLIC_PREFIX}/${await outputFileNameFor(options)}`;

const cloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_PRODUCT_FOLDER || "erp/products",
});

const getClient = () => {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: positiveNumber(process.env.OPENAI_THERMAL_ARTWORK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    });
  }
  return openaiClient;
};

const normalizeSourceImage = async (value = "") => {
  const image = await readSourceBuffer(value);
  if (!image) return null;

  try {
    const normalized = await sharp(image, { animated: false })
      .rotate()
      .resize({
        width: 1536,
        height: 1536,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return {
      buffer: normalized,
      mimetype: "image/png",
    };
  } catch {
    return {
      buffer: image,
      mimetype: "image/png",
    };
  }
};

const saveThermalArtworkAsset = async ({ buffer, productId = null, sourceKey = "", mimetype = "image/png" } = {}) => {
  const safeSourceKey = sha1(sourceKey || buffer?.length || "");
  const safeProductKey = Number.isFinite(Number(productId)) && Number(productId) > 0 ? `product-${Number(productId)}` : "draft";
  const fileName = `${safeProductKey}-thermal-${safeSourceKey.slice(0, 12)}-${Date.now()}.png`;

  try {
    const config = cloudinaryConfig();
    if (config.cloudName && config.apiKey && config.apiSecret && typeof fetch === "function" && typeof FormData !== "undefined") {
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureBase = Object.keys({ folder: config.folder, timestamp })
        .sort()
        .map((key) => `${key}=${key === "folder" ? config.folder : timestamp}`)
        .join("&");
      const signature = sha1(`${signatureBase}${config.apiSecret}`);
      const blob = new Blob([buffer], { type: mimetype || "image/png" });
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
        thermal_image_url: body?.secure_url || "",
        storage: "cloudinary",
      };
    }
  } catch (error) {
    console.warn("[thermal-artwork] cloudinary upload failed; falling back to local storage", {
      message: error?.message || String(error),
    });
  }

  const outputDir = path.join(process.cwd(), "uploads", "products", "thermal-artwork");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  await fs.writeFile(outputPath, buffer);
  return {
    thermal_image_url: `/uploads/products/thermal-artwork/${fileName}`,
    storage: "local",
    outputPath,
  };
};

const detectArtworkBounds = (data = Buffer.alloc(0), info = {}) => {
  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  const channels = Number(info.channels || 3);
  if (!width || !height) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * channels;
      const red = data[index] ?? 255;
      const green = data[index + 1] ?? 255;
      const blue = data[index + 2] ?? 255;
      if (red >= THERMAL_ARTWORK_BACKGROUND_THRESHOLD && green >= THERMAL_ARTWORK_BACKGROUND_THRESHOLD && blue >= THERMAL_ARTWORK_BACKGROUND_THRESHOLD) {
        continue;
      }

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;

  return {
    left: minX,
    top: minY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1,
  };
};

const postProcessThermalArtworkBuffer = async (inputBuffer) => {
  try {
    const prepared = sharp(inputBuffer, { animated: false }).rotate();
    const { data, info } = await prepared.raw().toBuffer({ resolveWithObject: true });
    const width = Number(info.width || 0);
    const height = Number(info.height || 0);
    if (!width || !height) {
      return inputBuffer;
    }

    const bounds = detectArtworkBounds(data, info);
    if (!bounds) {
      return sharp(data, { raw: { width, height, channels: Number(info.channels || 3) } })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          force: true,
        })
        .toBuffer();
    }

    const trimmed = sharp(data, { raw: { width, height, channels: Number(info.channels || 3) } }).extract(bounds);
    const fitScale = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height));
    const targetScale = clamp(fitScale * THERMAL_ARTWORK_FILL_TARGET, fitScale * THERMAL_ARTWORK_FILL_MIN, fitScale * THERMAL_ARTWORK_FILL_MAX);
    const scaledWidth = Math.max(1, Math.round(bounds.width * targetScale));
    const scaledHeight = Math.max(1, Math.round(bounds.height * targetScale));
    const offsetLeft = Math.max(0, Math.round((width - scaledWidth) / 2));
    const offsetTop = Math.max(0, Math.round((height - scaledHeight) / 2));
    const resizedArtwork = await trimmed
      .resize({
        width: scaledWidth,
        height: scaledHeight,
        fit: "fill",
        withoutEnlargement: false,
        kernel: sharp.kernel.nearest,
      })
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
        force: true,
      })
      .toBuffer();

    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: resizedArtwork, left: offsetLeft, top: offsetTop }])
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
        force: true,
      })
      .toBuffer();
  } catch (error) {
    console.warn("[thermal-artwork] post-process failed, using generated image", error);
    return inputBuffer;
  }
};

const updateThermalRecord = async ({ entityType = "product", productId = null, variantId = null, tenantId = null, thermalImageUrl = "", thermalImageStatus = "ready", thermalImageError = "" } = {}) => {
  const safeUrl = normalizeText(thermalImageUrl);
  const safeStatus = normalizeText(thermalImageStatus) || "ready";
  const safeError = normalizeText(thermalImageError);
  const safeGeneratedAtSql = safeStatus === "ready" ? "NOW()" : "NULL";
  if (entityType === "variant" && variantId) {
    await db.query(
      `
      UPDATE product_variants
      SET thermal_image_url = $1,
          thermal_image_status = $2,
          thermal_image_generated_at = ${safeGeneratedAtSql},
          thermal_image_error = $3,
          updated_at = NOW()
      WHERE id = $4
        AND ($5::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $5::bigint)
      `,
      [safeUrl, safeStatus, safeError, variantId, tenantId]
    );
    return;
  }

  if (productId) {
    await db.query(
      `
      UPDATE products
      SET thermal_image_url = $1,
          thermal_image_status = $2,
          thermal_image_generated_at = ${safeGeneratedAtSql},
          thermal_image_error = $3,
          updated_at = NOW()
      WHERE id = $4
        AND ($5::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $5::bigint)
      `,
      [safeUrl, safeStatus, safeError, productId, tenantId]
    );
  }
};

export const regenerateThermalImageForProductImage = async (options = {}) => {
  const entityType = options.entityType === "variant" ? "variant" : "product";
  const productId = Number(options.productId || 0) || null;
  const variantId = Number(options.variantId || 0) || null;
  const tenantId = options.tenantId === null || options.tenantId === undefined ? null : Number(options.tenantId) || null;
  const sourceImageUrl = normalizeText(options.sourceImageUrl || options.imageUrl || "");
  const existingThermalImageUrl = normalizeText(options.existingThermalImageUrl || "");
  const regenerate = options.regenerate === true || String(options.regenerate || "").toLowerCase() === "true";
  const productName = normalizeText(options.productName || options.name || "");
  const inputKey = await jobKeyFor({ entityType, tenantId, productId, variantId, sourceImageUrl });

  if (!sourceImageUrl && existingThermalImageUrl) {
    return {
      success: true,
      thermal_image_url: existingThermalImageUrl,
      cached: true,
      updated: false,
      storage: existingThermalImageUrl.startsWith("http") ? "remote" : "local",
      source: "cached-existing",
      model: "sharp-thermal-artwork",
      prompt: "",
      job_key: inputKey,
    };
  }

  if (!sourceImageUrl) {
    throw Object.assign(new Error("Thermal source image is missing"), { status: 400 });
  }

  const cacheKey = `${entityType}:${tenantId ?? "tenant"}:${productId ?? "product"}:${variantId ?? "variant"}:${inputKey}`;
  if (THERMAL_JOB_IN_FLIGHT.has(cacheKey)) {
    return THERMAL_JOB_IN_FLIGHT.get(cacheKey);
  }

  const job = (async () => {
    const outputUrl = await outputUrlFor({ entityType, productId, variantId, sourceImageUrl });
    const outputPath = await outputPathFor({ entityType, productId, variantId, sourceImageUrl });

    console.log("THERMAL_IMAGE_JOB_STARTED", {
      entityType,
      productId,
      variantId,
      tenantId,
      productName,
      sourceImageUrl,
      outputUrl,
    });

    if (!regenerate && (await fileExists(outputPath))) {
      await updateThermalRecord({
        entityType,
        productId,
        variantId,
        tenantId,
        thermalImageUrl: outputUrl,
        thermalImageStatus: "ready",
      });
      console.log("THERMAL_IMAGE_JOB_READY", {
        entityType,
        productId,
        variantId,
        tenantId,
        productName,
        thermalImageUrl: outputUrl,
        cached: true,
      });
      return {
        success: true,
        thermal_image_url: outputUrl,
        source: "cached",
        cached: true,
        updated: true,
        storage: "local",
        prompt: "",
        model: "sharp-thermal-artwork",
        job_key: inputKey,
      };
    }

    await updateThermalRecord({
      entityType,
      productId,
      variantId,
      tenantId,
      thermalImageUrl: "",
      thermalImageStatus: "processing",
    });

    const normalizedSource = await normalizeSourceImage(sourceImageUrl);
    if (!normalizedSource?.buffer) {
      throw new Error("Thermal source image could not be loaded");
    }

    const inputFile = await toFile(normalizedSource.buffer, `${cleanText(productName) || "product"}-thermal-source.png`, {
      type: normalizedSource.mimetype || "image/png",
    });

    const startedAt = Date.now();
    const client = getClient();
    console.log({
      hasKey: Boolean(process.env.OPENAI_API_KEY),
      sameClient: client === openaiClient,
    });
    const model = DEFAULT_MODEL;
    console.log("[thermal-artwork] OpenAI request start", {
      productId: productId || "",
      productName: cleanText(productName) || "",
      model,
    });

    const response = await client.images.edit({
      model,
      image: inputFile,
      prompt: THERMAL_ARTWORK_PROMPT,
      background: "transparent",
      input_fidelity: "high",
      output_format: "png",
      quality: "high",
      size: "1024x1024",
      n: 1,
    });

    const imageBase64 =
      response?.data?.[0]?.b64_json ||
      response?.data?.[0]?.base64 ||
      response?.data?.[0]?.image_base64 ||
      response?.output?.[0]?.b64_json ||
      response?.output?.[0]?.base64 ||
      response?.output?.[0]?.image_base64 ||
      "";
    if (!imageBase64) {
      throw new Error("OpenAI did not return thermal artwork image data");
    }

    const generatedBuffer = Buffer.from(imageBase64, "base64");
    console.log("THERMAL_ARTWORK_BUFFER_SOURCE", {
      using_openai_generated_buffer: true,
      using_original_source_buffer: false,
    });

    let thermalBuffer = generatedBuffer;
    try {
      thermalBuffer = await postProcessThermalArtworkBuffer(generatedBuffer);
    } catch (zoomError) {
      console.warn("[thermal-artwork] auto-zoom failed, saving generated image directly", {
        entityType,
        productId,
        variantId,
        message: zoomError?.message || String(zoomError),
      });
      thermalBuffer = generatedBuffer;
    }

    const stored = await saveThermalArtworkAsset({
      buffer: thermalBuffer,
      productId,
      sourceKey: `${sourceImageUrl}:${productId || ""}:${Date.now()}`,
      mimetype: "image/png",
    });

    await updateThermalRecord({
      entityType,
      productId,
      variantId,
      tenantId,
      thermalImageUrl: stored.thermal_image_url,
      thermalImageStatus: stored.thermal_image_url ? "ready" : "failed",
    });

    const result = {
      thermal_image_url: stored.thermal_image_url,
      cached: false,
      source: "OPENAI",
      storage: stored.storage,
      prompt: THERMAL_ARTWORK_PROMPT,
      model,
      durationMs: Date.now() - startedAt,
    };

    thermalArtworkCache.set(cacheKey, result);

    if (Number.isFinite(Number(productId)) && Number(productId) > 0) {
      const updateParams = [stored.thermal_image_url, stored.thermal_image_url ? "ready" : "failed", Number(productId)];
      const whereClause = tenantId ? " AND tenant_id = $4" : "";
      if (tenantId) updateParams.push(tenantId);
      try {
        await db.query(
          `UPDATE products SET thermal_image_url = $1, thermal_image_status = $2, updated_at = NOW() WHERE id = $3${whereClause}`,
          updateParams
        );
        result.updated = true;
      } catch (error) {
        console.warn("[thermal-artwork] product update failed", {
          productId,
          message: error?.message || String(error),
        });
        result.updated = false;
      }
    }

    console.log("THERMAL_IMAGE_JOB_READY", {
      entityType,
      productId,
      variantId,
      tenantId,
      productName,
      thermalImageUrl: stored.thermal_image_url,
      outputPath: stored.outputPath || "",
    });

    return {
      success: true,
      thermal_image_url: stored.thermal_image_url,
      source: "generated",
      cached: false,
      updated: true,
      storage: stored.storage,
      prompt: THERMAL_ARTWORK_PROMPT,
      model,
      job_key: inputKey,
    };
  })().catch(async (error) => {
    await updateThermalRecord({
      entityType,
      productId,
      variantId,
      tenantId,
      thermalImageUrl: "",
      thermalImageStatus: "failed",
      thermalImageError: error?.message || String(error),
    }).catch(() => {});

    console.error("THERMAL_IMAGE_JOB_FAILED", {
      entityType,
      productId,
      variantId,
      tenantId,
      productName,
      sourceImageUrl,
      message: error?.message || String(error),
      stack: error?.stack,
    });

    return {
      success: false,
      thermal_image_url: existingThermalImageUrl || "",
      source: "failed",
      cached: false,
      updated: false,
      storage: "local",
      prompt: "",
      model: "sharp-thermal-artwork",
      error: error?.message || String(error),
      job_key: inputKey,
    };
  }).finally(() => {
    THERMAL_JOB_IN_FLIGHT.delete(cacheKey);
  });

  THERMAL_JOB_IN_FLIGHT.set(cacheKey, job);
  return job;
};

export const generateThermalArtwork = async (options = {}) =>
  regenerateThermalImageForProductImage({
    entityType: "product",
    ...options,
  });
