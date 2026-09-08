// A customer created at the counter while the connection is down. The record
// lives here until it can be POSTed, but the sale never waits for it: the
// checkout payload carries the name and the phone, and the server resolves or
// creates the account from the phone itself. So this queue exists to preserve
// the *attribution* (source, personal-transaction flag) and to give the cashier
// a real, selectable customer row in the meantime -- not to gate the invoice.
//
// The id is deliberately a string with an `offline-cust-` prefix. `customers.id`
// is a bigint, so a local id must never reach `customer_id` on any payload;
// `isOfflineCustomerId` is the guard every caller uses before sending one.

const POS_OFFLINE_CUSTOMERS_DB_NAME = "erp-pos-offline-customers";
const POS_OFFLINE_CUSTOMERS_DB_STORE = "customers";
const POS_OFFLINE_CUSTOMERS_SYNC_LOCK = "erp-pos-offline-customers-sync";

const OFFLINE_CUSTOMER_ID_PREFIX = "offline-cust-";

let activeOfflineCustomerSync = null;

const isBrowser = () => typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

const nowIso = () => new Date().toISOString();

const randomPart = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeText = (value = "") => String(value ?? "").trim();

const normalizeDigits = (value = "") => String(value ?? "").replace(/\D/g, "");

export const createOfflineCustomerId = () => `${OFFLINE_CUSTOMER_ID_PREFIX}${randomPart()}`;

export const isOfflineCustomerId = (value) =>
  String(value ?? "").startsWith(OFFLINE_CUSTOMER_ID_PREFIX);

/**
 * A customer id that is safe to put on `customer_id`. An offline local id is
 * not: Postgres would fail the `WHERE id = $1` comparison against a bigint
 * column and turn a replayable invoice into a permanent 500.
 */
export const toServerCustomerId = (value) => {
  const raw = normalizeText(value);
  if (!raw || isOfflineCustomerId(raw)) return null;
  return raw;
};

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(POS_OFFLINE_CUSTOMERS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POS_OFFLINE_CUSTOMERS_DB_STORE)) {
        db.createObjectStore(POS_OFFLINE_CUSTOMERS_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open POS offline customers db"));
  });

const getAllRecords = async () => {
  if (!isBrowser()) return [];
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(POS_OFFLINE_CUSTOMERS_DB_STORE, "readonly")
        .objectStore(POS_OFFLINE_CUSTOMERS_DB_STORE)
        .getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error("Failed to read offline customers"));
    });
  } finally {
    db.close();
  }
};

const getRecord = async (localId) => {
  if (!isBrowser()) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(POS_OFFLINE_CUSTOMERS_DB_STORE, "readonly")
        .objectStore(POS_OFFLINE_CUSTOMERS_DB_STORE)
        .get(String(localId));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Failed to read offline customer"));
    });
  } finally {
    db.close();
  }
};

const putRecord = async (record) => {
  if (!isBrowser()) return record;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_OFFLINE_CUSTOMERS_DB_STORE, "readwrite");
      tx.objectStore(POS_OFFLINE_CUSTOMERS_DB_STORE).put(record, record.local_id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to save offline customer"));
    });
    return record;
  } finally {
    db.close();
  }
};

const deleteRecord = async (localId) => {
  if (!isBrowser()) return false;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_OFFLINE_CUSTOMERS_DB_STORE, "readwrite");
      tx.objectStore(POS_OFFLINE_CUSTOMERS_DB_STORE).delete(String(localId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to delete offline customer"));
    });
    return true;
  } finally {
    db.close();
  }
};

export const buildOfflineCustomerRecord = (payload = {}, { tenantId = null } = {}) => {
  const localId = normalizeText(payload.local_id || payload.id) || createOfflineCustomerId();
  const name = normalizeText(payload.name);
  const phone = normalizeText(payload.phone);
  return {
    local_id: localId,
    tenant_id: tenantId === null || tenantId === undefined ? null : String(tenantId),
    created_at: normalizeText(payload.created_at) || nowIso(),
    status: normalizeText(payload.status) || "pending_sync",
    name,
    phone,
    phone_digits: normalizeDigits(phone),
    create_payload: {
      name,
      phone,
      source: normalizeText(payload.source),
      customer_source: normalizeText(payload.customer_source || payload.source),
      lead_source: normalizeText(payload.lead_source || payload.source),
      registration_source: normalizeText(payload.registration_source || payload.source),
      marketing_source: normalizeText(payload.marketing_source),
      marketing_platform: normalizeText(payload.marketing_platform),
      attribution_type: normalizeText(payload.attribution_type || payload.source),
      allow_personal_transactions: Boolean(payload.allow_personal_transactions),
    },
    server_customer_id: payload.server_customer_id ?? null,
    error: normalizeText(payload.error),
    attempts: Number(payload.attempts || 0) || 0,
    last_attempt_at: payload.last_attempt_at || null,
    synced_at: payload.synced_at || null,
  };
};

/**
 * The row the POS list and the cart render for a customer that only exists on
 * this device so far. It carries `pending_sync` so the UI can mark it, and the
 * same field names a server customer has, so nothing downstream needs a branch.
 */
export const toPosCustomerRow = (record = {}) => ({
  id: record.local_id,
  customer_id: record.local_id,
  local_id: record.local_id,
  name: record.name || "",
  customer_name: record.name || "",
  phone: record.phone || "",
  mobile: record.phone || "",
  email: "",
  credit_balance: 0,
  wallet_balance: 0,
  balance: 0,
  loyalty_points: 0,
  invoices_count: 0,
  orders_count: 0,
  total_orders: 0,
  allow_personal_transactions: Boolean(record.create_payload?.allow_personal_transactions),
  allowPersonalTransactions: Boolean(record.create_payload?.allow_personal_transactions),
  is_active: true,
  pending_sync: String(record.status || "") !== "synced",
  offline_created: true,
});

