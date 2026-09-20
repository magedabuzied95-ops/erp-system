import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MIN_TRIGGER_LENGTH,
  buildKnowledgeLines,
  matchFixedAnswer,
  normalizeKnowledgeText,
} from "../server/services/aiAgentKnowledgeService.js";
import { clusterQuestions, __answerMiningTestHooks } from "../server/services/aiInboxAnswerMiningService.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const gate = read("server/services/aiInboxGroundingGate.js");
const persona = read("server/services/aiPersonaService.js");
const routes = read("server/routes/aiAgentOrders.js");
const mining = read("server/services/aiInboxAnswerMiningService.js");
const knowledge = read("server/services/aiAgentKnowledgeService.js");
const contextService = read("server/services/aiSupportContextService.js");

const entry = (over = {}) => ({
  id: 1,
  kind: "fixed_answer",
  title: "",
  triggers: [],
  answer: "answer",
  enabled: true,
  priority: 0,
  ...over,
});

test("a customer's spelling variant still meets the owner's trigger", () => {
  // The owner types "إلغاء", the customer types "الغاء"; alef/ya/ta-marbuta are folded both ways.
  assert.equal(normalizeKnowledgeText("إلغاء"), normalizeKnowledgeText("الغاء"));
  assert.equal(normalizeKnowledgeText("سيناء؟"), normalizeKnowledgeText("سيناء"));
  assert.equal(normalizeKnowledgeText("  مَواعيد  "), "مواعيد");
});

test("a trigger fires on the message that contains it", () => {
  const entries = [entry({ triggers: ["سيناء"], answer: "للأسف مابنشحنش لسيناء" })];
  const matched = matchFixedAnswer(entries, "بتشحنوا لسيناء؟");
  assert.ok(matched);
  assert.equal(matched.entry.answer, "للأسف مابنشحنش لسيناء");
  assert.equal(matched.trigger, "سيناء");
});

test("the more specific rule wins over the broader one", () => {
  const entries = [
    entry({ id: 1, triggers: ["شحن"], answer: "الشحن ٥٠ جنيه" }),
    entry({ id: 2, triggers: ["شحن سيناء"], answer: "مابنشحنش لسيناء" }),
  ];
  const matched = matchFixedAnswer(entries, "عايز اعرف شحن سيناء بكام");
  assert.equal(matched.entry.id, 2, "the longer matched trigger must win");
});

test("priority beats specificity when the owner sets it", () => {
  const entries = [
    entry({ id: 1, triggers: ["شحن سيناء"], answer: "قديم" }),
    entry({ id: 2, triggers: ["شحن"], answer: "جديد", priority: 10 }),
  ];
  assert.equal(matchFixedAnswer(entries, "شحن سيناء بكام").entry.id, 2);
});

test("a disabled rule never fires", () => {
  const entries = [entry({ triggers: ["سيناء"], enabled: false })];
  assert.equal(matchFixedAnswer(entries, "بتشحنوا لسيناء؟"), null);
});

test("a trigger shorter than the floor cannot route the whole inbox", () => {
  // Two letters appear in almost every Arabic sentence; the floor is what stops one rule swallowing
  // every conversation.
  const entries = [entry({ triggers: ["ال"] })];
  assert.equal(matchFixedAnswer(entries, "عايز اعرف الشحن"), null);
  assert.equal(MIN_TRIGGER_LENGTH, 3);
});

test("a knowledge entry has no triggers and never fires as a fixed answer", () => {
  const entries = [entry({ kind: "knowledge", triggers: ["سيناء"], answer: "fact" })];
  assert.equal(matchFixedAnswer(entries, "سيناء"), null);
});

test("knowledge lines are capped so they cannot crowd out the grounding rules", () => {
  const many = Array.from({ length: 80 }, (_, index) =>
    entry({ id: index, kind: "knowledge", answer: `حقيقة رقم ${index} `.repeat(6) })
  );
  const lines = buildKnowledgeLines(many);
  assert.ok(lines.length <= 40, `expected at most 40 entries, got ${lines.length}`);
  assert.ok(lines.join("").length <= 4000, "the character budget must hold");
});

test("an empty knowledge entry contributes no line", () => {
  assert.deepEqual(buildKnowledgeLines([entry({ kind: "knowledge", answer: "   " })]), []);
});

test("a fixed answer is enforced in the gate, ahead of the built-in support facts", () => {
  const fixedIndex = gate.indexOf('actionId: "owner_fixed_answer"') >= 0
    ? gate.indexOf("owner_fixed_answer")
    : gate.indexOf("owner_fixed_answer");
  const supportIndex = gate.indexOf("const supportFactIntent =");
  assert.ok(fixedIndex > 0 && supportIndex > fixedIndex, "owner rules must be checked first");
  assert.match(gate, /findFixedAnswerForMessage/);
});

