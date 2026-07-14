import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaSource = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
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

test("AI Inbox PWA renders direct-message channels with their brand icons", () => {
  assert.match(pwaSource, /key === "whatsapp"\) return \{ label: "WhatsApp", icon: FaWhatsapp/);
  assert.match(pwaSource, /key === "instagram" \? "Instagram DM"/);
  assert.match(pwaSource, /icon: FaInstagram/);
  assert.match(pwaSource, /icon: FaFacebookMessenger/);
});

test("AI Inbox PWA conversation list remains directly clickable and page-scrollable", () => {
  assert.doesNotMatch(pwaSource, /VirtualList/);
  assert.match(pwaSource, /filteredConversations\.map\(\(conversation\)/);
  assert.match(pwaSource, /identifiers\.conversationKey \|\| identifiers\.sessionId \|\| identifiers\.conversationId/);
});

test("AI Inbox PWA does not block conversations on secondary requests", () => {
  assert.match(pwaSource, /perfComponent: "AiInboxPwa\.conversations"/);
  assert.match(pwaSource, /timeoutMs: 20000,[\s\S]*?perfComponent: "AiInboxPwa\.conversations"/);
  assert.match(pwaSource, /setLoading\(false\);[\s\S]*?void api\.get\("\/ai-agent\/settings\/ai-assistant-global"/);
  assert.match(pwaSource, /void loadSocialComments\(/);
  assert.doesNotMatch(pwaSource, /await loadSocialComments\(\{ silent, seq \}\)/);
});

test("AI Inbox PWA first visible load always clears the initial spinner", () => {
  assert.match(pwaSource, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(pwaSource, /const isInitialLoad = requestSeqRef\.current === 0/);
  assert.match(pwaSource, /requestRefresh\("visibility", \{ silent: !isInitialLoad, force: true \}\)/);
  const loadingStops = pwaSource.match(/setLoading\(false\)/g) || [];
  assert.ok(loadingStops.length >= 2);
});
