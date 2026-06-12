import crypto from "node:crypto";

import db from "../database/db.js";
import { getAiAgentSettings } from "./aiSalesAgentService.js";
import { adjustVariantStock } from "./inventoryService.js";
import { sendManagerInvoiceCreatedPush } from "./managerPortalPushService.js";
import {
  compactAliasText,
  expandSearchAliasTerms,
  generateProductAliases,
} from "./productAliasEngine.js";
import { assignSequentialInvoiceNumber, buildTemporaryInvoiceNumber } from "../utils/invoiceNumber.js";
import { attachPublicOrderNumber, displayPublicOrderNumber } from "../utils/publicOrderNumber.js";
import { buildOrderItemInsertQuery, enrichOrderItemsInsertError } from "../utils/orderItemInsert.js";
import { resolveCustomerDisplayPrice } from "../utils/customerDisplayPrice.js";
import {
  aiProductSqlExclusionClause,
  filterAiEligibleProducts,
} from "./aiProductEligibilityService.js";
import {
  detectSalesProductUnderstanding,
  gateRelevantProducts,
} from "./aiSalesOrchestratorService.js";
import { resolveAiSalesConversationState } from "./aiSalesConversationEngineService.js";
import { normalizeChannel, isLikelyMessageLikeName } from "./aiChannelAdapterService.js";

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

const normalizeOrderChannel = (value = "") => {
  const channel = lower(value).replace("storefront_chat", "web_chat").replace("storefront_chat_image", "web_chat");
  return ORDER_CHANNELS.has(channel) ? channel : "web_chat";
};

const normalizePhone = (value = "") => {
  const digits = text(value).replace(/[^\d+]/g, "");
  const local = digits.startsWith("+20") ? `0${digits.slice(3)}` : digits.startsWith("20") ? `0${digits.slice(2)}` : digits;
  return /^01[0125]\d{8}$/.test(local) ? local : "";
};

const extractQuantity = (message = "") => {
  const match = text(message).match(/(?:ط¹ط¯ط¯|quantity|qty|x)\s*(\d{1,2})|\b(\d{1,2})\s*(?:ظ‚ط·ط¹|ظ‚ط·ط¹ط©|pairs?|ط¬ط²ظ…ط©|ط¬ط²ظ…)\b/i);
  return Math.max(1, integer(match?.[1] || match?.[2], 1));
};

const extractSize = (message = "") => {
  const match = text(message).match(/\b(?:ظ…ظ‚ط§ط³|size|sz)?\s*(3[0-9]|4[0-9]|5[0-2]|xs|s|m|l|xl|xxl)\b/i);
  return text(match?.[1] || "");
};

const COLOR_ALIASES = [
  ["black", "black"], ["ط§ط³ظˆط¯", "black"], ["ط£ط³ظˆط¯", "black"], ["ط¨ظ„ط§ظƒ", "black"],
  ["white", "white"], ["ط§ط¨ظٹط¶", "white"], ["ط£ط¨ظٹط¶", "white"], ["ظˆط§ظٹطھ", "white"],
  ["red", "red"], ["ط§ط­ظ…ط±", "red"], ["ط£ط­ظ…ط±", "red"],
  ["blue", "blue"], ["ط§ط²ط±ظ‚", "blue"], ["ط£ط²ط±ظ‚", "blue"],
  ["grey", "grey"], ["gray", "grey"], ["ط±ظ…ط§ط¯ظٹ", "grey"], ["ط±طµط§طµظٹ", "grey"],
  ["brown", "brown"], ["ط¨ظ†ظٹ", "brown"], ["beige", "beige"], ["ط¨ظٹط¬", "beige"],
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
    /(?:ط§ط³ظ…ظٹ|ط§ظ„ط§ط³ظ…|name is|my name is)\s*[:ï¼ڑ-]?\s*([^\nطŒ,]{2,80})/i,
  ]);

const extractAddress = (message = "") =>
  extractNamedField(message, [
    /(?:ط§ظ„ط¹ظ†ظˆط§ظ†|ط¹ظ†ظˆط§ظ†ظٹ|address)\s*[:ï¼ڑ-]?\s*([^\n]{6,180})/i,
  ]);

const extractArea = (message = "") => {
  const value = extractNamedField(message, [
    /(?:ط§ظ„ظ…ظ†ط·ظ‚ط©|ظ…ظ†ط·ظ‚ط©|area)\s*[:ï¼ڑ-]?\s*([^\nطŒ,]{2,80})/i,
  ]);
  return value;
};

const extractGovernorate = (message = "") => {
  const value = extractNamedField(message, [
    /(?:ط§ظ„ظ…ط­ط§ظپط¸ط©|ظ…ط­ط§ظپط¸ط©|governorate)\s*[:ï¼ڑ-]?\s*([^\nطŒ,]{2,80})/i,
  ]);
  return value;
};

