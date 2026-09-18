import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPortalOnlineSql,
  getPortalOnlineOrder,
  listPortalOnlineOrders,
  portalOrderSourceKey,
} from "../server/modules/shipping/shipping.portal.service.js";

// أوردرات الشحن (employee + manager portals). Every employee can open this list, and it
// carries customer names, phones and addresses — so the tenant filter and the "is this
// an online order" filter are the two things that must never regress.

const ORDER_COLUMNS = [
  "id", "tenant_id", "branch_id", "status", "source", "channel", "origin_surface", "ai_agent_conversation_id",
  "shipping_provider", "shipping_tracking_number", "tracking_number", "shipment_status", "shipping_status",
  "payment_status", "deleted_at", "is_personal_transaction", "created_at", "customer_name", "customer_phone",
  "invoice_number", "cashier_id", "created_by", "shipping_city_id", "shipping_zone_id", "shipping_district_id",
];
const ITEM_COLUMNS = ["id", "order_id", "product_id", "variant_id", "product_name", "quantity", "sale_price", "total_amount", "image_url", "color", "size"];
const TABLES = ["orders", "order_items", "branches", "users"];

const makeClient = ({ columns = ORDER_COLUMNS, tables = TABLES, pageRows = [], counts = [], detailRow = null, items = [] } = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return { rows: (params[0] === "orders" ? columns : ITEM_COLUMNS).map((column_name) => ({ column_name })) };
      }
      if (sql.includes("to_regclass")) return { rows: [{ regclass: tables.includes(params[0]) ? params[0] : null }] };
      if (sql.includes("GROUP BY 1")) return { rows: counts };
      if (sql.includes("WITH page AS")) return { rows: pageRows };
      if (sql.includes("FROM order_items oi")) return { rows: items };
      if (sql.includes("o.id = $1::bigint")) return { rows: detailRow ? [detailRow] : [] };
      return { rows: [] };
    },
  };
};

const orderQueries = (client) => client.calls.filter((call) => /FROM orders o/.test(call.sql));

test("the list only ever reads the caller's own shop", async () => {
  const client = makeClient();
  await listPortalOnlineOrders({ tenantId: 7, query: { range: "all" }, client });
  const queries = orderQueries(client);
  assert.equal(queries.length, 2, "counts + page");
  for (const { sql, params } of queries) {
    assert.match(sql, /o\.tenant_id = \$1::bigint/);
    assert.doesNotMatch(sql, /tenant_id IS NULL/, "a NULL-tenant escape hatch would leak other shops' customers");
    assert.equal(params[0], 7);
  }
});

test("a caller with no tenant sees tenant-less orders only, never every shop's", async () => {
  const client = makeClient();
  await listPortalOnlineOrders({ tenantId: null, query: { range: "all" }, client });
  for (const { sql } of orderQueries(client)) {
    assert.match(sql, /o\.tenant_id IS NULL/);
  }
});

test("the list and the details both apply the online-order and live-order filters", async () => {
  const sql = buildPortalOnlineSql(new Set(ORDER_COLUMNS));
  const listClient = makeClient();
  await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client: listClient });
  for (const call of orderQueries(listClient)) {
    assert.ok(call.sql.includes(sql.onlineExpr), "list must filter to online orders");
    assert.ok(call.sql.includes(sql.liveExpr), "list must drop deleted / personal / AI-draft orders");
  }
  // The details endpoint takes an id from the URL, so it is the one place an arbitrary
  // till invoice could be fetched — it must refuse anything the list would not show.
  const detailClient = makeClient();
  await assert.rejects(getPortalOnlineOrder({ tenantId: 1, orderId: 55, client: detailClient }), { status: 404 });
  const detailQuery = orderQueries(detailClient)[0];
  assert.ok(detailQuery.sql.includes(sql.onlineExpr));
  assert.ok(detailQuery.sql.includes(sql.liveExpr));
  assert.match(detailQuery.sql, /o\.tenant_id = \$2::bigint/);
  assert.deepEqual(detailQuery.params, [55, 1]);
});

