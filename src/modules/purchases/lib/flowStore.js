export { formatCurrency } from "../../../shared/lib/currency";

const STORAGE_KEYS = {
  purchases: "erp.purchases.records",
  purchaseDrafts: "erp.purchases.drafts",
  suppliersMeta: "erp.purchases.suppliers.meta",
  warehousesMeta: "erp.inventory.warehouses.meta",
  inventoryMovements: "erp.inventory.movements",
  inventoryAdjustments: "erp.inventory.adjustments",
  inventoryTransfers: "erp.inventory.transfers",
};

const MAX_PURCHASE_PAYLOAD_BYTES = 1024 * 1024;
const MAX_RECENT_DRAFTS = 10;
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const nowTime = () => Date.now();

const isPurchaseStorageKey = (key) =>
  key === STORAGE_KEYS.purchases ||
  key === STORAGE_KEYS.purchaseDrafts ||
  String(key || "").includes("purchase");

const getSerializedSizeBytes = (serialized) => new Blob([serialized]).size;

const getRecordTime = (record = {}) => {
  const value = record.updated_at || record.created_at || record.saved_at || record.timestamp || record.date;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

const normalizeDraftList = (items) => (Array.isArray(items) ? items : []);

const cleanupDraftList = (items) => {
  const cutoff = nowTime() - DRAFT_TTL_MS;
  let draftCount = 0;
  return normalizeDraftList(items)
    .filter((item) => {
      const status = String(item?.status || "").toLowerCase();
      if (status !== "draft") return true;
      const time = getRecordTime(item);
      return !time || time >= cutoff;
    })
    .sort((a, b) => getRecordTime(b) - getRecordTime(a))
    .filter((item) => {
      if (String(item?.status || "").toLowerCase() !== "draft") return true;
      draftCount += 1;
      return draftCount <= MAX_RECENT_DRAFTS;
    });
};

export const cleanupOldPurchaseDrafts = () => {
  const win = safeWindow();
  if (!win) return;

  try {
    const drafts = JSON.parse(win.localStorage.getItem(STORAGE_KEYS.purchaseDrafts) || "[]");
    win.localStorage.setItem(STORAGE_KEYS.purchaseDrafts, JSON.stringify(cleanupDraftList(drafts)));
  } catch {
    win.localStorage.removeItem(STORAGE_KEYS.purchaseDrafts);
  }

  try {
    const purchases = JSON.parse(win.localStorage.getItem(STORAGE_KEYS.purchases) || "[]");
    win.localStorage.setItem(STORAGE_KEYS.purchases, JSON.stringify(cleanupDraftList(purchases)));
  } catch {
    win.localStorage.removeItem(STORAGE_KEYS.purchases);
  }

  [win.localStorage, win.sessionStorage].forEach((storage) => {
    if (!storage) return;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key) continue;
      const normalized = key.toLowerCase();
      const isAbandonedPurchaseCache =
        normalized.includes("purchase") &&
        (normalized.includes("upload") || normalized.includes("cache") || normalized.includes("temp"));
      if (isAbandonedPurchaseCache) storage.removeItem(key);
    }
  });
};

const compactPurchaseLine = (item = {}, fallback = {}) => {
  const quantity = Number(item.quantity ?? item.qty ?? 1);
  const unitCost = Number(
    item.unit_cost ??
      item.cost_price ??
      item.last_cost ??
      item.purchase_cost ??
      item.cost ??
      0
  );

  return {
    id: item.id ?? item.line_id ?? null,
    product_id: item.product_id ?? null,
    variant_id: item.variant_id ?? null,
    sku: item.sku || "",
    size: item.size || "",
    color: item.color || "",
    quantity,
    unit_cost: unitCost,
    subtotal: Number(item.subtotal ?? quantity * unitCost),
    supplier_id: item.supplier_id ?? fallback.supplier_id ?? null,
    warehouse_id: item.warehouse_id ?? fallback.warehouse_id ?? null,
  };
};

