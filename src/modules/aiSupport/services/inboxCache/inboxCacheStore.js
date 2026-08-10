// Pure, storage-agnostic logic for the AI Inbox stale-while-revalidate cache.
//
// All functions take an injected `adapter` (async get/set/delete/keys/clear) so
// the same logic runs against IndexedDB in the browser and an in-memory Map in
// tests. Message de-duplication is ALSO injected (`mergeFn`) so we reuse the
// app's existing mergeMessagesByIdentity and never fork the dedup algorithm.
//
// Isolation: every record key is prefixed with the schema version + the
// authenticated namespace (tenant + user). A cache read/write is a NO-OP unless
// a valid namespace is supplied, so cached customer data can never be read
// before the current identity is resolved, and one identity's records can never
// collide with another's.

export const SCHEMA_VERSION = 1;

// Bounded retention policy (V1). Starting points per spec; report actual sizes.
export const MAX_CONVERSATIONS_WITH_MESSAGES = 30; // LRU cap on cached threads
export const MAX_MESSAGES_PER_THREAD = 50;         // newest N kept per thread
export const MAX_LIST_ROWS = 200;                  // matches inbox list page size
export const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
export const LIST_STALE_MS = 24 * 60 * 60 * 1000;       // list freshness hint

const clean = (value) => (value === null || value === undefined ? "" : String(value).trim());

// ---- Namespace / keys ---------------------------------------------------

// Build the isolation namespace from the resolved identity. Returns "" (falsy)
// when identity is incomplete — callers MUST treat that as "do not cache".
export const buildNamespace = ({ tenantId, userId } = {}) => {
  const t = clean(tenantId);
  const u = clean(userId);
  if (!t || !u) return "";
  // Encode so ':' inside an id can't cross field boundaries.
  return `v${SCHEMA_VERSION}:t=${encodeURIComponent(t)}:u=${encodeURIComponent(u)}`;
};

// The conversation list is per (namespace + channel filter) so switching the
// WhatsApp/Messenger/Instagram/Web/All filter never shows the wrong slice.
const listKey = (ns, channelFilter) => `${ns}:list:${clean(channelFilter) || "all"}`;
const threadKey = (ns, conversationKey) => `${ns}:thread:${clean(conversationKey)}`;
const lastThreadKey = (ns) => `${ns}:last`;
const threadIndexKey = (ns) => `${ns}:threadIndex`;

// ---- Projection (store only what a row / message needs) -----------------

// The list row renderer (ConversationListItem) reads many nested fields
// (customer_profile.*, channel_metadata.*, avatars, preview, timestamps, unread)
// via helper functions, so we keep the FULL conversation summary and only drop
// the (separately cached, potentially large) `messages` array plus a denylist of
// heavy fields the row never needs. This preserves byte-identical row rendering.
const CONVERSATION_HEAVY_FIELDS = new Set([
  "messages",           // cached separately, bounded, per-thread
  "transcript",
  "message_history",
  "older_messages",
]);

export const projectConversationRow = (conversation = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(conversation || {})) {
    if (CONVERSATION_HEAVY_FIELDS.has(key)) continue;
    out[key] = value;
  }
  return out;
};

// Messages are already normalized by the app (normalizeInboxMessage runs before
// they reach us), so we store them as-is to keep every identity/render field
// (id, provider/external id, client_request_id, message_identity_key, sender,
// direction, timestamp, text, type, product_cards, delivery_status). Pass-through
// keeps dedup keys intact; the newest-N cap bounds size.
export const projectMessage = (message = {}) => (message && typeof message === "object" ? message : {});

// Newest-N by created_at, oldest→newest order preserved.
export const boundMessages = (messages = [], limit = MAX_MESSAGES_PER_THREAD) => {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const ts = (m) => new Date(m?.created_at || m?.updated_at || 0).getTime() || 0;
  list.sort((a, b) => ts(a) - ts(b));
  return list.length > limit ? list.slice(list.length - limit) : list;
};

// Chronological ordering for a merged window.
//
// `mergeMessagesByIdentity` keeps each message at its FIRST-seen position, which
// is correct when the incoming page is strictly older than what's on screen. It
// is NOT correct when a cache-primed window reaches further back than the page
// being merged in, so callers hydrating a full page order the result here.
//
// Fail-safe: if ANY message lacks a usable timestamp (e.g. an in-flight
// optimistic bubble), reordering could move it to the wrong place, so we return
// `fallback` (the caller's existing merge order) and change nothing.
export const orderMessages = (messages = [], fallback = messages) => {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const ts = (m) => new Date(m?.created_at || m?.updated_at || 0).getTime() || 0;
  if (!list.length || list.some((m) => !ts(m))) return fallback;
  // Array#sort is stable, so equal timestamps keep their incoming order.
  return list.sort((a, b) => ts(a) - ts(b));
};

// ---- Conversation list --------------------------------------------------

export const readList = async (adapter, ns, channelFilter) => {
  if (!adapter || !ns) return null;
  const record = await adapter.get(listKey(ns, channelFilter));
  if (!record || !Array.isArray(record.conversations)) return null;
  return {
    conversations: record.conversations,
    cachedAt: record.cachedAt || 0,
    stale: (nowMs() - (record.cachedAt || 0)) > LIST_STALE_MS,
  };
};

export const writeList = async (adapter, ns, channelFilter, conversations) => {
  if (!adapter || !ns) return false;
  const rows = (Array.isArray(conversations) ? conversations : [])
    .slice(0, MAX_LIST_ROWS)
    .map(projectConversationRow);
  await adapter.set(listKey(ns, channelFilter), { conversations: rows, cachedAt: nowMs() });
  return true;
};

