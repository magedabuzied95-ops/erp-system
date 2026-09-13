import assert from "node:assert/strict";
import test from "node:test";

import { buildProductSizeGuide, recommendSizeForFoot } from "../src/storefront/lib/sizeGuide.js";

const sneaker = {
  product_type: "sneakers",
  gender: "men",
  variants: [
    { size: "45", stock: 0 },
    { size: "41", stock: 2 },
    { size: "43", stock: 1 },
    { size: "44.5", stock: 1 },
  ],
};

test("a shoe lists only the sizes it was entered with, smallest first, with the foot length each fits", () => {
  const guide = buildProductSizeGuide({ product: sneaker });
  assert.equal(guide.kind, "shoes");
  assert.deepEqual(guide.rows.map((row) => row.eu), ["41", "43", "44.5", "45"]);
  assert.deepEqual(guide.rows.map((row) => row.cm), [26, 27.2, 28.1, 28.4]);
  assert.deepEqual(guide.rows.map((row) => row.inStock), [true, true, true, false]);
});

test("with a colour on screen the guide is that colour's sizes, never another colour's", () => {
  const guide = buildProductSizeGuide({ product: sneaker, variants: [{ size: "41", stock: 0 }, { size: "43", stock: 3 }], selectedSize: "43" });
  assert.deepEqual(guide.rows.map((row) => row.eu), ["41", "43"]);
  assert.equal(guide.rows[0].inStock, false);
  assert.equal(guide.rows[1].selected, true);
});

test("a Crocs model lists its factory markings with their EU pair, and no foot length", () => {
  const crocs = { product_type: "crocs", variants: [{ size: "M9/W11", stock: 1 }, { size: "J3", stock: 0 }, { size: "M3/W5", stock: 2 }] };
  const guide = buildProductSizeGuide({ product: crocs });
  assert.equal(guide.kind, "crocs");
  assert.deepEqual(guide.rows.map((row) => row.eu), ["34/35", "42/43"]);
  assert.equal(guide.rows[0].factory, "J3 · M3/W5");
  assert.equal(guide.rows[0].inStock, true, "one of the two markings for 34/35 is in stock");
  assert.equal(guide.rows[0].cm, undefined);
});

test("a product without shoe sizes falls back to the full chart", () => {
  assert.equal(buildProductSizeGuide({ product: { product_type: "bags", variants: [{ size: "18-inch" }] } }).full, true);
  assert.equal(buildProductSizeGuide({ product: { variants: [{ size: "One size" }] } }).full, true);
});

test("the foot-length finder picks the smallest size that fits, and says when none does", () => {
  const { rows } = buildProductSizeGuide({ product: sneaker });
  assert.equal(recommendSizeForFoot(rows, "27").row.eu, "43");
  assert.equal(recommendSizeForFoot(rows, "27,2").row.eu, "43");
  const tooBig = recommendSizeForFoot(rows, 31);
  assert.equal(tooBig.tooBig, true);
  assert.equal(tooBig.row.eu, "45");
  assert.equal(recommendSizeForFoot(rows, ""), null);
});
