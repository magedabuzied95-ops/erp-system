// The Instagram Business Login token lives 60 days and dies in silence: on
// 2026-10-08 one expired and every staff reply came back to the customer as
// "Error validating access token: Session has expired". Nothing renewed it —
// the only refresh scheduler read marketing_settings, a different table
// holding a different credential — and the panel still said "connected"
// because the health check only ever looked at the Facebook token's expiry.
//
// These tests drive the real functions against a stubbed pool and fetch, so
// deleting the renewal, the dead-token guard or the derived status makes one
// of them fail rather than leaving a green suite behind.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// The service derives its key per call, so pinning it here is enough for the
// test to read back what it stored.
process.env.SECRET_ENCRYPTION_KEY = "instagram-token-auto-refresh-test-key";

const decryptStored = (value = "") => {
  const raw = String(value || "");
  assert.ok(raw.startsWith("enc:v1:"), "the token was written to the database in plain text");
  const [, , iv, tag, payload] = raw.split(":");
  const key = crypto.createHash("sha256").update(process.env.SECRET_ENCRYPTION_KEY).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
};

import db from "../server/database/db.js";
import {
  getMetaIntegrationStatus,
  runInstagramTokenAutoRefreshScan,
} from "../server/services/metaIntegrationService.js";

const realQuery = db.query.bind(db);
const realFetch = globalThis.fetch;

const daysFromNow = (days) => new Date(Date.now() + days * 86400000).toISOString();

const baseRow = (overrides = {}) => ({
  id: 7,
  tenant_id: 1,
  facebook_page_id: "610",
  page_name: "M1 Store",
  facebook_page_name: "M1 Store",
  page_access_token_encrypted: "PAGE-TOKEN",
  instagram_business_account_id: "178",
  instagram_username: "m1store",
  instagram_access_token_encrypted: "IG-TOKEN-OLD",
  instagram_token_expires_at: daysFromNow(3),
  instagram_token_status: "active",
  instagram_token_last_validated_at: daysFromNow(-40),
  instagram_token_refreshed_at: daysFromNow(-40),
  instagram_token_refresh_error: "",
  instagram_token_alert_sent_at: null,
  instagram_webhook_subscribed: true,
  instagram_enabled: true,
  instagram_dm_enabled: true,
  messenger_enabled: true,
  webhook_enabled: true,
  webhook_verified: true,
  subscribed_apps_verified: true,
  permissions_saved: true,
  capability_status: { instagram_dm: { ok: true }, permissions: { ok: true } },
  // Deliberately healthy: the Facebook clock must not be able to vouch for
  // the Instagram one, nor condemn it.
  token_expires_at: daysFromNow(120),
  status: "fully_connected",
  updated_at: new Date().toISOString(),
  ...overrides,
});

// Answers any SELECT on meta_integration_configs with the row under test and
// records every other statement so the test can assert what was written.
const stubPool = (row) => {
  const statements = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    statements.push({ text, params });
    if (/^\s*SELECT/i.test(text) && /FROM meta_integration_configs/i.test(text)) return { rows: [row] };
    return { rows: [] };
  };
  return statements;
};

const stubFetch = (handler) => {
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    requests.push(url);
    return handler(url, init);
  };
  return requests;
};

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const writesTo = (statements, column) =>
  statements.filter((entry) => /UPDATE meta_integration_configs/i.test(entry.text) && entry.text.includes(column));

const notificationsOfType = (statements, type) =>
  statements.filter((entry) => /INSERT INTO notifications/i.test(entry.text) && entry.params.includes(type));

test.afterEach(() => {
  db.query = realQuery;
  globalThis.fetch = realFetch;
});

test("a token inside its last week is renewed against the Instagram refresh endpoint", async () => {
  const statements = stubPool(baseRow());
  const requests = stubFetch(() => jsonResponse({ access_token: "IG-TOKEN-NEW", expires_in: 5183944 }));

  const summary = await runInstagramTokenAutoRefreshScan();

  assert.equal(summary.refreshed, 1, "the token three days from death was not refreshed");
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]);
  assert.equal(url.host, "graph.instagram.com");
  assert.equal(url.pathname, "/refresh_access_token");
  assert.equal(url.searchParams.get("grant_type"), "ig_refresh_token");
  assert.equal(url.searchParams.get("access_token"), "IG-TOKEN-OLD");

  const saved = writesTo(statements, "instagram_access_token_encrypted");
  assert.equal(saved.length, 1, "the renewed token was never written back");
  // Bound to the parameter, not merely mentioned: a SET that assigns the
  // column to itself would still carry the new token in params and prove
  // nothing.
  const [, storedToken] = saved[0].params;
  assert.match(saved[0].text, /SET instagram_access_token_encrypted = \$2/);
  assert.equal(decryptStored(storedToken), "IG-TOKEN-NEW", "the OLD token is still stored");
  assert.match(saved[0].text, /instagram_token_status = 'active'/);
  // A healthy token must clear the alarm, or the next expiry goes unannounced.
  assert.match(saved[0].text, /instagram_token_alert_sent_at = NULL/);
});

test("a token with weeks left is left alone", async () => {
  const statements = stubPool(baseRow({ instagram_token_expires_at: daysFromNow(45) }));
  const requests = stubFetch(() => jsonResponse({ access_token: "IG-TOKEN-NEW", expires_in: 5183944 }));

  const summary = await runInstagramTokenAutoRefreshScan();

  assert.equal(summary.refreshed, 0);
  assert.equal(requests.length, 0, "Meta was called for a token that had 45 days left");
  assert.equal(writesTo(statements, "instagram_access_token_encrypted").length, 0);
});

