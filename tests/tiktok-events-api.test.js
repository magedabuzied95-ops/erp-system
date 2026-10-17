import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

import {
  buildTikTokOrderEvent,
  buildTrackRequestBody,
  drainTikTokOutbox,
  ensureTikTokEventsSchema,
  postTikTokEvent,
  queuePaidTikTokPurchases,
  recordTikTokPlaceAnOrder,
  runTikTokEventsSweep,
  queueTikTokRefunds,
  tiktokOutboxStats,
  activeTestEventCode,
  tiktokEventsConfig,
  tiktokHashedEmail,
  tiktokHashedPhone,
} from "../server/modules/tiktok/tiktokEventsApi.js";
import { TIKTOK_EVENTS, isTikTokPaymentComplete, tiktokOrderEventId } from "../shared/tiktokPixelEvent.js";

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
// A test window is open for these tests: every order that is not a test order must still go out live.
const config = { accessToken: "test-token-never-real", pixelId: "DB9980JC77UAEK31A0AG", testEventCode: "TEST123", testPhones: new Set(["201099999999"]), enabled: true };

const items = [
  { product_id: 7, variant_id: 31, sku: "AR-42-BLK", meta_content_id: "AR-42-BLK", product_name: "Air Runner", price: 1500, quantity: 2 },
];
const checkout = { full_name: "Test Buyer", primary_phone: "01012345678", email: " Buyer@Example.COM " };
const req = { headers: { "user-agent": "Mozilla/5.0 test", "x-forwarded-for": "203.0.113.9" }, socket: { remoteAddress: "203.0.113.9" }, ip: "203.0.113.9" };
const identity = { consent: true, ttp: "ttp-cookie-1", ttclid: "click-1", page_url: "https://m1store-egy.com/checkout" };

/* ------------------------------------------------------------------ payload shape (no database) */

test("hashing follows TikTok's normalisation: trimmed lowercase email, E.164 phone", () => {
  assert.equal(tiktokHashedEmail(" Buyer@Example.COM "), sha("buyer@example.com"));
  assert.equal(tiktokHashedPhone("01012345678"), sha("+201012345678"));
  assert.equal(tiktokHashedPhone("not a phone"), "");
});

test("the server PlaceAnOrder carries the browser's event_id and the catalogue ids", () => {
  const event = buildTikTokOrderEvent({ eventName: "PlaceAnOrder", order: { id: 501, total_amount: 3050 }, items, user: {}, eventTime: 1 });
  assert.equal(event.event_id, tiktokOrderEventId("PlaceAnOrder", { id: 501 }));
  assert.equal(event.event_id, "m1_tt_placeanorder_order_501");
  assert.deepEqual(event.properties, {
    contents: [{ content_id: "AR-42-BLK", content_type: "product", content_name: "Air Runner", quantity: 2, price: 1500 }],
    content_type: "product",
    value: 3050,
    currency: "EGP",
    order_id: "501",
  });
  const body = buildTrackRequestBody(event, config);
  assert.equal(body.event_source, "web");
  assert.equal(body.event_source_id, "DB9980JC77UAEK31A0AG");
  assert.equal(body.test_event_code, "TEST123");
  assert.equal(body.data.length, 1);
});

test("no token = disabled; the token is read from the environment only", () => {
  assert.equal(tiktokEventsConfig({}).enabled, false);
  assert.equal(tiktokEventsConfig({ TIKTOK_EVENTS_ACCESS_TOKEN: "x" }).enabled, true);
  assert.equal(tiktokEventsConfig({ TIKTOK_EVENTS_ACCESS_TOKEN: "x", TIKTOK_EVENTS_API_ENABLED: "false" }).enabled, false);
});

