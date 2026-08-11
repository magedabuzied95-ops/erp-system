import db from "../../database/db.js";
import { preLookupUnitCostExpr, purchaseCostLookup } from "./accountingCanon.js";
import {
  WARNING_CODES,
  WarningCollector,
  buildEnvelope,
  safeRatio,
  toFiniteNumber,
  toMoney,
} from "./analyticsComparison.js";
import { canonicalOrderClauses } from "./analyticsMetrics.js";
import {
  DEMAND_MOVEMENT_TYPES,
  KNOWN_MOVEMENT_TYPES,
  RECEIPT_MOVEMENT_TYPES,
  sqlTypeList,
  unknownMovementTypes,
} from "./inventoryMovementContract.js";

/**
 * R4 — Inventory Intelligence.
 *
 * TWO CLOCKS, and confusing them is the easiest way to publish a wrong number:
 *
 *   Stock  — a snapshot of RIGHT NOW. product_variants.stock has no history, so no date
 *            filter can reconstruct what stock was last Tuesday. Every stock figure here
 *            ignores the selected period entirely.
 *   Demand — measured OVER the selected period, from order_items, net of returns.
 *
 * The API says so in meta.timeSemantics and the UI repeats it, because a manager who
 * assumes the date range rewinds stock will read every ratio backwards.
 *
 * NOT implemented, deliberately: inventory age. purchase_items carries no remaining
 * quantity and the schema has no batch, lot or FIFO layer, so which units remain from
 * which receipt is unknowable. First receipt date is shown as history, never as age.
 *
 * NOT used: products.stock (dead — nothing writes it) and warehouse_inventory (it
 * accumulates PURCHASE_IN and never decrements on sale; 5,373 units against a true
 * 4,960 on production at audit time).
 */

/* ------------------------------------------------------------------ allowlists */

export const INVENTORY_DIMENSIONS = Object.freeze({
  product_type: "COALESCE(NULLIF(TRIM(p.product_type), ''), 'غير محدد')",
  brand: "COALESCE(NULLIF(TRIM(p.brand), ''), 'بدون علامة')",
  category: "COALESCE(NULLIF(TRIM(p.main_category), ''), NULLIF(TRIM(p.category), ''), 'غير مصنف')",
});
export const DEFAULT_INVENTORY_DIMENSION = "product_type";

export const INVENTORY_SORTS = Object.freeze({
  inventory_value: "inventory_value",
  units: "units_in_stock",
  units_sold: "units_sold_period",
  net_sales: "net_sales_period",
  product: "product_name",
  last_sale: "last_sold_at",
  first_receipt: "first_received_at",
});
export const DEFAULT_INVENTORY_SORT = "inventory_value";

export const MATRIX_LIMIT = 300;
export const DEAD_CANDIDATE_LIMIT = 50;

/* ------------------------------------------------- velocity classification (v1) */

/** Approved v1 thresholds. Exported so the UI tooltip and the tests read the same numbers. */
export const VELOCITY_RULES = Object.freeze({
  tooNewDays: 14,
  recentSaleDays: 7,
  demandWindowDays: 30,
  fastMinUnits: 2,
  establishedDays: 30,
});

export const VELOCITY_CLASSES = Object.freeze([
  "fast",
  "steady",
  "slow",
  "dead_candidate",
  "too_new",
  "unknown_age",
]);

/**
 * Why a product could not be aged.
 *
 * Age-dependent classes (slow, dead_candidate, too_new) all rest on a receipt date. A
 * product with stock but no PURCHASE_IN has none, and guessing one would put real
 * inventory into a bucket the data cannot justify.
 */
export const UNKNOWN_AGE_REASON = "NO_RECEIPT_HISTORY";

/**
 * Classify one stocked product.
 *
 * Order matters: TOO_NEW wins first, because a product received nine days ago has not
 * had time to prove anything and calling it slow would be a judgement the data cannot
 * support. Production's five weeks of history is exactly why this guard exists.
 *
 * Products with no receipt date return "unknown_age" rather than being forced into an
 * age-dependent bucket: without a receipt there is no way to say whether a product is
 * too new to judge or old enough to be stagnant, and either guess would be a judgement
 * the data cannot support.
 *
 * Returns null only when a product HAS an age but matches no rule — received 14-30 days
 * ago, sold once long ago, nothing recently. That is genuinely between definitions, and
 * inventing a bucket for it would be inventing.
 */
export const classifyVelocity = ({ daysSinceFirstReceipt, daysSinceLastSale, unitsSoldWindow, hasEverSold }) => {
  const { tooNewDays, recentSaleDays, fastMinUnits, establishedDays } = VELOCITY_RULES;
  const received = toFiniteNumber(daysSinceFirstReceipt);
  const lastSale = toFiniteNumber(daysSinceLastSale);
  const units = toFiniteNumber(unitsSoldWindow) ?? 0;

  // No receipt date means no age, so every age-dependent verdict is off the table.
  if (received === null) {
    const soldRecentlyWithoutAge = lastSale !== null && lastSale <= recentSaleDays;
    // Recent demand is observable without knowing when the stock arrived, so a product
    // that is visibly selling is still classified. Only the age-dependent calls are
    // withheld.
    if (soldRecentlyWithoutAge && units >= fastMinUnits) return "fast";
    if (lastSale !== null && lastSale <= VELOCITY_RULES.demandWindowDays) return "steady";
    return "unknown_age";
  }

  if (received < tooNewDays) return "too_new";

  const soldRecently = lastSale !== null && lastSale <= recentSaleDays;
  const soldInWindow = lastSale !== null && lastSale <= VELOCITY_RULES.demandWindowDays;

  if (soldRecently && units >= fastMinUnits) return "fast";
  if (soldInWindow) return "steady";

  const established = received > establishedDays;
  if (established && !hasEverSold) return "dead_candidate";
  if (established && hasEverSold) return "slow";

  return null;
};

