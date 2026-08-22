// AI Studio Phase 8 — customer restock messaging: pure invariants (DB-free). The DB-transactional
// guarantees (mode gate, send idempotency, customer_notified_at-on-success-only, legacy/cancelled
// exclusion, delegated-grant-cannot-bypass) are proven in the bounded live proof using an INJECTED
// fake sender (no provider is ever called), consistent with earlier phases.

import test from "node:test";
import assert from "node:assert/strict";

const N = await import("../../server/services/restockNotificationService.js");
const { toolAutomaticPolicy, isDelegatableTool, automaticDecision, AUTO_POLICY } = await import("../../server/services/aiWorkflowToolRegistry.js");

test("messaging modes are exactly off | preview_only | approval_send (no fully_automatic)", () => {
  assert.deepEqual(N.MESSAGING_MODES, ["off", "preview_only", "approval_send"]);
  assert.equal(N.MESSAGING_MODES.includes("fully_automatic"), false);
});

test("only waiting/recovery_created intents are sendable (cancelled/fulfilled/expired excluded)", () => {
  assert.deepEqual(N.SENDABLE_INTENT_STATUSES, ["waiting", "recovery_created"]);
  for (const s of ["cancelled", "fulfilled", "expired", "customer_notified"]) assert.equal(N.SENDABLE_INTENT_STATUSES.includes(s), false);
});

test("deterministic draft is grounded, needs no LLM, invents nothing", () => {
  const d = N.buildDeterministicDraft({ customerName: "أحمد", productName: "Nike Air Max", color: "أبيض", size: "44" });
  assert.match(d, /أحمد/);
  assert.match(d, /Nike Air Max/);
  assert.match(d, /مقاس 44/);
  assert.match(d, /أبيض/);
  assert.match(d, /اتوفر/);
  // never fabricate discount/price/reservation/urgency/expiry
  assert.doesNotMatch(d, /خصم|جنيه|EGP|احجز|النهارده فقط|ينتهي|سعر/);
});

test("draft with unknown customer uses a neutral greeting (no fake name)", () => {
  const d = N.buildDeterministicDraft({ productName: "Shoe", size: "40" });
  assert.match(d, /^ازيك حضرتك؟/);
  assert.doesNotMatch(d, /undefined|null/);
});

test("messaging.send_customer stays SENSITIVE / approval-required / NOT delegatable (grant cannot bypass)", () => {
  assert.equal(toolAutomaticPolicy("messaging.send_customer"), AUTO_POLICY.APPROVAL_REQUIRED);
  assert.equal(isDelegatableTool("messaging.send_customer"), false);
  // even a truthy "grant" must not authorize an automatic SENSITIVE send
  assert.equal(automaticDecision("messaging.send_customer", true).allow, false);
  assert.match(automaticDecision("messaging.send_customer", true).reason, /approval/i);
});

test("notification status vocabulary is explicit and includes a failed state", () => {
  for (const s of ["draft", "pending_approval", "approved", "sending", "sent", "rejected", "failed", "cancelled"]) assert.ok(N.NOTIF_STATUSES.includes(s));
});
