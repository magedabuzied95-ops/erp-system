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
const MAX_STORY_IMAGES = 6;
const configuredMaxStorySlides = Number(process.env.MAX_STORY_SLIDES || 6);
const MAX_STORY_SLIDES = Number.isFinite(configuredMaxStorySlides)
  ? Math.min(6, Math.max(1, Math.round(configuredMaxStorySlides)))
  : 6;
const STORY_FONT_PATH = fileURLToPath(new URL("../../src/assets/fonts/customer-statement-arabic.ttf", import.meta.url));
const STORY_FONT_BASE64 = readFileSync(STORY_FONT_PATH).toString("base64");
const STORY_FONT_FAMILY = "M1Story";
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

const FIXED_FAST_STORY_TEMPLATE = storyTemplates.find((template) => template.id === "dark-premium") || storyTemplates[0];

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

export const isGeneratedStoryImageUrl = (value) => {
  const text = trimString(value);
  return /(^|\/)uploads\/stories\//.test(text) || /\/(?:erp\/)?stories\//i.test(text);
};

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
  return sizes.length ? sizes.join(" • ") : "AVAILABLE NOW";
};

const storyAssetSignalText = (story = {}, design = {}) =>
  [story.strategy_type, story.layout_type, design.strategy_type, design.layout_type, story.caption, design.caption, story.title, design.title]
    .map(trimString)
    .join(" ")
    .toLowerCase();

const storyAssetBadge = (story = {}, design = {}) => {
  const text = storyAssetSignalText(story, design);
  const stock = numberValue(story.stock ?? design.stock, 0);
  if (text.includes("last_size") || text.includes("last piece") || text.includes("last size") || (stock > 0 && stock <= 2)) return "LAST SIZE";
  if (/offer|sale|discount|deal|promotion/.test(text)) return "SPECIAL OFFER";
  if (/popular|best.?seller|trending|social.?proof/.test(text)) return "MOST WANTED";
  return "NEW COLLECTION";
};

const DESIGNED_STORY_THEMES = {
  new_arrival: {
    id: "new-arrival-crimson",
    label: "FRESH DROP",
    baseStart: "#fff8f7",
    baseMiddle: "#f1e5e3",
    baseEnd: "#170909",
    glowPrimary: "#ef4444",
    glowSecondary: "#f97316",
    accent: "#ef4444",
    accentSoft: "#fee2e2",
    accentDark: "#450a0a",
  },
  last_piece: {
    id: "last-piece-urgency",
    label: "LIMITED DROP",
    baseStart: "#fff7ed",
    baseMiddle: "#f5e7d7",
    baseEnd: "#2b100b",
    glowPrimary: "#fb7185",
    glowSecondary: "#f59e0b",
    accent: "#fda4af",
    accentSoft: "#ffe4e6",
    accentDark: "#4c0519",
  },
  offer: {
    id: "offer-coral",
    label: "PRICE DROP",
    baseStart: "#fff7f4",
    baseMiddle: "#f7e5df",
    baseEnd: "#32110f",
    glowPrimary: "#fb7185",
    glowSecondary: "#fdba74",
    accent: "#fecdd3",
    accentSoft: "#fff1f2",
    accentDark: "#4c0519",
  },
  premium: {
    id: "premium-midnight",
    label: "M1 EDIT",
    baseStart: "#f8fafc",
    baseMiddle: "#e8eef5",
    baseEnd: "#101827",
    glowPrimary: "#38bdf8",
    glowSecondary: "#fbbf24",
    accent: "#a5f3fc",
    accentSoft: "#cffafe",
    accentDark: "#082f49",
  },
};

export const resolveDesignedStoryTheme = (story = {}, design = {}) => {
  const text = storyAssetSignalText(story, design);
  const stock = numberValue(story.stock ?? design.stock, 0);
  if (/last_size|last piece|last size|low.?stock|almost gone/.test(text) || (stock > 0 && stock <= 2)) return DESIGNED_STORY_THEMES.last_piece;
  if (/offer|sale|discount|deal|promotion/.test(text)) return DESIGNED_STORY_THEMES.offer;
  if (/new.?arrival|new_arrival|new arrivals|just landed|fresh drop/.test(text)) return DESIGNED_STORY_THEMES.new_arrival;
  return DESIGNED_STORY_THEMES.premium;
};