test("a test code only applies inside its window: never left on by mistake", () => {
  const now = Date.parse("2026-10-17T10:00:00Z");
  const code = { TIKTOK_EVENTS_TEST_EVENT_CODE: "TEST1" };
  assert.equal(activeTestEventCode(code, now), "", "no TEST_UNTIL");
  assert.equal(activeTestEventCode({ ...code, TIKTOK_EVENTS_TEST_UNTIL: "2026-10-17T12:00:00Z" }, now), "TEST1");
  assert.equal(activeTestEventCode({ ...code, TIKTOK_EVENTS_TEST_UNTIL: "2026-10-17T09:00:00Z" }, now), "", "expired");
  assert.equal(activeTestEventCode({ ...code, TIKTOK_EVENTS_TEST_UNTIL: "2026-10-20T09:00:00Z" }, now), "", "more than 24h ahead");
  const live = buildTrackRequestBody({ event: "Purchase" }, tiktokEventsConfig({ TIKTOK_EVENTS_ACCESS_TOKEN: "x", ...code }, now));
  assert.equal("test_event_code" in live, false);
});

test("paid means the whole total is in, never a status on its own", () => {
  assert.equal(isTikTokPaymentComplete({ payment_status: "paid", paid_amount: 3050, total_amount: 3050 }), true);
  assert.equal(isTikTokPaymentComplete({ payment_status: "paid", paid_amount: 50, total_amount: 3050 }), false);
  assert.equal(isTikTokPaymentComplete({ payment_status: "paid", status: "returned", paid_amount: 3050, total_amount: 3050 }), false);
  assert.equal(isTikTokPaymentComplete({ payment_status: "unpaid", status: "delivered" }), false);
});

test("browser and server name and id the same order event identically", async () => {
  const browserSource = fs.readFileSync(new URL("../src/storefront/lib/tiktokPixel.js", import.meta.url), "utf8");
  // The browser sends through orderEventOnce(TIKTOK_EVENTS.x, …) → tiktokOrderEventId(eventName, order).
  assert.ok(browserSource.includes("orderEventOnce(TIKTOK_EVENTS.placeAnOrder,"));
  assert.ok(browserSource.includes("orderEventOnce(TIKTOK_EVENTS.purchase,"));
  assert.ok(browserSource.includes("tiktokOrderEventId(eventName, order)"));
  for (const name of [TIKTOK_EVENTS.placeAnOrder, TIKTOK_EVENTS.purchase]) {
    const server = buildTikTokOrderEvent({ eventName: name, order: { id: 9 }, items, user: {} });
    assert.equal(server.event, name);
    assert.equal(server.event_id, tiktokOrderEventId(name, { id: 9 }));
  }
  assert.deepEqual([TIKTOK_EVENTS.placeAnOrder, TIKTOK_EVENTS.purchase], ["PlaceAnOrder", "Purchase"]);
});

test("retry classification: throttling and 5xx retry, payload errors do not; token never in the error", async () => {
  const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  assert.equal((await postTikTokEvent({}, { config, fetchImpl: reply(200, { code: 0 }) })).ok, true);
  assert.equal((await postTikTokEvent({}, { config, fetchImpl: reply(200, { code: 40002, message: "Invalid value" }) })).retryable, false);
  assert.equal((await postTikTokEvent({}, { config, fetchImpl: reply(401, { code: 40100 }) })).retryable, true);
  assert.equal((await postTikTokEvent({}, { config, fetchImpl: reply(503, {}) })).retryable, true);
  const thrown = await postTikTokEvent({}, { config, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.equal(thrown.retryable, true);
  assert.doesNotMatch(JSON.stringify(thrown), /test-token-never-real/);
});

/* ------------------------------------------------------------------ outbox against real Postgres */

const schema = `tiktok_test_${process.pid}_${Date.now()}`;
let client = null;
const sent = [];
const fetchOk = async (url, init) => {
  sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ code: 0, message: "OK", request_id: "r" }) };
};

