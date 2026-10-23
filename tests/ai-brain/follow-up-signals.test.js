import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  __setAgentClientForTests,
  followUpContextLines,
  isPriceObjection,
  runClaudeSalesAgent,
} from "../../server/services/aiClaudeSalesAgentService.js";
import {
  FOLLOW_UP_PRESETS,
  SEQUENCE_TRIGGERS,
  __testing,
  followUpAudienceAllows,
  nextSendWindowStart,
} from "../../server/services/messageSequencesService.js";
import { addRestockWatch, ensureRestockWatchSchema, normalizeSize, resolveCatalogColour, runRestockWatchTick, variantMatchesWatch } from "../../server/modules/restockWatch/restockWatch.js";
import { RESTOCK_REQUEST, restockTargetFrom, safeProductFacts } from "../../server/services/aiUnifiedDecisionService.js";

/**
 * The owner, 2026-10-23: follow-ups "the way GENI does them, professionally" — four ready ones
 * (asked but did not buy, price objection, unfinished order, back in stock), test numbers only at
 * first, never at night.
 */

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cairoClock = (date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
const cairoDay = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(date);

test("a follow-up never lands at night in Cairo", () => {
  // Built from Cairo wall-clock times so the test holds in and out of summer time.
  const at = (hhmm) => {
    for (let hour = 0; hour < 24 * 2; hour += 1) {
      const candidate = new Date(Date.UTC(2026, 9, 23, 0, 0) + hour * 30 * 60 * 1000);
      if (cairoClock(candidate) === hhmm) return candidate;
    }
    throw new Error(`no ${hhmm}`);
  };
  assert.equal(nextSendWindowStart(at("12:00")), null);
  assert.equal(nextSendWindowStart(at("10:00")), null);
  const early = nextSendWindowStart(at("03:00"));
  assert.equal(cairoClock(early), "10:00");
  assert.equal(cairoDay(early), cairoDay(at("03:00")), "early morning waits for the same day's 10:00");
  const late = nextSendWindowStart(at("22:30"));
  assert.equal(cairoClock(late), "10:00");
  assert.notEqual(cairoDay(late), cairoDay(at("22:30")), "late night waits for tomorrow");
  assert.equal(cairoClock(nextSendWindowStart(at("03:00"), { spreadMinutes: 7 })), "10:07", "a night's backlog is spread out");
});

test("while the agent is test-only, automatic follow-ups reach only the test numbers", async () => {
  const saved = process.env.AI_SALES_AGENT_SCOPE;
  try {
    process.env.AI_SALES_AGENT_SCOPE = "test";
    const loadTestContacts = async () => "01024960585";
    assert.equal(await followUpAudienceAllows({ sessionId: "whatsapp:201024960585", loadTestContacts }), true);
    assert.equal(await followUpAudienceAllows({ sessionId: "messenger:77", phone: "+20 102 496 0585", loadTestContacts }), true);
    assert.equal(await followUpAudienceAllows({ sessionId: "whatsapp:201011112222", loadTestContacts }), false);
    process.env.AI_SALES_AGENT_SCOPE = "all";
    assert.equal(await followUpAudienceAllows({ sessionId: "whatsapp:201011112222", loadTestContacts }), true);
  } finally {
    process.env.AI_SALES_AGENT_SCOPE = saved ?? "";
  }
});

test("the four ready follow-ups are valid sequences, AI-written with a fixed fallback", () => {
  assert.deepEqual(FOLLOW_UP_PRESETS.map((preset) => preset.trigger_type), ["inquiry_no_purchase", "price_objection", "order_incomplete", "back_in_stock"]);
  for (const preset of FOLLOW_UP_PRESETS) {
    assert.ok(SEQUENCE_TRIGGERS.includes(preset.trigger_type));
    const normalized = __testing.normalizeSequenceInput({ ...preset, is_active: true });
    assert.equal(normalized.trigger_type, preset.trigger_type);
    for (const step of normalized.steps) {
      assert.equal(step.mode, "ai");
      assert.ok(step.body.length > 10, "every AI step keeps a fallback text");
      assert.match(step.ai_instruction, /متخترعش خصم/, "no step may invent a discount");
    }
  }
});

test("a price objection is an objection that talks about money", () => {
  assert.equal(isPriceObjection({ category: "objection", fact: "شايف السعر غالي عليه" }), true);
  assert.equal(isPriceObjection({ category: "objection", fact: "عايز حاجة أرخص" }), true);
  assert.equal(isPriceObjection({ category: "objection", fact: "مش واثق في الميرور" }), false);
  assert.equal(isPriceObjection({ category: "budget", fact: "ميزانيته 1500" }), false);
  assert.deepEqual(followUpContextLines({ product_name: "Jordan 4", size: "43" }), ["<follow_up_context>", "الموديل: Jordan 4", "المقاس: 43", "</follow_up_context>"]);
  assert.deepEqual(followUpContextLines({}), []);
});

const withAgent = async (responses, fn) => {
  const saved = { enabled: process.env.AI_CLAUDE_AGENT_ENABLED, key: process.env.ANTHROPIC_API_KEY, scope: process.env.AI_SALES_AGENT_SCOPE, provider: process.env.AI_SALES_AGENT_PROVIDER };
  process.env.AI_CLAUDE_AGENT_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_SALES_AGENT_SCOPE = "all";
  process.env.AI_SALES_AGENT_PROVIDER = "anthropic";
  __setAgentClientForTests({ beta: { messages: { create: async () => responses.shift() } } });
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

const baseLoaders = {
  persona: async () => ({}),
  knowledgeBase: async () => ({ knowledge_base: {}, branches: [] }),
  history: async () => [],
  customerCard: async () => "",
  customerFacts: async () => [],
};
const inbound = { channel: "whatsapp", text: "x", originalText: "x", customerName: "Ali", externalConversationId: "whatsapp:201024960585", metadata: {} };
const decision = { intent: "general", detected_intent: "general", text: "أهلا", product_cards: [] };

test("«غالي عليا» written down by the agent starts the price-objection follow-up", async () => {
  const signals = [];
  await withAgent([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "r1", name: "remember_fact", input: { fact: "شايف السعر غالي عليه", category: "objection" } }], usage: {} },
    { stop_reason: "end_turn", content: [{ type: "text", text: "فاهم حضرتك" }], usage: {} },
  ], () => runClaudeSalesAgent({
    decision,
    inbound: { ...inbound, text: "ده غالي اوي", originalText: "ده غالي اوي" },
    loaders: { ...baseLoaders, rememberFact: async () => ({ ok: true, id: 3 }), customerSignal: async (input) => { signals.push(input); return 1; } },
    helpers: { safeProductFacts },
  }));
  assert.deepEqual(signals, [{ tenantId: null, sessionId: "whatsapp:201024960585", channel: "whatsapp", signal: "price_objection" }]);
});

