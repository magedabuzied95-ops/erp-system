import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCriteria, CRITERIA_ATTRIBUTE_KEYS } from "../../server/services/restockIntentService.js";

// A criteria request is "notify me when ANY men's mirror sneakers arrive in 45".
// Its identity is the normalised criteria object, so two spellings of the same
// request must normalise byte-for-byte identically (that is what the dedup index hashes).
test("criteria normalise: lower-cased, trimmed, key-sorted, size kept as typed", () => {
  const a = normalizeCriteria({ gender: " Men ", product_type: "Sneakers", grade: "MIRROR_ORIGINAL", size: " 45 " });
  const b = normalizeCriteria({ size: "45", grade: "mirror_original", product_type: "sneakers", gender: "men" });
  assert.deepEqual(a, { gender: "men", grade: "mirror_original", product_type: "sneakers", size: "45" });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("criteria normalise: size is mandatory, and so is at least one attribute", () => {
  assert.throws(() => normalizeCriteria({ gender: "men" }), /size is required/);
  assert.throws(() => normalizeCriteria({ size: "45" }), /at least one/);
  assert.throws(() => normalizeCriteria({ size: "45", gender: "all" }), /at least one/);
});

test("criteria normalise: only the known attribute keys survive", () => {
  const c = normalizeCriteria({ size: "40", brand: "Nike", color: "red", price: 100 });
  assert.deepEqual(Object.keys(c), ["brand", "size"]);
  assert.deepEqual(CRITERIA_ATTRIBUTE_KEYS, ["gender", "product_type", "grade", "brand"]);
});
