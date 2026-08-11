// R4 — Inventory Intelligence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEMAND_MOVEMENT_TYPES,
  KNOWN_MOVEMENT_TYPES,
  MOVEMENT_SEMANTICS,
  RECEIPT_MOVEMENT_TYPES,
  unknownMovementTypes,
} from "../../server/services/analytics/inventoryMovementContract.js";
import {
  DEFAULT_INVENTORY_DIMENSION,
  DEFAULT_INVENTORY_SORT,
  INVENTORY_DIMENSIONS,
  INVENTORY_SORTS,
  UNKNOWN_AGE_REASON,
  VELOCITY_CLASSES,
  VELOCITY_RULES,
  assessInventoryDimensionQuality,
  buildHealth,
  buildInventoryHighlights,
  buildStockSalesMatrix,
  classifyVelocity,
} from "../../server/services/analytics/analyticsInventoryService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const service = () => read("../../server/services/analytics/analyticsInventoryService.js");

/** Structural checks read the code, not the prose that explains it. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/* ------------------------------------------------------- movement contract */

test("every movement type in the contract was traced, not guessed", () => {
  assert.equal(KNOWN_MOVEMENT_TYPES.length, 9, "production has exactly nine types");
  for (const type of KNOWN_MOVEMENT_TYPES) {
    const entry = MOVEMENT_SEMANTICS[type];
    assert.ok(entry.trigger, `${type} must name the code that writes it`);
    assert.ok(entry.meaning, `${type} must state its business meaning`);
    assert.ok(["in", "out", "both"].includes(entry.direction), `${type} needs a direction`);
    assert.equal(typeof entry.economic, "boolean");
    assert.equal(typeof entry.customerDemand, "boolean");
  }
});

test("only a real sale counts as customer demand", () => {
  assert.deepEqual(DEMAND_MOVEMENT_TYPES, ["SALE_OUT"]);
  // Stock corrections move stock without anybody buying anything.
  for (const type of [
    "ORDER_EDIT_DEDUCT", "ORDER_EDIT_RESTORE", "COUNT_ADJUSTMENT",
    "PURCHASE_EDIT_STOCK_IN", "PURCHASE_EDIT_STOCK_OUT", "SUPPLIER_RETURN_HOLD", "RETURN_IN",
  ]) {
    assert.equal(MOVEMENT_SEMANTICS[type].customerDemand, false, `${type} must not count as demand`);
  }
});

test("a supplier-return hold is a real outflow but never a sale", () => {
  const hold = MOVEMENT_SEMANTICS.SUPPLIER_RETURN_HOLD;
  assert.equal(hold.economic, true, "stock genuinely leaves sellable inventory");
  assert.equal(hold.customerDemand, false);
  assert.equal(hold.purchaseInflow, false);
  assert.equal(hold.returnFlow, false, "it is not a customer return flow");
  assert.equal(hold.receiptEvent, false);
});

test("returns net demand through order_items, not through the movement", () => {
  // Counting RETURN_IN as well as returned_quantity would deduct the return twice.
  assert.equal(MOVEMENT_SEMANTICS.RETURN_IN.returnFlow, true);
  assert.equal(MOVEMENT_SEMANTICS.RETURN_IN.customerDemand, false);
  const source = await0(service());
  return source.then((text) => {
    assert.match(text, /returned_quantity/, "demand must net returns from order_items");
  });
});
const await0 = (value) => Promise.resolve(value);

test("only a real receipt establishes when stock arrived", () => {
  assert.deepEqual(RECEIPT_MOVEMENT_TYPES, ["PURCHASE_IN"]);
  // A correction to a receipt is not an arrival: treating it as one would make corrected
  // stock look newer than it is and reset its age.
  assert.equal(MOVEMENT_SEMANTICS.PURCHASE_EDIT_STOCK_IN.receiptEvent, false);
  assert.equal(MOVEMENT_SEMANTICS.PURCHASE_EDIT_STOCK_OUT.receiptEvent, false);
});

