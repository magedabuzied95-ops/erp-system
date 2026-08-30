import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryAdapter } from "../src/modules/aiSupport/services/inboxCache/memoryAdapter.js";
import {
  buildNamespace,
  readList,
  writeList,
  readThread,
  writeThread,
  readLastThread,
  writeLastThread,
  sweepExpired,
  clearNamespace,
  boundMessages,
  projectConversationRow,
  setClock,
  MAX_CONVERSATIONS_WITH_MESSAGES,
  MAX_MESSAGES_PER_THREAD,
  THREAD_TTL_MS,
} from "../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js";

// A faithful stand-in for the app's mergeMessagesByIdentity: dedup by the same
// identity keys, later copy wins (server replaces optimistic).
const mergeByIdentity = (messages = []) => {
  const keyOf = (m) => m.client_request_id || m.message_identity_key || m.provider_message_id || m.external_message_id || (m.id != null ? `id:${m.id}` : null);
  const out = [];
  const index = new Map();
  for (const m of messages) {
    const k = keyOf(m);
    if (k && index.has(k)) { out[index.get(k)] = { ...out[index.get(k)], ...m }; continue; }
    if (k) index.set(k, out.length);
    out.push(m);
  }
  return out;
};

let clockValue = 1_000_000;
setClock(() => clockValue);

const NS = buildNamespace({ tenantId: "t1", userId: "u1" });

test("namespace requires both tenant and user (never caches otherwise)", () => {
  assert.equal(buildNamespace({ tenantId: "t1", userId: "u1" }).length > 0, true);
  assert.equal(buildNamespace({ tenantId: "", userId: "u1" }), "");
  assert.equal(buildNamespace({ tenantId: "t1", userId: "" }), "");
  assert.equal(buildNamespace({}), "");
});

test("conversation list round-trips, keeps summary/routing fields, drops the messages array", async () => {
  const adapter = createMemoryAdapter();
  await writeList(adapter, NS, "all", [
    {
      session_id: "wa:1", channel: "whatsapp", customer_name: "A",
      latest_message_preview: "hi", unread_count: 2,
      customer_profile: { name: "Ahmed" }, channel_metadata: { messenger_profile: {} },
      messages: [{ id: 1 }, { id: 2 }], transcript: [{ id: 9 }], // heavy → must be dropped
    },
  ]);
  const read = await readList(adapter, NS, "all");
  assert.equal(read.conversations.length, 1);
  const row = read.conversations[0];
  // Row-render fields preserved (name/avatar/preview/unread come from these).
  assert.equal(row.session_id, "wa:1");
  assert.equal(row.channel, "whatsapp");
  assert.equal(row.unread_count, 2);
  assert.deepEqual(row.customer_profile, { name: "Ahmed" });
  // Heavy per-thread data must NOT live in the list cache.
  assert.equal("messages" in row, false);
  assert.equal("transcript" in row, false);
});

test("list cache is isolated per channel filter", async () => {
  const adapter = createMemoryAdapter();
  await writeList(adapter, NS, "whatsapp", [{ session_id: "wa:1" }]);
  await writeList(adapter, NS, "messenger", [{ session_id: "fb:1" }, { session_id: "fb:2" }]);
  assert.equal((await readList(adapter, NS, "whatsapp")).conversations.length, 1);
  assert.equal((await readList(adapter, NS, "messenger")).conversations.length, 2);
});

test("thread messages preserve chronological order and are bounded to the newest N", async () => {
  const adapter = createMemoryAdapter();
  const many = Array.from({ length: MAX_MESSAGES_PER_THREAD + 20 }, (_, i) => ({
    id: i + 1, created_at: new Date(1_600_000_000_000 + i * 1000).toISOString(), text: `m${i + 1}`,
  }));
  await writeThread(adapter, NS, "wa:1", many, mergeByIdentity);
  const read = await readThread(adapter, NS, "wa:1");
  assert.equal(read.messages.length, MAX_MESSAGES_PER_THREAD);
  // Oldest kept is #21, newest #70; order ascending.
  assert.equal(read.messages[0].id, 21);
  assert.equal(read.messages[read.messages.length - 1].id, MAX_MESSAGES_PER_THREAD + 20);
  for (let i = 1; i < read.messages.length; i += 1) {
    assert.ok(new Date(read.messages[i].created_at) >= new Date(read.messages[i - 1].created_at));
  }
});

