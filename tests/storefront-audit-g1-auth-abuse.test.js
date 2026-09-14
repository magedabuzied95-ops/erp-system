import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import jwt from "jsonwebtoken";

// Storefront audit group 1 (auth, abuse, data exposure), 2026-09-15: customer tokens that
// outlived a password reset, unthrottled login/reset/register/checkout, /account echoing the
// password hash, coupon validation revealing customer ids, 7-character order-confirmation codes,
// forged Meta Purchase conversions, and schema DDL on every public request.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://none:none@127.0.0.1:1/none";
process.env.PG_CONNECTION_TIMEOUT_MS = process.env.PG_CONNECTION_TIMEOUT_MS || "100";
process.env.M1_META_CAPI_ACCESS_TOKEN = "test-token";
process.env.M1_META_DATASET_ID = "1234567890";

const { default: db } = await import("../server/database/db.js");
const {
  createRequestRateLimit,
  createSlidingWindowCounter,
  createSuccessRateLimit,
  rateLimitClientKey,
} = await import("../server/utils/requestRateLimit.js");
const { isStorefrontTokenRevoked, requireStorefrontCustomerAuth } = await import("../server/middleware/storefrontCustomerAuth.js");
const { isAllowedMetaRelayOrigin, loadVerifiedRelayPurchaseEvent } = await import("../server/services/metaConversionsApiService.js");
const { publicCouponValidation } = await import("../server/services/couponsService.js");
const { markCouponStaffCaller } = await import("../server/routes/coupons.js");
const { validate: validateCouponRoute } = await import("../server/controllers/couponsController.js");
const { pickStorefrontAccountFields, STOREFRONT_ACCOUNT_CUSTOMER_FIELDS, STOREFRONT_ACCOUNT_ORDER_FIELDS } = await import("../server/controllers/storefrontController.js");
const { generateOrderConfirmationCode } = await import("../server/services/whatsappOrderConfirmationService.js");
const { default: storefrontRouter } = await import("../server/routes/storefront.js");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to > from ? to : undefined);
};

// Every test swaps db.query for its own fake; the pool never connects.
const realQuery = db.query;
const useDb = (t, handler) => {
  db.query = async (sql, params = []) => handler(String(sql), params);
  t.after(() => {
    db.query = realQuery;
  });
};

const fakeRes = () => {
  const listeners = {};
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      listeners.finish?.forEach((listener) => listener());
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    on(event, listener) {
      (listeners[event] ||= []).push(listener);
      return this;
    },
  };
  return res;
};

// Runs a handler chain the way Express would, stopping at the first one that answers.
const runChain = async (handlers, req, res = fakeRes()) => {
  for (const handler of handlers) {
    let advanced = false;
    await handler(req, res, () => {
      advanced = true;
    });
    if (!advanced) return { res, reachedEnd: false };
  }
  return { res, reachedEnd: true };
};

const routeHandlers = (router, method, path) => {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} is missing`);
  return layer.route.stack.map((entry) => entry.handle);
};

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter += 1)}`;

// ---------------------------------------------------------------- rate limiter building blocks

test("the sliding window refuses once full and lets the key back in after the window", () => {
  let now = 1_000_000;
  const counter = createSlidingWindowCounter({ windowMs: 60_000, max: 2, now: () => now });
  assert.equal(counter.retryAfterSeconds("a"), 0);
  counter.hit("a");
  counter.hit("a");
  assert.equal(counter.retryAfterSeconds("a"), 60);
  assert.equal(counter.retryAfterSeconds("b"), 0, "one key filling up never blocks another");
  now += 60_001;
  assert.equal(counter.retryAfterSeconds("a"), 0);
});

