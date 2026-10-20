import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { expandSearchAliasTerms } from "../../server/services/productAliasEngine.js";
import { SKIP_INTENTS } from "../../server/services/aiClaudeSalesAgentService.js";

/** The owner's own WhatsApp test, 2026-10-20 (production logs 18:27–18:34). */
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("«عايز نيوبالانس 530» searches for New Balance 530", () => {
  for (const query of ["عايز نيوبالانس 530", "نيو بالانس 530", "نيوبلانس 530"]) {
    assert.ok(expandSearchAliasTerms(query).some((term) => term.includes("new balance 530")), query);
  }
  assert.ok(expandSearchAliasTerms("عايز ريبوك").some((term) => term.includes("reebok")));
});

test("«الاوردر بتاعي وصل لفين» reaches the agent and its phone-checked order lookup", () => {
  assert.equal(SKIP_INTENTS.includes("order_tracking"), false, "it used to get «ابعت الموديل» from the template");
  assert.equal(SKIP_INTENTS.includes("order_follow_up"), false);
  const agent = read("../../server/services/aiClaudeSalesAgentService.js");
  assert.match(agent, /case "get_order_status": \{\s*const phone = text\(input\.phone\) \|\| customerPhone;\s*const found = await findCustomerOrders\(\{ tenantId, orderNumber: text\(input\.order_number\), phone \}\);/);
});

test("an order is only found for the phone it was placed with, inside this shop", () => {
  const tools = read("../../server/services/aiBusinessToolsService.js");
  const lookup = tools.slice(tools.indexOf("export const findCustomerOrders"), tools.indexOf("export const loadBusinessToolContext"));
  assert.match(lookup, /if \(!variants\.length\) return \{ found: false, reason: "phone_needed" \};/);
  assert.match(lookup, /WHERE o\.tenant_id = \$1\s*AND \$\{phoneSqlDigits\("o\.customer_phone"\)\} = ANY\(\$2::text\[\]\)/);
  // The old lookup's OR escaped the tenant filter.
  assert.match(tools, /clauses\.push\(`\(public_order_number = \$\$\{params\.length\} OR display_order_number = \$\$\{params\.length\}\)`\);/);
});

test("every colour of a model is its own card; a bare product id picks them all", async () => {
  const agent = await import("../../server/services/aiClaudeSalesAgentService.js");
  const source = read("../../server/services/aiClaudeSalesAgentService.js");
  assert.match(source, /const matches = cardPool\.has\(id\) \? \[cardPool\.get\(id\)\] : \[\.\.\.cardPool\.values\(\)\]\.filter\(\(card\) => cardId\(card\) === id\);/);
  assert.ok(agent.__testing.cardSummary);
});

test("a reply carrying cards is sent as a product reply; an order answer gets a tracking button", () => {
  const agent = read("../../server/services/aiClaudeSalesAgentService.js");
  assert.match(agent, /const intentPatch = cardsChanged && cards\.length && !productIntent \? \{ intent: "product_search", detected_intent: "product_search" \} : \{\};/);
  assert.match(agent, /order_tracking_cta: \{ url: trackingUrl,/);
  const gateway = read("../../server/services/whatsappGatewayService.js");
  assert.match(gateway, /const trackingCta = generated\.aiPayload\?\.order_tracking_cta;\s*if \(text\(trackingCta\?\.url\) && replyParts\.length <= 1\) \{\s*try \{\s*result = await sendCtaUrlMessage\(\{/);
});

test("a model shown in one grade brings its other grades along, unless the customer named a grade", async () => {
  const agent = await import("../../server/services/aiClaudeSalesAgentService.js");
  const { safeProductFacts } = await import("../../server/services/aiUnifiedDecisionService.js");
  const saved = { enabled: process.env.AI_CLAUDE_AGENT_ENABLED, key: process.env.ANTHROPIC_API_KEY, scope: process.env.AI_SALES_AGENT_SCOPE, provider: process.env.AI_SALES_AGENT_PROVIDER };
  Object.assign(process.env, { AI_CLAUDE_AGENT_ENABLED: "true", ANTHROPIC_API_KEY: "k", AI_SALES_AGENT_SCOPE: "all", AI_SALES_AGENT_PROVIDER: "anthropic" });
  const card = (id, color, grade) => ({ product_id: id, id, color, title: `New Balance 530 - ${color}`, grade, price: 800, image_url: `https://x/${id}${color}.jpg` });
  const pool = [card("180", "Navy", "egyptian"), card("180", "Beige", "egyptian"), card("140", "White & Navy", "vietnamese"), card("141", "Grey", "mirror"), { ...card("999", "Black", "mirror"), title: "Nike Dunk - Black" }];
  const run = async (message) => {
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "s", name: "search_products", input: { query: "New Balance 530" } }], usage: {} },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p", name: "show_products", input: { product_ids: ["180"] } }], usage: {} },
      { stop_reason: "end_turn", content: [{ type: "text", text: "أيوه متاح 👇" }], usage: {} },
    ];
    agent.__setAgentClientForTests({ beta: { messages: { create: async () => replies.shift() } } });
    return agent.runClaudeSalesAgent({
      decision: { intent: "general", detected_intent: "general", text: "x", product_cards: [] },
      inbound: { channel: "whatsapp", text: message, originalText: message, customerName: "Maged", externalConversationId: "", metadata: {} },
      helpers: { safeProductFacts, searchCards: async () => pool },
      loaders: { persona: async () => ({}), knowledgeBase: async () => ({}), history: async () => [], customerCard: async () => "" },
    });
  };
  try {
    const all = await run("فيه نيوبالانس 530");
    assert.deepEqual(all.product_cards.map((c) => `${c.product_id}:${c.color}`), ["180:Navy", "180:Beige", "140:White & Navy", "141:Grey"], "every grade of the same model, never another model");
    assert.equal(all.detected_intent, "product_search", "WhatsApp sends cards only for product intents");
    // «البيج» next must resolve against these cards, in every copy of the memory.
    assert.deepEqual(all.ai_memory_patch.preferences.last_product_cards.map((c) => c.product_id), ["180", "180", "140", "141"]);
    assert.equal(all.ai_memory_patch.preferences.catalog_browse, null);
    const mirror = await run("فيه نيوبالانس 530 مصري");
    assert.deepEqual(mirror.product_cards.map((c) => c.product_id), ["180", "180"], "a named grade is respected");
  } finally {
    Object.assign(process.env, { AI_CLAUDE_AGENT_ENABLED: saved.enabled ?? "", ANTHROPIC_API_KEY: saved.key ?? "", AI_SALES_AGENT_SCOPE: saved.scope ?? "", AI_SALES_AGENT_PROVIDER: saved.provider ?? "" });
    agent.__setAgentClientForTests(null);
  }
});

test("prepared cards that don't name the asked model are dropped; a generic request keeps them", async () => {
  const { cardsNamingTheModel } = await import("../../server/services/aiClaudeSalesAgentService.js");
  const c = (title) => ({ title });
  const jordan = cardsNamingTheModel([c("Air Jordan 4  Sneakers for Men - Black"), c("Jordan 4 - Black"), c("ASICS  Q054-T123 - White"), c("Nike  B347 - Q069 - White")], "عندكم جوردن 4؟");
  assert.deepEqual(jordan.map((card) => card.title), ["Air Jordan 4  Sneakers for Men - Black", "Jordan 4 - Black"]);
  assert.deepEqual(cardsNamingTheModel([c("Nike Air Force 1 - White"), c("Nike Air Max - Black")], "عايز اير فورس").map((card) => card.title), ["Nike Air Force 1 - White"]);
  assert.equal(cardsNamingTheModel([c("A"), c("B")], "عايز كوتشي رجالي").length, 2);
  assert.equal(cardsNamingTheModel([c("Puma Suede")], "عندكم جوردن").length, 1, "nothing would remain → unchanged");
});

test("«فيه نيوبالانس 530 ميرور؟» searches the mirror grade and shows it, even if the model picked another", async () => {
  const agent = await import("../../server/services/aiClaudeSalesAgentService.js");
  const { safeProductFacts } = await import("../../server/services/aiUnifiedDecisionService.js");
  const saved = { enabled: process.env.AI_CLAUDE_AGENT_ENABLED, key: process.env.ANTHROPIC_API_KEY, scope: process.env.AI_SALES_AGENT_SCOPE, provider: process.env.AI_SALES_AGENT_PROVIDER };
  Object.assign(process.env, { AI_CLAUDE_AGENT_ENABLED: "true", ANTHROPIC_API_KEY: "k", AI_SALES_AGENT_SCOPE: "all", AI_SALES_AGENT_PROVIDER: "anthropic" });
  const card = (id, color, grade) => ({ product_id: id, id, color, title: `New Balance 530 - ${color}`, grade, price: 800, image_url: `https://x/${id}${color}.jpg` });
  const queries = [];
  const searchCards = async (query) => {
    queries.push(query);
    return /ميرور/.test(query) ? [card("140", "White & Navy", "mirror_original")] : [card("180", "Navy", "local")];
  };
  const replies = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "s", name: "search_products", input: { query: "New Balance 530" } }], usage: {} },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p", name: "show_products", input: { product_ids: ["180"] } }], usage: {} },
    { stop_reason: "end_turn", content: [{ type: "text", text: "أيوه متاح الميرور 👇" }], usage: {} },
  ];
  agent.__setAgentClientForTests({ beta: { messages: { create: async () => replies.shift() } } });
  try {
    const out = await agent.runClaudeSalesAgent({
      decision: { intent: "catalog_navigation", detected_intent: "catalog_navigation", text: "x", product_cards: [] },
      inbound: { channel: "whatsapp", text: "فيه نيوبالانس 530 ميرور؟", originalText: "فيه نيوبالانس 530 ميرور؟", customerName: "Maged", externalConversationId: "", metadata: {} },
      helpers: { safeProductFacts, searchCards },
      loaders: { persona: async () => ({}), knowledgeBase: async () => ({}), history: async () => [], customerCard: async () => "" },
    });
    assert.ok(queries.some((query) => /ميرور/.test(query)), "the named grade is searched by name");
    assert.deepEqual(out.product_cards.map((c) => c.product_id), ["140"], "the mirror pair replaces the Egyptian pick");
  } finally {
    Object.assign(process.env, { AI_CLAUDE_AGENT_ENABLED: saved.enabled ?? "", ANTHROPIC_API_KEY: saved.key ?? "", AI_SALES_AGENT_SCOPE: saved.scope ?? "", AI_SALES_AGENT_PROVIDER: saved.provider ?? "" });
    agent.__setAgentClientForTests(null);
  }
});