const compactPurchaseRecord = (purchase = {}) => ({
  id: purchase.id ?? null,
  invoice_number: purchase.invoice_number || purchase.purchase_number || "",
  legacy_purchase_number: purchase.legacy_purchase_number || purchase.legacyPurchaseNumber || "",
  supplier_id: purchase.supplier_id ?? null,
  supplier_name: purchase.supplier_name || "",
  warehouse_id: purchase.warehouse_id ?? null,
  warehouse_name: purchase.warehouse_name || "",
  status: purchase.status || "Draft",
  payment_status: purchase.payment_status || "Pending",
  subtotal: Number(purchase.subtotal ?? purchase.total ?? 0),
  tax: Number(purchase.tax ?? 0),
  discount: Number(purchase.discount ?? 0),
  total: Number(purchase.total ?? 0),
  notes: String(purchase.notes || "").slice(0, 1000),
  created_at: purchase.created_at || new Date().toISOString(),
  updated_at: purchase.updated_at || purchase.saved_at || purchase.created_at || new Date().toISOString(),
  items: Array.isArray(purchase.items)
    ? purchase.items.map((item) =>
        compactPurchaseLine(item, {
          supplier_id: purchase.supplier_id,
          warehouse_id: purchase.warehouse_id,
        })
      )
    : [],
});

export const normalizePurchaseStoragePayload = (value, key = STORAGE_KEYS.purchases) => {
  if (!isPurchaseStorageKey(key)) return value;
  if (Array.isArray(value)) return cleanupDraftList(value.map(compactPurchaseRecord));
  if (value && typeof value === "object" && Array.isArray(value.items)) return compactPurchaseRecord(value);
  return value;
};

const trimPurchasePayload = (value, key) => {
  const normalized = normalizePurchaseStoragePayload(value, key);
  if (!Array.isArray(normalized)) return normalized;
  return cleanupDraftList(normalized).slice(0, 50);
};

export function safeLocalSet(key, value) {
  const win = safeWindow();
  if (!win) return false;

  const persist = (nextValue) => {
    const serialized = JSON.stringify(nextValue);
    const sizeBytes = getSerializedSizeBytes(serialized);
    if (isPurchaseStorageKey(key)) console.log("[purchase-storage-size]", Math.round(sizeBytes / 1024));
    return { serialized, sizeBytes };
  };

  try {
    let nextValue = normalizePurchaseStoragePayload(value, key);
    let { serialized, sizeBytes } = persist(nextValue);
    if (sizeBytes > MAX_PURCHASE_PAYLOAD_BYTES) {
      nextValue = trimPurchasePayload(nextValue, key);
      ({ serialized, sizeBytes } = persist(nextValue));
    }
    win.localStorage.setItem(key, serialized);
    return true;
  } catch (err) {
    console.error("[storage] quota exceeded", err);
    cleanupOldPurchaseDrafts();
    try {
      const { serialized } = persist(trimPurchasePayload(value, key));
      win.localStorage.setItem(key, serialized);
      return true;
    } catch (retryErr) {
      console.error("[storage] quota retry failed", retryErr);
      return false;
    }
  }
}

