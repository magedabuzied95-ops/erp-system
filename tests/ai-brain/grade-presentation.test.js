import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";
import { toChatPlainText } from "../../server/utils/chatPlainText.js";
import { PRODUCT_GRADES, productGradeRank } from "../../server/config/productGrades.js";

/**
 * The owner, 2026-10-19: show the customer the local pairs first with their cards, then the
 * mirror ones with theirs, and explain the difference in material professionally. Production's
 * "متاح ايرفورس ؟" had five local Air Force rows and one mirror_original row; the first local
 * pair's colours filled all six cards, so the mirror pair was never offered. The same reply also
 * reached Messenger with Markdown (**…**, [هنا](…)) printed literally.
 */

// Production's Air Force rows (grades and prices as in the catalog), each with two colours.
const rows = {
  25: { id: 25, name: "Nike Air Force 1  Sneakers", grade: "local", stock: 33, total_stock: 0, price: 650 },
  191: { id: 191, name: "Nike Air Force", grade: "local", stock: 12, total_stock: 0, price: 350 },
  197: { id: 197, name: "Nike Air Force Half", grade: "local", stock: 8, total_stock: 0, price: 600 },
  // More local rows than the six slots, all ahead of the mirror row in id order.
  26: { id: 26, name: "Nike Air Force Low 26", grade: "local", stock: 4, total_stock: 0, price: 500 },
  27: { id: 27, name: "Nike Air Force Low 27", grade: "local", stock: 4, total_stock: 0, price: 500 },
  28: { id: 28, name: "Nike Air Force Low 28", grade: "local", stock: 4, total_stock: 0, price: 500 },
  29: { id: 29, name: "Nike Air Force Low 29", grade: "local", stock: 4, total_stock: 0, price: 500 },
  30: { id: 30, name: "Nike Air Force Low 30", grade: "local", stock: 4, total_stock: 0, price: 500 },
  31: { id: 31, name: "Nike Air Force Low 31", grade: "local", stock: 4, total_stock: 0, price: 500 },
  61: { id: 61, name: "Nike Air Force 1", grade: "mirror_original", stock: 107, total_stock: 0, price: 1850 },
};
// Like production: the one mirror_original Air Force product is in stock in 16 colours.
const MIRROR_COLOURS = ["White", "Black", "Olive", "Red", "Navy", "Grey", "Beige", "Brown", "Pink", "Green", "Gold", "Silver", "Cream", "Orange", "Purple", "Blue"];
const colourVariants = (id) => id === 61
  ? MIRROR_COLOURS.map((color, index) => ({ id: 6100 + index, size: "42", color, stock: 3, is_active: true, image_url: `https://cdn.example.test/61-${index}.jpg` }))
  : [
  { id: id * 10 + 1, size: "41", color: "White", stock: 5, is_active: true, image_url: `https://cdn.example.test/${id}-w.jpg` },
  { id: id * 10 + 2, size: "42", color: "Black", stock: 5, is_active: true, image_url: `https://cdn.example.test/${id}-b.jpg` },
];
pool.query = async (sql, params = []) => {
  const query = String(sql);
  if (query.includes("information_schema.columns")) {
    const columns = {
      products: ["id", "name", "grade", "status", "stock", "total_stock", "price", "tenant_id", "image_url"],
      product_variants: ["id", "product_id", "size", "color", "stock", "is_active", "image_url"],
    }[params[0]] || [];
    return { rows: columns.map((column_name) => ({ column_name })) };
  }
  const withDefaults = (row) => ({ status: "active", tenant_id: 1, image_url: `https://cdn.example.test/${row.id}.jpg`, ...row });
  if (/FROM products p\s+WHERE 1 = 1/.test(query)) return { rows: Object.values(rows).map(withDefaults) };
  if (query.includes("AS variants")) {
    const row = rows[Number(params[0])];
    return { rows: row ? [{ ...withDefaults(row), variants: colourVariants(row.id), product_variant_images: [] }] : [] };
  }
  return { rows: [] };
};

process.env.AI_SUPPORT_ENABLED = "false";
const { generateUnifiedConversationDecision, gradeGuideFor, safeProductFacts } = await import("../../server/services/aiUnifiedDecisionService.js");
const { pickAcrossGrades } = await import("../../server/services/aiBrainV2Service.js");

const ask = (message) => generateUnifiedConversationDecision({
  channel: "facebook_messenger",
  externalConversationId: "test:grades",
  externalCustomerId: "playground",
  text: message,
  // These tests are about laying out a multi-grade answer; the grade question (2026-10-23) comes first live.
  metadata: { tenant_id: 1, channel: "facebook_messenger", source: "ai_playground", ai_memory: {}, no_grade_question: true },
}, { tenantId: 1, memory: {} });

