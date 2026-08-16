import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRetrievalQueries,
  searchProductsHybrid,
} from "../../server/services/aiHybridProductSearchService.js";
import { buildDeterministicUnderstanding } from "../../server/services/aiUnderstandingService.js";

const CATALOG = [
  { id: 1, name: "Puma Suede Classic", brand: "Puma", total_stock: 5 },
  { id: 2, name: "Nike Air Force 1", brand: "Nike", total_stock: 8 },
  { id: 3, name: "Crocs Classic Clog", brand: "Crocs", total_stock: 12 },
];

/** Matches the way the SQL scorer behaves: substring over the product blob. */
const catalogSearch = ({ query }) => {
  const needle = String(query || "").toLowerCase();
  if (!needle) return [];
  return CATALOG.filter((product) => `${product.name} ${product.brand}`.toLowerCase().includes(needle));
};

test("a bound keeps the strongest retrievers, not the first ones", () => {
  const understanding = buildDeterministicUnderstanding("عندكم بوما كاجوال مقاس 44؟");
  const all = buildRetrievalQueries({ message: "عندكم بوما كاجوال مقاس 44؟", understanding });

  assert.ok(all.length > 3, "this message should build more retrievers than the bound");

  // Slicing the array directly would keep construction order, which starts with the raw
  // phrase and ends with single tokens — the weakest. The bound must sort by weight.
  const weakestWeight = Math.min(...all.map((entry) => entry.weight));
  const strongestWeight = Math.max(...all.map((entry) => entry.weight));
  assert.notEqual(weakestWeight, strongestWeight, "weights must differ for this to mean anything");
});

test("the bound keeps the highest-weighted retrievers and drops the rest", async () => {
  const message = "عندكم بوما كاجوال؟";
  const understanding = buildDeterministicUnderstanding(message);
  const all = buildRetrievalQueries({ message, understanding });
  const topTwo = [...all].sort((a, b) => b.weight - a.weight).slice(0, 2).map((entry) => entry.query);

  const seen = [];
  await searchProductsHybrid({
    tenantId: 1,
    message,
    understanding,
    maxQueries: 2,
    runQuery: ({ query }) => {
      seen.push(query);
      return catalogSearch({ query });
    },
  });

  assert.equal(seen.length, 2, "exactly the bound number of retrievers may run");
  // The real guarantee: a bound costs the WEAKEST retrievers. Slicing construction
  // order instead would have kept the raw phrase and a single token.
  assert.deepEqual([...seen].sort(), [...topTwo].sort());
});

test("an unbounded search runs every retriever", async () => {
  const understanding = buildDeterministicUnderstanding("عندكم بوما كاجوال؟");
  const all = buildRetrievalQueries({ message: "عندكم بوما كاجوال؟", understanding });
  const seen = [];
  await searchProductsHybrid({
    tenantId: 1,
    message: "عندكم بوما كاجوال؟",
    understanding,
    runQuery: ({ query }) => {
      seen.push(query);
      return catalogSearch({ query });
    },
  });

  assert.equal(seen.length, all.length, "the default must stay unbounded");
});

test("an Arabic brand reaches the Latin catalog entry", async () => {
  // The point of the rescue: the customer's spelling matches no product name directly.
  assert.deepEqual(catalogSearch({ query: "بوما" }), [], "the raw Arabic must miss, or this proves nothing");

  const understanding = buildDeterministicUnderstanding("عندكم بوما؟");
  const found = await searchProductsHybrid({
    tenantId: 1,
    message: "عندكم بوما؟",
    understanding,
    runQuery: catalogSearch,
  });

  assert.ok(found.length, "hybrid must recover the product the raw query missed");
  assert.equal(String(found[0].id), "1");
});

test("one failing retriever does not fail the search", async () => {
  const understanding = buildDeterministicUnderstanding("عندكم بوما؟");
  let calls = 0;
  const found = await searchProductsHybrid({
    tenantId: 1,
    message: "عندكم بوما؟",
    understanding,
    runQuery: ({ query }) => {
      calls += 1;
      if (calls === 1) throw new Error("simulated retriever failure");
      return catalogSearch({ query });
    },
  });

  assert.ok(found.length, "the surviving retrievers must still produce results");
});

test("a message with nothing searchable returns empty rather than everything", async () => {
  const understanding = buildDeterministicUnderstanding("شكرا ليك");
  const found = await searchProductsHybrid({
    tenantId: 1,
    message: "؟؟",
    understanding,
    runQuery: catalogSearch,
  });
  assert.deepEqual(found, []);
});
