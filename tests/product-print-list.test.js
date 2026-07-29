import test from "node:test";
import assert from "node:assert/strict";

import { printListSection, productPrintAudience, productPrintAudiences } from "../src/modules/products/lib/productPrintList.js";

test("print list separates the requested product panels", () => {
  assert.equal(printListSection({ product_type: "sneakers" }), "sneakers");
  assert.equal(printListSection({ product_type: "bags" }), "bags");
  assert.equal(printListSection({ product_type: "crocs" }), "crocs");
  assert.equal(printListSection({ product_type: "slippers" }), "slippers");
});

test("sneaker audience uses product and variant audiences", () => {
  assert.equal(productPrintAudience({ audiences: ["women"] }), "women");
  assert.equal(productPrintAudience({ variants: [{ audience: "kids" }] }), "kids");
  assert.equal(productPrintAudience({ gender: "men" }), "men");
  assert.deepEqual(productPrintAudiences({ audiences: ["men", "women"] }), ["men", "women"]);
});