before(async () => {
  const candidate = new pg.Client({
    connectionString: process.env.DATABASE_URL || undefined,
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "erp_db",
    password: process.env.PGPASSWORD || "065342",
    port: Number(process.env.PGPORT) || 5432,
  });
  try {
    await candidate.connect();
  } catch {
    return; // No local database: the outbox tests skip, the payload tests above still ran.
  }
  client = candidate;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE orders (id BIGINT PRIMARY KEY, tenant_id BIGINT, status TEXT, payment_status TEXT, total_amount NUMERIC, total NUMERIC, total_price NUMERIC, paid_amount NUMERIC NOT NULL DEFAULT 0)`);
  // The shape ordersController creates (only the columns the sweep reads).
  await client.query(`CREATE TABLE returns (id BIGSERIAL PRIMARY KEY, tenant_id BIGINT NULL, order_id BIGINT NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'pending', refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await client.query(`CREATE TABLE return_items (id BIGSERIAL PRIMARY KEY, return_id BIGINT NOT NULL REFERENCES returns(id) ON DELETE CASCADE, order_item_id BIGINT NOT NULL DEFAULT 0, variant_id BIGINT NULL, quantity INTEGER NOT NULL DEFAULT 1, refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0)`);
  await ensureTikTokEventsSchema(client);
});

after(async () => {
  if (!client) return;
  await client.query(`DROP SCHEMA ${schema} CASCADE`);
  await client.end();
});

beforeEach(async () => {
  sent.length = 0;
  if (!client) return;
  await client.query(`TRUNCATE orders, tiktok_event_outbox, return_items, returns`);
});

const db = (t) => {
  if (!client) t.skip("no local Postgres");
  return client;
};
const placeOrder = async (c, order) => {
  await c.query(`INSERT INTO orders (id, tenant_id, status, payment_status, total_amount, total) VALUES ($1, 1, $2, $3, $4, $4)`, [order.id, order.status, order.payment_status, order.total_amount]);
  const result = await recordTikTokPlaceAnOrder({ req, tenantId: 1, order, items, value: order.total_amount, checkout, customer: { id: 77 }, identity, client: c, config, fetchImpl: fetchOk });
  await result.delivery;
  return result;
};
const outbox = async (c) => (await c.query(`SELECT event_name, event_id, status FROM tiktok_event_outbox ORDER BY id`)).rows;

test("PlaceAnOrder: one row, sent once, same event_id as the browser; hashed matching data only", async (t) => {
  const c = db(t);
  if (!c) return;
  const result = await placeOrder(c, { id: 501, status: "pending", payment_status: "unpaid", total_amount: 3050 });
  assert.equal(result.eventId, "m1_tt_placeanorder_order_501");
  // A double submit / retried checkout for the same order is a no-op, and a later sweep sends nothing again.
  const again = await recordTikTokPlaceAnOrder({ req, tenantId: 1, order: { id: 501, status: "pending" }, items, checkout, identity, client: c, config, fetchImpl: fetchOk });
  assert.equal(again.queued, false);
  await c.query(`UPDATE tiktok_event_outbox SET next_attempt_at = NOW()`);
  await drainTikTokOutbox({ client: c, config, fetchImpl: fetchOk });
  assert.deepEqual(await outbox(c), [{ event_name: "PlaceAnOrder", event_id: "m1_tt_placeanorder_order_501", status: "sent" }]);
  assert.equal(sent.length, 1);
  const { headers, body } = sent[0];
  assert.equal(headers["Access-Token"], "test-token-never-real");
  assert.equal(body.data[0].event, "PlaceAnOrder");
  assert.equal(body.data[0].user.email, sha("buyer@example.com"));
  assert.equal(body.data[0].user.phone, sha("+201012345678"));
  assert.equal(body.data[0].user.external_id, sha("77"));
  assert.equal(body.data[0].user.ttp, "ttp-cookie-1");
  assert.equal(body.data[0].user.ttclid, "click-1");
  assert.doesNotMatch(JSON.stringify(body), /Test Buyer|01012345678|buyer@example/i);
  assert.equal((await outbox(c))[0].status, "sent");
});

test("Purchase: none while unpaid, partially paid or cancelled; exactly one once paid, even after re-saves", async (t) => {
  const c = db(t);
  if (!c) return;
  await placeOrder(c, { id: 601, status: "pending", payment_status: "unpaid", total_amount: 3050 });
  await placeOrder(c, { id: 602, status: "pending", payment_status: "unpaid", total_amount: 1000 });

  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);
  await c.query(`UPDATE orders SET payment_status = 'partially_paid' WHERE id = 601`);
  await c.query(`UPDATE orders SET status = 'delivered' WHERE id = 602`); // delivered is not paid
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);
  await c.query(`UPDATE orders SET status = 'cancelled', payment_status = 'paid', paid_amount = 1000 WHERE id = 602`);
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);

  // Marked paid by hand while money is still owed: not a Purchase.
  await c.query(`UPDATE orders SET payment_status = 'paid', paid_amount = 1000, total_amount = 3100 WHERE id = 601`);
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);
  await c.query(`UPDATE orders SET paid_amount = 3100 WHERE id = 601`);
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 1);
  // The order is saved again (status edits, a replayed webhook): still one Purchase.
  await c.query(`UPDATE orders SET status = 'confirmed' WHERE id = 601`);
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);

  await c.query(`UPDATE tiktok_event_outbox SET next_attempt_at = NOW()`);
  await drainTikTokOutbox({ client: c, config, fetchImpl: fetchOk });
  const purchases = sent.filter((entry) => entry.body.data[0].event === "Purchase");
  assert.equal(purchases.length, 1);
  const event = purchases[0].body.data[0];
  assert.equal(event.event_id, "m1_tt_purchase_order_601");
  assert.equal(event.properties.value, 3100);
  assert.equal(event.properties.currency, "EGP");
  assert.equal(event.properties.contents[0].content_id, "AR-42-BLK");
  assert.equal(event.user.email, sha("buyer@example.com"));
});

