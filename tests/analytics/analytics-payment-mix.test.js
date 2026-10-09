// Payment mix — "how much came in on cash, on a card, on InstaPay, in this period".
//
// The whole aggregation is a pure function over the SQL rows, so the contract that
// matters (one row per real method, three settlement classes kept apart, nothing
// invented for an invoice that never recorded a method) is testable without a database.
// Live behaviour is covered by analytics-overview.db.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assemblePaymentMix, assembleOverview } from "../../server/services/analytics/analyticsOverviewService.js";
import { WARNING_CODES, WarningCollector } from "../../server/services/analytics/analyticsComparison.js";
import { paymentMethodSettlement } from "../../shared/paymentMethods.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/** Just the payment-mix query builder, so a guard cannot pass on another query's SQL. */
const paymentMixQuerySource = async () => {
  const source = await read("../../server/services/analytics/analyticsOverviewService.js");
  const start = source.indexOf("const buildPaymentMixQuery");
  assert.ok(start > 0, "buildPaymentMixQuery was renamed or removed");
  const end = source.indexOf("/* ------", start);
  return source.slice(start, end > start ? end : undefined);
};

const row = (method, amount, orders = 1, unusable = 0) => ({ method, amount, orders, unusable });
const byMethod = (mix, method) => mix.rows.find((item) => item.method === method) || null;

/* ------------------------------------------------------------------ merging */

test("one method spelled two ways lands on one row", () => {
  const mix = assemblePaymentMix({ rows: [row("visa", 1000, 4), row("card", 500, 2)] });

  assert.equal(mix.rows.length, 1, "visa and card are the same rail and must not read as two");
  assert.equal(byMethod(mix, "card").amount, 1500);
  assert.equal(byMethod(mix, "card").orders, 6);
});

test("every stored spelling normalises through the shared normaliser", () => {
  const mix = assemblePaymentMix({
    rows: [row("insta_pay", 300), row("instapay", 200), row("vodafone", 100), row("Cash ", 50)],
  });

  assert.equal(byMethod(mix, "instapay").amount, 500);
  assert.equal(byMethod(mix, "vodafone_cash").amount, 100);
  assert.equal(byMethod(mix, "cash").amount, 50);
});

test("rows are ordered by amount, largest first", () => {
  const mix = assemblePaymentMix({ rows: [row("cash", 100), row("card", 900), row("instapay", 500)] });
  assert.deepEqual(mix.rows.map((item) => item.method), ["card", "instapay", "cash"]);
});

/* -------------------------------------------------------------- settlement */

test("collected, on-its-way and never-paid stay three different facts", () => {
  const mix = assemblePaymentMix({
    rows: [
      row("cash", 1000),
      row("card", 600),
      row("cod", 400),
      row("shipping_confirmation", 300),
      row("credit_sale", 200),
      row("customer_wallet", 100),
    ],
  });

  assert.equal(byMethod(mix, "cash").settlement, "collected");
  assert.equal(byMethod(mix, "card").settlement, "collected");
  assert.equal(byMethod(mix, "cod").settlement, "pending");
  // The customer transferred a fee; the rest of that invoice is still with the courier.
  assert.equal(byMethod(mix, "shipping_confirmation").settlement, "pending");
  assert.equal(byMethod(mix, "credit_sale").settlement, "credit");
  assert.equal(byMethod(mix, "customer_wallet").settlement, "credit");

  assert.equal(mix.totals.collected, 1600);
  assert.equal(mix.totals.pending, 700);
  assert.equal(mix.totals.credit, 300);
  assert.equal(mix.totals.all, 2600);
});

test("a method that moves no money is never counted as collected", () => {
  for (const method of ["credit_sale", "employee_advance", "exchange_credit", "return_credit", "customer_wallet", "personal"]) {
    assert.notEqual(paymentMethodSettlement(method), "collected", `${method} puts nothing in the drawer`);
  }
  for (const method of ["cod", "cash_on_delivery", "shipping_confirmation", "pending"]) {
    assert.equal(paymentMethodSettlement(method), "pending", `${method} is money we have not received yet`);
  }
  for (const method of ["cash", "card", "visa", "instapay", "vodafone_cash", "bank_transfer", "apple_pay"]) {
    assert.equal(paymentMethodSettlement(method), "collected", `${method} is real money in`);
  }
});

