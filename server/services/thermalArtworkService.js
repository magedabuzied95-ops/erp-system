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

sharp.cache(false);
sharp.concurrency(1);

const normalizeText = (value = "") => String(value || "").trim();

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
    return Buffer.from(meta.includes(";base64") ? payload : decodeURIComponent(payload), meta.includes(";base64") ? "base64" : "utf8");
  }

  const localPath = resolveLocalSourcePath(source);
  if (localPath && await fileExists(localPath)) {
    return fs.readFile(localPath);
  }

  if (isLocalUploadsPath(source)) {
    const candidate = resolveLocalSourcePath(source);
    if (candidate && await fileExists(candidate)) {
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
  if (localPath && await fileExists(localPath)) {
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    const resizedArtwork = await trimmed.resize({
      width: scaledWidth,
      height: scaledHeight,
      fit: "fill",
      withoutEnlargement: false,
      kernel: sharp.kernel.nearest,
    }).png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      force: true,
    }).toBuffer();

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

const generateBinaryThermalArtwork = async (sourceBuffer) => {
  const resized = await sharp(sourceBuffer, { animated: false })
    .rotate()
    .resize({
      width: THERMAL_IMAGE_MAX_SIDE,
      height: THERMAL_IMAGE_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.1, m1: 1.0, m2: 1.8, x1: 2, y2: 10, y3: 20, v1: 2, v2: 3, v3: 4 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  if (!width || !height) {
    throw new Error("Thermal artwork resize failed");
  }

  const luminance = new Uint8ClampedArray(width * height);
  let sum = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    const value = data[index] ?? 255;
    luminance[index] = value;
    sum += value;
  }

  const average = sum / Math.max(1, luminance.length);
  const darkThreshold = clamp(Math.round(average * 0.88), 160, 228);

  const getGray = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 255;
    return luminance[(y * width) + x] ?? 255;
  };

  const edgeMap = new Uint8ClampedArray(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const topLeft = getGray(x - 1, y - 1);
      const top = getGray(x, y - 1);
      const topRight = getGray(x + 1, y - 1);
      const left = getGray(x - 1, y);
      const right = getGray(x + 1, y);
      const bottomLeft = getGray(x - 1, y + 1);
      const bottom = getGray(x, y + 1);
      const bottomRight = getGray(x + 1, y + 1);
      const gx = (-1 * topLeft) + topRight + (-2 * left) + (2 * right) + (-1 * bottomLeft) + bottomRight;
      const gy = (-1 * topLeft) + (-2 * top) + (-1 * topRight) + bottomLeft + (2 * bottom) + bottomRight;
      edgeMap[(y * width) + x] = clamp(Math.round(Math.hypot(gx, gy)), 0, 255);
    }
  }

  const inkMap = new Uint8Array(width * height);
  for (let index = 0; index < luminance.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const edge = edgeMap[index] ?? 0;
    const gray = luminance[index] ?? 255;
    const darkRegion = gray < darkThreshold;
    const strongContour = edge > 52;
    const softContour = gray < 232 && edge > 24;
    const detailContour = gray < 220 && edge > 16;
    inkMap[index] = darkRegion || strongContour || softContour || detailContour ? 1 : 0;

    if (gray > 248 && edge < 8) {
      inkMap[index] = 0;
    }
  }

  const dilatedMap = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let ink = 0;
      for (let offsetY = -1; offsetY <= 1 && !ink; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nx = x + offsetX;
          const ny = y + offsetY;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (inkMap[(ny * width) + nx]) {
            ink = 1;
            break;
          }
        }
      }
      dilatedMap[(y * width) + x] = ink;
    }
  }

  const output = Buffer.alloc(width * height * 4);
  for (let index = 0; index < dilatedMap.length; index += 1) {
    const ink = dilatedMap[index] ? 0 : 255;
    const outputIndex = index * 4;
    output[outputIndex] = ink;
    output[outputIndex + 1] = ink;
    output[outputIndex + 2] = ink;
    output[outputIndex + 3] = 255;
  }

  return sharp(output, { raw: { width, height, channels: 4 } })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      force: true,
    })
    .toBuffer();
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

    if (!regenerate && await fileExists(outputPath)) {
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

    const sourceBuffer = await readSourceBuffer(sourceImageUrl);
    if (!sourceBuffer) {
      throw new Error("Thermal source image could not be loaded");
    }

    await ensureDir();
    const thermalBuffer = await postProcessThermalArtworkBuffer(sourceBuffer);
    await fs.writeFile(outputPath, thermalBuffer);
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
      outputPath,
    });

    return {
      success: true,
      thermal_image_url: outputUrl,
      source: "generated",
      cached: false,
      updated: true,
      storage: "local",
      prompt: "technical product illustration for thermal printing",
      model: "sharp-thermal-artwork",
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
