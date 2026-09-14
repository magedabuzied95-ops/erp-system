import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// POST /storefront/customer/session used to trust a typed phone: it renamed the customer who owned
// it, merged their saved cart into a new session and handed back their name, wallet and loyalty
// with a cookie that also opened /customer/me (saved addresses). Only an OTP-proven phone may now.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

const {
  createOrRestoreStorefrontCustomerSession,
  createStorefrontCustomerSessionRateLimit,
  getStorefrontCustomerSession,
  isCurrentStorefrontSessionToken,
  readStorefrontCustomerToken,
  restoreStorefrontCustomerCart,
} = await import("../server/services/storefrontCustomerSessionService.js");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to > from ? to : undefined);
};

const PHONE = "01012345678";

// A pool whose one client knows an existing customer and that customer's last session.
const makePool = () => {
  const state = {
    connected: 0,
    queries: [],
    customer: { id: 7, tenant_id: 1, name: "Real Owner", phone: PHONE, loyalty_points: 120, loyalty_tier: "Silver", wallet_balance: 350 },
    previousSession: { id: 3, cart_items: [{ lineId: "owner-line", quantity: 1 }], wishlist_items: [{ id: "owner-wish" }] },
  };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      state.queries.push(text);
      if (text.includes("FROM customers") && text.includes("FOR UPDATE")) return { rows: [state.customer] };
      if (text.trim().startsWith("UPDATE customers")) {
        state.customer = { ...state.customer, name: params[0] || state.customer.name };
        return { rows: [state.customer] };
      }
      if (text.includes("FROM storefront_customer_sessions") && text.includes("FOR UPDATE")) return { rows: [state.previousSession] };
      if (text.includes("INSERT INTO storefront_customer_sessions")) {
        return { rows: [{ cart_items: JSON.parse(params[3]), wishlist_items: JSON.parse(params[4]) }] };
      }
      if (text.includes("SELECT id, loyalty_points")) return { rows: [state.customer] };
      return { rows: [] };
    },
    release() {},
  };
  return {
    state,
    async connect() {
      state.connected += 1;
      return client;
    },
  };
};

test("a typed phone alone touches no customer and returns only the caller's own cart", async () => {
  const pool = makePool();
  const result = await createOrRestoreStorefrontCustomerSession({
    tenantId: 1,
    name: "Attacker",
    phone: PHONE,
    cartItems: [{ lineId: "mine", quantity: 2 }],
    wishlistItems: [{ id: "my-wish" }],
    pool,
  });
  assert.equal(pool.state.connected, 0, "no database work for an unproven phone");
  assert.equal(pool.state.customer.name, "Real Owner");
  assert.equal(result.token, "");
  assert.equal(result.identified, false);
  assert.equal(result.verification_required, true);
  assert.equal(result.customer, null);
  assert.deepEqual(result.cart_items.map((item) => item.lineId), ["mine"]);
  assert.deepEqual(result.wishlist_items.map((item) => item.id), ["my-wish"]);
  assert.doesNotMatch(JSON.stringify(result), /Real Owner|350|owner-line|owner-wish/);
});

test("an OTP token for a different phone proves nothing", async () => {
  const pool = makePool();
  const result = await createOrRestoreStorefrontCustomerSession({ tenantId: 1, name: "Attacker", phone: PHONE, otpVerifiedPhone: "01198765432", pool });
  assert.equal(pool.state.connected, 0);
  assert.equal(result.token, "");
  assert.equal(result.customer, null);
});

test("the owner of the phone, proven by OTP, gets their session, cart and loyalty back", async () => {
  const pool = makePool();
  const result = await createOrRestoreStorefrontCustomerSession({
    tenantId: 1,
    name: "Owner Renamed",
    phone: "+20 101 234 5678",
    otpVerifiedPhone: PHONE,
    cartItems: [{ lineId: "new-line", quantity: 1 }],
    pool,
  });
  assert.equal(pool.state.connected, 1);
  assert.equal(pool.state.customer.name, "Owner Renamed");
  assert.ok(isCurrentStorefrontSessionToken(result.token));
  assert.equal(result.identified, true);
  assert.equal(result.customer.name, "Owner Renamed");
  assert.deepEqual(result.cart_items.map((item) => item.lineId).sort(), ["new-line", "owner-line"]);
  // The loyalty summary takes the client first; called the old way it threw and the fallback showed.
  assert.ok("points_to_next_tier" in result.customer.loyalty, "loyalty summary must be computed, not the fallback");
});

test("sessions issued before the fix are refused by every reader", async () => {
  const legacy = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1u";
  assert.equal(isCurrentStorefrontSessionToken(legacy), false);
  assert.equal(readStorefrontCustomerToken({ headers: { cookie: `sf_customer_session=${legacy}` } }), "");
  assert.equal(readStorefrontCustomerToken({ headers: { "x-storefront-customer-token": legacy } }), "");
  assert.equal(readStorefrontCustomerToken({ headers: { cookie: "a=1; sf_customer_session=v2.abc" } }), "v2.abc");
  assert.equal(await getStorefrontCustomerSession({ tenantId: 1, token: legacy }), null);
  assert.equal(await restoreStorefrontCustomerCart({ tenantId: 1, token: legacy, cartItems: [] }), null);
});

test("/customer/me reads loyalty with the database handle first", () => {
  const source = read("../server/services/storefrontCustomerSessionService.js");
  const me = between(source, "export const getStorefrontCustomerSession", "export const restoreStorefrontCustomerCart");
  assert.match(me, /getCustomerLoyaltySummary\(db, row\.customer_id, tenantId\)/);
});

const fakeRes = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("the rate limit counts one bucket per parsed tenant and IP, and forgets quiet buckets", () => {
  let clock = 1_000_000;
  const buckets = new Map();
  const limit = createStorefrontCustomerSessionRateLimit({
    tenantIdOf: (req) => Number(req.headers["x-tenant-id"]) || 1,
    maxAttempts: 3,
    windowMs: 60_000,
    now: () => clock,
    buckets,
  });
  const hit = (tenant, ip = "9.9.9.9") => {
    const res = fakeRes();
    let passed = false;
    limit({ ip, headers: { "x-tenant-id": tenant } }, res, () => {
      passed = true;
    });
    return passed ? 200 : res.statusCode;
  };
  assert.equal(hit("1"), 200);
  assert.equal(hit("01"), 200);
  assert.equal(hit("001"), 200);
  assert.equal(hit("0001"), 429, "leading zeros must not open a fresh bucket");
  assert.equal(hit("1", "8.8.8.8"), 200);
  assert.equal(buckets.size, 2);

  clock += 61_000;
  assert.equal(hit("2", "7.7.7.7"), 200);
  assert.deepEqual([...buckets.keys()], ["2:7.7.7.7"], "buckets idle for a whole window are swept");
});

test("the route passes the OTP phone, sets a cookie only with a token, and keys the limit on publicTenantId", () => {
  const route = read("../server/routes/storefront.js");
  const handler = between(route, 'router.post("/customer/session"', 'router.get("/customer/me"');
  assert.match(handler, /otpVerifiedPhone: readOtpVerifiedStorefrontPhone\(req\)/);
  assert.match(handler, /if \(payload\.token\) setStorefrontCustomerCookie\(res, payload\.token, req\);/);
  assert.match(route, /createStorefrontCustomerSessionRateLimit\(\{ tenantIdOf: \(req\) => publicTenantId\(req\) \}\)/);
  assert.doesNotMatch(route, /customerSessionBuckets/);
});
