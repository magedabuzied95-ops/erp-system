import db from "../database/db.js";
import { getWebsiteSettings } from "./liveActivityService.js";
import {
  attachVariantImages,
  loadProductVariantImages,
} from "./productVariantImagesService.js";

const PRODUCT_LIMIT = 6;
const VARIANT_LIMIT = 12;
const SOURCE_TEXT_LIMIT = 4_000;
const DEBUG_PRODUCT_CONTEXT =
  process.env.AI_SUPPORT_DEBUG === "1";
const PRODUCT_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='18' fill='%23f5f5f4'/%3E%3Cpath d='M25 63l13-15 10 10 8-9 15 14H25z' fill='%23d6d3d1'/%3E%3Ccircle cx='37' cy='35' r='7' fill='%23d6d3d1'/%3E%3C/svg%3E";

const PRODUCT_INTENT_TERMS = [
  "product",
  "item",
  "sku",
  "barcode",
  "color",
  "colour",
  "size",
  "stock",
  "available",
  "availability",
  "price",
  "discount",
  "sale",
  "similar",
  "بديل",
  "متاح",
  "مقاس",
  "لون",
  "سعر",
  "خصم",
  "منتج",
];

const PRODUCT_DISCOVERY_TERMS = [
  "shoe",
  "shoes",
  "sneaker",
  "sneakers",
  "trainer",
  "trainers",
  "footwear",
  "model",
  "models",
  "jordan",
  "\u0643\u0648\u062a\u0634\u064a",
  "\u0643\u0648\u062a\u0634\u064a\u0627\u062a",
  "\u062c\u0632\u0645\u0629",
  "\u062c\u0632\u0645\u0647",
  "\u0633\u0646\u064a\u0643\u0631\u0632",
  "\u0634\u0648\u0632",
  "\u0645\u0648\u062f\u064a\u0644",
  "\u0645\u0648\u062f\u064a\u0644\u0627\u062a",
  "\u062c\u0648\u0631\u062f\u0646",
  "\u0631\u062c\u0627\u0644\u064a",
  "\u062d\u0631\u064a\u0645\u064a",
  "\u0648\u0644\u0627\u062f\u064a",
  "\u0628\u0646\u0627\u062a\u064a",
];

const BROAD_PRODUCT_DISCOVERY_TERMS = [
  "shoe",
  "shoes",
  "sneaker",
  "sneakers",
  "trainer",
  "trainers",
  "footwear",
  "model",
  "models",
  "\u0643\u0648\u062a\u0634\u064a",
  "\u0643\u0648\u062a\u0634\u064a\u0627\u062a",
  "\u062c\u0632\u0645\u0629",
  "\u062c\u0632\u0645\u0647",
  "\u0633\u0646\u064a\u0643\u0631\u0632",
  "\u0634\u0648\u0632",
  "\u0645\u0648\u062f\u064a\u0644",
  "\u0645\u0648\u062f\u064a\u0644\u0627\u062a",
];

const SHOPPING_REQUEST_TERMS = [
  "want",
  "show me",
  "looking for",
  "need",
  "\u0639\u0627\u064a\u0632",
  "\u0639\u0627\u064a\u0632\u0629",
  "\u0639\u0627\u0648\u0632",
  "\u0639\u0627\u0648\u0632\u0629",
  "\u0645\u062d\u062a\u0627\u062c",
  "\u0645\u062d\u062a\u0627\u062c\u0629",
  "\u0648\u0631\u064a\u0646\u064a",
  "\u0648\u0631\u0648\u0646\u064a",
  "\u0639\u0646\u062f\u0643\u0645",
  "\u062d\u0627\u062c\u0629",
  "\u0634\u0628\u0647",
  "\u0632\u064a",
];

const IMAGE_MODEL_TERMS = [
  "image",
  "photo",
  "picture",
  "\u0635\u0648\u0631\u0629",
  "\u0635\u0648\u0631\u0647",
  "\u0645\u0639\u0627\u064a\u0627 \u0635\u0648\u0631\u0629",
  "\u0645\u0639\u0627\u064a\u0627 \u0635\u0648\u0631\u0647",
  "\u0639\u0646\u062f\u064a \u0635\u0648\u0631\u0629",
  "\u0639\u0646\u062f\u064a \u0635\u0648\u0631\u0647",
];

const PRODUCT_QUERY_STOP_TERMS = [
  "price",
  "cost",
  "how",
  "much",
  "available",
  "availability",
  "stock",
  "size",
  "\u0633\u0639\u0631",
  "\u0628\u0643\u0627\u0645",
  "\u0643\u0627\u0645",
  "\u0643\u0645",
  "\u0647\u0644",
  "\u0645\u062a\u0627\u062d",
  "\u0645\u0648\u062c\u0648\u062f",
  "\u0645\u062a\u0648\u0641\u0631",
  "\u0645\u0642\u0627\u0633",
  "\u0627\u0644\u0633\u0639\u0631",
  "\u0639\u0627\u064a\u0632",
  "\u0639\u0627\u0648\u0632",
];

const HUMAN_SUPPORT_TERMS = [
  "human",
  "agent",
  "person",
  "representative",
  "complaint",
  "\u0643\u0644\u0645\u0648\u0646\u064a",
  "\u0643\u0644\u0645\u0646\u064a",
  "\u062d\u062f \u064a\u0643\u0644\u0645\u0646\u064a",
  "\u0645\u0639 \u062d\u062f",
  "\u0645\u0648\u0638\u0641",
  "\u0627\u062f\u0645\u0646",
  "\u0634\u0643\u0648\u0649",
  "\u0634\u0643\u0648\u0647",
  "\u0627\u0646\u0633\u0627\u0646",
  "\u0628\u0646\u064a \u0627\u062f\u0645",
  "\u0628\u0646\u064a \u0622\u062f\u0645",
];

const STORE_INTENT_TERMS = [
  "branch",
  "store",
  "hours",
  "working",
  "open",
  "close",
  "address",
  "phone",
  "shipping",
  "delivery",
  "return",
  "exchange",
  "refund",
  "payment",
  "policy",
  "\u0641\u0631\u0639",
  "\u0641\u0631\u0648\u0639",
  "\u0639\u0646\u0648\u0627\u0646",
  "\u0645\u0648\u0627\u0639\u064a\u062f",
  "\u0633\u0627\u0639\u0627\u062a",
  "\u0639\u0645\u0644",
  "\u0645\u0641\u062a\u0648\u062d",
  "\u0645\u0642\u0641\u0648\u0644",
  "\u0634\u062d\u0646",
  "\u062a\u0648\u0635\u064a\u0644",
  "\u0627\u0633\u062a\u0631\u062c\u0627\u0639",
  "\u0627\u0633\u062a\u0628\u062f\u0627\u0644",
  "\u062f\u0641\u0639",
  "\u0633\u064a\u0627\u0633\u0629",
  "\u0648\u0627\u062a\u0633",
  "\u062a\u0644\u064a\u0641\u0648\u0646",
  "\u0645\u0648\u0628\u0627\u064a\u0644",
  "فرع",
  "عنوان",
  "شحن",
  "توصيل",
  "استرجاع",
  "استبدال",
  "دفع",
  "سياسة",
];

const INTERNAL_INTENT_TERMS = [
  "admin",
  "supplier",
  "cost",
  "wholesale",
  "profit",
  "margin",
  "inventory movement",
  "internal",
  "password",
  "token",
  "secret",
  "api key",
  "customer data",
  "\u0633\u0639\u0631 \u0627\u0644\u062a\u0643\u0644\u0641\u0629",
  "\u062a\u0643\u0644\u0641\u0629",
  "\u0633\u0639\u0631 \u0627\u0644\u062c\u0645\u0644\u0629",
  "\u062c\u0645\u0644\u0629",
  "\u0645\u0648\u0631\u062f",
  "\u0645\u0648\u0631\u062f\u064a\u0646",
  "\u0647\u0627\u0645\u0634",
  "\u0631\u0628\u062d",
  "\u062f\u0627\u062e\u0644\u064a",
  "بيانات عميل",
  "مورد",
  "تكلفة",
  "هامش",
  "داخلي",
];

