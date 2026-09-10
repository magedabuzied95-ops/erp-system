import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");

test("checkout falls back to sale price when selling price is missing", () => {
  // ...but never to the compare/original price: a size with no price of its own was shown at its
  // strikethrough. With neither a selling nor a sale price the size has no price (0), and the
  // test below makes checkout refuse it.
  assert.match(source, /const basePrice = selling > 0 \? selling : sale > 0 \? sale : 0;/);
  assert.doesNotMatch(source, /const basePrice = [^;]*: original;/);
  assert.match(source, /const activePrice = activeSale \? sale : basePrice/);
});

test("checkout rejects zero-priced order items", () => {
  assert.match(source, /if \(price <= 0\)/);
  assert.match(source, /items\.price/);
});