test("writeThread merges via the injected dedup fn (no duplicates)", async () => {
  const adapter = createMemoryAdapter();
  await writeThread(adapter, NS, "wa:1", [
    { id: null, client_request_id: "c1", text: "pending", delivery_status: "sending" },
  ], mergeByIdentity);
  // Server copy of the same logical message (same client_request_id) arrives.
  await writeThread(adapter, NS, "wa:1", [
    { id: 500, client_request_id: "c1", text: "pending", delivery_status: "sent" },
  ], mergeByIdentity);
  const read = await readThread(adapter, NS, "wa:1");
  assert.equal(read.messages.length, 1);
  assert.equal(read.messages[0].id, 500);
  assert.equal(read.messages[0].delivery_status, "sent");
});

test("failed optimistic message stays failed in cache (never silently sent)", async () => {
  const adapter = createMemoryAdapter();
  await writeThread(adapter, NS, "wa:1", [{ id: null, client_request_id: "c9", text: "x", delivery_status: "sending" }], mergeByIdentity);
  await writeThread(adapter, NS, "wa:1", [{ id: null, client_request_id: "c9", text: "x", delivery_status: "failed" }], mergeByIdentity);
  const read = await readThread(adapter, NS, "wa:1");
  assert.equal(read.messages.length, 1);
  assert.equal(read.messages[0].delivery_status, "failed");
});

test("LRU evicts least-recently-used threads beyond the cap", async () => {
  const adapter = createMemoryAdapter();
  for (let i = 0; i < MAX_CONVERSATIONS_WITH_MESSAGES + 5; i += 1) {
    clockValue += 1000;
    await writeThread(adapter, NS, `wa:${i}`, [{ id: i, created_at: new Date(clockValue).toISOString() }], mergeByIdentity);
  }
  // The 5 oldest (wa:0..wa:4) must be evicted.
  assert.equal(await readThread(adapter, NS, "wa:0"), null);
  assert.equal(await readThread(adapter, NS, "wa:4"), null);
  assert.notEqual(await readThread(adapter, NS, `wa:${MAX_CONVERSATIONS_WITH_MESSAGES + 4}`), null);
});

test("expired threads are swept and read-through returns null", async () => {
  const adapter = createMemoryAdapter();
  clockValue = 5_000_000;
  await writeThread(adapter, NS, "wa:old", [{ id: 1, created_at: new Date(clockValue).toISOString() }], mergeByIdentity);
  clockValue += THREAD_TTL_MS + 1;
  assert.equal(await readThread(adapter, NS, "wa:old"), null); // read-through expiry
  await writeThread(adapter, NS, "wa:new", [{ id: 2, created_at: new Date(clockValue).toISOString() }], mergeByIdentity);
  const removed = await sweepExpired(adapter, NS);
  assert.ok(removed >= 0);
  assert.notEqual(await readThread(adapter, NS, "wa:new"), null);
});

test("last-opened thread pointer round-trips", async () => {
  const adapter = createMemoryAdapter();
  await writeLastThread(adapter, NS, "wa:42");
  assert.equal(await readLastThread(adapter, NS), "wa:42");
});