test("an unknown movement type is reported, never silently bucketed", async () => {
  assert.deepEqual(unknownMovementTypes(["SALE_OUT", "PURCHASE_IN"]), []);
  assert.deepEqual(unknownMovementTypes(["SALE_OUT", "TELEPORT_OUT"]), ["TELEPORT_OUT"]);
  assert.deepEqual(unknownMovementTypes(["teleport_out"]), ["TELEPORT_OUT"], "matching is case-insensitive");

  const source = await service();
  assert.match(source, /UNKNOWN_MOVEMENT_TYPE/, "the service must raise the warning");
  assert.match(source, /checkMovementVocabulary/);
});

/* ------------------------------------------------------ velocity classification */

const day = (n) => n;

test("a product too new to judge is never called slow or stagnant", () => {
  // Received nine days ago with no sales: the data cannot support a verdict.
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: day(9), daysSinceLastSale: null, unitsSoldWindow: 0, hasEverSold: false }),
    "too_new"
  );
  // Even at 13 days, still too new — the boundary is explicit.
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: day(13), daysSinceLastSale: null, unitsSoldWindow: 0, hasEverSold: false }),
    "too_new"
  );
});

test("fast requires both a recent sale and real volume", () => {
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: day(60), daysSinceLastSale: day(3), unitsSoldWindow: 5, hasEverSold: true }),
    "fast"
  );
  // Recent but a single unit is steady, not fast.
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: day(60), daysSinceLastSale: day(3), unitsSoldWindow: 1, hasEverSold: true }),
    "steady"
  );
});

test("steady, slow and stagnation candidates follow the approved thresholds", () => {
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: day(60), daysSinceLastSale: day(20), unitsSoldWindow: 3, hasEverSold: true }),
    "steady"
  );
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: day(60), daysSinceLastSale: day(90), unitsSoldWindow: 0, hasEverSold: true }),
    "slow"
  );
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: day(60), daysSinceLastSale: null, unitsSoldWindow: 0, hasEverSold: false }),
    "dead_candidate"
  );
});

test("no receipt history means unknown age, never an age-based verdict", () => {
  // The whole point: without a receipt date there is no way to say whether a product is
  // too new to judge or old enough to be stagnant.
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: null, daysSinceLastSale: null, unitsSoldWindow: 0, hasEverSold: false }),
    "unknown_age"
  );
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: null, daysSinceLastSale: day(200), unitsSoldWindow: 0, hasEverSold: true }),
    "unknown_age",
    "an old sale without a receipt date is still unknown age, not slow"
  );
  // Observable recent demand does not need a receipt date, so it is still classified.
  assert.equal(
    classifyVelocity({ daysSinceFirstReceipt: null, daysSinceLastSale: day(2), unitsSoldWindow: 4, hasEverSold: true }),
    "fast"
  );
  assert.equal(UNKNOWN_AGE_REASON, "NO_RECEIPT_HISTORY");
  assert.ok(VELOCITY_CLASSES.includes("unknown_age"));
});

test("the thresholds are the approved ones", () => {
  assert.equal(VELOCITY_RULES.tooNewDays, 14);
  assert.equal(VELOCITY_RULES.recentSaleDays, 7);
  assert.equal(VELOCITY_RULES.demandWindowDays, 30);
  assert.equal(VELOCITY_RULES.fastMinUnits, 2);
  assert.equal(VELOCITY_RULES.establishedDays, 30);
});

test("health reports unknown-age products separately with their reason", () => {
  const now = Date.now();
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  const health = buildHealth([
    { units: 10, value: 100, unitsSold: 5, lifetimeUnits: 9, lastSoldAt: ago(2), firstReceivedAt: ago(60) },
    { units: 4, value: 40, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: ago(60) },
    { units: 7, value: 70, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: null },
  ]);
  assert.equal(health.buckets.fast.products, 1);
  assert.equal(health.buckets.dead_candidate.products, 1);
  assert.equal(health.buckets.unknown_age.products, 1);
  assert.equal(health.unknownAge.products, 1);
  assert.equal(health.unknownAge.reason, "NO_RECEIPT_HISTORY");
  assert.equal(health.unclassified, 0);
  // The unknown-age product must not have contributed to any age-based bucket.
  assert.equal(health.buckets.slow.products, 0);
  assert.equal(health.buckets.too_new.products, 0);
});

