import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dash = await readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
const svc = await readFile(new URL("../server/services/dashboardAnalyticsService.js", import.meta.url), "utf8");

test("dashboard no longer fetches the heavy /products/with-variants on load (perf + no freeze)", () => {
  assert.doesNotMatch(dash, /api\.get\(\s*["'`][^"'`]*products\/with-variants/);
});

test("dashboard renders the redesigned sections (not the old tabbed workspace)", () => {
  for (const cmp of ["HourlySalesCard", "PaymentMixCard", "ShiftStatusCard", "RecentSalesCard", "TopSellersCard", "StockAttentionCard", "AttentionCenter"]) {
    assert.match(dash, new RegExp(`<${cmp}\\b`), `expected <${cmp}> to be rendered`);
    assert.match(dash, new RegExp(`function ${cmp}\\b`), `expected ${cmp} to be defined`);
  }
});

test("KPI row surfaces the executive metrics with Arabic labels", () => {
  assert.match(dash, /صافي مبيعات اليوم/);
  assert.match(dash, /عدد فواتير اليوم/);
  assert.match(dash, /متوسط قيمة الفاتورة/);
  assert.match(dash, /القطع المباعة اليوم/);
  assert.match(dash, /المرتجعات اليوم/);
  assert.match(dash, /الخصومات اليوم/);
});

test("primary hourly chart + payment mix use existing recharts (no new chart dep)", () => {
  assert.match(dash, /from "recharts"/);
  assert.match(dash, /مبيعات اليوم حسب الساعة/); // hourly primary chart title
  assert.match(dash, /طرق الدفع اليوم/); // payment donut title
});

test("cards drill down to existing routes", () => {
  for (const route of ["/orders/${inv.id}", "/products/${it.product_id}", "/reports", "/inventory", "/purchases"]) {
    assert.ok(dash.includes(route), `expected drill-down to ${route}`);
  }
});

test("backend overview exposes the new KPI fields from authoritative aggregates", () => {
  assert.match(svc, /unitsSold:\s*\{ value: toNumber\(itemStats\.units\)/);
  assert.match(svc, /returnedUnits:\s*\{ value: toNumber\(itemStats\.returned_units\)/);
  assert.match(svc, /discountToday:\s*\{ value: toNumber\(t\.discount\)/);
  // units/returns come from an order_items aggregate (no raw history to client)
  assert.match(svc, /FROM order_items oi\s*\n\s*JOIN orders o ON o\.id = oi\.order_id/);
});

test("empty-state copy exists for zero-sales day", () => {
  assert.match(dash, /لا توجد مبيعات حتى الآن اليوم/);
});
