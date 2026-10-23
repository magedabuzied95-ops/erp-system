import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  __setAgentClientForTests,
  buildDynamicContext,
  buildStablePrompt,
  historyTurnsFromRows,
  runClaudeSalesAgent,
  SKIP_INTENTS,
} from "../../server/services/aiClaudeSalesAgentService.js";
import { safeProductFacts } from "../../server/services/aiUnifiedDecisionService.js";

/**
 * The owner, 2026-10-20: "خليه زيهم بالظبط" — the model writes the reply, from a GENI-style
 * sectioned prompt, with the conversation history and tools. Brain V2 still finds the products;
 * the order steps stay deterministic; any failure keeps brain V2's reply.
 */

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const airForce = { product_id: "11", id: "11", title: "Nike Air Force 1", price: 1450, available_colors: ["أبيض"], available_sizes: ["41", "42"], total_stock: 9, image_url: "https://x/af1.jpg" };
const jordan = { product_id: "22", id: "22", title: "Jordan 4", price: 2100, available_colors: ["أسود"], available_sizes: ["43"], total_stock: 3, image_url: "https://x/j4.jpg" };

const loaders = {
  persona: async () => ({ forbidden_phrases: ["أنا مساعد ذكي"], shop_knowledge: ["الشحن مجاني فوق 2000"] }),
  knowledgeBase: async () => ({ knowledge_base: { store_name: "M1 Store", payment_methods: "كاش عند الاستلام" }, branches: [] }),
  history: async () => [{ role: "user", content: "السلام عليكم" }, { role: "assistant", content: "وعليكم السلام ورحمة الله\nتحت أمر حضرتك؟" }],
  customerCard: async () => "",
  customerFacts: async () => [],
};

const withEnv = async (fn) => {
  const saved = { enabled: process.env.AI_CLAUDE_AGENT_ENABLED, key: process.env.ANTHROPIC_API_KEY, scope: process.env.AI_SALES_AGENT_SCOPE, provider: process.env.AI_SALES_AGENT_PROVIDER };
  process.env.AI_CLAUDE_AGENT_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_SALES_AGENT_SCOPE = "all";
  process.env.AI_SALES_AGENT_PROVIDER = "anthropic";
  try {
    return await fn();
  } finally {
    process.env.AI_CLAUDE_AGENT_ENABLED = saved.enabled ?? "";
    process.env.ANTHROPIC_API_KEY = saved.key ?? "";
    process.env.AI_SALES_AGENT_SCOPE = saved.scope ?? "";
    process.env.AI_SALES_AGENT_PROVIDER = saved.provider ?? "";
    __setAgentClientForTests(null);
  }
};

const fakeClient = (responses, seen = []) => ({
  beta: {
    messages: {
      create: async (params) => {
        seen.push(JSON.parse(JSON.stringify(params)));
        const next = responses.shift();
        if (!next) throw new Error("no more fake responses");
        return next;
      },
    },
  },
});

const inbound = { channel: "whatsapp", text: "عايزة جوردن", originalText: "عايزة جوردن", customerName: "Heba", externalConversationId: "whatsapp:2010", metadata: {} };
const decision = { intent: "product_search", detected_intent: "product_search", text: "أيوه متاح إن شاء الله 👇", product_cards: [airForce], channel_reply: { text: "أيوه متاح إن شاء الله 👇" } };

test("off by default: no flag or no key keeps brain V2's reply", async () => {
  process.env.AI_CLAUDE_AGENT_ENABLED = "";
  assert.equal(await runClaudeSalesAgent({ decision, inbound, loaders }), null);
});

test("the sale's own steps and the owner's greeting never reach the model", async () => {
  await withEnv(async () => {
    __setAgentClientForTests(fakeClient([]));
    for (const intent of ["greeting", "post_product_order_confirmation", "post_product_size_selected", "human_takeover"]) {
      assert.ok(SKIP_INTENTS.includes(intent));
      assert.equal(await runClaudeSalesAgent({ decision: { ...decision, intent, detected_intent: intent }, inbound, loaders }), null, intent);
    }
  });
});

