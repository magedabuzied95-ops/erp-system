import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");

test("checkout falls back to sale price when selling price is missing", () => {
  assert.match(source, /const basePrice = selling > 0 \? selling : sale > 0 \? sale : original/);
  assert.match(source, /const activePrice = activeSale \? sale : basePrice/);
});

test("checkout rejects zero-priced order items", () => {
  assert.match(source, /if \(price <= 0\)/);
  assert.match(source, /items\.price/);
});
