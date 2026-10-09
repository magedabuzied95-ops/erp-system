import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inboxAttachmentKind, INBOX_ATTACHMENT_AUDIO_MAX_BYTES } from "../server/config/inboxAttachmentUpload.js";
import { attachmentKindOf, attachmentProblem, isAudioFile, MAX_OUTBOUND_AUDIO_BYTES } from "../src/modules/aiSupport/utils/outboundAttachment.js";

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

test("Telegram sends a voice note with sendVoice, and the list preview says so", () => {
  const code = source("../server/routes/aiAgentOrders.js");
  assert.match(code, /attachmentKind === "audio" \? "voice" : "photo"/);
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