const CONFIRM_TERMS = ["ط§ظƒط¯", "ط£ظƒط¯", "طھط£ظƒظٹط¯", "طھظ…ط§ظ…", "ظ…ظˆط§ظپظ‚", "confirm", "yes"];
const HANDOFF_TERMS = ["ط؛ظ„ط·", "ظ…ط´ظƒظ„ط©", "ط²ط¹ظ„ط§ظ†", "ط´ظƒظˆظ‰", "complaint"];

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
    .replace(/[ط¥ط£ط¢ط§]/g, "ط§")
    .replace(/ظ‰/g, "ظٹ")
    .replace(/ط©/g, "ظ‡")
    .replace(/[ظ‘ظژظ‹ظڈظŒظگظچظ’ظ€]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const hasAnyTerm = (message = "", terms = []) => {
  const normalized = normalizeArabic(message);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
};

const BUYING_INTENT_TERMS = [
  "طھظ…ط§ظ… ظ‡ط§ط®ط¯ظ‡",
  "طھظ…ط§ظ… ظ‡ط§ط®ط¯ظ‡ط§",
  "ظ‡ط§ط®ط¯ظ‡",
  "ظ‡ط§ط®ط¯ظ‡ط§",
  "ط§ط¹ظ…ظ„ ط§ظˆط±ط¯ط±",
  "ط§ط¹ظ…ظ„ ط£ظˆط±ط¯ط±",
  "ط§ط­ط¬ط²ظ‡ظˆظ„ظٹ",
  "ط§ط­ط¬ط²ظ‡ط§ظ„ظٹ",
  "ط§ط¨ط¹طھظ‡ظˆظ„ظٹ",
  "ط§ط¨ط¹طھظˆظ‡ظˆظ„ظٹ",
  "ط§ط¨ط¹طھظ‡ط§ظ„ظٹ",
  "ظ‡ط·ظ„ط¨ظ‡",
  "ظ‡ط·ظ„ط¨ظ‡ط§",
  "ظ‡ط·ظ„ط¨",
];

const hasClearBuyingIntent = (message = "") =>
  hasAnyTerm(message, BUYING_INTENT_TERMS) ||
  /\b(?:order it|place (?:an )?order|create (?:an )?order|checkout now|reserve it|send it|i'?ll take it)\b/i.test(text(message));

const detectSalesObjection = (message = "") => {
  const normalized = normalizeArabic(message);
  const checks = [
    ["expensive", ["ط§ظ„ط³ط¹ط± ط؛ط§ظ„ظٹ", "ط؛ط§ظ„ظٹ", "ط؛ط§ظ„ظٹظ‡", "ط؛ط§ظ„ظٹ ط§ظˆظٹ", "ط؛ط§ظ„ظٹظ‡ ط§ظˆظٹ", "too expensive"]],
    ["discount", ["ظپظٹظ‡ ط®طµظ…", "ظپظٹ ط®طµظ…", "ط®طµظ…", "discount"]],
    ["material", ["ط®ط§ظ…طھظ‡ ط§ظٹظ‡", "ط§ظ„ط®ط§ظ…ط©", "ط®ط§ظ…ظ‡", "material"]],
    ["authenticity", ["ط§طµظ„ظٹ ظˆظ„ط§ ظƒظˆط¨ظٹ", "ط§طµظ„ظٹ", "ظƒظˆط¨ظٹ", "ظ‡ط§ظٹ ظƒظˆط¨ظٹ", "original", "copy"]],
    ["delivery_fee", ["ط§ظ„طھظˆطµظٹظ„ ظƒط§ظ…", "ط´ط­ظ† ظƒط§ظ…", "طھظƒظ„ظپط© ط§ظ„طھظˆطµظٹظ„", "delivery fee", "shipping"]],
    ["delivery_eta", ["ظ‡ظٹظˆطµظ„ ط§ظ…طھظ‰", "ظٹظˆطµظ„ ط§ظ…طھظ‰", "ظˆظ‚طھ ط§ظ„طھظˆطµظٹظ„", "delivery time", "when arrive"]],
    ["exchange", ["ظٹظ†ظپط¹ ط§ط³طھط¨ط¯ط§ظ„", "ط§ط³طھط¨ط¯ط§ظ„", "طھط¨ط¯ظٹظ„", "exchange"]],
    ["cheaper", ["ظپظٹظ‡ ط§ط±ط®طµ", "ط§ط±ط®طµ", "ط­ط§ط¬ظ‡ ط§ط±ط®طµ", "cheaper"]],
    ["last_price", ["ط§ط®ط± ط³ط¹ط±", "ط¢ط®ط± ط³ط¹ط±", "ظ†ظ‡ط§ط¦ظٹ", "last price"]],
    ["cod", ["ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…", "ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…", "ظƒط§ط´ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…", "cod", "cash on delivery"]],
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
    isOrderIntent: hasOrder || (hasConfirm && (normalized.includes("ط§ظˆط±ط¯ط±") || normalized.includes("ط£ظˆط±ط¯ط±"))),
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

const buildProductAliasTerms = (message = "", metadata = {}) => compact([
  ...expandSearchAliasTerms(message, { limit: 40 }),
  ...expandSearchAliasTerms(metadata?.matched_product_name || "", { limit: 20 }),
  ...expandSearchAliasTerms(metadata?.product_name || "", { limit: 20 }),
  ...expandSearchAliasTerms(metadata?.image_search_query || "", { limit: 20 }),
  ...(Array.isArray(metadata?.keywords) ? metadata.keywords.flatMap((keyword) => expandSearchAliasTerms(keyword, { limit: 12 })) : []),
], 80);

const productSearchVectorSql = (productColumns, variantColumns) => {
  const productFields = ["name", "name_ar", "description", "seo_keywords", "ai_keywords", "style_tags", "slug", "canonical_slug", "sku", "barcode", "product_code"]
    .filter((column) => productColumns.has(column))
    .map((column) => `COALESCE(p.${column}::text, '')`);
  const variantFields = ["edition_name", "edition_slug", "size", "color", "sku", "barcode"]
    .filter((column) => variantColumns.has(column))
    .map((column) => `COALESCE(pv.${column}::text, '')`);
  return [...productFields, ...variantFields].length ? [...productFields, ...variantFields].join(" || ' ' || ") : "COALESCE(p.name, '')";
};

const productAliasVectorSql = (productColumns, variantColumns) => {
  const fields = [
    "name", "name_ar", "brand", "model", "sku", "barcode", "category", "category_name",
    "tags", "ai_keywords", "style_tags", "seo_keywords", "slug", "canonical_slug", "product_code",
  ]
    .filter((column) => productColumns.has(column))
    .map((column) => `COALESCE(p.${column}::text, '')`);
  const variantFields = ["edition_name", "edition_slug", "size", "color", "sku", "barcode"]
    .filter((column) => variantColumns.has(column))
    .map((column) => `COALESCE(pv.${column}::text, '')`);
  return [...fields, ...variantFields].length ? [...fields, ...variantFields].join(" || ' ' || ") : "COALESCE(p.name, '')";
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
  const aliasTerms = buildProductAliasTerms(message, metadata);
  const { productPrice, variantPrice, variantName, variantSize, variantColor, variantSku, variantBarcode, variantImage } = productSelectSql(productColumns, variantColumns);
  const searchVector = productSearchVectorSql(productColumns, variantColumns);
  const aliasVector = productAliasVectorSql(productColumns, variantColumns);
  const compactAliasVector = `REGEXP_REPLACE(LOWER(${aliasVector}), '[^a-z0-9\u0600-\u06FF]+', '', 'g')`;
  const variantActive = variantColumns.has("is_active") && variantColumns.has("deleted_at") ? "AND pv.is_active IS DISTINCT FROM FALSE AND pv.deleted_at IS NULL" : "";
  const productActive = productColumns.has("status") ? "AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive','disabled','archived','deleted')" : "";
  const productEligibility = aiProductSqlExclusionClause("p", productColumns);
  const termParams = terms.map((term) => `%${term}%`);
  const aliasParams = aliasTerms.map((term) => `%${term}%`);
  const compactAliasParams = aliasTerms.map((term) => `%${compactAliasText(term)}%`);
  const directProductId = numeric(metadata.matched_product_id || metadata.product_id, 0);
  if (!terms.length && !aliasTerms.length && !directProductId) return [];
  const termScore = terms.length
    ? terms.map((_, index) => `MAX(CASE WHEN LOWER(${searchVector}) LIKE LOWER($${index + 2}) THEN 1 ELSE 0 END)`).join(" + ")
    : "0";
  const aliasOffset = termParams.length + 2;
  const compactAliasOffset = aliasOffset + aliasParams.length;
  const denominatorParam = compactAliasOffset + compactAliasParams.length;
  const directProductParam = denominatorParam + 1;
  const aliasScore = aliasTerms.length
    ? aliasTerms.map((_, index) => {
      const aliasParam = aliasOffset + index;
      const compactParam = compactAliasOffset + index;
      return `MAX(CASE
        WHEN LOWER(${aliasVector}) LIKE LOWER($${aliasParam}) THEN 2
        WHEN ${compactAliasVector} LIKE LOWER($${compactParam}) THEN 2
        ELSE 0
      END)`;
    }).join(" + ")
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
      ((${aliasScore}) + (${termScore}))::numeric / GREATEST($${denominatorParam}::numeric, 1) AS confidence,
      (${aliasScore})::numeric AS alias_score,
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
      AND ${productEligibility}
      AND (
        ($${directProductParam}::bigint > 0 AND p.id = $${directProductParam}::bigint)
        OR (${aliasTerms.length ? aliasTerms.map((_, index) => {
          const aliasParam = aliasOffset + index;
          const compactParam = compactAliasOffset + index;
          return `LOWER(${aliasVector}) LIKE LOWER($${aliasParam}) OR ${compactAliasVector} LIKE LOWER($${compactParam})`;
        }).join(" OR ") : "FALSE"})
        OR (${terms.length ? terms.map((_, index) => `LOWER(${searchVector}) LIKE LOWER($${index + 2})`).join(" OR ") : "FALSE"})
      )
    GROUP BY p.id
    ORDER BY CASE WHEN p.id = $${directProductParam}::bigint THEN 1 ELSE 0 END DESC, alias_score DESC, confidence DESC, total_stock DESC, p.id DESC
    LIMIT 8
    `,
    [
      tenantId || null,
      ...termParams,
      ...aliasParams,
      ...compactAliasParams,
      Math.max(1, terms.length + (aliasTerms.length * 2)),
      directProductId,
    ]
  );
  const rows = result.rows.map((row) => ({
    ...row,
    product_price: numeric(row.product_price, 0),
    total_stock: integer(row.total_stock, 0),
    confidence: directProductId && Number(row.id) === directProductId ? 1 : Math.max(0, Math.min(1, numeric(row.confidence, 0))),
    variants: Array.isArray(row.variants) ? row.variants : [],
  }));
  const scoredRows = rows.map((row) => {
    const generatedAliases = generateProductAliases(row);
    const rowAliasCompact = new Set(generatedAliases.map(compactAliasText).filter(Boolean));
    const queryAliasCompact = aliasTerms.map(compactAliasText).filter(Boolean);
    const generatedAliasHit = queryAliasCompact.some((alias) => rowAliasCompact.has(alias) || [...rowAliasCompact].some((rowAlias) => rowAlias.includes(alias) || alias.includes(rowAlias)));
    return {
      ...row,
      generated_aliases: generatedAliases,
      alias_score: numeric(row.alias_score, 0) + (generatedAliasHit ? 4 : 0),
      confidence: Math.max(row.confidence, generatedAliasHit ? 0.92 : row.confidence),
    };
  }).sort((left, right) =>
    numeric(right.alias_score, 0) - numeric(left.alias_score, 0) ||
    numeric(right.confidence, 0) - numeric(left.confidence, 0) ||
    numeric(right.total_stock, 0) - numeric(left.total_stock, 0)
  );
  console.log("[ai-agent:product-alias-engine]", {
    tenantId,
    query: text(message).slice(0, 120),
    terms,
    alias_terms: aliasTerms.slice(0, 24),
    matched: scoredRows.slice(0, 5).map((row) => ({
      product_id: row.id,
      name: row.name,
      alias_score: numeric(row.alias_score, 0),
      confidence: numeric(row.confidence, 0),
      aliases: (row.generated_aliases || []).slice(0, 8),
    })),
  });
  const eligibleRows = filterAiEligibleProducts(scoredRows, { requireProductUrl: false });
  const understanding = detectSalesProductUnderstanding({
    message,
    memory: metadata?.memory || metadata?.conversation_memory || {},
    source: "ai_order_product_search",
  });
  const gatedRows = understanding.requires_relevance_gate
    ? gateRelevantProducts({ products: eligibleRows, understanding, limit: 8, fallback: false })
    : eligibleRows;
  console.log("[ai-orchestrator:candidates]", {
    exact_count: gatedRows.filter((product) => product.relevance_reasons?.includes("model_family_match")).length,
    family_count: gatedRows.filter((product) => product.relevance_reasons?.includes("same_jordan_family")).length,
    similar_count: gatedRows.length,
    fallback_count: 0,
  });
  return gatedRows;
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
  if (missing.includes("customer_name")) return "طھط´ط±ظپظ†ط§ â‌¤ï¸ڈ ظ…ظ…ظƒظ† ط£ط¹ط±ظپ ط§ط³ظ…ظƒطں";
  if (missing.includes("customer_phone")) return "ط§ط¨ط¹طھظ„ظٹ ط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ط¨ط³ ط¹ط´ط§ظ† ظ†ط£ظƒط¯ ط§ظ„ط·ظ„ط¨.";
  if (missing.includes("area")) return "ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ط­ط§ظپط¸ط© ظˆط§ظ„ظ…ظ†ط·ظ‚ط© ط¹ط´ط§ظ† ظ†ط£ظƒط¯ ط§ظ„طھظˆطµظٹظ„.";
  if (missing.includes("address")) return "ط§ط¨ط¹طھظ„ظٹ ط§ظ„ط¹ظ†ظˆط§ظ† ط¨ط§ظ„طھظپطµظٹظ„.";
  if (missing.includes("variant")) return "طھط­ط¨ ط£ظ†ظ‡ظٹ ظ…ظ‚ط§ط³ ظˆظ„ظˆظ†طں";
  if (missing.includes("quantity")) return "طھط­ط¨ ظƒط§ظ… ظ‚ط·ط¹ط©طں";
  return "ظ…ظ…ظƒظ† طھط¨ط¹طھ ط§ط³ظ… ط§ظ„ظ…ظ†طھط¬ ط£ظˆ طµظˆط±طھظ‡ ط¹ط´ط§ظ† ط£ط¬ظ‡ط² ط§ظ„ط£ظˆط±ط¯ط±طں";
};

const productPrice = (product = {}, variant = null) => {
  const resolved = resolveCustomerDisplayPrice({ ...product, ...variant, product, variant });
  const raw = numeric(variant?.price || product?.final_price || product?.sale_price || product?.product_price || product?.price, 0);
  console.log("[ai-text-price-source]", {
    product_id: resolved.product_id || product?.id || null,
    variant_id: resolved.variant_id || variant?.id || null,
    raw_price_used_in_text: raw || "",
    text_template: "${product?.name || 'ط§ظ„ظ…ظˆط¯ظٹظ„ ط¯ظ‡'} ط³ط¹ط±ظ‡ ${formatMoneyAr(productPrice(product, variant))}",
    function_name: "productPrice",
    file_name: "server/services/aiAgentOrderService.js",
  });
  if (raw > 0 && resolved.display_price > 0 && raw !== resolved.display_price) {
    console.error("[ai-price-mismatch]", {
      product_id: resolved.product_id || product?.id || null,
      variant_id: resolved.variant_id || variant?.id || null,
      text_price: raw,
      selected_display_price: resolved.display_price,
    });
  }
  return resolved.display_price || raw;
};

const formatMoneyAr = (value) => {
  const amount = numeric(value, 0);
  return amount > 0 ? `${amount} ط¬ظ†ظٹظ‡` : "ط§ظ„ط³ط¹ط± ط¨ظٹطھط£ظƒط¯ ط­ط³ط¨ ط§ظ„ط§ط®طھظٹط§ط±";
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
  const availability = numeric(variant?.stock ?? product?.total_stock, 0) > 0 ? "ظ…طھط§ط­ ط­ط§ظ„ظٹط§" : "ظ…ط´ ظ…طھط§ط­ ط­ط§ظ„ظٹط§";
  const optionLines = [
    options.colors.length ? `ط§ظ„ط£ظ„ظˆط§ظ† ط§ظ„ظ…طھط§ط­ط©: ${options.colors.join("طŒ ")}.` : "",
    options.sizes.length ? `ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط§ظ„ظ…طھط§ط­ط©: ${options.sizes.join("طŒ ")}.` : "",
  ].filter(Boolean);
  return [
    `${product?.name || "ط§ظ„ظ…ظˆط¯ظٹظ„ ط¯ظ‡"} ط³ط¹ط±ظ‡ ${formatMoneyAr(productPrice(product, variant))}طŒ ظˆ${availability}.`,
    "ط§ط®طھظٹط§ط± ط¹ظ…ظ„ظٹ ظˆط´ظٹظƒطŒ ظ…ظ†ط§ط³ط¨ ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظٹظˆظ…ظٹ ظˆط¨ظٹظƒظ…ظ„ ط§ظ„ظ„ط¨ط³ ط¨ط³ظ‡ظˆظ„ط©.",
    ...optionLines,
    "طھط­ط¨ ط£ظ‚ظˆظ„ظƒ طھظپط§طµظٹظ„ ط£ظƒطھط± ظˆظ„ط§ ط£ظˆط±ظٹظƒ ط¨ط¯ط§ط¦ظ„طں",
  ].join("\n");
};

const buildObjectionAnswer = ({ objection = "", product = {}, variant = null, settings = {} } = {}) => {
  const price = formatMoneyAr(productPrice(product, variant));
  const canPromiseDiscount = settings.allow_discount_promises === true || settings.discount_permission === true;
  const maxDiscount = numeric(settings.max_discount_percent, 0);
  const answers = {
    expensive: `ظپط§ظ‡ظ… ط­ط¶ط±طھظƒ. ط³ط¹ط±ظ‡ ${price} ظ„ط£ظ†ظ‡ ط®ط§ظ…طھظ‡ ظˆطھظ‚ظپظٹظ„ظ‡ ط£ط¹ظ„ظ‰ ظ…ظ† ط§ظ„ط¨ط¯ط§ط¦ظ„ ط§ظ„ط¹ط§ط¯ظٹط©طŒ ظˆظƒظ…ط§ظ† ظ…طھط§ط­ ظ…ظ†ظ‡ ط§ط®طھظٹط§ط±ط§طھ ظ…ط­ط¯ظˆط¯ط©. ظ„ظˆ ط­ط§ط¨ط¨ ط£ط±ط´ط­ظ„ظƒ ط­ط§ط¬ط© ط£ط±ط®طµ ط£ظ‚ط¯ط± ط£ط¹ظ…ظ„ ظƒط¯ظ‡.`,
    discount: canPromiseDiscount && maxDiscount > 0
      ? `ط­ط§ظ„ظٹط§ ط§ظ„ط³ط¹ط± ط§ظ„ط¸ط§ظ‡ط± ط¹ظ†ط¯ظٹ ظ‡ظˆ ${price}. ط£ظ‚ط¯ط± ط£ط±ط§ط¬ط¹ظ„ظƒ ط®طµظ… ظ„ط­ط¯ ${maxDiscount}% ط­ط³ط¨ ط³ظٹط§ط³ط© ط§ظ„ظ…طھط¬ط± ظ‚ط¨ظ„ طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط±.`
      : `ط­ط§ظ„ظٹط§ ط§ظ„ط³ط¹ط± ط§ظ„ط¸ط§ظ‡ط± ط¹ظ†ط¯ظٹ ظ‡ظˆ ${price}. ظ…ظ‚ط¯ط±ط´ ط£ظˆط¹ط¯ ط¨ط®طµظ… ظٹط¯ظˆظٹطŒ ط¨ط³ ط§ظ„ظپط±ظٹظ‚ ظٹظ‚ط¯ط± ظٹط±ط§ط¬ط¹ ظ„ظˆ ظپظٹظ‡ ط¹ط±ط¶ ط´ط؛ط§ظ„ ظ‚ط¨ظ„ طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط±.`,
    material: "ط®ط§ظ…طھظ‡ ط­ط³ط¨ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظ†طھط¬ ظ…ظ† ط§ظ„ظ…ط®ط²ظˆظ†طŒ ظˆط§ظ„طھظ‚ظپظٹظ„ ظ…ط®طµطµ ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظٹظˆظ…ظٹ. ظ„ظˆ ظ…ط­طھط§ط¬ ظˆطµظپ ط£ط¯ظ‚ ظ„ظ„ط®ط§ظ…ط© ظ‡ط­ظˆظ‘ظ„ ط³ط¤ط§ظ„ظƒ ظ„ظ„ظپط±ظٹظ‚ ظٹط£ظƒط¯ظ‡ط§ ظ…ظ† ط§ظ„ظ‚ط·ط¹ط© ظ†ظپط³ظ‡ط§.",
    authenticity: "ط§ظ„ظ…ظ†طھط¬ ط¨ظٹطھط¨ط§ط¹ ظ…ظ† ظ…ط®ط²ظˆظ† ط§ظ„ظ…طھط¬ط± ط¨ط§ظ„ط­ط§ظ„ط© ظˆط§ظ„ظˆطµظپ ط§ظ„ظ…ط³ط¬ظ„ظٹظ† ط¹ظ†ط¯ظ†ط§. ظ„ظˆ ظ…ط­طھط§ط¬ طھط£ظƒظٹط¯ ط£طµظ„ظٹ/ظƒظˆط¨ظٹ ط¹ظ„ظ‰ ظ…ظˆط¯ظٹظ„ ظ…ط¹ظٹظ†طŒ ط§ظ„ظپط±ظٹظ‚ ظٹظ‚ط¯ط± ظٹط±ط§ط¬ط¹ طھظپط§طµظٹظ„ظ‡ ظ‚ط¨ظ„ ط§ظ„ط´ط­ظ†.",
    delivery_fee: text(settings.delivery_policy_text) || "ط§ظ„طھظˆطµظٹظ„ ط¨ظٹطھط­ط¯ط¯ ط­ط³ط¨ ط§ظ„ظ…ط­ط§ظپط¸ط© ظˆط§ظ„ظ…ظ†ط·ظ‚ط©. ط§ط¨ط¹طھظ„ظٹ ظ…ظ†ط·ظ‚طھظƒ ظˆط£ظ†ط§ ط£ط£ظƒط¯ظ„ظƒ ط§ظ„طھظƒظ„ظپط© ظ‚ط¨ظ„ طھط³ط¬ظٹظ„ ط§ظ„ط£ظˆط±ط¯ط±.",
    delivery_eta: text(settings.delivery_policy_text) || "ظ…ظٹط¹ط§ط¯ ط§ظ„ظˆطµظˆظ„ ط­ط³ط¨ ط§ظ„ظ…ط­ط§ظپط¸ط© ظˆط§ظ„ظ…ظ†ط·ظ‚ط©طŒ ظˆط؛ط§ظ„ط¨ط§ ط¨ظٹطھط£ظƒط¯ ظ…ط¹ط§ظƒ ط¨ط¹ط¯ طھط³ط¬ظٹظ„ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظˆظ‚ط¨ظ„ ط§ظ„ط´ط­ظ†.",
    exchange: text(settings.exchange_return_policy_text) || "ظٹظ†ظپط¹ ط§ظ„ط§ط³طھط¨ط¯ط§ظ„ ط­ط³ط¨ ط³ظٹط§ط³ط© ط§ظ„ظ…طھط¬ط± ظˆط­ط§ظ„ط© ط§ظ„ظ…ظ†طھط¬. ط§ظ„ظپط±ظٹظ‚ ط¨ظٹط£ظƒط¯ظ„ظƒ ط§ظ„ط´ط±ظˆط· ظ‚ط¨ظ„ طھط£ظƒظٹط¯ ط§ظ„ط´ط­ظ†.",
    cheaper: "ط£ظ‚ط¯ط± ط£ط±ط´ط­ظ„ظƒ ط¨ط¯ط§ط¦ظ„ ط£ط±ط®طµ ظ…ظ† ظ†ظپط³ ط§ظ„ط³طھط§ظٹظ„. طھط­ط¨ ظ†ظپط³ ط§ظ„ظ„ظˆظ† ظˆظ„ط§ ط§ظ„ط£ظ‡ظ… ط§ظ„ط³ط¹ط±طں",
    last_price: canPromiseDiscount && maxDiscount > 0
      ? `ط¢ط®ط± ط³ط¹ط± ط¸ط§ظ‡ط± ط¹ظ†ط¯ظٹ ط­ط§ظ„ظٹط§ ${price}. ظˆظ…ظ…ظƒظ† ظ†ط±ط§ط¬ط¹ ط®طµظ… ظ„ط­ط¯ ${maxDiscount}% ط­ط³ط¨ ط³ظٹط§ط³ط© ط§ظ„ظ…طھط¬ط± ظ‚ط¨ظ„ ط§ظ„طھط£ظƒظٹط¯.`
      : `ط¢ط®ط± ط³ط¹ط± ط¸ط§ظ‡ط± ط¹ظ†ط¯ظٹ ط­ط§ظ„ظٹط§ ${price}. ظ„ظˆ ظپظٹظ‡ ط¹ط±ط¶ ط´ط؛ط§ظ„طŒ ط§ظ„ظپط±ظٹظ‚ ط¨ظٹط£ظƒط¯ ظ‚ط¨ظ„ طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط±.`,
    cod: text(settings.cod_availability_text) || "ط£ظٹظˆظ‡طŒ ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ… ظ…طھط§ط­ ط­ط³ط¨ ط³ظٹط§ط³ط© ط§ظ„ط´ط­ظ† ظˆط§ظ„ظ…ظ†ط·ظ‚ط©. ظ‡ظ†ط£ظƒط¯ظ‡ط§ ظ…ط¹ط§ظƒ ظ‚ط¨ظ„ ط®ط±ظˆط¬ ط§ظ„ط£ظˆط±ط¯ط±.",
  };
  return answers[objection] || buildProductSalesAnswer({ product, variant });
};

const inferredCustomerName = ({ channel = "", message = "", explicitName = "", lastAiAnswer = "" } = {}) => {
  const normalizedChannel = normalizeOrderChannel(channel);
  if (explicitName && !isLikelyMessageLikeName(explicitName)) return explicitName;
  if (["facebook_messenger", "instagram"].includes(normalizedChannel)) return "";
  const candidate = text(message).replace(/[^\p{L}\s.-]/gu, " ").replace(/\s+/g, " ").trim();
  if (
    candidate.length >= 2 &&
    candidate.length <= 60 &&
    hasAnyTerm(lastAiAnswer, ["تمام يا فندم", "اسم حضرتك"]) &&
    !isLikelyMessageLikeName(candidate) &&
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
  if (candidate.length >= 6 && hasAnyTerm(lastAiAnswer, ["ط§ظ„ط¹ظ†ظˆط§ظ† ط¨ط§ظ„طھظپطµظٹظ„", "ط§ظ„ظ…ط­ط§ظپط¸ط© ظˆط§ظ„ظ…ظ†ط·ظ‚ط©"])) return candidate.slice(0, 180);
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
    `ط¬ظ‡ط²طھ ظ…ط³ظˆط¯ط© ط§ظ„ط£ظˆط±ط¯ط±:`,
    `ط§ظ„ظ…ظ†طھط¬: ${product?.name || "ط§ظ„ظ…ظ†طھط¬ ط§ظ„ظ…ط®طھط§ط±"}`,
    `ط§ظ„ظ…ظ‚ط§ط³/ط§ظ„ظ„ظˆظ†: ${[variant?.size, variant?.color || variant?.name].filter(Boolean).join(" - ") || "ط­ط³ط¨ ط§ظ„ط§ط®طھظٹط§ط±"}`,
    `ط§ظ„ط³ط¹ط±: ${unitPrice} ط¬ظ†ظٹظ‡`,
    deliveryFee ? `ط§ظ„طھظˆطµظٹظ„: ${deliveryFee} ط¬ظ†ظٹظ‡` : "ط§ظ„طھظˆطµظٹظ„ ط¨ظٹطھط£ظƒط¯ ط­ط³ط¨ ط§ظ„ظ…ظ†ط·ظ‚ط©",
    `ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„طھظ‚ط±ظٹط¨ظٹ: ${total} ط¬ظ†ظٹظ‡`,
    `ط±ظ‚ظ… ط§ظ„ظ…ط³ظˆط¯ط©: ${displayPublicOrderNumber(order) || order?.id}`,
    "طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط±طں",
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
  const channel = normalizeOrderChannel(payload.channel || payload.source || payload.metadata?.channel);
  const conversationId = text(payload.conversation_id || payload.conversationId || payload.session_id || payload.metadata?.session_id);
  if (!conversationId) throw Object.assign(new Error("conversation_id is required"), { status: 400 });
  const product = payload.product || (await searchAiOrderProducts({ tenantId, message: payload.original_customer_message || payload.message, metadata: payload.metadata }))[0];
  if (!product || numeric(product.confidence, 0) < CONFIDENCE_THRESHOLD) {
    throw Object.assign(new Error("Product match confidence is too low"), { status: 409, code: "LOW_CONFIDENCE", product });
  }
  const quantity = Math.max(1, integer(payload.quantity, 1));
  const selectedVariant = payload.variant || selectVariant(product, { size: payload.size, color: payload.color });
  console.log("draft_stock_source", {
    tenantId,
    conversation_id: conversationId,
    product_id: product.id || product.product_id || null,
    variant_id: selectedVariant?.id || selectedVariant?.variant_id || null,
    requested_size: text(payload.size || ""),
    requested_color: text(payload.color || ""),
    source: "product_variants.stock",
    stock: numeric(selectedVariant?.stock, -1),
    quantity,
  });
  console.log("stock_consistency_check", {
    tenantId,
    conversation_id: conversationId,
    product_id: product.id || product.product_id || null,
    variant_id: selectedVariant?.id || selectedVariant?.variant_id || null,
    requested_size: text(payload.size || ""),
    source: "product_variants.stock",
    available: Boolean(selectedVariant && numeric(selectedVariant.stock, 0) >= quantity),
  });
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
      console.log("stock_check_source", {
        tenantId,
        order_id: order.id,
        conversation_id: order.ai_agent_conversation_id || conversationId,
        product_id: item.product_id || null,
        variant_id: item.variant_id || null,
        source: "product_variants.stock_for_update",
        stock: currentStock,
        quantity: numeric(item.quantity, 0),
      });
      console.log("stock_consistency_check", {
        tenantId,
        order_id: order.id,
        conversation_id: order.ai_agent_conversation_id || conversationId,
        product_id: item.product_id || null,
        variant_id: item.variant_id || null,
        stock_check_source: "product_variants.stock_for_update",
        draft_stock_source: "product_variants.stock",
        consistent: currentStock >= numeric(item.quantity, 0),
      });
      if (currentStock < numeric(item.quantity, 0)) throw Object.assign(new Error("Selected variant is out of stock"), { status: 409, code: "OUT_OF_STOCK" });
      await adjustVariantStock(client, {
        tenantId,
        variantId: item.variant_id,
        productId: item.product_id,
        quantityChange: numeric(item.quantity, 0) * -1,
        movementType: "SALE_OUT",
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
    const confirmedOrder = attachPublicOrderNumber(updated.rows[0], order.channel || order.source || "web_chat");
    sendManagerInvoiceCreatedPush({ order: confirmedOrder, source: "ai_agent" }).catch((error) => console.warn("[manager-push:invoice-created] ai skipped", {
      order_id: order.id,
      message: error?.message || String(error),
    }));
    console.log("[ai-agent:orders] confirmed", { tenantId, order_id: order.id, conversation_id: order.ai_agent_conversation_id });
    return { order: confirmedOrder, items: items.rows };
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
  const baseSalesEngineState = resolveAiSalesConversationState({
    message,
    intent: { type: intent.isOrderIntent ? "order" : objection ? "objection" : "general" },
    memory: metadata.memory || metadata.conversation_memory || {},
    response: {
      detected_intent: intent.isOrderIntent ? "order" : objection ? "sales_objection" : "",
    },
  });
  const withOrderSalesStage = (payload = {}, stage = SALES_STAGES.browsing) =>
    withSalesStage({
      sales_engine: {
        ...baseSalesEngineState,
        next_state: stage === SALES_STAGES.draftCreated
          ? "order_created"
          : stage === SALES_STAGES.confirmed
            ? "order_created"
            : stage === SALES_STAGES.handoff
              ? "handoff"
              : stage === SALES_STAGES.objectionHandling
                ? "objection"
                : stage === SALES_STAGES.readyToOrder
                  ? "buying"
                  : stage.startsWith("collecting_")
                    ? "checkout"
                    : baseSalesEngineState.next_state,
      },
      ...payload,
    }, stage);
  const isCollectingReply = hasAnyTerm(conversation.lastAiAnswer, [
    "ظ…ظ…ظƒظ† ط£ط¹ط±ظپ ط§ط³ظ… ط­ط¶ط±طھظƒ",
    "ط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„",
    "ط§ظ„ظ…ط­ط§ظپط¸ط© ظˆط§ظ„ظ…ظ†ط·ظ‚ط©",
    "ط§ظ„ط¹ظ†ظˆط§ظ† ط¨ط§ظ„طھظپطµظٹظ„",
    "ط£ظ†ظ‡ظٹ ظ…ظ‚ط§ط³ ظˆظ„ظˆظ†",
    "ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط£ظˆ ط§ظ„ط£ظ„ظˆط§ظ†",
    "ظƒط§ظ… ظ‚ط·ط¹ط©",
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
    return withOrderSalesStage({
      answer: "طھظ…ط§ظ…طŒ ظ‡ط­ظˆظ‘ظ„ ط·ظ„ط¨ظƒ ظ„ط­ط¯ ظ…ظ† ط§ظ„ظپط±ظٹظ‚ ظٹط±ط§ط¬ط¹ ط§ظ„طھظپط§طµظٹظ„ ظ…ط¹ط§ظƒ ط¹ط´ط§ظ† ظ…ط­طھط§ط¬ طھط¯ط®ظ„ ط¨ط´ط±ظٹ.",
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
        return withOrderSalesStage({
          answer: "طھظ…ط§ظ…طŒ ظ‡ط­ظˆظ‘ظ„ طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط± ظ„ط­ط¯ ظ…ظ† ط§ظ„ظپط±ظٹظ‚ ظٹط±ط§ط¬ط¹ظ‡ ظˆظٹط£ظƒط¯ ظ…ط¹ط§ظƒ ط§ظ„طھظپط§طµظٹظ„ ظ‚ط¨ظ„ ط§ظ„ط´ط­ظ†.",
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
      return withOrderSalesStage({
        answer: `طھظ… طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط± ط±ظ‚ظ… ${displayPublicOrderNumber(confirmed.order) || confirmed.order.id}. ط§ظ„ظپط±ظٹظ‚ ظ‡ظٹطھط§ط¨ط¹ ظ…ط¹ط§ظƒ ظ‚ط±ظٹط¨ ظ„طھط£ظƒظٹط¯ طھظپط§طµظٹظ„ ط§ظ„ط´ط­ظ†.`,
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
    customer_name: inferredCustomerName({ channel: conversation.channel || conversation.source || "", message, explicitName, lastAiAnswer: conversation.lastAiAnswer }),
    customer_phone: normalizePhone(enrichedMetadata.customer_phone || fullText.match(/01[0125]\d{8}/)?.[0] || ""),
    governorate: text(enrichedMetadata.governorate || extractGovernorate(fullText)),
    city_area: text(enrichedMetadata.city_area || enrichedMetadata.area || extractArea(fullText)),
    customer_address: inferredAddress({ message, explicitAddress, lastAiAnswer: conversation.lastAiAnswer }),
    quantity: extractQuantity(fullText),
  };
  const confidence = numeric(product?.confidence, 0);
  if (objection && product && confidence >= CONFIDENCE_THRESHOLD) {
    logSalesFlow("objection_handling", { tenantId, conversationId, objection, product_id: product.id });
    return withOrderSalesStage({
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
    return withOrderSalesStage({
      answer: "ط£ظƒظٹط¯طŒ ط¨ط³ ط§ط¨ط¹طھظ„ظٹ ط§ط³ظ… ط§ظ„ظ…ظ†طھط¬ ط£ظˆ ط§ظپطھط­ظ„ظٹ ط§ظ„ظ…ظˆط¯ظٹظ„ ط§ظ„ظ…ظ‚طµظˆط¯ ط¹ط´ط§ظ† ط£ط±ط¯ ط¹ظ„ظٹظƒ ط¨ط³ط¹ط±ظ‡ ظˆطھظپط§طµظٹظ„ظ‡ ط¨ط¯ظ‚ط©.",
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
    return withOrderSalesStage({
      answer: "ظ…ظ…ظƒظ† طھط¨ط¹طھ ط§ط³ظ… ط§ظ„ظ…ظ†طھط¬ ط£ظˆ طµظˆط±ط©/ظ„ظٹظ†ظƒ ط£ظˆط¶ط­طں ط¹ط§ظٹط² ط£طھط£ظƒط¯ ظ…ظ† ط§ظ„ظ…ظˆط¯ظٹظ„ ظ‚ط¨ظ„ ظ…ط§ ط£ط¬ظ‡ط² ط§ظ„ط£ظˆط±ط¯ط±.",
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
    return withOrderSalesStage({
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
    return withOrderSalesStage({
      answer: "ط§ظ„ظ…ظ‚ط§ط³/ط§ظ„ظ„ظˆظ† ط¯ظ‡ ظ…ط´ ظˆط§ط¶ط­ ط£ظˆ ط؛ظٹط± ظ…طھط§ط­ ط­ط§ظ„ظٹط§. ط£ظ‚ط¯ط± ط£ط±ط´ط­ظ„ظƒ ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط£ظˆ ط§ظ„ط£ظ„ظˆط§ظ† ط§ظ„ظ…طھط§ط­ط© ظ…ظ† ظ†ظپط³ ط§ظ„ظ…ظˆط¯ظٹظ„.",
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
    return withOrderSalesStage({
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
    return withOrderSalesStage({
      answer: "طھظ…ط§ظ…طŒ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظƒط¯ظ‡ ط´ط¨ظ‡ ظƒط§ظ…ظ„ط©. ظ‡ط­ظˆظ‘ظ„ظ‡ط§ ظ„ظ„ظپط±ظٹظ‚ ظٹط±ط§ط¬ط¹ ط§ظ„ظ…ط®ط²ظˆظ† ظˆط§ظ„ط³ط¹ط± ظˆظٹط£ظƒط¯ ط§ظ„ط£ظˆط±ط¯ط± ظ…ط¹ط§ظƒ.",
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
    channel: normalizeOrderChannel(metadata.channel),
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
  return withOrderSalesStage({
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

