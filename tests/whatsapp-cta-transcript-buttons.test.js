import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ctaTranscriptButtons,
  inferLegacyCtaTranscript,
  transcriptButtonsForSend,
} from "../server/utils/whatsappCtaTranscript.js";
import { performSend, transcriptForSentRow } from "../server/services/whatsappQueue/worker.js";
import { buildReviewRequestMessage } from "../server/services/productReviewRequestService.js";
import { normalizeInboxMessage } from "../server/services/aiSalesAgentService.js";

// The delivery message ("⭐ قيّمنا على جوجل") and the product-review request ("⭐ قيّم مشترياتك")
// reach the customer's phone with a button under them; the AI Inbox showed the body alone, and the
// review request even showed the raw link the phone never printed.

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const buttonTitles = (actions) => actions.filter((action) => action.type === "whatsapp_url_button").map((action) => action.title);
const footerOf = (actions) => actions.find((action) => action.type === "whatsapp_footer")?.title || "";

const deliveredRow = (overrides = {}) => ({
  id: 7,
  automation_type: "delivered",
  recipient_phone: "201126167809",
  rendered_body: "لو الخدمة عجبتك، تقييمك على جوجل بيفرق معانا كتير",
  payload: {
    send: {
      kind: "cta_url",
      title: "✅ تم تسليم طلبك بنجاح",
      footer: "M1 Store",
      displayText: "⭐ قيّمنا على جوجل",
      url: "https://g.page/r/test/review",
      fallbackText: "✅ تم تسليم طلبك بنجاح\n\nلو الخدمة عجبتك، تقييمك على جوجل بيفرق معانا كتير",
    },
    on_sent: {
      transcript: {
        session_id: "whatsapp:201126167809",
        source: "whatsapp_delivered",
        message: "✅ تم تسليم طلبك بنجاح\n\nلو الخدمة عجبتك، تقييمك على جوجل بيفرق معانا كتير",
      },
    },
  },
  ...overrides,
});

test("a CTA send's footer and button are read back off the send", () => {
  const actions = transcriptButtonsForSend(deliveredRow().payload.send);
  assert.equal(footerOf(actions), "M1 Store");
  assert.deepEqual(buttonTitles(actions), ["⭐ قيّمنا على جوجل"]);
  assert.equal(actions.find((action) => action.type === "whatsapp_url_button").value, "https://g.page/r/test/review");
  assert.deepEqual(transcriptButtonsForSend({ kind: "text" }), []);
  const copy = ctaTranscriptButtons({ footer: "F", buttons: [{ type: "copy", displayText: "انسخ", copyCode: "010" }] });
  assert.deepEqual(copy.at(-1), { type: "whatsapp_copy_button", title: "انسخ", value: "010" });
});

test("the delivery message is logged with its button when the CTA went out", () => {
  const { message, buttons } = transcriptForSentRow(deliveredRow(), { key: { id: "3EB0" } });
  assert.match(message, /^✅ تم تسليم طلبك بنجاح/);
  assert.deepEqual(buttonTitles(buttons), ["⭐ قيّمنا على جوجل"]);
  assert.equal(footerOf(buttons), "M1 Store");
});

test("a text fallback or a Cloud template carries no button", () => {
  for (const delivery_mode of ["link_text", "template"]) {
    assert.deepEqual(transcriptForSentRow(deliveredRow(), { delivery_mode }).buttons, [], delivery_mode);
  }
  assert.match(transcriptForSentRow(deliveredRow(), { delivery_mode: "link_text" }).message, /^✅/);
});

test("buttons the caller names win over the ones read off the send", () => {
  const row = deliveredRow();
  row.payload.on_sent.transcript.buttons = [{ type: "whatsapp_reply_button", id: "x", title: "X" }];
  assert.deepEqual(transcriptForSentRow(row, {}).buttons, [{ type: "whatsapp_reply_button", id: "x", title: "X" }]);
});

test("the worker marks a CTA that fell back to text", async () => {
  const gateway = {
    sendCtaUrlMessage: async () => { throw new Error("buttons refused"); },
    sendTextMessage: async () => ({ key: { id: "TEXT1" } }),
  };
  const result = await performSend(deliveredRow({ instance: "" }), gateway, { lastInboundAt: null });
  assert.equal(result.delivery_mode, "link_text");
  assert.equal(result.key.id, "TEXT1");
});

test("the review request logs header + body, and the link only as the button", () => {
  const review = buildReviewRequestMessage({ customerName: "عمرو ماجد", productNames: ["asics gel"], url: "https://m1store-egy.com/review/abc" });
  const service = read("server/services/productReviewRequestService.js");
  assert.match(service, /message: `\$\{message\.title\}\\n\\n\$\{message\.body\}`/);
  const row = {
    payload: {
      send: { kind: "cta_url", title: review.title, footer: "M1 Store", displayText: review.buttonText, url: review.url, fallbackText: review.fallbackText },
      on_sent: { transcript: { message: `${review.title}\n\n${review.body}` } },
    },
  };
  const { message, buttons } = transcriptForSentRow(row, {});
  assert.ok(!message.includes("https://"), "the phone never shows the raw link");
  assert.match(message, /^رأيك يهمنا ⭐\n\nأهلاً يا عمرو/);
  assert.deepEqual(buttonTitles(buttons), ["⭐ قيّم مشترياتك"]);
});