const storyAssetTitle = (story = {}, design = {}) =>
  trimString(story.product_name || story.title || design.product_name || design.title || "New product");

const storyAssetCta = () => "View details";

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

const storyAssetImageSources = (story = {}, design = {}) => {
  const previewSlideImages = uniqueList(storyPreviewSlideImages(design)).filter((source) => !isGeneratedStoryImageUrl(source));
  if (previewSlideImages.length) return previewSlideImages;

  const previewFallbackImages = uniqueList([
    story.image_url,
    ...(Array.isArray(story.media_urls) ? story.media_urls : []),
  ]).filter((source) => !isGeneratedStoryImageUrl(source));
  if (previewFallbackImages.length) return previewFallbackImages;

  const variantImages = uniqueList([
    story.source_product_image_url,
    story.variant_image_url,
    design.source_product_image_url,
    design.variant_image_url,
    ...(Array.isArray(story.variant_media_urls) ? story.variant_media_urls : []),
    ...(Array.isArray(design.variant_media_urls) ? design.variant_media_urls : []),
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

const storyAssetAudioTitle = (story = {}, design = {}) =>
  trimString(story.audio?.title || design.audio?.title || story.audio_title || design.audio_title);

const storyAssetBrandName = (story = {}, design = {}) =>
  trimString(story.store_name || story.storeName || story.brand_name || design.store_name || design.storeName || design.brand_name || process.env.STORY_BRAND_NAME || "M1 STORE");

export const designedStoryBackgroundSvg = ({ badge, title, price, sizes, cta, theme = DESIGNED_STORY_THEMES.premium, renderText = true }) => {
  const cleanSizes = trimString(sizes).replace(/^AVAILABLE SIZES:\s*/i, "").replace(/\s*,\s*/g, " \u2022 ").replace(/\s*•\s*/g, " \u2022 ");
  const titleLines = storyAssetTextLines(title, { maxChars: 24, maxLines: 2 });
  const sizesLines = storyAssetTextLines(cleanSizes, { maxChars: 40, maxLines: 1 });
  const priceLines = storyAssetTextLines(price || "Available now", { maxChars: 20, maxLines: 1 });
  const headingLines = storyAssetTextLines(badge || "NEW COLLECTION", { maxChars: 22, maxLines: 1 });
  const sizesWidth = Math.min(952, Math.max(520, cleanSizes.length * 38 + 160));
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
      <stop offset="0.36" stop-color="#000000" stop-opacity="0.44"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.82"/>
    </linearGradient>
    <linearGradient id="ctaFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.accentSoft}"/>
      <stop offset="0.55" stop-color="${theme.accent}"/>
      <stop offset="1" stop-color="${theme.glowPrimary}"/>
    </linearGradient>
    <filter id="productShadow" x="-45%" y="-45%" width="190%" height="190%">
      <feDropShadow dx="0" dy="34" stdDeviation="28" flood-color="#000000" flood-opacity="0.50"/>
    </filter>
    <filter id="ctaGlow" x="-35%" y="-80%" width="170%" height="260%">
      <feDropShadow dx="0" dy="0" stdDeviation="18" flood-color="${theme.accent}" flood-opacity="0.26"/>
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="${theme.accentDark}" flood-opacity="0.34"/>
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
  <rect x="768" y="92" width="224" height="48" rx="24" fill="${theme.accentDark}" fill-opacity="0.88"/>
  <text x="880" y="123" text-anchor="middle" font-family="${STORY_FONT_FAMILY}, DejaVu Sans, sans-serif" font-size="17" font-weight="650" letter-spacing="1.8" fill="#ffffff" opacity="${renderText ? 1 : 0}">${escapeXml(theme.label)}</text>
  <ellipse cx="540" cy="1038" rx="390" ry="48" fill="#000000" fill-opacity="0.28" filter="url(#stageShadow)"/>
  <ellipse cx="540" cy="996" rx="430" ry="92" fill="#ffffff" fill-opacity="0.10" filter="url(#stageShadow)"/>

  <rect x="48" y="1106" width="8" height="388" rx="4" fill="#ef4444" fill-opacity="0.94"/>
  <rect x="72" y="1104" width="${Math.min(420, Math.max(236, (badge || "NEW COLLECTION").length * 15 + 76))}" height="62" rx="31" fill="#dc2626" fill-opacity="0.98"/>
  ${storySvgText({ lines: headingLines, x: 112, y: 1145, size: 25, weight: 800, color: "#ffffff", anchor: "start", lineHeight: 1, opacity: renderText ? 1 : 0 })}
  ${storySvgText({ lines: titleLines, x: 72, y: 1270, size: 84, weight: 800, color: "#ffffff", anchor: "start", lineHeight: 1.08, opacity: renderText ? 1 : 0 })}
  <line x1="72" y1="1390" x2="1008" y2="1390" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
  ${storySvgText({ lines: priceLines, x: 72, y: 1480, size: 92, weight: 850, color: "#ffffff", anchor: "start", lineHeight: 1, opacity: renderText ? 1 : 0 })}
  <g filter="url(#ctaGlow)">
    <rect x="646" y="1410" width="362" height="88" rx="44" fill="url(#ctaFill)" stroke="#ffffff" stroke-opacity="0.32"/>
    <text x="827" y="1466" text-anchor="middle" font-family="${STORY_FONT_FAMILY}, DejaVu Sans, sans-serif" font-size="31" font-weight="800" fill="${theme.accentDark}" opacity="${renderText ? 1 : 0}">${escapeXml(cta || "View details")}</text>
  </g>
  <rect x="72" y="1540" width="${sizesWidth}" height="92" rx="46" fill="#ffffff" fill-opacity="0.96" stroke="#ef4444" stroke-opacity="0.24" stroke-width="2"/>
  ${storySvgText({ lines: sizesLines, x: 120, y: 1600, size: 38, weight: 800, color: "#0f172a", anchor: "start", lineHeight: 1, opacity: renderText ? 1 : 0 })}
</svg>`;
};

export const createDesignedStoryTextComposites = async ({ badge, title, price, sizes, cta, theme = DESIGNED_STORY_THEMES.premium }) => {
  const cleanSizes = trimString(sizes).replace(/^AVAILABLE SIZES:\s*/i, "").replace(/\s*,\s*/g, " \u2022 ").replace(/\s*â€¢\s*/g, " \u2022 ");
  const titleText = storyAssetTextLines(title, { maxChars: 24, maxLines: 2 }).join("\n");
  const composites = await Promise.all([
    createStoryTextComposite({ text: theme.label, left: 784, top: 100, width: 192, height: 32, size: 14, color: "#ffffff", align: "center", weight: "semibold" }),
    createStoryTextComposite({ text: badge || "NEW COLLECTION", left: 112, top: 1118, width: 360, height: 42, size: 20, color: "#ffffff", weight: "bold" }),
    createStoryTextComposite({ text: titleText, left: 72, top: 1190, width: 936, height: 190, size: 68, color: "#ffffff", weight: "bold" }),
    createStoryTextComposite({ text: price || "Available now", left: 72, top: 1404, width: 560, height: 100, size: 70, color: "#ffffff", weight: "bold" }),
    createStoryTextComposite({ text: cta || "View details", left: 666, top: 1426, width: 322, height: 58, size: 25, color: theme.accentDark, align: "center", weight: "bold" }),
    createStoryTextComposite({ text: cleanSizes || "AVAILABLE NOW", left: 120, top: 1558, width: 840, height: 58, size: 31, color: "#0f172a", weight: "bold" }),
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
  let backgroundBuffer = Buffer.from(background || storyBackgroundSvg());
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
        badge: storyAssetBadge(slideStory, slideDesign),
        title: storyAssetTitle(slideStory, slideDesign),
        price: storyAssetPrice(slideStory, slideDesign),
        sizes: storyAssetSizes(slideStory, slideDesign),
        cta: storyAssetCta(slideStory, slideDesign),
        audioTitle: storyAssetAudioTitle(slideStory, slideDesign),
        brandName: storyAssetBrandName(slideStory, slideDesign),
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

