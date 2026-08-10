import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import jwt from "jsonwebtoken";

import { metaReviewerApiBoundary } from "../../server/middleware/metaReviewerBoundary.js";
import {
  emitMetaReviewerInboundEvent,
  filterMetaReviewerVisibleMessages,
  getMetaReviewerChannelScope,
  loadMetaReviewerScope,
  metaReviewerConversationAllowed,
  metaReviewerConversationRef,
  metaReviewerConversationRefMatches,
  metaReviewerSenderScopeHmac,
  normalizeMetaReviewerChannel,
  sanitizeMetaReviewerMessage,
} from "../../server/services/metaReviewerAccessService.js";
import { setIo } from "../../server/utils/socket.js";
import {
  metaReviewerListQueryParams,
  metaReviewerUsesRawSenderSqlFilter,
} from "../../server/services/metaReviewerInboxService.js";

const env = {
  META_REVIEWER_TENANT_ID: "1",
  META_REVIEWER_FACEBOOK_PAGE_ID: "page-test",
  META_REVIEWER_ALLOWED_PSIDS: "messenger-test-user",
  META_REVIEWER_MESSENGER_REVIEW_SESSION_STARTED_AT: "2026-08-09T18:00:00.000Z",
  META_REVIEWER_INSTAGRAM_BUSINESS_ACCOUNT_ID: "instagram-business-test",
  META_REVIEWER_ALLOWED_INSTAGRAM_SCOPED_USER_IDS: "instagram-test-user",
  META_REVIEWER_INSTAGRAM_REVIEW_SESSION_STARTED_AT: "2026-08-09T19:00:00.000Z",
  META_REVIEWER_SCOPE_HMAC_KEY: "test-only-hmac-key-with-sufficient-entropy",
};

test("each review channel fails closed without its trusted test sender", () => {
  const scope = loadMetaReviewerScope({ ...env, META_REVIEWER_ALLOWED_INSTAGRAM_SCOPED_USER_IDS: "" });
  assert.equal(scope.enabled, true);
  assert.equal(getMetaReviewerChannelScope(scope, "messenger").enabled, true);
  assert.equal(getMetaReviewerChannelScope(scope, "instagram").enabled, false);
});

test("only Messenger and Instagram Direct normalize to authorized tabs", () => {
  assert.equal(normalizeMetaReviewerChannel("facebook_messenger"), "messenger");
  assert.equal(normalizeMetaReviewerChannel("instagram_dm"), "instagram");
  assert.equal(normalizeMetaReviewerChannel("whatsapp"), "whatsapp");
  assert.equal(normalizeMetaReviewerChannel("web_chat"), "web_chat");
});

test("Messenger isolation requires tenant, page and the authorized test PSID", () => {
  const scope = loadMetaReviewerScope(env);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "messenger", assetId: "page-test", senderScopedId: "messenger-test-user" }, scope), true);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 2, channel: "messenger", assetId: "page-test", senderScopedId: "messenger-test-user" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "messenger", assetId: "other-page", senderScopedId: "messenger-test-user" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "messenger", assetId: "page-test", senderScopedId: "real-customer" }, scope), false);
});

test("Instagram isolation requires tenant, business account and authorized scoped user", () => {
  const scope = loadMetaReviewerScope(env);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "instagram", assetId: "instagram-business-test", senderScopedId: "instagram-test-user" }, scope), true);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "instagram", assetId: "page-test", senderScopedId: "instagram-test-user" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "instagram", assetId: "instagram-business-test", senderScopedId: "messenger-test-user" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "whatsapp", assetId: "instagram-business-test", senderScopedId: "instagram-test-user" }, scope), false);
});

test("Instagram test sender can be allowlisted by an irreversible scoped HMAC", () => {
  const senderHmac = metaReviewerSenderScopeHmac({
    tenantId: 1,
    channel: "instagram",
    assetId: "instagram-business-test",
    senderScopedId: "instagram-test-user",
  }, env.META_REVIEWER_SCOPE_HMAC_KEY);
  const scope = loadMetaReviewerScope({
    ...env,
    META_REVIEWER_ALLOWED_INSTAGRAM_SCOPED_USER_IDS: "",
    META_REVIEWER_ALLOWED_INSTAGRAM_SCOPED_USER_HMACS: senderHmac,
  });
  assert.equal(scope.channels.instagram.enabled, true);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "instagram", assetId: "instagram-business-test", senderScopedId: "instagram-test-user" }, scope), true);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "instagram", assetId: "instagram-business-test", senderScopedId: "real-customer" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "instagram", assetId: "other-business", senderScopedId: "instagram-test-user" }, scope), false);
});

test("HMAC-only reviewer scopes are filtered after identity hashing instead of raw-ID SQL", () => {
  assert.equal(metaReviewerUsesRawSenderSqlFilter({
    allowedSenderIds: ["test-sender"],
    allowedSenderHmacs: [],
  }), true);
  assert.equal(metaReviewerUsesRawSenderSqlFilter({
    allowedSenderIds: [],
    allowedSenderHmacs: ["irreversible-test-digest"],
  }), false);
  assert.equal(metaReviewerUsesRawSenderSqlFilter({
    allowedSenderIds: ["test-sender"],
    allowedSenderHmacs: ["irreversible-test-digest"],
  }), false);
});

