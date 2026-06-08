import assert from "node:assert/strict";
import { composeAiSalesReply } from "../services/aiSalesReplyComposerService.js";

const productCard = {
  id: "product-1",
  product_id: "product-1",
  name: "Jordan 4 Black",
  title: "Jordan 4 Black",
  price: 1850,
  final_price: 1850,
  sizes: ["41", "42", "43"],
  colors: ["Black"],
  image_url: "https://example.com/jordan-4-black.jpg",
};

const imageCard = {
  id: "image-1",
  image_url: "https://example.com/jordan-4-black-detail.jpg",
  url: "https://example.com/jordan-4-black-detail.jpg",
  title: "Jordan 4 detail",
};

const legacyPhrases = [
  "لو عندك مقاس معين قولي عليه",
  "الموديل ده مش متوفر حاليًا",
  ];

const runCase = async ({
  name,
  response,
  expectedLegacy,
  expectReplaced,
  expectedSignals = [],
}) => {
  const result = await composeAiSalesReply({
    message: "اختبار",
    response,
    source: "test_ai_commerce_card_replies",
  });

  assert.deepEqual(result.product_cards || [], response.product_cards || [], `${name}: product_cards should be preserved`);
  assert.deepEqual(result.image_cards || [], response.image_cards || [], `${name}: image_cards should be preserved`);

  if (expectReplaced) {
    assert.notEqual(result.answer, expectedLegacy, `${name}: legacy fallback should be replaced`);
  } else {
    assert.equal(result.answer, expectedLegacy, `${name}: legacy fallback should remain allowed without cards`);
  }

  if (expectedSignals.length) {
    assert.ok(expectedSignals.some((phrase) => String(result.answer || "").includes(phrase)), `${name}: reply should sound commerce-aware`);
  }

  return result;
};

const main = async () => {
  const case1 = await runCase({
    name: "product_cards_size_prompt",
    response: {
      answer: legacyPhrases[0],
      detected_intent: "product_discovery",
      suggested_products: [productCard],
      product_cards: [productCard],
      image_cards: [],
      suggested_actions: ["ask_size"],
    },
    expectedLegacy: legacyPhrases[0],
    expectReplaced: true,
    expectedSignals: ["بديل شبه", "أطلعلك", "تحب", "سعره", "المقاسات المتاحة", "اختيار"],
  });
  assert.ok(!/لو عندك مقاس معين قولي عليه/.test(case1.answer), "case1: size-only legacy prompt must be removed");

  const case2 = await runCase({
    name: "product_cards_unavailable",
    response: {
      answer: legacyPhrases[1],
      detected_intent: "product_discovery",
      suggested_products: [productCard],
      product_cards: [productCard],
      image_cards: [],
    },
    expectedLegacy: legacyPhrases[1],
    expectReplaced: true,
  });
  assert.ok(/بديل شبه|أطلعلك|اختيار|تحب/i.test(case2.answer), "case2: reply should be replaced with a commerce-aware alternative");

  const case3 = await runCase({
    name: "image_cards_nearest_choice",
    response: {
      answer: "\u062f\u0647 \u0623\u0642\u0631\u0628 \u0627\u062e\u062a\u064a\u0627\u0631 \u0628\u0635\u0631\u064a",
      detected_intent: "image_request",
      suggested_products: [],
      product_cards: [],
      image_cards: [imageCard],
      visual_attachments: [imageCard],
    },
    expectedLegacy: "\u062f\u0647 \u0623\u0642\u0631\u0628 \u0627\u062e\u062a\u064a\u0627\u0631 \u0628\u0635\u0631\u064a",
    expectReplaced: true,
    expectedSignals: ["لقيت", "اختيارات", "صورة", "كروت", "أطلعلك"],
  });
  assert.ok(/صورة مرفقة|بص على الكروت تحت|اختيار مناسب|اختيارات مناسبة|قولّي/i.test(case3.answer), "case3: image-card reply should stay commerce-aware");

  const case4 = await composeAiSalesReply({
    message: "اختبار",
    response: {
      answer: legacyPhrases[0],
      detected_intent: "general",
      suggested_products: [],
      product_cards: [],
      image_cards: [],
    },
    source: "test_ai_commerce_card_replies",
  });
  assert.deepEqual(case4.product_cards || [], [], "case4: no-card fallback should not invent product cards");
  assert.deepEqual(case4.image_cards || [], [], "case4: no-card fallback should not invent image cards");
  assert.ok(/تقصد|موديل|مقاس|أقدر/i.test(case4.answer), "case4: no-card generic fallback should still be allowed");

  console.log("AI commerce-card regression passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

