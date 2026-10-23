import test from "node:test";
import assert from "node:assert/strict";
import pool from "../../server/database/db.js";
import { AI_REPLY_RULE_DEFAULTS, normalizeAiReplyRules, classifyAiRuleLesson } from "../../shared/aiReplyRules.js";
import { loadTenantAiReplyRules, saveTenantAiReplyRules, invalidateAiReplyRules } from "../../server/modules/aiReplyRules.js";

const stored = new Map();
const catalog = [
  { id: 25, name: "Nike Air Force 1", grade: "local", price: 650 },
  { id: 61, name: "Nike Air Force 1", grade: "mirror_original", price: 1850 },
];
const product = row => ({ ...row, status: "active", tenant_id: 1, stock: 5, total_stock: 5, image_url: `https://cdn.example.test/${row.id}.jpg`, product_url: `https://shop.example.test/shop/product/${row.id}` });
let ruleReads = 0;
pool.query = async (sql, params = []) => {
  const query = String(sql);
  if (query.includes("SELECT settings FROM ai_agent_settings")) {
    ruleReads++;
    return { rows: [{ settings: stored.get(String(params[0])) || {} }] };
  }
  if (query.includes("INSERT INTO ai_agent_settings")) {
    const settings = { ...stored.get(String(params[0])), ...JSON.parse(params[1]) };
    stored.set(String(params[0]), settings);
    return { rows: [{ settings }] };
  }
  if (query.includes("information_schema.columns")) {
    const columns = params[0] === "products" ? ["id", "name", "grade", "status", "stock", "total_stock", "price", "tenant_id", "image_url"] : ["id", "product_id", "size", "color", "stock", "is_active", "image_url"];
    return { rows: columns.map(column_name => ({ column_name })) };
  }
  if (/FROM products p\s+WHERE 1 = 1/.test(query)) return { rows: catalog.filter(row => !params.includes("local") && !params.includes("mirror_original") || params.includes(row.grade)).map(product) };
  if (query.includes("AS variants")) {
    const row = catalog.find(row => row.id === Number(params[0]));
    return { rows: row ? [{ ...product(row), variants: [{ id: row.id * 10, size: "42", color: "Black", stock: 5, is_active: true, image_url: product(row).image_url }], product_variant_images: [] }] : [] };
  }
  return { rows: [] };
};
process.env.AI_SUPPORT_ENABLED = "false";
process.env.AI_CLAUDE_AGENT_ENABLED = "false";
const { generateUnifiedConversationDecision, rewriteStructuredDecision } = await import("../../server/services/aiUnifiedDecisionService.js");
const { buildVisualRecognitionPayload } = await import("../../server/services/aiInboxService.js");
const { buildStablePrompt } = await import("../../server/services/aiClaudeSalesAgentService.js");
const ask = (rules, channel = "whatsapp") => generateUnifiedConversationDecision({ channel, text: "عايز ايرفورس", externalConversationId: "test:rules", externalCustomerId: "playground", metadata: { source: "ai_playground", tenant_id: 1 } }, { tenantId: 1, memory: {}, rules });

test("default grade question comes before cards; disabling shows both grades", async () => {
  const on = await ask(AI_REPLY_RULE_DEFAULTS);
  assert.equal(on.intent || on.detected_intent, "grade_question");
  assert.equal(on.product_cards.length, 0);
  const off = await ask({ ...AI_REPLY_RULE_DEFAULTS, ai_rules_grade_question: false });
  assert.deepEqual([...new Set(off.product_cards.map(card => card.grade))], ["local", "mirror_original"]);
});

test("booking, product link and custom intro reach the final decision on each channel", async () => {
  for (const channel of ["whatsapp", "facebook_messenger", "instagram"]) {
    const defaults = await ask({ ...AI_REPLY_RULE_DEFAULTS, ai_rules_grade_question: false }, channel);
    assert.doesNotMatch(defaults.text, /تحب أحجزهولك|https?:/);
    const switched = await ask({ ai_rules_grade_question: false, ai_rules_booking_question: true, ai_rules_product_link: true, ai_rules_cards_intro: "اختار اللي يناسبك 👇" }, channel);
    assert.match(switched.text, /اختار اللي يناسبك/);
    assert.match(switched.text, /تحب أحجزهولك؟/);
    assert.match(switched.text, /شوفه من هنا:/);
    assert.match(switched.text, /https?:/);
  }
});

