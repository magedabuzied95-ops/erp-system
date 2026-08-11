// AI Studio Phase 9 — messaging lifecycle & delivery reconciliation: pure invariants (DB-free).
// The DB-transactional guarantees (persistent event idempotency, monotonic UPDATE on the message row +
// notification, provider-id correlation, out-of-order safety) are proven in the bounded live proof using
// INJECTED / SYNTHETIC provider events (no real customer, no real provider), consistent with earlier phases.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const D = await import("../../server/services/messageDeliveryReconciliationService.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const serviceSrc = readFileSync(path.join(here, "../../server/services/messageDeliveryReconciliationService.js"), "utf8");

test("canonical lifecycle is exactly pending<sending<sent<delivered<read", () => {
  assert.deepEqual(D.MESSAGE_LIFECYCLE, ["pending", "sending", "sent", "delivered", "read"]);
  const r = D.statusRank;
  assert.ok(r("pending") < r("sending") && r("sending") < r("sent") && r("sent") < r("delivered") && r("delivered") < r("read"));
});

test("provider status mapping: numeric Baileys ack levels decode correctly", () => {
  assert.equal(D.mapProviderStatus("whatsapp", 0), "pending");
  assert.equal(D.mapProviderStatus("whatsapp", 1), "sent");
  assert.equal(D.mapProviderStatus("whatsapp", 2), "delivered");
  assert.equal(D.mapProviderStatus("whatsapp", 3), "read");
  assert.equal(D.mapProviderStatus("whatsapp", 4), "read"); // played
  assert.equal(D.mapProviderStatus("whatsapp", "3"), "read"); // string-numeric too
});

test("provider status mapping: string statuses across providers", () => {
  assert.equal(D.mapProviderStatus("whatsapp", "server_ack"), "sent"); // ack level 1 = reached server
  assert.equal(D.mapProviderStatus("whatsapp", "DELIVERY_ACK"), "delivered"); // ack level 2 = delivered to device
  assert.equal(D.mapProviderStatus("whatsapp", "delivered"), "delivered");
  assert.equal(D.mapProviderStatus("whatsapp", "read"), "read");
  assert.equal(D.mapProviderStatus("whatsapp", "failed"), "failed");
  assert.equal(D.mapProviderStatus("whatsapp", "undeliverable"), "failed");
  assert.equal(D.mapProviderStatus("facebook_messenger", "delivered"), "delivered");
  assert.equal(D.mapProviderStatus("instagram", "read"), "read");
  // Unknown / ambiguous -> null (never applied; recorded as unmatched/unknown)
  assert.equal(D.mapProviderStatus("whatsapp", "banana"), null);
  assert.equal(D.mapProviderStatus("whatsapp", ""), null);
  assert.equal(D.mapProviderStatus("whatsapp", null), null);
});

test("monotonic transitions: never move backwards", () => {
  const ok = D.isAllowedTransition;
  assert.equal(ok("sent", "delivered"), true);
  assert.equal(ok("delivered", "read"), true);
  assert.equal(ok("sent", "read"), true);
  // out-of-order / regressions refused
  assert.equal(ok("read", "delivered"), false);   // read before delivered arriving late
  assert.equal(ok("delivered", "sent"), false);    // late sent after delivered
  assert.equal(ok("read", "sent"), false);         // late sent after read
  assert.equal(ok("read", "read"), false);         // duplicate read -> no transition
  assert.equal(ok("delivered", "delivered"), false); // duplicate delivered
});

test("failure semantics: failed only before a confirmed delivered/read", () => {
  const ok = D.isAllowedTransition;
  assert.equal(ok("sent", "failed"), true);       // provider accepted then failed
  assert.equal(ok("sending", "failed"), true);
  assert.equal(ok("pending", "failed"), true);
  assert.equal(ok("delivered", "failed"), false); // never overwrite a confirmed delivery with a late failure
  assert.equal(ok("read", "failed"), false);      // never overwrite a read
});

test("event sanitization: bounds fields, allowlists metadata, parses timestamps", () => {
  const big = "x".repeat(5000);
  const s = D.sanitizeDeliveryEvent({
    tenantId: "1", channel: "whatsapp" + big, providerMessageId: big, providerEventId: big,
    providerStatus: "read",
    metadata: { failure_reason: "boom", secret_token: "sk-should-drop", nested: { a: 1 }, remote_jid: "20100@s" },
    occurredAt: 1700000000, // seconds
  });
  assert.equal(s.tenantId, 1);
  assert.ok(s.channel.length <= 40 && s.providerMessageId.length <= 200 && s.providerEventId.length <= 200);
  assert.equal(s.metadata.failure_reason, "boom");
  assert.equal(s.metadata.remote_jid, "20100@s");
  assert.equal(s.metadata.secret_token, undefined); // not allowlisted -> dropped
  assert.equal(s.metadata.nested, undefined);       // objects dropped
  assert.ok(s.occurredAt instanceof Date && s.occurredAt.getUTCFullYear() === 2023); // seconds*1000
  // ISO string parses too
  assert.ok(D.sanitizeDeliveryEvent({ occurredAt: "2026-08-11T18:06:23.994Z" }).occurredAt instanceof Date);
  // garbage timestamp -> null (falls back to NOW() in SQL)
  assert.equal(D.sanitizeDeliveryEvent({ occurredAt: "not-a-date" }).occurredAt, null);
});

test("reconciler is failure-isolated and validates identifiers (never throws)", async () => {
  // Missing context / identifier must resolve, not throw. (No DB needed for the guard paths.)
  const a = await D.reconcileOutboundMessageStatus({});
  assert.equal(a.ok, false);
});

test("SAFETY: reconciler never writes customer_notified_at, never sends, never auto-retries, never uses phone identity", () => {
  // customer_notified_at is Phase 8 semantics (provider-accepted) and must NOT be WRITTEN by delivery events.
  // (A prose mention in the header comment is fine; a SQL assignment is not.)
  assert.equal(/customer_notified_at\s*=/.test(serviceSrc), false);
  assert.equal(/UPDATE\s+restock_intents/i.test(serviceSrc), false); // never touches the intent row at all
  // No sender is ever invoked from the reconciler (delivery is read-only w.r.t. the provider).
  assert.equal(/sendTextMessage|sendMetaInboxOutboundMessage|sendApprovedRestockNotification/.test(serviceSrc), false);
  // No automatic retry/resend of a customer message.
  assert.equal(/\bresend\b|autoRetry|auto_retry/i.test(serviceSrc), false);
  // Correlation is by provider_message_id only — never by phone (no phone normalizer imported).
  assert.equal(/normalizePhone|normalizeWhatsapp/.test(serviceSrc), false);
  // No new provider integration / outbound send import.
  assert.equal(/whatsappGatewayService|metaIntegrationService/.test(serviceSrc), false);
});
