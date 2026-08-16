/**
 * Understanding pass — one structured read of the customer's message BEFORE any
 * search, composition, or routing happens.
 *
 * What it replaces: `resolveIntent` (aiIntentResolver.js) is 23 lines of
 * `text.includes()` over five buckets. It cannot see that "عايز حاجة كاجوال لأخويا
 * هدية، ميزانيتي 1500" is a gift, for someone else, with a budget — it returns
 * "GENERAL". Every downstream decision (which products to search, what tone to use,
 * whether to escalate, whether it is safe to auto-send) inherits that blindness.
 *
 * Design rules this follows, because the rest of the AI stack depends on them:
 *
 * 1. It NEVER decides facts. It reads the customer, not the catalog. Product
 *    identity, price and stock stay with the grounding gate.
 * 2. It NEVER throws. Every failure path returns a valid, deterministic
 *    understanding so callers can use the shape unconditionally.
 * 3. It stays backward compatible: `legacy_intent` always carries one of the five
 *    values the existing enum uses, so current callers keep working untouched.
 * 4. It is off by default (AI_UNDERSTANDING_ENABLED). Dormant, the service returns
 *    the deterministic reading — i.e. exactly today's behaviour.
 */
import { normalizeArabicIntentPayload } from "../utils/arabicTextNormalizer.js";
import { extractShoeSize } from "./aiMessageExtractors.js";
import { detectEscalation } from "./aiEscalationDetector.js";
import { resolveIntent } from "./aiIntentResolver.js";
import {
  getSharedOpenAiClient,
  isTextGenerationAvailable,
  resolveFastModel,
} from "./openaiSupportService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_MESSAGE_CHARS = 1_200;
const MAX_HISTORY_TURNS = 6;
const CACHE_MAX_ENTRIES = 500;

export const PRIMARY_INTENTS = Object.freeze([
  "greeting",
  "product_discovery",
  "product_availability",
  "price_question",
  "size_question",
  "color_question",
  "image_request",
  "comparison",
  "objection",
  "buying_intent",
  "order_status",
  "shipping_question",
  "return_or_exchange",
  "complaint",
  "restock_request",
  "human_handoff",
  "smalltalk",
  "other",
]);

export const FUNNEL_STAGES = Object.freeze([
  "browsing",
  "comparing",
  "objecting",
  "ready_to_buy",
  "post_purchase",
  "complaint",
]);

export const OBJECTION_TYPES = Object.freeze([
  "none",
  "price_high",
  "quality_doubt",
  "authenticity_doubt",
  "shipping_cost",
  "shipping_time",
  "size_risk",
  "trust",
]);

/**
 * Bridge to the five-value enum the existing pipeline reads. Anything that is not
 * clearly one of the legacy buckets falls to GENERAL, which is what the old resolver
 * would have produced anyway — so nothing downstream regresses.
 */
const LEGACY_INTENT_BY_PRIMARY = Object.freeze({
  greeting: "GREETING",
  product_availability: "AVAILABILITY_INQUIRY",
  restock_request: "AVAILABILITY_INQUIRY",
  size_question: "SIZE_INQUIRY",
  price_question: "PRICE_INQUIRY",
  objection: "PRICE_INQUIRY",
});

const understandingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "primary_intent",
    "secondary_intents",
    "entities",
    "funnel_stage",
    "sentiment",
    "urgency",
    "formality",
    "objection",
    "refers_to_previous",
    "requires_human",
    "confidence",
  ],
  properties: {
    primary_intent: { type: "string", enum: [...PRIMARY_INTENTS] },
    secondary_intents: {
      type: "array",
      maxItems: 3,
      items: { type: "string", enum: [...PRIMARY_INTENTS] },
    },
    entities: {
      type: "object",
      additionalProperties: false,
      required: [
        "product_model",
        "category",
        "brand",
        "color",
        "size",
        "quantity",
        "budget_max",
        "occasion",
        "recipient",
        "city",
      ],
      properties: {
        product_model: { type: ["string", "null"], description: "Model/name exactly as the customer said it" },
        category: { type: ["string", "null"] },
        brand: { type: ["string", "null"] },
        color: { type: ["string", "null"] },
        size: { type: ["string", "null"] },
        quantity: { type: ["integer", "null"], minimum: 1, maximum: 99 },
        budget_max: { type: ["number", "null"], minimum: 0 },
        occasion: { type: ["string", "null"], description: "e.g. gift, wedding, gym, school" },
        recipient: { type: ["string", "null"], description: "Who it is for, when not the customer" },
        city: { type: ["string", "null"] },
      },
    },
    funnel_stage: { type: "string", enum: [...FUNNEL_STAGES] },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    urgency: { type: "string", enum: ["low", "normal", "high"] },
    formality: { type: "string", enum: ["casual", "neutral", "formal"] },
    objection: { type: "string", enum: [...OBJECTION_TYPES] },
    refers_to_previous: {
      type: "object",
      additionalProperties: false,
      required: ["is_followup", "target"],
      properties: {
        is_followup: { type: "boolean" },
        target: {
          type: ["string", "null"],
          description: "What a pronoun like 'ده' points at: product | size | color | order | null",
        },
      },
    },
    requires_human: { type: "boolean" },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["intent", "entities"],
      properties: {
        intent: { type: "number", minimum: 0, maximum: 1 },
        entities: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
};

const INSTRUCTIONS = [
  "You read one customer message from an Egyptian online store and describe what the customer means.",
  "You are a reader, not a salesperson. Never write a reply, never name a product from your own knowledge, never state a price or stock.",
  "The conversation is Egyptian Arabic dialect, sometimes mixed with English or franco-Arabic (Arabic typed in Latin letters).",
  "Read the recent turns to resolve references. If the customer says 'ده' or 'هو' or 'نفسه', decide what it points at and set refers_to_previous.",
  "A message can carry more than one intent. Put the one that must be answered first in primary_intent and the rest in secondary_intents.",
  "A greeting is only the primary intent when the message contains nothing else. 'السلام عليكم عندكم كروكس؟' is product_availability.",
  "product_model is what the CUSTOMER called it, copied verbatim — do not correct spelling, translate it, or map it to a catalog name.",
  "Set entities to null when the customer did not say them. Never guess a size, colour, budget or city.",
  "budget_max is a number in EGP. 'في حدود 1500' is 1500. 'رخيص' is not a number, leave it null.",
  "urgency is high only on an explicit time pressure such as 'محتاجها النهاردة' or 'ضروري'.",
  "formality describes how the CUSTOMER writes, so the reply can mirror it.",
  "requires_human is true only for an explicit request for a person, a refund or money dispute, or an angry complaint.",
  "sentiment negative means the customer is unhappy with us, not merely that they said a product is expensive — that is objection price_high.",
  "confidence is your own certainty, and low confidence is useful information. Do not inflate it.",
].join("\n");

const understandingEnabled = () => envFlagEnabled(process.env.AI_UNDERSTANDING_ENABLED);
const understandingTimeoutMs = () => positiveNumber(process.env.AI_UNDERSTANDING_TIMEOUT_MS, 8_000);
const cacheTtlMs = () => positiveNumber(process.env.AI_UNDERSTANDING_CACHE_TTL_MS, 15 * 60 * 1000);

/**
 * Bounded LRU-ish cache. The same question arrives constantly ("بكام؟", "متاح؟"), and
 * re-reading it costs a model call each time. Keyed on the normalized message plus the
 * conversation tail, because the same words mean different things after different turns.
 */
const cache = new Map();

const cacheKey = ({ normalizedMessage, historySignature, activeProductId }) =>
  `${normalizedMessage}|${historySignature}|${activeProductId || ""}`;

const readCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Refresh recency so hot keys survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const writeCache = (key, value) => {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs() });
};

export const clearUnderstandingCache = () => cache.clear();

const emptyEntities = () => ({
  product_model: null,
  category: null,
  brand: null,
  color: null,
  size: null,
  quantity: null,
  budget_max: null,
  occasion: null,
  recipient: null,
  city: null,
});

const legacyIntentFor = (primaryIntent, fallbackMessage) =>
  LEGACY_INTENT_BY_PRIMARY[primaryIntent] || resolveIntent(fallbackMessage);

