import db from "../database/db.js";
import { getWebsiteSettings } from "./liveActivityService.js";
import {
  attachVariantImages,
  loadProductVariantImages,
} from "./productVariantImagesService.js";
import {
  buildProductIntelligenceProfile,
  detectStyleIntent,
  detectShoppingIntelligenceIntent,
  findByAlias,
  getProductIntelligence,
  getRandomPersonalityLine,
  getRandomSellingPoint,
  getVisualStyleTags,
  buildInventoryProfile,
  rankProductsByInventorySalesStrategy,
  rankProductsForStyle,
  rankProductsBySalesIntelligence,
} from "./productIntelligenceService.js";
import {
  buildAiMemoryContextSource,
  extractAiConversationMemory,
  loadAiConversationMemory,
  resolveAiConversationIdentity,
} from "./aiConversationMemoryService.js";
import { normalizeSaleModeSettings, resolveSaleModePrice } from "./saleModeService.js";
import {
  availableProductSizes,
  debugProductColorExpansion,
  resolveProductImageFromRecord,
  resolvePublicProductUrl,
} from "./aiProductCards.js";
import {
  aiProductSqlExclusionClause,
  filterAiEligibleProducts,
} from "./aiProductEligibilityService.js";
import {
  NO_RANDOM_PRODUCT_FALLBACK,
  detectSalesProductUnderstanding,
  gateRelevantProducts,
  relevanceExplanationAr,
} from "./aiSalesOrchestratorService.js";
import { findSimilarProductsForAi } from "./aiSimilarProductsService.js";

const PRODUCT_LIMIT = 18;
const IMAGE_SEARCH_PRODUCT_LIMIT = Number(process.env.AI_IMAGE_SEARCH_PRODUCT_LIMIT || 300);
const VARIANT_LIMIT = 12;
const SOURCE_TEXT_LIMIT = 4_000;
const DEBUG_PRODUCT_CONTEXT =
  process.env.AI_SUPPORT_DEBUG === "1";
const VISUAL_DEBUG =
  ["1", "true", "yes", "on"].includes(String(process.env.VISUAL_DEBUG || "").trim().toLowerCase());
const PRODUCT_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='18' fill='%23f5f5f4'/%3E%3Cpath d='M25 63l13-15 10 10 8-9 15 14H25z' fill='%23d6d3d1'/%3E%3Ccircle cx='37' cy='35' r='7' fill='%23d6d3d1'/%3E%3C/svg%3E";
const MODEL_INTENT_CONFIDENCE_THRESHOLD = Number(process.env.AI_PRODUCT_MODEL_MATCH_THRESHOLD || 0.72);
const MODEL_NOT_AVAILABLE_REPLY = NO_RANDOM_PRODUCT_FALLBACK;
const modelUnavailableReply = () => MODEL_NOT_AVAILABLE_REPLY;

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
  "slipper",
  "slippers",
  "sandal",
  "sandals",
  "bag",
  "bags",
  "accessory",
  "accessories",
  "model",
  "models",
  "jordan",
  "\u0643\u0648\u062a\u0634\u064a",
  "\u0643\u0648\u062a\u0634\u064a\u0627\u062a",
  "\u062c\u0632\u0645\u0629",
  "\u062c\u0632\u0645\u0647",
  "\u0633\u0646\u064a\u0643\u0631\u0632",
  "\u0634\u0648\u0632",
  "\u0634\u0628\u0634\u0628",
  "\u0634\u0628\u0627\u0634\u0628",
  "\u0635\u0646\u062f\u0644",
  "\u0635\u0646\u0627\u062f\u0644",
  "\u0634\u0646\u0637\u0629",
  "\u0634\u0646\u0637",
  "\u0627\u0643\u0633\u0633\u0648\u0627\u0631",
  "\u0627\u0643\u0633\u0633\u0648\u0627\u0631\u0627\u062a",
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
  "slipper",
  "slippers",
  "sandal",
  "sandals",
  "bag",
  "bags",
  "accessory",
  "accessories",
  "model",
  "models",
  "\u0643\u0648\u062a\u0634\u064a",
  "\u0643\u0648\u062a\u0634\u064a\u0627\u062a",
  "\u062c\u0632\u0645\u0629",
  "\u062c\u0632\u0645\u0647",
  "\u0633\u0646\u064a\u0643\u0631\u0632",
  "\u0634\u0648\u0632",
  "\u0634\u0628\u0634\u0628",
  "\u0634\u0628\u0627\u0634\u0628",
  "\u0635\u0646\u062f\u0644",
  "\u0635\u0646\u0627\u062f\u0644",
  "\u0634\u0646\u0637\u0629",
  "\u0634\u0646\u0637",
  "\u0627\u0643\u0633\u0633\u0648\u0627\u0631",
  "\u0627\u0643\u0633\u0633\u0648\u0627\u0631\u0627\u062a",
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

const COLOR_ALIAS_GROUPS = Object.freeze({
  black: ["black", "\u0627\u0633\u0648\u062f", "\u0623\u0633\u0648\u062f", "\u0633\u0648\u062f\u0627", "\u0633\u0648\u062f\u0627\u0621", "ط§ط³ظˆط¯", "ط£ط³ظˆط¯"],
  white: ["white", "off white", "off-white", "\u0627\u0628\u064a\u0636", "\u0623\u0628\u064a\u0636", "\u0627\u0648\u0641 \u0648\u0627\u064a\u062a", "ط§ط¨ظٹط¶", "ط£ط¨ظٹط¶"],
  red: ["red", "\u0627\u062d\u0645\u0631", "\u0623\u062d\u0645\u0631", "ط§ط­ظ…ط±", "ط£ط­ظ…ط±"],
  blue: ["blue", "\u0627\u0632\u0631\u0642", "\u0623\u0632\u0631\u0642", "ط§ط²ط±ظ‚", "ط£ط²ط±ظ‚"],
  navy: ["navy", "\u0643\u062d\u0644\u064a", "\u0643\u062d\u0644\u0649", "\u0646\u0627\u0641\u064a"],
  green: ["green", "\u0627\u062e\u0636\u0631", "\u0623\u062e\u0636\u0631", "ط§ط®ط¶ط±", "ط£ط®ط¶ط±"],
  olive: ["olive", "\u0632\u064a\u062a\u064a", "\u0632\u064a\u062a\u0649"],
  beige: ["beige", "cream", "tan", "\u0628\u064a\u062c", "\u0643\u0631\u064a\u0645", "ط¨ظٹط¬"],
  brown: ["brown", "\u0628\u0646\u064a", "\u0628\u0646\u0649", "ط¨ظ†ظٹ"],
  gray: ["gray", "grey", "silver", "\u0631\u0645\u0627\u062f\u064a", "\u0631\u0645\u0627\u062f\u0649", "\u0631\u0635\u0627\u0635\u064a", "\u0641\u0636\u064a", "ط±ظ…ط§ط¯ظٹ", "ظپط¶ظٹ"],
  yellow: ["yellow", "gold", "\u0627\u0635\u0641\u0631", "\u0623\u0635\u0641\u0631", "\u0630\u0647\u0628\u064a", "ط°ظ‡ط¨ظٹ"],
  pink: ["pink", "\u0628\u064a\u0646\u0643", "\u0648\u0631\u062f\u064a"],
  purple: ["purple", "violet", "\u0645\u0648\u0641", "\u0628\u0646\u0641\u0633\u062c\u064a"],
  orange: ["orange", "\u0628\u0631\u062a\u0642\u0627\u0644\u064a"],
  havan: ["havan", "havana", "camel", "\u0647\u0627\u0641\u0627\u0646", "\u0647\u0627\u0641\u0627\u0646\u0627", "\u062c\u0645\u0644\u064a"],
});

const SIZE_PATTERN = /\b(3[0-9]|4[0-9]|5[0-5]|xs|s|m|l|xl|xxl|xxxl|small|medium|large|one size)\b/i;
const CODE_PATTERN = /\b[A-Z0-9][A-Z0-9._-]{2,}\b/gi;

const columnCache = new Map();

const toText = (value, fallback = "") => String(value ?? fallback).trim();

const isArabicText = (value = "") => /[\u0600-\u06ff]/.test(toText(value));

const isPrimarilyEnglishText = (value = "") => {
  const text = toText(value);
  if (!text || isArabicText(text)) return false;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  const arabicChars = (text.match(/[\u0600-\u06ff]/g) || []).length;
  return latinChars >= 3 && latinChars > arabicChars * 2;
};

const shouldReplyInArabic = (message = "") => !isPrimarilyEnglishText(message);

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

const normalizeStorefrontPricingSettings = (settings = {}) => ({
  enable_fake_compare_price: settings.enable_fake_compare_price !== false,
  fake_compare_percent: Math.max(0, Math.min(500, money(settings.fake_compare_percent || 20))),
  fake_compare_rounding_mode: ["none", "nearest_10", "nearest_50", "nearest_100"].includes(settings.fake_compare_rounding_mode)
    ? settings.fake_compare_rounding_mode
    : "none",
  ...normalizeSaleModeSettings(settings),
});

const roundAiMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const roundAiComparePrice = (value, mode = "none") => {
  const step = mode === "nearest_10" ? 10 : mode === "nearest_50" ? 50 : mode === "nearest_100" ? 100 : 0;
  return roundAiMoney(step > 0 ? Math.round(Number(value || 0) / step) * step : value);
};
const aiComparePriceFor = (sellingPrice, product = {}, settings = {}) => {
  const pricing = normalizeStorefrontPricingSettings(settings);
  const selling = roundAiMoney(sellingPrice);
  const useCustom = product.use_custom_compare_price === true || String(product.use_custom_compare_price || "").toLowerCase() === "true";
  const custom = roundAiMoney(product.custom_compare_price);
  if (useCustom && custom > selling) return custom;
  if (!pricing.enable_fake_compare_price || selling <= 0) return 0;
  const compare = roundAiComparePrice(selling * (1 + pricing.fake_compare_percent / 100), pricing.fake_compare_rounding_mode);
  return compare > selling ? compare : 0;
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

const resolveStorefrontProductImageUrl = (value) => {
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
  const publicImageUrl = resolveProductImageFromRecord(product);
  if (publicImageUrl) return publicImageUrl;
  const matchedImage = product.matched_variant_image || product.matched_visual_candidate?.image_url || product.matched_image_url || "";
  if (matchedImage) return resolveStorefrontProductImageUrl(matchedImage, req) || PRODUCT_IMAGE_PLACEHOLDER;
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
const escapeRegex = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const isGreetingOnlyMessage = (message = "") => {
  const normalized = normalizeConversationalText(message);
  if (!normalized || normalized.length > 80) return false;
  const greetingPatterns = (CONVERSATIONAL_PATTERNS.greeting || []).map(normalizeConversationalText).filter(Boolean);
  const exactGreeting = greetingPatterns.includes(normalized);
  if (exactGreeting) return true;
  if (hasAnyTerm(message, [...PRODUCT_INTENT_TERMS, ...STORE_INTENT_TERMS, ...INTERNAL_INTENT_TERMS, ...SHOPPING_REQUEST_TERMS])) return false;
  if (unique(toText(message).match(CODE_PATTERN) || []).length) return false;
  if (SIZE_PATTERN.test(message)) return false;
  return greetingPatterns.some((pattern) => {
    if (!pattern || !normalized.includes(pattern)) return false;
    const remainingWords = normalized
      .replace(pattern, " ")
      .split(/\s+/)
      .filter(Boolean);
    return remainingWords.length <= 2 && remainingWords.every((word) => CONVERSATIONAL_FILLER_TERMS.has(word));
  });
};

export const detectAiSupportIntent = (message = "") => {
  const text = toText(message);
  if (isGreetingOnlyMessage(text)) {
    return {
      type: "greeting_only",
      greeting_only_mode: true,
      personalization_blocked: true,
      conversational: {
        subtype: "greeting",
      },
      product: {
        codes: [],
        colors: [],
        size: "",
        asksSimilar: false,
        asksAvailability: false,
        asksPrice: false,
        discovery: false,
        mentionsImageModel: false,
        intelligence: {
          hasIntent: false,
          style: { hasIntent: false },
          alias_matches: [],
        },
      },
    };
  }
  const codes = unique(text.match(CODE_PATTERN) || []).slice(0, 5);
  const colors = detectRequestedColors(text);
  const sizeMatch = text.match(SIZE_PATTERN);
  const intelligenceIntent = detectShoppingIntelligenceIntent(text);
  const styleIntent = detectStyleIntent(text);
  const aliasMatches = findByAlias(text);
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
      intelligenceIntent.hasIntent ||
      aliasMatches.length > 0 ||
      mentionsProductDiscovery ||
      (hasShoppingRequest && (colors.length > 0 || Boolean(sizeMatch) || asksSimilar || asksAvailability)) ||
      (hasShoppingRequest && text.length <= 80));
  const isProduct = isInternal
    ? false
    : hasAnyTerm(text, PRODUCT_INTENT_TERMS) || aliasMatches.length > 0 || codes.length > 0 || colors.length > 0 || Boolean(sizeMatch);

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
      intelligence: {
        ...intelligenceIntent,
        style: styleIntent,
        alias_matches: aliasMatches.map((entry) => entry.canonical_name),
      },
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
  if (includeActiveFilters || includeVisibilityFilters) {
    clauses.push(aiProductSqlExclusionClause("p", productColumns));
    filters.push("ai_product_filter: real active storefront products only");
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
    "brand",
    "brand_name",
    "vendor",
    "manufacturer",
    "category",
    "category_name",
    "product_type",
    "type",
    "style",
    "silhouette",
    "grade",
    "gender",
    "audience",
    "target_audience",
    "tags",
    "seo_keywords",
    "keywords",
  ]);
  const variantSearchFields = columnList("pvx", variantColumns, ["sku", "barcode", "color", "color_name", "color_hex", "color_value", "size", "image_url", "image", "photo_url", "thumbnail_url"]);
  const variantExactFields = columnList("pvc", variantColumns, ["sku", "barcode"]);

  for (const term of terms.slice(0, 12)) {
    const likeParam = add(`%${term}%`);
    for (const field of productSearchFields) searchClauses.push(`${field}::text ILIKE ${likeParam}`);
    if (variantSearchFields.length) {
      searchClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pvx WHERE pvx.product_id = p.id ${variantTenantClause(variantColumns, "pvx")} AND (${variantSearchFields
          .map((field) => `${field}::text ILIKE ${likeParam}`)
          .join(" OR ")}))`
      );
    }
    searchClauses.push(
      `EXISTS (SELECT 1 FROM product_variant_images pvix WHERE pvix.product_id = p.id AND (pvix.color_name ILIKE ${likeParam} OR pvix.color_value ILIKE ${likeParam} OR pvix.image_url ILIKE ${likeParam}))`
    );
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
  const normalizedMessage = normalizeProductMatchText(message);
  const modelIntent = detectStrictModelIntent(message);
  const aliasTerms = findByAlias(message).flatMap((entry) => [entry.canonical_name, ...entry.canonical_name.split(/\s+/)]);
  const styleTerms = intent.product?.intelligence?.style?.search_terms || [];
  const kindTerm = detectRequestedProductKind(message)?.kind || "";
  const words = normalizedMessage
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
  return unique(expandColorSearchTerms([
    ...intent.product.codes,
    ...intent.product.colors,
    intent.product.size,
    kindTerm,
    ...aliasTerms,
    ...styleTerms,
    ...(modelIntent?.searchTerms || []),
    ...words,
  ])).slice(0, 32);
};

const normalizeProductMatchText = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
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
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/\b\u0646\u0627\u064a\u0643\b/g, "nike")
    .replace(/\b\u0641\u0648\u0631\b/g, "4")
    .replace(/\b\u0627\u0631\u0628\u0639\u0647\b/g, "4")
    .replace(/\b\u0631\u0627\u0628\u0639\u0647\b/g, "4")
    .replace(/\b\u0627\u062f\u064a\u062f\u0627\u0633\b/g, "adidas")
    .replace(/\b\u062c\u0648\u0631\u062f\u0646\b/g, "jordan")
    .replace(/\b\u0634\u0648\u0643\u0633(?:\u0627\u062a)?\b/g, "shox")
    .replace(/\b\u0645\u064a\u0631\u0648\u0631\b/g, "mirror")
    .replace(/\b\u0645\u064a\u0631\u0648\b/g, "mirror")
    .replace(/\b\u0627\u064a\u0631\s*\u0641\u0648\u0631\u0633\b/g, "air force")
    .replace(/\b\u062f\u0627\u0646\u0643\b/g, "dunk")
    .replace(/\b\u064a\u064a\u0632\u064a\b/g, "yeezy")
    .replace(/\b\u0643\u0627\u0645\u0628\u0633\b/g, "campus")
    .replace(/\b\u0633\u0627\u0645\u0628\u0627\b/g, "samba")
    .replace(/\bنايك\b/g, "nike")
    .replace(/\bفور\b/g, "4")
    .replace(/\bاربعه\b/g, "4")
    .replace(/\bرابعه\b/g, "4")
    .replace(/\bjordan\s*iv\b/g, "jordan 4")
    .replace(/\bair\s+jordan\s*iv\b/g, "air jordan 4")
    .replace(/\baj\s*4\b/g, "aj4")
    .replace(/\bj\s*4\b/g, "j4")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeColorText = (value = "") => normalizeProductMatchText(value).replace(/\bgrey\b/g, "gray");

const colorAliasEntries = () =>
  Object.entries(COLOR_ALIAS_GROUPS).flatMap(([canonical, aliases]) =>
    [canonical, ...aliases].map((alias) => ({
      canonical,
      alias,
      normalized: normalizeColorText(alias),
    }))
  );

const canonicalColor = (value = "") => {
  const normalized = normalizeColorText(value);
  if (!normalized) return "";
  const exact = colorAliasEntries().find((entry) => entry.normalized === normalized);
  if (exact) return exact.canonical;
  const partial = colorAliasEntries().find((entry) => entry.normalized && normalized.includes(entry.normalized));
  return partial?.canonical || normalized;
};

const colorAliasesFor = (value = "") => {
  const canonical = canonicalColor(value);
  return unique([canonical, ...(COLOR_ALIAS_GROUPS[canonical] || [value])].filter(Boolean));
};

const detectRequestedColors = (message = "") => {
  const normalized = normalizeColorText(message);
  if (!normalized) return [];
  const matches = colorAliasEntries()
    .filter((entry) => entry.normalized && new RegExp(`(^|\\s)${entry.normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(normalized))
    .map((entry) => entry.canonical);
  const legacyMatches = COLOR_TERMS.filter((color) => toText(message).toLowerCase().includes(color.toLowerCase())).map(canonicalColor);
  return unique([...matches, ...legacyMatches]).slice(0, 4);
};

const expandColorSearchTerms = (terms = []) =>
  unique(
    terms.flatMap((term) => {
      const aliases = colorAliasesFor(term);
      return aliases.length > 1 ? aliases : [term];
    })
  );

const PRODUCT_KIND_MATCHERS = [
  {
    kind: "slippers",
    request: /\b(slipper|slippers|slide|slides)\b|\u0634\u0628\u0634\u0628|\u0634\u0628\u0627\u0634\u0628/i,
    catalog: /\b(slipper|slippers|slide|slides)\b|\u0634\u0628\u0634\u0628|\u0634\u0628\u0627\u0634\u0628/i,
  },
  {
    kind: "sandals",
    request: /\b(sandal|sandals)\b|\u0635\u0646\u062f\u0644|\u0635\u0646\u0627\u062f\u0644/i,
    catalog: /\b(sandal|sandals)\b|\u0635\u0646\u062f\u0644|\u0635\u0646\u0627\u062f\u0644/i,
  },
  {
    kind: "bags",
    request: /\b(bag|bags|backpack|purse|handbag)\b|\u0634\u0646\u0637\u0629|\u0634\u0646\u0637/i,
    catalog: /\b(bag|bags|backpack|purse|handbag)\b|\u0634\u0646\u0637\u0629|\u0634\u0646\u0637/i,
  },
  {
    kind: "accessories",
    request: /\b(accessory|accessories)\b|\u0627\u0643\u0633\u0633\u0648\u0627\u0631|\u0627\u0643\u0633\u0633\u0648\u0627\u0631\u0627\u062a/i,
    catalog: /\b(accessory|accessories)\b|\u0627\u0643\u0633\u0633\u0648\u0627\u0631|\u0627\u0643\u0633\u0633\u0648\u0627\u0631\u0627\u062a/i,
  },
  {
    kind: "running",
    request: /\b(running|runner|training)\b|\u062c\u0631\u064a|\u0631\u0646\u064a\u0646\u062c|\u0631\u064a/i,
    catalog: /\b(running|runner|training)\b|\u062c\u0631\u064a|\u0631\u0646\u064a\u0646\u062c|\u0631\u064a/i,
  },
  {
    kind: "sneakers",
    request: /\b(shoe|shoes|sneaker|sneakers|trainer|trainers|footwear)\b|\u0643\u0648\u062a\u0634\u064a|\u0643\u0648\u062a\u0634\u064a\u0627\u062a|\u062c\u0632\u0645\u0629|\u062c\u0632\u0645\u0647|\u0633\u0646\u064a\u0643\u0631\u0632|\u0634\u0648\u0632/i,
    catalog: /\b(shoe|shoes|sneaker|sneakers|trainer|trainers|footwear)\b|\u0643\u0648\u062a\u0634\u064a|\u0643\u0648\u062a\u0634\u064a\u0627\u062a|\u062c\u0632\u0645\u0629|\u062c\u0632\u0645\u0647|\u0633\u0646\u064a\u0643\u0631\u0632|\u0634\u0648\u0632/i,
  },
];

const detectRequestedProductKind = (message = "") => {
  const text = toText(message);
  return PRODUCT_KIND_MATCHERS.find((entry) => entry.request.test(text)) || null;
};

const productQueryText = (message = "", intent = {}) => {
  const terms = normalizeSearchTerms(message, intent)
    .filter((term) => !intent.product?.colors?.includes(term))
    .filter((term) => term !== intent.product?.size);
  return normalizeProductMatchText(terms.join(" "));
};

const productBestPrice = (product = {}, pricingSettings = {}) => {
  const directSale = money(product.sale_price);
  const directPrice = money(product.regular_price || product.price);
  const saleEnabled = product.sale_price_enabled === true || String(product.sale_price_enabled || "").toLowerCase() === "true";
  const resolved = resolveSaleModePrice({
    ...product,
    regular_price: directPrice,
    price: directPrice,
    sale_price: directSale,
    sale_price_enabled: saleEnabled,
  }, pricingSettings);
  if (resolved.final_price > 0 && directPrice > 0) return resolved.final_price;
  if (directPrice > 0) return directPrice;
  const variantPrices = (Array.isArray(product.variants) ? product.variants : [])
    .flatMap((variant) => {
      const regular = money(variant?.regular_price || variant?.price);
      const sale = money(variant?.sale_price);
      const variantSaleEnabled = variant?.sale_price_enabled === true || String(variant?.sale_price_enabled || "").toLowerCase() === "true";
      const variantResolved = resolveSaleModePrice({
        ...product,
        ...variant,
        id: product.id,
        product_id: product.id,
        regular_price: regular,
        price: regular,
        sale_price: sale,
        sale_price_enabled: variantSaleEnabled,
      }, pricingSettings);
      return [variantResolved.final_price > 0 && regular > 0 ? variantResolved.final_price : null, regular];
    })
    .filter((value) => value > 0);
  return variantPrices.length ? Math.min(...variantPrices) : null;
};

const requestedColor = ({ intent = {}, message = "" } = {}) => canonicalColor(intent.product?.colors?.[0] || detectRequestedColors(message)[0] || "");

const requestedSize = ({ intent = {}, memory = null } = {}) => toText(intent.product?.size || memory?.preferences?.size || "").toUpperCase();

const variantColorText = (variant = {}) =>
  [variant.color, variant.color_name, variant.color_value, variant.color_hex, variant.sku, variant.barcode, variant.image_url, variant.variant_image_url, variant.color_image_url, ...(Array.isArray(variant.images) ? variant.images.map((image) => [image?.color_name, image?.color_value, image?.image_url].filter(Boolean).join(" ")) : [])]
    .filter(Boolean)
    .join(" ");

const variantColorMatchScore = (variant = {}, color = "") => {
  const canonical = canonicalColor(color);
  if (!canonical) return 0;
  const directColor = canonicalColor([variant.color, variant.color_name, variant.color_value].filter(Boolean).join(" "));
  if (directColor === canonical) return 100;
  const blob = normalizeColorText(variantColorText(variant));
  const aliases = colorAliasesFor(canonical).map(normalizeColorText).filter(Boolean);
  if (aliases.some((alias) => new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(blob))) return 88;
  if (aliases.some((alias) => blob.includes(alias))) return 72;
  return 0;
};

const variantSizeMatchScore = (variant = {}, size = "") => {
  const wanted = toText(size).toUpperCase();
  if (!wanted) return 0;
  const actual = toText(variant.size).toUpperCase();
  if (actual === wanted) return 100;
  if (actual && normalizeProductMatchText(actual) === normalizeProductMatchText(wanted)) return 96;
  if (actual && actual.includes(wanted)) return 60;
  return 0;
};

const annotateProductVariantMatch = ({ product = {}, intent = {}, message = "", memory = null } = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const color = requestedColor({ intent, message });
  const size = requestedSize({ intent, memory });
  const wantsVariantConstraint = Boolean(color || size);
  let best = null;

  for (const variant of variants) {
    const colorScore = variantColorMatchScore(variant, color);
    const sizeScore = variantSizeMatchScore(variant, size);
    const inStock = numeric(variant.stock, 0) > 0;
    let score = 0;
    if (color) score += colorScore * 12;
    if (size) score += sizeScore * 14;
    if (inStock) score += 420;
    if (firstImageValue(variant.primary_image_url, variant.image_url, variant.variant_image_url, variant.color_image_url, variant.images)) score += 70;
    if (wantsVariantConstraint && color && colorScore <= 0) score -= 900;
    if (wantsVariantConstraint && size && sizeScore <= 0) score -= 950;
    const candidate = { variant, score, colorScore, sizeScore, inStock };
    if (!best || candidate.score > best.score) best = candidate;
  }

  const matched = best?.variant || null;
  const exactColor = !color || (best?.colorScore || 0) >= 88;
  const exactSize = !size || (best?.sizeScore || 0) >= 96;
  const exactAvailable = Boolean(matched && best.inStock && exactColor && exactSize);
  const matchedImage = firstImageValue(matched?.primary_image_url, matched?.image_url, matched?.variant_image_url, matched?.color_image_url, matched?.images);
  const reasonParts = [];
  if (color) reasonParts.push(best?.colorScore ? `color:${best.colorScore}` : "color:missing");
  if (size) reasonParts.push(best?.sizeScore ? `size:${best.sizeScore}` : "size:missing");
  reasonParts.push(best?.inStock ? "stock:in" : "stock:out_or_missing");

  return {
    ...product,
    requested_color: color,
    requested_size: size,
    matched_variant_id: matched?.id ?? null,
    matched_variant_color: matched?.color || matched?.color_name || "",
    matched_variant_size: matched?.size || "",
    matched_variant_image: matchedImage || "",
    matched_image_url: matchedImage || product.matched_image_url || "",
    matched_image_source: matchedImage ? "matched_variant" : product.matched_image_source || "",
    variant_match_reason: wantsVariantConstraint ? reasonParts.join(";") : "",
    searched_variants_count: variants.length,
    color_match_score: best?.colorScore || 0,
    size_match_score: best?.sizeScore || 0,
    exact_variant_available: wantsVariantConstraint ? exactAvailable : Number(product.total_stock || 0) > 0,
    variant_match_rank_score: wantsVariantConstraint ? (best?.score || -1_500) : 0,
  };
};

const normalizeAudienceValue = (value = "") => {
  const text = normalizeProductMatchText(value);
  if (!text) return "";
  if (/\b(women|woman|female|ladies|girls|girl)\b|\u062d\u0631\u064a\u0645\u064a|\u0628\u0646\u0627\u062a\u064a/.test(text)) return text.includes("girl") || text.includes("\u0628\u0646\u0627\u062a") ? "girls" : "women";
  if (/\b(kids|kid|children|child|boys|boy|youth|gs)\b|\u0627\u0637\u0641\u0627\u0644|\u0648\u0644\u0627\u062f\u064a/.test(text)) return text.includes("girl") || text.includes("\u0628\u0646\u0627\u062a") ? "girls" : "kids";
  if (/\b(men|man|male|mens)\b|\u0631\u062c\u0627\u0644\u064a/.test(text)) return "men";
  if (/\b(unisex|all gender)\b|\u064a\u0648\u0646\u064a\u0633\u0643\u0633/.test(text)) return "unisex";
  return text;
};

const productSearchBlob = (product = {}) =>
  normalizeProductMatchText([
    getProductIntelligence(product).canonical_name,
    ...getProductIntelligence(product).aliases,
    ...getProductIntelligence(product).styles,
    ...getProductIntelligence(product).occasions,
    product.name,
    product.sku,
    product.barcode,
    product.brand,
    product.brand_name,
    product.product_type,
    product.category,
    product.category_name,
    product.gender,
    product.style,
    product.grade,
    product.tags,
    product.seo_keywords,
    product.keywords,
    ...(Array.isArray(product.colors) ? product.colors : []),
    ...(Array.isArray(product.product_images) ? product.product_images.map((image) => firstImageValue(image)) : []),
    ...(Array.isArray(product.gallery_images) ? product.gallery_images.map((image) => firstImageValue(image)) : []),
    ...(Array.isArray(product.variants)
      ? product.variants.flatMap((variant) => [
          variant?.color,
          variant?.color_name,
          variant?.color_value,
          variant?.color_hex,
          variant?.size,
          variant?.sku,
          variant?.barcode,
          variant?.image_url,
          variant?.variant_image_url,
          variant?.color_image_url,
          ...(Array.isArray(variant?.images) ? variant.images.map((image) => [image?.color_name, image?.color_value, image?.image_url].filter(Boolean).join(" ")) : []),
        ])
      : []),
  ].filter(Boolean).join(" "));

const visualTokens = (...items) =>
  uniqueSearchParts(items)
    .flatMap((item) => normalizeProductMatchText(item).split(/\s+/))
    .filter((token) => token.length >= 2 && !BROAD_PRODUCT_DISCOVERY_TERMS.includes(token));

const normalizeModelAliases = (items = []) => {
  const text = normalizeProductMatchText(uniqueSearchParts(items).join(" "));
  const aliases = [];
  const add = (...values) => values.forEach((value) => {
    const normalized = normalizeProductMatchText(value);
    if (normalized) aliases.push(normalized);
  });

  if (/\bjordan\b/.test(text) && /\b4\b|iv\b/.test(text)) add("air jordan 4", "jordan 4", "aj4");
  if (/\baj4\b|\bj4\b/.test(text)) add("air jordan 4", "jordan 4", "aj4", "j4");
  if (/\bair jordan iv\b|\bjordan iv\b/.test(text)) add("air jordan 4", "jordan 4", "aj4", "j4");
  if (/\bjordan\b/.test(text) && /\b1\b|i\b/.test(text)) add("air jordan 1", "jordan 1", "aj1");
  if (/\bshox\b/.test(text)) add("nike shox", "shox");
  if (/\badidas\b/.test(text) && /\bmirror\b/.test(text)) add("adidas mirror", "mirror");
  if (/\bdunk\b/.test(text)) add("nike dunk", "dunk");
  if (/\bair force\b|\baf1\b/.test(text)) add("air force 1", "af1");
  if (/\byezy\b|\byeezy\b/.test(text)) add("yeezy");
  if (/\bcampus\b/.test(text)) add("adidas campus", "campus");
  if (/\bsamba\b/.test(text)) add("adidas samba", "samba");
  if (/\bpalermo\b/.test(text)) add("puma palermo", "palermo");
  if (/\bspezial\b|handball spezial/.test(text)) add("adidas spezial", "handball spezial", "spezial");

  add(text);
  return unique(aliases);
};

const STRICT_MODEL_DEFINITIONS = Object.freeze([
  {
    key: "jordan4",
    family: "air_jordan_4",
    displayName: "Air Jordan 4",
    aliases: [
      "air jordan 4",
      "air jordan iv",
      "jordan 4",
      "jordan iv",
      "jordan4",
      "aj4",
      "aj 4",
      "j4",
      "j 4",
      "\u062c\u0648\u0631\u062f\u0646 4",
      "\u062c\u0648\u0631\u062f\u0646 \u0664",
      "\u062c\u0648\u0631\u062f\u0646 \u06f4",
      "\u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631",
      "\u0646\u0627\u064a\u0643 \u062c\u0648\u0631\u062f\u0646 4",
      "\u0627\u064a\u0631 \u062c\u0648\u0631\u062f\u0646 4",
    ],
    requiredTokens: ["jordan", "4"],
    familyTokens: ["air", "jordan", "4"],
    searchTerms: [
      "air jordan 4",
      "jordan 4",
      "jordan",
      "4",
      "aj4",
      "j4",
      "\u062c\u0648\u0631\u062f\u0646",
    ],
  },
  {
    key: "nikeshox",
    family: "nike_shox",
    displayName: "Nike Shox",
    aliases: [
      "nike shox",
      "shox",
      "\u0634\u0648\u0643\u0633",
      "\u0634\u0648\u0643\u0633\u0627\u062a",
      "\u0646\u0627\u064a\u0643 \u0634\u0648\u0643\u0633",
    ],
    requiredTokens: ["shox"],
    familyTokens: ["nike", "shox"],
    searchTerms: [
      "nike shox",
      "shox",
      "\u0634\u0648\u0643\u0633",
      "\u0646\u0627\u064a\u0643",
    ],
  },
  {
    key: "adidasmirror",
    family: "adidas_mirror",
    displayName: "Adidas Mirror",
    aliases: ["adidas mirror", "mirror", "\u0627\u062f\u064a\u062f\u0627\u0633 \u0645\u064a\u0631\u0648\u0631", "\u0627\u062f\u064a\u062f\u0627\u0633 \u0645\u064a\u0631\u0648"],
    requiredTokens: ["adidas", "mirror"],
    familyTokens: ["adidas", "mirror"],
    searchTerms: ["adidas mirror", "mirror", "adidas"],
  },
  {
    key: "airforce",
    family: "nike_air_force",
    displayName: "Nike Air Force",
    aliases: ["air force", "air force 1", "nike air force", "af1", "\u0627\u064a\u0631 \u0641\u0648\u0631\u0633"],
    requiredTokens: ["air", "force"],
    familyTokens: ["nike", "air", "force"],
    searchTerms: ["air force", "air force 1", "af1", "nike"],
  },
  {
    key: "dunk",
    family: "nike_dunk",
    displayName: "Nike Dunk",
    aliases: ["dunk", "nike dunk", "nike dunk low", "dunk low", "low sneaker", "skate sneaker", "casual low", "white black", "patterned side", "\u062f\u0627\u0646\u0643"],
    requiredTokens: ["dunk"],
    familyTokens: ["nike", "dunk"],
    searchTerms: ["nike dunk", "dunk low", "low sneaker", "skate sneaker", "casual low", "white black", "patterned side", "nike"],
  },
  {
    key: "yeezy",
    family: "yeezy",
    displayName: "Yeezy",
    aliases: ["yeezy", "yezy", "\u064a\u064a\u0632\u064a"],
    requiredTokens: ["yeezy"],
    familyTokens: ["yeezy"],
    searchTerms: ["yeezy", "yezy"],
  },
  {
    key: "campus",
    family: "adidas_campus",
    displayName: "Adidas Campus",
    aliases: ["campus", "adidas campus", "\u0643\u0627\u0645\u0628\u0633"],
    requiredTokens: ["campus"],
    familyTokens: ["adidas", "campus"],
    searchTerms: ["adidas campus", "campus", "adidas"],
  },
  {
    key: "samba",
    family: "adidas_samba",
    displayName: "Adidas Samba",
    aliases: ["samba", "adidas samba", "\u0633\u0627\u0645\u0628\u0627"],
    requiredTokens: ["samba"],
    familyTokens: ["adidas", "samba"],
    searchTerms: ["adidas samba", "samba", "adidas"],
  },
]);

const normalizedModelDefinitions = () =>
  STRICT_MODEL_DEFINITIONS.map((definition) => ({
    ...definition,
    aliases: unique(normalizeModelAliases(definition.aliases).concat(definition.aliases.map(normalizeProductMatchText))).filter(Boolean),
    searchTerms: unique(definition.searchTerms.flatMap((term) => normalizeModelAliases([term]).concat(normalizeProductMatchText(term)))).filter(Boolean),
  }));

const hasToken = (value = "", token = "") => {
  const safeToken = normalizeProductMatchText(token);
  if (!safeToken) return false;
  return new RegExp(`(^|\\s)${escapeRegex(safeToken)}(\\s|$)`, "i").test(value);
};

const detectStrictModelIntent = (message = "") => {
  const normalized = normalizeProductMatchText(message);
  if (!normalized) return null;
  for (const definition of normalizedModelDefinitions()) {
    const exactAlias = definition.aliases.find((alias) => alias && (normalized === alias || normalized.includes(alias)));
    const hasRequiredTokens = definition.requiredTokens.every((token) => hasToken(normalized, token));
    if (exactAlias || hasRequiredTokens) {
      return {
        key: definition.key,
        family: definition.family,
        displayName: definition.displayName,
        matchedAlias: exactAlias || definition.requiredTokens.join(" "),
        aliases: definition.aliases,
        searchTerms: definition.searchTerms,
        requiredTokens: definition.requiredTokens,
        familyTokens: definition.familyTokens,
      };
    }
  }
  return null;
};

const productModelMatchAssessment = ({ product = {}, modelIntent = null, queryText = "", intent = {} } = {}) => {
  if (!modelIntent) {
    const score = productRankScore({ product, queryText, intent });
    return {
      confidence: score >= 900 ? 0.84 : score >= 650 ? 0.76 : score >= 360 ? 0.62 : 0.35,
      score,
      reason: score >= 650 ? "text_rank_match" : "weak_text_rank",
      model_family: "",
    };
  }

  const blob = productSearchBlob(product);
  const name = normalizeProductMatchText(product.name);
  const sku = normalizeProductMatchText([product.sku, product.barcode].filter(Boolean).join(" "));
  const intelligence = getProductIntelligence(product);
  const tagBlob = normalizeProductMatchText([
    product.brand,
    product.category,
    product.product_type,
    product.style,
    product.grade,
    intelligence.canonical_name,
    ...intelligence.aliases,
    ...intelligence.styles,
    ...intelligence.occasions,
  ].filter(Boolean).join(" "));

  const aliasMatches = modelIntent.aliases.filter((alias) => alias && blob.includes(alias));
  const exactName = modelIntent.aliases.some((alias) => alias && (name === alias || name.includes(alias)));
  const aliasMatch = aliasMatches.length > 0;
  const tagMatch = modelIntent.aliases.some((alias) => alias && tagBlob.includes(alias));
  const skuMatch = modelIntent.aliases.some((alias) => alias && sku.includes(alias.replace(/\s+/g, ""))) || /\b(aj4|j4)\b/.test(sku);
  const requiredTokenMatches = modelIntent.requiredTokens?.filter((token) => hasToken(blob, token)).length || 0;
  const allRequiredTokens = requiredTokenMatches >= (modelIntent.requiredTokens?.length || 0);
  const unrelatedJordanModel = modelIntent.key === "jordan4" && /\bjordan\b/.test(blob) && !hasToken(blob, "4") && /\b(1|2|3|5|6|7|8|9|10|11|12|13|14)\b/.test(blob);
  const unrelatedBrand = modelIntent.key === "jordan4" && /\b(puma|adidas|reebok|new balance|asics|converse|vans|shox|air max|air force|dunk)\b/.test(blob) && !/\bjordan\b/.test(blob);
  const unrelatedForShox = modelIntent.key === "nikeshox" && !/\bshox\b|\u0634\u0648\u0643\u0633/.test(blob);

  let confidence = 0.18;
  let reason = "semantic_or_weak_match";
  if (exactName) {
    confidence = 0.98;
    reason = "exact_model_name";
  } else if (aliasMatch) {
    confidence = 0.93;
    reason = "model_alias";
  } else if (skuMatch) {
    confidence = 0.9;
    reason = "sku_model_alias";
  } else if (tagMatch) {
    confidence = 0.84;
    reason = "tag_model_alias";
  } else if (allRequiredTokens) {
    confidence = 0.78;
    reason = "required_model_tokens";
  }
  if (unrelatedJordanModel) {
    confidence = Math.min(confidence, 0.42);
    reason = "different_jordan_model";
  }
  if (unrelatedBrand) {
    confidence = Math.min(confidence, 0.25);
    reason = "unrelated_brand_or_model";
  }
  if (unrelatedForShox) {
    confidence = Math.min(confidence, 0.25);
    reason = "different_model";
  }

  return {
    confidence,
    score: Math.round(confidence * 10_000),
    reason,
    model_family: confidence >= MODEL_INTENT_CONFIDENCE_THRESHOLD ? modelIntent.family : "",
    matched_aliases: aliasMatches.slice(0, 5),
  };
};

const hasRequestedAudienceOverride = (message = "") =>
  /\b(women|woman|ladies|girls|girl|kids|children|boys|boy)\b|\u062d\u0631\u064a\u0645\u064a|\u0628\u0646\u0627\u062a\u064a|\u0627\u0637\u0641\u0627\u0644|\u0648\u0644\u0627\u062f\u064a/i.test(message);

const productAudience = (product = {}) =>
  normalizeAudienceValue([
    product.gender,
    product.category,
    product.category_name,
    product.product_type,
    product.name,
  ].filter(Boolean).join(" "));

const visualDetectedBlob = (detected = {}) =>
  normalizeProductMatchText([
    detected.model_guess,
    detected.model_family,
    detected.likely_model,
    detected.model_keywords,
    detected.english_keywords,
    detected.arabic_keywords,
    detected.product_type,
    detected.category,
    detected.silhouette,
    detected.silhouette_style,
    detected.style,
    detected.high_top_low_top,
    detected.sole_shape,
    detected.features,
    detected.distinctive_features,
    detected.main_colors,
    detected.colors,
    detected.secondary_colors,
  ].flatMap((item) => (Array.isArray(item) ? item : [item])).filter(Boolean).join(" "));

const fieldConfidenceValue = (detected = {}, field = "") => {
  const value = Number(detected.field_confidence?.[field]);
  return Number.isFinite(value) ? value : 0;
};

const hasVisualTerm = (blob = "", pattern) => pattern.test(blob);

const visualImageMatchBreakdown = ({ product = {}, detected = {}, message = "" } = {}) => {
  const blob = productSearchBlob(product);
  const detectedBlob = visualDetectedBlob(detected);
  const likelyModel = detected.model_guess || detected.likely_model || detected.detected_model || detected.model_family || "";
  const modelAliases = normalizeModelAliases([likelyModel, detected.model_family, detected.model_keywords, detected.english_keywords, detected.arabic_keywords]);
  const brandTokens = visualTokens(detected.brand_guess, detected.brand_family, detected.brand, detected.likely_brand);
  const colorTokens = visualTokens(detected.main_colors, detected.colors, detected.secondary_colors);
  const categoryTokens = visualTokens(detected.product_type, detected.category);
  const featureTokens = visualTokens(detected.features, detected.distinctive_features, detected.english_keywords, detected.arabic_keywords);
  const materialTokens = visualTokens(detected.materials, detected.material);
  const silhouetteTokens = visualTokens(
    detected.silhouette,
    detected.silhouette_style,
    detected.silhouette,
    detected.style,
    detected.high_top_low_top,
    detected.sole_shape,
    detected.distinctive_features
  );
  const detectedAudience = normalizeAudienceValue(detected.gender_style || detected.gender_audience || detected.gender || detected.target_audience);
  const catalogAudience = productAudience(product);
  const stockScore = Number(product.total_stock || 0) > 0 ? 45 : -20;
  const requestedJordan4 = modelAliases.some((alias) => /\b(air jordan 4|jordan 4|aj4|j4)\b/.test(alias));
  const isJordanProduct = /\b(air jordan|jordan|aj)\b/.test(blob);
  const isJordan4Product = /\b(air jordan 4|jordan 4|aj4|j4)\b/.test(blob) || (/\bjordan\b/.test(blob) && /\b4\b|iv\b/.test(blob));
  const unrelatedBrandForJordan = requestedJordan4 && /\b(puma|adidas|reebok|new balance|asics|converse|vans)\b/.test(blob) && !isJordanProduct;
  const visualLowSkate = hasVisualTerm(detectedBlob, /\b(low|lowtop|low top|low profile|slim sole|skate|dunk|casual low)\b/);
  const visualTrailRunning = hasVisualTerm(detectedBlob, /\b(trail|running|runner|trek|terrex|goretex|hiking)\b/);
  const visualBasketballHigh = hasVisualTerm(detectedBlob, /\b(high|mid|high top|basketball|jordan 4|chunky basketball)\b/);
  const visualSlimSole = hasVisualTerm(detectedBlob, /\b(slim sole|smooth sole|low profile sole|flat sole)\b/);
  const visualChunkyTrailSole = hasVisualTerm(detectedBlob, /\b(chunky sole|rugged sole|trail sole|thick tread)\b/);
  const visualSidePattern = hasVisualTerm(detectedBlob, /\b(side graphic|graphic|pattern|patterned|side panel|side stripe|swoosh|black swoosh|stripe)\b/);
  const productDunkLow = /\b(dunk|nike dunk|dunk low)\b/.test(blob);
  const productLowCasual = /\b(low|lowtop|low top|casual|skate|court|sneaker)\b/.test(blob) && !/\b(high|mid|trail|running|runner|terrex|goretex|hiking)\b/.test(blob);
  const productTrailRunning = /\b(trail|running|runner|terrex|goretex|hiking|trek|outdoor)\b/.test(blob);
  const productHighBasketball = /\b(jordan 4|air jordan 4|aj4|j4|basketball|high top|high|mid)\b/.test(blob);
  const productChunkyTrailSole = /\b(trail|terrex|goretex|rugged|chunky|hiking|thick sole|outdoor)\b/.test(blob);

  const exactModel = modelAliases.some((alias) => alias && blob.includes(alias));
  const modelWordMatches = visualTokens(likelyModel, detected.model_keywords).filter((token) => blob.includes(token));
  let modelScore = exactModel ? 1_400 : Math.min(420, modelWordMatches.length * 140);
  if (requestedJordan4 && isJordan4Product) modelScore = Math.max(modelScore, 1_650);
  else if (requestedJordan4 && isJordanProduct) modelScore = Math.max(modelScore, 620);
  const brandMatches = brandTokens.filter((token) => blob.includes(token));
  const brandConfidence = fieldConfidenceValue(detected, "brand_guess");
  const brandTrustFactor = brandConfidence > 0 ? brandConfidence : brandTokens.length ? 0.45 : 0;
  const brandScore = brandTokens.length ? Math.round(Math.min(360, brandMatches.length * 180) * Math.max(0.25, brandTrustFactor)) : 0;
  if (brandScore > 0) modelScore += Math.min(220, brandScore);
  if (modelAliases.length && !exactModel && unrelatedBrandForJordan) modelScore -= 950;
  if (requestedJordan4 && !isJordanProduct) modelScore -= 520;

  const colorMatches = colorTokens.filter((token) => blob.includes(token));
  const colorScore = colorTokens.length ? Math.round((colorMatches.length / colorTokens.length) * 520) : 0;
  const requiredColorTokens = colorTokens.filter((token) => ["white", "black", "off", "gray", "grey", "blue", "red", "green", "brown", "beige"].includes(token));
  const missingRequiredColorTokens = unique(requiredColorTokens.filter((token) => !blob.includes(token)));
  const colorMismatchPenalty = requiredColorTokens.length >= 2 && missingRequiredColorTokens.length ? -Math.min(420, missingRequiredColorTokens.length * 210) : 0;
  const categoryMatches = categoryTokens.filter((token) => blob.includes(token));
  const categoryScore = categoryTokens.length ? Math.min(280, categoryMatches.length * 140) : 0;
  const featureMatches = featureTokens.filter((token) => blob.includes(token));
  const featureScore = featureTokens.length ? Math.min(420, featureMatches.length * 105) : 0;
  const materialMatches = materialTokens.filter((token) => blob.includes(token));
  const materialScore = materialTokens.length ? Math.min(180, materialMatches.length * 90) : 0;
  const silhouetteMatches = silhouetteTokens.filter((token) => blob.includes(token));
  let silhouetteScore = silhouetteTokens.length ? Math.min(520, silhouetteMatches.length * 130) : 0;
  const asksHighTop = silhouetteTokens.some((token) => ["high", "mid", "high top", "high-top", "hightop"].includes(token));
  const productLooksLow = /\b(low|lowtop|low top)\b/.test(blob);
  const productLooksHigh = /\b(high|mid|high top|high-top|hightop|jordan 4|aj4|j4)\b/.test(blob);
  if (asksHighTop && productLooksHigh) silhouetteScore += 260;
  if (asksHighTop && productLooksLow) silhouetteScore -= 380;
  if (silhouetteTokens.length && silhouetteMatches.length === 0 && !productLooksHigh) silhouetteScore -= 360;
  let silhouetteMismatchPenalty = 0;
  let silhouetteBoost = 0;
  if (visualLowSkate) {
    if (productDunkLow) silhouetteBoost += 1_250;
    else if (productLowCasual) silhouetteBoost += 820;
    else if (productLooksLow) silhouetteBoost += 460;
    if (productTrailRunning) silhouetteMismatchPenalty -= 1_550;
    if (productHighBasketball && !productDunkLow) silhouetteMismatchPenalty -= 950;
    if (productChunkyTrailSole && visualSlimSole) silhouetteMismatchPenalty -= 520;
  }
  if (visualTrailRunning && productTrailRunning) silhouetteBoost += 760;
  if (visualTrailRunning && productDunkLow) silhouetteMismatchPenalty -= 520;
  if (visualBasketballHigh && productHighBasketball) silhouetteBoost += 520;
  if (visualBasketballHigh && productTrailRunning) silhouetteMismatchPenalty -= 460;
  if (visualChunkyTrailSole && productChunkyTrailSole) silhouetteBoost += 360;
  silhouetteScore += silhouetteBoost;

  let featureMismatchPenalty = 0;
  let featureBoost = 0;
  if (visualSidePattern) {
    if (/\b(dunk|swoosh|stripe|pattern|graphic|side|white black|black white)\b/.test(blob)) featureBoost += 320;
    else featureMismatchPenalty -= 180;
  }

  let genderScore = 0;
  if (detectedAudience && catalogAudience) {
    if (catalogAudience === detectedAudience || catalogAudience === "unisex" || detectedAudience === "unisex") genderScore = 140;
    else if (!hasRequestedAudienceOverride(message) && ["men", "unisex"].includes(detectedAudience) && ["women", "girls", "kids"].includes(catalogAudience)) genderScore = -760;
    else genderScore = -260;
  }

  const lowVisualPenalty = !exactModel && !isJordan4Product && colorScore <= 0 && silhouetteScore <= 0 ? -420 : 0;
  const price = productBestPrice(product);
  const priceScore = price > 0 ? 20 : -15;
  const imageSimilarityHintScore = featureScore + Math.min(160, silhouetteScore > 0 ? 80 : 0) + Math.min(120, colorScore > 0 ? 60 : 0);
  const totalPenalty = colorMismatchPenalty + silhouetteMismatchPenalty + featureMismatchPenalty + lowVisualPenalty;
  const finalScore = modelScore + brandScore + colorScore + categoryScore + featureScore + featureBoost + materialScore + silhouetteScore + genderScore + stockScore + priceScore + totalPenalty;
  return {
    model_score: modelScore,
    brand_score: brandScore,
    brand_confidence: brandConfidence,
    brand_trust_factor: brandTrustFactor,
    color_score: colorScore,
    color_mismatch_penalty: colorMismatchPenalty,
    missing_required_colors: missingRequiredColorTokens,
    category_score: categoryScore,
    feature_score: featureScore,
    feature_boost: featureBoost,
    feature_mismatch_penalty: featureMismatchPenalty,
    material_score: materialScore,
    silhouette_score: silhouetteScore,
    silhouette_boost: silhouetteBoost,
    silhouette_mismatch_penalty: silhouetteMismatchPenalty,
    visual_silhouette: {
      low_skate: visualLowSkate,
      trail_running: visualTrailRunning,
      basketball_high: visualBasketballHigh,
      slim_sole: visualSlimSole,
      chunky_trail_sole: visualChunkyTrailSole,
      side_pattern: visualSidePattern,
    },
    product_silhouette: {
      dunk_low: productDunkLow,
      low_casual: productLowCasual,
      trail_running: productTrailRunning,
      high_basketball: productHighBasketball,
      chunky_trail_sole: productChunkyTrailSole,
    },
    gender_score: genderScore,
    stock_score: stockScore,
    price_score: priceScore,
    image_similarity_hint_score: imageSimilarityHintScore,
    low_visual_penalty: lowVisualPenalty,
    total_penalty: totalPenalty,
    final_score: finalScore,
    exact_model_match: (exactModel || (requestedJordan4 && isJordan4Product) || modelScore >= 1_200) && !unrelatedBrandForJordan,
    close_model_match: modelScore >= 620 && !unrelatedBrandForJordan,
    hard_filter_key: requestedJordan4 ? "jordan4" : "",
    hard_filter_match: requestedJordan4 ? isJordan4Product && !unrelatedBrandForJordan : false,
    unrelated_brand_penalty_applied: unrelatedBrandForJordan,
  };
};

const productRankScore = ({ product, queryText, intent }) => {
  const name = normalizeProductMatchText(product.name);
  const sku = normalizeProductMatchText(product.sku);
  const modelIntent = detectStrictModelIntent(queryText || "");
  const intelligence = getProductIntelligence(product);
  const intelligenceIntent = intent.product?.intelligence || {};
  const wantedStyles = new Set((intelligenceIntent.styles || []).map(normalizeProductMatchText));
  const wantedOccasions = new Set((intelligenceIntent.occasions || []).map(normalizeProductMatchText));
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
  if (modelIntent) {
    const assessment = productModelMatchAssessment({ product, modelIntent, queryText, intent });
    score += Math.round(assessment.confidence * 2_500);
    if (assessment.confidence >= 0.9) score += 2_500;
    if (assessment.model_family) score += 1_000;
    if (assessment.confidence < MODEL_INTENT_CONFIDENCE_THRESHOLD) score -= 3_500;
  }

  if (hasCopyName) score -= 260;
  if (Number(product.total_stock || 0) > 0) score += 130;
  if (intent.product?.colors?.length || intent.product?.size) {
    score += Number(product.variant_match_rank_score || 0);
    if (product.exact_variant_available) score += 1_800;
    else score -= 1_200;
  }
  if (finalPrice > 0) score += 110;
  if (intelligence.is_trending) score += 95;
  score += Math.round(Number(intelligence.priority_score || 0) / 2);
  score += intelligence.styles.filter((style) => wantedStyles.has(normalizeProductMatchText(style))).length * 90;
  score += intelligence.occasions.filter((occasion) => wantedOccasions.has(normalizeProductMatchText(occasion))).length * 85;
  if (intelligenceIntent.trendingOnly && !intelligence.is_trending) score -= 120;
  if (intent.product?.size && (product.variants || []).some((variant) => variantSizeMatchScore(variant, intent.product.size) >= 96)) score += 90;
  if (intent.product?.colors?.length && (product.variants || []).some((variant) => intent.product.colors.some((color) => variantColorMatchScore(variant, color) > 0))) score += 70;
  return score;
};

const rankProductsForIntent = ({ products = [], message = "", intent = {}, memory = null }) => {
  const queryText = productQueryText(message, intent);
  const requestedSize = resolveCustomerSize({ intent, memory });
  let ranked = [...products].sort((left, right) => {
    const scoreDiff =
      productRankScore({ product: right, queryText, intent }) -
      productRankScore({ product: left, queryText, intent });
    if (scoreDiff !== 0) return scoreDiff;
    return Number(right.total_stock || 0) - Number(left.total_stock || 0);
  });
  const styleIntent = intent.product?.intelligence?.style;
  if (styleIntent?.hasIntent) {
    ranked = rankProductsForStyle({ products: ranked, intent: styleIntent });
  }
  if (intent.product?.intelligence?.hasIntent || intent.product?.intelligence?.alias_matches?.length) {
    const salesRanked = rankProductsBySalesIntelligence({
      products: ranked,
      shoppingIntent: intent.product.intelligence,
    });
    return rankProductsByInventorySalesStrategy({
      products: salesRanked,
      requestedSize,
      shoppingIntent: intent.product?.intelligence || {},
      memory,
    });
  }
  return rankProductsByInventorySalesStrategy({
    products: ranked,
    requestedSize,
    shoppingIntent: intent.product?.intelligence || {},
    memory,
  });
};

const normalizeProductRow = (row, intent, pricingSettings = {}) => {
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const filteredVariants = variants
    .filter((variant) => {
      const colorOk = !intent.product.colors.length || intent.product.colors.some((color) => variantColorMatchScore(variant, color) > 0);
      const sizeOk = !intent.product.size || variantSizeMatchScore(variant, intent.product.size) >= 96;
      return colorOk && sizeOk;
    })
    .slice(0, VARIANT_LIMIT);
  const visibleVariants = filteredVariants.length ? filteredVariants : variants.slice(0, VARIANT_LIMIT);
  const totalStock = variants.length
    ? variants.reduce((sum, variant) => sum + Math.max(0, numeric(variant.stock, 0)), 0)
    : Math.max(0, numeric(row.stock, 0));
  const prices = [
    productBestPrice(row, pricingSettings),
    ...visibleVariants.map((variant) => money(variant.regular_price || variant.price) || null),
  ].filter((value) => value !== null);

  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const activePrice = productBestPrice(row, pricingSettings) || minPrice || money(row.price);
  const regularPrice = money(row.regular_price || row.price) || activePrice;
  const realSaleActive = productBestPrice(row, pricingSettings) < regularPrice;
  const compareAtPrice = realSaleActive ? regularPrice : aiComparePriceFor(regularPrice, row, pricingSettings);
  const hasDiscount = compareAtPrice > activePrice;

  const productImages = normalizeJsonArray(row.product_images);
  const stockedVariants = variants.filter((variant) => numeric(variant.stock, 0) > 0);
  const remainingSizeCount = new Set(stockedVariants.map((variant) => toText(variant.size).toLowerCase()).filter(Boolean)).size;
  const remainingColorCount = new Set(stockedVariants.map((variant) => toText(variant.color).toLowerCase()).filter(Boolean)).size;

  return {
    id: row.id,
    slug: row.slug || "",
    canonical_slug: row.canonical_slug || "",
    name: row.name,
    sku: row.sku || "",
    barcode: row.barcode || "",
    brand: row.brand || "",
    category: row.category || "",
    product_type: row.product_type || "",
    gender: row.gender || "",
    style: row.style || "",
    grade: row.grade || "",
    tags: row.tags || "",
    image: row.image || "",
    image_url: row.image_url || "",
    raw_image_url: row.image_url || "",
    product_image_url: row.product_image_url || row.image_url || row.image || row.main_image || row.thumbnail || "",
    main_image: row.main_image || "",
    thumbnail: row.thumbnail || "",
    product_images: productImages,
    gallery_images: productImages,
    regular_price: regularPrice,
    price: regularPrice,
    sale_price: realSaleActive ? activePrice : 0,
    compare_at_price: compareAtPrice,
    old_price: compareAtPrice,
    created_at: row.created_at || null,
    recent_sales_momentum: numeric(row.recent_sales_momentum, 0),
    price_range: minPrice === null ? null : minPrice === maxPrice ? `${minPrice}` : `${minPrice}-${maxPrice}`,
    active_discount: hasDiscount ? { sale_price: activePrice, original_price: compareAtPrice } : null,
    total_stock: totalStock,
    availability: totalStock > 0 ? "available" : "out_of_stock",
    colors: unique(variants.map((variant) => variant.color)),
    sizes: unique(variants.map((variant) => variant.size)),
    remaining_variant_count: stockedVariants.length,
    stocked_variant_count: stockedVariants.length,
    remaining_size_count: remainingSizeCount,
    remaining_color_count: remainingColorCount,
    variants: visibleVariants.map((variant) => ({
      id: variant.id,
      color: variant.color || "",
      color_name: variant.color_name || "",
      color_value: variant.color_value || "",
      color_hex: variant.color_hex || "",
      size: variant.size || "",
      sku: variant.sku || "",
      barcode: variant.barcode || "",
      image_url: variant.image_url || "",
      variant_image_url: variant.image_url || "",
      color_image_url: variant.image_url || "",
      product_images: normalizeJsonArray(variant.product_images),
      price: money(variant.price),
      sale_price: money(variant.sale_price),
      compare_at_price: aiComparePriceFor(money(variant.sale_price) || money(variant.price), row, pricingSettings),
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
      product_variant_images_count: imageBundle?.rows?.length || 0,
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

const searchProducts = async ({ tenantId, message, intent, req = null, memory = null }) => {
  const [productColumns, variantColumns] = await Promise.all([getColumns("products"), getColumns("product_variants")]);
  const productNameExpr = columnExpr("p", productColumns, ["name", "title", "name_en", "name_ar", "title_en", "title_ar"], "''");
  const productNameColumns = columnList("p", productColumns, ["name", "title", "name_ar", "name_en", "title_ar", "title_en"]);
  if (!productColumns.has("tenant_id") || !productNameColumns.length) return [];

  const terms = normalizeSearchTerms(message, intent);
  const strictModelIntent = detectStrictModelIntent(message);
  const orchestratorUnderstanding = detectSalesProductUnderstanding({ message, memory, source: "product_search" });
  const styleIntent = intent.product?.intelligence?.style;
  const hasConcreteProductFilter = Boolean(
    intent.product.codes.length ||
      intent.product.colors.length ||
      intent.product.size ||
      findByAlias(message).length ||
      intent.product.asksPrice ||
      intent.product.asksAvailability
  );
  const productSearchTerms = styleIntent?.hasIntent && !hasConcreteProductFilter ? [] : terms;
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
    terms: productSearchTerms,
    codes: intent.product.codes,
    includeActiveFilters: false,
    includeVisibilityFilters: false,
  });
  const activeOnlyConditions = buildProductConditions({
    productColumns,
    variantColumns,
    terms: productSearchTerms,
    codes: intent.product.codes,
    includeActiveFilters: true,
    includeVisibilityFilters: false,
  });
  const { where, params, filters, activeFilterApplied, storefrontFilterApplied } = buildProductConditions({
    productColumns,
    variantColumns,
    terms: productSearchTerms,
    codes: intent.product.codes,
  });
  params[0] = tenantId;
  params.push(PRODUCT_LIMIT);

  debugProductSearch("input", {
    normalized_query: normalizedQuery,
    normalized_model_query: normalizeProductMatchText(message),
    strict_model_intent: strictModelIntent,
    extracted_product_terms: terms,
    sql_product_terms: productSearchTerms,
    tenant_id: tenantId,
    schema: productSchemaDebug,
    sql_filters_applied: filters,
  });

  const productSelect = {
    slug: columnExpr("p", productColumns, ["slug"], "''"),
    canonical_slug: columnExpr("p", productColumns, ["canonical_slug", "product_slug"], "''"),
    sku: columnExpr("p", productColumns, ["sku"], "''"),
    barcode: columnExpr("p", productColumns, ["barcode"], "''"),
    brand: columnExpr("p", productColumns, ["brand", "brand_name", "vendor", "manufacturer"], "''"),
    category: columnExpr("p", productColumns, ["category", "category_name", "collection_name"], "''"),
    product_type: columnExpr("p", productColumns, ["product_type", "type", "item_type"], "''"),
    gender: columnExpr("p", productColumns, ["gender", "audience", "target_audience"], "''"),
    style: columnExpr("p", productColumns, ["style", "silhouette", "fit_style"], "''"),
    grade: columnExpr("p", productColumns, ["grade", "classification"], "''"),
    tags: columnExpr("p", productColumns, ["tags", "seo_keywords", "keywords"], "''"),
    image: columnExpr("p", productColumns, ["image"], "''"),
    image_url: columnExpr("p", productColumns, ["image_url"], "''"),
    main_image: columnExpr("p", productColumns, ["main_image", "main_image_url", "public_image_url", "product_image_url"], "''"),
    thumbnail: columnExpr("p", productColumns, ["thumbnail", "thumbnail_url", "photo_url"], "''"),
    product_images: columnExpr("p", productColumns, ["product_images", "gallery_images", "images"], "'[]'::jsonb"),
    stock: columnExpr("p", productColumns, ["stock"], "0"),
    regular_price: columnExpr("p", productColumns, ["regular_price", "price"], "0"),
    price: columnExpr("p", productColumns, ["regular_price", "price"], "0"),
    sale_price: columnExpr("p", productColumns, ["sale_price", "discount_price"], "0"),
    sale_price_enabled: columnExpr("p", productColumns, ["sale_price_enabled"], "FALSE"),
    use_custom_compare_price: columnExpr("p", productColumns, ["use_custom_compare_price"], "FALSE"),
    custom_compare_price: columnExpr("p", productColumns, ["custom_compare_price"], "0"),
    created_at: columnExpr("p", productColumns, ["created_at", "published_at"], "NULL"),
    recent_sales_momentum: columnExpr("p", productColumns, ["recent_sales_momentum", "recent_sales_30d", "sales_30d", "sold_30d", "sales_count"], "0"),
  };
  const variantStockOrder = variantColumns.has("stock") ? "COALESCE(SUM(GREATEST(COALESCE(pv.stock, 0), 0)), 0)" : "0";
  const productStockOrder = productColumns.has("stock") ? "GREATEST(COALESCE(p.stock, 0), 0)" : "0";
  const stockOrder = `${variantStockOrder} + ${productStockOrder} DESC, `;
  const productOrder = productColumns.has("updated_at") ? `${stockOrder}p.updated_at DESC NULLS LAST, p.id DESC` : `${stockOrder}p.id DESC`;
  const variantSelect = {
    id: columnExpr("pv", variantColumns, ["id"], "NULL"),
    color: columnExpr("pv", variantColumns, ["color"], "''"),
    color_name: columnExpr("pv", variantColumns, ["color_name"], "''"),
    color_value: columnExpr("pv", variantColumns, ["color_value"], "''"),
    color_hex: columnExpr("pv", variantColumns, ["color_hex", "hex"], "''"),
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
      ${productSelect.slug} AS slug,
      ${productSelect.canonical_slug} AS canonical_slug,
      ${productSelect.sku} AS sku,
      ${productSelect.barcode} AS barcode,
      ${productSelect.brand} AS brand,
      ${productSelect.category} AS category,
      ${productSelect.product_type} AS product_type,
      ${productSelect.gender} AS gender,
      ${productSelect.style} AS style,
      ${productSelect.grade} AS grade,
      ${productSelect.tags} AS tags,
      ${productSelect.image} AS image,
      ${productSelect.image_url} AS image_url,
      ${productSelect.main_image} AS main_image,
      ${productSelect.thumbnail} AS thumbnail,
      ${productSelect.product_images} AS product_images,
      ${productSelect.stock} AS stock,
      ${productSelect.regular_price} AS regular_price,
      ${productSelect.price} AS price,
      ${productSelect.sale_price} AS sale_price,
      ${productSelect.sale_price_enabled} AS sale_price_enabled,
      ${productSelect.use_custom_compare_price} AS use_custom_compare_price,
      ${productSelect.custom_compare_price} AS custom_compare_price,
      ${productSelect.created_at} AS created_at,
      ${productSelect.recent_sales_momentum} AS recent_sales_momentum,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', ${variantSelect.id},
            'color', ${variantSelect.color},
            'color_name', ${variantSelect.color_name},
            'color_value', ${variantSelect.color_value},
            'color_hex', ${variantSelect.color_hex},
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
  const [broadMatchedCount, activeMatchedCount, pricingSettings] = await Promise.all([
    countMatches(baseConditions),
    countMatches(activeOnlyConditions),
    getWebsiteSettings({ tenantId }).then(normalizeStorefrontPricingSettings).catch(() => normalizeStorefrontPricingSettings()),
  ]);
  const requestedKind = detectRequestedProductKind(message);
  const hydratedProducts = await hydrateProductsWithStorefrontImages(
    result.rows.map((row) => normalizeProductRow(row, intent, pricingSettings)),
    req
  );
  let products = rankProductsForIntent({
    products: hydratedProducts.map((product) => annotateProductVariantMatch({ product, intent, message, memory })),
    message,
    intent,
    memory,
  });
  if (requestedKind) {
    const kindMatches = products.filter((product) => requestedKind.catalog.test(productSearchBlob(product)));
    products = kindMatches.length ? kindMatches : [];
  }
  if (styleIntent?.hasIntent) {
    products = rankProductsForStyle({ products, intent: styleIntent, memory });
    products = rankProductsByInventorySalesStrategy({
      products,
      requestedSize: resolveCustomerSize({ intent, memory }),
      shoppingIntent: intent.product?.intelligence || {},
      memory,
    });
  }
  if (intent.product?.colors?.length || intent.product?.size) {
    products = [...products].sort((left, right) => {
      if (Boolean(right.exact_variant_available) !== Boolean(left.exact_variant_available)) {
        return right.exact_variant_available ? 1 : -1;
      }
      return Number(right.variant_match_rank_score || 0) - Number(left.variant_match_rank_score || 0);
    });
  }
  if (strictModelIntent) {
    const queryText = productQueryText(message, intent);
    const assessedProducts = products.map((product) => {
      const assessment = productModelMatchAssessment({ product, modelIntent: strictModelIntent, queryText, intent });
      return {
        ...product,
        model_match_confidence: assessment.confidence,
        model_match_reason: assessment.reason,
        model_family: assessment.model_family,
        model_match_aliases: assessment.matched_aliases || [],
        strong_model_match: assessment.confidence >= MODEL_INTENT_CONFIDENCE_THRESHOLD,
      };
    });
    const strongProducts = assessedProducts
      .filter((product) => Number(product.model_match_confidence || 0) >= MODEL_INTENT_CONFIDENCE_THRESHOLD)
      .sort((left, right) => {
        const familyDiff = Number(Boolean(right.model_family)) - Number(Boolean(left.model_family));
        if (familyDiff !== 0) return familyDiff;
        const confidenceDiff = Number(right.model_match_confidence || 0) - Number(left.model_match_confidence || 0);
        if (confidenceDiff !== 0) return confidenceDiff;
        return productRankScore({ product: right, queryText, intent }) - productRankScore({ product: left, queryText, intent });
      });
    const topDebug = assessedProducts.slice(0, 8).map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      confidence: product.model_match_confidence,
      reason: product.model_match_reason,
      model_family: product.model_family || "",
    }));
    const fallbackTriggered = !strongProducts.length;
    console.log("[ai-support product-retrieval]", {
      tenant_id: tenantId,
      normalized_query: normalizeProductMatchText(message),
      model_intent: strictModelIntent.displayName,
      top_matched_products: topDebug,
      confidence_score: strongProducts[0]?.model_match_confidence || assessedProducts[0]?.model_match_confidence || 0,
      fallback_triggered: fallbackTriggered,
      fallback_reason: fallbackTriggered ? "no_product_met_model_confidence_threshold" : "",
      confidence_threshold: MODEL_INTENT_CONFIDENCE_THRESHOLD,
    });
    products = strongProducts;
  }
  products = filterAiEligibleProducts(products, { requireProductUrl: false });
  const exactCount = strictModelIntent
    ? products.filter((product) => Number(product.model_match_confidence || 0) >= MODEL_INTENT_CONFIDENCE_THRESHOLD).length
    : products.length;
  const familyCount = products.filter((product) => product.model_family || product.strong_model_match).length;
  if (orchestratorUnderstanding.requires_relevance_gate) {
    products = gateRelevantProducts({
      products,
      understanding: orchestratorUnderstanding,
      limit: strictModelIntent ? 3 : PRODUCT_LIMIT,
      fallback: false,
    });
  }
  console.log("[ai-orchestrator:candidates]", {
    exact_count: exactCount,
    family_count: familyCount,
    similar_count: products.length,
    fallback_count: 0,
  });

  debugProductSearch("result", {
    query_text: message,
    normalized_query: normalizeProductMatchText(message),
    strict_model_intent: strictModelIntent?.displayName || "",
    confidence_threshold: strictModelIntent ? MODEL_INTENT_CONFIDENCE_THRESHOLD : undefined,
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
      requested_color: product.requested_color || "",
      requested_size: product.requested_size || "",
      matched_variant_id: product.matched_variant_id ?? null,
      matched_variant_color: product.matched_variant_color || "",
      matched_variant_size: product.matched_variant_size || "",
      matched_variant_image: compactImageDebugValue(product.matched_variant_image || ""),
      variant_match_reason: product.variant_match_reason || "",
      searched_variants_count: product.searched_variants_count || 0,
      color_match_score: product.color_match_score || 0,
      size_match_score: product.size_match_score || 0,
      model_match_confidence: product.model_match_confidence,
      model_match_reason: product.model_match_reason,
      model_family: product.model_family,
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
      product_intelligence: buildProductIntelligenceProfile(product),
      sku: product.sku || undefined,
      barcode: product.barcode || undefined,
      brand: product.brand || undefined,
      category: product.category || undefined,
      product_type: product.product_type || undefined,
      gender: product.gender || undefined,
      style: product.style || undefined,
      grade: product.grade || undefined,
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
        inventory_state: product.inventory_state,
        inventory_sales_score: product.inventory_sales_score,
        requested_size: product.inventory_profile?.requested_size || undefined,
        requested_size_stock: product.inventory_profile?.requested_size_stock ?? undefined,
        requested_size_available: product.inventory_profile?.requested_size_available ?? undefined,
        requested_size_strong: product.inventory_profile?.requested_size_strong || undefined,
        limited: product.inventory_profile?.low_inventory || undefined,
        availability: product.availability,
        colors: product.colors,
        sizes: product.sizes,
      },
      matching_variants: product.variants,
    })
  ),
});

