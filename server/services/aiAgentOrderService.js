import crypto from "node:crypto";

import db from "../database/db.js";
import { getAiAgentSettings } from "./aiSalesAgentService.js";
import { adjustVariantStock } from "./inventoryService.js";
import { assignSequentialInvoiceNumber, buildTemporaryInvoiceNumber } from "../utils/invoiceNumber.js";
import { attachPublicOrderNumber, displayPublicOrderNumber } from "../utils/publicOrderNumber.js";
import { buildOrderItemInsertQuery, enrichOrderItemsInsertError } from "../utils/orderItemInsert.js";

let schemaReadyPromise = null;
let schemaEnsured = false;
const tableColumnsCache = new Map();

const ORDER_CHANNELS = new Set(["web_chat", "whatsapp", "instagram", "facebook"]);
const ORDER_STATUS = new Set(["ai_draft", "confirmed", "human_handoff", "cancelled"]);
const CONFIDENCE_THRESHOLD = 0.62;

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const integer = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};
const compact = (items = [], limit = 20) =>
  [...new Set((Array.isArray(items) ? items : []).map(text).filter(Boolean))].slice(0, limit);
const json = (value) => JSON.stringify(value === undefined ? null : value);

const tableColumns = async (clientOrPool, tableName) => {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  const result = await clientOrPool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnsCache.set(tableName, columns);
  return columns;
};

const addValue = (columns, values, available, column, value) => {
  if (!available.has(column)) return;
  columns.push(column);
  values.push(value);
};

const assertInsertShape = ({ table, context, columns = [], placeholders = [], params = [] }) => {
  const columnCount = columns.length;
  const placeholderCount = Array.isArray(placeholders)
    ? placeholders.length
    : (String(placeholders).match(/\$\d+/g) || []).length;
  const paramCount = params.length;
  if (!columnCount || columnCount !== placeholderCount || placeholderCount !== paramCount) {
    const error = new Error(
      `[${context || "sql"}] INSERT ${table || "table"} mismatch: columns=${columnCount}, placeholders=${placeholderCount}, params=${paramCount}`
    );
    error.code = "SQL_INSERT_SHAPE_MISMATCH";
    throw error;
  }
};

export const ensureAiAgentOrderSchema = async (clientOrPool = db) => {
  if (schemaEnsured) return;
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS ai_agent_session_id TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS ai_agent_conversation_id TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS ai_agent_intent_hash TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS ai_agent_status VARCHAR(50)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS ai_agent_confidence NUMERIC(5,4)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS ai_agent_metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS public_order_number VARCHAR(40)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS display_order_number VARCHAR(40)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'pos'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(80)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_address TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS governorate VARCHAR(120)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS city_area VARCHAR(160)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_id BIGINT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS variant_id BIGINT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS variant_name VARCHAR(255)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS sku VARCHAR(120)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(120)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS price NUMERIC(12,2)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await clientOrPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_ai_agent_intent_dedupe
        ON orders (tenant_id, ai_agent_conversation_id, ai_agent_intent_hash)
        WHERE ai_agent_conversation_id IS NOT NULL AND ai_agent_intent_hash IS NOT NULL
      `);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_ai_agent_status ON orders (tenant_id, ai_agent_status, created_at DESC)`);
      await warmAiAgentOrderMetadataCache(clientOrPool);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    }).then(() => {
      if (clientOrPool === db) schemaEnsured = true;
    });
  }
  return schemaReadyPromise;
};

export const warmAiAgentOrderMetadataCache = async (clientOrPool = db) => {
  await Promise.all([
    tableColumns(clientOrPool, "orders"),
    tableColumns(clientOrPool, "order_items"),
    tableColumns(clientOrPool, "products"),
    tableColumns(clientOrPool, "product_variants"),
  ]);
};

const normalizeChannel = (value = "") => {
  const channel = lower(value).replace("storefront_chat", "web_chat").replace("storefront_chat_image", "web_chat");
  return ORDER_CHANNELS.has(channel) ? channel : "web_chat";
};

const normalizePhone = (value = "") => {
  const digits = text(value).replace(/[^\d+]/g, "");
  const local = digits.startsWith("+20") ? `0${digits.slice(3)}` : digits.startsWith("20") ? `0${digits.slice(2)}` : digits;
  return /^01[0125]\d{8}$/.test(local) ? local : "";
};

const extractQuantity = (message = "") => {
  const match = text(message).match(/(?:عدد|quantity|qty|x)\s*(\d{1,2})|\b(\d{1,2})\s*(?:قطع|قطعة|pairs?|جزمة|جزم)\b/i);
  return Math.max(1, integer(match?.[1] || match?.[2], 1));
};

const extractSize = (message = "") => {
  const match = text(message).match(/\b(?:مقاس|size|sz)?\s*(3[0-9]|4[0-9]|5[0-2]|xs|s|m|l|xl|xxl)\b/i);
  return text(match?.[1] || "");
};

const COLOR_ALIASES = [
  ["black", "black"], ["اسود", "black"], ["أسود", "black"], ["بلاك", "black"],
  ["white", "white"], ["ابيض", "white"], ["أبيض", "white"], ["وايت", "white"],
  ["red", "red"], ["احمر", "red"], ["أحمر", "red"],
  ["blue", "blue"], ["ازرق", "blue"], ["أزرق", "blue"],
  ["grey", "grey"], ["gray", "grey"], ["رمادي", "grey"], ["رصاصي", "grey"],
  ["brown", "brown"], ["بني", "brown"], ["beige", "beige"], ["بيج", "beige"],
];

const extractColor = (message = "") => {
  const normalized = lower(message);
  const hit = COLOR_ALIASES.find(([alias]) => normalized.includes(alias));
  return hit?.[1] || "";
};

const extractNamedField = (message = "", patterns = []) => {
  for (const pattern of patterns) {
    const match = text(message).match(pattern);
    if (match?.[1]) return text(match[1]).slice(0, 180);
  }
  return "";
};

const extractCustomerName = (message = "") =>
  extractNamedField(message, [
    /(?:اسمي|الاسم|name is|my name is)\s*[:：-]?\s*([^\n،,]{2,80})/i,
  ]);