test("older rows get their button back — only from the day it started going out", () => {
  const delivered = "✅ تم تسليم طلبك بنجاح\n\nلو الخدمة عجبتك، تقييمك على جوجل بيفرق معانا كتير";
  const recent = inferLegacyCtaTranscript({ detectedIntent: "whatsapp_delivered", body: delivered, createdAt: "2026-09-15T16:17:00Z" });
  assert.deepEqual(buttonTitles(recent.buttons), ["⭐ قيّمنا على جوجل"]);
  assert.equal(recent.message, null, "the delivery text was already what the phone showed");
  assert.equal(inferLegacyCtaTranscript({ detectedIntent: "whatsapp_delivered", body: delivered, createdAt: "2026-08-20T10:00:00Z" }), null);
  assert.equal(inferLegacyCtaTranscript({ detectedIntent: "whatsapp_invoice", body: "🙏 شكراً", createdAt: "2026-08-26T10:00:00Z" }), null);
  assert.ok(inferLegacyCtaTranscript({ detectedIntent: "whatsapp_pos_invoice", body: "🙏 شكراً", createdAt: "2026-09-01T10:00:00Z" }));
  assert.equal(inferLegacyCtaTranscript({ detectedIntent: "whatsapp_customer_reply", body: delivered, createdAt: "2026-09-15T16:17:00Z" }), null);

  const review = buildReviewRequestMessage({ customerName: "عمرو", productNames: ["asics gel"], url: "https://m1store-egy.com/review/WZrvu1FK5H0gguXs" });
  const legacy = inferLegacyCtaTranscript({ detectedIntent: "whatsapp_product_review_request", body: review.fallbackText, createdAt: "2026-09-18T07:27:00Z" });
  assert.equal(legacy.message, `${review.title}\n\n${review.body}`);
  assert.equal(legacy.buttons.find((action) => action.type === "whatsapp_url_button").value, "https://m1store-egy.com/review/WZrvu1FK5H0gguXs");
  assert.equal(inferLegacyCtaTranscript({ detectedIntent: "whatsapp_product_review_request", body: review.body, createdAt: "2026-09-18T07:27:00Z" }), null);
});

test("the inbox serializer hands an old review row to the bubble as the phone showed it", () => {
  const review = buildReviewRequestMessage({ customerName: "عمرو", productNames: ["asics gel"], url: "https://m1store-egy.com/review/abc" });
  const message = normalizeInboxMessage({
    id: 91,
    session_id: "whatsapp:201126167809",
    sender_type: "system",
    message_text: review.fallbackText,
    staff_message: review.fallbackText,
    suggested_actions: [],
    detected_intent: "whatsapp_product_review_request",
    created_at: "2026-09-18T07:27:00Z",
  });
  assert.equal(message.staff_message, `${review.title}\n\n${review.body}`);
  assert.deepEqual(buttonTitles(message.suggested_actions), ["⭐ قيّم مشترياتك"]);

  const stored = normalizeInboxMessage({
    id: 92,
    sender_type: "system",
    message_text: "x",
    staff_message: "x",
    suggested_actions: [{ type: "whatsapp_footer", title: "M1 Store" }],
    detected_intent: "whatsapp_delivered",
    created_at: "2026-09-18T07:27:00Z",
  });
  assert.deepEqual(stored.suggested_actions, [{ type: "whatsapp_footer", title: "M1 Store" }], "a row that stored its buttons is left alone");
});

test("the direct paths log the button only after the CTA call succeeded", () => {
  for (const path of ["server/services/whatsappShippingService.js", "server/services/whatsappOrderConfirmationService.js"]) {
    const source = read(path);
    assert.match(source, /\}\);\r?\n\s*transcriptButtons = ctaUrlTranscriptButtons\(/, `${path} sets the buttons right after the CTA send`);
    assert.match(source, /suggestedActions: transcriptButtons,/, `${path} writes them to the row`);
  }
});

// On the phone a light tap on a message threw up the reactions + actions sheet, and a tap on the
// review button did the same. WhatsApp opens that sheet on a long press only, and its link button
// opens the link.
test("a finger's tap never opens the message sheet — only a long press does", () => {
  const bubble = read("src/modules/aiSupport/components/TranscriptMessage.jsx");
  assert.match(bubble, /pressPointerRef\.current = event\.pointerType \|\| "";\s*if \(event\.pointerType === "mouse"\) return;/, "the press records what it was made with");
  assert.match(bubble, /if \(pressPointerRef\.current && pressPointerRef\.current !== "mouse"\) return;\s*if \(!canOpenActionsFrom\(event\.target\)\) return;\s*openActions\(event\.target\);/, "the click opens the sheet for a mouse only");
  assert.match(bubble, /pressTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]{0,400}openActions\(target\);/, "the long press still opens it");
});

test("a link button opens its link and a copy button copies, as in WhatsApp", () => {
  const bubble = read("src/modules/aiSupport/components/TranscriptMessage.jsx");
  assert.match(bubble, /button\.type === "whatsapp_url_button" && isWebLink\(value\)[\s\S]{0,120}<a key=\{rowKey\} \{\.\.\.rowProps\} data-whatsapp-button="url" href=\{value\} target="_blank" rel="noopener noreferrer">/);
  assert.match(bubble, /button\.type === "whatsapp_copy_button" && value[\s\S]{0,120}<button key=\{rowKey\} \{\.\.\.rowProps\} data-whatsapp-button="copy" type="button" onClick=\{\(\) => void copyValue\(value, index\)\}>/);
  // A tapped link or button must never double as the gesture that opens the sheet.
  assert.match(bubble, /if \(target\.closest\("a, button, input, textarea, select, audio, video, \[role='button'\]"\)\) return false;/);
});
