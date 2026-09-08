// A till expense raised while the connection was down -- the delivery man paid,
// the water arrived, an employee took an advance. The cash physically left the
// drawer at that moment, so like an invoice this is a completed fact waiting to
// be recorded, not a request waiting to succeed. It shares the invoice queue's
// status model and error classification so both drain under one contract.
import { OFFLINE_ORDER_STATUS, classifyOfflineSyncError } from "./posOfflineOrders.js";

const POS_OFFLINE_EXPENSES_DB_NAME = "erp-pos-offline-expenses";
const POS_OFFLINE_EXPENSES_DB_STORE = "expenses";
const POS_OFFLINE_EXPENSES_SYNC_LOCK = "erp-pos-offline-expenses-sync";

const OPEN_STATUSES = [
  OFFLINE_ORDER_STATUS.PENDING,
  OFFLINE_ORDER_STATUS.FAILED,
  OFFLINE_ORDER_STATUS.NEEDS_REVIEW,
];
const RETRYABLE_STATUSES = [OFFLINE_ORDER_STATUS.PENDING, OFFLINE_ORDER_STATUS.FAILED];

let activeOfflineExpenseSync = null;

const isBrowser = () => typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
const nowIso = () => new Date().toISOString();
const normalizeText = (value = "") => String(value ?? "").trim();

const randomPart = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const createOfflineExpenseIdempotencyKey = () => `pos-expense-${Date.now()}-${randomPart()}`;

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(POS_OFFLINE_EXPENSES_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POS_OFFLINE_EXPENSES_DB_STORE)) {
        db.createObjectStore(POS_OFFLINE_EXPENSES_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open POS offline expenses db"));
  });

const withDb = async (fn) => {
  if (!isBrowser()) return null;
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
};

const getAllRecords = async () =>
  (await withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction(POS_OFFLINE_EXPENSES_DB_STORE, "readonly")
          .objectStore(POS_OFFLINE_EXPENSES_DB_STORE)
          .getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error("Failed to read offline expenses"));
      })
  )) || [];

const getRecord = async (localId) =>
  withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction(POS_OFFLINE_EXPENSES_DB_STORE, "readonly")
          .objectStore(POS_OFFLINE_EXPENSES_DB_STORE)
          .get(String(localId));
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Failed to read offline expense"));
      })
  );

const putRecord = async (record) => {
  await withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(POS_OFFLINE_EXPENSES_DB_STORE, "readwrite");
        tx.objectStore(POS_OFFLINE_EXPENSES_DB_STORE).put(record, record.local_id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to save offline expense"));
      })
  );
  return record;
};

export const deleteOfflineExpense = async (localId) => {
  await withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(POS_OFFLINE_EXPENSES_DB_STORE, "readwrite");
        tx.objectStore(POS_OFFLINE_EXPENSES_DB_STORE).delete(String(localId));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to delete offline expense"));
      })
  );
  return true;
};

export const buildOfflineExpenseRecord = (payload = {}) => {
  const idempotencyKey = normalizeText(payload.idempotency_key) || createOfflineExpenseIdempotencyKey();
  return {
    local_id: normalizeText(payload.local_id) || `offline-expense-${idempotencyKey}`,
    idempotency_key: idempotencyKey,
    created_at: normalizeText(payload.created_at) || nowIso(),
    status: normalizeText(payload.status) || OFFLINE_ORDER_STATUS.PENDING,
    category: normalizeText(payload.category),
    amount: Number(payload.amount || 0) || 0,
    payment_method: normalizeText(payload.payment_method) || "cash",
    notes: normalizeText(payload.notes),
    employee_id: payload.employee_id ?? null,
    employee_name: normalizeText(payload.employee_name),
    cashier: payload.cashier || null,
    // Only ever a real server shift id. A shift opened on the device has no row
    // here, so the replay resolves to whichever shift is open when it lands.
    shift_id: payload.shift_id ?? null,
    branch_id: payload.branch_id ?? null,
    request_payload: payload.request_payload || {},
    server_expense_id: payload.server_expense_id ?? null,
    error: normalizeText(payload.error),
    error_reason: normalizeText(payload.error_reason),
    attempts: Number(payload.attempts || 0) || 0,
    last_attempt_at: payload.last_attempt_at || null,
    synced_at: payload.synced_at || null,
  };
};

