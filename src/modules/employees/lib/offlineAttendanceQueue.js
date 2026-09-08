// Attendance an employee recorded while their phone had no connection.
//
// Unlike a POS invoice, this does NOT become a record when it syncs: the time
// comes from the employee's own device, so the server parks it and a manager
// approves it. That is why nothing here talks about "synced" meaning "counted"
// -- a submission that reached the server is still only a request.

const DB_NAME = "erp-employee-offline-attendance";
const DB_STORE = "submissions";
const SYNC_LOCK = "erp-employee-offline-attendance-sync";

let activeSync = null;

const isBrowser = () => typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
const nowIso = () => new Date().toISOString();
const text = (value = "") => String(value ?? "").trim();

const randomPart = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const createAttendanceIdempotencyKey = () => `att-${Date.now()}-${randomPart()}`;

/**
 * Whether a failure means "the network is gone" rather than "the server said no".
 * A refusal (already checked in, outside the branch radius) must NOT be queued:
 * replaying it later would just be refused again, and in the meantime the
 * employee would believe they were recorded.
 */
export const shouldQueueAttendanceOffline = (error) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const status = Number(error?.status || error?.response?.status || 0);
  if (status >= 400 && status < 500) return false;
  if (status >= 500) return true;
  const message = String(error?.message || "").toLowerCase();
  return (
    !status &&
    (message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("network request failed") ||
      message.includes("load failed") ||
      message.includes("timeout") ||
      message.includes("timed out"))
  );
};

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open offline attendance db"));
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

const getAll = async () =>
  (await withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error("Failed to read offline attendance"));
      })
  )) || [];

const put = async (record) => {
  await withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(record, record.local_id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to save offline attendance"));
      })
  );
  return record;
};

const remove = async (localId) => {
  await withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(String(localId));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to delete offline attendance"));
      })
  );
  return true;
};

export const saveOfflineAttendance = async ({ action, location = {}, timezone, notes = "" } = {}) => {
  if (!isBrowser()) return null;
  const idempotencyKey = createAttendanceIdempotencyKey();
  // Stamped at the moment the employee pressed the button, which is the whole
  // point: recording it at sync time would put an arrival hours after it
  // happened, and that is a pay dispute rather than a missing feature.
  const record = {
    local_id: `offline-att-${idempotencyKey}`,
    idempotency_key: idempotencyKey,
    action,
    occurred_at: nowIso(),
    timezone: text(timezone) || "Africa/Cairo",
    notes: text(notes),
    location: {
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      accuracy: location?.accuracy ?? null,
    },
    status: "pending_sync",
    attempts: 0,
    error: "",
  };
  return put(record);
};

export const listOfflineAttendance = async () => {
  const records = await getAll();
  return records.sort((left, right) => String(left.occurred_at || "").localeCompare(String(right.occurred_at || "")));
};

export const countPendingOfflineAttendance = async () => (await listOfflineAttendance()).length;

export const discardOfflineAttendance = (localId) => remove(localId);

const sendOne = async (token, record) => {
  const { api } = await import("../../../shared/api/api.js");
  return api.post(`/employee-portal/${encodeURIComponent(token)}/attendance/actions`, {
    action: record.action,
    offline_origin: true,
    idempotency_key: record.idempotency_key,
    occurred_at: record.occurred_at,
    attendance_log_id: null,
    gps_lat: record.location?.latitude ?? null,
    gps_lng: record.location?.longitude ?? null,
    gps_accuracy: record.location?.accuracy ?? null,
    timezone: record.timezone,
    location: record.location,
    notes: record.notes,
  });
};

const runSync = async (token, send) => {
  const records = await listOfflineAttendance();
  const result = { total: records.length, submitted: [], failed: [] };

  for (const record of records) {
    try {
      await send(token, record);
      // Handed over successfully -- but it is now a PENDING REQUEST, not
      // attendance. Removing it from the device is correct: the server holds it,
      // and the employee tracks it from the manager's decision, not from here.
      await remove(record.local_id);
      result.submitted.push(record.local_id);
    } catch (error) {
      const status = Number(error?.status || 0);
      // A refusal will be refused again forever. Drop it and surface the reason
      // rather than leaving the employee with a queue that never empties.
      if (status >= 400 && status < 500) {
        await remove(record.local_id);
        result.failed.push({ local_id: record.local_id, permanent: true, error: error?.responseBody?.message || error?.message || "" });
        continue;
      }
      await put({
        ...record,
        attempts: Number(record.attempts || 0) + 1,
        error: String(error?.message || error || "").slice(0, 180),
      });
      result.failed.push({ local_id: record.local_id, permanent: false, error: String(error?.message || error || "") });
    }
  }

  return result;
};

export const syncOfflineAttendance = async (token, send = sendOne) => {
  if (!token) return { total: 0, submitted: [], failed: [] };
  if (activeSync) return activeSync;

  const runWithLock = async () => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : null;
    if (!locks?.request) return runSync(token, send);
    return locks.request(SYNC_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) return { total: 0, submitted: [], failed: [], skipped_locked: true };
      return runSync(token, send);
    });
  };

  activeSync = runWithLock().finally(() => {
    activeSync = null;
  });
  return activeSync;
};