const CONVERSATIONAL_RESPONSE_SETS = Object.freeze({
  greeting: [
    "\u0623\u0647\u0644\u0627\u064b \u0628\u064a\u0643 \u2764\ufe0f \u0625\u0632\u0627\u064a \u0623\u0642\u062f\u0631 \u0623\u0633\u0627\u0639\u062f\u0643\u061f",
    "\u0645\u0646\u0648\u0631\u0646\u0627 \u2728 \u062a\u062d\u0628 \u0623\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0645\u0646\u062a\u062c \u0623\u0648 \u0627\u0633\u062a\u0641\u0633\u0627\u0631 \u0645\u0639\u064a\u0646\u061f",
  ],
  thanks: [
    "\u0627\u0644\u0639\u0641\u0648 \u2764\ufe0f \u062a\u062d\u0628 \u0623\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0623\u064a \u062d\u0627\u062c\u0629 \u062a\u0627\u0646\u064a\u0629\u061f",
    "\u062a\u062d\u062a \u0623\u0645\u0631\u0643 \u2728 \u0644\u0648 \u0639\u0646\u062f\u0643 \u0623\u064a \u0633\u0624\u0627\u0644 \u0627\u0628\u0639\u062a\u0644\u064a.",
  ],
  goodbye: [
    "\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u2764\ufe0f \u0645\u0633\u062a\u0646\u064a\u064a\u0646\u0643 \u0623\u064a \u0648\u0642\u062a.",
    "\u064a\u0648\u0645\u0643 \u062c\u0645\u064a\u0644 \u2728 \u0644\u0648 \u0627\u062d\u062a\u062c\u062a \u0623\u064a \u0645\u0633\u0627\u0639\u062f\u0629 \u0627\u0628\u0639\u062a\u0644\u0646\u0627.",
  ],
  help: [
    "\u062a\u062d\u062a \u0623\u0645\u0631\u0643 \u2728 \u0627\u0628\u0639\u062a\u0644\u064a \u0633\u0624\u0627\u0644\u0643 \u0648\u0647\u062d\u0627\u0648\u0644 \u0623\u0633\u0627\u0639\u062f\u0643.",
    "\u0623\u0643\u064a\u062f \u2764\ufe0f \u0642\u0648\u0644\u064a \u062a\u062d\u0628 \u062a\u0633\u0623\u0644 \u0639\u0646 \u0625\u064a\u0647\u061f",
  ],
});

const CONVERSATIONAL_PATTERNS = Object.freeze({
  greeting: [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good evening",
    "\u0647\u0627\u064a",
    "\u0647\u0627\u0649",
    "\u0647\u0644\u0627",
    "\u0627\u0647\u0644\u0627",
    "\u0623\u0647\u0644\u0627",
    "\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645",
    "\u0635\u0628\u0627\u062d \u0627\u0644\u062e\u064a\u0631",
    "\u0645\u0633\u0627\u0621 \u0627\u0644\u062e\u064a\u0631",
    "\u0627\u0632\u064a\u0643",
    "\u0627\u0632\u064a\u0643\u0645",
    "\u0627\u0632\u064a\u0643\u0648",
    "\u0639\u0627\u0645\u0644 \u0627\u064a\u0647",
    "\u0639\u0627\u0645\u0644\u0647 \u0627\u064a\u0647",
    "\u0639\u0627\u0645\u0644\u064a\u0646 \u0627\u064a\u0647",
  ],
  thanks: [
    "thanks",
    "thank you",
    "\u0634\u0643\u0631\u0627",
    "\u0645\u062a\u0634\u0643\u0631",
    "\u0645\u062a\u0634\u0643\u0631\u0629",
    "\u062a\u0633\u0644\u0645",
    "\u062a\u0633\u0644\u0645\u064a",
    "\u0645\u064a\u0631\u0633\u064a",
  ],
  goodbye: [
    "bye",
    "goodbye",
    "see you",
    "\u0628\u0627\u064a",
    "\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629",
    "\u0633\u0644\u0627\u0645",
  ],
  help: [
    "help",
    "can you help",
    "i need help",
    "\u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u0645\u0643\u0646 \u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u062d\u062a\u0627\u062c \u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u062d\u062a\u0627\u062c\u0629 \u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u0645\u0643\u0646 \u062a\u0633\u0627\u0639\u062f\u0646\u064a",
    "\u0639\u0627\u064a\u0632 \u0627\u0633\u0627\u0644",
    "\u0639\u0627\u064a\u0632\u0629 \u0627\u0633\u0627\u0644",
    "\u0639\u0646\u062f\u064a \u0633\u0624\u0627\u0644",
    "\u0645\u0645\u0643\u0646 \u0627\u0633\u0627\u0644",
  ],
});

const CONVERSATIONAL_FILLER_TERMS = new Set([
  "please",
  "\u0644\u0648\u0633\u0645\u062d\u062a",
  "\u0644\u0648",
  "\u0633\u0645\u062d\u062a",
  "\u064a\u0627",
  "\u062c\u0645\u0627\u0639\u0629",
  "\u0645\u0646",
  "\u0641\u0636\u0644\u0643",
]);

const COLOR_TERMS = [
  "black",
  "white",
  "red",
  "blue",
  "green",
  "yellow",
  "pink",
  "purple",
  "brown",
  "beige",
  "gray",
  "grey",
  "orange",
  "navy",
  "\u0627\u0633\u0648\u062f",
  "\u0623\u0633\u0648\u062f",
  "\u0633\u0648\u062f\u0627",
  "\u0633\u0648\u062f\u0627\u0621",
  "\u0627\u0628\u064a\u0636",
  "\u0623\u0628\u064a\u0636",
  "ذهبي",
  "فضي",
  "اسود",
  "أسود",
  "ابيض",
  "أبيض",
  "احمر",
  "أحمر",
  "ازرق",
  "أزرق",
  "اخضر",
  "أخضر",
  "بيج",
  "رمادي",
  "بني",
];

const SIZE_PATTERN = /\b(3[0-9]|4[0-9]|5[0-5]|xs|s|m|l|xl|xxl|xxxl|small|medium|large|one size)\b/i;
const CODE_PATTERN = /\b[A-Z0-9][A-Z0-9._-]{2,}\b/gi;

const columnCache = new Map();

const toText = (value, fallback = "") => String(value ?? fallback).trim();

const compactText = (value, limit = SOURCE_TEXT_LIMIT) => toText(value).replace(/\s+/g, " ").slice(0, limit);

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const deepFindValue = (source, candidateKeys = []) => {
  const keys = new Set(candidateKeys.map((key) => String(key).toLowerCase()));
  const seen = new Set();
  const visit = (value) => {
    if (!isObject(value) && !Array.isArray(value)) return "";
    if (seen.has(value)) return "";
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found !== "") return found;
      }
      return "";
    }
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(String(key).toLowerCase()) && item !== undefined && item !== null && item !== "") return item;
    }
    for (const item of Object.values(value)) {
      const found = visit(item);
      if (found !== "") return found;
    }
    return "";
  };
  return visit(source);
};

const normalizePublicValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizePublicValue).filter((item) => item !== "");
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, normalizePublicValue(item)])
        .filter(([, item]) => item !== "" && !(Array.isArray(item) && item.length === 0))
    );
  }
  return toText(value);
};

const firstConfigured = (...values) => {
  for (const value of values) {
    const normalized = normalizePublicValue(value);
    if (Array.isArray(normalized) && normalized.length) return normalized;
    if (isObject(normalized) && Object.keys(normalized).length) return normalized;
    if (toText(normalized)) return normalized;
  }
  return "";
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (isObject(value)) return Object.values(value);
  const parsed = safeJsonParse(value);
  if (Array.isArray(parsed)) return parsed;
  if (isObject(parsed)) return Object.values(parsed);
  return [];
};

const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const money = (value) => {
  const amount = numeric(value, 0);
  return Number.isFinite(amount) ? amount : 0;
};

const unique = (items = []) => [...new Set(items.map((item) => toText(item)).filter(Boolean))];

const trimSlashes = (value = "") => String(value || "").replace(/^\/+|\/+$/g, "");

const firstImageValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstImageValue(...value);
      if (nested) return nested;
      continue;
    }
    if (isObject(value)) {
      const nested = firstImageValue(value.image_url, value.url, value.path, value.src, value.preview, value.secure_url);
      if (nested) return nested;
      continue;
    }
    const text = toText(value);
    if (text) return text;
  }
  return "";
};

const resolveStorefrontProductImageUrl = (value, req = null) => {
  const imageUrl = toText(value);
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

  if (imageUrl.startsWith("/uploads/") || imageUrl.startsWith("uploads/")) return `/${trimSlashes(imageUrl)}`;
  if (imageUrl.startsWith("products/")) return `/uploads/${trimSlashes(imageUrl)}`;
  if (imageUrl.startsWith("/products/")) return `/uploads${imageUrl}`;
  if (imageUrl.startsWith("/")) return imageUrl;
  return `/uploads/products/${trimSlashes(imageUrl)}`;
};

const isPlaceholderImageUrl = (value = "") => toText(value) === PRODUCT_IMAGE_PLACEHOLDER || toText(value).includes("/favicon.svg");

const resolveSuggestedProductImageUrl = (product = {}, req = null) => {
  const productImages = normalizeJsonArray(product.product_images);
  const variantImages = Array.isArray(product.variants)
    ? product.variants.flatMap((variant) => [
        variant?.image_url,
        variant?.image,
        variant?.main_image,
        variant?.thumbnail,
        ...normalizeJsonArray(variant?.product_images),
      ])
    : [];
  const source = firstImageValue(
    product.image_url,
    product.main_image,
    product.image,
    product.thumbnail,
    productImages,
    variantImages
  );
  return resolveStorefrontProductImageUrl(source, req) || PRODUCT_IMAGE_PLACEHOLDER;
};

const compactImageDebugValue = (value = "") => {
  const text = toText(value);
  if (text.length <= 220) return text;
  return `${text.slice(0, 120)}...${text.slice(-40)}`;
};

