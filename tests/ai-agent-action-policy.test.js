import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AGENT_ACTIONS,
  agentActionGuidance,
  agentActionGuidanceLines,
  applyAgentActionUpdates,
  isAgentActionEnabled,
  resolveAgentActions,
} from "../server/services/aiAgentActionPolicy.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("a switch that maps onto an existing flag writes THAT flag, not a second copy", () => {
  const next = applyAgentActionUpdates({}, { followups: { enabled: false } });
  assert.equal(next.followups_enabled, false);
  // The parallel store must not also claim an answer for it.
  assert.equal(next.action_policies?.followups?.enabled, undefined);
  assert.equal(isAgentActionEnabled(next, "followups"), false);
});

test("the order-confirmation switch is the inverse of the approval requirement", () => {
  const off = applyAgentActionUpdates({}, { confirm_order: { enabled: false } });
  assert.equal(off.require_human_approval_before_confirm, true);
  assert.equal(isAgentActionEnabled(off, "confirm_order"), false);

  const on = applyAgentActionUpdates({}, { confirm_order: { enabled: true } });
  assert.equal(on.require_human_approval_before_confirm, false);
  assert.equal(isAgentActionEnabled(on, "confirm_order"), true);
});

test("a SENSITIVE action is reported as never automatic even when switched on", () => {
  const on = applyAgentActionUpdates({}, { confirm_order: { enabled: true } });
  const confirm = resolveAgentActions(on).find((action) => action.id === "confirm_order");
  assert.equal(confirm.enabled, true);
  assert.equal(confirm.risk, "SENSITIVE");
  assert.equal(confirm.never_automatic, true);
});

test("handing off to a human cannot be switched off", () => {
  const attempted = applyAgentActionUpdates({}, { handoff_to_human: { enabled: false } });
  assert.equal(isAgentActionEnabled(attempted, "handoff_to_human"), true);
  const handoff = resolveAgentActions(attempted).find((action) => action.id === "handoff_to_human");
  assert.equal(handoff.locked, true);
  assert.equal(handoff.enabled, true);
});

test("the two actions with no prior flag are stored and honoured", () => {
  const next = applyAgentActionUpdates({}, {
    request_address: { enabled: false },
    send_product_card: { enabled: false, guidance: "ابعت الكروت بس لو العميل سأل عن موديل" },
  });
  assert.equal(isAgentActionEnabled(next, "request_address"), false);
  assert.equal(isAgentActionEnabled(next, "send_product_card"), false);
  assert.equal(agentActionGuidance(next, "send_product_card"), "ابعت الكروت بس لو العميل سأل عن موديل");
});

test("defaults keep every action working before anyone touches a switch", () => {
  const resolved = resolveAgentActions({});
  const enabled = Object.fromEntries(resolved.map((action) => [action.id, action.enabled]));
  assert.equal(enabled.request_address, true);
  assert.equal(enabled.send_product_card, true);
  assert.equal(enabled.create_draft_order, true);
  assert.equal(enabled.followups, true);
  assert.equal(enabled.suggested_replies, true);
  assert.equal(enabled.handoff_to_human, true);
  // Confirming an order on the agent's own is the one thing that stays off until asked for.
  assert.equal(enabled.confirm_order, false);
});

test("guidance for a disabled action never reaches the model", () => {
  const settings = applyAgentActionUpdates({}, {
    request_address: { enabled: false, guidance: "اطلب العنوان بدري" },
    send_product_card: { enabled: true, guidance: "كارت واحد لكل لون" },
  });
  const lines = agentActionGuidanceLines(settings);
  assert.ok(lines.some((line) => line.includes("كارت واحد لكل لون")));
  assert.ok(!lines.some((line) => line.includes("اطلب العنوان بدري")));
});

test("an empty guidance box contributes no line at all", () => {
  const settings = applyAgentActionUpdates({}, { send_product_card: { enabled: true, guidance: "   " } });
  assert.deepEqual(agentActionGuidanceLines(settings), []);
});

test("guidance is length-capped so one box cannot swallow the prompt", () => {
  const settings = applyAgentActionUpdates({}, { request_address: { guidance: "ا".repeat(5000) } });
  assert.equal(agentActionGuidance(settings, "request_address").length, 2000);
});

test("every action declares where it is enforced", () => {
  AGENT_ACTIONS.forEach((action) => {
    assert.ok(action.enforcedAt, `${action.id} has no enforcement site`);
    assert.ok(["READ", "WRITE", "SENSITIVE"].includes(action.risk), `${action.id} has no risk level`);
  });
});

test("the address-link switch is actually read at both channel call sites", () => {
  const whatsapp = read("../server/services/whatsappSalesFlowService.js");
  const meta = read("../server/services/metaIntegrationService.js");
  assert.match(whatsapp, /agentActionAllowed\(\{ tenantId, actionId: "request_address" \}\)/);
  assert.match(whatsapp, /whatsapp_address_link_disabled/);
  assert.match(meta, /actionId: "request_address"/);
});

test("the product-card switch is read once per reply and empties the card list", () => {
  const orchestrator = read("../server/services/aiConversationOrchestrator.js");
  assert.match(orchestrator, /agentActionAllowed\(\{ tenantId, actionId: "send_product_card" \}\)/);
  assert.match(orchestrator, /allowProductCards === false \? \[\]/);
});

test("action guidance is injected into the instruction block", () => {
  const persona = read("../server/services/aiPersonaService.js");
  assert.match(persona, /agentActionGuidanceLines\(settings \|\| \{\}\)/);
  assert.match(persona, /persona\.action_guidance/);
  // Derived at read time; persisting a copy would let the two drift.
  assert.match(persona, /delete nextPersona\.action_guidance/);
});
