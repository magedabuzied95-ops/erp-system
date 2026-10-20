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
  assert.match(agent, /case "get_order_status":\s*return findCustomerOrders\(\{ tenantId, orderNumber: text\(input\.order_number\), phone: text\(input\.phone\) \|\| customerPhone \}\);/);
});

test("an order is only found for the phone it was placed with, inside this shop", () => {
  const tools = read("../../server/services/aiBusinessToolsService.js");
  const lookup = tools.slice(tools.indexOf("export const findCustomerOrders"), tools.indexOf("export const loadBusinessToolContext"));
  assert.match(lookup, /if \(!variants\.length\) return \{ found: false, reason: "phone_needed" \};/);
  assert.match(lookup, /WHERE o\.tenant_id = \$1\s*AND \$\{phoneSqlDigits\("o\.customer_phone"\)\} = ANY\(\$2::text\[\]\)/);
  // The old lookup's OR escaped the tenant filter.
  assert.match(tools, /clauses\.push\(`\(public_order_number = \$\$\{params\.length\} OR display_order_number = \$\$\{params\.length\}\)`\);/);
});
