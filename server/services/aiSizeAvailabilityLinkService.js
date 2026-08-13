import { getPublicAppUrl } from "../utils/publicUrl.js";

const text = (value = "") => String(value ?? "").trim();
const normalizeArabic = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u0625\u0623\u0622\u0627]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u064b-\u065f\u0640]/g, "")
    .replace(/[\u061f?,.;:!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SIZE_BROWSING_TERMS = [
  "\u0627\u0644\u0645\u062a\u0627\u062d",
  "\u0639\u0627\u064a\u0632 \u0627\u0634\u0648\u0641",
  "\u0639\u0627\u064a\u0632\u0647 \u0627\u0634\u0648\u0641",
  "\u0639\u0627\u064a\u0632\u0629 \u0627\u0634\u0648\u0641",
  "\u0639\u0646\u062f\u0643 \u0627\u064a\u0647",
  "\u0648\u0631\u064a\u0646\u064a",
  "\u0643\u0644 \u0627\u0644\u0644\u064a \u0645\u0648\u062c\u0648\u062f",
  "\u0643\u0644 \u0627\u0644\u0645\u0648\u062c\u0648\u062f",
  "\u0645\u0648\u062c\u0648\u062f \u0645\u0642\u0627\u0633",
  "\u0645\u062a\u0627\u062d \u0645\u0642\u0627\u0633",
  "\u0645\u0642\u0627\u0633",
];

const MODEL_ALIASES = [
  { pattern: /\b(jordan\s*4|air\s*jordan\s*4|aj4|j4)\b|\u062c\u0648\u0631\u062f\u0646\s*(\u0641\u0648\u0631|4|\u0664)|\u062c\u0648\u0631\u062f\u0627\u0646\s*(\u0641\u0648\u0631|4|\u0664)/i, query: "Jordan 4" },
  { pattern: /\bshox\b|\u0634\u0648\u0643\u0633/i, query: "Shox" },
  { pattern: /\bdunk\b|\u062f\u0627\u0646\u0643/i, query: "Dunk" },
  { pattern: /\bair\s*force\b|\u0627\u064a\u0631\s*\u0641\u0648\u0631\u0633/i, query: "Air Force" },
];

const QUALITY_OPTIONS = [
  { key: "egyptian", label: "\u0645\u0635\u0631\u064a", patterns: [/\u0645\u0635\u0631\u064a/i, /egypt/i, /egyptian/i] },
  { key: "vietnamese_import", label: "\u0645\u0633\u062a\u0648\u0631\u062f \u0641\u064a\u062a\u0646\u0627\u0645\u064a", patterns: [/\u0645\u0633\u062a\u0648\u0631\u062f\s*\u0641\u064a\u062a\u0646\u0627\u0645\u064a/i, /\u0641\u064a\u062a\u0646\u0627\u0645\u064a/i, /\u0645\u0633\u062a\u0648\u0631\u062f/i, /vietnam/i, /vietnamese/i, /import/i] },
  { key: "mirror", label: "\u0645\u064a\u0631\u0648\u0631", patterns: [/\u0645\u064a\u0631\u0648\u0631/i, /mirror/i] },
  { key: "", label: "\u0627\u0644\u0643\u0644", patterns: [/\u0627\u0644\u0643\u0644/i, /^\u0643\u0644$/i, /all/i] },
];

export const detectSizeBrowseQuality = (message = "") => {
  const raw = text(message);
  const normalized = normalizeArabic(raw);
  const option = QUALITY_OPTIONS.find((item) => item.patterns.some((pattern) => pattern.test(raw) || pattern.test(normalized)));
  if (!option) return { detected: false, quality: "", label: "" };
  return { detected: true, quality: option.key, label: option.label };
};

export const SIZE_BROWSE_PENDING_TIMEOUT_MS = 15 * 60 * 1000;

export const pendingSizeBrowseExpired = (memory = {}, now = Date.now()) => {
  if (!memory?.pendingSizeBrowseAwaitingQuality) return false;
  const updatedAt = Date.parse(memory.pendingSizeBrowseStartedAt || memory.updatedAt || "");
  if (!Number.isFinite(updatedAt)) return false;
  return now - updatedAt > SIZE_BROWSE_PENDING_TIMEOUT_MS;
};

export const detectSizeAvailabilityIntent = (message = "") => {
  const raw = text(message);
  const normalized = normalizeArabic(raw);
  const sizeMatch = normalized.match(/(?:\u0645\u0642\u0627\u0633|size)?\s*(2[5-9]|3[0-9]|4[0-9]|5[0-2])\b/i);
  const size = sizeMatch?.[1] || "";
  if (!size) return { detected: false };
  const hasBrowsingTerm = SIZE_BROWSING_TERMS.some((term) => normalized.includes(normalizeArabic(term)));
  if (!hasBrowsingTerm) return { detected: false };
  const gender = /\u0631\u062c\u0627\u0644\u064a|\u0631\u062c\u0627\u0644\u0647|\u0631\u062c\u0627\u0644|men\b|male\b/i.test(normalized)
    ? "men"
    : /\u062d\u0631\u064a\u0645\u064a|\u0646\u0633\u0627\u0626\u064a|\u0646\u0633\u0627\u0621|women\b|female\b/i.test(normalized)
      ? "women"
      : /\u0627\u0637\u0641\u0627\u0644|\u0648\u0644\u0627\u062f\u064a|\u0628\u0646\u0627\u062a\u064a|kids?\b|children/i.test(normalized)
        ? "kids"
        : "";
  const alias = MODEL_ALIASES.find((item) => item.pattern.test(raw) || item.pattern.test(normalized));
  const quality = detectSizeBrowseQuality(raw);
  return {
    detected: true,
    size,
    gender,
    query: alias?.query || "",
    qualityDetected: quality.detected,
    quality: quality.quality,
    qualityLabel: quality.label,
  };
};

export const storefrontBaseUrl = () =>
  [
    process.env.STORE_FRONT_URL,
    process.env.STOREFRONT_URL,
    process.env.PUBLIC_STOREFRONT_URL,
    process.env.VITE_STOREFRONT_URL,
    getPublicAppUrl(),
  ]
    .map((value) => text(value).replace(/\/+$/g, ""))
    .map((value) => /\/\/erp-system-ten-green\.vercel\.app$/i.test(value) ? "https://m1store-egy.com" : value)
    .find(Boolean) || "https://m1store-egy.com";

export const buildSizeAvailabilityStorefrontUrl = ({ size, gender = "", query = "", quality = "" } = {}) => {
  const base = storefrontBaseUrl();
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (gender) params.set("gender", gender);
  if (size) params.set("size", size);
  if (quality) params.set("quality", quality);
  params.set("inStock", "1");
  params.set("v", "7");
  return `${base || ""}/share/available?${params.toString().replace(/\+/g, "%20")}`;
};

export const resolvePendingSizeBrowseQuality = ({ memory = {}, message = "", now = Date.now() } = {}) => {
  if (!memory?.pendingSizeBrowseAwaitingQuality) return { locked: false, handled: false, expired: false };
  if (pendingSizeBrowseExpired(memory, now)) {
    return { locked: false, handled: false, expired: true, clearPending: true };
  }
  const selected = detectSizeBrowseQuality(message);
  if (!selected.detected) return { locked: false, handled: false, expired: false };
  const intent = {
    size: memory.pendingSizeBrowseSize || "",
    gender: memory.pendingSizeBrowseGender || "",
    query: memory.pendingSizeBrowseQuery || "",
    quality: selected.quality || "",
    qualityLabel: selected.label || "",
  };
  const url = buildSizeAvailabilityStorefrontUrl(intent);
  return {
    locked: true,
    handled: true,
    expired: false,
    otherIntentsSkipped: true,
    intent,
    quality: selected,
    url,
    clearPending: true,
  };
};

export const sizeAvailabilityClarificationText = ({ size = "" } = {}) =>
  [
    "\u062a\u0645\u0627\u0645 ",
    `\u062a\u062d\u0628 \u062a\u0634\u0648\u0641 \u0645\u0642\u0627\u0633 ${size} \u0641\u064a \u0623\u0646\u0647\u064a \u0646\u0648\u0639\u061f`,
    "\u0645\u0635\u0631\u064a\u060c \u0645\u0633\u062a\u0648\u0631\u062f \u0641\u064a\u062a\u0646\u0627\u0645\u064a\u060c \u0645\u064a\u0631\u0648\u0631\u060c \u0648\u0644\u0627 \u0627\u0644\u0643\u0644\u061f",
  ].join("\n");

export const sizeAvailabilityReplyText = ({ size, gender = "", quality = "", qualityLabel = "", url = "" } = {}) => {
  const genderText = gender === "men" ? "\u0631\u062c\u0627\u0644\u064a " : gender === "women" ? "\u062d\u0631\u064a\u0645\u064a " : gender === "kids" ? "\u0623\u0637\u0641\u0627\u0644 " : "";
  const qualityText = quality ? ` ${qualityLabel || QUALITY_OPTIONS.find((item) => item.key === quality)?.label || ""}` : "";
  return [
    genderText
      ? `\u0623\u0643\u064a\u062f  \u062f\u0647 \u0644\u064a\u0646\u0643 \u0643\u0644 \u0627\u0644\u0645\u062a\u0627\u062d ${genderText}\u0645\u0642\u0627\u0633 ${size}${qualityText}:`
      : `\u0623\u0643\u064a\u062f  \u062f\u0647 \u0644\u064a\u0646\u0643 \u0643\u0644 \u0627\u0644\u0645\u062a\u0627\u062d \u0645\u0642\u0627\u0633 ${size}${qualityText}:`,
    url,
    "\u0644\u0648 \u062a\u062d\u0628 \u0623\u0631\u0634\u062d\u0644\u0643 \u0623\u062d\u0633\u0646 3 \u0645\u0646\u0647\u0645 \u0627\u0628\u0639\u062a\u0644\u064a: \u0631\u0634\u062d\u0644\u064a",
  ].join("\n");
};
