// Phase 13.5 — BUSINESS SUPPORT FACTS come from the Smart Support Knowledge Base ("قاعدة معرفة الدعم الذكي"),
// never from the LLM and never from conversation history.
//
// Production bug this locks down: a conversation whose recent context was a Jordan product, then
// "العنوان ايه؟" → the raw brain answered with stale Jordan product facts. A support question must resolve
// deterministically to the canonical Knowledge Base field, with ZERO product leak and ZERO product card.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as G from "../../server/services/aiInboxGroundingGate.js";
import * as KB from "../../server/services/aiSupportKnowledgeBaseService.js";

const FULL_KB = {
  store_name: "M1 Store",
  phone: "+201000000001",
  whatsapp: "+201000000002",
  store_address: "دمياط الجديدة - الحي الأول - شارع النيل",
  maps_url: "https://maps.app.goo.gl/m1store",
  branch_working_hours: "السبت - الخميس من 12 ظهرًا إلى 11 مساءً",
  payment_methods: "كاش عند الاستلام\nفودافون كاش\nإنستاباي",
  shipping_policy: "الشحن لكل المحافظات خلال 2-4 أيام",
  return_exchange_policy: "الاستبدال خلال 14 يوم بالفاتورة والمنتج بحالته",
  delivery_notes: "الاستلام من مندوب الشحن بعد المعاينة",
  warranty_notes: "ضمان 6 شهور على عيوب الصناعة",
  human_support_message: "ابعتلنا على واتساب وهنرد عليك فورًا.",
};

// a raw brain draft that leaked STALE Jordan product facts (the exact production failure)
const JORDAN_LEAK = {
  answer: "Air Jordan 4 for Men. سعره 1650 جنيه. المقاسات المتاحة: 41، 42.",
  suggested_products: [{ id: 39, name: "Air Jordan 4" }],
};

const deps = (kb = FULL_KB, branches = []) => ({
  loadSupportKnowledgeBase: async () => ({ knowledge_base: { ...KB.AI_KB_DEFAULTS, ...kb }, branches }),
  // Durable product context WOULD resolve a Jordan product — a support intent must never consult it.
  resolveProductSubject: async () => ({ productId: "39", source: "approved_selection", ageSeconds: 20 }),
  resolveProductById: async () => ({ id: 39, name: "Air Jordan 4", product_type: "sneakers" }),
  resolveByBrandModel: async () => [{ id: 39, name: "Air Jordan 4", product_type: "sneakers" }],
  inventoryFacts: async () => ({ variant_stock: [{ variant_id: 1, size: "44", color: "Black", stock: 3 }] }),
});

const run = (message, { kb = FULL_KB, branches = [], reply = JORDAN_LEAK, session = "whatsapp:X" } = {}) =>
  G.applyInboxGroundingGate({ tenantId: 1, sessionId: session, message, reply, deps: deps(kb, branches) });

const assertNoProductLeak = (r) => {
  assert.equal((r.suggested_products || []).length, 0, "no product cards");
  assert.equal(r.send_ready_card, null);
  assert.equal((r.card_choices || []).length, 0);
  assert.equal((r.color_choices || []).length, 0);
  assert.equal(r.color_choice_required, false);
  assert.notEqual(r.grounding?.product_resolution?.source, "conversation_context");
  assert.doesNotMatch(String(r.answer || ""), /Jordan|جوردن|1650|المقاسات المتاحة/i);
};

// ---- 1-5: STORE_LOCATION -----------------------------------------------------------------------------
for (const [i, message] of ["العنوان ايه؟", "العنوان؟", "مكانكم فين؟", "اللوكيشن؟"].entries()) {
  test(`${i + 1}: "${message}" → canonical Knowledge Base address (+ maps link), no product leak`, async () => {
    const r = await run(message);
    assert.equal(r.action, "support_fact");
    assert.equal(r.requestedIntent, "STORE_LOCATION");
    assert.match(r.answer, /دمياط الجديدة - الحي الأول - شارع النيل/);
    assert.match(r.answer, /https:\/\/maps\.app\.goo\.gl\/m1store/); // 4: canonical Maps URL
    assert.deepEqual(r.grounding.resolved.fields_used, ["store_address", "maps_url"]);
    assert.equal(r.grounding.resolved.source, "smart_support_knowledge_base");
    assertNoProductLeak(r);
  });
}

test("5: stale Jordan product context + an address question → ZERO product leak, canonical address only", async () => {
  const r = await run("العنوان ايه؟");
  assertNoProductLeak(r);
  assert.match(r.answer, /عنواننا:/);
});

