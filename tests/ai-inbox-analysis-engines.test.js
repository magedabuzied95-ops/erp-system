import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";

import { analysisInput, buildOrchestrator, closeAiEngines, inboxEngines, loadAiEngines } from "./helpers/loadAiEngines.mjs";

/*
 * The AI Inbox analysis layer, actually executed.
 *
 * src/modules/aiSupport/{core,intelligence,decision,copilot,learning} is roughly
 * 15k lines of TypeScript behind one hook, and every feature flag gating it
 * defaults to false — so until now none of it had ever run outside a browser
 * nobody had enabled. "Turn it on and see" is not a plan you execute against a
 * live inbox, so these tests answer it first: do the engines load, do they
 * produce correct analysis of the Arabic a shoe shop actually receives, and do
 * they survive the malformed input a real conversation feed contains.
 *
 * Conversations are written the way customers write, not the way test fixtures
 * usually are: Egyptian dialect, no punctuation, mixed digits.
 */

let engines;
let orchestrator;

before(async () => {
  engines = await loadAiEngines();
  orchestrator = buildOrchestrator(inboxEngines(engines), engines);
});

after(async () => {
  await closeAiEngines();
});

const message = (role, text, minutesAgo) => ({
  role,
  text,
  created_at: new Date(Date.UTC(2026, 7, 21, 9, 0, 0) + (60 - minutesAgo) * 60000).toISOString(),
});

const analyse = (messages, extra = {}) => orchestrator.analyze(analysisInput({ messages, ...extra }));

test("every engine loads and runs without error", async () => {
  const analysis = await analyse([message("customer", "السلام عليكم", 10)]);
  assert.deepEqual(analysis.errors, [], `engines reported errors: ${JSON.stringify(analysis.errors)}`);
  assert.ok(analysis.conversation, "the conversation engine must produce intelligence");
  assert.ok(analysis.decision, "the decision engine must produce a decision");
  assert.ok(Number.isFinite(analysis.executionTime), "executionTime must be a number");
});

test("it reads an Egyptian buying conversation correctly", async () => {
  const analysis = await analyse([
    message("customer", "السلام عليكم", 30),
    message("staff", "وعليكم السلام، أهلاً بيك", 29),
    message("customer", "عندكم الحذاء الأسود ده مقاس 43؟", 28),
    message("staff", "أيوة متوفر", 27),
    message("customer", "السعر غالي شوية، فيه خصم؟", 26),
    message("customer", "تمام هاخده، ابعتلي العنوان", 5),
  ]);

  const intelligence = analysis.conversation;
  assert.ok(intelligence.intent.includes("Price Inquiry"), `intents: ${intelligence.intent}`);
  assert.ok(intelligence.intent.includes("Size Inquiry"), `intents: ${intelligence.intent}`);
  assert.ok(intelligence.intent.includes("Purchase Ready"), `intents: ${intelligence.intent}`);
  // "السعر غالي" is an objection, not just a question about price.
  assert.ok(intelligence.objections.includes("Price"), `objections: ${intelligence.objections}`);
  assert.equal(intelligence.customerMood, "Price Sensitive");
  // "تمام هاخده" is the strongest signal in the thread.
  assert.equal(intelligence.salesStage, "Ready To Buy");
  assert.equal(intelligence.priority, "High");
  assert.ok(intelligence.leadScore > 50, `leadScore was ${intelligence.leadScore}`);
});

test("a browsing conversation is not scored as ready to buy", async () => {
  // The counter-case matters more than the positive one: a model that calls
  // everything hot is the same as no model.
  const analysis = await analyse([
    message("customer", "عندكم شنط؟", 20),
    message("staff", "أيوة عندنا", 19),
    message("customer", "طب شكرا هبص وارجعلك", 18),
  ]);
  const intelligence = analysis.conversation;
  assert.notEqual(intelligence.salesStage, "Ready To Buy", `salesStage: ${intelligence.salesStage}`);
  assert.ok(!intelligence.buyingSignals.includes("Asked discount"), `buyingSignals: ${intelligence.buyingSignals}`);
  assert.ok(intelligence.leadScore < 60, `a browser scored ${intelligence.leadScore}`);
});

