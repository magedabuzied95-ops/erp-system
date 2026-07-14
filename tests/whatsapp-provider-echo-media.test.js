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

test("AI Inbox renders saved WhatsApp voice messages with an audio player", () => {
  assert.match(transcriptSource, /<audio key=\{url\} controls preload="metadata"/);
  assert.match(transcriptSource, /typedMediaUrls\(message, \["audio", "voice", "ptt"\]\)/);
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
  assert.match(pwaInboxSource, /conversation\.customer_avatar_url/);
  assert.match(desktopInboxSource, /<img[\s\S]*?src=\{avatarUrl\}/);
  assert.match(pwaInboxSource, /<img[\s\S]*?src=\{avatar\}/);
});
