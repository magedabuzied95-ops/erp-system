import assert from "node:assert/strict";
import {
  agentOpenAiApiKey,
  thermalOpenAiApiKey,
  openAiCredentialStatus,
} from "../services/openaiCredentials.js";

const previous = {
  legacy: process.env.OPENAI_API_KEY,
  agent: process.env.OPENAI_AGENT_API_KEY,
  thermal: process.env.OPENAI_THERMAL_API_KEY,
};

try {
  process.env.OPENAI_API_KEY = "legacy-test-key";
  delete process.env.OPENAI_AGENT_API_KEY;
  delete process.env.OPENAI_THERMAL_API_KEY;
  assert.equal(agentOpenAiApiKey(), "legacy-test-key");
  assert.equal(thermalOpenAiApiKey(), "legacy-test-key");

  process.env.OPENAI_AGENT_API_KEY = "agent-test-key";
  process.env.OPENAI_THERMAL_API_KEY = "thermal-test-key";
  assert.equal(agentOpenAiApiKey(), "agent-test-key");
  assert.equal(thermalOpenAiApiKey(), "thermal-test-key");
  assert.deepEqual(openAiCredentialStatus(), {
    agent_key_loaded: true,
    thermal_key_loaded: true,
    agent_uses_dedicated_key: true,
    thermal_uses_dedicated_key: true,
    agent_uses_system_setting: false,
    thermal_uses_system_setting: false,
    legacy_fallback_loaded: true,
  });

  console.log("OpenAI credential routing passed.");
} finally {
  if (previous.legacy === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previous.legacy;
  if (previous.agent === undefined) delete process.env.OPENAI_AGENT_API_KEY;
  else process.env.OPENAI_AGENT_API_KEY = previous.agent;
  if (previous.thermal === undefined) delete process.env.OPENAI_THERMAL_API_KEY;
  else process.env.OPENAI_THERMAL_API_KEY = previous.thermal;
}
