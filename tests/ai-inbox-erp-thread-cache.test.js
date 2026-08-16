import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// ERP-integrated AI Inbox (/admin/ai-inbox): warm thread cache, refresh-storm
// control, secondary-data deferral and send safety.
const src = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const facade = fs.readFileSync(new URL("../src/modules/aiSupport/services/inboxCache/inboxCache.js", import.meta.url), "utf8");

// ---- PRIORITY 2: per-thread message SWR cache ---------------------------

test("opening a conversation primes its cached messages from the SHARED module", () => {
  assert.match(src, /inboxCache\.primeThread\(key\)/);
  // cached window merges UNDER what's on screen, using the app's own dedup fn
  assert.match(src, /mergeMessagesByIdentity\(\[\.\.\.cachedMessages, \.\.\.asArray\(conversation\.messages\)\]\)/);
  // no duplicated cache implementation in the page
  assert.doesNotMatch(src, /indexedDB\.open\(/);
});

test("the thread window is persisted through the shared cache, not inline storage", () => {
  assert.match(src, /inboxCache\.saveThread\(key, messages, mergeMessagesByIdentity\)/);
  assert.match(facade, /export const saveThread = \(conversationKey, messages, mergeFn\)/);
});

test("a cache-primed thread is still revalidated against the server (server stays authoritative)", () => {
  // the ">1 message" shortcut must not swallow revalidation of a primed thread
  assert.match(src, /const primedNeedsRevalidation = cachePrimedThreadsRef\.current\.has\(key\) && !hydratedThreadsRef\.current\.has\(key\)/);
  assert.match(src, /if \(asArray\(selectedConversation\.messages\)\.length > 1 && !primedNeedsRevalidation\) return;/);
  assert.match(src, /loadOlderMessages\(\{ forceHydrate: primedNeedsRevalidation \}\)/);
  // forceHydrate fetches the NEWEST page (no `before` cursor)
  assert.match(src, /const shouldHydrateFullPage = forceHydrate === true/);
});

test("revalidation is attempted at most once per thread (no retry loop on failure)", () => {
  assert.match(src, /if \(primedNeedsRevalidation\) hydratedThreadsRef\.current\.add\(key\);/);
});

test("hydrating over a cached window orders messages chronologically with a safe fallback", () => {
  assert.match(src, /inboxCache\.orderMessages\(/);
  // full-page hydrate orders; older-page loads keep the prepend order
  assert.match(src, /: mergeMessagesByIdentity\(\[\.\.\.incoming, \.\.\.existing\]\);/);
});

// ---- PRIORITY 3: refresh storm / dedup ----------------------------------

test("focus/visibility uses a freshness window instead of refetching every time", () => {
  assert.match(src, /const VISIBILITY_FRESH_MS = \d+;/);
  assert.match(src, /if \(Date\.now\(\) - lastListLoadAtRef\.current < VISIBILITY_FRESH_MS\) return;/);
  assert.match(src, /lastListLoadAtRef\.current = Date\.now\(\);/);
});

test("manual refresh and socket reconnect are NOT gated by the freshness window", () => {
  // the freshness check lives only in the !previous.pageVisible branch
  const visibilityEffect = src.slice(
    src.indexOf("const previous = refreshStateRef.current;"),
    src.indexOf('requestRefresh("socket", { silent: true, force: true });')
  );
  const guardCount = (visibilityEffect.match(/VISIBILITY_FRESH_MS/g) || []).length;
  assert.equal(guardCount, 1, "freshness window must gate only the visibility-regain refresh");
  assert.match(src, /requestRefresh\("manual", \{ silent: true \}\)/);
});

test("in-flight list refreshes are deduplicated and queued rather than duplicated", () => {
  assert.match(src, /if \(isRefreshingRef\.current\) \{\s*\n\s*if \(!refreshQueueRef\.current\)/);
});

test("in-flight thread loads are deduplicated", () => {
  assert.match(src, /if \(!selectedConversation\?\.session_id \|\| olderMessagesLoading \|\| isLoadingOlderRef\.current\) return;/);
});

test("a socket message patches the conversation instead of refetching the whole list", () => {
  const start = src.indexOf("const onMessage = (payload = {})");
  const onMessage = src.slice(start, src.indexOf("subscribeRealtime(", start));
  assert.ok(start > 0 && onMessage.length > 0, "socket message handler must be present");
  assert.match(onMessage, /mergeMessagesByIdentity\(\[\.\.\.asArray\(conversation\.messages\), incoming\]\)/);
  assert.doesNotMatch(onMessage, /requestRefresh\(/, "an incoming message must not trigger a full list refresh");
});

// ---- PRIORITY 4: secondary data off the critical path -------------------

test("social comments cannot hold the refresh state open", () => {
  // detached from the awaited path
  assert.match(src, /void \(async \(\) => \{\s*\n\s*try \{\s*\n\s*const \[postsPayload, settingsPayload\] = await Promise\.all\(/);
  // the refresh lifecycle no longer waits on it
  const finallyBlock = src.slice(src.indexOf("} finally {\n      if (seq === requestSeqRef.current && !silent) setLoading(false);"), src.indexOf("}, [channelFilter, debouncedSearch, filter, headers, tenantId]);"));
  assert.doesNotMatch(finallyBlock, /social/i);
});

test("recommendations and sales-closer wait for idle instead of racing the thread fetch", () => {
  assert.match(src, /window\.requestIdleCallback\s*\n?\s*\? window\.requestIdleCallback\(run, \{ timeout: 2000 \}\)/);
  assert.match(src, /void loadRecommendations\(\);\s*\n\s*void loadSalesCloser\(\);/);
});

test("the dead message_limit param is no longer sent on the summary-only list endpoint", () => {
  const listCall = src.slice(src.indexOf('api.get("/ai-inbox/conversations"'), src.indexOf('perfComponent: "AiInbox.conversations"'));
  assert.doesNotMatch(listCall, /message_limit/);
});

// ---- send safety ---------------------------------------------------------

// The guard is asserted as an INVARIANT, not as an exact line. It was originally
// pinned as `return;` and the send path later grew a richer result (`return { ok:
// false }`), which broke the test while the protection it describes was completely
// intact. A regex that fails when the behaviour improves is not guarding anything.
test("a rapid double-click sends exactly one text reply", () => {
  assert.match(src, /if \(sendingReplyRef\.current\) return\b/, "the send path must bail when one is in flight");
  assert.match(src, /sendingReplyRef\.current = true;/, "the guard must be claimed");
  assert.match(src, /sendingReplyRef\.current = false;/, "and released, or the composer locks forever");

  const send = src.slice(src.indexOf("const sendManualReply = async"), src.indexOf("setReplySending(true);"));
  assert.ok(
    send.indexOf("sendingReplyRef.current = true;") < send.indexOf("const optimistic = {"),
    "guard must precede the optimistic bubble, so a blocked click leaves no stray bubble"
  );
  // Release must be unconditional: an early return or a throw between claim and
  // release would leave the composer permanently disabled.
  assert.match(src, /finally \{\s*\n\s*sendingReplyRef\.current = false;/, "release must sit in finally");
});

test("a rapid double-click sends exactly one product-card message", () => {
  assert.match(src, /if \(sendingProductCardsRef\.current\) return\b/);
  assert.match(src, /sendingProductCardsRef\.current = true;/);
  assert.match(src, /finally \{\s*\n\s*sendingProductCardsRef\.current = false;/, "release must sit in finally");
});

test("text send still shows a pending bubble immediately and reconciles", () => {
  assert.match(src, /delivery_status: "sending"/);
  assert.match(src, /delivery_status: "failed"/);
});

// ---- product picker ------------------------------------------------------

test("opening the inbox loads no product catalog", () => {
  assert.doesNotMatch(src, /api\.get\("\/products/);
  assert.doesNotMatch(src, /with-variants/);
});

test("the picker itself is gated on being open and uses the size-first path", () => {
  const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
  assert.match(picker, /if \(!open\) return undefined;/);
  assert.match(picker, /sizeMode && !sizeCatalogFallback/);
});
