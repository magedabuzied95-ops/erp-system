const POS_OFFLINE_ORDERS_DB_NAME = "erp-pos-offline-orders";
const POS_OFFLINE_ORDERS_DB_STORE = "orders";
const POS_OFFLINE_DEBUG =
  String((typeof import.meta !== "undefined" && import.meta.env?.VITE_POS_OFFLINE_DEBUG) || "").trim().toLowerCase() === "true";
const POS_OFFLINE_SYNC_LOCK = "erp-pos-offline-orders-sync";
let activeOfflineOrderSync = null;

const isBrowser = () =>
  typeof window !== "undefined" &&
  typeof indexedDB !== "undefined";

const debugLog = (...args) => {
  if (POS_OFFLINE_DEBUG) {
    console.debug("[pos-offline-orders]", ...args);
  }
};

const nowIso = () => new Date().toISOString();

const randomPart = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeText = (value = "") => String(value ?? "").trim();

const normalizeSummaryError = (error) => {
  const message = normalizeText(
    error?.message ||
      error?.responseBody?.message ||
      error?.response?.data?.message ||
      error?.statusText ||
      error?.code ||
      "sync failed"
  );
  return message.slice(0, 180);
};

export const createOfflineOrderIdempotencyKey = () => `pos-${Date.now()}-${randomPart()}`;

export const shouldStoreOfflineOrderDraft = (error) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;

  const status = Number(error?.status || error?.response?.status || 0);
  if (status >= 400 && status < 500) return false;

  const message = String(error?.message || "").toLowerCase();
  if (!message) return true;
  if (message.includes("networkerror")) return true;
  if (message.includes("failed to fetch")) return true;
  if (message.includes("timed out")) return true;
  if (message.includes("timeout")) return true;
  if (message.includes("backend or vite proxy is not reachable")) return true;
  return Boolean(error?.cause);
};

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = window.indexedDB.open(POS_OFFLINE_ORDERS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POS_OFFLINE_ORDERS_DB_STORE)) {
        db.createObjectStore(POS_OFFLINE_ORDERS_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open POS offline orders db"));
  });

const withStore = async (mode, handler) => {
  if (!isBrowser()) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_OFFLINE_ORDERS_DB_STORE, mode);
      const store = tx.objectStore(POS_OFFLINE_ORDERS_DB_STORE);
      tx.oncomplete = () => resolve(handler?.result ?? null);
      tx.onerror = () => reject(tx.error || new Error("POS offline orders transaction failed"));
      Promise.resolve()
        .then(() => handler(store, tx))
        .then((result) => {
          handler.result = result;
          if (mode === "readonly") {
            resolve(result);
          }
        })
        .catch(reject);
    });
  } finally {
    db.close();
  }
};

const getAllRecords = async () => {
  if (!isBrowser()) return [];
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_OFFLINE_ORDERS_DB_STORE, "readonly");
      const store = tx.objectStore(POS_OFFLINE_ORDERS_DB_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error("Failed to read offline orders"));
    });
  } finally {
    db.close();
  }
};

const getRecordByLocalId = async (localId) => {
  if (!isBrowser()) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_OFFLINE_ORDERS_DB_STORE, "readonly");
      const store = tx.objectStore(POS_OFFLINE_ORDERS_DB_STORE);
      const request = store.get(String(localId));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Failed to read offline order"));
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
      const tx = db.transaction(POS_OFFLINE_ORDERS_DB_STORE, "readwrite");
      const store = tx.objectStore(POS_OFFLINE_ORDERS_DB_STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to save offline order"));
      store.put(record, record.local_id);
    });
    return record;
  } finally {
    db.close();
  }
};

const normalizeOfflineOrderDraft = (payload = {}) => {
  const idempotencyKey = normalizeText(payload.idempotency_key || payload.idempotencyKey || "") || createOfflineOrderIdempotencyKey();
  const createdAt = normalizeText(payload.created_at || payload.createdAt || nowIso()) || nowIso();
  const localId = normalizeText(payload.local_id || payload.localId || `offline-${idempotencyKey}`);
  const checkoutPayload = {
    ...(payload.checkout_payload || {}),
    ...(payload.checkoutPayload || {}),
    ...(payload.payload || {}),
  };
  const orderPayload = {
    ...checkoutPayload,
    idempotency_key: idempotencyKey,
  };

  return {
    local_id: localId,
    idempotency_key: idempotencyKey,
    created_at: createdAt,
    cashier: payload.cashier || payload.user || null,
    user: payload.user || payload.cashier || null,
    cart_items: Array.isArray(payload.cart_items || payload.cartItems)
      ? [...(payload.cart_items || payload.cartItems)]
      : Array.isArray(orderPayload.items)
        ? [...orderPayload.items]
        : [],
    customer: payload.customer || {
      id: orderPayload.customer_id || null,
      name: orderPayload.customer_name || "",
      phone: orderPayload.customer_phone || "",
    },
    payment_method: payload.payment_method || orderPayload.payment_method || "cash",
    totals: payload.totals || {
      subtotal: Number(orderPayload.subtotal || 0),
      discount_amount: Number(orderPayload.discount_amount || 0),
      service_fee: Number(orderPayload.service_fee || 0),
      total: Number(orderPayload.total || 0),
      paid_amount: Number(orderPayload.paid_amount || 0),
      change_amount: Number(orderPayload.change_amount || 0),
      amount_due_now: Number(orderPayload.amount_due_now || 0),
    },
    checkout_payload: orderPayload,
    sync_endpoint: normalizeText(payload.sync_endpoint || payload.endpoint || "/orders") || "/orders",
    status: normalizeText(payload.status || "pending_sync") || "pending_sync",
    server_order_id: payload.server_order_id || null,
    order_number: payload.order_number || null,
    synced_at: payload.synced_at || null,
    failed_at: payload.failed_at || null,
    error: normalizeText(payload.error || ""),
    last_attempt_at: payload.last_attempt_at || null,
    attempts: Number(payload.attempts || 0) || 0,
  };
};