/**
 * The deterministic reading. This is what the pipeline had before, expressed in the
 * new shape: keyword intent, regex size, keyword escalation. It is the fallback for
 * every failure path AND the value returned when the feature flag is off, so turning
 * the flag off is a true no-op rather than a degraded mode.
 */
export const buildDeterministicUnderstanding = (message = "") => {
  const raw = text(message);
  const legacyIntent = resolveIntent(raw);
  const escalation = detectEscalation(raw);
  const size = extractShoeSize(raw);

  const primaryByLegacy = {
    AVAILABILITY_INQUIRY: "product_availability",
    SIZE_INQUIRY: "size_question",
    PRICE_INQUIRY: "price_question",
    GREETING: "greeting",
    GENERAL: "other",
  };

  return {
    primary_intent: escalation.shouldEscalate ? "complaint" : primaryByLegacy[legacyIntent] || "other",
    secondary_intents: [],
    entities: { ...emptyEntities(), size: size || null },
    funnel_stage: escalation.shouldEscalate ? "complaint" : "browsing",
    sentiment: escalation.shouldEscalate ? "negative" : "neutral",
    urgency: "normal",
    formality: "casual",
    objection: "none",
    refers_to_previous: { is_followup: false, target: null },
    requires_human: escalation.shouldEscalate,
    confidence: { intent: escalation.shouldEscalate ? 0.6 : 0.35, entities: size ? 0.6 : 0.2 },
    legacy_intent: legacyIntent,
    source: "deterministic",
    model: "",
  };
};

const clamp01 = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

const oneOf = (value, allowed, fallback) => {
  const candidate = text(value).toLowerCase();
  return allowed.includes(candidate) ? candidate : fallback;
};

const nullableText = (value, maxLength = 120) => {
  const candidate = text(value);
  if (!candidate || candidate.toLowerCase() === "null") return null;
  return candidate.slice(0, maxLength);
};

const nullableNumber = (value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
};

/**
 * Never trust the model's shape. A malformed field degrades to the deterministic
 * value for that field rather than poisoning the whole understanding.
 */
const normalizeUnderstanding = (payload, { message, model }) => {
  const baseline = buildDeterministicUnderstanding(message);
  if (!payload || typeof payload !== "object") return baseline;

  const entities = payload.entities && typeof payload.entities === "object" ? payload.entities : {};
  const referral = payload.refers_to_previous && typeof payload.refers_to_previous === "object" ? payload.refers_to_previous : {};
  const confidence = payload.confidence && typeof payload.confidence === "object" ? payload.confidence : {};

  const primaryIntent = oneOf(payload.primary_intent, PRIMARY_INTENTS, baseline.primary_intent);

  return {
    primary_intent: primaryIntent,
    secondary_intents: asArray(payload.secondary_intents)
      .map((item) => oneOf(item, PRIMARY_INTENTS, ""))
      .filter((item) => item && item !== primaryIntent)
      .slice(0, 3),
    entities: {
      product_model: nullableText(entities.product_model),
      category: nullableText(entities.category),
      brand: nullableText(entities.brand),
      color: nullableText(entities.color, 40),
      // A regex-confirmed size beats a hallucinated one; fall back to the model only
      // when the deterministic extractor found nothing.
      size: nullableText(entities.size, 20) || baseline.entities.size,
      quantity: nullableNumber(entities.quantity, { min: 1, max: 99 }),
      budget_max: nullableNumber(entities.budget_max, { min: 0, max: 10_000_000 }),
      occasion: nullableText(entities.occasion, 60),
      recipient: nullableText(entities.recipient, 60),
      city: nullableText(entities.city, 60),
    },
    funnel_stage: oneOf(payload.funnel_stage, FUNNEL_STAGES, baseline.funnel_stage),
    sentiment: oneOf(payload.sentiment, ["positive", "neutral", "negative"], baseline.sentiment),
    urgency: oneOf(payload.urgency, ["low", "normal", "high"], "normal"),
    formality: oneOf(payload.formality, ["casual", "neutral", "formal"], "casual"),
    objection: oneOf(payload.objection, OBJECTION_TYPES, "none"),
    refers_to_previous: {
      is_followup: referral.is_followup === true,
      target: nullableText(referral.target, 30),
    },
    // The deterministic escalation keywords are a floor, not a ceiling: if either the
    // model or the keyword list flags a human, we flag a human.
    requires_human: payload.requires_human === true || baseline.requires_human,
    confidence: {
      intent: clamp01(confidence.intent, 0.5),
      entities: clamp01(confidence.entities, 0.5),
    },
    legacy_intent: legacyIntentFor(primaryIntent, message),
    source: "model",
    model,
  };
};

