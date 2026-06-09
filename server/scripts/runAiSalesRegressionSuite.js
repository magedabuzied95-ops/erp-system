#!/usr/bin/env node

const baseUrl = String(process.env.RENDER_API_BASE_URL || "").trim().replace(/\/+$/, "");
const regressionKey = String(process.env.AI_REGRESSION_TEST_KEY || "").trim();

const fail = (message) => {
  throw new Error(message);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const normalizeArabic = (value = "") =>
  lower(value)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

const extractMentionedPrices = (reply = "") =>
  Array.from(String(reply).matchAll(/(\d[\d,.]*)\s*جنيه/gi))
    .map((match) => Number(String(match[1]).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);

const hasBareCurrencyWord = (reply = "") =>
  /(^|[^\d])جنيه\b/i.test(String(reply)) && !/\d\s*جنيه\b/i.test(String(reply));

const isProbablyAvailable = (reply = "") =>
  /(?:\bمتاح\b|\bموجود\b|\bin stock\b|\bavailable\b)/i.test(String(reply));

const isProbablyUnavailable = (reply = "") =>
  /(?:غير\s*متاح|غير\s*موجود|نفد|out of stock|unavailable)/i.test(String(reply));

const containsAny = (reply = "", terms = []) => terms.some((term) => normalizeArabic(reply).includes(normalizeArabic(term)));

const priceFromCard = (card = {}) => {
  for (const candidate of [card.final_price, card.sale_price, card.price, card.selling_price, card.display_price]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
};

const stockFromCard = (card = {}) => {
  for (const candidate of [card.stock, card.quantity, card.available_stock, card.total_stock]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
};

const imageFromCard = (card = {}) => text(card.image_url || card.image || card.url || card.main_image || card.thumbnail);

const requestTimeout = 90_000;

const requestJson = async (payload, label) => {
  if (!baseUrl) fail("RENDER_API_BASE_URL is required");
  if (!regressionKey) fail("AI_REGRESSION_TEST_KEY is required");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out waiting for ${label}`)), requestTimeout);

  try {
    const response = await fetch(`${baseUrl}/api/ai/regression-test/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ai-regression-test-key": regressionKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`[${label}] HTTP ${response.status}: ${json?.message || JSON.stringify(json) || "request failed"}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
};

const baseCard = {
  id: "regression-card-j4-black",
  product_id: "regression-card-j4-black",
  name: "Nike Air Jordan 4 Retro",
  title: "Nike Air Jordan 4 Retro",
  base_name: "Nike Air Jordan 4 Retro",
  model_name: "Nike Air Jordan 4 Retro",
  brand: "Nike",
  color: "أسود",
  colors: ["أسود", "أبيض", "أحمر"],
  price: 3499,
  sale_price: 3299,
  final_price: 3299,
  stock: 5,
  total_stock: 5,
  available_sizes: ["40", "41", "42"],
  sizes: ["40", "41", "42"],
  variants: [
    { size: "40", stock: 2, color: "أسود", color_name: "أسود" },
    { size: "41", stock: 2, color: "أبيض", color_name: "أبيض" },
    { size: "42", stock: 1, color: "أحمر", color_name: "أحمر" },
  ],
  image_url: "https://example.com/regression/j4-black.jpg",
  url: "https://example.com/regression/j4-black.jpg",
  product_url: "https://example.com/regression/j4-black",
};

const whiteCard = {
  ...baseCard,
  id: "regression-card-j4-white",
  product_id: "regression-card-j4-white",
  color: "أبيض",
  image_url: "https://example.com/regression/j4-white.jpg",
  url: "https://example.com/regression/j4-white.jpg",
};

const staleOldCard = {
  ...baseCard,
  price: 2499,
  sale_price: 2499,
  final_price: 2499,
  image_url: "https://example.com/regression/j4-old-price.jpg",
};

const staleNewCard = {
  ...baseCard,
  price: 3799,
  sale_price: 3599,
  final_price: 3599,
  image_url: "https://example.com/regression/j4-new-price.jpg",
};

const missingPriceCard = {
  ...baseCard,
  id: "regression-card-missing-price",
  product_id: "regression-card-missing-price",
  price: undefined,
  sale_price: undefined,
  final_price: undefined,
  display_price: undefined,
  image_url: "https://example.com/regression/missing-price.jpg",
};

const unavailableCard = {
  ...baseCard,
  id: "regression-card-unavailable",
  product_id: "regression-card-unavailable",
  stock: 0,
  total_stock: 0,
  variants: [
    { size: "40", stock: 0, color: "أسود", color_name: "أسود" },
    { size: "41", stock: 0, color: "أبيض", color_name: "أبيض" },
  ],
  image_url: "https://example.com/regression/unavailable.jpg",
};

const makePayload = ({ message, productCards = [baseCard], memory = {}, tenantId = 1, sessionId = "" } = {}) => {
  const resolvedSessionId = sessionId || `regression-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    tenant_id: tenantId,
    session_id: resolvedSessionId,
    test_count: 1,
    message,
    product_cards: productCards,
    memory,
    metadata: {
      session_id: resolvedSessionId,
      is_regression_test: true,
      dry_run: true,
      source: "ai_regression_test_endpoint",
    },
  };
};

const runCase = async ({ name, payload, validate, expectProductCards = true }) => {
  const response = await requestJson(payload, name);
  assert(typeof response === "object" && response !== null, `[${name}] response is not an object`);
  assert(text(response.reply), `[${name}] reply is empty`);
  assert(response.analysis && typeof response.analysis === "object", `[${name}] analysis is missing`);
  assert(text(response.intent), `[${name}] intent is empty`);
  if (expectProductCards) {
    assert(Array.isArray(response.product_cards), `[${name}] product_cards is missing`);
  }
  await validate(response);
  return response;
};

const suite = [];

suite.push({
  name: "price",
  payload: makePayload({ message: "بكام؟", productCards: [baseCard] }),
  validate: async ({ reply, analysis }) => {
    const expected = priceFromCard(baseCard);
    assert(expected, "[price] expected price is missing from fixture");
    assert(extractMentionedPrices(reply).includes(expected), `[price] reply does not mention expected price ${expected}`);
    assert(!hasBareCurrencyWord(reply), "[price] reply uses bare currency word without a number");
    assert(analysis.reply_mentions_current_price === true, "[price] analysis did not detect the current price");
  },
});

suite.push({
  name: "availability",
  payload: makePayload({ message: "متاح؟", productCards: [baseCard] }),
  validate: async ({ reply, analysis }) => {
    assert(stockFromCard(baseCard) > 0, "[availability] fixture must be in stock");
    assert(isProbablyAvailable(reply), "[availability] reply does not claim availability");
    assert(!isProbablyUnavailable(reply), "[availability] reply incorrectly says the item is unavailable");
    assert(analysis.current_stock > 0, "[availability] analysis current_stock is not positive");
  },
});

suite.push({
  name: "size",
  payload: makePayload({ message: "مقاس 41 موجود؟", productCards: [baseCard] }),
  validate: async ({ reply, analysis }) => {
    assert(normalizeArabic(reply).includes("41"), "[size] reply does not mention size 41");
    assert(analysis.reply_mentions_size === true, "[size] analysis did not detect the requested size");
  },
});

suite.push({
  name: "colors",
  payload: makePayload({ message: "فيه ألوان؟", productCards: [baseCard] }),
  validate: async ({ reply, analysis }) => {
    assert(containsAny(reply, ["أسود", "أبيض", "أحمر"]) || analysis.reply_mentions_color === true, "[colors] reply does not mention colors");
    assert(Array.isArray(analysis.current_colors) && analysis.current_colors.length >= 2, "[colors] analysis does not expose colors");
  },
});

suite.push({
  name: "images",
  payload: makePayload({ message: "ابعت صور", productCards: [baseCard] }),
  validate: async ({ reply, analysis, product_cards }) => {
    assert(product_cards.some((card) => imageFromCard(card)), "[images] no image url returned in product_cards");
    assert(analysis.current_image_urls.length > 0, "[images] analysis does not contain image urls");
    assert(analysis.reply_mentions_image === true || /صور|صورة/i.test(reply), "[images] reply does not mention images");
  },
});

suite.push({
  name: "buy-intent",
  payload: makePayload({ message: "عايز اشتريه", productCards: [baseCard] }),
  validate: async ({ reply, analysis, intent }) => {
    assert(text(intent), "[buy-intent] intent is empty");
    assert(/تحب|مقاس|الاسم|موبايل|حجز|اوردر/i.test(reply), "[buy-intent] reply does not move toward purchase");
    assert(!analysis.reply_mentions_bare_currency, "[buy-intent] reply contains bare currency word");
  },
});

suite.push({
  name: "confirm-order",
  payload: makePayload({
    message: "تمام",
    productCards: [baseCard],
    memory: {
      preferences: {
        last_ai_action: "ask_order",
        active_product_id: baseCard.product_id,
        active_size: "41",
        active_color: "أسود",
        last_product_cards: [baseCard],
      },
    },
  }),
  validate: async ({ reply, analysis }) => {
    assert(/الاسم|الموبايل|العنوان|رقم/i.test(reply), "[confirm-order] reply does not ask for order details");
    assert(analysis.customer_name_candidate === "", "[confirm-order] detected a bogus customer name");
  },
});

suite.push({
  name: "shipping",
  payload: makePayload({ message: "الشحن كام و بياخد وقت قد ايه؟", productCards: [baseCard] }),
  validate: async ({ reply }) => {
    assert(reply.length > 10, "[shipping] reply is too short");
    assert(!hasBareCurrencyWord(reply), "[shipping] reply uses bare currency word");
  },
});

suite.push({
  name: "returns",
  payload: makePayload({ message: "لو المقاس ما ناسبنيش ارجع او ابدل ازاي؟", productCards: [baseCard] }),
  validate: async ({ reply }) => {
    assert(reply.length > 10, "[returns] reply is too short");
  },
});

suite.push({
  name: "typo-slang-arabic",
  payload: makePayload({ message: "بكامه يا باشا و في الوانه ايه؟", productCards: [baseCard] }),
  validate: async ({ reply, analysis }) => {
    assert(reply.length > 10, "[typo-slang-arabic] reply is too short");
    assert(analysis.product_card_count > 0, "[typo-slang-arabic] no product cards returned");
  },
});

suite.push({
  name: "stale-price-guard",
  payload: makePayload({
    message: "السعر كام دلوقتي؟",
    productCards: [staleNewCard],
    memory: {
      preferences: {
        last_product_cards: [staleOldCard],
        active_product_id: staleOldCard.product_id,
        last_product_id: staleOldCard.product_id,
      },
    },
  }),
  validate: async ({ reply }) => {
    const newPrice = priceFromCard(staleNewCard);
    const oldPrice = priceFromCard(staleOldCard);
    assert(extractMentionedPrices(reply).includes(newPrice), `[stale-price-guard] reply does not mention current price ${newPrice}`);
    assert(!extractMentionedPrices(reply).includes(oldPrice), `[stale-price-guard] reply still mentions stale price ${oldPrice}`);
  },
});

suite.push({
  name: "missing-price-guard",
  payload: makePayload({ message: "بكام؟", productCards: [missingPriceCard] }),
  validate: async ({ reply, analysis }) => {
    assert(!extractMentionedPrices(reply).length, "[missing-price-guard] reply hallucinated a price");
    assert(!analysis.reply_mentions_current_price, "[missing-price-guard] analysis incorrectly claims a current price");
    assert(/يتأكد|راجع|السعر/i.test(reply), "[missing-price-guard] reply does not ask to verify the price");
  },
});

suite.push({
  name: "stock-unavailable",
  payload: makePayload({ message: "متاح؟", productCards: [unavailableCard] }),
  validate: async ({ reply, analysis }) => {
    assert(stockFromCard(unavailableCard) === 0, "[stock-unavailable] fixture must be out of stock");
    assert(!isProbablyAvailable(reply), "[stock-unavailable] reply incorrectly claims availability");
    assert(isProbablyUnavailable(reply) || /يتأكد|مش متاح|غير متاح|غير موجود/i.test(reply), "[stock-unavailable] reply does not communicate unavailability");
    assert(analysis.current_stock === 0, "[stock-unavailable] analysis current_stock is not zero");
  },
});

suite.push({
  name: "name-guard",
  payload: makePayload({ message: "أكد الأوردر", productCards: [baseCard] }),
  validate: async ({ analysis, reply }) => {
    assert(analysis.customer_name_candidate === "", "[name-guard] customer name candidate should be empty");
    assert(!/أكد الأوردر/i.test(reply), "[name-guard] reply reuses the confirmation phrase as a customer name");
  },
});

suite.push({
  name: "context-memory-step1",
  payload: makePayload({
    message: "مقاس 41",
    productCards: [baseCard, whiteCard],
    memory: {
      preferences: {
        last_ai_action: "ask_size",
        last_product_cards: [baseCard, whiteCard],
      },
    },
  }),
  validate: async ({ reply }) => {
    assert(normalizeArabic(reply).includes("41"), "[context-memory-step1] reply does not mention the selected size");
  },
});

suite.push({
  name: "context-memory-step2",
  payload: makePayload({
    message: "نفسه بس أبيض",
    productCards: [whiteCard, baseCard],
    memory: {
      preferences: {
        last_product_cards: [baseCard, whiteCard],
        active_product_id: baseCard.product_id,
        active_size: "41",
        active_color: "أسود",
        last_ai_action: "ask_color",
      },
    },
  }),
  validate: async ({ reply, analysis }) => {
    assert(analysis.memory_before.remembered_size === "41", "[context-memory-step2] size memory was not preserved");
    assert(/أبيض|white/i.test(reply) || analysis.reply_mentions_color, "[context-memory-step2] reply does not use remembered color context");
    assert(analysis.memory_before.remembered_product_id, "[context-memory-step2] product id memory is missing");
  },
});

const main = async () => {
  const startedAt = Date.now();
  const results = [];
  let failures = 0;

  for (const testCase of suite) {
    process.stdout.write(`Running ${testCase.name}... `);
    try {
      const response = await runCase(testCase);
      results.push({ name: testCase.name, ok: true, response });
      process.stdout.write("ok\n");
    } catch (error) {
      failures += 1;
      results.push({ name: testCase.name, ok: false, error: error?.message || String(error) });
      process.stdout.write("FAIL\n");
      console.error(`  ${error?.message || String(error)}`);
    }
  }

  const total = results.length;
  const passed = total - failures;
  console.log(`AI sales regression suite completed: ${passed}/${total} passed in ${Date.now() - startedAt}ms`);

  if (failures > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
