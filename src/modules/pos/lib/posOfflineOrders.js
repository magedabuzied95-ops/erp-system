const POS_OFFLINE_ORDERS_DB_NAME = "erp-pos-offline-orders";
const POS_OFFLINE_ORDERS_DB_STORE = "orders";
const POS_OFFLINE_DEBUG =
  String((typeof import.meta !== "undefined" && import.meta.env?.VITE_POS_OFFLINE_DEBUG) || "").trim().toLowerCase() === "true";
const POS_OFFLINE_SYNC_LOCK = "erp-pos-offline-orders-sync";
let activeOfflineOrderSync = null;

// A queued invoice is money and goods that already left the shop, so "give up"
// is never a silent outcome. Every sync failure lands in exactly one of these:
//   pending_sync    - not sent yet, or a transient failure worth retrying
//   failed_sync     - retried and failed transiently; still retried automatically
//   needs_review    - the server refused for a reason a human must resolve
//                     (stock is gone, the branch changed). Never auto-retried,
//                     always visible in the queue panel until a manager acts.
//   synced          - the server holds it
export const OFFLINE_ORDER_STATUS = {
  PENDING: "pending_sync",
  FAILED: "failed_sync",
  NEEDS_REVIEW: "needs_review",
  SYNCED: "synced",
};

export const RETRYABLE_OFFLINE_ORDER_STATUSES = [
  OFFLINE_ORDER_STATUS.PENDING,
  OFFLINE_ORDER_STATUS.FAILED,
];

// Anything still owed to the server, whether it retries on its own or waits for
// a manager. This is the number the cashier sees and the shift close blocks on.
export const OPEN_OFFLINE_ORDER_STATUSES = [
  ...RETRYABLE_OFFLINE_ORDER_STATUSES,
  OFFLINE_ORDER_STATUS.NEEDS_REVIEW,
];

const OFFLINE_ORDER_CHANGE_EVENT = "pos-offline-orders-changed";

const emitOfflineOrdersChanged = () => {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_ORDER_CHANGE_EVENT));
  } catch {
    // A browser without CustomEvent still syncs; it just refreshes on its timer.
  }
};

export const subscribeToOfflineOrderChanges = (handler) => {
  if (typeof window === "undefined" || typeof handler !== "function") return () => {};
  window.addEventListener(OFFLINE_ORDER_CHANGE_EVENT, handler);
  return () => window.removeEventListener(OFFLINE_ORDER_CHANGE_EVENT, handler);
};

const readErrorCode = (error) =>
  String(
    error?.code ||
      error?.responseBody?.code ||
      error?.response?.data?.code ||
      ""
  ).toUpperCase();

const readErrorStatus = (error) => Number(error?.status || error?.response?.status || 0);

const AUTH_STATUSES = new Set([401, 403]);
const THROTTLE_STATUSES = new Set([408, 425, 429]);

const readErrorMessage = (error) =>
  String(
    error?.responseBody?.message ||
      error?.response?.data?.message ||
      error?.message ||
      ""
  ).toLowerCase();

/**
 * Which bucket a sync failure belongs in. The distinction that matters: a 4xx is
 * normally permanent, but the two 4xx answers a *replay* legitimately provokes --
 * "no shift is open right now" and "that stock is gone" -- must not burn the
 * invoice. The first is purely a matter of timing, so it stays retryable; the
 * second needs a person, so it parks in needs_review instead of disappearing.
 */