test("a success-only limiter does not charge a request that failed validation", async () => {
  const counter = createSlidingWindowCounter({ windowMs: 60_000, max: 1 });
  const limit = createSuccessRateLimit({ counter, keysOf: () => ["k"] });
  const failed = fakeRes();
  await runChain([limit, (_req, res) => res.status(400).json({})], {}, failed);
  const placed = fakeRes();
  const first = await runChain([limit, (_req, res) => res.status(201).json({})], {}, placed);
  assert.equal(placed.statusCode, 201);
  assert.equal(first.reachedEnd, false);
  const blocked = await runChain([limit], {}, fakeRes());
  assert.equal(blocked.res.statusCode, 429);
});

test("rate limits key on the proxy-verified client address", (t) => {
  const previous = process.env.TRUST_CLOUDFLARE_PROXY;
  t.after(() => {
    if (previous === undefined) delete process.env.TRUST_CLOUDFLARE_PROXY;
    else process.env.TRUST_CLOUDFLARE_PROXY = previous;
  });
  process.env.TRUST_CLOUDFLARE_PROXY = "true";
  const proxy = "10.0.0.5";
  assert.equal(rateLimitClientKey({ ip: proxy, headers: { "cf-connecting-ip": "198.51.100.7" } }), "198.51.100.7");
  assert.equal(rateLimitClientKey({ ip: proxy, headers: { "cf-connecting-ip": "198.51.100.8" } }), "198.51.100.8");

  const coupons = read("../server/routes/coupons.js");
  const limiter = between(coupons, "const validateRateLimit", "};");
  assert.match(limiter, /const key = rateLimitClientKey\(req\);/);
  assert.doesNotMatch(limiter, /req\.ip/);
});

// ---------------------------------------------------------------- #44 token revocation

test("a customer token issued before the password changed, or for an inactive customer, is refused", () => {
  const issued = Math.floor(Date.parse("2026-09-01T10:00:00Z") / 1000);
  const decoded = { iat: issued };
  assert.equal(isStorefrontTokenRevoked({ decoded, customer: null }), false);
  assert.equal(isStorefrontTokenRevoked({ decoded, customer: { status: "active", password_changed_at: null } }), false);
  assert.equal(isStorefrontTokenRevoked({ decoded, customer: { status: "active", password_changed_at: "2026-09-02T10:00:00Z" } }), true);
  assert.equal(isStorefrontTokenRevoked({ decoded, customer: { status: "Inactive", password_changed_at: null } }), true);
  // The token handed out at the moment the password was set (iat in whole seconds) still works.
  assert.equal(isStorefrontTokenRevoked({ decoded, customer: { status: "active", password_changed_at: "2026-09-01T10:00:00.900Z" } }), false);
});

test("the middleware turns away a token that predates a password reset and keeps a fresh one", async (t) => {
  const changedAt = new Date(Date.now() - 60_000);
  const queries = [];
  useDb(t, (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("FROM customers")) {
      return { rows: [{ id: 9, name: "Owner", phone: "01012345678", email: "o@example.com", tenant_id: 1, status: "active", password_changed_at: changedAt }] };
    }
    return { rows: [] };
  });
  const secret = process.env.JWT_SECRET;
  const stale = jwt.sign({ type: "storefront_customer", tenant_id: 1, customer_id: 9, auth_method: "email_password", iat: Math.floor(changedAt.getTime() / 1000) - 3600 }, secret);
  const fresh = jwt.sign({ type: "storefront_customer", tenant_id: 1, customer_id: 9, auth_method: "email_password" }, secret);
  const staleOtp = jwt.sign({ type: "storefront_customer", tenant_id: 1, phone: "01012345678", iat: Math.floor(changedAt.getTime() / 1000) - 3600 }, secret);

  const run = (token) => runChain([requireStorefrontCustomerAuth], { headers: { authorization: `Bearer ${token}` } });
  const refused = await run(stale);
  assert.equal(refused.res.statusCode, 401);
  assert.equal(refused.reachedEnd, false);

  const refusedOtp = await run(staleOtp);
  assert.equal(refusedOtp.res.statusCode, 401, "an OTP token is checked against the customer on its phone");
  assert.ok(queries.some(({ sql, params }) => sql.includes("phone = ANY") && params[1].includes("01012345678")));

  const req = { headers: { authorization: `Bearer ${fresh}` } };
  const allowed = await runChain([requireStorefrontCustomerAuth], req);
  assert.equal(allowed.reachedEnd, true);
  assert.equal(req.storefrontCustomer.customer_id, 9);
});

