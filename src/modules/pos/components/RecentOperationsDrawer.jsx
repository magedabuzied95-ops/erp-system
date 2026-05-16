import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Eye,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { getCurrentUser, getUserRole, hasPermission, isAdminUser } from "../../../shared/auth/authStorage";
import { downloadInvoicePdf, formatCurrency } from "../lib/posUtils";

const blockedStatuses = new Set(["cancelled", "canceled", "refunded", "returned", "partially_refunded"]);
const DEFAULT_EDIT_LOCK_HOURS = Number(import.meta.env.VITE_POS_INVOICE_EDIT_LOCK_HOURS || 24);

const normalizeStatus = (value = "") => String(value || "").trim().toLowerCase();

const canMutateOrder = (order = {}) => !blockedStatuses.has(normalizeStatus(order.status));
const canReturnOrder = (order = {}) => !["cancelled", "canceled", "refunded", "returned"].includes(normalizeStatus(order.status || order.payment_status));

const getOrderTotal = (order = {}) => Number(order.total_amount ?? order.total ?? order.total_price ?? 0);

const getOrderInvoiceNumber = (order = {}) => order.invoice_number || `INV-${String(order.id || "").padStart(6, "0")}`;

const arabicFallbacks = {
  "walk-in customer": "عميل نقدي",
  admin: "أدمن",
  paid: "مدفوعة",
  cash: "نقدي",
};
const statusLabels = {
  paid: "مدفوعة",
  complete: "مكتملة",
  completed: "مكتملة",
  pending: "معلقة",
  partial: "مدفوعة جزئيًا",
  unpaid: "غير مدفوعة",
  cancelled: "ملغاة",
  canceled: "ملغاة",
  refunded: "مستردة",
  returned: "مرتجع",
  partially_refunded: "مرتجعة جزئيًا",
  review: "قيد المراجعة",
  under_review: "قيد المراجعة",
};

const normalizeArabicValue = (value, fallback = "-") => {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return arabicFallbacks[text.toLowerCase()] || text;
};

const getOrderCustomer = (order = {}) => normalizeArabicValue(order.customer_name || order.customer_record_name, "عميل نقدي");

const getOrderPhone = (order = {}) => order.customer_phone || order.customer_record_phone || "";

const getPaymentMethod = (order = {}) => {
  const raw = String(order.payment_method || "").toLowerCase();
  const labels = {
    cash: "نقدي",
    card: "فيزا",
    visa: "فيزا",
    wallet: "محفظة",
    split: "متعدد",
  };
  return labels[raw] || raw || "نقدي";
};

const getOrderStatus = (order = {}) => {
  const raw = String(order.status || order.payment_status || "").trim();
  if (!raw) return "-";
  return statusLabels[raw.toLowerCase()] || normalizeArabicValue(raw);
};

const readEditLockHours = () => {
  if (typeof window === "undefined") return DEFAULT_EDIT_LOCK_HOURS;
  const stored = Number(window.localStorage.getItem("erp.pos.invoiceEditLockHours"));
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_EDIT_LOCK_HOURS;
};

const getOrderStatusKey = (order = {}) => normalizeStatus(order.status || order.payment_status);

const isCancelledOrder = (order = {}) => ["cancelled", "canceled"].includes(getOrderStatusKey(order)) || Boolean(order.cancelled_at);

const isReturnedOrder = (order = {}) =>
  ["refunded", "returned", "partially_refunded"].includes(getOrderStatusKey(order)) || Boolean(order.returned_at);

const isReviewOrder = (order = {}) => ["pending", "review", "under_review"].includes(getOrderStatusKey(order));

const isPaidOrder = (order = {}) => ["paid", "completed", "complete"].includes(getOrderStatusKey(order) || normalizeStatus(order.payment_status));

const getOrderAgeHours = (order = {}) => {
  const createdAt = new Date(order.created_at || 0).getTime();
  if (!createdAt) return 0;
  return (Date.now() - createdAt) / 36e5;
};

const isOldOrder = (order = {}, limitHours = readEditLockHours()) => getOrderAgeHours(order) > Number(limitHours || 0);

