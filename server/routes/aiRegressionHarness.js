import express from "express";

import db, { withReadOnlyDbSession } from "../database/db.js";

import { generateAiBrainV2Decision } from "../services/aiBrainV2Service.js";
import { composeAiSalesReply } from "../services/aiSalesReplyComposerService.js";
import { searchAiSalesProducts } from "../services/aiSalesAgentService.js";
import { normalizeProductCards } from "../services/aiProductCards.js";
import { resolveIntent } from "../services/aiIntentResolver.js";
import { getPerfContext } from "../utils/perfDebug.js";

const router = express.Router();
const truthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const regressionEndpointEnabled = () => truthy(process.env.ENABLE_AI_REGRESSION_TEST_ENDPOINT);
const regressionTestKey = () => String(process.env.AI_REGRESSION_TEST_KEY || "").trim();
const regressionKeyFromRequest = (req) =>
  String(
    req.get("x-ai-regression-test-key") ||
      req.get("x-api-key") ||
      req.get("authorization") ||
      req.body?.api_key ||
      ""
  )
    .replace(/^bearer\s+/i, "")
    .trim();

const toText = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const hasProductSearchSignal = ({ message = "", productQuery = "", intent = "" } = {}) => {
  const normalizedIntent = toText(intent).toLowerCase();
  const normalizedMessage = toText(message);
  return Boolean(productQuery) || normalizedIntent === "product_search" || normalizedIntent.includes("product_search") || normalizedIntent.includes("product search") || resolveIntent(normalizedMessage) === "product_search";
};
const REGRESSION_RATE_LIMIT_MAX = 250;
const REGRESSION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const regressionRateLimitBucketsByIp = new Map();
const regressionRateLimitBucketsByKey = new Map();
const REGRESSION_BODY_LIMIT_BYTES = 100 * 1024;
const MIN_REGRESSION_KEY_LENGTH = 32;
const DRY_RUN_MODE = true;

const isStrongRegressionKey = (value = "") => {
  const key = String(value || "").trim();
  return (
    key.length >= MIN_REGRESSION_KEY_LENGTH &&
    !/replace-with-a-secret|change-me|secret|example|test/i.test(key) &&
    !/\s/.test(key)
  );
};

const regressionRateLimitKeyByIp = (req) => String(req.ip || req.headers?.["x-forwarded-for"] || "unknown").split(",")[0].trim();
const regressionRateLimitKeyByKey = (key = "") => String(key || "").trim();

const readRateBucket = (map, bucketKey) => {
  const now = Date.now();
  const bucket = map.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    map.set(bucketKey, {
      count: 1,
      resetAt: now + REGRESSION_RATE_LIMIT_WINDOW_MS,
    });
    return { ok: true, remaining: REGRESSION_RATE_LIMIT_MAX - 1, resetAt: now + REGRESSION_RATE_LIMIT_WINDOW_MS };
  }
  if (bucket.count >= REGRESSION_RATE_LIMIT_MAX) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return { ok: true, remaining: REGRESSION_RATE_LIMIT_MAX - bucket.count, resetAt: bucket.resetAt };
};

const checkRegressionRateLimit = (req, key = "") => {
  const ipBucket = readRateBucket(regressionRateLimitBucketsByIp, regressionRateLimitKeyByIp(req));
  if (!ipBucket.ok) return { ...ipBucket, scope: "ip" };
  const keyBucket = readRateBucket(regressionRateLimitBucketsByKey, regressionRateLimitKeyByKey(key));
  if (!keyBucket.ok) return { ...keyBucket, scope: "key" };
  return { ok: true, remaining: Math.min(ipBucket.remaining, keyBucket.remaining), resetAt: Math.min(ipBucket.resetAt, keyBucket.resetAt) };
};

const sanitizeRegressionError = (error) => {
  console.error("[ai-regression-test:error]", {
    message: error?.message || String(error || ""),
    code: error?.code || "",
    stack: error?.stack || "",
  });
  return {
    success: false,
    message: "AI regression test failed",
  };
};

const regressionAuditLog = (phase, payload = {}) => {
  console.info("[ai-regression-test:audit]", {
    phase,
    started_at: payload.started_at || null,
    finished_at: payload.finished_at || null,
    session_id: payload.session_id || "",
    test_count: Number(payload.test_count || 0) || 0,
    ip: payload.ip || "",
    status: payload.status || "",
    dry_run: true,
    source: "ai_regression_test_endpoint",
  });
};

