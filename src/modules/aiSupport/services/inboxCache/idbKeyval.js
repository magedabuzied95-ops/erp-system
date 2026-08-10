// Minimal, dependency-free IndexedDB key/value adapter for the AI Inbox cache.
//
// This is intentionally tiny (no external library) and fail-safe: every method
// resolves to a safe fallback if IndexedDB is unavailable, blocked (private
// mode), quota-exceeded, or corrupt — the online inbox must never break because
// the cache failed. Only AI Inbox JSON lives here; static assets stay in the
// Service Worker CacheStorage.
//
// The store name is versioned via DB_VERSION; bumping it drops the old object
// store so a schema change invalidates cleanly (see inboxCacheStore.js for the
// logical schema version embedded in record keys as a second safety net).

const DB_NAME = "ai-inbox-cache";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise = null;

const hasIndexedDb = () =>
  typeof indexedDB !== "undefined" && indexedDB !== null;

const openDb = () => {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // If the connection is later force-closed (e.g. another tab upgrades the
      // schema), drop the cached promise so the next call reopens.
      db.onversionchange = () => {
        try { db.close(); } catch { /* noop */ }
        dbPromise = null;
      };
      resolve(db);
    };
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
    try {
      tx = db.transaction(STORE, mode);
    } catch {
      resolve(undefined);
      return;
    }
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch {
      resolve(undefined);
      return;
    }
    tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    tx.onerror = () => resolve(undefined);
    tx.onabort = () => resolve(undefined);
  }).catch(() => undefined);
};

// Public adapter API. All methods are Promise-based and never throw.
export const idbGet = (key) =>
  withStore("readonly", (store) => store.get(key));

export const idbSet = (key, value) =>
  withStore("readwrite", (store) => store.put(value, key));

export const idbDelete = (key) =>
  withStore("readwrite", (store) => store.delete(key));

export const idbKeys = () =>
  withStore("readonly", (store) =>
    (typeof store.getAllKeys === "function" ? store.getAllKeys() : { result: [] })
  );

export const idbClear = () =>
  withStore("readwrite", (store) => store.clear());

export const idbAvailable = () => hasIndexedDb();

export const createIdbAdapter = () => ({
  get: idbGet,
  set: idbSet,
  delete: idbDelete,
  keys: idbKeys,
  clear: idbClear,
  available: idbAvailable,
});

export default createIdbAdapter;
