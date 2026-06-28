import OpenAI, { toFile } from "openai";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import db from "../database/db.js";
import { resolveLocalProductImageSourcePath } from "./productImageVariantService.js";

const DEFAULT_MODEL = process.env.OPENAI_THERMAL_ARTWORK_MODEL || "gpt-image-1.5";
const DEFAULT_TIMEOUT_MS = 90_000;
export const THERMAL_ARTWORK_VERSION = "v1-openai";
export const THERMAL_ARTWORK_PROMPT = [
  "Create a clean monochrome product illustration suitable for 203 dpi direct thermal label printing.",
  "",
  "Requirements:",
  "",
  "* Keep the exact shoe proportions.",
  "* Preserve outsole shape.",
  "* Preserve logo.",
  "* Preserve lace layout.",
  "* Remove background completely.",
  "* Use solid black and white only.",
  "* No gray gradients.",
  "* No sketch style.",
  "* No cartoon style.",
  "* No artistic style.",
  "* Produce a technical product illustration similar to premium footwear packaging artwork.",
].join("\n");

const thermalArtworkCache = new Map();
let openaiClient = null;

const cleanText = (value = "") => {
  const text = String(value ?? "").trim();
  return text && !["null", "undefined", "n/a", "none"].includes(text.toLowerCase()) ? text : "";
};

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sha1 = (value = "") => createHash("sha1").update(String(value || "")).digest("hex");

const cloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_PRODUCT_FOLDER || "erp/products",
});

const isHttpUrl = (value = "") => /^https?:\/\//i.test(String(value || "").trim());

const dataUrlToBuffer = (value = "") => {
  const raw = String(value || "").trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    buffer: Buffer.from(match[2], "base64"),
    mimetype: match[1] || "image/png",
  };
};

const readImageBuffer = async (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const dataUrl = dataUrlToBuffer(raw);
  if (dataUrl?.buffer) return dataUrl;

  const localPath = resolveLocalProductImageSourcePath(raw);
  if (localPath) {
    return {
      buffer: await readFile(localPath),
      mimetype: "image/png",
    };
  }

  if (!isHttpUrl(raw)) return null;

  const response = await fetch(raw);
  if (!response.ok) return null;
  const mimeType = response.headers.get("content-type") || "image/png";
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimetype: mimeType,
  };
};

const readUrlBuffer = async (url = "") => {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return null;
  const response = await fetch(safeUrl);
  if (!response.ok) return null;
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimetype: response.headers.get("content-type") || "image/png",
  };
};

const normalizeSourceImage = async (value = "") => {
  const image = await readImageBuffer(value);
  if (!image?.buffer) return null;

  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default || sharpModule;
    const normalized = await sharp(image.buffer, { animated: false })
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
    return image;
  }
};

const getClient = () =>
  {
    if (!openaiClient) {
      openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 0,
        timeout: positiveNumber(process.env.OPENAI_THERMAL_ARTWORK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      });
    }
    return openaiClient;
  };

const uploadToCloudinary = async ({ buffer, filename, mimetype }) => {
  const config = cloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret || typeof fetch !== "function" || typeof FormData === "undefined") {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signatureBase = Object.keys({ folder: config.folder, timestamp })
    .sort()
    .map((key) => `${key}=${key === "folder" ? config.folder : timestamp}`)
    .join("&");
  const signature = sha1(`${signatureBase}${config.apiSecret}`);
  const blob = new Blob([buffer], { type: mimetype || "image/png" });
  const formData = new FormData();
  formData.append("file", blob, filename || "thermal-artwork.png");
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
  return body?.secure_url || "";
};