test("no consent: nothing queued, so no Purchase either", async (t) => {
  const c = db(t);
  if (!c) return;
  await c.query(`INSERT INTO orders (id, tenant_id, status, payment_status, total_amount, total, paid_amount) VALUES (701, 1, 'pending', 'paid', 500, 500, 500)`);
  const result = await recordTikTokPlaceAnOrder({ req, tenantId: 1, order: { id: 701, status: "pending" }, items, checkout, identity: { consent: false }, client: c, config });
  assert.equal(result.reason, "no_consent");
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);
  assert.deepEqual(await outbox(c), []);
});

test("retries with backoff, gives up on a payload error, and leaves no customer data in last_error", async (t) => {
  const c = db(t);
  if (!c) return;
  await placeOrder(c, { id: 801, status: "pending", payment_status: "unpaid", total_amount: 3050 });
  // Pretend the immediate send never happened.
  await c.query(`UPDATE tiktok_event_outbox SET next_attempt_at = NOW(), status = 'pending', attempts = 0, sent_at = NULL`);
  await drainTikTokOutbox({ client: c, config, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  let [row] = (await c.query(`SELECT status, attempts, next_attempt_at > NOW() AS later FROM tiktok_event_outbox`)).rows;
  assert.deepEqual(row, { status: "retry", attempts: 1, later: true });

  await c.query(`UPDATE tiktok_event_outbox SET next_attempt_at = NOW()`);
  await drainTikTokOutbox({
    client: c,
    config,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: 40002, message: `Invalid value for email: ${sha("buyer@example.com")}` }) }),
  });
  [row] = (await c.query(`SELECT status, last_error FROM tiktok_event_outbox`)).rows;
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /40002/);
  assert.doesNotMatch(row.last_error, /[0-9a-f]{64}|test-token/);
});

