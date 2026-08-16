import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeterministicUnderstanding,
  clearUnderstandingCache,
  isUnderstandingEnabled,
  summarizeUnderstanding,
  understandCustomerMessage,
} from "../../server/services/aiUnderstandingService.js";

test("dormant by default — the flag off returns the deterministic reading", async () => {
  delete process.env.AI_UNDERSTANDING_ENABLED;
  assert.equal(isUnderstandingEnabled(), false);

  const result = await understandCustomerMessage({ message: "عندكم كروكس اسود مقاس 44 ؟" });
  assert.equal(result.source, "deterministic");
  // Same legacy enum value the pipeline reads today: turning the flag off is a no-op,
  // not a degraded mode.
  assert.equal(result.legacy_intent, "AVAILABILITY_INQUIRY");
});

test("deterministic reading still extracts the size and keeps the legacy enum", () => {
  const result = buildDeterministicUnderstanding("عايز مقاس 43");
  assert.equal(result.entities.size, "43");
  assert.equal(result.legacy_intent, "SIZE_INQUIRY");
  assert.equal(result.primary_intent, "size_question");
});

test("a complaint escalates without the model", () => {
  const result = buildDeterministicUnderstanding("فيه مشكلة في الأوردر وعايز فلوسي");
  assert.equal(result.requires_human, true);
  assert.equal(result.sentiment, "negative");
  assert.equal(result.funnel_stage, "complaint");
});

test("empty message never throws and returns a usable shape", async () => {
  const result = await understandCustomerMessage({ message: "" });
  assert.equal(typeof result.primary_intent, "string");
  assert.ok(result.entities);
  assert.equal(result.entities.size, null);
});

test("a model call that fails degrades to deterministic instead of throwing", async () => {
  process.env.AI_UNDERSTANDING_ENABLED = "true";
  process.env.AI_SUPPORT_ENABLED = "true";
  clearUnderstandingCache();

  // No API key is configured in the test environment, so the gateway reports itself
  // unavailable and the service must fall through rather than reject.
  const result = await understandCustomerMessage({ message: "بكام دي؟" });
  assert.equal(result.source, "deterministic");
  assert.equal(result.legacy_intent, "PRICE_INQUIRY");

  delete process.env.AI_UNDERSTANDING_ENABLED;
  delete process.env.AI_SUPPORT_ENABLED;
});

test("summary line is compact and names only the fields that were filled", () => {
  const summary = summarizeUnderstanding(buildDeterministicUnderstanding("مقاس 44"));
  assert.match(summary, /size_question/);
  assert.match(summary, /size=44/);
  assert.match(summary, /src=deterministic/);
  assert.doesNotMatch(summary, /brand=/);
});
