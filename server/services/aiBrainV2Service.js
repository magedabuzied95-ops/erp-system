import db from "../database/db.js";
import { AI_AGENT_CHANNELS, normalizeChannel, normalizeOutgoingChannelReply } from "./aiChannelAdapterService.js";
import { normalizeProductCards } from "./aiProductCards.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const normalizeArabic = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsAny = (value = "", terms = []) => terms.some((term) => value.includes(term));

const detectExplicitModel = (message = "") => {
  const normalized = normalizeArabic(message);
  if (/(\u062c\u0648\u0631\u062f\u0646\s*(?:4|\u0664|\u06f4|\u0641\u0648\u0631)|jordan\s*4|jordan4|aj4|j4)/i.test(normalized)) {
    return {
      brand: "Jordan",
      model: "jordan4",
      display: "Jordan 4",
      aliases: ["jordan 4", "jordan4", "air jordan 4", "aj4", "j4", "\u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631", "\u062c\u0648\u0631\u062f\u0646 4"],
      confidence: 0.98,
    };
  }
  return null;
};

const classifyIntent = ({ message = "", attachments = [], explicitModel = null } = {}) => {
  const normalized = normalizeArabic(message);
  if (asArray(attachments).length) return "visual_search";
  if (/(\u0635\u0648\u0631|\u0635\u0648\u0631\u0647|\u0635\u0648\u0631\u0629|photo|image)/i.test(normalized)) return explicitModel ? "product_search" : "more_images";
  if (/(\u063a\u0627\u0644\u064a|\u063a\u0627\u0644\u064a\u0647|expensive|price high)/i.test(normalized)) return "price_objection";
  if (/(\u0644\u0648\u0646|\u0627\u0644\u0648\u0627\u0646|color)/i.test(normalized)) return "color_followup";
  if (/(\u0645\u0642\u0627\u0633|\u0645\u0642\u0627\u0633\u0627\u062a|size|available|availability|\u0645\u062a\u0627\u062d)/i.test(normalized)) return "size_followup";
  if (/^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|yes)$/i.test(normalized)) return "bare_confirmation";
  if (/(\u0639\u0627\u064a\u0632\s*[\u0627\u0623]?\u0634\u062a\u0631\u064a|[\u0627\u0623]?\u0634\u062a\u0631\u064a|buy|order|\u0627\u062d\u062c\u0632|\u062d\u062c\u0632)/i.test(normalized)) return "buying_intent";
  if (explicitModel || /(\u0628\u0643\u0627\u0645|\u0643\u0627\u0645|\u0627\u0644\u0633\u0639\u0631|\u0633\u0639\u0631|price|jordan|\u062c\u0648\u0631\u062f\u0646|nike|adidas)/i.test(normalized)) return "product_search";
  if (containsAny(normalized, ["\u0633\u0644\u0627\u0645", "\u0627\u0647\u0644\u0627", "hello", "hi"])) return "greeting";
  return "general";
};

const tableColumnCache = new Map();

const tableColumns = async (tableName = "") => {
  const safeName = text(tableName);
  if (!safeName) return new Set();
  if (tableColumnCache.has(safeName)) return tableColumnCache.get(safeName);
  const result = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [safeName]);
  const columns = new Set((result.rows || []).map((row) => row.column_name));
  tableColumnCache.set(safeName, columns);
  return columns;
};

const column = (alias = "", columns = new Set(), names = [], fallback = "NULL") => {
  const match = names.find((name) => columns.has(name));
  return match ? `${alias}.${match}` : fallback;
};

const searchTermsForMessage = ({ message = "", explicitModel = null } = {}) => {
  if (explicitModel) return explicitModel.aliases;
  return normalizeArabic(message)
    .split(/\s+/)
    .filter((term) => term.length >= 2)
    .slice(0, 8);
};

const scoreProduct = ({ product = {}, normalizedMessage = "", explicitModel = null } = {}) => {
  const name = normalizeArabic(product.name || product.title || product.product_name || "");
  const sku = normalizeArabic(product.sku || "");
  let score = 0;
  const reasons = [];
  if (explicitModel?.model === "jordan4") {
    const hasJordan = /(\bjordan\b|\u062c\u0648\u0631\u062f\u0646)/i.test(name);
    const hasFour = /(\b4\b|\bfour\b|\u0641\u0648\u0631|\u0664|\u06f4)/i.test(name);
    const isWrongJordan = /(\bjordan\b|\u062c\u0648\u0631\u062f\u0646)/i.test(name) && !hasFour;
    if (hasJordan) {
      score += 60;
      reasons.push("brand_jordan");
    }
    if (hasFour) {
      score += 80;
      reasons.push("model_4");
    }
    if (/aj4|j4/i.test(name) || /aj4|j4/i.test(sku)) {
      score += 70;
      reasons.push("short_alias");
    }
    if (isWrongJordan) {
      score -= 75;
      reasons.push("wrong_jordan_model_penalty");
    }
  }
  for (const token of normalizedMessage.split(/\s+/).filter((item) => item.length >= 2)) {
    if (name.includes(token) || sku.includes(token)) score += 5;
  }
  const stock = Number(product.total_stock ?? product.stock ?? product.quantity ?? 0) || 0;
  if (stock > 0) score += 8;
  if (product.status && !["active", "published", "available"].includes(text(product.status).toLowerCase())) score -= 20;
  return { score, reasons };
};

