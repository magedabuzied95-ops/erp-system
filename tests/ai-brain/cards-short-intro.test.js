import test from "node:test";
import assert from "node:assert/strict";

import { CARDS_INTRO_TEXT, rewriteStructuredDecision } from "../../server/services/aiUnifiedDecisionService.js";

// The owner, 2026-10-19, on a photo answered with colours listed, a grade explanation, a price and
// a link: "مش عايز كل الكلام ده ولا اللينكات دى كلها — عايز ايوه متاح ان شاء الله والكروت بتاعه الالوان كفايه".

const cards = [
  { name: "Adidas UltraBoost22 - Black", color: "Black", grade: "mirror_original", price: 1850 },
  { name: "Adidas UltraBoost22 - White/Black", color: "White/Black", grade: "mirror_original", price: 1850 },
];

test("product cards go out under one short line, no list and no link", async () => {
  const decision = { intent: "product_search", text: "أيوه يا فندم، عندنا موديلات … شوفه من هنا: https://m1store-egy.com/shop/x", product_cards: cards };
  const out = await rewriteStructuredDecision({ decision, inbound: { text: "دا موجود؟" } });
  assert.equal(out.text, CARDS_INTRO_TEXT);
  assert.equal(out.channel_reply.text, CARDS_INTRO_TEXT);
  assert.doesNotMatch(out.text, /https?:\/\//);
  assert.equal(out.product_cards.length, 2, "the cards themselves are untouched");
});

test("a colour just picked keeps the booking question", async () => {
  const out = await rewriteStructuredDecision({ decision: { intent: "post_product_color_selected", text: "long", product_cards: cards.slice(0, 1) }, inbound: { text: "الاسود" } });
  assert.equal(out.text, `${CARDS_INTRO_TEXT}\nتحب أحجزهولك؟`);
});

test("a gender miss keeps its own honest sentence", async () => {
  const miss = "للأسف مش لاقي الترا جو حريمي، بس دي أقرب حاجة:";
  const out = await rewriteStructuredDecision({
    decision: { intent: "product_search", text: miss, product_cards: cards, debug: { audience_reply: { text: miss, label: "حريمي", exact: false } } },
    inbound: { text: "الترا جو حريمي" },
  });
  assert.notEqual(out.text, CARDS_INTRO_TEXT, "never 'متاح' over a miss");
});
