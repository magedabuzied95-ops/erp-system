import assert from "node:assert/strict";
import test from "node:test";

import { createAmazonLwaClient } from "../../server/modules/amazon/amazonLwaClient.js";
import { createAmazonSpApiClient } from "../../server/modules/amazon/amazonSpApiClient.js";
import { createAmazonRateLimiter } from "../../server/modules/amazon/amazonRateLimiter.js";
import { AMAZON_ERROR_CATEGORY, redactAmazonText, toSafeError } from "../../server/modules/amazon/amazonErrors.js";
import { amazonEndpoint, amazonFlags, amazonProductUrl } from "../../server/modules/amazon/amazonConfig.js";

const REFRESH = "Atzr|IwEBIFAKE-refresh-token-value-0123456789";
const SECRET = "amzn1.oa2-cs.v1.fakesecretvalue0123456789abcdef";
const CLIENT_ID = "amzn1.application-oa2-client.0123456789abcdef";
const ACCESS = "Atza|IwEBIFAKE-access-token-value-9876543210";

const credentials = () => ({ refreshToken: REFRESH, clientId: CLIENT_ID, clientSecret: SECRET });

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  json: async () => body,
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

const makeClock = (start = Date.UTC(2026, 8, 17, 10, 0, 0)) => {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; }, set: (value) => { current = value; } };
};

const lwaFetch = (calls, { expiresIn = 3600, status = 200, body } = {}) => async (url, init) => {
  calls.push({ url, init });
  return jsonResponse(status, body ?? { access_token: `${ACCESS}-${calls.length}`, token_type: "bearer", expires_in: expiresIn });
};

// ---------------------------------------------------------------- LWA
test("LWA: exchanges the refresh token once and caches the access token", async () => {
  const calls = [];
  const clock = makeClock();
  const lwa = createAmazonLwaClient({ fetchImpl: lwaFetch(calls), now: clock.now, credentials, tokenUrl: () => "https://api.amazon.com/auth/o2/token" });
  const [a, b] = await Promise.all([lwa.getAccessToken(), lwa.getAccessToken()]);
  assert.equal(a, b);
  assert.equal(calls.length, 1, "concurrent callers share one refresh");
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), REFRESH);
  assert.equal(calls[0].url, "https://api.amazon.com/auth/o2/token");
  clock.advance(30 * 60 * 1000);
  await lwa.getAccessToken();
  assert.equal(calls.length, 1, "still valid after 30 minutes");
  const status = lwa.status();
  assert.equal(JSON.stringify(status).includes("Atza|"), false, "status never exposes the token");
});

test("LWA: refreshes 5 minutes before expiry and after invalidate()", async () => {
  const calls = [];
  const clock = makeClock();
  const lwa = createAmazonLwaClient({ fetchImpl: lwaFetch(calls), now: clock.now, credentials });
  const first = await lwa.getAccessToken();
  clock.advance(56 * 60 * 1000);
  const second = await lwa.getAccessToken();
  assert.notEqual(first, second);
  assert.equal(calls.length, 2);
  lwa.invalidate();
  await lwa.getAccessToken();
  assert.equal(calls.length, 3);
});

test("LWA: a refused refresh token becomes an authentication error with no secret in it", async () => {
  const lwa = createAmazonLwaClient({
    fetchImpl: async () => jsonResponse(400, { error: "invalid_grant", error_description: `bad token ${REFRESH} ${SECRET}` }),
    credentials,
  });
  await assert.rejects(lwa.getAccessToken(), (error) => {
    assert.equal(error.category, AMAZON_ERROR_CATEGORY.AUTHENTICATION);
    const serialized = JSON.stringify(toSafeError(error)) + error.message;
    assert.equal(serialized.includes(REFRESH), false);
    assert.equal(serialized.includes(SECRET), false);
    assert.match(error.message, /invalid_grant/);
    return true;
  });
});

test("LWA: missing credentials fail as not_configured without a network call", async () => {
  let called = false;
  const lwa = createAmazonLwaClient({ fetchImpl: async () => { called = true; }, credentials: () => ({ refreshToken: "", clientId: CLIENT_ID, clientSecret: "" }) });
  await assert.rejects(lwa.getAccessToken(), (error) => error.category === AMAZON_ERROR_CATEGORY.NOT_CONFIGURED);
  assert.equal(called, false);
});

// ---------------------------------------------------------------- SP-API client
const staticLwa = () => {
  let invalidations = 0;
  return {
    getAccessToken: async () => ACCESS,
    invalidate: () => { invalidations += 1; },
    status: () => ({}),
    get invalidations() { return invalidations; },
  };
};
const noWaitLimiter = () => ({ acquire: async () => {}, drain: () => {}, snapshot: () => ({}) });

