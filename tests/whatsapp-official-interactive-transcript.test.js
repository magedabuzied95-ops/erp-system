import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { interactiveTranscript, templateTranscript } from "../server/utils/whatsappCtaTranscript.js";
import { buildInteractivePayload, buildTemplateTranscript } from "../server/modules/whatsappOfficial/flows/flowSender.js";
import { registryTemplateTranscript, transcriptForSentRow } from "../server/services/whatsappQueue/worker.js";
import { extractWhatsAppWebhookMessages } from "../server/services/aiChannelAdapterService.js";
import { messageAuthorKind } from "../src/modules/aiSupport/services/messageAuthor.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a chatbot reply-button message keeps its header, footer and buttons for the inbox", () => {
  const payload = buildInteractivePayload({
    type: "interactive_buttons",
    data: { header: "M1 Store", body: "Hi {{name}}", footer: "choose", buttons: [{ id: "track", title: "Track" }, { id: "agent", title: "Agent" }] },
  }, { name: "Mai" });
  const transcript = interactiveTranscript(payload.interactive);
  assert.equal(transcript.message, "Hi Mai", "message_text stays the body alone");
  assert.equal(transcript.messageType, "interactive");
  assert.deepEqual(transcript.actions, [
    { type: "whatsapp_header", title: "M1 Store" },
    { type: "whatsapp_footer", title: "choose" },
    { type: "whatsapp_reply_button", id: "track", title: "Track" },
    { type: "whatsapp_reply_button", id: "agent", title: "Agent" },
  ]);
});

test("a list keeps its menu button and its rows; a CTA keeps its link", () => {
  const list = interactiveTranscript(buildInteractivePayload({
    type: "interactive_list",
    data: { body: "pick", button_label: "Menu", sections: [{ title: "S", rows: [{ id: "r1", title: "Row", description: "d" }] }] },
  }, {}).interactive);
  assert.deepEqual(list.actions.map((action) => action.type), ["whatsapp_list_button", "whatsapp_list_row"]);
  const cta = interactiveTranscript({ type: "cta_url", body: { text: "b" }, action: { name: "cta_url", parameters: { display_text: "Open", url: "https://x.test/a" } } });
  assert.deepEqual(cta.actions, [{ type: "whatsapp_url_button", title: "Open", value: "https://x.test/a" }]);
  const media = interactiveTranscript({ type: "button", header: { type: "image", image: { link: "https://x.test/p.jpg" } }, body: { text: "b" }, action: { buttons: [] } });
  assert.deepEqual(media.attachments, [{ type: "image", url: "https://x.test/p.jpg", title: "" }]);
});

test("a template is logged with its variables filled and every kind of button", () => {
  const transcript = buildTemplateTranscript({
    header_format: "TEXT",
    header_text: "Hi {{1}}",
    body_text: "Order {{1}} costs {{2}}",
    footer_text: "M1",
    buttons: [
      { type: "QUICK_REPLY", text: "Yes" },
      { type: "URL", text: "Open", url: "https://x.test/{{1}}" },
      { type: "PHONE_NUMBER", text: "Call", phone_number: "+201000" },
      { type: "COPY_CODE", example: "SAVE10" },
    ],
  }, { variables: ["{{order}}", "90"], header_variable: "{{name}}", button_variables: { 1: "abc" } }, { order: "INV-1", name: "Mai" });
  assert.equal(transcript.message, "Order INV-1 costs 90");
  assert.equal(transcript.messageType, "template");
  assert.deepEqual(transcript.actions, [
    { type: "whatsapp_header", title: "Hi Mai" },
    { type: "whatsapp_footer", title: "M1" },
    { type: "whatsapp_reply_button", id: "", title: "Yes" },
    { type: "whatsapp_url_button", title: "Open", value: "https://x.test/abc" },
    { type: "whatsapp_call_button", title: "Call", value: "+201000" },
    { type: "whatsapp_copy_button", title: "", value: "SAVE10" },
  ]);
  const imageHeader = templateTranscript({ template: { header_format: "IMAGE", header_media_url: "https://x.test/h.jpg", body_text: "b" } });
  assert.deepEqual(imageHeader.attachments, [{ type: "image", url: "https://x.test/h.jpg", title: "" }]);
});

test("a queued message that left as a Cloud template is logged as that template", () => {
  const sent = registryTemplateTranscript("order_confirmation", { customer_name: "Mai", order_number: "INV-7" });
  assert.match(sent.message, /INV-7/);
  assert.ok(sent.actions.every((action) => action.type === "whatsapp_reply_button"));
  const row = { automation_type: "order_confirmation", rendered_body: "free-form text", payload: { on_sent: { transcript: { message: "free-form text" } } } };
  const logged = transcriptForSentRow(row, { delivery_mode: "template", template_transcript: sent });
  assert.equal(logged.message, sent.message);
  assert.equal(logged.messageType, "template");
  assert.equal(logged.buttons.length, 3);
  assert.deepEqual(transcriptForSentRow(row, { delivery_mode: "template" }).buttons, [], "no transcript, no invented buttons");
});

test("a Cloud button tap keeps the id of the message it answered", () => {
  const [message] = extractWhatsAppWebhookMessages({
    tenantId: 1,
    body: { entry: [{ changes: [{ value: { metadata: {}, messages: [{ from: "201000000000", id: "wamid.TAP", type: "interactive", context: { id: "wamid.BOT" }, interactive: { type: "button_reply", button_reply: { id: "track", title: "Track" } } }] } }] }] },
  });
  assert.equal(message.message_text, "Track");
  assert.equal(message.reply_to_message_id, "wamid.BOT");
  const orders = read("server/routes/aiAgentOrders.js");
  assert.ok(orders.includes('externalReplyId: message.reply_to_message_id || ""'));
  const log = read("server/services/aiSupportLogService.js");
  assert.ok(log.includes('(isInbound ? "" : externalReplyId)'), "a quoted id never becomes an inbound row's identity");
});

test("a delivery tick no longer re-stamps who wrote the row", () => {
  const gateway = read("server/routes/whatsappGateway.js");
  assert.ok(!gateway.includes('sourcePath: "whatsapp_cloud_status_webhook"'));
  assert.equal(messageAuthorKind({ sender_type: "system", source_path: "whatsapp_cloud_status_webhook", detected_intent: "wa_chatbot_flow" }), "chatbot");
});
