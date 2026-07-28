import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { catalogCoverageLane, interleaveCatalogCoverageProducts } from "../../server/services/aiMarketingCenterService.js";

const serviceSource = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url), "utf8");

test("catalog coverage balances departments instead of exhausting one department first", () => {
  const products = [
    { id: 1, gender: "men", product_type: "sneakers" },
    { id: 2, gender: "men", product_type: "sneakers" },
    { id: 3, gender: "women", product_type: "sneakers" },
    { id: 4, gender: "kids", product_type: "sneakers" },
    { id: 5, gender: "women", product_type: "bags" },
    { id: 6, gender: "men", product_type: "crocs" },
    { id: 7, gender: "women", product_type: "slipper" },
    { id: 8, gender: "men", product_type: "sneakers", is_offer_story: true },
  ];
  assert.deepEqual(interleaveCatalogCoverageProducts(products).map((product) => product.id), [1, 3, 4, 5, 6, 7, 8, 2]);
});

test("catalog coverage assigns special product departments before audience", () => {
  assert.equal(catalogCoverageLane({ gender: "women", product_type: "bags" }), "bags");
  assert.equal(catalogCoverageLane({ gender: "men", product_type: "crocs" }), "crocs");
  assert.equal(catalogCoverageLane({ gender: "women", product_type: "slipper" }), "slippers");
  assert.equal(catalogCoverageLane({ gender: "men", product_type: "sneakers", is_offer_story: true }), "offers");
});

test("coverage state persists independently from queue rows and prevents repeats inside a cycle", () => {
  assert.match(serviceSource, /CREATE TABLE IF NOT EXISTS ai_marketing_catalog_cycles/);
  assert.match(serviceSource, /CREATE TABLE IF NOT EXISTS ai_marketing_catalog_coverage/);
  assert.match(serviceSource, /PRIMARY KEY \(tenant_id, cycle_number, product_id\)/);
  assert.match(serviceSource, /existing\.metadata->>'coverage_cycle' = \$23::jsonb->>'coverage_cycle'/);
  assert.match(serviceSource, /startNextCatalogCycle/);
  assert.match(serviceSource, /product_signature/);
});

test("AI center exposes full-catalog and newest-only modes with coverage counters", () => {
  assert.match(serviceSource, /DEFAULT_STORY_SELECTION_MODE = "catalog_coverage"/);
  assert.match(serviceSource, /story_selection_mode === "newest_only"/);
  assert.match(pageSource, /Full catalog first/);
  assert.match(pageSource, /Newest only/);
  assert.match(pageSource, /catalog_coverage\.coverage_percent/);
});
