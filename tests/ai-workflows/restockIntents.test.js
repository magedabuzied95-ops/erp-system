// AI Studio Phase 7 — Restock Intent invariants (pure/constant checks). The DB-bound behaviors
// (variant∈product validation, out-of-stock requirement, active dedup, exact-variant matching,
// cancelled/fulfilled exclusion) are proven in the bounded live production proof, consistent with
// earlier phases. Here we lock the invariants that guard correctness + the customer_notified rule.

import test from "node:test";
import assert from "node:assert/strict";

const intent = await import("../../server/services/restockIntentService.js");
const { scoreCandidate, formatRecoveryTask } = await import("../../server/services/aiRestockRecoveryService.js");

test("intent status/source vocabularies are explicit", () => {
  assert.deepEqual(intent.INTENT_STATUSES, ["waiting", "recovery_created", "customer_notified", "fulfilled", "cancelled", "expired"]);
  assert.deepEqual(intent.INTENT_SOURCES, ["storefront", "ai_inbox", "admin", "legacy_wishlist"]);
});

test("ACTIVE statuses exclude cancelled/fulfilled/expired (so they never match a restock)", () => {
  assert.ok(intent.ACTIVE_STATUSES.includes("waiting"));
  assert.ok(intent.ACTIVE_STATUSES.includes("recovery_created"));
  assert.equal(intent.ACTIVE_STATUSES.includes("cancelled"), false);
  assert.equal(intent.ACTIVE_STATUSES.includes("fulfilled"), false);
  assert.equal(intent.ACTIVE_STATUSES.includes("expired"), false);
});

test("intent bounds are sane (default 25, hard max 100)", () => {
  assert.equal(intent.INTENT_DEFAULT_LIMIT, 25);
  assert.equal(intent.INTENT_MAX_LIMIT, 100);
});

test("recovery preference: exact variant intent ranks above a legacy product-only waiter", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const exact = scoreCandidate({ matchQuality: "EXACT_VARIANT", source: "restock_intent", createdAt: "2026-08-10T12:00:00Z" }, now).score;
  const productIntent = scoreCandidate({ matchQuality: "PRODUCT_ONLY", source: "restock_intent", createdAt: "2026-08-10T12:00:00Z" }, now).score;
  const legacy = scoreCandidate({ matchQuality: "PRODUCT_ONLY", source: "legacy_wishlist", createdAt: "2026-08-10T12:00:00Z" }, now).score;
  assert.ok(exact > productIntent, "exact variant > product-level intent");
  assert.ok(productIntent > legacy, "explicit product intent > legacy wishlist");
});

test("legacy follow-up never fabricates a size; exact one names it", () => {
  const legacy = formatRecoveryTask({ productName: "Shoe", size: "44", availableQty: 3, candidate: { matchQuality: "PRODUCT_ONLY", source: "legacy_wishlist" }, priority: { score: 0, reason: "" } });
  assert.match(legacy.note, /requested size unknown/i);
  assert.doesNotMatch(legacy.note, /Size 44/);
  const exact = formatRecoveryTask({ productName: "Shoe", size: "44", availableQty: 3, candidate: { matchQuality: "EXACT_VARIANT", size: "44" }, priority: { score: 75, reason: "" } });
  assert.match(exact.note, /Size 44 is back in stock/);
});