test("an online order is recognised by any of its marks, and a bare till sale is not one", () => {
  const { onlineExpr, liveExpr } = buildPortalOnlineSql(new Set(ORDER_COLUMNS));
  for (const mark of ["o.source", "o.channel", "o.origin_surface IS NOT NULL", "o.ai_agent_conversation_id IS NOT NULL", "o.shipping_provider", "shipping_tracking_number"]) {
    assert.ok(onlineExpr.includes(mark), `missing online mark: ${mark}`);
  }
  assert.doesNotMatch(onlineExpr, /'pos'/, "the till's own channel must never count as online");
  for (const noCourier of ["'manual'", "'in_store_delivery'"]) {
    assert.ok(onlineExpr.includes(noCourier), `${noCourier} is the shop default, not a courier`);
  }
  assert.match(liveExpr, /o\.deleted_at IS NULL/);
  assert.match(liveExpr, /is_personal_transaction IS DISTINCT FROM TRUE/);
  assert.match(liveExpr, /<> 'ai_draft'/);
});

test("an older database without the newer columns still gets a valid query", async () => {
  const columns = ["id", "tenant_id", "status", "channel", "created_at", "customer_name"];
  const sql = buildPortalOnlineSql(new Set(columns));
  const all = `${sql.onlineExpr} ${sql.groupExpr} ${sql.liveExpr}`;
  for (const absent of ["origin_surface", "ai_agent_conversation_id", "o.shipping_tracking_number", "o.deleted_at", "o.source", "o.shipment_status"]) {
    assert.ok(!all.includes(absent), `referenced a column the table does not have: ${absent}`);
  }
  const client = makeClient({ columns });
  const payload = await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client });
  assert.deepEqual(payload.orders, []);
});

test("tab counts cover every tab and 'all' is their sum", async () => {
  const client = makeClient({ counts: [{ portal_group: "new", count: 4 }, { portal_group: "shipping", count: 2, attention: 1 }, { portal_group: "closed", count: 1 }] });
  const payload = await listPortalOnlineOrders({ tenantId: 1, query: {}, client });
  // "attention" is a cut across shipping, not a sixth tab: it is counted separately and
  // deliberately left out of `all`, or a stuck parcel would be counted twice.
  assert.deepEqual(payload.counts, { new: 4, confirmed: 0, shipping: 2, delivered: 0, closed: 1, attention: 1, all: 7 });
  assert.equal(payload.range, "30d", "the default window is the last 30 days");
});

test("a tab filters the page but never the counts", async () => {
  const client = makeClient();
  await listPortalOnlineOrders({ tenantId: 1, query: { group: "shipping", range: "all" }, client });
  const [countsQuery, pageQuery] = orderQueries(client);
  assert.ok(!countsQuery.params.includes("shipping"), "the counts must describe every tab at once");
  assert.ok(pageQuery.params.includes("shipping"));
});

test("paging reports whether another page exists", async () => {
  const pageRows = Array.from({ length: 31 }, (_, index) => ({ id: 100 - index, status: "pending", created_at: "2026-09-01T10:00:00Z", portal_group: "new" }));
  const payload = await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client: makeClient({ pageRows }) });
  assert.equal(payload.orders.length, 30);
  assert.equal(payload.has_more, true);
});

test("search finds an order number and an Egyptian phone in any written form", async () => {
  const byNumber = makeClient();
  await listPortalOnlineOrders({ tenantId: 1, query: { range: "all", search: "WEB-1234" }, client: byNumber });
  assert.ok(orderQueries(byNumber)[0].params.includes(1234));

  const byPhone = makeClient();
  await listPortalOnlineOrders({ tenantId: 1, query: { range: "all", search: "01024960585" }, client: byPhone });
  assert.ok(orderQueries(byPhone)[0].params.includes("%1024960585%"), "010… must match +2010… and 2010…");
});

test("the source label says which door the order came in through", () => {
  assert.equal(portalOrderSourceKey({ origin_surface: "pos", channel: "storefront", source: "website" }), "pos_online");
  assert.equal(portalOrderSourceKey({ channel: "storefront", source: "website" }), "website");
  assert.equal(portalOrderSourceKey({ channel: "whatsapp" }), "whatsapp");
  assert.equal(portalOrderSourceKey({ channel: "messenger" }), "facebook");
  assert.equal(portalOrderSourceKey({ channel: "instagram", source: "instagram" }), "instagram");
  assert.equal(portalOrderSourceKey({ channel: "pos", shipping_provider: "bosta" }), "pos");
});

