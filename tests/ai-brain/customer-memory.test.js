import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  __setAgentClientForTests,
  buildDynamicContext,
  buildStablePrompt,
  runClaudeSalesAgent,
} from "../../server/services/aiClaudeSalesAgentService.js";
import {
  MAX_ACTIVE_FACTS,
  cleanFact,
  customerMemoryPromptLines,
  ensureCustomerMemorySchema,
  forgetCustomerFact,
  loadCustomerMemoryFacts,
  memoryIdentityKeys,
  normalizeFactText,
  rememberCustomerFact,
} from "../../server/modules/customerMemory/customerMemory.js";
import { safeProductFacts } from "../../server/services/aiUnifiedDecisionService.js";

/**
 * The owner, 2026-10-23: the sales agent should remember what a customer told it — size, fit,
 * who they buy for, a restock request — from one conversation to the next, on any channel
 * (GENI's remember / forget). Facts live in our own Postgres, keyed by the customer's mobile.
 */

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a customer's facts live under their mobile, then the thread", () => {
  assert.deepEqual(memoryIdentityKeys({ sessionId: "whatsapp:201011112222" }), ["phone:1011112222", "session:whatsapp:201011112222"]);
  // A Messenger thread with the number the customer typed in it: the number first.
  assert.deepEqual(memoryIdentityKeys({ sessionId: "messenger:998877665544332", phones: ["01011112222", "+201011112222"] }), ["phone:1011112222", "session:messenger:998877665544332"]);
  // A Meta page-scoped id is not a phone and never becomes one.
  assert.deepEqual(memoryIdentityKeys({ sessionId: "instagram:1784", phones: ["17841400000000000"] }), ["session:instagram:1784"]);
  assert.deepEqual(memoryIdentityKeys({}), []);
});

test("the same fact said twice is one fact; a fact is one short line", () => {
  assert.equal(normalizeFactText("مقاسه 43، ورجله عريضة!"), normalizeFactText("مقاسه 43 ورجله عريضه"));
  assert.equal(normalizeFactText("بيحب الإسود"), normalizeFactText("بيحب الاسود"));
  assert.equal(cleanFact(`  ${"ا".repeat(300)}  `).length, 200);
  assert.deepEqual(customerMemoryPromptLines([{ id: 7, fact: "بيشتري لابنه  مقاس 38" }]), ["- [7] بيشتري لابنه مقاس 38"]);
});

test("the prompt carries the memory block and the rules for writing it", () => {
  const context = buildDynamicContext({ customerName: "Ali", customerFacts: [{ id: 3, fact: "مقاسه 43 ورجله عريضة" }] });
  assert.match(context, /<customer_memory>\n- \[3\] مقاسه 43 ورجله عريضة\n<\/customer_memory>/);
  assert.doesNotMatch(buildDynamicContext({ customerName: "Ali" }), /customer_memory/);
  const stable = buildStablePrompt({});
  assert.match(stable, /<customer_memory_rules>/);
  assert.match(stable, /remember_fact/);
  assert.match(stable, /forget_fact/);
  // Nothing per-customer in the cached half.
  assert.doesNotMatch(stable, /مقاسه 43/);
});

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

test("the agent sees what it knew, writes down what is new, and forgets what changed", async () => {
  await withEnv(async () => {
    const seen = [];
    const remembered = [];
    const forgotten = [];
    __setAgentClientForTests(fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "f1", name: "forget_fact", input: { fact_id: "[5]", reason: "المقاس اتغير" } },
          { type: "tool_use", id: "r1", name: "remember_fact", input: { fact: "مقاسه بقى 44", category: "size_fit" } },
        ],
        usage: {},
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "تمام يا فندم، هشوفلك 44 👌" }], usage: {} },
    ], seen));
    const out = await runClaudeSalesAgent({
      decision: { intent: "product_search", detected_intent: "product_search", text: "أيوه متاح", product_cards: [] },
      inbound: { channel: "whatsapp", text: "أنا بقيت بلبس 44", originalText: "أنا بقيت بلبس 44", customerName: "Ali", externalConversationId: "whatsapp:201011112222", metadata: {} },
      loaders: {
        persona: async () => ({}),
        knowledgeBase: async () => ({ knowledge_base: {}, branches: [] }),
        history: async () => [],
        customerCard: async () => "",
        customerFacts: async () => [{ id: 5, fact: "مقاسه 43" }],
        rememberFact: async (input) => { remembered.push(input); return { ok: true, id: 9 }; },
        forgetFact: async (input) => { forgotten.push(input); return { ok: true, id: Number(input.factId) }; },
      },
      helpers: { safeProductFacts },
    });
    assert.match(seen[0].system[1].text, /<customer_memory>\n- \[5\] مقاسه 43/);
    assert.equal(forgotten[0].factId, "5", "the [5] the model copied from the prompt is cleaned to the id");
    assert.equal(remembered[0].fact, "مقاسه بقى 44");
    assert.equal(remembered[0].category, "size_fit");
    assert.equal(remembered[0].source, "agent");
    assert.equal(remembered[0].sessionId, "whatsapp:201011112222");
    assert.deepEqual(out.debug.claude_agent.memory, { known: 1, remembered: [{ id: 9, fact: "مقاسه بقى 44", already_known: false }], forgotten: [5] });
    assert.equal(out.text, "تمام يا فندم، هشوفلك 44 👌");
  });
});

