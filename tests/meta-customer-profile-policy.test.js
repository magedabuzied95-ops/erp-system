import test from "node:test";
import assert from "node:assert/strict";

import {
  META_PROFILE_CHANNELS,
  classifyMetaProfileError,
  createMetaProfileCoordinator,
  mergeMetaProfile,
  normalizeMetaProfilePayload,
  resolveMetaCustomerDisplayName,
  resolveMetaProfileRefreshDecision,
  resolveMetaProfileRequest,
  waitAtMost,
} from "../server/services/metaCustomerProfileService.js";

const HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Channel routing: Instagram and Messenger are NOT the same endpoint.
// ---------------------------------------------------------------------------
test("Messenger PSID goes to graph.facebook.com with the page token and the Messenger field set", () => {
  const request = resolveMetaProfileRequest({ channel: "facebook_messenger", externalCustomerId: "5036593356360590" });
  assert.equal(request.channel, META_PROFILE_CHANNELS.MESSENGER);
  assert.equal(request.host, "graph.facebook.com");
  assert.equal(request.fallbackHost, "");
  assert.equal(request.token, "page_access_token");
  assert.equal(request.fields, "first_name,last_name,name,profile_pic");
  assert.equal(request.path, "/5036593356360590");
});

test("Instagram IGSID with a Facebook-Login page token is answered by graph.facebook.com, with graph.instagram.com as the fallback", () => {
  const request = resolveMetaProfileRequest({ channel: "instagram", externalCustomerId: "1044077131364783", instagramBusinessLogin: false });
  assert.equal(request.channel, META_PROFILE_CHANNELS.INSTAGRAM);
  assert.equal(request.host, "graph.facebook.com");
  assert.equal(request.fallbackHost, "graph.instagram.com");
  assert.equal(request.fields, "name,username,profile_pic");
  assert.equal(request.token, "page_access_token");
});

test("Instagram IGSID with an Instagram-Login token is answered by graph.instagram.com first", () => {
  const request = resolveMetaProfileRequest({ channel: "instagram", externalCustomerId: "1044077131364783", instagramBusinessLogin: true });
  assert.equal(request.host, "graph.instagram.com");
  assert.equal(request.fallbackHost, "graph.facebook.com");
  assert.equal(request.token, "instagram_user_token");
});

test("channel aliases resolve, other channels and non-scoped ids do not get a request", () => {
  assert.equal(resolveMetaProfileRequest({ channel: "messenger", externalCustomerId: "123456789" }).channel, "facebook_messenger");
  assert.equal(resolveMetaProfileRequest({ channel: "instagram_dm", externalCustomerId: "123456789" }).channel, "instagram");
  assert.equal(resolveMetaProfileRequest({ channel: "whatsapp", externalCustomerId: "201024960585" }), null);
  assert.equal(resolveMetaProfileRequest({ channel: "instagram", externalCustomerId: "not-an-id" }), null);
});

// ---------------------------------------------------------------------------
// Payload normalisation per channel.
// ---------------------------------------------------------------------------
test("Messenger payload keeps first/last name and builds a full name; Instagram payload keeps username", () => {
  const messenger = normalizeMetaProfilePayload({
    channel: "facebook_messenger",
    payload: { id: "1", first_name: "Hend", last_name: "Mostafa", profile_pic: "https://cdn.example/a.jpg" },
  });
  assert.deepEqual(messenger, { first_name: "Hend", last_name: "Mostafa", name: "Hend Mostafa", username: "", profile_pic: "https://cdn.example/a.jpg" });

  const instagram = normalizeMetaProfilePayload({
    channel: "instagram",
    payload: { id: "2", name: "Maged", username: "@maged.store", profile_pic: "https://cdn.example/b.jpg" },
  });
  assert.deepEqual(instagram, { first_name: "Maged", last_name: "", name: "Maged", username: "maged.store", profile_pic: "https://cdn.example/b.jpg" });
});

// ---------------------------------------------------------------------------
// No-wipe merge.
// ---------------------------------------------------------------------------
test("a fresh answer never replaces a stored value with a blank", () => {
  const merged = mergeMetaProfile(
    { name: "Hend Mostafa", first_name: "Hend", last_name: "Mostafa", profile_pic: "https://cdn.example/old.jpg", username: "" },
    { name: "", first_name: "", last_name: "", profile_pic: "", username: "hend.m" }
  );
  assert.equal(merged.name, "Hend Mostafa");
  assert.equal(merged.profile_pic, "https://cdn.example/old.jpg");
  assert.equal(merged.username, "hend.m");
});