// ---- 6-7: STORE_HOURS --------------------------------------------------------------------------------
for (const [i, message] of ["مواعيدكم؟", "بتفتحوا امتى؟"].entries()) {
  test(`${i + 6}: "${message}" → canonical Knowledge Base working hours`, async () => {
    const r = await run(message);
    assert.equal(r.requestedIntent, "STORE_HOURS");
    assert.match(r.answer, /السبت - الخميس من 12 ظهرًا إلى 11 مساءً/);
    assert.deepEqual(r.grounding.resolved.fields_used, ["branch_working_hours"]);
    assertNoProductLeak(r);
  });
}

// ---- 8-9: STORE_CONTACT / STORE_WHATSAPP -------------------------------------------------------------
test("8: \"رقمكم؟\" → canonical public phone", async () => {
  const r = await run("رقمكم؟");
  assert.equal(r.requestedIntent, "STORE_CONTACT");
  assert.match(r.answer, /\+201000000001/);
  assertNoProductLeak(r);
});

test("9: \"رقم الواتساب؟\" → canonical WhatsApp number (WhatsApp outranks the generic phone route)", async () => {
  const r = await run("رقم الواتساب؟");
  assert.equal(r.requestedIntent, "STORE_WHATSAPP");
  assert.match(r.answer, /\+201000000002/);
  assert.doesNotMatch(r.answer, /\+201000000001/);
  assertNoProductLeak(r);
});

// ---- 10-13: policies ---------------------------------------------------------------------------------
test("10: \"طرق الدفع؟\" → configured payment methods", async () => {
  const r = await run("طرق الدفع؟");
  assert.equal(r.requestedIntent, "PAYMENT_METHODS");
  assert.match(r.answer, /فودافون كاش/);
  assertNoProductLeak(r);
});

test("11: \"الاستبدال والاسترجاع؟\" → configured return/exchange policy", async () => {
  const r = await run("الاستبدال والاسترجاع؟");
  assert.equal(r.requestedIntent, "RETURN_EXCHANGE_POLICY");
  assert.match(r.answer, /الاستبدال خلال 14 يوم/);
  assertNoProductLeak(r);
});

test("12: \"سياسة الشحن؟\" → configured shipping policy (+ delivery notes)", async () => {
  const r = await run("سياسة الشحن؟");
  assert.equal(r.requestedIntent, "SHIPPING_POLICY");
  assert.match(r.answer, /الشحن لكل المحافظات خلال 2-4 أيام/);
  assert.match(r.answer, /الاستلام من مندوب الشحن/);
  assertNoProductLeak(r);
});

test("13: \"الضمان؟\" → configured warranty notes", async () => {
  const r = await run("الضمان؟");
  assert.equal(r.requestedIntent, "WARRANTY");
  assert.match(r.answer, /ضمان 6 شهور/);
  assertNoProductLeak(r);
});