export const saveOfflineExpense = async (payload = {}) => {
  if (!isBrowser()) return null;
  return putRecord(buildOfflineExpenseRecord(payload));
};

export const listOfflineExpenses = async () => {
  const records = await getAllRecords();
  return records.sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")));
};

export const listOpenOfflineExpenses = async () => {
  const records = await listOfflineExpenses();
  return records.filter((record) => OPEN_STATUSES.includes(String(record.status || "")));
};

export const markOfflineExpenseSynced = async (localId, serverExpense = {}) => {
  const current = await getRecord(localId);
  if (!current) return null;
  return putRecord({
    ...current,
    status: OFFLINE_ORDER_STATUS.SYNCED,
    synced_at: nowIso(),
    last_attempt_at: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
    error: "",
    error_reason: "",
    server_expense_id: serverExpense.id ?? current.server_expense_id ?? null,
  });
};

export const markOfflineExpenseFailed = async (localId, error) => {
  const current = await getRecord(localId);
  if (!current) return null;
  const classification = classifyOfflineSyncError(error);
  return putRecord({
    ...current,
    status: classification.status,
    error: String(error?.responseBody?.message || error?.message || error || "sync failed").slice(0, 180),
    error_reason: classification.reason,
    last_attempt_at: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
  });
};

export const requeueOfflineExpense = async (localId) => {
  const current = await getRecord(localId);
  if (!current || String(current.status || "") === OFFLINE_ORDER_STATUS.SYNCED) return current;
  return putRecord({ ...current, status: OFFLINE_ORDER_STATUS.PENDING, error: "", error_reason: "" });
};

export const pruneSyncedOfflineExpenses = async ({ keepMs = 7 * 24 * 60 * 60 * 1000 } = {}) => {
  const records = await getAllRecords();
  const cutoff = Date.now() - Math.max(0, keepMs);
  let removed = 0;
  for (const record of records) {
    if (String(record.status || "") !== OFFLINE_ORDER_STATUS.SYNCED) continue;
    const syncedAt = Date.parse(record.synced_at || "") || 0;
    if (syncedAt && syncedAt > cutoff) continue;
    await deleteOfflineExpense(record.local_id);
    removed += 1;
  }
  return removed;
};

const sendOfflineExpenseToServer = async (record) => {
  const { api } = await import("../../../shared/api/api.js");
  return api.post(
    "/pos/expenses",
    {
      ...(record.request_payload || {}),
      shift_id: record.shift_id ?? null,
      branch_id: record.branch_id ?? null,
      idempotency_key: record.idempotency_key,
      offline_origin: true,
      offline_created_at: record.created_at,
    },
    {
      timeoutMs: 30000,
      headers: {
        "Idempotency-Key": record.idempotency_key,
        "X-Idempotency-Key": record.idempotency_key,
      },
    }
  );
};

const runPendingOfflineExpenseSync = async (sendExpense) => {
  const records = await listOfflineExpenses();
  const retryable = records.filter((record) => RETRYABLE_STATUSES.includes(String(record.status || "")));
  const result = { total: retryable.length, synced: [], failed: [] };

  for (const record of retryable) {
    try {
      const response = await sendExpense(record);
      const payload = response?.data ?? response;
      await markOfflineExpenseSynced(record.local_id, payload?.expense || payload || {});
      result.synced.push(record.local_id);
    } catch (error) {
      await markOfflineExpenseFailed(record.local_id, error);
      result.failed.push({
        local_id: record.local_id,
        error: String(error?.message || error || "sync failed").slice(0, 180),
      });
    }
  }

  return result;
};

export const retryPendingOfflineExpenses = async (sendExpense = sendOfflineExpenseToServer) => {
  if (activeOfflineExpenseSync) return activeOfflineExpenseSync;

  const runWithCrossTabLock = async () => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : null;
    if (!locks?.request) return runPendingOfflineExpenseSync(sendExpense);
    return locks.request(POS_OFFLINE_EXPENSES_SYNC_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) return { total: 0, synced: [], failed: [], skipped_locked: true };
      return runPendingOfflineExpenseSync(sendExpense);
    });
  };

  activeOfflineExpenseSync = runWithCrossTabLock().finally(() => {
    activeOfflineExpenseSync = null;
  });
  return activeOfflineExpenseSync;
};