export const classifyOfflineSyncError = (error) => {
  const status = readErrorStatus(error);
  const code = readErrorCode(error);
  const message = readErrorMessage(error);

  if (code === "OFFLINE_REPLAY_NO_OPEN_SHIFT") {
    return { status: OFFLINE_ORDER_STATUS.PENDING, retryable: true, reason: "no_open_shift", stopPass: false };
  }
  if (code === "OFFLINE_REPLAY_STOCK_CONFLICT" || message.includes("not enough stock")) {
    return { status: OFFLINE_ORDER_STATUS.NEEDS_REVIEW, retryable: false, reason: "stock_conflict", stopPass: false };
  }
  // An expired login is not a verdict on the invoice. api.js clears the session
  // on the first 401, so every invoice after it in the same pass would be
  // refused too -- and parking them all turned one expired token into a queue a
  // manager had to free by hand, with the shift close blocked behind it. The
  // invoice stays pending, the pass stops, and the till asks for a login.
  if (AUTH_STATUSES.has(status)) {
    return { status: OFFLINE_ORDER_STATUS.PENDING, retryable: true, reason: "login_required", stopPass: true };
  }
  if (THROTTLE_STATUSES.has(status)) {
    return { status: OFFLINE_ORDER_STATUS.FAILED, retryable: true, reason: "server_unavailable", stopPass: true };
  }
  if (status >= 500) {
    return { status: OFFLINE_ORDER_STATUS.FAILED, retryable: true, reason: "server_unavailable", stopPass: false };
  }
  if (status >= 400 && status < 500) {
    // A genuine rejection (bad payload, revoked permission). It cannot fix
    // itself, so a human has to look at it -- but the invoice is still kept.
    return { status: OFFLINE_ORDER_STATUS.NEEDS_REVIEW, retryable: false, reason: "rejected", stopPass: false };
  }
  return { status: OFFLINE_ORDER_STATUS.FAILED, retryable: true, reason: "network", stopPass: false };
};

const AUTH_PARKED_MESSAGE = /session expired|unauthori[sz]ed|forbidden|jwt|token expired|invalid token/i;

/**
 * Invoices parked before 401/403 became retryable carry reason "rejected" and
 * nothing else to tell them apart from a real refusal -- except the status we
 * now store and, for older rows, api.js's fixed 401 message. Those go back into
 * the automatic queue; every other rejection stays with the manager.
 */
export const isAuthParkedOfflineRecord = (record = {}) => {
  if (String(record.status || "") !== OFFLINE_ORDER_STATUS.NEEDS_REVIEW) return false;
  if (String(record.error_reason || "") !== "rejected") return false;
  const status = Number(record.error_status || 0);
  if (status) return AUTH_STATUSES.has(status);
  return AUTH_PARKED_MESSAGE.test(String(record.error || ""));
};

// ---------------------------------------------------------------------------
// OWNERSHIP
// The queue lives on the device, not on the login. Without an owner, cashier B
// logging in after cashier A replayed A's sales under B's session and into B's
// shift. A record carries who made it; a pass only sends the current user's.
// ---------------------------------------------------------------------------

const parseStoredUser = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

/** The logged-in user as the auth layer stored it, or null when unknown. */
export const readCurrentPosUser = () => {
  const storages = [];
  try {
    if (typeof window !== "undefined" && window.localStorage) storages.push(window.localStorage);
  } catch {
    // Restricted storage.
  }
  try {
    if (typeof localStorage !== "undefined" && !storages.includes(localStorage)) storages.push(localStorage);
  } catch {
    // Restricted storage.
  }
  for (const storage of storages) {
    try {
      const user = parseStoredUser(storage.getItem("user"));
      if (user) return user;
    } catch {
      // Keep looking.
    }
  }
  return null;
};

const readUserId = (user) => {
  const value = user?.id ?? user?.user_id ?? user?.userId ?? null;
  return value === null || value === undefined || value === "" ? null : String(value);
};

const readTenantId = (user) => {
  const value = user?.tenant_id ?? user?.tenantId ?? null;
  return value === null || value === undefined || value === "" ? null : String(value);
};

/** The owner stamp for a new queued record. */
export const resolveOfflineRecordOwner = (payload = {}) => {
  const current = readCurrentPosUser();
  const cashier = payload.cashier || payload.user || null;
  return {
    owner_user_id: normalizeOwnerValue(payload.owner_user_id) ?? readUserId(cashier) ?? readUserId(current),
    owner_tenant_id: normalizeOwnerValue(payload.owner_tenant_id) ?? readTenantId(cashier) ?? readTenantId(current),
  };
};

