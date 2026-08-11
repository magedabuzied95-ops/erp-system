// AI Studio Phase 6 — Restock Customer Recovery: pure logic (no DB).
// Matching/eligibility/dedup that touch the DB are proven in the live production proof;
// here we lock the deterministic, PII-safe, bounded, explainable pure helpers.

import test from "node:test";
import assert from "node:assert/strict";

const {
  boundLimit, maskPhone, scoreCandidate, prioritize, formatRecoveryTask,
  RECOVERY_DEFAULT_LIMIT, RECOVERY_MAX_LIMIT,
} = await import("../../server/services/aiRestockRecoveryService.js");
const { shouldEmitRestock } = await import("../../server/services/aiWorkflowTriggerService.js");

test("boundLimit clamps to [1, MAX] with a sane default", () => {
  assert.equal(boundLimit(undefined), RECOVERY_DEFAULT_LIMIT);
  assert.equal(boundLimit(0), RECOVERY_DEFAULT_LIMIT);
  assert.equal(boundLimit(-5), RECOVERY_DEFAULT_LIMIT);
  assert.equal(boundLimit(10), 10);
  assert.equal(boundLimit(9999), RECOVERY_MAX_LIMIT);
});

test("maskPhone hides the middle (PII safety)", () => {
  assert.equal(maskPhone("01001234567"), "01****567");
  assert.equal(maskPhone("123"), "***");
  assert.equal(maskPhone(""), "");
});

test("scoreCandidate is deterministic and explainable", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const fresh = scoreCandidate({ customerId: 9, createdAt: "2026-08-09T12:00:00Z", notifyBackInStock: true }, now);
  assert.equal(fresh.score, 45); // registered 20 + within7d 15 + opted 10
  assert.match(fresh.reason, /registered/);
  const guestOld = scoreCandidate({ customerId: null, createdAt: "2026-06-01T12:00:00Z", notifyBackInStock: true }, now);
  assert.equal(guestOld.score, 10); // only opted-in (older than 30d, not registered)
});

test("prioritize sorts by score desc, then oldest request first", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const ranked = prioritize([
    { requestId: 1, customerId: null, createdAt: "2026-08-10T12:00:00Z", notifyBackInStock: true }, // 15+10=25
    { requestId: 2, customerId: 7, createdAt: "2026-08-10T12:00:00Z", notifyBackInStock: true },   // 20+15+10=45
    { requestId: 3, customerId: 7, createdAt: "2026-07-20T12:00:00Z", notifyBackInStock: true },   // 20+5+10=35
  ], now);
  assert.deepEqual(ranked.map((c) => c.requestId), [2, 3, 1]);
});

test("formatRecoveryTask is employee-readable, no raw ids/JSON, notes no auto-message", () => {
  const { title, note } = formatRecoveryTask({
    productName: "Nike Air Max", size: "44", color: "White", availableQty: 6,
    candidate: { customerName: "Ahmed", createdAt: "2026-08-08T00:00:00Z" },
    priority: { score: 45, reason: "registered customer +20" },
  });
  assert.match(title, /Restock follow-up — Nike Air Max/);
  assert.match(note, /Ahmed/);
  assert.match(note, /Nike Air Max White 44/);
  assert.match(note, /6 available/);
  assert.match(note, /No message was sent automatically/i);
  assert.doesNotMatch(note, /\{|\}|requestId/); // no JSON, no technical ids
});

test("guest candidate falls back to a masked phone label", () => {
  const { note } = formatRecoveryTask({
    productName: "Shoe", availableQty: 2,
    candidate: { phone: "01001234567", createdAt: "2026-08-08T00:00:00Z" },
    priority: { score: 10, reason: "opted-in" },
  });
  assert.match(note, /01\*\*\*\*567/);
  assert.doesNotMatch(note, /01001234567/); // full phone never leaks into the task
});

test("restock crossing gate still holds (only <=0 -> >0 qualifies)", () => {
  assert.equal(shouldEmitRestock({ quantity_before: 0, quantity_after: 5 }), true);
  assert.equal(shouldEmitRestock({ quantity_before: 2, quantity_after: 8 }), false);
  assert.equal(shouldEmitRestock({ quantity_before: -1, quantity_after: 3 }), true);
  assert.equal(shouldEmitRestock({ quantity_before: 7, quantity_after: 0 }), false);
});
