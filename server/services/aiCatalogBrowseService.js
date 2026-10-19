import db from "../database/db.js";
import { PRODUCT_GRADES, productGrade } from "../config/productGrades.js";
import { normalizeChannel, normalizeOutgoingChannelReply } from "./aiChannelAdapterService.js";
import { storefrontBaseUrl } from "./aiSizeAvailabilityLinkService.js";
import { detectCatalogBrowseSlots, productTypeByKey } from "../utils/catalogBrowseRequest.js";
import { productNamingTerms } from "../utils/productNamingTerms.js";

/*
 * Browsing by what the customer wants, like a salesperson (owner's spec, 2026-10-19):
 * "عايز اشوف الموديلات المستورد الفيتنامي مقاس 42" → one storefront link with exactly that.
 *
 * Five slots — product type, size, grade, audience, brand. The bot asks ONLY for what is missing,
 * in one message, and remembers the answers for the next turn:
 *   - no type and no size  → "كوتشي ولا سليبر ولا شنطة؟"
 *   - a sized type, no size → "مقاس كام؟"
 *   - no grade, and more than one grade in stock → the grades that exist for that request, with counts
 *   - never "رجالي ولا حريمي؟": a size already says who it fits (the owner's rule). A gender the
 *     customer gives is still a filter.
 * "ايه الفرق؟" is answered from the owner's grade notes (productGrades.js), then the question again.
 * The answer is the link only — no cards (owner's call) — and goes out word for word: the OpenAI
 * rewrite skips these intents, so the link and the counts are never re-worded.
 */

export const CATALOG_BROWSE_INTENTS = Object.freeze(["catalog_browse", "catalog_browse_ask", "grade_difference"]);
const PENDING_TTL_MS = 15 * 60 * 1000;

const text = (value = "") => String(value ?? "").trim();
const GENDER_LABELS = { men: "رجالي", women: "حريمي", kids: "أطفال" };

let brandCache = { at: 0, names: [] };
const loadBrandNames = async (tenantId) => {
  if (Date.now() - brandCache.at < 10 * 60 * 1000 && brandCache.names.length) return brandCache.names;
  const result = await db.query(
    `SELECT DISTINCT b.name FROM brands b JOIN products p ON p.brand_id = b.id WHERE p.tenant_id = $1 AND COALESCE(b.name, '') <> ''`,
    [tenantId]
  );
  brandCache = { at: Date.now(), names: result.rows.map((row) => text(row.name)).filter(Boolean) };
  return brandCache.names;
};

const audienceValues = (gender = "") => {
  if (gender === "men") return ["men", "رجالي", "unisex"];
  if (gender === "women") return ["women", "حريمي", "unisex"];
  if (gender === "kids") return ["kids", "اطفال", "unisex"];
  return null;
};

/*
 * In-stock choices per grade for the slots known so far — the same filters the link carries.
 * A choice is a model in one colour, the way the storefront lists them: size 42 imported was
 * 53 models but 126 cards on the page, and the number in the message must be the one the
 * customer then sees.
 */
const countByGrade = async ({ tenantId, slots }) => {
  const audiences = audienceValues(slots.gender);
  const result = await db.query(
    `
    SELECT LOWER(TRIM(COALESCE(p.grade, ''))) AS grade,
           COUNT(DISTINCT (p.id, LOWER(TRIM(COALESCE(pv.color, '')))))::int AS count
    FROM products p
    JOIN product_variants pv
      ON pv.product_id = p.id
     AND pv.is_active IS DISTINCT FROM FALSE
     AND pv.deleted_at IS NULL
     AND COALESCE(pv.stock, 0) > 0
     AND ($5::text = '' OR TRIM(COALESCE(pv.size, '')) = $5::text)
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.tenant_id = $1
      AND p.is_active IS DISTINCT FROM FALSE
      AND COALESCE(LOWER(p.status), 'active') NOT IN ('deleted', 'archived', 'draft', 'inactive')
      AND p.is_storefront_visible IS DISTINCT FROM FALSE
      AND ($2::text = '' OR LOWER(TRIM(COALESCE(p.product_type, ''))) = $2::text)
      AND ($3::text = '' OR LOWER(TRIM(COALESCE(b.name, ''))) = LOWER($3::text))
      AND (
        $4::text[] IS NULL
        OR LOWER(TRIM(COALESCE(p.gender, ''))) = ANY($4::text[])
        OR EXISTS (SELECT 1 FROM product_audiences pa WHERE pa.product_id = p.id AND LOWER(TRIM(pa.audience)) = ANY($4::text[]))
      )
    GROUP BY 1
    `,
    [tenantId, slots.type || "", slots.brand || "", audiences, slots.size || ""]
  );
  return new Map(result.rows.map((row) => [text(row.grade), Number(row.count) || 0]));
};