const extractAddress = (message = "") =>
  extractNamedField(message, [
    /(?:العنوان|عنواني|address)\s*[:：-]?\s*([^\n]{6,180})/i,
  ]);

const extractArea = (message = "") => {
  const value = extractNamedField(message, [
    /(?:المنطقة|منطقة|area)\s*[:：-]?\s*([^\n،,]{2,80})/i,
  ]);
  return value;
};

const extractGovernorate = (message = "") => {
  const value = extractNamedField(message, [
    /(?:المحافظة|محافظة|governorate)\s*[:：-]?\s*([^\n،,]{2,80})/i,
  ]);
  return value;
};

const CONFIRM_TERMS = ["اكد", "أكد", "تأكيد", "تمام", "موافق", "confirm", "yes"];
const HANDOFF_TERMS = ["غلط", "مشكلة", "زعلان", "شكوى", "complaint"];

const SALES_STAGES = Object.freeze({
  browsing: "browsing",
  productDiscussion: "product_discussion",
  objectionHandling: "objection_handling",
  readyToOrder: "ready_to_order",
  collectingName: "collecting_name",
  collectingPhone: "collecting_phone",
  collectingAddress: "collecting_address",
  draftCreated: "draft_created",
  confirmed: "confirmed",
  handoff: "handoff",
});

const logSalesFlow = (event, payload = {}) => {
  console.log("[ai-agent:sales-flow]", { event, ...payload });
};

const normalizeArabic = (value = "") =>
  lower(value)
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const hasAnyTerm = (message = "", terms = []) => {
  const normalized = normalizeArabic(message);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
};

const BUYING_INTENT_TERMS = [
  "تمام هاخده",
  "تمام هاخدها",
  "هاخده",
  "هاخدها",
  "اعمل اوردر",
  "اعمل أوردر",
  "احجزهولي",
  "احجزهالي",
  "ابعتهولي",
  "ابعتوهولي",
  "ابعتهالي",
  "هطلبه",
  "هطلبها",
  "هطلب",
];

const hasClearBuyingIntent = (message = "") =>
  hasAnyTerm(message, BUYING_INTENT_TERMS) ||
  /\b(?:order it|place (?:an )?order|create (?:an )?order|checkout now|reserve it|send it|i'?ll take it)\b/i.test(text(message));

const detectSalesObjection = (message = "") => {
  const normalized = normalizeArabic(message);
  const checks = [
    ["expensive", ["السعر غالي", "غالي", "غاليه", "غالي اوي", "غاليه اوي", "too expensive"]],
    ["discount", ["فيه خصم", "في خصم", "خصم", "discount"]],
    ["material", ["خامته ايه", "الخامة", "خامه", "material"]],
    ["authenticity", ["اصلي ولا كوبي", "اصلي", "كوبي", "هاي كوبي", "original", "copy"]],
    ["delivery_fee", ["التوصيل كام", "شحن كام", "تكلفة التوصيل", "delivery fee", "shipping"]],
    ["delivery_eta", ["هيوصل امتى", "يوصل امتى", "وقت التوصيل", "delivery time", "when arrive"]],
    ["exchange", ["ينفع استبدال", "استبدال", "تبديل", "exchange"]],
    ["cheaper", ["فيه ارخص", "ارخص", "حاجه ارخص", "cheaper"]],
    ["last_price", ["اخر سعر", "آخر سعر", "نهائي", "last price"]],
    ["cod", ["الدفع عند الاستلام", "دفع عند الاستلام", "كاش عند الاستلام", "cod", "cash on delivery"]],
  ];
  return checks.find(([, terms]) => terms.some((term) => normalized.includes(normalizeArabic(term))))?.[0] || "";
};

export const detectAiOrderIntent = (message = "") => {
  const raw = text(message);
  const normalized = lower(raw);
  const hasOrder = hasClearBuyingIntent(raw);
  const hasConfirm = CONFIRM_TERMS.some((term) => normalized.includes(lower(term)));
  const handoffReason = HANDOFF_TERMS.find((term) => normalized.includes(lower(term))) || "";
  return {
    isOrderIntent: hasOrder || (hasConfirm && (normalized.includes("اوردر") || normalized.includes("أوردر"))),
    isConfirmIntent: hasConfirm,
    handoffReason,
  };
};

const intentHash = (payload = {}) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 48);

const recentConversationContext = async ({ tenantId, conversationId }) => {
  if (!tenantId || !conversationId) return { transcript: "", suggestedProducts: [], lastAiAnswer: "", lastCustomerMessage: "" };
  const result = await db.query(
    `
    SELECT customer_message, ai_answer, suggested_products
    FROM ai_support_messages
    WHERE tenant_id = $1 AND session_id = $2
    ORDER BY created_at DESC
    LIMIT 12
    `,
    [tenantId, conversationId]
  );
  const rows = result.rows.reverse();
  const suggestedProducts = rows
    .flatMap((row) => (Array.isArray(row.suggested_products) ? row.suggested_products : []))
    .filter((product) => product?.id || product?.product_id);
  return {
    transcript: rows.map((row) => `${row.customer_message || ""}\n${row.ai_answer || ""}`).join("\n"),
    suggestedProducts,
    lastAiAnswer: rows.at(-1)?.ai_answer || "",
    lastCustomerMessage: rows.at(-1)?.customer_message || "",
  };
};

const buildProductQueryTerms = (message = "", metadata = {}) => compact([
  ...text(message).replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((word) => word.length > 2),
  metadata?.matched_product_name,
  metadata?.product_name,
  metadata?.image_search_query,
  ...(Array.isArray(metadata?.keywords) ? metadata.keywords : []),
], 14);

