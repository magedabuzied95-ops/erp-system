import { governorateOptions, resolveGovernorateId } from "../../shared/codPolicy.js";
import { normalizeChannel, normalizeOutgoingChannelReply } from "./aiChannelAdapterService.js";
import { getSetting } from "./settingsService.js";
import { loadShippingZones, resolveStorefrontShippingQuote } from "./storefrontShippingService.js";
import { shippingFeeAdvanceNoticeFor, toPlace } from "./codPolicyReplyService.js";
import { detectStoreFactsQuestion, extractGovernorateFromMessage } from "../utils/storeFactsQuestion.js";

/*
 * The shipping fee, opening the parcel before taking it, and exchange / return — answered from
 * the store's own settings, word for word, and never re-worded by OpenAI: the rewrite turned
 * "no product" into "السعر غير متاح ... contact_support" and the size path invented "inspection
 * is not available" (production, 2026-10-19). Shared by WhatsApp, Messenger and Instagram through
 * the unified decision. When the store has no data for a question, a colleague confirms it.
 */

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => Math.round(Number(value) || 0).toLocaleString("en-US");

export const STORE_FACTS_INTENTS = Object.freeze(["shipping_fee", "open_package", "exchange_return"]);

const COLLEAGUE_CONFIRMS = "هخلي حد من زمايلي يأكدلك التفاصيل دي حالاً 🙏";

const governorateNameAr = (id = "") => governorateOptions.find((option) => option.value === id)?.ar || "";
const governorateNameEn = (id = "") => governorateOptions.find((option) => option.value === id)?.en || "";

const zoneIsGovernorateWide = (zone = {}) => !text(zone.city) && !text(zone.area) && !text(zone.district) && !text(zone.zone);

/**
 * The website's own quote for a governorate: GET /storefront/shipping/quote runs
 * resolveStorefrontShippingQuote, and so does this — the checkout sends the Bosta picker's English
 * name, so that is tried first, then the Arabic one.
 */
export const websiteShippingQuoteFor = async (governorateId = "", resolveQuote = resolveStorefrontShippingQuote) => {
  const names = [governorateNameEn(governorateId), governorateNameAr(governorateId)].filter(Boolean);
  let first = null;
  for (const governorate of names) {
    const quote = await resolveQuote({ governorate });
    if (!first) first = quote;
    if (quote?.match_level && quote.match_level !== "default") return quote;
  }
  return first;
};

/**
 * The fee as the website shows it for the governorate. One the shop prices city by city (the
 * website then needs the city first) gets the range of what its cities pay.
 */
export const shippingFeeForGovernorate = ({ quote = {}, zones = [] } = {}, governorateId = "") => {
  const nameAr = governorateNameAr(governorateId);
  const inGovernorate = asArray(zones).filter((zone) => resolveGovernorateId(zone.governorate_id, zone.governorate) === governorateId);
  const cityZones = inGovernorate.filter((zone) => !zoneIsGovernorateWide(zone));
  const price = Number(quote?.price ?? quote?.shipping_price) || 0;
  const threshold = Number(quote?.free_shipping_threshold) || 0;
  const eta = text(quote?.estimated_delivery_text);
  // City zones next to the governorate's own price (or the default, when it has none).
  const prices = [...new Set([price, ...cityZones.map((zone) => Number(zone.price) || 0)])].sort((a, b) => a - b);
  if (cityZones.length && prices.length > 1) return { governorateId, nameAr, price: null, min: prices[0], max: prices[prices.length - 1], threshold, eta: "" };
  return { governorateId, nameAr, price, min: null, max: null, threshold, eta };
};

/** One fee for every governorate (no zones, or all zones and the default agree), else null. */
export const uniformShippingFee = ({ zones = [], defaultPrice = 0 } = {}) => {
  const prices = new Set(asArray(zones).map((zone) => Number(zone.price) || 0));
  if (!prices.size) return Number(defaultPrice) || 0;
  return prices.size === 1 && prices.has(Number(defaultPrice) || 0) ? Number(defaultPrice) || 0 : null;
};

// The zone's delivery text is typed in English in settings ("4-5 business days"); the customer
// reads Arabic, so a range is re-worded and anything else without Arabic is left out.
export const deliveryTextAr = (value = "") => {
  const eta = text(value);
  const range = eta.match(/^(\d+)\s*(?:-|to|–)\s*(\d+)\s*(business|working)?\s*days?$/i);
  if (range) return `من ${range[1]} لـ ${range[2]} ${range[3] ? "أيام عمل" : "أيام"}`;
  return /[؀-ۿ]/.test(eta) ? eta : "";
};

const freeShippingLine = (threshold = 0) => (Number(threshold) > 0 ? `والشحن مجاني لو الأوردر ${money(threshold)} جنيه أو أكتر.` : "");

export const buildShippingFeeReply = ({ fee = null, uniformFee = null, freeShippingThreshold = 0, advanceNotice = "" } = {}) => {
  if (!fee) {
    if (uniformFee !== null) {
      return [
        uniformFee > 0 ? `الشحن ${money(uniformFee)} جنيه لكل المحافظات 🚚` : "الشحن مجاني لكل المحافظات 🚚",
        freeShippingLine(freeShippingThreshold),
      ].filter(Boolean).join("\n");
    }
    return "مصاريف الشحن بتختلف حسب المحافظة 🚚\nحضرتك من أنهي محافظة؟";
  }
  const place = toPlace(fee.nameAr);
  const headline = fee.price === null
    ? `الشحن ${place} من ${money(fee.min)} لـ ${money(fee.max)} جنيه حسب المنطقة 🚚`
    : fee.price > 0 ? `الشحن ${place} ${money(fee.price)} جنيه 🚚` : `الشحن ${place} مجاني 🚚`;
  return [
    headline,
    deliveryTextAr(fee.eta) ? `التوصيل ${deliveryTextAr(fee.eta)}` : "",
    fee.price === 0 ? "" : freeShippingLine(fee.threshold),
    advanceNotice,
  ].filter(Boolean).join("\n");
};