const makeClient = (responses, extra = {}) => {
  const calls = [];
  const sleeps = [];
  const queue = [...responses];
  const lwa = extra.lwa || staticLwa();
  const client = createAmazonSpApiClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (typeof next === "function") return next(url, init);
      return next;
    },
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
    lwa,
    limiter: extra.limiter || noWaitLimiter(),
    endpoint: () => "https://sellingpartnerapi-eu.amazon.com",
    timeoutMs: extra.timeoutMs,
  });
  return { client, calls, sleeps, lwa };
};

test("SP-API: sends the access token only in x-amz-access-token over HTTPS", async () => {
  const { client, calls } = makeClient([jsonResponse(200, { payload: [] })]);
  await client.request({ operation: "getMarketplaceParticipations", path: "/sellers/v1/marketplaceParticipations", query: { marketplaceIds: ["ARBP9OOSHTCHU"] } });
  assert.match(calls[0].url, /^https:\/\/sellingpartnerapi-eu\.amazon\.com\/sellers\/v1\/marketplaceParticipations\?marketplaceIds=ARBP9OOSHTCHU$/);
  assert.equal(calls[0].init.headers["x-amz-access-token"], ACCESS);
  assert.equal(calls[0].url.includes(ACCESS), false);
  assert.ok(calls[0].init.headers["user-agent"].startsWith("M1ERP/"));
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test("SP-API: 429 backs off and retries, honouring Retry-After", async () => {
  const { client, calls, sleeps } = makeClient([
    jsonResponse(429, { errors: [{ code: "QuotaExceeded", message: "You exceeded your quota" }] }, { "retry-after": "7" }),
    jsonResponse(429, { errors: [{ code: "QuotaExceeded", message: "again" }] }),
    jsonResponse(200, { orders: [] }),
  ]);
  const payload = await client.request({ operation: "searchOrders", path: "/orders/2026-01-01/orders" });
  assert.deepEqual(payload, { orders: [] });
  assert.equal(calls.length, 3);
  assert.ok(sleeps[0] >= 7000, "Retry-After respected");
  assert.ok(sleeps[1] >= 1000 && sleeps[1] <= 4000, "exponential backoff with jitter");
});

test("SP-API: persistent 429 surfaces a rate_limited error after bounded retries", async () => {
  const responses = Array.from({ length: 10 }, () => jsonResponse(429, { errors: [{ code: "QuotaExceeded", message: "slow down" }] }));
  const { client, calls, sleeps } = makeClient(responses);
  await assert.rejects(client.request({ operation: "searchOrders", path: "/orders/2026-01-01/orders" }), (error) => {
    assert.equal(error.category, AMAZON_ERROR_CATEGORY.RATE_LIMITED);
    assert.equal(error.status, 429);
    return true;
  });
  assert.equal(calls.length, 6);
  assert.ok(sleeps.every((ms) => ms <= 120_000));
  assert.ok(sleeps[4] > sleeps[0], "backoff grows");
});

test("SP-API: network timeouts are retried then reported as network errors", async () => {
  const timeout = async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; };
  const { client, calls } = makeClient([timeout, timeout, timeout]);
  await assert.rejects(client.request({ operation: "getOrder", path: "/orders/2026-01-01/orders/1" }), (error) => {
    assert.equal(error.category, AMAZON_ERROR_CATEGORY.NETWORK);
    assert.match(error.message, /timed out/);
    return true;
  });
  assert.equal(calls.length, 3);
});

test("SP-API: a real timeout aborts the request", async () => {
  const { client } = makeClient([
    (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); })),
    (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); })),
    (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); })),
  ], { timeoutMs: 20 });
  await assert.rejects(client.request({ operation: "getOrder", path: "/x" }), (error) => error.category === AMAZON_ERROR_CATEGORY.NETWORK);
});

test("SP-API: 401 refreshes the token once; 403 is not retried", async () => {
  const unauthorized = makeClient([jsonResponse(401, { errors: [{ code: "Unauthorized", message: "expired" }] }), jsonResponse(200, { ok: 1 })]);
  assert.deepEqual(await unauthorized.client.request({ operation: "getOrder", path: "/x" }), { ok: 1 });
  assert.equal(unauthorized.lwa.invalidations, 1);

  const forbidden = makeClient([jsonResponse(403, { errors: [{ code: "Unauthorized", message: "Access to requested resource is denied." }] })]);
  await assert.rejects(forbidden.client.request({ operation: "getOrder", path: "/x" }), (error) => {
    assert.equal(error.category, AMAZON_ERROR_CATEGORY.AUTHORIZATION);
    assert.equal(error.code, "Unauthorized");
    return true;
  });
  assert.equal(forbidden.calls.length, 1);
});

