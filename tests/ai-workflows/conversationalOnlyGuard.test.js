// Phase 13.1 — durable context is a FALLBACK for an ELLIPTICAL product follow-up, NOT generic conversation
// memory. A greeting / ack / thanks / closing with NO product-dependent request must never recall a product or
// carry product facts — even if the raw brain leaked a product listing from its own history. Shared across all
// channels (session prefix is the only channel signal).
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../../server/services/aiInboxGroundingGate.js";

const P = { id: 359, name: "Adidas Adistar22", product_type: "sneakers" };
const ctx = (variants) => ({
  resolveProductSubject: async () => ({ productId: "359", source: "approved_selection", ageSeconds: 20 }),
  resolveProductById: async () => P,
  resolveByBrandModel: async () => [],
  inventoryFacts: async () => ({ variant_stock: variants || [{ variant_id: 1, size: "44", color: "Navy", stock: 2 }] }),
});
// a raw brain draft that leaked a product listing for a conversational message
const LEAK = { answer: "لقيتلك 2 اختيارات. Air Jordan 4 for Men. سعره 1650 جنيه. المقاسات المتاحة: 41، 42.", suggested_products: [{ id: 39 }] };
const run = (message, { reply = LEAK, contextMessages = null, session = "whatsapp:X", deps } = {}) =>
  G.applyInboxGroundingGate({ tenantId: 1, sessionId: session, message, contextMessages, reply, deps: deps || ctx() });

const CONVERSATIONAL = ["السلام عليكم", "السلام عليكم ورحمة الله", "مساء الخير", "صباح الخير", "شكرا", "تمام", "ماشي", "تمام شكرا", "سلام", "مع السلامة"];
for (const [i, m] of CONVERSATIONAL.entries()) {
  test(`conversational-only #${i + 1} "${m}" → no product recall, no product facts/cards`, async () => {
    const r = await run(m);
    assert.equal(r.action, "conversational");
    assert.notEqual(r.grounding?.product_resolution?.source, "conversation_context");
    assert.equal((r.suggested_products || []).length, 0);
    assert.equal(r.color_choice_required, false);
    assert.doesNotMatch(String(r.answer || ""), /جوردن|Jordan|1650|المقاسات المتاحة/);
  });
}

test("1/2: recent Jordan context + a greeting → GREETING wording (وعليكم السلام), never the product", async () => {
  const r = await run("السلام عليكم ورحمة الله");
  assert.match(r.answer, /وعليكم السلام/);
});

test("5: recent context + \"طب مقاس ٤٤؟\" → context product reused (elliptical follow-up still works)", async () => {
  const r = await run("طب مقاس ٤٤؟", { reply: { answer: "" } });
  assert.equal(r.grounding.product_resolution.source, "conversation_context");
});

test("6: recent context + \"والاسود؟\" → context product reused", async () => {
  const r = await run("والاسود؟", { reply: { answer: "" }, deps: ctx([{ variant_id: 3, size: "44", color: "Black", stock: 1 }]) });
  assert.equal(r.grounding.product_resolution.source, "conversation_context");
});

test("7: recent context + \"بكام؟\" → context product reused", async () => {
  const r = await run("بكام؟", { reply: { answer: "" } });
  assert.equal(r.grounding.product_resolution.source, "conversation_context");
});

test("8: greeting + product question in the SAME active turn → substantive product intent wins", async () => {
  const r = await run("عندكم جوردن فور مقاس ٤٥؟", { reply: { answer: "" }, contextMessages: ["السلام عليكم", "عندكم جوردن فور مقاس ٤٥؟"], deps: ctx([{ variant_id: 1, size: "45", color: "Navy", stock: 2 }]) });
  assert.equal(r.requestedIntent, "PRODUCT_AVAILABILITY");
  assert.notEqual(r.action, "conversational");
});

test("10: explicit new product overrides context (not neutralised as conversational)", async () => {
  const r = await run("متاح اديداس اديستار؟", { reply: { answer: "" }, deps: { resolveByBrandModel: async () => [P], inventoryFacts: async () => ({ variant_stock: [{ variant_id: 1, size: "44", color: "Navy", stock: 1 }] }) } });
  assert.notEqual(r.action, "conversational");
  assert.equal(r.grounding.product_resolution.source, "explicit_message");
});

test("11/12/13: same semantics regardless of channel (messenger/instagram/whatsapp session)", async () => {
  for (const s of ["facebook_messenger:PSID", "instagram:IGSID", "whatsapp:2010"]) {
    const r = await run("مساء الخير", { session: s });
    assert.equal(r.action, "conversational");
    assert.equal((r.suggested_products || []).length, 0);
  }
});

test("a clean greeting reply (no leak) is left untouched (noop) — guard only neutralises a real leak", async () => {
  const r = await run("السلام عليكم", { reply: { answer: "وعليكم السلام 🌹", suggested_products: [] } });
  assert.equal(r.changed, false); // nothing to correct
});