test("HMAC-only reviewer list queries bind exactly the five SQL parameters they use", () => {
  const scope = { tenantId: 1 };
  const config = {
    assetId: "instagram-business-test",
    allowedSenderIds: [],
    visibleMessagesAfter: "2026-08-09T19:00:00.000Z",
  };
  assert.equal(metaReviewerListQueryParams({
    scope,
    config,
    searchValue: "review",
    safeLimit: 50,
    useRawSenderSqlFilter: false,
  }).length, 5);
  assert.equal(metaReviewerListQueryParams({
    scope,
    config,
    searchValue: "review",
    safeLimit: 50,
    useRawSenderSqlFilter: true,
  }).length, 6);
});

test("opaque conversation references are bound to the selected channel", () => {
  const scope = loadMetaReviewerScope(env);
  const reference = metaReviewerConversationRef("test-session", scope, "messenger");
  assert.equal(reference.includes("test-session"), false);
  assert.equal(metaReviewerConversationRefMatches(reference, "test-session", scope, "messenger"), true);
  assert.equal(metaReviewerConversationRefMatches(reference, "test-session", scope, "instagram"), false);
  assert.equal(metaReviewerConversationRefMatches(reference, "other-session", scope, "messenger"), false);
});

test("network message responses omit scoped IDs, phones and metadata", () => {
  const result = sanitizeMetaReviewerMessage({ id: 7, message_text: "hello", sender_type: "customer", external_customer_id: "secret", remote_jid: "secret", phone: "secret", metadata: { token: "secret" } });
  assert.equal(result.text, "hello");
  for (const key of ["external_customer_id", "remote_jid", "phone", "metadata"]) assert.equal(key in result, false);
});

test("review session start is independent for Messenger and Instagram", () => {
  const scope = loadMetaReviewerScope(env);
  const messages = [
    { id: 1, created_at: "2026-08-09T18:30:00.000Z" },
    { id: 2, created_at: "2026-08-09T19:00:00.000Z" },
  ];
  assert.deepEqual(filterMetaReviewerVisibleMessages(messages, scope, "messenger").map((item) => item.id), [1, 2]);
  assert.deepEqual(filterMetaReviewerVisibleMessages(messages, scope, "instagram").map((item) => item.id), [2]);
});

test("Socket events are emitted only to the selected authorized channel room", () => {
  const events = [];
  const fakeIo = { to(room) { events.push({ room }); return this; }, emit(name, payload) { events.push({ name, payload }); return this; } };
  setIo(fakeIo);
  const scope = loadMetaReviewerScope(env);
  const message = { message_text: "ok", sender_type: "customer", created_at: "2026-08-09T19:00:00.000Z" };
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "whatsapp", assetId: "page-test", senderScopedId: "messenger-test-user", sessionId: "forbidden", message }, scope), false);
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "instagram", assetId: "instagram-business-test", senderScopedId: "real-customer", sessionId: "forbidden", message }, scope), false);
  assert.equal(events.length, 0);
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "instagram", assetId: "instagram-business-test", senderScopedId: "instagram-test-user", sessionId: "allowed", message }, scope), true);
  assert.equal(events.some((event) => String(event.room || "").endsWith(":instagram-test")), true);
  assert.equal(events.some((event) => String(event.room || "").endsWith(":messenger-test")), false);
  assert.equal(JSON.stringify(events).includes("instagram-test-user"), false);
  setIo(null);
});

test("API boundary keeps the reviewer inside its inbox while preserving Admin access", () => {
  process.env.JWT_SECRET = "boundary-test-secret";
  const makeResponse = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  let nextCalls = 0;
  const reviewerToken = jwt.sign({ id: 1, role: "meta_reviewer" }, process.env.JWT_SECRET);
  const denied = makeResponse();
  metaReviewerApiBoundary({ headers: { authorization: `Bearer ${reviewerToken}` }, originalUrl: "/api/settings" }, denied, () => { nextCalls += 1; });
  assert.equal(denied.statusCode, 403);
  const allowed = makeResponse();
  metaReviewerApiBoundary({ headers: { authorization: `Bearer ${reviewerToken}` }, originalUrl: "/api/meta-reviewer/inbox/channels/instagram/conversations" }, allowed, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  const adminToken = jwt.sign({ id: 2, role: "admin" }, process.env.JWT_SECRET);
  metaReviewerApiBoundary({ headers: { authorization: `Bearer ${adminToken}` }, originalUrl: "/api/settings" }, makeResponse(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
});

test("Instagram webhook setup subscribes to direct messages and fails back to the required field", () => {
  const source = fs.readFileSync(new URL("../../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  assert.match(source, /META_INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS\s*=\s*\[[\s\S]*?"messages"/);
  assert.match(source, /META_INSTAGRAM_WEBHOOK_REQUIRED_FIELDS\s*=\s*\["messages"\]/);
  assert.match(source, /subscribed_fields:\s*META_INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS\.join\(","\)/);
  assert.match(source, /subscribed_fields:\s*META_INSTAGRAM_WEBHOOK_REQUIRED_FIELDS\.join\(","\)/);
});
