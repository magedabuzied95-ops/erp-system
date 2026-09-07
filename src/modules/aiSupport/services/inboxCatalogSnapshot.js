// Persistent product-catalog snapshot for the AI Inbox product sheet.
//
// Why this exists: the PWA's "إرسال منتج" sheet called loadCustomerProductCatalog()
// on EVERY open, which asks /products/with-variants with no `limit` — the server
// then omits the LIMIT clause and returns the whole catalog with every variant
// (~50MB for this tenant; ?compact=1 only strips ~19 of 120 fields, so it barely
// helps). On a phone that is a multi-second download plus a JSON.parse plus a
// full normalize pass, every single time, because the module-level 5-minute cache
// dies with the JS context the moment the PWA is backgrounded.
//
// The snapshot stores the ALREADY-NORMALIZED products (the closed shape
// buildProductFromVariants returns — no raw API rows, no cost fields), so a warm
// open skips the download AND the normalization. This mirrors the proven POS
// warm-open snapshot (src/modules/pos/lib/posCatalogCache.js) and is gated by the
// same GET /products/pos-catalog-version watermark.
//
// Fail-safe by construction: every method resolves to a safe fallback when
// IndexedDB is unavailable, blocked (private mode), quota-exceeded or corrupt.
// A cache failure must never break the sheet — it only makes it slow again.

import { getCurrentUser, getCurrentTenant } from "../../../shared/auth/authStorage.js";

// Bump when the stored product shape or the pricing rule changes: it is the only
// thing that re-normalizes an existing snapshot (the catalog-version watermark
// tracks DATA, not the code that shaped it).
export const INBOX_CATALOG_SCHEMA_VERSION = 1;

const DB_NAME = "erp-inbox-product-catalog";
const DB_VERSION = 1;
const STORE = "kv";

// A snapshot younger than this is served with no network call at all — the same
// window the module-level in-memory cache already used.
export const SNAPSHOT_FRESH_MS = 5 * 60 * 1000;
// Beyond this a snapshot is not painted at all; prices/stock are too old to show.
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

// Test seam: node:test has no IndexedDB, and the point of these tests is the
// freshness/identity/expiry logic, not the browser API. Injecting a plain Map
// keeps that logic honest without a fake-indexeddb dependency.
let injectedStore = null;
export const __setStoreForTests = (store) => { injectedStore = store; };
export const __resetStoreForTests = () => { injectedStore = null; };

const withStore = async (mode, fn) => {
  if (injectedStore) {
    const shim = {
      get: (key) => ({ result: injectedStore.get(key) }),
      put: (value, key) => { injectedStore.set(key, value); return {}; },
      delete: (key) => { injectedStore.delete(key); return {}; },
      clear: () => { injectedStore.clear(); return {}; },
    };
    try {
      const request = fn(shim);
      return request && "result" in request ? request.result : undefined;
    } catch {
      return undefined;
    }
  }
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
    let request;
    try {
      request = fn(tx.objectStore(STORE));
    } catch {
      resolve(undefined);
      return;
    }
    tx.oncomplete = () => resolve(request && "result" in request ? request.result : undefined);
    tx.onerror = () => resolve(undefined);
    tx.onabort = () => resolve(undefined);
  }).catch(() => undefined);
};

// Namespaced exactly like the AI Inbox cache: a read/write is a NO-OP unless BOTH
// tenant id and user id resolve, so one account's catalog can never be served to
// another (or written before identity is known).
export const resolveSnapshotKey = () => {
  try {
    const user = getCurrentUser() || {};
    const tenant = getCurrentTenant() || {};
    const tenantId = String(user.tenant_id || user.tenantId || tenant.id || tenant.tenant_id || "").trim();
    const userId = String(user.id || user.user_id || "").trim();
    if (!tenantId || !userId) return "";
    return `snapshot:v${INBOX_CATALOG_SCHEMA_VERSION}:t=${tenantId}:u=${userId}`;
  } catch {
    return "";
  }
};

const isUsableRecord = (record) =>
  Boolean(
    record &&
      record.schema_version === INBOX_CATALOG_SCHEMA_VERSION &&
      Array.isArray(record.products) &&
      record.products.length > 0 &&
      Number.isFinite(Number(record.cached_at))
  );

export const snapshotAgeMs = (record) => {
  const cachedAt = Number(record?.cached_at);
  if (!Number.isFinite(cachedAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - cachedAt);
};

/**
 * The stored snapshot, or null when there is none, it is for another
 * tenant/user/schema, or it is past the hard expiry.
 */
export const readCatalogSnapshot = async () => {
  const key = resolveSnapshotKey();
  if (!key) return null;
  const record = await withStore("readonly", (store) => store.get(key));
  if (!isUsableRecord(record)) return null;
  if (snapshotAgeMs(record) > SNAPSHOT_MAX_AGE_MS) return null;
  return record;
};

export const writeCatalogSnapshot = async (products = [], catalogVersion = "") => {
  const key = resolveSnapshotKey();
  if (!key || !Array.isArray(products) || !products.length) return null;
  const record = {
    schema_version: INBOX_CATALOG_SCHEMA_VERSION,
    cached_at: Date.now(),
    catalog_version: String(catalogVersion ?? "").trim(),
    products,
  };
  await withStore("readwrite", (store) => store.put(record, key));
  return record;
};

/**
 * Re-stamp an unchanged snapshot as fresh. Used when the catalog-version
 * watermark still matches: nothing sellable changed, so re-downloading ~50MB to
 * learn that would be pure waste.
 */
export const touchCatalogSnapshot = async (record) => {
  const key = resolveSnapshotKey();
  if (!key || !isUsableRecord(record)) return null;
  const next = { ...record, cached_at: Date.now() };
  await withStore("readwrite", (store) => store.put(next, key));
  return next;
};

export const clearCatalogSnapshot = async () => {
  const key = resolveSnapshotKey();
  if (!key) return;
  await withStore("readwrite", (store) => store.delete(key));
};

/** Drops every stored snapshot — used on logout, where no identity resolves. */
export const clearAllCatalogSnapshots = async () => {
  await withStore("readwrite", (store) => store.clear());
};

export default readCatalogSnapshot;