const isManagerUser = (user = {}) => {
  const role = getUserRole(user);
  return ["manager", "branch_manager", "store_manager", "admin", "super admin", "superadmin", "super_admin"].includes(role);
};

const isCashierUser = (user = {}) => getUserRole(user) === "cashier";

const canCancelInvoices = (user = {}) => isAdminUser(user) || hasPermission("pos.cancel", user) || hasPermission("orders.delete", user);

const canEditInvoices = (user = {}) => !isCashierUser(user) && (hasPermission("orders.edit", user) || hasPermission("pos.edit", user) || isManagerUser(user));

const canEditOldInvoices = (user = {}) => isManagerUser(user) || hasPermission("pos.edit_old", user) || hasPermission("orders.approve", user);

const getInvoiceLock = (order = {}, user = getCurrentUser(), limitHours = readEditLockHours()) => {
  if (isCancelledOrder(order)) return { locked: true, reason: "الفاتورة ملغاة" };
  if (isReturnedOrder(order)) return { locked: true, reason: "الفاتورة مرتجعة" };
  if (!canEditInvoices(user)) return { locked: true, reason: "لا تملك صلاحية التعديل" };
  if (isOldOrder(order, limitHours) && !canEditOldInvoices(user)) return { locked: true, reason: `تجاوزت مهلة التعديل ${limitHours} ساعة` };
  return { locked: false, reason: "" };
};

const getStatusBadges = (order = {}) => {
  const badges = [];
  if (isCancelledOrder(order)) badges.push({ label: "ملغاة", className: "border-rose-400/25 bg-rose-500/10 text-rose-100" });
  else if (isReturnedOrder(order)) badges.push({ label: "مرتجعة", className: "border-amber-400/25 bg-amber-500/10 text-amber-100" });
  else if (isReviewOrder(order)) badges.push({ label: "قيد المراجعة", className: "border-sky-400/25 bg-sky-500/10 text-sky-100" });
  else if (isPaidOrder(order)) badges.push({ label: "مدفوعة", className: "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" });
  return badges;
};

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  const dayPeriod = part("dayPeriod");
  return `${part("day")}/${part("month")}/${part("year")} - ${part("hour")}:${part("minute")} ${dayPeriod}`.trim();
};

const formatDrawerCurrency = (value) => formatCurrency(value, "ar");

const getItemName = (item = {}) => item.product_name || item.name || "منتج";

const getItemQuantity = (item = {}) => Number(item.quantity || 0);

const getItemPrice = (item = {}) => Number(item.sale_price ?? item.price ?? item.unit_price ?? 0);

const getItemSubtotal = (item = {}) => Number(item.total_amount ?? item.subtotal ?? getItemPrice(item) * getItemQuantity(item));

const getReturnedQuantity = (item = {}) => Number(item.returned_quantity || 0);

const getReturnableQuantity = (item = {}) => Math.max(0, getItemQuantity(item) - getReturnedQuantity(item));

const getItemImage = (item = {}) => item.image_url || item.product_image_url || item.variant_image_url || "";

const returnReasons = ["مقاس غير مناسب", "عيب صناعة", "تغيير رأي العميل", "استبدال", "أخرى"];

const returnModes = [
  { key: "full", label: "مرتجع كامل" },
  { key: "partial", label: "مرتجع جزئي" },
  { key: "exchange", label: "استبدال" },
];

const refundMethods = [
  { key: "cash", label: "نقدي" },
  { key: "original", label: "نفس وسيلة الدفع" },
  { key: "wallet", label: "محفظة العميل" },
];

const auditActionLabels = {
  created: "إنشاء",
  edited: "تعديل",
  reprinted: "إعادة طباعة",
  returned: "مرتجع",
  return_created: "تم إنشاء مرتجع",
  exchange_created: "تم إنشاء استبدال",
  cancelled: "إلغاء",
};

const buildAuditTimeline = (order = {}) => {
  const explicit = Array.isArray(order.audit_timeline) ? order.audit_timeline : Array.isArray(order.timeline) ? order.timeline : [];
  if (explicit.length > 0) return explicit;

  return [
    { action: "created", user: order.created_by_name || order.cashier_name || "أدمن", at: order.created_at },
    order.updated_at && order.updated_at !== order.created_at ? { action: "edited", user: order.updated_by_name || order.cashier_name || "أدمن", at: order.updated_at } : null,
    order.returned_at ? { action: "returned", user: order.returned_by_name || order.cashier_name || "أدمن", at: order.returned_at } : null,
    order.cancelled_at ? { action: "cancelled", user: order.cancelled_by_name || "أدمن", at: order.cancelled_at } : null,
  ].filter(Boolean);
};

