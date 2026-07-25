import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Copy,
  CreditCard,
  DollarSign,
  Download,
  Eye,
  FileText,
  MapPin,
  MessageCircle,
  MoreVertical,
  PackageOpen,
  Pencil,
  Phone,
  Printer,
  RotateCcw,
  Search,
  SplitSquareHorizontal,
  Trash2,
  Truck,
  User,
  Wallet,
  X,
} from "lucide-react";

import toast from "react-hot-toast";
import { socket } from "../../../socket";
import { api } from "../../../shared/api/api";
import useDismissableLayer from "../../../shared/hooks/useDismissableLayer";
import OrdersShell from "../components/OrdersShell";
import StatusBadge from "../components/StatusBadge";
import { CurrencyText } from "../../../shared/components/CurrencyAmount";
import {
  buildSearchText,
  formatCurrency,
  formatDateTime,
  getReturnedOrders,
  isReturnedOrRefundedOrder,
  mockOrders,
  normalizeOrder,
} from "../lib/ordersStore";
import {
  formatShippingPaymentMethodLabel,
  getShippingProofRawValue,
  isInvalidShippingProofUrl,
  resolveProductImageUrl,
  resolveShippingProofImageUrl,
} from "../../../shared/lib/imageUrls";
import { normalizeOrderLifecycleStatus } from "../../../../shared/orderStatus.js";

const PAGE_SIZE = 10;
const ORDERS_DEBUG = String(import.meta.env.VITE_ERP_PERF_DEBUG || "").trim().toLowerCase() === "true";
const SOURCE_FILTERS = ["all", "pos", "website", "whatsapp", "instagram", "manual"];
const WORKSPACES = [
  { key: "table", labelKey: "orders.workspaces.table", icon: ClipboardList },
  { key: "verification", labelKey: "orders.workspaces.verification", icon: CreditCard },
  { key: "fulfillment", labelKey: "orders.workspaces.fulfillment", icon: Truck },
  { key: "returns", labelKey: "orders.workspaces.returns", icon: RotateCcw },
];

const SOURCE_LABELS = {
  pos: "orders.sources.pos",
  website: "orders.sources.website",
  whatsapp: "orders.sources.whatsapp",
  instagram: "orders.sources.instagram",
  manual: "orders.sources.manual",
};

const uniqueValues = (items) => Array.from(new Set(items.filter(Boolean)));
const text = (value = "") => String(value ?? "").trim();
const tt = (t, key, fallback, options) => {
  const value = t(key, options);
  return value === key ? fallback : value;
};
const lower = (value = "") => text(value).toLowerCase();
const orderCode = (order = {}) => order.public_order_number || order.display_order_number || order.invoice_number || `#${order.id}`;
const publicInvoiceCode = (order = {}) => text(order.invoice_number || order.public_order_number || order.display_order_number || order.public_token || order.id);
const absoluteShareUrl = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (typeof window === "undefined") return raw;
  return new URL(raw.startsWith("/") ? raw : `/${raw}`, window.location.origin).toString();
};
const publicInvoiceUrl = (order = {}) => {
  const existing = absoluteShareUrl(order.public_invoice_url || order.invoice_public_url || order.public_invoice_short_url || order.short_invoice_url);
  if (existing) return existing;
  const code = publicInvoiceCode(order);
  if (!code) return "";
  return absoluteShareUrl(`/invoice/${encodeURIComponent(code)}`);
};
const copyText = async (value = "") => {
  const textValue = String(value || "");
  if (!textValue) throw new Error("Nothing to copy");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(textValue);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = textValue;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
};
const getOrderSource = (order = {}) => lower(order.source || order.channel);
const totalValue = (order = {}) => Number(order.total ?? order.total_amount ?? order.grand_total ?? order.final_total ?? order.total_price ?? 0);
const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const resolveOrderItemUnitPrice = (item = {}) => {
  const candidates = [
    item.unit_price,
    item.unitPrice,
    item.price,
    item.sale_price,
    item.salePrice,
    item.selling_price,
    item.sellingPrice,
    item.product_price,
    item.productPrice,
    item.variant_price,
    item.variantPrice,
    item.line_unit_price,
    item.lineUnitPrice,
  ];

  const numbers = candidates
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => Number(v))
    .filter((number) => Number.isFinite(number));
  return numbers.find((number) => number > 0) ?? numbers[0] ?? 0;
};

const resolveOrderItemLineTotal = (item = {}) => {
  const candidates = [
    item.line_total,
    item.lineTotal,
    item.total,
    item.subtotal,
    item.item_total,
    item.itemTotal,
    item.total_amount,
    item.totalAmount,
  ];

  const value = candidates.find((v) => v !== null && v !== undefined && v !== "");
  const number = Number(value);

  if (Number.isFinite(number) && number > 0) return number;

  const qty = Number(item.quantity || item.qty || 1);
  return resolveOrderItemUnitPrice(item) * (Number.isFinite(qty) ? qty : 1);
};

const normalizePreviewOrderItem = (item = {}, order = {}) => {
  const rawQuantity = Number(item.quantity ?? item.qty ?? 1);
  const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  const rawImage = item.image_url || item.image || item.thumbnail || item.thumbnail_url || item.product_image || item.product_image_url || (Array.isArray(item.images) ? item.images[0] : "");
  const orderItems = Array.isArray(order.items) ? order.items : [];
  const orderTotal = firstPositiveNumber(order.total_amount, order.total, order.total_price, order.subtotal);
  const resolvedSubtotal = resolveOrderItemLineTotal(item);
  const fallbackSubtotal = !resolvedSubtotal && orderItems.length === 1 && orderTotal > 0 ? orderTotal : 0;
  const subtotal = resolvedSubtotal || fallbackSubtotal;
  const unitPrice = resolveOrderItemUnitPrice(item) || (subtotal && quantity ? subtotal / quantity : 0);
  return {
    ...item,
    quantity,
    unitPrice,
    subtotal: subtotal || unitPrice * quantity,
    imageUrl: rawImage ? resolveProductImageUrl(rawImage) : "",
  };
};
const paymentStatusOf = (order = {}) => lower(order.payment_status || order.paymentStatus);
const paymentMethodOf = (order = {}) => lower(order.payment_method || order.paymentMethod);
const paidAmountOf = (order = {}) => Number(order.paid_amount ?? order.paidAmount ?? 0);
const isExchangeOrder = (order = {}) => Boolean(order.exchange_mode || order.exchangeMode || Number(order.exchange_credit_amount ?? order.exchangeCreditAmount ?? 0) > 0);
const exchangeCreditOf = (order = {}) => Number(order.exchange_credit_amount ?? order.exchangeCreditAmount ?? 0) || 0;
const amountDueNowOf = (order = {}) => Number(order.amount_due_now ?? order.amountDueNow ?? order.paid_amount ?? order.paidAmount ?? 0) || 0;
const isEditedPaymentOrder = (order = {}) =>
  Number(order.edit_original_paid_amount ?? order.editOriginalPaidAmount ?? 0) > 0 ||
  Number(order.edit_additional_paid_amount ?? order.editAdditionalPaidAmount ?? 0) > 0 ||
  Number(order.edit_refund_or_credit_due ?? order.editRefundOrCreditDue ?? 0) > 0;
const editOriginalPaidOf = (order = {}) => Number(order.edit_original_paid_amount ?? order.editOriginalPaidAmount ?? 0) || 0;
const editAdditionalPaidOf = (order = {}) => Number(order.edit_additional_paid_amount ?? order.editAdditionalPaidAmount ?? 0) || 0;
const editRefundDueOf = (order = {}) => Number(order.edit_refund_or_credit_due ?? order.editRefundOrCreditDue ?? 0) || 0;
const shippingFeeOf = (order = {}) => Number(order.shipping_fee ?? order.delivery_fee ?? order.service_fee ?? 0);
const isPartialPaymentStatus = (value = "") => ["partially_paid", "partially paid", "partial"].includes(lower(value));
const isCodPaymentMethod = (order = {}) => ["cod", "cash_on_delivery", "cash on delivery"].includes(paymentMethodOf(order));
const hasApprovedShippingProof = (order = {}) =>
  lower(order.transfer_proof_status) === "approved" || Boolean(order.shipping_payment_verified_at);
const remainingCodAmount = (order = {}) => {
  const total = totalValue(order);
  if (!total) return 0;
  const paid = paidAmountOf(order);
  if (paid > 0 && paid < total) return Math.max(0, total - paid);
  const shipping = shippingFeeOf(order);
  if (shipping > 0 && shipping < total && hasApprovedShippingProof(order)) return Math.max(0, total - shipping);
  return 0;
};
const dueAmountOf = (order = {}) => {
  const explicit = [
    order.remaining_amount,
    order.remainingAmount,
    order.amount_due,
    order.amountDue,
    order.collect_on_delivery_amount,
    order.collectOnDeliveryAmount,
    order.cod_amount,
    order.codAmount,
  ]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value >= 0 && value > 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const total = totalValue(order);
  const paid = getPaidAmount(order);
  if (total > 0 && paid >= 0 && paid < total) return Number((total - paid).toFixed(2));
  return remainingCodAmount(order);
};
const isCodShippingPartial = (order = {}) =>
  isPartialPaymentStatus(order.payment_status || order.paymentStatus) ||
  (isCodPaymentMethod(order) && remainingCodAmount(order) > 0);
const paymentBadgeValue = (order = {}) =>
  isCodShippingPartial(order) ? "مدفوع جزئياً" : order.paymentStatus || order.payment_status || "غير مدفوع";
const firstValue = (...values) => values.map((value) => text(value)).find(Boolean) || "";
const numberValue = (...values) => {
  const value = values.find((item) => item !== null && item !== undefined && item !== "");
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};
const getCustomerPhone = (order = {}) => firstValue(order.customer_phone, order.phone, order.customer?.phone);
const getPaidAmount = (order = {}) => numberValue(order.paid_amount, order.amount_paid, order.payment_paid_amount, order.total_paid, 0);
const getItemsCount = (order = {}) => {
  const direct = numberValue(order.total_quantity, order.total_items, order.item_count);
  if (direct > 0) return direct;
  return (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => sum + Number(item.quantity || item.qty || 0), 0);
};
const getSellerName = (order = {}) =>
  firstValue(order.sales_employee_name, order.seller_name, order.salesperson_name, order.assigned_seller_name);
const statusOf = (order = {}) => normalizeOrderLifecycleStatus(order.status, "pending");
const shippingStatusOf = (order = {}) => normalizeOrderLifecycleStatus(order.shipping_status || order.delivery_status, "pending");
const isDeliveredOrder = (order = {}) => statusOf(order) === "delivered" || shippingStatusOf(order) === "delivered";

const isAwaitingVerification = (order = {}) => {
  const status = statusOf(order);
  const paymentStatus = paymentStatusOf(order);
  const transferProofStatus = lower(order.transfer_proof_status);
  return paymentStatus === "awaiting_verification" || transferProofStatus === "pending";
};

const isCancelledOrder = (order = {}) => {
  const status = statusOf(order);
  const payment = paymentStatusOf(order);
  return Boolean(order.cancelled_at || order.deleted_at) ||
    ["cancelled", "cancelled_by_customer"].includes(status) ||
    ["rejected"].includes(payment);
};

const isClosedOrder = (order = {}) => isCancelledOrder(order) || isReturnedOrRefundedOrder(order);

const isFulfillmentOrder = (order = {}) => {
  if (isAwaitingVerification(order) || isClosedOrder(order)) return false;
  const status = statusOf(order);
  const shipping = shippingStatusOf(order);
  return ["confirmed", "ready_to_ship", "shipment_created", "out_for_delivery", "delivered"].includes(status) ||
    ["pending", "ready_to_ship", "shipment_created", "out_for_delivery", "delivered"].includes(shipping);
};

