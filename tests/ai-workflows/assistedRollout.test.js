// AI Studio Phase 11 — Live Assisted AI Inbox Rollout: invariants + source guards (DB-free). The
// DB-transactional guarantees (server-side stale block, per-channel gating, burst coalescing) are proven
// in the bounded live/synthetic proof, consistent with earlier phases. No autonomous send is ever added.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const S = await import("../../server/services/aiInboundIntakeService.js");
const { toolAutomaticPolicy, isDelegatableTool, AUTO_POLICY } = await import("../../server/services/aiWorkflowToolRegistry.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, p), "utf8");
const intakeSrc = read("../../server/services/aiInboundIntakeService.js");
const sendSrc = read("../../server/routes/aiAgentOrders.js");
const brainSrc = read("../../server/services/aiSalesAgentService.js");
const logSrc = read("../../server/services/aiSupportLogService.js");

test("assisted channels are exactly messenger/instagram/whatsapp; modes still have no fully_automatic", () => {
  assert.deepEqual(S.ASSISTED_CHANNELS, ["facebook_messenger", "instagram", "whatsapp"]);
  assert.deepEqual(S.INBOUND_AI_MODES, ["off", "suggest_only", "approval_reply"]);
  assert.equal(S.INBOUND_AI_MODES.includes("fully_automatic"), false);
});

test("intake stays dormant + failure-isolated (global capability OFF → skip, never throw)", async () => {
  const prev = process.env.AI_INBOUND_WORKFLOWS_ENABLED;
  delete process.env.AI_INBOUND_WORKFLOWS_ENABLED;
  try {
    const r = await S.handleInboundMessageIntake({ tenantId: 1, channel: "facebook_messenger", conversationId: "facebook_messenger:1", text: "hi", providerMessageId: "m1" });
    assert.deepEqual(r, { skipped: true, reason: "global_disabled" });
  } finally { if (prev !== undefined) process.env.AI_INBOUND_WORKFLOWS_ENABLED = prev; }
});

test("MANDATORY: server-side stale guard exists on the canonical send path", () => {
  assert.match(sendSrc, /STALE_SUGGESTION/);
  assert.match(sendSrc, /hasNewerCustomerMessage/);
  // only blocks the UNEDITED suggestion (edited/manual replies still send)
  assert.match(sendSrc, /envText\(aiReplyDraft\.text\) === messageText/);
  // reuses the existing canonical send — no new sender introduced in this route change
  assert.equal(/new\s+Sender|sendApprovedRestockNotification/.test(sendSrc.slice(sendSrc.indexOf("STALE_SUGGESTION") - 400, sendSrc.indexOf("STALE_SUGGESTION") + 400)), false);
});

test("hasNewerCustomerMessage compares by source message id (precise) or timestamp fallback", () => {
  assert.match(logSrc, /export const hasNewerCustomerMessage/);
  assert.match(logSrc, /sender_type, ''\) = 'customer'/);
  assert.match(logSrc, /afterMessageId/);
});

test("draft carries source_message_id for stale linkage (threaded from intake)", () => {
  assert.match(brainSrc, /source_message_id: resolvedSourceMessageId/);
  assert.match(brainSrc, /sourceMessageId = null/); // generateAiInboxReply accepts it
  assert.match(intakeSrc, /sourceMessageId: canonicalMessageId/);
});

test("per-channel gating + burst coalescing + metrics exist; no autonomous send", () => {
  assert.match(intakeSrc, /channel_not_assisted/);
  assert.match(intakeSrc, /scheduleDebouncedGeneration/);
  assert.match(intakeSrc, /DEBOUNCE_MS/);
  assert.match(intakeSrc, /recordAssistedOutcome/);
  // still never sends / never writes stock/orders from the intake path
  assert.equal(/sendTextMessage|sendMetaInboxOutboundMessage|adjustVariantStock/.test(intakeSrc), false);
  // "fully_automatic" is only referenced by the autonomous-channel SKIP guard (avoid double-processing),
  // never introduced as a new assisted mode.
  assert.match(intakeSrc, /=== "fully_automatic"\) return \{ skipped: true, reason: "autonomous_channel"/);
});

test("kill switch = tenant mode off (no deploy); intake gate ordering keeps capability first", () => {
  // mode 'off' is the tenant kill switch; the intake checks global capability, then mode, then channel.
  const idxCap = intakeSrc.indexOf("global_disabled");
  const idxMode = intakeSrc.indexOf("tenant_mode_off");
  const idxChan = intakeSrc.indexOf("channel_not_assisted");
  assert.ok(idxCap > 0 && idxMode > idxCap && idxChan > idxMode);
});

test("customer-send tool stays SENSITIVE / approval-required / non-delegatable (no weaker assisted send path)", () => {
  assert.equal(toolAutomaticPolicy("messaging.send_customer"), AUTO_POLICY.APPROVAL_REQUIRED);
  assert.equal(isDelegatableTool("messaging.send_customer"), false);
});
