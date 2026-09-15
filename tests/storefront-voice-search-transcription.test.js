import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  isVoiceClipMime,
  resolveVoiceSearchProvider,
  tidyVoiceTranscript,
  transcribeVoiceSearchClip,
  voiceClipFileName,
} from "../server/utils/storefrontVoiceTranscription.js";

test("production's Groq text server gets Groq's whisper; nothing configured is honest about it", () => {
  const groq = resolveVoiceSearchProvider({ AI_TEXT_BASE_URL: "https://api.groq.com/openai/v1", AI_TEXT_API_KEY: "k" });
  assert.equal(groq.kind, "compatible");
  assert.equal(groq.model, "whisper-large-v3-turbo");
  // A local Ollama has no speech model; guessing one would fail every clip.
  assert.equal(resolveVoiceSearchProvider({ AI_TEXT_BASE_URL: "http://ollama:11434/v1" }).kind, "none");
  assert.equal(resolveVoiceSearchProvider({ OPENAI_API_KEY: "x" }).model, "whisper-1");
  assert.equal(resolveVoiceSearchProvider({ AI_VOICE_SEARCH_PROVIDER: "off", OPENAI_API_KEY: "x" }).kind, "none");
  assert.equal(resolveVoiceSearchProvider({}).kind, "none");
});

test("the clip name carries the container the phone recorded", () => {
  assert.equal(voiceClipFileName("audio/mp4"), "voice.m4a", "iPhone Safari records mp4");
  assert.equal(voiceClipFileName("audio/webm;codecs=opus"), "voice.webm");
  assert.equal(isVoiceClipMime("audio/webm;codecs=opus"), true);
  assert.equal(isVoiceClipMime("image/png"), false);
});

test("the transcript is search words, not a sentence", async () => {
  assert.equal(tidyVoiceTranscript("  جوردن 4   مقاس 42. "), "جوردن 4 مقاس 42");
  assert.equal(tidyVoiceTranscript("\"Skechers?\""), "Skechers");

  let request = null;
  const client = { audio: { transcriptions: { create: async (body) => { request = body; return { text: "سكيتشرز رمادي." }; } } } };
  const result = await transcribeVoiceSearchClip({
    buffer: Buffer.from("clip"),
    mimeType: "audio/mp4",
    provider: { kind: "compatible", model: "whisper-large-v3-turbo", apiKey: "k" },
    client,
  });
  assert.deepEqual([result.available, result.text], [true, "سكيتشرز رمادي"]);
  assert.equal(request.language, "ar");
  assert.equal(request.file.name, "voice.m4a");

  assert.equal((await transcribeVoiceSearchClip({ buffer: Buffer.from("x"), provider: { kind: "none" } })).available, false);
});

test("the endpoint is rate limited and answers 'no provider' with 503 the storefront falls back on", () => {
  const routes = fs.readFileSync(new URL("../server/routes/storefront.js", import.meta.url), "utf8");
  assert.match(routes, /router\.post\("\/voice-search", voiceSearchRateLimit, transcribeVoiceSearch\)/);
  assert.match(routes, /if \(!result\.available\) return res\.status\(503\)/);
});
