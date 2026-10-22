import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canonicalOrderChannel, isShopOrderChannel, SHOP_ORDER_CHANNEL } from "../server/utils/publicOrderNumber.js";

// The storefront writes "storefront"; the orders screen used to write "website" when staff
// picked الموقع. Both are the shop, and channel reports must see one channel.
test("every spelling of the shop folds into storefront", () => {
  for (const alias of ["storefront", "website", "web", "online", " Website ", "WEB"]) {
    assert.equal(canonicalOrderChannel(alias), SHOP_ORDER_CHANNEL, alias);
    assert.equal(isShopOrderChannel(alias), true, alias);
  }
});

test("other channels pass through untouched", () => {
  for (const channel of ["pos", "whatsapp", "instagram", "web_chat", "manual"]) {
    assert.equal(canonicalOrderChannel(channel), channel);
    assert.equal(isShopOrderChannel(channel), false, channel);
  }
  assert.equal(canonicalOrderChannel(""), "");
  assert.equal(canonicalOrderChannel(null), "");
  assert.equal(canonicalOrderChannel(undefined), "");
});

// Mutation guard: the three writers in ordersController (create, patch, full edit) must all
// go through the canonical helper, and the coupon "source" must no longer compare the raw
// channel string to "website" (a storefront order would have been billed as a POS coupon).
test("ordersController writes the channel through the canonical helper", () => {
  const source = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  assert.match(source, /channel: canonicalOrderChannel\(firstValue\(body\.channel, body\.order_type, body\.orderType, body\.source\)\) \|\| "pos"/);
  assert.match(source, /channel: canonicalOrderChannel\(Object\.prototype\.hasOwnProperty\.call\(req\.body, "channel"\)/);
  assert.match(source, /canonicalOrderChannel\(req\.body\.channel \|\| req\.body\.source\) \|\| null/);
  assert.doesNotMatch(source, /channel === "website" \? "website" : "pos"/);
  assert.equal((source.match(/isShopOrderChannel\(/g) || []).length, 3, "coupon source branches");
  assert.match(source, /UPDATE orders SET channel = 'storefront' WHERE LOWER\(COALESCE\(channel, ''\)\) IN \('website', 'web', 'online'\)/);
});
