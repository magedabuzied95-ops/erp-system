/**
 * Voice note transcription.
 *
 * Why this matters more here than the feature list suggests: a large share of
 * Egyptian customers send a voice note instead of typing. Today those arrive as an
 * audio attachment, the transcript bubble reads "🎤 رسالة صوتية", and every stage
 * downstream — understanding, retrieval, grounding, autonomy — receives an empty
 * message. The assistant is not answering those customers badly; it cannot read them
 * at all.
 *
 * Design rules, matching the rest of the AI stack:
 *
 * 1. Dormant by default (AI_VOICE_TRANSCRIPTION_ENABLED). Off, this returns a null
 *    result and nothing anywhere changes.
 * 2. It NEVER throws. A failed transcription degrades to the attachment label the UI
 *    already shows, which is exactly today's behaviour.
 * 3. A transcript is CUSTOMER TEXT, never a fact. It feeds the understanding pass like
 *    any typed message; the grounding gate remains the only authority on price and
 *    stock, so a misheard word cannot become a false claim about the catalog.
 * 4. It is explicitly marked as transcribed, so an employee reviewing the draft can
 *    see the reply was written against a machine transcript rather than typed words.
 */
import fs from "node:fs";
import path from "node:path";

import { getSharedOpenAiClient, isTextGenerationAvailable } from "./openaiSupportService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());

const AUDIO_TYPES = new Set(["audio", "voice", "ptt", "voice_note"]);
// Whisper's own hard limit. Anything larger is a recording, not a voice note.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPT_CHARS = 1_200;

export const isVoiceTranscriptionEnabled = () =>
  envFlagEnabled(process.env.AI_VOICE_TRANSCRIPTION_ENABLED) && isTextGenerationAvailable();

const resolveModel = () => text(process.env.AI_VOICE_TRANSCRIPTION_MODEL) || "whisper-1";

/**
 * Language hint. Whisper detects language on its own, but an explicit hint measurably
 * reduces the case that matters most here: short Egyptian-Arabic clips being read as
 * Persian or Urdu, which share much of the script's phonetics.
 */
const resolveLanguage = () => text(process.env.AI_VOICE_TRANSCRIPTION_LANGUAGE) || "ar";

export const isAudioAttachment = (attachment = {}) => {
  const type = text(attachment?.type || attachment?.media_type || attachment?.message_type).toLowerCase();
  if (AUDIO_TYPES.has(type)) return true;
  const mime = text(attachment?.mime_type || attachment?.mimeType || attachment?.metadata?.mime_type).toLowerCase();
  return mime.startsWith("audio/");
};

export const findAudioAttachment = (attachments = []) => asArray(attachments).find(isAudioAttachment) || null;

/**
 * Local path for an attachment this server already re-hosted.
 *
 * Only local files are transcribed. The provider URL is deliberately not followed: it
 * is a signed CDN link that expires, and `inboundMediaService` exists precisely because
 * those links cannot be relied on after webhook time.
 */
const resolveLocalAudioPath = (attachment = {}) => {
  const candidate = text(attachment?.local_path || attachment?.storage_path || attachment?.path);
  if (candidate && fs.existsSync(candidate)) return candidate;

  const url = text(attachment?.url || attachment?.media_url);
  const match = url.match(/\/uploads\/(.+)$/);
  if (!match) return "";

  // Resolve under uploads/ and confirm containment: the URL is attacker-influenced
  // webhook data, so a traversal segment must not reach outside the media folder.
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const resolved = path.resolve(uploadsRoot, match[1]);
  if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) return "";
  return fs.existsSync(resolved) ? resolved : "";
};

const emptyResult = (reason) => ({
  transcribed: false,
  text: "",
  language: "",
  model: "",
  duration_ms: 0,
  reason,
});

/**
 * Transcribes one audio attachment.
 *
 * @returns {Promise<{transcribed: boolean, text: string, reason: string}>} never throws.
 */
export const transcribeVoiceAttachment = async (attachment = {}) => {
  if (!isVoiceTranscriptionEnabled()) return emptyResult("disabled");
  if (!isAudioAttachment(attachment)) return emptyResult("not_audio");

  const filePath = resolveLocalAudioPath(attachment);
  if (!filePath) return emptyResult("no_local_file");

  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(filePath).size;
  } catch {
    return emptyResult("stat_failed");
  }
  if (!sizeBytes) return emptyResult("empty_file");
  if (sizeBytes > MAX_AUDIO_BYTES) return emptyResult("too_large");

  const client = getSharedOpenAiClient();
  if (!client) return emptyResult("no_client");

  const startedAt = Date.now();
  const model = resolveModel();
  try {
    const response = await client.audio.transcriptions.create(
      {
        file: fs.createReadStream(filePath),
        model,
        language: resolveLanguage(),
        // Plain text: verbose_json buys segment timings nothing downstream reads.
        response_format: "text",
      },
      { timeout: TRANSCRIBE_TIMEOUT_MS }
    );

    const transcript = text(typeof response === "string" ? response : response?.text).slice(0, MAX_TRANSCRIPT_CHARS);
    if (!transcript) return emptyResult("empty_transcript");

    const result = {
      transcribed: true,
      text: transcript,
      language: resolveLanguage(),
      model,
      duration_ms: Date.now() - startedAt,
      reason: "ok",
    };
    console.log("ai_voice_transcription", {
      model,
      size_bytes: sizeBytes,
      duration_ms: result.duration_ms,
      chars: transcript.length,
    });
    return result;
  } catch (error) {
    console.warn("[ai-voice-transcription] failed", { model, message: error?.message });
    return emptyResult("error");
  }
};

/**
 * Resolves the text the pipeline should treat as the customer's message.
 *
 * A typed caption always wins: if the customer sent both, the words they chose to type
 * are more reliable than a transcript of the words they spoke.
 */
export const resolveCustomerMessageText = async ({ messageText = "", attachments = [] } = {}) => {
  const typed = text(messageText);
  if (typed) return { text: typed, source: "typed", transcription: null };

  const audio = findAudioAttachment(attachments);
  if (!audio) return { text: "", source: "none", transcription: null };

  const transcription = await transcribeVoiceAttachment(audio);
  if (!transcription.transcribed) return { text: "", source: "voice_unreadable", transcription };

  return { text: transcription.text, source: "voice_transcript", transcription };
};

export const __testing = { resolveLocalAudioPath, isAudioAttachment, findAudioAttachment };