const isHighValue = (order = {}) => totalValue(order) >= 5000;

const isDelayedPending = (order = {}) => {
  const created = new Date(order.created_at || 0).getTime();
  if (!created) return false;
  const ageHours = (Date.now() - created) / 36e5;
  return ageHours >= 36 && ["pending", "awaiting_verification"].includes(statusOf(order));
};

const getDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getAttributionLabel = (order = {}) => {
  const source = lower(order.attribution_type || order.marketing_source);
  const platform = lower(order.marketing_platform || order.marketing_source);
  if (source.includes("instagram") && source.includes("story")) return "قصة إنستغرام";
  if (source.includes("story")) return "قصة";
  if (platform === "facebook" || source.includes("facebook")) return "منشور فيسبوك";
  if (platform === "instagram" || source.includes("instagram")) return "منشور إنستغرام";
  if (platform === "whatsapp" || source.includes("whatsapp")) return "حملة واتساب";
  if (platform === "tiktok" || source.includes("tiktok")) return "حملة تيك توك";
  if (order.marketing_campaign) return String(order.marketing_campaign);
  return "";
};

const isGuestCustomerName = (value = "") => /^guest[:#-]?\d*$/i.test(text(value)) || lower(value) === "guest";
const getCustomerDisplayName = (order = {}, fallback = "Customer") =>
  [order.customer_name, order.customer?.name, order.customer_full_name, order.customer_record_name, order.customer_phone]
    .map((value) => text(value))
    .find((value) => value && !isGuestCustomerName(value)) || fallback;
const getSellerDisplayName = (order = {}) =>
  getSellerName(order);

const isArabicLanguage = (language = "") => String(language || "").toLowerCase().startsWith("ar");
const localizedCopy = (language, ar, en) => (isArabicLanguage(language) ? ar : en);
const formatNumericOrderDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
};
const isShippingPartialDisplayStatus = (value = "") =>
  ["partially_paid_shipping", "shipping_paid", "partial_shipping"].includes(lower(value));
const getPosDisplay = (order = {}) =>
  firstValue(
    order.pos_name,
    order.posName,
    order.pos_alias,
    order.posAlias,
    order.cash_register_name,
    order.cashRegisterName,
    order.register_name,
    order.registerName,
    order.terminal_name,
    order.terminalName,
    order.channel,
    order.source
  );
const paymentStatusLabels = (language) => ({
  paid: localizedCopy(language, "\u0645\u062f\u0641\u0648\u0639", "Paid"),
  partially_paid: localizedCopy(language, "\u062c\u0632\u0626\u064a", "\u062c\u0632\u0626\u064a"),
  deferred: localizedCopy(language, "\u0622\u062c\u0644", "\u0622\u062c\u0644"),
});
const paymentMethodLabels = (language) => ({
  cash: localizedCopy(language, "\u0643\u0627\u0634", "Cash"),
  card: localizedCopy(language, "\u0641\u064a\u0632\u0627", "Visa"),
  wallet: localizedCopy(language, "\u0645\u062d\u0641\u0638\u0629", "Wallet"),
  instapay: "InstaPay",
  transfer: localizedCopy(language, "\u062a\u062d\u0648\u064a\u0644", "Transfer"),
  paymob: "Paymob",
  split: localizedCopy(language, "\u0645\u062a\u0639\u062f\u062f", "Split"),
  credit_sale: localizedCopy(language, "\u0622\u062c\u0644", "Credit sale"),
});
const refundMethodLabel = (value = "") => {
  const raw = lower(value);
  if (raw === "cash") return "نقدي";
  if (raw === "vodafone_cash") return "Vodafone Cash";
  if (raw === "instapay") return "InstaPay";
  return value || "-";
};
const paymentMethodIcon = {
  cash: Banknote,
  card: CreditCard,
  wallet: Wallet,
  instapay: Wallet,
  transfer: CreditCard,
  paymob: CreditCard,
  split: SplitSquareHorizontal,
  deferred: Clock3,
  credit_sale: Clock3,
};
const paymentMethodParts = (order = {}) => [
  { key: "cash", value: numberValue(order.cash_amount, order.cashAmount) },
  { key: "card", value: numberValue(order.card_amount, order.cardAmount) },
  { key: "wallet", value: numberValue(order.wallet_payment_amount, order.wallet_amount, order.walletAmount) },
].filter((item) => item.value > 0);
const normalizePaymentStatusKey = (order = {}) => {
  const raw = lower(order.payment_status || order.paymentStatus || order.status);
  const method = lower(order.payment_method || order.paymentMethod);
  const paid = getPaidAmount(order);
  const total = totalValue(order);
  if (["paid", "completed", "complete", "settled", "success", "succeeded"].includes(raw)) return "paid";
  if (isShippingPartialDisplayStatus(raw)) return "partially_paid";
  if (["partially_paid", "partially paid", "partial"].includes(raw) || (total > 0 && paid > 0 && paid < total)) return "partially_paid";
  if (
    ["pending", "unpaid", "awaiting_verification", "deferred", "credit", "on_credit", "postpaid", "refunded", "refund", "fully_refunded", "rejected", "cod"].includes(raw) ||
    ["deferred", "credit", "cod", "cash_on_delivery", "cash on delivery"].includes(method)
  ) return "deferred";
  return paid > 0 ? "paid" : "deferred";
};
const normalizeRawPaymentMethodKey = (value = "") => {
  const raw = lower(value);
  if (!raw) return "";
  if (["shipping", "shipping_confirmed", "shipping_paid"].includes(raw)) return "";
  if (["cod", "cash_on_delivery", "cash on delivery"].includes(raw)) return "";
  if (raw.includes("instapay")) return "instapay";
  if (raw.includes("paymob") || raw.includes("terminal")) return "paymob";
  if (raw.includes("transfer") || raw.includes("bank")) return "transfer";
  if (["visa", "card", "credit_card", "debit_card"].includes(raw)) return "card";
  if (["cash", "cash_payment"].includes(raw)) return "cash";
  if (["wallet", "customer_wallet"].includes(raw)) return "wallet";
  if (["split", "multiple", "mixed"].includes(raw)) return "split";
  return "";
};
const normalizePaymentMethodKey = (order = {}, options = {}) => {
  const { statusKey = normalizePaymentStatusKey(order), isShippingPartial = isShippingPartialDisplayStatus(order.payment_status || order.paymentStatus) } = options;
  if (statusKey === "deferred") return "";
  const parts = paymentMethodParts(order);
  if (parts.length > 1) return "split";
  if (parts[0]?.key) return parts[0].key;
  const candidates = isShippingPartial
    ? [
        order.shipping_payment_method,
        order.shippingPaymentMethod,
        order.payment_method,
        order.paymentMethod,
        order.payment_type,
        order.paymentType,
      ]
    : [
        order.payment_method,
        order.paymentMethod,
        order.payment_type,
        order.paymentType,
        order.shipping_payment_method,
        order.shippingPaymentMethod,
      ];
  for (const candidate of candidates) {
    const normalized = normalizeRawPaymentMethodKey(candidate);
    if (normalized) return normalized;
  }
  return "";
};
const getPaymentSummary = (order = {}, language = "en") => {
  const isShippingPartial = isShippingPartialDisplayStatus(order.payment_status || order.paymentStatus);
  const statusKey = normalizePaymentStatusKey(order);
  const methodKey = normalizePaymentMethodKey(order, { statusKey, isShippingPartial });
  const statuses = paymentStatusLabels(language);
  const methods = paymentMethodLabels(language);
  const parts = paymentMethodParts(order);
  const methodLabel = methodKey === "split" && parts.length
    ? parts.map((part) => methods[part.key]).join(" + ")
    : methods[methodKey] || "";
  const statusLabel = statuses[statusKey] || "\u0622\u062c\u0644";
  const label = methodLabel && statusKey !== "deferred"
    ? `${statusLabel} - ${methodLabel}`
    : statusLabel || "-";
  return {
    statusKey,
    methodKey: methodKey || statusKey,
    label,
  };
};
const PAYMENT_FILTER_OPTIONS = ["all", "paid", "due"];
const PAYMENT_FILTER_LABELS = {
  paid: "مدفوع",
  due: "مستحق الدفع",
};
const STATUS_FILTER_OPTIONS = ["all", "pending_confirmation", "confirmed", "edit_requested", "cancelled_by_customer"];
const STATUS_FILTER_LABELS = {
  pending_confirmation: "بانتظار التأكيد",
  confirmed: "تم التأكيد من العميل",
  edit_requested: "العميل طلب تعديل",
  cancelled_by_customer: "ألغاه العميل",
};
const matchesPaymentFilter = (order = {}, paymentFilter = "all") => {
  if (paymentFilter === "all") return true;
  const statusKey = normalizePaymentStatusKey(order);
  const due = dueAmountOf(order);
  if (paymentFilter === "paid") {
    return statusKey === "paid" && due <= 0;
  }
  if (paymentFilter === "due") {
    return due > 0 || statusKey !== "paid";
  }
  return true;
};
const matchesStatusFilter = (order = {}, statusFilter = "all") => {
  if (statusFilter === "all") return true;
  return statusOf(order) === statusFilter;
};
const isCriticalOrder = (order = {}) => {
  const combined = [order.risk_level, order.risk_status, order.status, order.payment_status, order.transfer_proof_status]
    .map(lower)
    .join(" ");
  return ["fraud", "dispute", "chargeback", "high_risk", "high risk"].some((term) => combined.includes(term));
};

const priorityFor = (order = {}) => {
  if (isCriticalOrder(order)) return { label: "حرج", className: "border-rose-400/35 bg-rose-400/10 shadow-rose-950/20" };
  if (statusOf(order) === "edit_requested") return { label: "تعديل مطلوب", className: "border-orange-400/35 bg-orange-400/10 shadow-orange-950/20" };
  if (isClosedOrder(order)) return { label: "مرتجع/ملغى", className: "border-white/10 bg-zinc-950/90 shadow-black/10" };
  if (isAwaitingVerification(order)) return { label: "مراجعة", className: "border-white/10 bg-zinc-950/90 shadow-black/10" };
  if (isDelayedPending(order)) return { label: "متأخر", className: "border-white/10 bg-zinc-950/90 shadow-black/10" };
  if (isHighValue(order)) return { label: "قيمة مرتفعة", className: "border-white/10 bg-zinc-950/90 shadow-black/10" };
  if (paymentStatusOf(order) === "cod") return { label: "COD", className: "border-white/10 bg-zinc-950/90 shadow-black/10" };
  return { label: "عادي", className: "border-white/10 bg-zinc-950/90 shadow-black/10" };
};

const CUSTOMER_CONFIRMATION_TIMELINE_META = {
  customer_confirmed_order: { label: "تم التأكيد من العميل", tone: "emerald" },
  customer_requested_edit: { label: "العميل طلب تعديل", tone: "orange" },
  customer_cancelled_order: { label: "ألغاه العميل", tone: "rose" },
};

const normalizeOrderTimeline = (order = {}) =>
  (Array.isArray(order.timeline) ? order.timeline : [])
    .map((item, index) => {
      const action = lower(item?.action || item?.event_type || item?.type);
      const meta = CUSTOMER_CONFIRMATION_TIMELINE_META[action] || {};
      const label = item?.label || meta.label || item?.note || item?.message || item?.title || action;
      return {
        key: `${action || "event"}-${index}`,
        label,
        at: item?.at || item?.created_at || item?.timestamp || order.updated_at || order.created_at || null,
        tone: item?.tone || meta.tone || "zinc",
        action,
      };
    })
    .filter((item) => Boolean(item.label));

