import db from "../database/db.js";
import { storefrontBaseUrl } from "./aiSizeAvailabilityLinkService.js";
import {
  buildClassificationAliasList,
  fetchProductClassificationGroups,
} from "./productClassificationsService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const unique = (values = []) => [...new Set(values.map(text).filter(Boolean))];

export const MESSENGER_GUIDED_SHOPPING_PREFIX = "SHOP_FLOW::";
export const MESSENGER_GUIDED_SHOPPING_TTL_MS = 30 * 60 * 1000;

const FLOW_STEPS = ["gender", "product_type", "grade", "size"];
const MAX_OPTION_BUTTONS = 11;
const GROUP_LABELS = {
  gender: "القسم",
  product_type: "نوع المنتج",
  grade: "الجودة",
  size: "المقاس",
};

const FALLBACK_OPTION_LABELS = {
  men: "رجالي",
  male: "رجالي",
  women: "حريمي",
  female: "حريمي",
  kids: "أطفال",
  children: "أطفال",
  sneakers: "سنيكرز",
  sneaker: "سنيكرز",
  shoes: "أحذية",
  crocs: "كروكس",
  slippers: "سليبرز",
  bags: "شنط",
  mirror: "ميرور أوريجنال",
  original: "أوريجنال",
  egyptian: "مصري",
  vietnamese_import: "مستورد فيتنامي",
  mirror_original: "ميرور أوريجنال",
  local: "محلي",
  premium: "بريميوم",
};

const HIDDEN_FACET_VALUES = new Set(["unknown", "uncategorized", "not_set", "not set", "غير محدد"]);
const PREFERRED_GENDER_ORDER = { men: 0, male: 0, women: 1, female: 1, kids: 2, children: 2 };

