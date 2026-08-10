// Minimal, dependency-free IndexedDB key/value adapter for Employee Portal
// working drafts (Warehouse Request + Inventory Count).
//
// Separate database from the AI Inbox cache and from the Service Worker
// CacheStorage: static assets live in CacheStorage, authenticated employee
// working drafts live HERE. Every method is fail-safe — it resolves to a safe
// fallback if IndexedDB is unavailable, blocked (private mode), quota-exceeded,
// or corrupt. The online Warehouse Request / Inventory Count workflows must
// never break because a draft read/write failed.
//
// Bumping DB_VERSION drops the old object store so a schema change invalidates
// cleanly; record keys also embed a logical schema version as a second net.

const DB_NAME = "employee-portal-drafts";
const DB_VERSION = 1;
const STORE = "drafts";

let dbPromise = null;

const hasIndexedDb = () => typeof indexedDB !== "undefined" && indexedDB !== null;

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
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
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

export const createDraftIdbAdapter = () => ({
  get: (key) => withStore("readonly", (store) => store.get(key)),
  set: (key, value) => withStore("readwrite", (store) => store.put(value, key)),
  delete: (key) => withStore("readwrite", (store) => store.delete(key)),
  keys: () => withStore("readonly", (store) => (typeof store.getAllKeys === "function" ? store.getAllKeys() : { result: [] })),
  clear: () => withStore("readwrite", (store) => store.clear()),
  available: () => hasIndexedDb(),
});

// In-memory fallback adapter (tests + environments without IndexedDB).
export const createMemoryDraftAdapter = () => {
  const map = new Map();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => { map.set(key, value); },
    delete: async (key) => { map.delete(key); },
    keys: async () => [...map.keys()],
    clear: async () => { map.clear(); },
    available: () => true,
  };
};

export default createDraftIdbAdapter;
