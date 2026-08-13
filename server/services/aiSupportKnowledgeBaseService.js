// Smart Support Knowledge Base — THE canonical source for customer-facing BUSINESS SUPPORT FACTS.
// ---------------------------------------------------------------------------------------------
// Operator surface: "قاعدة معرفة الدعم الذكي" (src/modules/aiSupport/pages/AiSupportKnowledgeBase.jsx)
// Storage:          website_settings.settings["ai_support_knowledge_base"], tenant-scoped (one row per tenant)
// API:              GET/PUT/DELETE /api/ai-support/knowledge-base (server/routes/aiSupport.js)
//
// This module owns THREE things and nothing else:
//   1. the canonical field list + normalization (shared by the route, so there is exactly ONE schema),
//   2. deterministic INTENT → canonical FIELD routing for customer support questions,
//   3. deterministic rendering of the grounded support answer.
//
// Architectural rule this enforces:
//   PRODUCT FACTS  → ERP catalog / variants / inventory
//   SUPPORT FACTS  → this Knowledge Base (never the LLM, never conversation history)
// The LLM may shape wording; it may NEVER invent or replace an address, phone, hours, payment method,
// shipping/return policy or warranty fact. When a canonical field is EMPTY we say so — we never fabricate.

import db from "../database/db.js";
import { getWebsiteSettings } from "./liveActivityService.js";

export const AI_KB_SETTINGS_KEY = "ai_support_knowledge_base";

const toText = (value, fallback = "") => String(value ?? fallback).trim();

export const AI_KB_DEFAULTS = Object.freeze({
  store_name: "",
  phone: "",
  whatsapp: "",
  // Canonical customer-facing LOCATION fields (added with the support-fact grounding layer). The operator
  // edits these on the SAME Knowledge Base page as phone/hours/policies — there is no second store-info source.
  store_address: "",
  maps_url: "",
  branch_working_hours: "",
  payment_methods: "",
  shipping_policy: "",
  return_exchange_policy: "",
  delivery_notes: "",
  warranty_notes: "",
  human_support_message: "",
  brand_tone_instructions: "",
  personality_settings: "Egyptian Arabic professional sales agent for Tiger Store. Friendly, confident, respectful, concise, and human.",
  allowed_phrases: "تمام، تحت أمرك، بص، مظبوء خليني أظبطهولك، المقاس ده بيتحرك بسرعة",
  forbidden_phrases: "أنا مساعد ذكي، يسعدني مساعدتك، برجاء المحاولة لاحقا، لا أملك معلومات كافية",
  sales_scripts: "افهم احتياج العميل الأول، رشح من المنتجات المتاحة، اذكر السعر والتوفر، وضح القيمة، ثم اسأل سؤال واحد مناسب.",
  objection_replies: [
    "السعر غالي: فاهمك، السعر واضح على الموديل والمتاح منه. لو الميزانية أقل أقدر أشوفلك اختيار أرخص.",
    "فيه خصم؟ الخصومات المتاحة هأكدها من السيستم، ولو محتاج خصم خاص بحولك للإدارة.",
    "أصلي ولا كوبي؟ هقولك التصنيف المتسجل عندنا بوضوح من غير مبالغة.",
    "الدفع عند الاستلام: لو متاح في سياسة الدفع هنأكدلك، ولو مش واضح بحولك للدعم.",
  ].join("\n"),
  tone_strength: "medium",
  discount_rules: "لا توعد بخصم غير مسجل. الخصم الخاص أو آخر سعر يحتاج تحويل للإدارة.",
  handoff_rules: "حول للإدارة عند الغضب، خصم خاص، مشكلة دفع أو توصيل، استبدال/استرجاع، تعارض مخزون، منطقة غير مدعومة، أو ثقة منخفضة.",
  order_draft_approval: "create_after_clear_buying_intent_and_complete_details",
});

const normalizePhone = (value = "") => toText(value).replace(/[\s().-]/g, "");

export const validateOptionalPhone = (value = "", label = "Phone") => {
  const text = normalizePhone(value);
  if (!text) return "";
  if (!/^\+?[0-9]{7,15}$/.test(text)) {
    const error = new Error(`${label} must be 7-15 digits and may start with +`);
    error.status = 400;
    throw error;
  }
  return text;
};

// A maps/location link is only accepted as an http(s) URL. Anything else is rejected rather than stored,
// so the AI can never read back a malformed "link" and present it to a customer as a real location.
export const validateOptionalUrl = (value = "", label = "URL") => {
  const text = toText(value);
  if (!text) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    parsed = null;
  }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error(`${label} must be a valid http(s) link`);
    error.status = 400;
    throw error;
  }
  return parsed.toString();
};

