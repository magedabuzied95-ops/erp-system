import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the fallback stock paths lock rows in ascending id order", () => {
  const start = source.indexOf("const sortLinesForRowLocks");
  assert.ok(start >= 0, "sortLinesForRowLocks must exist");
  const end = source.indexOf("\n  });\n", start);
  const sortLinesForRowLocks = new Function(`${source.slice(start, end + "\n  });".length)}; return sortLinesForRowLocks;`)();

  const lines = [
    { index: 0, item: { variant_id: 90 } },
    { index: 1, item: { product_id: 5 } },
    { index: 2, item: { variant_id: 12 } },
    { index: 3, item: { variantId: "40" } },
  ];
  assert.deepEqual(sortLinesForRowLocks(lines).map((line) => line.index), [2, 3, 0, 1]);

  const batch = source.slice(source.indexOf("const resolveOrderLinesStockBatch = async"), source.indexOf("const bulkInsertOrderItems"));
  assert.match(batch, /for \(const line of sortLinesForRowLocks\(lineInputs\)\)/);
  assert.match(batch, /for \(const \{ index, item \} of sortLinesForRowLocks\(items\.map/);
});