/* ------------------------------------------------------------------- SQL scope */

const buildScope = ({ filters, columns }) => {
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const tenantScoped = filters.tenantId !== null && filters.tenantId !== undefined;
  const tenant = tenantScoped ? push(filters.tenantId) : null;
  const from = push(filters.from);
  const to = push(filters.to);

  const orderPredicate = canonicalOrderClauses(columns.orderColumns, { alias: "o" }).clauses.join(" AND ");

  const productWhere = [];
  if (tenantScoped) productWhere.push(`p.tenant_id = ${tenant}`);
  if (columns.productColumns.has("deleted_at")) productWhere.push("p.deleted_at IS NULL");
  if (filters.productType) productWhere.push(`LOWER(TRIM(COALESCE(p.product_type,''))) = LOWER(TRIM(${push(filters.productType)}))`);
  if (filters.brandId) productWhere.push(`p.brand_id = ${push(filters.brandId)}`);
  if (filters.category) {
    productWhere.push(
      `LOWER(TRIM(COALESCE(NULLIF(p.main_category,''), p.category, ''))) = LOWER(TRIM(${push(filters.category)}))`
    );
  }
  if (filters.gender) productWhere.push(`LOWER(TRIM(COALESCE(p.gender,''))) = LOWER(TRIM(${push(filters.gender)}))`);
  if (filters.productId) productWhere.push(`p.id = ${push(filters.productId)}`);
  if (filters.search) {
    const term = push(`%${filters.search}%`);
    productWhere.push(`(p.name ILIKE ${term} OR COALESCE(p.brand,'') ILIKE ${term} OR COALESCE(p.sku,'') ILIKE ${term})`);
  }

  const variantWhere = [];
  if (tenantScoped) variantWhere.push(`pv.tenant_id = ${tenant}`);
  if (columns.variantColumns.has("deleted_at")) variantWhere.push("pv.deleted_at IS NULL");

  return {
    params,
    push,
    tenant,
    from,
    to,
    tenantScoped,
    productWhere: productWhere.length ? productWhere.join(" AND ") : "TRUE",
    variantWhere: variantWhere.length ? variantWhere.join(" AND ") : "TRUE",
    orderPredicate,
  };
};

/**
 * Unit cost via the canonical ladder, identical to the one R2/R3 use for COGS.
 * The purchase-history LATERAL is guarded so it never runs for an already-resolved cost.
 */
const unitCostExpressions = (columns, tenantParam) => {
  const preLookup = preLookupUnitCostExpr({
    overrideColumns: new Set(),
    variantColumns: columns.variantColumns,
    productColumns: columns.productColumns,
  });
  // Same guarded LATERAL R2/R3 use: it only runs when the variant and product rungs both
  // came back NULL, which on production is never.
  const lookup = purchaseCostLookup({
    purchaseColumns: columns.purchaseColumns,
    purchaseItemColumns: columns.purchaseItemColumns,
    variantColumns: columns.variantColumns,
    productIdExpr: "pv.product_id",
    variantIdExpr: "pv.id",
    tenantParam,
    skipWhenResolved: preLookup,
  });
  return { preLookup, join: lookup.join, resolved: `COALESCE(${preLookup}, NULLIF(${lookup.expr}, 0))` };
};

const loadColumns = async (client) => {
  const read = async (table) => {
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
      [table]
    );
    return new Set(result.rows.map((row) => row.column_name));
  };
  const [productColumns, variantColumns, purchaseColumns, purchaseItemColumns, orderColumns, itemColumns, movementColumns] =
    await Promise.all([
      read("products"),
      read("product_variants"),
      read("purchases"),
      read("purchase_items"),
      read("orders"),
      read("order_items"),
      read("inventory_movements"),
    ]);
  return { productColumns, variantColumns, purchaseColumns, purchaseItemColumns, orderColumns, itemColumns, movementColumns };
};

/**
 * The shared CTE stack: stock now, demand over the period, first/last receipt.
 *
 * Built once and reused by every endpoint so the four sections cannot drift apart.
 */