export const normalizeKnowledgeBase = (payload = {}) => ({
  store_name: toText(payload.store_name).slice(0, 160),
  phone: validateOptionalPhone(payload.phone, "Public phone"),
  whatsapp: validateOptionalPhone(payload.whatsapp, "WhatsApp number"),
  store_address: toText(payload.store_address || payload.address).slice(0, 2000),
  maps_url: validateOptionalUrl(payload.maps_url || payload.location_url, "Maps link"),
  branch_working_hours: toText(payload.branch_working_hours).slice(0, 4000),
  working_hours: toText(payload.branch_working_hours || payload.working_hours).slice(0, 4000),
  payment_methods: toText(payload.payment_methods).slice(0, 4000),
  shipping_policy: toText(payload.shipping_policy).slice(0, 6000),
  return_exchange_policy: toText(payload.return_exchange_policy).slice(0, 6000),
  delivery_notes: toText(payload.delivery_notes).slice(0, 4000),
  warranty_notes: toText(payload.warranty_notes).slice(0, 4000),
  human_support_message: toText(payload.human_support_message).slice(0, 2000),
  brand_tone_instructions: toText(payload.brand_tone_instructions).slice(0, 3000),
  personality_settings: toText(payload.personality_settings).slice(0, 3000),
  allowed_phrases: toText(payload.allowed_phrases).slice(0, 3000),
  forbidden_phrases: toText(payload.forbidden_phrases).slice(0, 3000),
  sales_scripts: toText(payload.sales_scripts).slice(0, 6000),
  objection_replies: toText(payload.objection_replies).slice(0, 6000),
  tone_strength: ["low", "medium", "high"].includes(toText(payload.tone_strength).toLowerCase())
    ? toText(payload.tone_strength).toLowerCase()
    : "medium",
  discount_rules: toText(payload.discount_rules).slice(0, 4000),
  handoff_rules: toText(payload.handoff_rules).slice(0, 4000),
  order_draft_approval: toText(payload.order_draft_approval || "create_after_clear_buying_intent_and_complete_details").slice(0, 120),
});

export const publicKnowledgeBase = (settings = {}) => ({
  ...AI_KB_DEFAULTS,
  ...(settings?.[AI_KB_SETTINGS_KEY] && typeof settings[AI_KB_SETTINGS_KEY] === "object" ? settings[AI_KB_SETTINGS_KEY] : {}),
});

// ---- Intent → canonical Knowledge Base field routing -------------------------------------------------
// DETERMINISTIC. Runs on the customer's CURRENT message only (never on history), so a stale product topic
// can never suppress an explicit support question. Ordered most-specific-first: "رقم الواتساب" must resolve
// to WHATSAPP (not the generic CONTACT phone), "سياسة الشحن" to SHIPPING (not the generic payment/policy).
export const SUPPORT_FACT_INTENTS = Object.freeze({
  RETURN_EXCHANGE_POLICY: "RETURN_EXCHANGE_POLICY",
  WARRANTY: "WARRANTY",
  SHIPPING_POLICY: "SHIPPING_POLICY",
  PAYMENT_METHODS: "PAYMENT_METHODS",
  STORE_WHATSAPP: "STORE_WHATSAPP",
  STORE_HOURS: "STORE_HOURS",
  STORE_LOCATION: "STORE_LOCATION",
  STORE_CONTACT: "STORE_CONTACT",
  HUMAN_HANDOFF: "HUMAN_HANDOFF",
});

const normalizeKbText = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// [intent, substring terms, regex patterns]. Terms are matched on the normalized text.
const SUPPORT_FACT_RULES = [
  [SUPPORT_FACT_INTENTS.RETURN_EXCHANGE_POLICY,
    ["استبدال", "استرجاع", "ارجاع", "مرتجع", "return policy", "refund", "exchange policy"], []],
  [SUPPORT_FACT_INTENTS.WARRANTY,
    ["ضمان", "جارانتي", "warranty", "guarantee"], []],
  [SUPPORT_FACT_INTENTS.SHIPPING_POLICY,
    ["الشحن", "شحن", "التوصيل", "توصيل", "دليفري", "delivery", "shipping"], []],
  [SUPPORT_FACT_INTENTS.PAYMENT_METHODS,
    ["طرق الدفع", "طريقه الدفع", "الدفع", "بدفع", "ادفع", "فيزا", "انستاباي", "فودافون كاش", "payment", "pay online", "cash on delivery"], []],
  [SUPPORT_FACT_INTENTS.STORE_WHATSAPP,
    ["واتس", "whatsapp", "whats app"], []],
  [SUPPORT_FACT_INTENTS.STORE_HOURS,
    ["مواعيد", "معاد", "ميعاد", "ساعات العمل", "بتفتحوا", "بتقفلوا", "بتفتح", "بتقفل", "working hours", "opening hours"], []],
  [SUPPORT_FACT_INTENTS.STORE_LOCATION,
    ["عنوان", "عناوين", "لوكيشن", "location", "address", "مكانكم", "مكانكو", "خريطه", "جوجل ماب", "google map", "maps", "الفروع", "فروعكم"],
    // NOTE: JS \b is ASCII-only and never matches at an Arabic letter boundary — use explicit space/anchors.
    [/(^|\s)فين\s+(المحل|المتجر|الفرع|المكان|محلكم|متجركم|فرعكم)(\s|$)/, /(^|\s)(انتم|انتو|المحل|المتجر|الفرع|حضرتكم)\s+فين(\s|$)/]],
  [SUPPORT_FACT_INTENTS.STORE_CONTACT,
    ["رقمكم", "ارقامكم", "نمرتكم", "رقم التليفون", "رقم الهاتف", "التليفون", "الموبايل", "phone number", "contact number"], []],
  [SUPPORT_FACT_INTENTS.HUMAN_HANDOFF,
    ["خدمه العملاء", "عايز اكلم حد", "عاوز اكلم حد", "حولني لموظف", "كلمني موظف", "human agent", "talk to a human"], []],
];