const buildHistorySignature = (history = []) =>
  asArray(history)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => `${text(turn?.role).slice(0, 1)}:${text(turn?.text).slice(0, 60)}`)
    .join("|");

const buildModelInput = ({ message, history, activeProduct, channel }) => ({
  customer_message: text(message).slice(0, MAX_MESSAGE_CHARS),
  channel: text(channel) || "unknown",
  recent_turns: asArray(history)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      role: text(turn?.role) === "customer" ? "customer" : "store",
      text: text(turn?.text).slice(0, 240),
    })),
  // Only the label is shared — never price or stock. The reader must not be able to
  // repeat a fact, and the grounding gate remains the only authority on those.
  active_product_label: text(activeProduct?.name || activeProduct?.product_name || "") || null,
});

/**
 * Reads one inbound message. Always resolves; never rejects.
 *
 * @returns {Promise<object>} understanding payload (see understandingSchema) plus
 *          `legacy_intent`, `source` ("model" | "deterministic"), and `model`.
 */
export const understandCustomerMessage = async ({
  message = "",
  history = [],
  activeProduct = null,
  channel = "",
  tenantId = null,
} = {}) => {
  const customerMessage = text(message);
  if (!customerMessage) return buildDeterministicUnderstanding("");

  if (!understandingEnabled() || !isTextGenerationAvailable()) {
    return buildDeterministicUnderstanding(customerMessage);
  }

  const normalizedMessage = normalizeArabicIntentPayload(customerMessage).normalizedForIntent;
  const key = cacheKey({
    normalizedMessage,
    historySignature: buildHistorySignature(history),
    activeProductId: activeProduct?.id || activeProduct?.product_id || "",
  });
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  const client = getSharedOpenAiClient();
  if (!client) return buildDeterministicUnderstanding(customerMessage);

  const model = resolveFastModel();
  try {
    const response = await client.responses.create(
      {
        model,
        instructions: INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(buildModelInput({ message: customerMessage, history, activeProduct, channel }), null, 2),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "customer_understanding",
            strict: true,
            schema: understandingSchema,
          },
        },
      },
      { timeout: understandingTimeoutMs(), maxRetries: 1 }
    );

    let parsed = null;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      parsed = null;
    }

    const understanding = normalizeUnderstanding(parsed, { message: customerMessage, model });
    writeCache(key, understanding);
    return { ...understanding, cached: false };
  } catch (error) {
    console.warn("[ai-understanding] read failed, using deterministic reading", {
      tenant_id: tenantId,
      channel: text(channel),
      model,
      message: error?.message,
      status: error?.status,
    });
    return buildDeterministicUnderstanding(customerMessage);
  }
};

/**
 * Compact single-line summary for logs and reply traces. Keeping this here means the
 * trace format lives next to the schema it describes.
 */
export const summarizeUnderstanding = (understanding = {}) => {
  const entities = understanding.entities || {};
  const named = Object.entries(entities)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([field, value]) => `${field}=${value}`)
    .join(" ");
  return [
    understanding.primary_intent || "?",
    understanding.funnel_stage || "?",
    understanding.sentiment || "?",
    understanding.objection && understanding.objection !== "none" ? `objection=${understanding.objection}` : "",
    named,
    `conf=${Number(understanding.confidence?.intent ?? 0).toFixed(2)}`,
    `src=${understanding.source || "?"}`,
  ]
    .filter(Boolean)
    .join(" · ");
};

export const isUnderstandingEnabled = () => understandingEnabled();