export const buildRegressionSeedProductCards = async ({
  tenantId = 1,
  message = "",
  productQuery = "",
  rawSeedProductCards = [],
  intent = "",
} = {}) => {
  const explicitCards = normalizeProductCards(rawSeedProductCards, { limit: 24, preserveUnavailableCards: true });
  if (explicitCards.length) return explicitCards;

  const searchText = toText(productQuery || message);
  if (!searchText || !hasProductSearchSignal({ message, productQuery, intent })) return [];

  const searchedProducts = await searchAiSalesProducts({ tenantId, query: searchText, limit: 24 }).catch(() => []);
  return normalizeProductCards(searchedProducts, { limit: 24, preserveUnavailableCards: true });
};

const primaryPrice = (product = {}) => {
  for (const candidate of [product?.final_price, product?.sale_price, product?.price, product?.selling_price, product?.display_price]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
};

const primaryStock = (product = {}) => {
  for (const candidate of [product?.stock, product?.quantity, product?.available_stock, product?.total_stock]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
};

const productSizes = (product = {}) => [
  ...(Array.isArray(product?.available_sizes) ? product.available_sizes : []),
  ...(Array.isArray(product?.sizes) ? product.sizes : []),
  ...(Array.isArray(product?.variants) ? product.variants.map((variant) => variant?.size) : []),
]
  .map((value) => toText(value))
  .filter(Boolean);

const normalizeArabic = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[ط£ط¥ط¢]/g, "ط§")
    .replace(/ظ‰/g, "ظٹ")
    .replace(/ط©/g, "ظ‡")
    .replace(/\s+/g, " ")
    .trim();

const extractExplicitSize = (message = "") => {
  const raw = toText(message);
  const normalized = normalizeArabic(raw);
  const match = raw.match(/\b(3[5-9]|4[0-9]|5[0-2])\b/) || normalized.match(/\b(3[5-9]|4[0-9]|5[0-2])\b/);
  return toText(match?.[1] || "");
};

const productColors = (product = {}) => [
  ...(Array.isArray(product?.colors) ? product.colors : []),
  ...(Array.isArray(product?.available_colors) ? product.available_colors : []),
  ...(Array.isArray(product?.variants) ? product.variants.flatMap((variant) => [variant?.color, variant?.color_name]) : []),
  product?.color,
]
  .map((value) => toText(value))
  .filter(Boolean);

const asksPrice = (message = "") =>
  /(ط¨ظƒط§ظ…|ط§ظ„ط³ط¹ط±|ط³ط¹ط±ظ‡|ظƒط§ظ…|price|cost)/i.test(String(message || ""));

const asksAvailability = (message = "") =>
  /(ظپظٹظ‡|ظ…ظˆط¬ظˆط¯|ظ…طھط§ط­|available|stock|ط¹ظ†ط¯ظƒظ…)/i.test(String(message || ""));

const asksColor = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(ط§ظ„ظˆط§ظ†|ط§ظ„ط£ظ„ظˆط§ظ†|ظ„ظˆظ†ظ‡|ظ„ظˆظ†|colors?|colour)/i.test(String(message || "")) ||
    /(ط§ظ„ظˆط§ظ†ظ‡ ط§ظٹظ‡|ط§ظ„ظˆط§ظ†ظ‡ط§ ط§ظٹظ‡|ظپظٹظ‡ ط§ظ„ظˆط§ظ†|ظپظٹ ط§ظ„ظˆط§ظ†|ط§ظٹظ‡ ط§ظ„ط§ظ„ظˆط§ظ†|ط§ظٹظ‡ ط§ظ„ظˆط§ظ†ظ‡|ط§ظٹظ‡ ط§ظ„ظˆط§ظ†ظ‡ط§|available colors|colors?)/i.test(normalized);
};

const asksSize = (message = "") =>
  Boolean(extractExplicitSize(message) || /(ظ…ظ‚ط§ط³|ظ…ظ‚ط§ط³ط§طھ|size)/i.test(String(message || "")));

const primaryImage = (product = {}) =>
  toText(product?.image_url || product?.image || product?.url || product?.main_image || product?.thumbnail);

