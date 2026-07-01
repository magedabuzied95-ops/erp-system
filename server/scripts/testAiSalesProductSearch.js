import assert from "node:assert/strict";

import { searchAiSalesProducts } from "../services/aiSalesAgentService.js";

const main = async () => {
  const results = await searchAiSalesProducts({ tenantId: 1, query: "Adidas Terrex", limit: 5 });

  assert.ok(Array.isArray(results), "search should return an array");
  assert.ok(results.length > 0, "search should return at least one product");

  const top = results[0];
  assert.ok(Number(top.total_stock) > 0, "top Terrex result should be sellable");
  assert.notEqual(Number(top.id), 25, "zero-stock Terrex record must not outrank sellable results");
  assert.ok(results.some((product) => Number(product.id) === 4 && Number(product.total_stock) > 0), "sellable Terrex record id 4 should remain present");

  console.log("AI sales product search regression passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