const imageDebugFields = (product = {}) => ({
  image: compactImageDebugValue(product.image),
  image_url: compactImageDebugValue(product.image_url),
  raw_image_url: compactImageDebugValue(product.raw_image_url),
  main_image: compactImageDebugValue(product.main_image),
  thumbnail: compactImageDebugValue(product.thumbnail),
  product_images_count: normalizeJsonArray(product.product_images).length,
  gallery_images_count: normalizeJsonArray(product.gallery_images).length,
  variant_images: (Array.isArray(product.variants) ? product.variants : []).slice(0, 6).map((variant) => ({
    id: variant?.id,
    image_url: compactImageDebugValue(variant?.image_url),
    primary_image_url: compactImageDebugValue(variant?.primary_image_url),
    variant_image_url: compactImageDebugValue(variant?.variant_image_url),
    color_image_url: compactImageDebugValue(variant?.color_image_url),
    images_count: Array.isArray(variant?.images) ? variant.images.length : 0,
  })),
});

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

const getColumns = async (tableName) => {
  if (columnCache.has(tableName)) return columnCache.get(tableName);
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  columnCache.set(tableName, columns);
  return columns;
};

const pickColumn = (columns, candidates) => candidates.find((column) => columns.has(column)) || null;

const columnExpr = (alias, columns, candidates, fallback = "NULL") => {
  const column = pickColumn(columns, candidates);
  return column ? `${alias}.${column}` : fallback;
};

const columnList = (alias, columns, candidates) =>
  candidates.filter((column) => columns.has(column)).map((column) => `${alias}.${column}`);

const variantTenantClause = (variantColumns, alias = "pv") =>
  variantColumns.has("tenant_id") ? `AND (${alias}.tenant_id = p.tenant_id OR ${alias}.tenant_id IS NULL)` : "";

const debugProductSearch = (message, payload = {}) => {
  if (!DEBUG_PRODUCT_CONTEXT) return;
  console.debug(`[ai-support product-context] ${message}`, payload);
};

const hasAnyTerm = (message, terms) => {
  const text = message.toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
};

const normalizeConversationalText = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[إأآ]/g, "\u0627")
    .replace(/ى/g, "\u064a")
    .replace(/ؤ/g, "\u0648")
    .replace(/ئ/g, "\u064a")
    .replace(/ة/g, "\u0647")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const detectConversationalSubtype = (message = "") => {
  const normalized = normalizeConversationalText(message);
  if (!normalized || normalized.length > 120) return "";
  if (hasAnyTerm(message, [...PRODUCT_INTENT_TERMS, ...STORE_INTENT_TERMS, ...INTERNAL_INTENT_TERMS])) return "";
  if (unique(toText(message).match(CODE_PATTERN) || []).length) return "";
  if (SIZE_PATTERN.test(message)) return "";

  for (const [subtype, patterns] of Object.entries(CONVERSATIONAL_PATTERNS)) {
    const normalizedPatterns = patterns.map(normalizeConversationalText);
    if (normalizedPatterns.some((pattern) => normalized === pattern)) return subtype;

    const containsSafePhrase = normalizedPatterns.some((pattern) => {
      if (!pattern || !normalized.includes(pattern)) return false;
      const remainingWords = normalized
        .replace(pattern, " ")
        .split(/\s+/)
        .filter(Boolean);
      return remainingWords.length <= 3 && remainingWords.every((word) => CONVERSATIONAL_FILLER_TERMS.has(word));
    });
    if (containsSafePhrase) return subtype;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && words.every((word) => CONVERSATIONAL_FILLER_TERMS.has(word))) return "help";

  return "";
};

export const detectAiSupportIntent = (message = "") => {
  const text = toText(message);
  const lower = text.toLowerCase();
  const codes = unique(text.match(CODE_PATTERN) || []).slice(0, 5);
  const colors = unique(COLOR_TERMS.filter((color) => lower.includes(color.toLowerCase()))).slice(0, 4);
  const sizeMatch = text.match(SIZE_PATTERN);
  const asksSimilar = /similar|alternative|like this|بديل|مشابه|شبه|زي|زى/i.test(text);
  const asksAvailability = /stock|available|availability|متاح|موجود|متوفر|كمية|عندكم/i.test(text);
  const asksPrice = /price|cost|سعر|بكام|كم|كام/i.test(text);
  const isInternal = hasAnyTerm(text, INTERNAL_INTENT_TERMS);
  const hasRefundProblem = /(refund|return|exchange|استرجاع|استبدال).*(problem|issue|complaint|مشكلة|شكوى)|(problem|issue|complaint|مشكلة|شكوى).*(refund|return|exchange|استرجاع|استبدال)/i.test(text);
  const conversationalSubtype = isInternal ? "" : detectConversationalSubtype(text);
  const isStore = hasAnyTerm(text, STORE_INTENT_TERMS);
  const wantsHuman = !isInternal && (hasAnyTerm(text, HUMAN_SUPPORT_TERMS) || hasRefundProblem);
  const mentionsProductDiscovery = !isInternal && hasAnyTerm(text, PRODUCT_DISCOVERY_TERMS);
  const hasShoppingRequest = !isInternal && hasAnyTerm(text, SHOPPING_REQUEST_TERMS);
  const mentionsImageModel = !isInternal && hasAnyTerm(text, IMAGE_MODEL_TERMS) && (mentionsProductDiscovery || hasShoppingRequest);
  const isProductDiscovery =
    !wantsHuman &&
    !isStore &&
    (mentionsImageModel ||
      mentionsProductDiscovery ||
      (hasShoppingRequest && (colors.length > 0 || Boolean(sizeMatch) || asksSimilar || asksAvailability)) ||
      (hasShoppingRequest && text.length <= 80));
  const isProduct = isInternal
    ? false
    : hasAnyTerm(text, PRODUCT_INTENT_TERMS) || codes.length > 0 || colors.length > 0 || Boolean(sizeMatch);

  return {
    type: isInternal
      ? "internal_data"
      : wantsHuman
        ? "human_support"
        : conversationalSubtype
          ? "conversational"
          : isProductDiscovery
            ? "product_discovery"
            : isProduct
              ? "product"
              : isStore
                ? "store_policy"
                : "general",
    conversational: {
      subtype: conversationalSubtype,
    },
    product: {
      codes,
      colors,
      size: sizeMatch?.[0] || "",
      asksSimilar,
      asksAvailability,
      asksPrice,
      discovery: isProductDiscovery,
      mentionsImageModel,
    },
  };
};

const buildProductConditions = ({ productColumns, variantColumns, terms, codes, includeActiveFilters = true, includeVisibilityFilters = true }) => {
  const clauses = [];
  const params = [];
  const filters = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  params.push(null);
  const tenantParam = "$1";
  clauses.push(`p.tenant_id = ${tenantParam}::bigint`);
  filters.push("tenant: p.tenant_id = $1");

  if (includeActiveFilters && productColumns.has("status")) {
    clauses.push(`LOWER(COALESCE(p.status::text, 'active')) NOT IN ('inactive', 'deleted', 'archived', 'disabled')`);
    filters.push("active: products.status not inactive/deleted/archived/disabled");
  }
  if (includeActiveFilters && productColumns.has("is_active")) {
    clauses.push(`COALESCE(p.is_active, TRUE) = TRUE`);
    filters.push("active: products.is_active true/null");
  }

  const visibilityColumn = pickColumn(productColumns, [
    "storefront_visible",
    "is_storefront_visible",
    "visible_on_storefront",
    "show_in_storefront",
    "is_visible",
  ]);
  if (includeVisibilityFilters && visibilityColumn) {
    clauses.push(`LOWER(COALESCE(p.${q(visibilityColumn)}::text, 'true')) NOT IN ('false', '0', 'no', 'hidden', 'inactive')`);
    filters.push(`storefront: ${visibilityColumn} not false/0/no/hidden/inactive or null`);
  }

  const searchClauses = [];
  const productSearchFields = columnList("p", productColumns, [
    "name",
    "title",
    "name_ar",
    "name_en",
    "title_ar",
    "title_en",
    "meta_title_ar",
    "meta_title_en",
    "edition_name",
    "description",
    "sku",
    "barcode",
    "product_type",
    "style",
    "grade",
    "gender",
  ]);
  const variantSearchFields = columnList("pvx", variantColumns, ["sku", "barcode", "color", "size"]);
  const variantExactFields = columnList("pvc", variantColumns, ["sku", "barcode"]);

  for (const term of terms.slice(0, 6)) {
    const likeParam = add(`%${term}%`);
    for (const field of productSearchFields) searchClauses.push(`${field}::text ILIKE ${likeParam}`);
    if (variantSearchFields.length) {
      searchClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pvx WHERE pvx.product_id = p.id ${variantTenantClause(variantColumns, "pvx")} AND (${variantSearchFields
          .map((field) => `${field}::text ILIKE ${likeParam}`)
          .join(" OR ")}))`
      );
    }
  }

  for (const code of codes.slice(0, 5)) {
    const codeParam = add(code);
    if (productColumns.has("sku")) searchClauses.push(`LOWER(p.sku) = LOWER(${codeParam})`);
    if (productColumns.has("barcode")) searchClauses.push(`LOWER(p.barcode) = LOWER(${codeParam})`);
    if (variantExactFields.length) {
      searchClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pvc WHERE pvc.product_id = p.id ${variantTenantClause(variantColumns, "pvc")} AND (${variantExactFields
          .map((field) => `LOWER(${field}::text) = LOWER(${codeParam})`)
          .join(" OR ")}))`
      );
    }
  }

  if (searchClauses.length) clauses.push(`(${searchClauses.join(" OR ")})`);

  return {
    where: clauses.join(" AND "),
    params,
    filters,
    storefrontFilterApplied: includeVisibilityFilters && Boolean(visibilityColumn),
    activeFilterApplied: includeActiveFilters && (productColumns.has("status") || productColumns.has("is_active")),
  };
};