// ---- 14-15: MISSING canonical fields → never fabricate ------------------------------------------------
test("14: missing address → NO fabricated address, and the empty field is surfaced to the operator", async () => {
  const r = await run("العنوان ايه؟", { kb: { ...FULL_KB, store_address: "", maps_url: "" } });
  assert.equal(r.requestedIntent, "STORE_LOCATION");
  assert.doesNotMatch(r.answer, /دمياط|شارع|https?:\/\//);
  assert.match(r.answer, /مش متسجل/);
  assert.deepEqual(r.kb_missing_fields, ["store_address"]);
  assert.match(r.answer, /ابعتلنا على واتساب/); // configured human-support fallback, not an invented fact
  assertNoProductLeak(r);
});

test("15: missing Maps URL → address still answers, no invented link", async () => {
  const r = await run("اللوكيشن؟", { kb: { ...FULL_KB, maps_url: "" } });
  assert.match(r.answer, /دمياط الجديدة/);
  assert.doesNotMatch(r.answer, /https?:\/\//);
  assert.deepEqual(r.kb_missing_fields, ["maps_url"]);
});

test("14b: address falls back to the EXISTING branch rows before declaring it missing (no duplicate source)", async () => {
  const r = await run("العنوان ايه؟", {
    kb: { ...FULL_KB, store_address: "" },
    branches: [{ name: "الفرع الرئيسي", address: "دمياط الجديدة - الحي الثالث", phone: "" }],
  });
  assert.match(r.answer, /الفرع الرئيسي: دمياط الجديدة - الحي الثالث/);
  assert.deepEqual(r.grounding.resolved.fields_used, ["branches.address", "maps_url"]);
});

// ---- 16-17: precedence -------------------------------------------------------------------------------
test("16: support-info intents NEVER invoke durable product context", async () => {
  for (const message of ["العنوان ايه؟", "مواعيدكم؟", "رقمكم؟", "طرق الدفع؟", "سياسة الشحن؟", "الضمان؟"]) {
    const r = await run(message);
    assert.equal(r.grounding.product_resolution.source, "none", message);
  }
});

test("17: a stale raw product reply is OVERRIDDEN by the canonical Knowledge Base fact", async () => {
  const r = await run("العنوان ايه؟", { reply: JORDAN_LEAK });
  assert.equal(r.changed, true);
  assert.notEqual(r.answer, JORDAN_LEAK.answer);
  assertNoProductLeak(r);
});

test("17b: a SAME-MESSAGE product request still grounds on the catalog (support routing is bounded)", async () => {
  const r = await run("عندكم كروكس اسود مقاس 44؟");
  assert.notEqual(r.action, "support_fact");
});

// ---- 18-20: one Knowledge Base across every channel --------------------------------------------------
test("18-20: Messenger / Instagram / WhatsApp resolve the SAME canonical fact (channel affects delivery only)", async () => {
  const answers = [];
  for (const session of ["messenger:PSID", "instagram:IGSID", "whatsapp:2010"]) {
    const r = await run("العنوان ايه؟", { session });
    assert.equal(r.requestedIntent, "STORE_LOCATION");
    answers.push(r.answer);
  }
  assert.equal(new Set(answers).size, 1, "identical support fact on every channel");
});

// ---- 21: no autonomous send --------------------------------------------------------------------------
test("21: the support-fact layer only rewrites the DRAFT — it never sends", () => {
  const src = fs.readFileSync("server/services/aiSupportKnowledgeBaseService.js", "utf8");
  assert.equal(/sendTextMessage|sendMetaInboxOutboundMessage|dispatch|provider/i.test(src), false);
  const gate = fs.readFileSync("server/services/aiInboxGroundingGate.js", "utf8");
  assert.equal(/sendTextMessage|sendMetaInboxOutboundMessage/.test(gate), false);
});

// ---- canonical routing unit coverage -----------------------------------------------------------------
test("intent routing: each support question maps to exactly one canonical Knowledge Base field", () => {
  const cases = [
    ["العنوان ايه؟", "STORE_LOCATION"], ["مكانكم فين؟", "STORE_LOCATION"], ["اللوكيشن؟", "STORE_LOCATION"],
    ["المحل فين؟", "STORE_LOCATION"], ["مواعيدكم؟", "STORE_HOURS"], ["بتفتحوا امتى؟", "STORE_HOURS"],
    ["رقمكم؟", "STORE_CONTACT"], ["رقم الواتساب؟", "STORE_WHATSAPP"], ["طرق الدفع؟", "PAYMENT_METHODS"],
    ["الاستبدال والاسترجاع؟", "RETURN_EXCHANGE_POLICY"], ["سياسة الشحن؟", "SHIPPING_POLICY"], ["الضمان؟", "WARRANTY"],
  ];
  for (const [message, expected] of cases) assert.equal(KB.detectSupportFactIntent(message), expected, message);
  // Product turns must NOT be captured by support routing.
  for (const message of ["عندكم جوردن فور؟", "مقاس 44 متاح؟", "بكام الكوتشي ده؟", "والاسود؟"]) {
    assert.equal(KB.detectSupportFactIntent(message), "", message);
  }
});

test("normalization: the maps link must be a real http(s) URL; the address is a plain canonical field", () => {
  assert.equal(KB.normalizeKnowledgeBase({ maps_url: "" }).maps_url, "");
  assert.equal(KB.normalizeKnowledgeBase({ maps_url: "https://maps.app.goo.gl/x" }).maps_url, "https://maps.app.goo.gl/x");
  assert.throws(() => KB.normalizeKnowledgeBase({ maps_url: "دمياط" }), /valid http/);
  assert.equal(KB.normalizeKnowledgeBase({ store_address: " دمياط " }).store_address, "دمياط");
});

test("ONE source: the operator page, the API and the AI layer share the same canonical field list", () => {
  const page = fs.readFileSync("src/modules/aiSupport/pages/AiSupportKnowledgeBase.jsx", "utf8");
  const route = fs.readFileSync("server/routes/aiSupport.js", "utf8");
  for (const field of ["store_address", "maps_url", "branch_working_hours", "payment_methods", "warranty_notes"]) {
    assert.match(page, new RegExp(field), `page exposes ${field}`);
    assert.ok(Object.prototype.hasOwnProperty.call(KB.AI_KB_DEFAULTS, field), `canonical defaults own ${field}`);
  }
  // The route must not re-declare a parallel schema.
  assert.match(route, /from "\.\.\/services\/aiSupportKnowledgeBaseService\.js"/);
  assert.equal(/const AI_KB_DEFAULTS = Object\.freeze/.test(route), false);
  assert.equal(/const normalizeKnowledgeBase = /.test(route), false);
});