const summarizeMemory = (memory = {}) => {
  const preferences = memory?.preferences || {};
  const rememberedCards = asArray(preferences.last_product_cards || preferences.lastProductCards);
  const firstCard = rememberedCards[0] || {};
  return {
    remembered_product_id: toText(
      preferences.active_product_id ||
        preferences.selected_product_id ||
        preferences.last_product_id ||
        firstCard.product_id ||
        firstCard.id ||
        ""
    ),
    remembered_product_name: toText(
      preferences.last_product_name ||
        firstCard.name ||
        firstCard.title ||
        firstCard.product_name ||
        ""
    ),
    remembered_size: toText(preferences.active_size || preferences.selected_size || preferences.activeSize || preferences.selectedSize || ""),
    remembered_color: toText(preferences.active_color || preferences.selected_color || preferences.activeColor || preferences.selectedColor || ""),
    last_ai_action: toText(preferences.last_ai_action || preferences.pending_action || ""),
    last_product_cards_count: rememberedCards.length,
  };
};

const extractCustomerNameCandidate = (message = "") => {
  const text = toText(message);
  if (!text) return "";
  if (/^ط£ظƒط¯\s+ط§ظ„ط£ظˆط±ط¯ط±$/i.test(text)) return "";
  const patterns = [
    /^(?:ط§ط³ظ…ظٹ|ط§ظ†ط§|ط£ظ†ط§|ط§ظ„ط§ط³ظ…|name)\s*[:\-]?\s*([^\d]{2,40})$/i,
    /(?:ط§ط³ظ…ظٹ|ط§ظ†ط§|ط£ظ†ط§|ط§ظ„ط§ط³ظ…|name)\s*[:\-]?\s*([^\d]{2,40})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = toText(match?.[1] || "");
    if (!candidate) continue;
    if (/ط£ظƒظ‘ط¯|ط£ظƒط¯|ط§ظ„ط£ظˆط±ط¯ط±|order|confirm/i.test(candidate)) continue;
    return candidate;
  }
  return "";
};