test("«الاسود» sends the black card, even when the model picked the range without it", async () => {
  const agent = await import("../../server/services/aiClaudeSalesAgentService.js");
  const { safeProductFacts } = await import("../../server/services/aiUnifiedDecisionService.js");
  const saved = { enabled: process.env.AI_CLAUDE_AGENT_ENABLED, key: process.env.ANTHROPIC_API_KEY, scope: process.env.AI_SALES_AGENT_SCOPE, provider: process.env.AI_SALES_AGENT_PROVIDER };
  Object.assign(process.env, { AI_CLAUDE_AGENT_ENABLED: "true", ANTHROPIC_API_KEY: "k", AI_SALES_AGENT_SCOPE: "all", AI_SALES_AGENT_PROVIDER: "anthropic" });
  const card = (id, color, grade) => ({ product_id: id, id, color, title: `New Balance 530 - ${color}`, grade, price: 800, image_url: `https://x/${id}${color}.jpg` });
  const pool = [card("180", "Navy", "local"), card("180", "Beige", "local"), card("144", "Black", "imported_from_vietnam")];
  const run = async (productIds) => {
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "s", name: "search_products", input: { query: "New Balance 530 Black" } }], usage: {} },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p", name: "show_products", input: { product_ids: productIds } }], usage: {} },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ده الأسود 👇" }], usage: {} },
    ];
    agent.__setAgentClientForTests({ beta: { messages: { create: async () => replies.shift() } } });
    return agent.runClaudeSalesAgent({
      decision: { intent: "general", detected_intent: "general", text: "x", product_cards: [] },
      inbound: { channel: "whatsapp", text: "الاسود", originalText: "الاسود", customerName: "Maged", externalConversationId: "", metadata: {} },
      helpers: { safeProductFacts, searchCards: async () => pool },
      loaders: { persona: async () => ({}), knowledgeBase: async () => ({}), history: async () => [], customerCard: async () => "" },
    });
  };
  try {
    assert.deepEqual((await run(["180"])).product_cards.map((c) => `${c.product_id}:${c.color}`), ["144:Black"], "the pick had no black: the same model's black comes instead");
    assert.deepEqual((await run(["180", "144"])).product_cards.map((c) => `${c.product_id}:${c.color}`), ["144:Black"], "a mixed pick narrows to the black");
  } finally {
    Object.assign(process.env, { AI_CLAUDE_AGENT_ENABLED: saved.enabled ?? "", ANTHROPIC_API_KEY: saved.key ?? "", AI_SALES_AGENT_SCOPE: saved.scope ?? "", AI_SALES_AGENT_PROVIDER: saved.provider ?? "" });
    agent.__setAgentClientForTests(null);
  }
});