/* ----------------------------------------------------------- stock vs sales */

const product = (id, stock, sold, value = stock * 10) => ({
  productId: id, productName: `p${id}`, unitsInStock: stock, unitsSoldPeriod: sold, inventoryValue: value,
});

test("the matrix splits on the period's own medians, not fixed numbers", () => {
  const rows = [product(1, 100, 1), product(2, 5, 20), product(3, 100, 20), product(4, 5, 1)];
  const matrix = buildStockSalesMatrix(rows, true);
  assert.equal(matrix.medianStock, 52.5);
  assert.equal(matrix.medianUnitsSold, 10.5);

  const byId = Object.fromEntries(matrix.points.map((row) => [row.productId, row.quadrant]));
  assert.equal(byId[2], "replenish", "high demand, low stock");
  assert.equal(byId[3], "healthy_core", "high demand, high stock");
  assert.equal(byId[1], "overstock", "low demand, high stock");
  assert.equal(byId[4], "low_priority");

  // Scaling every value must not change the classification: the rule is relative.
  const scaled = buildStockSalesMatrix(rows.map((r) => ({ ...r, unitsInStock: r.unitsInStock * 7 })), true);
  assert.deepEqual(scaled.points.map((r) => r.quadrant), matrix.points.map((r) => r.quadrant));
});

test("too few products yields no quadrants rather than a meaningless split", () => {
  const matrix = buildStockSalesMatrix([product(1, 10, 1), product(2, 20, 2)], true);
  assert.equal(matrix.medianStock, null);
  assert.ok(matrix.points.every((row) => row.quadrant === null));
});

test("products with no stock are not placed on a stock matrix", () => {
  const rows = [product(1, 0, 5), product(2, 10, 1), product(3, 20, 2), product(4, 30, 3), product(5, 40, 4)];
  const matrix = buildStockSalesMatrix(rows, true);
  assert.equal(matrix.points.length, 4);
  assert.ok(!matrix.points.some((row) => row.productId === 1));
});

/* -------------------------------------------------------- dimension quality */

test("a dimension made only of unknown buckets is unusable", () => {
  const quality = assessInventoryDimensionQuality("brand", [{ key: "بدون علامة", inventoryValue: 500, unitsInStock: 5 }], 500, true);
  assert.equal(quality.distinctMeaningfulValues, 0);
  assert.equal(quality.usable, false);
  assert.equal(quality.unknownContributionPercent, 1);
});

test("dimension quality is computed per request, never hardcoded", () => {
  const rich = assessInventoryDimensionQuality("brand", [
    { key: "Adidas", inventoryValue: 500, unitsInStock: 5 },
    { key: "Nike", inventoryValue: 300, unitsInStock: 3 },
    { key: "بدون علامة", inventoryValue: 10, unitsInStock: 1 },
  ], 810, true);
  assert.equal(rich.distinctMeaningfulValues, 2);
  assert.equal(rich.usable, true);
});

/* ---------------------------------------------------------------- allowlists */

