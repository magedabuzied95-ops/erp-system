import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "../../server/routes/aiSupport.js";
import {
  NEUTRAL_CONFIDENCE,
  NEUTRAL_VALIDATION,
  applyReplySafetyPipeline,
} from "../../server/services/aiReplySafetyPipeline.js";

const { applyChannelReplySafety } = __testing;

const DRAFT = Object.freeze({
  answer: "متاح دلوقتي ✅ السعر: 2500 جنيه",
  text: "متاح دلوقتي ✅ السعر: 2500 جنيه",
  product_cards: [{ id: 7, name: "Nike Air Force 1" }],
  suggested_products: [{ id: 7 }],
});

const withEnv = async (vars, run) => {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("the channel adapter is dormant while the flag is off", async () => {
  await withEnv({ AI_CHANNEL_GROUNDING_ENABLED: "" }, async () => {
    const result = await applyChannelReplySafety({ tenantId: 1, message: "عندكم كروكس؟", composed: DRAFT });
    assert.deepEqual(result, DRAFT, "today's behaviour must be exactly preserved");
  });
});

test("the channel adapter never runs without a tenant", async () => {
  await withEnv({ AI_CHANNEL_GROUNDING_ENABLED: "true" }, async () => {
    const result = await applyChannelReplySafety({ tenantId: null, message: "عندكم كروكس؟", composed: DRAFT });
    assert.deepEqual(result, DRAFT);
  });
});

test("an availability claim with no stock evidence is refused", async () => {
  // The property the whole sequence exists for. The draft asserts "متاح" for a product
  // the catalog cannot evidence.
  const result = await applyReplySafetyPipeline({
    tenantId: 999999,
    message: "عندكم كروكس؟",
    draft: DRAFT,
    stages: { agentLoop: false, scoring: false },
  });

  assert.equal(result.draft.grounded_by_gate, true);
  assert.ok(!/متاح دلوقتي/.test(result.draft.answer), "the unevidenced claim must not survive");
  // Cards go with the claim: leaving them re-asserts in pictures what the text refused.
  assert.deepEqual(result.draft.product_cards, []);
  assert.deepEqual(result.draft.image_cards, []);
  assert.equal(result.draft.answer, result.draft.text, "the two renderers must not disagree");
});

test("a disabled stage leaves the draft untouched", async () => {
  const result = await applyReplySafetyPipeline({
    tenantId: 999999,
    message: "عندكم كروكس؟",
    draft: DRAFT,
    stages: { agentLoop: false, grounding: false, scoring: false },
  });
  assert.deepEqual(result.draft, DRAFT);
});

test("scoring always returns a usable shape, even with no harness", async () => {
  const result = await applyReplySafetyPipeline({
    tenantId: 999999,
    message: "عندكم كروكس؟",
    draft: DRAFT,
    stages: { agentLoop: false, grounding: false },
  });

  assert.ok(result.validation, "validation must always be present");
  assert.ok(result.confidence, "confidence must always be present");
  assert.equal(typeof result.confidence.confidence_score, "number");
});

test("an empty draft is reported invalid rather than sent", async () => {
  const result = await applyReplySafetyPipeline({
    tenantId: 999999,
    message: "عندكم كروكس؟",
    draft: { answer: "", text: "" },
    stages: { agentLoop: false, grounding: false },
  });
  assert.equal(result.validation.is_valid, false);
});

test("the pipeline never throws, whatever it is handed", async () => {
  for (const draft of [{}, { answer: null }, { product_cards: "not-an-array" }]) {
    const result = await applyReplySafetyPipeline({ tenantId: 999999, message: "", draft });
    assert.ok(result?.draft && typeof result.draft === "object");
    assert.ok(result.validation && result.confidence);
  }
});

test("the agent loop stage is skipped without a product search", async () => {
  // No searchProducts means the loop has no tools to ground itself with, so running it
  // would be asking the model to answer from memory — the exact failure being avoided.
  await withEnv({ AI_AGENT_LOOP_ENABLED: "true" }, async () => {
    const result = await applyReplySafetyPipeline({
      tenantId: 999999,
      message: "عندكم كروكس؟",
      draft: DRAFT,
      stages: { grounding: false, scoring: false },
    });
    assert.equal(result.draft.answer, DRAFT.answer);
    assert.notEqual(result.draft.generation_source, "agent_loop");
  });
});

test("neutral results are frozen so a caller cannot corrupt the next request", () => {
  // These are module-level singletons handed to every caller.
  assert.throws(() => {
    NEUTRAL_VALIDATION.is_valid = false;
  });
  assert.throws(() => {
    NEUTRAL_CONFIDENCE.decision = "auto";
  });
});

test("the trace records which stages ran", async () => {
  const result = await applyReplySafetyPipeline({
    tenantId: 999999,
    message: "عندكم كروكس؟",
    draft: DRAFT,
    stages: { agentLoop: false },
  });
  assert.ok("grounding" in result.trace, "a stage that ran must say so");
  assert.equal(typeof result.trace.validation_ms, "number");
});