test("an event left unsent for over a week is expired, never sent late", async (t) => {
  const c = db(t);
  if (!c) return;
  await placeOrder(c, { id: 901, status: "pending", payment_status: "unpaid", total_amount: 3050 });
  sent.length = 0;
  await c.query(`UPDATE tiktok_event_outbox SET status = 'pending', sent_at = NULL, next_attempt_at = NOW(), created_at = NOW() - INTERVAL '8 days'`);
  await drainTikTokOutbox({ client: c, config, fetchImpl: fetchOk });
  assert.equal(sent.length, 0);
  await runTikTokEventsSweep({ client: c, config, fetchImpl: fetchOk });
  assert.equal(sent.length, 0);
  assert.equal((await outbox(c))[0].status, "expired");
});

/* ------------------------------------------------------------------ test mode is per order */

const placeAs = async (c, { id, phone, browser }) => {
  await c.query(`INSERT INTO orders (id, tenant_id, status, payment_status, total_amount, total) VALUES ($1, 1, 'pending', 'unpaid', 1000, 1000)`, [id]);
  const result = await recordTikTokPlaceAnOrder({ req, tenantId: 1, order: { id, status: "pending", total_amount: 1000 }, items, checkout: { ...checkout, primary_phone: phone }, identity: browser, client: c, config, fetchImpl: fetchOk });
  await result.delivery;
  return result;
};
const sentFor = (orderId) => sent.filter((entry) => entry.body.data[0].properties.order_id === String(orderId));

test("while a test runs, only a test-session order from a listed phone goes to Test Events", async (t) => {
  const c = db(t);
  if (!c) return;
  const testSession = { consent: true, test: true };
  const real = await placeAs(c, { id: 1001, phone: "01012345678", browser: identity });
  const testOrder = await placeAs(c, { id: 1002, phone: "01099999999", browser: testSession });
  const flagOnly = await placeAs(c, { id: 1003, phone: "01012345678", browser: testSession });
  const phoneOnly = await placeAs(c, { id: 1004, phone: "01099999999", browser: identity });
  assert.deepEqual([real.isTest, testOrder.isTest, flagOnly.isTest, phoneOnly.isTest], [false, true, false, false]);
  assert.equal("test_event_code" in sentFor(1001)[0].body, false, "a real customer is live during the test");
  assert.equal(sentFor(1002)[0].body.test_event_code, "TEST123");
  assert.equal("test_event_code" in sentFor(1003)[0].body, false, "the URL flag alone cannot hide an order");
  assert.equal("test_event_code" in sentFor(1004)[0].body, false, "a listed phone shopping normally is live");
});

test("a test order's Purchase inherits test mode, and never goes live once the window closes", async (t) => {
  const c = db(t);
  if (!c) return;
  await placeAs(c, { id: 1101, phone: "01099999999", browser: { consent: true, test: true } });
  await c.query(`UPDATE orders SET payment_status = 'paid', paid_amount = 1000 WHERE id = 1101`);
  const closed = { ...config, testEventCode: "" };
  await queuePaidTikTokPurchases({ client: c, config: closed });
  sent.length = 0;
  await drainTikTokOutbox({ client: c, config: closed, fetchImpl: fetchOk });
  assert.equal(sent.length, 0);
  const row = (await c.query(`SELECT is_test, status, last_error FROM tiktok_event_outbox WHERE event_name = 'Purchase'`)).rows[0];
  assert.deepEqual(row, { is_test: true, status: "expired", last_error: "test window closed" });
});

/* ------------------------------------------------------------------ refunds */

