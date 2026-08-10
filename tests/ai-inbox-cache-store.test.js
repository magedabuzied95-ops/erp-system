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
