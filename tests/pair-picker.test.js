import test from "node:test";
import assert from "node:assert/strict";

import { isKidsOnlyProduct, pickAutomaticPair } from "../src/storefront/lib/pairPicker.js";

const ctx = {
  audiencesOf: (product) => product.audiences || [],
  priceOf: (product) => product.price || 0,
  isSellable: (product) => product.sellable !== false,
  typeOf: (product) => product.product_type || "",
};
const mensSneaker = { id: 785, name: "SKECHERS", product_type: "sneakers", audiences: ["men"], grade: "mirror_original", brand_name: "Skechers", price: 1850 };

test("a men's sneaker is never offered a kids' school bag — the case the owner saw", () => {
  const kidsBag = { id: 761, name: "Classic Bag - Blue", product_type: "bags", bag_type: "school_bag", audiences: ["kids"], price: 2200 };
  const unrecordedBag = { id: 762, name: "Classic Bag - Red", product_type: "bags", audiences: [], price: 2200 };
  const mensSlipper = { id: 900, name: "Nike Slide", product_type: "slippers", audiences: ["men"], price: 900 };
  assert.equal(pickAutomaticPair([kidsBag, unrecordedBag, mensSlipper], mensSneaker, ctx)?.id, 900);
  assert.equal(pickAutomaticPair([kidsBag, unrecordedBag], mensSneaker, ctx), null);
});

test("an audience nobody recorded is not treated as everyone", () => {
  assert.equal(pickAutomaticPair([{ id: 1, product_type: "slippers", audiences: [], price: 900 }], mensSneaker, ctx), null);
});

test("women's products are not offered beside a men's product", () => {
  assert.equal(pickAutomaticPair([{ id: 2, product_type: "slippers", audiences: ["women"], price: 900 }], mensSneaker, ctx), null);
});

test("kids products are allowed beside a kids product", () => {
  const kidsShoe = { id: 50, product_type: "sneakers", audiences: ["kids"], price: 800 };
  const kidsCrocs = { id: 51, name: "Crocs Kids", product_type: "crocs", audiences: ["kids"], price: 700 };
  assert.equal(pickAutomaticPair([kidsCrocs], kidsShoe, ctx)?.id, 51);
});

test("a complementary type beats another sneaker, and the same grade and a close price win among them", () => {
  const cheapCrocs = { id: 10, product_type: "crocs", audiences: ["men"], grade: "local", price: 300 };
  const mirrorSlipper = { id: 11, product_type: "slippers", audiences: ["men"], grade: "mirror_original", price: 1400 };
  const otherSneaker = { id: 12, product_type: "sneakers", audiences: ["men"], grade: "mirror_original", brand_name: "Nike", price: 1850 };
  assert.equal(pickAutomaticPair([cheapCrocs, otherSneaker, mirrorSlipper], mensSneaker, ctx)?.id, 11);
});

test("with no complement in stock, a same-audience sneaker of another brand is the fallback", () => {
  const sameBrand = { id: 20, product_type: "sneakers", audiences: ["men"], brand_name: "Skechers", price: 1850 };
  const otherBrand = { id: 21, product_type: "sneakers", audiences: ["men"], brand_name: "Nike", price: 1850 };
  assert.equal(pickAutomaticPair([sameBrand, otherBrand], mensSneaker, ctx)?.id, 21);
});

test("the open product, its colour cards, unsellable and priceless products are skipped", () => {
  const colourCard = { id: 999, parent_product_id: 785, product_type: "slippers", audiences: ["men"], price: 900 };
  const soldOut = { id: 30, product_type: "slippers", audiences: ["men"], price: 900, sellable: false };
  const priceless = { id: 31, product_type: "slippers", audiences: ["men"], price: 0 };
  assert.equal(pickAutomaticPair([colourCard, soldOut, priceless], mensSneaker, ctx), null);
});

test("kids-only detection reads audience, school bag type and the name", () => {
  assert.equal(isKidsOnlyProduct({}, ["kids"]), true);
  assert.equal(isKidsOnlyProduct({}, ["kids", "women"]), false);
  assert.equal(isKidsOnlyProduct({ bag_type: "school_bag" }, ["women"]), true);
  assert.equal(isKidsOnlyProduct({ name: "شنطة مدرسة" }, ["women"]), true);
  assert.equal(isKidsOnlyProduct({ name: "Air Force 1" }, ["men"]), false);
});