test("the model searches, picks other cards, and its words become the reply", async () => {
  await withEnv(async () => {
    const seen = [];
    __setAgentClientForTests(fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search_products", input: { query: "جوردن" } }], usage: {} },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "show_products", input: { product_ids: ["22"] } }], usage: {} },
      { stop_reason: "end_turn", content: [{ type: "text", text: "أيوه يا أستاذة، الجوردن 4 متاح 👇" }], usage: { cache_read_input_tokens: 900 } },
    ], seen));
    const out = await runClaudeSalesAgent({
      decision,
      inbound,
      customerGender: "female",
      loaders,
      helpers: { safeProductFacts, searchCards: async (query) => (query === "جوردن" ? [jordan] : []) },
    });
    assert.equal(out.text, "أيوه يا أستاذة، الجوردن 4 متاح 👇");
    assert.equal(out.channel_reply.text, out.text);
    assert.deepEqual(out.product_cards.map((card) => card.product_id), ["22"], "the card it chose replaces the prepared one");
    assert.equal(out.memoryUpdates.active_product_id, "22", "the next colour/size step follows the shown card");
    assert.equal(out.debug.claude_agent.applied, true);

    const first = seen[0];
    assert.equal(first.model, "claude-sonnet-5-5");
    assert.equal(first.output_config.effort, "low");
    assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(first.fallbacks, "default");
    assert.equal(first.system[0].cache_control.type, "ephemeral", "the stable prompt is cached");
    assert.doesNotMatch(first.system[0].text, /Heba/, "nothing per-customer in the cached half");
    assert.match(first.system[1].text, /<client_name verbatim="true">Heba<\/client_name>/);
    assert.match(first.system[1].text, /صيغة المؤنث/);
    assert.equal(first.messages[0].content, "السلام عليكم", "the conversation so far goes in");
    const last = first.messages[first.messages.length - 1];
    assert.equal(last.role, "system");
    assert.match(last.content, /<system_findings>/);
    assert.match(last.content, /Nike Air Force 1/);
    // Round two carries the assistant turn back unchanged and the tool result after it.
    assert.equal(seen[1].messages.at(-2).role, "assistant");
    assert.equal(seen[1].messages.at(-1).content[0].type, "tool_result");
  });
});

test("without show_products the prepared cards go out under the model's line", async () => {
  await withEnv(async () => {
    __setAgentClientForTests(fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "**أيوه** متاح 👇" }], usage: {} }]));
    const out = await runClaudeSalesAgent({ decision, inbound, loaders, helpers: { safeProductFacts } });
    assert.equal(out.text, "أيوه متاح 👇", "markdown stripped");
    assert.deepEqual(out.product_cards, [airForce]);
  });
});

test("a refusal, an error or an empty answer keeps brain V2's reply", async () => {
  await withEnv(async () => {
    __setAgentClientForTests(fakeClient([{ stop_reason: "refusal", content: [], usage: {} }]));
    assert.equal(await runClaudeSalesAgent({ decision, inbound, loaders, helpers: { safeProductFacts } }), null);
    __setAgentClientForTests(fakeClient([]));
    assert.equal(await runClaudeSalesAgent({ decision, inbound, loaders, helpers: { safeProductFacts } }), null);
    __setAgentClientForTests(fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "  " }], usage: {} }]));
    assert.equal(await runClaudeSalesAgent({ decision, inbound, loaders, helpers: { safeProductFacts } }), null);
  });
});

test("escalate_to_human is recorded, and the colleague line is still sent", async () => {
  await withEnv(async () => {
    __setAgentClientForTests(fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "e1", name: "escalate_to_human", input: { reason: "شكوى تأخير" } }], usage: {} },
      { stop_reason: "end_turn", content: [{ type: "text", text: "معلش يا فندم، زميلي هيتابع مع حضرتك دلوقتي." }], usage: {} },
    ]));
    const out = await runClaudeSalesAgent({ decision, inbound: { ...inbound, externalConversationId: "" }, loaders, helpers: { safeProductFacts } });
    assert.equal(out.debug.claude_agent.escalated, true);
    assert.match(out.text, /زميلي/);
  });
});