const loadVisualSearchProducts = async ({ tenantId, intent, req = null } = {}) => {
  const [productColumns, variantColumns] = await Promise.all([getColumns("products"), getColumns("product_variants")]);
  const productNameExpr = columnExpr("p", productColumns, ["name", "title", "name_en", "name_ar", "title_en", "title_ar"], "''");
  const productNameColumns = columnList("p", productColumns, ["name", "title", "name_ar", "name_en", "title_ar", "title_en"]);
  if (!tenantId || !productColumns.has("tenant_id") || !productNameColumns.length) return [];

  const conditions = buildProductConditions({
    productColumns,
    variantColumns,
    terms: [],
    codes: [],
    includeActiveFilters: true,
    includeVisibilityFilters: true,
  });
  const params = [...conditions.params];
  params[0] = tenantId;
  params.push(Math.max(25, Math.min(1_000, IMAGE_SEARCH_PRODUCT_LIMIT || 300)));

  const productSelect = {
    slug: columnExpr("p", productColumns, ["slug"], "''"),
    canonical_slug: columnExpr("p", productColumns, ["canonical_slug", "product_slug"], "''"),
    sku: columnExpr("p", productColumns, ["sku"], "''"),
    barcode: columnExpr("p", productColumns, ["barcode"], "''"),
    brand: columnExpr("p", productColumns, ["brand", "brand_name", "vendor", "manufacturer"], "''"),
    category: columnExpr("p", productColumns, ["category", "category_name", "collection_name"], "''"),
    product_type: columnExpr("p", productColumns, ["product_type", "type", "item_type"], "''"),
    gender: columnExpr("p", productColumns, ["gender", "audience", "target_audience"], "''"),
    style: columnExpr("p", productColumns, ["style", "silhouette", "fit_style"], "''"),
    grade: columnExpr("p", productColumns, ["grade", "classification"], "''"),
    image: columnExpr("p", productColumns, ["image"], "''"),
    image_url: columnExpr("p", productColumns, ["image_url"], "''"),
    main_image: columnExpr("p", productColumns, ["main_image", "main_image_url", "public_image_url", "product_image_url"], "''"),
    thumbnail: columnExpr("p", productColumns, ["thumbnail", "thumbnail_url", "photo_url"], "''"),
    product_images: columnExpr("p", productColumns, ["product_images", "gallery_images", "images"], "'[]'::jsonb"),
    stock: columnExpr("p", productColumns, ["stock"], "0"),
    regular_price: columnExpr("p", productColumns, ["regular_price", "price"], "0"),
    price: columnExpr("p", productColumns, ["regular_price", "price"], "0"),
    sale_price: columnExpr("p", productColumns, ["sale_price", "discount_price"], "0"),
    sale_price_enabled: columnExpr("p", productColumns, ["sale_price_enabled"], "FALSE"),
    use_custom_compare_price: columnExpr("p", productColumns, ["use_custom_compare_price"], "FALSE"),
    custom_compare_price: columnExpr("p", productColumns, ["custom_compare_price"], "0"),
    created_at: columnExpr("p", productColumns, ["created_at", "published_at"], "NULL"),
    recent_sales_momentum: columnExpr("p", productColumns, ["recent_sales_momentum", "recent_sales_30d", "sales_30d", "sold_30d", "sales_count"], "0"),
  };
  const variantStockOrder = variantColumns.has("stock") ? "COALESCE(SUM(GREATEST(COALESCE(pv.stock, 0), 0)), 0)" : "0";
  const productStockOrder = productColumns.has("stock") ? "GREATEST(COALESCE(p.stock, 0), 0)" : "0";
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
      ${productSelect.slug} AS slug,
      ${productSelect.canonical_slug} AS canonical_slug,
      ${productSelect.sku} AS sku,
      ${productSelect.barcode} AS barcode,
      ${productSelect.brand} AS brand,
      ${productSelect.category} AS category,
      ${productSelect.product_type} AS product_type,
      ${productSelect.gender} AS gender,
      ${productSelect.style} AS style,
      ${productSelect.grade} AS grade,
      ${productSelect.image} AS image,
      ${productSelect.image_url} AS image_url,
      ${productSelect.main_image} AS main_image,
      ${productSelect.thumbnail} AS thumbnail,
      ${productSelect.product_images} AS product_images,
      ${productSelect.stock} AS stock,
      ${productSelect.regular_price} AS regular_price,
      ${productSelect.price} AS price,
      ${productSelect.sale_price} AS sale_price,
      ${productSelect.sale_price_enabled} AS sale_price_enabled,
      ${productSelect.use_custom_compare_price} AS use_custom_compare_price,
      ${productSelect.custom_compare_price} AS custom_compare_price,
      ${productSelect.created_at} AS created_at,
      ${productSelect.recent_sales_momentum} AS recent_sales_momentum,
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
    WHERE ${conditions.where}
    GROUP BY p.id
    ORDER BY ${variantStockOrder} + ${productStockOrder} DESC, p.id DESC
    LIMIT $${params.length}
    `,
    params
  );

  const pricingSettings = await getWebsiteSettings({ tenantId }).then(normalizeStorefrontPricingSettings).catch(() => normalizeStorefrontPricingSettings());
  const products = await hydrateProductsWithStorefrontImages(
    result.rows.map((row) => normalizeProductRow(row, intent || detectAiSupportIntent(""), pricingSettings)),
    req
  );
  const eligible = filterAiEligibleProducts(products, { requireProductUrl: false });
  const understanding = detectSalesProductUnderstanding({ message: intent?.product?.image_search_query || intent?.raw || "", memory: {}, source: "visual_search" });
  if (!understanding.requires_relevance_gate) return eligible;
  return gateRelevantProducts({ products: eligible, understanding, limit: IMAGE_SEARCH_PRODUCT_LIMIT, fallback: false });
};

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
  picked.working_hours ||= "مواعيد العمل مش مضافة لسه.";
  picked.return_exchange_policy ||= "سياسة الاستبدال والاسترجاع مش مضافة لسه.";
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
        working_hours: toText(branch.working_hours) || "مواعيد العمل مش مضافة لسه.",
        notes: toText(branch.notes),
      }))
    );
  }

  const storeContext = {
    store: settings,
    branches,
    configuration_status: {
      working_hours_configured:
        toText(settings.working_hours) !== "مواعيد العمل مش مضافة لسه." ||
        branches.some((branch) => toText(branch.working_hours) !== "مواعيد العمل مش مضافة لسه."),
      return_exchange_policy_configured: toText(settings.return_exchange_policy) !== "سياسة الاستبدال والاسترجاع مش مضافة لسه.",
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
  const locale = shouldReplyInArabic(message) ? "ar" : "en";
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
      .filter((branch) => toText(branch.working_hours) && toText(branch.working_hours) !== "مواعيد العمل مش مضافة لسه.")
      .map((branch) => `${branch.name}: ${branch.working_hours}`);
    const settingLines = toText(store.working_hours) && store.working_hours !== "مواعيد العمل مش مضافة لسه." ? valueToLines(store.working_hours) : [];
    const lines = [...settingLines, ...branchLines];
    if (lines.length) return wrap(locale === "ar" ? `مواعيد العمل:\n${joinList(lines, "ar")}` : `Working hours:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "مواعيد العمل مش مضافة لسه." : "Working hours are not configured yet.");
  }

  if (has(["return", "exchange", "refund", "\u0627\u0633\u062a\u0631\u062c\u0627\u0639", "\u0627\u0633\u062a\u0628\u062f\u0627\u0644"])) {
    const lines = store.return_exchange_policy === "سياسة الاستبدال والاسترجاع مش مضافة لسه." ? [] : valueToLines(store.return_exchange_policy);
    if (lines.length) return wrap(locale === "ar" ? `سياسة الاستبدال والاسترجاع:\n${joinList(lines, "ar")}` : `Return/exchange policy:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "سياسة الاستبدال أو الاسترجاع مش مضافة لسه." : "Return/exchange policy is not configured yet.");
  }

  if (has(["payment", "pay", "\u062f\u0641\u0639"])) {
    const lines = [...valueToLines(store.payment_methods), ...valueToLines(store.payment_policy)];
    if (lines.length) return wrap(locale === "ar" ? `طرق الدفع:\n${joinList(lines, "ar")}` : `Payment methods:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "طرق الدفع مش مضافة لسه." : "Payment methods are not configured yet.");
  }

  if (has(["address", "branch", "location", "\u0639\u0646\u0648\u0627\u0646", "\u0641\u0631\u0639", "\u0641\u0631\u0648\u0639"])) {
    const branchLines = branches
      .filter((branch) => toText(branch.address))
      .map((branch) => `${branch.name}: ${branch.address}${branch.phone ? ` - ${branch.phone}` : ""}`);
    const settingLines = valueToLines(store.address);
    const lines = [...settingLines, ...branchLines];
    if (lines.length) return wrap(locale === "ar" ? `العناوين المتاحة:\n${joinList(lines, "ar")}` : `Available addresses:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "عنوان الفرع مش مضاف لسه." : "Branch address is not configured yet.");
  }

  if (has(["shipping", "delivery", "\u0634\u062d\u0646", "\u062a\u0648\u0635\u064a\u0644"])) {
    const lines = [...valueToLines(store.shipping_policy), ...valueToLines(store.delivery_notes)];
    if (lines.length) return wrap(locale === "ar" ? `الشحن والتوصيل:\n${joinList(lines, "ar")}` : `Shipping and delivery:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "سياسة الشحن أو التوصيل مش مضافة لسه." : "Shipping/delivery policy is not configured yet.");
  }

  if (has(["phone", "whatsapp", "contact", "\u0648\u0627\u062a\u0633", "\u062a\u0644\u064a\u0641\u0648\u0646", "\u0645\u0648\u0628\u0627\u064a\u0644"])) {
    const lines = [...valueToLines(store.phone), ...valueToLines(store.whatsapp), ...branches.filter((branch) => branch.phone).map((branch) => `${branch.name}: ${branch.phone}`)];
    if (lines.length) return wrap(locale === "ar" ? `بيانات التواصل:\n${joinList(lines, "ar")}` : `Contact details:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "بيانات التواصل مش مضافة لسه." : "Contact details are not configured yet.");
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

const buildGreetingOnlyResponse = ({ message = "" } = {}) => ({
  answer: normalizeConversationalText(message).includes("السلام عليكم")
    ? "وعليكم السلام\nأقدر أساعدك في المقاسات، الموديلات، أو البحث بصورة."
    : "أهلاً بيك\nأقدر أساعدك في المقاسات، الموديلات، أو البحث بصورة.",
  confidence: 1,
  needs_human_support: false,
  sources_used: [],
  suggested_products: [],
  suggested_actions: [],
  personalization_blocked: true,
  greeting_only_mode: true,
});

const productColorCount = (product = {}) =>
  new Set((Array.isArray(product.variants) ? product.variants : [])
    .filter((variant) => Number(variant?.stock || variant?.quantity || 0) > 0)
    .map((variant) => normalizeProductMatchText(variant?.color || variant?.color_name || variant?.color_value || ""))
    .filter(Boolean)).size;

const suggestedProducts = (products = [], req = null, { limit = 3 } = {}) =>
  filterAiEligibleProducts(products, { requireProductUrl: false }).slice(0, Math.max(1, Number(limit) || 3)).map((product) => {
    const inventoryProfile = product.inventory_profile || buildInventoryProfile(product);
    const colorVariantCount = productColorCount(product);
    const item = ({
    id: product.id,
    name: product.name,
    slug: product.slug || product.canonical_slug || "",
    canonical_slug: product.canonical_slug || "",
    sku: product.sku || "",
    brand: product.brand || "",
    category: product.category || "",
    product_type: product.product_type || "",
    gender: product.gender || "",
    style: product.style || "",
    image: product.image || "",
    image_url: resolveSuggestedProductImageUrl(product, req),
    main_image: product.main_image || "",
    thumbnail: product.thumbnail || "",
    product_images: Array.isArray(product.product_images) ? product.product_images : [],
    variants: Array.isArray(product.variants) ? product.variants : [],
    price: productBestPrice(product),
    sale_price: money(product.sale_price) > 0 ? money(product.sale_price) : null,
    compare_at_price: money(product.compare_at_price || product.old_price) > productBestPrice(product) ? money(product.compare_at_price || product.old_price) : null,
    old_price: money(product.compare_at_price || product.old_price) > productBestPrice(product) ? money(product.compare_at_price || product.old_price) : null,
    final_price: productBestPrice(product),
    price_range: product.price_range || "",
    availability: product.exact_variant_available === false ? "out_of_stock" : product.availability,
    stock_status: product.exact_variant_available === false ? "out_of_stock" : Number(product.total_stock || 0) > 0 ? "in_stock" : "out_of_stock",
    available_sizes: availableProductSizes(product),
    sizes: availableProductSizes(product),
    product_url: resolvePublicProductUrl(product),
    total_stock: product.total_stock,
    stock: product.total_stock,
    inventory_state: inventoryProfile.inventory_state,
    inventory_profile: inventoryProfile,
    inventory_sales_score: product.inventory_sales_score || 0,
    limited: Boolean(inventoryProfile.low_inventory),
    requested_color: product.requested_color || "",
    requested_size: product.requested_size || inventoryProfile.requested_size,
    requested_size_stock: product.exact_variant_available === false ? 0 : inventoryProfile.requested_size_stock,
    requested_size_available: product.exact_variant_available === false ? false : inventoryProfile.requested_size_available,
    matched_image_url: product.matched_visual_candidate?.image_url || product.matched_image_url || "",
    matched_image_source: product.matched_visual_candidate?.image_source || product.matched_image_source || "",
    matched_variant_id: product.matched_visual_candidate?.variant_id ?? product.matched_variant_id ?? null,
    matched_variant_color: product.matched_visual_candidate?.color || product.matched_variant_color || "",
    matched_variant_size: product.matched_visual_candidate?.size || product.matched_variant_size || "",
    matched_variant_image: product.matched_variant_image || product.matched_image_url || "",
    selected_card_image_source: product.matched_variant_image || product.matched_visual_candidate?.image_url || product.matched_image_url
      ? product.matched_visual_candidate?.image_source || product.matched_image_source || "matched_variant_image"
      : product.selected_image_field || "",
    selected_card_image_url: resolveSuggestedProductImageUrl(product, req),
    variant_match_reason: product.variant_match_reason || "",
    searched_variants_count: product.searched_variants_count || 0,
    color_match_score: product.color_match_score || 0,
    size_match_score: product.size_match_score || 0,
    exact_variant_available: product.exact_variant_available,
    strong_model_match: Boolean(product.strong_model_match || product.exact_match_found || product.image_match_breakdown?.exact_model_match || product.image_match_breakdown?.hard_filter_match || product.model_match_confidence >= MODEL_INTENT_CONFIDENCE_THRESHOLD),
    model_match_confidence: product.model_match_confidence || product.image_match_confidence || 0,
    is_visual_search_match: Boolean(product.image_match_breakdown || product.matched_visual_candidate),
    color_variant_count: colorVariantCount,
    has_more_color_variants: colorVariantCount > 6,
    intelligence: buildProductIntelligenceProfile(product),
    visual_style_tags: getVisualStyleTags(product),
    ...(DEBUG_PRODUCT_CONTEXT && product.image_match_breakdown
      ? {
          image_match_score_breakdown: {
            model_score: product.image_match_breakdown.model_score || 0,
            color_score: product.image_match_breakdown.color_score || 0,
            silhouette_score: product.image_match_breakdown.silhouette_score || 0,
            gender_score: product.image_match_breakdown.gender_score || 0,
            stock_score: product.image_match_breakdown.stock_score || 0,
            final_score: product.image_match_breakdown.final_score || 0,
          },
        }
      : {}),
  });
    return filterAiEligibleProducts([item], { requireProductUrl: true })[0] || null;
  }).filter(Boolean);

const formatProductPriceAr = (product = {}) => {
  const finalPrice = productBestPrice(product);
  return finalPrice > 0
    ? `${Number(finalPrice).toLocaleString("ar-EG-u-nu-latn")} ج.م`
    : "\u0627\u0644\u0633\u0639\u0631 \u063a\u064a\u0631 \u0645\u062d\u062f\u062f \u062d\u0627\u0644\u064a\u0627\u064b";
};

const stockTextAr = (stock) => (Number(stock || 0) > 0 ? "\u0645\u062a\u0627\u062d" : "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d \u062d\u0627\u0644\u064a\u0627\u064b");

const resolveCustomerSize = ({ intent = {}, memory = null } = {}) =>
  toText(intent.product?.size || memory?.preferences?.size || "").toUpperCase();

const hasClearBuyingIntent = (message = "") => {
  const raw = toText(message);
  const normalized = normalizeProductMatchText(raw);
  return (
    /(?:تمام\s*)?(?:اطلبه|اطلبيه|احجزهولي|احجزهالى|ابعتهولي|ابعتهالى|اعمل\s*اوردر|اعمل\s*أوردر|هاتلي\s*واحد|هاتهولي|هاخده|هاخدها|اكد\s*الطلب|أكد\s*الطلب)/iu.test(raw) ||
    /\b(?:buy|order|checkout|reserve it|send it|i'?ll take it)\b/i.test(raw) ||
    [
      "تمام اطلبه",
      "احجزهولي",
      "ابعتهولي",
      "اعمل اوردر",
      "هاتلي واحد",
      "تمام هاخده",
      "هاخده",
    ].some((term) => normalized.includes(normalizeProductMatchText(term)))
  );
};

const requestedSizeAvailabilityTextAr = (product = {}, requestedSize = "") => {
  const profile = product.inventory_profile || buildInventoryProfile(product, requestedSize);
  if (requestedSize) {
    if (profile.requested_size_available) return `ومقاس ${requestedSize} غالبًا متاح عندنا`;
    return `ومقاس ${requestedSize} مش ظاهر متاح حاليًا`;
  }
  return Number(product.total_stock || 0) > 0 ? "والموديل متاح عندنا" : "والموديل مش ظاهر متاح حاليًا";
};

const buildSalesIntroLineAr = ({ product = {}, requestedSize = "" } = {}) => {
  if (!product?.name) return "";
  return `${product.name} سعره ${formatProductPriceAr(product)}، ${requestedSizeAvailabilityTextAr(product, requestedSize)}.`;
};

const buildOrderCollectionResponse = ({ memory = null, metadata = {}, suggested = [] } = {}) => {
  const customerName = toText(metadata.customer_name || memory?.customer_name);
  const customerPhone = toText(metadata.customer_phone || memory?.customer_phone);
  const address = toText(metadata.customer_address || metadata.address || metadata.shipping_address);
  const selectedProduct = Array.isArray(memory?.last_products) && memory.last_products.length ? memory.last_products[0] : suggested[0] || null;
  const productLine = selectedProduct?.name ? `تمام، هنجهز ${selectedProduct.name}.` : "تمام، هنجهز الطلب.";

  if (!customerName) return `${productLine} تشرفنا ❤️ ممكن أعرف اسم حضرتك؟`;
  if (!customerPhone) return `${productLine} يا ${customerName}، ممكن رقم الموبايل؟`;
  if (!address) return `${productLine} ممكن العنوان بالتفصيل؟`;
  return `${productLine} أكدلي المقاس واللون والكمية، ولو فيه أي ملاحظات اكتبها قبل ما نسجل الطلب.`;
};



const clearanceInventoryLineAr = (product = {}, requestedSize = "") => {
  const profile = product.inventory_profile || buildInventoryProfile(product, requestedSize);
  if (profile.requested_size && profile.requested_size_stock === 1) {
    return `مقاسك ${profile.requested_size} موجود في الموديل ده، وفاضل منه آخر قطعة بصراحة.`;
  }
  if (profile.requested_size && profile.requested_size_stock === 2) {
    return `مقاسك ${profile.requested_size} موجود، وفاضل منه قطعتين بس تقريبًا.`;
  }
  if (profile.total_stock === 1) return "الموديل ده فاضل منه آخر قطعة.";
  if (profile.total_stock === 2) return "ده فاضل منه آخر اتنين تقريبًا.";
  if (profile.inventory_state === "low_stock") return "الكميات منه قليلة، فلو مقاسك موجود يبقى اختيار كويس.";
  return "";
};

const recommendationIntroLineAr = (products = [], requestedSize = "") => {
  if (!requestedSize) return "قولي مقاسك الأول عشان أطلعلك المتاح فعلًا.";
  const limitedCount = products.filter((product) => {
    const profile = product.inventory_profile || buildInventoryProfile(product, requestedSize);
    return profile.requested_size_available && (profile.requested_size_limited || profile.total_stock <= 5);
  }).length;
  if (limitedCount >= 2) return `في موديلين فاضل منهم كميات قليلة وفيهم مقاسك ${requestedSize}.`;
  if (limitedCount === 1) return `مقاسك ${requestedSize} موجود في اختيار كميته قليلة.`;
  if (products.length) return `مقاسك ${requestedSize} موجود في الاختيارات دي.`;
  return "";
};

const memorySearchHint = (memory = null) => {
  const preferences = memory?.preferences || {};
  return [
    preferences.size,
    preferences.favorite_color,
    preferences.favorite_style,
    ...(Array.isArray(preferences.favorite_models) ? preferences.favorite_models : []),
    ...(Array.isArray(preferences.preferred_brands) ? preferences.preferred_brands : []),
    memory?.shopping_intent,
    memory?.preferred_category,
  ].map(toText).filter(Boolean).join(" ");
};

const conversationRecommendationState = (memory = null) => {
  const preferences = memory?.preferences || {};
  return {
    rejectedProductIds: unique(Array.isArray(preferences.rejectedProductIds) ? preferences.rejectedProductIds.map(String) : []),
    rejectedModelNames: unique(Array.isArray(preferences.rejectedModelNames) ? preferences.rejectedModelNames : []),
    currentRequestedModel: toText(preferences.currentRequestedModel || ""),
    currentRequestedModelName: toText(preferences.currentRequestedModelName || preferences.currentRequestedModel || ""),
    lastRecommendedProductIds: unique(Array.isArray(preferences.lastRecommendedProductIds) ? preferences.lastRecommendedProductIds.map(String) : []),
    lastVisualQuery: toText(preferences.lastVisualQuery || ""),
    lastVisualFeatures: preferences.lastVisualFeatures && typeof preferences.lastVisualFeatures === "object" ? preferences.lastVisualFeatures : {},
    lastVisualMatches: unique(Array.isArray(preferences.lastVisualMatches) ? preferences.lastVisualMatches.map(String) : []),
    rejectedVisualMatches: unique(Array.isArray(preferences.rejectedVisualMatches) ? preferences.rejectedVisualMatches.map(String) : []),
    pendingAlternativeForModel: toText(preferences.pendingAlternativeForModel || ""),
    pendingAlternativeCategory: toText(preferences.pendingAlternativeCategory || ""),
    pendingAlternativeSourceMessage: toText(preferences.pendingAlternativeSourceMessage || ""),
    pendingAlternativeBrand: toText(preferences.pendingAlternativeBrand || ""),
    pendingAlternativePrice: money(preferences.pendingAlternativePrice),
  };
};

const alternativeConfirmationDetected = (message = "") => {
  const normalized = normalizeProductMatchText(message);
  if (!normalized || normalized.length > 40) return false;
  const confirmations = new Set([
    "ايوه",
    "اه",
    "تمام",
    "طلع",
    "طلعلي",
    "وريني",
    "ابعت",
    "ابعتلي",
    "ماشي",
  ]);
  return confirmations.has(normalized) || /^(ايوه|اه|تمام|طلعلي?|وريني|ابعتلي?|ماشي)(\s+.+)?$/i.test(normalized);
};

const alternativeCategoryForModel = ({ message = "", modelIntent = null } = {}) => {
  const requestedKind = detectRequestedProductKind(message);
  if (requestedKind?.kind) return requestedKind.kind;
  if (modelIntent?.family || modelIntent?.displayName) return "sneaker";
  return "product";
};

const alternativeBrandForModel = (modelIntent = null) => {
  const tokens = (modelIntent?.familyTokens || []).map(toText).filter(Boolean);
  if (tokens.includes("nike")) return "nike";
  if (tokens.includes("jordan")) return "jordan";
  return tokens[0] || "";
};

const pendingAlternativePatch = ({ modelIntent = null, message = "" } = {}) => ({
  pendingAlternativeForModel: modelIntent?.displayName || toText(message),
  pendingAlternativeCategory: alternativeCategoryForModel({ message, modelIntent }),
  pendingAlternativeSourceMessage: toText(message),
  pendingAlternativeBrand: alternativeBrandForModel(modelIntent),
  pendingAlternativePrice: null,
});

const clearPendingAlternativePatch = () => ({
  pendingAlternativeForModel: "",
  pendingAlternativeCategory: "",
  pendingAlternativeSourceMessage: "",
  pendingAlternativeBrand: "",
  pendingAlternativePrice: null,
});

const alternativeSearchMessage = ({ state = {}, modelIntent = null } = {}) => {
  const category = state.pendingAlternativeCategory || "sneaker";
  const brand = state.pendingAlternativeBrand || alternativeBrandForModel(modelIntent);
  const familyTerms = (modelIntent?.familyTokens || []).filter((token) => !/^\d+$/.test(token));
  const styleTerms = modelIntent?.key === "jordan4"
    ? ["high top", "basketball", "streetwear", "chunky"]
    : [];
  return unique([
    category,
    brand,
    ...familyTerms,
    ...styleTerms,
    "available",
  ]).join(" ");
};

const scoreAlternativeProduct = ({ product = {}, state = {}, modelIntent = null } = {}) => {
  const blob = productSearchBlob(product);
  const category = normalizeProductMatchText(state.pendingAlternativeCategory);
  const brand = normalizeProductMatchText(state.pendingAlternativeBrand || alternativeBrandForModel(modelIntent));
  const price = money(state.pendingAlternativePrice);
  const productPrice = productBestPrice(product);
  let score = 0;
  if (Number(product.total_stock || 0) > 0) score += 5_000;
  if (category && blob.includes(category)) score += 1_500;
  if (brand && blob.includes(brand)) score += 1_000;
  for (const token of (modelIntent?.familyTokens || [])) {
    if (token && !/^\d+$/.test(token) && blob.includes(normalizeProductMatchText(token))) score += 420;
  }
  for (const term of ["sneaker", "shoe", "high", "basketball", "streetwear", "chunky"]) {
    if (blob.includes(term)) score += 90;
  }
  if (price > 0 && productPrice > 0) {
    const distance = Math.abs(productPrice - price) / price;
    if (distance <= 0.15) score += 500;
    else if (distance <= 0.3) score += 260;
    else if (distance > 0.6) score -= 250;
  }
  score += Math.round(Number(getProductIntelligence(product).priority_score || 0) / 3);
  return score;
};

const buildAlternativeProducts = async ({ tenantId, state = {}, req = null, memory = null } = {}) => {
  const modelIntent = detectStrictModelIntent(state.pendingAlternativeForModel || state.pendingAlternativeSourceMessage);
  const understanding = detectSalesProductUnderstanding({
    message: state.pendingAlternativeForModel || state.pendingAlternativeSourceMessage || "",
    memory,
    source: "alternative_products",
  });
  const message = alternativeSearchMessage({ state, modelIntent });
  const intent = detectAiSupportIntent(message);
  const activeProductId = Number(
    memory?.activeProductId ||
      memory?.selectedProductId ||
      memory?.lastProductCard?.product_id ||
      memory?.lastProductCard?.id ||
      0
  );
  const similarResult = activeProductId
    ? await findSimilarProductsForAi({
        tenantId,
        activeProductId,
        activeVariantId: memory?.activeVariantId || memory?.selectedVariantId || memory?.lastProductCard?.variant_id || null,
        activeColor: memory?.activeColor || memory?.selectedColor || memory?.lastProductCard?.color || "",
        customerSize: memory?.preferences?.size || "",
        limit: 8,
      }).catch((error) => {
        console.warn("[ai-orchestrator:similar-engine-skipped]", { tenant_id: tenantId, activeProductId, message: error?.message || String(error) });
        return { products: [] };
      })
    : { products: [] };
  const rawProducts = similarResult.products?.length ? similarResult.products : await searchProducts({ tenantId, message, intent, req, memory });
  const fallbackProducts = rawProducts.length
    ? []
    : rankProductsForIntent({
        products: await loadVisualSearchProducts({ tenantId, intent, req }),
        message,
        intent,
        memory,
      });
  const candidateProducts = rawProducts.length ? rawProducts : fallbackProducts;
  const rejectedIds = new Set([...(state.rejectedProductIds || []), ...(state.rejectedVisualMatches || [])].map(String));
  const preGateAlternatives = candidateProducts
    .filter((product) => Number(product.total_stock || 0) > 0)
    .filter((product) => !rejectedIds.has(String(product.id)))
    .filter((product) => !productMatchesRejectedModel(product, state.rejectedModelNames || []))
    .filter((product) => {
      if (!modelIntent) return true;
      const assessment = productModelMatchAssessment({ product, modelIntent, queryText: modelIntent.displayName, intent: detectAiSupportIntent(modelIntent.displayName) });
      return assessment.confidence < MODEL_INTENT_CONFIDENCE_THRESHOLD;
    })
    .sort((left, right) => scoreAlternativeProduct({ product: right, state, modelIntent }) - scoreAlternativeProduct({ product: left, state, modelIntent }));
  const alternatives = gateRelevantProducts({
    products: preGateAlternatives,
    understanding,
    limit: 3,
    fallback: true,
  });
  console.log("[ai-orchestrator:candidates]", {
    exact_count: 0,
    family_count: rawProducts.length,
    similar_count: similarResult.products?.length || alternatives.length,
    fallback_count: fallbackProducts.length,
  });
  return {
    modelIntent,
    searchMessage: message,
    understanding,
    alternatives,
    noAlternativeReason: alternatives.length
      ? ""
      : candidateProducts.length
        ? "all_candidates_rejected_out_of_stock_or_exact_model"
        : "no_candidate_products_found",
  };
};

const productMatchesRejectedModel = (product = {}, rejectedModelNames = []) => {
  const blob = productSearchBlob(product);
  return rejectedModelNames.some((modelName) => {
    const modelIntent = detectStrictModelIntent(modelName);
    if (modelIntent) {
      const assessment = productModelMatchAssessment({ product, modelIntent, queryText: modelName, intent: detectAiSupportIntent(modelName) });
      return assessment.confidence >= MODEL_INTENT_CONFIDENCE_THRESHOLD;
    }
    const normalized = normalizeProductMatchText(modelName);
    return normalized && blob.includes(normalized);
  });
};

const filterProductsByConversationState = ({ products = [], state = {}, currentModelIntent = null, intent = {}, message = "" } = {}) => {
  const rejectedIds = new Set([...(state.rejectedProductIds || []), ...(state.rejectedVisualMatches || [])].map(String));
  const queryText = productQueryText(currentModelIntent?.displayName || message, intent);
  return products.filter((product) => {
    if (currentModelIntent) {
      const assessment = productModelMatchAssessment({ product, modelIntent: currentModelIntent, queryText, intent });
      return assessment.confidence >= MODEL_INTENT_CONFIDENCE_THRESHOLD;
    }
    if (rejectedIds.has(String(product.id))) return false;
    if (productMatchesRejectedModel(product, state.rejectedModelNames || [])) return false;
    return true;
  });
};

const mergeCurrentTurnMemory = ({ memory = null, message = "", req = null } = {}) => {
  const metadata = req?.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
  const extracted = extractAiConversationMemory({
    message,
    metadata: {
      ...metadata,
      customer_phone: metadata.customer_phone || req?.body?.customer_phone || "",
      customer_name: metadata.customer_name || req?.body?.customer_name || "",
    },
  });
  return {
    ...(memory || {}),
    preferences: {
      ...(memory?.preferences || {}),
      ...(extracted.preferences || {}),
    },
    negative_preferences: {
      ...(memory?.negative_preferences || {}),
      ...(extracted.negative_preferences || {}),
    },
    shopping_intent: extracted.shopping_intent || memory?.shopping_intent || "",
    preferred_category: extracted.preferred_category || memory?.preferred_category || extracted.preferences?.preferred_category || "",
    customer_state: extracted.customer_state || memory?.customer_state || "browsing",
    conversation_tone: extracted.conversation_tone || memory?.conversation_tone || "friendly",
    urgency_level: extracted.urgency_level || memory?.urgency_level || "low",
  };
};

const FUNNEL_CHIPS = Object.freeze({
  style: [
    { label: "يومي", value: "daily", message: "يومي" },
    { label: "خروجات", value: "outfit", message: "خروجات" },
    { label: "ترند", value: "trending", message: "ترند" },
    { label: "clean", value: "clean", message: "clean" },
    { label: "chunky", value: "chunky", message: "chunky" },
  ],
  color: [
    { label: "أبيض", value: "white", message: "أبيض" },
    { label: "أسود", value: "black", message: "أسود" },
    { label: "بيج", value: "beige", message: "بيج" },
    { label: "ملون", value: "colorful", message: "ملون" },
  ],
  size: ["40", "41", "42", "43", "44", "45"].map((size) => ({ label: size, value: size, message: size })),
  refine: [
    { label: "تغيير المقاس", value: "size", message: "تغيير المقاس" },
    { label: "وريني الأسود", value: "black", message: "وريني الأسود" },
    { label: "حاجة أرخص", value: "cheaper", message: "حاجة أرخص" },
    { label: "ترند أكتر", value: "trending", message: "ترند أكتر" },
  ],
});

const funnelAction = (step, chip, selected = false) => ({
  type: "ai_funnel_chip",
  step,
  label: chip.label,
  value: chip.value,
  message: chip.message || chip.label,
  selected,
});

const normalizeFunnelColor = (value = "") => {
  const text = normalizeProductMatchText(value);
  if (/black|اسود|أسود/.test(text)) return "black";
  if (/white|ابيض|أبيض/.test(text)) return "white";
  if (/beige|بيج|cream|كريمي/.test(text)) return "beige";
  if (/color|ملون/.test(text)) return "colorful";
  return text;
};

const normalizeFunnelStyle = (value = "") => {
  const text = normalizeProductMatchText(value);
  if (/daily|يومي|جامعة|college/.test(text)) return "daily";
  if (/outfit|خروج|خروجات|شيك/.test(text)) return "outfit";
  if (/trend|ترند/.test(text)) return "trending";
  if (/clean|minimal/.test(text)) return "clean";
  if (/chunky|ضخم/.test(text)) return "chunky";
  return text;
};

const deriveQuickFunnelState = ({ message = "", intent = {}, memory = null, products = [] } = {}) => {
  const preferences = memory?.preferences || {};
  const selected = {
    style: normalizeFunnelStyle(preferences.favorite_style || ""),
    color: normalizeFunnelColor(preferences.favorite_color || ""),
    size: toText(preferences.size || intent.product?.size),
    gender: toText(preferences.gender || ""),
    product_type: toText(preferences.preferred_category || memory?.preferred_category || ""),
  };
  if (!selected.style) selected.style = normalizeFunnelStyle(intent.product?.intelligence?.style?.labels?.[0] || intent.product?.intelligence?.styles?.[0] || "");
  if (!selected.color && intent.product?.colors?.length) selected.color = normalizeFunnelColor(intent.product.colors[0]);
  if (!selected.size && intent.product?.size) selected.size = intent.product.size;
  if (!selected.product_type) selected.product_type = detectRequestedProductKind(message)?.kind || "";

  const hasShoppingSignal = intent.type === "product" || intent.type === "product_discovery" || intent.product?.intelligence?.hasIntent || Object.values(selected).some(Boolean);
  if (!hasShoppingSignal && !products.length) {
    return {
      active: true,
      current_step: "style",
      selected,
      prompt: "بتدور على أي نوع منتج؟ قولّي المقاس أو اللون أو ابعت صورة.",
      chips: FUNNEL_CHIPS.style.map((chip) => funnelAction("style", chip, selected.style === chip.value)),
    };
  }

  let currentStep = "results";
  let prompt = products.length
    ? "دي أقرب اختيارات متاحة حسب طلبك."
    : "تمام، نضيق الاختيارات بسرعة.";
  if (!selected.style) {
    currentStep = "style";
    prompt = selected.product_type
      ? "تحبها يومي ولا خروجات؟"
      : "بتدور على أي نوع منتج؟ قولّي المقاس أو اللون أو ابعت صورة.";
  } else if (!selected.color) {
    currentStep = "color";
    prompt = selected.style === "clean" ? "تمام، تحب أبيض ولا أسود أكتر؟" : "تحب لون هادي ولا حاجة ملفتة؟";
  } else if (!selected.size) {
    currentStep = "size";
    prompt = "مقاسك كام؟";
  }

  const chips = currentStep === "results"
    ? FUNNEL_CHIPS.refine.map((chip) => funnelAction(chip.value === "size" ? "size" : chip.value === "black" ? "color" : "style", chip, false))
    : FUNNEL_CHIPS[currentStep].map((chip) => funnelAction(currentStep, chip, selected[currentStep] === chip.value || selected[currentStep] === chip.label));

  return {
    active: true,
    current_step: currentStep,
    selected,
    prompt,
    chips,
  };
};


const buildDirectProductResponse = ({ message = "", intent, products = [], req = null, memory = null } = {}) => {
  const items = suggestedProducts(products, req);
  if (!items.length || (!intent.product?.asksPrice && !intent.product?.asksAvailability)) return null;

  const topProducts = products.slice(0, 3);
  const sourceIds = items.map((product) => `product_${product.id}`);
  const top = topProducts[0];
  const queryText = productQueryText(message, intent);
  const strictModelIntent = detectStrictModelIntent(message);
  const topScore = productRankScore({ product: top, queryText, intent });
  const secondScore = topProducts[1] ? productRankScore({ product: topProducts[1], queryText, intent }) : 0;
  const hasSingleStrongMatch =
    topProducts.length === 1 ||
    (topScore >= 900 && topScore - secondScore >= 180);

  let answer = "";
  if (intent.product?.asksAvailability) {
    const requestedSize = resolveCustomerSize({ intent, memory });
    if (requestedSize && topProducts.length) {
      const lines = topProducts.map((product) => {
        const profile = product.inventory_profile || buildInventoryProfile(product, requestedSize);
        const status = profile.requested_size_available
          ? `${stockTextAr(profile.requested_size_stock)} (${Number(profile.requested_size_stock).toLocaleString("ar-EG-u-nu-latn")} \u0642\u0637\u0639\u0629)`
          : "\u0627\u0644\u0645\u0642\u0627\u0633 \u0645\u0634 \u0645\u062a\u0627\u062d \u062d\u0627\u0644\u064a\u0627\u064b";
        const strength = profile.requested_size_strong ? " - اختيار آمن" : profile.requested_size_limited ? " - محدود" : "";
        return `${product.name}: \u0645\u0642\u0627\u0633 ${requestedSize} - ${status}${strength}`;
      });
      answer = `${recommendationIntroLineAr(topProducts, requestedSize)}\n\u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0645\u0642\u0627\u0633 ${requestedSize}:\n${lines.join("\n")}`.trim();
    } else {
      const lines = topProducts.map((product) => `${product.name}: ${stockTextAr(product.total_stock)}${Number(product.total_stock || 0) > 0 ? ` (${Number(product.total_stock).toLocaleString("ar-EG-u-nu-latn")} \u0642\u0637\u0639\u0629)` : ""}`);
      answer = lines.length === 1 ? `${top.name} ${stockTextAr(top.total_stock)}.` : `${recommendationIntroLineAr(topProducts)}\n\u0623\u0647\u0645 \u0627\u0644\u0646\u062a\u0627\u064a\u062c:\n${lines.join("\n")}`.trim();
    }
  } else if (intent.product?.asksPrice) {
    if (hasSingleStrongMatch) {
      answer = `${top.name}: ${formatProductPriceAr(top)}.`;
    } else {
      const lines = topProducts.map((product) => `${product.name}: ${formatProductPriceAr(product)} - ${stockTextAr(product.total_stock)}`);
      answer = `\u062f\u064a \u0623\u0642\u0631\u0628 \u0646\u062a\u0627\u064a\u062c \u0644\u0644\u0633\u0639\u0631:\n${lines.join("\n")}`;
    }
  }

  if (answer && top) {
    const limited = topProducts.find((product) => (product.inventory_profile || buildInventoryProfile(product)).low_inventory);
    const limitedLine = limited ? clearanceInventoryLineAr(limited, resolveCustomerSize({ intent, memory })) : "";
    if (strictModelIntent) {
      answer = `${answer}${limitedLine ? ` ${limitedLine}` : ""}\n\u062a\u062d\u0628 \u0627\u0644\u0635\u0648\u0631 \u0623\u0648 \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629\u061f`;
    } else {
      answer = `${answer} ${getRandomPersonalityLine(top)}، ${getRandomSellingPoint(top)}.${limitedLine ? ` ${limitedLine}` : ""}`;
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

const modelProductLinesAr = (products = []) =>
  products.slice(0, 3).map((product) => `${product.name}: ${formatProductPriceAr(product)} - ${stockTextAr(product.total_stock)}`);

const buildProductDiscoveryResponse = ({ message = "", intent, products = [], req = null, memory = null }) => {
  const items = suggestedProducts(products, req);
  const strictModelIntent = detectStrictModelIntent(message);
  const styleIntent = intent.product?.intelligence?.style;
  const requestedSize = resolveCustomerSize({ intent, memory });
  if (strictModelIntent) {
    if (items.length) {
      const lines = modelProductLinesAr(products);
      return {
        answer: `${lines.join("\n")}\n\u062a\u062d\u0628 \u0627\u0644\u0635\u0648\u0631 \u0623\u0648 \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629\u061f`,
        confidence: 0.94,
        needs_human_support: false,
        sources_used: items.map((product) => `product_${product.id}`),
        suggested_products: items,
        suggested_actions: ["view_product", "choose_size", "show_similar_products", "contact_support"],
      };
    }
    return {
      answer: modelUnavailableReply(strictModelIntent.displayName),
      confidence: 0.96,
      needs_human_support: false,
      sources_used: [],
      suggested_products: [],
      suggested_actions: ["show_similar_products", "contact_support"],
      ai_memory_patch: {
        preferences: pendingAlternativePatch({ modelIntent: strictModelIntent, message }),
      },
    };
  }
  if (styleIntent?.hasIntent) {
    if (!requestedSize) {
      const styleLine = styleIntent.response_hint || "تمام، هطلعلك اختيارات ماشية مع الستايل ده.";
      return {
        answer: `${styleLine} قولي مقاسك الأول عشان أرشحلك حاجة موجودة فعلًا ومناسبة للتصفية.`,
        confidence: 0.9,
        needs_human_support: false,
        sources_used: items.map((product) => `product_${product.id}`),
        suggested_products: items.slice(0, 3),
        suggested_actions: ["choose_size", "show_similar_products", "contact_support"],
      };
    }
    const styleLine = styleIntent.response_hint || "تمام، هطلعلك اختيارات ماشية مع الستايل ده.";
    if (items.length) {
      const topProducts = products.slice(0, 3);
      const names = topProducts.map((product) => product.name).filter(Boolean).join("، ");
      const sizeQuestion = "مقاسك كام عشان أظبطهالك على المتاح؟";
      const sizeLine = requestedSize ? recommendationIntroLineAr(topProducts, requestedSize) : sizeQuestion;
      return {
        answer: `${styleLine} أرشحلك: ${names}. ${sizeLine}`,
        confidence: 0.94,
        needs_human_support: false,
        sources_used: items.map((product) => `product_${product.id}`),
        suggested_products: items,
        suggested_actions: ["view_product", "show_similar_products", "choose_size", "contact_support"],
      };
    }
    return {
      answer: `${styleLine} قولّي مقاسك واللون اللي بتحبه، وأنا أطلعلك أقرب حاجة متاحة.`,
      confidence: 0.82,
      needs_human_support: false,
      sources_used: [],
      suggested_products: [],
      suggested_actions: ["show_similar_products", "choose_size"],
    };
  }
  if (intent.product?.mentionsImageModel) {
    return {
      answer: "لو معاك صورة الموديل هطلعلك أقرب حاجة عندنا. ولو عايز ترشيح سريع، قولّي مقاسك واللوك رايح كاجوال ولا خروجة.",
      confidence: 1,
      needs_human_support: false,
      sources_used: [],
      suggested_products: items,
      suggested_actions: ["show_similar_products"],
    };
  }
  if (items.length) {
    const top = products[0] || {};
    if (strictModelIntent) {
      const lines = modelProductLinesAr(products);
      return {
        answer: `${lines.join("\n")}\n\u062a\u062d\u0628 \u0627\u0644\u0635\u0648\u0631 \u0623\u0648 \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629\u061f`,
        confidence: 0.94,
        needs_human_support: false,
        sources_used: items.map((product) => `product_${product.id}`),
        suggested_products: items,
        suggested_actions: ["view_product", "choose_size", "show_similar_products", "contact_support"],
      };
    }
    if (!requestedSize) {
      return {
        answer: `${buildSalesIntroLineAr({ product: top })} تحب أراجعلك مقاس كام؟`.trim(),
        confidence: 0.86,
        needs_human_support: false,
        sources_used: items.map((product) => `product_${product.id}`),
        suggested_products: items.slice(0, 3),
        suggested_actions: ["choose_size", "show_similar_products", "contact_support"],
      };
    }
    const line = getRandomPersonalityLine(top);
    const point = getRandomSellingPoint(top);
    const urgency = clearanceInventoryLineAr(top, requestedSize);
    return {
      answer: `${buildSalesIntroLineAr({ product: top, requestedSize })} ${line}. ${point}. ${urgency}`.trim(),
      confidence: 0.9,
      needs_human_support: false,
      sources_used: items.map((product) => `product_${product.id}`),
      suggested_products: items,
      suggested_actions: ["view_product", "show_similar_products", "choose_size", "contact_support"],
    };
  }
  if (strictModelIntent) {
    return {
      answer: modelUnavailableReply(strictModelIntent.displayName),
      confidence: 0.96,
      needs_human_support: false,
      sources_used: [],
      suggested_products: [],
      suggested_actions: ["show_similar_products", "contact_support"],
      ai_memory_patch: {
        preferences: pendingAlternativePatch({ modelIntent: strictModelIntent, message }),
      },
    };
  }
  return {
    answer: "ندخل على حاجة شيك ولا يومي؟ مقاسك كام واللوك رايح جينز، كارجو، ولا تراكسوت؟",
    confidence: 0.8,
    needs_human_support: false,
    sources_used: [],
    suggested_products: [],
    suggested_actions: ["show_similar_products", "choose_size"],
  };
};

const uniqueSearchParts = (items = []) =>
  unique(
    items
      .flatMap((item) => (Array.isArray(item) ? item : String(item || "").split(/[,\n/|]+/)))
      .map((item) => toText(item))
      .filter(Boolean)
  );

const VISUAL_VARIANT_IMAGE_SOURCES = new Set(["variant", "product_variant_images"]);
const EXACT_VARIANT_TOP_PRIORITY_SCORE = 10_000_000;

const isVariantVisualCandidate = (candidate = {}) => VISUAL_VARIANT_IMAGE_SOURCES.has(candidate?.image_source || candidate?.matched_visual_candidate?.image_source);
const normalizeVisualImageOwnerUrl = (value = "") => resolveStorefrontProductImageUrl(value).split(/[?#]/)[0].toLowerCase();

const variantIdsInProduct = (product = {}) =>
  unique((Array.isArray(product.variants) ? product.variants : []).map((variant) => variant?.id).filter((value) => value !== null && value !== undefined));

const imageUrlsInProduct = (product = {}) =>
  unique(
    [
      product.image_url,
      product.product_image_url,
      product.main_image,
      product.image,
      product.thumbnail,
      product.matched_variant_image,
      product.matched_image_url,
      product.matched_visual_candidate?.image_url,
      ...normalizeJsonArray(product.product_images).map((image) => firstImageValue(image)),
      ...normalizeJsonArray(product.gallery_images).map((image) => firstImageValue(image)),
      ...(Array.isArray(product.variants)
        ? product.variants.flatMap((variant) => [
            variant?.image_url,
            variant?.primary_image_url,
            variant?.variant_image_url,
            variant?.color_image_url,
            variant?.image,
            variant?.main_image,
            variant?.thumbnail,
            ...normalizeJsonArray(variant?.product_images).map((image) => firstImageValue(image)),
            ...normalizeJsonArray(variant?.images).map((image) => firstImageValue(image)),
          ])
        : []),
    ]
      .map(resolveStorefrontProductImageUrl)
      .filter(Boolean)
  );

const productImageOwnershipDebugRows = (products = []) =>
  products.map((product, index) => ({
    rank: index + 1,
    product_id: product.id,
    name: product.name,
    matched_variant_id: product.matched_variant_id ?? product.matched_visual_candidate?.variant_id ?? null,
    matched_variant_image: product.matched_variant_image || "",
    matched_image_url: product.matched_image_url || "",
    selected_card_image_url: product.matched_variant_image || product.matched_visual_candidate?.image_url || product.matched_image_url || product.image_url || "",
    contained_variant_ids: variantIdsInProduct(product),
    contained_image_urls: imageUrlsInProduct(product).slice(0, 24),
  }));

const isExactVariantMatchedProduct = ({ product = {}, fallbackUsedVisualCandidates = false, candidateFirstMinimumScore = 300 } = {}) =>
  Boolean(
    product.matched_variant_id &&
      (product.matched_variant_image || product.matched_image_url || product.matched_visual_candidate?.image_url) &&
      isVariantVisualCandidate(product) &&
      (
        product.image_match_breakdown?.exact_image_candidate_match ||
        product.image_match_breakdown?.exact_model_match ||
        product.image_match_breakdown?.hard_filter_match ||
        Number(product.image_match_score || product.image_match_breakdown?.final_score || 0) >= (fallbackUsedVisualCandidates ? candidateFirstMinimumScore : 1_350)
      )
  );

const visualProductSortBucket = (product = {}) => {
  const breakdown = product.image_match_breakdown || {};
  if (product.forced_exact_variant_rank || isExactVariantMatchedProduct({ product })) return 0;
  if ((breakdown.exact_model_match || breakdown.hard_filter_match) && Number(breakdown.color_score || 0) > 0) return 1;
  if (breakdown.exact_model_match || breakdown.hard_filter_match || breakdown.close_model_match) return 2;
  if (Number(product.image_match_score || breakdown.final_score || 0) >= 760) return 3;
  return 4;
};

const topRankReason = (product = {}) => {
  const bucket = visualProductSortBucket(product);
  if (bucket === 0) return "exact_matched_variant_image";
  if (bucket === 1) return "same_model_same_color";
  if (bucket === 2) return "same_model_different_color";
  if (bucket === 3) return "visually_similar_product";
  return "loosely_related_product";
};

const forceExactVariantTopRank = ({ products = [], exactVariantProduct = null } = {}) => {
  if (!exactVariantProduct) {
    return { products, forcedExactVariantRank: false, forcedRankPosition: null };
  }
  const exactId = String(exactVariantProduct.id);
  const existingIndex = products.findIndex((product) => String(product.id) === exactId);
  const exactProduct = {
    ...(existingIndex >= 0 ? products[existingIndex] : exactVariantProduct),
    top_priority_score: EXACT_VARIANT_TOP_PRIORITY_SCORE,
    forced_exact_variant_rank: true,
    forced_rank_position: 1,
    top_rank_reason: "exact_matched_variant_image",
  };
  return {
    products: [exactProduct, ...products.filter((product) => String(product.id) !== exactId)],
    forcedExactVariantRank: true,
    forcedRankPosition: 1,
  };
};

const findExactVariantRankTarget = ({ visualCandidates = [], scoredProducts = [], fallbackUsedVisualCandidates = false, candidateFirstMinimumScore = 300 } = {}) => {
  const isStrongVariantCandidate = (candidate = {}) =>
    Boolean(
      isVariantVisualCandidate(candidate) &&
        candidate.variant_id &&
        candidate.image_url &&
        (
          candidate.score_breakdown?.exact_image_candidate_match ||
          candidate.score_breakdown?.exact_model_match ||
          candidate.score_breakdown?.hard_filter_match ||
          Number(candidate.image_match_score || candidate.score_breakdown?.final_score || 0) >= (fallbackUsedVisualCandidates ? candidateFirstMinimumScore : 1_350)
        )
    );
  const imageCandidate = visualCandidates.find(isStrongVariantCandidate) || null;
  const matchedImageUrl = imageCandidate?.image_url || "";
  const normalizedMatchedImageUrl = normalizeVisualImageOwnerUrl(matchedImageUrl);
  const imageOwnerProduct = imageCandidate?.product_id
    ? scoredProducts.find((product) => String(product.id) === String(imageCandidate.product_id)) ||
      (normalizedMatchedImageUrl
        ? scoredProducts.find((product) => imageUrlsInProduct(product).some((imageUrl) => normalizeVisualImageOwnerUrl(imageUrl) === normalizedMatchedImageUrl)) || null
        : null)
    : null;
  const variantOwnerProduct = imageCandidate?.variant_id
    ? scoredProducts.find((product) => variantIdsInProduct(product).some((variantId) => String(variantId) === String(imageCandidate.variant_id))) || null
    : null;
  const targetProduct = imageOwnerProduct || variantOwnerProduct || null;
  const mismatchDetected = Boolean(imageOwnerProduct && variantOwnerProduct && String(imageOwnerProduct.id) !== String(variantOwnerProduct.id));

  if (!targetProduct) {
    return {
      exactVariantProduct: null,
      exactMatchImageOwnerProductId: imageOwnerProduct?.id ?? imageCandidate?.product_id ?? null,
      exactMatchVariantOwnerProductId: variantOwnerProduct?.id ?? null,
      forcedRankTargetProductId: null,
      forcedRankTargetReason: "",
      forcedRankMismatchDetected: mismatchDetected,
      matchedVariantImage: matchedImageUrl,
      exactMatchVariantId: imageCandidate?.variant_id ?? null,
    };
  }

  const targetCandidate = String(targetProduct.id) === String(imageCandidate?.product_id)
    ? imageCandidate
    : visualCandidates.find(
        (candidate) =>
          String(candidate.product_id) === String(targetProduct.id) &&
          normalizeVisualImageOwnerUrl(candidate.image_url) === normalizedMatchedImageUrl
      ) || imageCandidate;
  const imageMatchBreakdown = targetCandidate?.score_breakdown || targetProduct.image_match_breakdown || {};

  return {
    exactVariantProduct: {
      ...targetProduct,
      image_url: matchedImageUrl || targetProduct.image_url,
      product_image_url: matchedImageUrl || targetProduct.product_image_url,
      selected_image_source: targetCandidate?.raw_image_url || matchedImageUrl || targetProduct.selected_image_source,
      selected_image_field: `matched_${targetCandidate?.image_source || targetProduct.matched_visual_candidate?.image_source || "variant"}_image`,
      matched_image_url: matchedImageUrl || targetProduct.matched_image_url,
      matched_image_source: targetCandidate?.image_source || targetProduct.matched_image_source,
      matched_variant_id: targetCandidate?.variant_id ?? targetProduct.matched_variant_id,
      matched_variant_color: targetCandidate?.color || targetProduct.matched_variant_color || "",
      matched_variant_size: targetCandidate?.size || targetProduct.matched_variant_size || "",
      matched_variant_image: matchedImageUrl || targetProduct.matched_variant_image || "",
      matched_visual_candidate: {
        ...(targetProduct.matched_visual_candidate || {}),
        candidate_rank: targetCandidate?.candidate_rank ?? targetProduct.matched_visual_candidate?.candidate_rank,
        product_id: targetProduct.id,
        product_name: targetProduct.name,
        variant_id: targetCandidate?.variant_id ?? targetProduct.matched_visual_candidate?.variant_id ?? targetProduct.matched_variant_id ?? null,
        image_url: matchedImageUrl || targetProduct.matched_visual_candidate?.image_url || "",
        image_source: targetCandidate?.image_source || targetProduct.matched_visual_candidate?.image_source || "variant",
        color: targetCandidate?.color || targetProduct.matched_visual_candidate?.color || "",
        size: targetCandidate?.size || targetProduct.matched_visual_candidate?.size || "",
        sku: targetCandidate?.sku || targetProduct.matched_visual_candidate?.sku || "",
        stock: targetCandidate?.stock ?? targetProduct.matched_visual_candidate?.stock ?? targetProduct.total_stock ?? 0,
        status: targetCandidate?.status || targetProduct.matched_visual_candidate?.status || "",
        price: targetCandidate?.price ?? targetProduct.matched_visual_candidate?.price ?? targetProduct.price,
        final_price: targetCandidate?.final_price ?? targetProduct.matched_visual_candidate?.final_price ?? productBestPrice(targetProduct),
      },
      image_match_score: imageMatchBreakdown.final_score || targetProduct.image_match_score,
      image_match_breakdown: imageMatchBreakdown,
    },
    exactMatchImageOwnerProductId: imageOwnerProduct?.id ?? imageCandidate?.product_id ?? null,
    exactMatchVariantOwnerProductId: variantOwnerProduct?.id ?? null,
    forcedRankTargetProductId: targetProduct.id,
    forcedRankTargetReason: imageOwnerProduct ? "matched_variant_image_owner" : "matched_variant_id_owner",
    forcedRankMismatchDetected: mismatchDetected,
    matchedVariantImage: matchedImageUrl,
    exactMatchVariantId: targetCandidate?.variant_id ?? imageCandidate?.variant_id ?? null,
  };
};

const sortVisualProductsByPriority = (products = []) =>
  products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => {
      const priorityDiff = visualProductSortBucket(left.product) - visualProductSortBucket(right.product);
      if (priorityDiff !== 0) return priorityDiff;
      const topPriorityDiff = Number(right.product.top_priority_score || 0) - Number(left.product.top_priority_score || 0);
      if (topPriorityDiff !== 0) return topPriorityDiff;
      return left.index - right.index;
    })
    .map(({ product }, index) => ({
      ...product,
      final_rank_position: index + 1,
      top_rank_reason: product.top_rank_reason || topRankReason(product),
    }));

const imageRankingDebugRows = (products = []) =>
  products.map((product, index) => ({
    rank: index + 1,
    id: product.id,
    name: product.name,
    sku: product.sku || "",
    brand: product.brand || "",
    category: product.category || "",
    gender: product.gender || "",
    stock: product.total_stock,
    candidate_image_url: product.matched_visual_candidate?.image_url || "",
    candidate_source: product.matched_visual_candidate?.image_source || "",
    variant_id: product.matched_visual_candidate?.variant_id ?? product.matched_variant_id ?? null,
    variant_color: product.matched_visual_candidate?.color || product.matched_variant_color || "",
    variant_size: product.matched_visual_candidate?.size || product.matched_variant_size || "",
    visual_score: product.image_match_breakdown?.final_score || product.image_match_score || 0,
    top_priority_score: product.top_priority_score || 0,
    forced_exact_variant_rank: Boolean(product.forced_exact_variant_rank),
    forced_rank_position: product.forced_rank_position || null,
    top_rank_reason: product.top_rank_reason || topRankReason(product),
    is_exact_candidate: Boolean(product.image_match_breakdown?.exact_image_candidate_match || product.image_match_breakdown?.exact_model_match || product.image_match_breakdown?.hard_filter_match),
    model_score: product.image_match_breakdown?.model_score || 0,
    brand_score: product.image_match_breakdown?.brand_score || 0,
    brand_confidence: product.image_match_breakdown?.brand_confidence || 0,
    color_score: product.image_match_breakdown?.color_score || 0,
    color_mismatch_penalty: product.image_match_breakdown?.color_mismatch_penalty || 0,
    missing_required_colors: product.image_match_breakdown?.missing_required_colors || [],
    category_score: product.image_match_breakdown?.category_score || 0,
    feature_score: product.image_match_breakdown?.feature_score || 0,
    feature_boost: product.image_match_breakdown?.feature_boost || 0,
    feature_mismatch_penalty: product.image_match_breakdown?.feature_mismatch_penalty || 0,
    material_score: product.image_match_breakdown?.material_score || 0,
    silhouette_score: product.image_match_breakdown?.silhouette_score || 0,
    silhouette_boost: product.image_match_breakdown?.silhouette_boost || 0,
    silhouette_mismatch_penalty: product.image_match_breakdown?.silhouette_mismatch_penalty || 0,
    visual_silhouette: product.image_match_breakdown?.visual_silhouette || {},
    product_silhouette: product.image_match_breakdown?.product_silhouette || {},
    gender_score: product.image_match_breakdown?.gender_score || 0,
    stock_score: product.image_match_breakdown?.stock_score || 0,
    price_score: product.image_match_breakdown?.price_score || 0,
    image_similarity_hint_score: product.image_match_breakdown?.image_similarity_hint_score || 0,
    low_visual_penalty: product.image_match_breakdown?.low_visual_penalty || 0,
    total_penalty: product.image_match_breakdown?.total_penalty || 0,
    final_score: product.image_match_breakdown?.final_score || 0,
    candidate_rank: product.matched_visual_candidate?.candidate_rank || null,
    exact_model_match: Boolean(product.image_match_breakdown?.exact_model_match),
    close_model_match: Boolean(product.image_match_breakdown?.close_model_match),
    hard_filter_match: Boolean(product.image_match_breakdown?.hard_filter_match),
    exact_image_candidate_match: Boolean(product.image_match_breakdown?.exact_image_candidate_match),
    unrelated_brand_penalty_applied: Boolean(product.image_match_breakdown?.unrelated_brand_penalty_applied),
    top_candidate_image_url: product.matched_visual_candidate?.image_url || "",
    top_candidate_source: product.matched_visual_candidate?.image_source || "",
    top_candidate_variant_id: product.matched_visual_candidate?.variant_id ?? null,
    top_candidate_variant_color: product.matched_visual_candidate?.color || product.matched_variant_color || "",
    top_candidate_variant_size: product.matched_visual_candidate?.size || product.matched_variant_size || "",
    matched_variant_id: product.matched_variant_id ?? product.matched_visual_candidate?.variant_id ?? null,
    matched_variant_color: product.matched_variant_color || product.matched_visual_candidate?.color || "",
    matched_variant_size: product.matched_variant_size || product.matched_visual_candidate?.size || "",
    matched_variant_image: product.matched_variant_image || product.matched_image_url || product.matched_visual_candidate?.image_url || "",
    selected_card_image_source: product.matched_variant_image || product.matched_visual_candidate?.image_url || product.matched_image_url ? "matched_variant_image" : product.selected_image_field || "",
    selected_card_image_url: product.matched_variant_image || product.matched_visual_candidate?.image_url || product.matched_image_url || product.image_url || "",
    product_variant_images_count: product.product_variant_images_count || 0,
  }));

const imageFileTokens = (value = "") =>
  normalizeProductMatchText(toText(value).split(/[?#]/)[0].split("/").pop() || "")
    .split(/\s+/)
    .filter((token) => token.length >= 2);

const pushVisualCandidate = (candidates, seen, product, source = {}) => {
  const rawImage = firstImageValue(source.image_url, source.url, source.path, source.src);
  const imageUrl = resolveStorefrontProductImageUrl(rawImage);
  if (!imageUrl || isPlaceholderImageUrl(imageUrl)) return;
  const key = `${product.id}:${imageUrl.toLowerCase()}:${source.variant_id ?? ""}:${source.image_source || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({
    product_id: product.id,
    product_name: product.name,
    variant_id: source.variant_id ?? null,
    image_url: imageUrl,
    raw_image_url: rawImage,
    image_source: source.image_source || "gallery",
    candidate_source: source.image_source || "gallery",
    color: source.color || "",
    size: source.size || "",
    sku: source.sku || product.sku || "",
    stock: source.stock ?? product.total_stock ?? 0,
    status: Number(source.stock ?? product.total_stock ?? 0) > 0 ? "in_stock" : "out_of_stock",
    price: money(source.price) || money(product.price) || productBestPrice(product),
    final_price: money(source.sale_price) || money(source.price) || productBestPrice(product),
    product,
  });
};

const buildVisualImageCandidates = (products = []) => {
  const candidates = [];
  const seen = new Set();
  for (const product of products) {
    pushVisualCandidate(candidates, seen, product, {
      image_url: firstImageValue(product.image_url, product.main_image, product.image, product.thumbnail),
      image_source: "cover",
      stock: product.total_stock,
      price: product.price,
      sale_price: product.sale_price,
    });
    for (const image of normalizeJsonArray(product.product_images)) {
      pushVisualCandidate(candidates, seen, product, {
        image_url: firstImageValue(image),
        image_source: "gallery",
        stock: product.total_stock,
        price: product.price,
        sale_price: product.sale_price,
      });
    }
    for (const image of normalizeJsonArray(product.gallery_images)) {
      pushVisualCandidate(candidates, seen, product, {
        image_url: firstImageValue(image),
        image_source: "gallery",
        stock: product.total_stock,
        price: product.price,
        sale_price: product.sale_price,
      });
    }
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      const directVariantImages = [
        variant.image_url,
        variant.primary_image_url,
        variant.variant_image_url,
        variant.color_image_url,
        variant.image,
        variant.main_image,
        variant.thumbnail,
        ...normalizeJsonArray(variant.product_images),
      ];
      for (const image of directVariantImages) {
        pushVisualCandidate(candidates, seen, product, {
          image_url: firstImageValue(image),
          image_source: "variant",
          variant_id: variant.id,
          color: variant.color,
          size: variant.size,
          sku: variant.sku,
          stock: variant.stock,
          price: variant.price,
          sale_price: variant.sale_price,
        });
      }
      for (const image of normalizeJsonArray(variant.images)) {
        pushVisualCandidate(candidates, seen, product, {
          image_url: firstImageValue(image),
          image_source: "product_variant_images",
          variant_id: image?.variant_id ?? variant.id,
          color: image?.color_name || image?.color_value || variant.color,
          size: variant.size,
          sku: variant.sku,
          stock: variant.stock,
          price: variant.price,
          sale_price: variant.sale_price,
        });
      }
    }
  }
  return candidates;
};

const scoreVisualImageCandidate = ({ candidate, detected = {}, message = "" } = {}) => {
  const product = candidate.product || {};
  const candidateTokens = [
    candidate.color,
    candidate.size,
    candidate.sku,
    candidate.image_source,
    ...imageFileTokens(candidate.image_url),
  ].filter(Boolean);
  const candidateProduct = {
    ...product,
    name: [product.name, ...candidateTokens].filter(Boolean).join(" "),
    sku: [product.sku, candidate.sku].filter(Boolean).join(" "),
    image_url: candidate.image_url,
    product_images: [candidate.image_url],
    colors: unique([...(Array.isArray(product.colors) ? product.colors : []), candidate.color]),
    variants: [{
      id: candidate.variant_id,
      color: candidate.color,
      size: candidate.size,
      sku: candidate.sku,
      stock: candidate.stock,
      image_url: candidate.image_url,
    }],
  };
  const breakdown = visualImageMatchBreakdown({ product: candidateProduct, detected, message });
  const fileTokens = new Set(imageFileTokens(candidate.image_url));
  const modelTokens = visualTokens(detected.model_guess, detected.model_family, detected.likely_model, detected.model_keywords, detected.model, detected.english_keywords, detected.arabic_keywords);
  const colorTokens = visualTokens(detected.main_colors, detected.colors, detected.secondary_colors);
  const fileModelMatches = modelTokens.filter((token) => fileTokens.has(token)).length;
  const fileColorMatches = colorTokens.filter((token) => fileTokens.has(token) || normalizeProductMatchText(candidate.color).includes(token)).length;
  const sourceBoost = candidate.image_source === "product_variant_images" ? 240 : candidate.image_source === "variant" ? 180 : candidate.image_source === "gallery" ? 120 : 0;
  const candidateImageScore = fileModelMatches * 180 + fileColorMatches * 120 + sourceBoost;
  const requestedJordan4 = normalizeModelAliases([detected.likely_model, detected.model_keywords, detected.model])
    .some((alias) => /\b(air jordan 4|jordan 4|aj4|j4)\b/.test(alias));
  const originalProductBlob = normalizeProductMatchText([product.name, product.brand, product.sku].filter(Boolean).join(" "));
  const unrelatedJordanBrand =
    requestedJordan4 &&
    /\b(puma|adidas|reebok|new balance|asics|converse|vans)\b/.test(originalProductBlob) &&
    !/\b(air jordan|jordan|aj4|j4)\b/.test(originalProductBlob);
  const unrelatedPenalty = unrelatedJordanBrand ? -1_800 : 0;
  const finalScore = Number(breakdown.final_score || 0) + candidateImageScore + unrelatedPenalty;
  return {
    ...breakdown,
    model_score: unrelatedJordanBrand ? Math.min(Number(breakdown.model_score || 0), -900) : breakdown.model_score,
    candidate_image_score: candidateImageScore,
    unrelated_brand_penalty_applied: Boolean(breakdown.unrelated_brand_penalty_applied || unrelatedJordanBrand),
    final_score: finalScore,
    exact_model_match: !unrelatedJordanBrand && breakdown.exact_model_match,
    close_model_match: !unrelatedJordanBrand && breakdown.close_model_match,
    hard_filter_match: !unrelatedJordanBrand && breakdown.hard_filter_match,
    exact_image_candidate_match: !unrelatedJordanBrand && (breakdown.exact_model_match || breakdown.hard_filter_match || finalScore >= 1_350) && candidate.image_source !== "cover",
  };
};

const candidateDebugRows = (candidates = []) =>
  candidates.map((candidate, index) => ({
    rank: index + 1,
    product_id: candidate.product_id,
    product_name: candidate.product_name,
    candidate_image_url: candidate.image_url,
    candidate_source: candidate.image_source,
    variant_id: candidate.variant_id,
    image_url: candidate.image_url,
    image_source: candidate.image_source,
    color: candidate.color,
    size: candidate.size,
    sku: candidate.sku,
    stock: candidate.stock,
    status: candidate.status,
    price: candidate.price,
    final_price: candidate.final_price,
    model_score: candidate.score_breakdown?.model_score || 0,
    brand_score: candidate.score_breakdown?.brand_score || 0,
    brand_confidence: candidate.score_breakdown?.brand_confidence || 0,
    color_score: candidate.score_breakdown?.color_score || 0,
    color_mismatch_penalty: candidate.score_breakdown?.color_mismatch_penalty || 0,
    missing_required_colors: candidate.score_breakdown?.missing_required_colors || [],
    category_score: candidate.score_breakdown?.category_score || 0,
    feature_score: candidate.score_breakdown?.feature_score || 0,
    feature_boost: candidate.score_breakdown?.feature_boost || 0,
    feature_mismatch_penalty: candidate.score_breakdown?.feature_mismatch_penalty || 0,
    material_score: candidate.score_breakdown?.material_score || 0,
    silhouette_score: candidate.score_breakdown?.silhouette_score || 0,
    silhouette_boost: candidate.score_breakdown?.silhouette_boost || 0,
    silhouette_mismatch_penalty: candidate.score_breakdown?.silhouette_mismatch_penalty || 0,
    visual_silhouette: candidate.score_breakdown?.visual_silhouette || {},
    product_silhouette: candidate.score_breakdown?.product_silhouette || {},
    gender_score: candidate.score_breakdown?.gender_score || 0,
    stock_score: candidate.score_breakdown?.stock_score || 0,
    price_score: candidate.score_breakdown?.price_score || 0,
    image_similarity_hint_score: candidate.score_breakdown?.image_similarity_hint_score || 0,
    candidate_image_score: candidate.score_breakdown?.candidate_image_score || 0,
    total_penalty: candidate.score_breakdown?.total_penalty || 0,
    final_score: candidate.score_breakdown?.final_score || 0,
    visual_score: candidate.score_breakdown?.final_score || 0,
    is_exact_candidate: Boolean(candidate.score_breakdown?.exact_image_candidate_match || candidate.score_breakdown?.exact_model_match || candidate.score_breakdown?.hard_filter_match),
    exact_image_candidate_match: Boolean(candidate.score_breakdown?.exact_image_candidate_match),
    exact_model_match: Boolean(candidate.score_breakdown?.exact_model_match),
    hard_filter_match: Boolean(candidate.score_breakdown?.hard_filter_match),
  }));

export const buildAiSupportImageProductSearch = async ({ tenantId, analysis = {}, req = null } = {}) => {
  const detected = analysis?.detected || analysis || {};
  const modelKeywords = uniqueSearchParts([
    detected.model_guess,
    detected.model_family,
    detected.likely_model,
    detected.model_keywords,
    detected.model,
    detected.likely_model_keywords,
    detected.english_keywords,
    detected.arabic_keywords,
  ]);
  const modelAliasKeywords = uniqueSearchParts(normalizeModelAliases(modelKeywords));
  const colors = uniqueSearchParts([detected.main_colors, detected.colors, detected.secondary_colors, detected.dominant_colors]);
  const brandKeywords = uniqueSearchParts([detected.brand_guess, detected.brand_family, detected.brand, detected.brand_resemblance, detected.likely_brand].filter(Boolean));
  const typeKeywords = uniqueSearchParts([detected.product_type, detected.category, detected.style_category, detected.fashion_category].filter(Boolean));
  const styleKeywords = uniqueSearchParts([
    detected.silhouette,
    detected.silhouette_style,
    detected.style,
    detected.silhouette,
    detected.high_top_low_top,
    detected.sole_shape,
    detected.gender_audience,
    detected.gender_style,
    detected.gender,
    detected.target_audience,
    detected.distinctive_features,
    detected.features,
    detected.materials,
    detected.english_keywords,
    detected.arabic_keywords,
  ].filter(Boolean));

  const exactQuery = uniqueSearchParts([...brandKeywords, ...modelKeywords, ...colors, ...typeKeywords]).join(" ");
  const aliasQuery = uniqueSearchParts([...brandKeywords, ...modelAliasKeywords, ...colors, ...typeKeywords]).join(" ");
  const familyQuery = uniqueSearchParts([...brandKeywords, detected.model_family, ...typeKeywords]).join(" ");
  const colorCategoryQuery = uniqueSearchParts([...colors, ...typeKeywords]).join(" ");
  const featureQuery = uniqueSearchParts([...styleKeywords, ...typeKeywords]).join(" ");
  const similarQuery = uniqueSearchParts([...modelKeywords, ...typeKeywords, ...styleKeywords, ...colors]).join(" ");
  const broadQuery = uniqueSearchParts([...typeKeywords, ...styleKeywords, ...colors]).join(" ");
  const visionDetectionFailed = !modelKeywords.length && !brandKeywords.length && !colors.length && !typeKeywords.length && !styleKeywords.length;
  const searchStages = [
    { stage: "exact_model", query: exactQuery },
    { stage: "alias_synonym", query: aliasQuery },
    { stage: "brand_model_family", query: familyQuery },
    { stage: "color_category", query: colorCategoryQuery },
    { stage: "tags_features", query: featureQuery },
    { stage: "semantic_similarity", query: similarQuery },
    { stage: "similar_products_fallback", query: broadQuery || "products" },
  ].filter((item) => toText(item.query));
  const queries = uniqueSearchParts(searchStages.map((item) => item.query));

  const productsById = new Map();
  let matchedQuery = "";
  const matchedStages = [];

  for (const { stage, query } of searchStages) {
    const intent = detectAiSupportIntent(query);
    const matches = await searchProducts({ tenantId, message: query, intent, req });
    if (matches.length) {
      if (!matchedQuery) matchedQuery = query;
      matchedStages.push({
        stage,
        query,
        count: matches.length,
        top_product_ids: matches.slice(0, 6).map((product) => product.id),
      });
      for (const product of matches) {
        if (!productsById.has(String(product.id))) productsById.set(String(product.id), product);
      }
    }
  }

  const visualCatalogProducts = await loadVisualSearchProducts({
    tenantId,
    intent: detectAiSupportIntent(exactQuery || similarQuery || "products"),
    req,
  });
  for (const product of visualCatalogProducts) {
    if (!productsById.has(String(product.id))) productsById.set(String(product.id), product);
  }

  const visualCandidates = buildVisualImageCandidates(Array.from(productsById.values()))
    .map((candidate) => {
      const scoreBreakdown = scoreVisualImageCandidate({ candidate, detected, message: exactQuery });
      return {
        ...candidate,
        score_breakdown: scoreBreakdown,
        image_match_score: scoreBreakdown.final_score,
      };
    })
    .sort((left, right) => {
      const scoreDiff = Number(right.image_match_score || 0) - Number(left.image_match_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(right.stock || 0) - Number(left.stock || 0);
    })
    .map((candidate, index) => ({ ...candidate, candidate_rank: index + 1 }));
  const topVisualCandidate = visualCandidates[0] || null;
  const genericMatchedQuery = !matchedQuery || matchedQuery === "products";
  const fallbackUsedVisualCandidates = Boolean(topVisualCandidate && (visionDetectionFailed || genericMatchedQuery));
  const inferredModelFromCandidate = fallbackUsedVisualCandidates ? toText(topVisualCandidate.product_name) : "";
  const inferredSearchQuery = inferredModelFromCandidate || matchedQuery || queries[0] || "";
  if (fallbackUsedVisualCandidates && genericMatchedQuery) {
    matchedQuery = inferredSearchQuery;
    console.log("[AI IMAGE FALLBACK ACTIVE]", {
      inferred_model_from_candidate: inferredModelFromCandidate,
      inferred_search_query: inferredSearchQuery,
      top_visual_score: Number(topVisualCandidate?.image_match_score || topVisualCandidate?.score_breakdown?.final_score || 0),
    });
  }

  const productsWithVariantCandidates = new Set(
    visualCandidates
      .filter((candidate) => isVariantVisualCandidate(candidate))
      .map((candidate) => String(candidate.product_id))
  );
  const groupedByProduct = new Map();
  for (const candidate of visualCandidates) {
    const key = String(candidate.product_id);
    if (productsWithVariantCandidates.has(key) && !isVariantVisualCandidate(candidate)) continue;
    const existing = groupedByProduct.get(key);
    if (existing && Number(existing.image_match_score || 0) >= Number(candidate.image_match_score || 0)) continue;
    const product = candidate.product || {};
    const scoreBreakdown = candidate.score_breakdown || {};
    groupedByProduct.set(key, {
      ...product,
      strong_model_match: Boolean(scoreBreakdown.exact_model_match || scoreBreakdown.hard_filter_match || scoreBreakdown.close_model_match),
      model_match_confidence: scoreBreakdown.exact_model_match || scoreBreakdown.hard_filter_match ? 0.98 : scoreBreakdown.close_model_match ? 0.78 : 0,
      image_url: candidate.image_url,
      product_image_url: candidate.image_url,
      selected_image_source: candidate.raw_image_url || candidate.image_url,
      selected_image_field: `matched_${candidate.image_source}_image`,
      matched_image_url: candidate.image_url,
      matched_image_source: candidate.image_source,
      matched_variant_id: candidate.variant_id,
      matched_variant_color: candidate.color || "",
      matched_variant_size: candidate.size || "",
      matched_variant_image: ["variant", "product_variant_images"].includes(candidate.image_source) ? candidate.image_url : "",
      matched_visual_candidate: {
        candidate_rank: candidate.candidate_rank,
        product_id: candidate.product_id,
        product_name: candidate.product_name,
        variant_id: candidate.variant_id,
        image_url: candidate.image_url,
        image_source: candidate.image_source,
        color: candidate.color,
        size: candidate.size,
        sku: candidate.sku,
        stock: candidate.stock,
        status: candidate.status,
        price: candidate.price,
        final_price: candidate.final_price,
      },
      image_match_score: scoreBreakdown.final_score,
      image_match_breakdown: scoreBreakdown,
    });
  }

  const scoredProducts = Array.from(groupedByProduct.values())
    .sort((left, right) => {
      const scoreDiff = Number(right.image_match_score || 0) - Number(left.image_match_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const rankDiff = Number(left.matched_visual_candidate?.candidate_rank || 999_999) - Number(right.matched_visual_candidate?.candidate_rank || 999_999);
      if (rankDiff !== 0) return rankDiff;
      return Number(right.total_stock || 0) - Number(left.total_stock || 0);
    });

  const bestScore = Number(scoredProducts[0]?.image_match_score || 0);
  const hasCloseModelMatch = scoredProducts.some((product) => product.image_match_breakdown?.close_model_match);
  const hasExactModelMatch = scoredProducts.some((product) => product.image_match_breakdown?.exact_model_match || product.image_match_breakdown?.exact_image_candidate_match);
  const jordan4StrongMatches = scoredProducts.filter(
    (product) =>
      product.image_match_breakdown?.hard_filter_key === "jordan4" &&
      product.image_match_breakdown?.hard_filter_match &&
      Number(product.image_match_score || 0) >= 1_350
  );
  const hardFilterApplied = jordan4StrongMatches.length >= 2;
  const candidateFirstMinimumScore = fallbackUsedVisualCandidates ? Math.max(120, bestScore - 60) : 300;
  const minimumScore = hasCloseModelMatch ? Math.max(760, bestScore - 420) : candidateFirstMinimumScore;
  const exactVariantRankTarget = findExactVariantRankTarget({
    visualCandidates,
    scoredProducts,
    fallbackUsedVisualCandidates,
    candidateFirstMinimumScore,
  });
  const exactVariantProduct = exactVariantRankTarget.exactVariantProduct;
  let filteredProducts = scoredProducts.filter((product) => Number(product.image_match_score || 0) >= minimumScore);
  if (hardFilterApplied) {
    filteredProducts = scoredProducts.filter((product) => product.image_match_breakdown?.hard_filter_match);
  }
  if (hasCloseModelMatch) {
    filteredProducts = filteredProducts.filter((product) => product.image_match_breakdown?.close_model_match || Number(product.image_match_score || 0) >= bestScore - 120);
  }
  if (filteredProducts.length < 3 && !hasCloseModelMatch) {
    filteredProducts = scoredProducts.filter((product) => Number(product.image_match_score || 0) >= 180).slice(0, 6);
  }
  const requestedSize = toText(detected.size || detected.requested_size || detected.customer_size || "");
  filteredProducts = rankProductsByInventorySalesStrategy({
    products: filteredProducts,
    requestedSize,
    shoppingIntent: { trendingOnly: false },
  }).sort((left, right) => {
    const scoreDiff = Number(right.image_match_score || 0) - Number(left.image_match_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(left.matched_visual_candidate?.candidate_rank || 999_999) - Number(right.matched_visual_candidate?.candidate_rank || 999_999);
  });
  const forcedExactRank = forceExactVariantTopRank({ products: filteredProducts, exactVariantProduct });
  filteredProducts = sortVisualProductsByPriority(forcedExactRank.products);
  const topCandidateSource = scoredProducts[0]?.matched_visual_candidate?.image_source || topVisualCandidate?.image_source || "";
  const topCandidateIsVariantImage = ["variant", "product_variant_images"].includes(topCandidateSource);
  const candidateFirstStrongVariant = Boolean(fallbackUsedVisualCandidates && topCandidateIsVariantImage && bestScore >= candidateFirstMinimumScore);
  const highConfidence = hasExactModelMatch || candidateFirstStrongVariant || bestScore >= 1_350;
  const visionConfidence = Number(analysis?.confidence ?? detected.confidence ?? 0);
  const mediumConfidence = !highConfidence && (bestScore >= 300 || visionConfidence >= 0.45);
  const confidenceLevel = highConfidence ? "high" : mediumConfidence ? "medium" : "low";
  const matchConfidence = highConfidence ? Math.max(0.82, visionConfidence) : mediumConfidence ? Math.max(0.52, Math.min(0.74, visionConfidence || bestScore / 1800)) : Math.max(0, Math.min(0.34, visionConfidence || bestScore / 1800));
  const visualUnderstanding = detectSalesProductUnderstanding({
    message: [
      inferredSearchQuery,
      matchedQuery,
      detected.brand,
      detected.brand_guess,
      detected.likely_model,
      detected.model_guess,
      detected.model_keywords,
      detected.product_type,
      detected.silhouette,
      detected.silhouette_style,
      detected.colors,
      detected.main_colors,
    ].flat().filter(Boolean).join(" "),
    memory: { lastImageUrl: req?.body?.image_url || req?.body?.imageUrl || "uploaded_image" },
    source: "visual_product_family",
  });
  let returnedProducts = highConfidence ? filteredProducts.slice(0, 3) : filteredProducts.slice(0, 6);
  if (visualUnderstanding.requires_relevance_gate) {
    returnedProducts = gateRelevantProducts({
      products: returnedProducts,
      understanding: visualUnderstanding,
      limit: highConfidence ? 3 : 6,
      fallback: !highConfidence,
    });
  }
  console.log("[ai-orchestrator:candidates]", {
    exact_count: Number(hasExactModelMatch),
    family_count: returnedProducts.filter((product) => product.relevance_reasons?.includes("model_family_match")).length,
    similar_count: returnedProducts.length,
    fallback_count: highConfidence ? 0 : returnedProducts.length,
  });
  const returnedExactVariantProduct = returnedProducts.find((product) =>
    isExactVariantMatchedProduct({ product, fallbackUsedVisualCandidates, candidateFirstMinimumScore })
  ) || null;
  const hasVariantExactMatch = Boolean(returnedExactVariantProduct);
  const finalExactMatchFound = hasExactModelMatch || hasVariantExactMatch;
  const variantCandidateCount = visualCandidates.filter((candidate) => ["variant", "product_variant_images"].includes(candidate.image_source)).length;
  const productVariantImagesCount = visualCandidates.filter((candidate) => candidate.image_source === "product_variant_images").length;
  const allRankedRows = imageRankingDebugRows(scoredProducts);
  const returnedRows = imageRankingDebugRows(returnedProducts);
  const returnedIds = new Set(returnedRows.map((row) => String(row.id)));
  const topCandidate = topVisualCandidate;
  const topReturnedCandidate = returnedProducts[0]?.matched_visual_candidate || null;
  const exactMatchReason = hasVariantExactMatch && exactVariantProduct
    ? "matched_variant_image_high_confidence"
    : hasExactModelMatch && topReturnedCandidate
    ? `matched_${topReturnedCandidate.image_source}_image`
    : hasExactModelMatch
      ? "matched_product_visual_profile"
      : "";

  const debugPayload = {
    detected,
    vision_json: analysis,
    visual_debug_enabled: VISUAL_DEBUG,
    search_stages: searchStages,
    matched_stages: matchedStages,
    queries,
    matched_query: matchedQuery,
    vision_detection_failed: visionDetectionFailed,
    fallback_used_visual_candidates: fallbackUsedVisualCandidates,
    inferred_model_from_candidate: inferredModelFromCandidate,
    inferred_search_query: inferredSearchQuery,
    top_visual_score: Number(topCandidate?.image_match_score || topCandidate?.score_breakdown?.final_score || 0),
    top_visual_candidate_source: topCandidate?.image_source || "",
    top_visual_candidate_product_name: topCandidate?.product_name || "",
    total_visual_candidates: visualCandidates.length,
    top_candidate_image_url: topCandidate?.image_url || "",
    top_candidate_source: topCandidate?.image_source || "",
    top_candidate_product_id: topCandidate?.product_id || null,
    top_candidate_variant_id: topCandidate?.variant_id ?? null,
    matched_cover: returnedProducts.some((product) => product.matched_visual_candidate?.image_source === "cover"),
    matched_variant: returnedProducts.some((product) => product.matched_visual_candidate?.image_source === "variant"),
    matched_gallery: returnedProducts.some((product) => product.matched_visual_candidate?.image_source === "gallery"),
    exact_match_reason: exactMatchReason,
    final_answer_reason: finalExactMatchFound
      ? "final_suggested_products_contain_strong_match"
      : returnedProducts.length
        ? "final_suggested_products_are_visual_similar_only"
        : "no_final_suggested_products",
    exact_match_found: finalExactMatchFound,
    has_exact_model_match: hasExactModelMatch,
    has_variant_exact_match: hasVariantExactMatch,
    final_exact_match_source: hasVariantExactMatch
      ? exactVariantProduct?.matched_visual_candidate?.image_source === "product_variant_images"
        ? "product_variant_images"
        : "variant_image"
      : hasExactModelMatch ? "product_visual_profile" : "",
    exact_match_variant_id: returnedExactVariantProduct?.matched_variant_id ?? returnedExactVariantProduct?.matched_visual_candidate?.variant_id ?? null,
    exact_match_variant_reason: hasVariantExactMatch ? "matched_variant_id + matched_variant_image + high visual/model confidence" : "",
    final_response_synced_with_variant: hasVariantExactMatch,
    forced_exact_variant_rank: forcedExactRank.forcedExactVariantRank,
    forced_rank_position: forcedExactRank.forcedRankPosition,
    final_sorted_product_ids: returnedProducts.map((product) => product.id),
    top_rank_reason: returnedProducts[0]?.top_rank_reason || topRankReason(returnedProducts[0] || {}),
    exact_match_product_id: returnedExactVariantProduct?.id ?? exactVariantRankTarget.forcedRankTargetProductId ?? null,
    exact_match_image_owner_product_id: exactVariantRankTarget.exactMatchImageOwnerProductId,
    exact_match_variant_owner_product_id: exactVariantRankTarget.exactMatchVariantOwnerProductId,
    forced_rank_target_product_id: exactVariantRankTarget.forcedRankTargetProductId,
    forced_rank_target_reason: exactVariantRankTarget.forcedRankTargetReason,
    forced_rank_mismatch_detected: exactVariantRankTarget.forcedRankMismatchDetected,
    matched_variant_image: exactVariantRankTarget.matchedVariantImage || returnedExactVariantProduct?.matched_variant_image || "",
    matched_image_url: returnedExactVariantProduct?.matched_image_url || exactVariantRankTarget.matchedVariantImage || "",
    suggested_product_image_ownership: productImageOwnershipDebugRows(returnedProducts),
    ranked_product_image_ownership: productImageOwnershipDebugRows(scoredProducts),
    has_close_model_match: hasCloseModelMatch,
    hard_filter_applied: hardFilterApplied,
    hard_filter_reason: hardFilterApplied ? "2_or_more_high_confidence_jordan4_matches" : "",
    high_confidence: highConfidence,
    confidence_level: confidenceLevel,
    match_confidence: matchConfidence,
    minimum_similarity_threshold: minimumScore,
    uploaded_detected_attributes: detected,
    top_candidate_images: candidateDebugRows(visualCandidates.slice(0, 12)),
    top_visual_candidates: candidateDebugRows(visualCandidates.slice(0, 10)),
    all_ranked_products: allRankedRows,
    grouped_product_results: allRankedRows,
    final_sorted_order_returned_to_frontend: returnedRows,
    selected_card_image_source: returnedRows[0]?.selected_card_image_source || returnedRows[0]?.top_candidate_source || "",
    selected_card_image_url: returnedRows[0]?.selected_card_image_url || returnedRows[0]?.top_candidate_image_url || "",
    exact_match_blocked_reason: finalExactMatchFound
      ? null
      : returnedProducts.length
        ? fallbackUsedVisualCandidates
          ? "visual candidate fallback ran, but top returned candidate was not a strong variant/product_variant_images match"
          : "no returned variant/product_variant_images candidate met exact visual threshold"
        : "no returned visual candidates",
    variant_candidate_count: variantCandidateCount,
    product_variant_images_count: productVariantImagesCount,
    filtered_or_penalized_products: allRankedRows
      .filter((row) => !returnedIds.has(String(row.id)) || row.unrelated_brand_penalty_applied || row.gender_score < 0 || row.low_visual_penalty < 0)
      .map((row) => ({
        ...row,
        filtered_out: !returnedIds.has(String(row.id)),
      })),
  };

  console.log("[ai-support] image-search actual ranked scoring", debugPayload);
  if (VISUAL_DEBUG) {
    console.log("[ai-support][VISUAL_DEBUG] image search retrieval", {
      vision_json: analysis,
      search_queries: searchStages,
      top_scored_products: allRankedRows.slice(0, 12),
      scores: allRankedRows.slice(0, 12).map((row) => ({
        id: row.id,
        name: row.name,
        final_score: row.final_score,
        model_score: row.model_score,
        brand_score: row.brand_score,
        color_score: row.color_score,
        color_mismatch_penalty: row.color_mismatch_penalty,
        category_score: row.category_score,
        feature_score: row.feature_score,
        feature_boost: row.feature_boost,
        feature_mismatch_penalty: row.feature_mismatch_penalty,
        material_score: row.material_score,
        silhouette_score: row.silhouette_score,
        silhouette_boost: row.silhouette_boost,
        silhouette_mismatch_penalty: row.silhouette_mismatch_penalty,
        stock_score: row.stock_score,
        total_penalty: row.total_penalty,
        visual_silhouette: row.visual_silhouette,
        product_silhouette: row.product_silhouette,
      })),
      fallback_reason: debugPayload.exact_match_blocked_reason || debugPayload.final_answer_reason,
    });
  }
  debugProductSearch("image search ranking", debugPayload);

  return {
    search_query: matchedQuery || inferredSearchQuery || queries[0] || "",
    exact_match: finalExactMatchFound,
    exact_match_found: finalExactMatchFound,
    exact_match_reason: exactMatchReason,
    final_exact_match_source: debugPayload.final_exact_match_source,
    exact_match_variant_id: debugPayload.exact_match_variant_id,
    exact_match_variant_reason: debugPayload.exact_match_variant_reason,
    final_response_synced_with_variant: debugPayload.final_response_synced_with_variant,
    close_match: hasCloseModelMatch,
    confidence_level: confidenceLevel,
    match_confidence: matchConfidence,
    fallback_reason: debugPayload.exact_match_blocked_reason || debugPayload.final_answer_reason,
    weak_fallback: !hasCloseModelMatch && returnedProducts.length > 0,
    no_exact_message: finalExactMatchFound ? "" : undefined,
    suggested_products: suggestedProducts(returnedProducts, req),
    debug: debugPayload,
  };
};

export const buildAiSupportImageRankingDebug = async ({ tenantId, query = "jordan4", req = null } = {}) => {
  const normalized = normalizeProductMatchText(query);
  const analysis = /jordan\s*4|jordan4|aj4|j4/.test(normalized)
    ? {
        confidence: 0.9,
        detected: {
          brand_family: "Nike Jordan",
          brand: "Jordan",
          likely_model: "Air Jordan 4",
          model_keywords: ["Jordan 4", "AJ4", "J4"],
          product_type: "sneaker",
          silhouette_style: "chunky high top basketball sneaker",
          high_top_low_top: "high top",
          style: "streetwear chunky",
          gender_audience: "men unisex",
          main_colors: ["black"],
          colors: ["black", "dark"],
        },
      }
    : {
        confidence: 0.75,
        detected: {
          likely_model: query,
          model_keywords: [query],
          product_type: "sneaker",
          style: "streetwear",
        },
      };
  const ranking = await buildAiSupportImageProductSearch({ tenantId, analysis, req });
  return {
    tenant_id: tenantId,
    query,
    detected_attributes: analysis.detected,
    search_query: ranking.search_query,
    exact_match: ranking.exact_match,
    exact_match_found: ranking.exact_match_found,
    exact_match_reason: ranking.exact_match_reason,
    close_match: ranking.close_match,
    confidence_level: ranking.confidence_level || ranking.debug?.confidence_level || "",
    match_confidence: ranking.match_confidence || ranking.debug?.match_confidence || 0,
    suggested_products: ranking.suggested_products,
    ranked_products: ranking.debug?.all_ranked_products || [],
    total_visual_candidates: ranking.debug?.total_visual_candidates || 0,
    top_candidate_image_url: ranking.debug?.top_candidate_image_url || "",
    top_candidate_source: ranking.debug?.top_candidate_source || "",
    top_candidate_images: ranking.debug?.top_candidate_images || [],
    grouped_product_results: ranking.debug?.grouped_product_results || [],
    matched_cover: Boolean(ranking.debug?.matched_cover),
    matched_variant: Boolean(ranking.debug?.matched_variant),
    matched_gallery: Boolean(ranking.debug?.matched_gallery),
    final_answer_reason: ranking.debug?.final_answer_reason || "",
    final_sorted_order_returned_to_frontend: ranking.debug?.final_sorted_order_returned_to_frontend || [],
    filtered_or_penalized_products: ranking.debug?.filtered_or_penalized_products || [],
    hard_filter_applied: Boolean(ranking.debug?.hard_filter_applied),
    hard_filter_reason: ranking.debug?.hard_filter_reason || "",
  };
};

export const buildAiSupportTrustedContext = async ({ tenantId, message, req = null } = {}) => {
  const intent = detectAiSupportIntent(message);
  if (intent.type === "greeting_only") {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: [],
      unknown_product_terms: [],
      fallbackReason: "",
      personalization_blocked: true,
      greeting_only_mode: true,
      conversation_memory: null,
      directResponse: buildGreetingOnlyResponse({ message }),
    };
  }
  const identity = resolveAiConversationIdentity({ req, tenantId });
  const conversationMemory = tenantId
    ? await loadAiConversationMemory({
        tenantId,
        sessionId: identity.sessionId,
        customerPhone: identity.customerPhone,
      }).catch((error) => {
        console.warn("[ai-support] conversation memory load skipped", {
          tenantId,
          message: error?.message,
        });
        return null;
      })
    : null;
  const memorySource = buildAiMemoryContextSource(conversationMemory);
  const effectiveMemory = mergeCurrentTurnMemory({ memory: conversationMemory, message, req });
  const recommendationState = conversationRecommendationState(effectiveMemory);
  const rawCurrentTurnModelIntent = detectStrictModelIntent(message);
  const currentTurnModelIntent = rawCurrentTurnModelIntent && recommendationState.rejectedModelNames.some((name) =>
    normalizeProductMatchText(name) === normalizeProductMatchText(rawCurrentTurnModelIntent.displayName)
  )
    ? null
    : rawCurrentTurnModelIntent;
  const currentRequestedModelIntent = currentTurnModelIntent || detectStrictModelIntent(recommendationState.currentRequestedModel);
  const requestMetadata = req?.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
  const confirmationDetected = alternativeConfirmationDetected(message);

  if (tenantId && confirmationDetected && recommendationState.pendingAlternativeForModel) {
    const alternativeResult = await buildAlternativeProducts({
      tenantId,
      state: recommendationState,
      req,
      memory: effectiveMemory,
    });
    const products = alternativeResult.alternatives;
    const sources = products.map(sourceFromProduct);
    const items = suggestedProducts(products, req);
    console.log("[ai-support alternatives]", {
      tenant_id: tenantId,
      pendingAlternativeForModel: recommendationState.pendingAlternativeForModel,
      pendingAlternativeCategory: recommendationState.pendingAlternativeCategory,
      confirmationDetected,
      search_query: alternativeResult.searchMessage,
      alternatives_selected: products.map((product) => ({
        id: product.id,
        name: product.name,
        stock: product.total_stock,
        price: productBestPrice(product),
      })),
      no_alternatives_reason: alternativeResult.noAlternativeReason || "",
    });
    const explanation = products[0] ? relevanceExplanationAr(products[0], alternativeResult.understanding) : "";
    return {
      intent: {
        ...intent,
        type: "product_discovery",
        pending_alternative_confirmation: true,
      },
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
      suggested_products: items,
      suggested_actions: products.length ? ["view_product", "choose_size", "contact_support"] : ["contact_support"],
      quick_funnel: null,
      unknown_product_terms: [],
      fallbackReason: products.length ? "" : alternativeResult.noAlternativeReason || "no_alternatives_found",
      conversation_memory: conversationMemory,
      directResponse: {
        answer: products.length ? explanation : NO_RANDOM_PRODUCT_FALLBACK,
        confidence: products.length ? 0.9 : 0.82,
        needs_human_support: false,
        sources_used: items.map((product) => `product_${product.id}`),
        suggested_products: items,
        suggested_actions: products.length ? ["view_product", "choose_size", "contact_support"] : ["contact_support"],
        ai_memory_patch: {
          preferences: clearPendingAlternativePatch(),
        },
      },
    };
  }

  console.log("[ai-support alternatives]", {
    tenant_id: tenantId,
    pendingAlternativeForModel: recommendationState.pendingAlternativeForModel || "",
    confirmationDetected,
    alternatives_selected: [],
    no_alternatives_reason: confirmationDetected && !recommendationState.pendingAlternativeForModel ? "confirmation_without_pending_model" : "",
  });

  if (hasClearBuyingIntent(message)) {
    const rememberedProducts = Array.isArray(effectiveMemory?.last_products) ? effectiveMemory.last_products : [];
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: memorySource ? [memorySource] : [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      unknown_product_terms: [],
      fallbackReason: "",
      conversation_memory: conversationMemory,
      directResponse: {
        answer: buildOrderCollectionResponse({
          memory: effectiveMemory,
          metadata: {
            ...requestMetadata,
            customer_name: requestMetadata.customer_name || req?.body?.customer_name || "",
            customer_phone: requestMetadata.customer_phone || req?.body?.customer_phone || "",
            customer_address: requestMetadata.customer_address || req?.body?.customer_address || "",
          },
          suggested: rememberedProducts,
        }),
        confidence: 0.96,
        needs_human_support: false,
        sources_used: memorySource ? [memorySource.id] : [],
        suggested_products: [],
        suggested_actions: ["contact_support"],
      },
    };
  }

  if (intent.type === "conversational") {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      unknown_product_terms: [],
      fallbackReason: "",
      personalization_blocked: true,
      greeting_only_mode: false,
      conversation_memory: null,
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
      conversation_memory: null,
    };
  }

  if (intent.type === "internal_data") {
    const internalAnswer = shouldReplyInArabic(message)
      ? "\u0645\u0634 \u0647\u0642\u062f\u0631 \u0623\u0634\u0627\u0631\u0643 \u0628\u064a\u0627\u0646\u0627\u062a \u062f\u0627\u062e\u0644\u064a\u0629 \u0632\u064a \u0633\u0639\u0631 \u0627\u0644\u062a\u0643\u0644\u0641\u0629 \u0623\u0648 \u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646. \u0623\u0642\u062f\u0631 \u0623\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u060c \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a\u060c \u0623\u0648 \u0627\u0644\u062a\u0648\u0641\u0631."
      : "I cannot share internal ERP, admin, supplier, cost, margin, credential, or private data. I can help with public prices, sizes, availability, and store policies.";
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      unknown_product_terms: [],
      fallbackReason: "internal_data_request",
      conversation_memory: conversationMemory,
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
      conversation_memory: conversationMemory,
      directResponse: {
        answer: shouldReplyInArabic(message)
          ? "\u062d\u0627\u0636\u0631 \u2764\ufe0f \u0647\u0648\u0635\u0644\u0643 \u0628\u0627\u0644\u062f\u0639\u0645. \u0627\u0628\u0639\u062a\u0644\u0646\u0627 \u0631\u0642\u0645\u0643 \u0623\u0648 \u0643\u0644\u0645\u0646\u0627 \u0639\u0644\u0649 \u0648\u0627\u062a\u0633\u0627\u0628."
          : "I can connect you with support. Send your phone number or contact us on WhatsApp.",
        confidence: 1,
        needs_human_support: true,
        sources_used: [],
        suggested_products: [],
        suggested_actions: ["contact_support"],
      },
    };
  }

  const sources = [];
  if (memorySource) sources.push(memorySource);
  let products = [];
  let fallbackReason = "";
  let unknownProductTerms = [];
  let quickFunnel = null;
  const strictModelIntent = currentRequestedModelIntent;

  if (intent.type === "product" || intent.type === "product_discovery" || intent.type === "general") {
    const searchMessage = currentTurnModelIntent
      ? message
      : [message, currentRequestedModelIntent?.displayName || "", memorySearchHint(effectiveMemory)].filter(Boolean).join(" ");
    products = await searchProducts({ tenantId, message: searchMessage, intent, req, memory: effectiveMemory });
    products = filterProductsByConversationState({
      products,
      state: recommendationState,
      currentModelIntent: currentRequestedModelIntent,
      intent,
      message: searchMessage,
    });
    console.log("[ai-support recommendation-state]", {
      tenant_id: tenantId,
      incoming_message: message,
      normalized_intent: normalizeProductMatchText(searchMessage),
      detected_rejection: Boolean(recommendationState.rejectedProductIds.length || recommendationState.rejectedModelNames.length),
      currentRequestedModel: currentRequestedModelIntent?.displayName || recommendationState.currentRequestedModel || "",
      rejectedProductIds: recommendationState.rejectedProductIds,
      rejectedModelNames: recommendationState.rejectedModelNames,
      lastVisualQuery: recommendationState.lastVisualQuery,
      lastVisualMatches: recommendationState.lastVisualMatches,
      rejectedVisualMatches: recommendationState.rejectedVisualMatches,
      lastRecommendedProductIds: recommendationState.lastRecommendedProductIds,
      selected_products: products.slice(0, 5).map((product) => ({
        id: product.id,
        name: product.name,
        model_match_confidence: product.model_match_confidence,
        model_match_reason: product.model_match_reason,
      })),
      fallback_reason: products.length ? "" : currentRequestedModelIntent ? "current_requested_model_no_confident_match" : "no_selected_products",
    });
    sources.push(...products.map(sourceFromProduct));
    quickFunnel = deriveQuickFunnelState({ message: searchMessage, intent, memory: effectiveMemory, products });
    const funnelActions = quickFunnel.chips || [];
    const directProductResponse = buildDirectProductResponse({ message, intent, products, req, memory: effectiveMemory });
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
        suggested_actions: [...funnelActions, ...directProductResponse.suggested_actions],
        quick_funnel: quickFunnel,
        unknown_product_terms: [],
        fallbackReason: "",
        conversation_memory: conversationMemory,
        directResponse: {
          ...directProductResponse,
          suggested_actions: [...funnelActions, ...directProductResponse.suggested_actions],
          quick_funnel: quickFunnel,
        },
      };
    }
    if (intent.type === "product_discovery") {
      const discoveryResponse = buildProductDiscoveryResponse({ message, intent, products, req, memory: effectiveMemory });
      const inventorySalesLine = products.length && !strictModelIntent
        ? [recommendationIntroLineAr(products.slice(0, 3), resolveCustomerSize({ intent, memory: effectiveMemory }))]
            .filter(Boolean)
            .join(" ")
        : "";
      if (inventorySalesLine && discoveryResponse?.answer && !discoveryResponse.answer.includes(inventorySalesLine)) {
        discoveryResponse.answer = `${inventorySalesLine} ${discoveryResponse.answer}`;
      }
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
        suggested_actions: [
          ...funnelActions,
          ...(products.length ? ["view_product", "show_similar_products", "choose_size", "contact_support"] : ["show_similar_products", "choose_size"]),
        ],
        quick_funnel: quickFunnel,
        unknown_product_terms: products.length ? [] : normalizeSearchTerms(message, intent),
        fallbackReason: products.length ? "" : strictModelIntent ? "strict_model_no_confident_match" : "product_discovery_needs_clarification",
        conversation_memory: conversationMemory,
        directResponse: {
          ...discoveryResponse,
          answer: products.length || strictModelIntent ? discoveryResponse.answer : quickFunnel.prompt,
          suggested_actions: [
            ...funnelActions,
            ...(products.length ? ["view_product", "show_similar_products", "choose_size", "contact_support"] : ["show_similar_products", "choose_size"]),
          ],
          quick_funnel: quickFunnel,
        },
      };
    }
    if (strictModelIntent && products.length === 0) {
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
        suggested_products: [],
        suggested_actions: [...funnelActions, "show_similar_products", "contact_support"],
        quick_funnel: quickFunnel,
        unknown_product_terms: normalizeSearchTerms(message, intent),
        fallbackReason: "strict_model_no_confident_match",
        conversation_memory: conversationMemory,
        directResponse: {
          answer: modelUnavailableReply(currentRequestedModelIntent?.displayName || recommendationState.currentRequestedModel),
          confidence: 0.96,
          needs_human_support: false,
          sources_used: [],
          suggested_products: [],
          suggested_actions: [...funnelActions, "show_similar_products", "contact_support"],
          quick_funnel: quickFunnel,
          ai_memory_patch: {
            preferences: pendingAlternativePatch({
              modelIntent: currentRequestedModelIntent,
              message,
            }),
          },
        },
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
    ? [...(quickFunnel?.chips || []), "view_product", "contact_support"]
    : sources.length
      ? [...(quickFunnel?.chips || []), "contact_support"]
      : [...(quickFunnel?.chips || []), "contact_support"];
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
    quick_funnel: quickFunnel,
    unknown_product_terms: unknownProductTerms,
    fallbackReason: sources.length ? "" : fallbackReason || "no_trusted_context",
    conversation_memory: conversationMemory,
    directResponse: directStoreResponse || undefined,
  };
};