function normalizeOwnerValue(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

/**
 * True when the record was made by someone other than the logged-in user. A
 * record with no owner (queued before owners existed) and a device with no known
 * user both answer false, so those keep replaying exactly as before.
 */
export const isOfflineRecordOwnedByAnotherUser = (record = {}, user = readCurrentPosUser()) => {
  const ownerId = normalizeOwnerValue(record?.owner_user_id);
  const currentId = readUserId(user);
  if (!ownerId || !currentId) return false;
  if (ownerId !== currentId) return true;
  const ownerTenant = normalizeOwnerValue(record?.owner_tenant_id);
  const currentTenant = readTenantId(user);
  return Boolean(ownerTenant && currentTenant && ownerTenant !== currentTenant);
};

// ---------------------------------------------------------------------------
// DISCARD: who may delete a paid queued invoice, and the trace it leaves.
// ---------------------------------------------------------------------------

const MANAGER_ROLES = new Set([
  "manager",
  "branch manager",
  "store manager",
  "admin",
  "super admin",
  "superadmin",
]);
const CASHIER_ROLES = new Set(["cashier", "pos cashier", "pos", "sales", "sales agent", "كاشير"]);
const DISCARD_PERMISSIONS = ["*", "pos.offline_queue.discard", "orders.delete"];

const normalizeRole = (user) =>
  String(user?.role || user?.role_name || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

/**
 * Deleting a queued invoice throws away a sale whose money is already in the
 * drawer, so it is a manager's call. A cashier role never qualifies, whatever
 * permissions it was granted for its own invoices; an unknown user never does.
 */
export const canDiscardOfflineQueueItems = (user = readCurrentPosUser()) => {
  if (!user || typeof user !== "object") return false;
  const role = normalizeRole(user);
  if (!role || CASHIER_ROLES.has(role)) return false;
  if (MANAGER_ROLES.has(role)) return true;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const normalized = permissions.map((permission) => String(permission || "").trim().toLowerCase().replace(":", "."));
  return DISCARD_PERMISSIONS.some((permission) => normalized.includes(permission));
};

/** What the manager has to type before a queued invoice is deleted for good. */
export const OFFLINE_DISCARD_CONFIRMATION_WORDS = ["حذف", "DELETE"];

export const isOfflineDiscardConfirmation = (value) => {
  const text = String(value ?? "").trim();
  return OFFLINE_DISCARD_CONFIRMATION_WORDS.some((word) => word.toLowerCase() === text.toLowerCase());
};

const OFFLINE_DISCARD_LOG_KEY = "erp.pos.offline_discard_log";
const OFFLINE_DISCARD_LOG_LIMIT = 500;

const readLocalStorage = () => {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Restricted storage.
  }
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Restricted storage.
  }
  return null;
};

export const listDiscardedOfflineItems = () => {
  const storage = readLocalStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(OFFLINE_DISCARD_LOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** A local trace of a deleted paid record: who, when, how much, what was in it. */
export const recordDiscardedOfflineItem = (kind, record = {}, actor = readCurrentPosUser()) => {
  const entry = {
    kind,
    discarded_at: nowIso(),
    discarded_by: actor
      ? {
          id: readUserId(actor),
          name: String(actor.name || actor.full_name || actor.email || ""),
          role: String(actor.role || actor.role_name || ""),
          tenant_id: readTenantId(actor),
        }
      : null,
    local_id: record.local_id || "",
    idempotency_key: record.idempotency_key || "",
    reference: record.offline_reference || record.invoice_number || "",
    created_at: record.created_at || "",
    status: record.status || "",
    error: record.error || "",
    owner_user_id: record.owner_user_id ?? null,
    cashier: record.cashier ? { id: record.cashier.id ?? null, name: record.cashier.name || "" } : null,
    total: Number(record.totals?.total ?? record.amount ?? 0) || 0,
    payment_method: record.payment_method || "",
    items: (Array.isArray(record.cart_items) ? record.cart_items : []).map((item) => ({
      product_id: item?.product_id ?? null,
      variant_id: item?.variant_id ?? null,
      name: String(item?.name || item?.product_name || ""),
      color: String(item?.color || ""),
      size: String(item?.size || ""),
      quantity: Number(item?.quantity || 0) || 0,
      price: Number(item?.price ?? item?.unit_price ?? 0) || 0,
    })),
    category: record.category || "",
    notes: record.notes || "",
  };
  const storage = readLocalStorage();
  if (!storage) return entry;
  try {
    const next = [...listDiscardedOfflineItems(), entry].slice(-OFFLINE_DISCARD_LOG_LIMIT);
    storage.setItem(OFFLINE_DISCARD_LOG_KEY, JSON.stringify(next));
  } catch {
    // A full quota must not stop the manager; the entry is still returned.
  }
  return entry;
};

const LOGIN_REQUIRED_EVENT = "pos-offline-login-required";

export const emitOfflineLoginRequired = (detail = {}) => {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(LOGIN_REQUIRED_EVENT, { detail }));
  } catch {
    // No CustomEvent: the pass result still carries login_required.
  }
};

