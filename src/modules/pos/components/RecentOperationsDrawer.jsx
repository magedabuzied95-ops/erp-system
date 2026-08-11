import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Eye,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { getCurrentUser, getUserRole, hasPermission } from "../../../shared/auth/authStorage";
import { DEFAULT_PRODUCT_PLACEHOLDER, resolveInvoiceItemImageUrl } from "../../../shared/lib/invoiceItemImages";
import { formatCurrency } from "../lib/posUtils";
import { CurrencyText } from "../../../shared/components/CurrencyAmount";

const DEFAULT_EDIT_LOCK_HOURS = Number(import.meta.env.VITE_POS_INVOICE_EDIT_LOCK_HOURS || 24);
const POS_DEBUG = Boolean(
  import.meta.env?.DEV ||
  String(import.meta.env?.VITE_POS_CHECKOUT_DEBUG || "").trim().toLowerCase() === "true" ||
  String(import.meta.env?.VITE_POS_DEBUG || "").trim().toLowerCase() === "true"
);

const normalizeStatus = (value = "") => String(value || "").trim().toLowerCase();

const canReturnOrder = (order = {}) => !["cancelled", "canceled", "refunded", "returned"].includes(normalizeStatus(order.status || order.payment_status));

const getOrderTotal = (order = {}) => Number(order.total_amount ?? order.total ?? order.total_price ?? 0);

const getOrderInvoiceNumber = (order = {}) => order.invoice_number || (order.id ? `INV-${order.id}` : "INV-PENDING");

const getOrderActionKey = (order = {}, action = "") => `${order.id || getOrderInvoiceNumber(order)}:${action}`;

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

const isPlaceholderCustomer = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  return (
    !text ||
    /^guest[:#-]?\d*/.test(text) ||
    text === "guest" ||
    text === "walk-in" ||
    text === "walk in" ||
    text === "walk-in customer" ||
    text === "عميل نقدي"
  );
};

const firstMeaningful = (...values) =>
  values.map((value) => String(value ?? "").trim()).find((value) => value && !isPlaceholderCustomer(value)) || "";

const getOrderCustomer = (order = {}) =>
  normalizeArabicValue(
    firstMeaningful(
      order.customer_name,
      order.customer?.name,
      order.customer_full_name,
      order.customer_record_name,
      order.customer_phone,
      order.customer_record_phone
    ),
    typeof document !== "undefined" && document.documentElement?.dir === "rtl" ? "عميل نقدي" : "Walk-in customer"
  );

