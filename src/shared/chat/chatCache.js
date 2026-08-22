/*
 * Employee-chat IndexedDB cache (P3): the conversation list and the newest
 * page of recently opened threads, so a warm open paints from disk before the
 * network answers. The network stays authoritative: the newest server page
 * REPLACES the cached window (a deleted message must not survive in cache),
 * older cached rows and pending optimistic rows are kept.
 *
 * Keys are namespaced by a caller-supplied scope (a hash of the portal token,
 * never the token itself) so two managers on one device never read each
 * other's rows. Fail-safe: every call resolves to a harmless fallback when
 * IndexedDB is missing, blocked (private mode) or full.
 */
const DB_NAME = "employee-chat-cache";
const DB_VERSION = 1;
const STORE = "kv";
const SCHEMA = "v1";
const MAX_THREAD_ROWS = 150;
const MAX_MESSAGES = 60;
const MAX_CACHED_THREADS = 30;
const THREAD_TTL_MS = 7 * 24 * 3600000;

let dbPromise = null;
const hasIdb = () => typeof indexedDB !== "undefined" && indexedDB !== null;

const openDb = () => {
  if (!hasIdb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { try { db.close(); } catch { /* noop */ } dbPromise = null; }; resolve(db); };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  }).catch(() => null);
  return dbPromise;
};

const withStore = async (mode, fn) => {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, mode); } catch { resolve(undefined); return; }
    let result;
    try { result = fn(tx.objectStore(STORE)); } catch { resolve(undefined); return; }
    tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    tx.onerror = () => resolve(undefined);
    tx.onabort = () => resolve(undefined);
  }).catch(() => undefined);
};

const get = (key) => withStore("readonly", (store) => store.get(key));
const set = (key, value) => withStore("readwrite", (store) => store.put(value, key));
const del = (key) => withStore("readwrite", (store) => store.delete(key));
const keys = () => withStore("readonly", (store) => store.getAllKeys()).then((list) => (Array.isArray(list) ? list : []));

// djb2 — a short, non-reversible scope from a secret token.
export const chatCacheScope = (secret = "") => {
  let hash = 5381;
  const text = String(secret || "");
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return text ? (hash >>> 0).toString(36) : "";
};

const ns = (scope) => `${SCHEMA}:s=${scope}`;
const listKey = (scope) => `${ns(scope)}:threads`;
const threadKey = (scope, threadId) => `${ns(scope)}:thread:${threadId}`;

// Strip anything that should not persist: blob URLs and optimistic state.
const persistable = (message = {}) => {
  const { status, pending, ...rest } = message;
  if (typeof rest.attachment_url === "string" && rest.attachment_url.startsWith("blob:")) return null;
  return rest;
};

export const chatCache = {
  async loadThreads(scope) {
    if (!scope) return null;
    const record = await get(listKey(scope));
    return Array.isArray(record?.rows) ? record.rows : null;
  },
  async saveThreads(scope, rows = []) {
    if (!scope || !Array.isArray(rows)) return;
    await set(listKey(scope), { rows: rows.slice(0, MAX_THREAD_ROWS), savedAt: Date.now() });
  },
  async loadThread(scope, threadId) {
    if (!scope || !threadId) return null;
    const record = await get(threadKey(scope, threadId));
    if (!record || !Array.isArray(record.messages)) return null;
    if (Date.now() - Number(record.savedAt || 0) > THREAD_TTL_MS) return null;
    return record.messages;
  },
  async saveThread(scope, threadId, messages = []) {
    if (!scope || !threadId || !Array.isArray(messages)) return;
    const rows = messages.map(persistable).filter(Boolean).filter((item) => item.id).slice(-MAX_MESSAGES);
    await set(threadKey(scope, threadId), { messages: rows, savedAt: Date.now() });
  },
  // LRU + TTL sweep, and any record from an older schema.
  async sweep(scope) {
    const all = await keys();
    const mine = all.filter((key) => typeof key === "string" && key.startsWith(`${ns(scope)}:thread:`));
    const stale = all.filter((key) => typeof key === "string" && !key.startsWith(`${SCHEMA}:`));
    await Promise.all(stale.map((key) => del(key)));
    if (mine.length <= MAX_CACHED_THREADS) return;
    const dated = await Promise.all(mine.map(async (key) => ({ key, savedAt: Number((await get(key))?.savedAt || 0) })));
    dated.sort((left, right) => left.savedAt - right.savedAt);
    await Promise.all(dated.slice(0, dated.length - MAX_CACHED_THREADS).map((item) => del(item.key)));
  },
  async clear(scope) {
    const all = await keys();
    await Promise.all(all.filter((key) => typeof key === "string" && (!scope || key.startsWith(ns(scope)))).map((key) => del(key)));
  },
};

export default chatCache;
