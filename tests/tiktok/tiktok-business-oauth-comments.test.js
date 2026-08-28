// TikTok Business OAuth + Comments — offline behavioural tests.
//
// No credentials, no network (global fetch is stubbed per test), no database
// (pool.query is stubbed per test). What these protect:
//   1. OAuth: CSRF state single-use, token exchange, encrypted-at-rest storage,
//      refresh-token rotation persisted in the same statement as the lock clear.
//   2. Capability: computed per tenant from connection + scopes + probe — never
//      copied from portal approval; every rung of the ladder reachable.
//   3. Sync/reply: idempotent ingestion keys, duplicate-reply protection,
//      ownership validation, digit-safe webhook ids.
//   4. Registry: tiktok routes to tiktok; every legacy Meta input unchanged;
//      Meta-only paths refuse tiktok loudly.

import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "tiktok-test-encryption-key";
const BUSINESS_KEY = "b7f3c1a9e5d24086bf1c73ae90d5218c4437fe6bqz";
process.env.TIKTOK_BUSINESS_ENCRYPTION_KEY = process.env.TIKTOK_BUSINESS_ENCRYPTION_KEY || BUSINESS_KEY;

const FULL_CONFIG = {
  TIKTOK_BUSINESS_ENABLED: "true",
  TIKTOK_BUSINESS_COMMENTS_ENABLED: "true",
  TIKTOK_BUSINESS_APP_ID: "7000000000000000001",
  TIKTOK_BUSINESS_APP_SECRET: "business-app-secret-value",
  TIKTOK_BUSINESS_REDIRECT_URI: "https://api.m1store-egy.com/api/tiktok-business/oauth/callback/",
  TIKTOK_BUSINESS_AUTHORIZE_URL:
    "https://www.tiktok.com/v2/auth/authorize?client_key=awtest&response_type=code&scope=comment.list%2Ccomment.list.manage",
};

const withEnv = (overrides, fn) => {
  const previous = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const restore = () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
};

