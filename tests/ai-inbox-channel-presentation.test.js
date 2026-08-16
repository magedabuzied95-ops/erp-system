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
  assert.match(source, /channel === "telegram"\) return "Telegram"/);
  assert.match(source, /channel === "web"\) return "Web Chat"/);
});

test("AI Inbox renders WhatsApp and Instagram with their own icons", () => {
  assert.match(source, /channel === "whatsapp"\) return FaWhatsapp/);
  assert.match(source, /channel === "instagram"\) return FaInstagram/);
  assert.match(source, /channel === "messenger"\) return FaFacebookMessenger/);
  assert.match(source, /channel === "telegram"\) return FaTelegramPlane/);
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
  assert.match(serviceSource, /IN \('facebook_messenger', 'instagram', 'whatsapp', 'telegram'\) THEN 0/);
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
  // Labels became translation keys when the inbox was localized. Asserting the English
  // string tested the language, not the channel wiring — and would fail again the next
  // time a word is reworded. The icon binding is the part that must not drift.
  assert.match(pwaSource, /key === "whatsapp"\) return \{ labelKey: "[^"]+", icon: FaWhatsapp/);
  assert.match(pwaSource, /key === "instagram" \? "aiSupport\.inbox\.pwa\.instagramDm"/, "a DM must be labelled as a DM, not as the feed");
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
  // Keyed on the tab `key`, not its label: the label is now a translation key, and the
  // exclusion being tested is about which tabs EXIST, which the key expresses and the
  // wording does not.
  assert.doesNotMatch(pwaSource, /\{ key: "comments",/, "a comments tab must not exist in the message inbox");
  assert.doesNotMatch(pwaSource, /\{ key: "messages",/);
  // The platform filter list must offer "all" and must not offer a comment platform.
  // The old assertion also pinned a `needs_reply` TAB, which no longer exists — the
  // needs-reply filter survives as a value, so pinning it here was testing a piece of
  // chrome, not the comment/message separation this test is about.
  assert.match(pwaSource, /MESSAGE_PLATFORM_FILTERS = \[[\s\S]*?\{ key: "all", labelKey: "[^"]+" \}/);
  const filterList = pwaSource.slice(
    pwaSource.indexOf("MESSAGE_PLATFORM_FILTERS = ["),
    pwaSource.indexOf("];", pwaSource.indexOf("MESSAGE_PLATFORM_FILTERS = ["))
  );
  assert.ok(!/comment/i.test(filterList), "no comment platform may appear in the message filters");
  assert.match(pwaSource, /\{tab === "conversations" \? \([\s\S]*?MESSAGE_PLATFORM_FILTERS\.map/);
  // Localized: the search box must exist and be labelled, in whatever language.
  assert.match(pwaSource, /placeholder=\{t\("aiSupport\.inbox\.pwa\.searchMessages"\)\}/);
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
  // The toggle must still announce which mode it switches TO, and the two labels must
  // differ — a single label for both states is the accessibility bug this guards.
  // Localized, so the assertion is on the conditional wiring, not the Arabic wording.
  assert.match(
    pwaSource,
    /aria-label=\{isDarkTheme \? t\("aiSupport\.inbox\.pwa\.lightMode"\) : t\("aiSupport\.inbox\.pwa\.darkMode"\)\}/
  );
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
  // The VALUE side of each pair is what the server filters on and must stay a stable
  // identifier; only the human label became a translation key. Asserting the Arabic
  // label tested the wording and would fail on any rewording.
  assert.match(pwaSource, /\["men", t\("[^"]+"\)\]/, "gender filter must keep the stable 'men' value");
  // The individual filter labels moved into the shared SmartPosFilters panel, so the
  // PWA's side of the contract is now the wiring it passes down. That is the real
  // invariant anyway: inline labels could be present and still not filter anything.
  assert.match(pwaSource, /<SmartPosFilters/, "the shared POS filter panel must be mounted");
  for (const prop of [
    "smartFilterOptions",
    "onGenderChange",
    "onProductTypeChange",
    "onGradeChange",
    "onBrandChange",
    "onManufacturerChange",
  ]) {
    assert.match(pwaSource, new RegExp(`${prop}=\\{`), `the ${prop} POS filter must still be wired`);
  }
});

test("AI Inbox PWA product picker follows light and dark mode even through its mobile portal", () => {
  // The mobile sheet renders through createPortal into document.body, so it has no
  // app-shell ancestor. Theming it therefore depends on two things, and this test
  // pinned neither: the portaled element must carry the BASE class the dark rules
  // target, and those rules must hang off html[data-theme], which is the only ancestor
  // a portaled node still has. A `--mobile`-specific rule was incidental; it was
  // removed as redundant once the base class covered it, and the theme still works.
  assert.match(pwaSource, /ai-pwa-product-sheet ai-pwa-product-sheet--mobile/, "the portaled sheet must carry the base class");

  const darkSheetRules = (pwaStyles.match(/html\[data-theme="dark"\] \.ai-pwa-product-sheet/g) || []).length;
  assert.ok(darkSheetRules >= 5, `the sheet needs dark rules to follow the theme, found ${darkSheetRules}`);
  assert.match(pwaStyles, /html\[data-theme="dark"\] \.ai-pwa-product-sheet input/);
  assert.match(pwaStyles, /html\[data-theme="dark"\] \.ai-pwa-product-sheet select/);

  // A rule scoped to an app-shell ancestor would silently miss the portal.
  assert.ok(
    !/\.m1-shell-content[^{]*\.ai-pwa-product-sheet/.test(pwaStyles),
    "sheet theming must not depend on a shell ancestor the portal escapes"
  );
});
