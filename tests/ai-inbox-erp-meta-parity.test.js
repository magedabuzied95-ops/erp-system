import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { writeList, MAX_LIST_ROWS } from "../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js";
import {
  AI_INBOX_BACKEND_CHANNEL_FILTERS,
  AI_INBOX_MESSAGE_CHANNELS,
  backendChannelFilter,
  channelWindow,
} from "../src/modules/aiSupport/services/inboxChannels.js";

// P0 regression guard: ERP /admin/ai-inbox showed 1 Messenger conversation where
// the PWA showed 2. Root cause was NOT identity/merge/cache — it was request
// truncation. The server returns the newest N conversations across ALL channels;
// ERP asked for 50 while the PWA asked for 200, and with 47 live WhatsApp threads
// the 50-row window left exactly one Messenger seat. Instagram truncates the same
// way. Compounding it, ERP sent UI channel names the backend does not recognise,
// so its channel chips never narrowed the query server-side.

const erp = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwa = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");

const erpRequest = erp.slice(
  erp.indexOf("const fetchChannelPage"),
  erp.indexOf("const requestedChannels")
);

// ---- the truncation itself -----------------------------------------------

test("ERP no longer relies on a single global page size", () => {
  assert.match(erpRequest, /limit: channelWindow\(backendChannel\)/);
  assert.doesNotMatch(erpRequest, /limit: \d+/, "a hard-coded global limit is what starved Meta");
});

test("each channel's own page still fits inside the cache row cap", () => {
  for (const ch of AI_INBOX_MESSAGE_CHANNELS) {
    assert.ok(channelWindow(ch) <= MAX_LIST_ROWS, `${ch} window exceeds the ${MAX_LIST_ROWS}-row cache cap`);
  }
});

test("the PWA's page size still exceeds any single ERP channel window", () => {
  // Parity sanity: ERP must never request more per channel than the PWA does overall.
  const pwaLimit = Number((pwa.match(/limit:\s*(\d+),\s*\n\s*message_limit/) || [])[1]);
  assert.ok(pwaLimit >= Math.max(...AI_INBOX_MESSAGE_CHANNELS.map(channelWindow)));
});

test("a low page size truncates a whole channel — the exact production shape", async () => {
  // Reproduces the incident: 47 WhatsApp + 2 Messenger + 2 Instagram, newest-first.
  const rows = [
    ...Array.from({ length: 47 }, (_, i) => ({ channel: "whatsapp", session_id: `wa-${i}`, last_message_at: `2026-08-10T12:${String(i).padStart(2, "0")}:00Z` })),
    { channel: "facebook_messenger", session_id: "fb-1", last_message_at: "2026-08-10T11:00:00Z" },
    { channel: "instagram", session_id: "ig-1", last_message_at: "2026-08-10T10:59:00Z" },
    { channel: "instagram", session_id: "ig-2", last_message_at: "2026-08-10T10:58:00Z" },
    { channel: "facebook_messenger", session_id: "fb-2", last_message_at: "2026-08-10T10:57:00Z" },
  ];
  const newestFirst = [...rows].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
  const messengerIn = (limit) => newestFirst.slice(0, limit).filter((r) => r.channel === "facebook_messenger").length;

  assert.equal(messengerIn(50), 1, "the old 50-row window drops the second Messenger thread");
  assert.equal(messengerIn(200), 2, "a 200-row window keeps both");
});

// ---- channel vocabulary must match the backend ---------------------------

const backendAccepted = [...backend.matchAll(/normalizedChannelFilter === "([a-z_]+)"/g)].map((m) => m[1]);

test("the backend's accepted channel vocabulary is what we think it is", () => {
  assert.deepEqual(
    [...backendAccepted].sort(),
    ["facebook_comment", "facebook_messenger", "instagram", "instagram_comment", "telegram", "web_chat", "whatsapp"]
  );
});

test("ERP sends a mapped channel value, never the raw UI value", () => {
  assert.match(erpRequest, /channel_filter: backendChannel\b/);
  assert.doesNotMatch(erpRequest, /channel_filter: channelFilter\b/, "raw UI value must never be sent");
});

test("every value the mapper can emit is one the backend actually honours", () => {
  const targets = [...new Set(AI_INBOX_BACKEND_CHANNEL_FILTERS.values())];
  assert.ok(targets.length >= 6, "expected the full channel map");
  for (const t of targets) {
    assert.ok(backendAccepted.includes(t), `ERP would send "${t}", which the backend silently ignores`);
  }
});

test("every UI chip value is mapped — an unmapped chip would silently disable filtering", () => {
  const order = JSON.parse((erp.match(/const conversationChannelOrder = (\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
  for (const chip of order) {
    assert.ok(backendChannelFilter(chip), `chip "${chip}" has no backend mapping`);
  }
});

test('"all" and unknown values resolve to no channel filter, never a literal', () => {
  assert.equal(backendChannelFilter("all"), "");
  assert.equal(backendChannelFilter(""), "");
  assert.equal(backendChannelFilter("nonsense"), "");
  assert.equal(backendChannelFilter("messenger"), "facebook_messenger");
  assert.equal(backendChannelFilter("web"), "web_chat");
});

// ---- identity must stay channel-scoped (no collapse) ---------------------

test("ERP conversation identity is channel-scoped", () => {
  const keyFn = erp.slice(erp.indexOf("const conversationKey = (conversation = {}) =>"), erp.indexOf("const customerAvatarUrl"));
  assert.match(keyFn, /`\$\{channel\}:\$\{sessionId\}`/, "messenger:123 and instagram:123 must never collapse to 123");
});

test("the shared cache never collapses distinct threads when storing a list", async () => {
  const store = new Map();
  const adapter = { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } };
  const rows = [
    { conversation_key: "messenger:fb-1", channel: "facebook_messenger" },
    { conversation_key: "messenger:fb-2", channel: "facebook_messenger" },
    { conversation_key: "instagram:ig-1", channel: "instagram" },
    { conversation_key: "instagram:ig-2", channel: "instagram" },
  ];
  await writeList(adapter, "v1:t=1:u=1", "all", rows);
  const saved = store.get("v1:t=1:u=1:list:all").conversations;
  assert.equal(saved.length, 4);
  assert.equal(new Set(saved.map((r) => r.conversation_key)).size, 4);
});

test("a full page survives the cache round-trip without clipping", async () => {
  const store = new Map();
  const adapter = { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } };
  const rows = Array.from({ length: 200 }, (_, i) => ({ conversation_key: `whatsapp:wa-${i}` }));
  await writeList(adapter, "v1:t=1:u=1", "all", rows);
  assert.equal(store.get("v1:t=1:u=1:list:all").conversations.length, 200);
});