const inventoryCte = ({ scope, columns, includeCost }) => {
  const cost = unitCostExpressions(columns, scope.tenantScoped ? scope.tenant : "NULL");
  // Resolve cost only where there is stock to value. Zero-stock variants contribute
  // nothing to inventory value by definition, and on production they are more than half
  // the catalogue (8,227 variants, 3,668 stocked) — resolving their cost cost 700k
  // buffer hits and about 1.5s per query for a figure that is always zero.
  const costSelect = includeCost ? `${cost.resolved} AS unit_cost` : "NULL::numeric AS unit_cost";
  const costJoin = includeCost ? cost.join : "";

  // Demand comes from order_items net of returned_quantity — the same basis as R2 and R3,
  // so the three screens agree. Movements are NOT used for demand: order edits, counts
  // and purchase corrections all move stock without a customer buying anything.
  return `
    variants AS (
      SELECT pv.id            AS variant_id,
             pv.product_id    AS product_id,
             NULLIF(TRIM(COALESCE(pv.size, '')), '') AS size,
             COALESCE(pv.stock, 0)                   AS units,
             COALESCE(pv.low_stock_alert, 0)         AS low_stock_alert
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE ${scope.variantWhere} AND ${scope.productWhere}
    ),
    valued AS (
      SELECT pv.id AS variant_id, ${costSelect}
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      ${costJoin}
      WHERE ${scope.variantWhere} AND ${scope.productWhere}
        AND COALESCE(pv.stock, 0) > 0
    ),
    stocked AS (
      SELECT v.variant_id, v.product_id, v.size, v.units, v.low_stock_alert,
             val.unit_cost
      FROM variants v
      LEFT JOIN valued val ON val.variant_id = v.variant_id
    ),
    demand AS (
      SELECT oi.variant_id,
             oi.product_id,
             SUM(GREATEST(oi.quantity - COALESCE(oi.returned_quantity, 0), 0))                       AS units_sold,
             SUM(GREATEST(oi.quantity - COALESCE(oi.returned_quantity, 0), 0) * COALESCE(oi.unit_price, 0)) AS net_sales,
             MAX(o.created_at)                                                                        AS last_sold_at
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE ${scope.tenantScoped ? `o.tenant_id = ${scope.tenant} AND ` : ""}${scope.orderPredicate}
        AND o.created_at >= ${scope.from}::date
        AND o.created_at < (${scope.to}::date + 1)
      GROUP BY oi.variant_id, oi.product_id
    ),
    lifetime AS (
      SELECT oi.product_id,
             MAX(o.created_at)                                                    AS last_sold_at,
             SUM(GREATEST(oi.quantity - COALESCE(oi.returned_quantity, 0), 0))    AS units_sold
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE ${scope.tenantScoped ? `o.tenant_id = ${scope.tenant} AND ` : ""}${scope.orderPredicate}
      GROUP BY oi.product_id
    ),
    receipts AS (
      SELECT m.product_id,
             MIN(m.created_at) AS first_received_at,
             MAX(m.created_at) AS last_received_at
      FROM inventory_movements m
      WHERE ${scope.tenantScoped ? `m.tenant_id = ${scope.tenant} AND ` : ""}
        UPPER(m.movement_type) IN (${sqlTypeList(RECEIPT_MOVEMENT_TYPES)})
        AND m.product_id IS NOT NULL
      GROUP BY m.product_id
    )
  `;
};

/* ------------------------------------------------------------------- endpoints */

const runTimed = async (client, sql, params, timings, name) => {
  const startedAt = Date.now();
  const result = await client.query(sql, params);
  timings[name] = Date.now() - startedAt;
  return result;
};

/**
 * Guard against a movement type the contract has never seen.
 *
 * A new type must not slip into a velocity bucket by accident: it either represents
 * demand or it does not, and guessing corrupts every downstream figure.
 */
const checkMovementVocabulary = async (client, scope, collector) => {
  const result = scope.tenantScoped
    ? await client.query(
        `SELECT DISTINCT UPPER(movement_type) AS movement_type FROM inventory_movements WHERE tenant_id = $1`,
        [scope.params[0]]
      )
    : await client.query(`SELECT DISTINCT UPPER(movement_type) AS movement_type FROM inventory_movements`);
  const unknown = unknownMovementTypes(result.rows.map((row) => row.movement_type));
  if (unknown.length) {
    collector.add(
      "UNKNOWN_MOVEMENT_TYPE",
      "Inventory movement types are present that the contract does not describe; they are excluded from every metric.",
      { types: unknown }
    );
  }
  return unknown;
};