export const detectSupportFactIntent = (message = "") => {
  const text = normalizeKbText(message);
  if (!text) return "";
  for (const [intent, terms, patterns] of SUPPORT_FACT_RULES) {
    if (terms.some((term) => text.includes(normalizeKbText(term)))) return intent;
    if (patterns.some((pattern) => pattern.test(text))) return intent;
  }
  return "";
};

// ---- Canonical load (tenant-scoped) ------------------------------------------------------------------
// Branches are a SECONDARY source for address/hours only: the same `branches` rows the public store context
// already reads. The Knowledge Base field always wins; branches fill in only when the KB field is empty, so
// an operator with a multi-branch setup does not have to duplicate data — and nothing is ever invented.
export const loadSupportKnowledgeBase = async ({ tenantId, dbClient = db } = {}) => {
  const settings = await getWebsiteSettings({ tenantId }).catch(() => ({}));
  const kb = publicKnowledgeBase(settings || {});
  let branches = [];
  if (tenantId) {
    const result = await dbClient.query(
      `SELECT name,
              COALESCE(phone, '') AS phone,
              COALESCE(address, '') AS address
         FROM branches
        WHERE tenant_id = $1::bigint
        ORDER BY name ASC
        LIMIT 8`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    branches = (result.rows || []).map((row) => ({
      name: toText(row.name),
      phone: toText(row.phone),
      address: toText(row.address),
    }));
  }
  return { knowledge_base: kb, branches };
};

// ---- Deterministic rendering -------------------------------------------------------------------------
// Returns { answer, fields_used, missing_fields }. `missing_fields` names the EMPTY canonical field(s) so the
// operator / AI Studio can see exactly what to fill in on the Knowledge Base page. NOTHING is fabricated:
// a missing address yields a clarification, never a guessed address; a missing maps link is simply omitted.
const lines = (value) => toText(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

const withHandoffTail = (answer, kb) => {
  const tail = toText(kb?.human_support_message);
  return tail ? `${answer}\n${tail}` : answer;
};

export const renderSupportFactAnswer = ({ intent = "", knowledge_base: kb = {}, branches = [] } = {}) => {
  const branchList = Array.isArray(branches) ? branches : [];
  const missing = (fields, answer) => ({ answer: withHandoffTail(answer, kb), fields_used: [], missing_fields: fields });
  const ok = (fields, answer) => ({ answer, fields_used: fields, missing_fields: [] });

  if (intent === SUPPORT_FACT_INTENTS.STORE_LOCATION) {
    const used = [];
    const body = [];
    const kbAddress = lines(kb.store_address);
    const branchAddresses = branchList.filter((branch) => branch.address).map((branch) => `${branch.name}: ${branch.address}`);
    if (kbAddress.length) {
      body.push(...kbAddress);
      used.push("store_address");
    } else if (branchAddresses.length) {
      body.push(...branchAddresses);
      used.push("branches.address");
    }
    if (!body.length) {
      return missing(["store_address"], "العنوان مش متسجل عندي في بيانات المتجر لسه، وأنا مش هأديك عنوان غير مؤكد. هأتأكدلك وأرجعلك بيه.");
    }
    const mapsUrl = toText(kb.maps_url);
    if (mapsUrl) used.push("maps_url");
    const answer = [`عنواننا: ${body.join(" - ")}`, mapsUrl ? `اللوكيشن على الخريطة: ${mapsUrl}` : ""].filter(Boolean).join("\n");
    return { answer, fields_used: used, missing_fields: mapsUrl ? [] : ["maps_url"] };
  }

  if (intent === SUPPORT_FACT_INTENTS.STORE_HOURS) {
    const kbHours = lines(kb.branch_working_hours || kb.working_hours);
    if (kbHours.length) return ok(["branch_working_hours"], `مواعيد العمل:\n${kbHours.join("\n")}`);
    return missing(["branch_working_hours"], "مواعيد العمل مش متسجلة عندي لسه، هأتأكدلك من الفرع وأقولك.");
  }

  if (intent === SUPPORT_FACT_INTENTS.STORE_CONTACT) {
    const phone = toText(kb.phone);
    const whatsapp = toText(kb.whatsapp);
    const used = [];
    const body = [];
    if (phone) { body.push(`رقم الهاتف: ${phone}`); used.push("phone"); }
    if (whatsapp) { body.push(`واتساب: ${whatsapp}`); used.push("whatsapp"); }
    if (!body.length) return missing(["phone", "whatsapp"], "رقم التواصل مش متسجل عندي لسه، هأتأكدلك وأبعتهولك.");
    return { answer: `بيانات التواصل:\n${body.join("\n")}`, fields_used: used, missing_fields: phone ? [] : ["phone"] };
  }

  if (intent === SUPPORT_FACT_INTENTS.STORE_WHATSAPP) {
    const whatsapp = toText(kb.whatsapp);
    if (whatsapp) return ok(["whatsapp"], `رقم الواتساب: ${whatsapp}`);
    const phone = toText(kb.phone);
    // No WhatsApp number configured → never present the public phone AS a WhatsApp number; label it plainly.
    const answer = phone
      ? `رقم الواتساب مش متسجل عندي لسه. رقم الهاتف العام: ${phone}`
      : "رقم الواتساب مش متسجل عندي لسه، هأتأكدلك وأبعتهولك.";
    return { answer: withHandoffTail(answer, kb), fields_used: phone ? ["phone"] : [], missing_fields: ["whatsapp"] };
  }

  if (intent === SUPPORT_FACT_INTENTS.PAYMENT_METHODS) {
    const methods = lines(kb.payment_methods);
    if (methods.length) return ok(["payment_methods"], `طرق الدفع المتاحة:\n${methods.join("\n")}`);
    return missing(["payment_methods"], "طرق الدفع مش متسجلة عندي لسه، هأتأكدلك وأقولك.");
  }

  if (intent === SUPPORT_FACT_INTENTS.SHIPPING_POLICY) {
    const shipping = lines(kb.shipping_policy);
    const notes = lines(kb.delivery_notes);
    const used = [];
    if (shipping.length) used.push("shipping_policy");
    if (notes.length) used.push("delivery_notes");
    if (!used.length) return missing(["shipping_policy"], "سياسة الشحن مش متسجلة عندي لسه، هأتأكدلك وأقولك.");
    return { answer: `الشحن والتوصيل:\n${[...shipping, ...notes].join("\n")}`, fields_used: used, missing_fields: shipping.length ? [] : ["shipping_policy"] };
  }

  if (intent === SUPPORT_FACT_INTENTS.RETURN_EXCHANGE_POLICY) {
    const policy = lines(kb.return_exchange_policy);
    if (policy.length) return ok(["return_exchange_policy"], `سياسة الاستبدال والاسترجاع:\n${policy.join("\n")}`);
    return missing(["return_exchange_policy"], "سياسة الاستبدال والاسترجاع مش متسجلة عندي لسه، هأتأكدلك وأقولك.");
  }

  if (intent === SUPPORT_FACT_INTENTS.WARRANTY) {
    const warranty = lines(kb.warranty_notes);
    if (warranty.length) return ok(["warranty_notes"], `الضمان:\n${warranty.join("\n")}`);
    return missing(["warranty_notes"], "تفاصيل الضمان مش متسجلة عندي لسه، هأتأكدلك وأقولك.");
  }

  if (intent === SUPPORT_FACT_INTENTS.HUMAN_HANDOFF) {
    const handoff = toText(kb.human_support_message);
    if (handoff) return ok(["human_support_message"], handoff);
    return { answer: "", fields_used: [], missing_fields: ["human_support_message"] };
  }

  return { answer: "", fields_used: [], missing_fields: [] };
};

// Impure convenience orchestrator: message → canonical grounded support answer (or null when the message is
// not a support-fact question). Never sends, never touches the catalog, never consults conversation history.
export const resolveSupportFactReply = async ({ tenantId, message, load = loadSupportKnowledgeBase } = {}) => {
  const intent = detectSupportFactIntent(message);
  if (!intent) return null;
  const knowledge = await load({ tenantId });
  const rendered = renderSupportFactAnswer({ intent, ...knowledge });
  if (!toText(rendered.answer)) return null;
  return { intent, ...rendered };
};
