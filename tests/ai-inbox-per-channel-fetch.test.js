import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  AI_INBOX_MESSAGE_CHANNELS,
  backendChannelFilter,
  channelWindow,
  channelsForFilter,
  conversationActivityAt,
  mergeConversationPages,
} from "../src/modules/aiSupport/services/inboxChannels.js";

const erp = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");

// Channel-scoped identity, mirroring AiInbox.jsx's conversationKey.
const keyOf = (c) => {
  const x = String(c.channel || "").toLowerCase();
  const ch = x.includes("whatsapp") ? "whatsapp"
    : x.includes("instagram") ? "instagram"
    : (x.includes("facebook") || x.includes("messenger")) ? "messenger"
    : x.includes("web") ? "web" : x || "unknown";
  return `${ch}:${c.session_id || ""}`;
};

// Simulates the server: newest-first across ALL channels, truncated to `limit`.
const serverPage = (all, { channel = "", limit = 200 } = {}) =>
  [...all]
    .filter((c) => !channel || c.channel === channel)
    .sort((a, b) => conversationActivityAt(b) - conversationActivityAt(a))
    .slice(0, limit);

const makeWorld = (waCount) => {
  const rows = [];
  // WhatsApp is the newest and the loudest — this is what starved the others.
  for (let i = 0; i < waCount; i++) {
    rows.push({ channel: "whatsapp", session_id: `wa-${i}`, last_message_at: new Date(Date.UTC(2026, 7, 11, 12, 0, 0) - i * 60000).toISOString() });
  }
  // Meta conversations are older than every WhatsApp thread — the worst case.
  const older = Date.UTC(2026, 7, 1, 0, 0, 0);
  rows.push({ channel: "facebook_messenger", session_id: "fb-1", last_message_at: new Date(older - 1000).toISOString() });
  rows.push({ channel: "facebook_messenger", session_id: "fb-2", last_message_at: new Date(older - 2000).toISOString() });
  rows.push({ channel: "instagram", session_id: "ig-1", last_message_at: new Date(older - 3000).toISOString() });
  rows.push({ channel: "instagram", session_id: "ig-2", last_message_at: new Date(older - 4000).toISOString() });
  return rows;
};

const countByChannel = (rows) => rows.reduce((acc, r) => {
  const c = r.channel === "facebook_messenger" ? "messenger" : r.channel;
  acc[c] = (acc[c] || 0) + 1;
  return acc;
}, {});

// Fair retrieval: one bounded request per channel, merged.
const fairFetch = (world) => mergeConversationPages(
  channelsForFilter("all").map((ch) => serverPage(world, { channel: ch, limit: channelWindow(ch) })),
  keyOf
);

// ---- the exact production failure ---------------------------------------

test("197 WhatsApp + 2 Messenger + 2 Instagram: the shipped 50-row global page starved Meta completely", () => {
  const world = makeWorld(197);
  const old = countByChannel(serverPage(world, { limit: 50 }));
  assert.equal(old.whatsapp, 50);
  assert.equal(old.messenger ?? 0, 0, "the original 50-row page was pure WhatsApp");
  assert.equal(old.instagram ?? 0, 0);
});

test("raising the global limit only postpones the starvation — it never removes it", () => {
  const world = makeWorld(197);
  const at200 = countByChannel(serverPage(world, { limit: 200 }));
  // 201 rows into a 200-row page: still lossy, just less obviously so.
  assert.equal((at200.messenger ?? 0) + (at200.instagram ?? 0), 3, "one Meta thread is still evicted at 200");
  assert.ok(at200.whatsapp === 197, "WhatsApp keeps every seat it asks for");
});

test("197 WhatsApp + 2 Messenger + 2 Instagram: per-channel keeps BOTH of each", () => {
  const got = countByChannel(fairFetch(makeWorld(197)));
  assert.equal(got.messenger, 2);
  assert.equal(got.instagram, 2);
  assert.equal(got.whatsapp, 150, "WhatsApp is bounded by its own window, not by the others");
});