const readJson = (key, fallback) => {
  const win = safeWindow();
  if (!win) return fallback;
  try {
    const raw = win.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  safeLocalSet(key, value);
};

export const formatDateTime = (value) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const slugify = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const generateCode = (prefix = "DOC") =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}`;

export const formatPurchaseCode = (sequence) =>
  `PO-${String(sequence).padStart(3, "0")}`;

export const seedSuppliers = () => [
  {
    id: "sup-1",
    name: "North Star Trading",
    phone: "+20 100 200 3000",
    email: "accounts@northstar.example",
    address: "Cairo, Egypt",
    status: "Active",
    balance: 4850,
  },
  {
    id: "sup-2",
    name: "Delta Fashion Supply",
    phone: "+20 111 222 3334",
    email: "sales@delta.example",
    address: "Alexandria, Egypt",
    status: "Active",
    balance: 1820,
  },
  {
    id: "sup-3",
    name: "Urban Goods Co.",
    phone: "+20 122 444 5555",
    email: "hello@urbangoods.example",
    address: "Giza, Egypt",
    status: "Inactive",
    balance: 0,
  },
];

export const seedWarehouses = () => [
  {
    id: "wh-1",
    name: "المخزن الرئيسي",
    location: "القاهرة",
    branch: "الفرع الرئيسي",
    status: "Active",
  },
  {
    id: "wh-2",
    name: "متجر وسط المدينة",
    location: "وسط المدينة",
    branch: "فرع",
    status: "Active",
  },
  {
    id: "wh-3",
    name: "مخزن المطار",
    location: "طريق المطار",
    branch: "فرع",
    status: "Active",
  },
];

export const seedPurchases = () => [
  {
    id: "pur-1001",
    invoice_number: "PUR-1001",
    supplier_name: "North Star Trading",
    warehouse_name: "المخزن الرئيسي",
    status: "Received",
    payment_status: "Paid",
    total: 8400,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
    notes: "Initial seasonal restock",
    items: [
      {
        product_name: "Running Shoe Pro",
        sku: "RUN-1021",
        color: "Black",
        size: "42",
        quantity: 4,
        cost_price: 1200,
        tax: 96,
        discount: 0,
      },
    ],
  },
  {
    id: "pur-1002",
    invoice_number: "PUR-1002",
    supplier_name: "Delta Fashion Supply",
    warehouse_name: "متجر وسط المدينة",
    status: "Ordered",
    payment_status: "Pending",
    total: 3200,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 42).toISOString(),
    notes: "Awaiting delivery",
    items: [
      {
        product_name: "Classic Tee",
        sku: "TEE-0048",
        color: "White",
        size: "L",
        quantity: 8,
        cost_price: 400,
        tax: 0,
        discount: 0,
      },
    ],
  },
];

export const getLocalPurchases = () => readJson(STORAGE_KEYS.purchases, seedPurchases());
export const saveLocalPurchases = (items) => writeJson(STORAGE_KEYS.purchases, items);

export const getDrafts = () => readJson(STORAGE_KEYS.purchaseDrafts, []);
export const saveDrafts = (items) => writeJson(STORAGE_KEYS.purchaseDrafts, items);

export const getSupplierMeta = () => readJson(STORAGE_KEYS.suppliersMeta, {});
export const saveSupplierMeta = (meta) => writeJson(STORAGE_KEYS.suppliersMeta, meta);

export const getWarehouseMeta = () => readJson(STORAGE_KEYS.warehousesMeta, {});
export const saveWarehouseMeta = (meta) => writeJson(STORAGE_KEYS.warehousesMeta, meta);

export const getInventoryMovements = () => readJson(STORAGE_KEYS.inventoryMovements, []);
export const saveInventoryMovements = (items) => writeJson(STORAGE_KEYS.inventoryMovements, items);

export const getInventoryAdjustments = () => readJson(STORAGE_KEYS.inventoryAdjustments, []);
export const saveInventoryAdjustments = (items) => writeJson(STORAGE_KEYS.inventoryAdjustments, items);

export const getInventoryTransfers = () => readJson(STORAGE_KEYS.inventoryTransfers, []);
export const saveInventoryTransfers = (items) => writeJson(STORAGE_KEYS.inventoryTransfers, items);

export const normalizeSupplier = (supplier) => {
  const meta = getSupplierMeta()[String(supplier.id)] || {};
  return {
    ...supplier,
    status: meta.status || supplier.status || "Active",
    balance: Number(meta.balance ?? supplier.balance ?? 0),
    ledger: Array.isArray(meta.ledger) ? meta.ledger : [],
    notes: meta.notes || supplier.notes || "",
  };
};

export const normalizeWarehouse = (warehouse) => {
  const meta = getWarehouseMeta()[String(warehouse.id)] || {};
  const normalizeFallbackWarehouseText = (value, fallbackMap = {}) => {
    const normalizedValue = String(value || "").trim();
    return fallbackMap[normalizedValue] || normalizedValue;
  };
  const stockQty = Number(warehouse.stock_qty ?? warehouse.stock_quantity ?? warehouse.stockQuantity ?? 0);
  const transfersCount = Number(warehouse.transfers_count ?? warehouse.transfer_references ?? warehouse.transferReferences ?? 0);
  const activeTransfersCount = Number(warehouse.active_transfers_count ?? warehouse.active_transfer_references ?? warehouse.activeTransferReferences ?? 0);
  return {
    ...warehouse,
    name: normalizeFallbackWarehouseText(meta.name || warehouse.name, {
      "Main Warehouse": "المخزن الرئيسي",
      "City Center Store": "متجر وسط المدينة",
      "Airport Depot": "مخزن المطار",
    }),
    location: normalizeFallbackWarehouseText(meta.location || warehouse.location, {
      Cairo: "القاهرة",
      Downtown: "وسط المدينة",
      "Airport Road": "طريق المطار",
    }),
    status: meta.status || warehouse.status || "Active",
    branch: normalizeFallbackWarehouseText(meta.branch || warehouse.branch || warehouse.branch_name || "الفرع الرئيسي", {
      Main: "الفرع الرئيسي",
      Branch: "فرع",
    }),
    notes: meta.notes || warehouse.notes || "",
    products_count: Number(warehouse.products_count || warehouse.productsCount || 0),
    stock_qty: stockQty,
    stock_quantity: stockQty,
    transfers_count: transfersCount,
    transfer_references: transfersCount,
    active_transfers_count: activeTransfersCount,
    active_transfer_references: activeTransfersCount,
    default_references: Number(warehouse.default_references || warehouse.defaultReferences || 0),
    can_delete: Boolean(warehouse.can_delete ?? warehouse.canDelete ?? false),
    is_protected: Boolean(warehouse.is_protected || warehouse.isProtected || warehouse.default_references),
  };
};

export const normalizePurchase = (purchase) => ({
  ...purchase,
  invoice_number: purchase.purchase_number || purchase.invoice_number || formatPurchaseCode(purchase.id),
  purchase_number: purchase.purchase_number || purchase.invoice_number || formatPurchaseCode(purchase.id),
  legacy_purchase_number: purchase.legacy_purchase_number || purchase.legacyPurchaseNumber || "",
  status: purchase.status || "Draft",
  payment_status: purchase.payment_status || "Pending",
  warehouse_name:
    {
      "Main Warehouse": "المخزن الرئيسي",
      "City Center Store": "متجر وسط المدينة",
      "Airport Depot": "مخزن المطار",
    }[purchase.warehouse_name] || purchase.warehouse_name || "المخزن الرئيسي",
  supplier_name: purchase.supplier_name || "مورد غير معروف",
  items: Array.isArray(purchase.items) ? purchase.items : [],
  notes: purchase.notes || "",
  subtotal: Number(purchase.subtotal ?? purchase.total ?? 0),
  tax: Number(purchase.tax ?? 0),
  discount: Number(purchase.discount ?? 0),
  total: Number(purchase.total ?? 0),
  created_at: purchase.created_at || new Date().toISOString(),
});

export const purchaseReceivedQuantity = (purchase = {}) =>
  (Array.isArray(purchase.items) ? purchase.items : []).reduce(
    (sum, item) => sum + Number(item.received_quantity ?? item.received_qty ?? item.receivedQty ?? 0),
    0
  );

export const purchaseOrderedQuantity = (purchase = {}) =>
  (Array.isArray(purchase.items) ? purchase.items : []).reduce(
    (sum, item) => sum + Number(item.quantity ?? item.qty ?? 0),
    0
  );

export const purchasePaidAmount = (purchase = {}) =>
  Number(purchase.paid_amount ?? purchase.supplier_paid_amount ?? purchase.amount_paid ?? 0) || 0;

export const purchaseHasStockMovements = (purchase = {}) =>
  Boolean(purchase.stock_applied || purchase.stock_applied_at || purchaseReceivedQuantity(purchase) > 0);

export const purchaseHasAccountingPostings = (purchase = {}) =>
  Boolean(purchase.accounting_posted || purchase.accounting_entry_id || purchase.journal_entry_id || purchase.metadata?.accounting_posted);

export const purchaseHasLinkedPayments = (purchase = {}) =>
  purchasePaidAmount(purchase) > 0 || ["paid", "partially_paid", "partial"].includes(String(purchase.payment_status || "").toLowerCase());

export const purchaseHasLinkedReturns = (purchase = {}) =>
  Boolean(purchase.return_id || purchase.return_count || purchase.metadata?.return_id || purchase.metadata?.returns_count);

export const purchaseIsFullyReceived = (purchase = {}) => {
  const ordered = purchaseOrderedQuantity(purchase);
  const received = purchaseReceivedQuantity(purchase);
  const status = String(purchase.status || "").toLowerCase();
  return Boolean(purchase.stock_applied || status.includes("fully") || status === "received" || (ordered > 0 && received >= ordered));
};

export const purchaseCanDelete = (purchase = {}) =>
  !purchaseHasStockMovements(purchase) &&
  !purchaseHasAccountingPostings(purchase) &&
  !purchaseHasLinkedPayments(purchase) &&
  !purchaseHasLinkedReturns(purchase);

export const purchaseCanEditDestructively = (purchase = {}) =>
  !purchaseHasStockMovements(purchase) && !purchaseIsFullyReceived(purchase);

export const upsertLocalPurchase = (purchase) => {
  const normalized = normalizePurchase(purchase);
  saveLocalPurchases([
    normalized,
    ...getLocalPurchases().map(normalizePurchase).filter((item) => String(item.id) !== String(normalized.id)),
  ]);
  return normalized;
};

export const deleteLocalPurchase = (purchaseId) => {
  saveLocalPurchases(getLocalPurchases().map(normalizePurchase).filter((purchase) => String(purchase.id) !== String(purchaseId)));
};

export const buildSearchText = (record) =>
  [
    record.invoice_number,
    record.purchase_number,
    record.legacy_purchase_number,
    record.legacyPurchaseNumber,
    record.supplier_name,
    record.warehouse_name,
    record.status,
    record.payment_status,
    record.notes,
    ...(Array.isArray(record.items)
      ? record.items.flatMap((item) => [item.product_name, item.sku, item.color, item.size])
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const derivePurchaseKpis = (purchases) => {
  const totalPurchases = purchases.length;
  const received = purchases.filter((purchase) => purchase.status === "Received").length;
  const ordered = purchases.filter((purchase) => purchase.status === "Ordered").length;
  const draft = purchases.filter((purchase) => purchase.status === "Draft").length;
  const totalSpent = purchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
  return { totalPurchases, received, ordered, draft, totalSpent };
};

export const deriveInventoryKpis = ({ variants = [], movements = [], adjustments = [] }) => {
  const lowStock = variants.filter((variant) => Number(variant.stock || 0) <= 10).length;
  const inventoryValue = variants.reduce((sum, variant) => sum + Number(variant.stock || 0) * Number(variant.price || 0), 0);
  const inbound = movements.filter((movement) => movement.direction === "Inbound").length;
  const outbound = movements.filter((movement) => movement.direction === "Outbound").length;
  return { lowStock, inventoryValue, inbound, outbound, adjustments: adjustments.length };
};

export const mergeArrayById = (items, idField = "id") =>
  Array.from(
    items.reduce((map, item) => map.set(String(item[idField]), item), new Map()).values()
  );