const loadCandidateProducts = async ({ tenantId = null, message = "", explicitModel = null, limit = 80 } = {}) => {
  const productColumns = await tableColumns("products");
  const tenantFilter = productColumns.has("tenant_id") ? "AND ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)" : "";
  const deletedFilter = productColumns.has("deleted_at") ? "AND p.deleted_at IS NULL" : "";
  const activeFilter = productColumns.has("is_active") ? "AND COALESCE(p.is_active, TRUE) = TRUE" : "";
  const statusFilter = productColumns.has("status") ? "AND COALESCE(NULLIF(LOWER(p.status), ''), 'active') NOT IN ('deleted', 'archived', 'draft')" : "";
  const searchable = [
    column("p", productColumns, ["name", "title", "product_name"], "''"),
    column("p", productColumns, ["sku"], "''"),
    column("p", productColumns, ["article_code"], "''"),
    column("p", productColumns, ["description"], "''"),
  ];
  const terms = searchTermsForMessage({ message, explicitModel });
  const likeClauses = terms.map((_, index) => searchable.map((expr) => `${expr} ILIKE $${index + 2}`).join(" OR "));
  const sql = `
    SELECT p.*
    FROM products p
    WHERE 1 = 1
      ${tenantFilter}
      ${deletedFilter}
      ${activeFilter}
      ${statusFilter}
      ${likeClauses.length ? `AND (${likeClauses.map((clause) => `(${clause})`).join(" OR ")})` : ""}
    ORDER BY p.id DESC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 80, 200))}
  `;
  const params = [numberOrNull(tenantId), ...terms.map((term) => `%${term}%`)];
  const result = await db.query(sql, params);
  console.info("AI_BRAIN_V2_SQL_TRACE", {
    tenant_id: tenantId || null,
    original_text: message,
    normalized_text: normalizeArabic(message),
    explicit_model: explicitModel?.model || "",
    search_terms: terms,
    rows_returned: result.rows.length,
    first_product_ids: result.rows.slice(0, 20).map((row) => row.id),
    first_product_names: result.rows.slice(0, 20).map((row) => row.name || row.title || row.product_name || ""),
  });
  return result.rows || [];
};

const rankProducts = ({ products = [], message = "", explicitModel = null } = {}) => {
  const normalizedMessage = normalizeArabic(message);
  return asArray(products)
    .map((product) => {
      const scored = scoreProduct({ product, normalizedMessage, explicitModel });
      return {
        ...product,
        ai_brain_v2_score: scored.score,
        ai_brain_v2_reasons: scored.reasons,
      };
    })
    .sort((a, b) => Number(b.ai_brain_v2_score || 0) - Number(a.ai_brain_v2_score || 0) || Number(a.id || 0) - Number(b.id || 0));
};

const activeProductFromMemory = (memory = {}) => {
  const preferences = memory?.preferences || {};
  return text(
    preferences.active_product_id ||
    preferences.selected_product_id ||
    preferences.last_product_id ||
    memory.activeProductId ||
    memory.selectedProductId ||
    memory.last_product_id ||
    ""
  );
};

const buildBaseText = ({ intent = "", cards = [], explicitModel = null, activeProductId = "" } = {}) => {
  if (intent === "greeting") return "\u0623\u0647\u0644\u0627 \u0628\u064a\u0643. \u0627\u0628\u0639\u062a \u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0623\u0648 \u0635\u0648\u0631\u0629 \u0648\u0623\u0633\u0627\u0639\u062f\u0643.";
  if (intent === "price_objection") {
    return activeProductId
      ? "\u0641\u0627\u0647\u0645\u0643. \u0644\u0648 \u0627\u0644\u0633\u0639\u0631 \u0645\u0634 \u0645\u0646\u0627\u0633\u0628 \u0623\u0642\u062f\u0631 \u0623\u0637\u0644\u0639\u0644\u0643 \u0628\u062f\u064a\u0644 \u0623\u0642\u0631\u0628 \u0644\u0644\u0645\u064a\u0632\u0627\u0646\u064a\u0629."
      : "\u0641\u0627\u0647\u0645\u0643. \u0627\u0628\u0639\u062a \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0627\u0644\u0644\u064a \u0639\u0627\u064a\u0632\u0647 \u0648\u0623\u0634\u0648\u0641\u0644\u0643 \u0628\u062f\u064a\u0644 \u0623\u0631\u062e\u0635.";
  }
  if (cards.length) return explicitModel ? "\u062f\u064a \u0623\u0642\u0631\u0628 \u0646\u062a\u064a\u062c\u0629 \u0644\u0645\u0648\u062f\u064a\u0644 Jordan 4:" : "\u062f\u064a \u0623\u0642\u0631\u0628 \u0627\u0644\u0646\u062a\u0627\u064a\u062c \u0627\u0644\u0645\u062a\u0627\u062d\u0629:";
  if (["product_search", "more_images"].includes(intent)) return "\u0645\u0634 \u0644\u0627\u0642\u064a \u0645\u0637\u0627\u0628\u0642\u0629 \u0648\u0627\u0636\u062d\u0629. \u0627\u0628\u0639\u062a \u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0623\u0648 \u0635\u0648\u0631\u0629 \u0623\u0648\u0636\u062d.";
  return "\u062a\u062d\u062a \u0623\u0645\u0631\u0643. \u0627\u0628\u0639\u062a \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0623\u0648 \u0627\u0644\u0633\u0624\u0627\u0644 \u0627\u0644\u0644\u064a \u0645\u062d\u062a\u0627\u062c\u0647.";
};