const normalizeSearchTerms = (message, intent) => {
  const words = toText(message)
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 || /^\d+$/.test(word))
    .filter((word) => !PRODUCT_INTENT_TERMS.includes(word.toLowerCase()))
    .filter((word) => !PRODUCT_QUERY_STOP_TERMS.includes(word.toLowerCase()))
    .filter((word) => !BROAD_PRODUCT_DISCOVERY_TERMS.includes(word.toLowerCase()))
    .filter((word) => !SHOPPING_REQUEST_TERMS.includes(word.toLowerCase()))
    .filter((word) => !IMAGE_MODEL_TERMS.includes(word.toLowerCase()))
    .filter((word) => !STORE_INTENT_TERMS.includes(word.toLowerCase()))
    .filter((word) => !INTERNAL_INTENT_TERMS.includes(word.toLowerCase()));
  return unique([...intent.product.codes, ...intent.product.colors, intent.product.size, ...words]).slice(0, 10);
};

const normalizeProductMatchText = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const productQueryText = (message = "", intent = {}) => {
  const terms = normalizeSearchTerms(message, intent)
    .filter((term) => !intent.product?.colors?.includes(term))
    .filter((term) => term !== intent.product?.size);
  return normalizeProductMatchText(terms.join(" "));
};

const productBestPrice = (product = {}) => {
  const directSale = money(product.sale_price);
  const directPrice = money(product.price);
  if (directSale > 0) return directSale;
  if (directPrice > 0) return directPrice;
  const variantPrices = (Array.isArray(product.variants) ? product.variants : [])
    .flatMap((variant) => [money(variant?.sale_price), money(variant?.price)])
    .filter((value) => value > 0);
  return variantPrices.length ? Math.min(...variantPrices) : null;
};

const productRankScore = ({ product, queryText, intent }) => {
  const name = normalizeProductMatchText(product.name);
  const sku = normalizeProductMatchText(product.sku);
  const hasCopyName = /\bcopy\b|كوبي|كوبى/i.test(toText(product.name));
  const finalPrice = productBestPrice(product);
  let score = 0;

  if (queryText) {
    if (name === queryText) score += 1000;
    else if (name.endsWith(` ${queryText}`)) score += 780;
    else if (name.includes(queryText)) score += 650;
    else {
      const queryWords = queryText.split(/\s+/).filter(Boolean);
      const matchedWords = queryWords.filter((word) => name.includes(word) || sku.includes(word)).length;
      score += matchedWords * 120;
      if (queryWords.length && matchedWords === queryWords.length) score += 180;
    }
    if (sku === queryText) score += 700;
  }

  if (hasCopyName) score -= 260;
  if (Number(product.total_stock || 0) > 0) score += 130;
  if (finalPrice > 0) score += 110;
  if (intent.product?.size && (product.variants || []).some((variant) => toText(variant.size).toLowerCase() === intent.product.size.toLowerCase())) score += 90;
  if (intent.product?.colors?.length && (product.variants || []).some((variant) => intent.product.colors.some((color) => toText(variant.color).toLowerCase().includes(color.toLowerCase())))) score += 70;
  return score;
};

const rankProductsForIntent = ({ products = [], message = "", intent = {} }) => {
  const queryText = productQueryText(message, intent);
  return [...products].sort((left, right) => {
    const scoreDiff =
      productRankScore({ product: right, queryText, intent }) -
      productRankScore({ product: left, queryText, intent });
    if (scoreDiff !== 0) return scoreDiff;
    return Number(right.total_stock || 0) - Number(left.total_stock || 0);
  });
};

const normalizeProductRow = (row, intent) => {
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const filteredVariants = variants
    .filter((variant) => {
      const colorOk = !intent.product.colors.length || intent.product.colors.some((color) => toText(variant.color).toLowerCase().includes(color.toLowerCase()));
      const sizeOk = !intent.product.size || toText(variant.size).toLowerCase() === intent.product.size.toLowerCase();
      return colorOk && sizeOk;
    })
    .slice(0, VARIANT_LIMIT);
  const visibleVariants = filteredVariants.length ? filteredVariants : variants.slice(0, VARIANT_LIMIT);
  const totalStock = variants.length
    ? variants.reduce((sum, variant) => sum + Math.max(0, numeric(variant.stock, 0)), 0)
    : Math.max(0, numeric(row.stock, 0));
  const prices = [
    money(row.sale_price) > 0 ? money(row.sale_price) : null,
    money(row.price) > 0 ? money(row.price) : null,
    ...visibleVariants.flatMap((variant) => [money(variant.sale_price) > 0 ? money(variant.sale_price) : null, money(variant.price) > 0 ? money(variant.price) : null]),
  ].filter((value) => value !== null);

  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const hasDiscount = money(row.sale_price) > 0 && money(row.price) > 0 && money(row.sale_price) < money(row.price);

  const productImages = normalizeJsonArray(row.product_images);

  return {
    id: row.id,
    name: row.name,
    sku: row.sku || "",
    barcode: row.barcode || "",
    image: row.image || "",
    image_url: row.image_url || "",
    raw_image_url: row.image_url || "",
    product_image_url: row.product_image_url || row.image_url || row.image || row.main_image || row.thumbnail || "",
    main_image: row.main_image || "",
    thumbnail: row.thumbnail || "",
    product_images: productImages,
    gallery_images: productImages,
    price: money(row.price),
    sale_price: money(row.sale_price),
    price_range: minPrice === null ? null : minPrice === maxPrice ? `${minPrice}` : `${minPrice}-${maxPrice}`,
    active_discount: hasDiscount ? { sale_price: money(row.sale_price), original_price: money(row.price) } : null,
    total_stock: totalStock,
    availability: totalStock > 0 ? "available" : "out_of_stock",
    colors: unique(variants.map((variant) => variant.color)),
    sizes: unique(variants.map((variant) => variant.size)),
    variants: visibleVariants.map((variant) => ({
      id: variant.id,
      color: variant.color || "",
      size: variant.size || "",
      sku: variant.sku || "",
      barcode: variant.barcode || "",
      image_url: variant.image_url || "",
      variant_image_url: variant.image_url || "",
      color_image_url: variant.image_url || "",
      price: money(variant.price),
      sale_price: money(variant.sale_price),
      stock: Math.max(0, numeric(variant.stock, 0)),
      availability: numeric(variant.stock, 0) > 0 ? "available" : "out_of_stock",
    })),
  };
};

const hydrateProductsWithStorefrontImages = async (products = [], req = null) => {
  const rows = Array.isArray(products) ? products : [];
  const productIds = rows.map((product) => Number(product.id)).filter((value) => Number.isFinite(value) && value > 0);
  const imageBundleMap = await loadProductVariantImages(db, productIds).catch((error) => {
    debugProductSearch("image hydration skipped", { message: error?.message });
    return new Map();
  });

  return rows.map((product) => {
    const imageBundle = imageBundleMap.get(String(product.id)) || null;
    const variants = attachVariantImages(Array.isArray(product.variants) ? product.variants : [], imageBundle);
    const compactVariants = variants.map((variant) => {
      const selectedVariantImage =
        variant.primary_image_url ||
        variant.image_url ||
        variant.variant_image_url ||
        variant.color_image_url ||
        firstImageValue(variant.images) ||
        product.image_url ||
        product.product_image_url ||
        product.image ||
        product.main_image ||
        product.thumbnail ||
        firstImageValue(product.product_images) ||
        "";
      return {
        ...variant,
        image_url: selectedVariantImage,
        selected_image_field:
          variant.primary_image_url
            ? "variant.primary_image_url"
            : variant.image_url
              ? "variant.image_url"
              : variant.variant_image_url
                ? "variant.variant_image_url"
                : variant.color_image_url
                  ? "variant.color_image_url"
                  : firstImageValue(variant.images)
                    ? "variant.images"
                    : "",
      };
    });
    const primaryVariant = compactVariants.find((variant) => variant.image_url) || null;
    const fallbackProductImage = firstImageValue(
      product.image_url,
      product.product_image_url,
      product.image,
      product.main_image,
      product.thumbnail,
      product.product_images,
      product.gallery_images
    );
    const selectedImage = primaryVariant?.image_url || fallbackProductImage;
    const selectedImageField = primaryVariant?.selected_image_field || (
      product.image_url
        ? "products.image_url"
        : product.product_image_url
          ? "products.product_image_url"
          : product.image
            ? "products.image"
            : product.main_image
              ? "products.main_image"
              : product.thumbnail
                ? "products.thumbnail"
                : firstImageValue(product.product_images)
                  ? "products.product_images"
                  : ""
    );
    const finalImageUrl = selectedImage ? resolveStorefrontProductImageUrl(selectedImage, req) : "";
    const normalized = {
      ...product,
      variants: compactVariants,
      selected_image_field: selectedImageField,
      selected_image_source: selectedImage,
      image_url: finalImageUrl || "",
      product_image_url: finalImageUrl || "",
    };

    debugProductSearch("suggested product image", {
      id: product.id,
      name: product.name,
      raw_image_fields: imageDebugFields({ ...product, variants }),
      selected_image_field: selectedImageField || "(none)",
      selected_image_value: compactImageDebugValue(selectedImage),
      final_image_url: compactImageDebugValue(finalImageUrl),
      used_placeholder: !finalImageUrl,
      product_variant_images_count: imageBundle?.rows?.length || 0,
    });

    return normalized;
  });
};

