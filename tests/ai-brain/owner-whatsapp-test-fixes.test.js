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
