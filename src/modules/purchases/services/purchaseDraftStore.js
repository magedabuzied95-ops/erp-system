// Persistent working-draft store for an UNFINISHED purchase invoice.
//
// This is ONLY form/cart persistence — it is NEVER authoritative for stock,
// cost, pricing, or accounting. The existing POST /purchases transaction stays
// the sole source of truth; on authoritative success the draft is deleted.
//
// Isolated from every other workflow: its own IndexedDB database
// (`erp-purchase-drafts`), namespaced by stable, non-secret identity ids
// (tenant + user). The raw JWT / auth token / session secret is NEVER stored or
// keyed, and draft contents are never logged. Every op is fail-safe: any
// IndexedDB failure degrades to "no draft" and the online Purchases flow keeps
// working exactly as today.

import { getCurrentUser, getCurrentTenant } from "../../../shared/auth/authStorage.js";

export const PURCHASE_DRAFT_SCHEMA_VERSION = 1;
const DB_NAME = "erp-purchase-drafts";
const DB_VERSION = 1;
const STORE = "drafts";
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // abandoned drafts expire after 14 days
const DEBOUNCE_MS = 400;

const str = (v) => String(v ?? "").trim();
const now = () => Date.now();

// ---- fail-safe IndexedDB adapter (dependency-free, mirrors the proven AI
// Inbox / Employee Portal pattern) --------------------------------------------
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
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } dbPromise = null; };
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
    try { tx = db.transaction(STORE, mode); } catch { resolve(undefined); return; }
    const store = tx.objectStore(STORE);
    let result;
    try { result = fn(store); } catch { resolve(undefined); return; }
    tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    tx.onerror = () => resolve(undefined);
    tx.onabort = () => resolve(undefined);
  }).catch(() => undefined);
};
const memoryAdapter = () => {
  const map = new Map();
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
    keys: async () => [...map.keys()],
    available: () => true,
  };
};
let adapter = null;
const getAdapter = () => {
  if (adapter) return adapter;
  adapter = hasIndexedDb()
    ? {
        get: (k) => withStore("readonly", (s) => s.get(k)),
        set: (k, v) => withStore("readwrite", (s) => s.put(v, k)),
        delete: (k) => withStore("readwrite", (s) => s.delete(k)),
        keys: () => withStore("readonly", (s) => (typeof s.getAllKeys === "function" ? s.getAllKeys() : { result: [] })),
        available: () => true,
      }
    : memoryAdapter();
  return adapter;
};
export const __setAdapterForTests = (a) => { adapter = a; };
export const __resetAdapterForTests = () => { adapter = null; };

const guard = async (fn, fallback) => {
  try { return await fn(getAdapter()); } catch { return fallback; }
};

// ---- identity → namespace key (token-free) ---------------------------------
// One active create-draft per tenant+user. The selected branch_id is stored in
// the draft body (so it restores exactly) rather than in the key, to avoid
// orphaning a draft when the branch selector changes mid-entry.
export const resolvePurchaseDraftKey = () => {
  const user = getCurrentUser() || {};
  const tenant = getCurrentTenant() || {};
  const tenantId = str(user.tenant_id || tenant.id || tenant.tenant_id);
  const userId = str(user.id || user.user_id);
  if (!tenantId || !userId) return ""; // refuse to persist without stable identity
  return `purchase:v${PURCHASE_DRAFT_SCHEMA_VERSION}:t=${tenantId}:u=${userId}`;
};

// ---- debounced write (latest wins) -----------------------------------------
let pendingKey = "";
let pendingRecord = null;
let pendingTimer = null;
const flushNow = async () => {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  if (!pendingKey || !pendingRecord) return;
  const key = pendingKey;
  const record = pendingRecord;
  pendingRecord = null;
  await guard((a) => a.set(key, record), undefined);
};
export const flushPendingPurchaseDraftWrites = () => flushNow();

// Persist (debounced, async — never blocks input). Returns false if there is no
// resolvable identity or nothing to save.
export const savePurchaseDraft = (draft) => {
  const key = resolvePurchaseDraftKey();
  if (!key || !draft) return false;
  pendingKey = key;
  pendingRecord = { schema: PURCHASE_DRAFT_SCHEMA_VERSION, updatedAt: now(), draft };
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { void flushNow(); }, DEBOUNCE_MS);
  if (typeof pendingTimer?.unref === "function") pendingTimer.unref();
  return true;
};

export const loadPurchaseDraft = async () => {
  const key = resolvePurchaseDraftKey();
  if (!key) return null;
  // Prefer a not-yet-flushed pending write for this key (freshest).
  if (pendingKey === key && pendingRecord) return pendingRecord.draft;
  const record = await guard((a) => a.get(key), null);
  if (!record || typeof record !== "object") return null;
  if (record.schema !== PURCHASE_DRAFT_SCHEMA_VERSION) return null;
  if (typeof record.updatedAt === "number" && now() - record.updatedAt > TTL_MS) {
    void guard((a) => a.delete(key), undefined);
    return null;
  }
  return record.draft || null;
};

export const clearPurchaseDraft = async () => {
  const key = resolvePurchaseDraftKey();
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  if (pendingKey === key) pendingRecord = null;
  if (!key) return false;
  await guard((a) => a.delete(key), undefined);
  return true;
};

// Opportunistic expiry sweep (bounded, content-free).
export const sweepExpiredPurchaseDrafts = async () => {
  const keys = await guard((a) => a.keys(), []);
  if (!Array.isArray(keys) || !keys.length) return 0;
  let removed = 0;
  for (const key of keys) {
    const record = await guard((a) => a.get(key), null);
    const stale = !record || record.schema !== PURCHASE_DRAFT_SCHEMA_VERSION
      || (typeof record.updatedAt === "number" && now() - record.updatedAt > TTL_MS);
    if (stale) { await guard((a) => a.delete(key), undefined); removed += 1; }
  }
  return removed;
};

// Project a live purchase form into the compact draft body actually needed to
// restore it — never the product catalog, galleries, supplier history, etc.
export const buildPurchaseDraftBody = ({ supplierId, warehouseId, branchId, invoiceNumber, invoiceDate, notes, mode, items } = {}) => ({
  supplier_id: str(supplierId) || null,
  warehouse_id: str(warehouseId) || null,
  branch_id: str(branchId) || null,
  invoice_number: str(invoiceNumber) || "",
  invoice_date: str(invoiceDate) || "",
  notes: str(notes) || "",
  mode: str(mode) || "",
  items: (Array.isArray(items) ? items : []).map((it) => ({
    line_id: it.line_id ?? null,
    product_id: it.product_id ?? null,
    variant_id: it.variant_id ?? null,
    product_name: str(it.product_name || it.name),
    image_url: str(it.image_url || it.thumbnail_url || ""),
    color: str(it.color),
    size: str(it.size),
    sku: str(it.sku),
    barcode: str(it.barcode),
    article_code: str(it.article_code || it.product_code),
    quantity: Number(it.quantity) || 0,
    unit_cost: Number(it.unit_cost ?? it.cost_price ?? it.purchase_price) || 0,
    cost_price: Number(it.cost_price ?? it.unit_cost ?? it.purchase_price) || 0,
    purchase_price: Number(it.purchase_price ?? it.cost_price ?? it.unit_cost) || 0,
    selling_price: Number(it.selling_price ?? it.price) || 0,
    sale_price: Number(it.sale_price) || 0,
    wholesale_price: Number(it.wholesale_price) || 0,
  })),
  savedAt: now(),
});