const searchProducts = async ({ tenantId, message, intent, req = null }) => {
  const [productColumns, variantColumns] = await Promise.all([getColumns("products"), getColumns("product_variants")]);
  const productNameExpr = columnExpr("p", productColumns, ["name", "title", "name_en", "name_ar", "title_en", "title_ar"], "''");
  const productNameColumns = columnList("p", productColumns, ["name", "title", "name_ar", "name_en", "title_ar", "title_en"]);
  if (!productColumns.has("tenant_id") || !productNameColumns.length) return [];

  const terms = normalizeSearchTerms(message, intent);
  if (!terms.length && !intent.product.asksSimilar && intent.type !== "product_discovery") return [];

  const normalizedQuery = compactText(message, 500).toLowerCase();
  const productSchemaDebug = {
    product_name_title_fields: ["name", "title", "name_ar", "name_en", "title_ar", "title_en"].filter((column) => productColumns.has(column)),
    product_sku_barcode_fields: ["sku", "barcode"].filter((column) => productColumns.has(column)),
    product_active_status_fields: ["status", "is_active"].filter((column) => productColumns.has(column)),
    product_storefront_visibility_fields: ["storefront_visible", "is_storefront_visible", "visible_on_storefront", "show_in_storefront", "is_visible"].filter((column) => productColumns.has(column)),
    product_tenant_field: productColumns.has("tenant_id") ? "tenant_id" : null,
    variant_sku_barcode_fields: ["sku", "barcode"].filter((column) => variantColumns.has(column)),
    variant_color_size_fields: ["color", "size"].filter((column) => variantColumns.has(column)),
    variant_tenant_field: variantColumns.has("tenant_id") ? "tenant_id" : null,
  };

  const baseConditions = buildProductConditions({
    productColumns,
    variantColumns,
    terms,
    codes: intent.product.codes,
    includeActiveFilters: false,
    includeVisibilityFilters: false,
  });
  const activeOnlyConditions = buildProductConditions({
    productColumns,
    variantColumns,
    terms,
    codes: intent.product.codes,
    includeActiveFilters: true,
    includeVisibilityFilters: false,
  });
  const { where, params, filters, activeFilterApplied, storefrontFilterApplied } = buildProductConditions({
    productColumns,
    variantColumns,
    terms,
    codes: intent.product.codes,
  });
  params[0] = tenantId;
  params.push(PRODUCT_LIMIT);

  debugProductSearch("input", {
    normalized_query: normalizedQuery,
    extracted_product_terms: terms,
    tenant_id: tenantId,
    schema: productSchemaDebug,
    sql_filters_applied: filters,
  });

  const productSelect = {
    sku: columnExpr("p", productColumns, ["sku"], "''"),
    barcode: columnExpr("p", productColumns, ["barcode"], "''"),
    image: columnExpr("p", productColumns, ["image"], "''"),
    image_url: columnExpr("p", productColumns, ["image_url"], "''"),
    main_image: columnExpr("p", productColumns, ["main_image", "main_image_url", "public_image_url", "product_image_url"], "''"),
    thumbnail: columnExpr("p", productColumns, ["thumbnail", "thumbnail_url", "photo_url"], "''"),
    product_images: columnExpr("p", productColumns, ["product_images", "gallery_images", "images"], "'[]'::jsonb"),
    stock: columnExpr("p", productColumns, ["stock"], "0"),
    price: columnExpr("p", productColumns, ["price"], "0"),
    sale_price: columnExpr("p", productColumns, ["sale_price", "discount_price"], "0"),
  };
  const variantStockOrder = variantColumns.has("stock") ? "COALESCE(SUM(GREATEST(COALESCE(pv.stock, 0), 0)), 0)" : "0";
  const productStockOrder = productColumns.has("stock") ? "GREATEST(COALESCE(p.stock, 0), 0)" : "0";
  const stockOrder = `${variantStockOrder} + ${productStockOrder} DESC, `;
  const productOrder = productColumns.has("updated_at") ? `${stockOrder}p.updated_at DESC NULLS LAST, p.id DESC` : `${stockOrder}p.id DESC`;
  const variantSelect = {
    id: columnExpr("pv", variantColumns, ["id"], "NULL"),
    color: columnExpr("pv", variantColumns, ["color"], "''"),
    size: columnExpr("pv", variantColumns, ["size"], "''"),
    sku: columnExpr("pv", variantColumns, ["sku"], "''"),
    barcode: columnExpr("pv", variantColumns, ["barcode"], "''"),
    image_url: columnExpr("pv", variantColumns, ["image_url", "image", "photo_url", "thumbnail_url"], "''"),
    product_images: columnExpr("pv", variantColumns, ["product_images", "images"], "'[]'::jsonb"),
    price: columnExpr("pv", variantColumns, ["price"], "0"),
    sale_price: columnExpr("pv", variantColumns, ["sale_price", "discount_price"], "0"),
    stock: columnExpr("pv", variantColumns, ["stock"], "0"),
  };

  const result = await db.query(
    `
    SELECT
      p.id,
      ${productNameExpr} AS name,
      ${productSelect.sku} AS sku,
      ${productSelect.barcode} AS barcode,
      ${productSelect.image} AS image,
      ${productSelect.image_url} AS image_url,
      ${productSelect.main_image} AS main_image,
      ${productSelect.thumbnail} AS thumbnail,
      ${productSelect.product_images} AS product_images,
      ${productSelect.stock} AS stock,
      ${productSelect.price} AS price,
      ${productSelect.sale_price} AS sale_price,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', ${variantSelect.id},
            'color', ${variantSelect.color},
            'size', ${variantSelect.size},
            'sku', ${variantSelect.sku},
            'barcode', ${variantSelect.barcode},
            'image_url', ${variantSelect.image_url},
            'product_images', ${variantSelect.product_images},
            'price', ${variantSelect.price},
            'sale_price', ${variantSelect.sale_price},
            'stock', ${variantSelect.stock}
          )
          ORDER BY pv.id
        ) FILTER (WHERE pv.id IS NOT NULL),
        '[]'::jsonb
      ) AS variants
    FROM products p
    LEFT JOIN product_variants pv
      ON pv.product_id = p.id
     ${variantTenantClause(variantColumns, "pv")}
    WHERE ${where}
    GROUP BY p.id
    ORDER BY ${productOrder}
    LIMIT $${params.length}
    `,
    params
  );

  const countMatches = async (conditions) => {
    const countParams = [...conditions.params];
    countParams[0] = tenantId;
    const countResult = await db.query(`SELECT COUNT(*)::int AS count FROM products p WHERE ${conditions.where}`, countParams);
    return Number(countResult.rows[0]?.count || 0);
  };
  const [broadMatchedCount, activeMatchedCount] = await Promise.all([countMatches(baseConditions), countMatches(activeOnlyConditions)]);
  const products = rankProductsForIntent({
    products: await hydrateProductsWithStorefrontImages(
    result.rows.map((row) => normalizeProductRow(row, intent)),
    req
    ),
    message,
    intent,
  });

  debugProductSearch("result", {
    query_text: message,
    detected_intent: intent.type,
    tenant_id: tenantId,
    matched_product_count: products.length,
    broad_matched_product_count_before_active_storefront_filters: broadMatchedCount,
    matched_count_after_active_filters_before_storefront_filters: activeMatchedCount,
    active_filters_excluded_products: activeFilterApplied && broadMatchedCount > activeMatchedCount,
    storefront_filters_excluded_products: storefrontFilterApplied && activeMatchedCount > products.length,
    sample_matched_products: products.slice(0, 5).map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      sale_price: product.sale_price,
      final_price: productBestPrice(product),
      stock: product.total_stock,
      image_url: compactImageDebugValue(product.image_url),
      variant_skus: product.variants.map((variant) => variant.sku).filter(Boolean).slice(0, 3),
    })),
  });

  return products;
};