export const buildAiSupportProductSearchDebug = async ({ tenantId, query, req = null } = {}) => {
  const message = toText(query);
  const intent = detectAiSupportIntent(message);
  const strictModelIntent = detectStrictModelIntent(message);
  const products = tenantId ? await searchProducts({ tenantId, message, intent, req }) : [];
  const directProductResponse = buildDirectProductResponse({ message, intent, products, req });
  const directDiscoveryResponse =
    intent.type === "product_discovery" ? buildProductDiscoveryResponse({ message, intent, products, req }) : null;
  const exactAnswer = directProductResponse?.answer || directDiscoveryResponse?.answer || "";

  const rankedDebugRows = products.map((product, index) => ({
    rank: index + 1,
    id: product.id,
    name: product.name,
    sku: product.sku || "",
    brand: product.brand || "",
    gender: product.gender || "",
    total_stock: product.total_stock,
    requested_size: product.inventory_profile?.requested_size || intent.product?.size || "",
    requested_size_stock: product.inventory_profile?.requested_size_stock ?? null,
    requested_size_available: product.inventory_profile?.requested_size_available ?? null,
    inventory_state: product.inventory_state || product.inventory_profile?.inventory_state || "",
    inventory_sales_score: product.inventory_sales_score || 0,
    inventory_sales_breakdown: product.inventory_sales_breakdown || {},
    model_match_confidence: product.model_match_confidence,
    model_match_reason: product.model_match_reason,
    model_family: product.model_family,
    requested_color: product.requested_color || "",
    matched_variant_id: product.matched_variant_id ?? null,
    matched_variant_color: product.matched_variant_color || "",
    matched_variant_size: product.matched_variant_size || "",
    matched_variant_image: product.matched_variant_image || "",
    variant_match_reason: product.variant_match_reason || "",
    searched_variants_count: product.searched_variants_count || 0,
    color_match_score: product.color_match_score || 0,
    size_match_score: product.size_match_score || 0,
  }));

  return {
    tenant_id: tenantId,
    query: message,
    normalized_query: normalizeProductMatchText(message),
    strict_model_intent: strictModelIntent,
    confidence_threshold: strictModelIntent ? MODEL_INTENT_CONFIDENCE_THRESHOLD : undefined,
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
      stock_status: product.exact_variant_available === false ? "out_of_stock" : Number(product.total_stock || 0) > 0 ? "in_stock" : "out_of_stock",
      requested_size: product.inventory_profile?.requested_size || intent.product?.size || "",
      requested_color: product.requested_color || "",
      matched_variant_id: product.matched_variant_id ?? null,
      matched_variant_color: product.matched_variant_color || "",
      matched_variant_size: product.matched_variant_size || "",
      matched_variant_image: product.matched_variant_image || "",
      variant_match_reason: product.variant_match_reason || "",
      searched_variants_count: product.searched_variants_count || 0,
      color_match_score: product.color_match_score || 0,
      size_match_score: product.size_match_score || 0,
      requested_size_stock: product.inventory_profile?.requested_size_stock ?? null,
      requested_size_available: product.inventory_profile?.requested_size_available ?? null,
      inventory_state: product.inventory_state || product.inventory_profile?.inventory_state || "",
      inventory_sales_score: product.inventory_sales_score || 0,
      inventory_sales_breakdown: product.inventory_sales_breakdown || {},
      model_match_confidence: product.model_match_confidence,
      model_match_reason: product.model_match_reason,
      model_family: product.model_family,
      availability: product.exact_variant_available === false ? "out_of_stock" : product.availability,
      product_url: `/shop/product/${product.id}`,
    })),
    suggested_products: suggestedProducts(products, req),
    ranked_products: rankedDebugRows,
    final_sorted_order: rankedDebugRows,
    final_sorted_order_returned_to_frontend: rankedDebugRows.slice(0, suggestedProducts(products, req).length),
    exact_answer: exactAnswer,
    would_use_direct_response: Boolean(directProductResponse || directDiscoveryResponse),
    fallback_reason: products.length ? "" : strictModelIntent ? "strict_model_no_confident_match" : "no_matching_products",
  };
};