const saveThermalArtworkAsset = async ({ buffer, productId = null, sourceKey = "", mimetype = "image/png" } = {}) => {
  const safeSourceKey = sha1(sourceKey || buffer?.length || "");
  const safeProductKey = Number.isFinite(Number(productId)) && Number(productId) > 0 ? `product-${Number(productId)}` : "draft";
  const fileName = `${safeProductKey}-thermal-${safeSourceKey.slice(0, 12)}-${Date.now()}.png`;

  try {
    const cloudinaryUrl = await uploadToCloudinary({
      buffer,
      filename: fileName,
      mimetype,
    });
    if (cloudinaryUrl) {
      return {
        thermal_image_url: cloudinaryUrl,
        storage: "cloudinary",
      };
    }
  } catch (error) {
    console.warn("[thermal-artwork] cloudinary upload failed; falling back to local storage", {
      message: error?.message || String(error),
    });
  }

  const outputDir = path.join(process.cwd(), "uploads", "products", "thermal-artwork");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  await writeFile(outputPath, buffer);
  return {
    thermal_image_url: `/uploads/products/thermal-artwork/${fileName}`,
    storage: "local",
    outputPath,
  };
};

const buildCacheKey = ({ sourceImageUrl = "", productId = null, regenerate = false } = {}) => {
  const scope = Number.isFinite(Number(productId)) && Number(productId) > 0 ? `product:${Number(productId)}` : "draft";
  const sourceHash = sha1(String(sourceImageUrl || ""));
  return `${THERMAL_ARTWORK_VERSION}:${scope}:${sourceHash}:${regenerate ? "regen" : "cached"}`;
};

export const generateThermalArtwork = async ({
  sourceImageUrl = "",
  productId = null,
  tenantId = null,
  existingThermalImageUrl = "",
  regenerate = false,
  productName = "",
} = {}) => {
  try {
    const safeSourceImageUrl = cleanText(sourceImageUrl);
    const safeExistingThermal = cleanText(existingThermalImageUrl);
    const cacheKey = buildCacheKey({ sourceImageUrl: safeSourceImageUrl, productId, regenerate });

    if (!regenerate && safeExistingThermal) {
      return {
        thermal_image_url: safeExistingThermal,
        cached: true,
        source: "DATABASE",
        prompt: THERMAL_ARTWORK_PROMPT,
        model: DEFAULT_MODEL,
      };
    }

    if (!regenerate && thermalArtworkCache.has(cacheKey)) {
      return {
        ...thermalArtworkCache.get(cacheKey),
        cached: true,
        source: "CACHE",
      };
    }

    const normalizedSource = await normalizeSourceImage(safeSourceImageUrl);
    if (!normalizedSource?.buffer) {
      throw new Error("A valid product image is required for thermal artwork generation");
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

    const imageResult = response?.data?.[0] || null;
    const base64Image = imageResult?.b64_json || "";
    const imageUrl = imageResult?.url || "";

    let generatedBuffer = null;
    if (base64Image) {
      generatedBuffer = Buffer.from(base64Image, "base64");
    } else if (imageUrl) {
      const downloaded = await readUrlBuffer(imageUrl);
      generatedBuffer = downloaded?.buffer || null;
    }

    if (!generatedBuffer?.length) {
      throw new Error("OpenAI did not return thermal artwork image data");
    }

    const stored = await saveThermalArtworkAsset({
      buffer: generatedBuffer,
      productId,
      sourceKey: `${safeSourceImageUrl}:${productId || ""}:${Date.now()}`,
      mimetype: "image/png",
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
      const updateParams = [stored.thermal_image_url, Number(productId)];
      const whereClause = tenantId ? " AND tenant_id = $3" : "";
      if (tenantId) updateParams.push(tenantId);
      try {
        await db.query(
          `UPDATE products SET thermal_image_url = $1, updated_at = NOW() WHERE id = $2${whereClause}`,
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

    return result;
  } catch (error) {
    console.error("THERMAL_ARTWORK_ERROR", {
      message: error?.message,
      stack: error?.stack,
      response: error?.response?.data,
      status: error?.status,
      code: error?.code,
    });

    throw error;
  }
};