export const buildCatalogBrowseUrl = ({ type = "", size = "", grade = "", gender = "", brand = "" } = {}) => {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (brand) params.set("brand", brand);
  if (gender) params.set("gender", gender);
  if (size) params.set("size", size);
  if (grade && grade !== "all") params.set("quality", grade);
  params.set("inStock", "1");
  params.set("v", "9");
  return `${storefrontBaseUrl()}/share/available?${params.toString().replace(/\+/g, "%20")}`;
};

// "الكوتشيات المستورد فيتنامي الحريمي نايكي مقاس 42"
const describeRequest = ({ type = "", size = "", grade = "", gender = "", brand = "" } = {}) => [
  productTypeByKey(type)?.label || "الموديلات",
  grade && grade !== "all" ? productGrade(grade)?.label || "" : "",
  GENDER_LABELS[gender] || "",
  brand,
  size ? `مقاس ${size}` : "",
].filter(Boolean).join(" ");

const gradeChoicesLine = (counts = new Map()) =>
  PRODUCT_GRADES
    .filter((grade) => (counts.get(grade.key) || 0) > 0)
    .map((grade) => `🔹 ${grade.label} (${counts.get(grade.key)} اختيار)`)
    .join("\n");

export const gradeDifferenceText = () => [
  "الفرق بين الدرجات يا فندم:",
  ...PRODUCT_GRADES.map((grade) => `🔹 ${grade.label}${grade.note ? ` — ${grade.note}` : ""}`),
].join("\n");

const pendingFrom = (memory = {}, now = Date.now()) => {
  const preferences = memory?.preferences || memory || {};
  const pending = preferences.catalog_browse;
  if (!pending || typeof pending !== "object") return null;
  // Only the very next message continues it: any other reply in between owns the conversation.
  if (text(preferences.last_intent) !== "catalog_browse_ask" && text(preferences.last_intent) !== "grade_difference") return null;
  const at = Date.parse(pending.at || "");
  if (!Number.isFinite(at) || now - at > PENDING_TTL_MS) return null;
  return pending;
};

const hasActiveProduct = (memory = {}) => {
  const preferences = memory?.preferences || {};
  return Boolean(
    preferences.active_product_id || preferences.selected_product_id || preferences.last_product_id || memory?.activeProductId
  );
};

const decisionFor = ({ intent, replyText, channel, slots, pending = null, facts = {} }) => {
  const memoryUpdates = {
    last_intent: intent,
    catalog_browse: pending,
    ...(intent === "catalog_browse" ? { catalog_url: facts.url, catalog_filters: slots } : {}),
    ai_brain_version: "v2",
  };
  console.info("[ai-catalog-browse]", { channel, intent, slots, facts, reply_preview: replyText.slice(0, 160) });
  return {
    text: replyText,
    answer: replyText,
    intent,
    detected_intent: intent,
    confidence: 0.95,
    needs_human_support: false,
    products: [],
    suggested_products: [],
    product_cards: [],
    images: [],
    image_cards: [],
    quickReplies: [],
    quick_replies: [],
    actions: facts.url ? [{ label: "open_storefront", value: facts.url, action: "open_storefront" }] : [],
    suggested_actions: [],
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    channel_reply: normalizeOutgoingChannelReply({ channel: normalizeChannel(channel), response: { text: replyText, product_cards: [], image_cards: [] } }),
    debug: { source: "aiCatalogBrowseService", engine: "catalog_browse", reason: intent, catalog_browse: facts },
  };
};

/**
 * Returns a decision, or null when the message is not a browse request (a named model, a
 * question about the product on screen, anything else) — then the product brain answers it.
 */
