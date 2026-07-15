import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/modules/products/pages/ProductsList.jsx", import.meta.url),
  "utf8",
);

test("desktop product table centers headers and matching row content", () => {
  assert.match(source, /<th className="px-4 py-2 text-center">\{t\("products\.table\.actions"\)\}<\/th>/);
  assert.match(source, /group\/product-row[^`]*text-center/);
  assert.match(source, /flex flex-wrap justify-center gap-1\.5/);
  assert.match(source, /relative flex min-h-10 items-center justify-center gap-2/);
});

test("product header, thumbnails, and names share a stable right alignment", () => {
  assert.match(source, /<th className="px-4 py-2 text-right">\{t\("products\.table\.product"\)\}<\/th>/);
  assert.match(source, /className="flex w-full min-w-0 items-center justify-start gap-3 text-start"/);
});