const sourceFromProduct = (product) => ({
  id: `product_${product.id}`,
  title: `Product: ${product.name}`,
  content: compactText(
    JSON.stringify({
      name: product.name,
      sku: product.sku || undefined,
      barcode: product.barcode || undefined,
      image: product.image || undefined,
      image_url: product.image_url || undefined,
      main_image: product.main_image || undefined,
      thumbnail: product.thumbnail || undefined,
      product_images: product.product_images?.length ? product.product_images : undefined,
      public_price: product.price || undefined,
      sale_price: product.sale_price || undefined,
      final_price: productBestPrice(product) || undefined,
      price_range: product.price_range || undefined,
      active_discount: product.active_discount || undefined,
      stock_summary: {
        total_stock: product.total_stock,
        availability: product.availability,
        colors: product.colors,
        sizes: product.sizes,
      },
      matching_variants: product.variants,
    })
  ),
});

const settingKeyGroups = {
  ai_support_knowledge_base: ["aiSupportKnowledgeBase", "ai_support_knowledge_base", "aiSupportKb", "ai_support_kb"],
  store_name: ["storeName", "store_name", "businessName", "business_name", "siteName", "site_name", "brandName", "brand_name", "name"],
  phone: ["phone", "supportPhone", "support_phone", "contactPhone", "contact_phone", "phoneNumber", "phone_number", "mobile"],
  whatsapp: ["whatsapp", "whatsApp", "whatsappNumber", "whatsapp_number", "supportWhatsapp", "support_whatsapp"],
  public_email: ["email", "supportEmail", "support_email", "contactEmail", "contact_email"],
  address: ["address", "storeAddress", "store_address", "publicAddress", "public_address"],
  working_hours: ["workingHours", "working_hours", "businessHours", "business_hours", "openingHours", "opening_hours", "hours"],
  payment_methods: ["paymentMethods", "payment_methods", "payments", "paymentOptions", "payment_options", "acceptedPayments", "accepted_payments"],
  payment_policy: ["paymentPolicy", "payment_policy", "paymentNotes", "payment_notes"],
  shipping_policy: ["shippingPolicy", "shipping_policy", "deliveryPolicy", "delivery_policy", "shipping", "delivery"],
  delivery_notes: ["deliveryNotes", "delivery_notes", "shippingNotes", "shipping_notes"],
  return_exchange_policy: [
    "returnExchangePolicy",
    "return_exchange_policy",
    "returnPolicy",
    "return_policy",
    "exchangePolicy",
    "exchange_policy",
    "refundPolicy",
    "refund_policy",
    "returns",
    "exchanges",
  ],
  warranty_notes: ["warrantyNotes", "warranty_notes", "warranty", "guaranteeNotes", "guarantee_notes"],
  human_support_message: ["humanSupportMessage", "human_support_message", "supportFallbackMessage", "support_fallback_message"],
  brand_tone_instructions: ["brandToneInstructions", "brand_tone_instructions", "toneInstructions", "tone_instructions"],
  social_links: ["socialLinks", "social_links", "social", "facebook", "instagram", "tiktok", "twitter", "x", "youtube"],
};

const buildPublicStoreSettings = (settings = {}) => {
  const picked = {};
  const kb = firstConfigured(...settingKeyGroups.ai_support_knowledge_base.map((key) => settings?.[key]));
  for (const [targetKey, candidates] of Object.entries(settingKeyGroups)) {
    if (targetKey === "ai_support_knowledge_base") continue;
    const value = firstConfigured(...candidates.map((key) => settings?.[key]), deepFindValue(settings, candidates));
    const kbValue = isObject(kb) ? firstConfigured(kb[targetKey], ...candidates.map((key) => kb?.[key]), deepFindValue(kb, candidates)) : "";
    if (kbValue !== "") picked[targetKey] = kbValue;
    else if (value !== "") picked[targetKey] = value;
  }
  picked.working_hours ||= "Working hours are not configured yet.";
  picked.return_exchange_policy ||= "Return/exchange policy is not configured yet.";
  return picked;
};

const loadStoreKnowledge = async ({ tenantId }) => {
  const settings = buildPublicStoreSettings(await getWebsiteSettings({ tenantId }));
  const branchColumns = await getColumns("branches");
  const branches = [];

  if (branchColumns.has("tenant_id") && branchColumns.has("name")) {
    const phoneExpr = columnExpr("b", branchColumns, ["phone"], "''");
    const addressExpr = columnExpr("b", branchColumns, ["address"], "''");
    const hoursExpr = columnExpr("b", branchColumns, ["working_hours", "business_hours", "opening_hours"], "NULL");
    const notesExpr = columnExpr("b", branchColumns, ["notes"], "''");
    const activeClause = branchColumns.has("is_active") ? "AND COALESCE(b.is_active, TRUE) = TRUE" : "";
    const result = await db.query(
      `
      SELECT
        b.name,
        ${phoneExpr} AS phone,
        ${addressExpr} AS address,
        ${hoursExpr} AS working_hours,
        ${notesExpr} AS notes
      FROM branches b
      WHERE b.tenant_id = $1::bigint
      ${activeClause}
      ORDER BY b.name ASC
      LIMIT 8
      `,
      [tenantId]
    );

    branches.push(
      ...result.rows.map((branch) => ({
        name: toText(branch.name),
        phone: toText(branch.phone),
        address: toText(branch.address),
        working_hours: toText(branch.working_hours) || "Working hours are not configured yet.",
        notes: toText(branch.notes),
      }))
    );
  }

  const storeContext = {
    store: settings,
    branches,
    configuration_status: {
      working_hours_configured:
        toText(settings.working_hours) !== "Working hours are not configured yet." ||
        branches.some((branch) => toText(branch.working_hours) !== "Working hours are not configured yet."),
      return_exchange_policy_configured: toText(settings.return_exchange_policy) !== "Return/exchange policy is not configured yet.",
    },
  };

  return [
    {
      id: "store_context",
      title: "Public store context, branches, contact details, policies, and configuration status",
      content: compactText(JSON.stringify(storeContext)),
      preview: storeContext,
    },
  ];
};

const isArabicText = (value = "") => /[\u0600-\u06ff]/.test(toText(value));

const joinList = (items = [], locale = "en") => {
  const values = items.map((item) => toText(item)).filter(Boolean);
  if (!values.length) return "";
  return locale === "ar" ? values.join("\n") : values.join("\n");
};

const valueToLines = (value) => {
  if (Array.isArray(value)) return value.map((item) => (isObject(item) ? JSON.stringify(item) : toText(item))).filter(Boolean);
  if (isObject(value)) return Object.entries(value).map(([key, item]) => `${key}: ${Array.isArray(item) || isObject(item) ? JSON.stringify(item) : toText(item)}`);
  return toText(value) ? [toText(value)] : [];
};

const buildDirectStoreResponse = ({ message, sources = [], suggestedActions = [] }) => {
  const source = sources.find((item) => item.id === "store_context");
  const context = source?.preview;
  if (!context) return null;
  const text = toText(message).toLowerCase();
  const locale = isArabicText(message) ? "ar" : "en";
  const store = context.store || {};
  const branches = Array.isArray(context.branches) ? context.branches : [];
  const has = (terms) => terms.some((term) => text.includes(term.toLowerCase()));
  const wrap = (answer) => ({
    answer,
    confidence: 1,
    needs_human_support: false,
    sources_used: ["store_context"],
    suggested_products: [],
    suggested_actions: suggestedActions.length ? suggestedActions : ["contact_support"],
  });

  if (has(["hours", "working", "open", "close", "\u0645\u0648\u0627\u0639\u064a\u062f", "\u0633\u0627\u0639\u0627\u062a", "\u0639\u0645\u0644", "\u0645\u0641\u062a\u0648\u062d"])) {
    const branchLines = branches
      .filter((branch) => toText(branch.working_hours) && toText(branch.working_hours) !== "Working hours are not configured yet.")
      .map((branch) => `${branch.name}: ${branch.working_hours}`);
    const settingLines = toText(store.working_hours) && store.working_hours !== "Working hours are not configured yet." ? valueToLines(store.working_hours) : [];
    const lines = [...settingLines, ...branchLines];
    if (lines.length) return wrap(locale === "ar" ? `مواعيد العمل:\n${joinList(lines, "ar")}` : `Working hours:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "مواعيد العمل غير مضافة حتى الآن." : "Working hours are not configured yet.");
  }

  if (has(["return", "exchange", "refund", "\u0627\u0633\u062a\u0631\u062c\u0627\u0639", "\u0627\u0633\u062a\u0628\u062f\u0627\u0644"])) {
    const lines = store.return_exchange_policy === "Return/exchange policy is not configured yet." ? [] : valueToLines(store.return_exchange_policy);
    if (lines.length) return wrap(locale === "ar" ? `سياسة الاستبدال والاسترجاع:\n${joinList(lines, "ar")}` : `Return/exchange policy:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "سياسة الاستبدال أو الاسترجاع غير مضافة حتى الآن." : "Return/exchange policy is not configured yet.");
  }

  if (has(["payment", "pay", "\u062f\u0641\u0639"])) {
    const lines = [...valueToLines(store.payment_methods), ...valueToLines(store.payment_policy)];
    if (lines.length) return wrap(locale === "ar" ? `طرق الدفع:\n${joinList(lines, "ar")}` : `Payment methods:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "طرق الدفع غير مضافة حتى الآن." : "Payment methods are not configured yet.");
  }

  if (has(["address", "branch", "location", "\u0639\u0646\u0648\u0627\u0646", "\u0641\u0631\u0639", "\u0641\u0631\u0648\u0639"])) {
    const branchLines = branches
      .filter((branch) => toText(branch.address))
      .map((branch) => `${branch.name}: ${branch.address}${branch.phone ? ` - ${branch.phone}` : ""}`);
    const settingLines = valueToLines(store.address);
    const lines = [...settingLines, ...branchLines];
    if (lines.length) return wrap(locale === "ar" ? `العناوين المتاحة:\n${joinList(lines, "ar")}` : `Available addresses:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "عنوان الفرع غير مضاف حتى الآن." : "Branch address is not configured yet.");
  }

  if (has(["shipping", "delivery", "\u0634\u062d\u0646", "\u062a\u0648\u0635\u064a\u0644"])) {
    const lines = [...valueToLines(store.shipping_policy), ...valueToLines(store.delivery_notes)];
    if (lines.length) return wrap(locale === "ar" ? `الشحن والتوصيل:\n${joinList(lines, "ar")}` : `Shipping and delivery:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "سياسة الشحن أو التوصيل غير مضافة حتى الآن." : "Shipping/delivery policy is not configured yet.");
  }

  if (has(["phone", "whatsapp", "contact", "\u0648\u0627\u062a\u0633", "\u062a\u0644\u064a\u0641\u0648\u0646", "\u0645\u0648\u0628\u0627\u064a\u0644"])) {
    const lines = [...valueToLines(store.phone), ...valueToLines(store.whatsapp), ...branches.filter((branch) => branch.phone).map((branch) => `${branch.name}: ${branch.phone}`)];
    if (lines.length) return wrap(locale === "ar" ? `بيانات التواصل:\n${joinList(lines, "ar")}` : `Contact details:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "بيانات التواصل غير مضافة حتى الآن." : "Contact details are not configured yet.");
  }

  return null;
};