export const getInventorySummary = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  await checkMovementVocabulary(client, scope, collector);

  const sql = `
    WITH ${inventoryCte({ scope, columns, includeCost })},
    per_product AS (
      SELECT s.product_id,
             SUM(s.units)                                              AS units,
             COUNT(*)                                                  AS variants,
             COUNT(*) FILTER (WHERE s.units > 0)                       AS stocked_variants,
             SUM(s.units * s.unit_cost) FILTER (WHERE s.unit_cost IS NOT NULL) AS value_known,
             SUM(s.units) FILTER (WHERE s.unit_cost IS NULL)           AS units_uncosted,
             COALESCE(SUM(d.units_sold), 0)                            AS units_sold,
             COALESCE(SUM(d.net_sales), 0)                             AS net_sales,
             MAX(l.last_sold_at)                                       AS last_sold_at,
             COALESCE(MAX(l.units_sold), 0)                            AS lifetime_units,
             MAX(r.first_received_at)                                  AS first_received_at
      FROM stocked s
      LEFT JOIN demand d   ON d.variant_id = s.variant_id
      LEFT JOIN lifetime l ON l.product_id = s.product_id
      LEFT JOIN receipts r ON r.product_id = s.product_id
      WHERE s.units > 0
      GROUP BY s.product_id
    )
    SELECT
      COUNT(*)                                                         AS stocked_products,
      COALESCE(SUM(units), 0)                                          AS units_in_stock,
      COALESCE(SUM(stocked_variants), 0)                               AS stocked_variants,
      COALESCE(SUM(value_known), 0)                                    AS inventory_value_known,
      COALESCE(SUM(units_uncosted), 0)                                 AS units_uncosted,
      COALESCE(SUM(units_sold), 0)                                     AS units_sold_period,
      COALESCE(SUM(net_sales), 0)                                      AS net_sales_period,
      json_agg(json_build_object(
        'productId', product_id,
        'units', units,
        'value', value_known,
        'unitsSold', units_sold,
        'lifetimeUnits', lifetime_units,
        'lastSoldAt', last_sold_at,
        'firstReceivedAt', first_received_at
      )) AS rows
    FROM per_product
  `;

  const result = await runTimed(client, sql, scope.params, timings, "summary");
  const row = result.rows[0] || {};
  const rows = row.rows || [];

  const unitsInStock = toFiniteNumber(row.units_in_stock) ?? 0;
  const unitsUncosted = toFiniteNumber(row.units_uncosted) ?? 0;
  const costCoverage = unitsInStock > 0 ? safeRatio(unitsInStock - unitsUncosted, unitsInStock) : null;

  // Never value unknown cost at zero: report what is known and how much of the stock it
  // covers, exactly as profit does with its COGS coverage.
  if (includeCost && costCoverage !== null && costCoverage < 1) {
    collector.add(
      WARNING_CODES.INVENTORY_COST_COVERAGE_LOW,
      "Some stocked units have no resolved cost, so inventory value covers only part of the stock.",
      { coverage: costCoverage, uncostedUnits: unitsUncosted }
    );
  }

  const health = buildHealth(rows);

  // Both conditions are visible, and they are not the same thing: one is missing
  // history, the other is a product that falls between the approved thresholds.
  if (health.unknownAge.products > 0) {
    collector.add(
      "VELOCITY_UNKNOWN_AGE",
      "Some stocked products have no recorded receipt, so age-dependent movement classes cannot be applied to them.",
      { products: health.unknownAge.products, reason: UNKNOWN_AGE_REASON }
    );
  }
  if (health.unclassified > 0) {
    collector.add(
      "VELOCITY_UNCLASSIFIED",
      "Some stocked products fall between the movement thresholds and are reported without a class.",
      { products: health.unclassified }
    );
  }

  return buildEnvelope({
    meta: { permissions: { cost: includeCost } },
    data: {
      kpis: {
        inventoryValue: includeCost
          ? { current: toMoney(toFiniteNumber(row.inventory_value_known) ?? 0), coverage: costCoverage }
          : { current: null, restricted: true },
        unitsInStock: { current: unitsInStock },
        stockedProducts: { current: toFiniteNumber(row.stocked_products) ?? 0 },
        stockedVariants: { current: toFiniteNumber(row.stocked_variants) ?? 0 },
        unitsSoldPeriod: { current: toFiniteNumber(row.units_sold_period) ?? 0 },
        netSalesPeriod: { current: toMoney(toFiniteNumber(row.net_sales_period) ?? 0) },
      },
      health,
      highlights: buildInventoryHighlights({ rows, health, costCoverage, includeCost }),
      uncostedUnits: includeCost ? unitsUncosted : null,
    },
    filters,
    collector,
  });
};

/**
 * Velocity buckets with their products, units and value.
 *
 * Rows that match no rule are counted separately rather than folded into a bucket they
 * do not belong to.
 */
export const buildHealth = (rows = []) => {
  const now = Date.now();
  const days = (value) => (value ? Math.floor((now - new Date(value).getTime()) / 86400000) : null);

  const buckets = Object.fromEntries(
    VELOCITY_CLASSES.map((key) => [key, { products: 0, units: 0, value: 0 }])
  );
  let unclassified = 0;
  let unknownAgeProducts = 0;

  for (const row of rows) {
    const velocity = classifyVelocity({
      daysSinceFirstReceipt: days(row.firstReceivedAt),
      daysSinceLastSale: days(row.lastSoldAt),
      unitsSoldWindow: toFiniteNumber(row.unitsSold) ?? 0,
      hasEverSold: (toFiniteNumber(row.lifetimeUnits) ?? 0) > 0 || Boolean(row.lastSoldAt),
    });
    if (!velocity) {
      unclassified += 1;
      continue;
    }
    if (velocity === "unknown_age") unknownAgeProducts += 1;
    buckets[velocity].products += 1;
    buckets[velocity].units += toFiniteNumber(row.units) ?? 0;
    buckets[velocity].value += toFiniteNumber(row.value) ?? 0;
  }

  for (const key of VELOCITY_CLASSES) buckets[key].value = toMoney(buckets[key].value);
  return {
    buckets,
    unclassified,
    unknownAge: { products: unknownAgeProducts, reason: UNKNOWN_AGE_REASON },
    rules: VELOCITY_RULES,
  };
};