test("an angry customer is not treated as a sales opportunity", async () => {
  // A late order and an ignored message, phrased the way it actually arrives:
  // no one writes "شكوى" or "غاضب". Before the vocabulary and folding fixes this
  // read Neutral / Low / no objections — a furious customer sorted below a
  // browser.
  const analysis = await analyse([
    message("customer", "الأوردر اتأخر أسبوع وحد مردش عليا", 40),
    message("customer", "ده كلام يتقال؟ عايز أرجع المنتج", 39),
  ]);
  const intelligence = analysis.conversation;
  assert.equal(intelligence.customerMood, "Angry", `mood: ${intelligence.customerMood}`);
  // analyzePriority reaches Critical only for an Angry complaint, which is
  // exactly this. High is accepted so the test survives a rules re-tune; Low is
  // the failure it exists to catch.
  assert.ok(["Critical", "High"].includes(intelligence.priority), `priority: ${intelligence.priority}`);
  assert.ok(intelligence.intent.includes("Complaint"), `intents: ${intelligence.intent}`);
  assert.ok(intelligence.objections.includes("Delivery"), `objections: ${intelligence.objections}`);
  assert.notEqual(intelligence.salesStage, "Ready To Buy");
});

test("Arabic spelling variants do not decide whether a customer is heard", async () => {
  // أ/ا, ة/ه and ى/ي are the same word to a customer and were different strings
  // to the matcher. "عايز أرجع" matched no rule because the pattern listed only
  // "ارجع"; the fix folds both sides rather than hand-listing variants forever.
  const spellings = [
    ["عايز أرجع المنتج", "hamza on alef"],
    ["عايز ارجع المنتج", "bare alef"],
    ["عايز إرجاع المنتج", "hamza below"],
    ["عايز اسْتبدال المنتج", "with a diacritic"],
    ["عايز اســتبدال المنتج", "with tatweel"],
  ];
  for (const [text, note] of spellings) {
    const analysis = await analyse([message("customer", text, 5)]);
    assert.ok(
      analysis.conversation.intent.includes("Exchange"),
      `"${text}" (${note}) produced ${analysis.conversation.intent}`
    );
  }
});

test("the definite article and attached pronouns do not hide an intent", async () => {
  // Arabic glues ال onto the front and the object pronoun onto the back, and
  // \p{L} counts both as letters — so "التوصيل" missed a rule listing "توصيل"
  // and "أستبدله" missed one listing "استبدل". The rules coped by hand-doubling
  // the forms somebody thought of ("سعر|السعر", "شحن|الشحن"); the ones nobody
  // doubled simply never fired.
  const cases = [
    ["التوصيل بياخد كام يوم؟", "Delivery", "definite article"],
    ["توصيل لحد البيت؟", "Delivery", "bare form still works"],
    ["المقاس مش مظبوط، عايز أستبدله", "Exchange", "attached object pronoun"],
    ["عايز استبدال", "Exchange", "bare noun still works"],
  ];
  for (const [text, intent, note] of cases) {
    const analysis = await analyse([message("customer", text, 5)]);
    assert.ok(
      analysis.conversation.intent.includes(intent),
      `"${text}" (${note}) produced ${analysis.conversation.intent}, wanted ${intent}`
    );
  }

  // Buying signals read the same patterns and gain the same allowances.
  // Asking for an invoice is a signal, not a Payment intent — the rules treat
  // "how do I pay" and "send me the bill" as different questions on purpose.
  const invoice = await analyse([message("customer", "ابعتلي الفاتورة", 5)]);
  assert.ok(invoice.conversation.buyingSignals.includes("Asked invoice"), `signals: ${invoice.conversation.buyingSignals}`);
});

test("the prefix and suffix allowances do not invent intents", async () => {
  // The counter-test for the rule above. Allowing ال and a pronoun tail widens
  // every pattern at once, so it has to be checked that it does not start
  // matching the middle of unrelated words. A false intent is worse than a
  // missed one: intents drive priority, and a wrong Complaint pushes a browser
  // to the top of the queue.
  const innocuous = [
    "الكتالوج وصل امبارح",
    "بشكركم على السرعة",
    "كامل العدد موجود",
    "الوان الشنطة حلوة",
  ];
  for (const text of innocuous) {
    const analysis = await analyse([message("customer", text, 5)]);
    assert.ok(
      !analysis.conversation.intent.includes("Complaint"),
      `"${text}" was read as a complaint: ${analysis.conversation.intent}`
    );
    assert.notEqual(analysis.conversation.customerMood, "Angry", `"${text}" was read as angry`);
  }
});

test("folding does not blunt the rules it normalises", async () => {
  // Both sides of every comparison are folded, so patterns written with أ or ة
  // must keep matching. A silent regression here would turn whole rule families
  // off while every test that only checks folded input still passes.
  const cases = [
    ["مشكلة في الأوردر", "Complaint"],
    ["السلام عليكم", "Greeting"],
    ["عايز أعرف السعر", "Price Inquiry"],
    ["فيه مقاسات تانية؟", "Size Inquiry"],
    ["التوصيل بكام؟", "Delivery"],
  ];
  for (const [text, intent] of cases) {
    const analysis = await analyse([message("customer", text, 5)]);
    assert.ok(analysis.conversation.intent.includes(intent), `"${text}" produced ${analysis.conversation.intent}, wanted ${intent}`);
  }
});