export const normalizeMessengerShoppingText = (value = "") =>
  lower(value)
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ٟـ]/g, "")
    .replace(/[؟?,.;:!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const isMessengerShoppingStartIntent = (message = "") => {
  const normalized = normalizeMessengerShoppingText(message);
  if (!normalized) return false;
  if (/^(ابدأ|ابدا)?\s*(التسوق|تسوق)$/.test(normalized)) return true;
  if (/^(المنتجات|الاقسام|الكاتالوج|كاتالوج)$/.test(normalized)) return true;
  if (/^(السلام عليكم|سلام|هاي|هلو|hello|hi)$/.test(normalized)) return true;
  return /(عايز|عاوزه|عايزه|محتاج).*(اشتري|اشترى|اتسوق|منتج)/.test(normalized);
};

export const buildMessengerShoppingPayload = (action, field = "", value = "") =>
  `${MESSENGER_GUIDED_SHOPPING_PREFIX}${[action, field, value].map((part) => encodeURIComponent(text(part))).join("::")}`;

export const parseMessengerShoppingPayload = (payload = "") => {
  const safePayload = text(payload);
  if (!safePayload.startsWith(MESSENGER_GUIDED_SHOPPING_PREFIX)) return null;
  const rawParts = safePayload.slice(MESSENGER_GUIDED_SHOPPING_PREFIX.length).split("::");
  try {
    const [action = "", field = "", value = ""] = rawParts.map((part) => decodeURIComponent(part || ""));
    if (!action) return { action: "invalid", field: "", value: "" };
    return { action, field, value };
  } catch {
    return { action: "invalid", field: "", value: "" };
  }
};

export const buildMessengerGuidedShoppingUrl = (selections = {}, { baseUrl = storefrontBaseUrl() } = {}) => {
  const params = new URLSearchParams();
  if (selections.gender) params.set("gender", selections.gender);
  if (selections.product_type) params.set("type", selections.product_type);
  if (selections.grade) params.set("quality", selections.grade);
  if (selections.size) params.set("size", selections.size);
  params.set("inStock", "1");
  params.set("v", "6");
  return `${text(baseUrl).replace(/\/+$/g, "")}/share/available?${params.toString().replace(/\+/g, "%20")}`;
};

const optionLabel = (value = "", option = {}) =>
  text(option.label_ar || option.name_ar || option.label_en || option.name_en || FALLBACK_OPTION_LABELS[lower(value)] || value);

const normalizeAliases = (values = []) => unique(values.map((value) => normalizeMessengerShoppingText(value)));

const optionAliases = (option = {}) => normalizeAliases([
  ...buildClassificationAliasList(option),
  option.value,
  option.label_ar,
  option.label_en,
]);

const optionMatchesRawValue = (option = {}, rawValue = "") => {
  const raw = normalizeMessengerShoppingText(rawValue);
  if (!raw) return false;
  return optionAliases(option).some((alias) => alias === raw || (alias.length >= 3 && (raw.includes(alias) || alias.includes(raw))));
};

const optionMatchesInput = (option = {}, input = "") => {
  const normalized = normalizeMessengerShoppingText(input);
  if (!normalized) return false;
  return optionAliases(option).some((alias) => alias === normalized) || normalizeMessengerShoppingText(option.title) === normalized;
};

const mapRawFacetValuesToOptions = ({ values = [], configuredOptions = [], step = "" } = {}) => {
  const mapped = [];
  for (const rawValue of unique(values)) {
    const configured = configuredOptions.find((option) => optionMatchesRawValue(option, rawValue));
    const value = text(configured?.value || rawValue);
    const key = lower(value);
    if (!value || HIDDEN_FACET_VALUES.has(key) || mapped.some((item) => lower(item.value) === key)) continue;
    mapped.push({
      value,
      title: step === "size" ? value : optionLabel(value, configured),
      aliases: configured ? optionAliases(configured) : normalizeAliases([value, FALLBACK_OPTION_LABELS[key]]),
      sort_order: Number(configured?.sort_order ?? configured?.sortOrder ?? 9999),
    });
  }
  return mapped.sort((left, right) => {
    if (step === "size") {
      const leftNumber = Number.parseFloat(left.value);
      const rightNumber = Number.parseFloat(right.value);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    }
    if (step === "gender") {
      const leftOrder = PREFERRED_GENDER_ORDER[lower(left.value)] ?? left.sort_order;
      const rightOrder = PREFERRED_GENDER_ORDER[lower(right.value)] ?? right.sort_order;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
    return left.title.localeCompare(right.title, "ar", { numeric: true, sensitivity: "base" });
  });
};

const nextStep = (step = "") => FLOW_STEPS[FLOW_STEPS.indexOf(step) + 1] || "complete";
const previousStep = (step = "") => {
  if (step === "complete") return "size";
  return FLOW_STEPS[Math.max(0, FLOW_STEPS.indexOf(step) - 1)] || "gender";
};

const trimSelectionsForStep = (selections = {}, step = "gender") => {
  const stopIndex = FLOW_STEPS.indexOf(step);
  return FLOW_STEPS.reduce((result, field, index) => {
    if (index < stopIndex && text(selections[field])) result[field] = text(selections[field]);
    return result;
  }, {});
};

const flowPrompt = ({ step = "gender", selections = {} } = {}) => {
  if (step === "gender") {
    return "أهلاً بيك في M1 Store 👋\nخلّيني أوصلك للمنتج المناسب بسرعة.\nاختار القسم:";
  }
  if (step === "product_type") return "تمام ✅\nاختار نوع المنتج:";
  if (step === "grade") return "ممتاز، اختار الجودة المناسبة:";
  if (step === "size") return `آخر خطوة 👌\nاختار المقاس المتوفر${selections.grade ? ` في ${FALLBACK_OPTION_LABELS[lower(selections.grade)] || selections.grade}` : ""}:`;
  return "اختار من الأزرار المتاحة:";
};

const navigationQuickReplies = ({ includeBack = true } = {}) => [
  ...(includeBack ? [{ content_type: "text", title: "↩️ رجوع", payload: buildMessengerShoppingPayload("back") }] : []),
  { content_type: "text", title: "🔄 ابدأ من جديد", payload: buildMessengerShoppingPayload("restart") },
];

export const buildMessengerShoppingQuickReplies = ({ step = "gender", options = [] } = {}) => [
  ...options.slice(0, MAX_OPTION_BUTTONS).map((option) => ({
    content_type: "text",
    title: text(option.title || option.value).slice(0, 20),
    payload: buildMessengerShoppingPayload("select", step, option.value),
  })),
  ...navigationQuickReplies({ includeBack: step !== "gender" }),
].slice(0, 13);

let schemaPromise = null;
const ensureSessionSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS messenger_guided_shopping_sessions (
        tenant_id BIGINT NOT NULL,
        conversation_id TEXT NOT NULL,
        step VARCHAR(40) NOT NULL DEFAULT 'gender',
        selections JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 minutes'),
        PRIMARY KEY (tenant_id, conversation_id)
      )
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
};

let catalogSchemaPromise = null;
const catalogSchema = async () => {
  if (!catalogSchemaPromise) {
    catalogSchemaPromise = db.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('products', 'product_variants', 'product_audiences')
    `).then((result) => {
      const tables = new Map();
      result.rows.forEach((row) => {
        if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
        tables.get(row.table_name).add(row.column_name);
      });
      return tables;
    }).catch((error) => {
      catalogSchemaPromise = null;
      throw error;
    });
  }
  return catalogSchemaPromise;
};

const defaultRepository = {
  async getSession({ tenantId, conversationId }) {
    await ensureSessionSchema();
    const result = await db.query(
      `SELECT step, selections, updated_at, expires_at
       FROM messenger_guided_shopping_sessions
       WHERE tenant_id = $1 AND conversation_id = $2 AND expires_at > CURRENT_TIMESTAMP`,
      [tenantId, conversationId]
    );
    return result.rows[0] || null;
  },

  async saveSession({ tenantId, conversationId, step, selections }) {
    await ensureSessionSchema();
    const ttlMinutes = Math.max(1, Math.ceil(MESSENGER_GUIDED_SHOPPING_TTL_MS / 60000));
    await db.query(
      `INSERT INTO messenger_guided_shopping_sessions (tenant_id, conversation_id, step, selections, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP + ($5::text || ' minutes')::interval)
       ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
         step = EXCLUDED.step,
         selections = EXCLUDED.selections,
         updated_at = CURRENT_TIMESTAMP,
         expires_at = EXCLUDED.expires_at`,
      [tenantId, conversationId, step, JSON.stringify(selections || {}), String(ttlMinutes)]
    );
  },

  async clearSession({ tenantId, conversationId }) {
    await ensureSessionSchema();
    await db.query(
      `DELETE FROM messenger_guided_shopping_sessions WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantId, conversationId]
    );
  },

  async listOptions({ tenantId, step, selections = {} }) {
    const schema = await catalogSchema();
    const productColumns = schema.get("products") || new Set();
    const variantColumns = schema.get("product_variants") || new Set();
    const audienceColumns = schema.get("product_audiences") || new Set();
    if (!productColumns.has("id") || !productColumns.has("tenant_id")) return [];

    const params = [tenantId];
    const where = ["p.tenant_id = $1"];
    if (productColumns.has("deleted_at")) where.push("p.deleted_at IS NULL");
    if (productColumns.has("is_active")) where.push("p.is_active IS DISTINCT FROM FALSE");
    if (productColumns.has("status")) where.push("LOWER(COALESCE(p.status::text, 'active')) NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')");
    ["storefront_visible", "is_storefront_visible", "visible_on_storefront", "show_in_storefront", "is_visible"].forEach((column) => {
      if (productColumns.has(column)) where.push(`LOWER(COALESCE(p.${column}::text, 'true')) NOT IN ('false', '0', 'no', 'hidden', 'inactive')`);
    });

    const variantActive = [
      variantColumns.has("is_active") ? "pv_filter.is_active IS DISTINCT FROM FALSE" : "TRUE",
      variantColumns.has("deleted_at") ? "pv_filter.deleted_at IS NULL" : "TRUE",
      variantColumns.has("stock") ? "COALESCE(pv_filter.stock, 0) > 0" : "FALSE",
    ].join(" AND ");
    const hasVariantStock = variantColumns.has("product_id") && variantColumns.has("stock")
      ? `EXISTS (SELECT 1 FROM product_variants pv_filter WHERE pv_filter.product_id = p.id AND ${variantActive})`
      : "FALSE";
    const hasProductStock = productColumns.has("stock") ? "COALESCE(p.stock, 0) > 0" : "FALSE";
    where.push(`(${hasProductStock} OR ${hasVariantStock})`);

    const groups = await fetchProductClassificationGroups({ includeInactive: false }).catch(() => []);
    const groupMap = new Map(groups.map((group) => [text(group.key), group]));
    const aliasesFor = (field, value) => {
      const configured = (groupMap.get(field)?.options || []).find((option) => optionMatchesRawValue(option, value));
      return normalizeAliases(configured ? [...buildClassificationAliasList(configured), value] : [value]);
    };

    const addFieldFilter = (field, value) => {
      if (!text(value)) return;
      const aliases = aliasesFor(field, value);
      if (!aliases.length) return;
      params.push(aliases);
      const parameter = `$${params.length}::text[]`;
      if (field === "gender") {
        const productGender = productColumns.has("gender")
          ? `LOWER(TRIM(COALESCE(p.gender::text, ''))) = ANY(${parameter})`
          : "FALSE";
        const audienceGender = audienceColumns.has("product_id") && audienceColumns.has("audience")
          ? `EXISTS (SELECT 1 FROM product_audiences pa_match WHERE pa_match.product_id = p.id AND LOWER(TRIM(COALESCE(pa_match.audience::text, ''))) = ANY(${parameter}))`
          : "FALSE";
        where.push(`(${productGender} OR ${audienceGender})`);
        return;
      }
      const column = field === "product_type" ? "product_type" : "grade";
      if (!productColumns.has(column)) return;
      where.push(`EXISTS (SELECT 1 FROM unnest(${parameter}) AS selected(value) WHERE LOWER(TRIM(COALESCE(p.${column}::text, ''))) = selected.value OR LOWER(TRIM(COALESCE(p.${column}::text, ''))) LIKE ('%' || selected.value || '%'))`);
    };

    if (step !== "gender") addFieldFilter("gender", selections.gender);
    if (["grade", "size"].includes(step)) addFieldFilter("product_type", selections.product_type);
    if (step === "size") addFieldFilter("grade", selections.grade);

    let rows;
    if (step === "size") {
      if (!variantColumns.has("product_id") || !variantColumns.has("size") || !variantColumns.has("stock")) return [];
      const active = [
        variantColumns.has("is_active") ? "pv.is_active IS DISTINCT FROM FALSE" : "TRUE",
        variantColumns.has("deleted_at") ? "pv.deleted_at IS NULL" : "TRUE",
        "COALESCE(pv.stock, 0) > 0",
      ].join(" AND ");
      const result = await db.query(
        `SELECT DISTINCT TRIM(COALESCE(pv.size::text, '')) AS value
         FROM products p
         JOIN product_variants pv ON pv.product_id = p.id
         WHERE ${where.join(" AND ")} AND ${active} AND TRIM(COALESCE(pv.size::text, '')) <> ''`,
        params
      );
      rows = result.rows;
    } else if (step === "gender") {
      const selects = [];
      if (productColumns.has("gender")) {
        selects.push(`SELECT DISTINCT TRIM(COALESCE(p.gender::text, '')) AS value FROM products p WHERE ${where.join(" AND ")} AND TRIM(COALESCE(p.gender::text, '')) <> ''`);
      }
      if (audienceColumns.has("product_id") && audienceColumns.has("audience")) {
        selects.push(`SELECT DISTINCT TRIM(COALESCE(pa.audience::text, '')) AS value FROM products p JOIN product_audiences pa ON pa.product_id = p.id WHERE ${where.join(" AND ")} AND TRIM(COALESCE(pa.audience::text, '')) <> ''`);
      }
      if (!selects.length) return [];
      const result = await db.query(selects.join(" UNION "), params);
      rows = result.rows;
    } else {
      const column = step === "product_type" ? "product_type" : "grade";
      if (!productColumns.has(column)) return [];
      const result = await db.query(
        `SELECT DISTINCT TRIM(COALESCE(p.${column}::text, '')) AS value
         FROM products p
         WHERE ${where.join(" AND ")} AND TRIM(COALESCE(p.${column}::text, '')) <> ''`,
        params
      );
      rows = result.rows;
    }

    return mapRawFacetValuesToOptions({
      values: rows.map((row) => row.value),
      configuredOptions: groupMap.get(step)?.options || [],
      step,
    });
  },

  async countMatches({ tenantId, selections = {} }) {
    const schema = await catalogSchema();
    const productColumns = schema.get("products") || new Set();
    const variantColumns = schema.get("product_variants") || new Set();
    const audienceColumns = schema.get("product_audiences") || new Set();
    if (!productColumns.has("id") || !productColumns.has("tenant_id")) return 0;
    const params = [tenantId];
    const where = ["p.tenant_id = $1"];
    if (productColumns.has("deleted_at")) where.push("p.deleted_at IS NULL");
    if (productColumns.has("is_active")) where.push("p.is_active IS DISTINCT FROM FALSE");
    if (productColumns.has("status")) where.push("LOWER(COALESCE(p.status::text, 'active')) NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')");
    ["storefront_visible", "is_storefront_visible", "visible_on_storefront", "show_in_storefront", "is_visible"].forEach((column) => {
      if (productColumns.has(column)) where.push(`LOWER(COALESCE(p.${column}::text, 'true')) NOT IN ('false', '0', 'no', 'hidden', 'inactive')`);
    });
    const groups = await fetchProductClassificationGroups({ includeInactive: false }).catch(() => []);
    const groupMap = new Map(groups.map((group) => [text(group.key), group]));
    const aliasesFor = (field, value) => {
      const configured = (groupMap.get(field)?.options || []).find((option) => optionMatchesRawValue(option, value));
      return normalizeAliases(configured ? [...buildClassificationAliasList(configured), value] : [value]);
    };
    const simpleFilter = (column, field, value, contains = false) => {
      if (!text(value) || !productColumns.has(column)) return;
      params.push(aliasesFor(field, value));
      const parameter = `$${params.length}::text[]`;
      where.push(contains
        ? `EXISTS (SELECT 1 FROM unnest(${parameter}) AS selected(value) WHERE LOWER(TRIM(COALESCE(p.${column}::text, ''))) = selected.value OR LOWER(TRIM(COALESCE(p.${column}::text, ''))) LIKE ('%' || selected.value || '%'))`
        : `LOWER(TRIM(COALESCE(p.${column}::text, ''))) = ANY(${parameter})`);
    };
    if (text(selections.gender)) {
      params.push(aliasesFor("gender", selections.gender));
      const parameter = `$${params.length}::text[]`;
      const productGender = productColumns.has("gender")
        ? `LOWER(TRIM(COALESCE(p.gender::text, ''))) = ANY(${parameter})`
        : "FALSE";
      const audienceGender = audienceColumns.has("product_id") && audienceColumns.has("audience")
        ? `EXISTS (SELECT 1 FROM product_audiences pa_count WHERE pa_count.product_id = p.id AND LOWER(TRIM(COALESCE(pa_count.audience::text, ''))) = ANY(${parameter}))`
        : "FALSE";
      where.push(`(${productGender} OR ${audienceGender})`);
    }
    simpleFilter("product_type", "product_type", selections.product_type, true);
    simpleFilter("grade", "grade", selections.grade, true);
    if (text(selections.size) && variantColumns.has("product_id") && variantColumns.has("size") && variantColumns.has("stock")) {
      params.push(lower(selections.size));
      const active = [
        variantColumns.has("is_active") ? "pv_count.is_active IS DISTINCT FROM FALSE" : "TRUE",
        variantColumns.has("deleted_at") ? "pv_count.deleted_at IS NULL" : "TRUE",
        "COALESCE(pv_count.stock, 0) > 0",
      ].join(" AND ");
      where.push(`EXISTS (SELECT 1 FROM product_variants pv_count WHERE pv_count.product_id = p.id AND ${active} AND LOWER(TRIM(COALESCE(pv_count.size::text, ''))) = $${params.length})`);
    }
    const result = await db.query(`SELECT COUNT(DISTINCT p.id)::int AS count FROM products p WHERE ${where.join(" AND ")}`, params);
    return Number(result.rows[0]?.count || 0);
  },
};