// ---------------------------------------------------------------- #45 / #84 login, reset, register

test("login locks an email after repeated wrong passwords, without touching other addresses", async (t) => {
  useDb(t, () => ({ rows: [] })); // no customer: every attempt is INVALID_EMAIL_OR_PASSWORD
  const handlers = routeHandlers(storefrontRouter, "post", "/auth/login");
  const attempt = (email, ip) => runChain(handlers, { ip, headers: {}, body: { email, password: "wrong-password" } });

  for (let index = 0; index < 5; index += 1) {
    const { res } = await attempt("victim@example.com", freshIp());
    assert.equal(res.statusCode, 400, `attempt ${index + 1} is an ordinary failure`);
  }
  const locked = await attempt("victim@example.com", freshIp());
  assert.equal(locked.res.statusCode, 429, "a sixth guess from any address is refused");
  assert.match(locked.res.body.message, /محاولات كثيرة/);
  assert.ok(Number(locked.res.headers["Retry-After"]) > 0);

  const other = await attempt("someone-else@example.com", freshIp());
  assert.equal(other.res.statusCode, 400);
});

test("login, register, reset request and reset are each capped per client", async (t) => {
  useDb(t, () => ({ rows: [] }));
  const ip = freshIp();
  const login = routeHandlers(storefrontRouter, "post", "/auth/login");
  let last = null;
  for (let index = 0; index < 31; index += 1) {
    last = await runChain(login.slice(0, 1), { ip, headers: {}, body: { email: `user${index}@example.com` } });
  }
  assert.equal(last.res.statusCode, 429, "the 31st login from one address in 15 minutes is refused");

  const resetRequest = routeHandlers(storefrontRouter, "post", "/auth/request-reset");
  const limiters = resetRequest.slice(0, -1);
  assert.equal(limiters.length, 2);
  for (let index = 0; index < 3; index += 1) {
    const { reachedEnd } = await runChain(limiters, { ip: freshIp(), headers: {}, body: { email: "inbox@example.com" } });
    assert.equal(reachedEnd, true);
  }
  const flooded = await runChain(limiters, { ip: freshIp(), headers: {}, body: { email: "INBOX@example.com" } });
  assert.equal(flooded.res.statusCode, 429, "a fourth reset mail to one address within the hour is refused");

  assert.ok(routeHandlers(storefrontRouter, "post", "/auth/register").length >= 2, "register has a limiter");
  assert.ok(routeHandlers(storefrontRouter, "post", "/auth/reset-password").length >= 2, "reset-password has a limiter");
});

// ---------------------------------------------------------------- #32 checkout

test("checkout stops a client or a phone that keeps placing orders, not one that retries a form error", async () => {
  const handlers = routeHandlers(storefrontRouter, "post", "/checkout");
  assert.equal(handlers.length, 4, "request limit, upload, placed-order limit, controller");
  const [requestLimit, , placedLimit] = handlers;
  const ip = freshIp();
  const phone = "01099887766";
  const place = (status, requestIp = ip, requestPhone = phone) =>
    runChain([requestLimit, placedLimit, (_req, res) => res.status(status).json({ success: status < 300 })], {
      ip: requestIp,
      headers: {},
      body: { checkout: JSON.stringify({ primary_phone: requestPhone }) },
    });

  const invalid = await place(400);
  assert.equal(invalid.res.statusCode, 400);
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await place(201, freshIp())).res.statusCode, 201);
  }
  assert.equal((await place(201, freshIp())).res.statusCode, 429, "the same phone from a new address is refused after 5 orders");
  assert.equal((await place(201, freshIp(), "01011112222")).res.statusCode, 201);
});

// ---------------------------------------------------------------- #93 account projection