const buildTimeline = (order = {}) => {
  const customTimeline = normalizeOrderTimeline(order);
  const customActions = new Set(customTimeline.map((item) => item.action).filter(Boolean));
  const items = [
    { key: "created", label: "تم إنشاء الطلب", at: order.created_at, done: Boolean(order.created_at), tone: "emerald" },
  ];
  if (getShippingProofRawValue(order)) {
    items.push({ key: "payment_uploaded", label: "تم رفع إثبات الدفع", at: order.created_at, done: true, tone: "amber" });
  }
  if (order.shipping_payment_verified_at) {
    const rejected = paymentStatusOf(order) === "rejected" || lower(order.transfer_proof_status) === "rejected";
    items.push({ key: "payment_verified", label: rejected ? "تم رفض الدفع" : "تم تأكيد الدفع", at: order.shipping_payment_verified_at, done: true, tone: rejected ? "rose" : "emerald" });
  }
  if (customTimeline.length) {
    items.push(...customTimeline);
  }
  if (statusOf(order) === "confirmed" && !customActions.has("customer_confirmed_order")) {
    items.push({ key: "confirmed", label: "تم تأكيد الطلب", at: order.updated_at, done: true, tone: "blue" });
  }
  if (statusOf(order) === "edit_requested" && !customActions.has("customer_requested_edit")) {
    items.push({ key: "edit_requested", label: "العميل طلب تعديل", at: order.updated_at, done: true, tone: "orange" });
  }
  const shipping = shippingStatusOf(order);
  if (["ready_to_ship"].includes(shipping) || ["ready_to_ship"].includes(statusOf(order))) {
    items.push({ key: "ready_to_ship", label: "جاهز للشحن", at: order.updated_at, done: true, tone: "blue" });
  }
  if (["shipment_created", "out_for_delivery", "delivered"].includes(shipping) || ["shipment_created", "out_for_delivery", "delivered"].includes(statusOf(order))) {
    items.push({ key: "shipment_created", label: "تم إنشاء الشحنة", at: order.updated_at, done: true, tone: "blue" });
  }
  if (shipping === "delivered" || statusOf(order) === "delivered") {
    items.push({ key: "delivered", label: "تم التسليم", at: order.updated_at, done: true, tone: "emerald" });
  }
  if (isClosedOrder(order)) {
    const returnedOrRefunded = isReturnedOrRefundedOrder(order);
    const hasCustomerCancelledEvent = customActions.has("customer_cancelled_order");
    items.push({
      key: "closed",
      label: returnedOrRefunded ? "\u0645\u0631\u062a\u062c\u0639/\u0645\u0633\u062a\u0631\u062f" : statusOf(order) === "cancelled_by_customer" ? (hasCustomerCancelledEvent ? "الطلب مغلق" : "ألغاه العميل") : "\u0645\u0644\u063a\u0649",
      at: order.cancelled_at || order.returned_at || order.deleted_at || order.updated_at,
      done: true,
      tone: "rose",
    });
    if (statusOf(order) === "cancelled_by_customer" && !customActions.has("customer_cancelled_order")) {
      items.push({ key: "cancelled_by_customer", label: "ألغاه العميل", at: order.cancelled_at || order.updated_at, done: true, tone: "rose" });
    }
    if (order.refund_method) {
      items.push({
        key: "refund_method",
        label: `\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f: ${refundMethodLabel(order.refund_method)}`,
        at: order.returned_at || order.return_completed_at || order.refunded_at || order.updated_at,
        done: true,
        tone: "cyan",
      });
    }
  }
  return items;
};

function OrdersDashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState(() => searchParams.get("channel") || "all");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [archivingOrder, setArchivingOrder] = useState(false);
  const [permanentDeleting, setPermanentDeleting] = useState(false);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const data = await api.get("/orders");
      const baseOrders = Array.isArray(data) ? data : Array.isArray(data.orders) ? data.orders : [];
      const enriched = baseOrders.map((order) => normalizeOrder(order, {
        items: Array.isArray(order.items) ? order.items : [],
        total: order.total ?? order.total_amount ?? order.total_price,
      }));
      setOrders(enriched.length ? enriched : mockOrders());
    } catch (err) {
      console.log(err);
      setOrders(mockOrders());
      setError(t("common.noData"));
      toast.error(t("common.noData"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadOrders();
    });

    const handleNewOrder = (newOrder) => {
      setOrders((prev) => [normalizeOrder(newOrder, { items: [] }), ...prev]);
    };

    socket.on("new_order", handleNewOrder);
    return () => socket.off("new_order", handleNewOrder);
  }, [loadOrders]);

  useEffect(() => {
    const channel = searchParams.get("channel") || "all";
    queueMicrotask(() => setChannelFilter(channel));
  }, [searchParams]);

  const verificationOrders = useMemo(() => orders.filter(isAwaitingVerification), [orders]);
  const fulfillmentOrders = useMemo(() => orders.filter(isFulfillmentOrder), [orders]);
  const returnsOrders = useMemo(() => getReturnedOrders(orders), [orders]);

  const workspaceSource = useMemo(() => {
    if (workspace === "verification") return verificationOrders;
    if (workspace === "fulfillment") return fulfillmentOrders;
    if (workspace === "returns") return returnsOrders;
    return orders;
  }, [workspace, orders, verificationOrders, fulfillmentOrders, returnsOrders]);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return workspaceSource.filter((order) => {
      const matchesSearch = !query || buildSearchText(order).includes(query);
      const matchesStatus = matchesStatusFilter(order, statusFilter);
      const matchesPayment = matchesPaymentFilter(order, paymentFilter);
      const orderSource = getOrderSource(order);
      const matchesChannel = channelFilter === "all" || orderSource === channelFilter;
      const matchesDate = !dateFilter || String(order.created_at || "").slice(0, 10) === dateFilter;
      return matchesSearch && matchesStatus && matchesPayment && matchesChannel && matchesDate;
    });
  }, [workspaceSource, search, statusFilter, paymentFilter, channelFilter, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleOrders = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedOrders = useMemo(() => orders.filter((order) => selectedIds.includes(order.id)), [orders, selectedIds]);
  const selectedCount = selectedIds.length;
  useEffect(() => {
    if (!ORDERS_DEBUG || !selectedOrder) return;
    console.log("SELECTED ORDER", selectedOrder);
    console.log("ORDER ITEMS", selectedOrder?.items);
    const itemRows = (Array.isArray(selectedOrder.items) ? selectedOrder.items : []).map((item) => ({
      id: item.id,
      product_name: item.product_name || item.name,
      price: item.price,
      sale_price: item.sale_price,
      unit_price: item.unit_price,
      total_amount: item.total_amount,
      subtotal: item.subtotal,
      line_total: item.line_total,
      final_price: item.final_price,
      variant_price: item.variant_price,
      resolved_unit_price: resolveOrderItemUnitPrice(item),
      resolved_line_total: resolveOrderItemLineTotal(item),
    }));
    console.table(itemRows);
  }, [selectedOrder]);
  const updateFilter = (setter, value) => {
    setter(value);
    setPage(1);
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const openOrder = async (order) => {
    setSelectedOrder(order);
    setOpenMenuId(null);
    if (!order?.id) return;
    try {
      const data = await api.get(`/orders/${order.id}`);
      const detailedOrder = normalizeOrder(data.order || data, {
        items: Array.isArray(data.items) ? data.items : Array.isArray(data.order?.items) ? data.order.items : order.items || [],
        total: data.order?.total ?? data.order?.total_amount ?? data.order?.total_price ?? order.total,
      });
      setSelectedOrder((current) => (String(current?.id) === String(order.id) ? detailedOrder : current));
      setOrders((prev) => prev.map((row) => (String(row.id) === String(order.id) ? { ...row, ...detailedOrder } : row)));
    } catch (err) {
      if (ORDERS_DEBUG) console.log("[orders-dashboard] selected order details load failed", err);
    }
  };

  const updateShippingPayment = async (orderId, action) => {
    try {
      const data = await api.post(`/orders/${orderId}/${action === "confirm" ? "confirm-payment" : "reject-payment"}`, {});
      setOrders((prev) => prev.map((order) => (String(order.id) === String(orderId) ? normalizeOrder(data.order || order, { items: order.items || [] }) : order)));
      toast.success(action === "confirm" ? t("orders.payment.confirmed") : t("orders.payment.rejected"));
    } catch (err) {
      toast.error(err.message || t("orders.payment.updateFailed"));
    }
  };

  const openEditOrder = (order) => {
    if (!order?.id) return;
    navigate(`/pos?editOrderId=${encodeURIComponent(order.id)}`);
    setOpenMenuId(null);
  };

  const openCancelOrder = async (order) => {
    const baseOrder = order;
    setOpenMenuId(null);
    if (!baseOrder?.id) return;
    try {
      const data = await api.get(`/orders/${baseOrder.id}`);
      const detailedOrder = normalizeOrder(data.order || data, {
        items: Array.isArray(data.items) ? data.items : Array.isArray(data.order?.items) ? data.order.items : baseOrder.items || [],
        total: data.order?.total ?? data.order?.total_amount ?? data.order?.total_price ?? baseOrder.total,
      });
      setCancelTarget(detailedOrder);
    } catch (err) {
      setCancelTarget(baseOrder);
      toast.error(err.responseBody?.message || err.message || t("orders.cancel.loadItemsFailed"));
    }
    setOpenMenuId(null);
  };

  const openArchiveOrder = (order) => {
    setArchiveTarget(order);
    setOpenMenuId(null);
  };

  const openPermanentDeleteOrder = (order) => {
    setPermanentDeleteTarget(order);
    setPermanentDeleteConfirm("");
    setOpenMenuId(null);
  };

  const saveOrderEdit = async (payload) => {
    if (!editingOrder?.id) return;
    try {
      setSavingEdit(true);
      const data = await api.patch(`/orders/${editingOrder.id}`, payload);
      const updatedOrder = normalizeOrder(data.order || editingOrder, {
        items: Array.isArray(data.items) ? data.items : payload.items || editingOrder.items || [],
        total: data.order?.total ?? data.order?.total_amount ?? data.order?.total_price,
      });
      setOrders((prev) => prev.map((order) => (String(order.id) === String(editingOrder.id) ? updatedOrder : order)));
      setEditingOrder(null);
      void loadOrders();
      toast.success(t("orders.edit.updated"));
    } catch (err) {
      toast.error(err.message || t("orders.edit.updateFailed"));
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmCancelOrder = async () => {
    if (!cancelTarget?.id) return;
    try {
      setCancellingOrder(true);
      await api.delete(`/orders/${cancelTarget.id}`, { body: { reason: "Cancelled from orders dashboard" } });
      setOrders((prev) => prev.filter((order) => String(order.id) !== String(cancelTarget.id)));
      setSelectedIds([]);
      if (selectedOrder && String(selectedOrder.id) === String(cancelTarget.id)) setSelectedOrder(null);
      setCancelTarget(null);
      void loadOrders();
      toast.success(t("orders.cancel.success"));
    } catch (err) {
      toast.error(err.responseBody?.message || err.message || t("orders.cancel.failed"));
    } finally {
      setCancellingOrder(false);
    }
  };

  const confirmArchiveOrder = async () => {
    if (!archiveTarget?.id) return;
    try {
      setArchivingOrder(true);
      await api.patch(`/orders/${archiveTarget.id}/archive`, { reason: "Archived from orders dashboard" });
      setOrders((prev) => prev.filter((order) => String(order.id) !== String(archiveTarget.id)));
      setSelectedIds([]);
      if (selectedOrder && String(selectedOrder.id) === String(archiveTarget.id)) setSelectedOrder(null);
      setArchiveTarget(null);
      void loadOrders();
      toast.success(t("orders.archive.success"));
    } catch (err) {
      toast.error(err.message || t("orders.archive.failed"));
    } finally {
      setArchivingOrder(false);
    }
  };

  const confirmPermanentDeleteOrder = async () => {
    if (!permanentDeleteTarget?.id) return;
    const confirmation = permanentDeleteConfirm.trim();
    if (confirmation !== "DELETE" && confirmation !== "حذف") {
      toast.error(tt(t, "orders.permanentDelete.confirmRequired", "اكتب DELETE أو حذف للتأكيد."));
      return;
    }
    try {
      setPermanentDeleting(true);
      await api.delete(`/orders/${permanentDeleteTarget.id}/permanent`, { body: { confirmation } });
      setOrders((prev) => prev.filter((order) => String(order.id) !== String(permanentDeleteTarget.id)));
      setSelectedIds((prev) => prev.filter((id) => String(id) !== String(permanentDeleteTarget.id)));
      if (selectedOrder && String(selectedOrder.id) === String(permanentDeleteTarget.id)) setSelectedOrder(null);
      setPermanentDeleteTarget(null);
      setPermanentDeleteConfirm("");
      toast.success(tt(t, "orders.permanentDelete.success", "تم حذف الفاتورة نهائياً."));
    } catch (err) {
      toast.error(err.responseBody?.message || err.message || tt(t, "orders.permanentDelete.failed", "تعذر حذف الفاتورة نهائياً."));
    } finally {
      setPermanentDeleting(false);
    }
  };

  const bulkSetStatus = (status) => {
    if (!selectedCount) return;
    setOrders((prev) => prev.map((order) => (selectedIds.includes(order.id) ? { ...order, status } : order)));
    toast.success(`${selectedCount} ${t("orders.bulk.selected")}`);
    setSelectedIds([]);
  };

  const exportSelected = () => {
    const rows = selectedOrders.length ? selectedOrders : filteredOrders;
    const csv = [
      ["order", "customer", "phone", "status", "payment_status", "paid_amount", "total", "seller", "source", "created_at"].join(","),
      ...rows.map((order) => [
        orderCode(order),
        order.customer_name || "",
        getCustomerPhone(order),
        order.status || "",
        getPaymentSummary(order, i18n.language).label,
        getPaidAmount(order),
        totalValue(order),
        getSellerName(order),
        getOrderSource(order),
        order.created_at || "",
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-export-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const bulkWhatsapp = () => {
    const first = selectedOrders[0];
    const phone = getCustomerPhone(first);
    if (!phone) {
      toast.error(t("orders.bulk.selectPhoneFirst"));
      return;
    }
    const message = encodeURIComponent(t("orders.bulk.whatsappMessage", { order: orderCode(first), status: first.status || "قيد المراجعة" }));
    window.open(`https://wa.me/${String(phone).replace(/\D/g, "")}?text=${message}`, "_blank", "noreferrer");
  };

  const activeWorkspace = WORKSPACES.find((item) => item.key === workspace) || WORKSPACES[0];
  const ActiveWorkspaceIcon = activeWorkspace.icon;

  return (
    <OrdersShell header={null}>
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <WorkspaceTabs t={t} value={workspace} onChange={(value) => { setWorkspace(value); setPage(1); }} counts={{ table: orders.length, verification: verificationOrders.length, fulfillment: fulfillmentOrders.length, returns: returnsOrders.length }} />

      <div className={`grid min-w-0 gap-3 ${selectedOrder && workspace === "table" ? "xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <main className="min-w-0 rounded-2xl border border-white/10 bg-zinc-950/90 p-3 shadow-2xl shadow-black/10">
          <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <ActiveWorkspaceIcon className="h-3.5 w-3.5" />
                {t(activeWorkspace.labelKey)}
              </div>
              <h2 className="mt-1 text-lg font-black text-white">{t("orders.dashboard.operationsWorkspace")}</h2>
            </div>
            <BulkActions
              t={t}
              selectedCount={selectedCount}
              onConfirm={() => bulkSetStatus("Confirmed")}
              onShip={() => bulkSetStatus("Shipped")}
              onPrint={() => window.print()}
              onExport={exportSelected}
              onWhatsapp={bulkWhatsapp}
            />
          </div>

            <Filters
            t={t}
            search={search}
            setSearch={(value) => updateFilter(setSearch, value)}
            statusFilter={statusFilter}
            setStatusFilter={(value) => updateFilter(setStatusFilter, value)}
            paymentFilter={paymentFilter}
            setPaymentFilter={(value) => updateFilter(setPaymentFilter, value)}
            channelFilter={channelFilter}
            setChannelFilter={(value) => updateFilter(setChannelFilter, value)}
            dateFilter={dateFilter}
            setDateFilter={(value) => updateFilter(setDateFilter, value)}
          />

          {loading ? <TableSkeleton /> : null}
          {!loading && workspace === "table" ? (
            <TableView
              t={t}
              language={i18n.language}
              orders={visibleOrders}
              selectedIds={selectedIds}
              toggleSelected={toggleSelected}
              openOrder={openOrder}
              editOrder={openEditOrder}
              cancelOrder={openCancelOrder}
              archiveOrder={openArchiveOrder}
              permanentDeleteOrder={openPermanentDeleteOrder}
              navigate={navigate}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              activeOrderId={selectedOrder?.id}
              empty={<EmptyState icon={PackageOpen} title={t("orders.empty.noOrders")} text={t("orders.empty.matchingFilters")} />}
            />
          ) : null}
          {!loading && workspace === "verification" ? (
            <VerificationQueue t={t} orders={filteredOrders} updateShippingPayment={updateShippingPayment} openOrder={openOrder} />
          ) : null}
          {!loading && workspace === "fulfillment" ? (
            <FulfillmentBoard t={t} orders={filteredOrders} openOrder={openOrder} />
          ) : null}
          {!loading && workspace === "returns" ? (
            <ReturnsView t={t} orders={filteredOrders} openOrder={openOrder} />
          ) : null}

          {workspace === "table" && !loading ? (
            <Pager currentPage={currentPage} totalPages={totalPages} visible={visibleOrders.length} total={filteredOrders.length} t={t} setPage={setPage} />
          ) : null}
        </main>
        {selectedOrder && workspace === "table" ? (
          <aside className="hidden min-w-0 xl:block">
            <OrderPreviewPanel
              t={t}
              order={selectedOrder}
              onClose={() => setSelectedOrder(null)}
              updateShippingPayment={updateShippingPayment}
              navigate={navigate}
              editOrder={openEditOrder}
              compact
            />
          </aside>
        ) : null}
      </div>

      <OrderDrawer t={t} order={selectedOrder} onClose={() => setSelectedOrder(null)} updateShippingPayment={updateShippingPayment} navigate={navigate} editOrder={openEditOrder} inlinePreview={workspace === "table"} />
      <OrderEditModal t={t} order={editingOrder} saving={savingEdit} onClose={() => setEditingOrder(null)} onSave={saveOrderEdit} />
      <CancelOrderModal t={t} order={cancelTarget} cancelling={cancellingOrder} onClose={() => setCancelTarget(null)} onConfirm={confirmCancelOrder} />
      <ArchiveOrderModal t={t} order={archiveTarget} archiving={archivingOrder} onClose={() => setArchiveTarget(null)} onConfirm={confirmArchiveOrder} />
      <PermanentDeleteOrderModal
        t={t}
        order={permanentDeleteTarget}
        value={permanentDeleteConfirm}
        deleting={permanentDeleting}
        onChange={setPermanentDeleteConfirm}
        onClose={() => {
          setPermanentDeleteTarget(null);
          setPermanentDeleteConfirm("");
        }}
        onConfirm={confirmPermanentDeleteOrder}
      />
    </OrdersShell>
  );
}

function WorkspaceTabs({ t, value, onChange, counts }) {
  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-zinc-950/80 p-1.5 shadow-xl shadow-black/10 sm:grid-cols-2 xl:grid-cols-4">
      {WORKSPACES.map(({ key, labelKey, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${value === key ? "border-cyan-400/30 bg-white/10 text-white shadow-[0_0_20px_rgba(34,211,238,0.15)]" : "border-transparent text-zinc-300 hover:bg-white/5 hover:text-white"}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate text-sm font-black">{t(labelKey)}</span>
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-black ${value === key ? "bg-cyan-400/15 text-cyan-100" : "bg-white/10 text-white"}`}>{counts[key] || 0}</span>
        </button>
      ))}
    </div>
  );
}

function BulkActions({ t, selectedCount, onConfirm, onShip, onPrint, onExport, onWhatsapp }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-zinc-200">{t("orders.bulk.selectedCount", { count: selectedCount })}</span>
      <ActionButton disabled={!selectedCount} onClick={onConfirm} icon={<CheckCircle2 className="h-3.5 w-3.5" />} label={t("orders.bulk.confirm")} />
      <ActionButton disabled={!selectedCount} onClick={onShip} icon={<Truck className="h-3.5 w-3.5" />} label={t("orders.bulk.ship")} />
      <ActionButton disabled={!selectedCount} onClick={onPrint} icon={<Printer className="h-3.5 w-3.5" />} label={t("orders.bulk.print")} />
      <ActionButton disabled={!selectedCount} onClick={onExport} icon={<Download className="h-3.5 w-3.5" />} label={t("orders.bulk.export")} />
      <ActionButton disabled={!selectedCount} onClick={onWhatsapp} icon={<MessageCircle className="h-3.5 w-3.5" />} label={t("orders.bulk.whatsapp")} />
      <ActionButton disabled title={t("orders.bulk.cancelRequiresBackend")} icon={<RotateCcw className="h-3.5 w-3.5" />} label={t("orders.bulk.cancel")} tone="rose" />
    </div>
  );
}

function ActionButton({ disabled, onClick, icon, label, tone = "zinc", title }) {
  const toneClass = tone === "rose" ? "border-rose-400/20 bg-rose-400/10 text-rose-200" : "border-white/10 bg-white/5 text-white";
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? title || "" : title}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}
    >
      {icon}
      {label}
    </button>
  );
}

function Filters(props) {
  const {
    t, search, setSearch, statusFilter, setStatusFilter, paymentFilter, setPaymentFilter, channelFilter, setChannelFilter, dateFilter, setDateFilter,
  } = props;

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[minmax(20rem,2.3fr)_repeat(4,minmax(9rem,1fr))]">
        <label className="block">
          <div className="mb-1.5 text-[11px] font-bold text-zinc-300">البحث</div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("orders.searchPlaceholder")}
              className="w-full rounded-xl border border-cyan-400/20 bg-white/[0.07] py-2.5 pe-3 ps-10 text-sm font-medium text-white outline-none shadow-[0_0_24px_rgba(34,211,238,0.05)] placeholder:text-zinc-500 focus:border-cyan-300/40"
            />
          </div>
        </label>
        <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} label="حالة الطلب" allLabel="الكل" labels={STATUS_FILTER_LABELS} />
        <Select value={paymentFilter} onChange={setPaymentFilter} options={PAYMENT_FILTER_OPTIONS} label="حالة الدفع" allLabel="الكل" labels={PAYMENT_FILTER_LABELS} />
        <Select value={channelFilter} onChange={setChannelFilter} options={SOURCE_FILTERS} label="المصدر" allLabel="الكل" labels={SOURCE_LABELS} t={t} />
        <label className="block">
          <div className="mb-1.5 text-[11px] font-bold text-zinc-300">التاريخ</div>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none" />
        </label>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <QuickFilterButton active={dateFilter === getDateInputValue()} onClick={() => setDateFilter(dateFilter === getDateInputValue() ? "" : getDateInputValue())} label={t("orders.filters.today")} />
      </div>
    </>
  );
}

