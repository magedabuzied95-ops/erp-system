import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import sharp from "sharp";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const SAFE_X = 90;
const SAFE_Y = 260;
const SAFE_WIDTH = 900;
const SAFE_HEIGHT = 1360;
const MAX_PRODUCT_HEIGHT = 0.72 * CANVAS_HEIGHT;
const MAX_STORY_IMAGES = 6;
const storyTemplates = [
  {
    id: "minimal-white",
    name: "Minimal White",
    weight: 14,
    colors: ["#ffffff", "#f6f7f8", "#edf0f2"],
    text: "#111827",
    muted: "#6b7280",
    logo: { x: 990, y: 112, anchor: "end" },
    title: { x: 90, y: 168, anchor: "start", size: 52, weight: 850 },
    product: { x: 90, y: 232, anchor: "start", size: 34, weight: 650 },
    collageBox: { x: 90, y: 330, width: 900, height: 1220 },
    singleCard: { x: 120, y: 330, width: 840, height: 1030 },
    singleTextTop: 1435,
    radius: 42,
    shadow: { dy: 20, blur: 22, opacity: 0.12 },
    gap: 32,
    decorations: "lines",
  },
  {
    id: "luxury-fashion",
    name: "Luxury Fashion",
    weight: 12,
    colors: ["#fdfbf8", "#f1ece4", "#ded7cc"],
    text: "#171717",
    muted: "#7c746a",
    logo: { x: 90, y: 116, anchor: "start" },
    title: { x: 990, y: 204, anchor: "end", size: 56, weight: 850 },
    product: { x: 990, y: 268, anchor: "end", size: 34, weight: 650 },
    collageBox: { x: 105, y: 380, width: 870, height: 1160 },
    singleCard: { x: 104, y: 345, width: 872, height: 1020 },
    singleTextTop: 1435,
    radius: 18,
    shadow: { dy: 26, blur: 30, opacity: 0.18 },
    gap: 28,
    decorations: "frame",
  },
  {
    id: "streetwear",
    name: "Streetwear",
    weight: 10,
    colors: ["#f5f5f3", "#e7eceb", "#d9dedc"],
    text: "#0f172a",
    muted: "#475569",
    logo: { x: 990, y: 120, anchor: "end" },
    title: { x: 90, y: 206, anchor: "start", size: 62, weight: 900 },
    product: { x: 92, y: 270, anchor: "start", size: 32, weight: 750 },
    collageBox: { x: 88, y: 360, width: 904, height: 1190 },
    singleCard: { x: 96, y: 340, width: 888, height: 1040 },
    singleTextTop: 1445,
    radius: 26,
    shadow: { dy: 18, blur: 16, opacity: 0.18 },
    gap: 24,
    decorations: "bars",
  },
  {
    id: "modern-gradient",
    name: "Modern Gradient",
    weight: 13,
    colors: ["#ffffff", "#eef6fb", "#f7ecef"],
    text: "#122033",
    muted: "#5b6776",
    logo: { x: 990, y: 112, anchor: "end" },
    title: { x: 540, y: 186, anchor: "middle", size: 54, weight: 850 },
    product: { x: 540, y: 246, anchor: "middle", size: 32, weight: 650 },
    collageBox: { x: 100, y: 350, width: 880, height: 1190 },
    singleCard: { x: 128, y: 326, width: 824, height: 1060 },
    singleTextTop: 1448,
    radius: 48,
    shadow: { dy: 24, blur: 28, opacity: 0.13 },
    gap: 34,
    decorations: "corner",
  },
  {
    id: "dark-premium",
    name: "Dark Premium",
    weight: 9,
    colors: ["#101114", "#191b20", "#2a2d34"],
    text: "#f8fafc",
    muted: "#cbd5e1",
    logo: { x: 990, y: 114, anchor: "end" },
    title: { x: 90, y: 190, anchor: "start", size: 56, weight: 850 },
    product: { x: 90, y: 252, anchor: "start", size: 32, weight: 650 },
    collageBox: { x: 98, y: 360, width: 884, height: 1190 },
    singleCard: { x: 116, y: 340, width: 848, height: 1040 },
    singleTextTop: 1440,
    radius: 36,
    shadow: { dy: 28, blur: 34, opacity: 0.36 },
    gap: 30,
    decorations: "darkFrame",
  },
  {
    id: "clean-catalog",
    name: "Clean Catalog",
    weight: 12,
    colors: ["#f8fafc", "#eef1f4", "#ffffff"],
    text: "#111827",
    muted: "#64748b",
    logo: { x: 90, y: 112, anchor: "start" },
    title: { x: 90, y: 1650, anchor: "start", size: 52, weight: 850 },
    product: { x: 90, y: 1710, anchor: "start", size: 32, weight: 650 },
    collageBox: { x: 90, y: 250, width: 900, height: 1270 },
    singleCard: { x: 110, y: 260, width: 860, height: 1110 },
    singleTextTop: 1455,
    radius: 8,
    shadow: { dy: 14, blur: 18, opacity: 0.09 },
    gap: 26,
    decorations: "catalog",
  },
  {
    id: "hype-drop",
    name: "Hype Drop",
    weight: 10,
    colors: ["#f9fafb", "#e7f5ef", "#eef2ff"],
    text: "#0b1120",
    muted: "#475569",
    logo: { x: 990, y: 120, anchor: "end" },
    title: { x: 540, y: 185, anchor: "middle", size: 64, weight: 950 },
    product: { x: 540, y: 252, anchor: "middle", size: 34, weight: 750 },
    collageBox: { x: 86, y: 350, width: 908, height: 1195 },
    singleCard: { x: 90, y: 330, width: 900, height: 1050 },
    singleTextTop: 1450,
    radius: 34,
    shadow: { dy: 16, blur: 18, opacity: 0.2 },
    gap: 22,
    decorations: "hype",
  },
  {
    id: "soft-shadow-cards",
    name: "Soft Shadow Cards",
    weight: 15,
    colors: ["#ffffff", "#f3f4f6", "#e8edf2"],
    text: "#111827",
    muted: "#6b7280",
    logo: { x: 990, y: 112, anchor: "end" },
    title: { x: 90, y: 176, anchor: "start", size: 54, weight: 850 },
    product: { x: 90, y: 238, anchor: "start", size: 32, weight: 650 },
    collageBox: { x: 100, y: 340, width: 880, height: 1210 },
    singleCard: { x: 130, y: 320, width: 820, height: 1065 },
    singleTextTop: 1445,
    radius: 58,
    shadow: { dy: 32, blur: 36, opacity: 0.16 },
    gap: 36,
    decorations: "soft",
  },
];