const paidAndSent = async (c, id) => {
  await placeOrder(c, { id, status: "pending", payment_status: "unpaid", total_amount: 3000 });
  await c.query(`UPDATE orders SET payment_status = 'paid', paid_amount = 3000 WHERE id = $1`, [id]);
  await queuePaidTikTokPurchases({ client: c, config });
  await drainTikTokOutbox({ client: c, config, fetchImpl: fetchOk });
  sent.length = 0;
};
const addReturn = async (c, { orderId, amount, status = "completed", quantity = 1 }) => {
  const { rows } = await c.query(`INSERT INTO returns (tenant_id, order_id, status, refund_amount) VALUES (1, $1, $2, $3) RETURNING id`, [orderId, status, amount]);
  await c.query(`INSERT INTO return_items (return_id, variant_id, quantity, refund_amount) VALUES ($1, 31, $2, $3)`, [rows[0].id, quantity, amount]);
  return rows[0].id;
};

test("Refund: one per return, mapped to the catalogue id the Purchase carried, never a second Purchase", async (t) => {
  const c = db(t);
  if (!c) return;
  await paidAndSent(c, 1201);
  const first = await addReturn(c, { orderId: 1201, amount: 1500 });
  await addReturn(c, { orderId: 1201, amount: 0 }); // an exchange with no money back
  await addReturn(c, { orderId: 1201, amount: 900, status: "pending" });
  assert.equal((await queueTikTokRefunds({ client: c, config })).refunds, 1);
  // The return is saved again, the order flips back and forth: nothing new.
  await c.query(`UPDATE orders SET payment_status = 'partially_refunded' WHERE id = 1201`);
  assert.equal((await queueTikTokRefunds({ client: c, config })).refunds, 0);
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);
  await c.query(`UPDATE orders SET payment_status = 'paid' WHERE id = 1201`);
  assert.equal((await queuePaidTikTokPurchases({ client: c, config })).queued, 0);

  const second = await addReturn(c, { orderId: 1201, amount: 1500 });
  assert.equal((await queueTikTokRefunds({ client: c, config })).refunds, 1);
  await c.query(`UPDATE tiktok_event_outbox SET next_attempt_at = NOW()`);
  await drainTikTokOutbox({ client: c, config, fetchImpl: fetchOk });
  const refunds = sent.map((entry) => entry.body.data[0]);
  assert.deepEqual(refunds.map((event) => event.event_id).sort(), [`m1_tt_refund_return_${first}`, `m1_tt_refund_return_${second}`].sort());
  assert.ok(refunds.every((event) => event.event === "Refund"));
  assert.deepEqual(refunds[0].properties.contents, [{ content_id: "AR-42-BLK", content_type: "product", content_name: "Air Runner", quantity: 1, price: 1500 }]);
  assert.equal(refunds[0].properties.value, 1500);
  assert.equal(refunds[0].properties.currency, "EGP");
  assert.equal(refunds[0].user.email, sha("buyer@example.com"));
  const purchases = (await c.query(`SELECT COUNT(*)::int AS n FROM tiktok_event_outbox WHERE event_name = 'Purchase'`)).rows[0].n;
  assert.equal(purchases, 1);
});

test("no Refund before the Purchase went out, and none for an order TikTok never heard of", async (t) => {
  const c = db(t);
  if (!c) return;
  await placeOrder(c, { id: 1301, status: "pending", payment_status: "unpaid", total_amount: 3000 });
  await addReturn(c, { orderId: 1301, amount: 1000 }); // returned while still unpaid
  await c.query(`INSERT INTO orders (id, tenant_id, status, payment_status, total_amount, total, paid_amount) VALUES (1302, 1, 'pending', 'paid', 500, 500, 500)`);
  await addReturn(c, { orderId: 1302, amount: 500 });
  assert.equal((await queueTikTokRefunds({ client: c, config })).refunds, 0);

  // Paid, its Purchase queued but not yet delivered (TikTok down): the Refund waits for it.
  await placeOrder(c, { id: 1303, status: "pending", payment_status: "unpaid", total_amount: 3000 });
  await c.query(`UPDATE orders SET payment_status = 'paid', paid_amount = 3000 WHERE id = 1303`);
  await queuePaidTikTokPurchases({ client: c, config });
  await addReturn(c, { orderId: 1303, amount: 1500 });
  assert.equal((await queueTikTokRefunds({ client: c, config })).refunds, 0);
  await c.query(`UPDATE tiktok_event_outbox SET next_attempt_at = NOW()`);
  await drainTikTokOutbox({ client: c, config, fetchImpl: fetchOk });
  assert.equal((await queueTikTokRefunds({ client: c, config })).refunds, 1);
});

