const clean = (value = "") => String(value || "").trim();

let persistedAgentApiKey = "";
let persistedThermalApiKey = "";

export const refreshOpenAiCredentialOverrides = async () => {
  const { getSetting } = await import("./settingsService.js");
  const [agentKey, thermalKey] = await Promise.all([
    getSetting("ai_channels.openai_agent_api_key", ""),
    getSetting("ai_channels.openai_thermal_api_key", ""),
  ]);
  persistedAgentApiKey = clean(agentKey);
  persistedThermalApiKey = clean(thermalKey);
  return openAiCredentialStatus();
};

export const agentOpenAiApiKey = () =>
  persistedAgentApiKey || clean(process.env.OPENAI_AGENT_API_KEY) || clean(process.env.OPENAI_API_KEY);

// Thermal artwork never borrows the shared OPENAI_API_KEY: that is the customer-reply credit,
// and an "openai" thermal style silently spent it. With no dedicated thermal key the artwork
// is drawn by the local engine (thermalArtworkService downgrades engine "openai" → "local").
export const thermalOpenAiApiKey = () =>
  persistedThermalApiKey || clean(process.env.OPENAI_THERMAL_API_KEY);

export const openAiCredentialStatus = () => ({
  agent_key_loaded: Boolean(agentOpenAiApiKey()),
  thermal_key_loaded: Boolean(thermalOpenAiApiKey()),
  agent_uses_dedicated_key: Boolean(clean(process.env.OPENAI_AGENT_API_KEY)),
  thermal_uses_dedicated_key: Boolean(clean(process.env.OPENAI_THERMAL_API_KEY)),
  agent_uses_system_setting: Boolean(persistedAgentApiKey),
  thermal_uses_system_setting: Boolean(persistedThermalApiKey),
  legacy_fallback_loaded: Boolean(clean(process.env.OPENAI_API_KEY)),
});

export default {
  agentOpenAiApiKey,
  thermalOpenAiApiKey,
  openAiCredentialStatus,
  refreshOpenAiCredentialOverrides,
};
