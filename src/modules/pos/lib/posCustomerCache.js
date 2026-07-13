export const POS_CUSTOMER_CACHE_SCHEMA_VERSION = 1;

const POS_CUSTOMER_DB_NAME = "erp-pos-customer-cache";
const POS_CUSTOMER_DB_STORE = "snapshots";
const MAX_CACHED_CUSTOMERS = 10000;

const isBrowser = () =>
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "");

const getCustomerId = (customer = {}) => customer.id ?? customer.customer_id ?? null;

const getCacheKey = (tenantId) => {
  const normalizedTenantId = String(tenantId ?? "").trim();
  return normalizedTenantId ? `tenant:${normalizedTenantId}` : "";
};

const sanitizeCustomer = (customer = {}) => {
  const id = getCustomerId(customer);
  if (id === null || id === undefined || String(id).trim() === "") return null;

  return {
    id,
    customer_id: customer.customer_id ?? id,
    tenant_id: customer.tenant_id ?? null,
    name: String(customer.name ?? customer.customer_name ?? "").trim(),
    customer_name: String(customer.customer_name ?? customer.name ?? "").trim(),
    phone: String(customer.phone ?? customer.mobile ?? customer.customer_phone ?? "").trim(),
    mobile: String(customer.mobile ?? "").trim(),
    whatsapp: String(customer.whatsapp ?? customer.whatsapp_number ?? "").trim(),
    email: String(customer.email ?? "").trim(),
    credit_balance: Number(customer.credit_balance ?? 0) || 0,
    wallet_balance: Number(customer.wallet_balance ?? customer.balance ?? 0) || 0,
    balance: Number(customer.balance ?? customer.wallet_balance ?? 0) || 0,
    loyalty_points: Number(customer.loyalty_points ?? 0) || 0,
    loyalty_tier: customer.loyalty_tier ?? customer.tier ?? "",
    tier: customer.tier ?? customer.loyalty_tier ?? "",
    invoices_count: Number(customer.invoices_count ?? customer.orders_count ?? customer.total_orders ?? 0) || 0,
    orders_count: Number(customer.orders_count ?? customer.invoices_count ?? customer.total_orders ?? 0) || 0,
    total_orders: Number(customer.total_orders ?? customer.orders_count ?? customer.invoices_count ?? 0) || 0,
    allow_personal_transactions: Boolean(
      customer.allow_personal_transactions ?? customer.allowPersonalTransactions ?? false
    ),
    allowPersonalTransactions: Boolean(
      customer.allowPersonalTransactions ?? customer.allow_personal_transactions ?? false
    ),
    is_active: customer.is_active !== false,
  };
};

const dedupeCustomers = (customers = []) => {
  const byId = new Map();
  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const sanitized = sanitizeCustomer(customer);
    if (!sanitized) return;
    byId.set(String(getCustomerId(sanitized)), sanitized);
  });
  return Array.from(byId.values()).slice(0, MAX_CACHED_CUSTOMERS);
};

export const buildPosCustomerSnapshot = (customers = [], { tenantId } = {}) => {
  const cacheKey = getCacheKey(tenantId);
  if (!cacheKey) return null;
  return {
    schema_version: POS_CUSTOMER_CACHE_SCHEMA_VERSION,
    tenant_id: String(tenantId),
    cached_at: new Date().toISOString(),
    customers: dedupeCustomers(customers),
  };
};

export const mergePosCustomerRows = (current = [], incoming = []) =>
  dedupeCustomers([...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]);

export const getPosCustomerPagination = (response, fallbackCount = 0) => {
  const root = response && typeof response === "object" ? response : {};
  const nested = root?.data && !Array.isArray(root.data) && typeof root.data === "object" ? root.data : null;
  const payload = root?.pagination || root?.total !== undefined || root?.page !== undefined ? root : nested || root;
  const pagination = payload?.pagination && typeof payload.pagination === "object" ? payload.pagination : {};
  const page = Number(payload?.page ?? pagination?.page ?? 1);
  const limit = Number(payload?.limit ?? pagination?.limit ?? Math.max(1, fallbackCount || 200));
  const total = Number(payload?.total ?? pagination?.total ?? fallbackCount);
  const totalPages = Number(payload?.totalPages ?? pagination?.totalPages ?? Math.ceil(total / Math.max(1, limit)));
  const hasMoreValue = payload?.hasMore ?? pagination?.hasMore;
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 200,
    total: Number.isFinite(total) && total >= 0 ? total : fallbackCount,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
    hasMore: typeof hasMoreValue === "boolean" ? hasMoreValue : page < totalPages,
  };
};

export const searchPosCustomerSnapshot = (snapshot, searchValue = "", { limit = 30 } = {}) => {
  if (!snapshot || snapshot.schema_version !== POS_CUSTOMER_CACHE_SCHEMA_VERSION) return [];
  const customers = Array.isArray(snapshot.customers) ? snapshot.customers : [];
  const query = normalizeText(searchValue);
  const queryDigits = normalizeDigits(searchValue);
  if (!query && !queryDigits) return customers.slice(0, limit);

  return customers.filter((customer) => {
    const textFields = [
      customer.name,
      customer.customer_name,
      customer.email,
      customer.id,
      customer.customer_id,
    ];
    const phoneFields = [customer.phone, customer.mobile, customer.whatsapp];
    const textMatch = query && textFields.some((value) => normalizeText(value).includes(query));
    const phoneMatch = queryDigits && phoneFields.some((value) => normalizeDigits(value).includes(queryDigits));
    return Boolean(textMatch || phoneMatch);
  }).slice(0, limit);
};

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(POS_CUSTOMER_DB_NAME, POS_CUSTOMER_CACHE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POS_CUSTOMER_DB_STORE)) {
        db.createObjectStore(POS_CUSTOMER_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open POS customer cache"));
  });

const readSnapshot = async (key) => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(POS_CUSTOMER_DB_STORE, "readonly").objectStore(POS_CUSTOMER_DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("Failed to read POS customer cache"));
    });
  } finally {
    db.close();
  }
};

const writeSnapshot = async (key, snapshot) => {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_CUSTOMER_DB_STORE, "readwrite");
      tx.objectStore(POS_CUSTOMER_DB_STORE).put(snapshot, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to write POS customer cache"));
    });
  } finally {
    db.close();
  }
};

export const getPosCustomerSnapshot = async ({ tenantId } = {}) => {
  const key = getCacheKey(tenantId);
  if (!key || !isBrowser()) return null;
  try {
    const snapshot = await readSnapshot(key);
    if (
      !snapshot ||
      snapshot.schema_version !== POS_CUSTOMER_CACHE_SCHEMA_VERSION ||
      String(snapshot.tenant_id ?? "") !== String(tenantId ?? "")
    ) return null;
    return { ...snapshot, customers: dedupeCustomers(snapshot.customers) };
  } catch (error) {
    console.warn("POS_CUSTOMER_CACHE_READ_FAILED", error?.message || error);
    return null;
  }
};

export const savePosCustomerSnapshot = async (customers = [], { tenantId, merge = false } = {}) => {
  const key = getCacheKey(tenantId);
  if (!key || !isBrowser()) return null;
  try {
    const existing = merge ? await getPosCustomerSnapshot({ tenantId }) : null;
    const rows = mergePosCustomerRows(existing?.customers || [], customers);
    const snapshot = buildPosCustomerSnapshot(rows, { tenantId });
    await writeSnapshot(key, snapshot);
    return snapshot;
  } catch (error) {
    console.warn("POS_CUSTOMER_CACHE_SAVE_FAILED", error?.message || error);
    return null;
  }
};
