import assert from "node:assert/strict";
import test from "node:test";

import { buildAiSupportTrustedContext } from "../../server/services/aiSupportContextService.js";

/**
 * These cover the seam where the channel path (Messenger / Instagram / WhatsApp, via
 * POST /api/ai-support/chat) gained the same structured read of the customer the AI
 * Inbox already had. tenantId is null throughout so nothing touches the database —
 * the contract under test is the shape, not the catalog.
 */

test("the channel path returns an understanding alongside the legacy intent", async () => {
  const result = await buildAiSupportTrustedContext({ tenantId: null, message: "عندكم بوما مقاس 44؟" });

  assert.ok(result.understanding, "understanding must be present on the channel path");
  // The legacy regex intent is untouched — it still owns routing.
  assert.ok(result.intent, "intent must survive unchanged");
  assert.equal(result.understanding.primary_intent, "product_availability");
});

test("entities the regex intent could not see are now read", async () => {
  const result = await buildAiSupportTrustedContext({ tenantId: null, message: "عندكم بوما مقاس 44؟" });
  const entities = result.understanding.entities;

  // Puma was invisible to this path: its brand detection knew three brands, none Arabic.
  assert.equal(entities.brand, "Puma");
  assert.equal(entities.size, "44");
});

test("understanding is present on the early-return paths too", async () => {
  // A greeting returns long before the product branch. The wrapper exists so this
  // path carries the field as well — an inconsistent shape is worse than no field.
  const greeting = await buildAiSupportTrustedContext({ tenantId: null, message: "السلام عليكم" });
  assert.ok("understanding" in greeting, "greeting path must carry the field");
  assert.equal(greeting.understanding.primary_intent, "greeting");
});

test("a greeting returns a usable trusted context instead of throwing", async () => {
  // Regression: this branch called a const declared ~40 lines below it, so every
  // greeting on the channel path threw "Cannot access before initialization" rather
  // than returning a greeting reply.
  const result = await buildAiSupportTrustedContext({ tenantId: null, message: "السلام عليكم" });

  assert.equal(result.greeting_only_mode, true);
  assert.ok(result.trustedContext, "a greeting must still carry a trusted context");
  assert.deepEqual(result.trustedContext.sources, []);
  assert.deepEqual(result.trustedContext.employee_corrections, []);
  assert.ok(result.directResponse, "the greeting reply itself must be produced");
});

test("an empty message never throws and still returns the shape", async () => {
  const result = await buildAiSupportTrustedContext({ tenantId: null, message: "" });
  assert.ok("understanding" in result);
  assert.ok(result.intent);
});

test("a complaint is read as requiring a human on this path", async () => {
  const result = await buildAiSupportTrustedContext({
    tenantId: null,
    message: "انتوا نصابين، بقالي اسبوع مستني",
  });
  assert.equal(result.understanding.requires_human, true);
});
