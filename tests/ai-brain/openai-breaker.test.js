import test from "node:test";
import assert from "node:assert/strict";

import {
  getOpenAiSupportRuntimeConfig,
  isTextGenerationAvailable,
  noteOpenAiFailure,
  noteOpenAiSuccess,
} from "../../server/services/openaiSupportService.js";

/**
 * Regression cover for what production actually did with a zero-credit account:
 * the understanding pass caught its own 429s privately and never tripped the shared
 * breaker, so every inbound message re-hit a dead API and paid the full retry latency
 * (measured at 10-12s before the deterministic fallback appeared).
 */

const quotaError = () =>
  Object.assign(new Error("You have no credits remaining. Add credits to continue using the API"), {
    status: 429,
    type: "insufficient_quota",
  });

const rateLimitError = () => Object.assign(new Error("Rate limit reached"), { status: 429, type: "rate_limit_error" });

test("running out of credits blocks far longer than a traffic spike", () => {
  noteOpenAiSuccess();
  const spikeMs = noteOpenAiFailure(rateLimitError());
  noteOpenAiSuccess();
  const quotaMs = noteOpenAiFailure(quotaError());

  assert.ok(spikeMs > 0, "a rate limit should back off");
  assert.ok(quotaMs > spikeMs * 5, `no-credits (${quotaMs}ms) must dwarf a spike backoff (${spikeMs}ms)`);
  noteOpenAiSuccess();
});

test("the block reason names billing, not traffic", () => {
  noteOpenAiSuccess();
  noteOpenAiFailure(quotaError());
  assert.equal(getOpenAiSupportRuntimeConfig().text_generation_block_reason, "openai_no_credits");

  noteOpenAiSuccess();
  noteOpenAiFailure(rateLimitError());
  assert.equal(getOpenAiSupportRuntimeConfig().text_generation_block_reason, "openai_rate_limit");
  noteOpenAiSuccess();
});

test("a quota message with no type field is still recognised", () => {
  noteOpenAiSuccess();
  const bare = Object.assign(new Error("You have no credits remaining."), { status: 429 });
  const ms = noteOpenAiFailure(bare);
  assert.ok(ms > 60_000, "the message alone must be enough to classify it as billing");
  noteOpenAiSuccess();
});

test("unrelated failures do not trip the breaker", () => {
  noteOpenAiSuccess();
  assert.equal(noteOpenAiFailure(Object.assign(new Error("socket hang up"), { status: 500 })), 0);
  assert.equal(noteOpenAiFailure(new Error("timeout")), 0);
});

test("one success clears the block", () => {
  noteOpenAiSuccess();
  noteOpenAiFailure(quotaError());
  assert.equal(getOpenAiSupportRuntimeConfig().text_generation_temporarily_blocked, true);

  noteOpenAiSuccess();
  assert.equal(getOpenAiSupportRuntimeConfig().text_generation_temporarily_blocked, false);
  assert.equal(getOpenAiSupportRuntimeConfig().text_generation_block_reason, "");
});

test("while blocked, callers are told not to try", () => {
  noteOpenAiSuccess();
  noteOpenAiFailure(quotaError());
  // This is what makes the fallback instant instead of costing another dead round trip.
  assert.equal(isTextGenerationAvailable(), false);
  noteOpenAiSuccess();
});