const findByIdempotencyKey = async (idempotencyKey) => {
  const records = await getAllRecords();
  return records.find((record) => String(record.idempotency_key || "") === String(idempotencyKey || "")) || null;
};

export const saveOfflineOrderDraft = async (payload = {}) => {
  if (!isBrowser()) return null;
  const draft = normalizeOfflineOrderDraft(payload);
  const existing = await findByIdempotencyKey(draft.idempotency_key);
  if (existing?.local_id) {
    const next = {
      ...existing,
      ...draft,
      local_id: existing.local_id,
      idempotency_key: existing.idempotency_key || draft.idempotency_key,
      created_at: existing.created_at || draft.created_at,
      status: existing.status === "synced" ? existing.status : draft.status,
      error: existing.error || draft.error || "",
      attempts: Number(existing.attempts || 0),
    };
    debugLog("updating existing draft", { local_id: next.local_id, status: next.status });
    return putRecord(next);
  }

  debugLog("saving draft", {
    local_id: draft.local_id,
    idempotency_key: draft.idempotency_key,
    cart_items: Array.isArray(draft.cart_items) ? draft.cart_items.length : 0,
    total: Number(draft.totals?.total || 0),
  });
  return putRecord(draft);
};

export const listOfflineOrders = async () => {
  const records = await getAllRecords();
  return records.sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")));
};

export const markOfflineOrderSynced = async (localId, serverOrder = {}) => {
  if (!isBrowser()) return null;
  const current = await getRecordByLocalId(localId);
  if (!current) return null;
  const next = {
    ...current,
    status: "synced",
    synced_at: nowIso(),
    error: "",
    failed_at: null,
    server_order_id: serverOrder.order_id || serverOrder.orderId || serverOrder.id || current.server_order_id || null,
    order_number: serverOrder.invoice_number || serverOrder.invoiceNumber || serverOrder.order_number || serverOrder.public_order_number || current.order_number || null,
    last_attempt_at: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
  };
  debugLog("marked synced", { local_id: localId, server_order_id: next.server_order_id, order_number: next.order_number });
  return putRecord(next);
};

export const markOfflineOrderFailed = async (localId, error) => {
  if (!isBrowser()) return null;
  const current = await getRecordByLocalId(localId);
  if (!current) return null;
  const next = {
    ...current,
    status: "failed_sync",
    error: normalizeSummaryError(error),
    failed_at: nowIso(),
    last_attempt_at: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
  };
  debugLog("marked failed", { local_id: localId, error: next.error });
  return putRecord(next);
};

const sendOfflineOrderToServer = async (record) => {
  const { api } = await import("../../../shared/api/api.js");
  const payload = {
    ...(record.checkout_payload || {}),
    idempotency_key: record.idempotency_key,
  };
  return api.post(record.sync_endpoint || "/orders", payload, {
    timeoutMs: 30000,
    headers: {
      "Idempotency-Key": record.idempotency_key,
      "X-Idempotency-Key": record.idempotency_key,
    },
  });
};

const runPendingOfflineOrderSync = async (sendOrder) => {
  const records = await listOfflineOrders();
  const retryable = records.filter((record) => ["pending_sync", "failed_sync"].includes(String(record.status || "")));
  const result = {
    total: retryable.length,
    synced: [],
    failed: [],
  };

  for (const record of retryable) {
    try {
      debugLog("retrying", { local_id: record.local_id, idempotency_key: record.idempotency_key });
      const response = await sendOrder(record);
      const normalizedOrder = response?.order || response?.data?.order || response || {};
      await markOfflineOrderSynced(record.local_id, normalizedOrder);
      result.synced.push(record.local_id);
    } catch (error) {
      await markOfflineOrderFailed(record.local_id, error);
      result.failed.push({
        local_id: record.local_id,
        error: normalizeSummaryError(error),
      });
    }
  }

  return result;
};

export const retryPendingOfflineOrders = async (sendOrder = sendOfflineOrderToServer) => {
  if (activeOfflineOrderSync) return activeOfflineOrderSync;

  const runWithCrossTabLock = async () => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : null;
    if (!locks?.request) return runPendingOfflineOrderSync(sendOrder);

    return locks.request(POS_OFFLINE_SYNC_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) {
        debugLog("sync skipped because another POS tab owns the lock");
        return { total: 0, synced: [], failed: [], skipped_locked: true };
      }
      return runPendingOfflineOrderSync(sendOrder);
    });
  };

  activeOfflineOrderSync = runWithCrossTabLock().finally(() => {
    activeOfflineOrderSync = null;
  });
  return activeOfflineOrderSync;
};