test("/storefront/account never returns the password hash or staff-only order fields", () => {
  const customer = pickStorefrontAccountFields(
    { id: 9, name: "Owner", phone: "010", email: "o@example.com", password_hash: "$2a$10$x", password_reset_token_hash: "abc", notes: "staff", ai_customer_profile: {} },
    STOREFRONT_ACCOUNT_CUSTOMER_FIELDS
  );
  assert.deepEqual(customer, { id: 9, name: "Owner", phone: "010", email: "o@example.com" });
  const order = pickStorefrontAccountFields(
    { id: 5, status: "confirmed", total_amount: 900, remaining_amount: 900, governorate: "Cairo", salesperson_commission_value: 40, cashier_id: 3, notes: "call first", public_token: "secret" },
    STOREFRONT_ACCOUNT_ORDER_FIELDS
  );
  assert.deepEqual(order, { id: 5, status: "confirmed", total_amount: 900, remaining_amount: 900, governorate: "Cairo" });

  const source = read("../server/controllers/storefrontController.js");
  const handler = between(source, "export const accountByPhone", "export const getStorefrontCustomerPreferences");
  assert.match(handler, /customer: pickStorefrontAccountFields\(customer\.rows\[0\], STOREFRONT_ACCOUNT_CUSTOMER_FIELDS\)/);
  assert.match(handler, /orders: orders\.rows\.map\(\(order\) => attachPublicOrderNumber\(pickStorefrontAccountFields\(order, STOREFRONT_ACCOUNT_ORDER_FIELDS\)\)\)/);
  assert.doesNotMatch(handler, /customer: customer\.rows\[0\] \|\| null/);
});

// ---------------------------------------------------------------- #95 coupon validation

