import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INBOX_ATTACHMENT_IMAGE_MAX_BYTES,
  INBOX_ATTACHMENT_VIDEO_MAX_BYTES,
  inboxAttachmentKind,
  isSendableInboxVideo,
} from "../server/config/inboxAttachmentUpload.js";
import { sendTelegramMedia } from "../server/services/telegramBotService.js";
import whatsappCloud from "../server/services/whatsappCloudProvider.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const routeSource = read("../server/routes/aiAgentOrders.js");
const gatewaySource = read("../server/services/whatsappGatewayService.js");
const metaSource = read("../server/services/metaIntegrationService.js");

/*
 * An operator's attachment reaches four different transports, and each one needs
 * to be TOLD it is carrying a clip: Evolution wants `mediatype: video`, Graph
 * wants `type: video`, Telegram wants sendVideo. Get any of them wrong and the
 * upload succeeds, the row is written, and the customer receives a broken bubble
 * or an undownloadable file — the failure mode that reads as "it never arrived".
 */

test("a clip is recognised as a video, whatever named it", () => {
  assert.equal(inboxAttachmentKind({ originalname: "clip.mp4", mimetype: "video/mp4" }), "video");
  assert.equal(inboxAttachmentKind({ originalname: "IMG_4410.MOV", mimetype: "video/quicktime" }), "video");
  // A file dragged out of some apps arrives with no mime at all.
  assert.equal(inboxAttachmentKind({ originalname: "clip.mp4", mimetype: "" }), "video");
  assert.equal(inboxAttachmentKind({ originalname: "rec.3gp", mimetype: "application/octet-stream" }), "video");
});

test("a photo is still a photo, and an unknown mime is not a video", () => {
  assert.equal(inboxAttachmentKind({ originalname: "shot.png", mimetype: "image/png" }), "image");
  assert.equal(inboxAttachmentKind({ originalname: "photo.jpg", mimetype: "image/jpeg" }), "image");
  // isPotentialImageUpload lets an unknown mime through as an image; that must
  // not happen BEFORE video has had its say, or every clip becomes a photo.
  assert.equal(inboxAttachmentKind({ originalname: "dragged", mimetype: "" }), "image");
});

test("only containers the channels actually carry are sendable", () => {
  for (const name of ["clip.mp4", "IMG.MOV", "rec.3gp", "a.m4v"]) {
    assert.equal(isSendableInboxVideo({ originalname: name, mimetype: "" }), true, name);
  }
  // These upload happily and are then refused by the channel, so they are turned
  // away while the operator can still be told to convert.
  for (const name of ["movie.mkv", "screen.webm", "old.avi"]) {
    assert.equal(isSendableInboxVideo({ originalname: name, mimetype: "" }), false, name);
  }
});

test("a clip gets more room than a photo, and WhatsApp's ceiling is the one used", () => {
  assert.ok(INBOX_ATTACHMENT_VIDEO_MAX_BYTES > INBOX_ATTACHMENT_IMAGE_MAX_BYTES);
  assert.equal(INBOX_ATTACHMENT_VIDEO_MAX_BYTES, 16 * 1024 * 1024);
});