test("the settlement totals account for every row, with nothing counted twice", () => {
  const mix = assemblePaymentMix({
    rows: [row("cash", 500), row("cod", 300), row("credit_sale", 150), row("split", 50)],
  });

  const parts = mix.totals.collected + mix.totals.pending + mix.totals.credit + mix.totals.unattributed;
  assert.equal(parts, mix.totals.all);
  const shares = mix.rows.reduce((sum, item) => sum + (item.share || 0), 0);
  assert.ok(Math.abs(shares - 1) < 1e-9, `shares must sum to the whole, got ${shares}`);
});

/* ----------------------------------------------------------- unattributed */

test("an invoice with no recorded method is reported, not spread across the real ones", () => {
  const collector = new WarningCollector();
  const mix = assemblePaymentMix({ rows: [row("cash", 900), row("split", 100, 2)], collector });

  const unattributed = byMethod(mix, "mixed");
  assert.equal(unattributed.settlement, "unattributed");
  assert.equal(unattributed.amount, 100);
  assert.equal(byMethod(mix, "cash").amount, 900, "the real method must keep exactly its own money");
  assert.equal(mix.totals.unattributed, 100);

  const warning = collector.list().find((item) => item.code === WARNING_CODES.PAYMENT_MIX_UNATTRIBUTED);
  assert.ok(warning, "a manager must be told the gap exists");
  assert.equal(warning.amount, 100, "the warning carries the evidence, not just a sentence");
  assert.ok(Math.abs(warning.share - 0.1) < 1e-9);
});

test("an empty stored method becomes an explicit unknown row", () => {
  const mix = assemblePaymentMix({ rows: [row("", 250)] });
  const unknown = byMethod(mix, "unknown");
  assert.ok(unknown, "a blank method must not vanish from the total");
  assert.equal(unknown.settlement, "unattributed");
  assert.equal(unknown.amount, 250);
});

test("no unattributed money means no warning", () => {
  const collector = new WarningCollector();
  assemblePaymentMix({ rows: [row("cash", 100), row("card", 100)], collector });
  assert.equal(collector.list().length, 0, "a warning that fires when nothing is wrong stops being read");
});

/* ------------------------------------------------------- unusable numbers */

test("an allocation with no usable amount is counted and reported, never treated as zero", () => {
  const collector = new WarningCollector();
  const mix = assemblePaymentMix({ rows: [row("cash", 400, 3, 2)], collector });

  assert.equal(byMethod(mix, "cash").amount, 400);
  const warning = collector.list().find((item) => item.code === WARNING_CODES.NAN_VALUES_IGNORED);
  assert.ok(warning, "silently understating a method is the fault this warning exists for");
  assert.equal(warning.rows, 2);
  assert.equal(warning.metric, "paymentMix.amount");
});

test("an unreadable total drops the row rather than contributing a zero", () => {
  const collector = new WarningCollector();
  const mix = assemblePaymentMix({ rows: [row("cash", "abc"), row("card", 100)], collector });

  assert.equal(byMethod(mix, "cash"), null);
  assert.equal(mix.totals.all, 100);
  assert.ok(collector.list().some((item) => item.code === WARNING_CODES.NAN_VALUES_IGNORED));
});

/* ------------------------------------------------------------------ empty */

test("a period with no payments reports zeros and no rows", () => {
  const collector = new WarningCollector();
  const mix = assemblePaymentMix({ rows: [], collector });

  assert.deepEqual(mix.rows, []);
  assert.equal(mix.totals.all, 0);
  assert.equal(collector.list().length, 0);
});

/* ------------------------------------------------- inside the overview payload */

