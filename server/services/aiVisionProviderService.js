import OpenAI from "openai";

import { extractJsonObject, rateLimitWaitMs } from "./openaiProductDescriptionService.js";

const cleanText = (value = "") => String(value ?? "").trim();
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/* ---------------------------------------------------------------------------
 * Vision provider — reading a customer's product photo
 *
 * The photo path used to have exactly one provider, OpenAI, and when its quota
 * ran out (live, 2026-09-11: `insufficient_quota`) every channel went blind at
 * once — WhatsApp, Messenger, Instagram and the storefront's search-by-photo.
 * This routes vision through any OpenAI-compatible server instead, the same
 * way AI_TEXT_* already routes product copy (production runs Groq):
 *
 *   AI_VISION_MODEL=<a model that accepts images>   REQUIRED to switch over.
 *     There is deliberately no default. The text model is not assumed to see
 *     images; a model that rejects them would fail every photo, and a photo
 *     that fails is held, so it would fail quietly. Prove it first with
 *     `node server/scripts/aiVisionProviderSmoke.js`.
 *   AI_VISION_BASE_URL=...   defaults to AI_TEXT_BASE_URL
 *   AI_VISION_API_KEY=...    defaults to AI_TEXT_API_KEY
 *   AI_VISION_TIMEOUT_MS=... default 30s (the intake runs off the webhook, so
 *                            this is patience, not customer-facing latency)
 *   AI_VISION_PROVIDER=openai   forces the old OpenAI path even with a model set
 *
 * With AI_VISION_MODEL unset nothing changes: OpenAI stays the path.
 * ------------------------------------------------------------------------- */

const DEFAULT_VISION_TIMEOUT_MS = 30_000;

export const resolveVisionProvider = (env = process.env) => {
  const explicit = cleanText(env.AI_VISION_PROVIDER).toLowerCase();
  const model = cleanText(env.AI_VISION_MODEL);
  if (explicit === "openai" || !model) return { kind: "openai" };
  const origin = cleanText(env.AI_VISION_BASE_URL || env.AI_TEXT_BASE_URL || env.OLLAMA_BASE_URL).replace(/\/+$/, "");
  if (!origin) return { kind: "openai", misconfigured: "AI_VISION_MODEL is set but no AI_VISION_BASE_URL / AI_TEXT_BASE_URL" };
  return {
    kind: "compatible",
    baseUrl: /\/v1$/i.test(origin) ? origin : `${origin}/v1`,
    apiKey: cleanText(env.AI_VISION_API_KEY || env.AI_TEXT_API_KEY) || "local",
    model,
    timeout: positiveNumber(env.AI_VISION_TIMEOUT_MS, DEFAULT_VISION_TIMEOUT_MS),
  };
};

const clients = new Map();
const clientFor = (provider) => {
  const key = `${provider.baseUrl}|${provider.apiKey}|${provider.timeout}`;
  if (!clients.has(key)) {
    clients.set(key, new OpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey, maxRetries: 0, timeout: provider.timeout }));
  }
  return clients.get(key);
};

// Reasoning models (Qwen and friends) open with a <think> block. Its text can hold braces of its
// own, and extractJsonObject's "first { to last }" fallback would then swallow the thinking too.
export const stripReasoning = (value = "") =>
  String(value ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();

/**
 * One JSON reading of an image from an OpenAI-compatible Chat Completions server.
 *
 * The image rides as an `image_url` content part — a data: URL when we hold the bytes, which is
 * what every caller sends now, so the provider never has to fetch our CDN. `keys` is the schema's
 * field list, repeated in the prompt because a compatible server may ignore response_format.
 */
export const requestCompatibleVisionJson = async ({
  provider,
  instructions = "",
  prompt = "",
  imageUrl = "",
  keys = [],
  client = null,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) => {
  const api = client || clientFor(provider);
  const body = {
    model: provider.model,
    temperature: 0,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: instructions },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${prompt}\n\nReturn ONLY one JSON object with exactly these keys: ${keys.join(", ")}. No prose, no markdown, no code fences.`,
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  };
  const call = () => api.chat.completions.create(body, { timeout: provider.timeout, maxRetries: 0 });
  let completion;
  try {
    completion = await call();
  } catch (error) {
    // A hosted free tier answers a burst with 429 and says how long to wait. One patient retry;
    // anything longer than rateLimitWaitMs's cap is a real refusal and is reported as one.
    const waitMs = Number(error?.status) === 429 ? rateLimitWaitMs(error) : 0;
    if (!waitMs) throw error;
    await sleep(waitMs);
    completion = await call();
  }
  return extractJsonObject(stripReasoning(completion?.choices?.[0]?.message?.content || ""));
};

export default { resolveVisionProvider, requestCompatibleVisionJson, stripReasoning };