test("«بلّغني لما ينزل» becomes a restock watch", async () => {
  const watches = [];
  const out = await withAgent([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "w1", name: "watch_restock", input: { product_id: "61", size: "44" } }], usage: {} },
    { stop_reason: "end_turn", content: [{ type: "text", text: "أول ما ينزل هبلّغ حضرتك" }], usage: {} },
  ], () => runClaudeSalesAgent({
    decision,
    inbound,
    loaders: { ...baseLoaders, watchRestock: async (input) => { watches.push(input); return { ok: true, id: 8 }; } },
    helpers: { safeProductFacts },
  }));
  assert.equal(watches[0].productId, "61");
  assert.equal(watches[0].size, "44");
  assert.equal(watches[0].sessionId, "whatsapp:201024960585");
  assert.deepEqual(out.debug.claude_agent.restock_watches, [{ id: 8, product_id: "61", size: "44", color: "" }]);
});

test("a watch matches the catalog's own size and colour; «الأسود» resolves to Black", () => {
  assert.equal(variantMatchesWatch({ size: "47", color: "Black" }, { size: "47", color: "Black" }), true);
  assert.equal(variantMatchesWatch({ size: "47", color: "White & Black" }, { size: "47", color: "Black" }), false, "a two-tone pair is another colour");
  assert.equal(variantMatchesWatch({ size: "44.5", color: "Black" }, { size: "44" }), false);
  assert.equal(variantMatchesWatch({ size: "42", color: "Navy" }, {}), true);
  const variants = [{ color: "White & Black" }, { color: "Black" }, { color: "Navy" }];
  assert.equal(resolveCatalogColour(variants, "الأسود"), "Black", "the plain colour before the two-tone one");
  assert.equal(resolveCatalogColour(variants, "نيفي"), "Navy");
  assert.equal(resolveCatalogColour(variants, "navy"), "Navy");
  assert.equal(resolveCatalogColour(variants, "أحمر"), "", "a colour the model does not come in");
  assert.equal(normalizeSize("٤٧"), "47");
  assert.equal(normalizeSize(" 44.5 "), "44.5");
});

