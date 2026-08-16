import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "../../server/routes/aiSupport.js";

const { applyChannelGroundingGate, applyChannelAgentLoop } = __testing;

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

test("grounding is dormant while its flag is off", async () => {
  await withEnv({ AI_CHANNEL_GROUNDING_ENABLED: "" }, async () => {
    const result = await applyChannelGroundingGate({ tenantId: 1, message: "عندكم كروكس؟", composed: DRAFT });
    assert.deepEqual(result, DRAFT, "the draft must pass through untouched");
  });
});

test("grounding never runs without a tenant", async () => {
  // No tenant means no catalog to ground against; running anyway would be guessing.
  await withEnv({ AI_CHANNEL_GROUNDING_ENABLED: "true" }, async () => {
    const result = await applyChannelGroundingGate({ tenantId: null, message: "عندكم كروكس؟", composed: DRAFT });
    assert.deepEqual(result, DRAFT);
  });
});

test("an availability claim with no stock evidence is refused on the channel path", async () => {
  // The headline safety property, and the reason this had to land before the agent
  // loop. The draft asserts "متاح" for a product the catalog cannot evidence; the gate
  // replaces the claim with an honest one.
  await withEnv({ AI_CHANNEL_GROUNDING_ENABLED: "true" }, async () => {
    const result = await applyChannelGroundingGate({ tenantId: 999999, message: "عندكم كروكس؟", composed: DRAFT });

    assert.equal(result.grounded_by_gate, true, "the gate must report that it acted");
    assert.notEqual(result.answer, DRAFT.answer, "the unevidenced claim must not survive");
    assert.ok(!/متاح دلوقتي/.test(result.answer), "the reply must stop asserting availability");
    // Cards are dropped with the claim: leaving them would re-assert in pictures the
    // availability the text just refused to state.
    assert.deepEqual(result.product_cards, []);
    assert.deepEqual(result.image_cards, []);
    // answer and text must not diverge, or the two renderers disagree.
    assert.equal(result.answer, result.text);
  });
});

test("grounding never throws, whatever it is handed", async () => {
  // A live customer is waiting on this reply, so every failure path must degrade to the
  // composed draft rather than propagate.
  await withEnv({ AI_CHANNEL_GROUNDING_ENABLED: "true" }, async () => {
    for (const composed of [{}, { answer: null }, { product_cards: "not-an-array" }]) {
      const result = await applyChannelGroundingGate({ tenantId: 999999, message: "", composed });
      assert.ok(result && typeof result === "object");
    }
  });
});

test("the agent loop is dormant while its flag is off", async () => {
  await withEnv({ AI_AGENT_LOOP_ENABLED: "" }, async () => {
    const result = await applyChannelAgentLoop({ tenantId: 1, message: "عندكم كروكس؟", composed: DRAFT });
    assert.deepEqual(result, DRAFT);
  });
});

test("the agent loop never runs without a tenant", async () => {
  await withEnv({ AI_AGENT_LOOP_ENABLED: "true" }, async () => {
    const result = await applyChannelAgentLoop({ tenantId: null, message: "عندكم كروكس؟", composed: DRAFT });
    assert.deepEqual(result, DRAFT);
  });
});

test("the agent loop falls back to the composer when it cannot run", async () => {
  // Flag on but no OpenAI credentials in this environment: the loop reports not-ok and
  // the deterministic answer must survive unchanged.
  await withEnv({ AI_AGENT_LOOP_ENABLED: "true" }, async () => {
    const result = await applyChannelAgentLoop({ tenantId: 999999, message: "عندكم كروكس؟", composed: DRAFT });
    assert.equal(result.answer, DRAFT.answer);
    assert.notEqual(result.generation_source, "agent_loop");
  });
});

test("both stages together are a no-op when both flags are off", async () => {
  await withEnv({ AI_AGENT_LOOP_ENABLED: "", AI_CHANNEL_GROUNDING_ENABLED: "" }, async () => {
    const afterLoop = await applyChannelAgentLoop({ tenantId: 1, message: "عندكم كروكس؟", composed: DRAFT });
    const afterGate = await applyChannelGroundingGate({ tenantId: 1, message: "عندكم كروكس؟", composed: afterLoop });
    assert.deepEqual(afterGate, DRAFT, "today's behaviour must be exactly preserved");
  });
});
