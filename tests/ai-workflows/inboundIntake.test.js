// AI Studio Phase 10 — inbound omnichannel intake: pure invariants + gating (DB-free). The end-to-end
// grounded-suggestion generation (which reuses the existing generateAiInboxReply brain and needs the DB
// + AI pipeline) is proven in the bounded live SYNTHETIC-inbound proof — no real customer, no send.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const S = await import("../../server/services/aiInboundIntakeService.js");
const TR = await import("../../server/services/aiWorkflowTriggerRegistry.js");
const { toolAutomaticPolicy, isDelegatableTool, AUTO_POLICY } = await import("../../server/services/aiWorkflowToolRegistry.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../../server/services/aiInboundIntakeService.js"), "utf8");

const withEnv = async (val, fn) => {
  const prev = process.env.AI_INBOUND_WORKFLOWS_ENABLED;
  if (val === undefined) delete process.env.AI_INBOUND_WORKFLOWS_ENABLED; else process.env.AI_INBOUND_WORKFLOWS_ENABLED = val;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.AI_INBOUND_WORKFLOWS_ENABLED; else process.env.AI_INBOUND_WORKFLOWS_ENABLED = prev; }
};

test("inbound AI modes are exactly off | suggest_only | approval_reply (no fully_automatic)", () => {
  assert.deepEqual(S.INBOUND_AI_MODES, ["off", "suggest_only", "approval_reply"]);
  assert.equal(S.INBOUND_AI_MODES.includes("fully_automatic"), false);
});

test("capability flag defaults OFF and reads the env at call time", async () => {
  await withEnv(undefined, () => assert.equal(S.isInboundWorkflowsEnabled(), false));
  await withEnv("false", () => assert.equal(S.isInboundWorkflowsEnabled(), false));
  await withEnv("true", () => assert.equal(S.isInboundWorkflowsEnabled(), true));
});

test("intake is dormant when the global capability is OFF (no DB touched)", async () => {
  await withEnv("false", async () => {
    const r = await S.handleInboundMessageIntake({ tenantId: 1, channel: "whatsapp", conversationId: "whatsapp:2010", text: "hi", providerMessageId: "m1" });
    assert.deepEqual(r, { skipped: true, reason: "global_disabled" });
  });
});

test("intake skips outbound echoes, autonomous channels, and non-text — all before any DB call", async () => {
  await withEnv("true", async () => {
    assert.equal((await S.handleInboundMessageIntake({ tenantId: 1, channel: "whatsapp", conversationId: "c", text: "hi", fromMe: true })).reason, "outbound_echo");
    assert.equal((await S.handleInboundMessageIntake({ tenantId: 1, channel: "whatsapp", conversationId: "c", text: "hi", autoReplyMode: "fully_automatic" })).reason, "autonomous_channel");
    assert.equal((await S.handleInboundMessageIntake({ tenantId: 1, channel: "whatsapp", conversationId: "c", text: "hi", autoSent: true })).reason, "autonomous_channel");
    assert.equal((await S.handleInboundMessageIntake({ tenantId: 1, channel: "whatsapp", conversationId: "c", text: "   " })).reason, "non_text");
    assert.equal((await S.handleInboundMessageIntake({ tenantId: 1, channel: "", conversationId: "", text: "hi" })).reason, "missing_context");
  });
});

test("intake NEVER throws (failure isolation) — always resolves an object", async () => {
  await withEnv("true", async () => {
    const r = await S.handleInboundMessageIntake({}); // missing everything
    assert.equal(typeof r, "object");
    assert.ok(r.skipped || r.ok === false);
  });
});

test("channel.message_received trigger: SENSITIVE, CHANNEL, gated + authorable by the capability flag", async () => {
  const t = TR.getTrigger("channel.message_received");
  assert.ok(t);
  assert.equal(t.category, TR.TRIGGER_CATEGORY.CHANNEL);
  assert.equal(t.riskLevel, "SENSITIVE");
  await withEnv("false", () => { assert.equal(TR.isTriggerAvailable("channel.message_received"), false); assert.equal(TR.isAuthorableTrigger("channel.message_received"), false); });
  await withEnv("true", () => { assert.equal(TR.isTriggerAvailable("channel.message_received"), true); assert.equal(TR.isAuthorableTrigger("channel.message_received"), true); });
});

test("trigger match is text-only and honors the channel filter", () => {
  const m = (cfg, ev) => TR.triggerMatchesEvent("channel.message_received", cfg, ev);
  assert.equal(m({ channel: "any" }, { channel: "whatsapp", messageType: "text" }), true);
  assert.equal(m({ channel: "whatsapp" }, { channel: "whatsapp", messageType: "text" }), true);
  assert.equal(m({ channel: "instagram" }, { channel: "whatsapp", messageType: "text" }), false);
  assert.equal(m({ channel: "any" }, { channel: "whatsapp", messageType: "image" }), false); // non-text never matches
});

test("SAFETY: intake reuses ONE brain, never sends, never auto-retries, never writes send/notify state", () => {
  // Reuses the existing grounded generator — no second brain, and never a provider send from here.
  assert.match(src, /generateAiInboxReply/);
  assert.equal(/sendTextMessage|sendMetaInboxOutboundMessage|sendApprovedRestockNotification/.test(src), false);
  assert.equal(/\bresend\b|autoRetry|auto_retry/i.test(src), false);
  assert.equal(/customer_notified_at\s*=/.test(src), false);
  // Idempotency + failure isolation are present.
  assert.match(src, /claimAiInboxReplyLock/);
  assert.match(src, /duplicate_intake/);
});

test("the customer-send tool stays SENSITIVE / approval-required / non-delegatable (no weaker inbound send path)", () => {
  assert.equal(toolAutomaticPolicy("messaging.send_customer"), AUTO_POLICY.APPROVAL_REQUIRED);
  assert.equal(isDelegatableTool("messaging.send_customer"), false);
});
