import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import { metaReviewerApiBoundary } from "../../server/middleware/metaReviewerBoundary.js";
import {
  emitMetaReviewerInboundEvent,
  filterMetaReviewerVisibleMessages,
  loadMetaReviewerScope,
  metaReviewerConversationAllowed,
  metaReviewerConversationRef,
  metaReviewerConversationRefMatches,
  sanitizeMetaReviewerMessage,
} from "../../server/services/metaReviewerAccessService.js";
import { setIo } from "../../server/utils/socket.js";

const env = {
  META_REVIEWER_TENANT_ID: "1",
  META_REVIEWER_FACEBOOK_PAGE_ID: "page-test",
  META_REVIEWER_ALLOWED_PSIDS: "test-psid",
  META_REVIEWER_SCOPE_HMAC_KEY: "test-only-hmac-key-with-sufficient-entropy",
  META_REVIEWER_VISIBLE_MESSAGES_AFTER: "2026-08-09T18:00:00.000Z",
};

test("scope fails closed when no test PSID is configured", () => {
  const scope = loadMetaReviewerScope({ ...env, META_REVIEWER_ALLOWED_PSIDS: "" });
  assert.equal(scope.enabled, false);
  assert.deepEqual(scope.allowedPsids, []);
});

test("scope fails closed when the review session start time is missing", () => {
  const scope = loadMetaReviewerScope({ ...env, META_REVIEWER_VISIBLE_MESSAGES_AFTER: "" });
  assert.equal(scope.enabled, false);
  assert.equal(scope.visibleMessagesAfter, "");
});

test("only the configured tenant, page, Messenger channel and test PSID are allowed", () => {
  const scope = loadMetaReviewerScope(env);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "messenger", pageId: "page-test", psid: "test-psid" }, scope), true);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 2, channel: "messenger", pageId: "page-test", psid: "test-psid" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "messenger", pageId: "other-page", psid: "test-psid" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "instagram", pageId: "page-test", psid: "test-psid" }, scope), false);
  assert.equal(metaReviewerConversationAllowed({ tenantId: 1, channel: "messenger", pageId: "page-test", psid: "real-customer" }, scope), false);
});

test("opaque conversation references do not expose or accept another conversation id", () => {
  const scope = loadMetaReviewerScope(env);
  const reference = metaReviewerConversationRef("messenger:test-psid", scope);
  assert.equal(reference.includes("test-psid"), false);
  assert.equal(metaReviewerConversationRefMatches(reference, "messenger:test-psid", scope), true);
  assert.equal(metaReviewerConversationRefMatches(reference, "messenger:real-customer", scope), false);
});

test("message responses omit channel identifiers and customer data", () => {
  const result = sanitizeMetaReviewerMessage({ id: 7, message_text: "hello", sender_type: "customer", external_customer_id: "secret", remote_jid: "secret", phone: "secret", metadata: { token: "secret" } });
  assert.equal(result.text, "hello");
  assert.equal("external_customer_id" in result, false);
  assert.equal("remote_jid" in result, false);
  assert.equal("phone" in result, false);
  assert.equal("metadata" in result, false);
});

test("review session hides old messages and includes messages at or after the cutoff", () => {
  const scope = loadMetaReviewerScope(env);
  const visible = filterMetaReviewerVisibleMessages([
    { id: 1, created_at: "2026-08-09T17:59:59.999Z", message_text: "old" },
    { id: 2, created_at: "2026-08-09T18:00:00.000Z", message_text: "at cutoff" },
    { id: 3, created_at: "2026-08-09T18:00:01.000Z", message_text: "new" },
  ], scope);
  assert.deepEqual(visible.map((message) => message.id), [2, 3]);
});

test("realtime emits only for the configured test conversation", () => {
  const events = [];
  const fakeIo = { to(room) { events.push({ room }); return this; }, emit(name, payload) { events.push({ name, payload }); return this; } };
  setIo(fakeIo);
  const scope = loadMetaReviewerScope(env);
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "messenger", pageId: "page-test", psid: "real-customer", sessionId: "forbidden", message: {} }, scope), false);
  assert.equal(events.length, 0);
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "messenger", pageId: "page-test", psid: "test-psid", sessionId: "old", message: { message_text: "old", sender_type: "customer", created_at: "2026-08-09T17:59:59.999Z" } }, scope), false);
  assert.equal(events.length, 0);
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "messenger", pageId: "page-test", psid: "test-psid", sessionId: "allowed", message: { message_text: "ok", sender_type: "customer", created_at: "2026-08-09T18:00:00.000Z" } }, scope), true);
  assert.equal(events.some((event) => event.name === "meta_reviewer:message"), true);
  assert.equal(JSON.stringify(events).includes("test-psid"), false);
  setIo(null);
});

test("API boundary rejects non-inbox APIs for the reviewer and preserves existing roles", () => {
  process.env.JWT_SECRET = "boundary-test-secret";
  const token = jwt.sign({ id: 1, role: "meta_reviewer" }, process.env.JWT_SECRET);
  const makeResponse = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  let nextCalls = 0;
  const denied = makeResponse();
  metaReviewerApiBoundary({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/settings" }, denied, () => { nextCalls += 1; });
  assert.equal(denied.statusCode, 403);
  assert.equal(nextCalls, 0);
  const allowed = makeResponse();
  metaReviewerApiBoundary({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/meta-reviewer/inbox/conversations?channel=whatsapp" }, allowed, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  const adminToken = jwt.sign({ id: 2, role: "admin" }, process.env.JWT_SECRET);
  metaReviewerApiBoundary({ headers: { authorization: `Bearer ${adminToken}` }, originalUrl: "/api/settings" }, makeResponse(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
});
