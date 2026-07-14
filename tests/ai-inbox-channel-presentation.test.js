import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const serviceSource = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");

test("AI Inbox renders each direct-message channel with its own label", () => {
  assert.match(source, /channel === "whatsapp"\) return "WhatsApp"/);
  assert.match(source, /channel === "instagram"\) return "Instagram DM"/);
  assert.match(source, /channel === "messenger"\) return "Messenger"/);
  assert.match(source, /channel === "web"\) return "Web Chat"/);
});

test("AI Inbox renders WhatsApp and Instagram with their own icons", () => {
  assert.match(source, /channel === "whatsapp"\) return FaWhatsapp/);
  assert.match(source, /channel === "instagram"\) return FaInstagram/);
  assert.match(source, /channel === "messenger"\) return FaFacebookMessenger/);
});

test("AI Inbox conversation selection uses the stored conversation identity without an undefined helper", () => {
  assert.doesNotMatch(source, /conversationIdentifiers\(item\)/);
  assert.match(source, /item\?\.conversation_key \|\|\s*conversationKey\(item\)/);
  assert.match(source, /setSelectedSessionId\(nextConversationId\)/);
});

test("AI Inbox conversation panes are independently scrollable", () => {
  const scrollableConversationPanes = source.match(/min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1/g) || [];
  assert.ok(scrollableConversationPanes.length >= 2);
});

test("AI Inbox queues a filter refresh instead of dropping it during an active request", () => {
  assert.match(source, /if \(isRefreshingRef\.current\) \{[\s\S]*?source: "filters"[\s\S]*?refreshQueueRef\.current/);
});

test("AI Inbox prioritizes WhatsApp direct messages in the initial summary", () => {
  assert.match(serviceSource, /IN \('facebook_messenger', 'instagram', 'whatsapp'\) THEN 0/);
});