const resolveRepository = (repository = {}) => ({ ...defaultRepository, ...repository });

const sendFlowStep = async ({ repository, sendReply, tenantId, conversationId, step, selections, reason }) => {
  const options = await repository.listOptions({ tenantId, step, selections });
  if (!options.length) {
    const fallbackStep = step === "gender" ? "gender" : previousStep(step);
    const fallbackSelections = trimSelectionsForStep(selections, fallbackStep);
    await sendReply({
      replyText: `للأسف مفيش اختيارات متاحة حاليًا في ${GROUP_LABELS[step] || "الخطوة دي"}. جرّب اختيار تاني.`,
      quickReplies: navigationQuickReplies({ includeBack: step !== "gender" }),
      detectedIntent: "messenger_guided_shopping_no_options",
      metadata: { guided_shopping: true, guided_shopping_step: step, force_reply_text_passthrough: true },
    });
    await repository.saveSession({ tenantId, conversationId, step: fallbackStep, selections: fallbackSelections });
    return { handled: true, sent: true, reason: "messenger_guided_shopping_no_options" };
  }
  await sendReply({
    replyText: flowPrompt({ step, selections }),
    quickReplies: buildMessengerShoppingQuickReplies({ step, options }),
    detectedIntent: "messenger_guided_shopping_step",
    metadata: { guided_shopping: true, guided_shopping_step: step, guided_shopping_reason: reason, force_reply_text_passthrough: true },
  });
  await repository.saveSession({ tenantId, conversationId, step, selections });
  return { handled: true, sent: true, reason: `messenger_guided_shopping_${step}` };
};