test("namespace isolation: one identity cannot read another's cache", async () => {
  const adapter = createMemoryAdapter();
  const nsA = buildNamespace({ tenantId: "t1", userId: "userA" });
  const nsB = buildNamespace({ tenantId: "t1", userId: "userB" });
  const nsOtherTenant = buildNamespace({ tenantId: "t2", userId: "userA" });
  await writeList(adapter, nsA, "all", [{ session_id: "A-secret" }]);
  await writeThread(adapter, nsA, "wa:1", [{ id: 1, text: "A-private" }], mergeByIdentity);
  assert.equal(await readList(adapter, nsB, "all"), null);
  assert.equal(await readThread(adapter, nsB, "wa:1"), null);
  assert.equal(await readList(adapter, nsOtherTenant, "all"), null);
  assert.equal(await readThread(adapter, nsOtherTenant, "wa:1"), null);
});

test("logout clears only the target namespace, leaving others intact", async () => {
  const adapter = createMemoryAdapter();
  const nsA = buildNamespace({ tenantId: "t1", userId: "userA" });
  const nsB = buildNamespace({ tenantId: "t1", userId: "userB" });
  await writeList(adapter, nsA, "all", [{ session_id: "A" }]);
  await writeThread(adapter, nsA, "wa:1", [{ id: 1 }], mergeByIdentity);
  await writeList(adapter, nsB, "all", [{ session_id: "B" }]);
  await clearNamespace(adapter, nsA);
  assert.equal(await readList(adapter, nsA, "all"), null);
  assert.equal(await readThread(adapter, nsA, "wa:1"), null);
  assert.equal((await readList(adapter, nsB, "all")).conversations.length, 1); // B untouched
});

test("boundMessages sorts and caps without mutating input", () => {
  const input = [
    { id: 3, created_at: "2020-01-03" },
    { id: 1, created_at: "2020-01-01" },
    { id: 2, created_at: "2020-01-02" },
  ];
  const out = boundMessages(input, 2);
  assert.deepEqual(out.map((m) => m.id), [2, 3]);
  assert.equal(input.length, 3); // input untouched
});

test("projectConversationRow keeps routing + isolation fields", () => {
  const row = projectConversationRow({ session_id: "wa:1", channel: "whatsapp", external_account_id: "acc9", unread_count: 3 });
  assert.equal(row.session_id, "wa:1");
  assert.equal(row.channel, "whatsapp");
  assert.equal(row.external_account_id, "acc9");
  assert.equal(row.unread_count, 3);
});

// ---- server-page reconciliation (V3) -------------------------------------

const identityKeys = (m = {}) =>
  [m.message_identity_key, m.client_request_id, m.provider_message_id, m.external_message_id, m.id != null ? String(m.id) : ""]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

test("reconcileWithServerPage drops server-deleted messages inside the page window", async () => {
  const { reconcileWithServerPage } = await import("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js");
  const cached = [
    { id: 100, created_at: "2026-08-18T01:00:51Z", staff_message: "dup A" },  // deleted on server
    { id: 101, created_at: "2026-08-18T01:01:25Z", staff_message: "dup B" },  // deleted on server
    { id: 102, created_at: "2026-08-18T01:19:00Z", staff_message: "kept" },   // still on server
  ];
  const serverPage = [
    { id: 99, created_at: "2026-08-18T00:50:00Z", customer_message: "hi" },
    { id: 102, created_at: "2026-08-18T01:19:00Z", staff_message: "kept" },
  ];
  const out = reconcileWithServerPage(cached, serverPage, identityKeys);
  assert.deepEqual(out.map((m) => m.id), [102]);
});

test("reconcileWithServerPage keeps optimistic bubbles and pre-window history", async () => {
  const { reconcileWithServerPage } = await import("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js");
  const cached = [
    { id: 10, created_at: "2026-08-01T00:00:00Z", staff_message: "old history" }, // older than the page window
    { id: "sending-171234", created_at: "2026-08-18T02:00:00Z", staff_message: "in flight" }, // optimistic
    { created_at: "2026-08-18T02:00:01Z", staff_message: "no id yet" },
  ];
  const serverPage = [{ id: 200, created_at: "2026-08-18T01:00:00Z", customer_message: "hi" }];
  const out = reconcileWithServerPage(cached, serverPage, identityKeys);
  assert.equal(out.length, 3);
});