test("1000 WhatsApp: Meta conversations still survive", () => {
  const got = countByChannel(fairFetch(makeWorld(1000)));
  assert.equal(got.messenger, 2, "unbounded WhatsApp growth must never evict Messenger");
  assert.equal(got.instagram, 2);
  assert.equal(got.whatsapp, 150);
});

test("a global limit fails at 1000 WhatsApp — proving the fix is what saves it", () => {
  const old = countByChannel(serverPage(makeWorld(1000), { limit: 200 }));
  assert.equal(old.messenger ?? 0, 0);
  assert.equal(old.instagram ?? 0, 0);
});

// ---- request shape -------------------------------------------------------

test('"All" fans out to every message channel and no comment channel', () => {
  // The list was hardcoded to four and broke when Telegram was added — a feature, not
  // a regression, but the failure read like one. The invariant is that "all" means
  // exactly the message channels, whatever that set currently is, and that comment
  // channels never leak into the message inbox.
  assert.deepEqual(channelsForFilter("all"), AI_INBOX_MESSAGE_CHANNELS);
  assert.deepEqual(channelsForFilter(""), AI_INBOX_MESSAGE_CHANNELS);
  for (const ch of channelsForFilter("all")) assert.ok(!ch.includes("comment"), `${ch} is not a message channel`);
  // The four that predate Telegram must still be there: this test also guards against
  // a channel silently disappearing from the fan-out.
  for (const ch of ["whatsapp", "facebook_messenger", "instagram", "web_chat"]) {
    assert.ok(channelsForFilter("all").includes(ch), `${ch} must still be fetched`);
  }
});

test("a selected tab issues exactly ONE request for that channel", () => {
  assert.deepEqual(channelsForFilter("messenger"), ["facebook_messenger"]);
  assert.deepEqual(channelsForFilter("instagram"), ["instagram"]);
  assert.deepEqual(channelsForFilter("whatsapp"), ["whatsapp"]);
  assert.deepEqual(channelsForFilter("web"), ["web_chat"]);
});

test("selecting a tab never fetches all channels and filters client-side", () => {
  const load = erp.slice(erp.indexOf("const loadAll = useCallback"), erp.indexOf("inboxCache.saveList"));
  assert.match(load, /channelsForFilter\(channelFilter\)/);
  assert.match(load, /channel_filter: backendChannel/, "each request carries its own channel");
  assert.doesNotMatch(load, /limit: 200\b/, "the old global page size must be gone");
});

test("every channel window is bounded and summary-only (no thread histories)", () => {
  for (const ch of AI_INBOX_MESSAGE_CHANNELS) {
    const w = channelWindow(ch);
    assert.ok(w > 0 && w <= 150, `${ch} window ${w} is not sensibly bounded`);
  }
  const request = erp.slice(erp.indexOf("const fetchChannelPage"), erp.indexOf("const requestedChannels"));
  assert.doesNotMatch(request, /message_limit/, "the list request stays summary-only");
});

// ---- merge correctness ---------------------------------------------------

test("merge never collapses two distinct Messenger threads", () => {
  const merged = mergeConversationPages([[
    { channel: "facebook_messenger", session_id: "fb-1", last_message_at: "2026-08-11T10:00:00Z" },
    { channel: "facebook_messenger", session_id: "fb-2", last_message_at: "2026-08-11T09:00:00Z" },
  ]], keyOf);
  assert.equal(merged.length, 2);
});

test("merge never collapses messenger:123 into instagram:123", () => {
  const merged = mergeConversationPages([
    [{ channel: "facebook_messenger", session_id: "123", last_message_at: "2026-08-11T10:00:00Z" }],
    [{ channel: "instagram", session_id: "123", last_message_at: "2026-08-11T09:00:00Z" }],
  ], keyOf);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((m) => m.conversation_key).sort(), ["instagram:123", "messenger:123"]);
});