export const buildAiSupportModelColorDebug = async ({ tenantId, query = "", req = null, limit = 6 } = {}) => {
  const message = toText(query || "jordan 4");
  const intent = detectAiSupportIntent(message);
  const strictModelIntent = detectStrictModelIntent(message);
  const products = tenantId ? await searchProducts({ tenantId, message, intent, req }) : [];
  const publicProducts = suggestedProducts(products, req, { limit: Math.max(1, Number(limit) || 6) });
  const colorExpansions = publicProducts.map((product) => debugProductColorExpansion(product, { limit }));
  const payload = {
    tenant_id: tenantId,
    query: message,
    normalized_query: normalizeProductMatchText(message),
    strict_model_intent: strictModelIntent ? {
      key: strictModelIntent.key,
      family: strictModelIntent.family,
      displayName: strictModelIntent.displayName,
      matchedAlias: strictModelIntent.matchedAlias,
    } : null,
    matched_product_count: products.length,
    strong_model_detected: products.some((product) => product.strong_model_match || Number(product.model_match_confidence || 0) >= MODEL_INTENT_CONFIDENCE_THRESHOLD),
    products: publicProducts.map((product, index) => ({
      rank: index + 1,
      product_id: product.id || product.product_id || null,
      product_name: product.name || product.title || "",
      model_match_confidence: product.model_match_confidence || 0,
      strong_model_match: Boolean(product.strong_model_match),
      color_expansion: colorExpansions[index] || null,
    })),
  };
  console.log("[ai-support debug model-colors]", {
    tenant_id: tenantId,
    query: message,
    normalized_query: payload.normalized_query,
    strict_model_intent: payload.strict_model_intent?.displayName || "",
    strong_model_detected: payload.strong_model_detected,
    expanded_color_count: colorExpansions.reduce((sum, item) => sum + Number(item?.expanded_color_count || 0), 0),
    colors_sent: colorExpansions.flatMap((item) => item?.colors_sent || []),
    colors_skipped: colorExpansions.flatMap((item) => item?.colors_skipped || []),
    color_groups: colorExpansions.flatMap((item) => item?.color_groups || []),
  });
  return payload;
};