// A refused send used to leave a `sending-…` bubble marked failed. It never gains a server id, so the
// "keep every id-less bubble" rule made it immortal: it survived in IndexedDB and came back every
// session next to the one real failed row the server stored — six identical فشل bubbles for one refusal.
test("reconcileWithServerPage drops a failed client-only bubble but keeps one still in flight", async () => {
  const { reconcileWithServerPage } = await import("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js");
  const cached = [
    { id: 300, created_at: "2026-08-29T11:46:36Z", staff_message: "the real failed row", delivery_status: "failed" },
    { id: "sending-1", created_at: "2026-08-29T11:46:36Z", staff_message: "ghost", delivery_status: "failed", client_request_id: "req-2" },
    { id: "sending-2", created_at: "2026-08-29T11:46:36Z", staff_message: "ghost", delivery_status: "failed", client_request_id: "req-3" },
    { id: "sending-3", created_at: "2026-08-29T11:46:37Z", staff_message: "still sending", delivery_status: "sending", client_request_id: "req-4" },
  ];
  const serverPage = [
    { id: 299, created_at: "2026-08-29T11:40:00Z", customer_message: "hi" },
    { id: 300, created_at: "2026-08-29T11:46:36Z", staff_message: "the real failed row", delivery_status: "failed" },
  ];
  const out = reconcileWithServerPage(cached, serverPage, identityKeys);
  assert.deepEqual(out.map((m) => m.id), [300, "sending-3"]);
});

// The pre-window rule outranks it: the page simply does not reach back that far, so a failed bubble
// older than the window is not evidence of anything and must not be swept.
test("reconcileWithServerPage keeps a failed client-only bubble older than the page window", async () => {
  const { reconcileWithServerPage } = await import("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js");
  const cached = [{ id: "sending-9", created_at: "2026-08-01T00:00:00Z", delivery_status: "failed" }];
  const serverPage = [{ id: 400, created_at: "2026-08-29T11:40:00Z", customer_message: "hi" }];
  assert.deepEqual(reconcileWithServerPage(cached, serverPage, identityKeys), cached);
});

test("reconcileWithServerPage never wipes anything on an empty or unusable server page", async () => {
  const { reconcileWithServerPage } = await import("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js");
  const cached = [{ id: 1, created_at: "2026-08-18T01:00:00Z" }];
  assert.deepEqual(reconcileWithServerPage(cached, [], identityKeys), cached);
  assert.deepEqual(reconcileWithServerPage(cached, [{ id: 2 }], null), cached);
  assert.deepEqual(reconcileWithServerPage(cached, [{ id: 2, created_at: "" }], identityKeys), cached);
});

test("replaceThread overwrites the cached record instead of unioning with it", async () => {
  const { replaceThread } = await import("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js");
  const adapter = createMemoryAdapter();
  await writeThread(adapter, NS, "conv:1", [
    { id: 1, created_at: "2026-08-18T01:00:00Z", staff_message: "ghost" },
    { id: 2, created_at: "2026-08-18T01:05:00Z", staff_message: "kept" },
  ], mergeByIdentity);
  await replaceThread(adapter, NS, "conv:1", [
    { id: 2, created_at: "2026-08-18T01:05:00Z", staff_message: "kept" },
  ]);
  const read = await readThread(adapter, NS, "conv:1");
  assert.deepEqual(read.messages.map((m) => m.id), [2]);
});

test("replaceThread refuses to blank a thread with an empty window", async () => {
  const { replaceThread } = await import("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js");
  const adapter = createMemoryAdapter();
  await writeThread(adapter, NS, "conv:2", [{ id: 5, created_at: "2026-08-18T01:00:00Z" }], mergeByIdentity);
  assert.equal(await replaceThread(adapter, NS, "conv:2", []), false);
  const read = await readThread(adapter, NS, "conv:2");
  assert.deepEqual(read.messages.map((m) => m.id), [5]);
});