export const buildCatalogBrowseDecision = async ({
  message = "",
  memory = {},
  channel = "",
  tenantId = 1,
  loaders = {},
  now = Date.now(),
} = {}) => {
  const load = {
    brandNames: loaders.brandNames || (() => loadBrandNames(tenantId)),
    countByGrade: loaders.countByGrade || ((slots) => countByGrade({ tenantId, slots })),
  };
  const brandNames = await load.brandNames().catch(() => []);
  const found = detectCatalogBrowseSlots(message, { brandNames });
  const brandWords = new Set(brandNames.map((name) => name.toLowerCase()));
  const namedModel = productNamingTerms(message).some((term) => !brandWords.has(term) && !/^(skechers|new balance|nike|adidas)$/i.test(term));
  const pending = pendingFrom(memory, now);

  const gradeQuestionOnly = found.asksGradeDifference && (found.gradesMentioned.length > 0 || pending);
  const fresh = !namedModel && (
    (found.strongBrowse && (found.type || found.size || found.grade || found.brand)) ||
    (found.weakBrowse && (found.type || found.grade || found.brand) && (found.type || found.size)) ||
    (found.grade && found.grade !== "all" && (found.size || found.type)) ||
    (found.type && found.size) ||
    // "متاح مقاس 42؟" with nothing on screen is the size browse; with a product on screen it asks
    // about THAT product and belongs to the brain.
    (found.weakBrowse && found.size && !hasActiveProduct(memory))
  );
  const continues = Boolean(pending) && !namedModel && (
    found.type || found.size || found.grade || found.brand || found.gender || found.anySize
  );
  if (!fresh && !continues && !gradeQuestionOnly) return null;

  // "ايه الفرق بينهم؟" in the middle of a browse keeps what the customer already said.
  const base = pending && (continues || gradeQuestionOnly) ? { ...pending } : {};
  const slots = {
    type: found.type || base.type || "",
    size: found.size || base.size || "",
    grade: found.grade || base.grade || "",
    gender: found.gender || base.gender || "",
    brand: found.brand || base.brand || "",
    any_size: found.anySize || Boolean(base.any_size),
  };

  if (gradeQuestionOnly && !found.size && !found.type) {
    const counts = slots.size || slots.type ? await load.countByGrade(slots).catch(() => new Map()) : new Map();
    const choices = gradeChoicesLine(counts);
    const replyText = [gradeDifferenceText(), choices ? `\nالمتاح ${describeRequest(slots)}:\n${choices}` : "", "\nتحب تشوف أنهي درجة؟"]
      .filter(Boolean)
      .join("\n");
    return decisionFor({ intent: "grade_difference", replyText, channel, slots, pending: { ...slots, at: new Date(now).toISOString() } });
  }

  const typeInfo = productTypeByKey(slots.type);
  const questions = [];
  if (!slots.type && !slots.size) questions.push("تحب تشوف كوتشيات ولا سليبر ولا شنط؟");
  else if (typeInfo?.sized && !slots.size && !slots.any_size) questions.push("مقاس كام؟");

  const counts = slots.size || slots.type ? await load.countByGrade(slots).catch(() => new Map()) : new Map();
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const gradesInStock = PRODUCT_GRADES.filter((grade) => (counts.get(grade.key) || 0) > 0);
  if (!slots.grade && !questions.length && gradesInStock.length > 1) {
    questions.push(`تحب أنهي درجة؟\n${gradeChoicesLine(counts)}\nولا الكل؟ ولو تحب أقولك الفرق بينهم قولّي.`);
  }
  if (questions.length) {
    const replyText = ["تمام يا فندم 👌", ...questions].join("\n");
    return decisionFor({ intent: "catalog_browse_ask", replyText, channel, slots, pending: { ...slots, at: new Date(now).toISOString() }, facts: { counts: Object.fromEntries(counts), total } });
  }

  const grade = slots.grade || (gradesInStock.length === 1 ? gradesInStock[0].key : "all");
  const finalSlots = { ...slots, grade };
  const count = grade === "all" ? total : counts.get(grade) || 0;
  if (!count) {
    const others = gradeChoicesLine(counts);
    const replyText = others
      ? [`${describeRequest(finalSlots)} مش متاح دلوقتي 🙏`, `بس متاح في:\n${others}`, "تحب أنهي؟"].join("\n")
      : `${describeRequest(finalSlots)} مش متاح دلوقتي 🙏\nتحب أدورلك على مقاس أو نوع تاني؟`;
    return decisionFor({ intent: "catalog_browse_ask", replyText, channel, slots: finalSlots, pending: { ...slots, grade: "", at: new Date(now).toISOString() }, facts: { counts: Object.fromEntries(counts), total, empty: true } });
  }
  const url = buildCatalogBrowseUrl(finalSlots);
  const replyText = [`أكيد 👌 ده لينك كل ${describeRequest(finalSlots)} المتاحة (${count} اختيار):`, url].join("\n");
  return decisionFor({ intent: "catalog_browse", replyText, channel, slots: finalSlots, pending: null, facts: { url, count } });
};

export default { buildCatalogBrowseDecision, buildCatalogBrowseUrl, CATALOG_BROWSE_INTENTS, gradeDifferenceText };
