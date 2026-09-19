// One settings payload, two stores.
//
// `ai_settings` is a SINGLE GLOBAL row (no tenant column) holding the inbox auto-reply gate's knobs.
// `ai_agent_settings` is per tenant and is the only row the sales agent reads for its own behaviour:
// handoff rules, the discount ceiling, forbidden/preferred phrases, follow-up policy.
//
// Until 2026-09-19 `PUT /api/ai-agent/settings` sent the entire payload to the global row, so every
// knob the AI Agent Settings page saved was written somewhere the agent never reads. Splitting by key
// is what makes that page's switches actually reach the agent.

export const AI_GLOBAL_SETTING_KEYS = Object.freeze([
  "autoReplyMode",
  "tone",
  "ai_shoe_cover_enabled",
  "safety",
  "debug",
]);

const GLOBAL_KEY_SET = new Set(AI_GLOBAL_SETTING_KEYS);

// The tenant id travels beside the settings in some callers' bodies; it is addressing, not a setting,
// and must never be persisted into either JSON blob.
const ADDRESSING_KEYS = new Set(["tenant_id", "tenantId"]);

export const isAiGlobalSettingKey = (key) => GLOBAL_KEY_SET.has(key);

export const splitAiSettingsPayload = (payload = {}) => {
  const global = {};
  const agent = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { global, agent };
  Object.entries(payload).forEach(([key, value]) => {
    if (ADDRESSING_KEYS.has(key)) return;
    if (GLOBAL_KEY_SET.has(key)) global[key] = value;
    else agent[key] = value;
  });
  return { global, agent };
};

export default splitAiSettingsPayload;
