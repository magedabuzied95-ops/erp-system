import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  extractEvolutionProfilePictureUrl,
  extractWhatsappMediaDescriptor,
  getEvolutionStatusUpdateDecision,
  getEvolutionWebhookSkipReason,
} from "../server/services/whatsappGatewayService.js";

const transcriptSource = fs.readFileSync(new URL("../src/modules/aiSupport/components/TranscriptMessage.jsx", import.meta.url), "utf8");
const desktopInboxSource = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaInboxSource = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const mediaSource = fs.readFileSync(new URL("../src/modules/aiSupport/components/MessageMedia.jsx", import.meta.url), "utf8");
const avatarSource = fs.readFileSync(new URL("../src/modules/aiSupport/components/CustomerAvatar.jsx", import.meta.url), "utf8");

const outboundPayload = (message, status = "sent") => ({
  event: "messages.upsert",
  data: {
    key: { id: "provider-message-1", remoteJid: "201001234567@s.whatsapp.net", fromMe: true },
    status,
    message,
  },
});

test("outbound WhatsApp text with sent status remains a message event", () => {
  const payload = outboundPayload({ conversation: "تم الرد من واتساب بيزنس" });
  const decision = getEvolutionStatusUpdateDecision(payload, { event: "messages.upsert", rawEvent: "messages.upsert", fromMe: true });
  assert.equal(decision.isStatusUpdate, false);
  assert.equal(decision.indicators.hasMessageContent, true);
});

test("outbound WhatsApp media without a caption is accepted and described", () => {
  const payload = outboundPayload({ audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 7 } });
  const media = extractWhatsappMediaDescriptor(payload);
  assert.equal(media.type, "audio");
  assert.equal(media.label, "🎤 رسالة صوتية");
  assert.equal(getEvolutionWebhookSkipReason({
    event: "messages.upsert",
    remoteJid: payload.data.key.remoteJid,
    messageId: payload.data.key.id,
    hasMedia: true,
    fromMe: true,
  }), "");
});

test("inbound captionless media reaches persistence without becoming AI text", () => {
  assert.equal(getEvolutionWebhookSkipReason({
    event: "messages.upsert",
    remoteJid: "201001234567@s.whatsapp.net",
    messageId: "customer-media-1",
    hasMedia: true,
    fromMe: false,
  }), "");
});

// The player moved out of TranscriptMessage into the shared media component, so
// these follow the code rather than the file it used to live in.
test("AI Inbox renders saved WhatsApp voice messages with an audio player", () => {
  assert.match(mediaSource, /<audio\s+ref=\{audioRef\}\s+src=\{item\.url\}\s+preload="metadata"/);
  assert.match(mediaSource, /const AUDIO_TYPES = \["audio", "voice", "ptt", "voice_note"\]/);
  assert.match(mediaSource, /if \(AUDIO_TYPES\.includes\(type\) \|\| mime\.startsWith\("audio\/"\)\) return "audio"/);
  assert.match(transcriptSource, /MessageMedia/);
});

test("Evolution profile picture responses resolve a safe nested image URL", () => {
  assert.equal(
    extractEvolutionProfilePictureUrl({ data: { profilePictureUrl: "https://pps.whatsapp.net/avatar.jpg" } }),
    "https://pps.whatsapp.net/avatar.jpg"
  );
  assert.equal(extractEvolutionProfilePictureUrl({ data: { profilePictureUrl: "javascript:alert(1)" } }), "");
});

test("desktop and PWA inboxes render the shared customer avatar field", () => {
  assert.match(desktopInboxSource, /source\.customer_avatar_url/);
  assert.match(pwaInboxSource, /conversation\?\.customer_avatar_url/);
  // Both inboxes draw it through CustomerAvatar now — one <img>, one dead-URL
  // fallback to initials, instead of a broken-image tile in each surface.
  assert.match(desktopInboxSource, /<CustomerAvatar url=\{avatarUrl\}/);
  assert.match(pwaInboxSource, /<CustomerAvatar/);
  assert.match(avatarSource, /<img\s+src=\{avatar\}/);
  assert.match(avatarSource, /rememberDeadAvatar\(avatar\)/);
});
