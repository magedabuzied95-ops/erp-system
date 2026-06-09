#!/usr/bin/env node

const baseUrl = String(process.env.RENDER_API_BASE_URL || "").trim().replace(/\/+$/, "");
const regressionKey = String(process.env.AI_REGRESSION_TEST_KEY || "").trim();

const fail = (message, details = {}) => {
  const error = new Error(message);
  error.details = details;
  throw error;
};

const assert = (condition, message, details = {}) => {
  if (!condition) fail(message, details);
};

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeArabic = (value = "") =>
  lower(value)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsAny = (value = "", terms = []) => {
  const normalized = normalizeArabic(value);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
};

const extractMentionedPrices = (reply = "") =>
  Array.from(String(reply).matchAll(/(\d[\d,.]*)\s*جنيه/gi))
    .map((match) => Number(String(match[1]).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);

const hasBareCurrencyWord = (reply = "") =>
  /(^|[^\d])جنيه\b/i.test(String(reply)) && !/\d\s*جنيه\b/i.test(String(reply));

const isProbablyAvailable = (reply = "") =>
  /(?:\bمتاح\b|\bموجود\b|\bin stock\b|\bavailable\b)/i.test(String(reply));

const isProbablyUnavailable = (reply = "") =>
  /(?:غير\s*متاح|غير\s*موجود|نفد|out of stock|unavailable|مش\s*متاح|مش\s*موجود|غير\s*متوفر)/i.test(String(reply));

const englishLetterRatio = (value = "") => {
  const raw = text(value);
  if (!raw) return 0;
  const englishCount = (raw.match(/[a-z]/gi) || []).length;
  return englishCount / raw.length;
};

const looksColdGreeting = (reply = "") =>
  /^(اهلا وسهلا|أهلا وسهلا|كيف يمكنني مساعدتك|كيف اقدر اساعدك|how can i help)/i.test(text(reply));

const replyTooLong = (reply = "", max = 280) => text(reply).length > max;

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

const colorsFromCards = (cards = []) =>
  [...new Set(cards.flatMap((card) => [
    ...asArray(card.colors),
    ...asArray(card.available_colors),
    ...asArray(card.variants).flatMap((variant) => [variant?.color, variant?.color_name]),
    card.color,
  ].map(text).filter(Boolean)))];

const sizesFromCards = (cards = []) =>
  [...new Set(cards.flatMap((card) => [
    ...asArray(card.sizes),
    ...asArray(card.available_sizes),
    ...asArray(card.variants).map((variant) => variant?.size),
    card.size,
  ].map(text).filter(Boolean)))];

const productCardSummary = (card = {}) => ({
  id: text(card.id || card.product_id),
  name: text(card.name || card.title || card.product_name),
  price: priceFromCard(card),
  stock: stockFromCard(card),
  sizes: sizesFromCards([card]),
  colors: colorsFromCards([card]),
  image_url: imageFromCard(card),
});

const requestTimeout = 90_000;

const requestJson = async (payload, label, allowHttpStatus = null) => {
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
      if (allowHttpStatus && response.status === allowHttpStatus) {
        return {
          ...json,
          __httpStatus: response.status,
        };
      }
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
  material: "جلد وشمواه",
  origin: "Vietnam",
  use_case: "casual",
  gender: "men",
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

const redCard = {
  ...baseCard,
  id: "regression-card-j4-red",
  product_id: "regression-card-j4-red",
  color: "أحمر",
  image_url: "https://example.com/regression/j4-red.jpg",
  url: "https://example.com/regression/j4-red.jpg",
};

const runningCard = {
  ...baseCard,
  id: "regression-card-running",
  product_id: "regression-card-running",
  name: "Nike Pegasus Run",
  title: "Nike Pegasus Run",
  base_name: "Nike Pegasus Run",
  model_name: "Nike Pegasus Run",
  material: "Mesh",
  use_case: "running",
  color: "أزرق",
  colors: ["أزرق", "أسود"],
  image_url: "https://example.com/regression/pegasus-blue.jpg",
  url: "https://example.com/regression/pegasus-blue.jpg",
};

const womenCard = {
  ...baseCard,
  id: "regression-card-women",
  product_id: "regression-card-women",
  name: "Adidas Samba Women",
  title: "Adidas Samba Women",
  gender: "women",
  color: "أبيض",
  colors: ["أبيض", "بيج"],
  image_url: "https://example.com/regression/samba-women.jpg",
  url: "https://example.com/regression/samba-women.jpg",
};

const kidsCard = {
  ...baseCard,
  id: "regression-card-kids",
  product_id: "regression-card-kids",
  name: "Jordan Kids",
  title: "Jordan Kids",
  gender: "kids",
  available_sizes: ["31", "32", "33"],
  sizes: ["31", "32", "33"],
  variants: [
    { size: "31", stock: 2, color: "أسود", color_name: "أسود" },
    { size: "32", stock: 1, color: "أبيض", color_name: "أبيض" },
    { size: "33", stock: 1, color: "أحمر", color_name: "أحمر" },
  ],
  image_url: "https://example.com/regression/jordan-kids.jpg",
  url: "https://example.com/regression/jordan-kids.jpg",
};

const budgetCard = {
  ...baseCard,
  id: "regression-card-budget",
  product_id: "regression-card-budget",
  name: "Nike Court Low",
  title: "Nike Court Low",
  price: 2599,
  sale_price: 2399,
  final_price: 2399,
  image_url: "https://example.com/regression/court-low.jpg",
  url: "https://example.com/regression/court-low.jpg",
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

const makePayload = ({ message, productCards = [baseCard], memory = {}, tenantId = 1, sessionId = "", testCount = 1 } = {}) => {
  const resolvedSessionId = sessionId || `regression-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    tenant_id: tenantId,
    session_id: resolvedSessionId,
    test_count: testCount,
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

const commonGuards = ({ testCase, response }) => {
  const reply = text(response.reply);
  const analysis = response.analysis || {};
  const message = text(testCase.payload.message);
  const cards = asArray(response.product_cards);
  const expectedCard = asArray(testCase.payload.product_cards)[0] || {};
  const allowedCurrentPrice = priceFromCard(expectedCard);
  const priceMentions = extractMentionedPrices(reply);

  assert(reply, `[${testCase.name}] reply is empty`);
  assert(!hasBareCurrencyWord(reply), `[${testCase.name}] reply contains bare currency word`);
  assert(!/[-–—]\s*جنيه/i.test(reply), `[${testCase.name}] reply contains dash currency`);
  assert(!replyTooLong(reply, testCase.maxReplyLength || 320), `[${testCase.name}] reply is too long`);
  if (testCase.category === "greeting") {
    assert(!looksColdGreeting(reply), `[${testCase.name}] greeting reply is too cold`);
  }
  if (!/[a-z]/i.test(message)) {
    assert(englishLetterRatio(reply) < 0.35, `[${testCase.name}] reply is unnecessarily English-heavy`);
  }
  if (testCase.expectNoHallucinatedPrice && priceMentions.length && allowedCurrentPrice) {
    assert(priceMentions.every((value) => value === allowedCurrentPrice), `[${testCase.name}] reply hallucinated a wrong price`, {
      reply,
      priceMentions,
      allowedCurrentPrice,
    });
  }
  if (testCase.expectMissingPriceGuard) {
    assert(priceMentions.length === 0, `[${testCase.name}] reply hallucinated a price`);
    assert(/يتأكد|يراجع|السعر/i.test(reply), `[${testCase.name}] reply does not ask to verify the price`);
  }
  if (testCase.expectUnavailable) {
    assert(!isProbablyAvailable(reply), `[${testCase.name}] reply incorrectly claims availability`);
    assert(isProbablyUnavailable(reply), `[${testCase.name}] reply does not communicate unavailability`);
  }
  if (testCase.expectAvailable) {
    assert(isProbablyAvailable(reply), `[${testCase.name}] reply does not claim availability`);
  }
  if (testCase.expectImages) {
    assert(analysis.reply_mentions_image === true || /صور|صورة|image|photo/i.test(reply), `[${testCase.name}] reply ignores images`);
  }
  if (testCase.expectSize) {
    assert(containsAny(reply, [String(testCase.expectSize)]), `[${testCase.name}] reply ignores size ${testCase.expectSize}`);
  }
  if (testCase.expectColor) {
    assert(containsAny(reply, [testCase.expectColor]), `[${testCase.name}] reply ignores color ${testCase.expectColor}`);
  }
  if (testCase.expectCurrentPrice) {
    assert(priceMentions.includes(testCase.expectCurrentPrice), `[${testCase.name}] reply does not mention current price ${testCase.expectCurrentPrice}`);
  }
  if (testCase.expectNoBogusName) {
    assert(analysis.customer_name_candidate === "", `[${testCase.name}] detected a bogus customer name`);
  }
  assert(Array.isArray(cards), `[${testCase.name}] product_cards is missing`);
};

const makeCase = ({
  category,
  name,
  message,
  productCards = [baseCard],
  memory = {},
  expectedBehavior = "",
  suggestedFix = "",
  validate = async () => {},
  maxReplyLength = 320,
  ...flags
}) => ({
  category,
  name,
  payload: makePayload({ message, productCards, memory }),
  expectedBehavior,
  suggestedFix,
  validate,
  maxReplyLength,
  ...flags,
});

const greetingCase = (name, message, expectedTerms) =>
  makeCase({
    category: "greeting",
    name,
    message,
    expectedBehavior: `Reply should use a natural Egyptian greeting and include one of: ${expectedTerms.join(", ")}`,
    suggestedFix: "Adjust greeting-only reply selection in aiSalesReplyComposerService / aiHumanSalesPersonalityLayer.",
    validate: async ({ reply }) => {
      assert(containsAny(reply, expectedTerms), `[${name}] reply does not use the expected greeting style`, { reply, expectedTerms });
    },
    maxReplyLength: 140,
  });

const productCase = ({
  name,
  message,
  productCards = [baseCard],
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags
}) => makeCase({
  category: "product_details",
  name,
  message,
  productCards,
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags,
});

const buyingCase = ({
  name,
  message,
  productCards = [baseCard],
  memory = {},
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags
}) => makeCase({
  category: "buying_flow",
  name,
  message,
  productCards,
  memory,
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags,
});

const objectionCase = ({ name, message, expectedBehavior, suggestedFix, validate, ...flags }) => makeCase({
  category: "objections",
  name,
  message,
  productCards: [baseCard],
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags,
});

const memoryCase = ({
  name,
  message,
  productCards = [baseCard],
  memory = {},
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags
}) => makeCase({
  category: "memory",
  name,
  message,
  productCards,
  memory,
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags,
});

const safetyCase = ({
  name,
  message,
  productCards = [baseCard],
  memory = {},
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags
}) => makeCase({
  category: "safety_guards",
  name,
  message,
  productCards,
  memory,
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags,
});

const unknownCase = ({
  name,
  message,
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags
}) => makeCase({
  category: "unknown_input",
  name,
  message,
  productCards: [baseCard],
  expectedBehavior,
  suggestedFix,
  validate,
  ...flags,
});

const expectAnswerOrFollowup = (reply = "") =>
  /تحب|قولي|قولي|ابعت|مقاس|لون|سعر|صور|موجود|متاح|أساعدك|اساعدك|تحت أمرك|نورتنا|نقدر|أقدر|اقدر/i.test(reply);

const cases = [];

const greetingCases = [
  greetingCase("greeting-salam-1", "السلام عليكم", ["وعليكم السلام ورحمة الله"]),
  greetingCase("greeting-salam-2", "سلام عليكم", ["وعليكم السلام ورحمة الله"]),
  greetingCase("greeting-salam-3", "السلاام عليكم", ["وعليكم السلام ورحمة الله"]),
  greetingCase("greeting-salam-4", "السلامو عليكم", ["وعليكم السلام ورحمة الله"]),
  greetingCase("greeting-morning-1", "صباح الخير", ["صباح الفل", "صباح الورد", "صباح النور", "صباح الجمال"]),
  greetingCase("greeting-morning-2", "صباحو", ["صباح الفل", "صباح الورد", "صباح النور", "صباح الجمال"]),
  greetingCase("greeting-morning-3", "صباح الفل", ["صباح الفل", "صباح الورد", "صباح النور", "صباح الجمال"]),
  greetingCase("greeting-morning-4", "صباح النور", ["صباح الفل", "صباح الورد", "صباح النور", "صباح الجمال"]),
  greetingCase("greeting-evening-1", "مساء الخير", ["مساء الفل", "مساء الورد", "مساء النور", "مساء الجمال"]),
  greetingCase("greeting-evening-2", "مساء الفل", ["مساء الفل", "مساء الورد", "مساء النور", "مساء الجمال"]),
  greetingCase("greeting-evening-3", "مساء الورد", ["مساء الفل", "مساء الورد", "مساء النور", "مساء الجمال"]),
  greetingCase("greeting-evening-4", "مساء النور", ["مساء الفل", "مساء الورد", "مساء النور", "مساء الجمال"]),
  greetingCase("greeting-casual-1", "هاي", ["أهلاً بيك", "نورتنا", "تحت أمرك"]),
  greetingCase("greeting-casual-2", "hi", ["أهلاً بيك", "نورتنا", "تحت أمرك"]),
  greetingCase("greeting-casual-3", "hello", ["أهلاً بيك", "نورتنا", "تحت أمرك"]),
  greetingCase("greeting-casual-4", "أهلا", ["أهلاً بيك", "نورتنا", "تحت أمرك"]),
  greetingCase("greeting-checkin", "عامل ايه", ["الحمد لله", "تمام", "نورتنا", "أساعدك"]),
  greetingCase("greeting-status-1", "في حد موجود؟", ["موجودين", "تحت أمرك", "نساعدك"]),
  greetingCase("greeting-status-2", "انتوا فاتحين؟", ["موجودين", "تحت أمرك", "نساعدك"]),
  greetingCase("greeting-support", "ممكن مساعدة؟", ["أكيد", "تحت أمرك", "نقدر", "أساعدك"]),
];
cases.push(...greetingCases);

const productCases = [
  productCase({
    name: "product-price-1",
    message: "بكام؟",
    expectedBehavior: "Reply should mention the current price.",
    suggestedFix: "Use current product card price in price replies.",
    expectCurrentPrice: 3299,
    expectNoHallucinatedPrice: true,
    validate: async () => {},
  }),
  productCase({
    name: "product-price-2",
    message: "سعره كام؟",
    expectedBehavior: "Reply should mention the current price.",
    suggestedFix: "Use current product card price in price replies.",
    expectCurrentPrice: 3299,
    expectNoHallucinatedPrice: true,
    validate: async () => {},
  }),
  productCase({
    name: "product-price-3",
    message: "اخره كام؟",
    expectedBehavior: "Reply should discuss price naturally and keep it sales-oriented.",
    suggestedFix: "Handle colloquial price questions as price intent.",
    validate: async ({ reply }) => {
      assert(/سعر|خصم|أراجع|3299|3499/i.test(reply), "[product-price-3] reply ignores the price question");
    },
  }),
  productCase({
    name: "product-discount-1",
    message: "فيه خصم؟",
    expectedBehavior: "Reply should answer discount status or explain the current price.",
    suggestedFix: "Handle discount/offer objections explicitly.",
    validate: async ({ reply }) => {
      assert(/خصم|سعر|العرض|السعر الحالي|أراجع/i.test(reply), "[product-discount-1] reply ignores discount question");
    },
  }),
  productCase({
    name: "product-shipping-price-1",
    message: "السعر شامل الشحن؟",
    expectedBehavior: "Reply should mention shipping or clarify that shipping is separate.",
    suggestedFix: "Add shipping-aware pricing reply.",
    validate: async ({ reply }) => {
      assert(/شحن|توصيل|شامل/i.test(reply), "[product-shipping-price-1] reply ignores shipping part");
    },
  }),
  productCase({
    name: "product-price-objection-1",
    message: "ده سعره ليه غالي؟",
    expectedBehavior: "Reply should handle the objection politely.",
    suggestedFix: "Use objection-handling phrasing in human personality layer.",
    validate: async ({ reply }) => {
      assert(/فاهمك|الخامة|الجودة|بديل|قيمة|سعر/i.test(reply), "[product-price-objection-1] reply ignores the objection");
    },
  }),
  productCase({
    name: "product-size-1",
    message: "في منه مقاس 41؟",
    expectedBehavior: "Reply should explicitly mention size 41.",
    suggestedFix: "Use product card sizes for size replies.",
    expectSize: "41",
    validate: async () => {},
  }),
  productCase({
    name: "product-size-2",
    message: "مقاس 42 متاح؟",
    expectedBehavior: "Reply should explicitly mention size 42.",
    suggestedFix: "Use product card sizes for size replies.",
    expectSize: "42",
    validate: async () => {},
  }),
  productCase({
    name: "product-size-3",
    message: "المقاسات المتاحة؟",
    expectedBehavior: "Reply should mention available sizes.",
    suggestedFix: "List available sizes from the product cards.",
    validate: async ({ reply }) => {
      assert(containsAny(reply, ["40", "41", "42"]), "[product-size-3] reply does not mention available sizes");
    },
  }),
  productCase({
    name: "product-colors-1",
    message: "الألوان المتاحة؟",
    expectedBehavior: "Reply should mention available colors.",
    suggestedFix: "List colors from the product cards.",
    validate: async ({ reply }) => {
      assert(containsAny(reply, ["أسود", "أبيض", "أحمر"]), "[product-colors-1] reply does not mention colors");
    },
  }),
  productCase({
    name: "product-colors-2",
    message: "عايز الأبيض",
    expectedBehavior: "Reply should acknowledge white color selection.",
    suggestedFix: "Use requested color in reply composition.",
    expectColor: "أبيض",
    validate: async () => {},
  }),
  productCase({
    name: "product-colors-3",
    message: "عايز الأسود",
    expectedBehavior: "Reply should acknowledge black color selection.",
    suggestedFix: "Use requested color in reply composition.",
    expectColor: "أسود",
    validate: async () => {},
  }),
  productCase({
    name: "product-images-1",
    message: "ابعت صور",
    expectedBehavior: "Reply should mention images.",
    suggestedFix: "Respond to image requests explicitly.",
    expectImages: true,
    validate: async () => {},
  }),
  productCase({
    name: "product-images-2",
    message: "ابعت كل الصور",
    expectedBehavior: "Reply should mention multiple images.",
    suggestedFix: "Respond to image requests explicitly.",
    expectImages: true,
    validate: async () => {},
  }),
  productCase({
    name: "product-images-3",
    message: "صور أكتر",
    expectedBehavior: "Reply should offer additional images.",
    suggestedFix: "Handle follow-up image requests explicitly.",
    expectImages: true,
    validate: async () => {},
  }),
  productCase({
    name: "product-images-4",
    message: "صورة الأبيض",
    productCards: [whiteCard, baseCard],
    expectedBehavior: "Reply should reference white product images.",
    suggestedFix: "Preserve color-specific image context.",
    expectImages: true,
    expectColor: "أبيض",
    validate: async () => {},
  }),
  productCase({
    name: "product-video-1",
    message: "فيه فيديو؟",
    expectedBehavior: "Reply should address the video request directly.",
    suggestedFix: "Handle video/media requests as a media follow-up.",
    validate: async ({ reply }) => {
      assert(/فيديو|صور|أبعت|ابعت|أراجع/i.test(reply), "[product-video-1] reply ignores the video request");
    },
  }),
  productCase({
    name: "product-material-1",
    message: "خامته ايه؟",
    expectedBehavior: "Reply should talk about material or quality.",
    suggestedFix: "Use product material or a safe material answer path.",
    validate: async ({ reply }) => {
      assert(/خامة|جلد|شمواه|mesh|مريح|جودة/i.test(reply), "[product-material-1] reply ignores material question");
    },
  }),
  productCase({
    name: "product-auth-1",
    message: "أصلي ولا ميرور؟",
    expectedBehavior: "Reply should address authenticity carefully.",
    suggestedFix: "Add authenticity-safe reply path.",
    validate: async ({ reply }) => {
      assert(/أصلي|ميرور|خامة|جودة|أوضح|أراجع/i.test(reply), "[product-auth-1] reply ignores authenticity question");
    },
  }),
  productCase({
    name: "product-origin-1",
    message: "Vietnam ولا محلي؟",
    expectedBehavior: "Reply should address origin.",
    suggestedFix: "Use origin/manufacturing context when available.",
    validate: async ({ reply }) => {
      assert(/vietnam|محلي|منشأ|خامة|أراجع/i.test(reply), "[product-origin-1] reply ignores origin question");
    },
  }),
  productCase({
    name: "product-running-1",
    message: "مناسب للجري؟",
    productCards: [runningCard],
    expectedBehavior: "Reply should address running suitability.",
    suggestedFix: "Use use-case signals in reply composition.",
    validate: async ({ reply }) => {
      assert(/جري|running|مناسب|مريح/i.test(reply), "[product-running-1] reply ignores running use case");
    },
  }),
  productCase({
    name: "product-work-1",
    message: "مناسب للشغل؟",
    expectedBehavior: "Reply should address work suitability.",
    suggestedFix: "Handle practical-use questions explicitly.",
    validate: async ({ reply }) => {
      assert(/شغل|مناسب|مريح|ستايل/i.test(reply), "[product-work-1] reply ignores work suitability");
    },
  }),
  productCase({
    name: "product-comfort-1",
    message: "مريح؟",
    expectedBehavior: "Reply should address comfort.",
    suggestedFix: "Handle comfort questions explicitly.",
    validate: async ({ reply }) => {
      assert(/مريح|لبس|مشي|خامة/i.test(reply), "[product-comfort-1] reply ignores comfort");
    },
  }),
  productCase({
    name: "product-weight-1",
    message: "تقيل ولا خفيف؟",
    expectedBehavior: "Reply should address weight or comfort.",
    suggestedFix: "Handle weight questions explicitly.",
    validate: async ({ reply }) => {
      assert(/خفيف|تقيل|مريح|لبس/i.test(reply), "[product-weight-1] reply ignores weight");
    },
  }),
  productCase({
    name: "product-gender-1",
    message: "رجالي ولا حريمي؟",
    productCards: [womenCard],
    expectedBehavior: "Reply should mention the target gender.",
    suggestedFix: "Use gender/product type signals in replies.",
    validate: async ({ reply }) => {
      assert(/رجالي|حريمي|نسائي|ستاتي/i.test(reply), "[product-gender-1] reply ignores gender question");
    },
  }),
  productCase({
    name: "product-kids-1",
    message: "ينفع أطفال؟",
    productCards: [kidsCard],
    expectedBehavior: "Reply should address kids suitability.",
    suggestedFix: "Use kids sizing/product type in replies.",
    validate: async ({ reply }) => {
      assert(/أطفال|kids|صغير|مقاسات/i.test(reply), "[product-kids-1] reply ignores kids question");
    },
  }),
  productCase({
    name: "product-fit-1",
    message: "مقاسه مظبوط ولا أكبر؟",
    expectedBehavior: "Reply should address fit guidance.",
    suggestedFix: "Add fit guidance or safe clarification path.",
    validate: async ({ reply }) => {
      assert(/مقاس|مظبوط|اكبر|أكبر|اصغر|أصغر|لو بتلبس/i.test(reply), "[product-fit-1] reply ignores fit guidance");
    },
  }),
  productCase({
    name: "product-fit-2",
    message: "لو بلبس 42 أجيب كام؟",
    expectedBehavior: "Reply should address size recommendation.",
    suggestedFix: "Handle size recommendation questions explicitly.",
    validate: async ({ reply }) => {
      assert(/42|مقاس|جرب|أجيب|اغلب/i.test(reply), "[product-fit-2] reply ignores size recommendation");
    },
  }),
  productCase({
    name: "product-brand-1",
    message: "عندك نايك؟",
    expectedBehavior: "Reply should acknowledge the Nike request.",
    suggestedFix: "Handle brand discovery naturally.",
    validate: async ({ reply }) => {
      assert(/نايك|nike|موديل|اختيارات|موجود/i.test(reply), "[product-brand-1] reply ignores brand request");
    },
  }),
  productCase({
    name: "product-model-1",
    message: "عندك جوردن فور؟",
    expectedBehavior: "Reply should acknowledge Jordan 4 request.",
    suggestedFix: "Handle product alias discovery naturally.",
    validate: async ({ reply }) => {
      assert(/جوردن|4|موديل|موجود/i.test(reply), "[product-model-1] reply ignores Jordan 4 request");
    },
  }),
  productCase({
    name: "product-model-2",
    message: "عندك جوردن 4؟",
    expectedBehavior: "Reply should acknowledge Jordan 4 request.",
    suggestedFix: "Handle product alias discovery naturally.",
    validate: async ({ reply }) => {
      assert(/جوردن|4|موديل|موجود/i.test(reply), "[product-model-2] reply ignores Jordan 4 request");
    },
  }),
  productCase({
    name: "product-model-3",
    message: "عندك jordan 4؟",
    expectedBehavior: "Reply should acknowledge Jordan 4 request.",
    suggestedFix: "Handle product alias discovery naturally.",
    validate: async ({ reply }) => {
      assert(/جوردن|4|موديل|moved|موجود|jordan/i.test(reply), "[product-model-3] reply ignores Jordan 4 alias");
    },
  }),
  productCase({
    name: "product-model-4",
    message: "عندك j4؟",
    expectedBehavior: "Reply should acknowledge J4 alias.",
    suggestedFix: "Handle product alias discovery naturally.",
    validate: async ({ reply }) => {
      assert(/جوردن|4|موديل|موجود|j4/i.test(reply), "[product-model-4] reply ignores J4 alias");
    },
  }),
  productCase({
    name: "product-model-5",
    message: "عندك aj4؟",
    expectedBehavior: "Reply should acknowledge AJ4 alias.",
    suggestedFix: "Handle product alias discovery naturally.",
    validate: async ({ reply }) => {
      assert(/جوردن|4|موديل|موجود|aj4/i.test(reply), "[product-model-5] reply ignores AJ4 alias");
    },
  }),
  productCase({
    name: "product-budget-1",
    message: "هات الأرخص",
    productCards: [budgetCard, baseCard],
    expectedBehavior: "Reply should move toward a cheaper option.",
    suggestedFix: "Handle budget preference and alternatives.",
    validate: async ({ reply }) => {
      assert(/أرخص|بديل|اختيار|2399|2599|سعر/i.test(reply), "[product-budget-1] reply ignores cheaper-option request");
    },
  }),
  productCase({
    name: "product-alt-1",
    message: "هات بديل",
    productCards: [budgetCard, baseCard],
    expectedBehavior: "Reply should offer an alternative.",
    suggestedFix: "Handle alternative requests explicitly.",
    validate: async ({ reply }) => {
      assert(/بديل|اختيار|أقرب|شبه/i.test(reply), "[product-alt-1] reply ignores alternative request");
    },
  }),
  productCase({
    name: "product-alt-2",
    message: "في موديل شبهه؟",
    productCards: [budgetCard, baseCard],
    expectedBehavior: "Reply should offer a similar option.",
    suggestedFix: "Handle similarity requests explicitly.",
    validate: async ({ reply }) => {
      assert(/بديل|شبه|أقرب|اختيار/i.test(reply), "[product-alt-2] reply ignores similar-model request");
    },
  }),
  productCase({
    name: "product-color-fallback-1",
    message: "لو الأبيض مش موجود في بديل؟",
    productCards: [whiteCard, budgetCard],
    expectedBehavior: "Reply should address white color fallback and alternatives.",
    suggestedFix: "Use color context together with alternatives.",
    validate: async ({ reply }) => {
      assert(/أبيض|بديل|شبه|موجود|أقرب/i.test(reply), "[product-color-fallback-1] reply ignores color fallback");
    },
  }),
  productCase({
    name: "product-colors-4",
    message: "فيه ألوان تانية؟",
    expectedBehavior: "Reply should mention colors.",
    suggestedFix: "Answer color follow-ups from product cards.",
    validate: async ({ reply }) => {
      assert(containsAny(reply, ["أسود", "أبيض", "أحمر", "ألوان"]), "[product-colors-4] reply ignores colors");
    },
  }),
  productCase({
    name: "product-price-4",
    message: "السعر الحالي كام دلوقتي؟",
    expectedBehavior: "Reply should mention current price.",
    suggestedFix: "Always use current card price over memory.",
    expectCurrentPrice: 3299,
    expectNoHallucinatedPrice: true,
    validate: async () => {},
  }),
];
cases.push(...productCases);

const buyingCases = [
  ["buy-flow-1", "عايز أطلب"],
  ["buy-flow-2", "عايز أحجز"],
  ["buy-flow-3", "أكد الأوردر"],
  ["buy-flow-4", "تمام خده"],
  ["buy-flow-5", "ابعتهولي"],
  ["buy-flow-6", "اسمي أحمد"],
  ["buy-flow-7", "رقمي 01012345678"],
  ["buy-flow-8", "العنوان دمياط الجديدة"],
  ["buy-flow-9", "الدفع عند الاستلام؟"],
  ["buy-flow-10", "ينفع أدفع فودافون كاش؟"],
  ["buy-flow-11", "ينفع انستا باي؟"],
  ["buy-flow-12", "عايز أغير المقاس قبل التأكيد"],
  ["buy-flow-13", "عايز أغير اللون"],
  ["buy-flow-14", "كنسل الأوردر"],
  ["buy-flow-15", "ابعتلي لينك الدفع"],
  ["buy-flow-16", "الشحن كام؟"],
  ["buy-flow-17", "يوصل امتى؟"],
  ["buy-flow-18", "ممكن أحجزه للليل؟"],
  ["buy-flow-19", "خلاص أنا جاهز"],
  ["buy-flow-20", "ابعث بيانات الدفع"],
  ["buy-flow-21", "عايز أخلص الطلب"],
  ["buy-flow-22", "احسبلي الإجمالي"],
  ["buy-flow-23", "ممكن أكمل بعدين؟"],
  ["buy-flow-24", "لو غيرت رأيي؟"],
  ["buy-flow-25", "محتاج تفاصيل الطلب"],
].forEach(([name, message]) => {
  cases.push(buyingCase({
    name,
    message,
    expectedBehavior: "Reply should move the conversation toward checkout or answer the buying-flow question.",
    suggestedFix: "Strengthen buying-intent and checkout collection replies.",
    validate: async ({ reply }) => {
      assert(expectAnswerOrFollowup(reply), `[${name}] reply does not move the buying flow forward`);
    },
  }));
});

const objectionCases = [
  "غالي",
  "آخر سعر؟",
  "في خصم؟",
  "شفته أرخص",
  "ليه أغلى من بره؟",
  "هفكر",
  "مش متأكد",
  "ممكن صور طبيعية؟",
  "خايف المقاس ميطلعش مظبوط",
  "لو طلع مش مناسب؟",
  "الضمان؟",
  "الاستبدال؟",
  "الاسترجاع؟",
  "مش عاجبني",
  "عندك بديل أرخص؟",
  "ممكن تتأكد تاني؟",
  "خايف من الخامة",
  "لو المنتج مش زي الصور؟",
  "محتاج ضمان للمقاس",
  "طب لو ما عجبنيش؟",
].forEach((message, index) => {
  const name = `objection-${index + 1}`;
  cases.push(objectionCase({
    name,
    message,
    expectedBehavior: "Reply should reassure or handle the objection politely.",
    suggestedFix: "Strengthen objection handling in the human personality layer.",
    validate: async ({ reply }) => {
      assert(/فاهمك|بديل|استبدال|استرجاع|صور|مقاس|أراجع|نقدر|أقدر|جودة|خامة|سياسة/i.test(reply), `[${name}] reply does not handle the objection`);
    },
  }));
});

const memoryCases = [
  memoryCase({
    name: "memory-1",
    message: "مقاس 41",
    productCards: [baseCard, whiteCard],
    memory: { preferences: { last_ai_action: "ask_size", last_product_cards: [baseCard, whiteCard] } },
    expectedBehavior: "Reply should acknowledge size 41.",
    suggestedFix: "Preserve ask_size context and mention the chosen size.",
    expectSize: "41",
    validate: async () => {},
  }),
  memoryCase({
    name: "memory-2",
    message: "نفسه بس أبيض",
    productCards: [whiteCard, baseCard],
    memory: { preferences: { last_product_cards: [baseCard, whiteCard], active_product_id: baseCard.product_id, active_size: "41", active_color: "أسود", last_ai_action: "ask_color" } },
    expectedBehavior: "Reply should preserve size 41 and acknowledge white color.",
    suggestedFix: "Keep remembered size while applying the requested color.",
    expectColor: "أبيض",
    validate: async ({ reply, analysis }) => {
      assert(analysis.memory_before.remembered_size === "41", "[memory-2] remembered size is missing");
      assert(containsAny(reply, ["41", "أبيض"]), "[memory-2] reply does not use remembered product context");
    },
  }),
  memoryCase({
    name: "memory-3",
    message: "ابعت صور الأبيض",
    productCards: [whiteCard, baseCard],
    memory: { preferences: { last_product_cards: [whiteCard, baseCard], active_product_id: whiteCard.product_id, active_size: "41", active_color: "أبيض", last_ai_action: "ask_color" } },
    expectedBehavior: "Reply should mention white images.",
    suggestedFix: "Preserve color context for image follow-ups.",
    expectImages: true,
    expectColor: "أبيض",
    validate: async () => {},
  }),
  memoryCase({
    name: "memory-4",
    message: "تمام",
    productCards: [whiteCard],
    memory: { preferences: { last_product_cards: [whiteCard], active_product_id: whiteCard.product_id, active_size: "41", active_color: "أبيض", last_ai_action: "ask_order" } },
    expectedBehavior: "Reply should ask for order details.",
    suggestedFix: "Respect ask_order memory state on confirmation.",
    validate: async ({ reply }) => {
      assert(/الاسم|الموبايل|العنوان|رقم/i.test(reply), "[memory-4] reply does not request order details");
    },
    expectNoBogusName: true,
  }),
  memoryCase({
    name: "memory-5",
    message: "اسمي أحمد",
    productCards: [whiteCard],
    memory: { preferences: { last_product_cards: [whiteCard], active_product_id: whiteCard.product_id, active_size: "41", active_color: "أبيض", last_ai_action: "ask_order" } },
    expectedBehavior: "Reply should continue collecting remaining order details.",
    suggestedFix: "Continue checkout collection when one field arrives.",
    validate: async ({ reply }) => {
      assert(/موبايل|العنوان|رقم/i.test(reply), "[memory-5] reply does not continue checkout collection");
    },
  }),
  memoryCase({
    name: "memory-6",
    message: "رقمي 01012345678",
    productCards: [whiteCard],
    memory: { preferences: { last_product_cards: [whiteCard], active_product_id: whiteCard.product_id, active_size: "41", active_color: "أبيض", last_ai_action: "ask_order", customer_name: "أحمد" } },
    expectedBehavior: "Reply should ask for address or remaining order data.",
    suggestedFix: "Continue collecting remaining checkout fields.",
    validate: async ({ reply }) => {
      assert(/العنوان|تفصيل|باقي/i.test(reply), "[memory-6] reply does not ask for the remaining address");
    },
  }),
  memoryCase({
    name: "memory-7",
    message: "العنوان دمياط الجديدة",
    productCards: [whiteCard],
    memory: { preferences: { last_product_cards: [whiteCard], active_product_id: whiteCard.product_id, active_size: "41", active_color: "أبيض", last_ai_action: "ask_order", customer_name: "أحمد", customer_phone: "01012345678" } },
    expectedBehavior: "Reply should move to confirmation.",
    suggestedFix: "Confirm order when required fields are present.",
    validate: async ({ reply }) => {
      assert(/أكد|تأكيد|الأوردر|الطلب|جاهز/i.test(reply), "[memory-7] reply does not move to confirmation");
    },
  }),
  memoryCase({
    name: "memory-8",
    message: "السعر كام دلوقتي؟",
    productCards: [staleNewCard],
    memory: { preferences: { last_product_cards: [staleOldCard], active_product_id: staleOldCard.product_id, last_product_id: staleOldCard.product_id } },
    expectedBehavior: "Reply should use the current price, not the stale one.",
    suggestedFix: "Prefer current product cards over memory prices.",
    expectCurrentPrice: 3599,
    expectNoHallucinatedPrice: true,
    validate: async ({ reply }) => {
      assert(!extractMentionedPrices(reply).includes(2499), "[memory-8] reply still mentions stale price");
    },
  }),
  memoryCase({
    name: "memory-9",
    message: "هات صور تانية",
    productCards: [baseCard],
    memory: { preferences: { last_product_cards: [baseCard], active_product_id: baseCard.product_id, active_size: "41", last_ai_action: "ask_color" } },
    expectedBehavior: "Reply should preserve product context and mention images.",
    suggestedFix: "Keep active product context on image follow-ups.",
    expectImages: true,
    validate: async () => {},
  }),
  memoryCase({
    name: "memory-10",
    message: "عايز الأسود",
    productCards: [baseCard, whiteCard],
    memory: { preferences: { last_product_cards: [whiteCard, baseCard], active_product_id: whiteCard.product_id, active_size: "41", last_ai_action: "ask_color" } },
    expectedBehavior: "Reply should switch to black while keeping size context.",
    suggestedFix: "Update color while preserving size/product memory.",
    expectColor: "أسود",
    validate: async ({ reply }) => {
      assert(containsAny(reply, ["41", "أسود"]), "[memory-10] reply loses remembered context");
    },
  }),
];

for (let index = 11; index <= 20; index += 1) {
  cases.push(memoryCase({
    name: `memory-${index}`,
    message: index % 2 === 0 ? "مقاس 41" : "نفسه بس أبيض",
    productCards: index % 2 === 0 ? [baseCard, whiteCard] : [whiteCard, baseCard],
    memory: {
      preferences: index % 2 === 0
        ? { last_ai_action: "ask_size", last_product_cards: [baseCard, whiteCard], active_product_id: baseCard.product_id }
        : { last_ai_action: "ask_color", last_product_cards: [baseCard, whiteCard], active_product_id: baseCard.product_id, active_size: "41", active_color: "أسود" },
    },
    expectedBehavior: "Reply should preserve active product memory and answer the follow-up directly.",
    suggestedFix: "Keep size/color memory stable across short follow-ups.",
    validate: async ({ reply }) => {
      assert(expectAnswerOrFollowup(reply), `[memory-${index}] reply is too generic for a memory follow-up`);
    },
  }));
}
cases.push(...memoryCases);

const safetyCases = [
  safetyCase({
    name: "safety-1",
    message: "بكام؟",
    productCards: [missingPriceCard],
    expectedBehavior: "Reply must not invent a price when no price exists.",
    suggestedFix: "Keep missing-price guard strict.",
    expectMissingPriceGuard: true,
    validate: async () => {},
  }),
  safetyCase({
    name: "safety-2",
    message: "السعر كام دلوقتي؟",
    productCards: [staleNewCard],
    memory: { preferences: { last_product_cards: [staleOldCard], active_product_id: staleOldCard.product_id } },
    expectedBehavior: "Reply must use the current price and ignore stale memory.",
    suggestedFix: "Keep stale-price guard strict.",
    expectCurrentPrice: 3599,
    expectNoHallucinatedPrice: true,
    validate: async ({ reply }) => {
      assert(!extractMentionedPrices(reply).includes(2499), "[safety-2] stale memory price leaked into reply");
    },
  }),
  safetyCase({
    name: "safety-3",
    message: "متاح؟",
    productCards: [unavailableCard],
    expectedBehavior: "Reply must not claim availability when stock is zero.",
    suggestedFix: "Keep out-of-stock guard strict.",
    expectUnavailable: true,
    validate: async () => {},
  }),
  safetyCase({
    name: "safety-4",
    message: "أكد الأوردر",
    productCards: [baseCard],
    expectedBehavior: "Reply must not treat order-confirmation phrase as a customer name.",
    suggestedFix: "Keep name guard strict.",
    expectNoBogusName: true,
    validate: async ({ reply }) => {
      assert(!/أكد الأوردر/i.test(reply), "[safety-4] reply reuses the customer phrase as a name");
    },
  }),
  safetyCase({
    name: "safety-5",
    message: "السلام عليكم",
    productCards: [baseCard],
    expectedBehavior: "Greeting reply must not be cold.",
    suggestedFix: "Use Egyptian Islamic greeting reply.",
    validate: async ({ reply }) => {
      assert(!looksColdGreeting(reply), "[safety-5] greeting reply is too cold");
    },
  }),
];

for (let index = 6; index <= 25; index += 1) {
  const message = [
    "بكام؟",
    "متاح؟",
    "ابعت صور",
    "مقاس 41 موجود؟",
    "الألوان المتاحة؟",
    "عايز الأبيض",
    "عايز أطلب",
    "؟؟؟",
    "12345",
    "اه",
    "لا",
    "مش ده",
    "هات بديل",
    "غالي",
    "الشحن كام؟",
    "الدفع عند الاستلام؟",
    "ينفع انستا باي؟",
    "ابعتلي لينك الدفع",
    "صباح الخير",
    "مساء الخير",
  ][(index - 6) % 20];
  cases.push(safetyCase({
    name: `safety-${index}`,
    message,
    productCards: message === "متاح؟" ? [baseCard] : [baseCard],
    expectedBehavior: "Reply should remain safe, concise, and grounded in the current product data.",
    suggestedFix: "Tighten guards for hallucination, overlong answers, and ignored customer intent.",
    validate: async ({ reply, analysis }) => {
      assert(!replyTooLong(reply, 320), `[safety-${index}] reply is too long`);
      assert(!hasBareCurrencyWord(reply), `[safety-${index}] reply contains bare currency`);
      if (message === "متاح؟") assert(analysis.current_stock > 0, `[safety-${index}] stock analysis is missing`);
    },
  }));
}
cases.push(...safetyCases);

const unknownMessages = [
  "كلام عشوائي",
  "🙂🙂🙂",
  "",
  "123456",
  "؟؟؟",
  "اه",
  "تمام",
  "لا",
  "مش ده",
  "التاني",
  "اللون ده",
  "نفسه بس أبيض",
  "هات الأرخص",
  "هات بديل",
  "مش عاجبني",
  "عندك نايك؟",
  "جوردن فور",
  "جوردن 4",
  "jordan 4",
  "aj4",
];

unknownMessages.forEach((message, index) => {
  const name = `unknown-${index + 1}`;
  if (!text(message)) {
    cases.push(makeCase({
      category: "unknown_input",
      name,
      message,
      productCards: [baseCard],
      expectedBehavior: "Endpoint should reject an empty message gracefully with a 400 response.",
      suggestedFix: "Keep empty-message validation explicit and safe.",
      expectHttpStatus: 400,
      validate: async (response) => {
        assert(/message is required/i.test(text(response.message)), `[${name}] empty-message validation message is missing`);
      },
    }));
    return;
  }
  cases.push(unknownCase({
    name,
    message,
    expectedBehavior: "Reply should stay grounded, ask or answer naturally, and avoid hallucinations.",
    suggestedFix: "Improve fallback/general handling without losing commerce context.",
    validate: async ({ reply }) => {
      assert(reply.length > 3, `[${name}] reply is too short`);
      assert(expectAnswerOrFollowup(reply), `[${name}] reply is too generic or non-helpful`);
    },
  }));
});

assert(cases.length >= 150 && cases.length <= 170, `Suite size must stay between 150 and 170 tests; got ${cases.length}`);

const runCase = async (testCase, totalTests) => {
  const payload = {
    ...testCase.payload,
    test_count: totalTests,
  };
  const response = await requestJson(payload, testCase.name, testCase.expectHttpStatus || null);
  if (testCase.expectHttpStatus) {
    assert(response.__httpStatus === testCase.expectHttpStatus, `[${testCase.name}] expected HTTP ${testCase.expectHttpStatus}`);
    await testCase.validate(response);
    return response;
  }
  assert(typeof response === "object" && response !== null, `[${testCase.name}] response is not an object`);
  assert(response.analysis && typeof response.analysis === "object", `[${testCase.name}] analysis is missing`);
  assert(text(response.intent), `[${testCase.name}] intent is empty`);
  commonGuards({ testCase, response });
  await testCase.validate(response);
  return response;
};

const buildFailureRecord = (testCase, error, response = null) => {
  const analysis = response?.analysis || {};
  const cards = asArray(response?.product_cards || testCase.payload?.product_cards);
  return {
    ok: false,
    name: testCase.name,
    category: testCase.category,
    error: error?.message || String(error),
    expected_behavior: testCase.expectedBehavior,
    suggested_fix: testCase.suggestedFix,
    actual_reply: text(response?.reply),
    product_card_used: productCardSummary(cards[0] || {}),
    extracted: {
      price_mentions: extractMentionedPrices(response?.reply || ""),
      current_stock: analysis.current_stock ?? null,
      current_sizes: asArray(analysis.current_sizes),
      current_colors: asArray(analysis.current_colors),
      intent: text(response?.intent),
    },
  };
};

const printSummary = (results, startedAt) => {
  const total = results.length;
  const failures = results.filter((result) => !result.ok);
  const passed = total - failures.length;
  const categorySummary = {};

  for (const result of results) {
    const current = categorySummary[result.category] || { total: 0, passed: 0, failed: 0 };
    current.total += 1;
    current[result.ok ? "passed" : "failed"] += 1;
    categorySummary[result.category] = current;
  }

  console.log(`AI sales regression suite completed: ${passed}/${total} passed in ${Date.now() - startedAt}ms`);
  console.log("Category summary:");
  Object.entries(categorySummary).forEach(([category, summary]) => {
    console.log(`- ${category}: ${summary.passed}/${summary.total} passed`);
  });

  if (failures.length) {
    console.log("Failed categories:");
    [...new Set(failures.map((item) => item.category))].forEach((category) => console.log(`- ${category}`));
    console.log("Failure details:");
    failures.forEach((failure) => {
      console.log(`- ${failure.name} [${failure.category}]`);
      console.log(`  actual reply: ${failure.actual_reply || "<empty>"}`);
      console.log(`  expected behavior: ${failure.expected_behavior}`);
      console.log(`  suggested fix: ${failure.suggested_fix}`);
      console.log(`  product card used: ${JSON.stringify(failure.product_card_used)}`);
      console.log(`  extracted: ${JSON.stringify(failure.extracted)}`);
      console.log(`  error: ${failure.error}`);
    });
  }
};

const main = async () => {
  const startedAt = Date.now();
  const results = [];

  for (const testCase of cases) {
    process.stdout.write(`Running ${testCase.name}... `);
    try {
      const response = await runCase(testCase, cases.length);
      results.push({ name: testCase.name, category: testCase.category, ok: true, response });
      process.stdout.write("ok\n");
    } catch (error) {
      results.push(buildFailureRecord(testCase, error, error?.details?.response || null));
      process.stdout.write("FAIL\n");
      console.error(`  ${error?.message || String(error)}`);
    }
  }

  printSummary(results, startedAt);
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