test("a model sold in two grades is offered in both, local first", async () => {
  const decision = await ask("متاح ايرفورس ؟");
  const grades = (decision.product_cards || []).map((card) => card.grade);
  assert.ok(grades.includes("local") && grades.includes("mirror_original"), `grades on screen: ${JSON.stringify(grades)}`);
  const ranks = grades.map(productGradeRank);
  assert.deepEqual(ranks, [...ranks].sort((left, right) => left - right), `local cards come before mirror ones: ${JSON.stringify(grades)}`);
  assert.ok(decision.product_cards.every((card) => card.grade_label), "each card says its grade in Arabic");
});

test("the rewrite is told each product's grade and the owner's note on it", () => {
  const products = [{ name: "a", grade: "mirror_original" }, { name: "b", grade: "local" }, { name: "c", grade: "local" }];
  assert.equal(safeProductFacts(products[0]).grade_label, "ميرور اوريجينال");
  assert.deepEqual(gradeGuideFor(products).map((entry) => entry.grade), ["local", "mirror_original"], "presentation order, each grade once");
  for (const entry of gradeGuideFor(products)) {
    const configured = PRODUCT_GRADES.find((grade) => grade.key === entry.grade);
    assert.equal(entry.note, configured.note);
  }
});

test("round-robin across grades keeps every grade on screen", () => {
  const local = Array.from({ length: 8 }, (_, index) => ({ id: `l${index}`, grade: "local" }));
  const picked = pickAcrossGrades([...local, { id: "m", grade: "mirror_original" }, { id: "v", grade: "imported_from_vietnam" }], 6);
  assert.deepEqual(picked.map((item) => item.grade), ["local", "local", "local", "local", "imported_from_vietnam", "mirror_original"]);
});

