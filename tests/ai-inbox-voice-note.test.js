import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inboxAttachmentKind, INBOX_ATTACHMENT_AUDIO_MAX_BYTES } from "../server/config/inboxAttachmentUpload.js";
import { attachmentKindOf, attachmentProblem, isAudioFile, MAX_OUTBOUND_AUDIO_BYTES } from "../src/modules/aiSupport/utils/outboundAttachment.js";
import { VOICE_NOTE_SAMPLE_RATE, downmixToMono, encodeWav, isUniversallyPlayableAudio, normalizeVoiceNote, resampleMono } from "../src/modules/aiSupport/utils/voiceNoteEncoding.js";

// Sending a voice note from the AI Inbox. The whole feature turns on ONE
// distinction the old code could not make: a recording is `audio/webm`, and
// `.webm` is also a video extension — read in the wrong order a voice note is
// sent as a silent clip.

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const file = (name, mimetype) => ({ originalname: name, mimetype });
const browserFile = (name, type, size = 24 * 1024) => ({ name, type, size });

test("a recording is audio even when the container is one a video uses", () => {
  // Chrome records webm, Safari records mp4. Both are what MediaRecorder hands us.
  assert.equal(inboxAttachmentKind(file("voice-1.webm", "audio/webm;codecs=opus")), "audio");
  assert.equal(inboxAttachmentKind(file("voice-1.m4a", "audio/mp4")), "audio");
  assert.equal(inboxAttachmentKind(file("note.ogg", "")), "audio", "the extension carries it when the mime is missing");
  assert.equal(inboxAttachmentKind(file("clip.webm", "video/webm")), "video", "a real webm VIDEO is still a video");
  assert.equal(inboxAttachmentKind(file("clip.mp4", "video/mp4")), "video");
  assert.equal(inboxAttachmentKind(file("photo.jpg", "image/jpeg")), "image");
});

test("the browser side reads the kind the same way", () => {
  assert.equal(isAudioFile(browserFile("voice.webm", "audio/webm;codecs=opus")), true);
  assert.equal(attachmentKindOf(browserFile("voice.webm", "audio/webm;codecs=opus")), "audio");
  assert.equal(attachmentKindOf(browserFile("voice.m4a", "audio/mp4")), "audio");
  assert.equal(attachmentKindOf(browserFile("clip.webm", "video/webm")), "video");
  assert.equal(attachmentKindOf(browserFile("photo.png", "image/png")), "image");
});

test("a voice note is not refused before it is uploaded, but an audio FILE over the cap is", () => {
  assert.equal(attachmentProblem(browserFile("voice.webm", "audio/webm")), "");
  assert.equal(
    attachmentProblem(browserFile("podcast.mp3", "audio/mpeg", MAX_OUTBOUND_AUDIO_BYTES + 1)),
    "audioTooLarge"
  );
  assert.equal(MAX_OUTBOUND_AUDIO_BYTES, INBOX_ATTACHMENT_AUDIO_MAX_BYTES, "the browser must refuse exactly what the server would");
});

test("the upload door lets a voice note through", () => {
  const code = source("../server/config/inboxAttachmentUpload.js");
  assert.match(code, /if \(kind === "image" \|\| kind === "audio"\) return cb\(null, true\);/);
  assert.match(code, /INBOX_ATTACHMENT_AUDIO_MAX_BYTES/);
});

test("WhatsApp gets a voice note through sendWhatsAppAudio, never the media sender", () => {
  const code = source("../server/routes/aiAgentOrders.js");
  const at = code.indexOf('normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP && attachmentKind === "audio"');
  assert.ok(at > 0, "the audio branch exists");
  const branch = code.slice(at, at + 1200);
  assert.match(branch, /sendWhatsappVoiceNote/);
  // Evolution fetches the file from us, so a stored path would 404 on its side.
  assert.match(branch, /absolutePublicUploadUrl\(relativeUrl\)/);
  // The branch must be tested BEFORE the generic WhatsApp media branch, or audio
  // arrives as a file attachment instead of a playable voice bubble.
  const mediaAt = code.indexOf("sendResult = await sendWhatsappMediaMessage({");
  assert.ok(at < mediaAt, "the voice branch comes first");
});

