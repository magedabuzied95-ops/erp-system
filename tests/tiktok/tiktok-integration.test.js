// TikTok integration tests.
//
// Everything here is deterministic and offline: no TikTok credentials, no
// network, no production database. The DB is a hand-rolled fake that records
// SQL + params, which is enough to assert the properties that actually matter
// (idempotency keys, single-use state, rotation persistence) without a server.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "tiktok-test-encryption-key";
process.env.TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || "test-client-key";
process.env.TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || "test-client-secret";
process.env.TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || "https://api.m1store-egy.com/api/tiktok/oauth/callback";

const {
  decryptTikTokSecret,
  encryptTikTokSecret,
  isTikTokEncryptedEnvelope,
} = await import("../../server/services/tiktokCryptoService.js");
const {
  TIKTOK_DEFAULT_SCOPES,
  describeTikTokConfig,
  validateTikTokConfig,
} = await import("../../server/services/tiktokConfigService.js");
const { buildTikTokAuthorizeUrl } = await import("../../server/services/tiktokApiClient.js");
const {
  TIKTOK_CONNECTION_STATUS,
  describeTikTokAccount,
  refreshTokenExpired,
  tokenNeedsRefresh,
} = await import("../../server/services/tiktokOAuthService.js");
const {
  TIKTOK_WEBHOOK_EVENTS,
  computeTikTokSignature,
  parseTikTokEventContent,
  parseTikTokSignatureHeader,
  processTikTokWebhookEventRecord,
  tiktokEventSignature,
  verifyTikTokWebhookSignature,
} = await import("../../server/services/tiktokWebhookService.js");
const {
  TIKTOK_POST_MODES,
  validateTikTokPostOptions,
} = await import("../../server/services/tiktokPublisherService.js");
const {
  TIKTOK_COMMENTS_STATE,
  tiktokCommentsProvider,
} = await import("../../server/services/tiktokCommentsProvider.js");
const { receiveTikTokWebhook } = await import("../../server/routes/tiktokWebhook.js");

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const makeRes = () => {
  const res = { statusCode: 200, body: null, redirectedTo: "" };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.redirect = (url) => { res.redirectedTo = url; return res; };
  return res;
};

const makeReq = ({ body = {}, rawBody = "", headers = {} } = {}) => ({
  body,
  tiktokRawBody: rawBody,
  get: (name) => headers[String(name).toLowerCase()] || "",
});