const buildInvoiceSnapshot = (order = {}) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = Number(order.subtotal || items.reduce((sum, item) => sum + Number(item.sale_price || item.price || 0) * Number(item.quantity || 0), 0));
  const discount = Number(order.discount_amount || 0);
  const service = Number(order.service_fee || 0);
  const total = getOrderTotal(order);
  return {
    invoiceNumber: getOrderInvoiceNumber(order),
    createdAt: order.created_at,
    customerName: getOrderCustomer(order),
    customerPhone: getOrderPhone(order),
    sellerName: order.cashier_name || order.seller_name || "",
    payment_method: order.payment_method,
    publicToken: order.public_token || "",
    publicInvoiceUrl: order.public_invoice_url || order.invoice_public_url || "",
    barcodeValue: getOrderInvoiceNumber(order),
    items: items.map((item) => ({
      ...item,
      name: item.product_name || item.name || "منتج",
      price: Number(item.sale_price || item.price || 0),
      quantity: Number(item.quantity || 0),
      total_amount: Number(item.total_amount || 0),
      image_url: item.image_url || "",
    })),
    totals: {
      subtotal,
      discount,
      invoiceDiscount: discount,
      itemDiscountTotal: 0,
      serviceFee: service,
      service,
      total,
    },
  };
};

function RecentOperationsDrawer({ open, onClose, onEditOrder, onResellOrder, onExchangeStarted, currentCartTotal = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [returnOrder, setReturnOrder] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const currentUser = useMemo(() => getCurrentUser() || { name: "أدمن", role: "admin", permissions: ["*"] }, []);
  const editLockHours = useMemo(() => readEditLockHours(), []);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/pos/recent-orders?limit=20", { timeoutMs: 15000 });
      setOrders(Array.isArray(response.data) ? response.data : Array.isArray(response.orders) ? response.orders : []);
    } catch (err) {
      console.error("[RecentOperationsDrawer] load failed:", err?.response?.data || err?.responseBody || err);
      setError("تعذر تحميل العمليات الأخيرة");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      void loadOrders();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOrders, open]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) =>
      `${getOrderInvoiceNumber(order)} ${getOrderCustomer(order)} ${getOrderPhone(order)} ${order.status || ""}`.toLowerCase().includes(q)
    );
  }, [orders, search]);

  const handleReprint = async (order) => {
    try {
      setBusyId(order.id);
      await api.post(`/orders/${order.id}/reprint-log`, {});
      const invoice = buildInvoiceSnapshot(order);
      const result = await downloadInvoicePdf({
        invoice,
        format: "thermal",
        filename: `${getOrderInvoiceNumber(order)}.pdf`,
      });
      if (result?.ok || result?.fallbackOpened) {
        toast.success("تم تجهيز الفاتورة للطباعة مرة أخرى");
      }
    } catch (err) {
      toast.error(err.message || "تعذر إعادة الطباعة");
    } finally {
      setBusyId(null);
    }
  };

  const handleViewDetails = async (order) => {
    if (!order?.id) {
      setSelectedOrder(order);
      return;
    }
    try {
      setBusyId(order.id);
      const response = await api.get(`/orders/${order.id}`);
      const loadedOrder = response.order || order;
      const loadedItems = Array.isArray(response.items) ? response.items : order.items || [];
      const timeline = Array.isArray(response.audit_timeline) ? response.audit_timeline : loadedOrder.audit_timeline;
      setSelectedOrder({ ...order, ...loadedOrder, items: loadedItems, audit_timeline: timeline || [] });
    } catch (err) {
      toast.error(err.message || "تعذر تحميل تفاصيل الفاتورة");
      setSelectedOrder(order);
    } finally {
      setBusyId(null);
    }
  };

  const handleEditClick = (order) => {
    const lock = getInvoiceLock(order, currentUser, editLockHours);
    if (lock.locked) {
      toast.error(lock.reason);
      return;
    }
    onEditOrder(order);
  };

  const handleCancel = async (order) => {
    if (!canMutateOrder(order)) {
      toast.error("لا يمكن إلغاء فاتورة ملغاة أو مستردة");
      return;
    }
    if (!canCancelInvoices(currentUser)) {
      toast.error("إلغاء الفواتير متاح للأدمن فقط");
      return;
    }
    if (!window.confirm(`تأكيد إلغاء الفاتورة ${getOrderInvoiceNumber(order)}طں سيتم إرجاع المخزون.`)) return;
    try {
      setBusyId(order.id);
      await api.post(`/orders/${order.id}/cancel`, { reason: "Cancelled from POS recent operations" });
      toast.success("تم إلغاء الفاتورة وإرجاع المخزون");
      await loadOrders();
    } catch (err) {
      toast.error(err.message || "تعذر إلغاء الفاتورة");
    } finally {
      setBusyId(null);
    }
  };

  const handleReturn = async (order) => {
    if (!canReturnOrder(order)) {
      toast.error("لا يمكن عمل مرتجع لهذه الفاتورة");
      return;
    }
    try {
      setBusyId(order.id);
      const response = await api.get(`/orders/${order.id}`);
      const loadedOrder = response.order || order;
      const loadedItems = Array.isArray(response.items) ? response.items : order.items || [];
      setReturnOrder({ ...order, ...loadedOrder, items: loadedItems });
    } catch (err) {
      toast.error(err.message || "تعذر تحميل الفاتورة للمرتجع");
    } finally {
      setBusyId(null);
    }
  };

  const handleReturnCreated = async (payload) => {
    const event = payload.mode === "exchange" ? "exchange_created" : "return_created";
    if (payload.mode === "exchange" && onExchangeStarted) {
      onExchangeStarted({ order: returnOrder, returnRecord: payload.returnRecord, returnTotal: payload.returnTotal });
    }
    setSelectedOrder((current) =>
      current?.id === returnOrder?.id
        ? {
            ...current,
            status: payload.order?.status || current.status,
            payment_status: payload.order?.payment_status || current.payment_status,
            returned_at: payload.order?.returned_at || new Date().toISOString(),
            audit_timeline: [
              ...buildAuditTimeline(current),
              { action: event, user: currentUser.name || "أدمن", at: new Date().toISOString() },
            ],
          }
        : current
    );
    setReturnOrder(null);
    await loadOrders();
  };

  const handleResell = (order) => {
    if (!onResellOrder) return;
    onResellOrder(order);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm" dir="rtl">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="إغلاق" />
      <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-[560px] flex-col overflow-hidden border-l border-white/10 bg-zinc-950/95 text-white shadow-2xl shadow-black/60 sm:rounded-l-[2rem]">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-200">POS</div>
              <h2 className="mt-1 text-2xl font-black">العمليات الأخيرة</h2>
              <p className="mt-1 text-sm text-zinc-400">عرض، إعادة طباعة، تعديل، إلغاء، أو مرتجع الفواتير الأخيرة.</p>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="بحث برقم الفاتورة أو العميل أو الهاتف"
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/40 pr-11 pl-4 text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
              />
            </div>
            <button type="button" onClick={loadOrders} className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]" title="تحديث">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-36 animate-pulse rounded-3xl border border-white/10 bg-white/[0.04]" />
              ))}
            </div>
          ) : error ? (
            <State icon={AlertTriangle} title="حدث خطأ" text={error} />
          ) : filteredOrders.length === 0 ? (
            <State icon={RotateCcw} title="لا توجد عمليات" text="ستظهر آخر فواتير POS هنا بعد البيع." />
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  busyId={busyId}
                  currentUser={currentUser}
                  editLockHours={editLockHours}
                  onReprint={handleReprint}
                  onViewDetails={handleViewDetails}
                  onEdit={handleEditClick}
                  onReturn={handleReturn}
                  onCancel={handleCancel}
                  onResell={handleResell}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {selectedOrder ? (
        <DetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      ) : null}

      {returnOrder ? (
        <ReturnExchangeModal
          order={returnOrder}
          currentCartTotal={currentCartTotal}
          onClose={() => setReturnOrder(null)}
          onCreated={handleReturnCreated}
        />
      ) : null}
    </div>
  );
}

