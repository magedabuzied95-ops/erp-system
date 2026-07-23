import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const SAFE_X = 90;
const SAFE_Y = 260;
const SAFE_WIDTH = 900;
const SAFE_HEIGHT = 1360;
const MAX_PRODUCT_HEIGHT = 0.72 * CANVAS_HEIGHT;
const configuredMaxStorySlides = Number(process.env.MAX_STORY_SLIDES || 6);
const MAX_STORY_SLIDES = Number.isFinite(configuredMaxStorySlides)
  ? Math.min(6, Math.max(1, Math.round(configuredMaxStorySlides)))
  : 6;
const STORY_FONT_PATH = fileURLToPath(new URL("../../src/assets/fonts/customer-statement-arabic.ttf", import.meta.url));
const STORY_FONT_BASE64 = readFileSync(STORY_FONT_PATH).toString("base64");
const STORY_FONT_FAMILY = "M1Story";
export const STORY_RENDERER_NAME = "m1_story_clean_product";
export const STORY_RENDERER_BUILD = "m1-story-clean-product-v2-2026-07-23";
const storyFontFaceSvg = () => `<style>@font-face{font-family:'${STORY_FONT_FAMILY}';src:url(data:font/ttf;base64,${STORY_FONT_BASE64}) format('truetype');font-style:normal;font-weight:100 1000;}text{font-family:'${STORY_FONT_FAMILY}','DejaVu Sans',sans-serif;}</style>`;
sharp.cache(false);
sharp.concurrency(1);

const memoryUsageDiagnostics = () => {
  const usage = process.memoryUsage();
  return {
    raw: usage,
    mb: Object.fromEntries(
      Object.entries(usage).map(([key, value]) => [key, `${Math.round((Number(value) || 0) / 1024 / 1024)}MB`])
    ),
  };
};

const formatMemoryUsage = () => memoryUsageDiagnostics().mb;

const disposeCompositeBuffers = (composites = []) => {
  for (const composite of composites) {
    if (composite && Buffer.isBuffer(composite.input)) composite.input = null;
  }
};

const logStoryMemory = (stage, extra = {}) => {
  console.log("[story-memory]", {
    stage,
    memory: memoryUsageDiagnostics(),
    ...extra,
  });
};


const trimString = (value) => String(value || "").trim();
const trimSlashes = (value = "") => String(value).replace(/^\/+|\/+$/g, "");
const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const storyUploadDir = () => path.join(process.cwd(), "uploads", "stories");

const storyCloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_STORY_FOLDER || process.env.CLOUDINARY_PRODUCT_FOLDER || "erp/stories",
});

const sha1 = (value = "") => crypto.createHash("sha1").update(value).digest("hex");