test("public coupon validation ignores a body customer_id and echoes no coupon or campaign internals", async (t) => {
  const customerIdsSeen = [];
  useDb(t, (sql, params) => {
    if (sql.includes("FROM coupons cp")) {
      return {
        rows: [{
          id: 1, campaign_id: 2, code: "FIRST-ABC123", usage_count: 0, usage_limit: 100, assigned_customer_id: 42, is_active: true,
          campaign_name: "First order", discount_type: "fixed", discount_value: 50, minimum_order_amount: 0, campaign_is_active: true,
          channel: "all", scope: null, stack_policy: "all", budget_cap: 5000, first_order_only: true,
        }],
      };
    }
    if (sql.includes("FROM orders")) {
      customerIdsSeen.push(params[0]);
      return { rows: [{ id: 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const anonymous = { headers: {}, body: { code: "FIRST-ABC123", order_total: 500, customer_id: 42, source: "website" } };
  const anonymousRes = fakeRes();
  await runChain([markCouponStaffCaller, validateCouponRoute], anonymous, anonymousRes);
  assert.equal(anonymousRes.body.valid, true, "the first-order rule is not run against a caller-chosen id");
  assert.deepEqual(customerIdsSeen, []);
  assert.equal(anonymousRes.body.coupon.code, "FIRST-ABC123");
  assert.equal(anonymousRes.body.coupon.assigned_customer_id, undefined);
  assert.equal(anonymousRes.body.campaign, undefined);

  const staffToken = jwt.sign({ id: 5, tenant_id: 1 }, process.env.JWT_SECRET);
  const till = { headers: { authorization: `Bearer ${staffToken}` }, body: { code: "FIRST-ABC123", order_total: 500, customer_id: 42, source: "pos" } };
  const tillRes = fakeRes();
  await runChain([markCouponStaffCaller, validateCouponRoute], till, tillRes);
  assert.deepEqual(customerIdsSeen, [42], "the till's chosen customer still gets the per-customer rules");
  assert.equal(tillRes.body.valid, false);

  const shopperToken = jwt.sign({ type: "storefront_customer", customer_id: 42, phone: "010" }, process.env.JWT_SECRET);
  const shopper = { headers: { authorization: `Bearer ${shopperToken}` } };
  await runChain([markCouponStaffCaller], shopper);
  assert.equal(shopper.couponStaffCaller, false);

  assert.deepEqual(Object.keys(publicCouponValidation({ valid: false, reason: "x", coupon: { code: "C", assigned_customer_id: 1 }, campaign: { budget_cap: 1 } })).sort(),
    ["coupon", "discount_amount", "final_total", "free_shipping", "reason", "valid"]);
  const checkout = between(read("../server/controllers/storefrontController.js"), "export const createWebsiteOrder", "export const createPosOnlineOrder");
  assert.match(checkout, /coupon: publicCouponValidation\(couponValidation\)/);
});

// ---------------------------------------------------------------- #48 order confirmation codes

test("order-confirmation codes are 16 uniform alphanumerics and the public route is throttled", async () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateOrderConfirmationCode()));
  assert.equal(codes.size, 200);
  for (const code of codes) assert.match(code, /^[A-Za-z0-9]{16}$/);

  const { default: confirmationRouter } = await import("../server/routes/publicOrderConfirmation.js");
  for (const method of ["get", "post"]) {
    const handlers = routeHandlers(confirmationRouter, method, "/:code");
    assert.equal(handlers.length, 3, `${method} /:code runs two limiters before the handler`);
  }
  const [requestLimit, unknownLimit] = routeHandlers(confirmationRouter, "get", "/:code");
  const ip = freshIp();
  for (let index = 0; index < 10; index += 1) {
    const { res } = await runChain([requestLimit, unknownLimit, (_req, response) => response.status(404).json({})], { ip, headers: {} });
    assert.equal(res.statusCode, 404);
  }
  const blocked = await runChain([requestLimit, unknownLimit], { ip, headers: {} });
  assert.equal(blocked.res.statusCode, 429, "an address that keeps guessing unknown codes is stopped");
});

// ---------------------------------------------------------------- #75 / #83 / #108 Meta relay

const liveOrigin = { origin: "https://m1store-egy.com", "user-agent": "test-agent" };

test("the relay ignores events from localhost, previews and requests without a page", () => {
  assert.equal(isAllowedMetaRelayOrigin({ headers: liveOrigin }), true);
  assert.equal(isAllowedMetaRelayOrigin({ headers: { referer: "https://www.m1store-egy.com/products/1" } }), true);
  assert.equal(isAllowedMetaRelayOrigin({ headers: { origin: "http://localhost:5173" } }), false);
  assert.equal(isAllowedMetaRelayOrigin({ headers: { origin: "https://erp-system-ten-green.vercel.app" } }), false);
  assert.equal(isAllowedMetaRelayOrigin({ headers: {} }), false);

  const client = read("../src/storefront/lib/metaPixelEvents.js");
  const track = between(client, "const track = ", "export const trackMetaViewContent");
  const gate = track.indexOf("if (!trackable) return eventPayload;");
  assert.ok(gate > 0 && gate < track.indexOf("void sendCapi("), "the browser relay is host-gated like the Pixel");
  assert.doesNotMatch(read("../src/storefront/lib/ga4Events.js"), /localhost|127\.0\.0\.1/);
});

test("a relayed Purchase is sent only for a real order, with the order's own value and products", async (t) => {
  const sent = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ events_received: 1 }) };
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  useDb(t, (sql, params) => {
    if (sql.includes("FROM orders")) {
      return String(params[0]) === "812"
        ? { rows: [{ id: 812, tenant_id: 1, source: "website", status: "pending_confirmation", total_amount: 1600, customer_phone: "01012345678", customer_name: "Real Buyer" }] }
        : { rows: [] };
    }
    if (sql.includes("FROM order_items")) {
      return { rows: [{ id: 1, product_id: 22, variant_id: 31, quantity: 2, price: 800, variant_sku: "SKU-22-31" }] };
    }
    return { rows: [] };
  });

  const handlers = routeHandlers(storefrontRouter, "post", "/meta/events");
  const relay = (body, headers = liveOrigin) => runChain(handlers, { ip: freshIp(), headers, body });

  const forged = await relay({ event_name: "Purchase", event_id: "m1_purchase_order_999999", content_ids: ["A"], value: 999999 });
  assert.equal(forged.res.statusCode, 202);
  assert.equal(forged.res.body.capi_sent, false);
  assert.equal(forged.res.body.reason, "purchase_not_verified");

  const random = await relay({ event_name: "Purchase", event_id: "xyz", content_ids: ["A"], value: 10 });
  assert.equal(random.res.body.reason, "purchase_not_verified");
  assert.equal(sent.length, 0, "nothing unverified reaches Meta");

  const inflated = await relay({ event_name: "Purchase", event_id: "m1_purchase_order_812", content_ids: ["FAKE"], value: 999999, fbp: "fb.1.2.3" });
  assert.equal(inflated.res.body.capi_sent, true);
  assert.equal(sent.length, 1);
  const [event] = sent[0].data;
  assert.equal(event.custom_data.value, 1600, "the value comes from the order row");
  assert.deepEqual(event.custom_data.content_ids, ["SKU-22-31"]);
  assert.equal(event.event_id, "m1_purchase_order_812");
  assert.equal(event.user_data.fbp, "fb.1.2.3");

  const local = await relay({ event_name: "ViewContent", event_id: "v1", content_ids: ["A"] }, { origin: "http://localhost:5173" });
  assert.equal(local.res.body.reason, "origin_not_tracked");
  assert.equal(sent.length, 1);

  assert.equal(await loadVerifiedRelayPurchaseEvent({ tenantId: 1, eventId: "m1_purchase_order_812 OR 1=1" }), null);
  assert.equal(handlers.length, 3, "the relay runs its own rate limit first");
});