function TableView({ t, language, orders, selectedIds, toggleSelected, openOrder, editOrder, cancelOrder, archiveOrder, permanentDeleteOrder, navigate, openMenuId, setOpenMenuId, activeOrderId, empty }) {
  const isRtl = isArabicLanguage(language);
  const tableDir = isRtl ? "rtl" : "ltr";
  useEffect(() => {
    if (!ORDERS_DEBUG) return;
    console.log("[orders-dashboard] table actions debug", {
      ordersLength: orders.length,
      actionsRendered: orders.map((order) => order.id),
      permissionChecks: "row actions visible; backend permissions enforced on requests",
    });
  }, [orders]);

  if (!orders.length) return empty;
  return (
    <div className="mt-3 w-full min-w-0 overflow-x-auto overflow-y-visible pb-2">
      <div className="min-w-[1480px] overflow-visible">
        <div
          className="sticky top-0 z-20 grid grid-cols-[4rem_8rem_7.5rem_minmax(9rem,1.2fr)_8rem_4.5rem_9rem_6.5rem_6.5rem_6.5rem_7rem_5.5rem_5.5rem] rounded-xl border border-white/10 bg-zinc-950/85 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-zinc-400 shadow-lg shadow-black/20 backdrop-blur-xl"
          dir={tableDir}
        >
          <div className="flex items-center justify-center py-1 text-center">{t("orders.table.actions")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.invoice")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.date")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.customer")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.customerPhone", isArabicLanguage(language) ? "\u0647\u0627\u062a\u0641 \u0627\u0644\u0639\u0645\u064a\u0644" : "Phone")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.items", isArabicLanguage(language) ? "\u0627\u0644\u0623\u0635\u0646\u0627\u0641" : "Items")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.paymentStatus", isArabicLanguage(language) ? "\u062d\u0627\u0644\u0629 \u0627\u0644\u062f\u0641\u0639" : "Payment Status")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.total")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.paidAmount", isArabicLanguage(language) ? "\u0627\u0644\u0645\u062f\u0641\u0648\u0639" : "Paid")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{isArabicLanguage(language) ? "\u0627\u0644\u0645\u0633\u062a\u062d\u0642" : "Due"}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.seller", isArabicLanguage(language) ? "\u0627\u0644\u0628\u0627\u0626\u0639" : "Seller")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{t("orders.table.branch")}</div>
          <div className="flex items-center justify-center px-2 py-1 text-center">{isArabicLanguage(language) ? "\u0646\u0642\u0637\u0629 \u0627\u0644\u0628\u064a\u0639" : "POS"}</div>
        </div>
        <div className="relative z-10 mt-1.5 space-y-1.5 overflow-visible">
          {orders.map((order) => {
            const priority = priorityFor(order);
            if (ORDERS_DEBUG) console.log("[orders-dashboard] row actions rendered", { rowId: order.id, actionsRendered: true });
            return (
              <div
                key={String(order.id)}
                role="button"
                tabIndex={0}
                onClick={() => openOrder(order)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") openOrder(order);
                }}
                className={`relative z-0 grid cursor-pointer grid-cols-[4rem_8rem_7.5rem_minmax(9rem,1.2fr)_8rem_4.5rem_9rem_6.5rem_6.5rem_6.5rem_7rem_5.5rem_5.5rem] items-center overflow-visible rounded-xl border px-3 py-2 shadow-xl transition-all duration-200 ease-out hover:z-10 hover:border-cyan-400/30 hover:bg-white/[0.02] hover:shadow-2xl hover:shadow-cyan-950/10 ${priority.className} ${selectedIds.includes(order.id) || String(activeOrderId) === String(order.id) ? "ring-1 ring-cyan-400/35" : ""}`}
                dir={tableDir}
              >
                <RowMenu t={t} order={order} openOrder={openOrder} editOrder={editOrder} cancelOrder={cancelOrder} archiveOrder={archiveOrder} permanentDeleteOrder={permanentDeleteOrder} navigate={navigate} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} />
                <div className="flex min-w-0 items-center justify-center gap-2 px-2 text-center">
                  <input className="h-4 w-4 shrink-0 accent-cyan-500" type="checkbox" checked={selectedIds.includes(order.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(order.id)} />
                  <OrderCode order={order} />
                </div>
                <OrderDateTimeCell value={order.created_at} language={language} />
                <CustomerCell t={t} order={order} />
                <PhoneCell t={t} order={order} />
                <ItemsCountCell order={order} />
                <PaymentStatusCell order={order} language={language} />
                <TotalCell t={t} order={order} />
                <PaidAmountCell order={order} />
                <DueAmountCell order={order} />
                <SellerCell order={order} />
                <div className="flex min-w-0 items-center justify-center px-2 text-center text-xs font-medium text-zinc-300"><span className="truncate">{order.branch || "-"}</span></div>
                <div className="flex min-w-0 items-center justify-center px-2 text-center text-xs font-medium text-zinc-300"><span className="truncate">{getPosDisplay(order) || "-"}</span></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RowMenu({ t, order, openOrder, editOrder, cancelOrder, archiveOrder, permanentDeleteOrder, navigate, openMenuId, setOpenMenuId }) {
  const cancelDisabled = isDeliveredOrder(order);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const isOpen = openMenuId === order.id;

  useEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 256;
      const viewportPadding = 12;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - menuWidth),
        window.innerWidth - menuWidth - viewportPadding
      );
      const top = Math.min(rect.bottom + 8, window.innerHeight - 340);
      setMenuPosition({ top: Math.max(viewportPadding, top), left });
      if (ORDERS_DEBUG) console.log("[orders-dashboard] dropdown open state", {
        rowId: order.id,
        open: true,
        top: Math.max(viewportPadding, top),
        left,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, order.id]);

  const closeMenu = () => setOpenMenuId(null);
  useDismissableLayer({
    enabled: isOpen,
    refs: [menuRef, buttonRef],
    onDismiss: closeMenu,
  });

  const runAction = (handler) => {
    handler();
    closeMenu();
  };

  const menu = isOpen && typeof document !== "undefined"
    ? createPortal(
        <>
          <div
            ref={menuRef}
            className="fixed z-[9999] w-64 rounded-2xl border border-white/10 bg-zinc-950/95 p-2 text-white shadow-2xl shadow-black/40 backdrop-blur-xl"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <MenuButton icon={<Eye className="h-4 w-4" />} label={t("orders.actionsMenu.viewDetails")} onClick={() => runAction(() => openOrder(order))} />
            <MenuButton icon={<Pencil className="h-4 w-4" />} label={t("orders.actionsMenu.editOrder")} onClick={() => runAction(() => editOrder(order))} />
            <MenuButton
              icon={<RotateCcw className="h-4 w-4" />}
              label={t("orders.actionsMenu.cancelRestore")}
              tone="rose"
              disabled={cancelDisabled}
              title={cancelDisabled ? t("orders.cancel.deliveredUseReturns") : ""}
              onClick={() => runAction(() => cancelOrder(order))}
            />
            <MenuButton icon={<Trash2 className="h-4 w-4" />} label={t("orders.actionsMenu.archiveOrder")} onClick={() => runAction(() => archiveOrder(order))} />
            <MenuButton icon={<FileText className="h-4 w-4" />} label={t("orders.actionsMenu.openDetailsPage")} onClick={() => runAction(() => navigate(`/orders/${order.id}`))} />
            <MenuButton icon={<Copy className="h-4 w-4" />} label={t("orders.actionsMenu.copyInvoiceLink", "نسخ رابط الفاتورة")} onClick={() => runAction(() => {
              copyText(publicInvoiceUrl(order))
                .then(() => toast.success(t("orders.actionsMenu.invoiceLinkCopied", "\u062a\u0645 \u0646\u0633\u062e \u0631\u0627\u0628\u0637 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629")))
                .catch(() => toast.error(t("orders.actionsMenu.invoiceLinkCopyFailed", "\u062a\u0639\u0630\u0631 \u0646\u0633\u062e \u0631\u0627\u0628\u0637 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629")));
            })} />
            <div className="my-1 border-t border-white/10" />
            <MenuButton
              icon={<Trash2 className="h-4 w-4" />}
              label={tt(t, "orders.actionsMenu.permanentDelete", "\u062d\u0630\u0641 \u0646\u0647\u0627\u0626\u064a")}
              tone="rose"
              onClick={() => runAction(() => permanentDeleteOrder(order))}
            />
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div className="z-30 flex h-full w-16 min-w-16 shrink-0 items-center justify-center overflow-visible" onClick={(event) => event.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("orders.actionsMenu.actionsFor", { order: orderCode(order) })}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          if (ORDERS_DEBUG) console.log("[orders-dashboard] action trigger clicked", { rowId: order.id, nextOpen: !isOpen });
          setOpenMenuId(isOpen ? null : order.id);
        }}
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/90 shadow-lg shadow-black/10 ring-1 ring-white/[0.03] transition-all duration-200 ease-out hover:border-cyan-300/40 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/35"
      >
        <MoreVertical className="h-4 w-4 opacity-95" />
      </button>
      {menu}
    </div>
  );
}