test("single-grade templates and photo replies preserve defaults and use custom text", async () => {
  const cards = [{ id: 25, name: "Nike Air Force", grade: "local", available_sizes: ["42"] }];
  const original = await rewriteStructuredDecision({ decision: { intent: "product_search", product_cards: cards } });
  assert.equal(original.text, AI_REPLY_RULE_DEFAULTS.ai_rules_cards_intro);
  const rules = { ai_rules_booking_question: true, ai_rules_cards_intro: "اختار اللون 👇" };
  const changed = await rewriteStructuredDecision({ decision: { intent: "post_product_color_selected", product_cards: cards }, rules });
  assert.equal(changed.text, "اختار اللون 👇\nتحب أحجزهولك؟");
  assert.equal(buildVisualRecognitionPayload({ cards }).answer, AI_REPLY_RULE_DEFAULTS.ai_rules_cards_intro);
  assert.equal(buildVisualRecognitionPayload({ cards, rules }).answer, changed.text);
  const photoLink = buildVisualRecognitionPayload({ cards: [{ ...cards[0], product_url: "https://shop.example.test/p/25" }], rules: { ...rules, ai_rules_product_link: true } });
  assert.match(photoLink.answer, /https:\/\/shop.example.test\/p\/25/);
  const sized = buildVisualRecognitionPayload({ cards, caption: "42", recognition: { matchedColor: "Black", photoMatch: "same" }, rules });
  assert.match(sized.answer, /تحب أحجزهولك/);
});

test("stable prompt follows booking/link switches and intro", () => {
  assert.match(buildStablePrompt(), /متختمش بـ«تحب أحجزهولك؟»/);
  assert.match(buildStablePrompt(), /ولا تحط لينك/);
  const prompt = buildStablePrompt({ rules: { ai_rules_booking_question: true, ai_rules_product_link: true, ai_rules_cards_intro: "أهلا 👇" } });
  assert.match(prompt, /اختم كروت المنتجات/);
  assert.match(prompt, /حط رابط المنتج/);
  assert.match(prompt, /أهلا 👇/);
  assert.doesNotMatch(prompt, /متختمش بـ«تحب أحجزهولك؟»/);
});

test("rules are isolated by tenant, persist by patch, invalidate cache and fail soft", async () => {
  stored.set("901", { persona: { name: "kept" }, ai_rules_booking_question: true });
  invalidateAiReplyRules(901);
  const first = await loadTenantAiReplyRules({ tenantId: 901 });
  const reads = ruleReads;
  assert.equal(first.ai_rules_booking_question, true);
  await loadTenantAiReplyRules({ tenantId: 901 });
  assert.equal(ruleReads, reads);
  await saveTenantAiReplyRules({ tenantId: 901, rules: { ai_rules_booking_question: false, ai_rules_cards_intro: "مرحبا 👇" } });
  assert.equal((await loadTenantAiReplyRules({ tenantId: 901 })).ai_rules_cards_intro, "مرحبا 👇");
  assert.deepEqual(stored.get("901").persona, { name: "kept" });
  assert.deepEqual(await loadTenantAiReplyRules({ tenantId: 902 }), AI_REPLY_RULE_DEFAULTS);
  assert.deepEqual(await loadTenantAiReplyRules({ tenantId: 999, load: async () => { throw new Error("offline"); } }), AI_REPLY_RULE_DEFAULTS);
  await assert.rejects(saveTenantAiReplyRules({ tenantId: 901, rules: { ai_rules_booking_question: "false" } }));
  await assert.rejects(saveTenantAiReplyRules({ tenantId: 901, rules: { other: true } }));
  assert.deepEqual(normalizeAiReplyRules({ ai_rules_booking_question: "true" }), AI_REPLY_RULE_DEFAULTS);
});

test("lessons propose exact rules without saving; unrelated lessons stay agent-only", async () => {
  const before = JSON.stringify([...stored]);
  const lesson = classifyAiRuleLesson("متسألش تحب أحجزهولك");
  assert.deepEqual(lesson.rule_change, { ai_rules_booking_question: false });
  assert.match(lesson.answer, /سؤال الحجز.*إيقاف/);
  assert.deepEqual(classifyAiRuleLesson("اظهر رابط المنتج").rule_change, { ai_rules_product_link: true });
  assert.deepEqual(classifyAiRuleLesson("بلاش السؤال عن درجة المنتج").rule_change, { ai_rules_grade_question: false });
  assert.equal(classifyAiRuleLesson("خليك لطيف مع العميل"), null);
  assert.deepEqual(classifyAiRuleLesson("لا تضيف لينك").rule_change, { ai_rules_product_link: false });
  assert.deepEqual(classifyAiRuleLesson('غير السطر فوق الكروت إلى «أهلاً بيك 👇»').rule_change, { ai_rules_cards_intro: "أهلاً بيك 👇" });
  assert.equal(JSON.stringify([...stored]), before);
  await saveTenantAiReplyRules({ tenantId: 901, rules: lesson.rule_change });
  assert.equal((await loadTenantAiReplyRules({ tenantId: 901 })).ai_rules_booking_question, false);
});