const findByPhone = async (phone, tenantId) => {
  const digits = normalizeDigits(phone);
  if (!digits) return null;
  const records = await getAllRecords();
  return (
    records.find(
      (record) =>
        normalizeDigits(record.phone) === digits &&
        String(record.tenant_id ?? "") === String(tenantId ?? "")
    ) || null
  );
};

export const saveOfflineCustomer = async (payload = {}, { tenantId = null } = {}) => {
  if (!isBrowser()) return null;
  const existing = await findByPhone(payload.phone, tenantId);
  if (existing) {
    // The same phone typed twice offline is one customer, not two queued rows.
    // The existing `create_payload` is spread first so a second, sparser entry
    // (just a name correction, say) cannot silently drop the source attribution
    // or the personal-transactions flag captured the first time.
    const merged = buildOfflineCustomerRecord(
      {
        ...existing,
        ...(existing.create_payload || {}),
        ...payload,
        local_id: existing.local_id,
        created_at: existing.created_at,
        status: existing.status === "synced" ? "synced" : "pending_sync",
        server_customer_id: existing.server_customer_id,
        attempts: existing.attempts,
      },
      { tenantId }
    );
    await putRecord(merged);
    return merged;
  }
  const record = buildOfflineCustomerRecord(payload, { tenantId });
  await putRecord(record);
  return record;
};

export const listOfflineCustomers = async ({ tenantId } = {}) => {
  const records = await getAllRecords();
  const scoped =
    tenantId === undefined
      ? records
      : records.filter((record) => String(record.tenant_id ?? "") === String(tenantId ?? ""));
  return scoped.sort((left, right) =>
    String(left.created_at || "").localeCompare(String(right.created_at || ""))
  );
};

export const listPendingOfflineCustomers = async ({ tenantId } = {}) => {
  const records = await listOfflineCustomers({ tenantId });
  return records.filter((record) => ["pending_sync", "failed_sync"].includes(String(record.status || "")));
};

export const markOfflineCustomerSynced = async (localId, serverCustomer = {}) => {
  const current = await getRecord(localId);
  if (!current) return null;
  const next = {
    ...current,
    status: "synced",
    synced_at: nowIso(),
    last_attempt_at: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
    error: "",
    server_customer_id:
      serverCustomer.id ?? serverCustomer.customer_id ?? current.server_customer_id ?? null,
  };
  await putRecord(next);
  return next;
};

export const markOfflineCustomerFailed = async (localId, error) => {
  const current = await getRecord(localId);
  if (!current) return null;
  const next = {
    ...current,
    status: "failed_sync",
    error: String(error?.message || error || "sync failed").slice(0, 180),
    last_attempt_at: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
  };
  await putRecord(next);
  return next;
};

export const discardOfflineCustomer = (localId) => deleteRecord(localId);

/** Drop records that already reached the server, so the queue does not grow forever. */
export const pruneSyncedOfflineCustomers = async ({ keepMs = 24 * 60 * 60 * 1000 } = {}) => {
  const records = await getAllRecords();
  const cutoff = Date.now() - Math.max(0, keepMs);
  let removed = 0;
  for (const record of records) {
    if (String(record.status || "") !== "synced") continue;
    const syncedAt = Date.parse(record.synced_at || "") || 0;
    if (syncedAt && syncedAt > cutoff) continue;
    await deleteRecord(record.local_id);
    removed += 1;
  }
  return removed;
};

const sendOfflineCustomerToServer = async (record) => {
  const { api } = await import("../../../shared/api/api.js");
  return api.post("/customers", record.create_payload || {}, { timeoutMs: 30000 });
};

const runPendingOfflineCustomerSync = async (sendCustomer, { tenantId } = {}) => {
  const pending = await listPendingOfflineCustomers({ tenantId });
  const result = { total: pending.length, synced: [], failed: [], idMap: {} };

  for (const record of pending) {
    try {
      const response = await sendCustomer(record);
      const payload = response?.data ?? response;
      const created = payload?.data ?? payload?.customer ?? payload ?? {};
      const serverId = created.id ?? created.customer_id ?? null;
      await markOfflineCustomerSynced(record.local_id, created);
      if (serverId) result.idMap[record.local_id] = serverId;
      result.synced.push(record.local_id);
    } catch (error) {
      await markOfflineCustomerFailed(record.local_id, error);
      result.failed.push({
        local_id: record.local_id,
        error: String(error?.message || error || "sync failed").slice(0, 180),
      });
    }
  }

  return result;
};

export const retryPendingOfflineCustomers = async (
  sendCustomer = sendOfflineCustomerToServer,
  { tenantId } = {}
) => {
  if (activeOfflineCustomerSync) return activeOfflineCustomerSync;

  const runWithCrossTabLock = async () => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : null;
    if (!locks?.request) return runPendingOfflineCustomerSync(sendCustomer, { tenantId });
    return locks.request(
      POS_OFFLINE_CUSTOMERS_SYNC_LOCK,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return { total: 0, synced: [], failed: [], idMap: {}, skipped_locked: true };
        return runPendingOfflineCustomerSync(sendCustomer, { tenantId });
      }
    );
  };

  activeOfflineCustomerSync = runWithCrossTabLock().finally(() => {
    activeOfflineCustomerSync = null;
  });
  return activeOfflineCustomerSync;
};