test("the shipment history shows each courier state once", async () => {
  const detailRow = {
    id: 9,
    status: "shipment_created",
    created_at: "2026-09-01T10:00:00Z",
    portal_group: "shipping",
    shipment_timeline: [
      { at: "2026-09-01T11:00:00Z", action: "bosta_create_delivery", status: "created" },
      { at: "2026-09-01T12:00:00Z", action: "bosta_refresh_status", status: "in_transit" },
      { at: "2026-09-01T12:05:00Z", action: "bosta_webhook", status: "in_transit" },
      { at: "2026-09-01T15:00:00Z", action: "courier_collected", amount: 900 },
    ],
  };
  const order = await getPortalOnlineOrder({ tenantId: 1, orderId: 9, client: makeClient({ detailRow }) });
  assert.deepEqual(order.timeline.map((event) => `${event.kind}:${event.status || ""}`), [
    "created:",
    "shipment:created",
    "shipment:in_transit",
    "courier_collected:",
  ]);
  assert.equal(order.timeline.at(-1).amount, 900);
});

test("both portals scope the list and the details by the token holder's tenant", () => {
  const employeeRoutes = readFileSync(new URL("../server/routes/employeePortal.js", import.meta.url), "utf8");
  const managerRoutes = readFileSync(new URL("../server/routes/managerPortal.js", import.meta.url), "utf8");
  assert.match(employeeRoutes, /listPortalOnlineOrders\(\{ tenantId: employee\.tenant_id,/);
  assert.match(employeeRoutes, /getPortalOnlineOrder\(\{ tenantId: employee\.tenant_id,/);
  assert.match(managerRoutes, /listPortalOnlineOrders\(\{ tenantId: manager\.tenant_id,/);
  assert.match(managerRoutes, /getPortalOnlineOrder\(\{ tenantId: manager\.tenant_id,/);
});

test("the manager tab keeps the board out of .manager-portal-card", () => {
  // ManagerPortal.m1.css forces --text onto every bold element inside a card in dark
  // mode, which painted the board's gold pills light-on-gold (1.8:1).
  const source = readFileSync(new URL("../src/modules/managerPortal/pages/ManagerPortal.jsx", import.meta.url), "utf8");
  const block = source.slice(source.indexOf('activeTab === "shipping"'), source.indexOf('activeTab === "notifications"'));
  assert.ok(block.includes("<PortalOnlineOrdersBoard"), "the shipping tab renders the shared board");
  assert.ok(!block.includes("<Card"), "the board must not sit inside a manager-portal Card");
});

/*
 * ---------------------------------------------------------------------------
 * What the courier said, carried into both portals (2026-09-18).
 *
 * The three rules the owner asked for: a parcel already moving must stop asking
 * to be confirmed or paid for, a failed attempt must be visible, and a customer
 * who refused the box must say so on the card.
 * ---------------------------------------------------------------------------
 */

const DELIVERY_COLUMNS = [
  ...ORDER_COLUMNS,
  "bosta_exception_code", "bosta_exception_reason", "bosta_exception_at", "bosta_attempts",
  "bosta_promise_date", "bosta_courier_name", "bosta_courier_phone", "bosta_details", "bosta_reported_cod",
  "bosta_details_synced_at", "customer_secondary_phone", "customer_record_phone",
];

const shippedRow = (extra = {}) => ({
  id: 41,
  status: "pending_confirmation",
  created_at: "2026-09-16T10:00:00Z",
  portal_group: "shipping",
  shipping_provider: "bosta",
  shipping_tracking_number: "6612345",
  shipment_status: "out_for_delivery",
  ...extra,
});

test("a parcel with the courier stops asking to be confirmed", async () => {
  const client = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [shippedRow()] });
  const [order] = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client })).orders;
  // status is still pending_confirmation — the board must read the parcel, not the column.
  assert.equal(order.dispatched, true, "a booked parcel IS the shop's decision to send it");
  assert.equal(order.delivery.alert, null, "a parcel simply on its way raises nothing");
});

test("an order still in the shop is not dispatched", async () => {
  const row = { id: 42, status: "pending_confirmation", created_at: "2026-09-16T10:00:00Z", portal_group: "new", channel: "website" };
  const client = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [row] });
  const [order] = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client })).orders;
  assert.equal(order.dispatched, false);
});

