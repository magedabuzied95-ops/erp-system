import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { requestCompatibleVisionJson, resolveVisionProvider, stripReasoning } from "../server/services/aiVisionProviderService.js";

// Customer photos used to have exactly one reader, OpenAI. When its quota ran out (live 2026-09-11,
// `insufficient_quota`) WhatsApp, Messenger, Instagram and the storefront's search-by-photo went
// blind together. Vision now routes through any OpenAI-compatible server — production's Groq —
// the moment AI_VISION_MODEL names a model that reads images.

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const withEnv = async (patch, run) => {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

// A stand-in for Groq's /v1/chat/completions, so the real production path runs with no network.
const fakeVisionServer = async (respond) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ url: req.url, auth: req.headers.authorization || "", body });
      const { status = 200, json } = respond(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
};

const completion = (content) => ({
  id: "cmpl-test",
  object: "chat.completion",
  created: 0,
  model: "test-vision",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
});

// ── which provider reads the photo ───────────────────────────────────────────────────────────

test("nothing changes until a vision model is named", () => {
  // The text model is not assumed to see images: a model that rejects them would fail every photo,
  // and a failed photo is held — so it would fail quietly. No default model, on purpose.
  assert.equal(resolveVisionProvider({ AI_TEXT_BASE_URL: "https://api.groq.com/openai/v1", AI_TEXT_MODEL: "qwen/qwen3.8-27b" }).kind, "openai");
  assert.equal(resolveVisionProvider({}).kind, "openai");
});

test("a named vision model rides the text provider's server and key", () => {
  const provider = resolveVisionProvider({
    AI_VISION_MODEL: "some-vision-model",
    AI_TEXT_BASE_URL: "https://api.groq.com/openai/v1/",
    AI_TEXT_API_KEY: "gsk_test",
  });
  assert.equal(provider.kind, "compatible");
  assert.equal(provider.model, "some-vision-model");
  assert.equal(provider.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(provider.apiKey, "gsk_test");
  // its own server/key win when given, and a bare origin gains /v1
  const own = resolveVisionProvider({ AI_VISION_MODEL: "m", AI_VISION_BASE_URL: "http://vision:8000", AI_VISION_API_KEY: "k", AI_TEXT_BASE_URL: "https://other/v1" });
  assert.equal(own.baseUrl, "http://vision:8000/v1");
  assert.equal(own.apiKey, "k");
});

test("AI_VISION_PROVIDER=openai forces the old path; a model with no server says why", () => {
  assert.equal(resolveVisionProvider({ AI_VISION_PROVIDER: "openai", AI_VISION_MODEL: "m", AI_TEXT_BASE_URL: "https://x/v1" }).kind, "openai");
  const orphan = resolveVisionProvider({ AI_VISION_MODEL: "m" });
  assert.equal(orphan.kind, "openai");
  assert.match(orphan.misconfigured, /no AI_VISION_BASE_URL/);
});

// ── the request and the reading ──────────────────────────────────────────────────────────────

test("the photo rides as an image part, and the reply is read past a <think> block", async () => {
  let sent = null;
  const client = { chat: { completions: { create: async (body) => { sent = body; return completion('<think>is it {a jordan}? no</think>{"product_type":"sneakers","brand_guess":"Skechers"}'); } } } };
  const parsed = await requestCompatibleVisionJson({
    provider: { model: "vision-m", timeout: 1000 },
    instructions: "SYSTEM",
    prompt: "Extract",
    imageUrl: "data:image/png;base64,AAAA",
    keys: ["product_type", "brand_guess"],
    client,
  });
  assert.deepEqual(parsed, { product_type: "sneakers", brand_guess: "Skechers" }, "the braces inside <think> are not mistaken for the answer");
  assert.equal(sent.model, "vision-m");
  assert.deepEqual(sent.response_format, { type: "json_object" });
  const parts = sent.messages[1].content;
  assert.equal(parts[1].type, "image_url");
  assert.equal(parts[1].image_url.url, "data:image/png;base64,AAAA", "the bytes are sent — the provider never fetches our CDN");
  assert.match(parts[0].text, /exactly these keys: product_type, brand_guess/);
  assert.equal(stripReasoning("<think>x</think> {}"), "{}");
});

test("a rate-limited free tier gets one patient retry, not a lost photo", async () => {
  let calls = 0;
  const waited = [];
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error("Rate limit reached. Please try again in 2s."), { status: 429 });
          return completion('{"product_type":"sneakers"}');
        },
      },
    },
  };
  const parsed = await requestCompatibleVisionJson({
    provider: { model: "m", timeout: 1000 }, imageUrl: "data:image/png;base64,AAAA", keys: ["product_type"], client,
    sleep: async (ms) => { waited.push(ms); },
  });
  assert.equal(parsed.product_type, "sneakers");
  assert.equal(calls, 2);
  assert.ok(waited[0] >= 2000 && waited[0] <= 30_000, `waited what the provider asked (${waited[0]}ms)`);
});

