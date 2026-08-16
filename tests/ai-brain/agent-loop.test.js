import test from "node:test";
import assert from "node:assert/strict";

import { isAgentLoopEnabled, runAgentLoop, verifyFactProvenance } from "../../server/services/aiAgentLoopService.js";
import { TOOL_DEFINITIONS, __testing } from "../../server/services/aiToolRegistryService.js";

test("dormant by default, and dormant means the caller keeps its own path", async () => {
  delete process.env.AI_AGENT_LOOP_ENABLED;
  assert.equal(isAgentLoopEnabled(), false);

  const result = await runAgentLoop({ tenantId: 1, message: "عندكم كروكس؟" });
  // ok:false is the contract — the caller falls back to the existing composer rather
  // than losing the reply.
  assert.equal(result.ok, false);
  assert.equal(result.reason, "disabled");
});

test("no tool can write, send or charge", () => {
  const names = TOOL_DEFINITIONS.map((tool) => tool.name);
  for (const name of names) {
    assert.doesNotMatch(name, /create|send|reserve|charge|update|delete|cancel/, `${name} must be read-only`);
  }
  assert.deepEqual(names.sort(), [
    "get_customer_history",
    "get_inventory",
    "get_order_status",
    "get_policy",
    "get_shipping_quote",
    "search_products",
  ]);
});

test("cost, margin and supplier can never reach a prompt", () => {
  const raw = {
    name: "Air Jordan 4",
    price: 4200,
    cost: 1800,
    margin_percent: 57,
    supplier_name: "Some Supplier",
    variants: [{ size: "43", stock: 2, wholesale_price: 1500, purchase_price: 1400 }],
    nested: { internal_note: "do not show", api_key: "sk-x" },
  };
  const safe = __testing.stripUnsafe(raw);

  assert.equal(safe.price, 4200);
  assert.equal(safe.variants[0].stock, 2);
  for (const blocked of ["cost", "margin_percent", "supplier_name"]) {
    assert.ok(!(blocked in safe), `${blocked} leaked`);
  }
  assert.ok(!("wholesale_price" in safe.variants[0]));
  assert.ok(!("purchase_price" in safe.variants[0]));
  assert.ok(!("internal_note" in safe.nested));
  assert.ok(!("api_key" in safe.nested));
});

test("a claim attributed to a tool that was never called is caught", () => {
  const result = {
    tool_trace: [{ tool: "search_products", ok: true }],
    facts_used: [
      { claim: "price is 1450", tool: "search_products" },
      { claim: "size 44 is in stock", tool: "get_inventory" },
    ],
  };
  const verdict = verifyFactProvenance(result);

  assert.equal(verdict.verified, false);
  assert.equal(verdict.unsupported_claims.length, 1);
  assert.match(verdict.unsupported_claims[0].claim, /size 44/);
});

test("a failed tool call does not count as support for a claim", () => {
  const verdict = verifyFactProvenance({
    tool_trace: [{ tool: "get_inventory", ok: false }],
    facts_used: [{ claim: "in stock", tool: "get_inventory" }],
  });
  assert.equal(verdict.verified, false);
});

test("claims fully backed by successful calls verify", () => {
  const verdict = verifyFactProvenance({
    tool_trace: [
      { tool: "search_products", ok: true },
      { tool: "get_inventory", ok: true },
    ],
    facts_used: [
      { claim: "price is 1450", tool: "search_products" },
      { claim: "size 44 black is in stock", tool: "get_inventory" },
    ],
  });
  assert.equal(verdict.verified, true);
  assert.equal(verdict.tools_called.length, 2);
});

test("the inventory tool description forbids claiming availability without it", () => {
  const inventory = TOOL_DEFINITIONS.find((tool) => tool.name === "get_inventory");
  assert.match(inventory.description, /only way to know/i);
  assert.deepEqual(inventory.parameters.required, ["product_id"]);
});
