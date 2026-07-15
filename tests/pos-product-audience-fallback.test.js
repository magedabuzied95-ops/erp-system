import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { inferPosAudienceFromProduct } from "../src/modules/pos/lib/posAudience.js";

test("POS infers a missing audience from the product identity", () => {
  assert.equal(inferPosAudienceFromProduct("Tommy Hilfiger Sneakers for Men"), "men");
  assert.equal(inferPosAudienceFromProduct("Running shoes for Women"), "women");
  assert.equal(inferPosAudienceFromProduct("\u062d\u0630\u0627\u0621 \u0623\u0637\u0641\u0627\u0644"), "kids");
});

test("POS variant normalization applies the fallback when stored audience is missing", () => {
  const source = readFileSync(new URL("../src/modules/pos/services/posProductsApi.js", import.meta.url), "utf8");
  assert.match(source, /normalizeText\(row\.audience[\s\S]*?inferPosAudienceFromProduct\(/);
  assert.match(source, /sourceProduct\.name/);
  assert.match(source, /sourceProduct\.sku/);
});