test("the prompt carries GENI's sections, in Egyptian Arabic", () => {
  const prompt = buildStablePrompt({ kb: { store_name: "M1 Store", payment_methods: "كاش" }, persona: { forbidden_phrases: ["أنا مساعد ذكي"], shop_knowledge: ["معلومة"] } });
  for (const section of ["<your_job>", "<company_info>", "<owner_knowledge>", "<products_and_cards>", "<egyptian_arabic_register>", "<honorifics>", "<message_limit>", "<handing_over_to_a_person>", "<response_examples>", "<critical_rules>"]) {
    assert.ok(prompt.includes(section), section);
  }
  assert.match(prompt, /M1 Store/);
  assert.match(prompt, /ممنوع نهائيًا: أنا مساعد ذكي/);
  const dynamic = buildDynamicContext({ customerName: "Mohamed", gender: "male", memory: { selectedSize: "42" } });
  assert.match(dynamic, /صيغة المذكر/);
  assert.match(dynamic, /المقاس اللي قاله: 42/);
});

test("history rows become chat turns, the current message is not doubled", () => {
  const rows = [
    { sender_type: "customer", message_text: "بكام؟" }, // newest first, as the query returns them
    { sender_type: "ai", message_type: "product_card", product_cards: [{ title: "Jordan 4" }] },
    { sender_type: "ai", ai_answer: "أيوه متاح 👇" },
    { sender_type: "customer", message_text: "عندك جوردن؟" },
    { sender_type: "staff", staff_message: "أهلا" },
  ];
  assert.deepEqual(historyTurnsFromRows(rows, "بكام؟"), [
    { role: "user", content: "عندك جوردن؟" },
    { role: "assistant", content: "أيوه متاح 👇\n[اتبعتله كروت: Jordan 4]" },
  ]);
});

test("the unified decision hands every channel's reply to the agent first", () => {
  const unified = read("../../server/services/aiUnifiedDecisionService.js");
  assert.match(unified, /const agentDecision = await runClaudeSalesAgent\(\{/);
  assert.match(unified, /decision = agentDecision\s*\|\| await rewriteStructuredDecision\(/);
  const ignore = read("../../.gitignore");
  assert.match(ignore, /^!server\/services\/aiClaudeSalesAgentService\.js$/m, "a gitignored service never deploys");
});

test("a wrong reply becomes one proposed lesson; an edit to a missing line becomes a new one", async () => {
  const { proposeAgentLesson } = await import("../../server/services/aiClaudeSalesAgentService.js");
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const seen = [];
  const answer = (lesson) => ({ messages: { create: async (params) => { seen.push(params); return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(lesson) }] }; } } });
  const knowledge = async () => [{ id: 7, title: "الشحن", answer: "الشحن لكل المحافظات 75 جنيه", enabled: true }];
  try {
    __setAgentClientForTests(answer({ action: "update", entry_id: 7, title: "الشحن", triggers: ["شحن", "اسوان"], answer: "الشحن 75 جنيه، والصعيد الجواني (أسوان والأقصر) 95", explanation: "السطر القديم كان بيقول 75 لكل مكان" }));
    const lesson = await proposeAgentLesson({ aiReply: "الشحن لأسوان 75", correctReply: "الشحن لأسوان 95", loaders: { knowledge } });
    assert.equal(lesson.action, "update");
    assert.equal(lesson.entry_id, 7);
    assert.equal(lesson.previous_answer, "الشحن لكل المحافظات 75 جنيه", "the owner sees before and after");
    assert.equal(seen[0].output_config.format.type, "json_schema");
    assert.match(seen[0].messages[0].content, /الشحن لكل المحافظات 75 جنيه/, "the current lines go to the model");

    __setAgentClientForTests(answer({ action: "update", entry_id: 999, title: "x", triggers: [], answer: "سطر", explanation: "" }));
    const orphan = await proposeAgentLesson({ aiReply: "a", feedback: "b", loaders: { knowledge } });
    assert.equal(orphan.action, "create");
    assert.equal(orphan.entry_id, null);

    await assert.rejects(proposeAgentLesson({ aiReply: "", correctReply: "x", loaders: { knowledge } }), /both needed/);
  } finally {
    process.env.ANTHROPIC_API_KEY = saved ?? "";
    __setAgentClientForTests(null);
  }
});