test("SP-API: 5xx is retried; 400 is not", async () => {
  const flaky = makeClient([jsonResponse(503, {}), jsonResponse(200, { fine: true })]);
  assert.deepEqual(await flaky.client.request({ operation: "getReport", path: "/x" }), { fine: true });
  const bad = makeClient([jsonResponse(400, { errors: [{ code: "InvalidInput", message: "bad marketplace" }] })]);
  await assert.rejects(bad.client.request({ operation: "getReport", path: "/x" }), (error) => error.category === AMAZON_ERROR_CATEGORY.INVALID_REQUEST);
  assert.equal(bad.calls.length, 1);
});

test("SP-API: error text from Amazon is redacted before it is stored", async () => {
  const { client } = makeClient([jsonResponse(400, { errors: [{ code: "InvalidInput", message: `token ${ACCESS} secret ${SECRET}` }] })]);
  await assert.rejects(client.request({ operation: "getReport", path: "/x" }), (error) => {
    const all = `${error.message} ${JSON.stringify(client.status())}`;
    assert.equal(all.includes("Atza|"), false);
    assert.equal(all.includes(SECRET), false);
    return true;
  });
});

test("SP-API: report documents are downloaded without Amazon auth headers and gunzipped", async () => {
  const { gzipSync } = await import("node:zlib");
  const content = "seller-sku\tasin1\nABC\tB000000001\n";
  const { client, calls } = makeClient([{
    ok: true,
    status: 200,
    headers: { get: (name) => (name === "content-type" ? "text/tab-separated-values; charset=UTF-8" : null) },
    arrayBuffer: async () => gzipSync(Buffer.from(content)),
  }]);
  const text = await client.downloadReportDocument({ url: "https://tortuga-prod-eu.s3.amazonaws.com/doc?X-Amz-Signature=abc", compressionAlgorithm: "GZIP" });
  assert.equal(text, content);
  assert.equal(calls[0].init.headers["x-amz-access-token"], undefined);
  await assert.rejects(client.downloadReportDocument({ url: "http://insecure.example/doc" }));
});

// ---------------------------------------------------------------- rate limiter
test("rate limiter: allows the burst then waits for the published rate", async () => {
  const clock = makeClock();
  const sleeps = [];
  const limiter = createAmazonRateLimiter({
    now: clock.now,
    sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
    limits: { searchOrders: { rate: 0.0056, burst: 20 }, default: { rate: 1, burst: 1 } },
  });
  for (let i = 0; i < 20; i += 1) await limiter.acquire("searchOrders");
  assert.equal(sleeps.length, 0);
  await limiter.acquire("searchOrders");
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 178_000 && sleeps[0] <= 179_000, `waited ${sleeps[0]}`);
  limiter.drain("default");
  await limiter.acquire("default");
  assert.ok(sleeps[1] >= 999);
});

test("rate limiter: refuses waits longer than the cap", async () => {
  const limiter = createAmazonRateLimiter({ limits: { slow: { rate: 0.0001, burst: 1 }, default: { rate: 1, burst: 1 } }, maxWaitMs: 1000, sleep: async () => {} });
  await limiter.acquire("slow");
  await assert.rejects(limiter.acquire("slow"), /local rate limit/);
});

// ---------------------------------------------------------------- config & redaction
test("config: HTTPS-only endpoint, Amazon.eg defaults, write/auto-sync/projection flags default OFF", () => {
  const saved = { ...process.env };
  try {
    delete process.env.AMAZON_WRITE_SYNC_ENABLED;
    delete process.env.AMAZON_ORDER_AUTO_SYNC_ENABLED;
    delete process.env.AMAZON_ORDER_PROJECTION_ENABLED;
    delete process.env.AMAZON_SPAPI_ENDPOINT;
    assert.equal(amazonEndpoint(), "https://sellingpartnerapi-eu.amazon.com");
    const flags = amazonFlags();
    assert.equal(flags.writeSync, false);
    assert.equal(flags.orderAutoSync, false);
    assert.equal(flags.orderProjection, false);
    process.env.AMAZON_SPAPI_ENDPOINT = "http://sellingpartnerapi-eu.amazon.com";
    assert.throws(() => amazonEndpoint(), /HTTPS/);
    assert.equal(amazonProductUrl("B0ABCDEF12"), "https://www.amazon.eg/dp/B0ABCDEF12");
    assert.equal(amazonProductUrl("x"), null);
  } finally {
    process.env = saved;
  }
});

test("redaction: tokens, secrets, client ids, auth headers and signed URLs never survive", () => {
  const dirty = `x-amz-access-token: ${ACCESS} refresh=${REFRESH} ${SECRET} ${CLIENT_ID} https://s3.amazonaws.com/doc?X-Amz-Signature=deadbeef&X-Amz-Credential=abc client_secret=shh`;
  const clean = redactAmazonText(dirty, 5000);
  for (const needle of [ACCESS, REFRESH, SECRET, CLIENT_ID, "deadbeef", "shh"]) {
    assert.equal(clean.includes(needle), false, `leaked ${needle}`);
  }
});