test("a fresh non-blank value does replace the stored one", () => {
  const merged = mergeMetaProfile({ name: "Old", profile_pic: "https://cdn.example/old.jpg" }, { name: "New", profile_pic: "https://cdn.example/new.jpg" });
  assert.equal(merged.name, "New");
  assert.equal(merged.profile_pic, "https://cdn.example/new.jpg");
});

// ---------------------------------------------------------------------------
// Refresh policy: not every message is a Graph call.
// ---------------------------------------------------------------------------
test("a brand-new customer (nothing cached) is fetched immediately", () => {
  assert.deepEqual(resolveMetaProfileRefreshDecision({ cached: null }), { refresh: true, reason: "missing" });
});

test("an incomplete profile that was never fetched from Meta is fetched immediately", () => {
  const decision = resolveMetaProfileRefreshDecision({ cached: { name: "Hend", profile_pic: "", profile_fetched_at: "" } });
  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, "incomplete_never_fetched");
});

test("a complete profile inside the TTL is served from cache", () => {
  const now = Date.now();
  const decision = resolveMetaProfileRefreshDecision({
    cached: { name: "Hend", profile_pic: "https://cdn.example/a.jpg", profile_fetched_at: new Date(now - 2 * HOUR).toISOString() },
    now,
  });
  assert.deepEqual(decision, { refresh: false, reason: "fresh" });
});

test("a complete profile older than the TTL is refreshed", () => {
  const now = Date.now();
  const decision = resolveMetaProfileRefreshDecision({
    cached: { name: "Hend", profile_pic: "https://cdn.example/a.jpg", profile_fetched_at: new Date(now - 30 * HOUR).toISOString() },
    now,
  });
  assert.deepEqual(decision, { refresh: true, reason: "stale" });
});

test("an incomplete profile Meta answered recently is NOT re-asked on the next message", () => {
  const now = Date.now();
  const cached = { name: "Hend", profile_pic: "", profile_fetched_at: new Date(now - 5 * 60 * 1000).toISOString() };
  assert.equal(resolveMetaProfileRefreshDecision({ cached, now }).refresh, false);
  const later = resolveMetaProfileRefreshDecision({ cached, now: now + 45 * 60 * 1000 });
  assert.equal(later.refresh, true);
  assert.equal(later.reason, "incomplete");
});

test("a recent failure holds the customer back; an unavailable/permission answer holds longer", () => {
  const now = Date.now();
  const transient = resolveMetaProfileRefreshDecision({ cached: null, failure: { at: now - 60 * 1000, kind: "transient" }, now });
  assert.equal(transient.refresh, false);
  assert.match(transient.reason, /failure_backoff/);
  const afterBackoff = resolveMetaProfileRefreshDecision({ cached: null, failure: { at: now - 20 * 60 * 1000, kind: "transient" }, now });
  assert.equal(afterBackoff.refresh, true);
  const unavailable = resolveMetaProfileRefreshDecision({ cached: null, failure: { at: now - 2 * HOUR, kind: "unavailable" }, now });
  assert.equal(unavailable.refresh, false);
});

test("forceRefresh (manual refresh, backfill) ignores the cache and the backoff", () => {
  const now = Date.now();
  const decision = resolveMetaProfileRefreshDecision({
    cached: { name: "Hend", profile_pic: "https://cdn.example/a.jpg", profile_fetched_at: new Date(now).toISOString() },
    failure: { at: now, kind: "unavailable" },
    forceRefresh: true,
    now,
  });
  assert.deepEqual(decision, { refresh: true, reason: "forced" });
});

// ---------------------------------------------------------------------------
// Error classification (drives backoff + the report), no secrets.
// ---------------------------------------------------------------------------
test("Meta error shapes are classified without leaking anything but code/subcode/message", () => {
  assert.equal(classifyMetaProfileError({ status: 400, meta: { code: 100, error_subcode: 33, message: "Unsupported get request." } }).kind, "unavailable");
  assert.equal(classifyMetaProfileError({ status: 400, meta: { code: 4, message: "(#4) Application request limit reached" } }).kind, "rate_limit");
  assert.equal(classifyMetaProfileError({ status: 400, meta: { code: 190, error_subcode: 463, message: "Error validating access token" } }).kind, "token");
  assert.equal(classifyMetaProfileError({ status: 403, meta: { code: 10, message: "(#10) This endpoint requires the ... permission" } }).kind, "permission");
  assert.equal(classifyMetaProfileError({ status: 502, message: "Bad gateway" }).kind, "transient");
  assert.equal(classifyMetaProfileError({ name: "AbortError", message: "The operation was aborted due to timeout" }).kind, "timeout");
  const classified = classifyMetaProfileError({ status: 400, meta: { code: 100, error_subcode: 33, message: "x", access_token: "EAAB-secret" } });
  assert.deepEqual(Object.keys(classified).sort(), ["code", "kind", "message", "retryable", "status", "subcode"]);
});