test("a canned reply can never hijack a turn that is about a product", () => {
  // Same suppression the support facts use: a turn naming a product genuinely is about that product.
  const block = gate.slice(gate.indexOf("OWNER-AUTHORED FIXED ANSWERS"), gate.indexOf("const supportFactIntent ="));
  assert.match(block, /if \(!entities\.productType\) \{/);
});

test("owner facts reach the instruction block but cannot outrank grounding", () => {
  assert.match(persona, /loadKnowledgeLines\(\{ tenantId \}\)/);
  assert.match(persona, /persona\.shop_knowledge/);
  assert.match(persona, /delete nextPersona\.shop_knowledge/);
  // The invariant line must still be above them in the prompt.
  const groundingIndex = persona.indexOf("متخترعش سعر ولا توفر");
  const knowledgeIndex = persona.indexOf("معلومات صاحب المحل");
  assert.ok(groundingIndex > 0 && knowledgeIndex > groundingIndex, "grounding rules must come first");
});

test("the correction endpoint the client calls finally exists", () => {
  // The client has always built /ai-agent/inbox/:id/messages/:id/correction; only the /conversations/
  // form was registered, so every correction anyone typed 404d.
  const helpers = read("src/modules/aiSupport/lib/conversationHelpers.js");
  assert.match(helpers, /aiAgentInboxEndpoint\(sessionId, `\/messages\/\$\{encodeConversationId\(messageId\)\}\/correction`\)/);
  assert.match(routes, /router\.post\("\/inbox\/:conversationId\/messages\/:messageId\/correction", protect, inboxReply\(\), handleReplyCorrection\)/);
  assert.match(routes, /router\.post\("\/conversations\/:conversationId\/messages\/:messageId\/correction", protect, inboxReply\(\), handleReplyCorrection\)/);
});

test("style learning is honoured on the storefront path too", () => {
  const block = contextService.slice(
    contextService.indexOf("const styleLearningEnabled"),
    contextService.indexOf("const employeeCorrectionSources")
  );
  assert.match(block, /style_learning_enabled === true/);
  assert.match(block, /tenantId && styleLearningEnabled/);
});

test("mining groups the same question asked different ways", () => {
  const pairs = [
    { question: "بتشحنوا لاسكندرية؟", answer: "أيوه بنشحن" },
    { question: "هو الشحن لاسكندرية متاح؟", answer: "أيوه بنشحن" },
    { question: "عندكم مقاس ٤٥؟", answer: "لأ خلص" },
  ];
  const clusters = clusterQuestions(pairs, { threshold: 0.3 });
  const shipping = clusters.find((cluster) => cluster.count > 1);
  assert.ok(shipping, "the two shipping questions should land in one cluster");
  assert.equal(shipping.count, 2);
});

test("mining suggests the answer the team gave most often", () => {
  const { dominantAnswer } = __answerMiningTestHooks;
  const best = dominantAnswer(["بنشحن أيوه", "بنشحن أيوه", "مش فاكر"]);
  assert.equal(best.count, 2);
  assert.match(best.answer, /بنشحن/);
});

test("mining reads only conversations a PERSON answered, and is bounded", () => {
  // A staff reply is the signal: where the agent already answered well, nothing needs teaching.
  assert.match(mining, /m\.staff_user_id IS NOT NULL/);
  assert.match(mining, /const MAX_PAIRS = 2000/);
  assert.match(mining, /LOOKBACK_DAYS = 60/);
  assert.match(mining, /deleted_at IS NULL/);
});

test("mining only ever suggests — it cannot change a reply by itself", () => {
  // The dangerous version of "learn from every conversation" is feeding staff replies back as fact.
  assert.doesNotMatch(mining, /INSERT INTO ai_agent_knowledge/);
  assert.doesNotMatch(mining, /UPDATE ai_agent_knowledge/);
  assert.match(routes, /router\.get\("\/knowledge\/suggestions", protect, permit\("settings", "view"\)/);
});

test("the schema ensure is memoized, the way the 2026-08-26 outage taught", () => {
  assert.match(knowledge, /let schemaReadyPromise = null/);
  assert.match(knowledge, /schemaReadyPromise = run\(\)\.catch/);
});

test("writing a rule is settings:edit, reading is settings:view", () => {
  assert.match(routes, /router\.get\("\/knowledge", protect, permit\("settings", "view"\)/);
  assert.match(routes, /router\.post\("\/knowledge", protect, permit\("settings", "edit"\)/);
  assert.match(routes, /router\.patch\("\/knowledge\/:id", protect, permit\("settings", "edit"\)/);
  assert.match(routes, /router\.delete\("\/knowledge\/:id", protect, permit\("settings", "edit"\)/);
});

test("the suggestions route is declared before any /knowledge/:id GET could shadow it", () => {
  const suggestions = routes.indexOf('router.get("/knowledge/suggestions"');
  const idGet = routes.indexOf('router.get("/knowledge/:id"');
  assert.ok(suggestions > 0);
  assert.ok(idGet === -1 || suggestions < idGet, "an :id route must never come first");
});
