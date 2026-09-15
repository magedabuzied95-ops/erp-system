import OpenAI, { toFile } from "openai";

/* ---------------------------------------------------------------------------
 * Storefront voice search — the shopper's spoken words, as search text
 *
 * The search sheet uses the browser's own speech recognition where it works
 * (Chrome on Android). iPhone Safari is the problem: its recogniser refuses
 * whenever Siri & Dictation is off and, without an error handler, the mic
 * button did nothing at all (owner report 2026-09-15). So the phone records a
 * short clip and this turns it into text on the server instead.
 *
 * Provider, from env, the same way AI_TEXT_* and AI_VISION_* already route:
 *   AI_VOICE_SEARCH_PROVIDER=off         switch it off
 *   AI_VOICE_SEARCH_MODEL=...            model name (see defaults below)
 *   AI_VOICE_SEARCH_BASE_URL=...         defaults to AI_TEXT_BASE_URL
 *   AI_VOICE_SEARCH_API_KEY=...          defaults to AI_TEXT_API_KEY
 * A Groq AI_TEXT_BASE_URL (what production runs) defaults to
 * whisper-large-v3-turbo; with no compatible server an OPENAI_API_KEY falls
 * back to whisper-1. Nothing configured ⇒ { available: false } and the
 * endpoint answers 503, which the storefront reads as "use the browser".
 * ------------------------------------------------------------------------- */

const clean = (value = "") => String(value ?? "").trim();

export const VOICE_SEARCH_MAX_BYTES = 4 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPT_CHARS = 160;
const VOICE_SEARCH_VOCABULARY =
  "جوردن، نايك، اديداس، سكيتشرز، كروكس، نيو بالانس، سامبا، اير فورس، بوما، فانس، كونفرس، كوتشي، شبشب، مقاس 42، رجالي، حريمي، أطفال، اسود، ابيض، رمادي، كحلي، بيج";

export const resolveVoiceSearchProvider = (env = process.env) => {
  const explicit = clean(env.AI_VOICE_SEARCH_PROVIDER).toLowerCase();
  if (["off", "none", "false", "0"].includes(explicit)) return { kind: "none" };
  const origin = clean(env.AI_VOICE_SEARCH_BASE_URL || env.AI_TEXT_BASE_URL).replace(/\/+$/, "");
  const explicitModel = clean(env.AI_VOICE_SEARCH_MODEL);
  if (explicit !== "openai" && origin) {
    const model = explicitModel || (/groq\.com/i.test(origin) ? "whisper-large-v3-turbo" : "");
    if (model) {
      return {
        kind: "compatible",
        baseUrl: /\/v1$/i.test(origin) ? origin : `${origin}/v1`,
        apiKey: clean(env.AI_VOICE_SEARCH_API_KEY || env.AI_TEXT_API_KEY) || "local",
        model,
      };
    }
  }
  if (clean(env.OPENAI_API_KEY)) {
    return { kind: "openai", apiKey: clean(env.OPENAI_API_KEY), model: explicitModel || "whisper-1" };
  }
  return { kind: "none" };
};

// iOS records audio/mp4 (m4a), Chrome audio/webm, Firefox audio/ogg. The provider reads the
// container from the file name, so the name must carry the right extension.
export const voiceClipFileName = (mimeType = "") => {
  const mime = clean(mimeType).toLowerCase();
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "voice.m4a";
  if (mime.includes("ogg")) return "voice.ogg";
  if (mime.includes("wav")) return "voice.wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "voice.mp3";
  return "voice.webm";
};

export const isVoiceClipMime = (mimeType = "") => /^(audio|video)\/(webm|mp4|m4a|x-m4a|aac|ogg|wav|x-wav|mpeg|mp3)\b/i.test(clean(mimeType));

// A search box wants the words, not a sentence: no trailing full stop, no quotes, one line.
export const tidyVoiceTranscript = (value = "") =>
  clean(value)
    .replace(/\s+/g, " ")
    .replace(/^["'«»“”]+|["'«»“”]+$/g, "")
    .replace(/[.。؟?!،,]+$/u, "")
    .trim()
    .slice(0, MAX_TRANSCRIPT_CHARS);

const clients = new Map();

export const transcribeVoiceSearchClip = async ({ buffer, mimeType = "", language = "ar", provider = resolveVoiceSearchProvider(), client = null } = {}) => {
  if (provider.kind === "none") return { available: false, text: "", reason: "not_configured" };
  if (!buffer?.length) return { available: true, text: "", reason: "empty_clip" };
  const key = `${provider.kind}|${provider.baseUrl || ""}|${provider.apiKey}`;
  if (!client && !clients.has(key)) {
    clients.set(key, new OpenAI({ apiKey: provider.apiKey, ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}), maxRetries: 0, timeout: TRANSCRIBE_TIMEOUT_MS }));
  }
  const api = client || clients.get(key);
  const file = await toFile(buffer, voiceClipFileName(mimeType), { type: clean(mimeType) || "audio/webm" });
  const response = await api.audio.transcriptions.create(
    {
      file,
      model: provider.model,
      // Egyptian shoppers mix Arabic with brand names ("عايز جوردن 4 مقاس 42"); the hint keeps a
      // short clip from being read as Persian or Urdu, and brand names still come out in Latin.
      language: clean(language) === "en" ? "en" : "ar",
      // Vocabulary, not instructions: whisper leans toward words it has just "heard", so a short
      // clip of "سكيتشرز" comes back as the brand instead of a near-sounding Arabic word.
      prompt: VOICE_SEARCH_VOCABULARY,
      response_format: "json",
      temperature: 0,
    },
    { timeout: TRANSCRIBE_TIMEOUT_MS }
  );
  const text = tidyVoiceTranscript(typeof response === "string" ? response : response?.text);
  return { available: true, text, reason: text ? "ok" : "empty_transcript", model: provider.model };
};

export default { resolveVoiceSearchProvider, transcribeVoiceSearchClip, tidyVoiceTranscript, voiceClipFileName, isVoiceClipMime };