/* ------------------------------------------------------------------ the 60-day window */

test("paid after 60 days: recorded as late, counted, never sent; inside 60 days it is sent", async (t) => {
  const c = db(t);
  if (!c) return;
  await placeOrder(c, { id: 1401, status: "pending", payment_status: "unpaid", total_amount: 3000 });
  await placeOrder(c, { id: 1402, status: "pending", payment_status: "unpaid", total_amount: 3000 });
  await c.query(`UPDATE tiktok_event_outbox SET created_at = NOW() - INTERVAL '61 days' WHERE order_id = 1401`);
  await c.query(`UPDATE tiktok_event_outbox SET created_at = NOW() - INTERVAL '59 days' WHERE order_id = 1402`);
  await c.query(`UPDATE orders SET payment_status = 'paid', paid_amount = 3000`);
  assert.deepEqual(await queuePaidTikTokPurchases({ client: c, config }), { queued: 1, late: 1 });
  assert.deepEqual(await queuePaidTikTokPurchases({ client: c, config }), { queued: 0, late: 0 }, "counted once");
  sent.length = 0;
  await drainTikTokOutbox({ client: c, config, fetchImpl: fetchOk });
  assert.deepEqual(sent.map((entry) => entry.body.data[0].properties.order_id), ["1402"]);
  const stats = await tiktokOutboxStats({ client: c });
  assert.ok(stats.some((row) => row.event_name === "Purchase" && row.status === "late" && row.count === 1));
});

/* ------------------------------------------------------------------ migrating the first table shape */

test("a table made by the first version (no ref_id, three-column key) is upgraded in place", async (t) => {
  const c = db(t);
  if (!c) return;
  const old = `${schema}_v1`;
  await c.query(`CREATE SCHEMA ${old}`);
  try {
    await c.query(`SET search_path TO ${old}`);
    await c.query(`CREATE TABLE tiktok_event_outbox (id BIGSERIAL PRIMARY KEY, tenant_id BIGINT NOT NULL, order_id BIGINT NOT NULL, event_name TEXT NOT NULL, event_id TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_error TEXT, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (tenant_id, event_name, order_id))`);
    await c.query(`INSERT INTO tiktok_event_outbox (tenant_id, order_id, event_name, event_id, payload) VALUES (1, 5, 'PlaceAnOrder', 'x', '{}')`);
    await ensureTikTokEventsSchema(c);
    await ensureTikTokEventsSchema(c); // a second boot is a no-op
    await c.query(`INSERT INTO tiktok_event_outbox (tenant_id, order_id, event_name, ref_id, event_id, payload) VALUES (1, 5, 'Refund', '10', 'a', '{}'), (1, 5, 'Refund', '11', 'b', '{}')`);
    await assert.rejects(c.query(`INSERT INTO tiktok_event_outbox (tenant_id, order_id, event_name, ref_id, event_id, payload) VALUES (1, 5, 'Refund', '10', 'c', '{}')`));
    const rows = (await c.query(`SELECT event_name, ref_id, is_test FROM tiktok_event_outbox ORDER BY id`)).rows;
    assert.deepEqual(rows, [
      { event_name: "PlaceAnOrder", ref_id: "", is_test: false },
      { event_name: "Refund", ref_id: "10", is_test: false },
      { event_name: "Refund", ref_id: "11", is_test: false },
    ]);
  } finally {
    await c.query(`SET search_path TO ${schema}`);
    await c.query(`DROP SCHEMA ${old} CASCADE`);
  }
});
