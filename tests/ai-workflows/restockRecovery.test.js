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

test("scoreCandidate is deterministic; exact variant outranks legacy (Phase 7)", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const exact = scoreCandidate({ matchQuality: "EXACT_VARIANT", source: "restock_intent", customerId: 9, createdAt: "2026-08-09T12:00:00Z" }, now);
  assert.equal(exact.score, 75); // exact 40 + registered 20 + within7d 15
  assert.match(exact.reason, /exact variant/);
  const legacyFresh = scoreCandidate({ source: "legacy_wishlist", customerId: 9, createdAt: "2026-08-09T12:00:00Z" }, now);
  assert.equal(legacyFresh.score, 35); // no match bonus + registered 20 + within7d 15
  assert.ok(exact.score > legacyFresh.score);
  const guestOld = scoreCandidate({ source: "legacy_wishlist", customerId: null, createdAt: "2026-06-01T12:00:00Z" }, now);
  assert.equal(guestOld.score, 0); // legacy, guest, >30d
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

test("formatRecoveryTask states the EXACT size for a variant intent", () => {
  const { title, note } = formatRecoveryTask({
    productName: "Nike Air Max", size: "44", color: "White", availableQty: 6,
    candidate: { customerName: "Ahmed", createdAt: "2026-08-08T00:00:00Z", matchQuality: "EXACT_VARIANT", size: "44", color: "White" },
    priority: { score: 75, reason: "exact variant requested +40" },
  });
  assert.match(title, /Restock follow-up — Nike Air Max \/ Size 44/);
  assert.match(note, /Ahmed/);
  assert.match(note, /Size 44 is back in stock \(6 available\)/);
  assert.match(note, /exact requested variant/i);
  assert.match(note, /No message was sent automatically/i);
  assert.doesNotMatch(note, /\{|\}|requestId/);
});

test("formatRecoveryTask says 'requested size unknown' for a legacy product-only waiter", () => {
  const { note } = formatRecoveryTask({
    productName: "Shoe", size: "44", color: "White", availableQty: 2,
    candidate: { phone: "01001234567", createdAt: "2026-08-08T00:00:00Z", matchQuality: "PRODUCT_ONLY", source: "legacy_wishlist" },
    priority: { score: 20, reason: "registered customer +20" },
  });
  assert.match(note, /01\*\*\*\*567/);
  assert.doesNotMatch(note, /01001234567/);
  assert.match(note, /requested size unknown/i); // never fabricate the size for legacy
  assert.doesNotMatch(note, /Size 44/); // must NOT claim the legacy waiter wanted size 44
});

test("restock crossing gate still holds (only <=0 -> >0 qualifies)", () => {
  assert.equal(shouldEmitRestock({ quantity_before: 0, quantity_after: 5 }), true);
  assert.equal(shouldEmitRestock({ quantity_before: 2, quantity_after: 8 }), false);
  assert.equal(shouldEmitRestock({ quantity_before: -1, quantity_after: 3 }), true);
  assert.equal(shouldEmitRestock({ quantity_before: 7, quantity_after: 0 }), false);
});