export const handleMessengerGuidedShopping = async ({
  tenantId = null,
  conversationId = "",
  messageText = "",
  quickReplyPayload = "",
  postbackPayload = "",
  sendReply = async () => null,
  repository: repositoryOverride = {},
  baseUrl = "",
} = {}) => {
  const safeTenantId = Number(tenantId || 0) || null;
  const safeConversationId = text(conversationId);
  if (!safeTenantId || !safeConversationId) return { handled: false, reason: "messenger_guided_shopping_missing_identity" };
  const repository = resolveRepository(repositoryOverride);
  const rawPayload = text(quickReplyPayload || postbackPayload);
  const parsedPayload = parseMessengerShoppingPayload(rawPayload);
  const activeSession = await repository.getSession({ tenantId: safeTenantId, conversationId: safeConversationId });
  const normalizedMessage = normalizeMessengerShoppingText(messageText);

  if (!parsedPayload && !activeSession && !isMessengerShoppingStartIntent(messageText)) {
    return { handled: false, reason: "messenger_guided_shopping_not_triggered" };
  }

  if (/^(الغاء|الغي|انهاء|خدمه العملاء|موظف|كلم موظف)$/.test(normalizedMessage)) {
    await repository.clearSession({ tenantId: safeTenantId, conversationId: safeConversationId });
    return { handled: false, reason: "messenger_guided_shopping_handoff" };
  }

  let action = parsedPayload?.action || (!activeSession ? "start" : "");
  if (!parsedPayload && activeSession && /^(ابدأ|ابدا) من جديد$/.test(normalizedMessage)) action = "restart";
  if (!parsedPayload && activeSession && /^(رجوع|ارجع)$/.test(normalizedMessage)) action = "back";
  if (["start", "restart"].includes(action) || (!parsedPayload && !activeSession)) {
    return sendFlowStep({
      repository,
      sendReply,
      tenantId: safeTenantId,
      conversationId: safeConversationId,
      step: "gender",
      selections: {},
      reason: action || "natural_language_start",
    });
  }

  if (action === "invalid") {
    return sendFlowStep({
      repository,
      sendReply,
      tenantId: safeTenantId,
      conversationId: safeConversationId,
      step: activeSession?.step || "gender",
      selections: activeSession?.selections || {},
      reason: "invalid_payload",
    });
  }

  if (action === "cancel") {
    await repository.clearSession({ tenantId: safeTenantId, conversationId: safeConversationId });
    await sendReply({
      replyText: "تم إلغاء مسار التسوق. ابعت سؤالك في أي وقت وأنا تحت أمرك.",
      quickReplies: [],
      detectedIntent: "messenger_guided_shopping_cancelled",
      metadata: { guided_shopping: true, force_reply_text_passthrough: true },
    });
    return { handled: true, sent: true, reason: "messenger_guided_shopping_cancelled" };
  }

  const currentStep = activeSession?.step || "gender";
  const currentSelections = activeSession?.selections && typeof activeSession.selections === "object" ? activeSession.selections : {};

  if (action === "back") {
    const targetStep = previousStep(currentStep);
    return sendFlowStep({
      repository,
      sendReply,
      tenantId: safeTenantId,
      conversationId: safeConversationId,
      step: targetStep,
      selections: trimSelectionsForStep(currentSelections, targetStep),
      reason: "back",
    });
  }

  if (currentStep === "complete" && !parsedPayload) {
    return { handled: false, reason: "messenger_guided_shopping_completed" };
  }

  const options = await repository.listOptions({ tenantId: safeTenantId, step: currentStep, selections: currentSelections });
  let selectedValue = "";
  if (action === "select" && parsedPayload?.field === currentStep) {
    selectedValue = text(parsedPayload.value);
  } else if (!parsedPayload && normalizedMessage) {
    selectedValue = text(options.find((option) => optionMatchesInput(option, messageText))?.value || "");
  }

  const selectedOption = options.find((option) => lower(option.value) === lower(selectedValue));
  if (!selectedOption) {
    if (!parsedPayload && (normalizedMessage.length > 30 || /[؟?]/.test(text(messageText)))) {
      await repository.clearSession({ tenantId: safeTenantId, conversationId: safeConversationId });
      return { handled: false, reason: "messenger_guided_shopping_free_text_exit" };
    }
    await sendReply({
      replyText: "من فضلك اختار من الأزرار المتاحة، أو اكتب «ابدأ من جديد».",
      quickReplies: buildMessengerShoppingQuickReplies({ step: currentStep, options }),
      detectedIntent: "messenger_guided_shopping_invalid_selection",
      metadata: { guided_shopping: true, guided_shopping_step: currentStep, force_reply_text_passthrough: true },
    });
    return { handled: true, sent: true, reason: "messenger_guided_shopping_invalid_selection" };
  }

  const selections = { ...currentSelections, [currentStep]: selectedOption.value };
  const targetStep = nextStep(currentStep);
  if (targetStep !== "complete") {
    return sendFlowStep({
      repository,
      sendReply,
      tenantId: safeTenantId,
      conversationId: safeConversationId,
      step: targetStep,
      selections,
      reason: `selected_${currentStep}`,
    });
  }

  const [matches, url] = await Promise.all([
    repository.countMatches({ tenantId: safeTenantId, selections }),
    Promise.resolve(buildMessengerGuidedShoppingUrl(selections, { baseUrl: baseUrl || storefrontBaseUrl() })),
  ]);
  const summary = [
    FALLBACK_OPTION_LABELS[lower(selections.gender)] || selections.gender,
    FALLBACK_OPTION_LABELS[lower(selections.product_type)] || selections.product_type,
    FALLBACK_OPTION_LABELS[lower(selections.grade)] || selections.grade,
    `مقاس ${selections.size}`,
  ].filter(Boolean).join(" • ");
  const resultLine = matches > 0
    ? `لقيتلك ${matches.toLocaleString("ar-EG-u-nu-latn")} منتج متاح ✅`
    : "الرابط جاهز، ولو المخزون اتغير هتظهر لك النتائج المتاحة فورًا.";
  await sendReply({
    replyText: `${resultLine}\n${summary}\n\nافتح كل المنتجات المطابقة من هنا:\n${url}`,
    quickReplies: navigationQuickReplies({ includeBack: true }),
    detectedIntent: "messenger_guided_shopping_result",
    metadata: {
      guided_shopping: true,
      guided_shopping_step: "complete",
      guided_shopping_filters: selections,
      guided_shopping_matches: matches,
      guided_shopping_url: url,
      force_reply_text_passthrough: true,
    },
  });
  await repository.saveSession({ tenantId: safeTenantId, conversationId: safeConversationId, step: "complete", selections });
  return { handled: true, sent: true, reason: "messenger_guided_shopping_result", url, matches, selections };
};

export default {
  buildMessengerGuidedShoppingUrl,
  buildMessengerShoppingPayload,
  buildMessengerShoppingQuickReplies,
  handleMessengerGuidedShopping,
  isMessengerShoppingStartIntent,
  parseMessengerShoppingPayload,
};
