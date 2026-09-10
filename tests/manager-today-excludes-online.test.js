import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shopOnlyOrderClause } from "../server/modules/shipping/onlineOrderSql.js";
import { runPortalBulkPrint } from "../server/modules/shipping/shipping.portal.actions.js";

// Owner request 2026-09-10: the manager portal's اليوم tab is the shop's own day —
// its sales, invoices, payment split, day accounts and feed never include an online
// order; those live on أوردرات الشحن only.

const ORDER_COLUMNS = ["id", "tenant_id", "status", "source", "channel", "origin_surface", "ai_agent_conversation_id", "shipping_provider", "shipping_tracking_number", "tracking_number", "shift_id", "created_at"];
const fakeClient = (columns = ORDER_COLUMNS) => ({
  query: async (sql, params) => {
    if (sql.includes("to_regclass")) return { rows: [{ regclass: params[0] }] };
    if (sql.includes("information_schema.columns")) return { rows: columns.map((column_name) => ({ column_name })) };
    return { rows: [] };
  },
});

test("the shop-only clause removes online orders that never went through a till", async () => {
  const clause = await shopOnlyOrderClause({ client: fakeClient() });
  assert.match(clause, /^ AND NOT \(/);
  assert.match(clause, /o\.origin_surface IS NOT NULL/);
  // A counter sale later handed to a courier keeps its cash in the drawer: it stays.
  assert.match(clause, /AND o\.shift_id IS NULL\)$/);
});

test("the clause follows the caller's alias and refuses anything that is not one", async () => {
  const clause = await shopOnlyOrderClause({ alias: "ord", client: fakeClient() });
  assert.ok(!/\bo\./.test(clause), "every column must use the given alias");
  assert.match(clause, /ord\.shift_id IS NULL/);
  await assert.rejects(shopOnlyOrderClause({ alias: "o; DROP TABLE orders", client: fakeClient() }), /Invalid SQL alias/);
});

test("the dashboard only narrows on a real boolean, so a query string cannot flip it", () => {
  const source = readFileSync(new URL("../server/services/dashboardAnalyticsService.js", import.meta.url), "utf8");
  assert.match(source, /filters\?\.excludeOnline === true \? await shopOnlyOrderClause/);
  const overview = source.slice(source.indexOf("export const getDashboardOverview"), source.indexOf('"overview.yesterday"'));
  assert.equal((overview.match(/\$\{shopOnly\}/g) || []).length, 2, "today and yesterday");
  const recent = source.slice(source.indexOf("export const getRecentInvoices"));
  assert.match(recent.slice(0, 1500), /\$\{shopOnly\}/, "the today invoices list");
});

test("every اليوم source in the manager portal leaves online orders out", () => {
  const source = readFileSync(new URL("../server/services/managerPortalService.js", import.meta.url), "utf8");
  const dashboard = source.slice(source.indexOf("export const getManagerPortalDashboard"), source.indexOf("aggregatePaymentDistribution(distributionRows)"));
  assert.match(dashboard, /windowStart, windowEnd, excludeOnline: true \}/, "set after the ...filters spread");
  assert.match(dashboard, /\$\{shopOnly\}/, "the payment split");
  const daySummary = source.slice(source.indexOf("export const getManagerPortalDaySummary"));
  assert.match(daySummary.slice(0, 6000), /\$\{personalOrderClause\("o"\)\}\s+\$\{shopOnly\}/, "the day accounts tape");
  const operations = source.slice(source.indexOf("export const getManagerPortalOperations"));
  assert.match(operations.slice(0, 4000), /\["1", "true"\]\.includes\(lower\(query\.exclude_online\)\)/);

  const portal = readFileSync(new URL("../src/modules/managerPortal/pages/ManagerPortal.jsx", import.meta.url), "utf8");
  const todayCalls = portal.match(/managerPortalApi\.operations\(token, \{ range: "today"[^}]*\}/g) || [];
  assert.ok(todayCalls.length >= 2 && todayCalls.every((call) => call.includes("exclude_online: 1")), "both اليوم feed requests ask for the shop-only feed");
});

test("bulk print only prints the caller's orders that have a Bosta parcel, in one PDF", async () => {
  const orders = {
    1: { id: 1, order_number: "WEB-1", shipment: { provider: "bosta", tracking_number: "111" } },
    2: { id: 2, order_number: "WEB-2", shipment: { provider: "manual", tracking_number: "" } },
    3: { id: 3, order_number: "WEB-3", shipment: { provider: "bosta", tracking_number: "333" } },
  };
  const seen = [];
  const printed = [];
  const deps = {
    loadOrder: async ({ tenantId, orderId }) => {
      seen.push([tenantId, orderId]);
      if (!orders[orderId]) {
        const error = new Error("Order not found");
        error.status = 404;
        error.code = "order_not_found";
        throw error;
      }
      return orders[orderId];
    },
    fetchLabels: async (ids) => {
      printed.push(ids);
      return { pdf_base64: "JVBER", content_type: "application/pdf" };
    },
    audit: async () => {},
  };
  const result = await runPortalBulkPrint({ actor: { id: 9, tenant_id: 4 }, orderIds: [1, 2, 3, 99, 1, "x"], deps });
  assert.deepEqual(printed, [[1, 3]], "one courier call for every printable order");
  assert.ok(seen.every(([tenantId]) => tenantId === 4), "every id is re-read under the caller's tenant");
  assert.equal(result.printed, 2);
  assert.deepEqual(result.skipped.map((entry) => entry.code).sort(), ["BOSTA_NO_PRINTABLE_LABEL", "order_not_found"]);

  await assert.rejects(runPortalBulkPrint({ actor: { tenant_id: 4 }, orderIds: [2], deps }), { code: "BOSTA_NO_PRINTABLE_LABEL" });
  await assert.rejects(runPortalBulkPrint({ actor: { tenant_id: 4 }, orderIds: [], deps }), { code: "NO_ORDERS_SELECTED" });
  await assert.rejects(runPortalBulkPrint({ actor: { tenant_id: 4 }, orderIds: Array.from({ length: 51 }, (_, i) => i + 1), deps }), { code: "TOO_MANY_ORDERS" });
});

test("bulk print is open to every employee, like the single print (owner request 2026-09-10)", () => {
  const routes = readFileSync(new URL("../server/routes/employeePortal.js", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/:token/online-orders/print-labels"');
  const block = routes.slice(start, routes.indexOf("});", routes.indexOf("runPortalBulkPrint(", start)));
  assert.ok(block.includes("loadVerifiedEmployee("), "still a verified portal token");
  assert.ok(!block.includes("employeeCanActOnOnlineOrders("), "no per-employee switch on printing");
});