// ---------------------------------------------------------------------------
// Coordinator: one Graph call per customer at a time, failures remembered.
// ---------------------------------------------------------------------------
test("concurrent callers for the same customer share ONE fetch; another customer gets its own", async () => {
  const coordinator = createMetaProfileCoordinator();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = async () => { calls += 1; await gate; return { name: "Hend" }; };
  const key = coordinator.key({ tenantId: 1, channel: "facebook_messenger", externalCustomerId: "111111111" });
  const other = coordinator.key({ tenantId: 1, channel: "instagram", externalCustomerId: "111111111" });
  const first = coordinator.run(key, task);
  const second = coordinator.run(key, task);
  const third = coordinator.run(other, task);
  assert.equal(first.shared, false);
  assert.equal(second.shared, true);
  assert.equal(third.shared, false);
  assert.equal(coordinator.inFlightCount(), 2);
  release();
  const [a, b] = await Promise.all([first.promise, second.promise]);
  await third.promise;
  assert.deepEqual(a, { name: "Hend" });
  assert.deepEqual(b, { name: "Hend" });
  assert.equal(calls, 2, "same Messenger customer asked once; the Instagram id is a different customer");
  assert.equal(coordinator.inFlightCount(), 0);
});

test("a failed fetch is remembered and released after a success", async () => {
  const coordinator = createMetaProfileCoordinator();
  const key = coordinator.key({ tenantId: 1, channel: "instagram", externalCustomerId: "222222222" });
  await assert.rejects(coordinator.run(key, () => Promise.reject(Object.assign(new Error("boom"), { status: 500 }))).promise);
  const classified = coordinator.noteFailure(key, { status: 500, message: "boom" });
  assert.equal(classified.kind, "transient");
  assert.equal(coordinator.getFailure(key).kind, "transient");
  assert.equal(resolveMetaProfileRefreshDecision({ cached: null, failure: coordinator.getFailure(key) }).refresh, false);
  coordinator.clearFailure(key);
  assert.equal(coordinator.getFailure(key), null);
  assert.equal(coordinator.isInFlight(key), false);
});

// ---------------------------------------------------------------------------
// Bounded wait: the webhook never blocks on Meta.
// ---------------------------------------------------------------------------
test("waitAtMost returns the value when Meta answers in time, and gives up without cancelling when it does not", async () => {
  const fast = await waitAtMost(Promise.resolve({ name: "Hend" }), 200);
  assert.deepEqual(fast, { settled: true, value: { name: "Hend" } });

  let finished = false;
  const slow = new Promise((resolve) => setTimeout(() => { finished = true; resolve("late"); }, 60));
  const outcome = await waitAtMost(slow, 10);
  assert.equal(outcome.settled, false);
  assert.equal(finished, false, "the fetch is still running in the background");
  assert.equal(await slow, "late");
  assert.equal(finished, true);

  const failed = await waitAtMost(Promise.reject(new Error("nope")), 50);
  assert.equal(failed.settled, true);
  assert.equal(failed.error.message, "nope");
});

// ---------------------------------------------------------------------------
// Display-name order shared with the UI.
// ---------------------------------------------------------------------------
test("display name: profile name → stored name → @username → id tail, never the raw id", () => {
  assert.deepEqual(resolveMetaCustomerDisplayName({ profileName: "Hend Mostafa", storedName: "old", username: "hend", externalCustomerId: "5036593356360590" }), { name: "Hend Mostafa", source: "profile" });
  assert.deepEqual(resolveMetaCustomerDisplayName({ profileName: "", storedName: "Hend", username: "hend", externalCustomerId: "5036593356360590" }), { name: "Hend", source: "stored" });
  assert.deepEqual(resolveMetaCustomerDisplayName({ profileName: "", storedName: "", username: "@hend.m", externalCustomerId: "5036593356360590" }), { name: "@hend.m", source: "username" });
  assert.deepEqual(resolveMetaCustomerDisplayName({ profileName: "", storedName: "5036593356360590", username: "", externalCustomerId: "5036593356360590", channel: "instagram" }), { name: "Instagram …0590", source: "external_id" });
  assert.deepEqual(resolveMetaCustomerDisplayName({ profileName: "", storedName: "", username: "", externalCustomerId: "5036593356360590", channel: "facebook_messenger" }), { name: "Messenger …0590", source: "external_id" });
});