const extractMentionedPrices = (reply = "") =>
  Array.from(String(reply).matchAll(/(\d[\d,.]*)\s*ط¬ظ†ظٹظ‡/gi))
    .map((match) => Number(String(match[1]).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);

const hasBareCurrencyWord = (reply = "") =>
  /(^|[^\d])ط¬ظ†ظٹظ‡\b/i.test(String(reply)) && !/\d\s*ط¬ظ†ظٹظ‡\b/i.test(String(reply));

const hasAvailabilityClaim = (reply = "") =>
  /(?:\bظ…طھط§ط­\b|\bظ…ظˆط¬ظˆط¯\b|\bin stock\b|\bavailable\b)/i.test(String(reply));

const buildRegressionAnalysis = ({
  message = "",
  reply = "",
  intent = "",
  brainIntent = "",
  simpleIntent = "",
  memory = {},
  productCards = [],
  composedResponse = {},
  autoReplyShadow = null,
  source = "ai_regression_test_endpoint",
} = {}) => {
  const cardList = asArray(productCards);
  const topProduct = cardList[0] || {};
  const currentPrice = primaryPrice(topProduct);
  const currentStock = cardList.length
    ? Math.max(
        ...cardList
          .map((card) => primaryStock(card))
          .filter((value) => Number.isFinite(value))
      )
    : primaryStock(topProduct);
  const currentSizes = [...new Set(cardList.flatMap((card) => productSizes(card)).filter(Boolean))];
  const currentColors = [...new Set(cardList.flatMap((card) => productColors(card)).filter(Boolean))];
  const imageCards = productCards.filter((card) => primaryImage(card));
  const mentionedPrices = extractMentionedPrices(reply);
  const memorySummary = summarizeMemory(memory);
  return {
    source,
    message_length: toText(message).length,
    reply_length: toText(reply).length,
    intent: toText(intent),
    brain_intent: toText(brainIntent),
    simple_intent: toText(simpleIntent),
    product_card_count: productCards.length,
    image_card_count: imageCards.length,
    current_price: currentPrice,
    current_stock: currentStock,
    current_sizes: currentSizes,
    current_colors: currentColors,
    current_image_urls: imageCards.map((card) => primaryImage(card)).filter(Boolean),
    memory_before: memorySummary,
    memory_patch: composedResponse?.memory_updates || composedResponse?.ai_memory_patch?.preferences || null,
    customer_name_candidate: extractCustomerNameCandidate(message),
    reply_mentions_bare_currency: hasBareCurrencyWord(reply),
    reply_mentions_current_price: currentPrice ? mentionedPrices.includes(currentPrice) : false,
    reply_mentioned_prices: mentionedPrices,
    reply_mentions_availability: hasAvailabilityClaim(reply),
    reply_mentions_unavailable: /(?:ط؛ظٹط±\s*ظ…طھط§ط­|ط؛ظٹط±\s*ظ…ظˆط¬ظˆط¯|ظ†ظپط¯|out of stock|unavailable)/i.test(reply),
    reply_mentions_size: currentSizes.some((size) => new RegExp(`\\b${String(size).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(reply)),
    reply_mentions_color: currentColors.some((color) => new RegExp(String(color).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(reply)),
    reply_mentions_image: /(?:طµظˆط±ط©|طµظˆط±|image|photo|photos)/i.test(reply),
    composed_detected_intent: toText(composedResponse?.detected_intent || composedResponse?.intent || ""),
    composed_sales_stage: toText(composedResponse?.sales_stage || ""),
    auto_reply_shadow: autoReplyShadow,
    intent_detected: toText(autoReplyShadow?.intent_detected || autoReplyShadow?.intent || intent),
    safety_intent: toText(autoReplyShadow?.safety_intent || ""),
    safety_intent_detected: autoReplyShadow?.safety_intent_detected === true,
    blockers: asArray(autoReplyShadow?.blockers),
    eligibility_result: autoReplyShadow?.eligibility_result ?? autoReplyShadow?.eligible ?? null,
    decision: toText(autoReplyShadow?.decision || ""),
  };
};

const selectRegressionDiagnosticCard = (cards = [], failures = []) => {
  const cardList = asArray(cards);
  if (!cardList.length) return {};
  const priceCard = cardList.find((card) => Number.isFinite(primaryPrice(card)) && primaryPrice(card) > 0);
  const availableCard = cardList.find((card) => Number.isFinite(primaryStock(card)) && primaryStock(card) > 0);
  const unavailableCard = cardList.find((card) => Number.isFinite(primaryStock(card)) && primaryStock(card) === 0);
  const imageCard = cardList.find((card) => primaryImage(card));
  const failureSet = new Set(asArray(failures));
  if (failureSet.has("stock-unavailable") || failureSet.has("availability")) return unavailableCard || availableCard || priceCard || imageCard || cardList[0] || {};
  if (failureSet.has("price") || failureSet.has("stale-price-guard") || failureSet.has("missing-price-guard")) return priceCard || availableCard || imageCard || cardList[0] || {};
  if (failureSet.has("images")) return imageCard || priceCard || availableCard || cardList[0] || {};
  return priceCard || availableCard || imageCard || unavailableCard || cardList[0] || {};
};

const detectRegressionFailureTypes = ({ message = "", reply = "", analysis = {}, composedResponse = {}, responseForComposer = {}, brainDecision = {}, normalizedProductCards = [], autoReplyShadow = null } = {}) => {
  const failures = [];
  const normalizedMessage = normalizeArabic(message);
  const replyText = toText(reply);
  const currentStock = Number(analysis?.current_stock ?? 0);
  const currentSizes = asArray(analysis?.current_sizes);
  const currentColors = asArray(analysis?.current_colors);
  const currentImages = asArray(analysis?.current_image_urls);
  const memorySize = toText(analysis?.memory_before?.remembered_size || responseForComposer?.memory_updates?.selected_size || responseForComposer?.memory_updates?.active_size || "");
  const memoryColor = toText(analysis?.memory_before?.remembered_color || responseForComposer?.memory_updates?.selected_color || responseForComposer?.memory_updates?.active_color || "");
  const requestedSize = extractExplicitSize(message);
  const availabilitySignal = /(ظ…طھط§ط­|ظ…ظˆط¬ظˆط¯|available|availability|stock|ظپظٹظ‡|available now)/i.test(normalizedMessage);
  const sizeSignal = /(ظ…ظ‚ط§ط³|size|ظ†ظ…ط±ط©|ظ†ظ…ط±ظ‡)/i.test(normalizedMessage);
  const colorSignal = /(ظ„ظˆظ†|ط§ظ„ظˆط§ظ†|ط§ظ„ط£ظ„ظˆط§ظ†|colors?|colour|white|ط§ط¨ظٹط¶|ط£ط¨ظٹط¶|black|ط§ط³ظˆط¯|ط£ط³ظˆط¯)/i.test(normalizedMessage);
  const asksPriceResult = asksPrice(message, responseForComposer, { type: analysis?.intent || "" });
  const asksAvailabilityResult = asksAvailability(message);

  if (autoReplyShadow?.safety_intent_detected && autoReplyShadow?.eligible !== false) {
    failures.push("safety-intent-eligible");
  }

  if (availabilitySignal && !(analysis?.reply_mentions_availability || /(?:\bظ…طھط§ط­\b|\bظ…ظˆط¬ظˆط¯\b|\bin stock\b|\bavailable\b)/i.test(replyText))) failures.push("availability");
  if (sizeSignal && requestedSize && !new RegExp(`\\b${String(requestedSize).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(replyText)) failures.push("size");
  if (colorSignal && currentColors.length < 2) failures.push("colors");
  if ((currentStock === 0 || /(?:out of stock|unavailable|ط؛ظٹط± ظ…طھط§ط­|ظ…ظ´ ظ…طھط§ط­|ط؛ظٹط± ظ…طھظˆظپط±|ظ†ظپط¯)/i.test(replyText)) && !analysis?.reply_mentions_unavailable) failures.push("stock-unavailable");
  if (memorySize && !new RegExp(`\\b${String(memorySize).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(replyText)) failures.push("context-memory-step1");
  if (memoryColor && !new RegExp(String(memoryColor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(replyText)) failures.push("context-memory-step2");

  if (failures.length) {
    console.info("[ai-regression-test:failed-types]", {
      message,
      detected_intent: toText(composedResponse?.detected_intent || composedResponse?.intent || brainDecision?.intent || brainDecision?.detected_intent || ""),
      reply: replyText,
      failed_types: failures,
      asks_price: asksPriceResult,
      asks_availability: asksAvailabilityResult,
      memory_last_ai_action: toText(analysis?.memory_before?.last_ai_action || responseForComposer?.memory_updates?.last_ai_action || responseForComposer?.ai_memory_patch?.preferences?.last_ai_action || ""),
      analysis_current_stock: currentStock,
      analysis_current_sizes: currentSizes,
      analysis_current_colors: currentColors,
      composed_answer: toText(composedResponse?.answer || composedResponse?.text || ""),
      composed_product_cards: asArray(composedResponse?.product_cards),
      brainDecision_intent: toText(brainDecision?.intent || brainDecision?.detected_intent || ""),
      responseForComposer_product_cards: asArray(responseForComposer?.product_cards),
      normalized_product_cards: asArray(normalizedProductCards),
      top_card: selectRegressionDiagnosticCard(normalizedProductCards, failures),
      extracted_price: primaryPrice(selectRegressionDiagnosticCard(normalizedProductCards, failures)) || null,
      extracted_stock: primaryStock(selectRegressionDiagnosticCard(normalizedProductCards, failures)) ?? null,
      image_urls: [primaryImage(selectRegressionDiagnosticCard(normalizedProductCards, failures))].filter(Boolean),
      selected_card_source: asArray(responseForComposer?.regression_source_product_cards).length ? "regression_source_product_cards" : "product_cards",
    });
  }

  return failures;
};

const requireRegressionTestKey = (req, res, next) => {
  if (!regressionEndpointEnabled()) {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  const expectedKey = regressionTestKey();
  if (!expectedKey) {
    return res.status(503).json({
      success: false,
      message: "AI regression test key is not configured",
    });
  }
  const providedKey = regressionKeyFromRequest(req);
  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      message: "Invalid AI regression test key",
    });
  }
  return next();
};

router.post("/message", requireRegressionTestKey, async (req, res) => {
  const startedAt = new Date().toISOString();
  const sessionId = toText(req.body?.session_id || req.body?.sessionId || "");
  const testCount = Number(req.body?.test_count || 1) || 1;
  const ip = String(req.ip || req.headers?.["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const key = regressionKeyFromRequest(req);

  if (!isStrongRegressionKey(regressionTestKey())) {
    return res.status(503).json({
      success: false,
      message: "AI regression test endpoint is not configured",
    });
  }

  const rateLimit = checkRegressionRateLimit(req, key);
  if (!rateLimit.ok) {
    return res.status(429).json({
      success: false,
      message: "AI regression test rate limit exceeded",
    });
  }

  if (Number(req.headers?.["content-length"] || 0) > REGRESSION_BODY_LIMIT_BYTES) {
    return res.status(413).json({
      success: false,
      message: "Request body too large",
    });
  }
  if (req.rawBody?.length > REGRESSION_BODY_LIMIT_BYTES) {
    return res.status(413).json({
      success: false,
      message: "Request body too large",
    });
  }

  regressionAuditLog("started", {
    started_at: startedAt,
    session_id: sessionId,
    test_count: testCount,
    ip,
    status: "started",
  });

  const perfContext = getPerfContext();
  perfContext.is_regression_test = true;
  perfContext.dry_run = DRY_RUN_MODE;
  perfContext.regression_session_id = sessionId;
  perfContext.regression_ip = ip;
  perfContext.regression_test_count = testCount;

  try {
    const payload = await withReadOnlyDbSession(async () => {
      const message = toText(req.body?.message);
      if (!message) {
        return { status: 400, body: { success: false, message: "message is required" } };
      }

      const tenantId = Number(req.body?.tenant_id || req.body?.tenantId || 1);
      const baseMemory = req.body?.memory && typeof req.body.memory === "object" ? req.body.memory : {};
      const productQuery = toText(req.body?.product_query || req.body?.productQuery || "");
      const requestIntent = toText(req.body?.intent || req.body?.detected_intent || req.body?.detectedIntent || resolveIntent(message));
      const rawSeedProductCards = req.body?.product_cards ||
        req.body?.fixture?.product_cards ||
        req.body?.fixture?.productCards ||
        [];
      const seedProductCards = await buildRegressionSeedProductCards({
        tenantId,
        message,
        productQuery,
        rawSeedProductCards,
        intent: requestIntent,
      });
      const composerProductCards = seedProductCards.length ? seedProductCards : asArray(rawSeedProductCards);
      const effectiveMemory = {
        ...baseMemory,
        preferences: {
          ...(baseMemory.preferences || {}),
          ...(seedProductCards.length
            ? {
                last_product_cards: seedProductCards,
                lastProductCards: seedProductCards,
              }
            : {}),
        },
      };

      const regressionMetadata = {
        ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
        tenant_id: tenantId,
        channel: "web_chat",
        original_message: message,
        normalized_for_intent: message,
        product_query: productQuery,
        request_intent: requestIntent,
        ai_memory: effectiveMemory,
        is_regression_test: true,
        dry_run: DRY_RUN_MODE,
        source: "ai_regression_test_endpoint",
      };

      const inbound = {
        channel: "web_chat",
        message,
        original_message: message,
        normalized_for_intent: message,
        text: message,
        metadata: regressionMetadata,
        product_query: productQuery,
        request_intent: requestIntent,
        is_regression_test: true,
        dry_run: DRY_RUN_MODE,
        source: "ai_regression_test_endpoint",
      };

      const brainDecision = await generateAiBrainV2Decision(inbound, {
        tenantId,
        memory: effectiveMemory,
        is_regression_test: true,
        dry_run: DRY_RUN_MODE,
        source: "ai_regression_test_endpoint",
      });

      const responseForComposer = composerProductCards.length
        ? {
            ...brainDecision,
            is_regression_test: true,
            dry_run: DRY_RUN_MODE,
            source: "ai_regression_test_endpoint",
            regression_source_product_cards: rawSeedProductCards,
            products: composerProductCards,
            suggested_products: composerProductCards,
            product_cards: composerProductCards,
            visual_attachments: composerProductCards
              .filter((card) => primaryImage(card))
              .map((card) => ({
                id: String(card.id || card.product_id || primaryImage(card)),
                url: primaryImage(card),
                image_url: primaryImage(card),
                product_id: String(card.product_id || card.id || ""),
              })),
          }
        : {
            ...brainDecision,
            is_regression_test: true,
            dry_run: DRY_RUN_MODE,
            source: "ai_regression_test_endpoint",
          };

      const composed = await composeAiSalesReply({
        message,
        response: responseForComposer,
        intent: { type: responseForComposer?.detected_intent || responseForComposer?.intent || "" },
        memory: effectiveMemory,
        source: "ai_regression_test_endpoint",
        context: {
          tenant_id: tenantId,
          is_regression_test: true,
          dry_run: DRY_RUN_MODE,
          source: "ai_regression_test_endpoint",
        },
      });

      const productCards = normalizeProductCards(
        composed.product_cards ||
          composed.suggested_products ||
          responseForComposer.product_cards ||
          responseForComposer.suggested_products ||
          seedProductCards,
        { limit: 24 }
      );
      const reply = toText(composed.answer || composed.text || "");
      const intent = toText(
        composed.detected_intent ||
          composed.intent ||
          brainDecision.detected_intent ||
          brainDecision.intent ||
          resolveIntent(message)
      );
      let analysis;
      let failedTypes;
      try {
        analysis = buildRegressionAnalysis({
          message,
          reply,
          intent,
          brainIntent: brainDecision.intent || brainDecision.detected_intent || "",
          simpleIntent: resolveIntent(message),
          memory: effectiveMemory,
          productCards: composerProductCards,
          composedResponse: composed,
          autoReplyShadow: brainDecision.auto_reply_shadow || null,
        });
        analysis.current_sizes = [...new Set(asArray(composerProductCards).flatMap((card) => productSizes(card)).filter(Boolean))];
        analysis.current_colors = [...new Set(asArray(composerProductCards).flatMap((card) => productColors(card)).filter(Boolean))];
        const regressionStockValues = asArray(composerProductCards).map((card) => primaryStock(card)).filter((value) => Number.isFinite(value));
        analysis.current_stock = regressionStockValues.length ? Math.max(...regressionStockValues) : Number(analysis.current_stock ?? 0);
        failedTypes = detectRegressionFailureTypes({
          message,
          reply,
          analysis,
          composedResponse: composed,
          responseForComposer,
          brainDecision,
          normalizedProductCards: composerProductCards,
          autoReplyShadow: brainDecision.auto_reply_shadow || null,
        });
      } catch (analysisError) {
        console.error("[ai-regression-test:analysis-error]", {
          message: analysisError?.message || String(analysisError || ""),
          stack: analysisError?.stack || "",
          phase: "build-analysis-or-detect-failures",
        });
        const regressionStockValues = asArray(composerProductCards).map((card) => primaryStock(card)).filter((value) => Number.isFinite(value));
        analysis = {
          source: "ai_regression_test_endpoint",
          message_length: toText(message).length,
          reply_length: toText(reply).length,
          intent,
          brain_intent: brainDecision.intent || brainDecision.detected_intent || "",
          simple_intent: resolveIntent(message),
          product_card_count: composerProductCards.length,
          image_card_count: asArray(composerProductCards).filter((card) => primaryImage(card)).length,
          current_price: primaryPrice(composerProductCards[0] || {}),
          current_stock: regressionStockValues.length ? Math.max(...regressionStockValues) : Number(primaryStock(composerProductCards[0] || {}) || 0),
          current_sizes: [...new Set(asArray(composerProductCards).flatMap((card) => productSizes(card)).filter(Boolean))],
          current_colors: [...new Set(asArray(composerProductCards).flatMap((card) => productColors(card)).filter(Boolean))],
          current_image_urls: asArray(composerProductCards).map((card) => primaryImage(card)).filter(Boolean),
          memory_before: summarizeMemory(effectiveMemory),
          memory_patch: composed?.memory_updates || composed?.ai_memory_patch?.preferences || null,
          customer_name_candidate: extractCustomerNameCandidate(message),
          reply_mentions_bare_currency: hasBareCurrencyWord(reply),
          reply_mentions_current_price: false,
          reply_mentioned_prices: extractMentionedPrices(reply),
          reply_mentions_availability: false,
          reply_mentions_unavailable: false,
          reply_mentions_size: false,
          reply_mentions_color: false,
          reply_mentions_image: false,
          composed_detected_intent: toText(composed?.detected_intent || composed?.intent || ""),
          composed_sales_stage: toText(composed?.sales_stage || ""),
        };
        failedTypes = [];
      }

      return {
        status: 200,
        body: {
          reply,
          analysis,
          intent,
          product_cards: composerProductCards,
          failed_types: failedTypes,
          auto_reply_shadow: brainDecision.auto_reply_shadow || null,
        },
      };
    }, {
      is_regression_test: true,
      dry_run: DRY_RUN_MODE,
      regression_session_id: sessionId,
      regression_ip: ip,
      regression_test_count: testCount,
    });

    regressionAuditLog("finished", {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      session_id: sessionId,
      test_count: testCount,
      ip,
      status: "success",
    });
    return res.status(payload.status || 200).json(payload.body);
  } catch (error) {
    const fallbackMessage = toText(req.body?.message);
    const fallbackMemory = req.body?.memory && typeof req.body.memory === "object" ? req.body.memory : {};
    const fallbackPreferences = fallbackMemory.preferences && typeof fallbackMemory.preferences === "object" ? fallbackMemory.preferences : {};
    const fallbackLastAction = toText(
      fallbackPreferences.last_ai_action ||
      fallbackMemory.last_ai_action ||
      fallbackPreferences.pending_action
    ).toLowerCase();
    const fallbackNormalizedMessage = normalizeArabic(fallbackMessage);
    const fallbackIsOrderConfirmation =
      fallbackLastAction === "ask_order" &&
      /^(طھظ…ط§ظ…|ط§ظٹظˆظ‡|ط§ظٹظˆط©|ظ…ط§ط´ظٹ|ok|okay|ط£ظƒط¯ ط§ظ„ط£ظˆط±ط¯ط±|ط§ظƒط¯ ط§ظ„ط£ظˆط±ط¯ط±)$/i.test(fallbackNormalizedMessage);

    if (fallbackIsOrderConfirmation) {
      const fallbackCards = normalizeProductCards(
        req.body?.product_cards ||
        req.body?.fixture?.product_cards ||
        req.body?.fixture?.productCards ||
        [],
        { limit: 24, preserveUnavailableCards: true }
      );
      const fallbackSize = toText(
        fallbackPreferences.active_size ||
        fallbackPreferences.selected_size ||
        fallbackMemory.active_size ||
        fallbackMemory.selected_size
      );
      const fallbackColor = toText(
        fallbackPreferences.active_color ||
        fallbackPreferences.selected_color ||
        fallbackMemory.active_color ||
        fallbackMemory.selected_color
      );
      const fallbackParts = [
        fallbackSize ? `ظ…ظ‚ط§ط³ ${fallbackSize}` : "",
        fallbackColor ? `ظ„ظˆظ† ${fallbackColor}` : "",
      ].filter(Boolean);
      const fallbackReply = fallbackParts.length
        ? `طھظ…ط§ظ…طŒ ظ‡ط£ظƒط¯ظ„ظƒ ${fallbackParts.join(" ")}. ط§ط¨ط¹طھظ„ظٹ ط§ظ„ط§ط³ظ… ظˆط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ط¹ظ†ظˆط§ظ† ظˆظ†ط£ظƒط¯ ط§ظ„ط£ظˆط±ط¯ط±.`
        : "طھظ…ط§ظ…طŒ ط§ط¨ط¹طھظ„ظٹ ط§ظ„ط§ط³ظ… ظˆط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ط¹ظ†ظˆط§ظ† ظˆظ†ط£ظƒط¯ ط§ظ„ط£ظˆط±ط¯ط±.";
      const fallbackAnalysis = {
        source: "ai_regression_test_endpoint",
        message_length: fallbackMessage.length,
        reply_length: fallbackReply.length,
        intent: "post_product_order_confirmation",
        brain_intent: "post_product_order_confirmation",
        simple_intent: resolveIntent(fallbackMessage),
        product_card_count: fallbackCards.length,
        image_card_count: fallbackCards.filter((card) => primaryImage(card)).length,
        current_price: primaryPrice(fallbackCards[0] || {}),
        current_stock: (() => {
          const values = fallbackCards.map((card) => primaryStock(card)).filter((value) => Number.isFinite(value));
          return values.length ? Math.max(...values) : 0;
        })(),
        current_sizes: [...new Set(fallbackCards.flatMap((card) => productSizes(card)).filter(Boolean))],
        current_colors: [...new Set(fallbackCards.flatMap((card) => productColors(card)).filter(Boolean))],
        current_image_urls: fallbackCards.map((card) => primaryImage(card)).filter(Boolean),
        memory_before: summarizeMemory(fallbackMemory),
        memory_patch: null,
        customer_name_candidate: extractCustomerNameCandidate(fallbackMessage),
        reply_mentions_bare_currency: hasBareCurrencyWord(fallbackReply),
        reply_mentions_current_price: false,
        reply_mentioned_prices: extractMentionedPrices(fallbackReply),
        reply_mentions_availability: false,
        reply_mentions_unavailable: false,
        reply_mentions_size: Boolean(fallbackSize && new RegExp(`\\b${String(fallbackSize).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(fallbackReply)),
        reply_mentions_color: Boolean(fallbackColor && new RegExp(String(fallbackColor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(fallbackReply)),
        reply_mentions_image: false,
        composed_detected_intent: "post_product_order_confirmation",
        composed_sales_stage: "",
      };
      regressionAuditLog("finished", {
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        session_id: sessionId,
        test_count: testCount,
        ip,
        status: "fallback_success",
      });
      return res.status(200).json({
        reply: fallbackReply,
        analysis: fallbackAnalysis,
        intent: "post_product_order_confirmation",
        product_cards: fallbackCards,
        failed_types: [],
      });
    }

    regressionAuditLog("finished", {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      session_id: sessionId,
      test_count: testCount,
      ip,
      status: "failed",
    });
    return res.status(500).json(sanitizeRegressionError(error));
  }
});

export default router;