const uploadStoryImageToCloudinary = async ({ filePath, filename }) => {
  const config = storyCloudinaryConfig();
  const hasCloudName = Boolean(trimString(config.cloudName));
  const hasApiKey = Boolean(trimString(config.apiKey));
  const hasApiSecret = Boolean(trimString(config.apiSecret));
  const isConfigured = hasCloudName && hasApiKey && hasApiSecret;
  console.log("[story-cloudinary-check]", {
    hasCloudName,
    hasApiKey,
    hasApiSecret,
  });

  if (!isConfigured) {
    return null;
  }
  if (typeof fetch !== "function" || typeof FormData === "undefined" || typeof Blob === "undefined") {
    const error = new Error("Cloudinary story upload unavailable: fetch/FormData/Blob runtime support missing");
    console.error("[story-cloudinary-upload-failed]", { error: error.message });
    throw error;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    folder: config.folder,
    timestamp,
  };
  const signatureBase = Object.keys(paramsToSign)
    .sort()
    .map((key) => `${key}=${paramsToSign[key]}`)
    .join("&");
  const signature = sha1(`${signatureBase}${config.apiSecret}`);
  let buffer = null;
  let blob = null;
  let formData = null;
  logStoryMemory("before-cloudinary-file-read", { filename: filename || "story-image.png" });
  buffer = await fs.readFile(filePath);
  logStoryMemory("after-cloudinary-file-read", { filename: filename || "story-image.png", bytes: buffer.length });
  blob = new Blob([buffer], { type: "image/png" });
  formData = new FormData();
  formData.append("file", blob, filename || "story-image.png");
  formData.append("api_key", config.apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", config.folder);
  formData.append("signature", signature);
  buffer = null;

  console.log("[story-cloudinary-upload-start]", {
    filename: filename || "story-image.png",
    folder: config.folder,
  });
  try {
    logStoryMemory("before-cloudinary-upload", { filename: filename || "story-image.png" });
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`, {
      method: "POST",
      body: formData,
    });
    buffer = null;
    blob = null;
    formData = null;
    logStoryMemory("after-cloudinary-upload-response", { filename: filename || "story-image.png" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || body?.message || "Cloudinary story upload failed");
    }
    if (!body?.secure_url) {
      throw new Error("Cloudinary story upload returned no secure_url");
    }
    console.log("[story-cloudinary-upload-success]", {
      secure_url: body.secure_url,
      public_id: body.public_id || "",
    });
    logStoryMemory("after-cloudinary-upload-success", { filename: filename || "story-image.png" });
    return body.secure_url;
  } catch (error) {
    buffer = null;
    blob = null;
    formData = null;
    console.error("[story-cloudinary-upload-failed]", {
      error: error?.message || "Cloudinary story upload failed",
    });
    logStoryMemory("after-cloudinary-upload-failed", { filename: filename || "story-image.png" });
    throw error;
  }
};

export const getStoryImageLocalPath = (source) => {
  const candidates = localUploadCandidates(source);
  return candidates[0] || "";
};
const localUploadCandidates = (source) => {
  const value = trimString(source);
  if (!value || /^https?:\/\//i.test(value)) return [];

  const normalized = trimSlashes(value);
  const uploadRelative = normalized.startsWith("uploads/")
    ? normalized.slice("uploads/".length)
    : normalized.startsWith("products/") || normalized.startsWith("stories/")
      ? normalized
      : "";

  return [
    uploadRelative ? path.join(process.cwd(), "uploads", uploadRelative) : "",
    uploadRelative ? path.join(process.cwd(), "server", "uploads", uploadRelative) : "",
    path.isAbsolute(value) ? value : "",
  ].filter(Boolean);
};

const readImageBuffer = async (source) => {
  const value = trimString(source);
  if (!value) {
    const error = new Error("Story image source is missing.");
    error.status = 400;
    throw error;
  }

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) {
      const error = new Error(`Failed to fetch story image source: ${response.status}`);
      error.status = 400;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const dataMatch = value.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (dataMatch?.[1]) {
    return Buffer.from(dataMatch[1], "base64");
  }

  for (const candidate of localUploadCandidates(value)) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try the next known uploads location.
    }
  }

  const error = new Error("Story image source file was not found.");
  error.status = 400;
  throw error;
};

export const getStoryImageMetadata = async (source) => {
  let inputBuffer = await readImageBuffer(source);
  try {
    const metadata = await sharp(inputBuffer, { animated: false }).metadata();
    return {
      width: Number(metadata.width || 0),
      height: Number(metadata.height || 0),
      format: metadata.format || "",
    };
  } finally {
    inputBuffer = null;
  }
};

export const getStoryImageChecksum = async (source) => {
  const buffer = await readImageBuffer(source);
  return crypto.createHash("sha256").update(buffer).digest("hex");
};

export const isGeneratedStoryImageUrl = (value) => {
  const text = trimString(value);
  return /(^|\/)uploads\/stories\//.test(text) || /\/(?:erp\/)?stories\//i.test(text);
};

const uniqueList = (items = []) => Array.from(new Set(items.map(trimString).filter(Boolean)));

const comparableImageUrl = (value = "") => {
  const text = trimString(value);
  if (!text) return "";
  try {
    const parsed = new URL(text, "https://local.invalid");
    return decodeURIComponent(parsed.pathname || text).replace(/\/+/g, "/").replace(/^\/+/, "").toLowerCase();
  } catch {
    return text.split("?")[0].split("#")[0].replace(/\/+/g, "/").replace(/^\/+/, "").toLowerCase();
  }
};

const sameImageUrl = (left = "", right = "") => {
  const leftKey = comparableImageUrl(left);
  const rightKey = comparableImageUrl(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
};

const naturalSizeSort = (left, right) => {
  const leftText = trimString(left);
  const rightText = trimString(right);
  const leftNumber = Number(leftText.replace(",", "."));
  const rightNumber = Number(rightText.replace(",", "."));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
};

const uniqueStoryTextValues = (items = []) =>
  uniqueList(items.map((item) => trimString(item))).sort(naturalSizeSort);

const storyAssetTextLines = (value, { maxChars = 24, maxLines = 2 } = {}) => {
  const words = trimString(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [trimString(value).slice(0, maxChars)].filter(Boolean);
};

const roundedRectMaskSvg = ({ width, height, radius }) => `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#ffffff"/>
</svg>`;

const storySvgText = ({ lines, x, y, size, weight = 700, color = "#111827", anchor = "middle", lineHeight = 1.18, opacity = 1 }) => `
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${STORY_FONT_FAMILY}, DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="0" fill="${color}" opacity="${opacity}">
    ${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(size * lineHeight)}">${escapeXml(line)}</tspan>`).join("")}
  </text>`;

const escapePangoMarkup = (value) => trimString(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const createStoryTextComposite = async ({ text, left, top, width, height, size, color, align = "left", weight = "bold" }) => {
  if (!trimString(text)) return null;
  const input = await sharp({
    text: {
      text: `<span foreground="${color}" weight="${weight}" size="${size}pt">${escapePangoMarkup(text)}</span>`,
      font: "Candara",
      fontfile: STORY_FONT_PATH,
      width,
      height,
      align,
      rgba: true,
    },
  }).png().toBuffer();
  return { input, left, top };
};

const storyAssetPrice = (story = {}, design = {}) => {
  const rawPrice = trimString(story.price || story.product_price || design.price || design.product_price);
  if (!rawPrice) return "";
  const currency = trimString(story.currency || design.currency || "EGP");
  return rawPrice.toLowerCase().includes(currency.toLowerCase()) ? rawPrice : `${rawPrice} ${currency}`;
};

const storyAssetSizes = (story = {}, design = {}) => {
  const sizes = uniqueStoryTextValues([
    ...(Array.isArray(story.available_sizes) ? story.available_sizes : []),
    ...(Array.isArray(design.available_sizes) ? design.available_sizes : []),
    ...(Array.isArray(story.sizes) ? story.sizes : []),
    ...(Array.isArray(design.sizes) ? design.sizes : []),
    story.size,
    design.size_name,
  ]);
  const existing = trimString(story.sizes_label || design.sizes_label);
  if (existing) return existing.replace(/^AVAILABLE SIZES:\s*/i, "").replace(/\s*,\s*/g, " • ");
  return sizes.length ? sizes.join(" • ") : "";
};

const DESIGNED_STORY_THEMES = {
  current: {
    id: "m1-clean-product-v2",
    label: "",
    baseStart: "#f4f1e9",
    baseMiddle: "#f8fafc",
    baseEnd: "#e2e8f0",
    glowPrimary: "#5eead4",
    glowSecondary: "#cbd5e1",
    accent: "#0f766e",
    accentSoft: "#ccfbf1",
    accentDark: "#134e4a",
  },
};

// Every AI Marketing story uses the approved M1 visual template. The campaign
// strategy controls selling copy, but never swaps the black/crimson art style.
export const resolveDesignedStoryTheme = () => DESIGNED_STORY_THEMES.current;

const storyAssetTitle = (story = {}, design = {}) =>
  trimString(story.product_name || story.title || design.product_name || design.title || "New product");

const storyPreviewSlideImages = (design = {}) => [
  ...(Array.isArray(design.slides) ? design.slides : []),
  ...(Array.isArray(design.carousel) ? design.carousel : []),
].map((slide) =>
  slide?.source_product_image_url ||
  slide?.original_image_url ||
  slide?.variant_image_url ||
  slide?.image_url ||
  slide?.primary_image_url ||
  slide?.url ||
  slide?.image ||
  ""
);

export const storyAssetImageSources = (story = {}, design = {}) => {
  const coverImages = uniqueList([
    story.product_cover_image_url,
    design.product_cover_image_url,
    story.metadata?.product_cover_image_url,
  ]);
  const usableSources = (items = []) => uniqueList(items).filter((source) =>
    !isGeneratedStoryImageUrl(source) &&
    !coverImages.some((coverImage) => sameImageUrl(coverImage, source))
  );

  // Prefer the explicit variant/color source list supplied by the queue. Old
  // slide previews may still contain the catalogue cover and must not override
  // the cleaned list during regeneration.
  const variantImages = usableSources([
    story.source_product_image_url,
    story.variant_image_url,
    design.source_product_image_url,
    design.variant_image_url,
    ...(Array.isArray(story.variant_media_urls) ? story.variant_media_urls : []),
    ...(Array.isArray(design.variant_media_urls) ? design.variant_media_urls : []),
    ...(Array.isArray(story.media_urls) ? story.media_urls : []),
    ...(Array.isArray(design.source_media_urls) ? design.source_media_urls : []),
    ...(Array.isArray(design.media_urls) ? design.media_urls : []),
  ]);
  if (variantImages.length) return variantImages;

  const previewSlideImages = usableSources(storyPreviewSlideImages(design));
  if (previewSlideImages.length) return previewSlideImages;

  return usableSources([
    story.image_url,
    ...(Array.isArray(story.media_urls) ? story.media_urls : []),
  ]);
};

export const designedStoryBackgroundSvg = ({ title, price, sizes, theme = DESIGNED_STORY_THEMES.current, renderText = true }) => {
  const cleanSizes = trimString(sizes).replace(/^AVAILABLE SIZES:\s*/i, "").replace(/\s*,\s*/g, " \u2022 ").replace(/\s*•\s*/g, " \u2022 ");
  const titleLines = storyAssetTextLines(title, { maxChars: 24, maxLines: 2 });
  const sizesLines = storyAssetTextLines(cleanSizes, { maxChars: 40, maxLines: 1 });
  const priceLines = storyAssetTextLines(price, { maxChars: 20, maxLines: 1 });
  return `
<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${storyFontFaceSvg()}
    <radialGradient id="primaryGlow" cx="22%" cy="18%" r="30%">
      <stop offset="0" stop-color="${theme.glowPrimary}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${theme.glowPrimary}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="secondaryGlow" cx="85%" cy="22%" r="26%">
      <stop offset="0" stop-color="${theme.glowSecondary}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${theme.glowSecondary}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="storyBase" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="${theme.baseStart}"/>
      <stop offset="0.45" stop-color="${theme.baseMiddle}"/>
      <stop offset="1" stop-color="${theme.baseEnd}"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="760" x2="0" y2="1920" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.36" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="productShadow" x="-45%" y="-45%" width="190%" height="190%">
      <feDropShadow dx="0" dy="34" stdDeviation="28" flood-color="#000000" flood-opacity="0.50"/>
    </filter>
    <filter id="whiteGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="80"/></filter>
    <filter id="cyanStageGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="74"/></filter>
    <filter id="stageShadow" x="-70%" y="-120%" width="240%" height="340%"><feGaussianBlur stdDeviation="28"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="${theme.baseStart}"/>
  <rect width="100%" height="100%" fill="url(#storyBase)"/>
  <rect width="100%" height="100%" fill="url(#primaryGlow)"/>
  <rect width="100%" height="100%" fill="url(#secondaryGlow)"/>
  <rect y="760" width="1080" height="1160" fill="url(#bottomFade)"/>

  <circle cx="540" cy="548" r="250" fill="#ffffff" fill-opacity="0.46" filter="url(#whiteGlow)"/>
  <circle cx="540" cy="570" r="192" fill="${theme.glowPrimary}" fill-opacity="0.16" filter="url(#cyanStageGlow)"/>
  <rect x="48" y="64" width="984" height="1016" rx="48" ry="48" fill="#ffffff" fill-opacity="0.96" stroke="#ffffff" stroke-opacity="0.42" filter="url(#productShadow)"/>
  <rect x="48" y="64" width="984" height="1016" rx="48" ry="48" fill="#ffffff" fill-opacity="0.92"/>
  <ellipse cx="540" cy="1038" rx="390" ry="48" fill="#000000" fill-opacity="0.28" filter="url(#stageShadow)"/>
  <ellipse cx="540" cy="996" rx="430" ry="92" fill="#ffffff" fill-opacity="0.10" filter="url(#stageShadow)"/>

  ${storySvgText({ lines: titleLines, x: 72, y: 1270, size: 84, weight: 800, color: "#111827", anchor: "start", lineHeight: 1.08, opacity: renderText ? 1 : 0 })}
  <line x1="72" y1="1390" x2="1008" y2="1390" stroke="#0f172a" stroke-opacity="0.12" stroke-width="2"/>
  ${storySvgText({ lines: priceLines, x: 72, y: 1480, size: 92, weight: 850, color: "#0f766e", anchor: "start", lineHeight: 1, opacity: renderText ? 1 : 0 })}
  ${storySvgText({ lines: sizesLines, x: 120, y: 1600, size: 38, weight: 800, color: "#0f172a", anchor: "start", lineHeight: 1, opacity: renderText ? 1 : 0 })}
</svg>`;
};

export const createDesignedStoryTextComposites = async ({ title, price, sizes, theme = DESIGNED_STORY_THEMES.current }) => {
  const cleanSizes = trimString(sizes).replace(/^AVAILABLE SIZES:\s*/i, "").replace(/\s*,\s*/g, " \u2022 ").replace(/\s*â€¢\s*/g, " \u2022 ");
  const titleText = storyAssetTextLines(title, { maxChars: 24, maxLines: 2 }).join("\n");
  const composites = await Promise.all([
    createStoryTextComposite({ text: titleText, left: 72, top: 1190, width: 936, height: 190, size: 68, color: "#111827", weight: "bold" }),
    createStoryTextComposite({ text: price, left: 72, top: 1404, width: 560, height: 100, size: 70, color: "#111827", weight: "bold" }),
    createStoryTextComposite({ text: cleanSizes, left: 120, top: 1558, width: 840, height: 58, size: 31, color: "#475569", weight: "bold" }),
  ]);
  return composites.filter(Boolean);
};

const normalizeInputImage = async (source) => {
  logStoryMemory("before-image-download", { source });
  let inputBuffer = await readImageBuffer(source);
  logStoryMemory("after-image-download", { source, bytes: inputBuffer.length });
  let normalizedBuffer = null;
  try {
    normalizedBuffer = await sharp(inputBuffer, { animated: false }).rotate().png().toBuffer();
    inputBuffer = null;
    const metadata = await sharp(normalizedBuffer).metadata();
    const imageWidth = Number(metadata.width || 0);
    const imageHeight = Number(metadata.height || 0);
    if (!imageWidth || !imageHeight) {
      normalizedBuffer = null;
      const error = new Error("Story image source has invalid dimensions.");
      error.status = 400;
      throw error;
    }
    return { buffer: normalizedBuffer, imageWidth, imageHeight };
  } catch (error) {
    normalizedBuffer = null;
    throw error;
  } finally {
    inputBuffer = null;
  }
};

const createContainedImageComposite = async ({ source, boxX, boxY, boxWidth, boxHeight, maxImageHeight = boxHeight, useSafeLimit = true, borderRadius = 0 }) => {
  const normalized = await normalizeInputImage(source);
  let buffer = normalized.buffer;
  const { imageWidth, imageHeight } = normalized;
  const scale = useSafeLimit
    ? Math.min(SAFE_WIDTH / imageWidth, SAFE_HEIGHT / imageHeight, MAX_PRODUCT_HEIGHT / imageHeight)
    : Number.POSITIVE_INFINITY;
  const containedScale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight, maxImageHeight / imageHeight, scale);
  const drawWidth = Math.max(1, Math.round(imageWidth * scale));
  const drawHeight = Math.max(1, Math.round(imageHeight * scale));
  const containedWidth = Math.max(1, Math.round(imageWidth * containedScale));
  const containedHeight = Math.max(1, Math.round(imageHeight * containedScale));
  const outputWidth = boxWidth === SAFE_WIDTH && boxHeight === SAFE_HEIGHT ? drawWidth : containedWidth;
  const outputHeight = boxWidth === SAFE_WIDTH && boxHeight === SAFE_HEIGHT ? drawHeight : containedHeight;
  const outputX = Math.round(boxX + (boxWidth - outputWidth) / 2);
  const outputY = Math.round(boxY + (boxHeight - outputHeight) / 2);
  try {
    let outputBuffer = await sharp(buffer)
      .resize(outputWidth, outputHeight, { fit: "contain", withoutEnlargement: false })
      .png()
      .toBuffer();
    if (borderRadius > 0) {
      const mask = Buffer.from(roundedRectMaskSvg({
        width: outputWidth,
        height: outputHeight,
        radius: Math.min(borderRadius, Math.floor(Math.min(outputWidth, outputHeight) / 2)),
      }));
      outputBuffer = await sharp(outputBuffer)
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer();
    }
    logStoryMemory("after-contained-image-composite", { source, outputBytes: outputBuffer.length });
    return { input: outputBuffer, left: outputX, top: outputY };
  } finally {
    buffer = null;
  }
};
const storyFilename = ({ tenantId = null, postId = null, suffix = "story" } = {}) =>
  [
    Date.now(),
    tenantId ? `tenant-${tenantId}` : "tenant",
    postId ? `post-${postId}` : suffix,
    crypto.randomBytes(5).toString("hex"),
  ].join("-") + ".png";

const writeStoryFile = async ({ filename, composites, background }) => {
  const outputDir = storyUploadDir();
  const outputPath = path.join(outputDir, filename);
  await fs.mkdir(outputDir, { recursive: true });
  if (!background) throw new Error("Canonical story background is required.");
  let backgroundBuffer = Buffer.from(background);
  try {
    logStoryMemory("before-story-render", { filename, compositeCount: composites.length });
    await sharp(backgroundBuffer)
      .composite(composites)
      .png()
      .toFile(outputPath);
    backgroundBuffer = null;
    disposeCompositeBuffers(composites);
    logStoryMemory("after-story-render", { filename });
    const cloudinaryUrl = await uploadStoryImageToCloudinary({ filePath: outputPath, filename });
    logStoryMemory("after-story-upload", { filename, cloudinary: Boolean(cloudinaryUrl) });
    return cloudinaryUrl || `/uploads/stories/${filename}`;
  } finally {
    backgroundBuffer = null;
    disposeCompositeBuffers(composites);
  }
};
export const generateDesignedAiMarketingStoryImage = async ({ story = {}, postId = null, tenantId = null } = {}) => {
  const rendered = await generateDesignedAiMarketingStoryImages({ story, postId, tenantId });
  return rendered.final_asset_url || rendered.media_urls?.[0] || "";
};

export const generateDesignedAiMarketingStoryImages = async ({ story = {}, postId = null, tenantId = null } = {}) => {
  const design = story.design_json || {};
  const allSources = storyAssetImageSources(story, design);
  const sources = allSources.slice(0, MAX_STORY_SLIDES);
  const source = sources[0] || "";
  console.log("[story-source-images]", {
    count: sources.length,
    originalCount: allSources.length,
    maxStorySlides: MAX_STORY_SLIDES,
    image_urls: sources,
  });
  console.log("[story-render-start]", {
    queueId: story.id || postId || null,
    tenantId: tenantId || story.tenant_id || null,
    sourceProductImageUrl: source || "",
    sourceImageCount: sources.length,
    originalSourceImageCount: allSources.length,
    maxStorySlides: MAX_STORY_SLIDES,
    title: storyAssetTitle(story, design),
    layout: story.layout_type || design.layout_type || "",
  });
  logStoryMemory("story-render-start", {
    queueId: story.id || postId || null,
    sourceImageCount: sources.length,
    originalSourceImageCount: allSources.length,
  });
  try {
    if (!sources.length) {
      const error = new Error("AI story rendered asset requires a product image source.");
      error.status = 400;
      throw error;
    }

    const designSlides = Array.isArray(design.slides) ? design.slides : [];
    const outputSlides = [];
    for (const [index, slideSource] of sources.entries()) {
      logStoryMemory("slide-render-start", {
        queueId: story.id || postId || null,
        slideIndex: index + 1,
        slideCount: sources.length,
        slideSource,
      });
      const slide = designSlides.find((candidate) =>
        trimString(candidate?.source_product_image_url || candidate?.variant_image_url || candidate?.image_url) === slideSource
      ) || designSlides[index] || {};
      const slideStory = {
        ...story,
        ...slide,
        source_product_image_url: slideSource,
        image_url: slideSource,
        price: slide.price || story.price,
        currency: slide.currency || story.currency,
        available_sizes: Array.isArray(slide.available_sizes) && slide.available_sizes.length ? slide.available_sizes : story.available_sizes,
        sizes_label: slide.sizes_label || story.sizes_label,
        strategy_type: slide.strategy_type || story.strategy_type,
        layout_type: slide.layout_type || story.layout_type,
      };
      const slideDesign = {
        ...design,
        ...slide,
        image_url: slideSource,
      };
      const storyTheme = resolveDesignedStoryTheme(slideStory, slideDesign);
      const storyText = {
        title: storyAssetTitle(slideStory, slideDesign),
        price: storyAssetPrice(slideStory, slideDesign),
        sizes: storyAssetSizes(slideStory, slideDesign),
        theme: storyTheme,
      };
      let imageComposite = await createContainedImageComposite({
        source: slideSource,
        boxX: 48,
        boxY: 64,
        boxWidth: 984,
        boxHeight: 1016,
        maxImageHeight: 1016,
        useSafeLimit: false,
        borderRadius: 48,
      });
      let textComposites = await createDesignedStoryTextComposites(storyText);
      logStoryMemory("slide-before-write-upload", {
        queueId: story.id || postId || null,
        slideIndex: index + 1,
        compositeBytes: imageComposite?.input?.length || 0,
      });
      const outputUrl = await writeStoryFile({
        filename: storyFilename({ tenantId, postId, suffix: `ai-center-story-${index + 1}` }),
        background: designedStoryBackgroundSvg({ ...storyText, renderText: false }),
        composites: [imageComposite, ...textComposites],
      });
      imageComposite = null;
      textComposites = null;
      outputSlides.push({
        index,
        source_product_image_url: slideSource,
        rendered_asset_url: outputUrl,
        image_url: outputUrl,
        final_asset_url: outputUrl,
        story_image_url: outputUrl,
        template_id: storyTheme.id,
      });
      logStoryMemory("slide-render-success", {
        queueId: story.id || postId || null,
        slideIndex: index + 1,
        outputUrl,
      });
    }
    const outputUrl = outputSlides[0]?.rendered_asset_url || "";
    const generatedAssetUrls = outputSlides.map((slide) => slide.rendered_asset_url).filter(Boolean);
    console.log("[story-generated-assets]", {
      generated_asset_count: generatedAssetUrls.length,
      generated_asset_urls: generatedAssetUrls,
      rendered_slides_length: outputSlides.length,
      media_urls_length: generatedAssetUrls.length,
      source_image_count: sources.length,
      generated_matches_source_count: generatedAssetUrls.length === sources.length,
    });
    console.log("[story-render-success]", {
      queueId: story.id || postId || null,
      tenantId: tenantId || story.tenant_id || null,
      final_asset_url: outputUrl,
      slide_asset_count: outputSlides.length,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      memory: formatMemoryUsage(),
    });
    logStoryMemory("story-render-success", {
      queueId: story.id || postId || null,
      slide_asset_count: outputSlides.length,
    });
    return {
      final_asset_url: outputUrl,
      rendered_image_url: outputUrl,
      story_image_url: outputUrl,
      media_urls: generatedAssetUrls,
      slides: outputSlides,
      source_media_urls: sources,
      renderer: STORY_RENDERER_NAME,
      renderer_build: STORY_RENDERER_BUILD,
    };
  } catch (error) {
    console.error("[story-render-failed]", {
      queueId: story.id || postId || null,
      tenantId: tenantId || story.tenant_id || null,
      sourceProductImageUrl: source || "",
      error: error?.message || "Story render failed",
      memory: formatMemoryUsage(),
    });
    logStoryMemory("story-render-failed", {
      queueId: story.id || postId || null,
      error: error?.message || "Story render failed",
    });
    throw error;
  }
};
