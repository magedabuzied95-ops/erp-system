import db from "../database/db.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";

let schemaReadyPromise = null;

const MEMORY_PRODUCT_LIMIT = 12;
const MEMORY_LIST_LIMIT = 12;

const toText = (value, fallback = "") => String(value ?? fallback).trim();
const jsonValue = (value) => JSON.stringify(value === undefined ? null : value);
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clampScore = (value) => Math.max(0, Math.min(100, Math.round(numeric(value, 0))));
const unique = (items = [], limit = MEMORY_LIST_LIMIT) =>
  [...new Set((Array.isArray(items) ? items : []).map((item) => toText(item)).filter(Boolean))].slice(0, limit);

const normalizeComparable = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
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
    .replace(/\bنايك\b/g, "nike")
    .replace(/\bفور\b/g, "4")
    .replace(/\bاربعه\b/g, "4")
    .replace(/\bرابعه\b/g, "4")
    .replace(/\bjordan\s*iv\b/g, "jordan 4")
    .replace(/\bair\s+jordan\s*iv\b/g, "air jordan 4")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();

const normalizeSessionId = (value = "") => toText(value).slice(0, 180);

const normalizePhoneValue = (value = "") => normalizePhone(value).slice(0, 50);

const firstMatch = (text, patterns = []) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return toText(match[1]);
  }
  return "";
};

const containsAny = (text, terms = []) => terms.some((term) => text.includes(term));