test("the attachment route hands every transport the kind it received", () => {
  const route = routeSource.slice(routeSource.indexOf('"/conversations/:conversationId/attachment"'));
  const body = route.slice(0, route.indexOf("test-meta-send"));
  // WhatsApp: the mediatype travels, rather than the old hard-coded image send.
  assert.match(body, /sendWhatsappMediaMessage\(\{[\s\S]*?mediaType: attachmentKind/);
  // Telegram: sendPhoto would deliver a clip as a still.
  assert.match(body, /mediaType: attachmentKind === "video" \? "video" : "photo"/);
  // Meta: the attachment descriptor carries the type Graph reads.
  assert.match(body, /attachments: \[\{ type: attachmentKind/);
  // And the stored row says what it is, so the transcript draws a player.
  assert.match(body, /messageType: attachmentKind/);
  assert.match(body, /visualAttachments: \[\{\s*type: attachmentKind/);
});

test("Evolution is told the mediatype and a matching mimetype", () => {
  const send = gatewaySource.slice(gatewaySource.indexOf("export const sendWhatsappMediaMessage"));
  assert.match(send, /mediatype: kind/);
  // image/jpeg on a clip is what makes a video arrive as a broken bubble.
  assert.match(send, /videoMimeType\(media\) \|\| "video\/mp4"/);
  assert.ok(gatewaySource.includes("export const sendVideoMessage"));
  // The image signature is kept for the dozens of product-photo callers.
  assert.ok(gatewaySource.includes("export const sendImageMessage"));
});

test("Graph is told the attachment type instead of always being told image", () => {
  assert.match(metaSource, /const attachmentType = text\(mediaType\)\.toLowerCase\(\) === "video" \? "video" : "image"/);
  assert.match(metaSource, /attachment: \{\s*type: attachmentType,/);
});

test("an uncaptioned attachment is a message in its own right", () => {
  // The old guard counted only text and product cards, so a photo with nothing
  // written under it was refused as "message required" on Messenger/Instagram.
  assert.match(
    metaSource,
    /!safeMessage && !cards\.length && !mediaAttachments\.length/
  );
  // ...and the empty text post that would follow it is skipped rather than
  // failing a send that already reached the customer.
  assert.match(metaSource, /const textPostWouldBeEmpty = !safeMessage && imageResults\.length > 0/);
});

/*
 * Caught live, sending to a real number: the photo reached WhatsApp and the
 * route THEN answered 400 "Reply message is required", because the transcript
 * writer counted only text and product cards. The customer had the picture; the
 * operator was told it failed and shown nothing, so they sent it again. That is
 * the whole of "I send a picture and sometimes it doesn't arrive".
 */
test("an uncaptioned attachment is a message the transcript will accept", () => {
  const logSource = read("../server/services/aiSupportLogService.js");
  assert.match(
    logSource,
    /!\(safeMessage \|\| safeProductCards\.length \|\| safeVisualAttachments\.length\)/
  );
});

test("an uncaptioned attachment still gives the conversation list a preview", () => {
  // The forced last_message UPDATE writes whatever it is given, so an empty
  // caption blanked the inbox row. The caption stays exact for the bubble.
  const route = routeSource.slice(routeSource.indexOf('"/conversations/:conversationId/attachment"'));
  const body = route.slice(0, route.indexOf("test-meta-send"));
  assert.match(body, /preserveExactMessage: true/);
  assert.match(body, /previewMessage: caption \|\| \(attachmentKind === "video"/);
});

/*
 * Also caught live: Evolution logged the photo as sent, and the row said failed.
 * The WhatsApp gateway reports `success` and throws on failure — it has never
 * had the `sent` / `delivery_status` pair the route was reading off it, so every
 * delivered photo was recorded as undelivered.
 */
test("a WhatsApp send that succeeded is not recorded as failed", () => {
  const route = routeSource.slice(routeSource.indexOf('"/conversations/:conversationId/attachment"'));
  const body = route.slice(0, route.indexOf("test-meta-send"));
  const whatsappStart = body.indexOf("sendWhatsappMediaMessage");
  const whatsappBranch = body.slice(whatsappStart, body.indexOf("sendTelegramMedia", whatsappStart));
  assert.ok(whatsappBranch.length > 0, "the WhatsApp branch was not found in the route");
  assert.match(whatsappBranch, /sent: true/);
  assert.match(whatsappBranch, /delivery_status: "sent"/);
  // ...and the provider id, which lives under result.key.id, without which the
  // delivery ticks can never be reconciled onto the row.
  assert.match(whatsappBranch, /result\?\.result\?\.key\?\.id/);
});

test("Telegram maps a clip to sendVideo, not sendDocument", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  };
  await sendTelegramMedia({
    chatId: "123",
    mediaUrl: "https://api.example.com/uploads/inbox/clip.mp4",
    mediaType: "video",
    token: "test-token",
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sendVideo$/);
  assert.equal(calls[0].body.video, "https://api.example.com/uploads/inbox/clip.mp4");
});

test("the Cloud transport can send a clip at all", () => {
  // sendWhatsappMediaMessage routes a cloud-transport video here; without it the
  // call is a TypeError at send time rather than a delivery failure.
  assert.equal(typeof whatsappCloud.sendVideo, "function");
  assert.match(gatewaySource, /whatsappCloud\.sendVideo\(\{ phone: normalizedPhone, videoUrl: media/);
});