test("it survives the malformed messages a real feed contains", async () => {
  // The inbox merges rows from four channels plus a chat-list import, so a
  // message can be missing text, missing a role, or not be an object at all.
  // The analysis panel renders on every conversation, so a throw here is a
  // blank inbox.
  const hostile = [
    null,
    undefined,
    {},
    { role: "customer" },
    { role: "customer", text: null },
    { role: "customer", text: "" },
    { text: "no role at all", created_at: "not-a-date" },
    { role: "customer", text: "🙂🙂🙂", created_at: null },
    { role: "customer", text: "a".repeat(20000), created_at: "2026-08-21T09:00:00Z" },
    message("customer", "عايز اشتري", 1),
  ];
  const analysis = await analyse(hostile);
  assert.deepEqual(analysis.errors, [], `engines threw on malformed input: ${JSON.stringify(analysis.errors)}`);
  assert.ok(analysis.conversation);
});

test("an empty conversation does not produce a confident verdict", async () => {
  const analysis = await analyse([]);
  assert.deepEqual(analysis.errors, []);
  assert.ok(analysis.conversation);
  assert.equal(analysis.conversation.buyingSignals.length, 0);
  assert.ok(analysis.conversation.leadScore <= 30, `empty conversation scored ${analysis.conversation.leadScore}`);
});

test("the copilot turns analysis into actions the operator is allowed to take", async () => {
  const analysis = await analyse([
    message("customer", "عايز اشتري الحذاء ده مقاس 42", 10),
    message("customer", "ممكن اعرف السعر النهائي؟", 8),
  ]);
  const copilot = engines.analyzeCopilot({
    analysis,
    conversation: { id: "whatsapp:test", messages: [], channel: "whatsapp" },
    customer: { id: 1 },
    currentAgent: { id: 1, name: "Agent" },
    permissions: { allowedActions: ["Continue Chat", "Create Order"], canViewCustomerData: true, canViewPricing: true },
  });

  assert.ok(copilot.summary.length > 0, "the copilot must summarise the conversation");
  assert.ok(Number.isFinite(copilot.confidence));
  // Permission-aware: an action the agent cannot perform must be marked, not
  // silently offered. "Human Takeover" was not granted above.
  const forbidden = copilot.recommendedActions.filter((action) => action.action === "Human Takeover");
  for (const action of forbidden) {
    assert.equal(action.permitted, false, "an action outside the agent's permissions must not be permitted");
  }
});

test("analysis is fast enough to run on every conversation switch", async () => {
  // It runs synchronously in the render path of a conversation the operator
  // just clicked. Slow here is a UI that feels broken.
  const messages = Array.from({ length: 60 }, (_, index) =>
    message(index % 2 ? "staff" : "customer", `رسالة رقم ${index} عن المقاس والسعر`, 60 - index));
  const started = performance.now();
  const analysis = await orchestrator.analyze(analysisInput({ messages }));
  const elapsed = performance.now() - started;
  assert.deepEqual(analysis.errors, []);
  assert.ok(elapsed < 400, `a 60-message conversation took ${Math.round(elapsed)}ms`);
});

test("the learning engine records feedback without throwing", async () => {
  // LEARNING_ENABLED writes through this on every suggestion shown. It runs in
  // a browser with localStorage; under node there is none, and it must degrade
  // rather than take the panel down with it.
  const learning = new engines.LearningEngine();
  const identity = {
    recommendationId: "r1",
    recommendationType: "Suggestion",
    userId: "1",
    conversationId: "whatsapp:test",
    customerId: "42",
  };
  assert.doesNotThrow(() => learning.track({ ...identity, source: "AI Inbox Copilot", confidence: 80, metadata: {} }));
  assert.doesNotThrow(() => learning.feedback(identity, "Accepted", {}));
});

test("the test harness mirrors the engine list the hook actually builds", () => {
  // These engines are declared in useAIInboxAnalysis and mirrored in the test
  // helper. If the hook gains an engine or a dependency edge and the mirror does
  // not, these tests would be exercising something the product no longer runs.
  const hook = readFileSync("src/modules/aiSupport/integration/useAIInboxAnalysis.js", "utf8");
  const helper = readFileSync("tests/helpers/loadAiEngines.mjs", "utf8");
  const names = (source) => [...source.matchAll(/name: "([a-z]+)",\s*\n?\s*version: "1\.0\.0"/g)].map((m) => m[1]);
  assert.deepEqual(names(helper), names(hook), "the mirrored engine list has drifted from the hook");
  assert.match(hook, /dependencies: \["crm"\]/);
  assert.match(hook, /dependencies: \["crm", "conversation"\]/);
  assert.match(helper, /dependencies: \["crm"\]/);
  assert.match(helper, /dependencies: \["crm", "conversation"\]/);
});