export const subscribeToOfflineLoginRequired = (handler) => {
  if (typeof window === "undefined" || typeof handler !== "function") return () => {};
  window.addEventListener(LOGIN_REQUIRED_EVENT, handler);
  return () => window.removeEventListener(LOGIN_REQUIRED_EVENT, handler);
};

let persistentStorageRequested = false;

/**
 * Asks the browser not to evict this origin's storage under pressure. The queue
 * is money; losing IndexedDB to a storage sweep loses sales. Best-effort, once.
 */
export const requestPersistentOfflineStorage = async () => {
  if (persistentStorageRequested) return null;
  persistentStorageRequested = true;
  try {
    const storage = typeof navigator !== "undefined" ? navigator.storage : null;
    if (!storage || typeof storage.persist !== "function") return null;
    if (typeof storage.persisted === "function" && (await storage.persisted())) return true;
    return Boolean(await storage.persist());
  } catch {
    return null;
  }
};

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

// The old 2-character tag (key `erp.pos.offline_device_tag`) gave 1,296 values:
// two tills in one shop drew the same tag often enough to print the same
// reference on the same day. The device id is 8 characters and lives under its
// own key, so a device still holding a 2-character tag simply mints a new id.
const OFFLINE_DEVICE_ID_KEY = "erp.pos.offline_device_id";
const OFFLINE_DEVICE_ID_LENGTH = 8;
const OFFLINE_REFERENCE_SEQ_KEY = "erp.pos.offline_reference_seq";
const DEVICE_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const mintOfflineDeviceId = () => {
  const bytes = new Uint8Array(OFFLINE_DEVICE_ID_LENGTH);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => DEVICE_ID_ALPHABET[byte % DEVICE_ID_ALPHABET.length]).join("");
};

// Per page load when storage is unavailable, so the fallback is at least not a
// constant shared by every broken device.
let volatileDeviceId = "";

export const readOfflineDeviceId = () => {
  const storage = readLocalStorage();
  try {
    const existing = String(storage?.getItem(OFFLINE_DEVICE_ID_KEY) || "").trim().toUpperCase();
    if (/^[A-Z0-9]{6,}$/.test(existing)) return existing;
    const id = mintOfflineDeviceId();
    if (!storage) throw new Error("no storage");
    storage.setItem(OFFLINE_DEVICE_ID_KEY, id);
    return id;
  } catch {
    if (!volatileDeviceId) volatileDeviceId = mintOfflineDeviceId();
    return volatileDeviceId;
  }
};

/**
 * The number printed on the paper the customer walks out with. Invoice numbers
 * are minted by the server, so an offline sale has none -- and handing someone a
 * receipt with "INV-PENDING" on it is not a receipt. This is a device-scoped,
 * per-day sequence (`OFF-K7M2Q9XA-260908-003`) that travels with the invoice and is
 * stamped on the order once it syncs, so the paper can always be traced back to
 * the real invoice it became.
 */