const pickConversationalAnswer = ({ subtype = "greeting", tenantId = null, brandTone = "", message = "" } = {}) => {
  const normalizedMessage = normalizeConversationalText(message);
  if (subtype === "greeting" && normalizedMessage.includes("السلام عليكم")) {
    return "وعليكم السلام ❤️ إزاي أقدر أساعدك؟";
  }
  const responses = CONVERSATIONAL_RESPONSE_SETS[subtype] || CONVERSATIONAL_RESPONSE_SETS.greeting;
  const normalizedTone = normalizeConversationalText(brandTone);
  const prefersShort = /short|brief|concise/i.test(brandTone) || normalizedTone.includes("\u0645\u062e\u062a\u0635\u0631");
  const prefersFriendly = /friendly|warm|casual/i.test(brandTone) || normalizedTone.includes("\u0648\u062f\u0648\u062f") || normalizedTone.includes("\u0645\u0631\u062d");
  const seed = Math.abs(Number(tenantId || 0)) + subtype.length;
  if (prefersShort) return responses[0];
  if (prefersFriendly && responses[1]) return responses[1];
  return responses[seed % responses.length] || responses[0];
};

const buildDirectConversationalResponse = async ({ tenantId, intent, message }) => {
  let brandTone = "";
  if (tenantId) {
    try {
      const settings = buildPublicStoreSettings(await getWebsiteSettings({ tenantId }));
      brandTone = toText(settings.brand_tone_instructions);
    } catch (error) {
      console.warn("[ai-support] conversational tone load skipped", {
        tenantId,
        message: error?.message,
      });
    }
  }

  return {
    answer: pickConversationalAnswer({
      subtype: intent.conversational?.subtype || "greeting",
      tenantId,
      brandTone,
      message,
    }),
    confidence: 1,
    needs_human_support: false,
    sources_used: [],
    suggested_products: [],
    suggested_actions: ["contact_support"],
  };
};

const suggestedProducts = (products = [], req = null) =>
  products.slice(0, 6).map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku || "",
    image: product.image || "",
    image_url: resolveSuggestedProductImageUrl(product, req),
    main_image: product.main_image || "",
    thumbnail: product.thumbnail || "",
    product_images: Array.isArray(product.product_images) ? product.product_images : [],
    price: productBestPrice(product),
    sale_price: money(product.sale_price) > 0 ? money(product.sale_price) : null,
    final_price: productBestPrice(product),
    price_range: product.price_range || "",
    availability: product.availability,
    stock_status: Number(product.total_stock || 0) > 0 ? "in_stock" : "out_of_stock",
    product_url: `/shop/product/${product.id}`,
    total_stock: product.total_stock,
    stock: product.total_stock,
  }));

const formatProductPriceAr = (product = {}) => {
  const finalPrice = productBestPrice(product);
  return finalPrice > 0
    ? `${Number(finalPrice).toLocaleString("ar-EG-u-nu-latn")} ج.م`
    : "\u0627\u0644\u0633\u0639\u0631 \u063a\u064a\u0631 \u0645\u062d\u062f\u062f \u062d\u0627\u0644\u064a\u0627\u064b";
};

const stockTextAr = (stock) => (Number(stock || 0) > 0 ? "\u0645\u062a\u0627\u062d" : "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d \u062d\u0627\u0644\u064a\u0627\u064b");

const matchingSizeVariants = (product = {}, size = "") => {
  if (!size) return [];
  const normalizedSize = toText(size).toLowerCase();
  return (Array.isArray(product.variants) ? product.variants : []).filter(
    (variant) => toText(variant?.size).toLowerCase() === normalizedSize
  );
};

const buildDirectProductResponse = ({ message = "", intent, products = [], req = null } = {}) => {
  const items = suggestedProducts(products, req);
  if (!items.length || (!intent.product?.asksPrice && !intent.product?.asksAvailability)) return null;

  const topProducts = products.slice(0, 3);
  const sourceIds = items.map((product) => `product_${product.id}`);
  const top = topProducts[0];
  const queryText = productQueryText(message, intent);
  const topScore = productRankScore({ product: top, queryText, intent });
  const secondScore = topProducts[1] ? productRankScore({ product: topProducts[1], queryText, intent }) : 0;
  const hasSingleStrongMatch =
    topProducts.length === 1 ||
    (topScore >= 900 && topScore - secondScore >= 180);

  let answer = "";
  if (intent.product?.asksAvailability) {
    const requestedSize = intent.product?.size || "";
    if (requestedSize && topProducts.length) {
      const lines = topProducts.map((product) => {
        const variants = matchingSizeVariants(product, requestedSize);
        const sizeStock = variants.length
          ? variants.reduce((sum, variant) => sum + Math.max(0, numeric(variant.stock, 0)), 0)
          : 0;
        const status = variants.length ? stockTextAr(sizeStock) : "\u0627\u0644\u0645\u0642\u0627\u0633 \u0645\u0634 \u0645\u0633\u062c\u0644 \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u062f\u064a\u0644";
        return `${product.name}: \u0645\u0642\u0627\u0633 ${requestedSize} - ${status}`;
      });
      answer = `\u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0645\u0642\u0627\u0633 ${requestedSize}:\n${lines.join("\n")}`;
    } else {
      const lines = topProducts.map((product) => `${product.name}: ${stockTextAr(product.total_stock)}${Number(product.total_stock || 0) > 0 ? ` (${Number(product.total_stock).toLocaleString("ar-EG-u-nu-latn")} \u0642\u0637\u0639\u0629)` : ""}`);
      answer = lines.length === 1 ? `${top.name} ${stockTextAr(top.total_stock)}.` : `\u0623\u0647\u0645 \u0627\u0644\u0646\u062a\u0627\u064a\u062c:\n${lines.join("\n")}`;
    }
  } else if (intent.product?.asksPrice) {
    if (hasSingleStrongMatch) {
      answer = `${top.name}: ${formatProductPriceAr(top)}.`;
    } else {
      const lines = topProducts.map((product) => `${product.name}: ${formatProductPriceAr(product)} - ${stockTextAr(product.total_stock)}`);
      answer = `\u062f\u064a \u0623\u0642\u0631\u0628 \u0646\u062a\u0627\u064a\u062c \u0644\u0644\u0633\u0639\u0631:\n${lines.join("\n")}`;
    }
  }

  return {
    answer,
    confidence: 0.95,
    needs_human_support: false,
    sources_used: sourceIds,
    suggested_products: items,
    suggested_actions: ["view_product", "choose_size", "show_similar_products", "contact_support"],
  };
};