function VerificationQueue({ t, orders, updateShippingPayment, openOrder }) {
  if (!orders.length) return <EmptyState icon={CreditCard} title={t("orders.payment.noVerificationOrders")} text={t("orders.payment.noVerificationText")} />;
  return (
    <div className="mt-3 grid gap-3 xl:grid-cols-2">
      {orders.map((order) => {
        const rawProof = getShippingProofRawValue(order);
        const proofUrl = resolveShippingProofImageUrl(rawProof);
        const proofInvalid = Boolean(rawProof) && isInvalidShippingProofUrl(rawProof);
        return (
          <div key={order.id} className="grid gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 shadow-xl shadow-amber-950/10 md:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
              {proofInvalid ? <div className="grid h-28 place-items-center px-3 text-center text-xs font-semibold text-rose-200">{t("orders.payment.invalidProof")}</div> : proofUrl ? <img src={proofUrl} alt={t("orders.payment.proofAlt")} className="h-28 w-full object-cover" /> : <div className="grid h-28 place-items-center text-xs font-semibold text-zinc-500">{t("orders.payment.noProof")}</div>}
            </div>
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <OrderCode order={order} />
                  <div className="mt-2 truncate text-sm font-semibold text-white">{order.customer_name || t("orders.fallback.customer")}</div>
                  <div className="mt-1 text-xs text-zinc-400">{formatShippingPaymentMethodLabel(order.shipping_payment_method || order.payment_method)} · {formatCurrency(order.shipping_fee || order.delivery_fee || 0)}</div>
                </div>
                <StatusBadge value={paymentBadgeValue(order)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={proofInvalid} onClick={() => updateShippingPayment(order.id, "confirm")} className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{t("orders.payment.confirm")}</button>
                <button type="button" disabled={proofInvalid} onClick={() => updateShippingPayment(order.id, "reject")} className="rounded-xl bg-rose-500 px-3 py-1.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{t("orders.payment.reject")}</button>
                <button type="button" onClick={() => openOrder(order)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white">{t("orders.actionsMenu.view")}</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FulfillmentBoard({ t, orders, openOrder }) {
  const columns = [
    ["confirmed", t("orders.fulfillment.confirmed")],
    ["ready_to_ship", t("orders.fulfillment.packedReady")],
    ["shipment_created", t("orders.fulfillment.shipped")],
    ["delivered", t("orders.fulfillment.delivered")],
  ];
  const grouped = columns.map(([key, label]) => ({
    key,
    label,
    orders: orders.filter((order) => {
      const status = statusOf(order);
      const shipping = shippingStatusOf(order);
      if (key === "confirmed") return status === "confirmed" || shipping === "pending";
      if (key === "ready_to_ship") return status === "ready_to_ship" || shipping === "ready_to_ship";
      if (key === "shipment_created") return ["shipment_created", "out_for_delivery"].includes(status) || ["shipment_created", "out_for_delivery"].includes(shipping);
      return status === "delivered" || shipping === "delivered";
    }),
  }));
  if (!orders.length) return <EmptyState icon={Truck} title={t("orders.fulfillment.noOrders")} text={t("orders.fulfillment.noOrdersText")} />;
  return (
    <div className="mt-3 grid gap-3 xl:grid-cols-4">
      {grouped.map((column) => (
        <div key={column.key} className="min-h-48 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-white">{column.label}</h3>
            <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-black text-zinc-200">{column.orders.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {column.orders.map((order) => <CompactOrderCard key={order.id} t={t} order={order} onClick={() => openOrder(order)} />)}
            {!column.orders.length ? <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs font-semibold text-zinc-500">{t("orders.empty.empty")}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReturnsView({ t, orders, openOrder }) {
  if (!orders.length) return <EmptyState icon={RotateCcw} title={t("orders.returns.noReturns")} text={t("orders.returns.noReturnsText")} />;
  return (
    <div className="mt-3 grid gap-2 xl:grid-cols-2">
      {orders.map((order) => (
        <button key={order.id} type="button" onClick={() => openOrder(order)} className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-left transition hover:bg-rose-400/15">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <OrderCode order={order} />
              <div className="mt-2 truncate text-sm font-semibold text-white">{order.customer_name || t("orders.fallback.customer")}</div>
              <div className="mt-1 text-xs text-zinc-400">{order.cancel_reason || order.notes || t("orders.returns.noReturnNote")}</div>
            </div>
            <StatusBadge value={order.status} />
          </div>
          <div className="mt-3 grid gap-2 text-xs text-zinc-300 sm:grid-cols-3">
            <span>{t("orders.table.payment")}: <b className="text-white">{paymentBadgeValue(order)}</b></span>
            <span>{t("orders.returns.stock")}: <b className="text-white">{order.stock_reverted_at || order.inventory_rollback_done ? t("orders.returns.returned") : t("orders.returns.notMarked")}</b></span>
            <span>{t("orders.table.total")}: <b className="text-white">{formatCurrency(totalValue(order))}</b></span>
          </div>
        </button>
      ))}
    </div>
  );
}

function OrderDrawer({ t, order, onClose, updateShippingPayment, navigate, editOrder, inlinePreview = false }) {
  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  const previewItems = items.map((item) => normalizePreviewOrderItem(item, order));
  const timeline = buildTimeline(order);
  const address = [order.governorate, order.city_area, order.customer_address, order.landmark].filter(Boolean).join(" - ");
  const rawProof = getShippingProofRawValue(order);
  const proofUrl = resolveShippingProofImageUrl(rawProof);
  const proofInvalid = Boolean(rawProof) && isInvalidShippingProofUrl(rawProof);
  return (
    <div className={`fixed inset-0 z-50 ${inlinePreview ? "xl:hidden" : ""}`}>
      <button type="button" aria-label={t("orders.drawer.closeBackdrop")} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <section className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-white/10 bg-zinc-950 text-white shadow-2xl md:w-[42rem]">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <OrderCode order={order} />
            <h2 className="mt-2 truncate text-2xl font-black">{getCustomerDisplayName(order, t("orders.fallback.customer"))}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge value={order.status} />
              <StatusBadge value={paymentBadgeValue(order)} />
              {isExchangeOrder(order) ? <ExchangeBadge order={order} /> : null}
              {order.shipping_status ? <StatusBadge value={order.shipping_status} /> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoTile icon={User} label={t("orders.drawer.customer")} value={getCustomerDisplayName(order, t("orders.fallback.walkInCustomer"))} />
            <InfoTile icon={Phone} label={t("orders.drawer.phone")} value={order.customer_phone || t("orders.fallback.noPhone")} />
            <InfoTile icon={User} label="البائع" value={getSellerDisplayName(order) || "غير متاح"} />
            <InfoTile icon={CreditCard} label="الدفع" value={`${order.payment_method || "غير متاح"} · ${paymentBadgeValue(order)}`} />
            {order.refund_method ? <InfoTile icon={RotateCcw} label="\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f" value={refundMethodLabel(order.refund_method)} /> : null}
            <InfoTile icon={Truck} label="الشحن" value={`${order.shipping_provider || "يدوي"} · ${order.shipping_status || "قيد الانتظار"}`} />
            <InfoTile icon={DollarSign} label={t("orders.table.total")} value={formatCurrency(totalValue(order))} />
            {isEditedPaymentOrder(order) ? <InfoTile icon={Pencil} label="دفع تعديل الفاتورة" value={`المدفوع الأصلي: ${formatCurrency(editOriginalPaidOf(order))} / المدفوع الإضافي: ${formatCurrency(editAdditionalPaidOf(order))} / الإجمالي النهائي: ${formatCurrency(totalValue(order))}`} /> : null}
            <InfoTile icon={MapPin} label={t("orders.drawer.address")} value={address || t("orders.fallback.noAddress")} />
          </div>

          <Section title={t("orders.drawer.timeline")}>
            <Timeline items={timeline} />
          </Section>

          <Section title={t("orders.drawer.items")}>
            {previewItems.length ? previewItems.map((item) => (
              <div key={item.id || `${item.product_id}-${item.variant_id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.product_name || item.name || t("orders.fallback.item")} className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover" />
                ) : null}
                <div className="min-w-0">
                  <div className="truncate text-sm font-black">{item.product_name || item.name || t("orders.fallback.item")}</div>
                  <div className="mt-1 text-xs text-zinc-400">{[item.color, item.size].filter(Boolean).join(" / ") || item.sku || "Variant"} · Qty {item.quantity || 0}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black">{formatCurrency(item.subtotal)}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-zinc-500">{formatCurrency(item.unitPrice)}</div>
                </div>
              </div>
            )) : <EmptyState icon={PackageOpen} title={t("orders.drawer.noItemData")} text={t("orders.drawer.noItemDataText")} compact />}
          </Section>

          <Section title={t("orders.payment.proof")}>
            {proofInvalid ? <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{t("orders.payment.invalidProofUrl")}</div> : proofUrl ? <img src={proofUrl} alt={t("orders.payment.proofAlt")} className="max-h-64 w-full rounded-xl border border-white/10 object-cover" /> : <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-400">{t("orders.payment.noProofUploaded")}</div>}
          </Section>

          <Section title={t("orders.drawer.notes")}>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-6 text-zinc-300">{order.order_notes || order.delivery_notes || order.notes || t("orders.fallback.noNotes")}</div>
          </Section>
        </div>
        <footer className="grid gap-2 border-t border-white/10 p-4 sm:grid-cols-3">
          <button type="button" onClick={() => navigate(`/orders/${order.id}`)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10">{t("orders.actionsMenu.openDetailsPage")}</button>
          <button type="button" onClick={() => editOrder?.(order)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10">{t("orders.actionsMenu.editOrder")}</button>
          <button type="button" onClick={() => {
            if (!order.customer_phone) {
              toast.error(t("orders.bulk.selectPhoneFirst"));
              return;
            }
            const message = encodeURIComponent(t("orders.bulk.whatsappMessage", { order: orderCode(order), status: order.status || "قيد المراجعة" }));
            window.open(`https://wa.me/${String(order.customer_phone).replace(/\D/g, "")}?text=${message}`, "_blank", "noreferrer");
          }} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10">WhatsApp</button>
          <button type="button" disabled={!isAwaitingVerification(order)} onClick={() => updateShippingPayment(order.id, "confirm")} className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-45">{t("orders.payment.confirmPay")}</button>
          <button type="button" disabled={!isAwaitingVerification(order)} onClick={() => updateShippingPayment(order.id, "reject")} className="rounded-xl bg-rose-500 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-45">{t("orders.payment.rejectPay")}</button>
          <button type="button" onClick={() => window.print()} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10">{t("orders.bulk.print")}</button>
        </footer>
      </section>
    </div>
  );
}

function OrderPreviewPanel({ t, order, onClose, updateShippingPayment, navigate, editOrder }) {
  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  const previewItems = items.map((item) => normalizePreviewOrderItem(item, order));
  const timeline = buildTimeline(order);
  const address = [order.governorate, order.city_area, order.customer_address, order.landmark].filter(Boolean).join(" - ");
  const sellerName = getSellerDisplayName(order);
  const customerName = getCustomerDisplayName(order, t("orders.fallback.customer"));
  const openWhatsapp = () => {
    if (!order.customer_phone) {
      toast.error(t("orders.bulk.selectPhoneFirst"));
      return;
    }
    const message = encodeURIComponent(t("orders.bulk.whatsappMessage", { order: orderCode(order), status: order.status || "قيد المراجعة" }));
    window.open(`https://wa.me/${String(order.customer_phone).replace(/\D/g, "")}?text=${message}`, "_blank", "noreferrer");
  };

  return (
    <section className="sticky top-3 flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 text-white shadow-2xl shadow-black/20">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 p-3">
        <div className="min-w-0">
          <OrderCode order={order} />
          <h2 className="mt-2 truncate text-lg font-black">{customerName}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusBadge value={order.status} />
            <StatusBadge value={paymentBadgeValue(order)} />
            {isExchangeOrder(order) ? <ExchangeBadge order={order} compact /> : null}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid gap-2">
          <InfoTile icon={User} label={t("orders.drawer.customer")} value={customerName} />
          <InfoTile icon={Phone} label={t("orders.drawer.phone")} value={order.customer_phone || t("orders.fallback.noPhone")} />
          <InfoTile icon={User} label="البائع" value={sellerName || "غير متاح"} />
          <InfoTile icon={CreditCard} label="الدفع" value={`${order.payment_method || "غير متاح"} / ${paymentBadgeValue(order)}`} />
          {order.refund_method ? <InfoTile icon={RotateCcw} label="\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f" value={refundMethodLabel(order.refund_method)} /> : null}
          <InfoTile icon={DollarSign} label={t("orders.table.total")} value={formatCurrency(totalValue(order))} />
          {isEditedPaymentOrder(order) ? <InfoTile icon={Pencil} label="دفع تعديل الفاتورة" value={`المدفوع الأصلي: ${formatCurrency(editOriginalPaidOf(order))} / المدفوع الإضافي: ${formatCurrency(editAdditionalPaidOf(order))} / الإجمالي النهائي: ${formatCurrency(totalValue(order))}`} /> : null}
          <InfoTile icon={MapPin} label={t("orders.drawer.address")} value={address || t("orders.fallback.noAddress")} />
        </div>

        <Section title={t("orders.drawer.items")}>
          {previewItems.length ? previewItems.map((item) => (
            <div key={item.id || `${item.product_id}-${item.variant_id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.product_name || item.name || t("orders.fallback.item")} className="h-9 w-9 shrink-0 rounded-lg border border-white/10 object-cover" />
              ) : null}
              <div className="min-w-0">
                <div className="truncate text-sm font-black">{item.product_name || item.name || t("orders.fallback.item")}</div>
                <div className="mt-1 text-xs text-zinc-400">{[item.color, item.size].filter(Boolean).join(" / ") || item.sku || "Variant"} / Qty {item.quantity || 0}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-black">{formatCurrency(item.subtotal)}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-zinc-500">{formatCurrency(item.unitPrice)}</div>
              </div>
            </div>
          )) : <EmptyState icon={PackageOpen} title={t("orders.drawer.noItemData")} text={t("orders.drawer.noItemDataText")} compact />}
        </Section>

        <Section title={t("orders.drawer.timeline")}>
          <Timeline items={timeline} />
        </Section>

        <Section title={t("orders.drawer.notes")}>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-6 text-zinc-300">{order.order_notes || order.delivery_notes || order.notes || t("orders.fallback.noNotes")}</div>
        </Section>
      </div>
      <footer className="grid gap-2 border-t border-white/10 p-3">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => navigate(`/orders/${order.id}`)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold hover:bg-white/10">{t("orders.actionsMenu.openDetailsPage")}</button>
          <button type="button" onClick={() => editOrder?.(order)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold hover:bg-white/10">{t("orders.actionsMenu.editOrder")}</button>
          <button type="button" onClick={openWhatsapp} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold hover:bg-white/10">WhatsApp</button>
          <button type="button" onClick={() => window.print()} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold hover:bg-white/10">{t("orders.bulk.print")}</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={!isAwaitingVerification(order)} onClick={() => updateShippingPayment(order.id, "confirm")} className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-45">{t("orders.payment.confirmPay")}</button>
          <button type="button" disabled={!isAwaitingVerification(order)} onClick={() => updateShippingPayment(order.id, "reject")} className="rounded-xl bg-rose-500 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-45">{t("orders.payment.rejectPay")}</button>
        </div>
      </footer>
    </section>
  );
}

function OrderCode({ order }) {
  return (
    <div className="min-w-0 text-center">
      <div className="inline-flex max-w-full items-center truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-black tracking-wide text-white">
        {orderCode(order)}
      </div>
      <div className="mt-0.5 truncate text-[10px] font-semibold text-zinc-500">#{order.id}</div>
    </div>
  );
}

function OrderDateTimeCell({ value, language }) {
  if (!value) return <div className="flex min-w-0 items-center justify-center px-2 text-center text-xs font-bold text-zinc-500">-</div>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <div className="flex min-w-0 items-center justify-center px-2 text-center text-xs font-bold text-zinc-300" title={String(value)}>{String(value)}</div>;
  }

  const locale = isArabicLanguage(language) ? "ar-EG" : "en-US";
  const dateLabel = formatNumericOrderDate(value);
  const timeLabel = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return (
    <div className="table-cell-stack px-2 leading-tight" dir="auto" title={formatDateTime(value)}>
      <div className="truncate text-xs font-black text-zinc-100">{dateLabel}</div>
      <div className="mt-0.5 truncate text-[11px] font-semibold text-zinc-500">{timeLabel}</div>
    </div>
  );
}

function CustomerCell({ t, order }) {
  const attribution = getAttributionLabel(order);
  return (
    <div className="table-cell-stack px-2">
      <div className="truncate text-sm font-semibold text-white" title={getCustomerPhone(order)}>{getCustomerDisplayName(order, t("orders.fallback.customer"))}</div>
      <div className="mt-1 flex max-w-full flex-wrap items-center justify-center gap-1">
        {attribution ? <div className="inline-flex max-w-[9rem] truncate rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200">{attribution}</div> : null}
      </div>
    </div>
  );
}

function PhoneCell({ t, order }) {
  const phone = getCustomerPhone(order);
  if (!phone) return <div className="flex min-w-0 items-center justify-center px-2 text-center text-xs font-bold text-zinc-500">-</div>;

  const copyOnDesktop = async (event) => {
    event.stopPropagation();
    const isMobile = typeof navigator !== "undefined" && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1);
    if (isMobile) return;
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(phone);
      toast.success(t("orders.details.phoneCopied"));
    } catch {
      toast.error(t("orders.details.copyPhoneFailed"));
    }
  };

  return (
    <div className="flex min-w-0 items-center justify-center px-2 text-center">
      <a
        href={`tel:${phone.replace(/[^\d+]/g, "")}`}
        onClick={copyOnDesktop}
        className="inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 truncate text-xs font-bold text-cyan-100 transition hover:text-cyan-50"
        title={phone}
      >
        <Phone className="table-cell-stack__icon h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{phone}</span>
      </a>
    </div>
  );
}

function PaymentStatusCell({ order, language }) {
  const summary = getPaymentSummary(order, language);
  const Icon = paymentMethodIcon[summary.methodKey] || CreditCard;
  const toneClass = {
    paid: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
    partially_paid: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    deferred: "border-slate-400/20 bg-slate-400/10 text-slate-100",
  }[summary.statusKey] || "border-white/10 bg-white/5 text-zinc-100";

  return (
    <div className="table-cell-stack px-2">
      <div className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-black ${toneClass}`} title={summary.label}>
        <Icon className="table-cell-stack__icon h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{summary.label}</span>
      </div>
    </div>
  );
}

function ItemsCountCell({ order }) {
  return (
    <div className="table-cell-stack px-2">
      <div className="inline-flex h-7 min-w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 px-2 text-xs font-black text-white">
        {getItemsCount(order)}
      </div>
    </div>
  );
}

function PaidAmountCell({ order }) {
  const paid = getPaidAmount(order);
  const total = totalValue(order);
  const isPartial = total > 0 && paid > 0 && paid < total;
  if (isEditedPaymentOrder(order)) {
    return (
      <div className="table-cell-stack px-2">
        <div className="truncate text-[10px] font-bold text-zinc-300">
          المدفوع الأصلي: <CurrencyText value={formatCurrency(editOriginalPaidOf(order))} />
        </div>
        <div className="truncate text-[10px] font-bold text-emerald-200">
          المدفوع الإضافي: <CurrencyText value={formatCurrency(editAdditionalPaidOf(order))} />
        </div>
        {editRefundDueOf(order) > 0 ? (
          <div className="truncate text-[10px] font-bold text-amber-100">
            Refund / credit: <CurrencyText value={formatCurrency(editRefundDueOf(order))} />
          </div>
        ) : null}
      </div>
    );
  }
  if (isExchangeOrder(order)) {
    return (
      <div className="table-cell-stack px-2">
        <div className="inline-flex rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-amber-100">
          Exchange
        </div>
        <div className="mt-0.5 truncate text-[10px] font-bold text-emerald-200">
          Paid now: <CurrencyText value={formatCurrency(amountDueNowOf(order))} />
        </div>
        <div className="truncate text-[10px] font-bold text-amber-100">
          Exchange credit: <CurrencyText value={formatCurrency(exchangeCreditOf(order))} />
        </div>
      </div>
    );
  }
  return (
    <div className="table-cell-stack px-2">
      <div className={`truncate text-sm font-bold ${isPartial ? "text-amber-200" : paid > 0 ? "text-emerald-200" : "text-zinc-400"}`}>
        <CurrencyText value={formatCurrency(paid)} />
      </div>
    </div>
  );
}

function SellerCell({ order }) {
  const seller = getSellerName(order);
  return (
    <div className="table-cell-stack px-2">
      <div className="truncate text-xs font-semibold text-zinc-200" title={seller || "-"}>
        {seller || "-"}
      </div>
    </div>
  );
}

function TotalCell({ t, order }) {
  return (
    <div className="table-cell-stack px-2">
      <div className="truncate text-sm font-bold text-white"><CurrencyText value={formatCurrency(totalValue(order))} /></div>
      {isExchangeOrder(order) ? (
        <div className="mt-0.5 truncate text-[10px] font-black text-amber-100">
          Total: <CurrencyText value={formatCurrency(totalValue(order))} />
        </div>
      ) : null}
    </div>
  );
}

function DueAmountCell({ order }) {
  const due = Number(dueAmountOf(order) || 0);
  const hasDue = due > 0;
  return (
    <div className="table-cell-stack px-2">
      <div className={`truncate text-sm font-bold ${hasDue ? "text-amber-200" : "text-zinc-500"}`}>
        <CurrencyText value={formatCurrency(due)} />
      </div>
    </div>
  );
}

function ExchangeBadge({ order, compact = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 font-black text-amber-100 ${
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      }`}
      title={`Paid now: ${formatCurrency(amountDueNowOf(order))} | Exchange credit: ${formatCurrency(exchangeCreditOf(order))} | Total: ${formatCurrency(totalValue(order))}`}
    >
      <RotateCcw className="h-3 w-3" />
      Exchange
    </span>
  );
}

function CompactOrderCard({ t, order, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-xl border p-3 text-left transition hover:bg-white/10 ${priorityFor(order).className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <OrderCode order={order} />
          <div className="mt-2 truncate text-sm font-semibold text-white">{order.customer_name || t("orders.fallback.customer")}</div>
        </div>
        <StatusBadge value={order.status} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-400">
        <span>{formatDateTime(order.created_at)}</span>
        <b className="text-white">{formatCurrency(totalValue(order))}</b>
      </div>
    </button>
  );
}

function Timeline({ items }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.key} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3">
          <div className={`mt-1 h-3 w-3 rounded-full ${timelineDot(item.tone)}`} />
          <div>
            <div className="text-sm font-black text-white">{item.label}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{item.at ? formatDateTime(item.at) : "No timestamp available"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InfoTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 break-words text-sm font-bold text-white"><CurrencyText value={value || "غير متاح"} /></div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-sm font-black text-white">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function EmptyState({ icon: Icon, title, text: body, compact = false }) {
  return (
    <div className={`rounded-2xl border border-dashed border-white/10 bg-white/5 text-center ${compact ? "p-4" : "mt-3 p-10"}`}>
      <Icon className="mx-auto h-10 w-10 text-zinc-500" />
      <h3 className="mt-3 text-lg font-black text-white">{title}</h3>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
    </div>
  );
}

function QuickFilterButton({ active, onClick, label }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-bold transition ${active ? "border-blue-300/30 bg-blue-400/15 text-blue-100" : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"}`}>
      {label}
    </button>
  );
}

function Select({ value, onChange, options, label, allLabel = "All", labels = {}, t }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none">
        {options.map((option) => {
          const display = labels[option] && t ? t(labels[option]) : labels[option] || option;
          return <option key={String(option)} value={option} className="bg-zinc-950 text-white">{option === "all" ? allLabel : display}</option>;
        })}
      </select>
    </label>
  );
}

function Pager({ currentPage, totalPages, visible, total, t, setPage }) {
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-zinc-400">{t("orders.paging.showing")} {visible} {t("orders.paging.of")} {total} {t("orders.paging.records")}</div>
      <div className="flex items-center gap-2">
        <PagerButton onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} label={t("common.previous")} />
        <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300">{t("orders.paging.page")} {currentPage} / {totalPages}</span>
        <PagerButton onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} label={t("common.next")} />
      </div>
    </div>
  );
}

function PagerButton({ onClick, disabled, label }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{label}</button>;
}

function MenuButton({ icon, label, onClick, tone = "zinc", disabled = false, title = "" }) {
  const toneClass = tone === "rose" ? "text-rose-200 hover:bg-rose-500/10" : "text-zinc-200 hover:bg-white/5";
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}>
      {icon}
      {label}
    </button>
  );
}

function OrderEditModal({ t, order, saving, onClose, onSave }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!order) {
      setForm(null);
      return;
    }
    setForm({
      customer_name: order.customer_name || "",
      customer_phone: order.customer_phone || "",
      status: order.status || "قيد المراجعة",
      payment_status: order.payment_status || order.paymentStatus || "unpaid",
      source: getOrderSource(order) || order.source || order.channel || "pos",
      channel: getOrderSource(order) || order.channel || order.source || "pos",
      branch_id: order.branch_id || "",
      items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
        id: item.id,
        product_id: item.product_id || item.productId || null,
        variant_id: item.variant_id || item.variantId || null,
        product_name: item.product_name || item.name || "",
        variant_name: item.variant_name || [item.color, item.size].filter(Boolean).join(" / "),
        sku: item.sku || "",
        barcode: item.barcode || "",
        color: item.color || "",
        size: item.size || "",
        quantity: Number(item.quantity || 0),
        price: resolveOrderItemUnitPrice(item),
        discount_amount: Number(item.discount_amount || 0),
        tax_amount: Number(item.tax_amount || 0),
      })),
    });
  }, [order]);

  if (!order || !form) return null;

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateItem = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    }));
  };
  const submit = (event) => {
    event.preventDefault();
    const payload = {
      ...form,
      branch_id: form.branch_id || null,
    };
    if (form.items.length) {
      payload.items = form.items.map((item) => {
        const quantity = Math.max(0, Number(item.quantity || 0));
        const price = Math.max(0, resolveOrderItemUnitPrice(item));
        const discount = Math.max(0, Number(item.discount_amount || 0));
        return {
          ...item,
          quantity,
          price,
          discount_amount: discount,
          tax_amount: Number(item.tax_amount || 0),
          total_amount: Math.max(0, price * quantity - discount),
        };
      });
    }
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label={t("orders.edit.closeModal")} className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={submit} className="absolute left-1/2 top-1/2 flex max-h-[88vh] w-[min(58rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.edit.title")}</div>
            <h2 className="mt-1 text-xl font-black">{orderCode(order)}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <EditField label={t("orders.edit.customerName")} value={form.customer_name} onChange={(value) => updateField("customer_name", value)} />
            <EditField label={t("orders.drawer.phone")} value={form.customer_phone} onChange={(value) => updateField("customer_phone", value)} />
            <EditField label={t("orders.edit.branchId")} value={form.branch_id} onChange={(value) => updateField("branch_id", value)} />
            <EditSelect
              label={t("orders.table.status")}
              value={form.status}
              onChange={(value) => updateField("status", value)}
              options={["Pending", "Pending Confirmation", "Confirmed", "Edit Requested", "Paid", "Shipped", "Delivered", "Cancelled by Customer", "Cancelled", "Returned"]}
              labels={{
                Pending: "قيد الانتظار",
                "Pending Confirmation": "بانتظار التأكيد",
                Confirmed: "مؤكد",
                "Edit Requested": "مطلوب تعديل",
                Paid: "مدفوع",
                Shipped: "مشحون",
                Delivered: "تم التسليم",
                "Cancelled by Customer": "ملغي من العميل",
                Cancelled: "ملغي",
                Returned: "مرتجع",
              }}
              t={t}
            />
            <EditSelect
              label={t("orders.edit.paymentStatus")}
              value={form.payment_status}
              onChange={(value) => updateField("payment_status", value)}
              options={["unpaid", "pending", "awaiting_verification", "partially_paid", "paid", "cod", "rejected", "refunded"]}
              labels={{
                unpaid: "غير مدفوع",
                pending: "قيد الانتظار",
                awaiting_verification: "بانتظار المراجعة",
                partially_paid: "مدفوع جزئياً",
                paid: "مدفوع",
                cod: "الدفع عند الاستلام",
                rejected: "مرفوض",
                refunded: "مسترد",
              }}
              t={t}
            />
            <EditSelect label={t("orders.edit.sourceChannel")} value={form.source} onChange={(value) => { updateField("source", value); updateField("channel", value); }} options={SOURCE_FILTERS.filter((item) => item !== "all")} labels={SOURCE_LABELS} t={t} />
          </div>
          <Section title={t("orders.drawer.items")}>
            {form.items.length ? (
              <div className="space-y-2">
                {form.items.map((item, index) => (
                  <div key={item.id || `${item.product_id}-${item.variant_id}-${index}`} className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 md:grid-cols-[minmax(0,1fr)_6rem_7rem]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{item.product_name || t("orders.fallback.item")}</div>
                      <div className="mt-1 truncate text-xs text-zinc-400">{[item.color, item.size, item.sku].filter(Boolean).join(" / ") || item.variant_name || t("orders.fallback.variant")}</div>
                    </div>
                    <EditField type="number" min="0" label={t("orders.drawer.qty")} value={item.quantity} onChange={(value) => updateItem(index, "quantity", value)} />
                    <EditField type="number" min="0" step="0.01" label={t("orders.edit.price")} value={item.price} onChange={(value) => updateItem(index, "price", value)} />
                  </div>
                ))}
              </div>
            ) : <EmptyState icon={PackageOpen} title={t("orders.drawer.noItemData")} text={t("orders.edit.noItemDataText")} compact />}
          </Section>
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-white/10 p-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold hover:bg-white/10">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? t("orders.edit.saving") : t("orders.edit.saveOrder")}</button>
        </footer>
      </form>
    </div>
  );
}

