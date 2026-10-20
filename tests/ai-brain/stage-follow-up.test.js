import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { __testing, SEQUENCE_TRIGGERS } from "../../server/services/messageSequencesService.js";
import { __setAgentClientForTests, writeFollowUpMessage } from "../../server/services/aiClaudeSalesAgentService.js";

/**
 * GENI's follow-up, here (2026-10-20): a sequence tied to a CRM stage, steps the AI writes from the
 * conversation, stop on reply, then the lead moves to "if replied" / "if no reply".
 */

const { normalizeSequenceInput, normalizeSteps, mapEnrollment } = __testing;
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a stage sequence names its stage and where the lead goes after", () => {
  assert.ok(SEQUENCE_TRIGGERS.includes("lead_stage"));
  const input = normalizeSequenceInput({
    name: "متابعة المهتمين",
    trigger_type: "lead_stage",
    trigger_stage: "interested",
    move_to_if_replied: "negotiation",
    move_to_if_no_reply: "lost",
    finalize_after_minutes: 1440,
    steps: [{ delay_minutes: 60, mode: "ai", ai_instruction: "فكّره بالموديل" }],
  });
  assert.equal(input.trigger_stage, "interested");
  assert.equal(input.move_to_if_replied, "negotiation");
  assert.equal(input.move_to_if_no_reply, "lost");
  assert.equal(input.finalize_after_minutes, 1440);
  assert.throws(() => normalizeSequenceInput({ name: "x", trigger_type: "lead_stage", steps: [{ body: "hi" }] }), /stage that starts it/);
  assert.throws(() => normalizeSequenceInput({ name: "x", trigger_type: "manual", move_to_if_replied: "vip", steps: [{ body: "hi" }] }), /Unknown stage/);
});

test("an AI step needs only its instruction; a text step keeps working as before", () => {
  const steps = normalizeSteps([
    { delay_minutes: 30, mode: "ai", ai_instruction: "اسأله عن المقاس" },
    { delay_minutes: 120, body: "لسه مهتم؟" },
    { delay_minutes: 120, mode: "ai", ai_instruction: "" }, // nothing to send — dropped
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].mode, "ai");
  assert.equal(steps[1].mode, "text");
  assert.equal(steps[1].ai_instruction, "");
});

test("an enrollment past its last step is waiting for the result", () => {
  const row = { status: "active", current_step: 2, steps: [{}, {}], move_to_if_no_reply: "lost" };
  assert.equal(mapEnrollment(row).awaiting_result, true);
  assert.equal(mapEnrollment({ ...row, current_step: 1 }).awaiting_result, false);
});

test("reply, last step and grace period each move the lead", () => {
  const source = read("../../server/services/messageSequencesService.js");
  // A reply while the sequence runs → "if replied".
  assert.match(source, /stopped_reason = 'customer_replied'[\s\S]{0,400}setConversationLeadStage\(\{ tenantId: safeTenantId, sessionId: row\.session_id, stage: row\.move_to_if_replied \}\)/);
  // After the last step it waits finalize_after_minutes instead of completing.
  assert.match(source, /if \(!nextStep && hasStageResult\) \{/);
  // Then the result decides the stage.
  assert.match(source, /const nextStage = text\(replied \? row\.move_to_if_replied : row\.move_to_if_no_reply\);/);
  // Leaving a stage stops that stage's sequences.
  assert.match(source, /stopped_reason = 'stage_changed'/);
  const routes = read("../../server/routes/aiAgentOrders.js");
  assert.equal((routes.match(/onLeadStageChanged\(\{ tenantId, sessionId:/g) || []).length, 2, "both stage pickers start the stage's follow-up");
});

test("the AI step is written from the conversation, and falls back on failure", async () => {
  const saved = { enabled: process.env.AI_CLAUDE_AGENT_ENABLED, key: process.env.ANTHROPIC_API_KEY };
  process.env.AI_CLAUDE_AGENT_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-key";
  const seen = [];
  try {
    __setAgentClientForTests({
      beta: { messages: { create: async (params) => { seen.push(params); return { stop_reason: "end_turn", content: [{ type: "text", text: "لسه حابة الإير فورس الأبيض مقاس 39 يا أستاذة؟ 😊" }] }; } } },
    });
    const loaders = {
      persona: async () => ({}),
      knowledgeBase: async () => ({ knowledge_base: { store_name: "M1" } }),
      history: async () => [{ role: "user", content: "عايزة اير فورس ابيض 39" }, { role: "assistant", content: "أيوه متاح 👇" }],
    };
    const text = await writeFollowUpMessage({ customerName: "Heba", instruction: "فكّرها بالموديل", stepNumber: 1, totalSteps: 2, loaders });
    assert.match(text, /الإير فورس/);
    const last = seen[0].messages.at(-1);
    assert.equal(last.role, "user");
    assert.match(last.content, /<follow_up_task>/);
    assert.match(last.content, /فكّرها بالموديل/);
    assert.match(seen[0].system[1].text, /صيغة المؤنث/, "Heba is addressed as a woman");

    __setAgentClientForTests({ beta: { messages: { create: async () => { throw new Error("down"); } } } });
    assert.equal(await writeFollowUpMessage({ customerName: "Heba", instruction: "x", loaders }), "");
    process.env.AI_CLAUDE_AGENT_ENABLED = "";
    assert.equal(await writeFollowUpMessage({ customerName: "Heba", instruction: "x", loaders }), "", "off means the fixed text goes");
  } finally {
    process.env.AI_CLAUDE_AGENT_ENABLED = saved.enabled ?? "";
    process.env.ANTHROPIC_API_KEY = saved.key ?? "";
    __setAgentClientForTests(null);
  }
});
