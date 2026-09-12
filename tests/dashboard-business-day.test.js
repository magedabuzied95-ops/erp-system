import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onlineOnlyOrderClause, shopOnlyOrderClause } from "../server/modules/shipping/onlineOrderSql.js";

// Owner request 2026-09-12: the ERP dashboard's day runs 05:00 → 05:00, and a card shows the
// day's online sales (everything the till did not sell).

const ORDER_COLUMNS = ["id", "tenant_id", "status", "source", "channel", "origin_surface", "ai_agent_conversation_id", "shipping_provider", "shipping_tracking_number", "tracking_number", "shift_id", "created_at"];
const fakeClient = (columns = ORDER_COLUMNS) => ({
  query: async (sql, params) => {
    if (sql.includes("to_regclass")) return { rows: [{ regclass: params[0] }] };
    if (sql.includes("information_schema.columns")) return { rows: columns.map((column_name) => ({ column_name })) };
    return { rows: [] };
  },
});

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the online clause is the exact complement of the shop-only clause", async () => {
  const shop = await shopOnlyOrderClause({ client: fakeClient() });
  const online = await onlineOnlyOrderClause({ client: fakeClient() });
  // shop = " AND NOT (<expr>)", online = " AND (<expr>)" — the same expression, so every order
  // lands on exactly one side and POS + online adds up to the headline total.
  assert.equal(shop.replace(/^ AND NOT \(/, " AND ("), online);
  assert.match(online, /AND o\.shift_id IS NULL\)$/, "a till sale later shipped is still a shop sale");
  await assert.rejects(onlineOnlyOrderClause({ alias: "o; DROP TABLE orders", client: fakeClient() }), /Invalid SQL alias/);
});

test("the dashboard's today and yesterday are 05:00 trading days; wider ranges stay calendar", () => {
  const controller = read("../server/controllers/dashboardController.js");
  assert.match(controller, /DASHBOARD_DAY_START_HOUR = 5;/);
  assert.match(controller, /const DAY_OFFSETS = \{ today: 0, yesterday: -1 \};/);
  for (const handler of ["overview", "topProducts", "paymentAnalytics", "hourlySales", "marketing", "branchPerformance"]) {
    const start = controller.indexOf(`route("${handler}"`);
    assert.ok(start > 0, handler);
    assert.match(controller.slice(start, start + 260), /await resolveDashboardFilters\(req\)/, `${handler} reads the trading day`);
  }
  const posLive = controller.slice(controller.indexOf('route("posLive"'));
  assert.match(posLive.slice(0, 400), /resolveBusinessDayWindow\(\{ startHour: DASHBOARD_DAY_START_HOUR \}\)/, "the payment donut reads posLive");

  const service = read("../server/services/dashboardAnalyticsService.js");
  const windowFn = service.slice(service.indexOf("export const resolveBusinessDayWindow"));
  assert.match(windowFn.slice(0, 1200), /\+ make_interval\(days => \$2::int\)/, "day offset in SQL, DST-safe");
  const overview = service.slice(service.indexOf("export const getDashboardOverview"), service.indexOf("export const calculateTodayProfit"));
  assert.match(overview, /WHERE c\.created_at >= \$\{customerFrom\}\$\{customerTo\}/, "new customers follow the window");
  assert.match(overview, /\$\{onlineOnly\}[\s\S]*"overview\.online"/);
  assert.match(overview, /onlineSales: \{ value: toNumber\(onlineToday\[0\]\?\.sales\)/);
});

test("the page draws the online card and the hours from 05 to 04", () => {
  const page = read("../src/pages/Dashboard.jsx");
  assert.match(page, /k\.onlineSales\?\.value/);
  assert.match(page, /const h = \(5 \+ i\) % 24;/);
});