const FIXED_FAST_STORY_TEMPLATE = storyTemplates.find((template) => template.id === "minimal-white") || storyTemplates[0];

const trimString = (value) => String(value || "").trim();
const trimSlashes = (value = "") => String(value).replace(/^\/+|\/+$/g, "");

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
  const buffer = await fs.readFile(filePath);
  const blob = new Blob([buffer], { type: "image/png" });
  const formData = new FormData();
  formData.append("file", blob, filename || "story-image.png");
  formData.append("api_key", config.apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", config.folder);
  formData.append("signature", signature);

  console.log("[story-cloudinary-upload-start]", {
    filename: filename || "story-image.png",
    folder: config.folder,
  });
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`, {
      method: "POST",
      body: formData,
    });
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
    return body.secure_url;
  } catch (error) {
    console.error("[story-cloudinary-upload-failed]", {
      error: error?.message || "Cloudinary story upload failed",
    });
    throw error;
  }
};

export const getStoryImageLocalPath = (source) => {
  const candidates = localUploadCandidates(source);
  return candidates[0] || "";
};

const storyBackgroundSvg = () => `
<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fbfbfb"/>
      <stop offset="0.55" stop-color="#eef4f7"/>
      <stop offset="1" stop-color="#f7efe9"/>
    </linearGradient>
    <radialGradient id="glowTop" cx="50%" cy="18%" r="62%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowBottom" cx="50%" cy="84%" r="55%">
      <stop offset="0" stop-color="#dde8ef" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#dde8ef" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glowTop)"/>
  <rect width="100%" height="100%" fill="url(#glowBottom)"/>
</svg>`;

const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const getProductName = (product = {}) => trimString(product.name || product.title || "New product");
const templateBackgroundSvg = ({ productName, productNameY = 1518, collectionSize = 72, productNameSize = 52 }) => `
<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.58" stop-color="#f4f5f6"/>
      <stop offset="1" stop-color="#eceff2"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="16%" r="78%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.86"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="lineSoft" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#111827" flood-opacity="0.06"/>
    </filter>
    <filter id="accentSoft" x="-20%" y="-80%" width="140%" height="260%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#d62828" flood-opacity="0.20"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <rect x="62" y="62" width="956" height="1796" rx="48" fill="none" stroke="#111827" stroke-opacity="0.055" stroke-width="2"/>
  <g filter="url(#lineSoft)">
    <path d="M154 142 H364" stroke="#111827" stroke-opacity="0.24" stroke-width="2"/>
    <path d="M716 142 H926" stroke="#111827" stroke-opacity="0.24" stroke-width="2"/>
  </g>
  <text x="540" y="140" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="2.2" fill="#111827">NEW</text>
  <text x="540" y="202" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${collectionSize}" font-style="italic" font-weight="900" letter-spacing="0" fill="#111827">COLLECTION</text>
  <path d="M438 240 H642" stroke="#d62828" stroke-opacity="0.72" stroke-width="3" filter="url(#accentSoft)"/>
  <path d="M140 286 H940" stroke="#111827" stroke-opacity="0.08" stroke-width="2" filter="url(#lineSoft)"/>
  <text x="540" y="${productNameY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${productNameSize}" font-weight="820" fill="#111827">${escapeXml(productName)}</text>
</svg>`;

const cardSvg = ({ width, height, radius = 42, shadow = { dy: 22, blur: 22, opacity: 0.14 }, fill = "#ffffff", stroke = "none" }) => `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-18%" y="-18%" width="136%" height="136%">
      <feDropShadow dx="0" dy="${shadow.dy}" stdDeviation="${shadow.blur}" flood-color="#111827" flood-opacity="${shadow.opacity}"/>
    </filter>
  </defs>
  <rect x="2" y="2" width="${width - 4}" height="${height - 4}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-opacity="0.16" filter="url(#shadow)"/>
</svg>`;

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
  const inputBuffer = await readImageBuffer(source);
  const metadata = await sharp(inputBuffer, { animated: false }).metadata();
  return {
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
    format: metadata.format || "",
  };
};

export const isGeneratedStoryImageUrl = (value) => /(^|\/)uploads\/stories\//.test(trimString(value));

const uniqueList = (items = []) => Array.from(new Set(items.map(trimString).filter(Boolean)));

const numberValue = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const storySvgText = ({ lines, x, y, size, weight = 700, color = "#111827", anchor = "middle", lineHeight = 1.18 }) => `
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="0" fill="${color}">
    ${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(size * lineHeight)}">${escapeXml(line)}</tspan>`).join("")}
  </text>`;

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
  if (existing) return existing;
  return sizes.length ? `AVAILABLE SIZES: ${sizes.join(", ")}` : "AVAILABLE NOW";
};

const storyAssetBadge = (story = {}, design = {}) => {
  const text = [story.strategy_type, story.layout_type, design.strategy_type, design.layout_type, story.caption, design.caption]
    .map(trimString)
    .join(" ")
    .toLowerCase();
  const stock = numberValue(story.stock ?? design.stock, 0);
  return text.includes("last_size") || text.includes("last piece") || text.includes("last size") || (stock > 0 && stock <= 2)
    ? "LAST SIZE"
    : "NEW COLLECTION";
};

const storyAssetTitle = (story = {}, design = {}) =>
  trimString(story.product_name || story.title || design.product_name || design.title || "New product");

const storyAssetCta = (story = {}, design = {}) => trimString(story.cta_text || design.cta_text || "View details");

const storySlideImages = (design = {}) => [
  ...(Array.isArray(design.slides) ? design.slides.map((slide) => slide?.source_product_image_url || slide?.variant_image_url || slide?.image_url) : []),
  ...(Array.isArray(design.carousel) ? design.carousel.map((slide) => slide?.source_product_image_url || slide?.variant_image_url || slide?.image_url) : []),
];

const storyAssetImageSources = (story = {}, design = {}) => {
  const variantImages = uniqueList([
    story.source_product_image_url,
    story.variant_image_url,
    design.source_product_image_url,
    design.variant_image_url,
    ...(Array.isArray(story.variant_media_urls) ? story.variant_media_urls : []),
    ...(Array.isArray(design.variant_media_urls) ? design.variant_media_urls : []),
    ...storySlideImages(design),
    ...(Array.isArray(story.media_urls) ? story.media_urls : []),
    ...(Array.isArray(design.source_media_urls) ? design.source_media_urls : []),
    ...(Array.isArray(design.media_urls) ? design.media_urls : []),
  ]).filter((source) => !isGeneratedStoryImageUrl(source));
  const coverImages = uniqueList([
    story.primary_image_url,
    story.image_url,
    design.primary_image_url,
    design.image_url,
  ]).filter((source) => !isGeneratedStoryImageUrl(source));
  return variantImages.length ? variantImages : coverImages;
};

const storyAssetImageSource = (story = {}, design = {}) => storyAssetImageSources(story, design)[0] || "";

const designedStoryBackgroundSvg = ({ badge, title, price, sizes, cta }) => {
  const titleLines = storyAssetTextLines(title, { maxChars: 28, maxLines: 2 });
  const sizesLines = storyAssetTextLines(sizes, { maxChars: 34, maxLines: 1 });
  const priceLines = storyAssetTextLines(price || "Available now", { maxChars: 20, maxLines: 1 });
  const headingLines = storyAssetTextLines(badge || "NEW COLLECTION", { maxChars: 18, maxLines: 1 });
  return `
<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="storyBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050816"/>
      <stop offset="0.46" stop-color="#101827"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <radialGradient id="cyanGlow" cx="22%" cy="18%" r="30%">
      <stop offset="0" stop-color="#22d3ee" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="goldGlow" cx="85%" cy="22%" r="26%">
      <stop offset="0" stop-color="#fbbf24" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#fbbf24" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.36" stop-color="#000000" stop-opacity="0.44"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.82"/>
    </linearGradient>
    <linearGradient id="ctaFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a5f3fc"/>
      <stop offset="0.55" stop-color="#67e8f9"/>
      <stop offset="1" stop-color="#38bdf8"/>
    </linearGradient>
    <filter id="productShadow" x="-45%" y="-45%" width="190%" height="190%">
      <feDropShadow dx="0" dy="34" stdDeviation="28" flood-color="#000000" flood-opacity="0.50"/>
    </filter>
    <filter id="ctaGlow" x="-35%" y="-80%" width="170%" height="260%">
      <feDropShadow dx="0" dy="0" stdDeviation="18" flood-color="#67e8f9" flood-opacity="0.22"/>
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#082f49" flood-opacity="0.30"/>
    </filter>
    <filter id="softBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="38"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#storyBg)"/>
  <rect width="100%" height="100%" fill="url(#cyanGlow)"/>
  <rect width="100%" height="100%" fill="url(#goldGlow)"/>
  <rect y="922" width="1080" height="998" fill="url(#bottomFade)"/>

  <g opacity="0.95">
    <rect x="48" y="36" width="315" height="8" rx="4" fill="#ffffff"/>
    <rect x="381" y="36" width="315" height="8" rx="4" fill="#ffffff" fill-opacity="0.35"/>
    <rect x="714" y="36" width="315" height="8" rx="4" fill="#ffffff" fill-opacity="0.35"/>
  </g>

  <g>
    <circle cx="94" cy="102" r="36" fill="#020617"/>
    <text x="94" y="113" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="950" fill="#ffffff">ERP</text>
    <text x="144" y="94" text-anchor="start" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="950" fill="#ffffff">ERP Store</text>
    <text x="144" y="121" text-anchor="start" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="800" fill="#cbd5e1">Story preview</text>
    <rect x="769" y="78" width="260" height="48" rx="24" fill="#ffffff" fill-opacity="0.80"/>
    <text x="899" y="110" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="950" fill="#0f172a">${escapeXml(badge || "NEW COLLECTION")}</text>
  </g>

  <g filter="url(#softBlur)">
    <circle cx="540" cy="548" r="235" fill="#ffffff" fill-opacity="0.50"/>
    <circle cx="540" cy="564" r="178" fill="#67e8f9" fill-opacity="0.18"/>
    <ellipse cx="540" cy="1088" rx="360" ry="52" fill="#000000" fill-opacity="0.34"/>
    <ellipse cx="540" cy="1040" rx="360" ry="100" fill="#ffffff" fill-opacity="0.12"/>
  </g>

  ${storySvgText({ lines: headingLines, x: 54, y: 1248, size: 76, weight: 950, color: "#ffffff", anchor: "start", lineHeight: 1.04 })}
  <rect x="54" y="1308" width="${Math.min(760, Math.max(310, sizes.length * 13 + 80))}" height="44" rx="22" fill="#ffffff" fill-opacity="0.92" stroke="#ffffff" stroke-opacity="0.12"/>
  ${storySvgText({ lines: sizesLines, x: 86, y: 1337, size: 21, weight: 950, color: "#0f172a", anchor: "start", lineHeight: 1 })}
  ${storySvgText({ lines: titleLines, x: 54, y: 1408, size: titleLines.length > 1 ? 50 : 58, weight: 950, color: "#ffffff", anchor: "start", lineHeight: 1.12 })}
  ${storySvgText({ lines: priceLines, x: 54, y: 1580, size: 72, weight: 950, color: "#ffffff", anchor: "start", lineHeight: 1 })}
  <text x="54" y="1638" text-anchor="start" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="900" fill="#ffffff" fill-opacity="0.84">Available now</text>
  <g filter="url(#ctaGlow)">
    <rect x="682" y="1576" width="336" height="90" rx="45" fill="url(#ctaFill)" stroke="#ffffff" stroke-opacity="0.30"/>
    <text x="850" y="1632" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="950" fill="#0f172a">${escapeXml(cta || "View details")}</text>
  </g>
</svg>`;
};

const normalizeInputImage = async (source) => {
  const inputBuffer = await readImageBuffer(source);
  const normalizedBuffer = await sharp(inputBuffer, { animated: false }).rotate().png().toBuffer();
  const metadata = await sharp(normalizedBuffer).metadata();
  const imageWidth = Number(metadata.width || 0);
  const imageHeight = Number(metadata.height || 0);
  if (!imageWidth || !imageHeight) {
    const error = new Error("Story image source has invalid dimensions.");
    error.status = 400;
    throw error;
  }
  return { buffer: normalizedBuffer, imageWidth, imageHeight };
};

const createContainedImageComposite = async ({ source, boxX, boxY, boxWidth, boxHeight, maxImageHeight = boxHeight, useSafeLimit = true }) => {
  const { buffer, imageWidth, imageHeight } = await normalizeInputImage(source);
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
  const outputBuffer = await sharp(buffer)
    .resize(outputWidth, outputHeight, { fit: "contain", withoutEnlargement: false })
    .png()
    .toBuffer();
  return { input: outputBuffer, left: outputX, top: outputY };
};

const getBrandImageSource = (product = {}) =>
  trimString(
    product.brand_image ||
      product.brand_logo ||
      product.brand_image_url ||
      product.brand_logo_url ||
      product.brand?.image_url ||
      product.brand?.logo_url ||
      product.brand?.logo ||
      ""
  );

const createBrandLogoComposite = async ({ product, boxX = 330, boxY = 1648, boxWidth = 420, boxHeight = 150 }) => {
  const brandSource = getBrandImageSource(product);
  if (!brandSource) {
    return null;
  }

  try {
    return await createContainedImageComposite({
      source: brandSource,
      boxX,
      boxY,
      boxWidth,
      boxHeight,
      maxImageHeight: boxHeight,
    });
  } catch (error) {
    console.error("[fast-story] brand logo skipped", {
      productId: product?.id || null,
      brandSource,
      error: error?.message || "Failed to load brand logo",
    });
    return null;
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
  await sharp(Buffer.from(background || storyBackgroundSvg()))
    .composite(composites)
    .png()
    .toFile(outputPath);
  const cloudinaryUrl = await uploadStoryImageToCloudinary({ filePath: outputPath, filename });
  return cloudinaryUrl || `/uploads/stories/${filename}`;
};

const getTemplateCollageGrid = (count, template) => {
  const box = template.collageBox;
  const columns = count <= 2 ? count : 2;
  const rows = Math.ceil(count / columns);
  const gap = template.gap;
  const cellWidth = Math.floor((box.width - gap * (columns - 1)) / columns);
  const cellHeight = Math.floor((box.height - gap * (rows - 1)) / rows);
  const gridWidth = cellWidth * columns + gap * (columns - 1);
  const gridHeight = cellHeight * rows + gap * (rows - 1);
  return {
    columns,
    gap,
    cellWidth,
    cellHeight,
    startX: box.x + Math.round((box.width - gridWidth) / 2),
    startY: box.y + Math.round((box.height - gridHeight) / 2),
  };
};

export const generateCollageStory = async ({ product = {}, images = [], postId = null, tenantId = null } = {}) => {
  const storyImages = uniqueList(images).slice(0, MAX_STORY_IMAGES);
  if (!storyImages.length) {
    const error = new Error("Story image source is missing.");
    error.status = 400;
    throw error;
  }

  const template = {
    ...FIXED_FAST_STORY_TEMPLATE,
    collageBox: { x: 34, y: 298, width: 1012, height: 1104 },
    gap: 16,
    radius: 48,
    shadow: { dy: 34, blur: 36, opacity: 0.17 },
  };
  const productName = getProductName(product);
  const grid = getTemplateCollageGrid(storyImages.length, template);
  const composites = [];
  for (const [index, imageUrl] of storyImages.entries()) {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const cardX = grid.startX + column * (grid.cellWidth + grid.gap);
    const cardY = grid.startY + row * (grid.cellHeight + grid.gap);
    const inset = 14;
    composites.push({
      input: Buffer.from(cardSvg({
        width: grid.cellWidth,
        height: grid.cellHeight,
        radius: template.radius,
        shadow: template.shadow,
        fill: "#ffffff",
        stroke: "#111827",
      })),
      left: cardX,
      top: cardY,
    });
    composites.push(
      await createContainedImageComposite({
        source: imageUrl,
        boxX: cardX + inset,
        boxY: cardY + inset,
        boxWidth: grid.cellWidth - inset * 2,
        boxHeight: grid.cellHeight - inset * 2,
        maxImageHeight: grid.cellHeight - inset * 2,
        useSafeLimit: false,
      })
    );
  }
  const brandLogoComposite = await createBrandLogoComposite({ product });
  if (brandLogoComposite) composites.push(brandLogoComposite);

  return writeStoryFile({
    filename: storyFilename({ tenantId, postId, suffix: "collage" }),
    background: templateBackgroundSvg({ productName, productNameY: 1436 }),
    composites,
  });
};

export const generateSingleProductStory = async ({ product = {}, image, postId = null, tenantId = null } = {}) => {
  const productName = getProductName(product);
  const template = {
    ...FIXED_FAST_STORY_TEMPLATE,
    singleCard: { x: 34, y: 320, width: 1012, height: 930 },
    radius: 56,
    shadow: { dy: 30, blur: 32, opacity: 0.14 },
  };
  const card = template.singleCard;
  const imageBox = {
    x: card.x + 16,
    y: card.y + 26,
    width: 980,
    height: 812,
  };
  const composites = [
    {
      input: Buffer.from(cardSvg({
        width: card.width,
        height: card.height,
        radius: template.radius,
        shadow: template.shadow,
        fill: "#ffffff",
        stroke: "none",
      })),
      left: card.x,
      top: card.y,
    },
    await createContainedImageComposite({
      source: image,
      boxX: imageBox.x,
      boxY: imageBox.y,
      boxWidth: imageBox.width,
      boxHeight: imageBox.height,
      maxImageHeight: imageBox.height,
      useSafeLimit: false,
    }),
  ];

  return writeStoryFile({
    filename: storyFilename({ tenantId, postId, suffix: "single" }),
    background: templateBackgroundSvg({
      productName,
      productNameY: 1360,
      collectionSize: 78,
      productNameSize: 56,
    }),
    composites,
  });
};

export const generateDesignedAiMarketingStoryImage = async ({ story = {}, postId = null, tenantId = null } = {}) => {
  const rendered = await generateDesignedAiMarketingStoryImages({ story, postId, tenantId });
  return rendered.final_asset_url || rendered.media_urls?.[0] || "";
};

export const generateDesignedAiMarketingStoryImages = async ({ story = {}, postId = null, tenantId = null } = {}) => {
  const design = story.design_json || {};
  const sources = storyAssetImageSources(story, design);
  const source = sources[0] || "";
  console.log("[story-render-start]", {
    queueId: story.id || postId || null,
    tenantId: tenantId || story.tenant_id || null,
    sourceProductImageUrl: source || "",
    sourceImageCount: sources.length,
    title: storyAssetTitle(story, design),
    layout: story.layout_type || design.layout_type || "",
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
      const imageComposite = await createContainedImageComposite({
        source: slideSource,
        boxX: 36,
        boxY: 245,
        boxWidth: 1008,
        boxHeight: 950,
        maxImageHeight: 950,
        useSafeLimit: false,
      });
      const outputUrl = await writeStoryFile({
        filename: storyFilename({ tenantId, postId, suffix: `ai-center-story-${index + 1}` }),
        background: designedStoryBackgroundSvg({
          badge: storyAssetBadge(slideStory, slideDesign),
          title: storyAssetTitle(slideStory, slideDesign),
          price: storyAssetPrice(slideStory, slideDesign),
          sizes: storyAssetSizes(slideStory, slideDesign),
          cta: storyAssetCta(slideStory, slideDesign),
        }),
        composites: [imageComposite],
      });
      outputSlides.push({
        index,
        source_product_image_url: slideSource,
        rendered_asset_url: outputUrl,
        image_url: outputUrl,
        final_asset_url: outputUrl,
        story_image_url: outputUrl,
      });
    }
    const outputUrl = outputSlides[0]?.rendered_asset_url || "";
    console.log("[story-render-success]", {
      queueId: story.id || postId || null,
      tenantId: tenantId || story.tenant_id || null,
      final_asset_url: outputUrl,
      slide_asset_count: outputSlides.length,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
    return {
      final_asset_url: outputUrl,
      rendered_image_url: outputUrl,
      story_image_url: outputUrl,
      media_urls: outputSlides.map((slide) => slide.rendered_asset_url).filter(Boolean),
      slides: outputSlides,
      source_media_urls: sources,
    };
  } catch (error) {
    console.error("[story-render-failed]", {
      queueId: story.id || postId || null,
      tenantId: tenantId || story.tenant_id || null,
      sourceProductImageUrl: source || "",
      error: error?.message || "Story render failed",
    });
    throw error;
  }
};

const getCollageGrid = (count, hasOverflowText) => {
  const columns = count <= 2 ? count : 2;
  const rows = Math.ceil(count / columns);
  const gap = count <= 1 ? 0 : 32;
  const labelHeight = hasOverflowText ? 96 : 0;
  const availableHeight = SAFE_HEIGHT - labelHeight;
  const cellWidth = Math.floor((SAFE_WIDTH - gap * (columns - 1)) / columns);
  const cellHeight = Math.floor((availableHeight - gap * (rows - 1)) / rows);
  const gridWidth = cellWidth * columns + gap * (columns - 1);
  const gridHeight = cellHeight * rows + gap * (rows - 1);
  const startX = SAFE_X + Math.round((SAFE_WIDTH - gridWidth) / 2);
  const startY = SAFE_Y + Math.round((availableHeight - gridHeight) / 2);
  return { columns, gap, cellWidth, cellHeight, startX, startY };
};

const buildStoryComposites = async ({ imageUrls }) => {
  if (imageUrls.length === 1) {
    return [
      await createContainedImageComposite({
        source: imageUrls[0],
        boxX: SAFE_X,
        boxY: SAFE_Y,
        boxWidth: SAFE_WIDTH,
        boxHeight: SAFE_HEIGHT,
        maxImageHeight: MAX_PRODUCT_HEIGHT,
      }),
    ];
  }

  const grid = getCollageGrid(imageUrls.length, false);
  const composites = [];
  for (const [index, imageUrl] of imageUrls.entries()) {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    composites.push(
      await createContainedImageComposite({
        source: imageUrl,
        boxX: grid.startX + column * (grid.cellWidth + grid.gap),
        boxY: grid.startY + row * (grid.cellHeight + grid.gap),
        boxWidth: grid.cellWidth,
        boxHeight: grid.cellHeight,
        maxImageHeight: grid.cellHeight,
      })
    );
  }

  return composites;
};

export const generateInstagramSafeStoryImage = async ({ imageUrl, imageUrls = [], postId = null, tenantId = null } = {}) => {
  const sources = uniqueList([...imageUrls, imageUrl]).filter((source) => !isGeneratedStoryImageUrl(source));
  if (!sources.length && isGeneratedStoryImageUrl(imageUrl)) return trimString(imageUrl);
  const storyImages = sources.slice(0, MAX_STORY_IMAGES);
  if (!storyImages.length) {
    const error = new Error("Story image source is missing.");
    error.status = 400;
    throw error;
  }

  const composites = await buildStoryComposites({ imageUrls: storyImages });
  return writeStoryFile({
    filename: storyFilename({ tenantId, postId }),
    composites,
    background: storyBackgroundSvg(),
  });
};

export const STORY_IMAGE_LAYOUT = {
  canvasWidth: CANVAS_WIDTH,
  canvasHeight: CANVAS_HEIGHT,
  safeX: SAFE_X,
  safeY: SAFE_Y,
  safeWidth: SAFE_WIDTH,
  safeHeight: SAFE_HEIGHT,
  maxProductHeight: MAX_PRODUCT_HEIGHT,
};

