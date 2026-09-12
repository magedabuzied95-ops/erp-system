import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCodOrderConfirmationMessage,
  inferOrderConfirmationButtons,
  orderConfirmationTranscriptButtons,
} from "../server/utils/orderConfirmationMessage.js";

// The AI inbox showed the confirmation prompt as a body ending in "⬇️ برجاء التأكيد" with
// nothing under it: the buttons went to the customer but never reached the transcript row.
// And the customer's tap, written without a per-row broadcast, never appeared in an open thread.

const ORDER = { invoice_number: "INV-1468", cod_amount: 1640, governorate: "الغربيه" };
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the transcript buttons are the three the customer is sent", () => {
  const buttons = orderConfirmationTranscriptButtons();
  assert.deepEqual(buttons.map((button) => button.id), ["confirm_order", "edit_order", "cancel_order"]);
  assert.ok(buttons.every((button) => button.type === "whatsapp_reply_button" && button.title));
  const gateway = read("server/services/whatsappGatewayService.js");
  assert.match(gateway, /ORDER_CONFIRMATION_BUTTONS\.map\(\(button\) => \(\{\s*type: "reply"/, "the send payload reads the same list");
});

test("an older button-form row gets its buttons back, the text fallback does not", () => {
  const buttonsBody = buildCodOrderConfirmationMessage({ customerName: "محمد", order: ORDER });
  assert.equal(inferOrderConfirmationButtons({ detectedIntent: "whatsapp_order_confirmation", body: buttonsBody }).length, 3);

  const textBody = buildCodOrderConfirmationMessage({ customerName: "محمد", order: ORDER, withActions: true, confirmationLink: "https://x.test/c/abc" });
  assert.equal(inferOrderConfirmationButtons({ detectedIntent: "whatsapp_order_confirmation", body: textBody }).length, 0);

  assert.equal(inferOrderConfirmationButtons({ detectedIntent: "whatsapp_customer_reply", body: buttonsBody }).length, 0);
});

test("the queue writes the buttons only when they went out", () => {
  const worker = read("server/services/whatsappQueue/worker.js");
  assert.match(worker, /delivery_mode: "link_text"/, "a text fallback is marked");
  assert.match(worker, /suggestedActions: transcriptButtons/);
  assert.match(worker, /!fellBackToText && Array\.isArray\(transcript\.buttons\)/);
  const service = read("server/services/whatsappOrderConfirmationService.js");
  assert.match(service, /buttons: orderConfirmationTranscriptButtons\(\)/);
});

test("the list summary carries the message's own id, not the session's", () => {
  const service = read("server/services/aiSalesAgentService.js");
  assert.match(service, /\.\.\.conversation,\s*\/\/[^\n]*\n[^\n]*\n\s*id: conversation\.latest_message_id,/);
});

test("both inboxes refetch a loaded thread the server says changed", () => {
  for (const page of ["src/modules/aiSupport/pages/AiInbox.jsx", "src/modules/aiSupport/pages/AiInboxPwa.jsx"]) {
    const source = read(page);
    assert.match(source, /thread_stale_at: staleAt/, `${page} marks the thread on ai_inbox:refresh`);
    assert.match(source, /selectedThreadStaleAt <= selectedThreadHydratedAt/, `${page} refetches once per mark`);
    assert.match(source, /thread_hydrated_at: requestStartedAt/, `${page} stamps a full-page load`);
  }
  const desktop = read("src/modules/aiSupport/pages/AiInbox.jsx");
  assert.match(desktop, /threadBehind \? \{ thread_stale_at: Date\.now\(\) \}/, "a summary the thread never saw marks it behind");
});

test("the bubble draws the reply buttons", () => {
  const bubble = read("src/modules/aiSupport/components/TranscriptMessage.jsx");
  assert.match(bubble, /action\?\.type === "whatsapp_reply_button"/);
  assert.match(bubble, /<ReplyButtons buttons=\{replyButtons\} skin=\{skin\} \/>/);
});

test("cached summary snapshots joined by the session id no longer swallow the real rows", async () => {
  const { messageIdentityKeys, messagesConflict } = await import("../src/modules/aiSupport/lib/conversationHelpers.js");
  // Same shape as the desktop inbox's mergeMessagesByIdentity.
  const merge = (messages) => {
    const merged = [];
    const indexes = new Map();
    for (const message of messages) {
      const keys = messageIdentityKeys(message);
      const found = keys.reduce((hit, key) => hit ?? indexes.get(key), undefined);
      if (found !== undefined && !messagesConflict(merged[found], message)) {
        merged[found] = { ...merged[found], ...message };
        messageIdentityKeys(merged[found]).forEach((key) => indexes.set(key, found));
      } else {
        const next = merged.push(message) - 1;
        keys.forEach((key) => indexes.set(key, next));
      }
    }
    return merged;
  };
  const SESSION_ROW_ID = "4242";
  const cached = [
    { id: "709362", provider_message_id: "3EB0D39A" },
    { id: SESSION_ROW_ID, provider_message_id: "3EB0984F" }, // summary snapshot at 15:23
    { id: SESSION_ROW_ID, provider_message_id: "3A5DA255" }, // summary snapshot at 15:31
  ];
  const page = [
    { id: "709362", provider_message_id: "3EB0D39A" },
    { id: "709492", provider_message_id: "3EB0984F" },
    { id: "709493", provider_message_id: "3A5DA255" },
    { id: "709494", provider_message_id: "" },
    { id: "709495", provider_message_id: "3EB008A7" },
  ];
  const ids = merge([...cached, ...page]).map((message) => message.id);
  for (const id of ["709362", "709492", "709493", "709494", "709495"]) {
    assert.ok(ids.includes(id), `row ${id} is its own bubble`);
  }
  // A provider echo of our own row is still one message.
  assert.equal(merge([{ id: "sending-1", client_request_id: "r1" }, { id: "900", client_request_id: "r1", provider_message_id: "P" }]).length, 1);
  assert.equal(merge([{ id: "900", provider_message_id: "P" }, { id: "900", provider_message_id: "P", delivery_status: "read" }]).length, 1);
});

test("opening a thread always loads its newest page once, whatever the cache holds", () => {
  for (const page of ["src/modules/aiSupport/pages/AiInbox.jsx", "src/modules/aiSupport/pages/AiInboxPwa.jsx"]) {
    const source = read(page);
    assert.match(source, /const neverLoaded = !selectedThreadHydratedAt;/, `${page} treats a never-loaded thread as behind`);
    assert.match(source, /if \(!neverLoaded && selectedThreadStaleAt <= selectedThreadHydratedAt\) return undefined;/);
  }
});