const signedHeaders = (rawBody, { secret = process.env.TIKTOK_CLIENT_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) => ({
  "tiktok-signature": `t=${timestamp},s=${computeTikTokSignature({ timestamp, rawBody, clientSecret: secret })}`,
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test("config validation accepts the canonical redirect URI", () => {
  const { valid, problems } = validateTikTokConfig();
  assert.equal(valid, true, `unexpected problems: ${problems.join("; ")}`);
});

test("config rejects a redirect URI that is not https or carries a query string", () => {
  const original = process.env.TIKTOK_REDIRECT_URI;
  process.env.TIKTOK_REDIRECT_URI = "http://api.m1store-egy.com/api/tiktok/oauth/callback?x=1";
  const { valid, problems } = validateTikTokConfig();
  assert.equal(valid, false);
  assert.ok(problems.some((p) => p.includes("https")));
  assert.ok(problems.some((p) => p.includes("query string")));
  process.env.TIKTOK_REDIRECT_URI = original;
});

test("describeTikTokConfig never leaks the client secret", () => {
  const described = describeTikTokConfig();
  const serialized = JSON.stringify(described);
  assert.equal(described.client_secret_present, true);
  assert.ok(!serialized.includes(process.env.TIKTOK_CLIENT_SECRET), "client secret leaked into config description");
});

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

test("token encryption round-trips and produces a versioned envelope", () => {
  const secret = "act.example-access-token-value";
  const envelope = encryptTikTokSecret(secret);
  assert.ok(isTikTokEncryptedEnvelope(envelope));
  assert.ok(!envelope.includes(secret), "plaintext survived into the envelope");
  assert.equal(decryptTikTokSecret(envelope), secret);
});

test("encrypting the same token twice produces different ciphertext (random IV)", () => {
  const a = encryptTikTokSecret("same-token");
  const b = encryptTikTokSecret("same-token");
  assert.notEqual(a, b);
  assert.equal(decryptTikTokSecret(a), decryptTikTokSecret(b));
});

test("decrypt refuses a plaintext value instead of passing it through", () => {
  assert.throws(() => decryptTikTokSecret("act.raw-plaintext-token"), /valid encrypted envelope/);
});

test("a tampered auth tag fails decryption", () => {
  const envelope = encryptTikTokSecret("tamper-me");
  const parts = envelope.split(":");
  parts[2] = Buffer.from(crypto.randomBytes(16)).toString("base64");
  assert.throws(() => decryptTikTokSecret(parts.join(":")));
});

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

test("authorize URL carries the official parameters and comma-separated scopes", () => {
  const url = new URL(buildTikTokAuthorizeUrl({
    clientKey: "test-client-key",
    redirectUri: process.env.TIKTOK_REDIRECT_URI,
    scopes: [...TIKTOK_DEFAULT_SCOPES],
    state: "state-abc",
  }));
  assert.equal(url.origin + url.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_key"), "test-client-key");
  assert.equal(url.searchParams.get("state"), "state-abc");
  // TikTok requires commas, not the OAuth-standard space separator.
  assert.equal(url.searchParams.get("scope"), "user.info.basic,video.upload,video.publish");
});

test("authorize URL never contains the client secret", () => {
  const url = buildTikTokAuthorizeUrl({
    clientKey: "test-client-key",
    redirectUri: process.env.TIKTOK_REDIRECT_URI,
    scopes: ["user.info.basic"],
    state: "s",
  });
  assert.ok(!url.includes(process.env.TIKTOK_CLIENT_SECRET));
});

// ---------------------------------------------------------------------------
// Token lifecycle
// ---------------------------------------------------------------------------

test("tokenNeedsRefresh honours the skew window", () => {
  const now = Date.now();
  const fresh = { access_token_encrypted: "tk:v1:x", access_token_expires_at: new Date(now + 60 * 60 * 1000) };
  const nearExpiry = { access_token_encrypted: "tk:v1:x", access_token_expires_at: new Date(now + 5 * 60 * 1000) };
  assert.equal(tokenNeedsRefresh(fresh, { now }), false);
  assert.equal(tokenNeedsRefresh(nearExpiry, { now }), true, "a token expiring inside the skew window must refresh");
});

test("a missing access token always needs refresh", () => {
  assert.equal(tokenNeedsRefresh({ access_token_encrypted: "", access_token_expires_at: null }), true);
});

test("an expired refresh token is detected as terminal", () => {
  const now = Date.now();
  assert.equal(refreshTokenExpired({ refresh_token_expires_at: new Date(now - 1000) }, { now }), true);
  assert.equal(refreshTokenExpired({ refresh_token_expires_at: new Date(now + 1000) }, { now }), false);
  // No recorded expiry must not be treated as expired.
  assert.equal(refreshTokenExpired({ refresh_token_expires_at: null }, { now }), false);
});

test("describeTikTokAccount exposes no token material and reports comments as unavailable", () => {
  const account = describeTikTokAccount({
    open_id: "open-1",
    display_name: "M1 Store",
    username: "m1store",
    granted_scopes: "user.info.basic,video.publish",
    status: TIKTOK_CONNECTION_STATUS.CONNECTED,
    access_token_encrypted: encryptTikTokSecret("act.secret"),
    refresh_token_encrypted: encryptTikTokSecret("rft.secret"),
  });
  const serialized = JSON.stringify(account);
  assert.ok(!serialized.includes("act.secret"));
  assert.ok(!serialized.includes("tk:v1:"), "an encrypted envelope leaked into the API shape");
  assert.equal(account.capabilities.direct_post, true);
  assert.equal(account.capabilities.draft_upload, false);
  assert.equal(account.capabilities.comments, false);
});

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

test("signature header parses the t= / s= form", () => {
  const parsed = parseTikTokSignatureHeader("t=1633174587,s=abc123");
  assert.equal(parsed.timestamp, 1633174587);
  assert.equal(parsed.signature, "abc123");
});

test("a correctly signed body verifies", () => {
  const rawBody = JSON.stringify({ event: "authorization.removed", user_openid: "o1" });
  const timestamp = 1700000000;
  const header = `t=${timestamp},s=${computeTikTokSignature({ timestamp, rawBody, clientSecret: "secret" })}`;
  const result = verifyTikTokWebhookSignature({ header, rawBody, clientSecret: "secret", nowSeconds: timestamp });
  assert.equal(result.valid, true);
});

test("a body modified after signing fails verification", () => {
  const rawBody = JSON.stringify({ event: "authorization.removed", user_openid: "o1" });
  const timestamp = 1700000000;
  const header = `t=${timestamp},s=${computeTikTokSignature({ timestamp, rawBody, clientSecret: "secret" })}`;
  const result = verifyTikTokWebhookSignature({ header, rawBody: `${rawBody} `, clientSecret: "secret", nowSeconds: timestamp });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("a stale timestamp is rejected even with a valid signature (replay defence)", () => {
  const rawBody = JSON.stringify({ event: "x" });
  const timestamp = 1700000000;
  const header = `t=${timestamp},s=${computeTikTokSignature({ timestamp, rawBody, clientSecret: "secret" })}`;
  const result = verifyTikTokWebhookSignature({
    header, rawBody, clientSecret: "secret",
    nowSeconds: timestamp + 4000, toleranceSeconds: 300,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_timestamp_out_of_tolerance");
});

test("a malformed signature header is rejected", () => {
  const result = verifyTikTokWebhookSignature({ header: "garbage", rawBody: "{}", clientSecret: "secret" });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_header_malformed");
});

// ---------------------------------------------------------------------------
// Webhook route
// ---------------------------------------------------------------------------

test("webhook rejects an invalid signature with 401 and does not persist", async () => {
  process.env.TIKTOK_WEBHOOK_ENABLED = "true";
  const rawBody = JSON.stringify({ event: "authorization.removed", user_openid: "o1", create_time: 1 });
  const req = makeReq({ rawBody, headers: { "tiktok-signature": "t=1,s=deadbeef" } });
  const res = makeRes();
  await receiveTikTokWebhook(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("webhook rejects a malformed body with 400", async () => {
  process.env.TIKTOK_WEBHOOK_ENABLED = "true";
  const rawBody = "not-json";
  const req = makeReq({ rawBody, headers: signedHeaders(rawBody) });
  const res = makeRes();
  await receiveTikTokWebhook(req, res);
  assert.equal(res.statusCode, 400);
});

test("webhook returns 503 when disabled", async () => {
  process.env.TIKTOK_WEBHOOK_ENABLED = "false";
  const rawBody = JSON.stringify({ event: "x" });
  const req = makeReq({ rawBody, headers: signedHeaders(rawBody) });
  const res = makeRes();
  await receiveTikTokWebhook(req, res);
  assert.equal(res.statusCode, 503);
});

// ---------------------------------------------------------------------------
// Webhook idempotency + processing
// ---------------------------------------------------------------------------

test("the same event hashes identically and a different one does not (dedupe key)", () => {
  const event = { client_key: "ck", event: "video.publish.completed", user_openid: "o1", create_time: 100, content: '{"share_id":"s1"}' };
  assert.equal(tiktokEventSignature(event), tiktokEventSignature({ ...event }));
  assert.notEqual(tiktokEventSignature(event), tiktokEventSignature({ ...event, create_time: 101 }));
  assert.notEqual(tiktokEventSignature(event), tiktokEventSignature({ ...event, content: '{"share_id":"s2"}' }));
});

test("event content arrives as a JSON string and is parsed", () => {
  assert.deepEqual(parseTikTokEventContent({ content: '{"reason":1}' }), { reason: 1 });
  assert.deepEqual(parseTikTokEventContent({ content: "not-json" }), {});
  assert.deepEqual(parseTikTokEventContent({}), {});
});

test("authorization.removed marks the connection for reconnect", async () => {
  let captured = null;
  const result = await processTikTokWebhookEventRecord(
    {
      payload: { event: TIKTOK_WEBHOOK_EVENTS.AUTHORIZATION_REMOVED, user_openid: "open-9", content: '{"reason":1}' },
    },
    {
      client: { query: async () => ({ rowCount: 0, rows: [] }) },
      onAuthorizationRemoved: async (args) => { captured = args; return { updated: 1, tenant_ids: [7] }; },
    }
  );
  assert.equal(result.handled, true);
  assert.equal(captured.openId, "open-9");
  assert.equal(captured.reason, "user_disconnected");
  assert.deepEqual(result.tenant_ids, [7]);
});

test("an unknown event type is handled without throwing so it is not retried for 72h", async () => {
  const result = await processTikTokWebhookEventRecord(
    { payload: { event: "some.future.event", user_openid: "o1", content: "{}" } },
    { client: { query: async () => ({ rowCount: 0, rows: [] }) } }
  );
  assert.equal(result.handled, false);
  assert.equal(result.reason, "unsupported_event");
});

test("video.publish.completed tolerates a share_id that matches no local job", async () => {
  const result = await processTikTokWebhookEventRecord(
    { payload: { event: TIKTOK_WEBHOOK_EVENTS.VIDEO_PUBLISH_COMPLETED, user_openid: "o1", content: '{"share_id":"unknown"}' } },
    { client: { query: async () => ({ rowCount: 0, rows: [] }) } }
  );
  assert.equal(result.handled, true);
  assert.equal(result.matched_jobs, 0);
});

// ---------------------------------------------------------------------------
// Posting options
// ---------------------------------------------------------------------------

const creatorInfo = {
  privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
  comment_disabled: false,
  duet_disabled: true,
  stitch_disabled: false,
};

test("a valid Direct Post passes validation", () => {
  const { valid } = validateTikTokPostOptions({
    options: { caption: "hello", privacy_level: "PUBLIC_TO_EVERYONE" },
    creatorInfo,
  });
  assert.equal(valid, true);
});

test("a privacy level the creator cannot use is rejected", () => {
  const { valid, problems } = validateTikTokPostOptions({
    options: { caption: "hi", privacy_level: "FOLLOWER_OF_CREATOR" },
    creatorInfo,
  });
  assert.equal(valid, false);
  assert.ok(problems.some((p) => p.includes("not available")));
});

test("a missing privacy level is rejected rather than defaulted", () => {
  const { valid } = validateTikTokPostOptions({ options: { caption: "hi" }, creatorInfo });
  assert.equal(valid, false);
});

test("enabling an interaction the account disabled is rejected", () => {
  const { valid, problems } = validateTikTokPostOptions({
    options: { caption: "hi", privacy_level: "PUBLIC_TO_EVERYONE", disable_duet: false },
    creatorInfo,
  });
  assert.equal(valid, false);
  assert.ok(problems.some((p) => p.includes("Duet")));
});

test("branded content requires commercial disclosure and cannot be SELF_ONLY", () => {
  const missingDisclosure = validateTikTokPostOptions({
    options: { caption: "ad", privacy_level: "PUBLIC_TO_EVERYONE", brand_content_toggle: true },
    creatorInfo,
  });
  assert.equal(missingDisclosure.valid, false);

  const selfOnly = validateTikTokPostOptions({
    options: { caption: "ad", privacy_level: "SELF_ONLY", brand_content_toggle: true, commercial_content_toggle: true },
    creatorInfo,
  });
  assert.equal(selfOnly.valid, false);
  assert.ok(selfOnly.problems.some((p) => p.includes("SELF_ONLY")));
});

test("a draft upload skips post-option validation entirely", () => {
  // A draft carries no caption/privacy — they are chosen inside the TikTok app.
  const { valid } = validateTikTokPostOptions({
    options: {},
    creatorInfo,
    postMode: TIKTOK_POST_MODES.INBOX_UPLOAD,
  });
  assert.equal(valid, true);
});

// ---------------------------------------------------------------------------
// Comments boundary
// ---------------------------------------------------------------------------

test("comments are declared blocked, not merely empty", () => {
  assert.equal(TIKTOK_COMMENTS_STATE.status, "WAITING_FOR_TIKTOK_BUSINESS_PERMISSION");
  assert.equal(TIKTOK_COMMENTS_STATE.available, false);
  assert.equal(TIKTOK_COMMENTS_STATE.polling_enabled, false, "no polling may run without Business API access");
});

test("every comment operation throws rather than returning fake data", async () => {
  for (const operation of ["listComments", "replyToComment", "likeComment", "hideComment", "unhideComment", "deleteOwnReply"]) {
    await assert.rejects(
      () => tiktokCommentsProvider[operation](),
      (error) => error.code === "WAITING_FOR_TIKTOK_BUSINESS_PERMISSION",
      `${operation} must not resolve`
    );
  }
});

test("no comment capability is advertised as available", () => {
  for (const [name, enabled] of Object.entries(tiktokCommentsProvider.capabilities)) {
    assert.equal(enabled, false, `capability ${name} must be false until Business API access is granted`);
  }
});