const productSearchVectorSql = (productColumns, variantColumns) => {
  const productFields = ["name", "name_ar", "description", "seo_keywords", "ai_keywords", "style_tags", "slug", "canonical_slug", "sku", "barcode", "product_code"]
    .filter((column) => productColumns.has(column))
    .map((column) => `COALESCE(p.${column}::text, '')`);
  const variantFields = ["edition_name", "edition_slug", "size", "color", "sku", "barcode"]
    .filter((column) => variantColumns.has(column))
    .map((column) => `COALESCE(pv.${column}::text, '')`);
  return [...productFields, ...variantFields].length ? [...productFields, ...variantFields].join(" || ' ' || ") : "COALESCE(p.name, '')";
};

const productSelectSql = (productColumns, variantColumns) => {
  const productPrice = productColumns.has("regular_price") ? "COALESCE(NULLIF(p.regular_price, 0), p.price, 0)" : "COALESCE(p.price, 0)";
  const variantPrice = variantColumns.has("price") ? "COALESCE(NULLIF(pv.price, 0), NULLIF(p.price, 0), 0)" : "COALESCE(p.price, 0)";
  const variantName = variantColumns.has("edition_name") ? "COALESCE(pv.edition_name, '')" : "''";
  const variantSize = variantColumns.has("size") ? "COALESCE(pv.size, '')" : "''";
  const variantColor = variantColumns.has("color") ? "COALESCE(pv.color, '')" : "''";
  const variantSku = variantColumns.has("sku") ? "COALESCE(pv.sku, '')" : "''";
  const variantBarcode = variantColumns.has("barcode") ? "COALESCE(pv.barcode, '')" : "''";
  const variantImage = variantColumns.has("image_url") ? "COALESCE(pv.image_url, '')" : "''";
  return { productPrice, variantPrice, variantName, variantSize, variantColor, variantSku, variantBarcode, variantImage };
};

export const searchAiOrderProducts = async ({ tenantId, message, metadata = {} } = {}) => {
  await ensureAiAgentOrderSchema();
  const [productColumns, variantColumns] = await Promise.all([tableColumns(db, "products"), tableColumns(db, "product_variants")]);
  const terms = buildProductQueryTerms(message, metadata);
  const { productPrice, variantPrice, variantName, variantSize, variantColor, variantSku, variantBarcode, variantImage } = productSelectSql(productColumns, variantColumns);
  const searchVector = productSearchVectorSql(productColumns, variantColumns);
  const variantActive = variantColumns.has("is_active") && variantColumns.has("deleted_at") ? "AND pv.is_active IS DISTINCT FROM FALSE AND pv.deleted_at IS NULL" : "";
  const productActive = productColumns.has("status") ? "AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive','disabled','archived','deleted')" : "";
  const termParams = terms.map((term) => `%${term}%`);
  const directProductId = numeric(metadata.matched_product_id || metadata.product_id, 0);
  if (!terms.length && !directProductId) return [];
  const termScore = terms.length
    ? terms.map((_, index) => `MAX(CASE WHEN LOWER(${searchVector}) LIKE LOWER($${index + 2}) THEN 1 ELSE 0 END)`).join(" + ")
    : "0";
  const result = await db.query(
    `
    SELECT
      p.id,
      COALESCE(p.name, '') AS name,
      ${productColumns.has("slug") ? "COALESCE(p.slug, '')" : "''"} AS slug,
      ${productColumns.has("canonical_slug") ? "COALESCE(p.canonical_slug, '')" : "''"} AS canonical_slug,
      ${productColumns.has("image_url") ? "COALESCE(p.image_url, '')" : "''"} AS image_url,
      ${productColumns.has("main_image") ? "COALESCE(p.main_image, '')" : "''"} AS main_image,
      ${productColumns.has("thumbnail") ? "COALESCE(p.thumbnail, '')" : "''"} AS thumbnail,
      ${productColumns.has("brand") ? "COALESCE(p.brand, '')" : "''"} AS brand,
      ${productColumns.has("model") ? "COALESCE(p.model, '')" : "''"} AS model,
      MAX(${searchVector}) AS search_text,
      ${productPrice} AS product_price,
      MAX(NULLIF(${variantImage}, '')) AS variant_image_url,
      COALESCE(SUM(GREATEST(COALESCE(pv.stock, 0), 0)), 0)::int AS total_stock,
      (${termScore})::numeric / GREATEST($${termParams.length + 2}::numeric, 1) AS confidence,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', pv.id,
            'product_id', pv.product_id,
            'name', ${variantName},
            'size', ${variantSize},
            'color', ${variantColor},
            'sku', ${variantSku},
            'barcode', ${variantBarcode},
            'image_url', ${variantImage},
            'price', ${variantPrice},
            'stock', COALESCE(pv.stock, 0)
          )
        ) FILTER (WHERE pv.id IS NOT NULL),
        '[]'::jsonb
      ) AS variants
    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id
      AND ($1::bigint IS NULL OR pv.tenant_id = $1::bigint OR pv.tenant_id IS NULL)
      ${variantActive}
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)
      ${productActive}
      AND (
        ($${termParams.length + 3}::bigint > 0 AND p.id = $${termParams.length + 3}::bigint)
        OR (${terms.length ? terms.map((_, index) => `LOWER(${searchVector}) LIKE LOWER($${index + 2})`).join(" OR ") : "TRUE"})
      )
    GROUP BY p.id
    ORDER BY CASE WHEN p.id = $${termParams.length + 3}::bigint THEN 1 ELSE 0 END DESC, confidence DESC, total_stock DESC, p.id DESC
    LIMIT 8
    `,
    [tenantId || null, ...termParams, terms.length || 1, directProductId]
  );
  return result.rows.map((row) => ({
    ...row,
    product_price: numeric(row.product_price, 0),
    total_stock: integer(row.total_stock, 0),
    confidence: directProductId && Number(row.id) === directProductId ? 1 : Math.max(0, Math.min(1, numeric(row.confidence, 0))),
    variants: Array.isArray(row.variants) ? row.variants : [],
  }));
};