/** Deterministic highlights. Codes and values only — Arabic prose lives in the bundle. */
export const buildInventoryHighlights = ({ rows = [], health, costCoverage, includeCost }) => {
  const highlights = [];
  const totalValue = rows.reduce((sum, row) => sum + (toFiniteNumber(row.value) ?? 0), 0);

  if (includeCost && totalValue > 0) {
    const sorted = [...rows].sort((a, b) => (toFiniteNumber(b.value) ?? 0) - (toFiniteNumber(a.value) ?? 0));
    const topCount = Math.min(8, sorted.length);
    const topValue = sorted.slice(0, topCount).reduce((sum, row) => sum + (toFiniteNumber(row.value) ?? 0), 0);
    const share = safeRatio(topValue, totalValue);
    if (share !== null && share >= 0.25 && rows.length > topCount) {
      highlights.push({
        code: "INVENTORY_VALUE_HIGH_CONCENTRATION",
        severity: "info",
        metric: "inventoryValue",
        messageKey: "highlights.inventoryConcentration",
        values: { percent: share, count: topCount },
      });
    }
  }

  const dead = health?.buckets?.dead_candidate;
  if (dead?.products > 0) {
    highlights.push({
      code: "DEAD_CANDIDATE_VALUE_HIGH",
      severity: "warning",
      metric: "deadCandidates",
      messageKey: "highlights.deadCandidates",
      values: { products: dead.products, units: dead.units, value: dead.value },
    });
  }

  const tooNew = health?.buckets?.too_new;
  const totalProducts = VELOCITY_CLASSES.reduce((sum, key) => sum + (health?.buckets?.[key]?.products ?? 0), 0);
  const tooNewShare = safeRatio(tooNew?.products ?? 0, totalProducts);
  if (tooNewShare !== null && tooNewShare >= 0.4) {
    highlights.push({
      code: "TOO_NEW_SHARE_HIGH",
      severity: "info",
      metric: "tooNew",
      messageKey: "highlights.tooNewShare",
      values: { percent: tooNewShare, products: tooNew.products },
    });
  }

  if (includeCost && costCoverage !== null && costCoverage < 1) {
    highlights.push({
      code: "COST_COVERAGE_LOW",
      severity: "warning",
      metric: "inventoryValue",
      messageKey: "highlights.inventoryCoverage",
      values: { percent: costCoverage },
    });
  }

  return highlights.slice(0, 5);
};


/* ------------------------------------------------------------------ breakdown */

/**
 * Inventory value and demand by dimension.
 *
 * Stock is a snapshot; demand covers the selected period. Both appear per row precisely
 * so a manager can see where the two disagree.
 */
export const getInventoryBreakdown = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const dimension = INVENTORY_DIMENSIONS[filters.dimension] ? filters.dimension : DEFAULT_INVENTORY_DIMENSION;
  const timings = {};

  await checkMovementVocabulary(client, scope, collector);

  const dimensionExpr = INVENTORY_DIMENSIONS[dimension];
  const sql = `
    WITH ${inventoryCte({ scope, columns, includeCost })},
    per_variant AS (
      SELECT ${dimensionExpr}                                            AS dimension_key,
             s.product_id,
             s.units,
             s.unit_cost,
             COALESCE(d.units_sold, 0)                                   AS units_sold,
             COALESCE(d.net_sales, 0)                                    AS net_sales
      FROM stocked s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN demand d ON d.variant_id = s.variant_id
      WHERE s.units > 0
    )
    SELECT dimension_key                                                 AS key,
           COUNT(DISTINCT product_id)                                    AS stocked_products,
           SUM(units)                                                    AS units_in_stock,
           SUM(units * unit_cost) FILTER (WHERE unit_cost IS NOT NULL)   AS inventory_value,
           SUM(units) FILTER (WHERE unit_cost IS NULL)                   AS units_uncosted,
           SUM(units_sold)                                               AS units_sold_period,
           SUM(net_sales)                                                AS net_sales_period
    FROM per_variant
    GROUP BY dimension_key
    ORDER BY ${includeCost ? "inventory_value" : "units_in_stock"} DESC NULLS LAST
  `;

  const result = await runTimed(client, sql, scope.params, timings, "breakdown");
  const rows = result.rows || [];
  const totalValue = rows.reduce((sum, row) => sum + (toFiniteNumber(row.inventory_value) ?? 0), 0);
  const totalUnits = rows.reduce((sum, row) => sum + (toFiniteNumber(row.units_in_stock) ?? 0), 0);

  const mapped = rows.map((row) => ({
    key: row.key,
    stockedProducts: toFiniteNumber(row.stocked_products) ?? 0,
    unitsInStock: toFiniteNumber(row.units_in_stock) ?? 0,
    inventoryValue: includeCost ? toMoney(toFiniteNumber(row.inventory_value) ?? 0) : null,
    unitsUncosted: includeCost ? toFiniteNumber(row.units_uncosted) ?? 0 : null,
    unitsSoldPeriod: toFiniteNumber(row.units_sold_period) ?? 0,
    netSalesPeriod: toMoney(toFiniteNumber(row.net_sales_period) ?? 0),
    valueShare: includeCost ? safeRatio(toFiniteNumber(row.inventory_value) ?? 0, totalValue) : null,
    unitShare: safeRatio(toFiniteNumber(row.units_in_stock) ?? 0, totalUnits),
  }));

  const quality = assessInventoryDimensionQuality(dimension, mapped, includeCost ? totalValue : totalUnits, includeCost);
  if (!quality.usable) {
    collector.add(
      "DIMENSION_NOT_USABLE",
      "This dimension has no meaningful segmentation in the current catalogue.",
      { dimension, distinctMeaningfulValues: quality.distinctMeaningfulValues }
    );
  }

  return buildEnvelope({
    meta: { permissions: { cost: includeCost } },
    data: { dimension, rows: mapped, total: { value: includeCost ? toMoney(totalValue) : null, units: totalUnits }, quality },
    filters,
    collector,
  });
};