test("dimensions and sorts are allowlisted and never request-derived", async () => {
  assert.deepEqual(Object.keys(INVENTORY_DIMENSIONS).sort(), ["brand", "category", "product_type"]);
  assert.equal(DEFAULT_INVENTORY_DIMENSION, "product_type");
  assert.equal(DEFAULT_INVENTORY_SORT, "inventory_value");

  const source = await service();
  assert.match(source, /INVENTORY_DIMENSIONS\[filters\.dimension\] \? filters\.dimension : DEFAULT_INVENTORY_DIMENSION/);
  assert.match(source, /INVENTORY_SORTS\[filters\.sort\] \? filters\.sort : DEFAULT_INVENTORY_SORT/);
  assert.ok(!/ORDER BY \$\{filters/.test(source), "sort must never be interpolated from the request");
  assert.ok(!/GROUP BY \$\{filters/.test(source), "group by must never be interpolated from the request");
});

/* ------------------------------------------------------ source of truth */

test("stock comes from product_variants.stock and nothing else", async () => {
  const source = await service();
  assert.match(source, /FROM product_variants pv/);
  assert.match(source, /COALESCE\(pv\.stock, 0\)\s+AS units/);

  // Comments are stripped before the exclusion checks: the module header documents WHY
  // these two sources are rejected, and that explanation is worth keeping in the file.
  const code = stripComments(source);
  // products.stock is dead — nothing in the server writes it.
  assert.ok(!/\bp\.stock\b/.test(code), "products.stock must never be read");
  // warehouse_inventory accumulates receipts and never decrements on sale.
  assert.ok(!/warehouse_inventory/i.test(code), "warehouse_inventory must never be queried");
});

test("no warehouse filter is exposed", async () => {
  const source = await service();
  assert.ok(!/warehouseId|warehouse_id/.test(source), "R4 must not filter by warehouse");
  const hook = await read("../../src/modules/reports/hooks/useInventoryFilters.js");
  assert.ok(!/warehouse/i.test(hook), "the UI must not offer a warehouse filter");
});

/* ------------------------------------------------------------ cost coverage */

test("unknown cost is never valued at zero", async () => {
  const source = await service();
  // Value sums only the rows with a resolved cost; the rest are counted, not multiplied.
  assert.match(source, /FILTER \(WHERE s\.unit_cost IS NOT NULL\)/);
  assert.match(source, /SUM\(s\.units\) FILTER \(WHERE s\.unit_cost IS NULL\)\s+AS units_uncosted/);
  assert.match(source, /INVENTORY_COST_COVERAGE_LOW/);
  assert.match(source, /inventory_value_known/, "the field name must say the value is what is known");
});

test("inventory value is withheld without the cost permission", async () => {
  const source = await service();
  assert.match(source, /const includeCost = Boolean\(permissions\.cost\)/);
  assert.match(source, /\{ current: null, restricted: true \}/, "value must be restricted, not zero");
  // The cost expression must not even enter the SQL for a caller without permission.
  assert.match(source, /includeCost \? `\$\{cost\.resolved\} AS unit_cost` : "NULL::numeric AS unit_cost"/);
});

/* ------------------------------------------------------------ time semantics */

test("stock is a snapshot and the period never reaches it", async () => {
  const source = await service();
  // The date parameters bound the demand CTE only.
  const stockedCte = source.slice(source.indexOf("stocked AS ("), source.indexOf("demand AS ("));
  assert.ok(!/scope\.from|scope\.to/.test(stockedCte), "the stock CTE must not use the date range");
  const demandCte = source.slice(source.indexOf("demand AS ("), source.indexOf("lifetime AS ("));
  assert.match(demandCte, /o\.created_at >= \$\{scope\.from\}/, "demand must be bounded by the period");
});

test("no inventory age metric is produced", async () => {
  // Again comments are stripped: the header explains that FIFO layers do not exist,
  // which is exactly why no age metric is produced.
  const code = stripComments(await service());
  for (const banned of ["inventoryAge", "stockAge", "averageAge", "ageBucket", "fifo"]) {
    assert.ok(!new RegExp(banned, "i").test(code), `R4 must not compute ${banned}`);
  }
  // First receipt is history, and is named as such.
  assert.match(code, /first_received_at/);
});

/* ------------------------------------------------------------- highlights */

test("highlights are codes and raw values, never Arabic prose from the backend", () => {
  const now = Date.now();
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  const rows = [
    { units: 10, value: 9000, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: ago(60) },
    { units: 5, value: 100, unitsSold: 3, lifetimeUnits: 8, lastSoldAt: ago(2), firstReceivedAt: ago(60) },
  ];
  const health = buildHealth(rows);
  const highlights = buildInventoryHighlights({ rows, health, costCoverage: 0.8, includeCost: true });

  assert.ok(highlights.length <= 5);
  for (const item of highlights) {
    assert.ok(item.code && item.severity && item.messageKey);
    assert.ok(!/[؀-ۿ]/.test(JSON.stringify(item)), "no Arabic may originate in the backend");
  }
  const codes = highlights.map((item) => item.code);
  assert.ok(codes.includes("DEAD_CANDIDATE_VALUE_HIGH"));
  assert.ok(codes.includes("COST_COVERAGE_LOW"));
});
