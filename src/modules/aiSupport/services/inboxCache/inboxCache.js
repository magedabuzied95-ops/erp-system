// AI Inbox stale-while-revalidate cache facade.
//
// Binds the pure store (inboxCacheStore) to the IndexedDB adapter and the
// authenticated namespace (tenant + user), with debounced event-driven writes,
// logout cleanup, and total fail-safety: ANY cache error is swallowed with a
// content-free diagnostic and the online inbox continues unaffected.
//
// Only AI Inbox JSON lives here (IndexedDB). Static assets stay in the Service
// Worker CacheStorage. No tokens/credentials are ever written here.

import { getCurrentUser, getCurrentTenant } from "../../../../shared/auth/authStorage.js";
import createIdbAdapter from "./idbKeyval.js";
import { createMemoryAdapter } from "./memoryAdapter.js";
import * as store from "./inboxCacheStore.js";

// ---- adapter (IndexedDB when available, in-memory fallback otherwise) ----

let adapter = null;
const getAdapter = () => {
  if (adapter) return adapter;
  try {
    const idb = createIdbAdapter();
    adapter = idb.available() ? idb : createMemoryAdapter();
  } catch {
    adapter = createMemoryAdapter();
  }
  return adapter;
};

// Test seam: inject a specific adapter (e.g. a throwing one for fail-safe tests
// or an in-memory one for behavioral tests). Not used in production code paths.
export const __setAdapterForTests = (nextAdapter) => { adapter = nextAdapter; };
export const __resetAdapterForTests = () => { adapter = null; };

// ---- namespace (isolation) ----------------------------------------------

// Resolve the current authenticated namespace. Requires BOTH a tenant id AND a
// user id — otherwise returns "" and every cache op becomes a safe no-op, so we
// never read/write customer data before identity is known or key it ambiguously.
export const resolveNamespace = () => {
  try {
    const user = getCurrentUser() || {};
    const tenant = getCurrentTenant() || {};
    const tenantId = user.tenant_id || user.tenantId || tenant.id || tenant.tenant_id || "";
    const userId = user.id || user.user_id || user.uid || user.userId || "";
    return store.buildNamespace({ tenantId, userId });
  } catch {
    return "";
  }
};

// ---- safe diagnostics (never log customer content) ----------------------

let warned = false;
const safeLog = (code) => {
  // Log at most a short, content-free code once per session to avoid noise and
  // to guarantee no cached message text ever reaches the console.
  if (warned) return;
  warned = true;
  try { console.warn("[ai-inbox-cache] degraded:", code); } catch { /* noop */ }
};

const guard = async (code, fn, fallback) => {
  try {
    return await fn();
  } catch {
    safeLog(code);
    return fallback;
  }
};

// ---- debounced writes (avoid a write storm) -----------------------------

const timers = new Map();
const debounce = (key, fn, wait = 400) => {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(key);
    Promise.resolve().then(fn).catch(() => safeLog("write"));
  }, wait);
  timers.set(key, t);
};

// ---- public API ----------------------------------------------------------

export const primeList = (channelFilter) =>
  guard("readList", async () => {
    const ns = resolveNamespace();
    if (!ns) return null;
    return store.readList(getAdapter(), ns, channelFilter);
  }, null);

export const saveList = (conversations, channelFilter) => {
  const ns = resolveNamespace();
  if (!ns) return;
  debounce(`list:${channelFilter || "all"}`, () =>
    store.writeList(getAdapter(), ns, channelFilter, conversations)
  );
};

// Pure re-export (no identity/adapter needed): chronological ordering for a
// merged message window, with a fail-safe fallback. See inboxCacheStore.
export const orderMessages = (messages, fallback) => store.orderMessages(messages, fallback);

// Pure re-export: drop cached messages the authoritative server page no longer
// contains (deleted on the server), keeping optimistic bubbles and history older
// than the page window. See inboxCacheStore.reconcileWithServerPage.
export const reconcileWithServerPage = (cachedMessages, serverPage, identityKeysFn) => {
  try {
    return store.reconcileWithServerPage(cachedMessages, serverPage, identityKeysFn);
  } catch {
    safeLog("reconcile");
    return cachedMessages;
  }
};

// Immediate replace-write of a thread's cached window — full-page hydrate only
// (its window is already cache ∪ server page, reconciled). A union write here
// would resurrect server-deleted messages on the next session.
export const replaceThreadNow = (conversationKey, messages) =>
  guard("replaceThread", async () => {
    const ns = resolveNamespace();
    if (!ns || !conversationKey) return false;
    return store.replaceThread(getAdapter(), ns, conversationKey, messages);
  }, false);

export const primeThread = (conversationKey) =>
  guard("readThread", async () => {
    const ns = resolveNamespace();
    if (!ns) return null;
    return store.readThread(getAdapter(), ns, conversationKey);
  }, null);

// mergeFn is the app's mergeMessagesByIdentity — passed in so we never fork the
// dedup algorithm. Debounced per thread.
export const saveThread = (conversationKey, messages, mergeFn) => {
  const ns = resolveNamespace();
  if (!ns || !conversationKey) return;
  debounce(`thread:${conversationKey}`, () =>
    store.writeThread(getAdapter(), ns, conversationKey, messages, mergeFn)
  );
};

// Immediate (non-debounced) thread write — used on optimistic send / send
// reconciliation so a reopen right after sending reflects the true state.
export const saveThreadNow = (conversationKey, messages, mergeFn) =>
  guard("writeThreadNow", async () => {
    const ns = resolveNamespace();
    if (!ns || !conversationKey) return false;
    return store.writeThread(getAdapter(), ns, conversationKey, messages, mergeFn);
  }, false);

export const saveLastThread = (conversationKey) => {
  const ns = resolveNamespace();
  if (!ns || !conversationKey) return;
  debounce("last", () => store.writeLastThread(getAdapter(), ns, conversationKey), 200);
};

export const readLastThread = () =>
  guard("readLast", async () => {
    const ns = resolveNamespace();
    if (!ns) return null;
    return store.readLastThread(getAdapter(), ns);
  }, null);

export const sweep = () =>
  guard("sweep", async () => {
    const ns = resolveNamespace();
    if (!ns) return 0;
    return store.sweepExpired(getAdapter(), ns);
  }, 0);

// Logout / session change → wipe the ENTIRE inbox cache DB. Simplest safe
// strategy: no residue of the previous session can reach the next user.
export const clearAllCache = () =>
  guard("clear", async () => {
    // Flush any pending debounced writes so they can't repopulate after clear.
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    return store.clearAll(getAdapter());
  }, false);

export const measure = (channelFilterNamespaceOnly = false) =>
  guard("measure", async () => {
    const ns = resolveNamespace();
    return store.estimateSize(getAdapter(), channelFilterNamespaceOnly ? ns : "");
  }, { bytes: 0, records: 0 });

export const cacheDebug = () => ({ namespace: resolveNamespace(), adapter: getAdapter() === adapter ? "idb-or-memory" : "unknown" });

export default {
  primeList,
  saveList,
  primeThread,
  orderMessages,
  reconcileWithServerPage,
  replaceThreadNow,
  saveThread,
  saveThreadNow,
  saveLastThread,
  readLastThread,
  sweep,
  clearAllCache,
  measure,
  resolveNamespace,
};
