import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_GLOBAL_SETTING_KEYS,
  isAiGlobalSettingKey,
  splitAiSettingsPayload,
} from "../server/utils/aiSettingsPartition.js";

const routeSource = readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
const agentServiceSource = readFileSync(
  new URL("../server/services/aiSalesAgentService.js", import.meta.url),
  "utf8"
);

test("agent behaviour keys are never routed to the global ai_settings row", () => {
  const { global, agent } = splitAiSettingsPayload({
    tenant_id: 7,
    autoReplyMode: "fully_automatic",
    tone: "luxury",
    safety: { no_fake_price: true },
    debug: { show_live_logs: false },
    ai_shoe_cover_enabled: false,
    max_discount_percent: 15,
    handoff_rules: { angry_customer: false },
    forbidden_phrases: ["كنموذج لغوي"],
    followups_enabled: false,
    agent_name: "بائع M1",
  });

  assert.deepEqual(Object.keys(global).sort(), ["ai_shoe_cover_enabled", "autoReplyMode", "debug", "safety", "tone"]);
  assert.deepEqual(Object.keys(agent).sort(), [
    "agent_name",
    "followups_enabled",
    "forbidden_phrases",
    "handoff_rules",
    "max_discount_percent",
  ]);
  // The agent reads these; landing them in the global row is the bug this split exists to prevent.
  assert.equal(agent.max_discount_percent, 15);
  assert.equal(agent.handoff_rules.angry_customer, false);
  assert.equal(global.max_discount_percent, undefined);
  assert.equal(global.handoff_rules, undefined);
});

test("the tenant id is addressing, not a setting, and reaches neither store", () => {
  const { global, agent } = splitAiSettingsPayload({ tenant_id: 3, tenantId: 3, tone: "casual" });
  assert.equal(global.tenant_id, undefined);
  assert.equal(global.tenantId, undefined);
  assert.equal(agent.tenant_id, undefined);
  assert.equal(agent.tenantId, undefined);
  assert.equal(global.tone, "casual");
});

test("splitting a non-object payload yields two empty halves instead of throwing", () => {
  for (const payload of [null, undefined, "settings", 42, []]) {
    const { global, agent } = splitAiSettingsPayload(payload);
    assert.deepEqual(global, {});
    assert.deepEqual(agent, {});
  }
});

test("the global key list stays the exact set ai_settings persists", () => {
  assert.deepEqual([...AI_GLOBAL_SETTING_KEYS].sort(), [
    "ai_shoe_cover_enabled",
    "autoReplyMode",
    "debug",
    "safety",
    "tone",
  ]);
  assert.equal(isAiGlobalSettingKey("autoReplyMode"), true);
  assert.equal(isAiGlobalSettingKey("max_discount_percent"), false);
});

test("PUT /ai-agent/settings writes the agent half to the tenant-scoped store", () => {
  const handler = routeSource.slice(routeSource.indexOf('router.put("/settings"'));
  const body = handler.slice(0, handler.indexOf("router.get(\"/settings/ai-assistant-global\""));
  assert.match(body, /splitAiSettingsPayload\(incoming\)/);
  assert.match(body, /updateAiAgentSettings\(\{\s*tenantId,\s*settings: agent\s*\}\)/);
  assert.match(body, /updateAISettings\(global\)/);
});

test("updateAiAgentSettings merges onto the stored row, never onto bare defaults", () => {
  const fn = agentServiceSource.slice(agentServiceSource.indexOf("export const updateAiAgentSettings"));
  const body = fn.slice(0, fn.indexOf("export const detectSalesObjection"));
  // The row is shared with aiPersonaService (persona) and the style-learning flags. A patch that
  // rebuilt the object from DEFAULT_SETTINGS alone would silently wipe whatever it did not send.
  assert.match(body, /SELECT settings FROM ai_agent_settings WHERE tenant_id = \$1/);
  assert.match(body, /const merged = \{ \.\.\.stored, \.\.\.\(settings \|\| \{\}\) \}/);
  assert.match(body, /\.\.\.\(stored\?\.handoff_rules \|\| \{\}\)/);
});
