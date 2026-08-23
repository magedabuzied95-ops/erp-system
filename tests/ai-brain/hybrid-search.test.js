import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRetrievalQueries,
  searchProductsHybrid,
  __testing,
} from "../../server/services/aiHybridProductSearchService.js";

const understandingFor = (entities) => ({
  primary_intent: "product_availability",
  entities: {
    product_model: null,
    category: null,
    brand: null,
    color: null,
    size: null,
    quantity: null,
    budget_max: null,
    occasion: null,
    recipient: null,
    city: null,
    ...entities,
  },
});

test("a full sentence produces entity queries, not just the raw phrase", () => {
  const queries = buildRetrievalQueries({
    message: "السلام عليكم عندكم كروكس اسود مقاس ٤٤؟",
    understanding: understandingFor({ product_model: "كروكس", color: "أسود", size: "44" }),
  });

  const names = queries.map((entry) => entry.name);
  assert.ok(names.includes("phrase"), "the whole-phrase retriever is still there");
  assert.ok(names.includes("entity"), "the extracted model must be searched on its own");

  // This is the failure being fixed: the raw phrase LIKE matches no product row.
  const entityQuery = queries.find((entry) => entry.name === "entity");
  assert.equal(entityQuery.query, "كروكس");
  assert.ok(entityQuery.weight > queries.find((entry) => entry.name === "phrase").weight);
});

test("stopwords and bare numbers never become search queries", () => {
  // Searching "بكام" or "44" returns half the catalog and drowns the real signal.
  assert.deepEqual(__testing.meaningfulTokens("عايز اعرف السعر بكام مقاس 44 لو سمحت"), []);
  // ...but a real product token in the same sentence must survive.
  assert.deepEqual(__testing.meaningfulTokens("عايز اعرف كروكس بكام مقاس 44"), ["كروكس"]);
});

test("an Arabic-spelled brand reaches its Latin catalog name", () => {
  const skeleton = __testing.latinSkeleton;
  // The alias table only knows products someone remembered to add. The consonant
  // skeleton generalises: no table entry exists for any of these.
  for (const [arabic, latin] of [
    ["كروكس", "crocs"],
    ["نايك", "nike"],
    ["اديداس", "adidas"],
    ["بوما", "puma"],
    ["فانز", "vans"],
    ["نيو بالانس", "new balance"],
  ]) {
    assert.equal(skeleton(arabic), skeleton(latin), `${arabic} should reach ${latin}`);
  }
});

test("the skeleton does not collapse unrelated brands together", () => {
  const skeleton = __testing.latinSkeleton;
  assert.notEqual(skeleton("crocs"), skeleton("jordan"));
  assert.notEqual(skeleton("nike"), skeleton("puma"));
  assert.notEqual(skeleton("adidas"), skeleton("reebok"));
});

test("agreement between weak retrievers beats one strong first place", () => {
  const fused = __testing.fuseByReciprocalRank([
    { name: "phrase", results: [{ id: 1 }], weight: 1 },
    { name: "entity", results: [{ id: 2 }, { id: 1 }], weight: 1 },
    { name: "token", results: [{ id: 2 }], weight: 1 },
  ]);

  assert.equal(String(fused[0].id), "2", "product 2 was found by two retrievers");
  assert.ok(fused[0].retrieval_sources.length === 2);
});

test("an incompatible product is filtered out before it can be recommended", () => {
  const products = [
    { id: 1, name: "Air Jordan 4 Retro", price: 4200 },
    { id: 2, name: "Crocs Classic Clog", product_type: "crocs", price: 900 },
  ];
  const constrained = __testing.applyEntityConstraints(products, understandingFor({ product_model: "كروكس" }));
  assert.equal(constrained.length, 1);
  assert.equal(String(constrained[0].id), "2");
});

test("a constraint that matches nothing is dropped rather than emptying the results", () => {
  const products = [{ id: 1, name: "Air Jordan 4" }];
  const constrained = __testing.applyEntityConstraints(products, understandingFor({ product_model: "منتج مش موجود" }));
  // Better to hand the grounding gate imperfect candidates than none at all.
  assert.equal(constrained.length, 1);
});

test("budget filters out what is clearly over, keeping unpriced rows", () => {
  const products = [
    { id: 1, name: "A", price: 4200 },
    { id: 2, name: "B", price: 1400 },
    { id: 3, name: "C", price: 0 },
  ];
  const constrained = __testing.applyEntityConstraints(products, understandingFor({ budget_max: 1500 }));
  const ids = constrained.map((product) => String(product.id));
  assert.deepEqual(ids, ["2", "3"]);
});

test("one failing retriever does not fail the search", async () => {
  const results = await searchProductsHybrid({
    tenantId: 1,
    message: "كروكس اسود",
    understanding: understandingFor({ product_model: "كروكس" }),
    limit: 5,
    runQuery: async ({ query }) => {
      if (query.includes("اسود")) throw new Error("simulated retriever failure");
      return [{ id: 7, name: "Crocs Classic", product_type: "crocs" }];
    },
  });

  assert.equal(results.length, 1);
  assert.equal(String(results[0].id), "7");
});

test("no query at all returns empty rather than throwing", async () => {
  const results = await searchProductsHybrid({
    tenantId: 1,
    message: "",
    understanding: null,
    runQuery: async () => [],
  });
  assert.deepEqual(results, []);
});

test("a non-shopping question returns no products at all", async () => {
  // Measured against the live catalog before this guard: asking for a human returned
  // handbags, and asking where an order was returned Crocs. The token retriever
  // latches onto incidental words ("حد", "رقم") and the ranker answers them.
  const calls = [];
  const runQuery = async ({ query }) => {
    calls.push(query);
    return [{ id: 99, name: "Classic Bag" }];
  };

  for (const intent of [
    "order_status",
    "human_handoff",
    "complaint",
    "return_or_exchange",
    "shipping_question",
  ]) {
    const results = await searchProductsHybrid({
      tenantId: 1,
      message: "الأوردر بتاعي رقم 4412 وصل فين؟",
      understanding: { primary_intent: intent, entities: {} },
      runQuery,
    });
    assert.deepEqual(results, [], `${intent} must not return products`);
  }
  assert.equal(calls.length, 0, "retrieval should not even run for these intents");
});

test("a greeting can still surface something to show", async () => {
  // Greeting is deliberately NOT suppressed: it often opens a shopping conversation.
  const results = await searchProductsHybrid({
    tenantId: 1,
    message: "السلام عليكم عندكم كروكس؟",
    understanding: { primary_intent: "greeting", entities: { brand: "كروكس" } },
    runQuery: async () => [{ id: 1, name: "Crocs Classic", product_type: "crocs" }],
  });
  assert.equal(results.length, 1);
});