test("the conversation list says a voice note was sent", () => {
  const code = source("../server/routes/aiAgentOrders.js");
  assert.match(code, /🎤 رسالة صوتية/);
});

test("Graph is told the attachment is audio, not an image", () => {
  const code = source("../server/services/metaIntegrationService.js");
  assert.match(code, /const isAudio = declared === "audio"/);
  assert.match(code, /mediaType: isAudio \? "audio" : isVideo \? "video" : "image"/);
  assert.match(code, /declaredType === "audio" \? "audio" : "image"/);
});

test("the recorder releases the microphone on every exit", () => {
  const code = source("../src/modules/aiSupport/components/VoiceNoteRecorder.jsx");
  // Unmount, stop, a failed MediaRecorder construction, and the onstop path.
  assert.match(code, /useEffect\(\(\) => \(\) => releaseMic\(\), \[releaseMic\]\)/, "unmount");
  assert.match(code, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/, "construction failure");
  assert.match(code, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/, "releaseMic");
  assert.ok(code.includes("releaseMic();\n      setRecording(false);"), "onstop and the inactive path both release");
});

test("the recorder names the file after the container the browser chose", () => {
  const code = source("../src/modules/aiSupport/components/VoiceNoteRecorder.jsx");
  assert.match(code, /type\.includes\("mp4"\) \? "m4a"/, "Safari's mp4 must not be saved as .webm");
  assert.match(code, /audio\/webm;codecs=opus/);
});

test("both inbox surfaces carry the recorder", () => {
  for (const page of ["../src/modules/aiSupport/pages/AiInbox.jsx", "../src/modules/aiSupport/pages/AiInboxPwa.jsx"]) {
    const code = source(page);
    assert.match(code, /import VoiceNoteRecorder from "\.\.\/components\/VoiceNoteRecorder"/, page);
    assert.match(code, /<VoiceNoteRecorder/, page);
    assert.match(code, /onRecordVoice/, page);
  }
});

