import test from "node:test";
import assert from "node:assert/strict";
import { buildAvailableSizeOptions, normalizeStockValue } from "../shared/displayRefillSizing.js";
test("display sizing preserves numeric ordering and excludes unavailable/non-numeric sizes", () => {
  assert.deepEqual(buildAvailableSizeOptions([{ size: "41-42", stock: 1 }, { size: "37/38", stock: 1 }, { size: "One Size", stock: 9 }, { size: "40", stock: -1 }]), [{ size: "37/38", normalized: 37 }, { size: "41-42", normalized: 41 }]);
  assert.equal(normalizeStockValue({ stock: null }), 0);
});