// ---- Thread messages (with LRU + TTL) -----------------------------------

const readThreadIndex = async (adapter, ns) => {
  const idx = await adapter.get(threadIndexKey(ns));
  return Array.isArray(idx) ? idx : [];
};

const writeThreadIndex = async (adapter, ns, index) => {
  await adapter.set(threadIndexKey(ns), index);
};

export const readThread = async (adapter, ns, conversationKey) => {
  if (!adapter || !ns || !clean(conversationKey)) return null;
  const record = await adapter.get(threadKey(ns, conversationKey));
  if (!record || !Array.isArray(record.messages)) return null;
  if ((nowMs() - (record.cachedAt || 0)) > THREAD_TTL_MS) {
    // Expired → drop it and its index entry.
    await removeThread(adapter, ns, conversationKey);
    return null;
  }
  return { messages: record.messages, cachedAt: record.cachedAt || 0 };
};

const removeThread = async (adapter, ns, conversationKey) => {
  await adapter.delete(threadKey(ns, conversationKey));
  const index = await readThreadIndex(adapter, ns);
  const next = index.filter((entry) => entry.key !== clean(conversationKey));
  if (next.length !== index.length) await writeThreadIndex(adapter, ns, next);
};

// Merge new messages into the cached window using the INJECTED dedup fn, bound
// to the newest MAX_MESSAGES_PER_THREAD, update the LRU index, and evict the
// least-recently-used threads beyond MAX_CONVERSATIONS_WITH_MESSAGES.
export const writeThread = async (adapter, ns, conversationKey, messages, mergeFn) => {
  if (!adapter || !ns || !clean(conversationKey)) return false;
  const key = clean(conversationKey);
  const existing = await adapter.get(threadKey(ns, key));
  const existingMessages = existing && Array.isArray(existing.messages) ? existing.messages : [];
  const incoming = (Array.isArray(messages) ? messages : []).map(projectMessage);
  const merged = typeof mergeFn === "function"
    ? mergeFn([...existingMessages, ...incoming])
    : [...existingMessages, ...incoming];
  const bounded = boundMessages(merged.map(projectMessage));
  await adapter.set(threadKey(ns, key), { messages: bounded, cachedAt: nowMs() });

  // LRU index: move this thread to the front (most-recent), evict overflow.
  let index = (await readThreadIndex(adapter, ns)).filter((entry) => entry.key !== key);
  index.unshift({ key, lastAccess: nowMs() });
  if (index.length > MAX_CONVERSATIONS_WITH_MESSAGES) {
    const evicted = index.slice(MAX_CONVERSATIONS_WITH_MESSAGES);
    index = index.slice(0, MAX_CONVERSATIONS_WITH_MESSAGES);
    for (const entry of evicted) {
      await adapter.delete(threadKey(ns, entry.key));
    }
  }
  await writeThreadIndex(adapter, ns, index);
  return true;
};

// ---- Last opened thread pointer -----------------------------------------

export const readLastThread = async (adapter, ns) => {
  if (!adapter || !ns) return null;
  const record = await adapter.get(lastThreadKey(ns));
  return record && clean(record.conversationKey) ? record.conversationKey : null;
};

export const writeLastThread = async (adapter, ns, conversationKey) => {
  if (!adapter || !ns || !clean(conversationKey)) return false;
  await adapter.set(lastThreadKey(ns), { conversationKey: clean(conversationKey), at: nowMs() });
  return true;
};

// ---- Expiry sweep + logout cleanup --------------------------------------

// Drop expired threads across the namespace (called opportunistically on mount).
export const sweepExpired = async (adapter, ns) => {
  if (!adapter || !ns) return 0;
  const index = await readThreadIndex(adapter, ns);
  let removed = 0;
  const kept = [];
  for (const entry of index) {
    const record = await adapter.get(threadKey(ns, entry.key));
    if (!record || (nowMs() - (record.cachedAt || 0)) > THREAD_TTL_MS) {
      await adapter.delete(threadKey(ns, entry.key));
      removed += 1;
    } else {
      kept.push(entry);
    }
  }
  if (kept.length !== index.length) await writeThreadIndex(adapter, ns, kept);
  return removed;
};

// Remove EVERY record belonging to a namespace (used on logout / user change).
export const clearNamespace = async (adapter, ns) => {
  if (!adapter || !ns) return false;
  const keys = (await adapter.keys()) || [];
  for (const key of keys) {
    if (typeof key === "string" && key.startsWith(`${ns}:`)) {
      await adapter.delete(key);
    }
  }
  return true;
};

// Nuclear option: wipe the whole inbox cache store (adapter.clear()).
export const clearAll = async (adapter) => {
  if (!adapter) return false;
  await adapter.clear();
  return true;
};

// Approximate stored byte size (for reporting).
export const estimateSize = async (adapter, ns = "") => {
  if (!adapter) return { bytes: 0, records: 0 };
  const keys = (await adapter.keys()) || [];
  let bytes = 0;
  let records = 0;
  for (const key of keys) {
    if (ns && !(typeof key === "string" && key.startsWith(`${ns}:`))) continue;
    const value = await adapter.get(key);
    if (value === undefined) continue;
    records += 1;
    try { bytes += JSON.stringify(value).length; } catch { /* noop */ }
  }
  return { bytes, records };
};

// ---- clock (injectable for deterministic tests) -------------------------

let clock = () => Date.now();
export const setClock = (fn) => { clock = typeof fn === "function" ? fn : (() => Date.now()); };
const nowMs = () => clock();