/** Unknown buckets carry no segmentation, so a dimension made only of them is unusable. */
export const UNKNOWN_DIMENSION_KEYS = Object.freeze(["بدون علامة", "غير مصنف", "غير محدد"]);

export const assessInventoryDimensionQuality = (dimension, rows = [], total = 0, includeCost = true) => {
  const weight = (row) => (includeCost ? row.inventoryValue : row.unitsInStock) ?? 0;
  const meaningful = rows.filter((row) => !UNKNOWN_DIMENSION_KEYS.includes(row.key));
  const unknown = rows.filter((row) => UNKNOWN_DIMENSION_KEYS.includes(row.key));
  const unknownWeight = unknown.reduce((sum, row) => sum + weight(row), 0);
  return {
    dimension,
    distinctMeaningfulValues: meaningful.length,
    unknownContribution: toMoney(unknownWeight),
    unknownContributionPercent: safeRatio(unknownWeight, total),
    usable: meaningful.length > 0,
  };
};

/* ------------------------------------------------------------------- products */

/**
 * The product grid, the stock-vs-sales matrix and the dead-candidate list.
 *
 * One query feeds all three so the sections cannot disagree about a product.
 */
export const getInventoryProducts = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const sortKey = INVENTORY_SORTS[filters.sort] ? filters.sort : DEFAULT_INVENTORY_SORT;
  const sortColumn = INVENTORY_SORTS[sortKey];
  const direction = filters.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const page = Math.max(Number(filters.page) || 1, 1);
  const timings = {};

  await checkMovementVocabulary(client, scope, collector);

  const sql = `
    WITH ${inventoryCte({ scope, columns, includeCost })},
    per_product AS (
      SELECT s.product_id,
             MAX(p.name)                                                  AS product_name,
             MAX(NULLIF(TRIM(COALESCE(p.product_type,'')),''))            AS product_type,
             MAX(NULLIF(TRIM(COALESCE(p.brand,'')),''))                   AS brand,
             MAX(NULLIF(TRIM(COALESCE(p.image_url,'')),''))               AS image_url,
             MAX(NULLIF(TRIM(COALESCE(p.variation_mode,'')),''))          AS variation_mode,
             SUM(s.units)                                                 AS units_in_stock,
             COUNT(*) FILTER (WHERE s.units = 0)                          AS zero_stock_variants,
             COUNT(*)                                                     AS variants,
             SUM(s.units * s.unit_cost) FILTER (WHERE s.unit_cost IS NOT NULL) AS inventory_value,
             SUM(s.units) FILTER (WHERE s.unit_cost IS NULL)              AS units_uncosted,
             COUNT(*) FILTER (WHERE s.units > 0
                              AND s.units <= GREATEST(s.low_stock_alert, 1)) AS low_stock_variants,
             COALESCE(SUM(d.units_sold), 0)                               AS units_sold_period,
             COALESCE(SUM(d.net_sales), 0)                                AS net_sales_period,
             MAX(l.last_sold_at)                                          AS last_sold_at,
             COALESCE(MAX(l.units_sold), 0)                               AS lifetime_units,
             MAX(r.first_received_at)                                     AS first_received_at
      FROM stocked s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN demand d   ON d.variant_id = s.variant_id
      LEFT JOIN lifetime l ON l.product_id = s.product_id
      LEFT JOIN receipts r ON r.product_id = s.product_id
      GROUP BY s.product_id
      HAVING SUM(s.units) > 0
    )
    SELECT *, COUNT(*) OVER () AS total_rows
    FROM per_product
    ORDER BY ${sortColumn} ${direction} NULLS LAST, product_id ASC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}
  `;

  const deadSql = `
    WITH ${inventoryCte({ scope, columns, includeCost })},
    per_product AS (
      SELECT s.product_id,
             MAX(p.name)                                                   AS product_name,
             MAX(NULLIF(TRIM(COALESCE(p.product_type,'')),''))             AS product_type,
             MAX(NULLIF(TRIM(COALESCE(p.brand,'')),''))                    AS brand,
             SUM(s.units)                                                  AS units_in_stock,
             SUM(s.units * s.unit_cost) FILTER (WHERE s.unit_cost IS NOT NULL) AS inventory_value,
             COALESCE(SUM(d.units_sold), 0)                                AS units_sold_period,
             COALESCE(SUM(d.net_sales), 0)                                 AS net_sales_period,
             MAX(l.last_sold_at)                                           AS last_sold_at,
             COALESCE(MAX(l.units_sold), 0)                                AS lifetime_units,
             MAX(r.first_received_at)                                      AS first_received_at
      FROM stocked s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN demand d   ON d.variant_id = s.variant_id
      LEFT JOIN lifetime l ON l.product_id = s.product_id
      LEFT JOIN receipts r ON r.product_id = s.product_id
      GROUP BY s.product_id
      HAVING SUM(s.units) > 0
    )
    SELECT * FROM per_product
    WHERE last_sold_at IS NULL
      AND lifetime_units = 0
      AND first_received_at IS NOT NULL
      AND first_received_at < NOW() - (${VELOCITY_RULES.establishedDays} * INTERVAL '1 day')
    ORDER BY inventory_value DESC NULLS LAST, units_in_stock DESC
    LIMIT ${DEAD_CANDIDATE_LIMIT}
  `;

  const [pageResult, allResult, deadResult] = await Promise.all([
    runTimed(client, sql, scope.params, timings, "products"),
    runTimed(
      client,
      `
      WITH ${inventoryCte({ scope, columns, includeCost })},
      per_product AS (
        SELECT s.product_id,
               MAX(p.name) AS product_name,
               MAX(NULLIF(TRIM(COALESCE(p.product_type,'')),'')) AS product_type,
               MAX(NULLIF(TRIM(COALESCE(p.brand,'')),'')) AS brand,
               SUM(s.units) AS units_in_stock,
               SUM(s.units * s.unit_cost) FILTER (WHERE s.unit_cost IS NOT NULL) AS inventory_value,
               COALESCE(SUM(d.units_sold), 0) AS units_sold_period,
               COALESCE(SUM(d.net_sales), 0) AS net_sales_period,
               MAX(l.last_sold_at) AS last_sold_at,
               COALESCE(MAX(l.units_sold), 0) AS lifetime_units,
               MAX(r.first_received_at) AS first_received_at
        FROM stocked s
        JOIN products p ON p.id = s.product_id
        LEFT JOIN demand d   ON d.variant_id = s.variant_id
        LEFT JOIN lifetime l ON l.product_id = s.product_id
        LEFT JOIN receipts r ON r.product_id = s.product_id
        GROUP BY s.product_id
        HAVING SUM(s.units) > 0
      )
      SELECT * FROM per_product
      ORDER BY inventory_value DESC NULLS LAST
      LIMIT ${MATRIX_LIMIT}
      `,
      scope.params,
      timings,
      "matrix"
    ),
    runTimed(client, deadSql, scope.params, timings, "dead"),
  ]);

  const shape = (row) => {
    const velocity = classifyVelocity({
      daysSinceFirstReceipt: daysSince(row.first_received_at),
      daysSinceLastSale: daysSince(row.last_sold_at),
      unitsSoldWindow: toFiniteNumber(row.units_sold_period) ?? 0,
      hasEverSold: (toFiniteNumber(row.lifetime_units) ?? 0) > 0 || Boolean(row.last_sold_at),
    });
    return {
      productId: row.product_id,
      productName: row.product_name,
      productType: row.product_type,
      brand: row.brand,
      imageUrl: row.image_url ?? null,
      unitsInStock: toFiniteNumber(row.units_in_stock) ?? 0,
      inventoryValue: includeCost ? toMoney(toFiniteNumber(row.inventory_value) ?? 0) : null,
      unitsSoldPeriod: toFiniteNumber(row.units_sold_period) ?? 0,
      netSalesPeriod: toMoney(toFiniteNumber(row.net_sales_period) ?? 0),
      lifetimeUnits: toFiniteNumber(row.lifetime_units) ?? 0,
      lastSoldAt: row.last_sold_at ?? null,
      firstReceivedAt: row.first_received_at ?? null,
      lowStockVariants: toFiniteNumber(row.low_stock_variants) ?? 0,
      missingSizes: toFiniteNumber(row.zero_stock_variants) ?? 0,
      variants: toFiniteNumber(row.variants) ?? 0,
      velocity,
      unknownAge: velocity === "unknown_age" ? UNKNOWN_AGE_REASON : null,
    };
  };

  const table = (pageResult.rows || []).map(shape);
  const matrixRows = (allResult.rows || []).map(shape);
  const total = toFiniteNumber(pageResult.rows?.[0]?.total_rows) ?? table.length;

  if (total > MATRIX_LIMIT) {
    collector.add("PRODUCT_LIST_TRUNCATED", "The matrix covers the highest-value products only.", { limit: MATRIX_LIMIT, total });
  }

  // Selected by the criteria themselves, so a low-value stagnant product cannot be
  // ranked out of its own list.
  const deadCandidates = (deadResult.rows || []).map(shape);

  return buildEnvelope({
    meta: { permissions: { cost: includeCost } },
    data: {
      table,
      pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
      sort: { key: sortKey, direction: direction.toLowerCase() },
      matrix: buildStockSalesMatrix(matrixRows, includeCost),
      deadCandidates,
    },
    filters,
    collector,
  });
};