test("merge sorts globally by latest activity, newest first", () => {
  const merged = mergeConversationPages([
    [{ channel: "whatsapp", session_id: "wa", last_message_at: "2026-08-11T08:00:00Z" }],
    [{ channel: "instagram", session_id: "ig", last_message_at: "2026-08-11T12:00:00Z" }],
    [{ channel: "facebook_messenger", session_id: "fb", last_message_at: "2026-08-11T10:00:00Z" }],
  ], keyOf);
  assert.deepEqual(merged.map((m) => m.session_id), ["ig", "fb", "wa"]);
});

test("the same conversation in two pages dedupes to the newest copy", () => {
  const merged = mergeConversationPages([
    [{ channel: "instagram", session_id: "ig", last_message_at: "2026-08-11T08:00:00Z", note: "stale" }],
    [{ channel: "instagram", session_id: "ig", last_message_at: "2026-08-11T12:00:00Z", note: "fresh" }],
  ], keyOf);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].note, "fresh");
});

test("rows without a resolvable identity are dropped, not merged into one bucket", () => {
  const merged = mergeConversationPages([[{ foo: 1 }, { bar: 2 }]], () => "");
  assert.equal(merged.length, 0);
});

// ---- failure isolation + per-channel cache -------------------------------

test("a failed channel falls back to its cached page instead of blanking the inbox", () => {
  const load = erp.slice(erp.indexOf("const loadAll = useCallback"), erp.indexOf("if (activeSection === \"conversations\""));
  assert.match(load, /Promise\.allSettled/);
  assert.match(load, /result\.status === "fulfilled"/);
  assert.match(load, /return asArray\(cachedPages\[index\]\)/);
});

test("a channel served from cache after a failure is not written back as fresh", () => {
  const load = erp.slice(erp.indexOf("requestedChannels.forEach"), erp.indexOf("if (activeSection === \"conversations\""));
  assert.match(load, /if \(failedChannels\.includes\(backendChannel\)\) return;/);
});

test("cache entries are per-channel, never one merged 'all' blob", () => {
  assert.match(erp, /inboxCache\.saveList\(channelPages\[index\], backendChannel\)/);
  assert.match(erp, /inboxCache\.primeList\(ch\)/);
  assert.doesNotMatch(erp, /inboxCache\.saveList\(conversations, channelFilter\)/);
});

test("warm open merges the per-channel caches before any network round", () => {
  const load = erp.slice(erp.indexOf("const loadAll = useCallback"), erp.indexOf("Promise.allSettled"));
  // Pinned literally, this broke when the warm start grew a reviewer-mode branch. The
  // property under test is that the per-channel caches are read and merged BEFORE the
  // network round, which is what makes a warm open instant.
  assert.match(load, /const cachedPages =/, "cached pages must be read before the network round");
  assert.match(load, /Promise\.all\(warmChannels\.map\(/, "channels must be primed in parallel");
  assert.match(load, /mergeConversationPages\(cachedPages, conversationKey\)/);
});

// ---- refresh discipline is preserved -------------------------------------

test("the fan-out is still ONE logical refresh (in-flight guard + freshness window intact)", () => {
  assert.match(erp, /if \(isRefreshingRef\.current\) \{/);
  assert.match(erp, /if \(Date\.now\(\) - lastListLoadAtRef\.current < VISIBILITY_FRESH_MS\) return;/);
});

test("realtime is not gated by the REST freshness window", () => {
  const onMessage = erp.slice(erp.indexOf("const onMessage = (payload = {})"), erp.indexOf("subscribeRealtime(", erp.indexOf("const onMessage = (payload = {})")));
  assert.ok(onMessage.length > 0);
  assert.doesNotMatch(onMessage, /VISIBILITY_FRESH_MS/);
  assert.doesNotMatch(onMessage, /requestRefresh\(/, "a socket message patches state directly, it must not wait for REST");
});
