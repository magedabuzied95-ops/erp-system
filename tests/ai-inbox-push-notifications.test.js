import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { isInboundCustomerMessage, pushTopic } from "../server/services/aiInboxPushService.js";

const readSource = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const clientNotifications = readSource("../src/modules/aiSupport/services/inboxNotifications.js");
const desktopSource = readSource("../src/modules/aiSupport/pages/AiInbox.jsx");
const pwaSource = readSource("../src/modules/aiSupport/pages/AiInboxPwa.jsx");
const pushWorker = readSource("../public/ai-inbox-push-sw.js");
const inboxWorker = readSource("../public/inbox-sw.js");
const socketUtil = readSource("../server/utils/socket.js");

// --- who gets a notification -------------------------------------------------

test("only inbound customer messages notify", () => {
  for (const inbound of [
    { sender_type: "customer" },
    { sender_type: "CUSTOMER" },
    { customer_message: "الحذاء ده متوفر؟" },
    { sender_type: "customer", message_type: "image" },
  ]) {
    assert.equal(isInboundCustomerMessage(inbound), true, `${JSON.stringify(inbound)} should notify`);
  }

  // Both directions of a conversation ride the same `ai_inbox:message` event, so
  // an over-broad gate turns every AI/staff reply into a buzz on the operator's phone.
  for (const outbound of [
    { sender_type: "staff", staff_message: "أهلاً" },
    { sender_type: "staff", customer_message: "quoted text" },
    { sender_type: "ai", ai_answer: "أيوه متوفر" },
    { sender_type: "agent" },
    { sender_type: "system" },
    { sender_type: "customer", is_echo: true },
    { ai_answer: "reply with no sender_type" },
    {},
  ]) {
    assert.equal(isInboundCustomerMessage(outbound), false, `${JSON.stringify(outbound)} must NOT notify`);
  }
});

test("the client gate matches the server gate exactly", () => {
  // `/admin/ai-inbox` and `/inbox` are separate implementations of one product;
  // a rule that lives in two places drifts. Compare full bodies, not signatures.
  const clientBody = /export const isInboundCustomerMessage = \(message = \{\}\) => \{([\s\S]*?)\n\};/.exec(clientNotifications);
  const serverBody = /export const isInboundCustomerMessage = \(message = \{\}\) => \{([\s\S]*?)\n\};/.exec(
    readSource("../server/services/aiInboxPushService.js")
  );
  assert.ok(clientBody, "client gate not found");
  assert.ok(serverBody, "server gate not found");
  const normalize = (value) => value.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();
  assert.equal(normalize(clientBody[1]), normalize(serverBody[1]), "client and server inbound gates have diverged");
});

// --- the header that silently killed every send ------------------------------

test("push topic is URL-safe base64 even when the tag carries a conversation id", () => {
  // web-push validates the Topic header as URL-safe base64 and throws BEFORE it
  // sends. Conversation ids carry a colon, so passing a tag through raw made every
  // push fail with "Unsupported characters set".
  const urlSafe = /^[A-Za-z0-9_-]+$/;
  for (const tag of [
    "ai-inbox-whatsapp:201024960585",
    "ai-inbox-facebook_messenger:987654321",
    "ai-inbox-instagram:17841400000000000",
    "ai-inbox-whatsapp:lid:123456789012",
  ]) {
    const topic = pushTopic(tag);
    assert.ok(urlSafe.test(topic), `${tag} produced an invalid Topic header: ${topic}`);
    assert.ok(topic.length <= 32, `${tag} produced a Topic longer than 32 chars`);
  }
  assert.equal(pushTopic(""), undefined);
});

// --- wiring ------------------------------------------------------------------

test("the socket tap fires for ai_inbox:message and nothing else", () => {
  assert.match(socketUtil, /notifyAiInboxPush/, "emitToRooms has no push tap");
  assert.match(
    socketUtil,
    /if \(eventName === "ai_inbox:message"\) notifyAiInboxPush\(payload\)/,
    "the tap must be gated on the ai_inbox:message event name"
  );
});

test("both inbox surfaces notify on inbound realtime messages", () => {
  for (const [name, source] of [["AiInbox.jsx", desktopSource], ["AiInboxPwa.jsx", pwaSource]]) {
    assert.match(source, /handleInboundInboxMessage\(/, `${name} never calls handleInboundInboxMessage`);
    assert.match(source, /primeInboxChime\(\)/, `${name} never primes the chime, so the first message is silent`);
    assert.match(source, /refreshInboxPushSubscription\(/, `${name} never refreshes its push subscription`);
    assert.match(source, /InboxNotificationBell/, `${name} has no way to grant notification permission`);
  }
});

// --- worker safety -----------------------------------------------------------

test("the push worker never caches anything", () => {
  // inbox-sw.js is cache-first for /assets/. At the root scope this worker uses,
  // that would pin a stale bundle across the WHOLE ERP.
  assert.doesNotMatch(pushWorker, /addEventListener\(\s*"fetch"/, "the push worker must not handle fetch");
  assert.doesNotMatch(pushWorker, /caches\./, "the push worker must not touch the cache API");
  assert.match(pushWorker, /addEventListener\(\s*"push"/, "the push worker must handle push");
  assert.match(pushWorker, /addEventListener\(\s*"notificationclick"/, "the push worker must handle notificationclick");
});

test("inbox-sw cache version and its registration query stay in step", () => {
  // A stale worker keeps serving an old bundle, so a shipped fix looks dead.
  const version = /const VERSION = "ai-inbox-v(\d+)";/.exec(inboxWorker);
  const registered = /inbox-sw\.js\?v=(\d+)/.exec(pwaSource);
  assert.ok(version, "inbox-sw.js VERSION not found");
  assert.ok(registered, "inbox-sw.js registration not found in AiInboxPwa.jsx");
  assert.equal(
    registered[1],
    version[1],
    "bumping inbox-sw VERSION without bumping the ?v= leaves clients on the old worker"
  );
});