const hasClearBuyingIntent = (message = "") => {
  const raw = toText(message);
  const normalized = normalizeComparable(raw);
  return (
    /(?:تمام\s*)?(?:اطلبه|اطلبيه|احجزهولي|احجزهالى|ابعتهولي|ابعتهالى|اعمل\s*اوردر|اعمل\s*أوردر|هاتلي\s*واحد|هاتهولي|هاخده|هاخدها|اكد\s*الطلب|أكد\s*الطلب)/iu.test(raw) ||
    /\b(?:buy|order|checkout|reserve it|send it|i'?ll take it)\b/i.test(raw) ||
    containsAny(normalized, [
      "تمام اطلبه",
      "احجزهولي",
      "ابعتهولي",
      "اعمل اوردر",
      "هاتلي واحد",
      "تمام هاخده",
      "هاخده",
    ])
  );
};

const COLOR_ALIASES = [
  ["black", ["اسود", "أسود", "سودا", "سوداء", "black"]],
  ["white", ["ابيض", "أبيض", "بيضا", "white"]],
  ["red", ["احمر", "أحمر", "red"]],
  ["blue", ["ازرق", "أزرق", "blue"]],
  ["green", ["اخضر", "أخضر", "green"]],
  ["grey", ["رمادي", "رصاصي", "gray", "grey"]],
  ["beige", ["بيج", "beige"]],
  ["brown", ["بني", "brown"]],
  ["navy", ["كحلي", "navy"]],
  ["silver", ["فضي", "silver"]],
  ["gold", ["دهبي", "ذهبي", "gold"]],
];
const COLOR_LABELS_AR = {
  black: "الأسود",
  white: "الأبيض",
  red: "الأحمر",
  blue: "الأزرق",
  green: "الأخضر",
  grey: "الرمادي",
  beige: "البيج",
  brown: "البني",
  navy: "الكحلي",
  silver: "الفضي",
  gold: "الدهبي",
};

const STYLE_ALIASES = [
  ["streetwear", ["ستريت", "street", "streetwear", "اوف وايت", "oversized"]],
  ["daily", ["يومي", "كل يوم", "مشاوير", "daily", "everyday"]],
  ["smart casual", ["شيك", "خروجه", "خروجات", "smart", "casual"]],
  ["sport", ["جيم", "جري", "رياضه", "running", "sport", "training"]],
  ["minimal", ["بسيط", "هادي", "ناعم", "minimal"]],
  ["chunky", ["ضخم", "chunky", "bulky"]],
];

const MODEL_TERMS = ["Jordan 4", "Jordan", "Shox", "Air Force", "Air Max", "Dunk", "Samba", "Gazelle", "New Balance", "Yeezy"];
const BRAND_TERMS = ["Nike", "Adidas", "New Balance", "Puma", "Reebok", "Asics", "Converse", "Vans", "Jordan"];

const MODEL_ALIASES = Object.freeze([
  {
    canonical: "Jordan 4",
    normalized: "jordan 4",
    aliases: ["jordan 4", "air jordan 4", "jordan iv", "air jordan iv", "aj4", "j4", "\u062c\u0648\u0631\u062f\u0646 4", "\u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631"],
  },
  {
    canonical: "Nike Shox",
    normalized: "nike shox",
    aliases: ["nike shox", "shox", "\u0634\u0648\u0643\u0633", "\u0634\u0648\u0643\u0633\u0627\u062a", "\u0646\u0627\u064a\u0643 \u0634\u0648\u0643\u0633"],
  },
]);

const regexSafe = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const modelAliasMatch = (message = "") => {
  const text = normalizeComparable(message);
  return MODEL_ALIASES.find((entry) => entry.aliases.some((alias) => text.includes(normalizeComparable(alias)))) || null;
};

const rejectedModelsFromMessage = (message = "") => {
  const text = normalizeComparable(message);
  const rejected = [];
  for (const entry of MODEL_ALIASES) {
    const aliasPattern = entry.aliases.map((alias) => regexSafe(normalizeComparable(alias))).join("|");
    if (!aliasPattern) continue;
    const explicitReject = new RegExp(`(?:مش\\s+عايز|مش\\s+عاوز|عايزش|عاوزش|مش)\\s+(?:${aliasPattern})|(?:${aliasPattern})\\s+(?:لا|مش|مرفوض)`, "i").test(text);
    if (explicitReject) rejected.push(entry.canonical);
  }
  return unique(rejected);
};

const isCorrectionToNewWant = (message = "") => {
  const text = normalizeComparable(message);
  return /^(?:لا|لاء|لأ)\s+(?:عايز|عاوز|عايزه|عاوزه|محتاج|محتاجه)(?:\s|$)/i.test(text);
};

const rejectsPreviousRecommendation = (message = "") => {
  const text = normalizeComparable(message);
  if (isCorrectionToNewWant(message)) return true;
  return /^(?:لا|لاء|لأ)(?:\s|$)/.test(text) || /(?:لا\s+مش\s+ده|مش\s+ده|غيره|غيرها|بدلها|مش\s+عاجبني)(?:\s|$)/i.test(text);
};

const classifyCustomerState = ({ message = "", current = {}, suggestedProducts = [] } = {}) => {
  const text = normalizeComparable(message);
  if (hasClearBuyingIntent(message)) return "ready_to_buy";
  if (/(هشتري|اشتري|اطلب|اوردر|ضيف|الكارت|cart|buy|order|checkout)/i.test(message)) return "ready_to_buy";
  if (containsAny(text, ["غالي", "مش متاكد", "محتار", "افكر", "متردد", "hesitant", "expensive"])) return "hesitant";
  if (containsAny(text, ["بكام", "السعر", "متاح", "موجود", "مقاس", "لون", "price", "available", "size"])) return "interested";
  if (containsAny(text, ["قارن", "احسن", "ولا", "ايه الفرق", "compare", "better"])) return "comparing";
  if (suggestedProducts.length || current.customer_state === "interested") return "interested";
  return "browsing";
};

const detectUrgency = ({ message = "", customerState = "browsing" } = {}) => {
  const text = normalizeComparable(message);
  if (customerState === "ready_to_buy" || containsAny(text, ["دلوقتي", "النهارده", "حالاً", "حالا", "مستعجل", "now", "today"])) return "high";
  if (customerState === "interested" || customerState === "comparing") return "medium";
  return "low";
};

const detectTone = (message = "") => {
  const text = normalizeComparable(message);
  if (containsAny(text, ["براحه", "مش مستعجل", "اشوف", "اتفرج"])) return "low_pressure";
  if (containsAny(text, ["عايز", "محتاج", "هات", "وريني", "خلاص"])) return "direct";
  return "friendly";
};

export const extractAiConversationMemory = ({ message = "", metadata = {}, suggestedProducts = [] } = {}) => {
  const raw = toText(message);
  const text = normalizeComparable(raw);
  const preferences = {};
  const negative_preferences = {};
  const funnelSelection = metadata.ai_quick_funnel || metadata.quick_funnel || {};
  const funnelValue = toText(funnelSelection.value || funnelSelection.message || funnelSelection.label);
  const funnelStep = toText(funnelSelection.step || funnelSelection.field);
  const area = toText(metadata.city_area || metadata.area || metadata.customer_area).slice(0, 120);
  const city = toText(metadata.city || metadata.governorate).slice(0, 120);
  const address = toText(metadata.customer_address || metadata.address || metadata.shipping_address).slice(0, 240);

  const phone = normalizePhoneValue(
    metadata.customer_phone ||
      firstMatch(raw, [
        /(?:رقمي|رقم(?:ي)?|موبايلي|واتسابي|whatsapp|phone)\s*[:：]?\s*(\+?\d[\d\s().-]{6,18})/i,
        /(\+?20?1[0125][\d\s().-]{8,12})/,
      ])
  );
  const name = toText(
    metadata.customer_name ||
      firstMatch(raw, [
        /(?:اسمي|انا اسمي|معاك|معاكي)\s+([\p{L}\s]{2,40})/iu,
        /(?:my name is|i am|i'm)\s+([A-Za-z\s]{2,40})/i,
      ])
  ).slice(0, 80);

  const size = firstMatch(raw, [
    /(?:مقاسي|مقاس(?:ي)?|size)\s*(?:هو|=|:)?\s*(3[0-9]|4[0-9]|5[0-5]|xs|s|m|l|xl|xxl|xxxl)\b/i,
    /\b(3[0-9]|4[0-9]|5[0-5])\b/,
  ]);
  if (size) preferences.size = size.toUpperCase();
  if (city) preferences.city = city;
  if (area) preferences.city_area = area;
  if (address) preferences.last_address = address;

  const budget = firstMatch(raw, [
    /(?:ميزانيتي|budget|في حدود|لحد|حدود)\s*(\d{3,6})/i,
    /(\d{3,6})\s*(?:جنيه|ج\.م|egp)/i,
  ]);
  if (budget) preferences.budget = Number(budget);

  const colors = COLOR_ALIASES.filter(([, aliases]) => aliases.some((alias) => text.includes(normalizeComparable(alias)))).map(([color]) => color);
  if (colors.length) {
    preferences.favorite_color = colors[0];
    preferences.preferred_colors = colors;
  }

  const styles = STYLE_ALIASES.filter(([, aliases]) => aliases.some((alias) => text.includes(normalizeComparable(alias)))).map(([style]) => style);
  if (styles.length) {
    preferences.favorite_style = styles[0];
    preferences.preferred_styles = styles;
  }

  const models = MODEL_TERMS.filter((model) => text.includes(normalizeComparable(model)));
  if (models.length) preferences.favorite_models = models;

  const brands = BRAND_TERMS.filter((brand) => text.includes(normalizeComparable(brand)));
  if (brands.length) preferences.preferred_brands = brands;

  if (funnelValue) {
    preferences.ai_quick_funnel_step = funnelStep || "";
    if (["style", "vibe", "occasion"].includes(funnelStep)) {
      preferences.favorite_style = funnelValue;
      preferences.preferred_styles = unique([...(preferences.preferred_styles || []), funnelValue]);
    }
    if (funnelStep === "color") {
      preferences.favorite_color = funnelValue;
      preferences.preferred_colors = unique([...(preferences.preferred_colors || []), funnelValue]);
    }
    if (funnelStep === "size") preferences.size = funnelValue.toUpperCase();
    if (funnelStep === "gender") preferences.gender = funnelValue;
    if (funnelStep === "product_type") preferences.preferred_category = funnelValue;
  }

  if (containsAny(text, ["رجالي", "men", "mens"])) preferences.gender = "men";
  if (containsAny(text, ["حريمي", "بناتي", "women", "womens", "ladies"])) preferences.gender = "women";
  if (containsAny(text, ["اطفال", "ولادي", "kids"])) preferences.gender = "kids";

  if (containsAny(text, ["كوتشي", "سنيكر", "sneaker", "shoe"])) preferences.preferred_category = "sneakers";
  if (containsAny(text, ["تيشيرت", "هودي", "بنطلون", "t-shirt", "hoodie", "pants"])) preferences.preferred_category = "fashion";

  if (containsAny(text, ["مش بحب", "مبحبش", "مش عايز", "بلاش", "not like", "don't like"])) {
    if (containsAny(text, ["ضخم", "chunky", "bulky"])) negative_preferences.avoid_styles = ["chunky"];
  }
  if (negative_preferences.avoid_styles?.length && preferences.preferred_styles?.length) {
    preferences.preferred_styles = preferences.preferred_styles.filter((style) => !negative_preferences.avoid_styles.includes(style));
    if (negative_preferences.avoid_styles.includes(preferences.favorite_style)) {
      preferences.favorite_style = preferences.preferred_styles[0] || "";
    }
  }

  const shoppingIntent = firstMatch(raw, [
    /(?:عايز|عايزة|محتاج|محتاجة|بدور على)\s+([^؟?.!]{3,80})/i,
    /(?:looking for|need|want)\s+([^؟?.!]{3,80})/i,
  ]) || (styles[0] || "");
  const customerState = classifyCustomerState({ message: raw, suggestedProducts });
  const urgencyLevel = detectUrgency({ message: raw, customerState });
  const supportIssue = containsAny(text, ["شكوى", "مشكلة", "زعلان", "استبدال", "استرجاع", "return", "exchange", "complaint"]);
  if (supportIssue) preferences.support_issues = unique([...(preferences.support_issues || []), raw.slice(0, 140)], 5);
  if (customerState === "hesitant" && suggestedProducts.length) {
    preferences.abandoned_products = summarizeProducts(suggestedProducts).slice(0, 5);
  }

  return {
    customer_name: name,
    customer_phone: phone,
    preferences,
    negative_preferences,
    shopping_intent: toText(shoppingIntent).slice(0, 160),
    conversation_tone: detectTone(raw),
    urgency_level: urgencyLevel,
    preferred_category: preferences.preferred_category || "",
    customer_state: customerState,
  };
};

export const ensureAiConversationMemorySchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_conversation_memories (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          session_id TEXT NOT NULL,
          customer_id BIGINT NULL,
          customer_name TEXT NOT NULL DEFAULT '',
          customer_phone TEXT NOT NULL DEFAULT '',
          preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
          negative_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
          shopping_intent TEXT NOT NULL DEFAULT '',
          last_products JSONB NOT NULL DEFAULT '[]'::jsonb,
          conversation_tone TEXT NOT NULL DEFAULT 'friendly',
          urgency_level TEXT NOT NULL DEFAULT 'low',
          preferred_category TEXT NOT NULL DEFAULT '',
          customer_state TEXT NOT NULL DEFAULT 'browsing',
          lead_quality_score INTEGER NOT NULL DEFAULT 0,
          engagement_score INTEGER NOT NULL DEFAULT 0,
          intent_score INTEGER NOT NULL DEFAULT 0,
          lead_capture_prompted_at TIMESTAMP NULL,
          lead_captured_at TIMESTAMP NULL,
          last_interaction_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, session_id)
        )
      `);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_conversation_memories_tenant_phone ON ai_conversation_memories (tenant_id, customer_phone)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_conversation_memories_tenant_updated ON ai_conversation_memories (tenant_id, updated_at DESC)`);

      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_customer_profile JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_preferences JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_last_intent TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_last_seen_products JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_lead_quality_score INTEGER NOT NULL DEFAULT 0`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_engagement_score INTEGER NOT NULL DEFAULT 0`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_intent_score INTEGER NOT NULL DEFAULT 0`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS ai_last_interaction_at TIMESTAMP NULL`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

