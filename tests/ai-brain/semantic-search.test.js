import assert from "node:assert/strict";
import test from "node:test";

import {
  EMBEDDING_DIMENSIONS,
  isSemanticSearchEnabled,
  productEmbeddingSource,
  resetSemanticCapabilityCache,
  searchProductsSemantic,
  toVectorLiteral,
} from "../../server/services/aiSemanticSearchService.js";

const withEnv = async (vars, run) => {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetSemanticCapabilityCache();
  }
};

test("semantic search is inert while the flag is off", async () => {
  await withEnv({ AI_SEMANTIC_SEARCH_ENABLED: "" }, async () => {
    assert.equal(isSemanticSearchEnabled(), false);
    assert.deepEqual(await searchProductsSemantic({ tenantId: 1, query: "حاجة تناسب فرح" }), []);
  });
});

test("semantic search returns empty rather than throwing without pgvector", async () => {
  // The property the whole design rests on: installing the extension is a DBA action
  // this code cannot assume, and a missing extension must never fail a customer reply.
  await withEnv({ AI_SEMANTIC_SEARCH_ENABLED: "true" }, async () => {
    const found = await searchProductsSemantic({ tenantId: 999999, query: "حاجة تناسب فرح" });
    assert.deepEqual(found, []);
  });
});

test("a missing tenant or empty query short-circuits before any database work", async () => {
  await withEnv({ AI_SEMANTIC_SEARCH_ENABLED: "true" }, async () => {
    assert.deepEqual(await searchProductsSemantic({ tenantId: null, query: "كروكس" }), []);
    assert.deepEqual(await searchProductsSemantic({ tenantId: 1, query: "" }), []);
    assert.deepEqual(await searchProductsSemantic({}), []);
  });
});

test("vector literals use pgvector's bracket syntax, not a Postgres array", () => {
  // `{1,2,3}` is a Postgres array and pgvector rejects it. This is the kind of thing
  // that only surfaces at query time on a database that has the extension.
  assert.equal(toVectorLiteral([1, 2, 3]), "[1,2,3]");
  assert.equal(toVectorLiteral([]), "[]");
  assert.equal(toVectorLiteral(null), "[]");
});

test("the embedding source describes what a product IS, not what it costs", () => {
  // Price and stock change constantly. Including them would invalidate the embedding
  // on every inventory movement while adding nothing about the product's identity.
  const source = productEmbeddingSource({
    name: "Nike Air Force 1",
    brand: "Nike",
    product_type: "sneakers",
    price: 2800,
    total_stock: 8,
  });

  assert.match(source, /Nike Air Force 1/);
  assert.match(source, /sneakers/);
  assert.ok(!source.includes("2800"), "price must not be embedded");
  assert.ok(!source.includes("8"), "stock must not be embedded");
});

test("the embedding source is bounded and survives empty products", () => {
  assert.equal(productEmbeddingSource({}), "");
  assert.equal(productEmbeddingSource(), "");
  const long = productEmbeddingSource({ name: "x".repeat(5_000) });
  assert.ok(long.length <= 2_000, "must be bounded before it reaches the embedding API");
});

test("the declared dimension matches what the migration reserves", () => {
  // A vector column has a fixed width; a mismatch fails at insert time, not at deploy.
  assert.equal(EMBEDDING_DIMENSIONS, 1536);
});