// Scriptable stand-ins. db is the real pg pool object; patching .query on it is
// safe because nothing here ever lets a query through to a live socket.
const db = (await import("../../server/database/db.js")).default;
const realQuery = db.query.bind(db);
const withDb = (handler, fn) => {
  const calls = [];
  db.query = async (sqlText, params = []) => {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const result = await handler({ sql, params, calls });
    return result || { rows: [], rowCount: 0 };
  };
  const restore = () => { db.query = realQuery; };
  let result;
  try {
    result = fn(calls);
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
};

const realFetch = globalThis.fetch;
const withFetch = (handler, fn) => {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const record = { url: String(url), init };
    requests.push(record);
    const body = await handler(record, requests);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const restore = () => { globalThis.fetch = realFetch; };
  let result;
  try {
    result = fn(requests);
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
};

const apiClient = await import("../../server/services/tiktokBusinessApiClient.js");
const oauth = await import("../../server/services/tiktokBusinessOAuthService.js");
const capability = await import("../../server/services/tiktokBusinessCapabilityService.js");
const businessCrypto = await import("../../server/services/tiktokBusinessCryptoService.js");
const sync = await import("../../server/services/tiktokBusinessCommentsSyncService.js");
const registry = await import("../../server/services/socialCommentPlatforms.js");

const futureTs = (hours) => new Date(Date.now() + hours * 3_600_000);
const CONNECTED_ROW = () => ({
  tenant_id: 1,
  business_id: "biz-open-id",
  status: "connected",
  access_token_encrypted: businessCrypto.encryptTikTokBusinessSecret("live-access-token"),
  refresh_token_encrypted: businessCrypto.encryptTikTokBusinessSecret("live-refresh-token"),
  access_token_expires_at: futureTs(20),
  refresh_token_expires_at: futureTs(24 * 300),
  granted_scopes: "comment.list,comment.list.manage,video.list,user.info.basic",
  refresh_lock_token: "",
  refresh_lock_at: null,
  last_error: "",
});

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

test("array query params are JSON-encoded the way TikTok expects", async () => {
  await withFetch(
    () => ({ code: 0, message: "OK", data: { videos: [] } }),
    async (requests) => {
      await apiClient.fetchTikTokBusinessVideos({ accessToken: "t", businessId: "b", fields: ["create_time"] });
      const url = new URL(requests[0].url);
      // item_id is force-included, and the value is a JSON array literal.
      assert.equal(url.searchParams.get("fields"), JSON.stringify(["item_id", "create_time"]));
      assert.equal(url.searchParams.get("business_id"), "b");
      assert.equal(requests[0].init.headers["Access-Token"], "t");
    }
  );
});

test("HTTP 200 with a non-zero TikTok code is an error, and reauth codes map to 409", async () => {
  await withFetch(
    () => ({ code: 40105, message: "Access token is invalid" }),
    () =>
      assert.rejects(
        () => apiClient.fetchTikTokBusinessComments({ accessToken: "t", businessId: "b", videoId: "v" }),
        (error) => error.code === "TIKTOK_BUSINESS_REAUTH_REQUIRED" && error.status === 409 && error.tiktokCode === 40105
      )
  );
  await withFetch(
    () => ({ code: 50002, message: "rate limit" }),
    () =>
      assert.rejects(
        () => apiClient.fetchTikTokBusinessComments({ accessToken: "t", businessId: "b", videoId: "v" }),
        (error) => error.status === 429 && apiClient.isTikTokBusinessRateLimited(error)
      )
  );
});

test("reply text is validated locally before any network call", async () => {
  let fetched = 0;
  await withFetch(
    () => { fetched += 1; return { code: 0, data: {} }; },
    async () => {
      await assert.rejects(
        () => apiClient.createTikTokBusinessCommentReply({ accessToken: "t", businessId: "b", videoId: "v", commentId: "c", text: "  " }),
        (error) => error.code === "TIKTOK_BUSINESS_REPLY_EMPTY"
      );
      await assert.rejects(
        () => apiClient.createTikTokBusinessCommentReply({ accessToken: "t", businessId: "b", videoId: "v", commentId: "c", text: "x".repeat(1201) }),
        (error) => error.code === "TIKTOK_BUSINESS_REPLY_TOO_LONG"
      );
      assert.equal(fetched, 0, "invalid replies must not burn a TikTok request");
    }
  );
});

test("error redaction strips anything credential-shaped", () => {
  const redacted = apiClient.redactTikTokBusinessError(
    'failed: access_token=act1234567890abcdefghijklmnopqrstuvwxyz012345 refresh_token: "rt-secret" client_secret="cs-secret"'
  );
  assert.ok(!redacted.includes("act1234567890abcdefghijklmnopqrstuvwxyz012345"));
  assert.ok(!redacted.includes("rt-secret"));
  assert.ok(!redacted.includes("cs-secret"));
});

test("the authorize URL is the portal's own URL plus state — never rebuilt from parts", () => {
  const url = apiClient.buildTikTokBusinessAuthorizeUrl({
    authorizeUrl: FULL_CONFIG.TIKTOK_BUSINESS_AUTHORIZE_URL,
    state: "csrf-state-token",
    forceConsent: true,
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("state"), "csrf-state-token");
  assert.equal(parsed.searchParams.get("disable_auto_auth"), "1");
  // The portal-issued parts survive untouched.
  assert.equal(parsed.searchParams.get("client_key"), "awtest");
  assert.equal(parsed.searchParams.get("scope"), "comment.list,comment.list.manage");
  assert.throws(
    () => apiClient.buildTikTokBusinessAuthorizeUrl({ authorizeUrl: "", state: "s" }),
    (error) => error.code === "TIKTOK_BUSINESS_AUTHORIZE_URL_MISSING"
  );
});

test("webhook content parser preserves ids beyond 2^53 digit-for-digit", () => {
  const content = '{"comment_id":7247303576418566913,"video_id":7203946942097902849,"comment_type":"reply","comment_action":"insert","timestamp":1687394416109}';
  const parsed = apiClient.parseTikTokBusinessWebhookContent(content);
  assert.equal(parsed.comment_id, "7247303576418566913");
  assert.equal(parsed.video_id, "7203946942097902849");
  assert.equal(parsed.timestamp, "1687394416109");
  assert.equal(parsed.comment_action, "insert");
  // Quoted ids parse identically.
  assert.equal(apiClient.parseTikTokBusinessWebhookContent('{"comment_id":"42"}').comment_id, "42");
});

// ---------------------------------------------------------------------------
// Redirect URI rules (TikTok's documented formatting constraints)
// ---------------------------------------------------------------------------

test("redirect URI validation enforces TikTok's documented rules", async () => {
  const config = await import("../../server/services/tiktokBusinessConfigService.js");
  const valid = config.validateTikTokBusinessRedirectUri("https://api.m1store-egy.com/api/tiktok-business/oauth/callback/");
  assert.equal(valid.valid, true, valid.problems.join("; "));

  for (const [uri, why] of [
    ["https://api.m1store-egy.com/api/tiktok-business/oauth/callback", "must end with a trailing slash"],
    ["http://api.m1store-egy.com/cb/", "must use https"],
    ["https://api.m1store-egy.com:8443/cb/", "must not include a port"],
    ["https://api.m1store-egy.com/cb/?x=1", "must not contain query parameters"],
    ["https://api.m1store-egy.com/cb/#frag", "must not contain a fragment"],
  ]) {
    const result = config.validateTikTokBusinessRedirectUri(uri);
    assert.equal(result.valid, false, `${uri} should be rejected`);
    assert.ok(result.problems.some((p) => p.includes(why.split(" ").at(-1))), `${uri}: expected a problem about "${why}"`);
  }
});

// ---------------------------------------------------------------------------
// OAuth lifecycle
// ---------------------------------------------------------------------------

test("oauth start mints a single-use state and embeds it in the authorize URL", async () => {
  await withEnv(FULL_CONFIG, () =>
    withDb(
      ({ sql }) => (sql.includes("INSERT INTO tiktok_business_oauth_states") ? { rows: [], rowCount: 1 } : null),
      async (calls) => {
        const started = await oauth.createTikTokBusinessOAuthState({ tenantId: 7, userId: 3 });
        assert.match(started.state, /^[0-9a-f]{64}$/);
        assert.ok(started.authorize_url.includes(`state=${started.state}`));
        const insert = calls.find((c) => c.sql.includes("tiktok_business_oauth_states"));
        assert.ok(insert, "state row must be persisted");
        assert.equal(insert.params[1], 7);
      }
    )
  );
});

test("a replayed or expired state is rejected before any token exchange", async () => {
  let fetched = 0;
  await withEnv(FULL_CONFIG, () =>
    withFetch(
      () => { fetched += 1; return { code: 0, data: {} }; },
      () =>
        withDb(
          // The consume UPDATE matches zero rows: already used or expired.
          () => ({ rows: [], rowCount: 0 }),
          () =>
            assert.rejects(
              () => oauth.handleTikTokBusinessOAuthCallback({ code: "auth-code", state: "stale" }),
              (error) => error.code === "TIKTOK_BUSINESS_STATE_INVALID"
            )
        )
    )
  );
  assert.equal(fetched, 0, "no exchange may happen on an invalid state");
});

test("a TikTok-side denial is recorded and never exchanged", async () => {
  let fetched = 0;
  await withEnv(FULL_CONFIG, () =>
    withFetch(
      () => { fetched += 1; return { code: 0, data: {} }; },
      () =>
        withDb(
          () => ({ rows: [], rowCount: 1 }),
          async (calls) => {
            await assert.rejects(
              () => oauth.handleTikTokBusinessOAuthCallback({ state: "s", error: "access_denied", errorDescription: "user said no" }),
              (error) => error.code === "TIKTOK_BUSINESS_AUTH_DENIED"
            );
            const failedUpdate = calls.find((c) => c.sql.includes("status = 'failed'"));
            assert.ok(failedUpdate, "the state row must record the denial");
          }
        )
    )
  );
  assert.equal(fetched, 0);
});

test("callback exchanges the code, stores tokens ENCRYPTED, and keys the row by token_info's creator_id", async () => {
  await withEnv(FULL_CONFIG, () =>
    withFetch(
      ({ url }) => {
        if (url.includes("/tt_user/oauth2/token/")) {
          return {
            code: 0,
            data: {
              access_token: "fresh-access-token",
              refresh_token: "fresh-refresh-token",
              expires_in: 86_400,
              refresh_token_expires_in: 31_536_000,
              open_id: "open-id-from-token",
              scope: "comment.list",
            },
          };
        }
        if (url.includes("/tt_user/token_info/get/")) {
          return { code: 0, data: { app_id: FULL_CONFIG.TIKTOK_BUSINESS_APP_ID, creator_id: "creator-id-authoritative", scope: "comment.list,comment.list.manage,video.list" } };
        }
        if (url.includes("/business/get/")) {
          return { code: 0, data: { display_name: "M1 Store", username: "m1store", profile_image: "https://cdn/avatar.jpg" } };
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      () =>
        withDb(
          ({ sql }) => {
            if (sql.includes("UPDATE tiktok_business_oauth_states")) {
              return { rows: [{ tenant_id: 7, user_id: 3, state_token: "s" }], rowCount: 1 };
            }
            if (sql.includes("INSERT INTO tiktok_business_connections")) {
              return { rows: [{ tenant_id: 7 }], rowCount: 1 };
            }
            return null;
          },
          async (calls) => {
            const result = await oauth.handleTikTokBusinessOAuthCallback({ code: "auth-code", state: "s" });
            assert.equal(result.tenantId, 7);
            // token_info wins for both identity and scopes.
            assert.equal(result.businessId, "creator-id-authoritative");
            assert.deepEqual(result.scopes, ["comment.list", "comment.list.manage", "video.list"]);

            const upsert = calls.find((c) => c.sql.includes("INSERT INTO tiktok_business_connections"));
            assert.ok(upsert, "connection row must be written");
            const [, businessId, , , , accessEnc, refreshEnc, , , scopes] = upsert.params;
            assert.equal(businessId, "creator-id-authoritative");
            assert.ok(String(accessEnc).startsWith("tkb:v1:"), "access token must be stored in the tkb envelope");
            assert.ok(String(refreshEnc).startsWith("tkb:v1:"), "refresh token must be stored in the tkb envelope");
            assert.ok(!JSON.stringify(upsert.params).includes("fresh-access-token"), "no plaintext token in params");
            assert.equal(businessCrypto.decryptTikTokBusinessSecret(accessEnc), "fresh-access-token");
            assert.equal(businessCrypto.decryptTikTokBusinessSecret(refreshEnc), "fresh-refresh-token");
            assert.equal(scopes, "comment.list,comment.list.manage,video.list");
          }
        )
    )
  );
});

test("refresh rotates the refresh token and persists the NEW one in the lock-clearing statement", async () => {
  const row = CONNECTED_ROW();
  row.access_token_expires_at = new Date(Date.now() + 60_000); // inside the skew => needs refresh
  await withEnv(FULL_CONFIG, () =>
    withFetch(
      ({ url }) => {
        assert.ok(url.includes("/tt_user/oauth2/refresh_token/"));
        return {
          code: 0,
          data: {
            access_token: "rotated-access-token",
            refresh_token: "ROTATED-refresh-token",
            expires_in: 86_400,
            refresh_token_expires_in: 30_000_000,
            open_id: "biz-open-id",
            scope: "comment.list,comment.list.manage",
          },
        };
      },
      () =>
        withDb(
          ({ sql }) => {
            if (sql.includes("SELECT * FROM tiktok_business_connections")) return { rows: [row], rowCount: 1 };
            if (sql.includes("SET refresh_lock_token")) return { rows: [{ ...row, refresh_lock_token: "lock" }], rowCount: 1 };
            if (sql.includes("SET access_token_encrypted")) return { rows: [{ ...row }], rowCount: 1 };
            return null;
          },
          async (calls) => {
            const { refreshed } = await oauth.refreshTikTokBusinessTokenIfNeeded({ tenantId: 1 });
            assert.equal(refreshed, true);
            const update = calls.find((c) => c.sql.includes("SET access_token_encrypted"));
            assert.ok(update, "the refresh must persist");
            // Same statement clears the lock — a crash between persist and
            // unlock cannot drop the rotated token.
            assert.match(update.sql, /refresh_lock_token = ''/);
            const [, accessEnc, refreshEnc] = update.params;
            assert.equal(businessCrypto.decryptTikTokBusinessSecret(accessEnc), "rotated-access-token");
            assert.equal(businessCrypto.decryptTikTokBusinessSecret(refreshEnc), "ROTATED-refresh-token", "the ROTATED refresh token must be stored, not the old one");
          }
        )
    )
  );
});

test("a reauth failure during refresh marks the connection reconnect_required", async () => {
  const row = CONNECTED_ROW();
  row.access_token_expires_at = new Date(Date.now() - 1_000);
  await withEnv(FULL_CONFIG, () =>
    withFetch(
      () => ({ code: 40105, message: "refresh token invalid" }),
      () =>
        withDb(
          ({ sql }) => {
            if (sql.includes("SELECT * FROM tiktok_business_connections")) return { rows: [row], rowCount: 1 };
            if (sql.includes("SET refresh_lock_token")) return { rows: [{ ...row, refresh_lock_token: "lock" }], rowCount: 1 };
            return null;
          },
          async (calls) => {
            await assert.rejects(() => oauth.refreshTikTokBusinessTokenIfNeeded({ tenantId: 1 }));
            const marked = calls.find((c) => c.sql.includes("SET status =") && (c.params || []).includes("reconnect_required"));
            assert.ok(marked, "the connection must be marked reconnect_required");
          }
        )
    )
  );
});

test("an expired refresh token demands reconnect without calling TikTok", async () => {
  const row = CONNECTED_ROW();
  row.access_token_expires_at = new Date(Date.now() - 1_000);
  row.refresh_token_expires_at = new Date(Date.now() - 1_000);
  let fetched = 0;
  await withEnv(FULL_CONFIG, () =>
    withFetch(
      () => { fetched += 1; return { code: 0, data: {} }; },
      () =>
        withDb(
          ({ sql }) => (sql.includes("SELECT * FROM tiktok_business_connections") ? { rows: [row], rowCount: 1 } : null),
          () =>
            assert.rejects(
              () => oauth.refreshTikTokBusinessTokenIfNeeded({ tenantId: 1 }),
              (error) => error.code === "TIKTOK_BUSINESS_RECONNECT_REQUIRED"
            )
        )
    )
  );
  assert.equal(fetched, 0);
});

test("token lifecycle helpers", () => {
  assert.equal(oauth.tokenNeedsRefresh(CONNECTED_ROW()), false);
  assert.equal(oauth.tokenNeedsRefresh({ ...CONNECTED_ROW(), access_token_expires_at: new Date(Date.now() + 60_000) }), true, "inside the skew window");
  assert.equal(oauth.tokenNeedsRefresh({ ...CONNECTED_ROW(), access_token_encrypted: "" }), true);
  assert.equal(oauth.refreshTokenExpired(CONNECTED_ROW()), false);
  assert.equal(oauth.refreshTokenExpired({ refresh_token_expires_at: new Date(Date.now() - 1) }), true);
  assert.deepEqual(oauth.parseGrantedScopes(" comment.list, video.list  comment.list.manage "), ["comment.list", "video.list", "comment.list.manage"]);
});

test("the account description never exposes token material", () => {
  const described = oauth.describeTikTokBusinessAccount(CONNECTED_ROW());
  const serialized = JSON.stringify(described);
  assert.ok(!serialized.includes("live-access-token"));
  assert.ok(!serialized.includes("tkb:v1:"), "not even the ciphertext leaves the server");
  assert.deepEqual(described.granted_scopes.slice(0, 2), ["comment.list", "comment.list.manage"]);
});

// ---------------------------------------------------------------------------
// Capability ladder — every rung reachable, none skipped
// ---------------------------------------------------------------------------

test("capability: DISABLED while the feature flags are off", async () => {
  const state = await capability.detectTikTokBusinessCommentsCapability({ tenantId: 1 });
  assert.equal(state.status, "DISABLED");
  assert.equal(state.available, false);
});

test("capability: NOT_CONNECTED with no connection row", async () => {
  await withEnv(FULL_CONFIG, () =>
    withDb(
      () => ({ rows: [], rowCount: 0 }),
      async () => {
        const state = await capability.detectTikTokBusinessCommentsCapability({ tenantId: 11, probe: false });
        assert.equal(state.status, "NOT_CONNECTED");
      }
    )
  );
});

test("capability: TOKEN_EXPIRED when the connection needs reconnecting", async () => {
  await withEnv(FULL_CONFIG, () =>
    withDb(
      () => ({ rows: [{ ...CONNECTED_ROW(), status: "reconnect_required" }], rowCount: 1 }),
      async () => {
        const state = await capability.detectTikTokBusinessCommentsCapability({ tenantId: 12, probe: false });
        assert.equal(state.status, "TOKEN_EXPIRED");
      }
    )
  );
});

test("capability: MISSING_PERMISSION names the exact missing scope", async () => {
  await withEnv(FULL_CONFIG, () =>
    withDb(
      () => ({ rows: [{ ...CONNECTED_ROW(), granted_scopes: "video.list,user.info.basic" }], rowCount: 1 }),
      async () => {
        const state = await capability.detectTikTokBusinessCommentsCapability({ tenantId: 13, probe: false });
        assert.equal(state.status, "MISSING_PERMISSION");
        assert.deepEqual(state.missing_scopes, ["comment.list"]);
      }
    )
  );
});

test("capability: AVAILABLE from stored scopes, with can_reply tracking the manage scope", async () => {
  await withEnv(FULL_CONFIG, () =>
    withDb(
      () => ({ rows: [CONNECTED_ROW()], rowCount: 1 }),
      async () => {
        const state = await capability.detectTikTokBusinessCommentsCapability({ tenantId: 14, probe: false });
        assert.equal(state.status, "AVAILABLE");
        assert.equal(state.can_reply, true);
      }
    )
  );
  await withEnv(FULL_CONFIG, () =>
    withDb(
      () => ({ rows: [{ ...CONNECTED_ROW(), granted_scopes: "comment.list,video.list" }], rowCount: 1 }),
      async () => {
        const state = await capability.detectTikTokBusinessCommentsCapability({ tenantId: 15, probe: false });
        assert.equal(state.status, "AVAILABLE");
        assert.equal(state.can_reply, false, "read-only grant must not advertise reply");
      }
    )
  );
});

test("capability: a live probe downgrades to MISSING_PERMISSION when TikTok reports the scope revoked", async () => {
  capability.invalidateTikTokBusinessCapabilityCache();
  await withEnv(FULL_CONFIG, () =>
    withFetch(
      ({ url }) => {
        assert.ok(url.includes("/tt_user/token_info/get/"), "the probe is token_info — the cheapest authenticated read");
        return { code: 0, data: { creator_id: "biz-open-id", scope: "video.list" } };
      },
      () =>
        withDb(
          () => ({ rows: [CONNECTED_ROW()], rowCount: 1 }),
          async () => {
            const state = await capability.detectTikTokBusinessCommentsCapability({ tenantId: 16, probe: true });
            assert.equal(state.status, "MISSING_PERMISSION", "the live scope list must win over the stored one");
          }
        )
    )
  );
  capability.invalidateTikTokBusinessCapabilityCache();
});

test("messaging capability stays waiting even when the app is approved", async () => {
  const state = await withDb(
    () => ({ rows: [], rowCount: 0 }),
    () => capability.describeTikTokBusinessMessagingCapabilityState({ tenantId: 1 })
  );
  assert.equal(state.status, "WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION");
  assert.equal(state.available, false);
});

// ---------------------------------------------------------------------------
// Sync + replies
// ---------------------------------------------------------------------------

test("the canonical TikTok comment event matches the ledger contract", () => {
  const event = sync.buildTikTokCommentEvent({
    tenantId: 1,
    businessId: "biz",
    video: { item_id: "v-1", caption: "new drop", share_url: "https://www.tiktok.com/@m1/video/v-1", thumbnail_url: "https://cdn/t.jpg", create_time: 1_755_000_000 },
    comment: {
      external_conversation_id: "v-1",
      external_message_id: "c-1",
      parent_external_message_id: "",
      external_customer_id: "+stable/id",
      customer_name: "Feather",
      customer_username: "feather",
      body: "nice",
      created_at: "2026-08-12T10:00:00.000Z",
      like_count: 2,
      reply_count: 0,
    },
  });
  assert.equal(event.platform, "tiktok");
  assert.equal(event.channel, "tiktok_comment");
  assert.equal(event.post_id, "v-1");
  assert.equal(event.comment_id, "c-1");
  assert.equal(event.root_comment_id, "c-1");
  assert.equal(event.original_comment_text, "nice");
  assert.equal(event.raw_payload.provider, "tiktok_business");
  assert.equal(event.raw_payload.business_id, "biz");
  assert.equal(event.action_taken, "ingested");
});

test("replying to a comment the tenant does not own is refused", async () => {
  await withDb(
    ({ sql }) => {
      if (sql.includes("FROM tiktok_business_comment_map")) return { rows: [], rowCount: 0 };
      return null;
    },
    () =>
      assert.rejects(
        () => sync.replyToTikTokComment({ tenantId: 1, commentId: "foreign-comment", text: "hi" }),
        (error) => error.code === "TIKTOK_BUSINESS_COMMENT_NOT_FOUND" && error.status === 404
      )
  );
});

test("a duplicate reply request is answered from the log, never re-sent", async () => {
  let fetched = 0;
  await withFetch(
    () => { fetched += 1; return { code: 0, data: {} }; },
    () =>
      withDb(
        ({ sql }) => {
          if (sql.includes("FROM tiktok_business_comment_map")) {
            return { rows: [{ tenant_id: 1, business_id: "biz", tiktok_video_id: "v-1", tiktok_comment_id: "c-1" }], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO tiktok_business_reply_log")) return { rows: [], rowCount: 0 }; // conflict: someone already sent it
          if (sql.includes("FROM tiktok_business_reply_log")) {
            return { rows: [{ status: "sent", provider_reply_id: "r-99" }], rowCount: 1 };
          }
          return null;
        },
        async () => {
          const result = await sync.replyToTikTokComment({ tenantId: 1, commentId: "c-1", text: "same text" });
          assert.deepEqual(result, { sent: true, duplicate: true, provider_reply_id: "r-99", video_id: "v-1" });
        }
      )
  );
  assert.equal(fetched, 0, "the duplicate path must not reach TikTok");
});

test("an in-flight identical reply is a 409, not a second send", async () => {
  await withDb(
    ({ sql }) => {
      if (sql.includes("FROM tiktok_business_comment_map")) {
        return { rows: [{ tenant_id: 1, business_id: "biz", tiktok_video_id: "v-1", tiktok_comment_id: "c-1" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO tiktok_business_reply_log")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM tiktok_business_reply_log")) return { rows: [{ status: "pending" }], rowCount: 1 };
      return null;
    },
    () =>
      assert.rejects(
        () => sync.replyToTikTokComment({ tenantId: 1, commentId: "c-1", text: "same text" }),
        (error) => error.code === "TIKTOK_BUSINESS_REPLY_DUPLICATE" && error.status === 409
      )
  );
});

test("empty reply text is rejected before any lookup", async () => {
  await assert.rejects(
    () => sync.replyToTikTokComment({ tenantId: 1, commentId: "c-1", text: "   " }),
    (error) => error.code === "TIKTOK_BUSINESS_REPLY_EMPTY"
  );
});

test("a webhook delete event marks the mapped comment hidden instead of fetching", async () => {
  const updates = [];
  await withDb(
    ({ sql, params }) => {
      if (sql.includes("FROM tiktok_business_connections")) return { rows: [{ tenant_id: 4 }], rowCount: 1 };
      if (sql.includes("UPDATE tiktok_business_comment_map")) {
        updates.push(params);
        return { rows: [], rowCount: 1 };
      }
      return null;
    },
    async () => {
      const result = await sync.processTikTokBusinessWebhookEvent({
        eventRow: {
          payload: {
            event: "comment.update",
            user_openid: "biz-open-id",
            content: '{"comment_id":7247303576418566913,"video_id":7203946942097902849,"comment_action":"delete"}',
          },
        },
      });
      assert.equal(result.processed, true);
      assert.equal(result.action, "deleted_marked_hidden");
      assert.equal(updates[0][1], "7247303576418566913", "the full 19-digit id must reach the UPDATE intact");
    }
  );
});

// ---------------------------------------------------------------------------
// Platform registry — tiktok routes to tiktok, Meta behaviour pinned
// ---------------------------------------------------------------------------

test("normalizePlatform: tiktok now normalizes to itself; every legacy input is unchanged", () => {
  assert.equal(registry.normalizePlatform("tiktok"), "tiktok");
  assert.equal(registry.normalizePlatform("TikTok"), "tiktok");

  // The pinned legacy behaviour: instagram -> instagram, EVERYTHING else ->
  // facebook. These inputs cover what the system actually produces.
  const legacyInputs = ["", null, undefined, "facebook", "FACEBOOK", " facebook ", "instagram", "Instagram", " INSTAGRAM ", "instagram_comment", "facebook_comment", "meta", "messenger", "ig", "fb", "whatsapp", "telegram", "garbage", "0"];
  for (const input of legacyInputs) {
    const expected = String(input ?? "").trim().toLowerCase() === "instagram" ? "instagram" : "facebook";
    assert.equal(registry.normalizePlatform(input), expected, `normalizePlatform(${JSON.stringify(input)}) changed for a legacy input`);
  }
});

test("channel mapping covers all three platforms", () => {
  assert.equal(registry.commentChannelForPlatform("facebook"), "facebook_comment");
  assert.equal(registry.commentChannelForPlatform("instagram"), "instagram_comment");
  assert.equal(registry.commentChannelForPlatform("tiktok"), "tiktok_comment");
  assert.equal(registry.isTikTok("tiktok"), true);
  assert.equal(registry.isTikTok("instagram"), false);
});

test("Meta-only paths refuse tiktok loudly", () => {
  assert.throws(
    () => registry.assertMetaPlatform("tiktok", "test-site"),
    (error) => error.code === "NON_META_COMMENT_PLATFORM" && error.status === 501
  );
  // And still pass Meta through unchanged.
  assert.equal(registry.assertMetaPlatform("instagram"), "instagram");
  assert.equal(registry.assertMetaPlatform(""), "facebook");
});

test("the auto-reply engine is guarded against tiktok at the source level", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../server/services/socialCommentsCenterService.js", import.meta.url), "utf8");
  // Mutation-resistant: the guard call must sit inside processSocialCommentAutoReply.
  const fnStart = source.indexOf("const processSocialCommentAutoReply");
  assert.ok(fnStart > 0);
  const fnSlice = source.slice(fnStart, fnStart + 1200);
  assert.match(fnSlice, /assertMetaPlatform\(platform, "processSocialCommentAutoReply"\)/);
});
