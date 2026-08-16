import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "../../server/routes/aiSupport.js";

const { transcribeChannelVoiceNote } = __testing;

const AUDIO = { type: "audio", mime_type: "audio/ogg", url: "https://example.test/voice.ogg" };

const withEnv = async (vars, run) => {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("a typed message is never overwritten by an attachment", async () => {
  // The guard that matters most: a customer who typed AND attached must have their
  // words used, not a transcript of whatever they also recorded.
  await withEnv({ AI_VOICE_TRANSCRIPTION_ENABLED: "true" }, async () => {
    const message = { message_text: "عندكم كروكس؟", attachments: [AUDIO] };
    await transcribeChannelVoiceNote(message);
    assert.equal(message.message_text, "عندكم كروكس؟");
    assert.ok(!message.voice_transcript);
  });
});

test("transcription is dormant while the flag is off", async () => {
  await withEnv({ AI_VOICE_TRANSCRIPTION_ENABLED: "" }, async () => {
    const message = { message_text: "", attachments: [AUDIO] };
    await transcribeChannelVoiceNote(message);
    assert.equal(message.message_text, "");
    assert.ok(!message.voice_transcript, "a dormant stage must not claim it transcribed");
  });
});

test("a message with no attachments is left alone", async () => {
  await withEnv({ AI_VOICE_TRANSCRIPTION_ENABLED: "true" }, async () => {
    const message = { message_text: "", attachments: [] };
    await transcribeChannelVoiceNote(message);
    assert.equal(message.message_text, "");
  });
});

test("an unreadable voice note leaves the message empty rather than inventing text", async () => {
  // No credentials in this environment, so transcription cannot succeed. The message
  // must stay empty and fall through to the existing "message is required" path —
  // answering a guess would be worse than answering nothing.
  await withEnv({ AI_VOICE_TRANSCRIPTION_ENABLED: "true" }, async () => {
    const message = { message_text: "", attachments: [AUDIO] };
    await transcribeChannelVoiceNote(message);
    assert.equal(message.message_text, "");
    assert.ok(!message.voice_transcript);
  });
});

test("malformed input never throws", async () => {
  // This runs on the inbound path of a live channel; a crash here drops the message.
  await withEnv({ AI_VOICE_TRANSCRIPTION_ENABLED: "true" }, async () => {
    for (const input of [null, undefined, {}, { attachments: "not-an-array" }, { message_text: null }]) {
      await transcribeChannelVoiceNote(input);
    }
  });
});