test("a customer who refused the parcel says so, with Bosta's own reason", async () => {
  const row = shippedRow({ shipment_status: "failed_delivery", bosta_exception_code: 8, bosta_attempts: 1 });
  const client = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [row] });
  const [order] = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client })).orders;
  assert.equal(order.delivery.alert.key, "refused");
  assert.equal(order.delivery.alert.tone, "danger");
  assert.equal(order.delivery.exception_reason, "العميل رفض الاستلام");
});

test("a failed attempt is a warning, a second one needs a person", async () => {
  const once = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [shippedRow({ shipment_status: "failed_delivery", bosta_exception_code: 7, bosta_attempts: 1 })] });
  const twice = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [shippedRow({ shipment_status: "failed_delivery", bosta_exception_code: 7, bosta_attempts: 2 })] });
  const first = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client: once })).orders[0];
  const second = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client: twice })).orders[0];
  assert.equal(first.delivery.alert.key, "failed_attempt");
  assert.equal(second.delivery.alert.key, "action_needed", "Bosta gives up after three tries");
});

test("a delivered parcel carries no alert, whatever went wrong on the way", async () => {
  const row = shippedRow({ shipment_status: "delivered", bosta_exception_code: 7, bosta_attempts: 2 });
  const client = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [row] });
  const [order] = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client })).orders;
  assert.equal(order.delivery.alert, null, "an alert on a finished order is noise");
});

test("the attention tab is a cut across shipping, counted on its own", async () => {
  const { attentionExpr, groupExpr } = buildPortalOnlineSql(new Set(DELIVERY_COLUMNS));
  assert.ok(attentionExpr.includes(`${groupExpr} = 'shipping'`), "only a live parcel can need a person");
  assert.match(attentionExpr, /bosta_exception_code IS NOT NULL/);
  assert.match(attentionExpr, /'failed_delivery'/);
  const client = makeClient({ columns: DELIVERY_COLUMNS });
  await listPortalOnlineOrders({ tenantId: 1, query: { group: "attention", range: "all" }, client });
  const [countsQuery, pageQuery] = orderQueries(client);
  assert.ok(countsQuery.sql.includes("FILTER (WHERE"), "the count must cover the whole range, not the page");
  assert.ok(pageQuery.sql.includes(attentionExpr), "the attention tab filters by the shared expression");
  assert.ok(!pageQuery.params.includes("attention"), "attention is not a portal_group value");
});

test("an older database without the Bosta columns still answers", () => {
  const columns = ["id", "tenant_id", "status", "channel", "created_at", "customer_name"];
  const { attentionExpr } = buildPortalOnlineSql(new Set(columns));
  assert.ok(!attentionExpr.includes("bosta_exception_code"), "must not reference a column the table lacks");
});

test("the WhatsApp button resolves the customer's own inbox thread", async () => {
  const row = shippedRow({ customer_phone: "01001234567" });
  const conversationRow = { external_conversation_id: "whatsapp:201001234567", channel: "whatsapp", last_message_at: "2026-09-17T09:00:00Z" };
  const client = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [row], tables: [...TABLES, "ai_channel_conversations"] });
  const inner = client.query;
  client.query = async (sql, params = []) => {
    if (sql.includes("FROM ai_channel_conversations")) {
      // 010… is typed, whatsapp:2010… is what every ingest path writes.
      assert.ok(params[1].includes("whatsapp:201001234567"), `phone was not canonicalised: ${params[1]}`);
      return { rows: [conversationRow] };
    }
    return inner(sql, params);
  };
  const [order] = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client })).orders;
  assert.equal(order.conversation.id, "whatsapp:201001234567");
  assert.equal(order.conversation.channel, "whatsapp");
});

test("an order the inbox never saw gets no thread, so the button stays wa.me", async () => {
  const client = makeClient({ columns: DELIVERY_COLUMNS, pageRows: [shippedRow({ customer_phone: "01001234567" })], tables: [...TABLES, "ai_channel_conversations"] });
  const [order] = (await listPortalOnlineOrders({ tenantId: 1, query: { range: "all" }, client })).orders;
  assert.equal(order.conversation, null);
});
