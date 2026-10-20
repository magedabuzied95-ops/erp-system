import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Opening / switching conversations in /admin/ai-inbox and /inbox (measured on production
// 2026-10-21: 13-23 /messages calls per open on some threads, /product-classifications on every
// switch, every list row re-rendered per page render). These pin the fixes in place.
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const desktop = read("src/modules/aiSupport/pages/AiInbox.jsx");
const pwa = read("src/modules/aiSupport/pages/AiInboxPwa.jsx");
const classificationsApi = read("src/modules/products/services/productClassificationsApi.js");
const classificationsHook = read("src/modules/products/hooks/useProductClassifications.js");
const presence = read("src/modules/aiSupport/lib/useStaffPresence.js");
const desktopCss = read("src/modules/aiSupport/pages/AiInboxDesktop.css");
const pwaCss = read("src/modules/aiSupport/pages/AiInboxPwa.css");

test("product classifications are one shared, cached request, dropped by every mutation", () => {
  assert.match(classificationsHook, /loadProductClassificationsShared\(\{ includeInactive \}, \{ force \}\)/);
  assert.match(classificationsHook, /const force = refreshToken > 0;/, "only refresh() bypasses the cache");
  assert.doesNotMatch(classificationsHook, /api\.get\(/, "the hook must not fetch on its own");
  for (const name of ["createProductClassificationGroup", "updateProductClassificationGroup", "deleteProductClassificationGroup", "createProductClassificationOption", "updateProductClassificationOption", "deactivateProductClassificationOption", "deleteProductClassificationOption"]) {
    assert.match(classificationsApi, new RegExp(`export const ${name} = invalidatingClassifications\\(`), `${name} must clear the cache`);
  }
});

test("the desktop product picker is not remounted closed on every switch", () => {
  assert.match(desktop, /\{productCardPickerMounted \? \(\n\s*<ProductCardPicker\n\s*key=\{productCardPickerKey\}/);
  assert.match(desktop, /if \(productCardPickerConfig\.open\) productCardPickerMountedKeyRef\.current = productCardPickerKey;/);
});

test("staff presence hands out the same viewer array until presence changes", () => {
  assert.match(presence, /const NO_VIEWERS = Object\.freeze\(\[\]\);/);
  assert.match(presence, /const othersOn = useCallback\(\(key\) => othersBySession\[text\(key\)\] \|\| NO_VIEWERS, \[othersBySession\]\);/);
  assert.doesNotMatch(presence, /othersOn = useCallback\(\(key\) => \(viewersBySession\[text\(key\)\] \|\| \[\]\)\.filter/);
});

test("off-screen conversation rows skip style and layout on both surfaces", () => {
  assert.match(desktop, /className=\{`ai-inbox-conversation-card w-full rounded-2xl/);
  assert.match(desktopCss, /\.ai-inbox-desktop \.ai-inbox-conversation-card \{\n\s*content-visibility: auto;\n\s*contain-intrinsic-size: auto \d+px;/);
  assert.match(pwa, /<div key=\{itemKey\} className="ai-inbox-pwa-list-row py-0\.5">/);
  assert.match(pwaCss, /\.ai-inbox-pwa \.ai-inbox-pwa-list-row \{\n\s*content-visibility: auto;\n\s*contain-intrinsic-size: auto \d+px;/);
});

test("the PWA list row is memoised", () => {
  assert.match(pwa, /const PwaConversationListItem = memo\(function ConversationListItem\(/);
  assert.match(pwa, /<PwaConversationListItem\n/);
});

test("desktop transcript rows are cached per message and bubble handlers keep their identity", () => {
  assert.match(desktop, /const transcriptRowCacheRef = useRef\(new Map\(\)\);/);
  assert.match(desktop, /cached\.source === source\n\s*&& cached\.deliveryStatus === normalizedMessage\.delivery_status/);
  assert.match(desktop, /conversationMetadata = selectedConversation\?\.channel_metadata \|\| selectedConversation\?\.metadata \|\| EMPTY_CONVERSATION_METADATA;/);
  assert.doesNotMatch(desktop, /conversationMetadata: selectedConversation\?\.channel_metadata \|\| selectedConversation\?\.metadata \|\| \{\}/);
  for (const handler of ["reactToMessage", "editMessage", "deleteMessage"]) {
    const start = desktop.indexOf(`const ${handler} = useCallback(`);
    const body = desktop.slice(start, desktop.indexOf("\n  }, [", start) + 120);
    assert.match(body, /const selectedConversation = selectedConversationRef\.current;/, `${handler} reads the mirror`);
    assert.doesNotMatch(body.slice(body.lastIndexOf("}, [")), /selectedConversation[,\]]/, `${handler} must not depend on the conversation object`);
  }
});

test("the desktop transcript paints the newest bubbles first", () => {
  assert.match(desktop, /const TRANSCRIPT_FIRST_PAINT_ROWS = \d+;/);
  assert.match(desktop, /const visibleRows = firstRowIndex \? rows\.slice\(firstRowIndex\) : rows;/);
  assert.match(desktop, /\{visibleRows\.map\(\(row, visibleIndex\) => \{\n\s*const index = firstRowIndex \+ visibleIndex;/);
});

test("the PWA opens a thread with one forced newest-page fetch, once per thread", () => {
  assert.match(pwa, /if \(!key \|\| revalidatedThreadsRef\.current\.has\(key\)\) return;\n\s*revalidatedThreadsRef\.current\.add\(key\);\n\s*void loadOlderMessages\(\{ forceHydrate: true \}\);/);
  assert.doesNotMatch(pwa, /void loadOlderMessages\(\{ forceHydrate: primedNeedsRevalidate \}\)/);
});