function OrderCard({ order, busyId, currentUser, editLockHours, onReprint, onViewDetails, onEdit, onReturn, onCancel, onResell }) {
  const lock = getInvoiceLock(order, currentUser, editLockHours);
  const canCancel = canCancelInvoices(currentUser) && canMutateOrder(order);
  const badges = getStatusBadges(order);

  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-black text-white">{getOrderInvoiceNumber(order)}</div>
                      <div className="mt-1 truncate text-sm text-zinc-400">
                        {getOrderCustomer(order)} {getOrderPhone(order) ? `- ${getOrderPhone(order)}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-100">
                      {formatDrawerCurrency(getOrderTotal(order))}
                    </div>
                  </div>

                  {badges.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {badges.map((badge) => (
                        <span key={badge.label} className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${badge.className}`}>
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                    <Info label="الدفع" value={getPaymentMethod(order)} />
                    <Info label="الحالة" value={getOrderStatus(order)} />
                    <Info label="الكاشير" value={normalizeArabicValue(order.cashier_name, "أدمن")} />
                    <Info label="التاريخ" value={formatDateTime(order.created_at)} />
                  </div>

                  {lock.locked ? (
                    <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">
                      {lock.reason}
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Action icon={Printer} label="طباعة مرة أخرى" disabled={busyId === order.id} onClick={() => onReprint(order)} />
                    <Action icon={Eye} label="عرض التفاصيل" disabled={busyId === order.id} onClick={() => onViewDetails(order)} />
                    <Action icon={ShoppingCart} label="إعادة بيع" disabled={busyId === order.id || isCashierUser(currentUser)} onClick={() => onResell(order)} />
                    <Action icon={Pencil} label="تعديل الفاتورة" disabled={lock.locked || busyId === order.id} onClick={() => onEdit(order)} title={lock.reason} />
                    <Action icon={RotateCcw} label="مرتجع" disabled={!canReturnOrder(order) || busyId === order.id || isCashierUser(currentUser)} onClick={() => onReturn(order)} />
                    <Action className="col-span-2" icon={Trash2} label="إلغاء الفاتورة" danger disabled={!canCancel || busyId === order.id} onClick={() => onCancel(order)} />
                  </div>
    </article>
  );
}

function ReturnExchangeModal({ order, currentCartTotal = 0, onClose, onCreated }) {
  const [mode, setMode] = useState("partial");
  const [reason, setReason] = useState("مقاس غير مناسب");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [customReason, setCustomReason] = useState("");
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries((order.items || []).map((item) => [item.id, 0]))
  );
  const [submitting, setSubmitting] = useState(false);

  const lines = useMemo(
    () =>
      (order.items || []).map((item) => {
        const max = getReturnableQuantity(item);
        const selected = Math.min(Math.max(Number(quantities[item.id] || 0), 0), max);
        const unit = Number(item.total_amount || 0) / Math.max(1, getItemQuantity(item) || 1);
        return {
          item,
          max,
          selected,
          subtotal: selected * unit,
        };
      }),
    [order.items, quantities]
  );

  const returnTotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const exchangeDifference = Number(currentCartTotal || 0) - returnTotal;

  const setFullReturn = () => {
    setMode("full");
    setQuantities(Object.fromEntries((order.items || []).map((item) => [item.id, getReturnableQuantity(item)])));
  };

  const updateQuantity = (item, value) => {
    const max = getReturnableQuantity(item);
    const next = Math.min(Math.max(Number(value || 0), 0), max);
    setQuantities((current) => ({ ...current, [item.id]: next }));
  };

  const handleMode = (nextMode) => {
    if (nextMode === "full") {
      setFullReturn();
      return;
    }
    setMode(nextMode);
    if (nextMode === "exchange") setReason("استبدال");
  };

  const submit = async () => {
    const selectedItems = lines
      .filter((line) => line.selected > 0)
      .map((line) => ({
        order_item_id: line.item.id,
        quantity: line.selected,
        refund_amount: line.subtotal,
      }));

    if (selectedItems.length === 0) {
      toast.error("اختر المنتجات المراد إرجاعها");
      return;
    }

    try {
      setSubmitting(true);
      const resolvedReason = reason === "أخرى" ? customReason.trim() : reason;
      const response = await api.post(`/orders/${order.id}/return`, {
        mode,
        refund_method: refundMethod,
        reason: resolvedReason || reason,
        refund_amount: returnTotal,
        exchange_difference: mode === "exchange" ? exchangeDifference : 0,
        items: selectedItems,
      });
      toast.success(refundMethod === "wallet" ? "تم إضافة الرصيد إلى محفظة العميل" : mode === "exchange" ? "تم إنشاء استبدال" : "تم إنشاء مرتجع");
      onCreated?.({
        mode,
        order: response.order,
        returnRecord: response.return,
        wallet: response.wallet,
        returnTotal,
        exchangeDifference,
      });
    } catch (err) {
      toast.error(err.message || "تعذر إنشاء المرتجع");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/75 px-3 py-4 sm:items-center" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">مرتجع POS</div>
            <h3 className="mt-1 text-xl font-black">إنشاء مرتجع / استبدال</h3>
            <p className="mt-1 text-sm font-semibold text-zinc-400">الفاتورة القديمة: {getOrderInvoiceNumber(order)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">إغلاق</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {returnModes.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => handleMode(option.key)}
                className={`h-11 rounded-2xl border px-3 text-sm font-black ${
                  mode === option.key ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-50" : "border-white/10 bg-white/[0.04] text-zinc-300"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <label className="text-sm font-black text-white">سبب المرتجع</label>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {returnReasons.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setReason(item)}
                  className={`h-10 rounded-2xl border px-3 text-xs font-black ${
                    reason === item ? "border-sky-300/40 bg-sky-500/15 text-sky-50" : "border-white/10 bg-black/20 text-zinc-300"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            {reason === "أخرى" ? (
              <input
                value={customReason}
                onChange={(event) => setCustomReason(event.target.value)}
                placeholder="اكتب السبب"
                className="mt-3 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
              />
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <label className="text-sm font-black text-white">طريقة رد المبلغ</label>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {refundMethods.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRefundMethod(item.key)}
                  className={`h-10 rounded-2xl border px-3 text-xs font-black ${
                    refundMethod === item.key ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-50" : "border-white/10 bg-black/20 text-zinc-300"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {refundMethod === "wallet" && !order.customer_id ? (
              <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">
                يجب ربط الفاتورة بعميل لاستخدام محفظة العميل.
              </div>
            ) : null}
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="bg-white/[0.06] px-3 py-2 text-sm font-black text-zinc-200">اختيار المنتجات المراد إرجاعها</div>
            <div className="divide-y divide-white/10">
              {lines.map(({ item, max, selected }) => (
                <div key={item.id} className="grid gap-3 p-3 sm:grid-cols-[56px_minmax(0,1fr)_150px] sm:items-center">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                    {getItemImage(item) ? <img src={getItemImage(item)} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">{getItemName(item)}</div>
                    <div className="mt-1 text-xs font-semibold text-zinc-400">
                      {[item.size, item.color].filter(Boolean).join(" / ") || "بدون مقاس أو لون"}
                    </div>
                    <div className="mt-1 text-xs font-bold text-zinc-500">
                      مباع: {getItemQuantity(item)} / مرتجع سابقا: {getReturnedQuantity(item)} / متاح: {max}
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-zinc-500">الكمية المرتجعة</label>
                    <input
                      type="number"
                      min="0"
                      max={max}
                      value={selected}
                      onChange={(event) => updateQuantity(item, event.target.value)}
                      disabled={max <= 0}
                      className="mt-1 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-center text-sm font-black text-white outline-none disabled:opacity-40"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SummaryBox label="إجمالي المرتجع" value={formatDrawerCurrency(returnTotal)} />
            {mode === "exchange" ? (
              <SummaryBox
                label={exchangeDifference >= 0 ? "فرق يدفعه العميل" : "رصيد مستحق للعميل"}
                value={formatDrawerCurrency(Math.abs(exchangeDifference))}
                tone={exchangeDifference >= 0 ? "emerald" : "amber"}
              />
            ) : null}
          </div>
        </div>

        <div className="flex gap-2 border-t border-white/10 p-4">
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-white">
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || (refundMethod === "wallet" && !order.customer_id)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-400 text-sm font-black text-zinc-950 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryBox({ label, value, tone = "emerald" }) {
  const tones = {
    emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-50",
    amber: "border-amber-400/20 bg-amber-500/10 text-amber-50",
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tones[tone] || tones.emerald}`}>
      <div className="text-xs font-bold opacity-70">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
    </div>
  );
}

function DetailsModal({ order, onClose }) {
  const timeline = buildAuditTimeline(order);

  return (
        <div className="fixed inset-0 z-[105] flex items-end justify-center bg-black/70 px-3 py-4 sm:items-center" dir="rtl">
          <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">تفاصيل الفاتورة</div>
                <h3 className="mt-1 text-xl font-black">{getOrderInvoiceNumber(order)}</h3>
              </div>
              <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">إغلاق</button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-4">
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[minmax(0,1.8fr)_0.7fr_0.9fr_0.9fr] gap-2 bg-white/[0.06] px-3 py-2 text-xs font-bold text-zinc-400">
                  <div>المنتج</div>
                  <div className="text-center">الكمية</div>
                  <div className="text-left">السعر</div>
                  <div className="text-left">الإجمالي الفرعي</div>
                </div>
                {(order.items || []).length > 0 ? (
                  (order.items || []).map((item, index) => (
                    <div key={item.id || index} className="grid grid-cols-[minmax(0,1.8fr)_0.7fr_0.9fr_0.9fr] gap-2 border-t border-white/10 px-3 py-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-black text-white">{getItemName(item)}</div>
                        {[item.color, item.size].filter(Boolean).length > 0 ? (
                          <div className="mt-1 truncate text-xs font-semibold text-zinc-500">{[item.color, item.size].filter(Boolean).join(" / ")}</div>
                        ) : null}
                      </div>
                      <div className="text-center font-black text-zinc-100">{getItemQuantity(item)}</div>
                      <div className="text-left font-black text-zinc-100">{formatDrawerCurrency(getItemPrice(item))}</div>
                      <div className="text-left font-black text-zinc-100">{formatDrawerCurrency(getItemSubtotal(item))}</div>
                    </div>
                  ))
                ) : (
                  <div className="border-t border-white/10 px-3 py-6 text-center text-sm font-semibold text-zinc-400">لا توجد منتجات في هذه الفاتورة</div>
                )}
              </div>
              <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-emerald-100/70">الإجمالي</span>
                  <span className="text-lg font-black text-emerald-50">{formatDrawerCurrency(getOrderTotal(order))}</span>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h4 className="text-sm font-black text-white">سجل الفاتورة</h4>
                <div className="mt-3 space-y-3">
                  {timeline.length > 0 ? (
                    timeline.map((event, index) => (
                      <div key={`${event.action}-${event.at || index}`} className="flex gap-3">
                        <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-black text-zinc-100">{auditActionLabels[event.action] || normalizeArabicValue(event.action, "عملية")}</span>
                            <span className="shrink-0 text-xs font-bold text-zinc-500">{formatDateTime(event.at)}</span>
                          </div>
                          <div className="mt-1 text-xs font-semibold text-zinc-400">{normalizeArabicValue(event.user, "أدمن")}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm font-semibold text-zinc-400">لا يوجد سجل متاح لهذه الفاتورة</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
      <span className="shrink-0 font-semibold text-zinc-500">{label}</span>
      <span className="min-w-0 truncate text-left font-black text-zinc-100" dir="auto">{value}</span>
    </div>
  );
}

function Action({ icon: Icon, label, onClick, disabled, danger = false, className = "", title = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${className} ${
        danger
          ? "border-rose-400/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
          : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
      }`}
    >
      {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  );
}

function State({ icon: Icon, title, text }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.04] p-10 text-center">
      <Icon className="mx-auto h-10 w-10 text-zinc-500" />
      <h3 className="mt-3 text-lg font-black text-white">{title}</h3>
      <p className="mt-2 text-sm text-zinc-400">{text}</p>
    </div>
  );
}

export default RecentOperationsDrawer;

