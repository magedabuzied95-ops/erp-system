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
  NEUTRAL_VELOCITY_CLASSES,
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

/* ------------------------------------------------------------ tenant scope */

test("a null tenant means every tenant, not a comparison against NULL", async () => {
  const source = await service();
  // resolveAnalyticsTenantId returns null for a super-admin. Binding it and comparing
  // produces `tenant_id = NULL`, which matches nothing — the page rendered empty on
  // production for exactly the users most likely to open it.
  assert.match(source, /const tenantScoped = filters\.tenantId !== null && filters\.tenantId !== undefined/);
  assert.ok(
    !/const tenant = push\(filters\.tenantId\);/.test(source),
    "the tenant must not be bound unconditionally"
  );
  // Every tenant clause is guarded.
  assert.match(source, /if \(tenantScoped\) productWhere\.push/);
  assert.match(source, /if \(tenantScoped\) variantWhere\.push/);
  assert.match(source, /scope\.tenantScoped \? `o\.tenant_id = \$\{scope\.tenant\} AND ` : ""/);
  assert.match(source, /scope\.tenantScoped \? `m\.tenant_id = \$\{scope\.tenant\} AND ` : ""/);
  // An empty clause list must still be valid SQL.
  assert.match(source, /productWhere\.length \? productWhere\.join\(" AND "\) : "TRUE"/);
  assert.match(source, /variantWhere\.length \? variantWhere\.join\(" AND "\) : "TRUE"/);
});