test("a relayed Purchase for a cancelled order or a till-raised order is not sent", async () => {
  const orderClient = (order) => ({
    query: async (sql) => {
      if (sql.includes("FROM orders")) return { rows: [order] };
      if (sql.includes("FROM order_items")) return { rows: [{ id: 1, product_id: 22, variant_id: 31, quantity: 1, price: 500, sku: "SKU-1" }] };
      return { rows: [] };
    },
  });
  const base = { id: 900, tenant_id: 1, source: "website", status: "pending_confirmation", total_amount: 500 };
  const eventId = "m1_purchase_order_900";
  assert.equal((await loadVerifiedRelayPurchaseEvent({ tenantId: 1, eventId, client: orderClient(base) }))?.value, 500);
  assert.equal(await loadVerifiedRelayPurchaseEvent({ tenantId: 1, eventId, client: orderClient({ ...base, status: "cancelled" }) }), null);
  assert.equal(await loadVerifiedRelayPurchaseEvent({ tenantId: 1, eventId, client: orderClient({ ...base, origin_surface: "pos" }) }), null);
  assert.equal(await loadVerifiedRelayPurchaseEvent({ tenantId: 1, eventId, client: orderClient({ ...base, source: "pos" }) }), null);
});

// ---------------------------------------------------------------- #86 request-path DDL

test("the customer session, email-auth and OTP schema ensures run their DDL once per process", async () => {
  const { ensureStorefrontCustomerSessionSchema } = await import("../server/services/storefrontCustomerSessionService.js");
  const calls = [];
  const spy = { query: async (sql) => { calls.push(String(sql)); return { rows: [] }; } };
  await ensureStorefrontCustomerSessionSchema(spy);
  const initial = calls.length;
  assert.ok(initial > 0);
  await Promise.all(Array.from({ length: 10 }, () => ensureStorefrontCustomerSessionSchema(spy)));
  assert.equal(calls.length, initial, "no DDL after the first successful run");

  for (const [file, name] of [
    ["../server/services/storefrontCustomerEmailAuthService.js", "ensureCustomerEmailAuthSchema"],
    ["../server/services/customerOtpAuthService.js", "ensureCustomerOtpAuthSchema"],
  ]) {
    const body = between(read(file), `const ${name} = async () => {`, "};");
    assert.match(body, /if \(\w+SchemaReady\) return;/, `${name} is memoised`);
  }
});