const daysSince = (value) => (value ? Math.floor((Date.now() - new Date(value).getTime()) / 86400000) : null);

/**
 * Stock against demand, split on the period's own medians.
 *
 * Relative rather than absolute: a fixed "low stock" number would be wrong for a 3,000
 * EGP boot and a 200 EGP slipper on the same screen, and would drift as the catalogue
 * grows. Medians move with the data, so the quadrants keep meaning.
 */
export const buildStockSalesMatrix = (rows = [], includeCost = true) => {
  const eligible = rows.filter((row) => row.unitsInStock > 0);
  if (eligible.length < 4) {
    return { medianUnitsSold: null, medianStock: null, points: eligible.map((row) => ({ ...row, quadrant: null })) };
  }

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  const medianUnitsSold = median(eligible.map((row) => row.unitsSoldPeriod));
  const medianStock = median(eligible.map((row) => row.unitsInStock));

  const points = eligible.map((row) => {
    const highDemand = row.unitsSoldPeriod > medianUnitsSold;
    const highStock = row.unitsInStock > medianStock;
    const quadrant = highDemand
      ? highStock
        ? "healthy_core"
        : "replenish"
      : highStock
        ? "overstock"
        : "low_priority";
    return { ...row, quadrant };
  });

  return { medianUnitsSold, medianStock, points, includeCost };
};