test("an already-dead token is not offered to Meta, and an admin is told to reconnect", async () => {
  const statements = stubPool(baseRow({ instagram_token_expires_at: daysFromNow(-2) }));
  const requests = stubFetch(() => jsonResponse({ access_token: "IG-TOKEN-NEW", expires_in: 5183944 }));

  const summary = await runInstagramTokenAutoRefreshScan();

  assert.equal(summary.expired, 1);
  assert.equal(requests.length, 0, "Meta cannot renew an expired token; calling it only burns a request");
  const marked = writesTo(statements, "instagram_token_status = 'expired'");
  assert.equal(marked.length, 1);
  assert.equal(summary.alerted, 1);
  assert.equal(notificationsOfType(statements, "meta_instagram_token_expired").length, 1);
  assert.equal(writesTo(statements, "instagram_token_alert_sent_at = NOW()").length, 1);
});

test("an alert sent hours ago is not sent again on the next pass", async () => {
  const statements = stubPool(
    baseRow({ instagram_token_expires_at: daysFromNow(-2), instagram_token_alert_sent_at: new Date(Date.now() - 3600000).toISOString() })
  );
  stubFetch(() => jsonResponse({}));

  const summary = await runInstagramTokenAutoRefreshScan();

  assert.equal(summary.expired, 1);
  assert.equal(summary.alerted, 0);
  assert.equal(notificationsOfType(statements, "meta_instagram_token_expired").length, 0);
});

test("a refused renewal records why and raises the alarm instead of failing quietly", async () => {
  const statements = stubPool(baseRow());
  stubFetch(() =>
    jsonResponse({ error: { message: "Error validating access token: Session has expired", code: 190, error_subcode: 463 } }, 400)
  );

  const summary = await runInstagramTokenAutoRefreshScan();

  assert.equal(summary.refreshed, 0);
  assert.equal(summary.failed, 1);
  const marked = writesTo(statements, "instagram_token_status = 'error'");
  assert.equal(marked.length, 1);
  assert.match(marked[0].text, /instagram_token_refresh_error = \$2/);
  assert.match(
    String(marked[0].params[1]),
    /Session has expired/,
    "Meta's reason was dropped, leaving nobody able to tell why the renewal failed"
  );
  assert.equal(notificationsOfType(statements, "meta_instagram_token_refresh_failed").length, 1);
  // The old token stays put: a failed refresh must not wipe a credential that
  // may still have days of life in it.
  assert.equal(writesTo(statements, "instagram_access_token_encrypted").length, 0);
});

test("a forced run renews a token that is nowhere near expiry", async () => {
  stubPool(baseRow({ instagram_token_expires_at: daysFromNow(45) }));
  const requests = stubFetch(() => jsonResponse({ access_token: "IG-TOKEN-NEW", expires_in: 5183944 }));

  const summary = await runInstagramTokenAutoRefreshScan({ tenantId: 1, force: true });

  assert.equal(summary.refreshed, 1);
  assert.equal(requests.length, 1);
});

// The whole outage came from a scheduler that ran daily and never looked at
// this table. Wiring, not logic: the scan has to be reachable from the job
// that actually runs in production.
test("the daily Meta refresh job reaches the Instagram token", async () => {
  stubPool(baseRow());
  const requests = stubFetch(() => jsonResponse({ access_token: "IG-TOKEN-NEW", expires_in: 5183944 }));

  const { runMetaTokenAutoRefreshScan } = await import("../server/services/metaTokenAutoRefreshService.js");
  await runMetaTokenAutoRefreshScan();

  assert.ok(
    requests.some((url) => url.includes("graph.instagram.com/refresh_access_token")),
    "the daily job still ignores the inbox's Instagram credential"
  );
});

test("the panel reads the Instagram expiry, not the Facebook one", async () => {
  stubPool(baseRow({ instagram_token_expires_at: daysFromNow(-2) }));

  const status = await getMetaIntegrationStatus({ tenantId: 1, req: null });

  assert.equal(status.config.instagram_token_status, "expired", "a dead Instagram token still reported itself active");
  assert.equal(status.channels.instagram.token_valid, false);
  assert.equal(status.channels.instagram.dm_connected, false, "the inbox would still claim Instagram DMs work");
  // The Facebook side is healthy and must stay that way.
  assert.equal(status.channels.facebook.token_valid, true);
});

test("the last week shows as expiring_soon while DMs still work", async () => {
  stubPool(baseRow({ instagram_token_expires_at: daysFromNow(3) }));

  const status = await getMetaIntegrationStatus({ tenantId: 1, req: null });

  assert.equal(status.config.instagram_token_status, "expiring_soon");
  assert.equal(status.config.instagram_token_expires_in_days, 3);
  assert.equal(status.channels.instagram.token_valid, true);
});

test("a healthy Instagram token reports active even when the stored status is stale", async () => {
  stubPool(baseRow({ instagram_token_expires_at: daysFromNow(45), instagram_token_status: "expired" }));

  const status = await getMetaIntegrationStatus({ tenantId: 1, req: null });

  assert.equal(status.config.instagram_token_status, "active");
  assert.equal(status.channels.instagram.token_valid, true);
});
