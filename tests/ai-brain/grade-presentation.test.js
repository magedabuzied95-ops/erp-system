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
const colourVariants = (id) => [
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
  metadata: { tenant_id: 1, channel: "facebook_messenger", source: "ai_playground", ai_memory: {} },
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
    { id: 25, product_id: 25, name: "Nike Air Force Sneakers", grade: "local", grade_label: "محلي" },
  ];
  const output = normalizeUnifiedDecisionOutput({ text: "x", product_cards: cards, intent: "product_search" }, { originalText: "Nike Air Force 1" });
  assert.deepEqual(output.product_cards.map((card) => card.grade), ["local", "mirror_original"]);
});
