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
  // Cached pages are read per-channel from the shared module before the network
  // round. Per-channel entries (not one merged blob) are what stop a large
  // channel from starving the others on a warm open.
  assert.match(src, /const cachedPages = await Promise\.all\(/);
  assert.match(src, /inboxCache\.primeList\(ch\)/);
  // when cached rows exist we render them and drop the loading spinner
  assert.match(src, /if \(seq === requestSeqRef\.current && cachedRows\.length\)/);
  assert.match(src, /setLoading\(false\); \/\/ show cached now/);
  // prime happens before the authoritative fetch (warm render, then revalidate)
  const prime = src.indexOf("const cachedPages = await Promise.all(");
  const fetchList = src.indexOf("await Promise.allSettled(requestedChannels.map(fetchChannelPage))");
  assert.ok(prime >= 0 && fetchList >= 0 && prime < fetchList, "prime must precede the network fetch");
});

test("persists compact summaries after the authoritative list resolves", () => {
  // one cache entry per channel, written only for channels that actually resolved
  assert.match(src, /inboxCache\.saveList\(channelPages\[index\], backendChannel\)/);
  const save = src.indexOf("inboxCache.saveList(channelPages[index], backendChannel)");
  const fetchList = src.indexOf("await Promise.allSettled(requestedChannels.map(fetchChannelPage))");
  assert.ok(save > fetchList, "saveList must run after the fetch, not on the warm path");
});

test("wipes the cache on logout / user switch (tenant/user isolation) and sweeps on mount", () => {
  assert.match(src, /inboxCache\.sweep\(\)/);
  assert.match(src, /erp:auth-user-updated/);
  assert.match(src, /erp:auth-expired/);
  assert.match(src, /inboxCache\.clearAllCache\(\)/);
});
