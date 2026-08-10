import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// ERP-integrated AI Inbox (route /admin/ai-inbox) must warm-open from the shared
// inboxCache (stale-while-revalidate): render cached summaries immediately, then
// revalidate /ai-inbox/conversations in the background — no cache→spinner→wait.
const src = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");

test("uses the SHARED inboxCache module (not a duplicated cache in the page)", () => {
  assert.match(src, /import inboxCache from "\.\.\/services\/inboxCache\/inboxCache"/);
});

test("warm start primes cached summaries and skips the spinner when present", () => {
  // cached list is read from the shared module before the network fetch
  assert.match(src, /await inboxCache\.primeList\(channelFilter\)/);
  // when cached rows exist we render them and drop the loading spinner
  assert.match(src, /if \(seq === requestSeqRef\.current && cachedRows\.length\)/);
  assert.match(src, /setLoading\(false\); \/\/ show cached now/);
  // prime happens before the authoritative fetch (warm render, then revalidate)
  const prime = src.indexOf("await inboxCache.primeList(channelFilter)");
  const fetchList = src.indexOf('const inboxPayload = await api.get("/ai-inbox/conversations"');
  assert.ok(prime >= 0 && fetchList >= 0 && prime < fetchList, "prime must precede the network fetch");
});

test("persists compact summaries after the authoritative list resolves", () => {
  assert.match(src, /inboxCache\.saveList\(conversations, channelFilter\)/);
  const setInbox = src.indexOf("inboxCache.saveList(conversations, channelFilter)");
  const fetchList = src.indexOf('const inboxPayload = await api.get("/ai-inbox/conversations"');
  assert.ok(setInbox > fetchList, "saveList must run after the fetch, not on the warm path");
});

test("wipes the cache on logout / user switch (tenant/user isolation) and sweeps on mount", () => {
  assert.match(src, /inboxCache\.sweep\(\)/);
  assert.match(src, /erp:auth-user-updated/);
  assert.match(src, /erp:auth-expired/);
  assert.match(src, /inboxCache\.clearAllCache\(\)/);
});
