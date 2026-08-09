import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaSource = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const pwaStyles = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.css", import.meta.url), "utf8");
const serviceSource = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");

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

test("legacy Facebook DM sessions remain visible under Messenger", () => {
  assert.match(serviceSource, /IN \('facebook_messenger', 'facebook', 'messenger'\)/);
});

test("AI Inbox hides regression fixtures without deleting production data", () => {
  assert.match(serviceSource, /mock-product-card:%/);
  assert.match(serviceSource, /example\.com\/regression\//);
  assert.match(serviceSource, /NOT EXISTS \(/);
});

test("Messenger message fragments cannot override the stored account name", () => {
  assert.match(serviceSource, /readableSystemCustomerName/);
  assert.match(serviceSource, /isHumanReadableDisplayName\(systemCustomer\.name/);
  assert.match(serviceSource, /const customerName = readableSystemCustomerName \|\|/);
});

test("numeric Messenger ids stay Messenger and legacy WhatsApp URLs resolve to the stored session", () => {
  assert.match(pwaSource, /\(!detectedPrefix && \/\^\\\+\?\\d\+\$\//);
  assert.match(routeSource, /safeExternalCustomerId = safeConversationId\.replace/);
  assert.match(routeSource, /resolved\.conversation\?\.session_id/);
  assert.match(routeSource, /let conversationId = requestedConversationId/);
  assert.match(routeSource, /session_id: channelRow\?\.external_conversation_id \|\| sessionRow\?\.session_id/);
  assert.match(routeSource, /LOWER\(COALESCE\(channel, ''\)\) IN \('whatsapp', 'facebook_messenger', 'facebook', 'messenger', 'instagram'\)/);
});

test("dirty Messenger CRM matches do not override Customer 360", () => {
  assert.match(serviceSource, /const validatedSystemCustomer = readableSystemCustomerName \? systemCustomer : null/);
  assert.match(serviceSource, /erp_customer_id: validatedSystemCustomer\?\.id/);
  assert.match(serviceSource, /id: validatedSystemCustomer\?\.id/);
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

test("AI Inbox PWA keeps social comments exclusively in Social Comments", () => {
  const commentExclusions = pwaSource.match(/if \(isSocialCommentThread\(conversation\)\) return false;/g) || [];
  assert.ok(commentExclusions.length >= 2, "comments must be excluded from both the list and direct selection");
  assert.doesNotMatch(pwaSource, /\{ key: "comments", label: "Comments" \}/);
  assert.doesNotMatch(pwaSource, /\{ key: "messages", label: "Messages" \}/);
  assert.match(pwaSource, /\{ key: "all", label: "All" \},\s*\{ key: "needs_reply", label: "Needs Reply" \}/);
  assert.match(pwaSource, /\{tab === "conversations" \? \([\s\S]*?MESSAGE_PLATFORM_FILTERS\.map/);
  assert.match(pwaSource, /placeholder="Search messages"/);
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

test("AI Inbox PWA uses the shared M1 light and dark theme", () => {
  assert.match(pwaSource, /const \{ theme, setTheme \} = useTheme\(\)/);
  assert.match(pwaSource, /setTheme\(isDarkTheme \? "light" : "dark"\)/);
  assert.match(pwaSource, /aria-label=\{isDarkTheme \? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"\}/);
  assert.match(pwaStyles, /html\[data-theme="dark"\] \.ai-inbox-pwa/);
});

test("AI Inbox PWA expands on desktop while keeping a mobile layout", () => {
  assert.doesNotMatch(pwaSource, /max-w-\[430px\]/);
  assert.match(pwaStyles, /width: min\(100%, 1280px\)/);
  assert.match(pwaStyles, /@media \(min-width: 768px\)/);
  assert.match(pwaStyles, /@media \(max-width: 767px\)/);
});

test("AI Inbox PWA social comments use a defined reply template", () => {
  assert.doesNotMatch(pwaSource, /replyDraft=\{replyDraft\}/);
  assert.doesNotMatch(pwaSource, /previewReply=\{previewReply\}/);
  assert.doesNotMatch(pwaSource, /suggestedReply=\{suggestedReply\}/);
  assert.match(pwaSource, /replyDraft=\{templateText \|\| genericTemplateText\}/);
});

test("AI Inbox PWA product picker keeps product details open and exposes POS filters", () => {
  assert.doesNotMatch(pwaSource, /if \(!open\) return;\s*setView\("list"\);\s*const firstId/);
  assert.match(pwaSource, /PRODUCT_FILTER_DEFAULTS/);
  assert.match(pwaSource, /\["men", "رجالي"\]/);
  assert.match(pwaSource, /label="البراند"/);
  assert.match(pwaSource, /label="القسم الرئيسي"/);
  assert.match(pwaSource, /label="نوع المنتج"/);
  assert.match(pwaSource, /label="المصنّع"/);
  assert.match(pwaSource, /label="المخزون"/);
});

test("AI Inbox PWA product picker follows light and dark mode even through its mobile portal", () => {
  assert.match(pwaSource, /ai-pwa-product-sheet ai-pwa-product-sheet--mobile/);
  assert.match(pwaStyles, /html\[data-theme="dark"\] \.ai-pwa-product-sheet--mobile/);
  assert.match(pwaStyles, /html\[data-theme="dark"\] \.ai-pwa-product-sheet input/);
  assert.match(pwaStyles, /html\[data-theme="dark"\] \.ai-pwa-product-sheet select/);
});