export const resolveAiConversationIdentity = ({ req = null, tenantId = null, metadata = {} } = {}) => {
  const body = req?.body || {};
  const merged = { ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}), ...metadata };
  return {
    tenantId: Number(tenantId || body.tenant_id || body.tenantId || req?.headers?.["x-tenant-id"] || 0) || null,
    sessionId: normalizeSessionId(merged.session_id || body.session_id || req?.headers?.["x-session-id"] || req?.id || ""),
    customerPhone: normalizePhoneValue(merged.customer_phone || body.customer_phone || body.phone || ""),
    customerName: toText(merged.customer_name || body.customer_name || body.name).slice(0, 80),
  };
};

export const loadAiConversationMemory = async ({ tenantId, sessionId, customerPhone = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = normalizeSessionId(sessionId);
  const safePhone = normalizePhoneValue(customerPhone);
  if (!safeTenantId || (!safeSessionId && !safePhone)) return null;

  await ensureAiConversationMemorySchema();
  const params = [safeTenantId];
  const lookupClauses = [];
  if (safeSessionId) {
    params.push(safeSessionId);
    lookupClauses.push(`session_id = $${params.length}`);
  }
  if (safePhone) {
    params.push(safePhone);
    lookupClauses.push(`customer_phone = $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT *
    FROM ai_conversation_memories
    WHERE tenant_id = $1
      AND (${lookupClauses.join(" OR ")})
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    params
  );
  const memory = result.rows[0] || null;
  if (memory) {
    const preferences = memory.preferences || {};
    memory.active_product_id = memory.active_product_id || preferences.active_product_id || preferences.selected_product_id || preferences.last_product_id || "";
    memory.active_variant_id = memory.active_variant_id || preferences.active_variant_id || preferences.selected_variant_id || preferences.last_product_variant_id || "";
    memory.active_color = memory.active_color || preferences.active_color || preferences.selected_color || preferences.last_selected_color || "";
    memory.active_model_family = memory.active_model_family || preferences.active_model_family || preferences.last_model_family || "";
    memory.selected_product_context = memory.selected_product_context || preferences.selected_product_context || preferences.last_product || preferences.lastProductCard || null;
    memory.selected_product_id = memory.selected_product_id || preferences.selected_product_id || preferences.last_product_id || "";
    memory.selected_variant_id = memory.selected_variant_id || preferences.selected_variant_id || preferences.last_product_variant_id || "";
    memory.selected_color = memory.selected_color || preferences.selected_color || preferences.last_selected_color || "";
  }
  return memory;
};

const mergePreferences = (current = {}, next = {}) => {
  const merged = { ...(current || {}) };
  for (const [key, value] of Object.entries(next || {})) {
    if (Array.isArray(value)) merged[key] = unique([...(Array.isArray(merged[key]) ? merged[key] : []), ...value]);
    else if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  return merged;
};

const productColorList = (product = {}) =>
  unique([
    product?.color,
    product?.requested_color,
    product?.matched_variant_color,
    product?.colors,
    product?.available_colors,
    ...(Array.isArray(product?.variants) ? product.variants.map((variant) => variant?.color || variant?.color_name || variant?.name) : []),
  ].flatMap((item) => Array.isArray(item) ? item : String(item || "").split(/[,،/|]+/)), 12);

const productSizeList = (product = {}) =>
  unique([
    product?.size,
    product?.requested_size,
    product?.matched_variant_size,
    product?.sizes,
    product?.available_sizes,
    product?.size_options,
    product?.inventory_profile?.available_sizes,
    ...(Array.isArray(product?.variants) ? product.variants.map((variant) => variant?.size) : []),
  ].flatMap((item) => Array.isArray(item) ? item : String(item || "").split(/[,،/|]+/)), 16);

const productModelFamily = (product = {}) => {
  const blob = normalizeComparable([
    product?.name,
    product?.title,
    product?.product_name,
    product?.brand,
    product?.model,
    product?.model_family,
    product?.slug,
    product?.canonical_slug,
  ].filter(Boolean).join(" "));
  if (/jordan\s*4|air\s*jordan\s*4|aj4|j4|جوردن\s*(4|فور)/i.test(blob)) return "air_jordan_4";
  if (/jordan|جوردن/i.test(blob)) return "jordan";
  if (/adidas|اديداس/i.test(blob)) return "adidas";
  if (/nike|نايك/i.test(blob)) return "nike";
  return toText(product?.model_family || product?.model || product?.brand || "").slice(0, 80);
};

const summarizeProductVariants = (product = {}) =>
  (Array.isArray(product?.variants) ? product.variants : [])
    .map((variant) => ({
      id: variant?.id ?? variant?.variant_id ?? null,
      color: toText(variant?.color || variant?.color_name || variant?.name).slice(0, 80),
      size: toText(variant?.size).slice(0, 30),
      stock: numeric(variant?.stock || variant?.quantity, 0),
      image_url: toText(variant?.image_url || variant?.variant_image_url || variant?.color_image_url || variant?.primary_image_url).slice(0, 500),
    }))
    .filter((variant) => variant.color || variant.size || variant.image_url)
    .slice(0, 16);

const summarizeProducts = (products = []) =>
  (Array.isArray(products) ? products : [])
    .map((product, index) => ({
      card_index: Number(product?.card_index || product?.index || 0) > 0 ? Number(product.card_index || product.index) : index + 1,
      id: product?.id ?? product?.product_id ?? "",
      product_id: product?.product_id ?? product?.id ?? "",
      name: toText(product?.name || product?.title || product?.product_name).slice(0, 160),
      product_name: toText(product?.product_name || product?.name || product?.title).slice(0, 160),
      brand: toText(product?.brand || product?.brand_name).slice(0, 120),
      model_family: productModelFamily(product),
      price: numeric(product?.final_price || product?.price || product?.sale_price, 0) || null,
      stock: numeric(product?.total_stock || product?.stock, 0),
      availability: toText(product?.stock_status || product?.availability),
      color: toText(product?.color || product?.matched_variant_color || product?.requested_color).slice(0, 80),
      size_options: productSizeList(product).slice(0, 16),
      image_url: toText(product?.image_url || product?.image || product?.main_image || product?.thumbnail || product?.matched_variant_image || product?.matched_image_url).slice(0, 500),
      product_url: toText(product?.product_url || product?.url).slice(0, 500),
      colors: productColorList(product),
      variants: summarizeProductVariants(product),
    }))
    .filter((product) => product.id || product.name)
    .slice(0, MEMORY_PRODUCT_LIMIT);

const firstNonEmptyText = (...values) => values.map((value) => toText(value)).find(Boolean) || "";

const summarizeActiveProductContext = (product = {}, fallback = {}) => {
  if (!product || typeof product !== "object") {
    return {
      active_product_id: firstNonEmptyText(fallback.active_product_id, fallback.selected_product_id),
      active_variant_id: firstNonEmptyText(fallback.active_variant_id, fallback.selected_variant_id),
      active_color: firstNonEmptyText(fallback.active_color, fallback.selected_color),
      active_model_family: firstNonEmptyText(fallback.active_model_family, fallback.last_model_family),
      selected_product_context: null,
    };
  }

  const selectedVariant = product.selected_variant || product.variant || product.matched_variant || {};
  const summarized = summarizeProducts([product])[0] || product;
  return {
    active_product_id: firstNonEmptyText(product.product_id, product.id, fallback.active_product_id, fallback.selected_product_id),
    active_variant_id: firstNonEmptyText(
      product.selected_variant_id,
      product.variant_id,
      selectedVariant.id,
      selectedVariant.variant_id,
      fallback.active_variant_id,
      fallback.selected_variant_id
    ),
    active_color: firstNonEmptyText(
      product.color,
      product.selected_color,
      product.matched_variant_color,
      selectedVariant.color,
      selectedVariant.color_name,
      fallback.active_color,
      fallback.selected_color
    ),
    active_model_family: firstNonEmptyText(
      product.model_family,
      product.model,
      product.brand,
      summarized.model_family,
      fallback.active_model_family,
      fallback.last_model_family
    ),
    selected_product_context: summarized,
  };
};

const hasFollowUpContextSignal = (message = "", metadata = {}) => {
  const blob = normalizeComparable([
    message,
    metadata?.followup_intent,
    metadata?.detected_intent,
    metadata?.message_type,
  ].filter(Boolean).join(" "));
  return /(?:اللون|لون|color|صور|image|photo|صور أكتر|more images|المقاس|مقاس|size|غالي|السعر|price|بدائل|بديل|alternatives?)/i.test(blob);
};

export const resolveActiveProductContext = ({
  current = null,
  message = "",
  metadata = {},
  suggestedProducts = [],
  preferencesPatch = {},
} = {}) => {
  const currentPreferences = current?.preferences || {};
  const patch = preferencesPatch && typeof preferencesPatch === "object" ? preferencesPatch : {};
  const candidate =
    patch.selected_product_context ||
    patch.last_product ||
    metadata.selected_product_context ||
    metadata.selectedProductContext ||
    metadata.product_context ||
    metadata.selected_product ||
    metadata.product_card ||
    currentPreferences.selected_product_context ||
    currentPreferences.last_product ||
    currentPreferences.lastProductCard ||
    current?.selected_product_context ||
    current?.last_product ||
    current?.lastProductCard ||
    (Array.isArray(suggestedProducts) && suggestedProducts[0]) ||
    (Array.isArray(current?.last_products) && current.last_products[0]) ||
    null;

  const baseFallback = {
    active_product_id: current?.active_product_id || currentPreferences.active_product_id || currentPreferences.selected_product_id || currentPreferences.last_product_id || "",
    active_variant_id: current?.active_variant_id || currentPreferences.active_variant_id || currentPreferences.selected_variant_id || currentPreferences.last_product_variant_id || "",
    active_color: current?.active_color || currentPreferences.active_color || currentPreferences.selected_color || currentPreferences.last_selected_color || "",
    active_model_family: current?.active_model_family || currentPreferences.active_model_family || currentPreferences.last_model_family || "",
    selected_product_id: currentPreferences.selected_product_id || currentPreferences.last_product_id || "",
    selected_variant_id: currentPreferences.selected_variant_id || currentPreferences.last_product_variant_id || "",
    selected_color: currentPreferences.selected_color || currentPreferences.last_selected_color || "",
    last_model_family: currentPreferences.last_model_family || "",
  };

  const active = summarizeActiveProductContext(candidate || {}, baseFallback);
  const shouldPreserveCurrent = !candidate && hasFollowUpContextSignal(message, metadata) && (
    Boolean(baseFallback.active_product_id) ||
    Boolean(baseFallback.active_variant_id) ||
    Boolean(baseFallback.active_color) ||
    Boolean(baseFallback.active_model_family)
  );

  if (shouldPreserveCurrent) {
    return {
      ...baseFallback,
      selected_product_context: currentPreferences.selected_product_context || currentPreferences.last_product || currentPreferences.lastProductCard || null,
    };
  }

  return active;
};

const scoreMemory = ({ memory = {}, extracted = {}, suggestedProducts = [] } = {}) => {
  const preferences = memory.preferences || {};
  const preferenceCount = Object.values(preferences).filter((value) => Array.isArray(value) ? value.length : Boolean(value)).length;
  const customerState = extracted.customer_state || memory.customer_state || "browsing";
  const hasPhone = Boolean(extracted.customer_phone || memory.customer_phone);
  const leadQuality = clampScore(preferenceCount * 8 + (hasPhone ? 35 : 0) + (suggestedProducts.length ? 10 : 0) + (customerState === "ready_to_buy" ? 25 : 0));
  const engagement = clampScore(numeric(memory.engagement_score, 0) + 8 + (suggestedProducts.length ? 5 : 0));
  const intent = clampScore(
    (customerState === "ready_to_buy" ? 85 : customerState === "interested" ? 62 : customerState === "comparing" ? 55 : customerState === "hesitant" ? 45 : 25) +
      (extracted.shopping_intent ? 8 : 0)
  );
  return { leadQuality, engagement, intent };
};

const upsertCustomerAiProfile = async ({ tenantId, memory }) => {
  const phone = normalizePhoneValue(memory.customer_phone);
  if (!tenantId || !phone) return null;
  const phoneVariants = getPhoneSearchVariants(phone);
  const profile = {
    session_id: memory.session_id,
    customer_state: memory.customer_state,
    urgency_level: memory.urgency_level,
    conversation_tone: memory.conversation_tone,
    last_interaction_at: memory.last_interaction_at,
  };

  const found = await db.query(
    `
    SELECT id, name, phone
    FROM customers
    WHERE tenant_id = $1
      AND ${phoneSqlDigits("phone")} = ANY($2::text[])
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [tenantId, phoneVariants.length ? phoneVariants : [phone.replace(/\D/g, "")]]
  );

  if (found.rows[0]) {
    const result = await db.query(
      `
      UPDATE customers
      SET
        name = COALESCE(NULLIF($2, ''), name),
        ai_customer_profile = COALESCE(ai_customer_profile, '{}'::jsonb) || $3::jsonb,
        ai_preferences = COALESCE(ai_preferences, '{}'::jsonb) || $4::jsonb,
        ai_last_intent = $5,
        ai_last_seen_products = $6::jsonb,
        ai_lead_quality_score = GREATEST(COALESCE(ai_lead_quality_score, 0), $7),
        ai_engagement_score = GREATEST(COALESCE(ai_engagement_score, 0), $8),
        ai_intent_score = GREATEST(COALESCE(ai_intent_score, 0), $9),
        ai_last_interaction_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
      `,
      [
        found.rows[0].id,
        toText(memory.customer_name),
        jsonValue(profile),
        jsonValue(memory.preferences || {}),
        toText(memory.shopping_intent),
        jsonValue(memory.last_products || []),
        clampScore(memory.lead_quality_score),
        clampScore(memory.engagement_score),
        clampScore(memory.intent_score),
      ]
    );
    return result.rows[0] || null;
  }

  const result = await db.query(
    `
    INSERT INTO customers (
      tenant_id, name, phone, status, ai_customer_profile, ai_preferences, ai_last_intent,
      ai_last_seen_products, ai_lead_quality_score, ai_engagement_score, ai_intent_score, ai_last_interaction_at
    )
    VALUES ($1, $2, $3, 'lead', $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $9, $10, CURRENT_TIMESTAMP)
    RETURNING id
    `,
    [
      tenantId,
      toText(memory.customer_name, "AI Storefront Lead") || "AI Storefront Lead",
      phone,
      jsonValue(profile),
      jsonValue(memory.preferences || {}),
      toText(memory.shopping_intent),
      jsonValue(memory.last_products || []),
      clampScore(memory.lead_quality_score),
      clampScore(memory.engagement_score),
      clampScore(memory.intent_score),
    ]
  );
  return result.rows[0] || null;
};

export const updateAiConversationMemory = async ({
  tenantId,
  sessionId,
  customerPhone = "",
  customerName = "",
  message = "",
  metadata = {},
  suggestedProducts = [],
  preferencesPatch = {},
} = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = normalizeSessionId(sessionId);
  if (!safeTenantId || !safeSessionId) return null;

  await ensureAiConversationMemorySchema();
  const current = await loadAiConversationMemory({ tenantId: safeTenantId, sessionId: safeSessionId, customerPhone });
  const extracted = extractAiConversationMemory({ message, metadata: { ...metadata, customer_phone: customerPhone, customer_name: customerName }, suggestedProducts });
  const preferences = mergePreferences(current?.preferences || {}, extracted.preferences);
  const negativePreferences = mergePreferences(current?.negative_preferences || {}, extracted.negative_preferences);
  const detectedModel = modelAliasMatch(message);
  const explicitlyRejectedModels = rejectedModelsFromMessage(message);
  const previousLastProductIds = unique([
    ...((current?.preferences?.lastRecommendedProductIds || []).map(String)),
    ...((current?.last_products || []).map((product) => String(product?.id || "")).filter(Boolean)),
  ]);
  const previousVisualMatchIds = unique((current?.preferences?.lastVisualMatches || []).map(String));
  const rejectedPrevious = rejectsPreviousRecommendation(message);
  const rejectedProductIds = unique([
    ...((current?.preferences?.rejectedProductIds || []).map(String)),
    ...(rejectedPrevious ? previousLastProductIds : []),
  ]);
  const rejectedVisualMatches = unique([
    ...((current?.preferences?.rejectedVisualMatches || []).map(String)),
    ...(rejectedPrevious ? previousVisualMatchIds : []),
  ]);
  const rejectedModelNames = unique([
    ...((current?.preferences?.rejectedModelNames || []).map(String)),
    ...explicitlyRejectedModels,
  ]);
  const currentRequestedModel = detectedModel
    ? (explicitlyRejectedModels.includes(detectedModel.canonical) ? "" : detectedModel.normalized)
    : toText(current?.preferences?.currentRequestedModel || "");
  const lastRecommendedProductIds = suggestedProducts.length
    ? unique(summarizeProducts(suggestedProducts).map((product) => String(product.id || "")).filter(Boolean))
    : unique(Array.isArray(current?.preferences?.lastRecommendedProductIds) ? current.preferences.lastRecommendedProductIds.map(String) : []);
  const summarizedSuggestedProducts = summarizeProducts(suggestedProducts);
  const lastSuggestedProduct = summarizedSuggestedProducts[0] || null;
  const safePreferencesPatch = preferencesPatch && typeof preferencesPatch === "object" ? preferencesPatch : {};
  const metadataSalesEngine = metadata?.sales_engine && typeof metadata.sales_engine === "object" ? metadata.sales_engine : null;
  preferences.rejectedProductIds = rejectedProductIds;
  preferences.rejectedModelNames = rejectedModelNames;
  preferences.currentRequestedModel = currentRequestedModel;
  preferences.currentRequestedModelName = detectedModel && currentRequestedModel ? detectedModel.canonical : toText(current?.preferences?.currentRequestedModelName || "");
  preferences.lastRecommendedProductIds = lastRecommendedProductIds;
  preferences.last_recommended_product_ids = lastRecommendedProductIds;
  if (lastSuggestedProduct) {
    preferences.last_product = lastSuggestedProduct;
    preferences.last_product_id = lastSuggestedProduct.product_id || lastSuggestedProduct.id || "";
    preferences.last_product_name = lastSuggestedProduct.name || "";
    preferences.last_model_family = lastSuggestedProduct.model_family || "";
    preferences.lastProductCard = lastSuggestedProduct;
    preferences.last_product_cards = summarizedSuggestedProducts;
  }
  preferences.lastVisualQuery = toText(current?.preferences?.lastVisualQuery || "");
  preferences.lastVisualFeatures = current?.preferences?.lastVisualFeatures || {};
  preferences.lastVisualMatches = previousVisualMatchIds;
  preferences.rejectedVisualMatches = rejectedVisualMatches;
  if (metadataSalesEngine) {
    preferences.sales_engine_state = toText(metadataSalesEngine.next_state || metadataSalesEngine.current_state || preferences.sales_engine_state || "");
    preferences.sales_engine_previous_state = toText(metadataSalesEngine.previous_state || preferences.sales_engine_previous_state || "");
    preferences.sales_engine_reason = toText(metadataSalesEngine.reason || preferences.sales_engine_reason || "");
    preferences.sales_engine_next_action = toText(metadataSalesEngine.recommended_next_action || preferences.sales_engine_next_action || "");
    preferences.sales_engine_missing_info = Array.isArray(metadataSalesEngine.missing_info) ? metadataSalesEngine.missing_info : preferences.sales_engine_missing_info || [];
  }
  Object.assign(preferences, safePreferencesPatch);
  if (Array.isArray(safePreferencesPatch.lastVisualMatches)) {
    preferences.lastVisualMatches = unique(safePreferencesPatch.lastVisualMatches.map(String));
  }
  if (safePreferencesPatch.lastVisualFeatures && typeof safePreferencesPatch.lastVisualFeatures === "object") {
    preferences.lastVisualFeatures = safePreferencesPatch.lastVisualFeatures;
  }
  if (safePreferencesPatch.lastVisualQuery !== undefined) {
    preferences.lastVisualQuery = toText(safePreferencesPatch.lastVisualQuery).slice(0, 240);
  }
  if (Array.isArray(safePreferencesPatch.rejectedVisualMatches)) {
    preferences.rejectedVisualMatches = unique([
      ...rejectedVisualMatches,
      ...safePreferencesPatch.rejectedVisualMatches.map(String),
    ]);
  }
  if (Array.isArray(preferences.last_product_cards)) {
    preferences.last_product_cards = summarizeProducts(preferences.last_product_cards);
  }
  const activeContext = resolveActiveProductContext({
    current,
    message,
    metadata,
    suggestedProducts,
    preferencesPatch: safePreferencesPatch,
  });
  preferences.active_product_id = activeContext.active_product_id || preferences.active_product_id || preferences.selected_product_id || preferences.last_product_id || "";
  preferences.active_variant_id = activeContext.active_variant_id || preferences.active_variant_id || preferences.selected_variant_id || preferences.last_product_variant_id || "";
  preferences.active_color = activeContext.active_color || preferences.active_color || preferences.selected_color || preferences.last_selected_color || "";
  preferences.active_model_family = activeContext.active_model_family || preferences.active_model_family || preferences.last_model_family || "";
  preferences.selected_product_context = activeContext.selected_product_context || preferences.selected_product_context || preferences.last_product || preferences.lastProductCard || null;
  preferences.selected_product_id = preferences.selected_product_context?.product_id || preferences.selected_product_context?.id || preferences.selected_product_id || preferences.last_product_id || "";
  preferences.selected_variant_id = preferences.selected_product_context?.variant_id || preferences.selected_variant_id || preferences.last_product_variant_id || "";
  preferences.selected_color = preferences.active_color || preferences.selected_color || preferences.last_selected_color || "";
  preferences.last_product = preferences.selected_product_context || preferences.last_product || null;
  preferences.last_product_id = preferences.selected_product_id || preferences.last_product_id || "";
  preferences.last_product_name = preferences.selected_product_context?.name || preferences.selected_product_context?.title || preferences.last_product_name || "";
  preferences.last_model_family = preferences.active_model_family || preferences.last_model_family || "";
  preferences.last_selected_color = preferences.selected_color || preferences.last_selected_color || "";
  if (preferences.selected_product_context && typeof preferences.selected_product_context === "object") {
    preferences.selected_product_context = summarizeProducts([preferences.selected_product_context])[0] || preferences.selected_product_context;
  }
  const lastProducts = unique([...summarizedSuggestedProducts, ...((current?.last_products || []).filter(Boolean))].map((item) => JSON.stringify(item)), MEMORY_PRODUCT_LIMIT)
    .map((item) => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const baseMemory = {
    ...(current || {}),
    tenant_id: safeTenantId,
    session_id: safeSessionId,
    customer_name: extracted.customer_name || customerName || current?.customer_name || "",
    customer_phone: extracted.customer_phone || customerPhone || current?.customer_phone || "",
    preferences,
    negative_preferences: negativePreferences,
    shopping_intent: extracted.shopping_intent || current?.shopping_intent || "",
    last_products: lastProducts,
    conversation_tone: extracted.conversation_tone || current?.conversation_tone || "friendly",
    urgency_level: extracted.urgency_level || current?.urgency_level || "low",
    preferred_category: extracted.preferred_category || current?.preferred_category || preferences.preferred_category || "",
    customer_state: extracted.customer_state || current?.customer_state || "browsing",
  };
  const scores = scoreMemory({ memory: baseMemory, extracted, suggestedProducts });

  const result = await db.query(
    `
    INSERT INTO ai_conversation_memories (
      tenant_id, session_id, customer_name, customer_phone, preferences, negative_preferences,
      shopping_intent, last_products, conversation_tone, urgency_level, preferred_category,
      customer_state, lead_quality_score, engagement_score, intent_score, lead_captured_at,
      last_interaction_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, CASE WHEN $4 <> '' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_conversation_memories.customer_name),
      customer_phone = COALESCE(NULLIF(EXCLUDED.customer_phone, ''), ai_conversation_memories.customer_phone),
      preferences = COALESCE(ai_conversation_memories.preferences, '{}'::jsonb) || EXCLUDED.preferences,
      negative_preferences = COALESCE(ai_conversation_memories.negative_preferences, '{}'::jsonb) || EXCLUDED.negative_preferences,
      shopping_intent = COALESCE(NULLIF(EXCLUDED.shopping_intent, ''), ai_conversation_memories.shopping_intent),
      last_products = EXCLUDED.last_products,
      conversation_tone = EXCLUDED.conversation_tone,
      urgency_level = EXCLUDED.urgency_level,
      preferred_category = COALESCE(NULLIF(EXCLUDED.preferred_category, ''), ai_conversation_memories.preferred_category),
      customer_state = EXCLUDED.customer_state,
      lead_quality_score = GREATEST(ai_conversation_memories.lead_quality_score, EXCLUDED.lead_quality_score),
      engagement_score = GREATEST(ai_conversation_memories.engagement_score, EXCLUDED.engagement_score),
      intent_score = GREATEST(ai_conversation_memories.intent_score, EXCLUDED.intent_score),
      lead_captured_at = COALESCE(ai_conversation_memories.lead_captured_at, EXCLUDED.lead_captured_at),
      last_interaction_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      safeTenantId,
      safeSessionId,
      baseMemory.customer_name,
      baseMemory.customer_phone,
      jsonValue(preferences),
      jsonValue(negativePreferences),
      baseMemory.shopping_intent,
      jsonValue(lastProducts),
      baseMemory.conversation_tone,
      baseMemory.urgency_level,
      baseMemory.preferred_category,
      baseMemory.customer_state,
      scores.leadQuality,
      scores.engagement,
      scores.intent,
    ]
  );

  const memory = result.rows[0] || null;
  if (memory?.customer_phone) {
    memory.active_product_id = preferences.active_product_id || "";
    memory.active_variant_id = preferences.active_variant_id || "";
    memory.active_color = preferences.active_color || "";
    memory.active_model_family = preferences.active_model_family || "";
    memory.selected_product_context = preferences.selected_product_context || null;
    memory.selected_product_id = preferences.selected_product_id || "";
    memory.selected_variant_id = preferences.selected_variant_id || "";
    memory.selected_color = preferences.selected_color || "";
    const customer = await upsertCustomerAiProfile({ tenantId: safeTenantId, memory }).catch((error) => {
      console.warn("[ai-memory] CRM sync skipped", { tenantId: safeTenantId, message: error?.message });
      return null;
    });
    if (customer?.id) {
      await db.query(`UPDATE ai_conversation_memories SET customer_id = $3 WHERE tenant_id = $1 AND session_id = $2`, [safeTenantId, safeSessionId, customer.id]);
      memory.customer_id = customer.id;
    }
  }
  if (memory) {
    memory.active_product_id = preferences.active_product_id || "";
    memory.active_variant_id = preferences.active_variant_id || "";
    memory.active_color = preferences.active_color || "";
    memory.active_model_family = preferences.active_model_family || "";
    memory.selected_product_context = preferences.selected_product_context || null;
    memory.selected_product_id = preferences.selected_product_id || "";
    memory.selected_variant_id = preferences.selected_variant_id || "";
    memory.selected_color = preferences.selected_color || "";
  }
  return memory;
};

export const buildAiMemoryContextSource = (memory = null) => {
  if (!memory) return null;
  return {
    id: "conversation_memory",
    title: "AI conversation memory for this shopper",
    content: JSON.stringify({
      preferences: memory.preferences || {},
      negative_preferences: memory.negative_preferences || {},
      shopping_intent: memory.shopping_intent || "",
      customer_state: memory.customer_state || "browsing",
      urgency_level: memory.urgency_level || "low",
      preferred_category: memory.preferred_category || "",
      last_products: memory.last_products || [],
      rejectedProductIds: memory.preferences?.rejectedProductIds || [],
      rejectedModelNames: memory.preferences?.rejectedModelNames || [],
      currentRequestedModel: memory.preferences?.currentRequestedModel || "",
      lastRecommendedProductIds: memory.preferences?.lastRecommendedProductIds || [],
      lastVisualQuery: memory.preferences?.lastVisualQuery || "",
      lastVisualFeatures: memory.preferences?.lastVisualFeatures || {},
      lastVisualMatches: memory.preferences?.lastVisualMatches || [],
      rejectedVisualMatches: memory.preferences?.rejectedVisualMatches || [],
      active_product_id: memory.active_product_id || memory.preferences?.active_product_id || "",
      active_variant_id: memory.active_variant_id || memory.preferences?.active_variant_id || "",
      active_color: memory.active_color || memory.preferences?.active_color || "",
      active_model_family: memory.active_model_family || memory.preferences?.active_model_family || "",
      selected_product_id: memory.selected_product_id || memory.preferences?.selected_product_id || "",
      selected_variant_id: memory.selected_variant_id || memory.preferences?.selected_variant_id || "",
      selected_color: memory.selected_color || memory.preferences?.selected_color || "",
      lead_quality_score: memory.lead_quality_score || 0,
      engagement_score: memory.engagement_score || 0,
      intent_score: memory.intent_score || 0,
    }),
  };
};

const randomBySeed = (items = [], seed = "") => {
  if (!items.length) return "";
  const total = String(seed || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return items[total % items.length];
};

export const personalizeAiSupportResponse = ({ response = {}, memory = null } = {}) => {
  if (!memory || !response?.answer) return response;
  const preferences = memory.preferences || {};
  const suggestedProducts = Array.isArray(response.suggested_products) ? response.suggested_products : [];
  const answer = toText(response.answer);
  const hasPersonalCue = /بما إن|طالما|قريب من الستايل|مقاسك|بتحب/i.test(answer);
  const introParts = [];

  if (!hasPersonalCue && preferences.favorite_color && suggestedProducts.length) introParts.push(`فيه اختيارات قريبة من اللون ${preferences.favorite_color}.`);
  if (!hasPersonalCue && preferences.size && suggestedProducts.length) introParts.push(`طالما مقاسك ${preferences.size} خلينا نركز على المتاح منه.`);

  const customerState = memory.customer_state || "browsing";
  const leadReady = !memory.customer_phone && customerState === "ready_to_buy";
  const leadPrompt = leadReady
    ? randomBySeed([
        "تحب أبعتلك المتاح والمقاسات على واتساب؟",
        "سيبلي رقمك وأنا أبعتلك أفضل اختيار بالمقاس المتاح دلوقتي.",
        "لو حابب، أبعتلك الصور والمقاسات على واتساب من غير لف كتير.",
      ], `${memory.session_id}-${memory.engagement_score}`)
    : "";
  const stateLine = customerState === "hesitant"
    ? "ولو مش متأكد، أطلعلك بديل أهدى في نفس الرينج."
    : customerState === "ready_to_buy"
      ? "المقاس ده بيتحرك بسرعة شوية."
      : "";

  return {
    ...response,
    answer: [introParts.join(" "), answer, stateLine, leadReady ? "تشرفنا ❤️ ممكن أعرف اسم حضرتك؟" : leadPrompt].filter(Boolean).join(" "),
    memory: {
      preferences,
      shopping_intent: memory.shopping_intent || "",
      customer_state: customerState,
      urgency_level: memory.urgency_level || "low",
      lead_quality_score: memory.lead_quality_score || 0,
    },
  };
};

export const buildMemoryQuickSuggestions = (memory = null) => {
  const preferences = memory?.preferences || {};
  return unique([
    "وريني الترند",
    preferences.favorite_color ? `وريني ${COLOR_LABELS_AR[preferences.favorite_color] || preferences.favorite_color}` : "وريني الأسود",
    "عايز حاجة شبه اللي فات",
    "عايز خروجات",
    preferences.size ? `متاح مقاس ${preferences.size}` : "",
  ].filter(Boolean), 5);
};