const selectVariant = (product, { size = "", color = "" } = {}) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const stocked = variants.filter((variant) => numeric(variant.stock, 0) > 0);
  const normalizedSize = lower(size);
  const normalizedColor = lower(color);
  const ranked = stocked
    .map((variant) => {
      let score = numeric(variant.stock, 0) > 0 ? 10 : 0;
      if (normalizedSize && lower(variant.size) === normalizedSize) score += 80;
      if (normalizedSize && lower(variant.name).includes(normalizedSize)) score += 30;
      if (normalizedColor && (lower(variant.color).includes(normalizedColor) || lower(variant.name).includes(normalizedColor))) score += 30;
      return { variant, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.variant || null;
};

const missingFields = (state = {}) => {
  const missing = [];
  if (!state.product) missing.push("product");
  if (!state.variant) missing.push("variant");
  if (!state.customer_name) missing.push("customer_name");
  if (!state.customer_phone) missing.push("customer_phone");
  if (!state.governorate || !state.city_area) missing.push("area");
  if (!state.customer_address) missing.push("address");
  if (!state.quantity || state.quantity <= 0) missing.push("quantity");
  return missing;
};

const nextCollectionStage = (missing = []) => {
  if (missing.includes("customer_name")) return SALES_STAGES.collectingName;
  if (missing.includes("customer_phone")) return SALES_STAGES.collectingPhone;
  if (missing.includes("area") || missing.includes("address")) return SALES_STAGES.collectingAddress;
  return SALES_STAGES.readyToOrder;
};

const askForMissing = (missing = []) => {
  if (missing.includes("customer_name")) return "تشرفنا ❤️ ممكن أعرف اسم حضرتك؟";
  if (missing.includes("customer_phone")) return "تمام يا فندم، ممكن رقم الموبايل للتواصل؟";
  if (missing.includes("area")) return "ممكن المحافظة والمنطقة عشان نأكد التوصيل؟";
  if (missing.includes("address")) return "ممكن العنوان بالتفصيل؟";
  if (missing.includes("variant")) return "تحب أنهي مقاس ولون؟";
  if (missing.includes("quantity")) return "تحب كام قطعة؟";
  return "ممكن تبعت اسم المنتج أو صورته عشان أجهز الأوردر؟";
};

const productPrice = (product = {}, variant = null) => numeric(variant?.price || product?.final_price || product?.sale_price || product?.product_price || product?.price, 0);

const formatMoneyAr = (value) => {
  const amount = numeric(value, 0);
  return amount > 0 ? `${amount} جنيه` : "السعر بيتأكد حسب الاختيار";
};

const variantOptions = (product = {}) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const stocked = variants.filter((variant) => numeric(variant.stock, 0) > 0);
  return {
    colors: compact(stocked.map((variant) => variant.color || variant.name), 8),
    sizes: compact(stocked.map((variant) => variant.size), 10),
  };
};

const buildProductSalesAnswer = ({ product = {}, variant = null } = {}) => {
  const options = variantOptions(product);
  const availability = numeric(variant?.stock ?? product?.total_stock, 0) > 0 ? "متاح حاليا" : "مش متاح حاليا";
  const optionLines = [
    options.colors.length ? `الألوان المتاحة: ${options.colors.join("، ")}.` : "",
    options.sizes.length ? `المقاسات المتاحة: ${options.sizes.join("، ")}.` : "",
  ].filter(Boolean);
  return [
    `${product?.name || "الموديل ده"} سعره ${formatMoneyAr(productPrice(product, variant))}، و${availability}.`,
    "اختيار عملي وشيك، مناسب للاستخدام اليومي وبيكمل اللبس بسهولة.",
    ...optionLines,
    "تحب أقولك تفاصيل أكتر ولا أوريك بدائل؟",
  ].join("\n");
};

const buildObjectionAnswer = ({ objection = "", product = {}, variant = null, settings = {} } = {}) => {
  const price = formatMoneyAr(productPrice(product, variant));
  const canPromiseDiscount = settings.allow_discount_promises === true || settings.discount_permission === true;
  const maxDiscount = numeric(settings.max_discount_percent, 0);
  const answers = {
    expensive: `فاهم حضرتك. سعره ${price} لأنه خامته وتقفيله أعلى من البدائل العادية، وكمان متاح منه اختيارات محدودة. لو حابب أرشحلك حاجة أرخص أقدر أعمل كده.`,
    discount: canPromiseDiscount && maxDiscount > 0
      ? `حاليا السعر الظاهر عندي هو ${price}. أقدر أراجعلك خصم لحد ${maxDiscount}% حسب سياسة المتجر قبل تأكيد الأوردر.`
      : `حاليا السعر الظاهر عندي هو ${price}. مقدرش أوعد بخصم يدوي، بس الفريق يقدر يراجع لو فيه عرض شغال قبل تأكيد الأوردر.`,
    material: "خامته حسب بيانات المنتج من المخزون، والتقفيل مخصص للاستخدام اليومي. لو محتاج وصف أدق للخامة هحوّل سؤالك للفريق يأكدها من القطعة نفسها.",
    authenticity: "المنتج بيتباع من مخزون المتجر بالحالة والوصف المسجلين عندنا. لو محتاج تأكيد أصلي/كوبي على موديل معين، الفريق يقدر يراجع تفاصيله قبل الشحن.",
    delivery_fee: text(settings.delivery_policy_text) || "التوصيل بيتحدد حسب المحافظة والمنطقة. ابعتلي منطقتك وأنا أأكدلك التكلفة قبل تسجيل الأوردر.",
    delivery_eta: text(settings.delivery_policy_text) || "ميعاد الوصول حسب المحافظة والمنطقة، وغالبا بيتأكد معاك بعد تسجيل البيانات وقبل الشحن.",
    exchange: text(settings.exchange_return_policy_text) || "ينفع الاستبدال حسب سياسة المتجر وحالة المنتج. الفريق بيأكدلك الشروط قبل تأكيد الشحن.",
    cheaper: "أقدر أرشحلك بدائل أرخص من نفس الستايل. تحب نفس اللون ولا الأهم السعر؟",
    last_price: canPromiseDiscount && maxDiscount > 0
      ? `آخر سعر ظاهر عندي حاليا ${price}. وممكن نراجع خصم لحد ${maxDiscount}% حسب سياسة المتجر قبل التأكيد.`
      : `آخر سعر ظاهر عندي حاليا ${price}. لو فيه عرض شغال، الفريق بيأكد قبل تأكيد الأوردر.`,
    cod: text(settings.cod_availability_text) || "أيوه، الدفع عند الاستلام متاح حسب سياسة الشحن والمنطقة. هنأكدها معاك قبل خروج الأوردر.",
  };
  return answers[objection] || buildProductSalesAnswer({ product, variant });
};

const inferredCustomerName = ({ message = "", explicitName = "", lastAiAnswer = "" } = {}) => {
  if (explicitName) return explicitName;
  const candidate = text(message).replace(/[^\p{L}\s.-]/gu, " ").replace(/\s+/g, " ").trim();
  if (
    candidate.length >= 2 &&
    candidate.length <= 60 &&
    hasAnyTerm(lastAiAnswer, ["ممكن أعرف اسم حضرتك", "اسم حضرتك"]) &&
    !hasClearBuyingIntent(candidate) &&
    !detectSalesObjection(candidate) &&
    !normalizePhone(candidate)
  ) {
    return candidate;
  }
  return "";
};

const inferredAddress = ({ message = "", explicitAddress = "", lastAiAnswer = "" } = {}) => {
  if (explicitAddress) return explicitAddress;
  const candidate = text(message);
  if (candidate.length >= 6 && hasAnyTerm(lastAiAnswer, ["العنوان بالتفصيل", "المحافظة والمنطقة"])) return candidate.slice(0, 180);
  return "";
};

const withSalesStage = (payload = {}, stage = SALES_STAGES.browsing) => ({
  ...payload,
  conversation_stage: stage,
  ai_order: {
    ...(payload.ai_order || {}),
    conversation_stage: stage,
  },
});

const buildOrderSummary = ({ order, product, variant, quantity, deliveryFee = 0 }) => {
  const unitPrice = numeric(variant?.price || product?.product_price, 0);
  const total = unitPrice * quantity + numeric(deliveryFee, 0);
  return [
    `جهزت مسودة الأوردر:`,
    `المنتج: ${product?.name || "المنتج المختار"}`,
    `المقاس/اللون: ${[variant?.size, variant?.color || variant?.name].filter(Boolean).join(" - ") || "حسب الاختيار"}`,
    `السعر: ${unitPrice} جنيه`,
    deliveryFee ? `التوصيل: ${deliveryFee} جنيه` : "التوصيل بيتأكد حسب المنطقة",
    `الإجمالي التقريبي: ${total} جنيه`,
    `رقم المسودة: ${displayPublicOrderNumber(order) || order?.id}`,
    "تأكيد الأوردر؟",
  ].join("\n");
};

const loadExistingDraft = async ({ tenantId, conversationId }) => {
  const result = await db.query(
    `
    SELECT *
    FROM orders
    WHERE tenant_id = $1
      AND ai_agent_conversation_id = $2
      AND ai_agent_status = 'ai_draft'
      AND LOWER(COALESCE(status, '')) = 'ai_draft'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tenantId, conversationId]
  );
  return result.rows[0] || null;
};

const insertOrderWithItems = async (client, payload = {}) => {
  const orderColumns = await tableColumns(client, "orders");
  const itemColumns = await tableColumns(client, "order_items");
  const columns = [];
  const values = [];
  Object.entries(payload.order).forEach(([column, value]) => addValue(columns, values, orderColumns, column, value));
  const placeholders = values.map((_, index) => `$${index + 1}`);
  assertInsertShape({ table: "orders", context: "insertAiAgentOrder", columns, placeholders, params: values });
  const orderResult = await client.query(
    `INSERT INTO orders (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    values
  );
  let order = orderResult.rows[0];
  order = await assignSequentialInvoiceNumber(client, order);
  order = attachPublicOrderNumber(order, order.channel || order.source || payload.order?.channel || "web_chat");
  const itemRows = [];
  for (const item of payload.items) {
    const query = buildOrderItemInsertQuery({ ...item, order_id: order.id }, {
      availableColumns: itemColumns,
      returning: true,
      filePath: "server/services/aiAgentOrderService.js",
      routeName: "createAiOrderDraft",
      insertLabel: "insertAiAgentOrderItems",
      sqlSnippetLabel: "ai_agent_order_items_insert",
    });
    let itemResult;
    try {
      itemResult = await client.query(query.sql, query.params);
    } catch (error) {
      throw enrichOrderItemsInsertError(error, {
        routeName: "createAiOrderDraft",
        insertLabel: "insertAiAgentOrderItems",
        columnsCount: query.columns.length,
        paramsCount: query.params.length,
        sqlSnippetLabel: "ai_agent_order_items_insert",
      });
    }
    itemRows.push(itemResult.rows[0]);
  }
  return { order, items: itemRows };
};

export const createAiOrderDraft = async (payload = {}) => {
  await ensureAiAgentOrderSchema();
  const tenantId = numeric(payload.tenant_id ?? payload.tenantId, 0);
  if (!tenantId) throw Object.assign(new Error("Tenant is required"), { status: 400 });
  const channel = normalizeChannel(payload.channel || payload.source || payload.metadata?.channel);
  const conversationId = text(payload.conversation_id || payload.conversationId || payload.session_id || payload.metadata?.session_id);
  if (!conversationId) throw Object.assign(new Error("conversation_id is required"), { status: 400 });
  const product = payload.product || (await searchAiOrderProducts({ tenantId, message: payload.original_customer_message || payload.message, metadata: payload.metadata }))[0];
  if (!product || numeric(product.confidence, 0) < CONFIDENCE_THRESHOLD) {
    throw Object.assign(new Error("Product match confidence is too low"), { status: 409, code: "LOW_CONFIDENCE", product });
  }
  const quantity = Math.max(1, integer(payload.quantity, 1));
  const selectedVariant = payload.variant || selectVariant(product, { size: payload.size, color: payload.color });
  if (!selectedVariant || numeric(selectedVariant.stock, 0) < quantity) {
    throw Object.assign(new Error("Selected variant is unavailable"), { status: 409, code: "OUT_OF_STOCK", product });
  }
  const normalizedPhone = normalizePhone(payload.customer_phone || payload.phone || payload.metadata?.customer_phone);
  const allowMissingPhone = payload.allow_missing_phone === true || payload.metadata?.allow_missing_phone === true;
  const phone = normalizedPhone || (allowMissingPhone ? text(payload.customer_phone || payload.phone || payload.external_customer_id || payload.metadata?.external_customer_id || "meta_customer_pending_phone") : "");
  if (!phone) throw Object.assign(new Error("Valid Egyptian phone number is required"), { status: 400, code: "INVALID_PHONE" });
  const unitPrice = numeric(selectedVariant.price || product.product_price, 0);
  const subtotal = unitPrice * quantity;
  const hash = intentHash({
    conversationId,
    productId: product.id,
    variantId: selectedVariant.id,
    quantity,
    phone,
    message: text(payload.original_customer_message || payload.message).slice(0, 500),
  });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `
      SELECT *
      FROM orders
      WHERE tenant_id = $1 AND ai_agent_conversation_id = $2 AND ai_agent_intent_hash = $3
      LIMIT 1
      `,
      [tenantId, conversationId, hash]
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { order: attachPublicOrderNumber(existing.rows[0], channel), items: [], product, variant: selectedVariant, duplicate: true };
    }
    const invoiceNumber = buildTemporaryInvoiceNumber();
    const { order, items } = await insertOrderWithItems(client, {
      order: {
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        customer_name: text(payload.customer_name || payload.name),
        customer_phone: phone,
        channel,
        source: channel,
        status: "ai_draft",
        payment_status: "unpaid",
        payment_method: "pending",
        subtotal,
        total_amount: subtotal,
        total_price: subtotal,
        total: subtotal,
        paid_amount: 0,
        customer_address: text(payload.customer_address || payload.address),
        governorate: text(payload.governorate),
        city_area: text(payload.city_area || payload.area),
        delivery_notes: text(payload.delivery_notes),
        notes: text(payload.notes || `AI order draft from ${channel}`),
        ai_agent_session_id: text(payload.session_id || conversationId),
        ai_agent_conversation_id: conversationId,
        ai_agent_intent_hash: hash,
        ai_agent_status: "ai_draft",
        ai_agent_confidence: numeric(product.confidence, 0),
        ai_agent_metadata: json({
          matched_product_id: product.id,
          matched_variant_id: selectedVariant.id,
          original_customer_message: text(payload.original_customer_message || payload.message),
          confidence_score: numeric(product.confidence, 0),
          transcript: payload.transcript || "",
          channel,
          sales_intent: payload.metadata?.sales_intent || null,
          external_customer_id: text(payload.external_customer_id || payload.metadata?.external_customer_id),
          source: text(payload.metadata?.source),
        }),
      },
      items: [{
        tenant_id: tenantId,
        product_id: product.id,
        variant_id: selectedVariant.id,
        product_name: product.name,
        variant_name: selectedVariant.name || [selectedVariant.size, selectedVariant.color].filter(Boolean).join(" / "),
        sku: selectedVariant.sku || "",
        barcode: selectedVariant.barcode || "",
        quantity,
        price: unitPrice,
        sale_price: unitPrice,
        total_amount: subtotal,
      }],
    });
    await client.query("COMMIT");
    console.log("[ai-agent:orders] draft created", { tenantId, order_id: order.id, conversation_id: conversationId, product_id: product.id, variant_id: selectedVariant.id });
    return { order: attachPublicOrderNumber(order, channel), items, product, variant: selectedVariant, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[ai-agent:orders] draft failed", { tenantId, conversation_id: conversationId, message: error?.message, code: error?.code });
    throw error;
  } finally {
    client.release();
  }
};

export const confirmAiOrder = async (payload = {}) => {
  await ensureAiAgentOrderSchema();
  const tenantId = numeric(payload.tenant_id ?? payload.tenantId, 0);
  const orderId = numeric(payload.order_id ?? payload.orderId, 0);
  const conversationId = text(payload.conversation_id || payload.conversationId || payload.session_id);
  if (!tenantId || (!orderId && !conversationId)) throw Object.assign(new Error("Order reference is required"), { status: 400 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `
      SELECT *
      FROM orders
      WHERE tenant_id = $1
        AND ($2::bigint = 0 OR id = $2::bigint)
        AND ($3::text = '' OR ai_agent_conversation_id = $3)
        AND ai_agent_status = 'ai_draft'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [tenantId, orderId, conversationId]
    );
    const order = orderResult.rows[0];
    if (!order) throw Object.assign(new Error("AI order draft not found"), { status: 404 });
    const items = await client.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC FOR UPDATE`, [order.id]);
    for (const item of items.rows) {
      if (!item.variant_id) throw Object.assign(new Error("Stock is unclear for this order"), { status: 409, code: "UNCLEAR_STOCK" });
      const variant = await client.query(
        `SELECT id, stock FROM product_variants WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) FOR UPDATE`,
        [item.variant_id, tenantId]
      );
      const currentStock = numeric(variant.rows[0]?.stock, -1);
      if (currentStock < numeric(item.quantity, 0)) throw Object.assign(new Error("Selected variant is out of stock"), { status: 409, code: "OUT_OF_STOCK" });
      await adjustVariantStock(client, {
        tenantId,
        variantId: item.variant_id,
        productId: item.product_id,
        quantityChange: numeric(item.quantity, 0) * -1,
        movementType: "sale",
        referenceType: "order",
        referenceId: order.id,
        reason: "AI agent order confirmed",
        notes: `AI agent order ${order.invoice_number || order.id}`,
        createdBy: payload.user_id || null,
      });
    }
    const updated = await client.query(
      `
      UPDATE orders
      SET status = 'confirmed',
          payment_status = 'unpaid',
          ai_agent_status = 'confirmed',
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [order.id]
    );
    await client.query("COMMIT");
    console.log("[ai-agent:orders] confirmed", { tenantId, order_id: order.id, conversation_id: order.ai_agent_conversation_id });
    return { order: attachPublicOrderNumber(updated.rows[0], order.channel || order.source || "web_chat"), items: items.rows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[ai-agent:orders] confirm failed", { tenantId, orderId, conversationId, message: error?.message, code: error?.code });
    throw error;
  } finally {
    client.release();
  }
};

export const updateAiOrderStatus = async ({ tenantId, orderId, status }) => {
  await ensureAiAgentOrderSchema();
  const nextStatus = ORDER_STATUS.has(status) ? status : "";
  if (!tenantId || !orderId || !nextStatus) throw Object.assign(new Error("Valid order status is required"), { status: 400 });
  const result = await db.query(
    `
    UPDATE orders
    SET ai_agent_status = $3,
        status = CASE WHEN $3 IN ('human_handoff', 'cancelled') THEN $3 ELSE status END,
        updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, orderId, nextStatus]
  );
  return result.rows[0] || null;
};

export const listAiOrderDrafts = async ({ tenantId, limit = 50 } = {}) => {
  await ensureAiAgentOrderSchema();
  const result = await db.query(
    `
    SELECT
      o.*,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'product_id', oi.product_id,
        'variant_id', oi.variant_id,
        'product_name', oi.product_name,
        'variant_name', oi.variant_name,
        'quantity', oi.quantity,
        'price', COALESCE(oi.price, oi.sale_price, 0),
        'total_amount', oi.total_amount
      ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.tenant_id = $1
      AND o.ai_agent_status IS NOT NULL
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $2
    `,
    [tenantId, Math.min(100, Math.max(1, integer(limit, 50)))]
  );
  return result.rows;
};

export const buildAiOrderChatResponse = async ({ tenantId, message, metadata = {}, req = null } = {}) => {
  const settings = await getAiAgentSettings({ tenantId }).catch(() => ({}));
  const intent = detectAiOrderIntent(message);
  const objection = detectSalesObjection(message);
  const conversationId = text(metadata.session_id || req?.body?.session_id || req?.body?.conversation_id || req?.id);
  const conversation = await recentConversationContext({ tenantId, conversationId });
  const isCollectingReply = hasAnyTerm(conversation.lastAiAnswer, [
    "ممكن أعرف اسم حضرتك",
    "رقم الموبايل",
    "المحافظة والمنطقة",
    "العنوان بالتفصيل",
    "أنهي مقاس ولون",
    "المقاسات أو الألوان",
    "كام قطعة",
  ]);
  if (!intent.isOrderIntent && !intent.isConfirmIntent && !objection && !isCollectingReply) return null;
  const transcript = conversation.transcript;
  const lastSuggestedProduct = conversation.suggestedProducts.at(-1) || null;
  const enrichedMetadata = {
    ...metadata,
    matched_product_id: metadata.matched_product_id || lastSuggestedProduct?.id || lastSuggestedProduct?.product_id || null,
    matched_product_name: metadata.matched_product_name || lastSuggestedProduct?.name || lastSuggestedProduct?.title || "",
  };
  if (intent.handoffReason) {
    logSalesFlow("handoff", { tenantId, conversationId, reason: intent.handoffReason });
    return withSalesStage({
      answer: "تمام، هحوّل طلبك لحد من الفريق يراجع التفاصيل معاك عشان محتاج تدخل بشري.",
      confidence: 0.35,
      needs_human_support: true,
      sources_used: [],
      suggested_products: [],
      suggested_actions: ["contact_support"],
      detected_intent: "order_handoff",
      ai_order: { status: "human_handoff", reason: intent.handoffReason },
    }, SALES_STAGES.handoff);
  }
  if (intent.isConfirmIntent) {
    const existingDraft = await loadExistingDraft({ tenantId, conversationId });
    if (existingDraft) {
      if (settings.require_human_approval_before_confirm === true) {
        logSalesFlow("confirm_requires_human", { tenantId, conversationId, order_id: existingDraft.id });
        return withSalesStage({
          answer: "تمام، هحوّل تأكيد الأوردر لحد من الفريق يراجعه ويأكد معاك التفاصيل قبل الشحن.",
          confidence: 0.82,
          needs_human_support: true,
          sources_used: [],
          suggested_products: [],
          suggested_actions: ["contact_support"],
          detected_intent: "order_confirm_requires_human",
          ai_order: { status: "human_handoff", order: existingDraft },
        }, SALES_STAGES.handoff);
      }
      const confirmed = await confirmAiOrder({ tenant_id: tenantId, conversation_id: conversationId });
      logSalesFlow("confirmed", { tenantId, conversationId, order_id: confirmed.order?.id });
      return withSalesStage({
        answer: `تم تأكيد الأوردر رقم ${displayPublicOrderNumber(confirmed.order) || confirmed.order.id}. الفريق هيتابع معاك قريب لتأكيد تفاصيل الشحن.`,
        confidence: 0.92,
        needs_human_support: false,
        sources_used: [],
        suggested_products: [],
        suggested_actions: [],
        detected_intent: "order_confirmed",
        ai_order: { status: "confirmed", order: confirmed.order },
      }, SALES_STAGES.confirmed);
    }
    if (!intent.isOrderIntent && !objection && !isCollectingReply) return null;
  }

  const fullText = `${transcript}\n${message}`;
  const products = await searchAiOrderProducts({ tenantId, message: fullText, metadata: enrichedMetadata });
  const product = products[0] || null;
  const size = extractSize(fullText);
  const color = extractColor(fullText);
  const variant = product ? selectVariant(product, { size, color }) : null;
  const explicitName = text(enrichedMetadata.customer_name || enrichedMetadata.full_name || extractCustomerName(fullText));
  const explicitAddress = text(enrichedMetadata.customer_address || enrichedMetadata.address || extractAddress(fullText));
  const state = {
    product,
    variant,
    customer_name: inferredCustomerName({ message, explicitName, lastAiAnswer: conversation.lastAiAnswer }),
    customer_phone: normalizePhone(enrichedMetadata.customer_phone || fullText.match(/01[0125]\d{8}/)?.[0] || ""),
    governorate: text(enrichedMetadata.governorate || extractGovernorate(fullText)),
    city_area: text(enrichedMetadata.city_area || enrichedMetadata.area || extractArea(fullText)),
    customer_address: inferredAddress({ message, explicitAddress, lastAiAnswer: conversation.lastAiAnswer }),
    quantity: extractQuantity(fullText),
  };
  const confidence = numeric(product?.confidence, 0);
  if (objection && product && confidence >= CONFIDENCE_THRESHOLD) {
    logSalesFlow("objection_handling", { tenantId, conversationId, objection, product_id: product.id });
    return withSalesStage({
      answer: buildObjectionAnswer({ objection, product, variant, settings }),
      confidence,
      needs_human_support: false,
      sources_used: [`product_${product.id}`],
      suggested_products: products.slice(0, 3),
      suggested_actions: objection === "cheaper" ? ["show_similar_products"] : [],
      detected_intent: `sales_objection_${objection}`,
      ai_order: { status: "discussing", objection },
    }, SALES_STAGES.objectionHandling);
  }
  if (objection && (!product || confidence < CONFIDENCE_THRESHOLD)) {
    logSalesFlow("objection_needs_product", { tenantId, conversationId, objection });
    return withSalesStage({
      answer: "أكيد، بس ابعتلي اسم المنتج أو افتحلي الموديل المقصود عشان أرد عليك بسعره وتفاصيله بدقة.",
      confidence: 0.45,
      needs_human_support: false,
      sources_used: [],
      suggested_products: products,
      suggested_actions: ["show_similar_products"],
      detected_intent: `sales_objection_${objection}`,
      ai_order: { status: "needs_product_context", objection },
    }, SALES_STAGES.objectionHandling);
  }
  if (!product || confidence < CONFIDENCE_THRESHOLD) {
    logSalesFlow("ready_to_order_low_confidence", { tenantId, conversationId, confidence });
    return withSalesStage({
      answer: "ممكن تبعت اسم المنتج أو صورة/لينك أوضح؟ عايز أتأكد من الموديل قبل ما أجهز الأوردر.",
      confidence,
      needs_human_support: true,
      sources_used: [],
      suggested_products: products,
      suggested_actions: ["contact_support", "show_similar_products"],
      detected_intent: "order_low_confidence",
      ai_order: { status: "needs_product_clarification" },
    }, SALES_STAGES.readyToOrder);
  }
  const missing = missingFields(state);
  if (missing.includes("customer_name")) {
    logSalesFlow("collecting_missing_field", { tenantId, conversationId, stage: SALES_STAGES.collectingName, missing, product_id: product.id });
    return withSalesStage({
      answer: askForMissing(missing),
      confidence,
      needs_human_support: false,
      sources_used: [`product_${product.id}`],
      suggested_products: products.slice(0, 3),
      suggested_actions: [],
      detected_intent: "order_collecting_details",
      ai_order: { status: "collecting_details", missing },
    }, SALES_STAGES.collectingName);
  }
  if (!variant || numeric(variant.stock, 0) < state.quantity) {
    logSalesFlow("ready_to_order_needs_variant", { tenantId, conversationId, product_id: product.id });
    return withSalesStage({
      answer: "المقاس/اللون ده مش واضح أو غير متاح حاليا. أقدر أرشحلك المقاسات أو الألوان المتاحة من نفس الموديل.",
      confidence,
      needs_human_support: false,
      sources_used: [`product_${product.id}`],
      suggested_products: products,
      suggested_actions: ["choose_size", "choose_color", "show_similar_products"],
      detected_intent: "order_stock_clarification",
      ai_order: { status: "needs_variant", alternatives: product.variants },
    }, SALES_STAGES.readyToOrder);
  }
  if (missing.length) {
    const stage = nextCollectionStage(missing);
    logSalesFlow("collecting_missing_field", { tenantId, conversationId, stage, missing, product_id: product.id });
    return withSalesStage({
      answer: askForMissing(missing),
      confidence,
      needs_human_support: false,
      sources_used: [`product_${product.id}`],
      suggested_products: products.slice(0, 3),
      suggested_actions: ["choose_size", "choose_color"],
      detected_intent: "order_collecting_details",
      ai_order: { status: "collecting_details", missing },
    }, stage);
  }
  if (settings.allow_auto_draft_creation === false) {
    logSalesFlow("draft_requires_human", { tenantId, conversationId, product_id: product.id, variant_id: variant.id });
    return withSalesStage({
      answer: "تمام، البيانات كده شبه كاملة. هحوّلها للفريق يراجع المخزون والسعر ويأكد الأوردر معاك.",
      confidence,
      needs_human_support: true,
      sources_used: [`product_${product.id}`],
      suggested_products: [product],
      suggested_actions: ["contact_support"],
      detected_intent: "order_draft_requires_human",
      ai_order: { status: "human_handoff", reason: "auto_draft_disabled" },
    }, SALES_STAGES.handoff);
  }
  const draft = await createAiOrderDraft({
    tenant_id: tenantId,
    channel: normalizeChannel(metadata.channel),
    conversation_id: conversationId,
    session_id: conversationId,
    product,
    variant,
    size,
    color,
    quantity: state.quantity,
    customer_name: state.customer_name,
    customer_phone: state.customer_phone,
    governorate: state.governorate,
    city_area: state.city_area,
    customer_address: state.customer_address,
    delivery_notes: text(metadata.delivery_notes),
    original_customer_message: message,
    transcript,
    metadata: enrichedMetadata,
  });
  logSalesFlow("draft_created", { tenantId, conversationId, order_id: draft.order?.id, product_id: product.id, variant_id: variant.id });
  return withSalesStage({
    answer: buildOrderSummary({ order: draft.order, product, variant, quantity: state.quantity }),
    confidence,
    needs_human_support: false,
    sources_used: [`product_${product.id}`],
    suggested_products: [product],
    suggested_actions: ["confirm_order"],
    detected_intent: "order_draft_created",
    ai_order: { status: "ai_draft", order: draft.order, duplicate: draft.duplicate },
  }, SALES_STAGES.draftCreated);
};