export const generateAiBrainV2Decision = async (normalizedInbound = {}, options = {}) => {
  const channel = normalizeChannel(normalizedInbound.channel || normalizedInbound.metadata?.channel || AI_AGENT_CHANNELS.WEB_CHAT);
  const message = text(normalizedInbound.text || normalizedInbound.message_text || normalizedInbound.message || normalizedInbound.body);
  const tenantId = options.tenantId || normalizedInbound.metadata?.tenant_id || normalizedInbound.metadata?.tenantId || 1;
  const memory = options.memory || normalizedInbound.metadata?.ai_memory || {};
  const explicitModel = detectExplicitModel(message);
  const intent = classifyIntent({ message, attachments: normalizedInbound.attachments, explicitModel });
  const shouldSearch = ["product_search", "more_images", "visual_search"].includes(intent) || Boolean(explicitModel);
  const candidates = shouldSearch ? await loadCandidateProducts({ tenantId, message, explicitModel }) : [];
  const ranked = rankProducts({ products: candidates, message, explicitModel });
  const selectedProducts = ranked.filter((product) => Number(product.ai_brain_v2_score || 0) > 0).slice(0, 6);
  const productCards = normalizeProductCards(selectedProducts, { limit: 6 });
  const images = productCards
    .map((card) => ({
      id: text(card.image_id || card.image_url || card.product_id || card.id),
      url: text(card.image_url || card.url || card.image),
      image_url: text(card.image_url || card.url || card.image),
      product_id: text(card.product_id || card.id),
    }))
    .filter((image) => image.url);
  const activeProductId = text(productCards[0]?.product_id || productCards[0]?.id || activeProductFromMemory(memory));
  const responseText = buildBaseText({ intent, cards: productCards, explicitModel, activeProductId });
  const memoryUpdates = {
    ...(activeProductId ? {
      active_product_id: activeProductId,
      selected_product_id: activeProductId,
      last_product_id: activeProductId,
      last_product_cards: productCards,
    } : {}),
    last_intent: intent,
    ai_brain_version: "v2",
  };
  const actions = productCards.length ? ["view_product", "choose_size", "contact_support"] : ["contact_support"];
  const output = {
    text: responseText,
    answer: responseText,
    intent,
    detected_intent: intent,
    products: selectedProducts,
    suggested_products: productCards,
    product_cards: productCards,
    images,
    image_cards: images,
    quickReplies: [],
    quick_replies: [],
    actions,
    suggested_actions: actions,
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    active_product_id: activeProductId,
    channel_reply: normalizeOutgoingChannelReply({ channel, response: { text: responseText, product_cards: productCards, image_cards: images, suggested_actions: actions } }),
    debug: {
      source: "aiBrainV2",
      engine: "ai_brain_v2",
      legacy_called: false,
      explicit_model: explicitModel,
      ranked_candidates: ranked.slice(0, 20).map((product, index) => ({
        rank: index + 1,
        id: product.id,
        name: product.name || product.title || product.product_name || "",
        score: product.ai_brain_v2_score,
        reasons: product.ai_brain_v2_reasons,
      })),
    },
  };
  console.info("AI_BRAIN_V2_DECISION", {
    channel,
    conversation_id: text(normalizedInbound.externalConversationId || normalizedInbound.external_conversation_id || normalizedInbound.metadata?.session_id || ""),
    text_preview: message.slice(0, 160),
    intent,
    explicit_model: explicitModel?.model || "",
    products_count: selectedProducts.length,
    product_cards_count: productCards.length,
    top_product_id: productCards[0]?.product_id || productCards[0]?.id || "",
    legacy_called: false,
  });
  return output;
};

export default {
  generateAiBrainV2Decision,
};