function CancelOrderModal({ t, order, cancelling, onClose, onConfirm }) {
  const selectedOrder = order;
  const cancelLoading = cancelling;
  const canSubmitCancelRestore =
    Boolean(selectedOrder) &&
    !cancelLoading;

  if (ORDERS_DEBUG) console.log("[cancel-restore-debug]", {
    selectedOrderId: selectedOrder?.id,
    itemCount: Array.isArray(selectedOrder?.items) ? selectedOrder.items.length : 0,
    cancelLoading,
    canSubmitCancelRestore,
  });

  if (!selectedOrder) return null;
  const items = Array.isArray(selectedOrder.items) ? selectedOrder.items : [];
  const itemCount = items.length;
  const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label={t("orders.cancel.closeModal")} className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <section className="absolute left-1/2 top-1/2 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-rose-400/25 bg-zinc-950 p-5 text-white shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-rose-500/15 p-2 text-rose-200"><RotateCcw className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="text-lg font-black">{t("orders.cancel.title")}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{t("orders.cancel.description")}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <ConfirmMetric label={t("orders.cancel.order")} value={orderCode(selectedOrder)} />
          <ConfirmMetric label={t("orders.drawer.customer")} value={selectedOrder.customer_name || t("orders.fallback.customer")} />
          <ConfirmMetric label={t("orders.table.total")} value={formatCurrency(totalValue(selectedOrder))} />
          <ConfirmMetric label={t("orders.cancel.itemsUnits")} value={t("orders.cancel.itemsUnitsValue", { items: itemCount, units: totalUnits })} />
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={cancelLoading} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold hover:bg-white/10 disabled:opacity-60">{t("common.close")}</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSubmitCancelRestore}
            className={`rounded-xl px-4 py-2 text-sm font-black text-white transition-all duration-200 ${canSubmitCancelRestore ? "bg-rose-500 shadow-lg shadow-rose-950/25 hover:bg-rose-400 hover:shadow-rose-500/20" : "cursor-not-allowed bg-rose-500/35 opacity-55"}`}
          >
            {cancelLoading ? t("orders.cancel.cancelling") : t("orders.cancel.confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ArchiveOrderModal({ t, order, archiving, onClose, onConfirm }) {
  if (!order) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label={t("orders.archive.closeModal")} className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <section className="absolute left-1/2 top-1/2 w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/10 p-2 text-zinc-200"><Trash2 className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="text-lg font-black">{t("orders.archive.title")}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{t("orders.archive.description", { order: orderCode(order) })}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={archiving} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold hover:bg-white/10 disabled:opacity-60">{t("common.close")}</button>
          <button type="button" onClick={onConfirm} disabled={archiving} className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60">{archiving ? t("orders.archive.archiving") : t("orders.archive.title")}</button>
        </div>
      </section>
    </div>
  );
}

function PermanentDeleteOrderModal({ t, order, value, deleting, onChange, onClose, onConfirm }) {
  if (!order) return null;
    const canConfirm = value.trim() === "DELETE" || value.trim() === "حذف";
  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label={tt(t, "orders.permanentDelete.closeModal", "إغلاق نافذة الحذف النهائي")} className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <section className="absolute left-1/2 top-1/2 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-rose-400/35 bg-zinc-950 p-5 text-white shadow-2xl shadow-rose-950/20">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-rose-500/15 p-2 text-rose-200"><Trash2 className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="text-lg font-black">{tt(t, "orders.permanentDelete.title", "حذف نهائي")}</h2>
            <p className="mt-2 text-sm leading-6 text-rose-100">
              {tt(t, "orders.permanentDelete.description", "سيتم حذف الفاتورة نهائياً ولا يمكن التراجع عن ذلك.")}
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-300">
              {tt(t, "orders.permanentDelete.stockNote", "ستُزال السجلات المرتبطة وسيُعاد المخزون إذا لم تتم استعادته مسبقاً.")}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <ConfirmMetric label={tt(t, "orders.cancel.order", "Order")} value={orderCode(order)} />
          <ConfirmMetric label={t("orders.table.total")} value={formatCurrency(totalValue(order))} />
        </div>
        <label className="mt-5 block">
          <div className="mb-1.5 text-xs font-black text-rose-100">{tt(t, "orders.permanentDelete.typeConfirm", "اكتب DELETE أو حذف للتأكيد")}</div>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
            className="w-full rounded-xl border border-rose-400/30 bg-black/35 px-3 py-2.5 text-sm font-black text-white outline-none placeholder:text-zinc-600 focus:border-rose-300"
            placeholder="DELETE"
          />
        </label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={deleting} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold hover:bg-white/10 disabled:opacity-60">{t("common.close")}</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || deleting}
            className={`rounded-xl px-4 py-2 text-sm font-black text-white transition-all duration-200 ${canConfirm && !deleting ? "bg-rose-600 shadow-lg shadow-rose-950/25 hover:bg-rose-500" : "cursor-not-allowed bg-rose-500/35 opacity-55"}`}
          >
            {deleting ? tt(t, "orders.permanentDelete.deleting", "جاري الحذف...") : tt(t, "orders.permanentDelete.confirm", "حذف نهائي")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ConfirmMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-white"><CurrencyText value={value} /></div>
    </div>
  );
}

function EditField({ label, value, onChange, type = "text", ...props }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <input {...props} type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none" />
    </label>
  );
}

function EditSelect({ label, value, onChange, options, labels = {}, t }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <select value={value || ""} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none">
        {options.map((option) => <option key={option} value={option} className="bg-zinc-950 text-white">{labels[option] && t ? t(labels[option]) : labels[option] || option}</option>)}
      </select>
    </label>
  );
}

function TableSkeleton() {
  return (
    <div className="mt-3 space-y-2">
      {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/5" />)}
    </div>
  );
}

const timelineDot = (tone) => ({
  amber: "bg-amber-300 shadow-[0_0_0_4px_rgba(251,191,36,0.12)]",
  orange: "bg-orange-300 shadow-[0_0_0_4px_rgba(251,146,60,0.12)]",
  emerald: "bg-emerald-300 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]",
  rose: "bg-rose-300 shadow-[0_0_0_4px_rgba(251,113,133,0.12)]",
  blue: "bg-blue-300 shadow-[0_0_0_4px_rgba(96,165,250,0.12)]",
  cyan: "bg-cyan-300 shadow-[0_0_0_4px_rgba(34,211,238,0.12)]",
}[tone] || "bg-zinc-400");

export default OrdersDashboard;