// ── end to end, through the production function ──────────────────────────────────────────────

test("with a vision model named, a customer photo is read WITHOUT any OpenAI key", async () => {
  const server = await fakeVisionServer(() => ({
    json: completion('{"product_type":"sneakers","brand_guess":"Skechers","model_family":"Hyper Burst","model_guess":"Skechers Hyper Burst","colors":["grey"]}'),
  }));
  try {
    await withEnv(
      { AI_VISION_MODEL: "test-vision", AI_VISION_BASE_URL: server.baseUrl, AI_VISION_API_KEY: "gsk_fake", OPENAI_API_KEY: "", OPENAI_AGENT_API_KEY: "", AI_SUPPORT_VISION_ENABLED: undefined },
      async () => {
        const { understandProductImageForSearch } = await import("../server/services/openaiSupportService.js");
        const understanding = await understandProductImageForSearch({ imageBuffer: PNG, mimeType: "image/png", requestId: "test" });
        assert.equal(understanding.vision_provider, "compatible");
        assert.equal(understanding.detected.brand_guess, "Skechers");
        assert.equal(understanding.detected.product_type, "sneakers");
        assert.ok(!understanding.error, `no error (${understanding.error || ""})`);
      }
    );
    assert.equal(server.requests.length, 1);
    const request = server.requests[0];
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.auth, "Bearer gsk_fake");
    assert.equal(request.body.model, "test-vision");
    assert.match(request.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
    // the same instructions the OpenAI path sends — switching provider never changes what is asked
    assert.match(request.body.messages[0].content, /Analyze the customer-uploaded product image for storefront product discovery\./);
  } finally {
    await server.close();
  }
});

test("a refusing vision server is named in the miss, and the photo is held", async () => {
  const server = await fakeVisionServer(() => ({ status: 401, json: { error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" } } }));
  try {
    await withEnv(
      { AI_VISION_MODEL: "test-vision", AI_VISION_BASE_URL: server.baseUrl, OPENAI_API_KEY: "", OPENAI_AGENT_API_KEY: "", AI_SUPPORT_VISION_ENABLED: undefined },
      async () => {
        const { recogniseProductFromImage } = await import("../server/services/aiVisualProductRecognitionService.js");
        const result = await recogniseProductFromImage({ tenantId: 1, imageBuffer: PNG, mimeType: "image/png" });
        assert.equal(result.matched, false);
        assert.equal(result.reason, "vision_unavailable:invalid_api_key", "the provider's own refusal reaches the log and the draft");
      }
    );
  } finally {
    await server.close();
  }
});

test("AI_SUPPORT_VISION_ENABLED=false still switches vision off for every provider", async () => {
  const server = await fakeVisionServer(() => ({ json: completion('{"product_type":"sneakers"}') }));
  try {
    await withEnv(
      { AI_VISION_MODEL: "test-vision", AI_VISION_BASE_URL: server.baseUrl, AI_SUPPORT_VISION_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_AGENT_API_KEY: "" },
      async () => {
        const { understandProductImageForSearch } = await import("../server/services/openaiSupportService.js");
        await understandProductImageForSearch({ imageBuffer: PNG, mimeType: "image/png" });
      }
    );
    assert.equal(server.requests.length, 0, "the kill switch is honoured before any provider is called");
  } finally {
    await server.close();
  }
});