test("a voice note is never offered in internal-note mode", () => {
  const pwa = source("../src/modules/aiSupport/pages/AiInboxPwa.jsx");
  assert.match(pwa, /\{onRecordVoice && mode !== "note" \? \(/);
  const desktop = source("../src/modules/aiSupport/pages/AiInbox.jsx");
  const at = desktop.indexOf("<VoiceNoteRecorder");
  assert.match(desktop.slice(at, at + 400), /disabled=\{loading \|\| noteMode \|\| !canSendLive\}/);
});

// --- playback by the people who SENT it ---------------------------------------
// The customer hears every container (Evolution transcodes for WhatsApp); our own
// transcript does not. Safari and every browser on iOS cannot decode WebM, so a
// note recorded at a desk read as "المرفق غير متاح" on the owner's phone.

test("mp4 is asked for first, because it is the only container iOS can play back", () => {
  const code = source("../src/modules/aiSupport/components/VoiceNoteRecorder.jsx");
  const list = code.slice(code.indexOf("const MIME_CANDIDATES"), code.indexOf("];", code.indexOf("const MIME_CANDIDATES")));
  assert.ok(list.indexOf('"audio/mp4"') < list.indexOf('"audio/webm'), "mp4 before webm");
});

test("the recorder normalises before it hands the file over", () => {
  const code = source("../src/modules/aiSupport/components/VoiceNoteRecorder.jsx");
  assert.ok(
    code.includes("void normalizeVoiceNote(recorded).then((file) => onSend?.(file || recorded));"),
    "the recording must not reach the upload before it has been made playable"
  );
});

test("a container iOS can play is passed through untouched", async () => {
  const m4a = { name: "voice.m4a", type: "audio/mp4", arrayBuffer: async () => new ArrayBuffer(8) };
  assert.equal(isUniversallyPlayableAudio("audio/mp4"), true);
  assert.equal(isUniversallyPlayableAudio("audio/wav"), true);
  assert.equal(isUniversallyPlayableAudio("audio/webm;codecs=opus"), false);
  assert.equal(await normalizeVoiceNote(m4a), m4a, "re-encoding an m4a would only make it bigger");
});

test("a webm recording is re-encoded to wav before it is stored", async () => {
  const samples = new Float32Array(48000).map((_, i) => Math.sin(i / 10) * 0.5);
  const FakeContext = class {
    async decodeAudioData() {
      return {
        numberOfChannels: 2,
        length: samples.length,
        sampleRate: 48000,
        getChannelData: () => samples,
      };
    }
    async close() { this.closed = true; }
  };
  const webm = { name: "voice-x.webm", type: "audio/webm;codecs=opus", arrayBuffer: async () => new ArrayBuffer(16) };
  const out = await normalizeVoiceNote(webm, { AudioContextImpl: FakeContext });
  assert.notEqual(out, webm);
  assert.equal(out.type, "audio/wav");
  assert.equal(out.name, "voice-x.wav");
  // 1s of 48 kHz becomes 1s of 16 kHz mono: 16000 samples, 2 bytes each, + header.
  assert.equal(out.size, 44 + 16000 * 2);
});

test("a decode that fails still sends the recording", async () => {
  const Broken = class {
    async decodeAudioData() { throw new Error("unsupported"); }
    async close() {}
  };
  const webm = { name: "voice.webm", type: "audio/webm", arrayBuffer: async () => new ArrayBuffer(4) };
  assert.equal(await normalizeVoiceNote(webm, { AudioContextImpl: Broken }), webm, "a note the customer can hear beats no note");
});

test("the wav it writes is a wav", () => {
  // 1.5 and -1.5 are deliberate: a sample outside [-1, 1] that is not clamped
  // wraps around into loud noise instead of saturating.
  const buffer = encodeWav(new Float32Array([0, 1.5, -1.5, 0.5]), VOICE_NOTE_SAMPLE_RATE);
  const view = new DataView(buffer);
  const ascii = (at, length) => String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(at + i)));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(ascii(36, 4), "data");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), VOICE_NOTE_SAMPLE_RATE);
  assert.equal(view.getUint16(34, true), 16, "16-bit");
  assert.equal(view.getUint32(40, true), 8, "four samples, two bytes each");
  // Clamped, not wrapped: +1 must be the top of the range, not silence.
  assert.equal(view.getInt16(44 + 2, true), 32767, "clamped, not wrapped");
  assert.equal(view.getInt16(44 + 4, true), -32768, "clamped, not wrapped");
});

test("stereo is averaged and the rate is dropped to speech", () => {
  const mono = downmixToMono([new Float32Array([1, 1]), new Float32Array([0, -1])], 2);
  assert.deepEqual([...mono], [0.5, 0]);
  const resampled = resampleMono(new Float32Array([0, 1, 0, -1]), 48000, 24000);
  assert.equal(resampled.length, 2);
});

test("Telegram gets sendVoice only for OGG, and sendAudio for the rest", () => {
  const code = source("../server/services/telegramBotService.js");
  assert.match(code, /if \(\["voice", "ptt"\]\.includes\(normalized\)\) return \{ method: "sendVoice"/);
  assert.match(code, /\["audio", "music", "sound"\]\.includes\(normalized\)\) return \{ method: "sendAudio"/);
  const route = source("../server/routes/aiAgentOrders.js");
  assert.match(route, /\/ogg\|opus\/i\.test\(req\.file\.mimetype \|\| ""\) \? "voice" : "audio"/);
});