/* ---------------------------------------------------------------------- sizes */

/**
 * Size-level stock against demand, for one product type.
 *
 * Scoped exactly as R3 scopes its size analysis: one product type at a time, because
 * shoe sizes, bag dimensions and one-size are not comparable on a single axis. Only
 * variation modes that genuinely carry sizes qualify.
 *
 * A "missing size" is a size variant that ALREADY EXISTS on the product and currently
 * has zero stock. No ideal run is inferred: the variants a product has ARE its run.
 */
export const getInventorySizes = async ({ filters, permissions = {}, client = db }) => {
  const includeCost = Boolean(permissions.cost);
  const collector = new WarningCollector();
  const columns = await loadColumns(client);
  const scope = buildScope({ filters, columns });
  const timings = {};

  if (!filters.productType) {
    collector.add("SIZE_SCOPE_REQUIRED", "Size analysis needs a single product type, because size ranges are not comparable across types.", {});
    return buildEnvelope({ data: { productType: null, applicable: false, rows: [], totals: null }, filters, collector });
  }

  const sql = `
    WITH ${inventoryCte({ scope, columns, includeCost })},
    sized AS (
      SELECT s.size,
             s.units,
             s.unit_cost,
             COALESCE(d.units_sold, 0) AS units_sold,
             COALESCE(d.net_sales, 0)  AS net_sales
      FROM stocked s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN demand d ON d.variant_id = s.variant_id
      WHERE s.size IS NOT NULL
        AND LOWER(TRIM(s.size)) NOT IN ('one size', 'onesize', 'مقاس واحد', 'free', 'free size')
        AND LOWER(COALESCE(p.variation_mode, '')) NOT IN ('color_only', 'simple')
    )
    SELECT size,
           SUM(units)                                                  AS units_in_stock,
           SUM(units * unit_cost) FILTER (WHERE unit_cost IS NOT NULL) AS inventory_value,
           SUM(units_sold)                                             AS units_sold_period,
           SUM(net_sales)                                              AS net_sales_period,
           COUNT(*) FILTER (WHERE units = 0)                           AS zero_stock_variants,
           COUNT(*)                                                    AS variants
    FROM sized
    GROUP BY size
    ORDER BY SUM(units_sold) DESC, SUM(units) DESC
  `;

  const result = await runTimed(client, sql, scope.params, timings, "sizes");
  const rows = (result.rows || []).map((row) => ({
    size: row.size,
    unitsInStock: toFiniteNumber(row.units_in_stock) ?? 0,
    inventoryValue: includeCost ? toMoney(toFiniteNumber(row.inventory_value) ?? 0) : null,
    unitsSoldPeriod: toFiniteNumber(row.units_sold_period) ?? 0,
    netSalesPeriod: toMoney(toFiniteNumber(row.net_sales_period) ?? 0),
    // An existing variant at zero stock is the approved definition of a missing size.
    missingVariants: toFiniteNumber(row.zero_stock_variants) ?? 0,
    variants: toFiniteNumber(row.variants) ?? 0,
  }));

  if (!rows.length) {
    collector.add("SIZE_SCOPE_APPLIED", "Colour-only and one-size products are excluded from size analysis.", {});
    return buildEnvelope({ data: { productType: filters.productType, applicable: false, rows: [], totals: null }, filters, collector });
  }

  const maxSold = Math.max(...rows.map((row) => row.unitsSoldPeriod), 0);
  const maxStock = Math.max(...rows.map((row) => row.unitsInStock), 0);
  const flagged = rows.map((row) => {
    const demandShare = safeRatio(row.unitsSoldPeriod, maxSold);
    const stockShare = safeRatio(row.unitsInStock, maxStock);
    let flag = null;
    if (demandShare !== null && stockShare !== null) {
      if (demandShare >= 0.5 && stockShare <= 0.25) flag = "high_demand_low_stock";
      else if (demandShare <= 0.25 && stockShare >= 0.5) flag = "high_stock_low_demand";
    }
    return { ...row, flag };
  });

  collector.add("SIZE_SCOPE_APPLIED", "Colour-only and one-size products are excluded from size analysis.", {});

  const missingSizes = flagged.filter((row) => row.unitsInStock === 0 && row.variants > 0);
  if (missingSizes.length) {
    collector.add("MISSING_SIZES", "Some existing size variants currently have no stock.", { sizes: missingSizes.length });
  }

  return buildEnvelope({
    meta: { permissions: { cost: includeCost } },
    data: {
      productType: filters.productType,
      applicable: true,
      rows: flagged,
      totals: {
        unitsInStock: flagged.reduce((sum, row) => sum + row.unitsInStock, 0),
        unitsSoldPeriod: flagged.reduce((sum, row) => sum + row.unitsSoldPeriod, 0),
        sizesWithStock: flagged.filter((row) => row.unitsInStock > 0).length,
        missingSizes: missingSizes.length,
      },
    },
    filters,
    collector,
  });
};

export { buildScope, inventoryCte, loadColumns, runTimed, checkMovementVocabulary, unitCostExpressions };
export { KNOWN_MOVEMENT_TYPES, DEMAND_MOVEMENT_TYPES, RECEIPT_MOVEMENT_TYPES };