const getOrderSeller = (order = {}) => {
  const excluded = new Set(
    [order.cashier_name, order.created_by_name, order.admin_name]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  return (
    [order.seller_name, order.sales_employee_name, order.salesperson_name, order.assigned_seller_name, order.employee_name]
      .map((value) => String(value ?? "").trim())
      .find((value) => value && !excluded.has(value.toLowerCase())) || "-"
  );
};

const getPaymentMethod = (order = {}) => {
  const raw = String(order.payment_method || "").toLowerCase();
  const labels = {
    cash: "CASH",
    card: "VISA",
    visa: "VISA",
    wallet: "INSTAPAY",
    instapay: "INSTAPAY",
    vodafone_cash: "V.CASH",
    split: "SPLIT",
  };
  return labels[raw] || raw || "CASH";
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

const isCashierUser = (user = {}) => ["cashier", "pos cashier", "pos_cashier", "pos-cashier"].includes(getUserRole(user));

const canEditInvoices = (user = {}) => isCashierUser(user) || hasPermission("orders.edit", user) || hasPermission("pos.edit", user) || isManagerUser(user);

const canDeleteInvoices = (user = {}) => isCashierUser(user) || hasPermission("orders.delete", user) || isManagerUser(user);

const canEditOldInvoices = (user = {}) => isCashierUser(user) || isManagerUser(user) || hasPermission("pos.edit_old", user) || hasPermission("orders.approve", user);

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

const getItemImage = (item = {}) =>
  resolveInvoiceItemImageUrl(item, "");

const getItemVariantInfo = (item = {}) => {
  const colorSize = [item.color, item.size].filter(Boolean).join(" / ");
  return colorSize || item.variant_name || item.variant?.name || "";
};

const returnReasons = ["مقاس غير مناسب", "عيب صناعة", "تغيير رأي العميل", "استبدال", "أخرى"];

const returnModes = [
  { key: "full", label: "مرتجع كامل" },
  { key: "partial", label: "مرتجع جزئي" },
  { key: "exchange", label: "استبدال" },
];

const refundMethods = [
  { key: "cash", label: "نقدي" },
  { key: "vodafone_cash", label: "Vodafone Cash" },
  { key: "instapay", label: "InstaPay" },
];

const RECENT_ORDERS_PAGE_SIZE = 10;
const ORDER_SUMMARY_CACHE_TTL_MS = 45_000;
const orderSummaryCache = new Map();
const orderSummaryRequests = new Map();

const primeOrderImages = (order = {}) => {
  if (typeof window === "undefined" || typeof window.Image !== "function") return;
  const urls = new Set((order.items || []).map((item) => getItemImage(item)).filter(Boolean));
  urls.forEach((url) => {
    const image = new window.Image();
    image.decoding = "async";
    image.src = url;
  });
};

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

function RecentOperationsDrawer({ open, openedAt = 0, requestedInvoiceNumber = "", onClose, onEditOrder, onExchangeStarted, onPrintOrder, currentCartTotal = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [scannedInvoiceLookup, setScannedInvoiceLookup] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [returnOrder, setReturnOrder] = useState(null);
  const [permanentDeleteOrder, setPermanentDeleteOrder] = useState(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState("");
  const [loadingActions, setLoadingActions] = useState({});
  const requestSeqRef = useRef(0);
  const ordersLengthRef = useRef(0);
  const initialRenderLoggedRef = useRef(false);
  const pendingRenderStartedAtRef = useRef(0);
  const drawerOpenedAtRef = useRef(0);
  const autoOpenedInvoiceRef = useRef("");
  const currentUser = useMemo(() => getCurrentUser() || { name: "أدمن", role: "admin", permissions: ["*"] }, []);
  const editLockHours = useMemo(() => readEditLockHours(), []);

  useEffect(() => {
    ordersLengthRef.current = orders.length;
  }, [orders.length]);

  const runOrderAction = useCallback(async (order, action, task) => {
    const key = getOrderActionKey(order, action);
    setLoadingActions((current) => ({ ...current, [key]: true }));
    try {
      return await task();
    } finally {
      setLoadingActions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }, []);

  const loadOrderSummary = useCallback(async (order, { force = false } = {}) => {
    if (!order?.id) return order;
    const cacheKey = String(order.id);
    const cached = orderSummaryCache.get(cacheKey);
    if (!force && cached?.expiresAt > Date.now()) {
      return { ...order, ...cached.order };
    }
    if (!force && orderSummaryRequests.has(cacheKey)) {
      const pendingOrder = await orderSummaryRequests.get(cacheKey);
      return { ...order, ...pendingOrder };
    }

    const request = api.get(`/orders/${order.id}/pos-summary`, { timeoutMs: 10000 }).then((response) => {
      const loadedOrder = response.order || order;
      const loadedItems = Array.isArray(response.items) ? response.items : loadedOrder.items || order.items || [];
      const timeline = Array.isArray(response.audit_timeline) ? response.audit_timeline : loadedOrder.audit_timeline;
      const summary = { ...order, ...loadedOrder, items: loadedItems, audit_timeline: timeline || [] };
      orderSummaryCache.set(cacheKey, { order: summary, expiresAt: Date.now() + ORDER_SUMMARY_CACHE_TTL_MS });
      primeOrderImages(summary);
      return summary;
    });
    orderSummaryRequests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (orderSummaryRequests.get(cacheKey) === request) orderSummaryRequests.delete(cacheKey);
    }
  }, []);

  const prefetchOrderSummary = useCallback((order) => {
    if (!order?.id) return;
    void loadOrderSummary(order).catch(() => {});
  }, [loadOrderSummary]);

  const loadOrders = useCallback(async ({ reset = false } = {}) => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    const fetchStartedAt = performance.now();
    const offset = reset ? 0 : ordersLengthRef.current;
    try {
      if (reset) {
        setLoading(true);
        setHasMore(false);
        setTotalCount(null);
      } else setLoadingMore(true);
      setError("");
      const response = await api.get("/orders", {
        params: {
          mode: "pos_recent",
          limit: RECENT_ORDERS_PAGE_SIZE,
          offset,
          search: debouncedSearch,
        },
        timeoutMs: 10000,
      });
      if (seq !== requestSeqRef.current) return;
      const nextOrders = Array.isArray(response.data) ? response.data : Array.isArray(response.orders) ? response.orders : [];
      const pagination = response.pagination || {};
      const nextTotal = Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : null;
      pendingRenderStartedAtRef.current = performance.now();
      setOrders((current) => (reset ? nextOrders : [...current, ...nextOrders]));
      setTotalCount(nextTotal);
      setHasMore(Boolean(pagination.has_more ?? (nextOrders.length === RECENT_ORDERS_PAGE_SIZE)));
      if (POS_DEBUG) {
        console.log("[pos-recent-operations-timing]", {
          recent_orders_fetch_ms: Math.round(performance.now() - fetchStartedAt),
          limit: RECENT_ORDERS_PAGE_SIZE,
          offset,
          search: debouncedSearch || "",
          count: nextOrders.length,
        });
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error("[RecentOperationsDrawer] load failed:", err?.response?.data || err?.responseBody || err);
      setError("تعذر تحميل العمليات الأخيرة");
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const invoiceNumber = String(requestedInvoiceNumber || "").trim();
    if (!invoiceNumber) return;
    autoOpenedInvoiceRef.current = "";
    setSearch(invoiceNumber);
    setScannedInvoiceLookup(invoiceNumber);
    setDebouncedSearch(invoiceNumber);
  }, [open, requestedInvoiceNumber]);

  useEffect(() => {
    if (!open) {
      requestSeqRef.current += 1;
      setOrders([]);
      setLoading(false);
      setLoadingMore(false);
      setError("");
      setHasMore(false);
      setTotalCount(null);
      initialRenderLoggedRef.current = false;
      pendingRenderStartedAtRef.current = 0;
      return undefined;
    }
    drawerOpenedAtRef.current = Number(openedAt || performance.now());
    if (POS_DEBUG) {
      window.requestAnimationFrame(() => {
        console.log("[pos-recent-operations-timing]", {
          drawer_open_ms: Math.round(performance.now() - drawerOpenedAtRef.current),
        });
      });
    }
    setLoading(true);
    return undefined;
  }, [open, openedAt]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      void loadOrders({ reset: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [debouncedSearch, loadOrders, open]);

  useEffect(() => {
    if (!open || loading || !orders.length) return undefined;
    const warmRecentOrders = () => {
      orders.slice(0, 2).forEach(prefetchOrderSummary);
    };
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(warmRecentOrders, { timeout: 800 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timer = window.setTimeout(warmRecentOrders, 120);
    return () => window.clearTimeout(timer);
  }, [loading, open, orders, prefetchOrderSummary]);

  useEffect(() => {
    if (!open || !pendingRenderStartedAtRef.current) return undefined;
    const renderStartedAt = pendingRenderStartedAtRef.current;
    pendingRenderStartedAtRef.current = 0;
    const frame = window.requestAnimationFrame(() => {
      if (!POS_DEBUG) return;
      const payload = {
        render_ms: Math.round(performance.now() - renderStartedAt),
      };
      if (!initialRenderLoggedRef.current) {
        initialRenderLoggedRef.current = true;
        payload.total_ms = Math.round(performance.now() - drawerOpenedAtRef.current);
      }
      console.log("[pos-recent-operations-timing]", payload);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, orders]);

  const filteredOrders = orders;

  useEffect(() => {
    const invoiceLookup = requestedInvoiceNumber || scannedInvoiceLookup;
    if (!open || !invoiceLookup || loading || !orders.length) return;
    const requested = String(invoiceLookup).trim().toLowerCase();
    if (!requested || autoOpenedInvoiceRef.current === requested) return;
    const requestedDigits = requested.replace(/\D/g, "").replace(/^0+/, "");
    const matchedOrder = orders.find((order) => {
      const invoiceNumber = getOrderInvoiceNumber(order).trim().toLowerCase();
      const invoiceDigits = invoiceNumber.replace(/\D/g, "").replace(/^0+/, "");
      return invoiceNumber === requested || (requestedDigits && invoiceDigits === requestedDigits);
    });
    if (!matchedOrder) return;
    autoOpenedInvoiceRef.current = requested;
    void loadOrderSummary(matchedOrder)
      .then((loadedOrder) => setSelectedOrder(loadedOrder))
      .catch((error) => {
        autoOpenedInvoiceRef.current = "";
        toast.error(error.message || "تعذر فتح الفاتورة المقروءة");
      });
  }, [loadOrderSummary, loading, open, orders, requestedInvoiceNumber, scannedInvoiceLookup]);

  const handleSearchChange = (event) => {
    const value = String(event.target.value || "");
    const barcodeMatch = value.trim().match(/^9919(\d{12})$/);
    if (barcodeMatch) {
      const invoiceLookup = String(Number(barcodeMatch[1] || 0));
      setScannedInvoiceLookup(invoiceLookup);
      setSearch(invoiceLookup);
      setDebouncedSearch(invoiceLookup);
      return;
    }
    setScannedInvoiceLookup("");
    setSearch(value);
  };

  const handleReprint = async (order) => {
    await runOrderAction(order, "print", async () => {
      try {
        const loadedOrder = await loadOrderSummary(order);
        await onPrintOrder?.(loadedOrder);
        void api.post(`/orders/${order.id}/reprint-log`, {}).catch((error) => {
          console.warn("[RecentOperationsDrawer] reprint log failed", error);
        });
        toast.success("تم تجهيز الفاتورة للطباعة مرة أخرى");
      } catch (err) {
        toast.error(err.message || "تعذر إعادة الطباعة");
      }
    });
  };

  const handleViewDetails = async (order) => {
    if (!order?.id) {
      setSelectedOrder(order);
      return;
    }
    await runOrderAction(order, "details", async () => {
      try {
      const loadedOrder = await loadOrderSummary(order);
      console.log("[pos][seller-debug] seller returned from invoice details API", {
        order_id: order.id,
        seller_id: loadedOrder.seller_id || loadedOrder.sales_employee_id || loadedOrder.salesperson_id || loadedOrder.assigned_seller_id || null,
        seller_name: loadedOrder.seller_name,
        sales_employee_name: loadedOrder.sales_employee_name,
        salesperson_name: loadedOrder.salesperson_name,
        assigned_seller_name: loadedOrder.assigned_seller_name,
        cashier_name: loadedOrder.cashier_name,
      });
      setSelectedOrder(loadedOrder);
      } catch (err) {
        toast.error(err.message || "تعذر تحميل تفاصيل الفاتورة");
        setSelectedOrder(order);
      }
    });
  };

  const handleEditClick = async (order) => {
    const lock = getInvoiceLock(order, currentUser, editLockHours);
    if (lock.locked) {
      toast.error(lock.reason);
      return;
    }
    const startedAt = performance.now();
    if (POS_DEBUG) {
      console.log("[pos-edit-drawer] click start", {
        order_id: order?.id || null,
        invoice_number: getOrderInvoiceNumber(order),
      });
    }
    await runOrderAction(order, "edit", async () => {
      await Promise.resolve(onEditOrder(order));
    });
    if (POS_DEBUG) {
      console.log("[pos-edit-drawer] total", {
        order_id: order?.id || null,
        invoice_number: getOrderInvoiceNumber(order),
        total_ms: Math.round(performance.now() - startedAt),
      });
    }
  };

  const handleReturn = async (order) => {
    if (!canReturnOrder(order)) {
      toast.error("لا يمكن عمل مرتجع لهذه الفاتورة");
      return;
    }
    await runOrderAction(order, "return", async () => {
      try {
      setReturnOrder(await loadOrderSummary(order));
      } catch (err) {
        toast.error(err.message || "تعذر تحميل الفاتورة للمرتجع");
      }
    });
  };

  const openPermanentDelete = (order) => {
    setPermanentDeleteOrder(order);
    setPermanentDeleteConfirm("");
  };

  const handlePermanentDelete = async () => {
    if (!permanentDeleteOrder?.id) return;
    const confirmation = permanentDeleteConfirm.trim();
    if (confirmation !== "DELETE" && confirmation !== "حذف") {
      toast.error("اكتب DELETE أو حذف للتأكيد");
      return;
    }
    await runOrderAction(permanentDeleteOrder, "permanent-delete", async () => {
      try {
        await api.delete(`/orders/${permanentDeleteOrder.id}/permanent`, { body: { confirmation } });
        orderSummaryCache.delete(String(permanentDeleteOrder.id));
        setOrders((current) => current.filter((order) => String(order.id) !== String(permanentDeleteOrder.id)));
        setSelectedOrder((current) => (String(current?.id) === String(permanentDeleteOrder.id) ? null : current));
        setReturnOrder((current) => (String(current?.id) === String(permanentDeleteOrder.id) ? null : current));
        setPermanentDeleteOrder(null);
        setPermanentDeleteConfirm("");
        toast.success("تم حذف الفاتورة نهائيًا");
      } catch (err) {
        toast.error(err.responseBody?.message || err.message || "تعذر حذف الفاتورة نهائيًا");
      }
    });
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
    await loadOrders({ reset: true });
  };

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    document.documentElement.classList.add("pos-recent-operations-open");
    document.body.classList.add("pos-recent-operations-open");
    return () => {
      document.documentElement.classList.remove("pos-recent-operations-open");
      document.body.classList.remove("pos-recent-operations-open");
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="pos-recent-operations-overlay fixed inset-0 z-[2147483000] isolate h-[100dvh] w-screen overflow-hidden bg-black/70 backdrop-blur-sm" dir="rtl">
      <button type="button" className="absolute inset-0 z-0 h-full w-full cursor-default" onClick={onClose} aria-label="إغلاق" />
      <aside
        aria-label="العمليات الأخيرة"
        className="pos-recent-operations-drawer absolute inset-y-0 right-0 z-10 flex h-[100dvh] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden border-l border-white/10 bg-zinc-950/95 text-white shadow-2xl shadow-black/60 sm:w-[min(42rem,92vw)] sm:rounded-l-[2rem]"
      >
        <div className="shrink-0 border-b border-white/10 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-200">POS</div>
              <h2 className="mt-1 text-2xl font-black">العمليات الأخيرة</h2>
              <p className="mt-1 text-sm text-zinc-400">عرض، إعادة طباعة، تعديل، أو مرتجع الفواتير الأخيرة.</p>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={search}
                onChange={handleSearchChange}
                placeholder="بحث برقم الفاتورة أو العميل أو الهاتف"
                className="h-[var(--control-height-lg)] w-full rounded-2xl border border-white/10 bg-black/40 pr-11 pl-4 text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
              />
            </div>
            <button type="button" onClick={() => loadOrders({ reset: true })} className="inline-flex h-[var(--control-height-lg)] w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]" title="تحديث">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-3 sm:p-4">
          {loading && orders.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
              ))}
            </div>
          ) : error ? (
            <State icon={AlertTriangle} title="حدث خطأ" text={error} actionLabel="إعادة المحاولة" onAction={() => loadOrders({ reset: true })} />
          ) : filteredOrders.length === 0 ? (
            <State icon={RotateCcw} title="لا توجد عمليات" text={debouncedSearch ? "لا توجد نتائج مطابقة للبحث." : "ستظهر آخر فواتير POS هنا بعد البيع."} />
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  loadingActions={loadingActions}
                  currentUser={currentUser}
                  editLockHours={editLockHours}
                  onReprint={handleReprint}
                  onViewDetails={handleViewDetails}
                  onEdit={handleEditClick}
                  onReturn={handleReturn}
                  onPermanentDelete={openPermanentDelete}
                  onPrefetch={prefetchOrderSummary}
                />
              ))}
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => loadOrders({ reset: false })}
                  disabled={loadingMore}
                  className="flex h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-sm font-black text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {loadingMore ? "جار التحميل..." : "تحميل المزيد"}
                </button>
              ) : totalCount !== null ? (
                <div className="py-2 text-center text-xs font-bold text-zinc-500">تم عرض {orders.length} من {totalCount}</div>
              ) : null}
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

      {permanentDeleteOrder ? (
        <PermanentDeleteModal
          order={permanentDeleteOrder}
          value={permanentDeleteConfirm}
          loading={Boolean(loadingActions[getOrderActionKey(permanentDeleteOrder, "permanent-delete")])}
          onChange={setPermanentDeleteConfirm}
          onClose={() => {
            setPermanentDeleteOrder(null);
            setPermanentDeleteConfirm("");
          }}
          onConfirm={handlePermanentDelete}
        />
      ) : null}
    </div>,
    document.body
  );
}

function OrderCard({ order, loadingActions, currentUser, editLockHours, onReprint, onViewDetails, onEdit, onReturn, onPermanentDelete, onPrefetch }) {
  const lock = getInvoiceLock(order, currentUser, editLockHours);
  const badges = getStatusBadges(order);
  const isActionLoading = (action) => Boolean(loadingActions[getOrderActionKey(order, action)]);
  const detailsLoading = isActionLoading("details");
  const printLoading = isActionLoading("print");
  const returnLoading = isActionLoading("return");
  const editLoading = isActionLoading("edit");
  const deleteLoading = isActionLoading("permanent-delete");
  const statusBadge = badges[0] || { label: getOrderStatus(order), className: "border-white/10 bg-white/[0.04] text-zinc-200" };
  const isRtl = typeof document !== "undefined" && document.documentElement?.dir === "rtl";
  const labels = {
    payment: isRtl ? "الدفع" : "Payment",
    seller: isRtl ? "البائع" : "Seller",
    date: isRtl ? "التاريخ" : "Date",
  };

  return (
    <article
      className="relative rounded-xl border border-white/10 bg-white/[0.04] p-2"
      onPointerEnter={() => onPrefetch?.(order)}
      onFocusCapture={() => onPrefetch?.(order)}
    >
                  <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)_auto_auto] items-center gap-1.5">
                    <div className="min-w-0">
                      <div className="max-w-[8.5rem] truncate text-xs font-extrabold leading-4 text-white sm:text-sm" title={getOrderInvoiceNumber(order)}>
                        {getOrderInvoiceNumber(order)}
                      </div>
                    </div>
                    <div className="min-w-0 truncate text-[11px] font-semibold leading-4 text-zinc-300" dir="auto" title={getOrderCustomer(order)}>
                      {getOrderCustomer(order)}
                    </div>
                    <div className="shrink-0 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[11px] font-black text-emerald-100">
                      <CurrencyText value={formatDrawerCurrency(getOrderTotal(order))} />
                    </div>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-black ${statusBadge.className}`}>
                      {statusBadge.label}
                    </span>
                  </div>

                  <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-zinc-400">
                    <Info label={labels.payment} value={getPaymentMethod(order)} />
                    <Info label={labels.seller} value={getOrderSeller(order)} />
                    <Info label={labels.date} value={formatDateTime(order.created_at)} />
                  </div>

                  {lock.locked ? (
                    <div className="mt-1.5 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-100">
                      {lock.reason}
                    </div>
                  ) : null}

                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <Action icon={Eye} label="تفاصيل" loading={detailsLoading} disabled={detailsLoading} onClick={() => onViewDetails(order)} />
                    <Action icon={Printer} label="طباعة" loading={printLoading} disabled={printLoading} onClick={() => onReprint(order)} />
                    <Action icon={RotateCcw} label="مرتجع" loading={returnLoading} disabled={!canReturnOrder(order) || returnLoading || isCashierUser(currentUser)} onClick={() => onReturn(order)} />
                    <Action icon={Pencil} label="تعديل" loading={editLoading} disabled={lock.locked || editLoading} title={lock.reason} onClick={() => onEdit(order)} />
                    <span className="mx-0.5 h-5 w-px bg-white/10" />
                    <Action icon={Trash2} label="حذف نهائي" loading={deleteLoading} disabled={deleteLoading || !canDeleteInvoices(currentUser)} danger onClick={() => onPermanentDelete(order)} />
                  </div>
    </article>
  );
}

function PermanentDeleteModal({ order, value, loading, onChange, onClose, onConfirm }) {
  const canConfirm = value.trim() === "DELETE" || value.trim() === "حذف";
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 px-3 py-4 sm:items-center" dir="rtl">
      <div className="w-full max-w-md rounded-3xl border border-rose-400/35 bg-zinc-950 p-5 text-white shadow-2xl shadow-rose-950/20">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-rose-500/15 p-2 text-rose-200"><Trash2 className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h3 className="text-lg font-black">حذف نهائي</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-rose-100">سيتم حذف الفاتورة نهائيًا ولا يمكن التراجع عن هذه العملية.</p>
            <p className="mt-1 text-sm leading-6 text-zinc-300">سيتم حذف السجلات المرتبطة واسترجاع المخزون إذا لم يكن مسترجعًا مسبقًا.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Info label="الفاتورة" value={getOrderInvoiceNumber(order)} />
          <Info label="الإجمالي" value={formatDrawerCurrency(getOrderTotal(order))} />
        </div>
        <label className="mt-4 block">
          <div className="mb-1.5 text-xs font-black text-rose-100">اكتب DELETE أو حذف للتأكيد</div>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
            placeholder="DELETE"
            className="w-full rounded-2xl border border-rose-400/30 bg-black/35 px-3 py-2.5 text-sm font-black text-white outline-none placeholder:text-zinc-600 focus:border-rose-300"
          />
        </label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={loading} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-black text-white disabled:opacity-60">إلغاء</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || loading}
            className={`rounded-2xl px-4 py-2 text-sm font-black text-white ${canConfirm && !loading ? "bg-rose-600 hover:bg-rose-500" : "cursor-not-allowed bg-rose-500/35 opacity-55"}`}
          >
            {loading ? "جار الحذف..." : "حذف نهائي"}
          </button>
        </div>
      </div>
    </div>
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
      toast.success(mode === "exchange" ? "تم إنشاء استبدال" : "تم إنشاء مرتجع");
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
                className={`h-[var(--control-height-lg)] rounded-2xl border px-3 text-sm font-black ${
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
                  className={`h-[var(--control-height-md)] rounded-2xl border px-3 text-xs font-black ${
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
                className="mt-3 h-[var(--control-height-lg)] w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
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
                  className={`h-[var(--control-height-md)] rounded-2xl border px-3 text-xs font-black ${
                    refundMethod === item.key ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-50" : "border-white/10 bg-black/20 text-zinc-300"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="bg-white/[0.06] px-3 py-2 text-sm font-black text-zinc-200">اختيار المنتجات المراد إرجاعها</div>
            <div className="divide-y divide-white/10">
              {lines.map(({ item, max, selected }) => (
                <div key={item.id} className="grid gap-3 p-3 sm:grid-cols-[56px_minmax(0,1fr)_150px] sm:items-center">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                    <img
                      src={getItemImage(item) || DEFAULT_PRODUCT_PLACEHOLDER}
                      alt={getItemName(item)}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_PRODUCT_PLACEHOLDER;
                      }}
                    />
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
                      className="mt-1 h-[var(--control-height-lg)] w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-center text-sm font-black text-white outline-none disabled:opacity-40"
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
          <button type="button" onClick={onClose} className="h-[var(--control-height-lg)] flex-1 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-white">
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex h-[var(--control-height-lg)] flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-400 text-sm font-black text-zinc-950 disabled:opacity-50"
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
      <div className="mt-1 text-lg font-black"><CurrencyText value={value} /></div>
    </div>
  );
}

function DetailsModal({ order, onClose }) {
  const timeline = buildAuditTimeline(order);
  const isRtl = typeof document !== "undefined" && document.documentElement?.dir === "rtl";
  const labels = {
    customer: isRtl ? "العميل" : "Customer",
    seller: isRtl ? "البائع" : "Seller",
    payment: isRtl ? "الدفع" : "Payment",
    date: isRtl ? "التاريخ" : "Date",
  };

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
              <div className="mb-4 grid gap-2 sm:grid-cols-4">
                <Info label={labels.customer} value={getOrderCustomer(order)} />
                <Info label={labels.seller} value={getOrderSeller(order)} />
                <Info label={labels.payment} value={getPaymentMethod(order)} />
                <Info label={labels.date} value={formatDateTime(order.created_at)} />
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[minmax(0,2.1fr)_0.65fr_0.85fr_0.95fr] gap-2 bg-white/[0.06] px-3 py-2 text-xs font-bold text-zinc-400">
                  <div>المنتج</div>
                  <div className="text-center">الكمية</div>
                  <div className="text-left">السعر</div>
                  <div className="text-left">الإجمالي الفرعي</div>
                </div>
                {(order.items || []).length > 0 ? (
                  (order.items || []).map((item, index) => {
                    const variantInfo = getItemVariantInfo(item);
                    return (
                    <div key={item.id || index} className="grid grid-cols-[minmax(0,2.1fr)_0.65fr_0.85fr_0.95fr] items-center gap-2 border-t border-white/10 px-3 py-3 text-sm">
                      <div className="flex min-w-0 items-center gap-3">
                        <InvoiceItemThumbnail item={item} />
                        <div className="min-w-0">
                          <div className="truncate font-black text-white" title={getItemName(item)}>{getItemName(item)}</div>
                          {variantInfo ? (
                            <div className="mt-1 truncate text-xs font-semibold text-zinc-500" title={variantInfo}>{variantInfo}</div>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-center font-black text-zinc-100">{getItemQuantity(item)}</div>
                      <div className="text-left font-black text-zinc-100"><CurrencyText value={formatDrawerCurrency(getItemPrice(item))} /></div>
                      <div className="text-left font-black text-zinc-100"><CurrencyText value={formatDrawerCurrency(getItemSubtotal(item))} /></div>
                    </div>
                    );
                  })
                ) : (
                  <div className="border-t border-white/10 px-3 py-6 text-center text-sm font-semibold text-zinc-400">لا توجد منتجات في هذه الفاتورة</div>
                )}
              </div>
              <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-emerald-100/70">الإجمالي</span>
                  <span className="text-lg font-black text-emerald-50"><CurrencyText value={formatDrawerCurrency(getOrderTotal(order))} /></span>
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

function InvoiceItemThumbnail({ item }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = getItemImage(item);
  const showImage = imageUrl && !failed;

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
      <img
        src={showImage ? imageUrl : DEFAULT_PRODUCT_PLACEHOLDER}
        alt={getItemName(item)}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(e) => {
          setFailed(true);
          e.currentTarget.src = DEFAULT_PRODUCT_PLACEHOLDER;
        }}
      />
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-1.5 py-1">
      <div className="truncate text-[8px] font-black text-zinc-500">{label}</div>
      <div className="truncate text-[10px] font-black text-zinc-100" dir="auto"><CurrencyText value={value} /></div>
    </div>
  );
}

function Action({ icon: Icon, label, onClick, disabled, loading = false, danger = false, className = "", title = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-[var(--control-height-sm)] items-center justify-center gap-1 rounded-lg border px-2 text-[10px] font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${className} ${
        danger
          ? "border-rose-400/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
          : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
      }`}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

function State({ icon: Icon, title, text, actionLabel = "", onAction }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-6 text-center">
      <Icon className="mx-auto h-10 w-10 text-zinc-500" />
      <h3 className="mt-3 text-lg font-black text-white">{title}</h3>
      <p className="mt-2 text-sm text-zinc-400">{text}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="mt-4 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-black text-white">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export default RecentOperationsDrawer;

