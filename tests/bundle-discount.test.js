import test from "node:test";
import assert from "node:assert/strict";

import { buildBundleId, computeBundleDiscount, normalizeBundleDiscountPercent } from "../shared/bundleDiscount.js";

const id = buildBundleId(10, 20);
const line = (product_id, price, quantity = 1, bundle_id = id) => ({ product_id, price, quantity, bundle_id });

test("a bundle id names both products, in a stable order, and never one product twice", () => {
  assert.equal(buildBundleId(20, 10), "pair:10+20");
  assert.equal(buildBundleId(10, 20), "pair:10+20");
  assert.equal(buildBundleId(10, 10), "");
  assert.equal(buildBundleId("", 10), "");
});

test("the percentage is clamped and anything invalid turns the discount off", () => {
  assert.equal(normalizeBundleDiscountPercent(5), 5);
  assert.equal(normalizeBundleDiscountPercent("7.5"), 7.5);
  assert.equal(normalizeBundleDiscountPercent(90), 50);
  assert.equal(normalizeBundleDiscountPercent(-1), 0);
  assert.equal(normalizeBundleDiscountPercent("abc"), 0);
  assert.deepEqual(computeBundleDiscount([line(10, 2200), line(20, 2600)], 0), { amount: 0, bundles: [] });
});

test("a whole bundle of two products earns the percentage on both", () => {
  const result = computeBundleDiscount([line(10, 2200), line(20, 2600)], 5);
  assert.equal(result.amount, 240);
  assert.deepEqual(result.bundles[0].product_ids, ["10", "20"]);
  assert.equal(result.bundles[0].sets, 1);
});

test("removing either product takes the discount off the other", () => {
  assert.equal(computeBundleDiscount([line(10, 2200)], 5).amount, 0);
  assert.equal(computeBundleDiscount([line(20, 2600)], 5).amount, 0);
});

test("quantities pair up and the extra units pay full price", () => {
  assert.equal(computeBundleDiscount([line(10, 1000, 2), line(20, 1000, 2)], 10).amount, 400);
  assert.equal(computeBundleDiscount([line(10, 1000, 3), line(20, 1000, 1)], 10).amount, 200);
});

test("two sizes of one product share its slot, and the cheapest units are discounted first", () => {
  const result = computeBundleDiscount([line(10, 900), line(10, 1200), line(20, 1000, 1)], 10);
  assert.equal(result.bundles[0].sets, 1);
  assert.equal(result.amount, 190); // (900 + 1000) * 10%
});

test("a line cannot join a bundle that does not name its product, and untagged lines are ignored", () => {
  assert.equal(computeBundleDiscount([line(10, 1000), line(30, 1000)], 10).amount, 0);
  assert.equal(computeBundleDiscount([line(10, 1000, 1, ""), line(20, 1000, 1, "")], 10).amount, 0);
  assert.equal(computeBundleDiscount([line(10, 1000, 1, "pair:bogus"), line(20, 1000, 1, "pair:bogus")], 10).amount, 0);
});

test("the server's eligibility check can veto a pair", () => {
  const lines = [line(10, 1000), line(20, 1000)];
  assert.equal(computeBundleDiscount(lines, 10, () => false).amount, 0);
  assert.equal(computeBundleDiscount(lines, 10, (a, b) => a === "10" && b === "20").amount, 200);
});

test("free or zero-quantity lines never make a bundle", () => {
  assert.equal(computeBundleDiscount([line(10, 0), line(20, 1000)], 10).amount, 0);
  assert.equal(computeBundleDiscount([line(10, 1000, 0), line(20, 1000)], 10).amount, 0);
});

test("amounts round to piastres", () => {
  assert.equal(computeBundleDiscount([line(10, 333.33), line(20, 333.33)], 7).amount, 46.67);
});