export const createOfflineInvoiceReference = (now = new Date()) => {
  const stamp = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const tag = readOfflineDeviceId();

  let sequence = 1;
  if (typeof window !== "undefined") {
    try {
      const storage = readLocalStorage();
      const raw = storage.getItem(OFFLINE_REFERENCE_SEQ_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      sequence = parsed?.day === stamp ? Number(parsed.seq || 0) + 1 : 1;
      storage.setItem(OFFLINE_REFERENCE_SEQ_KEY, JSON.stringify({ day: stamp, seq: sequence }));
    } catch {
      sequence = Math.floor(Math.random() * 900) + 100;
    }
  }

  return `OFF-${tag}-${stamp}-${String(sequence).padStart(3, "0")}`;
};

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
    // Who made the sale. Only the same user replays it (see isOfflineRecordOwnedByAnotherUser).
    ...resolveOfflineRecordOwner(payload),
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
    // The invoice number the customer walked out with. The receipt is printed
    // from it offline, so the same number has to reach the server on replay
    // rather than the server minting a second one.
    invoice_number: normalizeText(payload.invoice_number || payload.invoiceNumber || orderPayload.invoice_number || ""),
    // The reference printed on the customer's copy while the till was offline.
    offline_reference: normalizeText(payload.offline_reference || payload.offlineReference || ""),
    // The full receipt as it was printed. Kept so the cashier can reprint a
    // queued invoice from the offline panel without the server having seen it.
    receipt_order: payload.receipt_order || payload.receiptOrder || null,
    // Where the sale actually happened. The replay is judged against these, not
    // against whatever shift happens to be open when the connection returns.
    shift_id: payload.shift_id ?? orderPayload.shift_id ?? null,
    branch_id: payload.branch_id ?? orderPayload.branch_id ?? null,
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
  void requestPersistentOfflineStorage();
  const draft = normalizeOfflineOrderDraft(payload);
  const existing = await findByIdempotencyKey(draft.idempotency_key);
  if (existing?.local_id) {
    const next = {
      ...existing,
      ...draft,
      local_id: existing.local_id,
      owner_user_id: existing.owner_user_id ?? draft.owner_user_id,
      owner_tenant_id: existing.owner_tenant_id ?? draft.owner_tenant_id,
      idempotency_key: existing.idempotency_key || draft.idempotency_key,
      created_at: existing.created_at || draft.created_at,
      status: existing.status === "synced" ? existing.status : draft.status,
      error: existing.error || draft.error || "",
      attempts: Number(existing.attempts || 0),
    };
    debugLog("updating existing draft", { local_id: next.local_id, status: next.status });
    const updated = await putRecord(next);
    emitOfflineOrdersChanged();
    return updated;
  }

  debugLog("saving draft", {
    local_id: draft.local_id,
    idempotency_key: draft.idempotency_key,
    cart_items: Array.isArray(draft.cart_items) ? draft.cart_items.length : 0,
    total: Number(draft.totals?.total || 0),
  });
  const saved = await putRecord(draft);
  emitOfflineOrdersChanged();
  return saved;
};

export const listOfflineOrders = async () => {
  const records = await getAllRecords();
  return records.sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")));
};

/**
 * One-time repair for invoices an expired login parked under the old rule. Runs
 * at the start of every pass (cheap: a read, and writes only for matches) so a
 * device that updates mid-shift frees its queue without anyone pressing retry.
 */
export const migrateAuthParkedOfflineOrders = async () => {
  if (!isBrowser()) return 0;
  const records = await getAllRecords();
  let migrated = 0;
  for (const record of records) {
    if (!isAuthParkedOfflineRecord(record)) continue;
    await putRecord({
      ...record,
      status: OFFLINE_ORDER_STATUS.PENDING,
      error_reason: "login_required",
      retryable: true,
      failed_at: null,
      auth_requeued_at: nowIso(),
    });
    migrated += 1;
  }
  if (migrated) emitOfflineOrdersChanged();
  return migrated;
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
  const saved = await putRecord(next);
  emitOfflineOrdersChanged();
  return saved;
};

export const markOfflineOrderFailed = async (localId, error) => {
  if (!isBrowser()) return null;
  const current = await getRecordByLocalId(localId);
  if (!current) return null;
  const classification = classifyOfflineSyncError(error);
  const next = {
    ...current,
    status: classification.status,
    error: normalizeSummaryError(error),
    error_reason: classification.reason,
    error_status: readErrorStatus(error) || null,
    retryable: classification.retryable,
    failed_at: nowIso(),
    last_attempt_at: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
  };
  debugLog("marked failed", { local_id: localId, error: next.error, status: next.status, reason: classification.reason });
  const saved = await putRecord(next);
  emitOfflineOrdersChanged();
  return saved;
};

/** Put a parked invoice back in the automatic queue -- the manager fixed the cause. */
export const requeueOfflineOrder = async (localId) => {
  if (!isBrowser()) return null;
  const current = await getRecordByLocalId(localId);
  if (!current) return null;
  if (String(current.status || "") === OFFLINE_ORDER_STATUS.SYNCED) return current;
  const next = {
    ...current,
    status: OFFLINE_ORDER_STATUS.PENDING,
    error: "",
    error_reason: "",
    retryable: true,
    failed_at: null,
  };
  const saved = await putRecord(next);
  emitOfflineOrdersChanged();
  return saved;
};

/**
 * Deletes a queued invoice. A synced one is housekeeping; an unsynced one is a
 * paid sale the server will never hear about, so it needs a manager and leaves a
 * local trace (listDiscardedOfflineItems) that can be reported on later.
 */
