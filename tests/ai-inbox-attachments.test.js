import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync("server/routes/aiAgentOrders.js", "utf8");
const uploadConfig = readFileSync("server/config/inboxAttachmentUpload.js", "utf8");
const logService = readFileSync("server/services/aiSupportLogService.js", "utf8");
const desktop = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const pwa = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));

const attachmentRoute = routes.slice(
  routes.indexOf('"/conversations/:conversationId/attachment"'),
  routes.indexOf('router.post("/conversations/:conversationId/test-meta-send"')
);
// Config assertions are about the CODE, not the comment explaining the choice.
const uploadConfigCode = uploadConfig
  .split("\n")
  .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
  .join("\n");

test("the attachment route exists and is gated on reply, not view", () => {
  assert.ok(attachmentRoute.length > 0, "the attachment route must exist");
  assert.match(attachmentRoute, /protect,\s*inboxReply\(\),/);
});

test("every message channel gets a real media send", () => {
  // Text worked everywhere and images only inside a product card, so an operator
  // answering "ابعتلي صورة" had to leave the ERP.
  assert.match(attachmentRoute, /sendImageMessage\(\{ phone: recipientId, imageUrl: relativeUrl, caption \}\)/);
  assert.match(attachmentRoute, /sendTelegramMedia\(\{ chatId: recipientId, mediaUrl: relativeUrl, mediaType: "photo", caption \}\)/);
  assert.match(attachmentRoute, /attachments: \[\{ type: "image", image_url: relativeUrl \}\]/);
  // Web chat has no transport; the row itself is the delivery.
  assert.match(attachmentRoute, /AI_AGENT_CHANNELS\.WEB_CHAT[\s\S]*?delivery_status: "stored"/);
});

test("a channel refusal is reported, not swallowed", () => {
  // Each sender is caught individually so one transport's throw becomes a failed
  // delivery on that message, never a 500 that loses the operator's file.
  const catches = attachmentRoute.match(/\.catch\(\(error\) => \(\{\s*sent: false,/g) || [];
  assert.equal(catches.length, 3, `expected a catch per transport, found ${catches.length}`);
  assert.match(attachmentRoute, /deliveryStatus = sendResult\?\.delivery_status \|\| \(sendResult\?\.sent \? "sent" : "failed"\)/);
  // The transcript row is written either way, so a failure is visible in-thread.
  assert.ok(
    attachmentRoute.indexOf("appendManualAiSupportReply") > attachmentRoute.indexOf("deliveryStatus ="),
    "the row must be written after the delivery outcome is known"
  );
  assert.match(attachmentRoute, /delivery_status: deliveryStatus/);
});

test("a failed upload does not leave an orphan on disk", () => {
  assert.match(attachmentRoute, /const discardUpload = \(\) => unlink\(req\.file\.path\)\.catch\(\(\) => \{\}\)/);
  assert.match(attachmentRoute, /catch \(error\) \{\s*await discardUpload\(\);/);
});

test("attachments do not land in the product image directory", () => {
  // uploads/products is variant-generated, watched, and has its own recovery
  // tooling; a customer photo in there looks like a product that lost its row.
  assert.match(uploadConfigCode, /"uploads", "inbox"/);
  assert.match(uploadConfigCode, /INBOX_ATTACHMENT_URL_PREFIX = "\/uploads\/inbox"/);
  assert.doesNotMatch(uploadConfigCode, /uploads[/\\]products/);
  assert.match(uploadConfigCode, /files: 1,/);
  assert.match(uploadConfigCode, /isPotentialImageUpload/);
});

test("the stored row carries the media so the bubble survives a reload", () => {
  assert.match(attachmentRoute, /visualAttachments: \[\{/);
  assert.match(attachmentRoute, /type: "image",\s*url: relativeUrl,/);
  // appendManualAiSupportReply used to drop visualAttachments on the floor.
  const append = logService.slice(
    logService.indexOf("export const appendManualAiSupportReply"),
    logService.indexOf("console.info(\"[ai-support-insert]\"")
  );
  assert.match(append, /visualAttachments = \[\],/);
  assert.match(append, /^\s+visualAttachments,$/m);
});

test("both surfaces can actually pick a file", () => {
  // Desktop had no file input at all; the PWA had one wired to a "not
  // supported" toast.
  assert.match(desktop, /type="file"\s*\n\s*accept="image\/\*"/);
  assert.match(desktop, /onAttachImage\?\.\(file\)/);
  assert.equal((desktop.match(/onAttachImage=\{sendAttachment\}/g) || []).length, 2);
  assert.doesNotMatch(pwa, /imageSendingUnsupported/);
  assert.match(pwa, /aiInboxConversationEndpoint\(canonicalSessionId, "\/attachment"\)/);
});

test("both surfaces guard against a double send", () => {
  assert.match(desktop, /if \(attachmentSendingRef\.current\) return;/);
  assert.match(pwa, /if \(attachmentSendingRef\.current\) return;/);
  // And the picker is reset before any await, or the same file cannot be
  // chosen twice in a row.
  const pwaHandler = pwa.slice(pwa.indexOf("const handleImageAttachmentChange"), pwa.indexOf("const toggleConversationAi"));
  assert.ok(
    pwaHandler.indexOf("event.target.value = \"\"") < pwaHandler.indexOf("await api.post"),
    "the input must be reset before the upload await"
  );
});

test("every new attachment string exists in both locales", () => {
  for (const key of ["attachImage", "attachImageNoteMode", "imagePreview", "imageSent", "imageSendFailed"]) {
    assert.ok(en.inbox.composer[key], `en is missing aiSupport.inbox.composer.${key}`);
    assert.ok(ar.inbox.composer[key], `ar is missing aiSupport.inbox.composer.${key}`);
  }
});