const OVERVIEW_INPUT = {
  ordersRow: {
    totals: { orders_current: 10, revenue_current: 1000, gross_current: 1100, discount_current: 100 },
    item_totals: { units_current: 20, costed_units_current: 20, cogs_current: 400 },
    trend: [],
  },
  contextRow: { returns_current: 0, new_customers_current: 1, inventory_value: 100 },
  categoryRows: [],
  paymentMixRows: [row("cash", 700), row("card", 300)],
  filters: { tenantId: 1, from: "2026-06-01", to: "2026-06-30", days: 30, comparisonMode: "none", comparison: null },
  granularity: "day",
};

test("the overview payload carries the payment mix and the net sales it should be read against", () => {
  const payload = assembleOverview({ ...OVERVIEW_INPUT, includeCost: true, includeProfit: true });

  assert.equal(payload.data.paymentMix.totals.all, 1000);
  assert.equal(payload.data.paymentMix.netSales, payload.data.kpis.netSales.current);
});

test("payment mix is not a cost figure, so it survives a caller with no cost permission", () => {
  const payload = assembleOverview({ ...OVERVIEW_INPUT, includeCost: false, includeProfit: false });

  assert.equal(payload.data.paymentMix.totals.all, 1000);
  assert.equal(payload.data.paymentMix.rows.length, 2);
  assert.equal(payload.data.kpis.grossProfit.current, null, "profit is still masked");
});

test("an overview assembled without payment rows still answers, with an empty mix", () => {
  const { paymentMixRows, ...withoutRows } = OVERVIEW_INPUT;
  const payload = assembleOverview({ ...withoutRows, includeCost: true, includeProfit: true });

  assert.deepEqual(payload.data.paymentMix.rows, []);
  assert.equal(payload.data.paymentMix.totals.all, 0);
});

/* --------------------------------------------------------- source guarantees */

test("the query reads the allocations, and falls back to the stored column only when there are none", async () => {
  const query = await paymentMixQuerySource();

  // The authoritative per-method record. Grouping by orders.payment_method instead would
  // bucket every split sale under the word "mixed".
  assert.match(query, /jsonb_array_elements/, "allocations are the source");
  assert.match(query, /jsonb_typeof\(o\.payment_breakdown\) = 'array'/, "a non-array column would throw");
  assert.match(query, /WHERE jsonb_array_length\(s\.allocations\) = 0/, "the fallback must not double-count an allocated invoice");
});

test("normalisation never happens in SQL, so it cannot drift from the shared rule", async () => {
  const source = await read("../../server/services/analytics/analyticsOverviewService.js");
  const query = await paymentMixQuerySource();

  for (const spelling of ["'visa'", "'insta_pay'", "'vodafone'"]) {
    assert.ok(!query.includes(spelling), `${spelling} is mapped in shared/paymentMethods.js; a second copy in SQL will drift`);
  }
  assert.match(source, /normalizePaymentMethodKey/, "the shared normaliser is the one used");
});

test("every settlement class the service can emit has copy in both locales", async () => {
  const bundles = {
    en: JSON.parse(await read("../../src/locales/en/overview.json")),
    ar: JSON.parse(await read("../../src/locales/ar/overview.json")),
  };

  // The card builds its labels from the settlement value, so a class with no copy would
  // render a raw dotted key to a manager.
  const mix = assemblePaymentMix({
    rows: [row("cash", 100), row("cod", 100), row("credit_sale", 100), row("split", 100)],
  });
  const classes = new Set(mix.rows.map((item) => item.settlement));
  assert.equal(classes.size, 4, "all four settlement classes must be exercised here");

  for (const settlement of classes) {
    for (const locale of ["en", "ar"]) {
      assert.ok(bundles[locale].paymentMix?.settlement?.[settlement], `${settlement} has no ${locale} total label`);
    }
  }
  for (const settlement of ["pending", "credit", "unattributed"]) {
    for (const locale of ["en", "ar"]) {
      assert.ok(bundles[locale].paymentMix?.chip?.[settlement], `${settlement} has no ${locale} chip label`);
    }
  }
});

test("an unusable allocation amount becomes NULL in SQL, not zero", async () => {
  const query = await paymentMixQuerySource();

  assert.match(query, /ELSE NULL/, "a zero would be an invented amount");
  assert.match(query, /COUNT\(\*\) FILTER \(WHERE amount IS NULL\)/, "what was refused has to be countable");
});
