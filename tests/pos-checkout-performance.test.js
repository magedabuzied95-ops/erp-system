import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ordersController = fs.readFileSync("server/controllers/ordersController.js", "utf8");
const server = fs.readFileSync("server/server.js", "utf8");

test("POS checkout schemas are warmed before the server accepts sales", () => {
  assert.match(ordersController, /let posCheckoutSchemaReadyPromise = null/);
  assert.match(ordersController, /export const ensurePosCheckoutSchema = async/);
  assert.match(ordersController, /await ensurePosCheckoutSchema\(tenantId\)/);
  assert.match(server, /await ensurePosCheckoutSchema\(\)/);
});

test("slow POS checkouts remain visible without verbose diagnostics", () => {
  assert.match(ordersController, /if \(!POS_CHECKOUT_DEBUG && totalMs <= 1000\) return/);
  assert.match(ordersController, /console\.warn\("\[pos-checkout-slow\]", payload\)/);
});