test("a memory that cannot load never stops the reply", async () => {
  await withEnv(async () => {
    __setAgentClientForTests(fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "أهلا بيك" }], usage: {} }]));
    const out = await runClaudeSalesAgent({
      decision: { intent: "general", detected_intent: "general", text: "أهلا", product_cards: [] },
      inbound: { channel: "messenger", text: "عندكم ايه", originalText: "عندكم ايه", customerName: "Ali", externalConversationId: "messenger:1", metadata: {} },
      loaders: {
        persona: async () => ({}),
        knowledgeBase: async () => ({ knowledge_base: {}, branches: [] }),
        history: async () => [],
        customerCard: async () => "",
        customerFacts: async () => { throw new Error("db down"); },
      },
      helpers: { safeProductFacts },
    });
    assert.equal(out.text, "أهلا بيك");
    assert.equal(out.debug.claude_agent.memory.known, 0);
  });
});

test("staff see and correct the memory; the table is made at boot without risking it", () => {
  const routes = read("../../server/routes/aiAgentOrders.js");
  assert.match(routes, /router\.get\("\/conversations\/:conversationId\/customer-memory", protect, inboxView\(\)/);
  assert.match(routes, /router\.post\("\/conversations\/:conversationId\/customer-memory", protect, inboxReply\(\)/);
  assert.match(routes, /router\.delete\("\/conversations\/:conversationId\/customer-memory\/:factId", protect, inboxReply\(\)/);
  const server = read("../../server/server.js");
  const boot = server.slice(server.indexOf("const bootstrapStartup"));
  assert.match(boot, /await ensureCustomerMemorySchema\(db\)\n\s*\.then\([\s\S]*?\.catch\(/);
  const panel = read("../../src/shared/components/inboxCustomerOrders/InboxCustomerOrdersPanel.jsx");
  assert.match(panel, /<CustomerMemory sessionId=\{sessionId\} phone=\{phone\} headers=\{headers\} skin=\{skin\} \/>/);
});

// Against the local database, inside a transaction that is rolled back.
test("remember / load / forget on a real Postgres", async (t) => {
  const { default: db } = await import("../../server/database/db.js");
  let client;
  try {
    client = await db.connect();
  } catch {
    t.skip("no local database");
    return;
  }
  try {
    await client.query("BEGIN");
    await ensureCustomerMemorySchema(client);
    const whatsapp = { tenantId: 1, sessionId: "whatsapp:201099990000", client };
    const first = await rememberCustomerFact({ ...whatsapp, fact: "مقاسه 43 ورجله عريضة", category: "size_fit" });
    assert.equal(first.ok, true);
    // Said again in other words' spelling: the same fact, not a second line.
    const again = await rememberCustomerFact({ ...whatsapp, fact: "مقاسه 43، ورجله عريضه" });
    assert.deepEqual([again.ok, again.id, again.already_known], [true, first.id, true]);
    // A Messenger thread where the customer typed that number sees the WhatsApp fact.
    const messenger = { tenantId: 1, sessionId: "messenger:5550001", phones: ["01099990000"], client };
    await rememberCustomerFact({ ...messenger, fact: "بيشتري لابنه كمان", category: "for_whom" });
    const fromMessenger = await loadCustomerMemoryFacts(messenger);
    assert.deepEqual(fromMessenger.map((fact) => fact.fact).sort(), ["بيشتري لابنه كمان", "مقاسه 43 ورجله عريضة"].sort());
    // Another customer's thread cannot forget it.
    assert.equal((await forgetCustomerFact({ tenantId: 1, sessionId: "whatsapp:201088880000", factId: first.id, client })).ok, false);
    assert.equal((await forgetCustomerFact({ ...whatsapp, factId: first.id, reason: "اتغير" })).ok, true);
    assert.deepEqual((await loadCustomerMemoryFacts(whatsapp)).map((fact) => fact.fact), ["بيشتري لابنه كمان"]);
    // Past the cap the oldest are set aside.
    for (let index = 0; index < MAX_ACTIVE_FACTS + 3; index += 1) {
      await rememberCustomerFact({ ...whatsapp, fact: `حقيقة رقم ${index}` });
    }
    assert.equal((await loadCustomerMemoryFacts({ ...whatsapp, limit: 100 })).length, MAX_ACTIVE_FACTS);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await db.end?.().catch?.(() => {});
  }
});
