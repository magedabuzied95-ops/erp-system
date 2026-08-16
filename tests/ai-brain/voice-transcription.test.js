import assert from "node:assert/strict";
import test from "node:test";

import {
  isAudioAttachment,
  findAudioAttachment,
  isVoiceTranscriptionEnabled,
  transcribeVoiceAttachment,
  resolveCustomerMessageText,
  __testing,
} from "../../server/services/aiVoiceTranscriptionService.js";

test("dormant by default — the flag off transcribes nothing", async () => {
  delete process.env.AI_VOICE_TRANSCRIPTION_ENABLED;
  assert.equal(isVoiceTranscriptionEnabled(), false);
  const result = await transcribeVoiceAttachment({ type: "audio", url: "/uploads/inbox-media/x.ogg" });
  assert.equal(result.transcribed, false);
  assert.equal(result.reason, "disabled");
});

test("recognises the audio shapes every channel sends", () => {
  assert.equal(isAudioAttachment({ type: "voice" }), true);
  assert.equal(isAudioAttachment({ type: "ptt" }), true);
  assert.equal(isAudioAttachment({ media_type: "audio" }), true);
  assert.equal(isAudioAttachment({ mime_type: "audio/ogg; codecs=opus" }), true);
  assert.equal(isAudioAttachment({ type: "image" }), false);
  assert.equal(isAudioAttachment({}), false);
});

test("finds the voice note among mixed attachments", () => {
  const found = findAudioAttachment([{ type: "image" }, { type: "voice", url: "/uploads/a.ogg" }]);
  assert.equal(found?.type, "voice");
  assert.equal(findAudioAttachment([{ type: "image" }]), null);
  assert.equal(findAudioAttachment([]), null);
});

test("a typed caption outranks a voice note", async () => {
  const resolved = await resolveCustomerMessageText({
    messageText: "عايز مقاس 44",
    attachments: [{ type: "voice", url: "/uploads/a.ogg" }],
  });
  assert.equal(resolved.source, "typed");
  assert.equal(resolved.text, "عايز مقاس 44");
  // No transcription attempted at all when the customer typed.
  assert.equal(resolved.transcription, null);
});

test("an unreadable voice note yields empty text, never a throw", async () => {
  const resolved = await resolveCustomerMessageText({
    messageText: "",
    attachments: [{ type: "voice", url: "/uploads/inbox-media/missing.ogg" }],
  });
  assert.equal(resolved.text, "");
  assert.equal(resolved.source, "voice_unreadable");
  assert.equal(resolved.transcription.transcribed, false);
});

test("a message with no attachments resolves to nothing", async () => {
  const resolved = await resolveCustomerMessageText({ messageText: "", attachments: [] });
  assert.equal(resolved.source, "none");
  assert.equal(resolved.text, "");
});

test("path traversal in a provider URL cannot escape uploads/", () => {
  const escaped = __testing.resolveLocalAudioPath({
    type: "voice",
    url: "/uploads/../../../../etc/passwd",
  });
  assert.equal(escaped, "");
});

test("a remote provider URL is never transcribed directly", () => {
  const resolved = __testing.resolveLocalAudioPath({
    type: "voice",
    url: "https://lookaside.fbsbx.com/signed/expiring.ogg",
  });
  assert.equal(resolved, "");
});
