import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import pool from "../../server/database/db.js";

/**
 * 2026-10-19: the playground's "متاح ايرفورس ؟" died with "Request timed out". The server cuts
 * every request at 60s (REQUEST_TIMEOUT_MS), and the OpenAI call that only re-words an answer
 * brain V2 already has was allowed 25s × 3 attempts = 75s. A slow OpenAI therefore lost the whole
 * reply instead of falling back to the grounded answer.
 */

process.env.AI_SUPPORT_ENABLED = "true";
process.env.OPENAI_AGENT_API_KEY = "test-key-not-real";
pool.query = async () => ({ rows: [] });

const { generateSupportAnswer, getSharedOpenAiClient } = await import("../../server/services/openaiSupportService.js");
const { groundedRewriteBudget } = await import("../../server/services/aiUnifiedDecisionService.js");

const SERVER_REQUEST_LIMIT_MS = 60_000;
const worstCaseMs = ({ timeoutMs, maxRetries }) => timeoutMs * (maxRetries + 1);

const withEnv = (patch, fn) => {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  Object.assign(process.env, patch);
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("the rewrite budget leaves brain V2 room inside the 60s request limit, whatever the env says", () => {
  assert.deepEqual(groundedRewriteBudget(), { timeoutMs: 15_000, maxRetries: 1 });
  for (const env of [
    {},
    { AI_GROUNDED_REWRITE_TIMEOUT_MS: "90000", AI_GROUNDED_REWRITE_MAX_RETRIES: "5" },
    { AI_GROUNDED_REWRITE_TIMEOUT_MS: "nonsense", AI_GROUNDED_REWRITE_MAX_RETRIES: "-1" },
  ]) {
    const budget = withEnv(env, groundedRewriteBudget);
    assert.ok(worstCaseMs(budget) <= 40_000, `${JSON.stringify(env)} → ${JSON.stringify(budget)}`);
  }
  assert.ok(worstCaseMs({ timeoutMs: 25_000, maxRetries: 2 }) > SERVER_REQUEST_LIMIT_MS, "the old defaults could not fit");
});

test("generateSupportAnswer hands OpenAI the caller's budget, and the defaults without one", async () => {
  const client = getSharedOpenAiClient();
  assert.ok(client, "the stub key must configure a client");
  const calls = [];
  client.responses.create = async (body, options) => {
    calls.push(options);
    return { status: "completed", output_text: "{}" };
  };
  const ask = (extra = {}) => generateSupportAnswer({
    message: "متاح ايرفورس ؟",
    trustedContext: { sources: [{ id: "live_store_context", title: "facts", content: "{}" }] },
    metadata: { tenant_id: 1 },
    ...extra,
  });

  await ask({ requestBudget: { timeoutMs: 15_000, maxRetries: 1 } });
  assert.deepEqual(calls.at(-1), { timeout: 15_000, maxRetries: 1 });

  await ask();
  assert.deepEqual(calls.at(-1), { timeout: 25_000, maxRetries: 2 }, "other callers keep their behaviour");
});

test("the grounded rewrite passes that budget", () => {
  const source = fs.readFileSync(new URL("../../server/services/aiUnifiedDecisionService.js", import.meta.url), "utf8");
  const rewrite = source.slice(source.indexOf("const rewriteStructuredDecision"), source.indexOf("[ai-grounded-rewrite:skipped]"));
  assert.match(rewrite, /requestBudget: groundedRewriteBudget\(\),/);
});

test("OpenAI's Markdown is gone before the reply reaches a channel", async () => {
  const client = getSharedOpenAiClient();
  client.responses.create = async () => ({
    status: "completed",
    output_text: JSON.stringify({
      answer: "أيوه يا فندم، متاح **Nike Air Force 1** بسعر 650 جنيه. اختار المقاس من [هنا](https://m1store-egy.com/shop/product/x).",
      confidence: 0.9,
      needs_human_support: false,
      sources_used: ["live_store_context"],
      suggested_products: [],
      suggested_actions: [],
    }),
  });
  const result = await generateSupportAnswer({
    message: "متاح ايرفورس ؟",
    trustedContext: { sources: [{ id: "live_store_context", title: "facts", content: "{}" }] },
    metadata: { tenant_id: 1 },
  });
  assert.doesNotMatch(result.answer, /\*\*|\]\(/, result.answer);
  assert.match(result.answer, /Nike Air Force 1 بسعر 650/);
});

test("a multi-grade answer does not wait for OpenAI: the owner's grade introduction goes out", async () => {
  const { rewriteStructuredDecision } = await import("../../server/services/aiUnifiedDecisionService.js");
  const client = getSharedOpenAiClient();
  let called = 0;
  client.responses.create = async () => { called += 1; return { status: "completed", output_text: "{}" }; };
  const decision = {
    intent: "product_search",
    text: "دي أقرب النتايج المتاحة:",
    product_cards: [
      { id: 25, name: "Nike Air Force 1 Sneakers - White", grade: "local", grade_label: "محلي", price: 650 },
      { id: 61, name: "Nike Air Force 1 - Olive", grade: "mirror_original", grade_label: "ميرور اوريجينال", price: 1850 },
    ],
  };
  const out = await rewriteStructuredDecision({ decision, inbound: { originalText: "متاح ايرفورس ؟" }, tenantId: 1 });
  assert.equal(called, 0);
  assert.match(out.text, /محلي — مصري، خامة محترمة/);
});

test("a bare greeting keeps its next step: it is not sent to OpenAI to be re-worded", async () => {
  const { rewriteStructuredDecision } = await import("../../server/services/aiUnifiedDecisionService.js");
  const client = getSharedOpenAiClient();
  let called = 0;
  client.responses.create = async () => { called += 1; return { status: "completed", output_text: "{}" }; };
  const greeting = { intent: "greeting", text: "وعليكم السلام ورحمة الله، أهلاً بيك يا فندم ونورتنا 🌷\nتحب أساعدك تلاقي إيه النهارده؟" };
  const out = await rewriteStructuredDecision({ decision: greeting, inbound: { originalText: "السلام عليكم" }, tenantId: 1 });
  assert.equal(called, 0);
  assert.equal(out.text, greeting.text);
});