test("«بلّغني لما ينزل» in the size step is read for model, size and the colour said now", () => {
  assert.equal(RESTOCK_REQUEST.test("لو مش موجود بلغني أول ما ينزل"), true);
  assert.equal(RESTOCK_REQUEST.test("عرفني لما يتوفر"), true);
  assert.equal(RESTOCK_REQUEST.test("عايز مقاس 47"), false);
  const target = restockTargetFrom({
    output: { memoryUpdates: { active_product_id: "180", selectedColor: "Navy" } },
    memory: { selectedSize: "44" },
    message: "لا أنا عايزه أسود مش نيفي، الأسود مقاس ٤٧ موجود؟ لو مش موجود بلغني",
  });
  assert.deepEqual(target, { productId: "180", size: "47", color: "black" });
});

test("the wiring: one track per customer, quiet hours, the audience at send time, the order steps, the worker", () => {
  const engine = read("../../server/services/messageSequencesService.js");
  assert.match(engine, /const SIGNAL_PRIORITY = Object\.freeze\(\{ inquiry_no_purchase: 1, price_objection: 2, order_incomplete: 3 \}\);/);
  assert.match(engine, /if \(running\.rows\.some\(\(row\) => SIGNAL_PRIORITY\[row\.trigger_type\] >= priority\)\) continue;/);
  assert.match(engine, /return "quiet_hours";/);
  assert.match(engine, /stopped", "audience_test_only"/);
  assert.match(engine, /ai_agent_conversation_id = \$3/, "an order from the chat stops it even with no phone");
  const unified = read("../../server/services/aiUnifiedDecisionService.js");
  assert.match(unified, /const ORDER_STEP_INTENTS = new Set\(\["post_product_color_selected", "post_product_size_selected", "post_product_order_confirmation"\]\);/);
  assert.match(unified, /ORDER_STEP_INTENTS\.has\(outputIntent\) \? "order_incomplete" : outputIntent === "price_objection" \? "price_objection" : ""/);
  const server = read("../../server/server.js");
  assert.match(server, /void runRestockWatchTick\(\)\.catch/);
  assert.match(server, /await ensureRestockWatchSchema\(db\)\n\s*\.then/);
  const routes = read("../../server/routes/aiAgentOrders.js");
  assert.match(routes, /router\.post\("\/sequences\/presets", protect, permit\("settings", "edit"\)/);
});

// Against the local database, inside a transaction that is rolled back.
test("a restock watch fires once, when the stock comes back", async (t) => {
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
    const pick = await client.query(
      `SELECT pv.id, pv.product_id, pv.size, p.tenant_id FROM product_variants pv JOIN products p ON p.id = pv.product_id
       WHERE pv.deleted_at IS NULL AND pv.is_active IS DISTINCT FROM FALSE AND COALESCE(pv.size, '') <> '' LIMIT 1`
    );
    if (!pick.rows[0]) {
      t.skip("no variant to test with");
      return;
    }
    const variant = pick.rows[0];
    const tenantId = Number(variant.tenant_id || 1);
    await client.query(`UPDATE product_variants SET stock = 0 WHERE product_id = $1`, [variant.product_id]);
    await ensureRestockWatchSchema(client);
    const watch = { tenantId, sessionId: "whatsapp:201024960585", channel: "whatsapp", productId: variant.product_id, size: variant.size, client };
    const added = await addRestockWatch(watch);
    assert.equal(added.ok, true);
    assert.equal((await addRestockWatch(watch)).already_watching, true);
    const signals = [];
    const signal = async (input) => { signals.push(input); return 1; };
    assert.equal((await runRestockWatchTick({ client, signal, force: true })).fired, 0, "still out of stock: nothing");
    await client.query(`UPDATE product_variants SET stock = 3 WHERE id = $1`, [variant.id]);
    assert.equal((await runRestockWatchTick({ client, signal, force: true })).fired, 1);
    assert.equal(signals[0].signal, "back_in_stock");
    assert.equal(signals[0].context.size, variant.size);
    assert.equal((await runRestockWatchTick({ client, signal, force: true })).fired, 0, "a watch fires once");
    // In stock already: nothing to wait for.
    assert.equal((await addRestockWatch(watch)).reason, "in_stock_now");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await db.end?.().catch?.(() => {});
  }
});