test("replies leave as plain chat text", () => {
  const openAiReply = "أيوه يا فندم:\n\n1. **Nike Air Force 1 - White** بسعر 650 جنيه.\n\nتقدر تختار المقاس من [هنا](https://m1store-egy.com/shop/product/x).";
  const plain = toChatPlainText(openAiReply);
  assert.doesNotMatch(plain, /\*\*|\]\(|\[/);
  assert.match(plain, /Nike Air Force 1 - White بسعر 650/);
  assert.match(plain, /https:\/\/m1store-egy\.com\/shop\/product\/x/);
  assert.equal(toChatPlainText("شوف [صفحة المنتج](https://a.test/p)"), "شوف صفحة المنتج: https://a.test/p");
});

test("the confidence re-rank after brain V2 cannot undo local-first", async () => {
  const { normalizeUnifiedDecisionOutput } = await import("../../server/services/aiUnifiedDecisionService.js");
  // A mirror card that matches the words best would be ranked first by confidence alone.
  const cards = [
    { id: 61, product_id: 61, name: "Nike Air Force 1", grade: "mirror_original", grade_label: "ميرور اوريجينال" },
    { id: 25, product_id: 25, name: "Nike Air Force Sneakers", grade: "local", grade_label: "مصري" },
  ];
  const output = normalizeUnifiedDecisionOutput({ text: "x", product_cards: cards, intent: "product_search" }, { originalText: "Nike Air Force 1" });
  assert.deepEqual(output.product_cards.map((card) => card.grade), ["local", "mirror_original"]);
});

test("every grade gets its own run of cards: the 16-colour mirror pair is not cut to 3", async () => {
  // Production, 2026-10-19 (owner's WhatsApp test): 3 local + 3 mirror went out of a 6-card budget
  // shared by both grades, while the one mirror Air Force has 16 colours in stock.
  const decision = await ask("متاح ايرفورس ؟");
  const count = (grade) => decision.product_cards.filter((card) => card.grade === grade).length;
  assert.equal(count("mirror_original"), 10, "a full carousel of mirror colours");
  assert.ok(count("local") >= 5, `local models each show (got ${count("local")})`);
  assert.ok(decision.product_cards.length <= 20);
  const firstMirror = decision.product_cards.findIndex((card) => card.grade === "mirror_original");
  assert.ok(decision.product_cards.slice(firstMirror).every((card) => card.grade === "mirror_original"), "local first, mirror after");
  assert.equal(decision.metadata?.product_card_limit, decision.product_cards.length, "the Meta sender is told not to cut them");
});

test("inside a grade the models take turns before any shows a second colour", async () => {
  const { pickCardsPerGrade } = await import("../../server/services/aiBrainV2Service.js");
  const card = (productId, colour, grade = "local") => ({ product_id: productId, color: colour, grade });
  const picked = pickCardsPerGrade([card(1, "a"), card(1, "b"), card(1, "c"), card(2, "a"), card(3, "a")], { perGrade: 3 });
  assert.deepEqual(picked.map((item) => `${item.product_id}${item.color}`), ["1a", "2a", "3a"]);
});

test("a multi-grade answer opens with one short line; each grade's line goes above its own cards", async () => {
  // The owner, 2026-10-19: the long explanation was too much — "مصري" then its cards, "ميرور
  // اوريجينال" then its cards, and never the word "محلي".
  const { gradeHeaderLine } = await import("../../server/config/productGrades.js");
  const decision = await ask("متاح ايرفورس ؟");
  assert.equal(decision.text, "أيوه يا فندم، Nike Air Force متاح عندنا بدرجتين 👇");
  assert.equal(decision.debug?.grade_intro, "fixed");
  assert.equal(gradeHeaderLine("local"), "🔹 مصري — خامة محترمة");
  assert.equal(gradeHeaderLine("ميرور اوريجينال"), "🔹 ميرور اوريجينال — نسخة طبق الأصل من الأوريجينال في الشكل والخامة والنعل والتفاصيل");
  assert.ok(decision.product_cards.every((card) => card.grade_label !== "محلي"), "no card says محلي");
  assert.ok(decision.product_cards.some((card) => card.grade_label === "مصري"));
});

test("on Messenger and Instagram each grade goes out as its own carousel, under its own line", async () => {
  const { metaCarouselChunks } = await import("../../server/services/metaIntegrationService.js");
  const items = (label, count) => Array.from({ length: count }, (_, index) => ({ card: { grade_label: label, id: `${label}${index}` } }));
  const chunks = metaCarouselChunks([...items("مصري", 5), ...items("ميرور اوريجينال", 10)]);
  assert.deepEqual(chunks.map((chunk) => [chunk.label, chunk.items.length]), [["مصري", 5], ["ميرور اوريجينال", 10]]);
  const fs = await import("node:fs");
  const meta = fs.readFileSync(new URL("../../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  assert.match(meta, /messageText: gradeHeaderLine\(chunk\.label\)/, "the line above each carousel is the shared grade line");
  assert.deepEqual(metaCarouselChunks(items("", 12)).map((chunk) => [chunk.label, chunk.items.length]), [["", 10], ["", 2]], "ungraded lists keep the plain 10-card split");
});

test("the card builder keeps a card's grade", async () => {
  const { normalizeProductCards } = await import("../../server/services/aiProductCards.js");
  const [card] = normalizeProductCards([{ id: 61, name: "Nike Air Force 1", price: 1850, image_url: "https://cdn.example.test/61.jpg", grade: "mirror_original", grade_label: "ميرور اوريجينال" }]);
  assert.equal(card.grade_label, "ميرور اوريجينال");
});

test("brain V2 answers a bare greeting short, in two parts, end to end", async () => {
  const decision = await ask("السلام عليكم");
  assert.equal(decision.intent, "greeting");
  assert.deepEqual(decision.reply_parts, ["وعليكم السلام ورحمة الله", "تحت أمر حضرتك؟"]);
  assert.equal(decision.text, "وعليكم السلام ورحمة الله\nتحت أمر حضرتك؟");
  assert.equal((decision.product_cards || []).length, 0, "no products for a greeting");
});

test("a gender-aware answer survives the multi-grade introduction", async () => {
  const { multiGradeIntroText } = await import("../../server/services/aiUnifiedDecisionService.js");
  const cards = [{ name: "Nike Air Force 1 - White", grade: "local" }, { name: "Nike Air Force 1 - Olive", grade: "mirror_original" }];
  const guide = gradeGuideFor(cards);
  const missed = multiGradeIntroText(guide, cards, { exact: false, label: "حريمي", text: "للأسف مش لاقي Air Force حريمي دلوقتي. ده المتاح منه رجالي:" });
  assert.equal(missed, "للأسف مش لاقي Air Force حريمي دلوقتي. ده المتاح منه رجالي، بدرجتين 👇");
  const exact = multiGradeIntroText(guide, cards, { exact: true, label: "رجالي", text: "أيوه يا فندم، Nike Air Force 1 رجالي متاح بالألوان دي:" });
  assert.equal(exact, "أيوه يا فندم، Nike Air Force 1 رجالي متاح عندنا بدرجتين 👇");
});