export const deleteOfflineOrder = async (localId, { actor = readCurrentPosUser() } = {}) => {
  if (!isBrowser()) return false;
  const current = await getRecordByLocalId(localId);
  if (current && String(current.status || "") !== OFFLINE_ORDER_STATUS.SYNCED) {
    if (!canDiscardOfflineQueueItems(actor)) {
      const error = new Error("Only a manager can delete a queued invoice");
      error.code = "OFFLINE_DISCARD_FORBIDDEN";
      throw error;
    }
    recordDiscardedOfflineItem("order", current, actor);
  }
  return removeOfflineOrderRecord(localId);
};

const removeOfflineOrderRecord = async (localId) => {
  if (!isBrowser()) return false;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_OFFLINE_ORDERS_DB_STORE, "readwrite");
      tx.objectStore(POS_OFFLINE_ORDERS_DB_STORE).delete(String(localId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to delete offline order"));
    });
    emitOfflineOrdersChanged();
    return true;
  } finally {
    db.close();
  }
};

export const countOpenOfflineOrders = async () => {
  const records = await listOfflineOrders();
  return records.filter((record) => OPEN_OFFLINE_ORDER_STATUSES.includes(String(record.status || ""))).length;
};

/**
 * Synced invoices are kept for a while so the cashier can still reprint or
 * check one, then dropped -- an unbounded store eventually costs the device its
 * IndexedDB quota, which is what breaks the *next* offline sale.
 */
export const pruneSyncedOfflineOrders = async ({ keepMs = 7 * 24 * 60 * 60 * 1000 } = {}) => {
  const records = await listOfflineOrders();
  const cutoff = Date.now() - Math.max(0, keepMs);
  let removed = 0;
  for (const record of records) {
    if (String(record.status || "") !== OFFLINE_ORDER_STATUS.SYNCED) continue;
    const syncedAt = Date.parse(record.synced_at || "") || 0;
    if (syncedAt && syncedAt > cutoff) continue;
    await removeOfflineOrderRecord(record.local_id);
    removed += 1;
  }
  return removed;
};

const sendOfflineOrderToServer = async (record) => {
  const { api } = await import("../../../shared/api/api.js");
  const payload = {
    ...(record.checkout_payload || {}),
    idempotency_key: record.idempotency_key,
    // The replay markers. They tell the server this sale is already finished in
    // the real world, so "your shift is closed" is a routing question rather
    // than a reason to refuse the invoice.
    offline_origin: true,
    offline_created_at: record.created_at || null,
    offline_shift_id: record.shift_id ?? record.checkout_payload?.shift_id ?? null,
    offline_reference: record.offline_reference || "",
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
  await migrateAuthParkedOfflineOrders().catch(() => 0);
  const records = await listOfflineOrders();
  const retryable = records.filter((record) => RETRYABLE_OFFLINE_ORDER_STATUSES.includes(String(record.status || "")));
  const currentUser = readCurrentPosUser();
  const result = {
    total: retryable.length,
    synced: [],
    failed: [],
    // Another cashier's sales. They stay pending until that cashier logs in.
    foreign: [],
    login_required: false,
    stopped_reason: "",
  };

  for (const record of retryable) {
    if (isOfflineRecordOwnedByAnotherUser(record, currentUser)) {
      result.foreign.push(record.local_id);
      continue;
    }
    try {
      debugLog("retrying", { local_id: record.local_id, idempotency_key: record.idempotency_key });
      const response = await sendOrder(record);
      const normalizedOrder = response?.order || response?.data?.order || response || {};
      await markOfflineOrderSynced(record.local_id, normalizedOrder);
      result.synced.push(record.local_id);
    } catch (error) {
      const classification = classifyOfflineSyncError(error);
      await markOfflineOrderFailed(record.local_id, error);
      result.failed.push({
        local_id: record.local_id,
        error: normalizeSummaryError(error),
        reason: classification.reason,
      });
      if (classification.stopPass) {
        // Every invoice after this one would get the same answer. Stop here
        // and leave the rest untouched rather than stamping each with a failure.
        result.stopped_reason = classification.reason;
        if (classification.reason === "login_required") {
          result.login_required = true;
          emitOfflineLoginRequired({ source: "orders" });
        }
        break;
      }
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