test("the resolved permissions reach the client", async () => {
  const source = await service();
  // The UI gates inventory value on meta.permissions.cost; without it every caller
  // silently loses the value column.
  const envelopes = source.match(/meta: \{ permissions: \{ cost: includeCost \} \}/g) || [];
  assert.equal(envelopes.length, 4, `all four endpoints must report permissions, found ${envelopes.length}`);

  const comparison = await read("../../server/services/analytics/analyticsComparison.js");
  assert.match(comparison, /meta = null/, "buildEnvelope must accept caller metadata");
  assert.match(comparison, /\.\.\.\(meta \|\| \{\}\)/, "and merge it");
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

/* ------------------------------------------------- R4.1 evaluating band */

test("the 14 and 30 day boundaries are exact", () => {
  const at = (days) =>
    classifyVelocity({ daysSinceFirstReceipt: days, daysSinceLastSale: null, unitsSoldWindow: 0, hasEverSold: false });

  // 13 is still too new to watch; 14 starts the evaluating window.
  assert.equal(at(13), "too_new");
  assert.equal(at(14), "evaluating");
  // 30 is the last evaluating day; 31 is established enough to judge.
  assert.equal(at(30), "evaluating");
  assert.equal(at(31), "dead_candidate");
});

test("evaluating covers the band, and real sales activity still wins", () => {
  const inBand = (extra) =>
    classifyVelocity({ daysSinceFirstReceipt: 20, daysSinceLastSale: null, unitsSoldWindow: 0, hasEverSold: false, ...extra });

  assert.equal(inBand({}), "evaluating");
  // A product in the band that is genuinely selling is classified on that, not on its age.
  assert.equal(inBand({ daysSinceLastSale: 3, unitsSoldWindow: 4, hasEverSold: true }), "fast");
  assert.equal(inBand({ daysSinceLastSale: 20, unitsSoldWindow: 1, hasEverSold: true }), "steady");
});

test("evaluating never means slow, dead or overstocked", () => {
  assert.ok(NEUTRAL_VELOCITY_CLASSES.includes("evaluating"));
  assert.ok(NEUTRAL_VELOCITY_CLASSES.includes("too_new"));
  assert.ok(NEUTRAL_VELOCITY_CLASSES.includes("unknown_age"));
  // The judgement classes stay out of the neutral set.
  for (const judged of ["fast", "steady", "slow", "dead_candidate"]) {
    assert.ok(!NEUTRAL_VELOCITY_CLASSES.includes(judged), `${judged} is a verdict, not neutral`);
  }
});

test("too_new, evaluating and unknown_age remain three separate states", () => {
  const noSale = { daysSinceLastSale: null, unitsSoldWindow: 0, hasEverSold: false };
  assert.equal(classifyVelocity({ daysSinceFirstReceipt: 5, ...noSale }), "too_new");
  assert.equal(classifyVelocity({ daysSinceFirstReceipt: 20, ...noSale }), "evaluating");
  assert.equal(classifyVelocity({ daysSinceFirstReceipt: null, ...noSale }), "unknown_age");
  assert.equal(new Set(["too_new", "evaluating", "unknown_age"]).size, 3);
});

test("every product lands in exactly one class — the rules have no hole", () => {
  // A hole would show up as a null, which the caller would have to display as an
  // unexplained remainder. Sweep the whole input space instead of trusting the reading.
  const seen = new Set();
  let nulls = 0;
  for (let received = 0; received <= 90; received += 1) {
    for (const lastSale of [null, 0, 1, 6, 7, 8, 29, 30, 31, 200]) {
      for (const units of [0, 1, 2, 9]) {
        for (const ever of [true, false]) {
          const result = classifyVelocity({
            daysSinceFirstReceipt: received, daysSinceLastSale: lastSale, unitsSoldWindow: units, hasEverSold: ever,
          });
          if (result === null) nulls += 1;
          else seen.add(result);
        }
      }
    }
  }
  assert.equal(nulls, 0, "no input may fall outside the classes");
  // Every class except unknown_age is reachable with a receipt date.
  for (const key of VELOCITY_CLASSES.filter((k) => k !== "unknown_age")) {
    assert.ok(seen.has(key), `${key} is unreachable`);
  }
});

test("the buckets reconcile against the eligible products", () => {
  const now = Date.now();
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  const rows = [
    { units: 10, value: 100, unitsSold: 5, lifetimeUnits: 9, lastSoldAt: ago(2), firstReceivedAt: ago(60) },
    { units: 4, value: 40, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: ago(60) },
    { units: 7, value: 70, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: ago(20) },
    { units: 3, value: 30, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: ago(5) },
    { units: 2, value: 20, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: null },
  ];
  const health = buildHealth(rows);

  assert.equal(health.buckets.fast.products, 1);
  assert.equal(health.buckets.dead_candidate.products, 1);
  assert.equal(health.buckets.evaluating.products, 1);
  assert.equal(health.buckets.too_new.products, 1);
  assert.equal(health.buckets.unknown_age.products, 1);

  // The whole point of R4.1: nothing is left over.
  assert.equal(health.unclassified, 0);
  assert.equal(health.reconciliation.eligibleProducts, rows.length);
  assert.equal(health.reconciliation.classifiedProducts, rows.length);
  assert.equal(health.reconciliation.balanced, true);

  // Units reconcile too.
  const bucketUnits = VELOCITY_CLASSES.reduce((sum, key) => sum + health.buckets[key].units, 0);
  assert.equal(bucketUnits, rows.reduce((sum, row) => sum + row.units, 0));
});

test("an unbalanced classification is a warning, never a silent remainder", async () => {
  const source = await service();
  assert.match(source, /if \(!health\.reconciliation\.balanced\)/);
  assert.match(source, /"VELOCITY_UNCLASSIFIED"/);
  assert.match(source, /Movement classification did not account for every stocked product/);
  // The UI must not render its own leftover bucket any more.
  const ui = await read("../../src/modules/reports/components/StockHealth.jsx");
  assert.ok(!/health\?\.unclassified/.test(ui), "the UI must not display a remainder");
  assert.ok(!/const unclassified =/.test(ui), "and must not compute one");
});

test("a large evaluating share never becomes a negative alert", () => {
  const now = Date.now();
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  // A catalogue that is almost entirely young: a shop that has just restocked.
  const rows = Array.from({ length: 10 }, () => ({
    units: 5, value: 50, unitsSold: 0, lifetimeUnits: 0, lastSoldAt: null, firstReceivedAt: ago(20),
  }));
  const health = buildHealth(rows);
  assert.equal(health.buckets.evaluating.products, 10);

  const highlights = buildInventoryHighlights({ rows, health, costCoverage: 1, includeCost: true });
  for (const item of highlights) {
    assert.notEqual(item.severity, "warning", `${item.code} must not warn about young stock`);
    assert.notEqual(item.severity, "critical");
  }
  const share = highlights.find((item) => item.code === "TOO_NEW_SHARE_HIGH");
  assert.ok(share, "the share is still reported as context");
  assert.equal(share.severity, "info");
});