test("both inboxes offer the lesson, through the knowledge routes the owner already uses", () => {
  const modal = read("../../src/modules/aiSupport/components/ReplyCorrectionModal.jsx");
  assert.match(modal, /api\.post\("\/ai-agent\/feedback\/propose-lesson"/);
  assert.match(modal, /api\.patch\(`\/ai-agent\/knowledge\/\$\{lesson\.entry_id\}`/);
  for (const page of ["AiInbox", "AiInboxPwa"]) {
    const source = read(`../../src/modules/aiSupport/pages/${page}.jsx`);
    assert.match(source, /onSave=\{saveReplyCorrection\}\s*headers=\{headers\}\s*tenantId=\{tenantId\}/, page);
  }
  const routes = read("../../server/routes/aiAgentOrders.js");
  assert.match(routes, /router\.post\("\/feedback\/propose-lesson", protect, permit\("settings", "edit"\)/);
});

test("scope 'test' (the default): only the playground and the owner's test numbers get the agent", async () => {
  const { agentAppliesTo } = await import("../../server/services/aiClaudeSalesAgentService.js");
  const saved = process.env.AI_SALES_AGENT_SCOPE;
  process.env.AI_SALES_AGENT_SCOPE = "";
  try {
    const loadTestContacts = async () => "201000000001";
    assert.equal(await agentAppliesTo({ metadata: { source: "ai_playground" } }, { loadTestContacts }), true);
    assert.equal(await agentAppliesTo({ externalCustomerId: "201000000001", metadata: {} }, { loadTestContacts }), true);
    assert.equal(await agentAppliesTo({ externalCustomerId: "201099999999", metadata: {} }, { loadTestContacts }), false, "a real customer keeps brain V2");
    process.env.AI_SALES_AGENT_SCOPE = "all";
    assert.equal(await agentAppliesTo({ externalCustomerId: "201099999999", metadata: {} }, { loadTestContacts }), true);
  } finally {
    process.env.AI_SALES_AGENT_SCOPE = saved ?? "";
  }
});

test("the same agent runs on OpenAI's Responses API: tools, call outputs, cards", async () => {
  const { __setOpenAiClientForTests } = await import("../../server/services/aiClaudeSalesAgentService.js");
  await withEnv(async () => {
    process.env.AI_SALES_AGENT_PROVIDER = "openai";
    process.env.AI_SALES_AGENT_OPENAI_MODEL = "gpt-4o";
    process.env.AI_SUPPORT_ENABLED = "true";
    const seen = [];
    const replies = [
      { output: [{ type: "function_call", call_id: "c1", name: "search_products", arguments: JSON.stringify({ query: "جوردن" }) }], usage: {} },
      { output: [{ type: "function_call", call_id: "c2", name: "show_products", arguments: JSON.stringify({ product_ids: ["22"] }) }], usage: {} },
      { output: [{ type: "message" }], output_text: "أيوه الجوردن متاح 👇", status: "completed", usage: { input_tokens_details: { cached_tokens: 1200 } } },
    ];
    __setOpenAiClientForTests({ responses: { create: async (params) => { seen.push(JSON.parse(JSON.stringify(params))); return replies.shift(); } } });
    try {
      const out = await runClaudeSalesAgent({ decision, inbound, customerGender: "female", loaders, helpers: { safeProductFacts, searchCards: async () => [jordan] } });
      assert.ok(out, "OpenAI path produced a reply");
      assert.equal(out.text, "أيوه الجوردن متاح 👇");
      assert.deepEqual(out.product_cards.map((card) => card.product_id), ["22"]);
      assert.equal(out.debug.claude_agent.provider, "openai");
      assert.equal(out.debug.claude_agent.usage.cache_read, 1200);
      assert.equal(seen[0].model, "gpt-4o");
      assert.match(seen[0].instructions, /<egyptian_arabic_register>/, "the stable prompt is the instructions");
      assert.equal(seen[0].input[0].role, "developer");
      assert.match(seen[0].input[0].content, /صيغة المؤنث/);
      assert.equal(seen[0].input.at(-1).role, "developer");
      assert.match(seen[0].input.at(-1).content, /<system_findings>/);
      assert.equal(seen[0].tools[0].type, "function");
      assert.equal(seen[1].input.at(-1).type, "function_call_output");
      assert.equal(seen[1].input.at(-1).call_id, "c1");
    } finally {
      __setOpenAiClientForTests(null);
      delete process.env.AI_SALES_AGENT_OPENAI_MODEL;
    }
  });
});