const buildProductDiscoveryResponse = ({ intent, products = [], req = null }) => {
  const items = suggestedProducts(products, req);
  if (intent.product?.mentionsImageModel) {
    return {
      answer: "\u0623\u0643\u064a\u062f \u2764\ufe0f \u0627\u0628\u0639\u062a\u0644\u064a \u0635\u0648\u0631\u0629 \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0648\u0623\u0646\u0627 \u0623\u0637\u0644\u0639\u0644\u0643 \u0623\u0642\u0631\u0628 \u062d\u0627\u062c\u0629 \u0639\u0646\u062f\u0646\u0627.",
      confidence: 1,
      needs_human_support: false,
      sources_used: [],
      suggested_products: items,
      suggested_actions: ["show_similar_products"],
    };
  }
  if (items.length) {
    return {
      answer: "\u0623\u0643\u064a\u062f\u060c \u062f\u064a \u0634\u0648\u064a\u0629 \u0645\u0648\u062f\u064a\u0644\u0627\u062a \u0645\u0645\u0643\u0646 \u062a\u0639\u062c\u0628\u0643. \u0648\u0644\u0648 \u0645\u0639\u0627\u0643 \u0635\u0648\u0631\u0629 \u0645\u0648\u062f\u064a\u0644 \u0627\u0628\u0639\u062a\u0647\u0627\u0644\u064a \u0648\u0623\u0646\u0627 \u0623\u0637\u0644\u0639\u0644\u0643 \u0627\u0644\u0623\u0642\u0631\u0628 \u0644\u064a\u0647.",
      confidence: 0.9,
      needs_human_support: false,
      sources_used: items.map((product) => `product_${product.id}`),
      suggested_products: items,
      suggested_actions: ["view_product", "show_similar_products", "choose_size", "contact_support"],
    };
  }
  return {
    answer: "\u0623\u0643\u064a\u062f \u2764\ufe0f \u062a\u062d\u0628 \u0643\u0648\u062a\u0634\u064a \u0631\u062c\u0627\u0644\u064a \u0648\u0644\u0627 \u062d\u0631\u064a\u0645\u064a\u061f \u0648\u0645\u0642\u0627\u0633\u0643 \u0643\u0627\u0645\u061f \u0648\u0644\u0648 \u0645\u0639\u0627\u0643 \u0635\u0648\u0631\u0629 \u0645\u0648\u062f\u064a\u0644 \u0627\u0628\u0639\u062a\u0647\u0627\u0644\u064a \u0648\u0623\u0637\u0644\u0639\u0644\u0643 \u0627\u0644\u0623\u0642\u0631\u0628.",
    confidence: 0.8,
    needs_human_support: false,
    sources_used: [],
    suggested_products: [],
    suggested_actions: ["show_similar_products", "choose_size"],
  };
};

export const buildAiSupportTrustedContext = async ({ tenantId, message, req = null } = {}) => {
  const intent = detectAiSupportIntent(message);

  if (intent.type === "conversational") {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      unknown_product_terms: [],
      fallbackReason: "",
      directResponse: await buildDirectConversationalResponse({ tenantId, intent, message }),
    };
  }

  if (!tenantId) {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      unknown_product_terms: [],
      fallbackReason: "missing_tenant",
    };
  }

  if (intent.type === "internal_data") {
    const internalAnswer = isArabicText(message)
      ? "\u0645\u0634 \u0647\u0642\u062f\u0631 \u0623\u0634\u0627\u0631\u0643 \u0628\u064a\u0627\u0646\u0627\u062a \u062f\u0627\u062e\u0644\u064a\u0629 \u0632\u064a \u0633\u0639\u0631 \u0627\u0644\u062a\u0643\u0644\u0641\u0629 \u0623\u0648 \u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646. \u0623\u0642\u062f\u0631 \u0623\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u060c \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a\u060c \u0623\u0648 \u0627\u0644\u062a\u0648\u0641\u0631."
      : "I cannot share internal ERP, admin, supplier, cost, margin, credential, or private data. I can help with public prices, sizes, availability, and store policies.";
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      unknown_product_terms: [],
      fallbackReason: "internal_data_request",
      directResponse: {
        answer: internalAnswer,
        confidence: 1,
        needs_human_support: false,
        sources_used: [],
        suggested_products: [],
        suggested_actions: ["contact_support"],
      },
    };
  }

  if (intent.type === "human_support") {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      unknown_product_terms: [],
      fallbackReason: "human_support_requested",
      directResponse: {
        answer: isArabicText(message)
          ? "\u062d\u0627\u0636\u0631 \u2764\ufe0f \u0647\u0648\u0635\u0644\u0643 \u0628\u0627\u0644\u062f\u0639\u0645. \u0627\u0628\u0639\u062a\u0644\u0646\u0627 \u0631\u0642\u0645\u0643 \u0623\u0648 \u0643\u0644\u0645\u0646\u0627 \u0639\u0644\u0649 \u0648\u0627\u062a\u0633\u0627\u0628."
          : "Sure, I can connect you with support. Please send your phone number or contact us on WhatsApp.",
        confidence: 1,
        needs_human_support: true,
        sources_used: [],
        suggested_products: [],
        suggested_actions: ["contact_support"],
      },
    };
  }

  const sources = [];
  let products = [];
  let fallbackReason = "";
  let unknownProductTerms = [];

  if (intent.type === "product" || intent.type === "product_discovery" || intent.type === "general") {
    products = await searchProducts({ tenantId, message, intent, req });
    sources.push(...products.map(sourceFromProduct));
    const directProductResponse = buildDirectProductResponse({ message, intent, products, req });
    if (directProductResponse) {
      return {
        intent,
        trustedContext: {
          tenant_id: tenantId,
          context_version: "phase_2_real_storefront_product_context",
          sources,
        },
        source_previews: sources.map((source) => ({
          id: source.id,
          title: source.title,
          preview: source.preview || safeJsonParse(source.content) || source.content,
        })),
        suggested_products: suggestedProducts(products, req),
        suggested_actions: directProductResponse.suggested_actions,
        unknown_product_terms: [],
        fallbackReason: "",
        directResponse: directProductResponse,
      };
    }
    if (intent.type === "product_discovery") {
      return {
        intent,
        trustedContext: {
          tenant_id: tenantId,
          context_version: "phase_2_real_storefront_product_context",
          sources,
        },
        source_previews: sources.map((source) => ({
          id: source.id,
          title: source.title,
          preview: source.preview || safeJsonParse(source.content) || source.content,
        })),
        suggested_products: suggestedProducts(products, req),
        suggested_actions: products.length ? ["view_product", "show_similar_products", "choose_size", "contact_support"] : ["show_similar_products", "choose_size"],
        unknown_product_terms: products.length ? [] : normalizeSearchTerms(message, intent),
        fallbackReason: products.length ? "" : "product_discovery_needs_clarification",
        directResponse: buildProductDiscoveryResponse({ intent, products, req }),
      };
    }
    if ((intent.type === "product" || intent.product.asksSimilar) && products.length === 0) {
      fallbackReason = "no_matching_products";
      unknownProductTerms = normalizeSearchTerms(message, intent);
    }
  }

  if (intent.type === "store_policy" || intent.type === "general") {
    const storeSources = await loadStoreKnowledge({ tenantId });
    sources.push(...storeSources);
    if (!sources.length && !fallbackReason) fallbackReason = "no_store_context";
  }

  const sourcePreviews = sources.map((source) => ({
    id: source.id,
    title: source.title,
    preview: source.preview || safeJsonParse(source.content) || source.content,
  }));
  const suggestedActions = products.length
    ? ["view_product", "contact_support"]
    : sources.length
      ? ["contact_support"]
      : ["contact_support"];
  const directStoreResponse = intent.type === "store_policy"
    ? buildDirectStoreResponse({ message, sources, suggestedActions })
    : null;

  return {
    intent,
    trustedContext: {
      tenant_id: tenantId,
      context_version: "phase_2_real_storefront_product_context",
      sources,
    },
    source_previews: sourcePreviews,
    suggested_products: suggestedProducts(products, req),
    suggested_actions: suggestedActions,
    unknown_product_terms: unknownProductTerms,
    fallbackReason: sources.length ? "" : fallbackReason || "no_trusted_context",
    directResponse: directStoreResponse || undefined,
  };
};

export const buildAiSupportProductSearchDebug = async ({ tenantId, query, req = null } = {}) => {
  const message = toText(query);
  const intent = detectAiSupportIntent(message);
  const products = tenantId ? await searchProducts({ tenantId, message, intent, req }) : [];
  const directProductResponse = buildDirectProductResponse({ message, intent, products, req });
  const directDiscoveryResponse =
    intent.type === "product_discovery" ? buildProductDiscoveryResponse({ intent, products, req }) : null;
  const exactAnswer = directProductResponse?.answer || directDiscoveryResponse?.answer || "";

  return {
    tenant_id: tenantId,
    query: message,
    detected_intent: intent,
    matched_products: products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku || "",
      raw_image_fields: imageDebugFields(product),
      variant_images_count: (Array.isArray(product.variants) ? product.variants : []).filter((variant) =>
        Boolean(variant?.image_url || variant?.primary_image_url || variant?.variant_image_url || variant?.color_image_url)
      ).length,
      selected_image_field: product.selected_image_field || "",
      selected_image_source: compactImageDebugValue(product.selected_image_source || ""),
      image_url: resolveSuggestedProductImageUrl(product, req),
      raw_price: product.price,
      raw_sale_price: product.sale_price,
      final_price: productBestPrice(product),
      stock: product.total_stock,
      stock_status: Number(product.total_stock || 0) > 0 ? "in_stock" : "out_of_stock",
      availability: product.availability,
      product_url: `/shop/product/${product.id}`,
    })),
    suggested_products: suggestedProducts(products, req),
    exact_answer: exactAnswer,
    would_use_direct_response: Boolean(directProductResponse || directDiscoveryResponse),
    fallback_reason: products.length ? "" : "no_matching_products",
  };
};
