import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesQuickFilterGroups,
  moveWinterCollectionToEnd,
  toggleMultiFilterValue,
} from "../src/modules/pos/lib/posQuickFilterLogic.js";

const product = ({ audienceKeys = [], brandKey = "", manufacturerIds = [], manufacturerNames = [] }) => ({
  audienceKeys,
  brandKey,
  manufacturerIds: new Set(manufacturerIds),
  manufacturerNames,
});

test("winter collection moves after the other product types without reordering them", () => {
  const options = [
    { id: "winter", name: "كولكشن شتوي" },
    { id: "shoes", name: "Shoes" },
    { id: "bags", name: "Bags" },
  ];

  assert.deepEqual(
    moveWinterCollectionToEnd(options).map((option) => option.id),
    ["shoes", "bags", "winter"]
  );
});

test("quick filters support gender OR and empty selections show all", () => {
  const menProduct = product({ audienceKeys: ["men"] });
  const womenProduct = product({ audienceKeys: ["women"] });
  const kidsProduct = product({ audienceKeys: ["kids"] });

  assert.equal(matchesQuickFilterGroups(menProduct, { genders: ["men"] }), true);
  assert.equal(matchesQuickFilterGroups(womenProduct, { genders: ["men"] }), false);
  assert.equal(matchesQuickFilterGroups(menProduct, { genders: ["men", "women"] }), true);
  assert.equal(matchesQuickFilterGroups(womenProduct, { genders: ["men", "women"] }), true);
  assert.equal(matchesQuickFilterGroups(kidsProduct, { genders: [] }), true);
});

test("quick filters support manufacturer OR and brand OR with AND between groups", () => {
  const nikeFactoryA = product({
    audienceKeys: ["men"],
    brandKey: "brand:nike",
    manufacturerIds: ["factory-a"],
    manufacturerNames: ["factory alpha"],
  });
  const adidasFactoryB = product({
    audienceKeys: ["women"],
    brandKey: "brand:adidas",
    manufacturerIds: ["factory-b"],
    manufacturerNames: ["factory beta"],
  });

  assert.equal(matchesQuickFilterGroups(nikeFactoryA, { manufacturers: ["factory-a", "factory-b"] }), true);
  assert.equal(matchesQuickFilterGroups(adidasFactoryB, { manufacturers: ["factory-a", "factory-b"] }), true);
  assert.equal(matchesQuickFilterGroups(nikeFactoryA, { brands: ["brand:nike", "brand:adidas"] }), true);
  assert.equal(matchesQuickFilterGroups(adidasFactoryB, { brands: ["brand:nike", "brand:adidas"] }), true);
  assert.equal(matchesQuickFilterGroups(nikeFactoryA, {
    genders: ["women"],
    brands: ["brand:nike"],
    manufacturers: ["factory-a"],
  }), false);
  assert.equal(matchesQuickFilterGroups(nikeFactoryA, {
    genders: ["men"],
    brands: ["brand:nike"],
    manufacturers: ["factory-a"],
  }), true);
});

test("quick filters clear-all behavior returns products to unfiltered state", () => {
  const selectedBrands = toggleMultiFilterValue(["brand:nike"], "all");
  const selectedManufacturers = toggleMultiFilterValue(["factory-a", "factory-b"], "all");
  const selectedGenders = toggleMultiFilterValue(["men", "women"], "all");

  assert.deepEqual(selectedBrands, []);
  assert.deepEqual(selectedManufacturers, []);
  assert.deepEqual(selectedGenders, []);
  assert.equal(matchesQuickFilterGroups(product({ audienceKeys: ["kids"], brandKey: "brand:puma", manufacturerIds: ["factory-c"] }), {
    genders: selectedGenders,
    brands: selectedBrands,
    manufacturers: selectedManufacturers,
  }), true);
});
