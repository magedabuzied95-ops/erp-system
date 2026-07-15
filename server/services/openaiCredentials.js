const clean = (value = "") => String(value || "").trim();

export const agentOpenAiApiKey = () =>
  clean(process.env.OPENAI_AGENT_API_KEY) || clean(process.env.OPENAI_API_KEY);

export const thermalOpenAiApiKey = () =>
  clean(process.env.OPENAI_THERMAL_API_KEY) || clean(process.env.OPENAI_API_KEY);

export const openAiCredentialStatus = () => ({
  agent_key_loaded: Boolean(agentOpenAiApiKey()),
  thermal_key_loaded: Boolean(thermalOpenAiApiKey()),
  agent_uses_dedicated_key: Boolean(clean(process.env.OPENAI_AGENT_API_KEY)),
  thermal_uses_dedicated_key: Boolean(clean(process.env.OPENAI_THERMAL_API_KEY)),
  legacy_fallback_loaded: Boolean(clean(process.env.OPENAI_API_KEY)),
});

export default {
  agentOpenAiApiKey,
  thermalOpenAiApiKey,
  openAiCredentialStatus,
};