// orders.bosta_allow_open_package: "allow" / "deny" / "inherit" (Bosta's account decides, which
// we cannot see — so a colleague confirms).
export const openPackageMode = (value) => {
  const key = text(value).toLowerCase();
  if (value === true || ["allow", "allowed", "true", "1", "yes", "on"].includes(key)) return "allow";
  if (value === false || ["deny", "denied", "block", "false", "0", "no", "off"].includes(key)) return "deny";
  return "unknown";
};

export const buildOpenPackageReply = ({ mode = "unknown" } = {}) => {
  if (mode === "allow") return "أيوه يا فندم، تقدر تفتح الشحنة وتعاين الأوردر قدام المندوب قبل ما تستلمه 👌";
  if (mode === "deny") return "للأسف فتح الشحنة ومعاينتها قبل الاستلام مش متاح حالياً.";
  return `بالنسبة للمعاينة قبل الاستلام، ${COLLEAGUE_CONFIRMS}`;
};

export const buildExchangeReturnReply = ({ policy = "" } = {}) => (
  text(policy)
    ? `بالنسبة للاستبدال والاسترجاع:\n${text(policy)}`
    : `بالنسبة للاستبدال والاسترجاع، ${COLLEAGUE_CONFIRMS}`
);

// The last reply asked "which governorate?": a bare "اسكندريه" now answers it.
// A bare governorate is a shipping question both when we asked "which governorate?" and right
// after a fee answer: "الشحن للقاهرة كام" → 100, then "واسيوط" means "and to Assiut?" (production,
// 2026-10-19, it got "تحت أمرك. ابعت الموديل...").
const awaitingGovernorateFrom = (memory = {}) =>
  ["shipping_fee_ask_governorate", "shipping_fee"].includes(text(memory?.preferences?.last_intent ?? memory?.last_intent));

const defaultLoaders = {
  shippingZones: () => loadShippingZones(),
  shippingQuote: (params) => resolveStorefrontShippingQuote(params),
  openPackageSetting: () => getSetting("orders.bosta_allow_open_package", "inherit"),
  advanceNotice: ({ governorate, shippingFee }) => shippingFeeAdvanceNoticeFor({ governorate, shippingFee, orderTotal: shippingFee, compact: true }),
  returnPolicy: async () => "",
};

/**
 * The decision for a store question, or null when the message is not one. `loaders` replaces the
 * settings reads (tests, and the unified decision passes its invoice-policy reader).
 */
export const buildStoreFactsDecision = async ({ message = "", memory = {}, channel = "", tenantId = null, loaders = {} } = {}) => {
  const question = detectStoreFactsQuestion(message, { awaitingGovernorate: awaitingGovernorateFrom(memory) });
  if (!question) return null;
  const load = { ...defaultLoaders, ...loaders };
  let replyText = "";
  let lastIntent = question;
  const facts = { question };
  try {
    if (question === "shipping_fee") {
      const shipping = await load.shippingZones();
      const governorateId = extractGovernorateFromMessage(message);
      const quote = governorateId ? await websiteShippingQuoteFor(governorateId, load.shippingQuote) : null;
      const fee = governorateId ? shippingFeeForGovernorate({ quote, zones: shipping?.zones }, governorateId) : null;
      const uniformFee = fee ? null : uniformShippingFee(shipping);
      const advanceNotice = fee && fee.price !== null
        ? await Promise.resolve(load.advanceNotice({ governorate: fee.nameAr, shippingFee: fee.price })).catch(() => "")
        : "";
      replyText = buildShippingFeeReply({ fee, uniformFee, freeShippingThreshold: shipping?.freeShippingThreshold, advanceNotice: text(advanceNotice) });
      if (!fee && uniformFee === null) lastIntent = "shipping_fee_ask_governorate";
      Object.assign(facts, { governorate_id: governorateId, fee });
    } else if (question === "open_package") {
      const mode = openPackageMode(await load.openPackageSetting());
      replyText = buildOpenPackageReply({ mode });
      facts.open_package_mode = mode;
    } else {
      const policy = text(await load.returnPolicy(tenantId));
      replyText = buildExchangeReturnReply({ policy });
      facts.has_policy = Boolean(policy);
    }
  } catch (error) {
    console.warn("[ai-store-facts:lookup-failed]", { question, message: error?.message || String(error) });
    replyText = COLLEAGUE_CONFIRMS;
    facts.lookup_failed = true;
  }
  const memoryUpdates = {
    last_intent: lastIntent,
    ai_brain_version: "v2",
  };
  console.info("[ai-store-facts]", { channel, question, last_intent: lastIntent, reply_preview: replyText.slice(0, 120) });
  return {
    text: replyText,
    answer: replyText,
    intent: question,
    detected_intent: question,
    products: [],
    suggested_products: [],
    product_cards: [],
    images: [],
    image_cards: [],
    quickReplies: [],
    quick_replies: [],
    actions: [],
    suggested_actions: [],
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    channel_reply: normalizeOutgoingChannelReply({ channel: normalizeChannel(channel), response: { text: replyText, product_cards: [], image_cards: [] } }),
    debug: {
      source: "aiStoreFactsReplyService",
      engine: "store_facts",
      reason: `store_facts_${question}`,
      store_facts: facts,
    },
  };
};

export default { buildStoreFactsDecision, STORE_FACTS_INTENTS };
