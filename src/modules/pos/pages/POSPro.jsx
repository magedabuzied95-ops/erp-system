import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import toast from "react-hot-toast";
import {
  AlertTriangle,
  Camera,
  X,
  LogOut,
  ChevronRight,
  Loader2,
  MessageCircle,
  FileDown,
  Printer,
  Maximize2,
  Minimize2,
  Image as ImageIcon,
  Search,
  SlidersHorizontal,
  RotateCcw,
  Banknote,
  CheckCircle2,
  BadgeCheck,
  Clock3,
  History,
  ShieldCheck,
  ShoppingBag,
  Package2,
  Minus,
  Plus,
  Store,
  UserCheck,
  User,
  Warehouse,
  ReceiptText,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import useDismissableLayer from "../../../shared/hooks/useDismissableLayer";
import { useRealtimeFeedback } from "../../../hooks/useRealtimeFeedback";
import { getCurrentTenant, getCurrentUser, hasPermission, isAdminUser } from "../../../shared/auth/authStorage";
import { displayPublicOrderNumber } from "../../../shared/utils/publicOrderNumber";
import { useProductClassifications } from "../../products/hooks/useProductClassifications";
import {
  classificationGroupsToFieldOptions,
  normalizeClassificationValue,
} from "../../products/lib/productClassifications";
import {
  getLoyaltyCustomerById,
  validateLoyaltyRedemption,
} from "../../loyalty/loyaltyApi";
import { getProductByQrToken, getProductsWithVariants } from "../../products/services/productsApi";
import {
  calcTotals,
  clearPosPersistedState,
  derivePaymentSummary,
  formatCurrency,
  generateInvoiceNumber,
  pickFirstVariant,
  readPosCart,
  readPosPersistedState,
  readPosSession,
  writePosCart,
  writePosPersistedState,
  writePosSession,
} from "../lib/posUtils";
import { POS_ARABIC_TEXT, safeArabicText } from "../lib/arabicText";
import { normalizePhone } from "../lib/phoneSearch";
import { normalizePosCatalogProduct, normalizePosSellableProducts, resolvePosImageUrl } from "../services/posProductsApi";
import { normalizeSaleModeSettings } from "../../../shared/lib/saleMode";
import { logPagePerf } from "../../../shared/lib/perfDebug";
import { buildLoyaltyReceiptMessage, buildLoyaltyReceiptWhatsappUrl, normalizeReceiptPhone } from "../lib/whatsappReceiptMessage.js";
import { buildPageTitle } from "../../../shared/hooks/usePageTitle";
import { getCrocsSizeInputDisplayLabel, isCrocsProductType } from "../../products/lib/variantBulkSizes";
import BarcodeScanner, { barcodeScannerMessages } from "../../../components/BarcodeScanner";
import ProductGrid from "../components/ProductGrid";
import CartSidebar, { ReceiptPreview } from "../components/CartSidebar";
import ProductAvailabilityModal from "../components/ProductAvailabilityModal";
import SmartPosFilters from "../components/SmartPosFilters";
import { CurrencyText } from "../../../shared/components/CurrencyAmount";
import { MobileBottomSheet, StickyMobileActionBar } from "../../../shared/components/mobile/ResponsiveMobile";

const RecentOperationsDrawer = lazy(async () => {
  const startedAt = performance.now();
  const module = await import("../components/RecentOperationsDrawer");
  logPagePerf("pos.recent-operations-drawer", startedAt, { heavy_component_load_ms: Math.round(performance.now() - startedAt) });
  return module;
});

const defaultState = {
  search: "",
  selectedMainCategoryId: "all",
  selectedSubCategoryId: "all",
  selectedChildCategoryId: "all",
  selectedBrandId: "all",
  selectedManufacturerId: "all",
  selectedGender: "all",
  selectedProductType: "all",
  selectedGrade: "all",
  customerSearch: "",
  paymentMode: "cash",
  cashAmount: 0,
  cardAmount: 0,
  walletAmount: 0,
  vodafoneCashAmount: 0,
  customerWalletAmount: 0,
  invoiceDiscountType: "fixed",
  invoiceDiscountValue: 0,
  invoiceDiscountReason: "",
  invoiceDiscount: 0,
  serviceFee: 0,
  quickCustomer: { name: "", phone: "", source_key: "", allow_personal_transactions: false },
  personalSettlementType: "",
  personalNote: "",
};

const isBrowser = () => typeof window !== "undefined";
const isMobileViewport = () => isBrowser() && window.matchMedia?.("(max-width: 1023px)")?.matches;
const isStandaloneDisplayMode = () =>
  isBrowser() && (window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone === true);

const POS_LAST_SALESPERSON_KEY = "pos.lastSalespersonId";
const POS_USE_SALE_PRICES_KEY = "pos.useSalePrices";
const POS_MANIFEST_HREF = "/pos-manifest.webmanifest";
const POS_APP_TITLE = buildPageTitle("POS");
const POS_APP_SHORT_TITLE = "POS";
const POS_THEME_COLOR = "#07111f";
const POS_STATUS_BAR_STYLE = "black-translucent";
const POS_TOUCH_ICON_HREF = "/icons/pos-180.png";
const POS_GLOBAL_BARCODE_MIN_LENGTH = 6;
const POS_GLOBAL_BARCODE_MAX_DURATION_MS = 500;
const POS_CHECKOUT_DEBUG = Boolean(
  import.meta.env?.DEV ||
  String(import.meta.env?.VITE_POS_CHECKOUT_DEBUG || "").trim().toLowerCase() === "true" ||
  String(import.meta.env?.VITE_POS_DEBUG || "").trim().toLowerCase() === "true"
);
const quickExpenseDefaults = { category: "delivery", employee_id: "", amount: "", payment_method: "cash", notes: "" };
const quickExpenseEmployeeAdvanceOption = { value: "employee_advance", label: "سلفة موظف / Employee Advance" };
const quickExpenseCategories = [
  { value: "delivery", label: "توصيل / Delivery" },
  { value: "snacks", label: "سناكس / Snacks" },
  { value: "cleaning", label: "تنظيف / Cleaning" },
  { value: "small_purchases", label: "مشتريات بسيطة" },
  { value: "water", label: "مياه / Water" },
  { value: "electricity", label: "كهرباء / Electricity" },
  { value: "shipping", label: "شحن / Shipping" },
  { value: "maintenance", label: "صيانة / Maintenance" },
  { value: "other", label: "أخرى / Other" },
];

const readLastSalespersonId = () => {
  try {
    return String(window.localStorage.getItem(POS_LAST_SALESPERSON_KEY) || "");
  } catch {
    return "";
  }
};

const writeLastSalespersonId = (salespersonId) => {
  try {
    if (salespersonId) window.localStorage.setItem(POS_LAST_SALESPERSON_KEY, String(salespersonId));
    else window.localStorage.removeItem(POS_LAST_SALESPERSON_KEY);
  } catch {
    // This is a cashier convenience only; checkout must continue.
  }
};

const readUseSalePrices = () => {
  try {
    const saved = window.localStorage.getItem(POS_USE_SALE_PRICES_KEY);
    if (saved === "false" || saved === "0") return false;
    if (saved === "true" || saved === "1") return true;
  } catch {
    // Persisted POS preferences are best-effort only.
  }
  return true;
};

const parseSaleModeEnabled = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const writeUseSalePrices = (value) => {
  try {
    window.localStorage.setItem(POS_USE_SALE_PRICES_KEY, String(Boolean(value)));
  } catch {
    // Persisted POS preferences are best-effort only.
  }
};

const getHeadMetaContent = (name) => {
  if (typeof document === "undefined") return "";
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") || "";
};

const isEditableKeyTarget = (target) => {
  if (!target || typeof target !== "object") return false;
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  const tagName = String(target.tagName || "").toLowerCase();
  if (target.isContentEditable) return true;
  if (["input", "textarea", "select"].includes(tagName)) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
};

const setHeadMetaContent = (name, content) => {
  if (typeof document === "undefined") return null;
  let meta = document.querySelector(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", name);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
  return meta;
};

const restoreHeadMetaContent = (name, content, hadExistingMeta) => {
  if (typeof document === "undefined") return;
  const meta = document.querySelector(`meta[name="${name}"]`);
  if (!hadExistingMeta && !content) {
    meta?.remove();
    return;
  }
  if (content || hadExistingMeta) {
    setHeadMetaContent(name, content);
  }
};

const getActiveFullscreenElement = () => {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
};

const getPosCustomerModalRuntime = () => {
  if (typeof window === "undefined") {
    return {
      viewportWidth: 0,
      viewportHeight: 0,
      mode: "server",
      fullscreen: false,
      browserFullscreen: false,
    };
  }
  const viewportWidth = Math.round(window.innerWidth || 0);
  const viewportHeight = Math.round(window.innerHeight || 0);
  const fullscreen = Boolean(getActiveFullscreenElement());
  const browserFullscreen = Boolean(
    window.screen &&
    viewportHeight >= Math.max(0, Number(window.screen.availHeight || window.screen.height || 0) - 8)
  );
  return {
    viewportWidth,
    viewportHeight,
    mode: viewportWidth < 640 ? "mobile" : fullscreen || browserFullscreen ? "fullscreen" : "desktop",
    fullscreen,
    browserFullscreen,
  };
};

const POS_PHONE_INPUT_PATTERN = /^[+\d\s\-()]+$/;
const POS_PHONE_FIELDS = ["phone", "mobile", "whatsapp", "customer_phone", "primary_phone"];

const getPosPhoneExactVariants = (value = "") => {
  const raw = normalizePhone(value);
  if (!raw || !POS_PHONE_INPUT_PATTERN.test(String(value || "").trim())) return [];
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return [];

  const variants = new Set([digits]);
  if (digits.startsWith("20") && digits.length > 2) {
    const local = digits.slice(2);
    variants.add(local);
    variants.add(`0${local}`);
  }
  if (digits.startsWith("0") && digits.length > 1) {
    const withoutZero = digits.slice(1);
    variants.add(withoutZero);
    variants.add(`20${withoutZero}`);
  }
  if (digits.startsWith("1")) {
    variants.add(`0${digits}`);
    variants.add(`20${digits}`);
  }
  return Array.from(variants).filter(Boolean);
};

const isPosPhoneLikeSearch = (value = "") => getPosPhoneExactVariants(value).length > 0;

const customerMatchesPhoneVariants = (customer = {}, inputVariants = []) => {
  if (!inputVariants.length) return false;
  const querySet = new Set(inputVariants);
  return POS_PHONE_FIELDS.some((field) =>
    getPosPhoneExactVariants(customer?.[field] || "").some((variant) => querySet.has(variant))
  );
};

const WALK_IN_CUSTOMER = {
  id: null,
  name: "Walk-in Customer",
  type: "walk_in",
};

const normalizeInvoiceDiscountType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "percentage" || normalized === "percent" ? "percentage" : "fixed";
};

const calculateInvoiceDiscountAmount = ({ subtotal = 0, type = "fixed", value = 0 } = {}) => {
  const safeSubtotal = Math.max(0, Number(subtotal || 0));
  const safeValue = Math.max(0, Number(value || 0));
  const rawDiscount = normalizeInvoiceDiscountType(type) === "percentage"
    ? safeSubtotal * (Math.min(100, safeValue) / 100)
    : safeValue;
  return Number(Math.min(safeSubtotal, Math.max(0, rawDiscount)).toFixed(2));
};

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.detail ||
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.responseBody?.detail ||
  error?.responseBody?.message ||
  error?.responseBody?.error ||
  error?.message ||
  fallback;

const resolveCheckoutItemUnitPrice = (item = {}) => {
  const candidates = [
    item.unit_price,
    item.unitPrice,
    item.price,
    item.sale_price,
    item.salePrice,
    item.final_price,
    item.finalPrice,
    item.variant_price,
    item.variantPrice,
    item.selling_price,
    item.sellingPrice,
  ];
  const numbers = candidates
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numbers.find((value) => value > 0) ?? numbers[0] ?? 0;
};

const isForbiddenError = (error) => Number(error?.status || error?.response?.status || 0) === 403;

const normalizeCheckoutOrderResponse = (response = {}) => {
  const root = response?.data ?? response ?? {};
  const data = root?.data ?? root;
  const order = data?.order ?? root?.order ?? data?.invoice ?? root?.invoice ?? data;
  const orderObject = order && typeof order === "object" ? order : {};
  const invoiceNumber =
    orderObject.invoice_number ||
    orderObject.invoiceNumber ||
    data?.invoice_number ||
    data?.invoiceNumber ||
    root?.invoice_number ||
    root?.invoiceNumber ||
    (orderObject.id ? `INV-${orderObject.id}` : "");
  const orderId =
    orderObject.order_id ||
    orderObject.orderId ||
    orderObject.id ||
    data?.order_id ||
    data?.orderId ||
    data?.id ||
    root?.order_id ||
    root?.orderId ||
    root?.id ||
    null;
  const publicToken =
    orderObject.public_token ||
    orderObject.publicToken ||
    data?.public_token ||
    data?.publicToken ||
    root?.public_token ||
    root?.publicToken ||
    "";
  const publicOrderNumber =
    orderObject.public_order_number ||
    orderObject.display_order_number ||
    data?.public_order_number ||
    data?.display_order_number ||
    root?.public_order_number ||
    root?.display_order_number ||
    displayPublicOrderNumber(orderObject);

  return {
    raw: root,
    data,
    order: orderObject,
    invoiceNumber,
    publicOrderNumber,
    orderId,
    publicToken,
    loyalty: data?.loyalty ?? root?.loyalty ?? orderObject?.loyalty ?? {},
    wallet: data?.wallet ?? root?.wallet ?? orderObject?.wallet ?? {},
    publicInvoiceUrl:
      orderObject.public_invoice_url ||
      orderObject.publicInvoiceUrl ||
      orderObject.invoice_public_url ||
      data?.public_invoice_url ||
      data?.publicInvoiceUrl ||
      data?.invoice_public_url ||
      root?.public_invoice_url ||
      root?.publicInvoiceUrl ||
      root?.invoice_public_url ||
      "",
    publicInvoiceShortUrl:
      orderObject.public_invoice_short_url ||
      orderObject.shortInvoiceUrl ||
      orderObject.short_invoice_url ||
      data?.public_invoice_short_url ||
      data?.shortInvoiceUrl ||
      data?.short_invoice_url ||
      root?.public_invoice_short_url ||
      root?.shortInvoiceUrl ||
      root?.short_invoice_url ||
      "",
  };
};

const isFullVariationMode = (value) => String(value || "").trim().toLowerCase() === "full_variations";

const isRealVariantId = (value) =>
  value !== undefined && value !== null && value !== "" && !String(value).startsWith("product:");

const parsePaymentBreakdownRows = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizePaymentMethodKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const resolveEditOrderTotal = (order = {}) => {
  const candidates = [
    order.original_total,
    order.originalTotal,
    order.total_amount,
    order.totalAmount,
    order.total,
    order.total_price,
    order.totalPrice,
    order.grand_total,
    order.grandTotal,
  ];
  const resolved = candidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  return Math.max(0, resolved || 0);
};

const sumOriginalCollectedPayments = (order = {}) => {
  const originalRows = parsePaymentBreakdownRows(order.original_payment_breakdown ?? order.originalPaymentBreakdown);
  const rows = originalRows.length
    ? originalRows
    : parsePaymentBreakdownRows(order.payment_breakdown ?? order.paymentBreakdown ?? order.payments);
  const seenRows = new Set();
  return rows.reduce((sum, payment, index) => {
    if (!payment || typeof payment !== "object") return sum;
    const rowKey = payment.id || payment.payment_id || `${index}:${payment.method || payment.payment_method}:${payment.amount}`;
    if (seenRows.has(rowKey)) return sum;
    seenRows.add(rowKey);
    const method = normalizePaymentMethodKey(payment.method || payment.payment_method);
    if (method === "exchange_credit" || method === "return_credit" || payment.edit_additional_payment) return sum;
    const amount = Number(payment.amount ?? payment.paid_amount ?? payment.value ?? 0);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
};

const resolveOriginalCollectedAmount = (order = {}) => {
  const candidates = [
    order.original_paid_amount,
    order.originalPaidAmount,
    order.total_paid,
    order.totalPaid,
    order.amount_paid,
    order.amountPaid,
    order.payment_paid_amount,
    order.paymentPaidAmount,
    order.paid_amount,
    order.paidAmount,
    order.payment?.paid_amount,
    order.payment?.paidAmount,
  ];
  const explicitAmount = candidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  if (explicitAmount > 0) return Math.max(0, explicitAmount);

  const breakdownAmount = sumOriginalCollectedPayments(order);
  if (breakdownAmount > 0) return Math.max(0, breakdownAmount);

  const status = normalizePaymentMethodKey(order.original_payment_status || order.originalPaymentStatus || order.payment_status || order.paymentStatus);
  const total = resolveEditOrderTotal(order);
  if (total > 0 && ["paid", "completed", "complete", "settled"].includes(status)) return total;
  return 0;
};

const resolveCheckoutVariantId = (item = {}) => {
  const variantId = item.variant_id ?? item.variantId ?? null;
  if (!isRealVariantId(variantId)) return null;
  if (!isFullVariationMode(item.variation_mode) && String(variantId) === String(item.product_id || "")) return null;
  return variantId;
};

const resolvePublicInvoiceUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (typeof window !== "undefined") {
    return new URL(raw, window.location.origin).toString();
  }
  return raw;
};

const resolveShortPublicInvoiceUrl = ({ shortInvoiceUrl, publicToken, publicInvoiceUrl, invoiceUrl } = {}) => {
  const resolvedCandidates = [invoiceUrl, publicInvoiceUrl, shortInvoiceUrl]
    .map((value) => resolvePublicInvoiceUrl(value))
    .filter(Boolean);

  const publicCandidate = resolvedCandidates.find((value) => /\/invoice\/[^/]+$/i.test(String(value)));
  if (publicCandidate) return publicCandidate;

  const token = String(publicToken || "").trim();
  if (token) {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(token)}`;
    }

    return `/invoice/${encodeURIComponent(token)}`;
  }

  return resolvedCandidates[0] || "";
};

const resolveReceiptInvoiceUrl = (context = {}) =>
  resolveShortPublicInvoiceUrl({
    invoiceUrl: context.invoiceUrl || context.public_invoice_url || context.publicInvoiceUrl,
    shortInvoiceUrl:
      context.shortInvoiceUrl ||
      context.public_invoice_short_url ||
      context.short_invoice_url ||
      context.publicInvoiceUrl,
    publicToken: context.publicToken || context.public_token,
    publicInvoiceUrl: context.publicInvoiceUrl || context.public_invoice_url,
  });

const MARKETING_ATTRIBUTION_KEY = "erp.marketing.attribution";

const MARKETING_ATTRIBUTION_OPTIONS = [
  { value: "facebook_post", label: "Facebook" },
  { value: "instagram_post", label: "Instagram" },
  { value: "instagram_story", label: "Story" },
  { value: "tiktok", label: "TikTok" },
  { value: "whatsapp_campaign", label: "WhatsApp" },
  { value: "other", label: "Other" },
];

const normalizeMarketingSourceKey = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["facebook", "fb", "facebook_post"].includes(raw)) return "facebook_post";
  if (["instagram", "ig", "instagram_post"].includes(raw)) return "instagram_post";
  if (["story", "instagram_story"].includes(raw)) return "instagram_story";
  if (["tiktok", "tk"].includes(raw)) return "tiktok";
  if (["whatsapp", "wa", "whatsapp_campaign"].includes(raw)) return "whatsapp_campaign";
  if (raw === "other") return "other";
  if (raw === "post") return "";
  return raw;
};

const readMarketingAttributionState = () => {
  if (typeof window === "undefined") {
    return {
      source_key: "",
      marketing_source: "",
      marketing_platform: "",
      marketing_campaign: "",
      marketing_post_id: "",
      marketing_tracking_code: "",
      marketing_session_id: "",
      attribution_type: "",
    };
  }

  try {
    const raw = window.localStorage.getItem(MARKETING_ATTRIBUTION_KEY);
    if (!raw) {
      return {
        source_key: "",
        marketing_source: "",
        marketing_platform: "",
        marketing_campaign: "",
        marketing_post_id: "",
        marketing_tracking_code: "",
        marketing_session_id: "",
        attribution_type: "",
      };
    }
    const parsed = JSON.parse(raw);
    return {
      source_key: normalizeMarketingSourceKey(parsed.source_key || parsed.attribution_type || parsed.marketing_source || parsed.marketing_platform || ""),
      marketing_source: String(parsed.marketing_source || ""),
      marketing_platform: String(parsed.marketing_platform || parsed.marketing_source || ""),
      marketing_campaign: String(parsed.marketing_campaign || ""),
      marketing_post_id: String(parsed.marketing_post_id || ""),
      marketing_tracking_code: String(parsed.marketing_tracking_code || ""),
      marketing_session_id: String(parsed.marketing_session_id || ""),
      attribution_type: String(parsed.attribution_type || parsed.source_key || ""),
    };
  } catch {
    return {
      source_key: "",
      marketing_source: "",
      marketing_platform: "",
      marketing_campaign: "",
      marketing_post_id: "",
      marketing_tracking_code: "",
      marketing_session_id: "",
      attribution_type: "",
    };
  }
};

const writeMarketingAttributionState = (value) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKETING_ATTRIBUTION_KEY, JSON.stringify(value || {}));
  } catch {
    // Attribution memory is a convenience only.
  }
};

const resolveMarketingAttributionFromSelection = (sourceKey = "", current = {}) => {
  const normalized = normalizeMarketingSourceKey(sourceKey);
  if (!normalized) {
    return {
      source_key: "",
      marketing_source: "",
      marketing_platform: "",
      marketing_campaign: String(current.marketing_campaign || ""),
      marketing_post_id: String(current.marketing_post_id || ""),
      marketing_tracking_code: String(current.marketing_tracking_code || ""),
      marketing_session_id: String(current.marketing_session_id || ""),
      attribution_type: "",
    };
  }
  const base = {
    source_key: normalized,
    marketing_source: "other",
    marketing_platform: "other",
    marketing_campaign: String(current.marketing_campaign || ""),
    marketing_post_id: String(current.marketing_post_id || ""),
    marketing_tracking_code: String(current.marketing_tracking_code || ""),
    marketing_session_id: String(current.marketing_session_id || ""),
    attribution_type: normalized,
  };

  if (normalized === "facebook_post") {
    return { ...base, marketing_source: "facebook", marketing_platform: "facebook", attribution_type: "facebook_post" };
  }
  if (normalized === "instagram_post") {
    return { ...base, marketing_source: "instagram", marketing_platform: "instagram", attribution_type: "instagram_post" };
  }
  if (normalized === "instagram_story") {
    return { ...base, marketing_source: "story", marketing_platform: "instagram", attribution_type: "story" };
  }
  if (normalized === "tiktok") {
    return { ...base, marketing_source: "tiktok", marketing_platform: "tiktok", attribution_type: "tiktok" };
  }
  if (normalized === "whatsapp_campaign") {
    return { ...base, marketing_source: "whatsapp", marketing_platform: "whatsapp", attribution_type: "whatsapp_campaign" };
  }

  return base;
};

const resolveMarketingAttributionPayload = (attribution = {}) => {
  const selection = resolveMarketingAttributionFromSelection(attribution.source_key || attribution.attribution_type || "other", attribution);
  return {
    marketing_source: selection.marketing_source || null,
    marketing_platform: selection.marketing_platform || null,
    marketing_post_id: selection.marketing_post_id || null,
    marketing_campaign: selection.marketing_campaign || null,
    attribution_type: selection.attribution_type || null,
    marketing_tracking_code: selection.marketing_tracking_code || null,
    marketing_session_id: selection.marketing_session_id || null,
  };
};

const normalizeCheckoutInvoiceData = (response = {}, createdOrder = {}) => {
  const publicToken =
    response?.public_token ||
    response?.order?.public_token ||
    response?.public_invoice_token ||
    response?.order?.public_invoice_token ||
    createdOrder?.public_token ||
    createdOrder?.public_invoice_token ||
    "";

  let invoiceUrl =
    response?.public_invoice_short_url ||
    response?.public_invoice_url ||
    response?.invoice_public_url ||
    response?.short_invoice_url ||
    response?.order?.public_invoice_short_url ||
    response?.order?.public_invoice_url ||
    response?.order?.invoice_public_url ||
    createdOrder?.public_invoice_short_url ||
    createdOrder?.public_invoice_url ||
    createdOrder?.invoice_public_url ||
    "";

  if (!invoiceUrl && publicToken) {
    if (typeof window !== "undefined" && window.location?.origin) {
      invoiceUrl = `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(publicToken)}`;
    } else {
      invoiceUrl = `/invoice/${encodeURIComponent(publicToken)}`;
    }
  }

  if (import.meta.env.DEV && !invoiceUrl) {
    console.log("[checkout response]", response);
    console.log("[normalized invoice url]", invoiceUrl);
    console.log("[normalized public token]", publicToken);
  }

  return {
    invoiceUrl,
    publicToken,
  };
};

const normalizeStockQuantity = (value) => Math.max(0, Number(value ?? 0) || 0);

const getVariantStockQuantity = (variant = {}) =>
  normalizeStockQuantity(
    variant.stock_quantity ??
      variant.stock ??
      variant.quantity ??
      variant.qty ??
      variant.available_quantity ??
      variant.inventory_quantity ??
      variant.current_stock
  );

const firstTextValue = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const firstImageValue = (...values) => {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      const nested = firstImageValue(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === "object") {
      const nested = firstImageValue(
        value.image_url,
        value.image,
        value.url,
        value.path,
        value.preview,
        value.thumbnail,
        value.secure_url
      );
      if (nested) return nested;
      continue;
    }
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const getDisplayImageUrl = (...values) => resolvePosImageUrl(firstTextValue(...values));

const getProductVisibleStock = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0) {
    return variants.reduce((sum, variant) => sum + getVariantStockQuantity(variant), 0);
  }

  return normalizeStockQuantity(
    product.total_stock ??
      product.stock ??
      product.quantity ??
      product.qty ??
      product.available_quantity ??
      product.inventory_quantity ??
      product.current_stock
  );
};

const isInactiveProductValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["inactive", "disabled", "archived", "draft", "unavailable"].includes(normalized);
};

const isVisiblePosProduct = (product = {}) => {
  if (!product) return false;

  const status = String(product.status || product.state || product.availability_status || "").trim().toLowerCase();
  if (
    product.active === false ||
    product.enabled === false ||
    product.is_active === false ||
    product.disabled === true ||
    isInactiveProductValue(status)
  ) {
    return false;
  }

  return getProductVisibleStock(product) > 0;
};

const getCatalogProductId = (product = {}) => String(product?.product_id ?? product?.id ?? "");

const getCatalogVariantId = (variant = {}) => String(variant?.variant_id ?? variant?.variantId ?? variant?.id ?? "");

const normalizeCatalogVariant = (variant = {}) => {
  const stockQuantity = getVariantStockQuantity(variant);
  return {
    ...variant,
    stock: stockQuantity,
    stock_quantity: stockQuantity,
    available: stockQuantity > 0,
  };
};

const normalizeCatalogProduct = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants.map((variant) => normalizeCatalogVariant(variant)) : [];
  const stock = variants.reduce((sum, variant) => sum + Number(variant.stock_quantity ?? variant.stock ?? 0), 0);
  return {
    ...product,
    variants,
    total_stock: stock,
    stock,
  };
};

const getCatalogProductById = (products = [], productId) =>
  Array.isArray(products)
    ? products.find((item) => String(item?.product_id ?? item?.id ?? "") === String(productId ?? ""))
    : null;

const getCatalogVariantById = (product, variantId, color, size) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const exact = variants.find((variant) => String(getCatalogVariantId(variant)) === String(variantId ?? ""));
  if (exact) return exact;

  const byColorSize = variants.find(
    (variant) =>
      String(variant.color || "").toLowerCase() === String(color || "").toLowerCase() &&
      String(variant.size || "").toLowerCase() === String(size || "").toLowerCase()
  );
  if (byColorSize) return byColorSize;

  return variants[0] || null;
};

const getProductSelectionMatch = (product = {}) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const matchedVariantId = String(product?.matched_variant_id ?? product?.matchedVariantId ?? "").trim();
  const matchedColor = String(product?.matched_color ?? product?.matchedColor ?? "").trim();
  const matchedColorLower = matchedColor.toLowerCase();

  const matchedVariant =
    (matchedVariantId && variants.find((variant) => String(getCatalogVariantId(variant)) === matchedVariantId)) ||
    (matchedColorLower
      ? variants.find((variant) => String(variant?.color || "").trim().toLowerCase() === matchedColorLower)
      : null) ||
    variants.find((variant) => Number(normalizeStockQuantity(variant.stock_quantity ?? variant.stock)) > 0) ||
    variants[0] ||
    null;

  const matchedColorValue = String(matchedVariant?.color || matchedColor || "").trim();
  return {
    matchedVariant,
    matchedColor: matchedColorValue,
    matchedVariantId: matchedVariant?.variant_id ?? matchedVariant?.variantId ?? matchedVariant?.id ?? (matchedVariantId || null),
    matchedSize: String(matchedVariant?.size || "").trim(),
  };
};

const getCatalogItemStock = (products = [], item = {}) => {
  const productId = item.product_id ?? item.productId ?? null;
  const variantId = resolveCheckoutVariantId(item);
  const product = getCatalogProductById(products, productId);
  if (!product) return 0;

  if (isFullVariationMode(item.variation_mode) && variantId !== null) {
    const variant = getCatalogVariantById(product, variantId, item.color, item.size);
    return normalizeStockQuantity(variant?.stock_quantity ?? variant?.stock);
  }

  if (variantId !== null) {
    const variant = getCatalogVariantById(product, variantId, item.color, item.size);
    if (variant) {
      return normalizeStockQuantity(variant.stock_quantity ?? variant.stock);
    }
  }

  return normalizeStockQuantity(product.total_stock ?? product.stock);
};

const getCatalogItemPrice = (products = [], item = {}) => {
  const productId = item.product_id ?? item.productId ?? null;
  const variantId = resolveCheckoutVariantId(item);
  const product = getCatalogProductById(products, productId);
  if (!product) return Number(item.price || 0);
  const variant = variantId !== null ? getCatalogVariantById(product, variantId, item.color, item.size) : null;
  return Number(variant?.price ?? variant?.final_price ?? product.price ?? item.price ?? 0);
};

const reconcileCartWithCatalog = (cart = [], products = []) => {
  const nextCart = [];
  const removedItems = [];
  let changed = false;

  for (const item of Array.isArray(cart) ? cart : []) {
    const liveStock = getCatalogItemStock(products, item);
    if (liveStock <= 0) {
      removedItems.push(item);
      changed = true;
      continue;
    }

    const nextQuantity = Math.min(Number(item.quantity || 0), liveStock);
    if (nextQuantity <= 0) {
      removedItems.push(item);
      changed = true;
      continue;
    }

    const livePrice = getCatalogItemPrice(products, item);
    if (nextQuantity !== Number(item.quantity || 0) || Number(item.stock || 0) !== liveStock || Number(item.price || 0) !== livePrice) {
      changed = true;
    }

    nextCart.push({
      ...item,
      stock: liveStock,
      stock_quantity: liveStock,
      original_price: Number(item.original_price || item.regular_price || item.price || 0),
      price: livePrice,
      sale_price: livePrice,
      quantity: nextQuantity,
    });
  }

  return { nextCart, removedItems, changed };
};

const applySoldItemsToCatalog = (products = [], soldItems = []) => {
  const nextProducts = Array.isArray(products)
    ? products.map((product) => normalizeCatalogProduct(product))
    : [];

  for (const soldItem of Array.isArray(soldItems) ? soldItems : []) {
    const productId = soldItem?.product_id ?? soldItem?.productId ?? null;
    const variantId = resolveCheckoutVariantId(soldItem);
    const quantity = normalizeStockQuantity(soldItem?.quantity);
    if (!productId || quantity <= 0) continue;

    const product = getCatalogProductById(nextProducts, productId);
    if (!product) continue;

    if (isFullVariationMode(soldItem?.variation_mode) && variantId !== null) {
      const variant = getCatalogVariantById(product, variantId, soldItem?.color, soldItem?.size);
      if (variant) {
        const nextStock = Math.max(0, normalizeStockQuantity(variant.stock_quantity ?? variant.stock) - quantity);
        variant.stock = nextStock;
        variant.stock_quantity = nextStock;
        variant.available = nextStock > 0;
      }
    } else if (variantId !== null) {
      const variant = getCatalogVariantById(product, variantId, soldItem?.color, soldItem?.size);
      if (variant) {
        const nextStock = Math.max(0, normalizeStockQuantity(variant.stock_quantity ?? variant.stock) - quantity);
        variant.stock = nextStock;
        variant.stock_quantity = nextStock;
        variant.available = nextStock > 0;
      }
    } else {
      const nextStock = Math.max(0, normalizeStockQuantity(product.stock) - quantity);
      product.stock = nextStock;
      product.total_stock = nextStock;
    }

    const totalStock = Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants.reduce((sum, variant) => sum + normalizeStockQuantity(variant.stock_quantity ?? variant.stock), 0)
      : normalizeStockQuantity(product.stock);
    product.total_stock = totalStock;
    product.stock = totalStock;
  }

  return nextProducts;
};

const mergeCatalogProducts = (current = [], incoming = []) => {
  const byId = new Map();
  (Array.isArray(current) ? current : []).forEach((product) => {
    const key = String(product?.product_id ?? product?.id ?? "").trim();
    if (key) byId.set(key, product);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((product) => {
    const key = String(product?.product_id ?? product?.id ?? "").trim();
    if (key) byId.set(key, product);
  });
  return Array.from(byId.values());
};

const extractOrderItemsFromResponse = (response = {}, fallbackOrder = {}) => {
  const candidates = [
    response.items,
    response.order?.items,
    response.order?.order_items,
    response.order?.invoice_items,
    response.data?.items,
    response.data?.order_items,
    response.data?.invoice_items,
    fallbackOrder.items,
    fallbackOrder.order_items,
    fallbackOrder.invoice_items,
  ];
  return candidates.find((items) => Array.isArray(items)) || [];
};

const refreshCatalogProducts = async ({ setProducts, setLoading, manageLoading = true, isActive = () => true, signal, saleModeSettings = {}, search } = {}) => {
  if (manageLoading && setLoading) {
    setLoading(true);
  }
  try {
    const rawProducts = await getProductsWithVariants({
      signal,
      ...(search !== undefined ? { params: { search } } : {}),
    });
    const catalog = normalizePosSellableProducts(rawProducts, saleModeSettings).map((product) => normalizePosCatalogProduct(product));
    if (isActive()) {
      setProducts(catalog);
    }
    return catalog;
  } finally {
    if (manageLoading && setLoading) {
      setLoading(false);
    }
  }
};

const getCustomerCreditBalance = (customer = {}, loyaltyProfile = null) => {
  const value = customer?.credit_balance ?? loyaltyProfile?.credit_balance ?? customer?.wallet_balance ?? customer?.balance ?? loyaltyProfile?.wallet_balance ?? 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePosCustomer = (customer = {}) => {
  const creditBalance = getCustomerCreditBalance(customer);
  return {
    ...customer,
    credit_balance: creditBalance,
  };
};

const normalizeCustomersResponse = (response) => {
  const payload = response?.data ?? response;
  const rows = Array.isArray(payload) ? payload :
    Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.customers) ? payload.customers :
    [];
  return rows.map(normalizePosCustomer);
};

const POS_SALE_STATS_KEY = "erp.pos.saleStats";

const normalizeSmartText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ط·آ£ط·آ¥ط·آ¢]/g, "ط·آ§")
    .replace(/ط·آ©/g, "ط¸â€،")
    .replace(/ط¸â€°/g, "ط¸ظ¹")
    .toLowerCase()
    .trim();

const normalizeSmartFilterKey = (value) =>
  normalizeSmartText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeFilterValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\s-]+/g, "_");

const normalizeAudienceValue = (value = "") => {
  const normalized = normalizeFilterValue(value);
  if (["men", "man", "male"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls"].includes(normalized)) return "kids";
  return "";
};

const getProductAudienceKeys = (product = {}) => {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|]+/)
      .map(normalizeAudienceValue)
      .filter(Boolean)
      .forEach((audience) => seen.add(audience));
  };
  visit(product.audiences);
  visit(product.product_audiences);
  visit(product.gender);
  return ["men", "women", "kids"].filter((audience) => seen.has(audience));
};

const resolveSmartFilterMatch = (value, options = []) => {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return "";
  const normalizedOptions = (Array.isArray(options) ? options : []).map((option) => ({
    ...option,
    value: normalizeFilterValue(option?.value || option?.id || option?.name || ""),
    aliases: [
      option?.value,
      option?.id,
      option?.name,
      option?.label,
      option?.label_ar,
      option?.label_en,
    ]
      .map(normalizeFilterValue)
      .filter(Boolean),
  }));
  const match = normalizedOptions.find((option) => option.aliases.includes(normalized));
  return match?.value || normalized;
};

const getProductSmartFilterValue = (product, field, options = []) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const firstVariant = variants[0] || {};
  if (field === "gender") return getProductAudienceKeys(product)[0] || resolveSmartFilterMatch(product?.gender || firstVariant.gender, options);
  const aliases = {
    productType: [
      product?.product_type,
      product?.productType,
      product?.type,
      firstVariant.product_type,
      firstVariant.productType,
      firstVariant.type,
    ],
    grade: [product?.grade, product?.product_grade, firstVariant.grade, firstVariant.product_grade],
  };

  return resolveSmartFilterMatch((aliases[field] || []).find((value) => String(value || "").trim()), options);
};

const getPosSizeDisplayLabel = (product = {}, size = "") => {
  const rawSize = String(size || "").trim();
  if (!rawSize) return "";

  const crocsSource = [
    product?.product_type,
    product?.productType,
    product?.category,
    product?.category_name,
    product?.brand,
    product?.brand_name,
    product?.type,
  ]
    .filter(Boolean)
    .join(" ");

  return isCrocsProductType(crocsSource) ? getCrocsSizeInputDisplayLabel(rawSize) || rawSize : rawSize;
};

const makeCategoryOption = (id, name) => {
  const label = String(name || "").trim();
  if (!label) return null;
  return {
    id: id ? String(id) : `name:${normalizeSmartText(label)}`,
    name: label,
  };
};

const buildProductSearchText = (product, manufacturerLookup) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return [
    product?.name,
    product?.product_name,
    product?.sku,
    product?.barcode,
    product?.category,
    product?.category_name,
    product?.category_path,
    product?.gender,
    ...getProductAudienceKeys(product),
    product?.product_type,
    product?.productType,
    product?.grade,
    product?.main_category_name,
    product?.sub_category_name,
    product?.child_category_name,
    product?.subcategory,
    product?.subcategory_name,
    product?.brand,
    product?.brand_name,
    product?.manufacturer,
    product?.manufacturer_name,
    manufacturerLookup.get(String(product?.manufacturer_id || product?.variant_manufacturer_id || "").trim()) || "",
    ...variants.flatMap((variant) => [
      variant.sku,
      variant.article_code,
      variant.color,
      variant.size,
      variant.barcode,
      variant.brand,
      variant.brand_name,
      variant.manufacturer,
      variant.manufacturer_name,
      manufacturerLookup.get(String(variant.manufacturer_id || variant.variant_manufacturer_id || "").trim()) || "",
    ]),
  ]
    .filter(Boolean)
    .map(normalizeSmartText)
    .join(" ");
};

const buildSmartMeta = (product, manufacturerLookup, classificationOptions = {}) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const manufacturerIds = new Set(
    [
      product?.manufacturer_id,
      product?.variant_manufacturer_id,
      ...variants.flatMap((variant) => [variant.manufacturer_id, variant.variant_manufacturer_id]),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const manufacturerNames = [
    product?.manufacturer,
    product?.manufacturer_name,
    ...variants.flatMap((variant) => [variant.manufacturer, variant.manufacturer_name]),
    ...Array.from(manufacturerIds).map((id) => manufacturerLookup.get(id)),
  ]
    .filter(Boolean)
    .map(normalizeSmartText);
  const brandKey = product?.brand_id ? String(product.brand_id) : product?.brand || product?.brand_name ? `name:${normalizeSmartText(product.brand || product.brand_name)}` : "";
  const mainCategory = makeCategoryOption(product?.main_category_id, product?.main_category_name || product?.main_category || product?.category_name || product?.category);
  const subCategory = makeCategoryOption(product?.sub_category_id, product?.sub_category_name || product?.sub_category);
  const childCategory = makeCategoryOption(product?.child_category_id, product?.child_category_name || product?.child_category);
  const firstVariant = variants[0] || {};
  const gender = getProductSmartFilterValue(product, "gender", classificationOptions.gender) || normalizeSmartFilterKey(getProductAudienceKeys(product)[0] || product?.gender || firstVariant.gender);
  const productType =
    getProductSmartFilterValue(product, "productType", classificationOptions.productType) ||
    normalizeSmartFilterKey(product?.product_type || product?.productType || firstVariant.product_type || firstVariant.productType);
  const grade = getProductSmartFilterValue(product, "grade", classificationOptions.grade) || normalizeSmartFilterKey(product?.grade || firstVariant.grade);

  return {
    mainCategory,
    subCategory,
    childCategory,
    brandKey,
    gender,
    productType,
    grade,
    manufacturerIds,
    manufacturerNames,
    searchText: buildProductSearchText(product, manufacturerLookup),
  };
};

const readPosSaleStats = () => {
  try {
    return JSON.parse(window.localStorage.getItem(POS_SALE_STATS_KEY) || "{}");
  } catch {
    return {};
  }
};

const writePosSaleStats = (cart) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const current = readPosSaleStats();
    const next = {
      date: current.date === today ? current.date : today,
      recent: current.date === today && Array.isArray(current.recent) ? current.recent : [],
      counts: current.date === today && current.counts ? current.counts : {},
    };

    cart.forEach((item) => {
      const productId = String(item.product_id || item.id || "").trim();
      if (!productId) return;
      next.recent = [productId, ...next.recent.filter((id) => id !== productId)].slice(0, 8);
      next.counts[productId] = Number(next.counts[productId] || 0) + Number(item.quantity || 1);
    });

    window.localStorage.setItem(POS_SALE_STATS_KEY, JSON.stringify(next));
  } catch {
    // Sale stats are a cashier shortcut only; checkout must never fail because localStorage is unavailable.
  }
};

function POSPro() {
  const pageStartedAtRef = useRef(performance.now());
  const firstDataLoggedRef = useRef(false);
  const renderLoggedRef = useRef(false);
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { emitFeedback } = useRealtimeFeedback();
  const persisted = useMemo(() => readPosPersistedState(), []);
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const routeEditOrderId = useMemo(
    () =>
      searchParams.get("editOrderId") ||
      searchParams.get("orderId") ||
      searchParams.get("invoiceId") ||
      "",
    [searchParams]
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      logPagePerf("pos", pageStartedAtRef.current, { page_mount_ms: Math.round(performance.now() - pageStartedAtRef.current) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const [products, setProducts] = useState([]);
  const [saleModeSettings, setSaleModeSettings] = useState(() => normalizeSaleModeSettings({}));
  const [saleModeSaving, setSaleModeSaving] = useState(false);
  const [manufacturers, setManufacturers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesEmployees, setSalesEmployees] = useState([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [sellersLoaded, setSellersLoaded] = useState(false);
  const [sellerLoadError, setSellerLoadError] = useState("");
  const [salesSettings, setSalesSettings] = useState({ allow_sale_without_salesperson: true, fixed_commission_mode: "fixed_per_invoice" });
  const [selectedSalespersonId, setSelectedSalespersonId] = useState("");
  const lastSalespersonIdRef = useRef(readLastSalespersonId());
  const [cart, setCart] = useState(() => readPosCart());
  const [search, setSearch] = useState(() => persisted.search || defaultState.search);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [selectedMainCategoryId, setSelectedMainCategoryId] = useState(
    () => persisted.selectedMainCategoryId || defaultState.selectedMainCategoryId
  );
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState(
    () => persisted.selectedSubCategoryId || defaultState.selectedSubCategoryId
  );
  const [selectedChildCategoryId, setSelectedChildCategoryId] = useState(
    () => persisted.selectedChildCategoryId || defaultState.selectedChildCategoryId
  );
  const [selectedBrandId, setSelectedBrandId] = useState(() => persisted.selectedBrandId || defaultState.selectedBrandId);
  const [selectedManufacturerId, setSelectedManufacturerId] = useState(
    () => persisted.selectedManufacturerId || persisted.manufacturerFilter || defaultState.selectedManufacturerId
  );
  const [selectedGender, setSelectedGender] = useState(() => persisted.selectedGender || defaultState.selectedGender);
  const [selectedProductType, setSelectedProductType] = useState(() => persisted.selectedProductType || defaultState.selectedProductType);
  const [selectedGrade, setSelectedGrade] = useState(() => persisted.selectedGrade || defaultState.selectedGrade);
  const [customerSearch, setCustomerSearch] = useState(defaultState.customerSearch);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [activePosShift, setActivePosShift] = useState(null);
  const [posShiftBranch, setPosShiftBranch] = useState(null);
  const [posShiftLoading, setPosShiftLoading] = useState(true);
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [sellerOverrideAllowed, setSellerOverrideAllowed] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState(defaultState.quickCustomer);
  const [personalSettlementType, setPersonalSettlementType] = useState(defaultState.personalSettlementType);
  const [personalNote, setPersonalNote] = useState(defaultState.personalNote);
  const [loyaltyProfile, setLoyaltyProfile] = useState(null);
  const [loyaltyValidation, setLoyaltyValidation] = useState(null);
  const [loyaltyUnavailable, setLoyaltyUnavailable] = useState(false);
  const [loyaltyRedeemPoints, setLoyaltyRedeemPoints] = useState(0);
  const [, setLoyaltyLoading] = useState(false);
  const [paymentMode, setPaymentMode] = useState(defaultState.paymentMode);
  const [editRefundMethod, setEditRefundMethod] = useState("cash");
  const [activeSplitMethod, setActiveSplitMethod] = useState("cash");
  const [cashAmount, setCashAmount] = useState(defaultState.cashAmount);
  const [cardAmount, setCardAmount] = useState(defaultState.cardAmount);
  const [walletAmount, setWalletAmount] = useState(defaultState.walletAmount);
  const [vodafoneCashAmount, setVodafoneCashAmount] = useState(defaultState.vodafoneCashAmount);
  const [customerWalletAmount, setCustomerWalletAmount] = useState(defaultState.customerWalletAmount);
  const [exchangeState, setExchangeState] = useState(null);
  const [paymentAccountStatus, setPaymentAccountStatus] = useState(null);
  const [paymentAccountLoading, setPaymentAccountLoading] = useState(false);
  const [paymentAccountRefreshKey, setPaymentAccountRefreshKey] = useState(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState(defaultState.invoiceDiscountType);
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState(defaultState.invoiceDiscountValue);
  const [invoiceDiscountReason, setInvoiceDiscountReason] = useState(defaultState.invoiceDiscountReason);
  const [invoiceDiscount, setInvoiceDiscount] = useState(defaultState.invoiceDiscount);
  const [serviceFee, setServiceFee] = useState(defaultState.serviceFee);
  const [couponCode, setCouponCode] = useState("");
  const [couponValidation, setCouponValidation] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(generateInvoiceNumber());
  const [lastOrder, setLastOrder] = useState(null);
  const [lastShareContext, setLastShareContext] = useState(null);
  const [checkoutSuccessOpen, setCheckoutSuccessOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [marketingAttribution, setMarketingAttribution] = useState(() => readMarketingAttributionState());
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [shiftReport, setShiftReport] = useState(null);
  const [shiftReportOpen, setShiftReportOpen] = useState(false);
  const [shiftCloseOpen, setShiftCloseOpen] = useState(false);
  const [shiftCloseSubmitting, setShiftCloseSubmitting] = useState(false);
  const [shiftCloseReport, setShiftCloseReport] = useState(null);
  const [actualDrawerAmount, setActualDrawerAmount] = useState("");
  const [shiftCloseNotes, setShiftCloseNotes] = useState("");
  const [shiftVarianceReason, setShiftVarianceReason] = useState("");

  const [barcodeShopProduct, setBarcodeShopProduct] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [mobileProductQuantity, setMobileProductQuantity] = useState(1);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [recentOperationsOpen, setRecentOperationsOpen] = useState(false);
  const [recentOperationsOpenedAt, setRecentOperationsOpenedAt] = useState(0);
  const [editingOrder, setEditingOrder] = useState(null);
  const [paymobTerminalState, setPaymobTerminalState] = useState(null);
  const [paymobTerminalLoading, setPaymobTerminalLoading] = useState(false);
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const [quickExpense, setQuickExpense] = useState(quickExpenseDefaults);
  const [quickExpenseSaving, setQuickExpenseSaving] = useState(false);
  const isVariantModalOpen = Boolean(barcodeShopProduct);
  const [viewportIsMobile, setViewportIsMobile] = useState(() => isMobileViewport());

  const searchRef = useRef(null);
  const posShellRef = useRef(null);
  const filtersPanelRef = useRef(null);
  const filtersButtonRef = useRef(null);
  const previousTotalRef = useRef(0);
  const lastBarcodeSubmitRef = useRef({ value: "", timer: null });
  const globalBarcodeBufferRef = useRef({ value: "", startedAt: 0, lastAt: 0 });
  const posSearchMatchLogRef = useRef({ query: "", keys: new Set() });
  const shiftSessionRecoveredRef = useRef(false);
  const loadedRouteEditOrderIdRef = useRef("");
  const paymobPollingRef = useRef({ timer: null, cancelled: false });
  const deferredSearch = useDeferredValue(search);
  const isRtl = String(i18n.language || "").toLowerCase().startsWith("ar");
  const currentTenant = useMemo(() => getCurrentTenant() || {}, []);
  const currentUser = useMemo(() => getCurrentUser() || {}, []);
  const resolvedPosBranchId = useMemo(
    () =>
      String(
        posShiftBranch?.id ||
          currentUser?.branch_id ||
          currentUser?.branchId ||
          currentUser?.default_branch_id ||
          currentUser?.defaultBranchId ||
          ""
      ).trim(),
    [currentUser?.branchId, currentUser?.branch_id, currentUser?.defaultBranchId, currentUser?.default_branch_id, posShiftBranch?.id]
  );
  const activeSalesperson = useMemo(
    () => salesEmployees.find((employee) => String(employee.id || "") === String(selectedSalespersonId || "")) || null,
    [salesEmployees, selectedSalespersonId]
  );
  const storeDisplayName = useMemo(
    () =>
      String(
        posShiftBranch?.name ||
          activePosShift?.branch_name ||
          currentTenant?.companyName ||
          currentTenant?.company_name ||
          currentTenant?.name ||
          "POSPro"
      ).trim() || "POSPro",
    [activePosShift?.branch_name, currentTenant?.companyName, currentTenant?.company_name, currentTenant?.name, posShiftBranch?.name]
  );
  const salespersonDisplayName = useMemo(() => {
    if (activeSalesperson) {
      return String(
        activeSalesperson.full_name ||
          activeSalesperson.name ||
          activeSalesperson.employee_name ||
          activeSalesperson.pos_alias ||
          activeSalesperson.user_name ||
          `#${activeSalesperson.id || ""}`
      ).trim();
    }
    return salesSettings.allow_sale_without_salesperson ? "بدون بائع" : "اختر بائع";
  }, [activeSalesperson, salesSettings.allow_sale_without_salesperson]);
  const canOverrideSeller = useMemo(
    () => sellerOverrideAllowed || isAdminUser(currentUser) || hasPermission("pos.override_seller", currentUser) || hasPermission("orders.edit", currentUser),
    [currentUser, sellerOverrideAllowed]
  );
  const canCreatePosExpense = useMemo(() => {
    const role = String(currentUser?.role || currentUser?.role_name || "").toLowerCase().replace(/[_-]+/g, " ");
    return hasPermission("pos.expenses.create", currentUser) || ["cashier", "pos", "pos cashier", "sales", "sales agent"].includes(role);
  }, [currentUser]);
  const canChangeSalesperson = useMemo(() => {
    if (canOverrideSeller) return true;
    const currentUserId = currentUser?.id ? String(currentUser.id) : "";
    if (!currentUserId) return true;
    return !salesEmployees.some((employee) => String(employee.user_id || "") === currentUserId);
  }, [canOverrideSeller, currentUser?.id, salesEmployees]);

  useEffect(() => {
    if (!isBrowser() || !location.pathname.startsWith("/pos")) return undefined;

    const previousManifests = Array.from(document.querySelectorAll('link[rel="manifest"]')).map((item) => item.getAttribute("href") || "").filter(Boolean);
    const hadAppleCapable = Boolean(document.querySelector('meta[name="apple-mobile-web-app-capable"]'));
    const hadAppleTitle = Boolean(document.querySelector('meta[name="apple-mobile-web-app-title"]'));
    const hadStatusBarStyle = Boolean(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'));
    const hadThemeColor = Boolean(document.querySelector('meta[name="theme-color"]'));
    const appleTouchLink = document.querySelector('link[rel="apple-touch-icon"]');
    const hadAppleTouchIcon = Boolean(appleTouchLink);
    const previousAppleCapable = getHeadMetaContent("apple-mobile-web-app-capable");
    const previousAppleTitle = getHeadMetaContent("apple-mobile-web-app-title");
    const previousStatusBarStyle = getHeadMetaContent("apple-mobile-web-app-status-bar-style");
    const previousThemeColor = getHeadMetaContent("theme-color");
    const previousAppleTouchIcon = appleTouchLink?.getAttribute("href") || "";
    const previousTitle = document.title;

    document.querySelectorAll('link[rel="manifest"]').forEach((item) => item.remove());
    const manifest = document.createElement("link");
    manifest.setAttribute("rel", "manifest");
    manifest.setAttribute("href", POS_MANIFEST_HREF);
    manifest.setAttribute("data-pos-manifest", "true");
    document.head.appendChild(manifest);

    setHeadMetaContent("apple-mobile-web-app-capable", "yes");
    setHeadMetaContent("apple-mobile-web-app-title", POS_APP_SHORT_TITLE);
    setHeadMetaContent("apple-mobile-web-app-status-bar-style", POS_STATUS_BAR_STYLE);
    setHeadMetaContent("theme-color", POS_THEME_COLOR);
    if (appleTouchLink) {
      appleTouchLink.setAttribute("href", POS_TOUCH_ICON_HREF);
    } else {
      const touchIcon = document.createElement("link");
      touchIcon.setAttribute("rel", "apple-touch-icon");
      touchIcon.setAttribute("href", POS_TOUCH_ICON_HREF);
      document.head.appendChild(touchIcon);
    }
    document.title = POS_APP_TITLE;

    return () => {
      manifest.remove();
      if (!window.location.pathname.startsWith("/pos")) {
        previousManifests.forEach((href) => {
          if (!href) return;
          const restored = document.createElement("link");
          restored.setAttribute("rel", "manifest");
          restored.setAttribute("href", href);
          document.head.appendChild(restored);
        });
      }
      restoreHeadMetaContent("apple-mobile-web-app-capable", previousAppleCapable, hadAppleCapable);
      restoreHeadMetaContent("apple-mobile-web-app-title", previousAppleTitle, hadAppleTitle);
      restoreHeadMetaContent("apple-mobile-web-app-status-bar-style", previousStatusBarStyle, hadStatusBarStyle);
      restoreHeadMetaContent("theme-color", previousThemeColor, hadThemeColor);
      if (hadAppleTouchIcon) {
        const restoredTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
        if (restoredTouchIcon) restoredTouchIcon.setAttribute("href", previousAppleTouchIcon);
      } else {
        document.querySelector('link[rel="apple-touch-icon"]')?.remove();
      }
      document.title = previousTitle || POS_APP_TITLE;
    };
  }, [location.pathname]);

  useEffect(() => {
    writePosCart(cart);
    if (activePosShift?.id && shiftSessionRecoveredRef.current) {
      writePosSession({
        shift_id: activePosShift.id,
        branch_id: activePosShift.branch_id || posShiftBranch?.id || null,
        cart,
        invoiceNumber,
        paymentMode,
        cashAmount,
        cardAmount,
        walletAmount,
        vodafoneCashAmount,
        customerWalletAmount,
        invoiceDiscountType,
        invoiceDiscountValue,
        invoiceDiscountReason,
        invoiceDiscount,
        serviceFee,
        selectedSalespersonId,
      });
    }
  }, [activePosShift?.id, activePosShift?.branch_id, cardAmount, cart, cashAmount, customerWalletAmount, invoiceDiscount, invoiceDiscountReason, invoiceDiscountType, invoiceDiscountValue, invoiceNumber, paymentMode, posShiftBranch?.id, selectedSalespersonId, serviceFee, vodafoneCashAmount, walletAmount]);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    const updateViewport = () => setViewportIsMobile(isMobileViewport());
    updateViewport();
    window.addEventListener("resize", updateViewport, { passive: true });
    window.visualViewport?.addEventListener?.("resize", updateViewport, { passive: true });
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener?.("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (!selectedProduct) setMobileProductQuantity(1);
  }, [selectedProduct]);

  useEffect(() => {
    if (!activePosShift?.id || shiftSessionRecoveredRef.current) return;
    shiftSessionRecoveredRef.current = true;
    if (routeEditOrderId) return;
    const savedSession = readPosSession();
    if (!savedSession?.shift_id) return;
    if (String(savedSession.shift_id) !== String(activePosShift.id)) {
      clearPosPersistedState();
      setCart([]);
      return;
    }
    if (Array.isArray(savedSession.cart) && savedSession.cart.length > 0) {
      setCart(savedSession.cart);
      setInvoiceNumber(savedSession.invoiceNumber || generateInvoiceNumber());
      setPaymentMode(savedSession.paymentMode || defaultState.paymentMode);
      setCashAmount(savedSession.cashAmount ?? defaultState.cashAmount);
      setCardAmount(savedSession.cardAmount ?? defaultState.cardAmount);
      setWalletAmount(savedSession.walletAmount ?? defaultState.walletAmount);
      setVodafoneCashAmount(savedSession.vodafoneCashAmount ?? defaultState.vodafoneCashAmount);
      setCustomerWalletAmount(savedSession.customerWalletAmount ?? defaultState.customerWalletAmount);
      setPersonalSettlementType(savedSession.personalSettlementType ?? defaultState.personalSettlementType);
      setPersonalNote(savedSession.personalNote ?? defaultState.personalNote);
      setInvoiceDiscountType(normalizeInvoiceDiscountType(savedSession.invoiceDiscountType ?? defaultState.invoiceDiscountType));
      setInvoiceDiscountValue(savedSession.invoiceDiscountValue ?? savedSession.invoiceDiscount ?? defaultState.invoiceDiscountValue);
      setInvoiceDiscountReason(savedSession.invoiceDiscountReason ?? defaultState.invoiceDiscountReason);
      setInvoiceDiscount(savedSession.invoiceDiscount ?? defaultState.invoiceDiscount);
      setServiceFee(savedSession.serviceFee ?? defaultState.serviceFee);
      if (savedSession.selectedSalespersonId) setSelectedSalespersonId(String(savedSession.selectedSalespersonId));
      toast.success("تم استرجاع جلسة البيع المحفوظة");
    }
  }, [activePosShift?.id, routeEditOrderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writePosPersistedState({
        search,
        selectedMainCategoryId,
        selectedSubCategoryId,
        selectedChildCategoryId,
        selectedBrandId,
        selectedManufacturerId,
        selectedGender,
        selectedProductType,
        selectedGrade,
        paymentMode,
        cashAmount,
        cardAmount,
        walletAmount,
        vodafoneCashAmount,
        customerWalletAmount,
        personalSettlementType,
        personalNote,
        invoiceDiscountType,
        invoiceDiscountValue,
        invoiceDiscountReason,
        invoiceDiscount,
        serviceFee,
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    search,
    selectedMainCategoryId,
    selectedSubCategoryId,
    selectedChildCategoryId,
    selectedBrandId,
    selectedManufacturerId,
    selectedGender,
    selectedProductType,
    selectedGrade,
    paymentMode,
    cashAmount,
    cardAmount,
    walletAmount,
    vodafoneCashAmount,
    customerWalletAmount,
    personalSettlementType,
    personalNote,
    invoiceDiscountType,
    invoiceDiscountValue,
    invoiceDiscountReason,
    invoiceDiscount,
    serviceFee,
  ]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key === "Escape") {
        setFiltersOpen(false);
        setSelectedProduct(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(lastBarcodeSubmitRef.current.timer);
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== MARKETING_ATTRIBUTION_KEY) return;
      setMarketingAttribution(readMarketingAttributionState());
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const getFullscreenElement = () =>
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement ||
      null;
    const syncFullscreenState = () => setIsFullscreen(Boolean(getFullscreenElement()));

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    document.addEventListener("msfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
      document.removeEventListener("msfullscreenchange", syncFullscreenState);
    };
  }, []);

  useDismissableLayer({
    enabled: filtersOpen,
    refs: [filtersPanelRef, filtersButtonRef],
    onDismiss: () => setFiltersOpen(false),
  });

  useEffect(() => {
    if (!customerCreateOpen) return undefined;

    console.log("[pos-customer-modal-render]", {
      ...getPosCustomerModalRuntime(),
      portalTarget: getActiveFullscreenElement() ? "fullscreenElement" : "body",
    });

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setCustomerCreateOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [customerCreateOpen]);

  const loadCustomers = async (searchValue = "") => {
    try {
      const data = await api.get("/customers", {
        params: {
          limit: searchValue ? 30 : 200,
          page: 1,
          search: searchValue,
        },
      });
      const normalized = normalizeCustomersResponse(data);
      setCustomers(normalized);
      return normalized;
    } catch (err) {
      console.error("[pos] failed to load customers:", err);
      return [];
    }
  };

  const saveSaleModeSettings = useCallback(async (nextSaleModeEnabled, previousSaleMode = null) => {
    const payload = {
      sale_mode_enabled: Boolean(nextSaleModeEnabled),
    };
    setSaleModeSaving(true);
    try {
      console.debug("POS_SALE_MODE_CLICK_TARGET", {
        previous: previousSaleMode,
        next: Boolean(nextSaleModeEnabled),
        payload,
      });
      console.debug("POS_SALE_MODE_PUT_PAYLOAD", payload);
      const response = await api.put("/website/settings", payload);
      const refreshed = await api.get("/website/settings", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      }).catch(() => null);
      const refreshedRaw = refreshed?.settings?.sale_mode_enabled;
      const parsedFromResponse = parseSaleModeEnabled(response?.settings?.sale_mode_enabled, payload.sale_mode_enabled);
      const saved = normalizeSaleModeSettings({
        ...(response?.settings || payload),
        sale_mode_enabled: parseSaleModeEnabled(refreshedRaw, parsedFromResponse),
      });
      console.debug("POS_SALE_MODE_AFTER_SAVE_GET", {
        response_sale_mode_enabled: response?.settings?.sale_mode_enabled,
        refreshed_sale_mode_enabled: refreshedRaw,
        parsed_sale_mode_enabled: saved.sale_mode_enabled,
      });
      setSaleModeSettings(saved);
      const refreshedCatalog = await refreshCatalogProducts({
        setProducts,
        setLoading,
        manageLoading: false,
        saleModeSettings: saved,
      });
      setCart((current) => {
        if (editingOrder?.id) {
          console.log("[cart-reset-blocked-edit-mode]", {
            order_id: editingOrder.id,
            cart_count: current.length,
            reason: "skip sale mode catalog reconciliation while editing invoice",
          });
          return current;
        }
        return reconcileCartWithCatalog(current, refreshedCatalog).nextCart;
      });
      toast.success(saved.sale_mode_enabled ? "Existing sale prices enabled" : "Existing sale prices disabled");
      return saved;
    } catch (error) {
      toast.error(error.message || "Failed to save existing sale prices setting");
      return null;
    } finally {
      setSaleModeSaving(false);
    }
  }, [editingOrder?.id]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError("");
        let saleModeForLoad = normalizeSaleModeSettings({ sale_mode_enabled: parseSaleModeEnabled(readUseSalePrices(), true) });

        let websiteSettings = null;
        try {
          websiteSettings = await api.get("/website/settings", {
            signal: controller.signal,
            cache: "no-store",
            headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          });
        } catch {
          websiteSettings = null;
        }
        if (websiteSettings) {
          const backendSaleModeEnabledRaw = websiteSettings?.settings?.sale_mode_enabled;
          const backendSaleModeEnabled = parseSaleModeEnabled(backendSaleModeEnabledRaw, true);
          saleModeForLoad = normalizeSaleModeSettings({
            ...(websiteSettings?.settings || {}),
            sale_mode_enabled: backendSaleModeEnabled,
          });
          console.debug("POS_SALE_MODE_HYDRATE_BACKEND_RAW", {
            sale_mode_enabled: backendSaleModeEnabledRaw,
          });
          console.debug("POS_SALE_MODE_HYDRATE_PARSED", {
            backend_sale_mode_enabled: backendSaleModeEnabled,
            source: "backend",
          });
          console.debug("POS_SALE_MODE_FINAL_STATE", {
            sale_mode_enabled: saleModeForLoad.sale_mode_enabled,
            backend_sale_mode_enabled: backendSaleModeEnabledRaw,
            parsed_backend_sale_mode_enabled: backendSaleModeEnabled,
            source: "backend",
          });
          setSaleModeSettings(saleModeForLoad);
        } else {
          const fallbackSaleModeEnabled = parseSaleModeEnabled(readUseSalePrices(), true);
          saleModeForLoad = normalizeSaleModeSettings({ sale_mode_enabled: fallbackSaleModeEnabled });
          console.debug("POS_SALE_MODE_HYDRATE_BACKEND_RAW", {
            sale_mode_enabled: null,
            fallback: true,
          });
          console.debug("POS_SALE_MODE_HYDRATE_PARSED", {
            backend_sale_mode_enabled: undefined,
            local_sale_mode_enabled: fallbackSaleModeEnabled,
            source: "localStorage_fallback",
          });
          console.debug("POS_SALE_MODE_FINAL_STATE", {
            sale_mode_enabled: saleModeForLoad.sale_mode_enabled,
            backend_sale_mode_enabled: null,
            parsed_backend_sale_mode_enabled: undefined,
            local_sale_mode_enabled: fallbackSaleModeEnabled,
            source: "localStorage_fallback",
          });
          setSaleModeSettings(saleModeForLoad);
        }
        const catalog = await refreshCatalogProducts({
          setProducts,
          setLoading,
          manageLoading: false,
          isActive: () => active,
          signal: controller.signal,
          saleModeSettings: saleModeForLoad,
        });
        void catalog;

        if (!active) return;

        const [manufacturersResult, customersResult] = await Promise.allSettled([
          api.get("/manufacturers", { signal: controller.signal }),
          api.get("/customers", {
            params: {
              limit: 200,
              page: 1,
              branch_id: activePosShift?.branch_id || posShiftBranch?.id || "",
            },
            signal: controller.signal,
          }),
        ]);

        if (!active) return;

        if (manufacturersResult.status === "rejected") {
          console.error("[pos] failed to load manufacturers:", manufacturersResult.reason);
        }
        if (customersResult.status === "rejected") {
          console.error("[pos] failed to load customers:", customersResult.reason);
        }
        const manufacturersRes = manufacturersResult.status === "fulfilled" ? manufacturersResult.value : null;
        const customersRes = customersResult.status === "fulfilled" ? customersResult.value : null;

        const manufacturerRows = Array.isArray(manufacturersRes?.manufacturers)
          ? manufacturersRes.manufacturers
          : Array.isArray(manufacturersRes?.data)
            ? manufacturersRes.data
            : Array.isArray(manufacturersRes)
              ? manufacturersRes
              : [];
        setManufacturers(manufacturerRows);
        const manufacturerNameById = new Map(manufacturerRows.map((item) => [String(item.id), item.name]));
        setProducts((current) =>
          current.map((item) => {
            const manufacturerId = String(item.manufacturer_id || item.variant_manufacturer_id || "").trim();
            const manufacturer = item.manufacturer || manufacturerNameById.get(manufacturerId) || "";
            return {
              ...item,
              manufacturer,
              variants: Array.isArray(item.variants)
                ? item.variants.map((variant) => ({
                    ...variant,
                    manufacturer:
                      variant.manufacturer ||
                      manufacturerNameById.get(String(variant.manufacturer_id || variant.variant_manufacturer_id || "").trim()) ||
                      manufacturer,
                  }))
                : item.variants,
            };
          })
        );

        setCustomers(normalizeCustomersResponse(customersRes));
      } catch (err) {
        const message = getErrorMessage(err, "Failed to load products from /products/with-variants.");
        console.error("[pos] product feed load failed:", {
          message,
          status: err?.status,
          responseBody: err?.responseBody,
          url: err?.url,
        });
        if (!active) return;
        setError(message);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [editingOrder?.id]);

  useEffect(() => {
    const rawSearch = String(deferredSearch ?? "");
    if (rawSearch.trim().length < 2) return undefined;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const rawProducts = await getProductsWithVariants({
          params: { search: rawSearch },
          signal: controller.signal,
        });
        const catalog = normalizePosSellableProducts(rawProducts, saleModeSettings).map((product) => normalizePosCatalogProduct(product));
        if (catalog.length > 0) {
          setProducts((current) => mergeCatalogProducts(current, catalog));
        }
      } catch (err) {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        console.error("[pos] product search fetch failed:", err);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [deferredSearch, saleModeSettings]);

  useEffect(() => {
    const searchValue = String(customerSearch || "").trim();
    if (!searchValue || selectedCustomerId) return undefined;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await api.get("/customers", {
          params: {
            limit: 30,
            page: 1,
            search: normalizePhone(searchValue).replace(/\D/g, "") ? normalizePhone(searchValue) : searchValue,
            branch_id: activePosShift?.branch_id || posShiftBranch?.id || "",
          },
          signal: controller.signal,
          suppressErrorStatuses: [401],
        });
        const rows = normalizeCustomersResponse(response);
        setCustomers((current) => {
          const existing = Array.isArray(current) ? current : [];
          const merged = new Map(existing.map((item) => [String(item?.id || item?.customer_id), item]));
          rows.forEach((item) => {
            const key = String(item?.id || item?.customer_id || "");
            if (key) merged.set(key, item);
          });
          return Array.from(merged.values());
        });
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("[pos] failed to search customers:", err);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activePosShift?.branch_id, customerSearch, posShiftBranch?.id, selectedCustomerId]);

  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0 || !Array.isArray(cart) || cart.length === 0) {
      return;
    }
    if (editingOrder?.id) {
      console.log("[cart-reset-blocked-edit-mode]", {
        order_id: editingOrder.id,
        cart_count: cart.length,
        reason: "skip catalog reconciliation while editing invoice",
      });
      return;
    }

    const reconciliation = reconcileCartWithCatalog(cart, products);
    if (!reconciliation.changed) return;

    setCart(reconciliation.nextCart);
    if (reconciliation.removedItems.length > 0) {
      toast.error("Some cart items are no longer available and were removed.");
    } else {
      toast.error("Cart quantities were adjusted to live stock.");
    }
  }, [products, cart, editingOrder?.id]);

  const manufacturerLookup = useMemo(
    () => new Map(manufacturers.map((item) => [String(item.id), item.name])),
    [manufacturers]
  );
  const smartClassificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false }),
    [classificationGroups]
  );

  const customer = useMemo(
    () =>
      customers.find((item) => String(item?.id || item?.customer_id) === String(selectedCustomerId)) || null,
    [customers, selectedCustomerId]
  );
  const mobileSelectedCustomerLabel = useMemo(
    () => String(customer?.name || customer?.customer_name || customerSearch?.trim() || "عميل غير محدد").trim() || "عميل غير محدد",
    [customer?.customer_name, customer?.name, customerSearch]
  );
  const customerCreditBalance = useMemo(
    () => Math.max(0, getCustomerCreditBalance(customer, loyaltyProfile)),
    [customer, loyaltyProfile]
  );
  const canUseCustomerCredit = Boolean(customer && customerCreditBalance > 0);
  const quickCustomerExistingMatch = useMemo(() => {
    const normalizedPhone = normalizeReceiptPhone(quickCustomer.phone);
    if (!normalizedPhone) return null;
    const phoneDigits = normalizedPhone.replace(/\D/g, "");
    return (Array.isArray(customers) ? customers : []).find((item) => {
      const itemId = item?.id || item?.customer_id;
      if (!itemId) return false;
      const itemPhone = normalizeReceiptPhone(item?.phone || item?.mobile || item?.whatsapp || item?.customer_phone || "");
      return itemPhone && itemPhone.replace(/\D/g, "") === phoneDigits;
    }) || null;
  }, [customers, quickCustomer.phone]);
  const quickCustomerNeedsSource = Boolean(
    customerCreateOpen &&
    !quickCustomerExistingMatch &&
    (quickCustomer.name.trim() || normalizeReceiptPhone(quickCustomer.phone))
  );

  useEffect(() => {
    if (!customer) return;
    const invoicesCount = Number(customer.invoices_count ?? customer.orders_count ?? customer.total_orders ?? 0);
    const loyaltyPoints = Number(loyaltyProfile?.available_points ?? loyaltyProfile?.points ?? customer.loyalty_points ?? 0);
    if (import.meta.env.DEV || (loyaltyPoints > 0 && invoicesCount === 0)) {
      console.log("[pos-customer-summary]", {
        customer_id: customer.id || customer.customer_id,
        wallet_balance: Number(loyaltyProfile?.wallet_balance ?? customer.wallet_balance ?? customer.balance ?? 0),
        loyalty_points: loyaltyPoints,
        loyalty_tier: loyaltyProfile?.tier || customer.loyalty_tier || customer.tier || "Bronze",
        invoices_count: invoicesCount,
        orders_count_query_source: loyaltyProfile?.orders_count_query_source || customer.orders_count_query_source || "unknown",
        tenant_id: currentUser?.tenant_id || customer.tenant_id || null,
        branch_id: activePosShift?.branch_id || posShiftBranch?.id || null,
      });
    }
  }, [activePosShift?.branch_id, currentUser?.tenant_id, customer, loyaltyProfile, posShiftBranch?.id]);

  const loadActivePosShift = useCallback(async ({ silent = false, branchId = null } = {}) => {
    try {
      if (!silent) setPosShiftLoading(true);
      const response = await api.get("/pos/shifts/active", {
        params: { branch_id: branchId || resolvedPosBranchId || undefined },
        suppressErrorStatuses: [400, 404],
      });
      setActivePosShift(response?.shift || null);
      setPosShiftBranch(response?.branch || null);
      return response;
    } catch (error) {
      console.error("[pos] failed to load active POS shift:", error);
      setActivePosShift(null);
      return null;
    } finally {
      if (!silent) setPosShiftLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivePosShift();
  }, [loadActivePosShift]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadActivePosShift({ silent: true, branchId: resolvedPosBranchId || null });
    }, 45000);
    return () => window.clearInterval(timer);
  }, [loadActivePosShift, resolvedPosBranchId]);

  const loadSellerUsers = useCallback(async ({ silent = false } = {}) => {
    const activeShiftBranchId = activePosShift?.branch_id || "";
    const selectedBranchId = resolvedPosBranchId || "";
    const branchId = activeShiftBranchId || selectedBranchId || "";
    if (posShiftLoading) {
      if (import.meta.env.DEV) {
        console.log("[pos-sellers-load:wait-branch]", {
          reason: "active shift still loading",
          active_shift_branch_id: activeShiftBranchId || null,
          selected_branch_id: selectedBranchId || null,
          resolved_branch_id: branchId || null,
        });
      }
      return;
    }
    if (!branchId) {
      if (import.meta.env.DEV) {
        console.log("[pos-sellers-load:skip]", {
          reason: "branch_id unresolved",
          active_shift_branch_id: activeShiftBranchId || null,
          selected_branch_id: selectedBranchId || null,
          active_shift_id: activePosShift?.id || null,
        });
      }
      return;
    }

    if (!silent) setSellersLoading(true);
    if (silent && salesEmployees.length === 0) setSellersLoading(true);
    setSellerLoadError("");
    if (import.meta.env.DEV) {
      console.log("[pos-sellers-load:request]", {
        branch_id: branchId,
        source: activeShiftBranchId ? "active_shift" : "selected_branch",
        active_shift_id: activePosShift?.id || null,
        active_shift_branch_id: activeShiftBranchId || null,
        selected_branch_id: selectedBranchId || null,
      });
    }
    try {
      const response = await api.get("/pos/seller-users", { params: { branch_id: branchId } });
        const rows = Array.isArray(response?.users) ? response.users : [];
        const normalizedRows = rows.map((user) => ({
          ...user,
          id: user.employee_id || user.id,
          employee_id: user.employee_id || user.id,
          full_name: user.full_name || user.name || user.email || `User #${user.id}`,
          name: user.name || user.full_name || user.email || `Employee #${user.employee_id || user.id}`,
          pos_alias: user.pos_alias || "",
          active_for_pos: user.active_for_pos === true || user.is_sales_active === true,
        }));
        setSellersLoaded(true);
        setSalesEmployees(normalizedRows);
        setSellerOverrideAllowed(Boolean(response?.can_override_seller));
        setSalesSettings({
          allow_sale_without_salesperson: response?.settings?.allow_sale_without_salesperson !== false,
          fixed_commission_mode: response?.settings?.fixed_commission_mode || "fixed_per_item",
        });
        if (import.meta.env.DEV) {
          console.log("[pos-sellers-load]", {
            branch_id: branchId,
            active_shift_branch_id: activeShiftBranchId || null,
            selected_branch_id: selectedBranchId || null,
            backend_debug: response?.debug || null,
            returned_sellers_count: normalizedRows.length,
            allow_sale_without_salesperson: response?.settings?.allow_sale_without_salesperson !== false,
            sellers: normalizedRows.map((employee) => ({
              employee_id: employee.employee_id || employee.id,
              name: employee.name || "",
              pos_alias: employee.pos_alias || "",
              active_for_pos: employee.active_for_pos === true,
              branch_id: employee.branch_id || null,
            })),
          });
        }
        setSelectedSalespersonId((current) => {
          const activeRows = normalizedRows.filter((user) => user.is_active !== false && user.active_for_pos === true);
          const currentUserId = currentUser?.id ? String(currentUser.id) : "";
          const currentUserSeller = activeRows.find((user) => currentUserId && String(user.user_id || "") === currentUserId);
          if (currentUserSeller?.id) {
            const currentEmployeeId = String(currentUserSeller.id);
            if (!canOverrideSeller) return currentEmployeeId;
            if (activeRows.some((user) => String(user.id) === String(current))) return current || currentEmployeeId;
            return currentEmployeeId;
          }
          if (response?.settings?.allow_sale_without_salesperson !== false && !current) return "";
          if (activeRows.some((user) => String(user.id) === String(current))) return current;
          return activeRows[0]?.id ? String(activeRows[0].id) : "";
        });
    } catch (error) {
      console.error("[pos] failed to load branch seller users:", error);
      setSellerLoadError(error?.message || "Failed to refresh sellers");
    } finally {
      setSellersLoading(false);
    }
  }, [activePosShift?.id, activePosShift?.branch_id, canOverrideSeller, posShiftLoading, resolvedPosBranchId, salesEmployees.length]);

  useEffect(() => {
    loadSellerUsers({ silent: sellersLoaded || salesEmployees.length > 0 });
  }, [loadSellerUsers, sellersLoaded, salesEmployees.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadSellerUsers({ silent: true });
    }, 45000);
    return () => window.clearInterval(timer);
  }, [loadSellerUsers]);

  const handleSalespersonChange = useCallback((salespersonId) => {
    const nextId = String(salespersonId || "");
    const currentUserId = currentUser?.id ? String(currentUser.id) : "";
    const currentUserSeller = salesEmployees.find((employee) => currentUserId && String(employee.user_id || "") === currentUserId);
    const currentEmployeeId = currentUserSeller?.id ? String(currentUserSeller.id) : "";
    if (!canOverrideSeller && nextId && currentEmployeeId && nextId !== currentEmployeeId) {
      toast.error("لا تملك صلاحية البيع باسم مستخدم آخر");
      return;
    }
    if (!canOverrideSeller && !nextId && currentEmployeeId) {
      setSelectedSalespersonId(currentEmployeeId);
      return;
    }
    setSelectedSalespersonId(nextId);
    lastSalespersonIdRef.current = nextId;
    writeLastSalespersonId(nextId);
  }, [canOverrideSeller, currentUser?.id, salesEmployees]);

  const isShiftActive = Boolean(activePosShift?.id && activePosShift?.status === "open");

  const handleSelectCustomer = useCallback((item) => {
    const selected = normalizePosCustomer(item);
    const customerId = selected?.id || selected?.customer_id;
    if (!customerId) {
      console.error("[pos] selected customer is missing id/customer_id:", item);
      toast.error("This customer cannot be selected because its ID is missing.");
      return;
    }

    setCustomers((current) => {
      const safeCurrent = Array.isArray(current) ? current : [];
      const withoutSelected = safeCurrent.filter((customerItem) => String(customerItem?.id || customerItem?.customer_id) !== String(customerId));
      return [selected, ...withoutSelected];
    });
    setSelectedCustomerId(customerId);
    setCustomerSearch(selected.name || selected.phone || "");
    setLoyaltyRedeemPoints(0);
    if (!Boolean(selected.allow_personal_transactions ?? selected.allowPersonalTransactions ?? false)) {
      setPaymentMode((current) => (String(current || "").toLowerCase() === "personal" ? "cash" : current));
      setPersonalSettlementType("");
      setPersonalNote("");
    }
  }, []);

  const customerPhoneAutoSelectMatch = useMemo(() => {
    if (selectedCustomerId) return null;
    const input = String(customerSearch || "").trim();
    if (!isPosPhoneLikeSearch(input)) return null;
    const normalizedInputPhone = normalizePhone(input).replace(/\D/g, "");
    const inputVariants = getPosPhoneExactVariants(input);
    const matchesById = new Map();

    if (normalizedInputPhone) {
      (Array.isArray(customers) ? customers : []).forEach((item) => {
        const itemId = item?.id || item?.customer_id;
        if (!itemId) return;
        const itemPhones = [item?.phone, item?.mobile, item?.whatsapp]
          .map((value) => normalizePhone(value || "").replace(/\D/g, ""))
          .filter(Boolean);
        if (itemPhones.includes(normalizedInputPhone)) {
          matchesById.set(String(itemId), item);
        }
      });
      if (matchesById.size === 1) return Array.from(matchesById.values())[0];
      matchesById.clear();
    }

    (Array.isArray(customers) ? customers : []).forEach((item) => {
      const itemId = item?.id || item?.customer_id;
      if (!itemId || !customerMatchesPhoneVariants(item, inputVariants)) return;
      matchesById.set(String(itemId), item);
    });
    return matchesById.size === 1 ? Array.from(matchesById.values())[0] : null;
  }, [customerSearch, customers, selectedCustomerId]);

  useEffect(() => {
    if (!customerPhoneAutoSelectMatch) return;
    const customerId = customerPhoneAutoSelectMatch.id || customerPhoneAutoSelectMatch.customer_id;
    if (!customerId || String(customerId) === String(selectedCustomerId || "")) return;
    const normalizedInputPhone = getPosPhoneExactVariants(customerSearch)[0] || normalizePhone(customerSearch).replace(/\D/g, "");
    console.log("[pos-customer-auto-select-by-phone]", {
      input: customerSearch,
      normalized_phone: normalizedInputPhone,
      customer_id: customerId,
      customer_name: customerPhoneAutoSelectMatch.name || "",
    });
    handleSelectCustomer(customerPhoneAutoSelectMatch);
  }, [customerPhoneAutoSelectMatch, customerSearch, handleSelectCustomer, selectedCustomerId]);

  const handleClearSelectedCustomer = useCallback(() => {
    setSelectedCustomerId(null);
    setCustomerSearch("");
    setLoyaltyProfile(null);
    setLoyaltyValidation(null);
    setLoyaltyRedeemPoints(0);
    setCustomerWalletAmount(0);
    setPaymentMode((current) => {
      const normalized = String(current || "").toLowerCase();
      if (normalized === "customer_wallet" || normalized === "personal" || normalized === "credit_sale") return "cash";
      return current;
    });
    setPersonalSettlementType("");
    setPersonalNote("");
  }, []);

  useEffect(() => {
    if (String(paymentMode || "").toLowerCase() !== "personal") return;
    if (!selectedCustomerId || !Boolean(customer?.allow_personal_transactions ?? customer?.allowPersonalTransactions ?? false)) {
      setPaymentMode("cash");
      setPersonalSettlementType("");
      setPersonalNote("");
    }
  }, [customer?.allowPersonalTransactions, customer?.allow_personal_transactions, paymentMode, selectedCustomerId]);

  useEffect(() => {
    if (String(paymentMode || "").toLowerCase() !== "credit_sale") return;
    if (!selectedCustomerId) {
      setPaymentMode("cash");
    }
  }, [paymentMode, selectedCustomerId]);

  useEffect(() => {
    let active = true;

    const defaultLoyaltyProfile = {
      points: 0,
      tier: "Bronze",
      wallet: 0,
      available_points: 0,
      points_balance: 0,
      lifetime_points: 0,
      wallet_balance: 0,
      transactions: [],
    };

    const loadLoyalty = async () => {
      if (!selectedCustomerId) {
        setLoyaltyProfile(null);
        setLoyaltyValidation(null);
        setLoyaltyRedeemPoints(0);
        return;
      }

      try {
        setLoyaltyLoading(true);
        const response = await getLoyaltyCustomerById(selectedCustomerId);
        if (!active) return;
        setLoyaltyUnavailable(false);
        setLoyaltyProfile(response?.loyalty || null);
        setLoyaltyValidation(response?.loyalty ? { ...response.loyalty, customerId: selectedCustomerId } : null);
        if (response?.loyalty) {
          setCustomers((current) =>
            (Array.isArray(current) ? current : []).map((item) => {
              const itemId = item?.id || item?.customer_id;
              if (String(itemId) !== String(selectedCustomerId)) return item;
              const liveOrders = Number(response.loyalty.invoices_count ?? response.loyalty.orders_count ?? response.loyalty.total_orders ?? item.total_orders ?? 0);
              return {
                ...item,
                loyalty_points: Number(response.loyalty.available_points ?? response.loyalty.points ?? item.loyalty_points ?? 0),
                loyalty_tier: response.loyalty.tier || item.loyalty_tier || item.tier || "Bronze",
                tier: response.loyalty.tier || item.tier || item.loyalty_tier || "Bronze",
                wallet_balance: Number(response.loyalty.wallet_balance ?? item.wallet_balance ?? item.balance ?? 0),
                credit_balance: Number(response.loyalty.credit_balance ?? response.loyalty.wallet_balance ?? item.credit_balance ?? item.wallet_balance ?? item.balance ?? 0),
                balance: Number(response.loyalty.wallet_balance ?? item.wallet_balance ?? item.balance ?? 0),
                total_orders: liveOrders,
                orders_count: liveOrders,
                invoices_count: liveOrders,
                orders_count_query_source: response.loyalty.orders_count_query_source || item.orders_count_query_source,
              };
            })
          );
        }
      } catch (error) {
        if (!isForbiddenError(error)) {
          console.error("[pos] failed to load loyalty customer:", error);
        }
        if (!active) return;
        if (isForbiddenError(error)) {
          setLoyaltyUnavailable(true);
        }
        setLoyaltyProfile(defaultLoyaltyProfile);
        setLoyaltyValidation({ ...defaultLoyaltyProfile, customerId: selectedCustomerId });
      } finally {
        if (active) setLoyaltyLoading(false);
      }
    };

    loadLoyalty();
    return () => {
      active = false;
    };
  }, [selectedCustomerId]);

  const availableProducts = useMemo(
    () => products.filter((product) => isVisiblePosProduct(product)),
    [products]
  );

  const smartProducts = useMemo(
    () =>
      availableProducts.map((product) => ({
        product,
        meta: buildSmartMeta(product, manufacturerLookup, smartClassificationOptions),
      })),
    [availableProducts, manufacturerLookup, smartClassificationOptions]
  );

  const mainCategoryOptions = useMemo(() => {
    const map = new Map();
    smartProducts.forEach(({ meta }) => {
      if (!meta.mainCategory) return;
      const current = map.get(meta.mainCategory.id) || { ...meta.mainCategory, count: 0 };
      current.count += 1;
      map.set(meta.mainCategory.id, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [smartProducts]);

  const productsAfterMainCategory = useMemo(
    () =>
      smartProducts.filter(
        ({ meta }) => selectedMainCategoryId === "all" || meta.mainCategory?.id === selectedMainCategoryId
      ),
    [smartProducts, selectedMainCategoryId]
  );

  const subCategoryOptions = useMemo(() => {
    const map = new Map();
    productsAfterMainCategory.forEach(({ meta }) => {
      if (!meta.subCategory) return;
      const current = map.get(meta.subCategory.id) || { ...meta.subCategory, count: 0 };
      current.count += 1;
      map.set(meta.subCategory.id, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterMainCategory]);

  const productsAfterSubCategory = useMemo(
    () =>
      productsAfterMainCategory.filter(
        ({ meta }) => selectedSubCategoryId === "all" || meta.subCategory?.id === selectedSubCategoryId
      ),
    [productsAfterMainCategory, selectedSubCategoryId]
  );

  const childCategoryOptions = useMemo(() => {
    const map = new Map();
    productsAfterSubCategory.forEach(({ meta }) => {
      if (!meta.childCategory) return;
      const current = map.get(meta.childCategory.id) || { ...meta.childCategory, count: 0 };
      current.count += 1;
      map.set(meta.childCategory.id, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterSubCategory]);

  const productsAfterChildCategory = useMemo(
    () =>
      productsAfterSubCategory.filter(
        ({ meta }) => selectedChildCategoryId === "all" || meta.childCategory?.id === selectedChildCategoryId
      ),
    [productsAfterSubCategory, selectedChildCategoryId]
  );

  const productsAfterNonSmartFilters = useMemo(() => {
    const query = normalizeSmartText(deferredSearch.trim());

    return productsAfterChildCategory.filter(({ meta }) => {
      const matchesBrand = selectedBrandId === "all" || meta.brandKey === selectedBrandId;
      const matchesManufacturer =
        selectedManufacturerId === "all" ||
        meta.manufacturerIds.has(String(selectedManufacturerId)) ||
        meta.manufacturerNames.includes(normalizeSmartText(String(selectedManufacturerId).replace(/^name:/, "")));
      const matchesText = !query || meta.searchText.includes(query);
      return matchesBrand && matchesManufacturer && matchesText;
    });
  }, [productsAfterChildCategory, deferredSearch, selectedBrandId, selectedManufacturerId]);

  const smartFilterOptions = useMemo(() => {
    const renderedFilterSource = productsAfterNonSmartFilters.map(({ product }) => product);

    const productMatchesSmartField = (product, field, optionValue) => {
      if (field === "gender") return getProductAudienceKeys(product).includes(optionValue);
      return getProductSmartFilterValue(product, field, smartClassificationOptions[field]) === optionValue;
    };

    const withCounts = (items, field) =>
      items.map((item) => {
        const rawOptionValue = item.value || item.id || item.name || item.label;
        const optionValue = field === "gender" ? normalizeAudienceValue(rawOptionValue) || normalizeFilterValue(rawOptionValue) : normalizeFilterValue(rawOptionValue);
        return {
          ...item,
          id: optionValue,
          name: item.name || item.label || item.label_ar || item.label_en || item.value || item.id || "",
          icon: item.icon || "",
          color: item.color || "",
          count: renderedFilterSource.filter((product) => productMatchesSmartField(product, field, optionValue)).length,
        };
      });

    const counts = {
      gender: withCounts(smartClassificationOptions.gender, "gender"),
      productType: withCounts(smartClassificationOptions.productType, "productType"),
      grade: withCounts(smartClassificationOptions.grade, "grade"),
    };
    return counts;
  }, [productsAfterNonSmartFilters, smartClassificationOptions]);

  const smartFilterProductsSource = useMemo(
    () => productsAfterNonSmartFilters.map(({ product }) => product),
    [productsAfterNonSmartFilters]
  );

  const productsAfterSmartFilters = useMemo(
    () =>
      productsAfterNonSmartFilters.filter(({ product }) => {
        const matchesGender =
          selectedGender === "all" || getProductAudienceKeys(product).includes(normalizeAudienceValue(selectedGender) || normalizeFilterValue(selectedGender));
        const matchesProductType =
          selectedProductType === "all" ||
          getProductSmartFilterValue(product, "productType", smartClassificationOptions.productType) === normalizeFilterValue(selectedProductType);
        const matchesGrade =
          selectedGrade === "all" || getProductSmartFilterValue(product, "grade", smartClassificationOptions.grade) === normalizeFilterValue(selectedGrade);
        return matchesGender && matchesProductType && matchesGrade;
      }),
    [productsAfterNonSmartFilters, selectedGender, selectedProductType, selectedGrade, smartClassificationOptions]
  );

  const brandOptions = useMemo(() => {
    const map = new Map();
    productsAfterSmartFilters.forEach(({ product, meta }) => {
      const label = product.brand_name || product.brand;
      if (!label || label === "Unbranded") return;
      const key = meta.brandKey || `name:${normalizeSmartText(label)}`;
      if (!map.has(key)) map.set(key, { id: key, name: label });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterSmartFilters]);

  const manufacturerOptions = useMemo(() => {
    const map = new Map();
    productsAfterSmartFilters.forEach(({ product, meta }) => {
      meta.manufacturerIds.forEach((id) => {
        const name = manufacturerLookup.get(id) || product.manufacturer_name || product.manufacturer;
        if (name) map.set(id, { id, name });
      });
      meta.manufacturerNames.forEach((name) => {
        if (!name) return;
        const existing = Array.from(map.values()).find((item) => normalizeSmartText(item.name) === name);
        if (!existing) map.set(`name:${name}`, { id: `name:${name}`, name });
      });
    });
    manufacturers.forEach((manufacturer) => {
      const id = String(manufacturer.id);
      if (!map.has(id)) map.set(id, { id, name: manufacturer.name });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterSmartFilters, manufacturers, manufacturerLookup]);

  const visibleProducts = useMemo(() => {
    const query = normalizeSmartText(deferredSearch.trim());

    return productsAfterSmartFilters
      .filter(({ meta }) => {
        const matchesBrand = selectedBrandId === "all" || meta.brandKey === selectedBrandId;
        const matchesManufacturer =
          selectedManufacturerId === "all" ||
          meta.manufacturerIds.has(String(selectedManufacturerId)) ||
          meta.manufacturerNames.includes(normalizeSmartText(String(selectedManufacturerId).replace(/^name:/, "")));
        const matchesText = !query || meta.searchText.includes(query);
        return matchesBrand && matchesManufacturer && matchesText;
      })
      .map(({ product }) => product);
  }, [productsAfterSmartFilters, deferredSearch, selectedBrandId, selectedManufacturerId]);

  useEffect(() => {
    if (loading || products.length === 0 || firstDataLoggedRef.current) return;
    firstDataLoggedRef.current = true;
    logPagePerf("pos", pageStartedAtRef.current, { first_data_ms: Math.round(performance.now() - pageStartedAtRef.current), products: products.length });
  }, [loading, products.length]);

  useEffect(() => {
    if (loading || renderLoggedRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      renderLoggedRef.current = true;
      logPagePerf("pos", pageStartedAtRef.current, { render_complete_ms: Math.round(performance.now() - pageStartedAtRef.current), visible_products: visibleProducts.length });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, visibleProducts.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedMainCategoryId !== "all" && !mainCategoryOptions.some((option) => option.id === selectedMainCategoryId)) {
        setSelectedMainCategoryId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mainCategoryOptions, selectedMainCategoryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedSubCategoryId !== "all" && !subCategoryOptions.some((option) => option.id === selectedSubCategoryId)) {
        setSelectedSubCategoryId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [subCategoryOptions, selectedSubCategoryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedChildCategoryId !== "all" && !childCategoryOptions.some((option) => option.id === selectedChildCategoryId)) {
        setSelectedChildCategoryId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [childCategoryOptions, selectedChildCategoryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedGender !== "all" && !smartFilterOptions.gender.some((option) => option.id === selectedGender)) {
        setSelectedGender("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [smartFilterOptions.gender, selectedGender]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedProductType !== "all" && !smartFilterOptions.productType.some((option) => option.id === selectedProductType)) {
        setSelectedProductType("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [smartFilterOptions.productType, selectedProductType]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedGrade !== "all" && !smartFilterOptions.grade.some((option) => option.id === selectedGrade)) {
        setSelectedGrade("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [smartFilterOptions.grade, selectedGrade]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedBrandId !== "all" && !brandOptions.some((option) => option.id === selectedBrandId)) {
        setSelectedBrandId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [brandOptions, selectedBrandId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedManufacturerId !== "all" && !manufacturerOptions.some((option) => option.id === selectedManufacturerId)) {
        setSelectedManufacturerId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [manufacturerOptions, selectedManufacturerId]);

  const activeProduct = selectedProduct
    ? products.find((item) => String(item.product_id || item.id) === String(selectedProduct.product_id || selectedProduct.id)) || selectedProduct
    : null;

  const activeVariant = useMemo(() => {
    if (!activeProduct) return null;
    const variants = Array.isArray(activeProduct.variants) ? activeProduct.variants : [];
    if (variants.length <= 1) return variants[0] || null;
    return variants.find(
      (variant) =>
        String(variant.color || "") === String(selectedColor || "") &&
        String(variant.size || "") === String(selectedSize || "")
    ) || null;
  }, [activeProduct, selectedColor, selectedSize]);
  const activeVariantSizeLabel = getPosSizeDisplayLabel(activeProduct, activeVariant?.size);

  const activeVariantImageUrl = useMemo(() => {
    if (!activeProduct) return "";
    const variants = Array.isArray(activeProduct.variants) ? activeProduct.variants : [];
    const colorVariant = variants.find(
      (variant) =>
        String(variant.color || "") === String(selectedColor || "") &&
        firstTextValue(variant.variant_image_url, variant.primary_image_url, variant.image_url)
    );

    return getDisplayImageUrl(
      activeVariant?.variant_image_url,
      activeVariant?.primary_image_url,
      colorVariant?.variant_image_url,
      colorVariant?.primary_image_url,
      colorVariant?.image_url,
      activeVariant?.image_url,
      activeProduct.product_image_url,
      activeProduct.image_url
    );
  }, [activeProduct, activeVariant, selectedColor]);

  const mobileProductStock = useMemo(
    () => Math.max(0, normalizeStockQuantity(activeVariant?.stock_quantity ?? activeVariant?.stock ?? activeProduct?.total_stock ?? activeProduct?.stock)),
    [activeProduct?.stock, activeProduct?.total_stock, activeVariant?.stock, activeVariant?.stock_quantity]
  );

  useEffect(() => {
    if (!selectedProduct) return;
    setMobileProductQuantity((current) => Math.min(Math.max(1, Number(current || 1)), mobileProductStock));
  }, [mobileProductStock, selectedProduct]);

  useEffect(() => {
    if (!import.meta.env.DEV && !String(import.meta.env.VITE_DEBUG_POS_SEARCH || "").trim()) return;
    const query = String(deferredSearch || "").trim();
    if (!query) return;
    const normalizedQuery = query.toLowerCase();
    if (posSearchMatchLogRef.current.query !== normalizedQuery) {
      posSearchMatchLogRef.current = { query: normalizedQuery, keys: new Set() };
    }
    const seen = posSearchMatchLogRef.current.keys;
    visibleProducts.forEach((product) => {
      const matchType = String(product?.search_match_type || product?.searchMatchType || "").trim().toLowerCase();
      if (!["variant_article", "sku", "barcode"].includes(matchType)) return;
      const productId = String(product?.product_id || product?.id || "");
      const key = [normalizedQuery, productId, matchType].join(":");
      if (seen.has(key)) return;
      seen.add(key);
      console.info("POS_SEARCH_VARIANT_ARTICLE_MATCH", {
        query,
        product_id: product?.product_id || product?.id || null,
        matched_variant_id: product?.matched_variant_id || product?.matchedVariantId || null,
        matched_color: product?.matched_color || product?.matchedColor || "",
        matched_article: product?.matched_article || product?.matchedArticle || "",
      });
    });
  }, [deferredSearch, visibleProducts]);

  const handleAddSelectedProductToCart = useCallback(() => {
    if (!activeProduct || !activeVariant) return;
    const quantity = Math.min(mobileProductStock, Math.max(1, Math.trunc(Number(mobileProductQuantity || 1) || 1)));
    addVariantToCart(activeProduct, activeVariant, { quantity });
    setSelectedProduct(null);
    setMobileProductQuantity(1);
  }, [activeProduct, activeVariant, mobileProductQuantity, mobileProductStock]);

  const liveBarcodeShopProduct = useMemo(() => {
    if (!barcodeShopProduct) return null;
    return products.find((item) => String(item.product_id || item.id) === String(barcodeShopProduct.product_id || barcodeShopProduct.id)) || barcodeShopProduct;
  }, [barcodeShopProduct, products]);

  const barcodeLookup = useMemo(() => {
    const variantsByCode = new Map();
    const productsByCode = new Map();
    products.forEach((product) => {
      [product.sku, product.barcode].filter(Boolean).forEach((value) => {
        productsByCode.set(String(value).toLowerCase(), product);
      });
      (product.variants || []).forEach((variant) => {
        [variant.sku, variant.barcode, variant.article_code, product.sku, product.barcode].filter(Boolean).forEach((value) => {
          const key = String(value).toLowerCase();
          if (!variantsByCode.has(key)) variantsByCode.set(key, { product, variant });
        });
      });
    });
    return { productsByCode, variantsByCode };
  }, [products]);

  const invoiceDiscountSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0),
    [cart]
  );
  const computedInvoiceDiscount = useMemo(
    () =>
      calculateInvoiceDiscountAmount({
        subtotal: invoiceDiscountSubtotal,
        type: invoiceDiscountType,
        value: invoiceDiscountValue,
      }),
    [invoiceDiscountSubtotal, invoiceDiscountType, invoiceDiscountValue]
  );

  useEffect(() => {
    if (Math.abs(Number(invoiceDiscount || 0) - computedInvoiceDiscount) > 0.009) {
      setInvoiceDiscount(computedInvoiceDiscount);
    }
  }, [computedInvoiceDiscount, invoiceDiscount]);

  const cartTotals = useMemo(
    () =>
      calcTotals({
        cart,
        invoiceDiscount: computedInvoiceDiscount,
        serviceFee,
        loyaltyDiscount: loyaltyValidation && loyaltyValidation.valid === false ? 0 : Number(loyaltyValidation?.applied_amount || 0),
        couponDiscount: couponValidation?.valid ? Number(couponValidation.discount_amount || 0) : 0,
      }),
    [cart, computedInvoiceDiscount, serviceFee, loyaltyValidation, couponValidation]
  );
  const cartItemCount = useMemo(() => cart.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0), [cart]);

  const exchangeCreditAmount = Math.max(0, Number(exchangeState?.creditAmount || 0));
  const appliedExchangeCredit = Math.min(exchangeCreditAmount, Math.max(0, Number(cartTotals.total || 0)));
  const originalEditPaidAmount = editingOrder?.id ? resolveOriginalCollectedAmount(editingOrder) : 0;
  const editAmountDueNow = editingOrder?.id ? Math.max(0, Number(cartTotals.total || 0) - originalEditPaidAmount) : 0;
  const editRefundOrCreditDue = editingOrder?.id ? Math.max(0, originalEditPaidAmount - Number(cartTotals.total || 0)) : 0;
  const paymentTargetAmount = editingOrder?.id ? editAmountDueNow : Math.max(0, Number(cartTotals.total || 0) - appliedExchangeCredit);
  const amountDueNow = paymentTargetAmount;
  const exchangeDifference = Number((Number(cartTotals.total || 0) - exchangeCreditAmount).toFixed(2));
  const remainingExchangeCustomerCredit = Math.max(0, exchangeCreditAmount - Number(cartTotals.total || 0));
  const editPaymentSummary = editingOrder?.id
    ? {
        originalOrderId: editingOrder.id,
        originalInvoiceNumber: editingOrder.invoice_number || editingOrder.invoiceNumber || "",
        originalTotal: resolveEditOrderTotal(editingOrder),
        originalPaidAmount: originalEditPaidAmount,
        originalPaymentStatus: editingOrder.original_payment_status || editingOrder.originalPaymentStatus || editingOrder.payment_status || editingOrder.paymentStatus || "",
        originalItems: editingOrder.original_items || editingOrder.originalItems || editingOrder.items || [],
        newTotal: Number(cartTotals.total || 0),
        amountDueNow: editAmountDueNow,
        refundOrCreditDue: editRefundOrCreditDue,
      }
    : null;

  const paymentSummary = useMemo(
    () =>
      derivePaymentSummary({
        total: amountDueNow,
        paymentMode,
        cashAmount,
        cardAmount,
        walletAmount,
        vodafoneCashAmount,
        customerWalletAmount,
      }),
    [amountDueNow, paymentMode, cashAmount, cardAmount, walletAmount, vodafoneCashAmount, customerWalletAmount]
  );

  const paymobTerminalAmount = useMemo(() => {
    if (paymentMode === "personal" || paymentMode === "credit_sale") return 0;
    if (paymentMode === "split") return Number(cardAmount || 0);
    if (paymentMode === "card") return Number(paymentSummary.paidAmount || amountDueNow || 0);
    return 0;
  }, [amountDueNow, cardAmount, paymentMode, paymentSummary.paidAmount]);

  const activePaymentAccountMethod = useMemo(() => {
    if (paymentMode === "customer_wallet") return "";
    if (paymentMode === "personal" || paymentMode === "credit_sale") return "";
    if (paymentMode !== "split") return paymentMode;
    return activeSplitMethod;
  }, [activeSplitMethod, paymentMode]);

  const activePaymentAccountAmount = useMemo(() => {
    if (paymentMode === "personal" || paymentMode === "credit_sale") return 0;
    if (paymentMode === "split") {
      if (activePaymentAccountMethod === "vodafone_cash") return Number(vodafoneCashAmount || 0);
      if (activePaymentAccountMethod === "wallet") return Number(walletAmount || 0);
      if (activePaymentAccountMethod === "card") return Number(cardAmount || 0);
      return Number(cashAmount || 0);
    }
    return Number(paymentSummary.paidAmount || amountDueNow || 0);
  }, [activePaymentAccountMethod, amountDueNow, cardAmount, cashAmount, paymentMode, paymentSummary.paidAmount, vodafoneCashAmount, walletAmount]);

  const existingPaymobOrder = cart.length === 0 ? lastOrder || lastShareContext || null : null;
  const existingPaymobOrderId = existingPaymobOrder?.order_id || existingPaymobOrder?.orderId || existingPaymobOrder?.id || null;
  const retryPaymobAmount = Number(existingPaymobOrder?.payment?.paymobTerminalAmount || paymobTerminalState?.amount || 0);
  const missingFullVariantForCheckout = useMemo(
    () => cart.find((item) => isFullVariationMode(item.variation_mode) && !resolveCheckoutVariantId(item)),
    [cart]
  );
  const invalidCartItemForCheckout = useMemo(
    () =>
      cart.find((item) => {
        const quantity = Number(item.quantity || 0);
        const price = Number(item.price ?? item.unit_price ?? 0);
        const productId = item.product_id || item.productId || null;
        const variantId = resolveCheckoutVariantId(item);
        return (!productId && !variantId) || quantity <= 0 || !Number.isFinite(price) || price < 0;
      }),
    [cart]
  );
  const canUsePaymobTerminal = existingPaymobOrderId
    ? retryPaymobAmount > 0 && !paymobTerminalLoading
    : cart.length > 0 &&
      isShiftActive &&
      !missingFullVariantForCheckout &&
      !invalidCartItemForCheckout &&
      (salesSettings.allow_sale_without_salesperson || Boolean(selectedSalespersonId)) &&
      paymobTerminalAmount > 0 &&
      paymentMode !== "personal" &&
      paymentMode !== "credit_sale" &&
      !checkoutLoading &&
      !paymobTerminalLoading;

  useEffect(() => {
    let active = true;
    const branchId = activePosShift?.branch_id || posShiftBranch?.id || currentUser?.branch_id || "";
    if (!branchId || !activePaymentAccountMethod || cart.length === 0) {
      setPaymentAccountStatus(null);
      setPaymentAccountLoading(false);
      return undefined;
    }

    const loadPaymentAccountStatus = async () => {
      try {
        setPaymentAccountLoading(true);
        const result = await api.get("/pos/payment-account-status", {
          params: {
            payment_method: activePaymentAccountMethod,
            branch_id: branchId,
            amount: activePaymentAccountAmount,
            direction: "in",
            purpose: "pos_sale",
          },
          timeoutMs: 15000,
        });
        if (active) setPaymentAccountStatus(result?.status || null);
      } catch (statusError) {
        if (active) {
          setPaymentAccountStatus({
            unavailable: true,
            reason: statusError?.message || "payment_account_status_unavailable",
            payment_method: activePaymentAccountMethod,
            branch_id: branchId,
            amount: activePaymentAccountAmount,
            direction: "in",
            requires_balance: false,
            account: null,
            sufficient: null,
          });
        }
        console.warn("[pos] payment account status unavailable", statusError?.message || statusError);
      } finally {
        if (active) setPaymentAccountLoading(false);
      }
    };

    loadPaymentAccountStatus();
    return () => {
      active = false;
    };
  }, [activePaymentAccountAmount, activePaymentAccountMethod, activePosShift?.branch_id, cart.length, currentUser?.branch_id, paymentAccountRefreshKey, posShiftBranch?.id]);

  const loyaltyPointsToEarn = useMemo(() => {
    const spendAmount = 100;
    const earnPoints = 10;
    return Math.max(0, Math.floor(Number(cartTotals.total || 0) / spendAmount) * earnPoints);
  }, [cartTotals.total]);

  const loyaltyDiscountAmount = loyaltyValidation && loyaltyValidation.valid === false ? 0 : Number(loyaltyValidation?.applied_amount || 0);
  const walletCashbackToEarn = useMemo(() => {
    const tier = String(loyaltyProfile?.tier || customer?.tier || "Bronze");
    const rates = { Bronze: 0, Silver: 0.02, Gold: 0.03, Platinum: 0.05 };
    return Number((Number(cartTotals.total || 0) * Number(rates[tier] || 0)).toFixed(2));
  }, [cartTotals.total, customer?.tier, loyaltyProfile?.tier]);
  const activeSmartFilters = useMemo(
    () =>
      [
        { key: "gender", label: "الجنس", value: selectedGender, setValue: setSelectedGender, options: smartFilterOptions.gender },
        { key: "type", label: "نوع المنتج", value: selectedProductType, setValue: setSelectedProductType, options: smartFilterOptions.productType },
        { key: "grade", label: "الفئة", value: selectedGrade, setValue: setSelectedGrade, options: smartFilterOptions.grade },
      ]
        .filter((item) => item.value !== "all")
        .map((item) => ({
          ...item,
          name: item.options.find((option) => option.id === item.value)?.name || item.options.find((option) => option.value === item.value)?.name || item.value,
        })),
    [selectedGender, selectedProductType, selectedGrade, smartFilterOptions]
  );
  const activeSmartFilterCount = activeSmartFilters.length;

  useEffect(() => {
    const previousTotal = Number(previousTotalRef.current || 0);
    if (paymentMode === "cash" && (Number(cashAmount || 0) === 0 || Number(cashAmount || 0) === previousTotal)) {
      setCashAmount(amountDueNow);
    }
    if (paymentMode === "card" && (Number(cardAmount || 0) === 0 || Number(cardAmount || 0) === previousTotal)) {
      setCardAmount(amountDueNow);
    }
    if ((paymentMode === "instapay" || paymentMode === "wallet") && (Number(walletAmount || 0) === 0 || Number(walletAmount || 0) === previousTotal)) {
      setWalletAmount(amountDueNow);
    }
    if (paymentMode === "vodafone_cash" && (Number(vodafoneCashAmount || 0) === 0 || Number(vodafoneCashAmount || 0) === previousTotal)) {
      setVodafoneCashAmount(amountDueNow);
    }
    previousTotalRef.current = amountDueNow;
  }, [paymentMode, amountDueNow, cashAmount, cardAmount, walletAmount, vodafoneCashAmount, customerWalletAmount, customerCreditBalance]);

  useEffect(() => {
    if (!canUseCustomerCredit) {
      if (paymentMode === "customer_wallet") setPaymentMode("cash");
      if (Number(customerWalletAmount || 0) > 0) setCustomerWalletAmount(0);
      return;
    }

    const maxCustomerCreditPayment = Math.min(customerCreditBalance, Number(amountDueNow || 0));
    if (Number(customerWalletAmount || 0) > maxCustomerCreditPayment) {
      setCustomerWalletAmount(maxCustomerCreditPayment);
    }
  }, [amountDueNow, canUseCustomerCredit, customerCreditBalance, customerWalletAmount, paymentMode]);

  useEffect(() => {
    const total = Math.max(0, Number(amountDueNow || 0));
    const credit = Math.min(Math.max(0, Number(customerWalletAmount || 0)), total);
    const nextCash = Math.min(Math.max(0, Number(cashAmount || 0)), Math.max(0, total - credit));
    const nextCard = Math.min(Math.max(0, Number(cardAmount || 0)), Math.max(0, total - credit - nextCash));
    const nextWallet = Math.min(Math.max(0, Number(walletAmount || 0)), Math.max(0, total - credit - nextCash - nextCard));
    const nextVodafoneCash = Math.min(Math.max(0, Number(vodafoneCashAmount || 0)), Math.max(0, total - credit - nextCash - nextCard - nextWallet));

    if (nextCash !== Number(cashAmount || 0)) setCashAmount(nextCash);
    if (nextCard !== Number(cardAmount || 0)) setCardAmount(nextCard);
    if (nextWallet !== Number(walletAmount || 0)) setWalletAmount(nextWallet);
    if (nextVodafoneCash !== Number(vodafoneCashAmount || 0)) setVodafoneCashAmount(nextVodafoneCash);
  }, [amountDueNow, cardAmount, cashAmount, customerWalletAmount, vodafoneCashAmount, walletAmount]);

  useEffect(() => {
    let active = true;

    const validate = async () => {
      if (!selectedCustomerId || loyaltyUnavailable) {
        setLoyaltyValidation(null);
        return;
      }

      try {
        const response = await validateLoyaltyRedemption({
          customerId: selectedCustomerId,
          points: loyaltyRedeemPoints,
          orderTotal: cartTotals.preLoyaltyTotal,
        });

        if (!active) return;
        setLoyaltyUnavailable(false);
        setLoyaltyValidation(response);
      } catch (error) {
        if (!isForbiddenError(error)) {
          console.error("[pos] failed to validate loyalty redemption:", error);
        }
        if (!active) return;
        if (isForbiddenError(error)) {
          setLoyaltyUnavailable(true);
        }
        setLoyaltyValidation(null);
      }
    };

    validate();
    return () => {
      active = false;
    };
  }, [selectedCustomerId, loyaltyRedeemPoints, cartTotals.preLoyaltyTotal, loyaltyUnavailable]);

  const normalizeQrProduct = (product) => ({
    ...product,
    image_url: resolvePosImageUrl(product?.image_url || product?.product_image_url || ""),
    product_image_url: resolvePosImageUrl(product?.product_image_url || product?.image_url || ""),
    colors: (Array.isArray(product?.colors) ? product.colors : []).map((color) => {
      const colorImages = Array.isArray(color.images) ? color.images : [];
      const primaryColorImage = colorImages.find((image) => image?.is_primary) || colorImages[0] || null;
      const sizes = (Array.isArray(color.sizes) ? color.sizes : []).map((size) => {
        const stockQuantity = normalizeStockQuantity(size.stock_quantity ?? size.stock);
        const sizeImages = Array.isArray(size.images) ? size.images : [];
        const primarySizeImage = sizeImages.find((image) => image?.is_primary) || sizeImages[0] || null;
        return {
          ...size,
          stock: stockQuantity,
          stock_quantity: stockQuantity,
          available: stockQuantity > 0,
          image_url: resolvePosImageUrl(size.image_url || size.variant_image_url || primarySizeImage?.image_url || primaryColorImage?.image_url || color.image_url || product?.image_url),
          variant_image_url: resolvePosImageUrl(size.variant_image_url),
          images: sizeImages,
        };
      });

      return {
        ...color,
        image_url: resolvePosImageUrl(color.image_url || primaryColorImage?.image_url),
        primary_image_url: resolvePosImageUrl(primaryColorImage?.image_url || color.image_url),
        images: colorImages,
        sizes,
      };
    }),
    total_stock: (Array.isArray(product?.colors) ? product.colors : []).reduce(
      (sum, color) =>
        sum +
        (Array.isArray(color.sizes)
          ? color.sizes.reduce((colorSum, size) => colorSum + normalizeStockQuantity(size.stock_quantity ?? size.stock), 0)
          : 0),
      0
    ),
    stock: (Array.isArray(product?.colors) ? product.colors : []).reduce(
      (sum, color) =>
        sum +
        (Array.isArray(color.sizes)
          ? color.sizes.reduce((colorSum, size) => colorSum + normalizeStockQuantity(size.stock_quantity ?? size.stock), 0)
          : 0),
      0
    ),
  });

  const handleBarcodeSubmit = async (inputValue = search) => {
    const rawValue = String(inputValue || "").trim();
    const normalized = rawValue.toLowerCase();
    if (!normalized) return;
    if (lastBarcodeSubmitRef.current.value === normalized) return;
    window.clearTimeout(lastBarcodeSubmitRef.current.timer);
    lastBarcodeSubmitRef.current = {
      value: normalized,
      timer: window.setTimeout(() => {
        lastBarcodeSubmitRef.current = { value: "", timer: null };
      }, 250),
    };

    const exactVariant = barcodeLookup.variantsByCode.get(normalized);

    if (exactVariant) {
      addVariantToCart(exactVariant.product, exactVariant.variant);
      emitFeedback("pos_barcode_scan", {
        title: t("pos.toasts.barcodeScanned"),
        message: exactVariant.product?.name || exactVariant.product?.product_name || rawValue,
      });
      setSearch("");
      return;
    }

    const exactProduct = barcodeLookup.productsByCode.get(normalized);

    if (exactProduct) {
      quickAddProduct(exactProduct);
      emitFeedback("pos_barcode_scan", {
        title: t("pos.toasts.barcodeScanned"),
        message: exactProduct.name || exactProduct.product_name || rawValue,
      });
      setSearch("");
      return;
    }

    try {
      const qrProduct = await getProductByQrToken(rawValue);
      setBarcodeShopProduct(normalizeQrProduct(qrProduct));
      emitFeedback("pos_barcode_scan", {
        title: t("pos.toasts.productQrScanned"),
        message: qrProduct?.name || qrProduct?.product_name || rawValue,
      });
      setSearch("");
    } catch (error) {
      console.error("[pos] product QR lookup failed:", error);
      toast.error(t("pos.toasts.productQrNotFound"));
      emitFeedback("pos_product_not_found", {
        title: t("pos.toasts.productQrNotFound"),
        message: rawValue,
      });
    }
  };

  const handleCameraScannerResult = async (decodedValue) => {
    const scannedValue = String(decodedValue || "").trim();
    if (!scannedValue) return;
    setCameraScannerOpen(false);
    setSearch(scannedValue);
    await handleBarcodeSubmit(scannedValue);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  const handleCameraScannerPermissionDenied = useCallback((message = barcodeScannerMessages.permissionDenied) => {
    setCameraScannerOpen(false);
    toast.error(message || t("pos.toasts.cameraPermissionDenied", barcodeScannerMessages.permissionDenied));
  }, [t]);

  const handleCameraScannerUnsupported = useCallback((message = barcodeScannerMessages.unsupported) => {
    setCameraScannerOpen(false);
    toast.error(message || t("pos.toasts.cameraUnsupported", barcodeScannerMessages.unsupported));
  }, [t]);

  const handleCameraScannerError = useCallback((message = barcodeScannerMessages.startFailed) => {
    toast.error(message || t("pos.toasts.cameraStartFailed", barcodeScannerMessages.startFailed));
  }, [t]);

  useEffect(() => {
    const resetGlobalBarcodeBuffer = () => {
      globalBarcodeBufferRef.current = { value: "", startedAt: 0, lastAt: 0 };
    };

    const finalizeGlobalBarcodeBuffer = (event) => {
      const snapshot = globalBarcodeBufferRef.current;
      const rawValue = String(snapshot.value || "");
      const normalizedValue = rawValue.trim();
      const durationMs = snapshot.startedAt && snapshot.lastAt ? Math.max(0, snapshot.lastAt - snapshot.startedAt) : 0;
      resetGlobalBarcodeBuffer();
      if (!normalizedValue) return;
      const isScanCandidate =
        normalizedValue.length >= POS_GLOBAL_BARCODE_MIN_LENGTH && durationMs < POS_GLOBAL_BARCODE_MAX_DURATION_MS;
      if (!isScanCandidate) {
        console.info("POS_GLOBAL_BARCODE_SCAN_IGNORED", {
          reason: "not_scanner_speed",
          code: normalizedValue,
          length: normalizedValue.length,
          duration_ms: durationMs,
          trigger_key: event?.key || "",
        });
        return;
      }
      event?.preventDefault?.();
      console.info("POS_GLOBAL_BARCODE_SCAN_RECEIVED", {
        code: normalizedValue,
        length: normalizedValue.length,
        duration_ms: durationMs,
        trigger_key: event?.key || "",
      });
      handleBarcodeSubmit(normalizedValue).catch((error) => {
        console.error("POS_GLOBAL_BARCODE_SCAN_FAILED", {
          code: normalizedValue,
          message: error?.message || String(error || "Unknown error"),
        });
      });
    };

    const onGlobalBarcodeKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (isEditableKeyTarget(event.target)) {
        if (globalBarcodeBufferRef.current.value) {
          console.info("POS_GLOBAL_BARCODE_SCAN_IGNORED", {
            reason: "editable_target",
            code: globalBarcodeBufferRef.current.value,
            trigger_key: event.key || "",
          });
        }
        resetGlobalBarcodeBuffer();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) {
        resetGlobalBarcodeBuffer();
        return;
      }

      const now = performance.now();
      const state = globalBarcodeBufferRef.current;
      if (state.lastAt && now - state.lastAt >= POS_GLOBAL_BARCODE_MAX_DURATION_MS) {
        resetGlobalBarcodeBuffer();
      }

      if (event.key === "Enter" || event.key === "Tab") {
        finalizeGlobalBarcodeBuffer(event);
        return;
      }

      if (event.key.length !== 1) return;

      const nextState = globalBarcodeBufferRef.current;
      if (!nextState.value) {
        globalBarcodeBufferRef.current = {
          value: event.key,
          startedAt: now,
          lastAt: now,
        };
        return;
      }

      globalBarcodeBufferRef.current = {
        value: `${nextState.value}${event.key}`,
        startedAt: nextState.startedAt || now,
        lastAt: now,
      };
    };

    window.addEventListener("keydown", onGlobalBarcodeKeyDown);
    return () => {
      window.removeEventListener("keydown", onGlobalBarcodeKeyDown);
      resetGlobalBarcodeBuffer();
    };
  }, [handleBarcodeSubmit]);

  const addVariantToCart = useCallback((product, variant, options = {}) => {
    const requestedQuantity = Math.max(1, Math.trunc(Number(options.quantity || 1) || 1));
    const silent = Boolean(options.silent);
    if (!variant) {
      toast.error(t("pos.toasts.variantNotAvailable"));
      return;
    }

    const productId = product.product_id ?? product.id;
    const liveProduct = getCatalogProductById(products, productId) || normalizeCatalogProduct(product);
    const candidateVariantId = variant.variant_id ?? variant.variantId ?? variant.id ?? null;
    const variantId = isRealVariantId(candidateVariantId) ? candidateVariantId : null;
    const liveVariant =
      variantId !== null ? getCatalogVariantById(liveProduct, variantId, variant.color, variant.size) || normalizeCatalogVariant(variant) : null;
    const liveStock = normalizeStockQuantity(
      liveVariant?.stock_quantity ?? liveVariant?.stock ?? liveProduct.total_stock ?? liveProduct.stock
    );

    if (liveStock <= 0) {
      toast.error(t("pos.toasts.stockEmpty"));
      return;
    }

    const key = variantId ? String(variantId) : `product:${productId}`;
    const activePrice = Number(variant.price || product.sale_price || product.price || 0);
    const originalPrice = Number(variant.original_price || variant.regular_price || product.original_price || product.regular_price || variant.price || product.price || 0);
    const resolvedColor = variant.color || variant.variant_color || variant.selected_color || "";
    const resolvedSize = variant.size || variant.variant_size || variant.selected_size || product.fixed_size_label || "";
    if (!(activePrice > 0)) {
      toast.error(t("pos.toasts.productNoPrice"));
      return;
    }

    console.info("[display-refill-trace:pos-cart-item]", {
      product_id: productId || null,
      variant_id: variantId || null,
      size: resolvedSize || null,
      color: resolvedColor || null,
      selected_size: variant.selected_size || resolvedSize || null,
      selected_color: variant.selected_color || resolvedColor || null,
      variant_size: variant.variant_size || variant.size || null,
      variant_color: variant.variant_color || variant.color || null,
    });

    const existingCartItem = cart.find((item) => item.key === key);
    if (existingCartItem && Number(existingCartItem.quantity || 0) >= liveStock) {
      toast.error(t("pos.toasts.stockLimitReached"));
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.key === key);
      if (existing) {
        const nextQuantity = Math.min(liveStock, Number(existing.quantity || 0) + requestedQuantity);
        if (nextQuantity <= Number(existing.quantity || 0)) {
          toast.error(t("pos.toasts.stockLimitReached"));
          return prev;
        }

        return prev.map((item) =>
          item.key === key
            ? {
                ...item,
                stock: liveStock,
                stock_quantity: liveStock,
                quantity: nextQuantity,
              }
            : item
        );
      }

      return [
        ...prev,
        {
          key,
          product_id: productId,
          variant_id: variantId,
          name: product.name || product.product_name,
          product_name: product.product_name || product.name,
          sku: variant.sku || product.sku,
          barcode: variant.barcode || product.barcode || variant.sku,
          color: resolvedColor,
          size: resolvedSize,
          selected_color: variant.selected_color || resolvedColor,
          selected_size: variant.selected_size || resolvedSize,
          variant_color: variant.variant_color || resolvedColor,
          variant_size: variant.variant_size || resolvedSize,
          stock: liveStock,
          stock_quantity: liveStock,
          image_url: variant.image_url || product.image_url || "",
          image: variant.image || product.image || "",
          product_image: variant.product_image || product.product_image || "",
          cover_image: variant.cover_image || product.cover_image || "",
          thumbnail: variant.thumbnail || product.thumbnail || "",
          variant_image: variant.variant_image || product.variant_image || "",
          product_image_url: variant.product_image_url || product.product_image_url || product.image_url || "",
          variant_image_url: variant.variant_image_url || product.variant_image_url || "",
          color_image_url: variant.color_image_url || product.color_image_url || "",
          images: variant.images || product.images || null,
          gallery: variant.gallery || product.gallery || null,
          product,
          variant,
          product_variant: variant.product_variant || variant,
          color_object: variant.color_object || product.color || null,
          price: activePrice,
          original_price: originalPrice,
          sale_badge: variant.sale_badge || product.sale_badge || "",
          sale_source: variant.sale_source || product.sale_source || "regular",
          sale_mode_applied: Boolean(variant.sale_mode_applied || product.sale_mode_applied),
          brand: product.brand || variant.brand || "",
          category: product.category || variant.category || "",
          manufacturer: product.manufacturer || variant.manufacturer || "",
          variation_mode: product.variation_mode || "",
          fixed_size_label: product.fixed_size_label || "",
          lineDiscount: 0,
          quantity: Math.min(requestedQuantity, liveStock),
        },
      ];
    });

    if (!silent) {
      toast.success(
        requestedQuantity > 1
          ? t("pos.toasts.addedToCart", { name: `${product.name || product.product_name} أ—${requestedQuantity}` })
          : t("pos.toasts.addedToCart", { name: product.name || product.product_name })
      );
    }
  }, [products, t]);

  const openProductVariantPicker = useCallback((product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const selectionMatch = getProductSelectionMatch(product);
    const initialColor = selectionMatch.matchedColor || selectionMatch.matchedVariant?.color || "";
    const initialSize = selectionMatch.matchedVariant?.size || "";

    if (viewportIsMobile) {
      const firstVariant =
        selectionMatch.matchedVariant ||
        variants.find((variant) => normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0) ||
        variants[0] ||
        null;
      setSelectedColor(initialColor || firstVariant?.color || "");
      const firstInStockForColor =
        variants.find(
          (variant) =>
            String(variant.color || "") === String((initialColor || firstVariant?.color || "")) &&
            normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0
        ) || firstVariant;
      setSelectedSize(initialSize || firstInStockForColor?.size || "");
      setMobileProductQuantity(1);
      setSelectedProduct(product);
      return true;
    }

    if (variants.length <= 1) return false;

    const firstVariant =
      selectionMatch.matchedVariant ||
      variants.find((variant) => normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0) ||
      variants[0] ||
      null;
    setSelectedColor(initialColor || firstVariant?.color || "");
    const firstInStockForColor =
      variants.find(
        (variant) =>
          String(variant.color || "") === String((initialColor || firstVariant?.color || "")) &&
          normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0
      ) || firstVariant;
    setSelectedSize(initialSize || firstInStockForColor?.size || "");
    setMobileProductQuantity(1);
    setSelectedProduct(product);
    return true;
  }, [setMobileProductQuantity, setSelectedColor, setSelectedProduct, setSelectedSize, viewportIsMobile]);

  const quickAddProduct = useCallback((product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length === 1) {
      addVariantToCart(product, variants[0]);
      return;
    }

    if (variants.length > 1) {
      openProductVariantPicker(product);
      return;
    }

    const variant = pickFirstVariant(product);
    if (variant) {
      addVariantToCart(product, variant);
      return;
    }

    toast.error(t("pos.toasts.notSellable"));
  }, [addVariantToCart, openProductVariantPicker, t]);

  const handleSelectProduct = useCallback((product) => {
    if (openProductVariantPicker(product)) return;
    quickAddProduct(product);
  }, [openProductVariantPicker, quickAddProduct]);

  const handleRemoveCartItem = useCallback((key) => setCart((prev) => prev.filter((item) => item.key !== key)), []);
  const handleIncrease = useCallback((key) =>
    setCart((prev) =>
      prev.map((item) =>
        item.key === key
          ? (() => {
              const liveStock = getCatalogItemStock(products, item);
              const nextQuantity = Math.min(Number(item.quantity || 0) + 1, liveStock);
              if (nextQuantity === Number(item.quantity || 0)) {
                toast.error(t("pos.toasts.stockLimitReached"));
                return item;
              }
              return {
                ...item,
                stock: liveStock,
                stock_quantity: liveStock,
                quantity: nextQuantity,
              };
            })()
          : item
      )
    ), [products, t]);
  const handleDecrease = useCallback((key) =>
    setCart((prev) =>
      prev.map((item) =>
        item.key === key
          ? {
              ...item,
              quantity: Math.max(1, Number(item.quantity || 0) - 1),
            }
          : item
      )
    ), []);
  const handleItemDiscount = useCallback((key, value) =>
    setCart((prev) =>
      prev.map((item) =>
        item.key === key
          ? {
              ...item,
              lineDiscount: Number(value || 0),
            }
          : item
      )
    ), []);
  const showQuantityAdjustedWarning = useCallback((oldQuantity, newQuantity, availableStock) => {
    toast(
      [
        `Only ${availableStock} unit${Number(availableStock) === 1 ? "" : "s"} is available for the selected size.`,
        `Quantity was automatically adjusted from ${oldQuantity} to ${newQuantity}.`,
        `الكمية المتاحة للمقاس المحدد هي ${availableStock} فقط.`,
        `تم تعديل الكمية تلقائياً من ${oldQuantity} إلى ${newQuantity}.`,
      ].join("\n"),
      { icon: "!" }
    );
  }, []);
  const handleCartVariantChange = useCallback((key, variantId) => {
    const targetVariantId = String(variantId || "");
    if (!targetVariantId) return;

    setCart((prev) => {
      const sourceItem = prev.find((item) => String(item.key) === String(key));
      if (!sourceItem) return prev;

      const productId = sourceItem.product_id ?? sourceItem.product?.product_id ?? sourceItem.product?.id;
      const catalogProduct = getCatalogProductById(products, productId) || normalizeCatalogProduct(sourceItem.product || {});
      const targetVariant = getCatalogVariantById(catalogProduct, targetVariantId) ||
        (Array.isArray(sourceItem.product?.variants) ? sourceItem.product.variants : []).find(
          (variant) => String(variant.variant_id ?? variant.variantId ?? variant.id ?? "") === targetVariantId
        );

      if (!targetVariant) {
        toast.error("Variant not found / لم يتم العثور على المقاس أو اللون");
        return prev;
      }

      const liveStock = normalizeStockQuantity(targetVariant.stock_quantity ?? targetVariant.stock);
      if (liveStock <= 0) {
        toast.error("Out of stock / غير متوفر بالمخزون");
        return prev;
      }

      const nextKey = targetVariantId;
      const sourceQuantity = Number(sourceItem.quantity || 0);
      const nextQuantity = Math.min(sourceQuantity, liveStock);
      const quantityWasCapped = nextQuantity < sourceQuantity;
      const activePrice = Number(targetVariant.price || targetVariant.sale_price || catalogProduct.sale_price || catalogProduct.price || sourceItem.price || 0);
      const originalPrice = Number(targetVariant.original_price || targetVariant.regular_price || catalogProduct.original_price || catalogProduct.regular_price || activePrice);
      const nextItem = {
        ...sourceItem,
        key: nextKey,
        product_id: catalogProduct.product_id ?? catalogProduct.id ?? productId,
        variant_id: targetVariant.variant_id ?? targetVariant.id ?? targetVariantId,
        sku: targetVariant.sku || catalogProduct.sku || sourceItem.sku,
        barcode: targetVariant.barcode || catalogProduct.barcode || targetVariant.sku || sourceItem.barcode,
        color: targetVariant.color || "",
        size: targetVariant.size || catalogProduct.fixed_size_label || "",
        stock: liveStock,
        stock_quantity: liveStock,
        image_url: targetVariant.image_url || catalogProduct.image_url || sourceItem.image_url || "",
        image: targetVariant.image || catalogProduct.image || sourceItem.image || "",
        product_image_url: targetVariant.product_image_url || catalogProduct.product_image_url || catalogProduct.image_url || sourceItem.product_image_url || "",
        variant_image_url: targetVariant.variant_image_url || sourceItem.variant_image_url || "",
        color_image_url: targetVariant.color_image_url || sourceItem.color_image_url || "",
        product: catalogProduct,
        variant: targetVariant,
        product_variant: targetVariant.product_variant || targetVariant,
        price: activePrice,
        original_price: originalPrice,
        sale_badge: targetVariant.sale_badge || catalogProduct.sale_badge || sourceItem.sale_badge || "",
        sale_source: targetVariant.sale_source || catalogProduct.sale_source || sourceItem.sale_source || "regular",
        sale_mode_applied: Boolean(targetVariant.sale_mode_applied || catalogProduct.sale_mode_applied || sourceItem.sale_mode_applied),
        quantity: nextQuantity,
      };

      const existingTarget = prev.find((item) => String(item.key) === nextKey && String(item.key) !== String(key));
      if (existingTarget) {
        const requestedMergedQuantity = Number(existingTarget.quantity || 0) + nextQuantity;
        const mergedQuantity = Math.min(requestedMergedQuantity, liveStock);
        const cappedByMerge = mergedQuantity < requestedMergedQuantity;
        if (quantityWasCapped) showQuantityAdjustedWarning(sourceQuantity, nextQuantity, liveStock);
        if (cappedByMerge) showQuantityAdjustedWarning(requestedMergedQuantity, mergedQuantity, liveStock);
        return prev
          .filter((item) => String(item.key) !== String(key))
          .map((item) =>
            String(item.key) === nextKey
              ? {
                  ...item,
                  ...nextItem,
                  lineDiscount: Math.max(Number(item.lineDiscount || 0), Number(sourceItem.lineDiscount || 0)),
                  quantity: mergedQuantity,
                }
              : item
          );
      }

      if (quantityWasCapped) showQuantityAdjustedWarning(sourceQuantity, nextQuantity, liveStock);
      return prev.map((item) => (String(item.key) === String(key) ? nextItem : item));
    });
  }, [products, showQuantityAdjustedWarning]);

  const handleApplyCoupon = async () => {
    const code = String(couponCode || "").trim().toUpperCase();
    if (!code) {
      toast.error(t("pos.toasts.enterCoupon"));
      return;
    }
    try {
      setCouponLoading(true);
      const orderTotal = Math.max(0, Number(cartTotals.preLoyaltyTotal || 0) - Number(loyaltyDiscountAmount || 0));
      const response = await api.post("/coupons/validate", {
        code,
        source: "pos",
        order_total: orderTotal,
        customer_id: selectedCustomerId || null,
      });
      if (!response.valid) {
        setCouponValidation(null);
        toast.error(response.reason || t("pos.toasts.couponInvalid"));
        return;
      }
      setCouponCode(code);
      setCouponValidation(response);
      toast.success(t("pos.toasts.couponApplied", { amount: formatCurrency(response.discount_amount || 0) }));
    } catch (err) {
      setCouponValidation(null);
      toast.error(getErrorMessage(err, t("pos.toasts.couponValidateFailed")));
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponCode("");
    setCouponValidation(null);
  };

  const mapOrderItemToCartItem = (item = {}) => {
    const variantId = resolveCheckoutVariantId({
      ...item,
      variant_id: item.variant_id ?? item.product_variant_id ?? item.variantId ?? item.productVariantId ?? item.variant?.id ?? item.product_variant?.id,
    });
    const productId =
      item.product_id ||
      item.productId ||
      item.product?.id ||
      item.product?.product_id ||
      item.variant?.product_id ||
      item.product_variant?.product_id ||
      null;
    const key = variantId ? String(variantId) : `product:${productId || item.id || item.order_item_id || item.invoice_item_id}`;
    const catalogProduct = getCatalogProductById(products, productId) || {};
    const catalogVariant = variantId ? getCatalogVariantById(catalogProduct, variantId, item.color, item.size) || {} : {};
    const quantity = Number(item.quantity ?? item.qty ?? item.item_quantity ?? 0);
    const unitPrice = Number(item.sale_price ?? item.unit_price ?? item.price ?? item.selling_price ?? 0);
    const totalDiscount = Number(item.discount_amount ?? item.discount ?? 0);
    const liveStock = getCatalogItemStock(products, {
      product_id: productId,
      variant_id: variantId,
      variation_mode: item.variation_mode || catalogProduct.variation_mode || "full_variations",
    });

    return {
      key,
      order_item_id: item.id || item.order_item_id || item.invoice_item_id || null,
      product_id: productId,
      variant_id: variantId,
      name: item.product_name || item.name || item.product?.name || catalogProduct.name || "منتج",
      product_name: item.product_name || item.name || item.product?.name || catalogProduct.name || "منتج",
      sku: item.sku || catalogVariant.sku || catalogProduct.sku || "",
      barcode: item.barcode || catalogVariant.barcode || catalogProduct.barcode || "",
      color: item.color || item.variant_color || catalogVariant.color || "",
      size: item.size || item.variant_size || catalogVariant.size || "",
      stock: liveStock + quantity,
      stock_quantity: liveStock + quantity,
      image_url: item.image_url || item.product_image_url || item.variant_image_url || catalogVariant.image_url || catalogProduct.image_url || "",
      product_image_url: item.product_image_url || catalogProduct.product_image_url || catalogProduct.image_url || item.image_url || "",
      product: catalogProduct,
      variant: catalogVariant,
      product_variant: catalogVariant,
      price: unitPrice,
      unit_price: unitPrice,
      sale_price: unitPrice,
      variation_mode: item.variation_mode || catalogProduct.variation_mode || "full_variations",
      fixed_size_label: catalogProduct.fixed_size_label || "",
      discount_amount: totalDiscount,
      tax_amount: Number(item.tax_amount || 0),
      service_fee: Number(item.service_fee || 0),
      total_amount: Number(item.total_amount ?? Math.max(0, unitPrice * quantity - totalDiscount)),
      lineDiscount: totalDiscount / Math.max(1, quantity || 1),
      quantity,
    };
  };

  const loadRouteOrderIntoEditMode = async (orderId) => {
    if (!orderId) return false;
    const editStartedAt = performance.now();
    const editTimings = {};
    const markEditTiming = (label, startedAt) => {
      editTimings[label] = Math.round(performance.now() - startedAt);
    };
    try {
      if (POS_CHECKOUT_DEBUG) console.log("[pos-edit-ui] click start", { order_id: orderId, source: "route" });
      const fetchStartedAt = performance.now();
      const response = await api.get(`/orders/${orderId}/pos-edit`, { timeoutMs: 8000 });
      markEditTiming("fetch_invoice_details_ms", fetchStartedAt);
      const loadedOrder = response.order || { id: orderId };
      const loadedItems = extractOrderItemsFromResponse(response, loadedOrder);
      if (POS_CHECKOUT_DEBUG) console.log("[invoice-edit-load]", {
        order_id: orderId,
        invoice_number: loadedOrder.invoice_number || "",
        items_count: loadedItems.length,
        source: "route",
        fetch_invoice_details_ms: editTimings.fetch_invoice_details_ms,
      });
      const mapStartedAt = performance.now();
      const mappedCart = loadedItems.map(mapOrderItemToCartItem).filter((item) => item.quantity > 0);
      markEditTiming("map_order_to_cart_ms", mapStartedAt);
      if (POS_CHECKOUT_DEBUG) console.log("[invoice-edit-cart-map]", {
        order_id: orderId,
        mapped_cart_count: mappedCart.length,
        source: "route",
        map_order_to_cart_ms: editTimings.map_order_to_cart_ms,
      });
      if (loadedItems.length > 0 && mappedCart.length === 0) {
        toast.error("Invoice items could not be loaded into the cart.");
        return false;
      }

      const originalPaymentBreakdown = parsePaymentBreakdownRows(loadedOrder.payment_breakdown ?? loadedOrder.paymentBreakdown ?? loadedOrder.payments);
      const originalTotal = resolveEditOrderTotal(loadedOrder);
      const originalPaidAmount = resolveOriginalCollectedAmount({
        ...loadedOrder,
        original_total: originalTotal,
        original_payment_breakdown: originalPaymentBreakdown,
      });
      setEditingOrder({
        ...loadedOrder,
        original_order_id: loadedOrder.id || orderId,
        original_invoice_number: loadedOrder.invoice_number || "",
        original_total: originalTotal,
        original_paid_amount: originalPaidAmount,
        total_paid: originalPaidAmount,
        original_payment_status: loadedOrder.payment_status || "",
        original_payment_breakdown: originalPaymentBreakdown,
        payment_breakdown: originalPaymentBreakdown,
        original_items: loadedItems,
        items: loadedItems,
      });
      setCart(mappedCart);
      setInvoiceNumber(loadedOrder.invoice_number || invoiceNumber);
      setPaymentMode(loadedOrder.payment_method || "cash");
      setCashAmount(0);
      setCardAmount(0);
      setWalletAmount(0);
      setVodafoneCashAmount(0);
      setCustomerWalletAmount(0);
      setExchangeState(null);
      setInvoiceDiscountType(normalizeInvoiceDiscountType(loadedOrder.invoice_discount_type || "fixed"));
      setInvoiceDiscountValue(Number(loadedOrder.invoice_discount_value ?? loadedOrder.invoice_discount_amount ?? 0));
      setInvoiceDiscountReason(loadedOrder.invoice_discount_reason || "");
      setInvoiceDiscount(Number(loadedOrder.invoice_discount_amount || 0));
      setServiceFee(Number(loadedOrder.service_fee || 0));
      setEditRefundMethod("cash");

      const loadedCustomerId = loadedOrder.customer_id || loadedOrder.customer?.id || null;
      if (loadedCustomerId) {
        setCustomers((current) => {
          const rows = Array.isArray(current) ? current : [];
          if (rows.some((item) => String(item?.id || item?.customer_id) === String(loadedCustomerId))) return rows;
          return [
            {
              id: loadedCustomerId,
              customer_id: loadedCustomerId,
              name: loadedOrder.customer_name || loadedOrder.customer?.name || "Customer",
              phone: loadedOrder.customer_phone || loadedOrder.customer?.phone || "",
            },
            ...rows,
          ];
        });
      }
      setSelectedCustomerId(loadedCustomerId);
      setCustomerSearch(loadedOrder.customer_name || loadedOrder.customer?.name || loadedOrder.customer_phone || "");

      const sellerId =
        loadedOrder.sales_employee_id ||
        loadedOrder.salesperson_id ||
        loadedOrder.assigned_seller_id ||
        loadedOrder.seller_id ||
        loadedOrder.seller_employee_id ||
        "";
      setSelectedSalespersonId(sellerId ? String(sellerId) : "");
      setMarketingAttribution((current) => ({
        ...current,
        marketing_source: loadedOrder.marketing_source || current.marketing_source,
        marketing_platform: loadedOrder.marketing_platform || current.marketing_platform,
        marketing_post_id: loadedOrder.marketing_post_id || current.marketing_post_id,
        marketing_campaign: loadedOrder.marketing_campaign || current.marketing_campaign,
        attribution_type: loadedOrder.attribution_type || current.attribution_type,
        marketing_tracking_code: loadedOrder.marketing_tracking_code || current.marketing_tracking_code,
        marketing_session_id: loadedOrder.marketing_session_id || current.marketing_session_id,
      }));
      const openStartedAt = performance.now();
      setRecentOperationsOpen(false);
      markEditTiming("open_edit_mode_ms", openStartedAt);
      if (POS_CHECKOUT_DEBUG) {
        console.log("[pos-edit-ui] total", {
          order_id: orderId,
          source: "route",
          ...editTimings,
          total_ms: Math.round(performance.now() - editStartedAt),
        });
      }
      toast.success(t("pos.toasts.invoiceEditLoaded", { invoice: loadedOrder.invoice_number || orderId }));
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err, t("pos.toasts.invoiceEditLoadFailed")));
      return false;
    }
  };

  const handleEditRecentOrder = async (order) => {
    if (!order?.id) return;
    const editStartedAt = performance.now();
    const editTimings = {};
    const markEditTiming = (label, startedAt) => {
      editTimings[label] = Math.round(performance.now() - startedAt);
    };
    try {
      if (POS_CHECKOUT_DEBUG) console.log("[pos-edit-ui] click start", { order_id: order.id, source: "recent-orders" });
      const fetchStartedAt = performance.now();
      const response = await api.get(`/orders/${order.id}/pos-edit`, { timeoutMs: 8000 });
      markEditTiming("fetch_invoice_details_ms", fetchStartedAt);
      const loadedOrder = response.order || order;
      const loadedItems = extractOrderItemsFromResponse(response, order);
      if (POS_CHECKOUT_DEBUG) console.log("[invoice-edit-load]", {
        order_id: order.id,
        invoice_number: loadedOrder.invoice_number || order.invoice_number || "",
        items_count: loadedItems.length,
        fetch_invoice_details_ms: editTimings.fetch_invoice_details_ms,
      });
      const mapStartedAt = performance.now();
      const mappedCart = loadedItems.map(mapOrderItemToCartItem).filter((item) => item.quantity > 0);
      markEditTiming("map_order_to_cart_ms", mapStartedAt);
      if (POS_CHECKOUT_DEBUG) console.log("[invoice-edit-cart-map]", {
        order_id: order.id,
        mapped_cart_count: mappedCart.length,
        map_order_to_cart_ms: editTimings.map_order_to_cart_ms,
      });
      if (loadedItems.length > 0 && mappedCart.length === 0) {
        toast.error("Invoice items could not be loaded into the cart.");
        return;
      }
      const originalContext = { ...order, ...loadedOrder };
      const originalPaymentBreakdown = parsePaymentBreakdownRows(
        loadedOrder.payment_breakdown ?? loadedOrder.paymentBreakdown ?? loadedOrder.payments ?? order.payment_breakdown ?? order.paymentBreakdown ?? order.payments
      );
      const originalTotal = resolveEditOrderTotal(originalContext);
      const originalPaidAmount = resolveOriginalCollectedAmount({
        ...originalContext,
        original_total: originalTotal,
        original_payment_breakdown: originalPaymentBreakdown,
      });
      setEditingOrder({
        ...loadedOrder,
        original_order_id: loadedOrder.id || order.id,
        original_invoice_number: loadedOrder.invoice_number || order.invoice_number || "",
        original_total: originalTotal,
        original_paid_amount: originalPaidAmount,
        total_paid: originalPaidAmount,
        original_payment_status: loadedOrder.payment_status || order.payment_status || "",
        original_payment_breakdown: originalPaymentBreakdown,
        payment_breakdown: originalPaymentBreakdown,
        original_items: loadedItems,
        items: loadedItems,
      });
      setCart(mappedCart);
      setInvoiceNumber(loadedOrder.invoice_number || order.invoice_number || invoiceNumber);
      setPaymentMode(loadedOrder.payment_method || order.payment_method || "cash");
      setCashAmount(0);
      setCardAmount(0);
      setWalletAmount(0);
      setVodafoneCashAmount(0);
      setCustomerWalletAmount(0);
      setExchangeState(null);
      setInvoiceDiscountType(normalizeInvoiceDiscountType(loadedOrder.invoice_discount_type || "fixed"));
      setInvoiceDiscountValue(Number(loadedOrder.invoice_discount_value ?? loadedOrder.invoice_discount_amount ?? 0));
      setInvoiceDiscountReason(loadedOrder.invoice_discount_reason || "");
      setInvoiceDiscount(Number(loadedOrder.invoice_discount_amount || 0));
      setServiceFee(Number(loadedOrder.service_fee || 0));
      setEditRefundMethod("cash");
      setSelectedCustomerId(loadedOrder.customer_id || null);
      setCustomerSearch(loadedOrder.customer_name || "");
      const openStartedAt = performance.now();
      setRecentOperationsOpen(false);
      markEditTiming("open_edit_mode_ms", openStartedAt);
      if (POS_CHECKOUT_DEBUG) {
        console.log("[pos-edit-ui] total", {
          order_id: order.id,
          source: "recent-orders",
          ...editTimings,
          total_ms: Math.round(performance.now() - editStartedAt),
        });
      }
      toast.success(`أنت الآن تعدل فاتورة رقم ${loadedOrder.invoice_number || order.invoice_number}`);
    } catch (err) {
      toast.error(getErrorMessage(err, "تعذر تحميل الفاتورة للتعديل"));
    }
  };

  useEffect(() => {
    const editOrderId = String(routeEditOrderId || "").trim();
    if (!editOrderId || loadedRouteEditOrderIdRef.current === editOrderId) return;
    loadedRouteEditOrderIdRef.current = editOrderId;
    void loadRouteOrderIntoEditMode(editOrderId);
  }, [routeEditOrderId]);

  useEffect(() => {
    if (!editingOrder?.id || selectedSalespersonId || salesEmployees.length === 0) return;
    const sellerUserId = editingOrder.seller_user_id || editingOrder.sellerUserId || "";
    if (!sellerUserId) return;
    const seller = salesEmployees.find((employee) => String(employee.user_id || "") === String(sellerUserId));
    if (seller?.id) setSelectedSalespersonId(String(seller.id));
  }, [editingOrder, salesEmployees, selectedSalespersonId]);

  const handleExchangeStarted = ({ order, returnTotal = 0 } = {}) => {
    setEditingOrder(null);
    setInvoiceNumber(generateInvoiceNumber());
    setPaymentMode("cash");
    setCashAmount(0);
    setCardAmount(0);
    setWalletAmount(0);
    setVodafoneCashAmount(0);
    setCustomerWalletAmount(0);
    setExchangeState({
      active: true,
      originalOrderId: order?.id || order?.order_id || null,
      invoiceNumber: order?.invoice_number || order?.public_order_number || String(order?.id || ""),
      creditAmount: Number(returnTotal || order?.total_amount || order?.total || 0),
    });
    setInvoiceDiscountType(defaultState.invoiceDiscountType);
    setInvoiceDiscountValue(defaultState.invoiceDiscountValue);
    setInvoiceDiscountReason(defaultState.invoiceDiscountReason);
    setInvoiceDiscount(0);
    setServiceFee(0);
    handleClearSelectedCustomer();
    setRecentOperationsOpen(false);
    toast.success(`تم إنشاء استبدال للفاتورة ${order?.invoice_number || order?.id || ""}. أضف المنتج البديل إلى السلة ثم بيع جديد بقيمة مرتجع ${formatCurrency(returnTotal, "ar")}`);
  };

  const lookupExchangeOrder = async (query) => {
    const text = String(query || "").trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      try {
        const result = await api.get(`/orders/${text}`);
        return result?.order || result?.data?.order || result;
      } catch {
        // Try invoice-number search below.
      }
    }
    const result = await api.get("/orders", { params: { limit: 500 } });
    const orders = Array.isArray(result?.orders) ? result.orders : Array.isArray(result?.data) ? result.data : [];
    const lowerText = text.toLowerCase();
    return orders.find((order) =>
      [order.id, order.invoice_number, order.public_order_number, order.display_order_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === lowerText)
    ) || null;
  };

  const clearEditMode = () => {
    setEditingOrder(null);
    setInvoiceNumber(generateInvoiceNumber());
    setEditRefundMethod("cash");
    loadedRouteEditOrderIdRef.current = "";
    if (routeEditOrderId) {
      navigate("/pos", { replace: true });
    }
  };

  const handleCancelEdit = () => {
    setEditingOrder(null);
    setCart([]);
    setInvoiceNumber(generateInvoiceNumber());
    setPaymentMode("cash");
    setCashAmount(0);
    setCardAmount(0);
    setWalletAmount(0);
    setVodafoneCashAmount(0);
    setCustomerWalletAmount(0);
    setEditRefundMethod("cash");
    setExchangeState(null);
    setInvoiceDiscountType(defaultState.invoiceDiscountType);
    setInvoiceDiscountValue(defaultState.invoiceDiscountValue);
    setInvoiceDiscountReason(defaultState.invoiceDiscountReason);
    setInvoiceDiscount(0);
    setServiceFee(0);
    handleRemoveCoupon();
    handleClearSelectedCustomer();
    clearPosPersistedState();
    loadedRouteEditOrderIdRef.current = "";
    navigate("/orders", { replace: true });
    toast.success(t("pos.toasts.invoiceEditCancelled"));
  };

  const handleCreateCustomer = useCallback(async () => {
    const name = quickCustomer.name.trim();
    if (!name) {
      toast.error(t("pos.toasts.customerNameRequired"));
      return false;
    }

    const normalizedPhone = normalizeReceiptPhone(quickCustomer.phone);
    if (quickCustomer.phone && !normalizedPhone) {
      toast.error(t("pos.toasts.customerPhoneInvalid"));
      return false;
    }

    if (quickCustomerExistingMatch) {
      handleSelectCustomer(quickCustomerExistingMatch);
      setQuickCustomer(defaultState.quickCustomer);
      toast.success(t("pos.toasts.customerSelected", "Customer selected"));
      return true;
    }

    if (!quickCustomer.source_key) {
      toast.error(t("pos.toasts.customerSourceRequired", "Select where the new customer came from."));
      return false;
    }

    const customerSource = resolveMarketingAttributionFromSelection(quickCustomer.source_key);
    try {
      const result = await api.post("/customers", {
        name,
        phone: normalizedPhone,
        source: quickCustomer.source_key,
        customer_source: quickCustomer.source_key,
        lead_source: quickCustomer.source_key,
        registration_source: quickCustomer.source_key,
        marketing_source: customerSource.marketing_source || quickCustomer.source_key,
        marketing_platform: customerSource.marketing_platform || "",
        attribution_type: customerSource.attribution_type || quickCustomer.source_key,
        allow_personal_transactions: Boolean(quickCustomer.allow_personal_transactions),
      });

      const payload = result?.data ?? result;
      const createdCustomer = normalizePosCustomer(payload?.data ?? payload?.customer ?? payload);

      const createdCustomerId = createdCustomer?.id || createdCustomer?.customer_id;
      if (!createdCustomerId) {
        console.error("[pos] customer create response did not include an id:", result);
        toast.error(t("pos.toasts.customerCreateMissingId"));
        await loadCustomers();
        return false;
      }

      const upsertCreatedCustomer = (prev) => {
        const safePrev = Array.isArray(prev) ? prev : [];
        const withoutDuplicate = safePrev.filter((item) => String(item?.id || item?.customer_id) !== String(createdCustomerId));
        return [normalizePosCustomer(createdCustomer), ...withoutDuplicate];
      };

      setCustomers(upsertCreatedCustomer);
      setSelectedCustomerId(createdCustomerId);
      setCustomerSearch(`${createdCustomer.name || ""} ${createdCustomer.phone || ""}`.trim());
      const refreshedCustomers = await loadCustomers();
      const refreshedCustomer = refreshedCustomers.find((item) => String(item?.id || item?.customer_id) === String(createdCustomerId));
      setCustomers((prev) => {
        const selectedCustomer = normalizePosCustomer(refreshedCustomer || createdCustomer);
        const safePrev = Array.isArray(prev) ? prev : [];
        const withoutDuplicate = safePrev.filter((item) => String(item?.id || item?.customer_id) !== String(createdCustomerId));
        return [selectedCustomer, ...withoutDuplicate];
      });
      setSelectedCustomerId(createdCustomerId);

      setQuickCustomer(defaultState.quickCustomer);
      toast.success(t("pos.toasts.customerCreated"));
      return true;
    } catch (err) {
      const message = getErrorMessage(err, t("pos.toasts.customerCreateFailed"));
      console.error("[pos] failed to create customer:", message, err);
      toast.error(message);
      return false;
    }
  }, [
    handleSelectCustomer,
    loadCustomers,
    quickCustomer.allow_personal_transactions,
    quickCustomer.name,
    quickCustomer.phone,
    quickCustomer.source_key,
    quickCustomerExistingMatch,
    resolveMarketingAttributionFromSelection,
    setCustomerSearch,
    setCustomers,
    setCustomerCreateOpen,
    setQuickCustomer,
    setSelectedCustomerId,
    t,
  ]);

  const handleOpenShift = async () => {
    try {
      setAttendanceLoading(true);
      const response = await api.post("/pos/shifts/open", {
        branch_id: resolvedPosBranchId || null,
        opening_cash: Number(openingCash || 0),
      });
      setActivePosShift(response?.shift || null);
      setPosShiftBranch(response?.branch || posShiftBranch || null);
      setOpeningCash("");
      setSelectedSalespersonId(currentUser?.id ? String(currentUser.id) : "");
      toast.success(t("pos.shift.opened"));
      emitFeedback("attendance_check_in", {
        title: t("pos.shift.opened"),
        message: currentUser?.name || currentUser?.email || "",
      });
    } catch (err) {
      console.error("[pos] failed to open shift:", err);
      toast.error(err?.message || t("pos.shift.noBranchMessage"));
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleCloseShift = async () => {
    if (!activePosShift?.id) {
      toast.error("لا توجد نردية مفتوحة");
      return;
    }

    try {
      setAttendanceLoading(true);
      const response = await api.get(`/pos/shifts/${activePosShift.id}/report`);
      const report = response?.report || null;
      setShiftCloseReport(report || {
        shift: activePosShift,
        totals: {
          opening_cash: Number(activePosShift.opening_cash || 0),
          expected_cash: Number(activePosShift.expected_cash || 0),
          total_sales: Number(activePosShift.sales_cash || 0),
          cash: Number(activePosShift.sales_cash || 0),
          card: 0,
          wallet: 0,
          invoice_count: 0,
          returns: 0,
          discounts: 0,
        },
        payment_breakdown: [],
        top_products: [],
        audit_timeline: [],
      });
      const expectedCash = report?.totals?.expected_cash ?? activePosShift.expected_cash ?? activePosShift.opening_cash ?? 0;
      setClosingCash(String(expectedCash));
      setActualDrawerAmount(String(expectedCash));
      setShiftCloseNotes("");
      setShiftVarianceReason("");
      setShiftCloseOpen(true);
    } catch (err) {
      console.error("[pos] failed to close shift:", err);
      toast.error(err?.message || t("pos.shift.failedClose"));
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleConfirmCloseShift = async () => {
    if (shiftCloseSubmitting) return;

    try {
      setShiftCloseSubmitting(true);
      const actualDrawer = closingCash === "" ? 0 : Number(closingCash);
      const response = await api.post(`/pos/shifts/${activePosShift.id}/close`, {
        closing_cash: actualDrawer,
        closing_notes: shiftCloseNotes,
        variance_reason: shiftVarianceReason,
      });

      const closedShift = response?.shift || {};
      setShiftReport(response?.report || {
        ...(shiftCloseReport || {}),
        shift: { ...(shiftCloseReport?.shift || {}), ...closedShift },
        totals: {
          ...(shiftCloseReport?.totals || {}),
          closing_cash: actualDrawer,
          expected_cash: Number(closedShift.expected_cash ?? shiftCloseReport?.totals?.expected_cash ?? 0),
          cash_difference: Number(closedShift.cash_difference ?? closedShift.difference ?? actualDrawer - Number(shiftCloseReport?.totals?.expected_cash || 0)),
        },
      });
      setShiftReportOpen(true);
      toast.success(t("pos.shift.closedSuccess"));
      emitFeedback("attendance_check_out", {
        title: t("pos.shift.closedSuccess"),
        message: currentUser?.name || currentUser?.email || "",
      });
      setShiftCloseOpen(false);
      setShiftCloseReport(null);
      setActualDrawerAmount("");
      setShiftCloseNotes("");
      setShiftVarianceReason("");
      setClosingCash("");
      setActivePosShift(null);
      clearPosPersistedState();
      await loadActivePosShift({ silent: true });
    } catch (err) {
      console.error("[pos] failed to confirm shift close:", err);
      toast.error(err?.message || t("pos.shift.failedClose"));
    } finally {
      setShiftCloseSubmitting(false);
    }
  };

  const handleSaveQuickExpense = async () => {
    if (!activePosShift?.id) {
      toast.error(t("pos.shift.openShift", "Open shift"));
      return;
    }
    const amount = Number(quickExpense.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid expense amount");
      return;
    }
    const isEmployeeAdvance = quickExpense.category === "employee_advance";
    if (isEmployeeAdvance && !quickExpense.employee_id) {
      toast.error("Select an employee for the advance");
      return;
    }
    try {
      setQuickExpenseSaving(true);
      const response = await api.post("/pos/expenses", {
        shift_id: activePosShift.id,
        branch_id: activePosShift.branch_id || posShiftBranch?.id || currentUser?.branch_id || null,
        category: quickExpense.category,
        expense_type: quickExpense.category,
        amount,
        payment_method: quickExpense.payment_method,
        notes: quickExpense.notes,
        employee_id: isEmployeeAdvance ? quickExpense.employee_id : null,
      });
      const report = response?.report || null;
      if (report?.shift) {
        setActivePosShift((prev) => ({ ...(prev || {}), ...report.shift }));
      }
      if (shiftCloseReport && report) setShiftCloseReport(report);
      if (shiftReport && report) setShiftReport(report);
      setQuickExpense(quickExpenseDefaults);
      setQuickExpenseOpen(false);
      toast.success(isEmployeeAdvance ? "Employee advance saved" : "Expense saved");
    } catch (err) {
      console.error("[pos] failed to create quick expense:", err);
      toast.error(err?.message || "Failed to save expense");
    } finally {
      setQuickExpenseSaving(false);
    }
  };

  const handleCheckout = async (options = {}) => {
    const paymobTerminalCheckout = options?.paymobTerminal === true;
    const paymobTerminalConfirmed = options?.paymobTerminalConfirmed === true;
    const creditSaleCheckout = options?.creditSale === true;
    const terminalConfirmedAmount = paymobTerminalConfirmed
      ? Math.max(0, Number(options?.terminalAmount || paymobTerminalState?.amount || 0))
      : 0;
    const editActive = Boolean(editingOrder?.id);
    const editSettlementType = editActive
      ? (editRefundOrCreditDue > 0 ? "refund" : editAmountDueNow > 0 ? "extra_payment" : "none")
      : null;
    const resolvedEditPaymentMethod = editActive
      ? (editRefundOrCreditDue > 0 ? editRefundMethod : creditSaleCheckout ? "credit_sale" : paymentMode)
      : paymentMode;
    console.log("[pos-checkout:clicked]", {
      checkoutLoading,
      cart_count: cart.length,
      editing_order_id: editingOrder?.id || null,
      paymob_terminal: paymobTerminalCheckout,
    });
    if (checkoutLoading) {
      return null;
    }

    if (cart.length === 0) {
      toast.error(t("pos.toasts.cartEmpty"));
      return null;
    }

    if (!loyaltyUnavailable && Number(loyaltyRedeemPoints || 0) > 0 && loyaltyValidation && loyaltyValidation.valid === false) {
      toast.error(t("pos.toasts.loyaltyExceeded"));
      return null;
    }

    if (!isShiftActive) {
      toast.error("يجب فتح نردية قبل البيع");
      return null;
    }

    const checkoutBranchId = activePosShift?.branch_id || posShiftBranch?.id || currentUser?.branch_id || null;
    if (!checkoutBranchId) {
      toast.error(t("pos.shift.employeeNoBranch"));
      return null;
    }

    if (missingFullVariantForCheckout) {
      toast.error(t("pos.toasts.selectVariantBeforeCheckout"));
      return null;
    }

    if (invalidCartItemForCheckout) {
      console.error("[pos] invalid checkout cart item:", {
        product_id: invalidCartItemForCheckout.product_id || invalidCartItemForCheckout.productId || null,
        variant_id: resolveCheckoutVariantId(invalidCartItemForCheckout),
        quantity: invalidCartItemForCheckout.quantity,
        price: invalidCartItemForCheckout.price,
      });
      toast.error(t("pos.toasts.invalidCartItem"));
      return null;
    }

    const currentUserId = currentUser?.id ? String(currentUser.id) : "";
    const currentUserSeller = salesEmployees.find((employee) => currentUserId && String(employee.user_id || "") === currentUserId);
    const currentEmployeeId = currentUserSeller?.id ? String(currentUserSeller.id) : "";
    if (!canOverrideSeller && selectedSalespersonId && currentEmployeeId && String(selectedSalespersonId) !== currentEmployeeId) {
      toast.error("لا تملك صلاحية البيع باسم مستخدم آخر");
      return null;
    }

    if (!salesSettings.allow_sale_without_salesperson && !selectedSalespersonId) {
      toast.error("Select a salesperson before checkout");
      return null;
    }

    if ((paymobTerminalCheckout || paymobTerminalConfirmed) && Number(paymobTerminalConfirmed ? terminalConfirmedAmount : paymobTerminalAmount) <= 0) {
      toast.error("Invoice amount is required");
      return null;
    }

    const normalizedPaymentMode = String(creditSaleCheckout ? "credit_sale" : paymentMode || "").toLowerCase();
    const isPersonalTransaction = normalizedPaymentMode === "personal";
    const isCreditSaleTransaction = normalizedPaymentMode === "credit_sale";
    const requestedCustomerWalletAmount = paymentMode === "customer_wallet"
      ? Number(paymentSummary.paidAmount || customerWalletAmount || 0)
      : paymentMode === "split"
        ? Number(customerWalletAmount || 0)
        : 0;
    if (isPersonalTransaction) {
      if (!customer || !customer.id) {
        toast.error("اختر عميلًا أولًا قبل العملية الشخصية.");
        return null;
      }
      if (!Boolean(customer.allow_personal_transactions ?? customer.allowPersonalTransactions ?? false)) {
        toast.error("هذا العميل غير مسموح له بالعمليات الشخصية.");
        return null;
      }
      if (!String(personalSettlementType || "").trim()) {
        toast.error("اختر نوع العملية الشخصية قبل حفظ الفاتورة.");
        return null;
      }
    }
    if (isCreditSaleTransaction && (!customer || !customer.id)) {
      toast.error("اختر عميلًا أولًا قبل البيع الآجل.");
      return null;
    }
    const availableCustomerWalletBalance = canUseCustomerCredit ? customerCreditBalance : 0;
    if (requestedCustomerWalletAmount > 0 && !canUseCustomerCredit) {
      toast.error("رصيد العميل متاح فقط عند اختيار عميل لديه رصيد موجب.");
      return null;
    }
    if (requestedCustomerWalletAmount > availableCustomerWalletBalance) {
      const shortage = Math.max(0, requestedCustomerWalletAmount - availableCustomerWalletBalance);
      toast.error(
        `${POS_ARABIC_TEXT.notEnoughCredit}.\nالرصيد الحالي: ${formatCurrency(availableCustomerWalletBalance)}\n${POS_ARABIC_TEXT.required}: ${formatCurrency(requestedCustomerWalletAmount)}\n${POS_ARABIC_TEXT.shortage}: ${formatCurrency(shortage)}`
      );
      return null;
    }

    const enteredPaymentTotal = isPersonalTransaction || isCreditSaleTransaction
      ? Number(amountDueNow || cartTotals.total || 0)
      : Number(cashAmount || 0) + Number(cardAmount || 0) + Number(walletAmount || 0) + Number(vodafoneCashAmount || 0) + requestedCustomerWalletAmount;
    const paymentTarget = Number(amountDueNow || 0);
    if (enteredPaymentTotal - paymentTarget > 0.009) {
      toast.error("Payment total cannot exceed amount due now");
      return null;
    }
    if (!isPersonalTransaction && !isCreditSaleTransaction && !paymobTerminalCheckout && !paymobTerminalConfirmed && Math.abs(enteredPaymentTotal - paymentTarget) > 0.009) {
      toast.error(`Payment mismatch. Remaining: ${formatCurrency(Math.max(0, paymentTarget - enteredPaymentTotal))}`);
      return null;
    }
    if ((isPersonalTransaction || isCreditSaleTransaction) && (paymobTerminalCheckout || paymobTerminalConfirmed)) {
      toast.error("العملية الشخصية لا تدعم الدفع عبر التيرمنال.");
      return null;
    }

    const selectedTreasuryRequiresBalance = paymentAccountStatus?.requires_balance !== false && paymentAccountStatus?.direction !== "in";
    if (selectedTreasuryRequiresBalance && paymentAccountStatus?.account && paymentAccountStatus.sufficient === false && paymentAccountStatus.allow_negative_balance !== true) {
      const accountName = safeArabicText(paymentAccountStatus.account.name, POS_ARABIC_TEXT.accountSelected);
      const fallback = Array.isArray(paymentAccountStatus.fallback_accounts) && paymentAccountStatus.fallback_accounts[0]
        ? `\nيوجد رصيد إضافي في ${safeArabicText(paymentAccountStatus.fallback_accounts[0].name, POS_ARABIC_TEXT.account)}`
        : "";
      toast.error(
        `رصيد ${accountName} غير كاف.\nالرصيد الحالي: ${formatCurrency(paymentAccountStatus.available_balance || 0)}\n${POS_ARABIC_TEXT.required}: ${formatCurrency(activePaymentAccountAmount || cartTotals.total || 0)}\n${POS_ARABIC_TEXT.shortage}: ${formatCurrency(paymentAccountStatus.shortage_amount || 0)}${fallback}`
      );
      return null;
    }
    if (selectedTreasuryRequiresBalance && paymentAccountStatus?.account && paymentAccountStatus.shortage_amount > 0 && paymentAccountStatus.allow_negative_balance === true) {
      const accountName = safeArabicText(paymentAccountStatus.account.name, POS_ARABIC_TEXT.accountSelected);
      toast(
        `تنبيه: سيصبح رصيد ${accountName} سالباً.\nالرصيد الحالي: ${formatCurrency(paymentAccountStatus.available_balance || 0)}\n${POS_ARABIC_TEXT.required}: ${formatCurrency(activePaymentAccountAmount || cartTotals.total || 0)}\n${POS_ARABIC_TEXT.shortage}: ${formatCurrency(paymentAccountStatus.shortage_amount || 0)}`,
        { icon: "!" }
      );
    }

    try {
      console.log("[pos-checkout:frontend-submit]", {
        checkout_branch_id: checkoutBranchId,
        cart_count: cart.length,
        payment_method: resolvedEditPaymentMethod,
        paymob_terminal: paymobTerminalCheckout,
      });
      const checkoutStartedAt = performance.now();
      let apiStartedAt = checkoutStartedAt;
      setCheckoutLoading(true);
      if (editingOrder?.id) {
        console.log("[cart-reset-blocked-edit-mode]", {
          order_id: editingOrder.id,
          cart_count: cart.length,
          reason: "skip checkout stock reconciliation while saving invoice edit",
        });
      }

      const invoiceCustomer = customer || WALK_IN_CUSTOMER;
      const customerId = customer ? customer.id || customer.customer_id : null;

      if (customer && !customerId) {
        console.error("[pos] selected customer is missing id/customer_id at checkout:", customer);
        toast.error(t("pos.toasts.selectedCustomerMissingId"));
        return null;
      }

      const selectedSeller = salesEmployees.find((employee) => String(employee.id) === String(selectedSalespersonId));
      const resolvedSellerUserId = selectedSeller?.user_id || null;
      const resolvedSalesEmployeeId = selectedSeller?.employee_id || selectedSeller?.id || null;
      const resolvedSellerName = selectedSeller?.name || selectedSeller?.full_name || selectedSeller?.pos_alias || "";
      console.log("[pos][seller-debug] selected seller before checkout", {
        selectedSalespersonId,
        selectedSeller,
        resolvedSellerUserId,
        resolvedSalesEmployeeId,
        resolvedSellerName,
      });
      const terminalManualCashAmount = paymentMode === "split" ? Number(cashAmount || 0) : 0;
      const terminalManualWalletAmount = paymentMode === "split" ? Number(walletAmount || 0) : 0;
      const terminalManualVodafoneCashAmount = paymentMode === "split" ? Number(vodafoneCashAmount || 0) : 0;
      const terminalManualCustomerWalletAmount = paymentMode === "split" ? Number(customerWalletAmount || 0) : 0;
      const terminalManualPaidAmount = Math.max(0, terminalManualCashAmount + terminalManualWalletAmount + terminalManualVodafoneCashAmount + terminalManualCustomerWalletAmount);
      const checkoutPaymentSummary = creditSaleCheckout
        ? {
            paidAmount: 0,
            changeAmount: 0,
            dueAmount: Number(amountDueNow || cartTotals.total || 0),
            paymentStatus: Number(amountDueNow || 0) > 0 ? "Pending" : "Paid",
          }
        : paymobTerminalConfirmed
        ? {
            paidAmount: terminalConfirmedAmount,
            changeAmount: 0,
            dueAmount: 0,
            paymentStatus: "Paid",
          }
        : paymobTerminalCheckout
        ? {
            paidAmount: terminalManualPaidAmount,
            changeAmount: Math.max(0, terminalManualPaidAmount - Number(amountDueNow || 0)),
            dueAmount: Math.max(0, Number(amountDueNow || 0) - terminalManualPaidAmount),
            paymentStatus:
              terminalManualPaidAmount >= Number(amountDueNow || 0) && Number(amountDueNow || 0) > 0
                ? "Paid"
                : Number(amountDueNow || 0) <= 0
                  ? "Paid"
                  : terminalManualPaidAmount > 0
                  ? "Partial"
                  : "Pending",
          }
        : paymentSummary;
      const personalPaymentAmount = isPersonalTransaction ? Number(amountDueNow || cartTotals.total || 0) : 0;
      const payloadCashAmount = paymobTerminalConfirmed
        ? 0
        : creditSaleCheckout
          ? 0
        : paymobTerminalCheckout
        ? terminalManualCashAmount
        : paymentMode === "cash"
          ? paymentSummary.paidAmount
          : paymentMode === "split"
            ? Number(cashAmount || 0)
            : 0;
      const payloadCardAmount = paymobTerminalConfirmed
        ? terminalConfirmedAmount
        : creditSaleCheckout
          ? 0
        : paymobTerminalCheckout
          ? 0
        : paymentMode === "card"
          ? paymentSummary.paidAmount
          : paymentMode === "split"
            ? Number(cardAmount || 0)
            : 0;
      const payloadWalletAmount = paymobTerminalConfirmed
        ? 0
        : creditSaleCheckout
          ? 0
        : paymobTerminalCheckout
        ? terminalManualWalletAmount
        : paymentMode === "instapay" || paymentMode === "wallet"
          ? paymentSummary.paidAmount
          : paymentMode === "split"
            ? Number(walletAmount || 0)
            : 0;
      const payloadVodafoneCashAmount = paymobTerminalConfirmed
        ? 0
        : creditSaleCheckout
          ? 0
        : paymobTerminalCheckout
        ? terminalManualVodafoneCashAmount
        : paymentMode === "vodafone_cash"
          ? paymentSummary.paidAmount
          : paymentMode === "split"
            ? Number(vodafoneCashAmount || 0)
            : 0;
      const payloadCustomerWalletAmount = paymobTerminalConfirmed
        ? 0
        : creditSaleCheckout
          ? 0
        : paymobTerminalCheckout
        ? terminalManualCustomerWalletAmount
        : paymentMode === "customer_wallet"
          ? paymentSummary.paidAmount
          : paymentMode === "split"
            ? Number(customerWalletAmount || 0)
            : 0;
      const paymentBreakdown = isPersonalTransaction
        ? [{
            method: "personal",
            amount: personalPaymentAmount,
            personal_settlement_type: personalSettlementType,
            personal_note: String(personalNote || "").trim() || null,
          }]
        : creditSaleCheckout
          ? []
        : [
            exchangeState?.active && !editingOrder?.id
              ? {
                  method: "exchange_credit",
                  amount: appliedExchangeCredit,
                  original_order_id: exchangeState?.originalOrderId || null,
                  invoice_number: exchangeState?.invoiceNumber || "",
                }
              : null,
            { method: "cash", amount: payloadCashAmount },
            { method: "card", amount: payloadCardAmount },
            { method: "instapay", amount: payloadWalletAmount },
            { method: "vodafone_cash", amount: payloadVodafoneCashAmount },
            { method: "customer_wallet", amount: payloadCustomerWalletAmount },
          ].filter((item) => item && Number(item.amount || 0) > 0);
      const additionalPaymentBreakdown = editingOrder?.id
        ? paymentBreakdown.filter((item) => item.method !== "exchange_credit")
        : [];
      console.log("[pos-checkout:edit-settlement-payload]", {
        editing_order_id: editingOrder?.id || null,
        edit_settlement_type: editSettlementType,
        edit_settlement_method: editActive ? resolvedEditPaymentMethod : null,
        edit_refund_method: editActive ? editRefundMethod : null,
        refund_or_credit_due: editRefundOrCreditDue,
        amount_due_now: editAmountDueNow,
        additional_payment_breakdown: additionalPaymentBreakdown,
      });
      const payload = {
        customer_name: invoiceCustomer.name,
        customer_id: customerId || null,
        customer_phone: customer?.phone || "",
        payment_method: isPersonalTransaction ? "personal" : (creditSaleCheckout ? "credit_sale" : (paymobTerminalConfirmed ? "card" : paymentMode)),
        payment_transaction_id: paymobTerminalConfirmed ? options?.paymobTerminalTransactionId || null : null,
        paymob_terminal_transaction_id: paymobTerminalConfirmed ? options?.paymobTerminalTransactionId || null : null,
        subtotal: cartTotals.subtotal,
        discount_amount: cartTotals.itemDiscountTotal + cartTotals.invoiceDiscount,
        invoice_discount_type: cartTotals.invoiceDiscount > 0 ? invoiceDiscountType : null,
        invoice_discount_value: cartTotals.invoiceDiscount > 0 ? Number(invoiceDiscountValue || 0) : 0,
        invoice_discount_amount: cartTotals.invoiceDiscount,
        invoice_discount_reason: cartTotals.invoiceDiscount > 0 ? String(invoiceDiscountReason || "").trim() : "",
        coupon_code: couponValidation?.valid ? couponValidation.coupon?.code || couponCode : null,
        coupon_discount_amount: couponValidation?.valid ? Number(couponValidation.discount_amount || 0) : 0,
        loyalty_points_redeemed: loyaltyUnavailable ? 0 : Number(loyaltyValidation?.applied_points || loyaltyRedeemPoints || 0),
        loyalty_discount_amount: loyaltyUnavailable ? 0 : Number(loyaltyValidation?.applied_amount || 0),
        wallet_amount: payloadCustomerWalletAmount,
        full_wallet_redemption_only: paymentMode === "customer_wallet" && payloadCustomerWalletAmount >= Number(amountDueNow || 0),
        tax_amount: 0,
        tax_rate: 0,
        service_fee: cartTotals.serviceFee,
        total: cartTotals.total,
        paid_amount: checkoutPaymentSummary.paidAmount,
        change_amount: checkoutPaymentSummary.changeAmount,
        status: checkoutPaymentSummary.paymentStatus,
        payment_status: creditSaleCheckout ? "unpaid" : checkoutPaymentSummary.paymentStatus,
        branch_id: checkoutBranchId,
        cash_amount: payloadCashAmount,
        card_amount: payloadCardAmount,
        wallet_payment_amount: payloadWalletAmount + payloadVodafoneCashAmount,
        payment_breakdown: paymentBreakdown,
        payments: paymentBreakdown,
        personal_settlement_type: isPersonalTransaction ? personalSettlementType : null,
        personal_note: isPersonalTransaction ? String(personalNote || "").trim() || null : null,
        edit_order_id: editingOrder?.id || null,
        original_invoice_number: editingOrder?.id ? editingOrder.invoice_number || editingOrder.invoiceNumber || "" : "",
        original_paid_amount: editingOrder?.id ? originalEditPaidAmount : 0,
        new_total: editingOrder?.id ? cartTotals.total : null,
        amount_due_now: creditSaleCheckout ? Number(amountDueNow || cartTotals.total || 0) : amountDueNow,
        refund_or_credit_due: editingOrder?.id ? editRefundOrCreditDue : 0,
        edit_settlement_type: editSettlementType,
        edit_settlement_method: editingOrder?.id ? resolvedEditPaymentMethod : null,
        edit_refund_method: editingOrder?.id ? editRefundMethod : null,
        additional_payment_breakdown: additionalPaymentBreakdown,
        exchange_mode: Boolean(exchangeState?.active && !editingOrder?.id),
        original_order_id: !editingOrder?.id ? exchangeState?.originalOrderId || null : null,
        exchange_credit_amount: !editingOrder?.id ? exchangeCreditAmount : 0,
        new_order_total: cartTotals.total,
        exchange_difference: exchangeDifference,
        exchange_invoice_number: exchangeState?.invoiceNumber || "",
        shift_id: activePosShift.id,
        seller_user_id: resolvedSellerUserId,
        seller_id: resolvedSalesEmployeeId,
        seller_name: resolvedSellerName,
        salesperson_name: resolvedSellerName,
        cashier_user_id: currentUser?.id || null,
        cashier_id: currentUser?.id || null,
        sales_employee_id: resolvedSalesEmployeeId,
        salesperson_id: resolvedSalesEmployeeId,
        assigned_seller_id: resolvedSalesEmployeeId,
        seller_employee_id: resolvedSalesEmployeeId,
        ...resolveMarketingAttributionPayload(marketingAttribution),
        items: cart.map((item) => {
          const quantity = Number(item.quantity || 0);
          const unitPrice = resolveCheckoutItemUnitPrice(item);
          const discountAmount = Number(item.discount_amount ?? Number(item.lineDiscount || 0) * quantity);
          const lineTotal = Math.max(0, unitPrice * quantity - discountAmount);
          if (POS_CHECKOUT_DEBUG && !(unitPrice > 0) && Number(cartTotals.total || 0) > 0) {
            console.warn("[pos] checkout item missing unit price", {
              product_id: item.product_id || null,
              variant_id: resolveCheckoutVariantId(item),
              product_name: item.product_name || item.name || "",
              quantity,
              price_fields: {
                unit_price: item.unit_price,
                price: item.price,
                sale_price: item.sale_price,
                final_price: item.final_price,
                variant_price: item.variant_price,
              },
            });
          }
          return {
            product_id: item.product_id || null,
            product_name: item.product_name || item.name || "",
            variant_id: resolveCheckoutVariantId(item),
            variant_name: [item.color || item.variant_color || item.selected_color, item.size || item.variant_size || item.selected_size].filter(Boolean).join(" / "),
            variation_mode: item.variation_mode || "full_variations",
            sku: item.sku || "",
            barcode: item.barcode || "",
            size: item.size || item.selected_size || item.variant_size || "",
            color: item.color || item.selected_color || item.variant_color || "",
            selected_size: item.selected_size || item.size || item.variant_size || "",
            selected_color: item.selected_color || item.color || item.variant_color || "",
            variant_size: item.variant_size || item.size || item.selected_size || "",
            variant_color: item.variant_color || item.color || item.selected_color || "",
            quantity,
            price: unitPrice,
            unit_price: unitPrice,
            sale_price: unitPrice,
            final_price: unitPrice,
            variant_price: Number(item.variant_price ?? item.variantPrice ?? unitPrice),
            discount_amount: discountAmount,
            tax_amount: 0,
            tax_rate: 0,
            line_total: lineTotal,
            subtotal: lineTotal,
            total_amount: lineTotal,
          };
        }),
      };

      console.log("[pos-checkout:payload-built]", {
        editing_order_id: editingOrder?.id || null,
        payment_method: payload.payment_method,
        edit_settlement_type: payload.edit_settlement_type,
        edit_settlement_method: payload.edit_settlement_method,
        edit_refund_method: payload.edit_refund_method,
        additional_payment_breakdown_count: Array.isArray(payload.additional_payment_breakdown) ? payload.additional_payment_breakdown.length : 0,
      });
      console.log("[pos:discount-checkout-payload]", {
        subtotal: payload.subtotal,
        item_discount_amount: cartTotals.itemDiscountTotal,
        invoice_discount_type: payload.invoice_discount_type,
        invoice_discount_value: payload.invoice_discount_value,
        invoice_discount_amount: payload.invoice_discount_amount,
        invoice_discount_reason: payload.invoice_discount_reason ? "[present]" : "",
        aggregate_discount_amount: payload.discount_amount,
        service_fee: payload.service_fee,
        total: payload.total,
        payment_due_amount: amountDueNow,
        paid_amount: payload.paid_amount,
        payment_method: payload.payment_method,
        payment_breakdown_total: paymentBreakdown.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      });

      console.info("[display-refill-trace:checkout-payload]", {
        items: payload.items.slice(0, 10).map((item) => ({
          product_id: item.product_id || null,
          variant_id: item.variant_id || null,
          size: item.size || null,
          color: item.color || null,
          selected_size: item.selected_size || null,
          selected_color: item.selected_color || null,
          variant_size: item.variant_size || null,
          variant_color: item.variant_color || null,
        })),
      });

      if (import.meta.env.DEV) {
        console.log("[pos] final checkout payload", {
          ...payload,
          customer_phone: payload.customer_phone ? "[redacted]" : "",
        });
      }

      if (editingOrder?.id) {
        const response = await api.patch(`/orders/${editingOrder.id}/edit`, {
          ...payload,
          reason: `POS edit for invoice ${editingOrder.invoice_number || editingOrder.id}`,
        }, { timeoutMs: 30000 });
        const updatedOrder = response.order || {};
        setLastOrder({
          ...editingOrder,
          ...updatedOrder,
          items: response.items || payload.items,
          cart: [...cart],
          invoice_number: updatedOrder.invoice_number || editingOrder.invoice_number,
          invoiceNumber: updatedOrder.invoice_number || editingOrder.invoice_number,
          customerName: payload.customer_name,
          total: cartTotals.total,
          totals: cartTotals,
          payment: {
            method: paymentMode,
            paymentStatus: checkoutPaymentSummary.paymentStatus,
            paidAmount: checkoutPaymentSummary.paidAmount,
            dueAmount: checkoutPaymentSummary.dueAmount,
            changeAmount: checkoutPaymentSummary.changeAmount,
            exchangeMode: Boolean(exchangeState?.active),
            exchangeInvoiceNumber: exchangeState?.invoiceNumber || "",
            exchangeCreditAmount,
            newOrderTotal: cartTotals.total,
            amountDueNow,
            exchangeDifference,
            remainingExchangeCustomerCredit,
            editMode: Boolean(editingOrder?.id),
            originalPaidAmount: originalEditPaidAmount,
            additionalPaidAmount: checkoutPaymentSummary.paidAmount,
            finalTotal: cartTotals.total,
            refundOrCreditDue: editRefundOrCreditDue,
          },
        });
        setLastShareContext({
          ...editingOrder,
          ...updatedOrder,
          invoiceNumber: updatedOrder.invoice_number || editingOrder.invoice_number,
          customerName: payload.customer_name,
          total: cartTotals.total,
          totals: cartTotals,
          payment: {
            method: paymentMode,
            paymentStatus: checkoutPaymentSummary.paymentStatus,
            paidAmount: checkoutPaymentSummary.paidAmount,
            dueAmount: checkoutPaymentSummary.dueAmount,
            changeAmount: checkoutPaymentSummary.changeAmount,
            exchangeMode: Boolean(exchangeState?.active),
            exchangeInvoiceNumber: exchangeState?.invoiceNumber || "",
            exchangeCreditAmount,
            newOrderTotal: cartTotals.total,
            amountDueNow,
            exchangeDifference,
            remainingExchangeCustomerCredit,
            editMode: Boolean(editingOrder?.id),
            originalPaidAmount: originalEditPaidAmount,
            additionalPaidAmount: checkoutPaymentSummary.paidAmount,
            finalTotal: cartTotals.total,
            refundOrCreditDue: editRefundOrCreditDue,
          },
          cart: [...cart],
          items: response.items || payload.items,
        });
        setCheckoutSuccessOpen(true);
        toast.success(t("pos.toasts.invoiceEditSaved"));
        setProducts((current) => applySoldItemsToCatalog(current, []));
        setCart([]);
        clearPosPersistedState();
        setCashAmount(0);
        setCardAmount(0);
        setWalletAmount(0);
        setVodafoneCashAmount(0);
        setCustomerWalletAmount(0);
        setEditRefundMethod("cash");
        setExchangeState(null);
        setInvoiceDiscountType(defaultState.invoiceDiscountType);
        setInvoiceDiscountValue(defaultState.invoiceDiscountValue);
        setInvoiceDiscountReason(defaultState.invoiceDiscountReason);
        setInvoiceDiscount(0);
        setServiceFee(0);
        handleRemoveCoupon();
        handleClearSelectedCustomer();
        clearEditMode();
        await refreshCatalogProducts({ setProducts, setLoading, manageLoading: false, saleModeSettings });
        emitFeedback("payment_success", {
          title: t("pos.toasts.invoiceUpdated"),
          message: updatedOrder.invoice_number || editingOrder.invoice_number || "",
        });
        return null;
      }

      apiStartedAt = performance.now();
      const response = await api.post("/orders", payload, { timeoutMs: 30000 });
      const apiResponseAt = performance.now();
      const normalizedResponse = normalizeCheckoutOrderResponse(response);
      const loyaltyResult = normalizedResponse.loyalty || {};
      const walletResult = normalizedResponse.wallet || {};
      const soldItems = [...cart];
      const nextInvoice =
        normalizedResponse.invoiceNumber ||
        (normalizedResponse.orderId ? `INV-${normalizedResponse.orderId}` : generateInvoiceNumber());
      const normalizedOrder = {
        ...normalizedResponse.data,
        ...normalizedResponse.order,
        rawResponse: normalizedResponse.raw,
        id: normalizedResponse.orderId,
        order_id: normalizedResponse.orderId,
        orderId: normalizedResponse.orderId,
        public_token: normalizedResponse.publicToken || "",
        publicToken: normalizedResponse.publicToken || "",
        invoice_number: nextInvoice || "",
        invoiceNumber: nextInvoice || "",
        public_order_number: normalizedResponse.publicOrderNumber || "",
        display_order_number: normalizedResponse.publicOrderNumber || "",
        public_invoice_url: normalizedResponse.publicInvoiceUrl || "",
        public_invoice_short_url: normalizedResponse.publicInvoiceShortUrl || "",
        customerName: invoiceCustomer.name,
        customerPhone: normalizeReceiptPhone(customer?.phone || "") || customer?.phone || "",
        total: cartTotals.total,
        totals: cartTotals,
        coupon: normalizedResponse.raw?.coupon || normalizedResponse.data?.coupon || null,
        paymentStatus: checkoutPaymentSummary.paymentStatus,
        exchange_mode: Boolean(exchangeState?.active),
        exchange_invoice_number: exchangeState?.invoiceNumber || "",
        exchange_credit_amount: exchangeCreditAmount,
        new_order_total: cartTotals.total,
        amount_due_now: amountDueNow,
        exchange_difference: exchangeDifference,
        payment: {
          method: paymentMode,
          paymentStatus: checkoutPaymentSummary.paymentStatus,
          paidAmount: checkoutPaymentSummary.paidAmount,
          dueAmount: checkoutPaymentSummary.dueAmount,
          changeAmount: checkoutPaymentSummary.changeAmount,
          walletAmount: Number(walletResult?.redeemedAmount || payloadCustomerWalletAmount || 0),
          remainingCashOrCard: Math.max(0, Number(cartTotals.total || 0) - Number(walletResult?.redeemedAmount || payloadCustomerWalletAmount || 0)),
          companyWalletAmount: payloadWalletAmount,
          customerWalletAmount: payloadCustomerWalletAmount,
          walletBalanceAfter: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? 0),
          cashAmount: payloadCashAmount,
          cardAmount: payloadCardAmount,
          paymobTerminalAmount: paymobTerminalCheckout || paymobTerminalConfirmed
            ? (paymobTerminalConfirmed ? terminalConfirmedAmount : paymobTerminalAmount)
            : 0,
          exchangeMode: Boolean(exchangeState?.active),
          exchangeInvoiceNumber: exchangeState?.invoiceNumber || "",
          exchangeCreditAmount,
          newOrderTotal: cartTotals.total,
          amountDueNow,
          exchangeDifference,
          remainingExchangeCustomerCredit,
        },
        cart: [...cart],
        items: [...cart],
        loyalty: {
          pointsRedeemed: Number(loyaltyResult?.pointsRedeemed || loyaltyValidation?.applied_points || loyaltyRedeemPoints || 0),
          pointsEarned: Number(loyaltyResult?.pointsEarned || 0),
          remainingPoints: Number(loyaltyResult?.availablePoints ?? loyaltyProfile?.available_points ?? 0),
          tier: loyaltyResult?.tier || loyaltyProfile?.tier || "Bronze",
          cashbackAmount: Number(loyaltyResult?.cashbackAmount || walletResult?.cashbackAmount || 0),
          walletBalance: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? 0),
        },
      };
      const invoiceShareCode = normalizedOrder.invoice_number || normalizedOrder.invoiceNumber || normalizedOrder.public_token;
      if (!normalizedOrder.public_invoice_url && invoiceShareCode && typeof window !== "undefined" && window.location?.origin) {
        normalizedOrder.public_invoice_url = `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(invoiceShareCode)}`;
      }
      if (!normalizedOrder.public_invoice_short_url) {
        normalizedOrder.public_invoice_short_url = normalizedOrder.public_invoice_url;
      }
      normalizedOrder.invoiceUrl = normalizedOrder.public_invoice_url;
      normalizedOrder.invoice_url = normalizedOrder.public_invoice_url;
      normalizedOrder.publicInvoiceUrl = normalizedOrder.public_invoice_url;
      normalizedOrder.shortInvoiceUrl = normalizedOrder.public_invoice_short_url;
      normalizedOrder.short_invoice_url = normalizedOrder.public_invoice_short_url;
      normalizedOrder.publicToken = normalizedOrder.public_token;
      setLastOrder(normalizedOrder);
      setLastShareContext(normalizedOrder);
      const modalRenderStartedAt = performance.now();
      if (!paymobTerminalCheckout || paymobTerminalConfirmed) setCheckoutSuccessOpen(true);
      requestAnimationFrame(() => {
        if (POS_CHECKOUT_DEBUG) {
          console.log("[pos-checkout-ui-timing]", {
            items_count: cart.length,
            click_to_api_response_ms: Math.round(apiResponseAt - checkoutStartedAt),
            api_request_ms: Math.round(apiResponseAt - apiStartedAt),
            modal_render_ms: Math.round(performance.now() - modalRenderStartedAt),
            backend_timings: normalizedResponse.raw?.timings || null,
          });
        }
      });
      if (POS_CHECKOUT_DEBUG) console.log("[saved normalized order]", normalizedOrder);
      setInvoiceNumber(nextInvoice);
      handleRemoveCoupon();
      if (!paymobTerminalCheckout || paymobTerminalConfirmed) {
        emitFeedback("payment_success", {
          title: t("pos.toasts.paymentSuccess"),
          message: nextInvoice || "",
        });
      }

      if (!paymobTerminalCheckout || paymobTerminalConfirmed) toast.success(t("pos.toasts.invoiceCreated"));
      if (Number(loyaltyResult?.pointsEarned || 0) > 0) {
        toast.success(t("pos.toasts.loyaltyPointsEarned", { points: Number(loyaltyResult.pointsEarned).toLocaleString() }));
      }
      if (loyaltyResult?.tierUpgraded) {
        toast.success(t("pos.toasts.tierUnlocked", { tier: loyaltyResult.tier }));
      }
      if (Number(loyaltyResult?.cashbackAmount || walletResult?.cashbackAmount || 0) > 0) {
        toast.success(t("pos.toasts.cashbackAdded", { amount: formatCurrency(Number(loyaltyResult?.cashbackAmount || walletResult?.cashbackAmount || 0)) }));
      }
      if (customerId) {
        const updatedCustomer = {
          ...customer,
          loyalty_points: Number(loyaltyResult?.availablePoints ?? customer.loyalty_points ?? 0),
          wallet_balance: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? customer.wallet_balance ?? customer.balance ?? 0),
          credit_balance: Number(loyaltyResult?.creditBalance ?? loyaltyResult?.walletBalance ?? walletResult?.balance ?? customer.credit_balance ?? customer.wallet_balance ?? customer.balance ?? 0),
          tier: loyaltyResult?.tier || customer.tier || "Bronze",
        };
        setCustomers((current) =>
          (Array.isArray(current) ? current : []).map((item) =>
            String(item?.id || item?.customer_id) === String(customerId) ? { ...item, ...updatedCustomer } : item
          )
        );
        setLoyaltyProfile((current) => ({
          ...(current || {}),
          tier: loyaltyResult?.tier || current?.tier || "Bronze",
          available_points: Number(loyaltyResult?.availablePoints ?? current?.available_points ?? 0),
          total_points_earned: Number(current?.total_points_earned || 0) + Number(loyaltyResult?.pointsEarned || 0),
          total_points_redeemed: Number(current?.total_points_redeemed || 0) + Number(loyaltyResult?.pointsRedeemed || 0),
          wallet_balance: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? current?.wallet_balance ?? 0),
          credit_balance: Number(loyaltyResult?.creditBalance ?? loyaltyResult?.walletBalance ?? walletResult?.balance ?? current?.credit_balance ?? current?.wallet_balance ?? 0),
        }));
        setLoyaltyValidation((current) => ({
          ...(current || {}),
          available_points: Number(loyaltyResult?.availablePoints ?? current?.available_points ?? 0),
        }));
      }
      setProducts((current) => applySoldItemsToCatalog(current, soldItems));
      writePosSaleStats(cart);
      setCart([]);
      clearPosPersistedState();
      setCashAmount(0);
      setCardAmount(0);
      setWalletAmount(0);
      setVodafoneCashAmount(0);
      setCustomerWalletAmount(0);
      setExchangeState(null);
      setInvoiceDiscountType(defaultState.invoiceDiscountType);
      setInvoiceDiscountValue(defaultState.invoiceDiscountValue);
      setInvoiceDiscountReason(defaultState.invoiceDiscountReason);
      setInvoiceDiscount(0);
      setServiceFee(0);
      setLoyaltyRedeemPoints(0);
      handleClearSelectedCustomer();
      refreshCatalogProducts({ setProducts, setLoading, manageLoading: false, saleModeSettings }).catch((refreshError) => {
        if (POS_CHECKOUT_DEBUG) console.warn("[pos] background catalog refresh failed", refreshError?.message || refreshError);
      });
      return normalizedOrder;
    } catch (err) {
      console.error("[pos-checkout:frontend-error]", {
        message: err?.message || String(err),
        status: err?.status || err?.response?.status || null,
        response: err?.response?.data || err?.responseBody || null,
      });
      console.error("[pos] checkout failed:", {
        message: err?.message,
        status: err?.status || err?.response?.status,
        response: err?.response?.data || err?.responseBody,
        error: err,
      });
      const message = safeArabicText(getErrorMessage(err, t("pos.toasts.checkoutFailed")), t("pos.toasts.checkoutFailed"));
      if (String(message).toLowerCase().includes("not enough stock")) {
        toast.error(message);
        try {
          const refreshedCatalog = await refreshCatalogProducts({ setProducts, setLoading, manageLoading: false, saleModeSettings });
          const reconciliation = reconcileCartWithCatalog(cart, refreshedCatalog);
          if (reconciliation.changed) {
            setCart(reconciliation.nextCart);
            if (reconciliation.removedItems.length > 0) {
              toast.error(t("pos.toasts.removedUnavailableItems"));
            }
          }
        } catch (refreshError) {
          console.error("[pos] failed to refresh catalog after stock error:", refreshError);
        }
      } else if (err?.response?.data?.code === "INSUFFICIENT_CUSTOMER_WALLET_BALANCE" || err?.responseBody?.code === "INSUFFICIENT_CUSTOMER_WALLET_BALANCE") {
        const payload = err?.response?.data || err?.responseBody || {};
        toast.error(
          `${POS_ARABIC_TEXT.notEnoughCredit}.\nالرصيد الحالي: ${formatCurrency(payload.available_balance || 0)}\n${POS_ARABIC_TEXT.required}: ${formatCurrency(payload.attempted_amount || 0)}\n${POS_ARABIC_TEXT.shortage}: ${formatCurrency(payload.shortage_amount || 0)}`
        );
      } else {
        toast.error(t("pos.toasts.checkoutFailedWithMessage", { message }));
      }
    } finally {
      setCheckoutLoading(false);
    }
    return null;
  };

  const getReceiptRenderContext = (source = lastOrder || lastShareContext || {}) => {
    const order = source || {};
    const orderPayment = order.payment || {};
    const orderTotals = order.totals || {};
    const renderedCart = Array.isArray(order.cart) && order.cart.length
      ? order.cart
      : Array.isArray(order.items)
        ? order.items
        : cart;
    const renderedTotals = {
      ...cartTotals,
      ...orderTotals,
      total: Number(order.total ?? orderTotals.total ?? cartTotals.total ?? 0),
    };
    const renderedPaymentSummary = {
      ...paymentSummary,
      paymentStatus: order.paymentStatus || orderPayment.paymentStatus || paymentSummary.paymentStatus,
      paidAmount: Number(orderPayment.paidAmount ?? paymentSummary.paidAmount ?? renderedTotals.total ?? 0),
      dueAmount: Number(orderPayment.dueAmount ?? paymentSummary.dueAmount ?? 0),
      changeAmount: Number(orderPayment.changeAmount ?? paymentSummary.changeAmount ?? 0),
      exchangeMode: Boolean(order.exchange_mode || order.exchangeMode || orderPayment.exchangeMode),
      exchangeInvoiceNumber: order.exchange_invoice_number || order.exchangeInvoiceNumber || orderPayment.exchangeInvoiceNumber || "",
      exchangeCreditAmount: Number(order.exchange_credit_amount ?? order.exchangeCreditAmount ?? orderPayment.exchangeCreditAmount ?? 0),
      newOrderTotal: Number(order.new_order_total ?? order.newOrderTotal ?? orderPayment.newOrderTotal ?? renderedTotals.total ?? 0),
      amountDueNow: Number(order.amount_due_now ?? order.amountDueNow ?? orderPayment.amountDueNow ?? orderPayment.paidAmount ?? paymentSummary.paidAmount ?? 0),
      exchangeDifference: Number(order.exchange_difference ?? order.exchangeDifference ?? orderPayment.exchangeDifference ?? 0),
      remainingExchangeCustomerCredit: Number(orderPayment.remainingExchangeCustomerCredit ?? Math.max(0, Number(order.exchange_credit_amount ?? 0) - Number(renderedTotals.total || 0))),
    };
    return {
      invoiceNumber: order.invoice_number || order.invoiceNumber || displayPublicOrderNumber(order) || invoiceNumber,
      customer: {
        ...(customer || {}),
        name: order.customerName || order.customer_name || customer?.name || WALK_IN_CUSTOMER.name,
      },
      cart: renderedCart,
      totals: renderedTotals,
      paymentSummary: renderedPaymentSummary,
      paymentMode: orderPayment.method || order.payment_method || paymentMode,
      loyaltyProfile: order.loyalty || loyaltyProfile,
      loyaltyValidation,
      walletCashbackToEarn: Number(order.loyalty?.cashbackAmount ?? walletCashbackToEarn ?? 0),
    };
  };

  const handlePrint = async () => {
    const receiptContext = getReceiptRenderContext();
    if (!receiptContext.invoiceNumber) return;
    const startedAt = performance.now();
    const { renderToStaticMarkup } = await import("react-dom/server");
    logPagePerf("pos.receipt-print-renderer", startedAt, { heavy_component_load_ms: Math.round(performance.now() - startedAt) });
    const receiptHtml = renderToStaticMarkup(<ReceiptPreview {...receiptContext} compact />);

    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) {
      toast.error(t("pos.toasts.popupBlocked"));
      return;
    }

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((element) => element.outerHTML)
      .join("\n");

    const printLang = document.documentElement.lang || "en";
    const printDir = document.documentElement.dir || "ltr";

    printWindow.document.write(`
      <html lang="${printLang}" dir="${printDir}">
        <head>
          <title>Sales Receipt</title>
          ${styles}
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 14px; background: #fff; color: #111827; direction: inherit; font-family: var(--app-font), "Cairo", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif; }
            .pos-receipt { width: 100%; margin: 0 auto; direction: inherit; text-align: start; background: #fff !important; color: #111827 !important; border: 1px solid #bbf7d0 !important; box-shadow: none !important; page-break-inside: avoid; break-inside: avoid; }
            [dir="rtl"] .pos-receipt { text-align: right; }
            [dir="ltr"] .pos-receipt { text-align: left; }
            .pos-receipt-thermal { width: 80mm !important; max-width: 80mm !important; border-radius: 0 !important; padding: 10px !important; }
            .pos-receipt-a4 { max-width: 720px !important; border-radius: 0 !important; padding: 24px !important; }
            .pos-receipt-barcode svg { display: block; width: 100%; max-width: 100%; height: auto; }
            .pos-receipt-barcode svg text { display: none; }
            .amount, .number, .tabular-nums, [dir="ltr"] { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
            [dir="rtl"] .text-left { text-align: right !important; }
            [dir="rtl"] .text-right { text-align: left !important; }
            .text-emerald-600, .text-emerald-700 { color: #059669 !important; }
            .bg-emerald-500, .bg-emerald-50, .bg-emerald-50\\/60 { background-color: #ecfdf5 !important; }
            .border-emerald-100, .border-emerald-200, .border-emerald-300 { border-color: #bbf7d0 !important; }
            .shadow-2xl, .shadow-black\\/20 { box-shadow: none !important; }
            svg { display: inline-block; vertical-align: middle; }
            @page { size: 80mm auto; margin: 4mm; }
            @media print {
              body { padding: 0; }
              .pos-receipt { border-color: #bbf7d0 !important; }
            }
          </style>
        </head>
        <body>${receiptHtml}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const handleDownloadInvoicePdf = async () => {
    const source = lastOrder || lastShareContext || {};
    if (!source?.order_id && !source?.id && !source?.invoiceNumber && !source?.invoice_number) {
      toast.error("Create the invoice first");
      return;
    }
    const receiptContext = getReceiptRenderContext(source);
    try {
      const importStartedAt = performance.now();
      const { downloadInvoicePdf } = await import("../../../shared/utils/invoicePdf");
      logPagePerf("pos.invoice-pdf", importStartedAt, { heavy_component_load_ms: Math.round(performance.now() - importStartedAt) });
      await downloadInvoicePdf({
        format: "a4",
        invoice: {
          ...source,
          invoiceNumber: receiptContext.invoiceNumber,
          customerName: receiptContext.customer?.name,
          items: receiptContext.cart,
          totals: receiptContext.totals,
          payment: {
            ...(source.payment || {}),
            method: receiptContext.paymentMode,
            paymentStatus: receiptContext.paymentSummary.paymentStatus,
          },
          publicInvoiceUrl: resolveReceiptInvoiceUrl(source),
        },
        filename: `${receiptContext.invoiceNumber || "invoice"}.pdf`,
      });
    } catch (error) {
      console.error("[pos] invoice pdf download failed:", error);
      toast.error("Unable to download invoice PDF");
    }
  };

  const handleShareWhatsApp = () => {
    console.log("[share whatsapp clicked]");
    console.log("[share whatsapp lastOrder]", lastOrder);
    console.log("[lastOrder state]", lastOrder);
    console.log("[checkout state]", {
      invoiceNumber,
      selectedCustomerId,
      paymentMode,
      cartCount: cart.length,
      total: cartTotals.total,
      paymentStatus: paymentSummary.paymentStatus,
    });
    console.log("public_invoice_url", lastOrder?.public_invoice_url);
    console.log("public_invoice_short_url", lastOrder?.public_invoice_short_url);
    console.log("invoice_public_url", lastOrder?.invoice_public_url);
    console.log("public_token", lastOrder?.public_token);

    const currentTenant = getCurrentTenant() || {};
    const storeName = currentTenant.companyName || currentTenant.company_name || currentTenant.name || "YOUR STORE";
    const context = lastOrder || lastShareContext;
    const normalizedPhone = normalizeReceiptPhone(context?.customerPhone);
    let invoiceUrl = resolveReceiptInvoiceUrl(context || {});

    if (!invoiceUrl) {
      const fallbackToken = String(context?.publicToken || context?.public_token || "").trim();
      if (fallbackToken && typeof window !== "undefined" && window.location?.origin) {
        invoiceUrl = `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(fallbackToken)}`;
      } else if (fallbackToken) {
        invoiceUrl = `/invoice/${encodeURIComponent(fallbackToken)}`;
      }
    }

    if (!invoiceUrl) {
      toast.error("تعذر إنشاء رابط الفاتورة");
      return;
    }

    const message = buildLoyaltyReceiptMessage({ invoiceUrl });

      const url = buildLoyaltyReceiptWhatsappUrl({
      phone: normalizedPhone || "",
      customerName: context?.customerName,
      invoiceNumber: displayPublicOrderNumber(context) || context?.invoice_number || context?.invoiceNumber || invoiceNumber,
      totalPaid: paymentSummary.paidAmount || context?.total || cartTotals.total,
      invoiceUrl,
      paymentMethod: paymentMode,
      paymentStatus: paymentSummary.paymentStatus,
      pointsEarned: Number(context?.loyalty?.pointsEarned || 0),
      pointsRedeemed: Number(context?.loyalty?.pointsRedeemed || 0),
      remainingPoints: Number(context?.loyalty?.remainingPoints || 0),
      customerTier: context?.loyalty?.tier || "",
      companyName: storeName,
    });

    console.log("[final whatsapp message]", message);
    console.log("[final whatsapp url]", url);

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const currentPublicInvoiceUrl = resolveReceiptInvoiceUrl(lastOrder || lastShareContext || {});

  const handleCopyInvoiceLink = async () => {
    if (!currentPublicInvoiceUrl) {
      toast.error("No invoice link available");
      return;
    }

    try {
      await navigator.clipboard.writeText(currentPublicInvoiceUrl);
      toast.success("Invoice link copied");
    } catch {
      toast.error("Unable to copy invoice link");
    }
  };

  const handleOpenInvoice = () => {
    if (!currentPublicInvoiceUrl) {
      toast.error("No invoice link available");
      return;
    }

    window.open(currentPublicInvoiceUrl, "_blank", "noopener,noreferrer");
  };

  useEffect(() => () => {
    paymobPollingRef.current.cancelled = true;
    if (paymobPollingRef.current.timer) {
      window.clearTimeout(paymobPollingRef.current.timer);
    }
  }, []);

  const applyPaymobConfirmedOrder = (sourceOrder, confirmedOrder, transaction) => {
    if (!confirmedOrder) return;
    const orderTotal = Number(confirmedOrder.total_amount || confirmedOrder.total || sourceOrder?.total || sourceOrder?.totals?.total || 0);
    const paidAmount = Number(confirmedOrder.paid_amount || 0);
    const dueAmount = Math.max(0, orderTotal - paidAmount);
    const paymentStatus = dueAmount <= 0 && orderTotal > 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Pending";
    const nextOrder = {
      ...(sourceOrder || {}),
      ...confirmedOrder,
      id: confirmedOrder.id || sourceOrder?.id,
      order_id: confirmedOrder.id || confirmedOrder.order_id || sourceOrder?.order_id,
      orderId: confirmedOrder.id || confirmedOrder.orderId || sourceOrder?.orderId,
      invoice_number: confirmedOrder.invoice_number || sourceOrder?.invoice_number,
      invoiceNumber: confirmedOrder.invoice_number || sourceOrder?.invoiceNumber,
      total: orderTotal,
      totals: {
        ...(sourceOrder?.totals || {}),
        total: orderTotal,
      },
      paymentStatus,
      payment: {
        ...(sourceOrder?.payment || {}),
        method: sourceOrder?.payment?.method || "split",
        paymentStatus,
        paidAmount,
        dueAmount,
        changeAmount: Math.max(0, paidAmount - orderTotal),
        cashAmount: Number(confirmedOrder.cash_amount || sourceOrder?.payment?.cashAmount || 0),
        cardAmount: Number(confirmedOrder.card_amount || sourceOrder?.payment?.cardAmount || 0),
        walletAmount: Number(confirmedOrder.wallet_payment_amount || sourceOrder?.payment?.walletAmount || 0),
        paymobTerminalAmount: Number(transaction?.confirmed_amount_cents || transaction?.amount_cents || 0) / 100,
        transactionReference: transaction?.transaction_reference || "",
      },
    };
    setLastOrder(nextOrder);
    setLastShareContext(nextOrder);
  };

  const stopPaymobPolling = () => {
    paymobPollingRef.current.cancelled = true;
    if (paymobPollingRef.current.timer) {
      window.clearTimeout(paymobPollingRef.current.timer);
      paymobPollingRef.current.timer = null;
    }
  };

  const startPaymobTerminalPolling = ({ transactionId, sourceOrder, amount, currency = "EGP", terminalId = "" }) => {
    if (!transactionId) {
      if (import.meta.env.DEV) {
        console.warn("[paymob-pos-poll-start]", { started: false, reason: "missing_transaction_id" });
      }
      setPaymobTerminalState((current) => ({
        ...(current || {}),
        open: true,
        status: "timeout",
        message: "Payment was sent to the terminal, but ERP did not receive confirmation. If the terminal shows Approved, click Confirm terminal payment.",
      }));
      return;
    }
    stopPaymobPolling();
    paymobPollingRef.current.cancelled = false;
    const startedAt = Date.now();
    const timeoutMs = 90000;
    const intervalMs = 3000;
    if (import.meta.env.DEV) {
      console.info("[paymob-pos-poll-start]", { transactionId, amount, currency, terminalId });
    }

    const poll = async () => {
      if (paymobPollingRef.current.cancelled) return;
      if (Date.now() - startedAt > timeoutMs) {
        if (import.meta.env.DEV) {
          console.warn("[paymob-pos-poll-result]", { transactionId, status: "timeout" });
        }
        console.info("PAYMOB_TERMINAL_PAYMENT_FAILED_KEEP_CART", {
          transaction_id: transactionId,
          order_id: sourceOrder?.order_id || sourceOrder?.orderId || sourceOrder?.id || null,
          status: "timeout",
        });
        setPaymobTerminalLoading(false);
        setPaymobTerminalState((current) => ({
          ...(current || {}),
          open: true,
          status: "timeout",
          message: "Payment was sent to the terminal, but ERP did not receive confirmation. If the terminal shows Approved, click Confirm terminal payment.",
        }));
        return;
      }

      try {
        const response = await api.get(`/pos/payments/paymob-terminal/status/${transactionId}`, {
          timeoutMs: 20000,
          suppressErrorStatuses: [501, 502, 503],
        });
        const status = String(response?.status || response?.transaction?.status || "sent").toLowerCase();
        if (import.meta.env.DEV) {
          console.info("[paymob-pos-poll-result]", {
            transactionId,
            status,
            localStatus: response?.local_status || response?.transaction?.status || "",
            message: response?.message || "",
          });
        }
        if (status === "success" || status === "success_manual_confirmed") {
          stopPaymobPolling();
          setPaymobTerminalLoading(false);
          let confirmedOrder = response.order || sourceOrder || null;
          if (response?.transaction?.order_id) {
            applyPaymobConfirmedOrder(sourceOrder, response.order, response.transaction);
          } else {
            console.info("PAYMOB_TERMINAL_PAYMENT_SUCCESS_CREATE_ORDER", {
              transaction_id: response?.transaction?.id || transactionId,
              amount,
              currency,
              terminal_id: response?.transaction?.terminal_id || terminalId,
            });
            setPaymobTerminalLoading(false);
            confirmedOrder = await handleCheckout({
              paymobTerminalConfirmed: true,
              terminalAmount: amount,
              paymobTerminalTransactionId: response?.transaction?.id || transactionId,
            });
            if (!confirmedOrder) {
              setPaymobTerminalState((current) => ({
                ...(current || {}),
                open: true,
                status: "failed",
                message: "Failed to create order after terminal payment success.",
                transaction: response?.transaction || null,
                order: null,
              }));
              toast.error("Failed to create order after terminal payment success.");
              return;
            }
          }
          setPaymobTerminalState({
            open: true,
            status: "success",
            amount,
            currency,
            terminalId: response?.transaction?.terminal_id || terminalId,
            message: "Payment completed successfully.",
            transaction: response?.transaction || null,
            order: confirmedOrder || response?.order || sourceOrder,
          });
          toast.success("Payment completed successfully.");
          emitFeedback("payment_success", {
            title: "Payment completed successfully.",
            message: confirmedOrder?.invoice_number || response?.order?.invoice_number || sourceOrder?.invoice_number || "",
          });
          window.setTimeout(() => {
            setPaymobTerminalState((current) => (String(current?.status || "").toLowerCase() === "success" ? null : current));
          }, 1200);
          return;
        }
        if (status === "failed" || status === "cancelled") {
          stopPaymobPolling();
          console.info("PAYMOB_TERMINAL_PAYMENT_FAILED_KEEP_CART", {
            transaction_id: response?.transaction?.id || transactionId,
            order_id: response?.transaction?.order_id || sourceOrder?.order_id || sourceOrder?.orderId || sourceOrder?.id || null,
            status,
          });
          setPaymobTerminalLoading(false);
          setPaymobTerminalState((current) => ({
            ...(current || {}),
            open: true,
            status,
            transaction: response?.transaction || current?.transaction || null,
            order: response?.order || sourceOrder,
            message: response?.message || (status === "cancelled" ? "Paymob terminal payment was cancelled." : "Paymob terminal payment failed."),
          }));
          toast.error(status === "cancelled" ? "Paymob terminal payment was cancelled." : "Paymob terminal payment failed.");
          return;
        }
        setPaymobTerminalState((current) => ({
          ...(current || {}),
          open: true,
          status: "waiting",
          message: "Waiting for terminal payment confirmation...",
          transaction: response?.transaction || current?.transaction || null,
          order: response?.order || current?.order || sourceOrder,
        }));
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("[paymob-pos-poll-result]", { transactionId, status: "error", message: error?.message || String(error) });
        }
      }

      if (!paymobPollingRef.current.cancelled) {
        paymobPollingRef.current.timer = window.setTimeout(poll, intervalMs);
      }
    };

    poll();
  };

  const handlePaymobRetryStatusCheck = () => {
    const transactionId = paymobTerminalState?.transaction?.id;
    const sourceOrder = paymobTerminalState?.order || lastOrder || lastShareContext || null;
    startPaymobTerminalPolling({
      transactionId,
      sourceOrder,
      amount: Number(paymobTerminalState?.amount || sourceOrder?.payment?.paymobTerminalAmount || 0),
      currency: paymobTerminalState?.currency || "EGP",
      terminalId: paymobTerminalState?.terminalId || paymobTerminalState?.transaction?.terminal_id || "",
    });
  };

  const handlePaymobManualConfirm = async () => {
    const transactionId = paymobTerminalState?.transaction?.id;
    if (!transactionId) {
      toast.error("No Paymob transaction is available to confirm.");
      return;
    }
    stopPaymobPolling();
    setPaymobTerminalLoading(true);
    try {
      const response = await api.post(`/pos/payments/paymob-terminal/${transactionId}/manual-confirm`, {
        note: "Terminal showed Approved; cashier manually confirmed in POS.",
      }, { timeoutMs: 20000 });
      const transaction = response?.transaction || paymobTerminalState?.transaction || null;
      const confirmedAmount = Number(paymobTerminalState?.amount || 0) || (Number(response?.transaction?.confirmed_amount_cents || response?.transaction?.amount_cents || 0) / 100);
      let confirmedOrder = response?.order || paymobTerminalState?.order || null;
      if (transaction?.order_id) {
        applyPaymobConfirmedOrder(paymobTerminalState?.order || lastOrder || lastShareContext, confirmedOrder, transaction);
      } else {
        confirmedOrder = await handleCheckout({
          paymobTerminalConfirmed: true,
          terminalAmount: confirmedAmount,
          paymobTerminalTransactionId: transaction?.id || transactionId,
        });
        if (!confirmedOrder) {
          throw new Error("Failed to create order after terminal payment success.");
        }
      }
      setPaymobTerminalState({
        ...(paymobTerminalState || {}),
        open: true,
        status: response?.status || "success_manual_confirmed",
        message: "Payment completed successfully.",
        transaction,
        order: confirmedOrder || response?.order || paymobTerminalState?.order || null,
        audit: response?.audit || null,
      });
      toast.success("Payment completed successfully.");
      window.setTimeout(() => {
        setPaymobTerminalState((current) => {
          const currentStatus = String(current?.status || "").toLowerCase();
          return currentStatus === "success" || currentStatus === "success_manual_confirmed" ? null : current;
        });
      }, 1200);
    } catch (error) {
      const message = getErrorMessage(error, "Failed to confirm terminal payment");
      setPaymobTerminalState((current) => ({
        ...(current || {}),
        open: true,
        status: "timeout",
        message,
      }));
      toast.error(message);
    } finally {
      setPaymobTerminalLoading(false);
    }
  };

  const handlePaymobTerminalPayment = async () => {
    if (paymobTerminalLoading || checkoutLoading) return;
    stopPaymobPolling();
    const existingOrder = cart.length === 0 ? lastOrder || lastShareContext || null : null;
    const existingOrderId = existingOrder?.order_id || existingOrder?.orderId || existingOrder?.id || null;
    const initialAmount = existingOrderId
      ? Number(existingOrder?.payment?.paymobTerminalAmount || paymobTerminalState?.amount || 0)
      : Number(paymobTerminalAmount || 0);

    if (!existingOrderId && !canUsePaymobTerminal) {
      toast.error(cart.length === 0 ? t("pos.toasts.cartEmpty") : "Checkout is not ready");
      return;
    }
    if (!initialAmount || initialAmount <= 0) {
      toast.error("Invoice amount is required");
      return;
    }

    const terminalItems = cart.map((item) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = resolveCheckoutItemUnitPrice(item);
      const lineTotal = Math.max(0, unitPrice * quantity - Number(item.discount_amount ?? Number(item.lineDiscount || 0) * quantity));
      return {
        product_name: item.product_name || item.name || "",
        variant_name: [item.color || item.variant_color || item.selected_color, item.size || item.variant_size || item.selected_size].filter(Boolean).join(" / "),
        sku: item.sku || "",
        barcode: item.barcode || "",
        quantity,
        price: unitPrice,
        total_amount: lineTotal,
      };
    });
    const checkoutBranchId = activePosShift?.branch_id || posShiftBranch?.id || currentUser?.branch_id || null;
    const invoiceCustomer = customer || WALK_IN_CUSTOMER;
    const customerId = customer ? customer.id || customer.customer_id : null;
    const selectedSeller = salesEmployees.find((employee) => String(employee.id) === String(selectedSalespersonId));
    const resolvedSellerUserId = selectedSeller?.user_id || null;
    const resolvedSalesEmployeeId = selectedSeller?.employee_id || selectedSeller?.id || null;
    const resolvedSellerName = selectedSeller?.name || selectedSeller?.full_name || selectedSeller?.pos_alias || "";
    const terminalPayload = {
      amount: initialAmount,
      currency: "EGP",
      branch_id: checkoutBranchId,
      shift_id: activePosShift?.id || null,
      customer_id: customerId || null,
      customer_name: invoiceCustomer?.name || "",
      customer_phone: customer?.phone || "",
      payment_method: paymentMode,
      subtotal: cartTotals.subtotal,
      total: cartTotals.total,
      payment_breakdown: paymentSummary?.paidAmount > 0 ? [{ method: paymentMode, amount: paymentSummary.paidAmount }] : [],
      seller_user_id: resolvedSellerUserId,
      seller_id: resolvedSalesEmployeeId,
      seller_name: resolvedSellerName,
      items: terminalItems,
    };

    setPaymobTerminalLoading(true);
    setPaymobTerminalState({
      open: true,
      status: "processing",
      amount: initialAmount,
      currency: "EGP",
      terminalId: "",
      message: "Sending payment to Paymob terminal...",
      transaction: null,
      order: existingOrder || null,
    });
    try {
      if (String(paymobTerminalState?.status || "").toLowerCase() === "failed" || String(paymobTerminalState?.status || "").toLowerCase() === "cancelled" || String(paymobTerminalState?.status || "").toLowerCase() === "timeout") {
        console.info("PAYMOB_TERMINAL_PAYMENT_RETRY", {
          transaction_id: paymobTerminalState?.transaction?.id || null,
          order_id: paymobTerminalState?.transaction?.order_id || null,
          amount: initialAmount,
        });
      }
      console.info("PAYMOB_TERMINAL_PAYMENT_STARTED", {
        order_id: existingOrderId || null,
        branch_id: checkoutBranchId,
        amount: initialAmount,
        cart_count: cart.length,
      });
      const response = await api.post("/pos/payments/paymob-terminal", terminalPayload, { timeoutMs: 30000 });
      const terminalId = response?.terminal_id || response?.transaction?.terminal_id || "";
      const transactionId = response?.transaction?.id || response?.transaction_id || response?.id || null;
      setPaymobTerminalState({
        open: true,
        status: "waiting",
        amount: initialAmount,
        currency: response?.currency || "EGP",
        terminalId,
        message: "Waiting for terminal payment confirmation...",
        transaction: response?.transaction || null,
        order: response?.order || null,
      });
      toast.success("Payment request sent to terminal. Complete payment on the machine.");
      startPaymobTerminalPolling({
        transactionId,
        sourceOrder: response?.order || null,
        amount: initialAmount,
        currency: response?.currency || "EGP",
        terminalId,
      });
    } catch (err) {
      const message = getErrorMessage(err, "Failed to send Paymob terminal payment");
      console.info("PAYMOB_TERMINAL_PAYMENT_FAILED_KEEP_CART", {
        transaction_id: err?.response?.data?.transaction?.id || null,
        order_id: existingOrderId || null,
        message,
      });
      setPaymobTerminalState((current) => ({
        ...(current || {}),
        open: true,
        status: "failed",
        message,
        transaction: err?.response?.data?.transaction || null,
        order: err?.response?.data?.order || current?.order || null,
      }));
      toast.error(message);
    } finally {
      setPaymobTerminalLoading(false);
    }
  };

  const handleClearCart = () => {
    if (editingOrder?.id) {
      toast.error(t("pos.toasts.cancelEditBeforeClearing"));
      return;
    }
    setCart([]);
    setInvoiceDiscountType(defaultState.invoiceDiscountType);
    setInvoiceDiscountValue(defaultState.invoiceDiscountValue);
    setInvoiceDiscountReason(defaultState.invoiceDiscountReason);
    setInvoiceDiscount(0);
    setServiceFee(0);
    setCashAmount(0);
    setCardAmount(0);
    setWalletAmount(0);
    setVodafoneCashAmount(0);
    setCustomerWalletAmount(0);
    setExchangeState(null);
    clearPosPersistedState();
    setSelectedCustomerId(null);
    setCustomerSearch("");
    setLoyaltyProfile(null);
    setLoyaltyValidation(null);
    setLoyaltyRedeemPoints(0);
    clearEditMode();
    toast.success("Cart cleared");
  };

  const handleClearSmartFilters = useCallback(() => {
    setSelectedMainCategoryId("all");
    setSelectedSubCategoryId("all");
    setSelectedChildCategoryId("all");
    setSelectedBrandId("all");
    setSelectedManufacturerId("all");
    setSelectedGender("all");
    setSelectedProductType("all");
    setSelectedGrade("all");
    setSearch("");
  }, []);

  const handleToggleFilters = useCallback(() => {
    setFiltersOpen((open) => !open);
  }, []);

  const handleCreateCustomerFromToolbar = useCallback(async () => {
    const created = await handleCreateCustomer();
    if (created) {
      setCustomerCreateOpen(false);
    }
  }, [handleCreateCustomer]);

  const openCustomerCreateModal = useCallback(() => {
    const searchText = String(customerSearch || "").trim();
    const normalizedPhone = normalizeReceiptPhone(searchText);
    console.log("[pos-customer-modal-open]", {
      ...getPosCustomerModalRuntime(),
      hasSearchText: Boolean(searchText),
      normalizedPhonePresent: Boolean(normalizedPhone),
      selectedCustomerId: selectedCustomerId || null,
      portalTarget: getActiveFullscreenElement() ? "fullscreenElement" : "body",
    });
    setQuickCustomer((prev) => ({
      ...prev,
      name: normalizedPhone ? prev.name : searchText || prev.name,
      phone: normalizedPhone || prev.phone,
      source_key: "",
    }));
    setCustomerCreateOpen(true);
  }, [customerSearch, selectedCustomerId]);

  const handlePrintShiftReport = useCallback((report) => {
    if (!report) return;
    const shift = report.shift || {};
    const totals = report.totals || {};
    const rows = [
      ["Cashier", shift.cashier_name || currentUser?.name || currentUser?.email || ""],
      ["Branch", shift.branch_name || posShiftBranch?.name || ""],
      ["Opened", shift.opened_at ? new Date(shift.opened_at).toLocaleString() : ""],
      ["Closed", shift.closed_at ? new Date(shift.closed_at).toLocaleString() : ""],
      ["Opening cash", formatCurrency(totals.opening_cash ?? shift.opening_cash)],
      ["Expected cash", formatCurrency(totals.expected_cash ?? shift.expected_cash)],
      ["Closing cash", totals.closing_cash === null || totals.closing_cash === undefined ? "-" : formatCurrency(totals.closing_cash)],
      ["Cash difference", formatCurrency(totals.cash_difference ?? shift.cash_difference)],
      ["Total sales", formatCurrency(totals.total_sales)],
      ["POS daily expenses", formatCurrency(totals.pos_expenses || 0)],
      ["Employee advances", formatCurrency(totals.employee_advances || 0)],
      ["Total cash out", formatCurrency(totals.total_cash_out || 0)],
      ["Returns", formatCurrency(totals.returns)],
      ["Discounts", formatCurrency(totals.discounts)],
      ["Invoice count", Number(totals.invoice_count || 0).toLocaleString()],
    ];
    const printWindow = window.open("", "_blank", "width=820,height=900");
    if (!printWindow) {
      toast.error(t("pos.toasts.popupBlocked"));
      return;
    }
    const paymentRows = (report.payment_breakdown || []).map((item) => `<tr><td>${item.payment_method}</td><td>${item.count}</td><td>${formatCurrency(item.total)}</td></tr>`).join("");
    const totalSoldItems = (report.top_products || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const productRows = (report.top_products || []).map((item) => `<tr><td>${item.product_name}</td><td>${Number(item.quantity || 0).toLocaleString()} sales</td><td>${totalSoldItems > 0 ? Math.round((Number(item.quantity || 0) / totalSoldItems) * 100) : 0}%</td><td>${formatCurrency(item.total)}</td></tr>`).join("");
    const sellerRows = getShiftSellerPerformance(report).map((item) => `<tr><td>${item.name}</td><td>${Number(item.count || 0).toLocaleString()}</td><td>${formatCurrency(item.total)}</td></tr>`).join("");
    const auditRows = (report.audit_timeline || []).map((item) => `<tr><td>${item.at ? new Date(item.at).toLocaleString() : ""}</td><td>${readableAuditAction(item)}</td><td>${auditReference(item)}</td><td>${formatCurrency(item.amount || 0)}</td></tr>`).join("");
    const netRevenue = Number(totals.total_sales || 0) - Number(totals.returns || 0) - Number(totals.discounts || 0);
    const variance = Number(totals.cash_difference ?? shift.cash_difference ?? 0);
    printWindow.document.write(`
      <html><head><title>Shift report</title>
      <style>
        body{font-family:Arial,sans-serif;margin:24px;color:#111827}
        h1{margin:0 0 4px;font-size:24px}
        h2{margin:22px 0 8px;font-size:15px;text-transform:uppercase;letter-spacing:.08em}
        table{width:100%;border-collapse:collapse;margin:14px 0}
        th,td{border:1px solid #d1d5db;padding:8px;text-align:left;font-size:12px}
        th{background:#f3f4f6}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .box{border:1px solid #d1d5db;padding:10px;border-radius:8px}
        .brand{font-weight:800;color:#047857;margin-bottom:12px}
        .variance{border:2px solid ${variance === 0 ? "#10b981" : variance > 0 ? "#f59e0b" : "#ef4444"};padding:12px;border-radius:10px;margin:14px 0;font-weight:800}
        .signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:36px}
        .sig{border-top:1px solid #111827;padding-top:8px;font-size:12px}
        @media print{button{display:none}}
      </style></head><body>
      <button onclick="window.print()">Print</button>
      <div class="brand">${getCurrentTenant()?.name || "ERP POS"} / Shift Close Report</div>
      <h1>End of Shift Report #${shift.id || ""}</h1>
      <div>Cashier: ${shift.cashier_name || currentUser?.name || currentUser?.email || ""} | Branch: ${shift.branch_name || posShiftBranch?.name || ""}</div>
      <div class="variance">Variance: ${formatCurrency(variance)} | Net revenue: ${formatCurrency(netRevenue)}</div>
      <div class="grid">${rows.map(([label, value]) => `<div class="box"><strong>${label}</strong><br>${value ?? ""}</div>`).join("")}</div>
      <h2>Payment breakdown</h2><table><thead><tr><th>Method</th><th>Count</th><th>Total</th></tr></thead><tbody>${paymentRows || "<tr><td colspan='3'>No payments</td></tr>"}</tbody></table>
      <h2>Seller performance</h2><table><thead><tr><th>Seller</th><th>Invoices</th><th>Sales</th></tr></thead><tbody>${sellerRows || "<tr><td colspan='3'>No seller data</td></tr>"}</tbody></table>
      <h2>Top products</h2><table><thead><tr><th>Product</th><th>Qty</th><th>Share</th><th>Total</th></tr></thead><tbody>${productRows || "<tr><td colspan='4'>No products</td></tr>"}</tbody></table>
      <h2>Audit timeline</h2><table><thead><tr><th>Time</th><th>Action</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${auditRows || "<tr><td colspan='4'>No events</td></tr>"}</tbody></table>
      <div class="signatures"><div class="sig">Cashier signature</div><div class="sig">Manager signature</div></div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
  }, [currentUser?.email, currentUser?.name, posShiftBranch?.name, t]);

  const topSelectionInfo = useMemo(() => {
    if (!activeProduct) return null;
    const variants = Array.isArray(activeProduct.variants) ? activeProduct.variants : [];
    const colors = [...new Set(variants.map((variant) => variant.color || ""))];
    const sizes = [
      ...new Set(
        variants
          .filter((variant) => String(variant.color || "") === String(selectedColor || ""))
          .map((variant) => variant.size || "")
      ),
    ];
    return {
      colors,
      sizes,
    };
  }, [activeProduct, selectedColor]);

  const saleMode = useMemo(() => normalizeSaleModeSettings(saleModeSettings), [saleModeSettings]);
  const salePricesEnabled = Boolean(saleMode.sale_mode_enabled);
  const handleToggleSaleMode = useCallback(async () => {
    const previousSaleMode = Boolean(saleModeSettings?.sale_mode_enabled);
    const nextSaleMode = !previousSaleMode;
    setSaleModeSettings((current) => normalizeSaleModeSettings({ ...current, sale_mode_enabled: nextSaleMode }));
    const saved = await saveSaleModeSettings(nextSaleMode, previousSaleMode);
    if (!saved) {
      setSaleModeSettings((current) => normalizeSaleModeSettings({ ...current, sale_mode_enabled: previousSaleMode }));
    }
  }, [saleModeSettings, saveSaleModeSettings]);

  const handleToggleFullscreen = useCallback(async () => {
    const getFullscreenElement = () =>
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement ||
      null;
    try {
      if (getFullscreenElement()) {
        const exitFullscreen =
          document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.msExitFullscreen;
        if (exitFullscreen) await exitFullscreen.call(document);
        return;
      }

      const target = posShellRef.current || document.documentElement;
      const requestFullscreen =
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.msRequestFullscreen;
      if (requestFullscreen) {
        await requestFullscreen.call(target);
      } else {
        toast.error(t("pos.fullscreenUnavailable", "Fullscreen is not available in this browser"));
      }
    } catch (error) {
      toast.error(error?.message || t("pos.fullscreenFailed", "Could not toggle fullscreen"));
    }
  }, [t]);
  const handleRefreshSellerUsers = useCallback(() => loadSellerUsers({ silent: false }), [loadSellerUsers]);
  const handleClearExchangeCredit = useCallback(() => setExchangeState(null), []);
  const handlePaymentAccountAdjusted = useCallback(() => setPaymentAccountRefreshKey((key) => key + 1), []);
  const handleCloseFilters = useCallback(() => setFiltersOpen(false), []);
  const handleCloseMobileCart = useCallback(() => setMobileCartOpen(false), []);
  const checkoutActionRef = useRef(handleCheckout);
  useEffect(() => {
    checkoutActionRef.current = handleCheckout;
  }, [handleCheckout]);
  const handleCheckoutAction = useCallback((options = {}) => checkoutActionRef.current(options), []);
  const handleCreditSaleCheckout = useCallback(() => handleCheckoutAction({ creditSale: true }), [handleCheckoutAction]);
  const paymentAreaRenderCountRef = useRef(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    paymentAreaRenderCountRef.current += 1;
    console.log("[pos-render] PaymentArea", {
      render: paymentAreaRenderCountRef.current,
      cart_count: cart.length,
      payment_mode: String(paymentMode || ""),
      sale_prices_enabled: salePricesEnabled,
    });
  });
  const fullscreenTooltip = isRtl ? "\u0645\u0644\u0621 \u0627\u0644\u0634\u0627\u0634\u0629" : "Fullscreen";

  if (!isShiftActive) {
    return (
      <div className="min-h-[100dvh] w-full min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),transparent_35%),linear-gradient(180deg,#09090b_0%,#111111_100%)] text-white">
        <div className="flex h-full w-full min-w-0 max-w-none flex-col gap-3 overflow-y-auto p-2 sm:p-3 lg:p-4">
          <div className="flex shrink-0 items-center justify-end">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-rose-400/30 bg-rose-500/10 px-4 text-sm font-black text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.16)] transition hover:border-rose-300/50 hover:bg-rose-500/15"
            >
              <LogOut className="h-4 w-4" />
              Exit POS
            </button>
          </div>

          <ShiftGate
            currentUser={currentUser}
            branch={posShiftBranch}
            attendanceLoading={attendanceLoading}
            posShiftLoading={posShiftLoading}
            openingCash={openingCash}
            setOpeningCash={setOpeningCash}
            onOpenShift={handleOpenShift}
          />

          {shiftReportOpen && shiftReport ? (
            <ShiftReportModal report={shiftReport} onClose={() => setShiftReportOpen(false)} onPrint={handlePrintShiftReport} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={posShellRef}
      className="h-[100dvh] w-full max-w-[100vw] min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),transparent_35%),linear-gradient(180deg,#09090b_0%,#111111_100%)] text-white"
    >
      <div className="flex h-full w-full min-w-0 max-w-none flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 pb-[calc(6.25rem+env(safe-area-inset-bottom))] sm:p-3 sm:pb-[calc(8rem+env(safe-area-inset-bottom))] lg:min-h-0 lg:overflow-hidden lg:p-3 xl:pb-3">
        {viewportIsMobile ? (
          <div className="sticky top-0 z-40 -mx-2 -mt-2 border-b border-white/10 bg-zinc-950/96 px-2 pt-[calc(env(safe-area-inset-top)+0.6rem)] pb-2 shadow-2xl shadow-black/20 backdrop-blur-xl lg:hidden">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                  <Store className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{storeDisplayName}</span>
                </div>
                <div className="mt-1 truncate text-sm font-black text-white">{salespersonDisplayName}</div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-zinc-400">{mobileSelectedCustomerLabel}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileCartOpen(true)}
                  className="inline-flex h-11 max-w-[8.75rem] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 text-left text-[11px] font-black text-white shadow-[0_0_18px_rgba(0,0,0,0.16)]"
                >
                  <User className="h-4 w-4 shrink-0 text-emerald-200" />
                  <span className="truncate">{mobileSelectedCustomerLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobileCartOpen(true)}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-emerald-500 px-3 text-[11px] font-black text-black shadow-[0_0_18px_rgba(16,185,129,0.18)]"
                >
                  <ReceiptText className="h-4 w-4 shrink-0" />
                  <span className="tabular-nums">{cartItemCount}</span>
                  <span className="hidden min-[390px]:inline tabular-nums">{formatCurrency(cartTotals.total)}</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className={`hidden shrink-0 items-center justify-between gap-2 overflow-x-hidden ${isRtl ? "flex-row-reverse" : ""} lg:flex`}>
          <div className="hidden shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-200 lg:block">
            نافذة مفتوحة: {currentUser?.name || currentUser?.email || "المستخدم"} | {posShiftBranch?.name || activePosShift?.branch_name || "الفرع"} | {activePosShift?.opened_at ? new Date(activePosShift.opened_at).toLocaleString() : ""}
          </div>
          <div className={`flex shrink-0 items-center gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label={fullscreenTooltip}
            aria-pressed={isFullscreen}
            title={fullscreenTooltip}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-200 shadow-[0_0_18px_rgba(0,0,0,0.18)] transition hover:border-white/20 hover:bg-white/[0.09] hover:text-white"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-pressed={salePricesEnabled}
            onClick={handleToggleSaleMode}
            disabled={saleModeSaving}
            title={salePricesEnabled ? "Sale Prices ON" : "Sale Prices OFF"}
            className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-black uppercase tracking-[0.08em] shadow-[0_0_18px_rgba(0,0,0,0.18)] transition disabled:cursor-not-allowed disabled:opacity-60 ${
              salePricesEnabled
                ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100 hover:border-emerald-300/50 hover:bg-emerald-400/15"
                : "border-amber-300/30 bg-amber-400/10 text-amber-100 hover:border-amber-300/50 hover:bg-amber-400/15"
            }`}
          >
            {saleModeSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Sale Prices</span>
            <span>{salePricesEnabled ? "ON" : "OFF"}</span>
          </button>
          <button
            type="button"
            onClick={handleCloseShift}
            disabled={attendanceLoading}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 text-xs font-black text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.14)] transition hover:border-emerald-300/50 hover:bg-emerald-500/15 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            Shift / Close Shift
          </button>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-rose-400/30 bg-rose-500/10 px-3 text-xs font-black text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.16)] transition hover:border-rose-300/50 hover:bg-rose-500/15"
          >
            <LogOut className="h-4 w-4" />
            Exit POS
          </button>
          </div>
        </div>

        <div className="relative z-30">
          <SmartPosFilters
            open={filtersOpen}
            panelRef={filtersPanelRef}
            portalTarget={typeof document !== "undefined" ? document.fullscreenElement || document.body : undefined}
            smartFilterOptions={smartFilterOptions}
            selectedGender={selectedGender}
            onGenderChange={setSelectedGender}
            selectedProductType={selectedProductType}
            onProductTypeChange={setSelectedProductType}
            selectedGrade={selectedGrade}
            onGradeChange={setSelectedGrade}
            brandOptions={brandOptions}
            selectedBrandId={selectedBrandId}
            onBrandChange={setSelectedBrandId}
            manufacturerOptions={manufacturerOptions}
            selectedManufacturerId={selectedManufacturerId}
            onManufacturerChange={setSelectedManufacturerId}
            activeSmartFilterCount={activeSmartFilterCount}
            onReset={handleClearSmartFilters}
            onClose={handleCloseFilters}
          />
          {customerCreateOpen && typeof document !== "undefined" ? createPortal(
            <div
              className="fixed inset-0 flex items-end justify-center overflow-hidden bg-black/80 p-2 backdrop-blur-sm sm:items-center sm:p-6"
              style={{ zIndex: 2147483000 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setCustomerCreateOpen(false);
              }}
              dir="auto"
            >
              <div
                className="flex max-h-[calc(100vh-1rem)] w-full max-w-lg min-w-0 flex-col overflow-hidden rounded-t-3xl border border-emerald-400/20 bg-slate-950 shadow-2xl shadow-black/70 sm:max-h-[calc(100vh-3rem)] sm:rounded-3xl"
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="pos-add-customer-title"
              >
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">CUSTOMER</div>
                    <h3 id="pos-add-customer-title" className="mt-1 text-lg font-black text-white">Quick customer creation</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomerCreateOpen(false)}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08]"
                  >
                    {t("common.close")}
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  <label className="block">
                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Customer name</div>
                    <input
                      value={quickCustomer.name}
                      onChange={(e) => setQuickCustomer((prev) => ({ ...prev, name: e.target.value }))}
                      className="h-12 w-full rounded-2xl border border-white/10 bg-black/70 px-4 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/50"
                      placeholder="Enter customer name"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Phone number</div>
                    <input
                      value={quickCustomer.phone}
                      onChange={(e) => setQuickCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                      className="h-12 w-full rounded-2xl border border-white/10 bg-black/70 px-4 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/50"
                      placeholder="Enter phone number"
                    />
                  </label>

                  {quickCustomerExistingMatch ? (
                    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100">
                      Existing customer found: {quickCustomerExistingMatch.name || quickCustomerExistingMatch.phone}. Saving will select this customer automatically.
                    </div>
                  ) : null}

                  {quickCustomerNeedsSource ? (
                    <label className="block">
                      <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Customer came from</div>
                      <select
                        value={quickCustomer.source_key}
                        onChange={(e) => setQuickCustomer((prev) => ({ ...prev, source_key: e.target.value }))}
                        className="h-12 w-full rounded-2xl border border-white/10 bg-black/70 px-4 text-sm text-white outline-none focus:border-emerald-400/50"
                      >
                        <option value="">Select source</option>
                        <option value="other">Other</option>
                        <option value="facebook_post">Facebook</option>
                        <option value="instagram_post">Instagram</option>
                        <option value="instagram_story">Story</option>
                        <option value="tiktok">TikTok</option>
                        <option value="whatsapp_campaign">WhatsApp</option>
                      </select>
                    </label>
                  ) : null}

                  <label className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-50">
                    <input
                      type="checkbox"
                      checked={Boolean(quickCustomer.allow_personal_transactions)}
                      onChange={(e) => setQuickCustomer((prev) => ({ ...prev, allow_personal_transactions: e.target.checked }))}
                      className="h-4 w-4 rounded border-emerald-300/40 bg-slate-950 text-emerald-400 focus:ring-emerald-300/40"
                    />
                    <span>السماح بالعمليات الشخصية</span>
                  </label>

                  <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setCustomerCreateOpen(false)}
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.08]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateCustomerFromToolbar}
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/15 px-4 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
                    >
                      Save customer
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            getActiveFullscreenElement() || document.body
          ) : null}
        </div>

        {shiftCloseOpen ? (
          <ShiftCloseModal
            report={shiftCloseReport}
            actualDrawerAmount={actualDrawerAmount}
            onActualDrawerChange={(value) => {
              setActualDrawerAmount(value);
              setClosingCash(value);
            }}
            closingNotes={shiftCloseNotes}
            onClosingNotesChange={setShiftCloseNotes}
            varianceReason={shiftVarianceReason}
            onVarianceReasonChange={setShiftVarianceReason}
            onCancel={() => {
              if (shiftCloseSubmitting) return;
              setShiftCloseOpen(false);
            }}
            onConfirm={handleConfirmCloseShift}
            submitting={shiftCloseSubmitting}
            onPrint={handlePrintShiftReport}
          />
        ) : null}
        {quickExpenseOpen ? (
          <QuickExpenseModal
            value={quickExpense}
            onChange={setQuickExpense}
            onClose={() => {
              if (!quickExpenseSaving) setQuickExpenseOpen(false);
            }}
            onSave={handleSaveQuickExpense}
            saving={quickExpenseSaving}
            branchName={activePosShift?.branch_name || posShiftBranch?.name || ""}
            shiftId={activePosShift?.id || ""}
            employees={salesEmployees}
          />
        ) : null}
        {paymobTerminalState?.open ? (
          <PaymobTerminalModal
            state={paymobTerminalState}
            loading={paymobTerminalLoading}
            onClose={() => {
              stopPaymobPolling();
              setPaymobTerminalState(null);
            }}
            onRetry={handlePaymobTerminalPayment}
            onChangePaymentMethod={() => {
              stopPaymobPolling();
              setPaymobTerminalState(null);
            }}
            onRetryStatus={handlePaymobRetryStatusCheck}
            onManualConfirm={handlePaymobManualConfirm}
          />
        ) : null}
        {cameraScannerOpen ? (
          <PosCameraScannerModal
            onClose={() => setCameraScannerOpen(false)}
            onScan={handleCameraScannerResult}
            onPermissionDenied={handleCameraScannerPermissionDenied}
            onUnsupported={handleCameraScannerUnsupported}
            onError={handleCameraScannerError}
          />
        ) : null}

        {editingOrder ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-black text-amber-100 shadow-2xl shadow-black/10" dir={isRtl ? "rtl" : "ltr"}>
            <span>{t("pos.editingInvoice", { invoice: editingOrder.invoice_number || editingOrder.id })}</span>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="rounded-full border border-amber-200/30 bg-black/20 px-3 py-1 text-xs text-amber-50 hover:bg-black/30"
            >
              {t("pos.cancelEdit")}
            </button>
          </div>
        ) : null}

        <div className="grid min-w-0 flex-none gap-2 lg:min-h-0 lg:flex-1 lg:gap-3 xl:grid-cols-[minmax(0,48%)_minmax(0,52%)] 2xl:grid-cols-[minmax(0,48%)_minmax(0,52%)]">
          <section className="min-w-0 self-start overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none lg:flex lg:min-h-0 lg:self-stretch lg:overflow-hidden lg:rounded-2xl lg:border lg:border-white/10 lg:bg-white/5 lg:p-2 lg:shadow-xl lg:shadow-black/10 lg:backdrop-blur">
            <div className="min-w-0 space-y-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <div className="relative z-30 rounded-2xl border border-white/10 bg-zinc-950/90 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl lg:sticky lg:top-[calc(env(safe-area-inset-top)+4.9rem)] xl:static xl:mx-0 xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-[1_1_100%] items-center gap-2 sm:flex-1 2xl:max-w-md">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      ref={searchRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleBarcodeSubmit();
                        }
                      }}
                      placeholder={t("pos.searchPlaceholder")}
                      className="h-9 w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 pl-10 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-400/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCameraScannerOpen(true)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 xl:hidden"
                    aria-label="فتح ماسح الكاميرا"
                    title="فتح ماسح الكاميرا"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                </div>
                <button
                  ref={filtersButtonRef}
                  type="button"
                  onClick={handleToggleFilters}
                  aria-expanded={filtersOpen}
                  className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black transition ${
                    filtersOpen
                      ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.14)]"
                      : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10"
                  }`}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {t("pos.filters.title")}
                  {activeSmartFilterCount > 0 ? (
                    <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-black text-emerald-100">
                      {activeSmartFilterCount}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecentOperationsOpenedAt(performance.now());
                    setRecentOperationsOpen(true);
                  }}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 transition hover:border-emerald-200/50 hover:bg-emerald-400/15"
                  dir="rtl"
                >
                  <History className="h-4 w-4" />
                  العمليات الأخيرة
                </button>
                {canCreatePosExpense ? (
                  <button
                    type="button"
                    onClick={() => setQuickExpenseOpen(true)}
                    disabled={!activePosShift?.id}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-amber-300/20 bg-amber-400/10 px-2.5 text-xs font-black text-amber-100 transition hover:border-amber-200/45 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                    title="مصروف / Expense"
                  >
                    <ReceiptText className="h-4 w-4" />
                    <span>مصروف</span>
                  </button>
                ) : null}
            </div>
            </div>

            <div className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
            <ProductGrid
              loading={loading}
              error={error}
              products={visibleProducts}
              search={search}
              onSelectProduct={handleSelectProduct}
            />
            </div>
            </div>
          </section>

          <div className="hidden min-h-0 xl:flex xl:flex-col xl:overflow-hidden">
          <CartSidebar
            cart={cart}
            onIncrease={handleIncrease}
            onDecrease={handleDecrease}
            onRemove={handleRemoveCartItem}
            onClear={handleClearCart}
            catalogProducts={products}
            onVariantChange={handleCartVariantChange}
            customer={customer}
            customerCreditBalance={customerCreditBalance}
            canUseCustomerCredit={canUseCustomerCredit}
            paymentMode={paymentMode}
            setPaymentMode={setPaymentMode}
            editRefundMethod={editRefundMethod}
            setEditRefundMethod={setEditRefundMethod}
            activeSplitMethod={activeSplitMethod}
            setActiveSplitMethod={setActiveSplitMethod}
            cashAmount={cashAmount}
            setCashAmount={setCashAmount}
            cardAmount={cardAmount}
            setCardAmount={setCardAmount}
            walletAmount={walletAmount}
            setWalletAmount={setWalletAmount}
            vodafoneCashAmount={vodafoneCashAmount}
            setVodafoneCashAmount={setVodafoneCashAmount}
            customerWalletAmount={customerWalletAmount}
            setCustomerWalletAmount={setCustomerWalletAmount}
            personalSettlementType={personalSettlementType}
            setPersonalSettlementType={setPersonalSettlementType}
            personalNote={personalNote}
            setPersonalNote={setPersonalNote}
            loyaltyProfile={loyaltyProfile}
            loyaltyValidation={loyaltyValidation}
            loyaltyUnavailable={loyaltyUnavailable}
            loyaltyRedeemPoints={loyaltyRedeemPoints}
            setLoyaltyRedeemPoints={setLoyaltyRedeemPoints}
            loyaltyDiscount={loyaltyDiscountAmount}
            loyaltyPointsToEarn={loyaltyPointsToEarn}
            walletCashbackToEarn={walletCashbackToEarn}
            totals={cartTotals}
            paymentSummary={paymentSummary}
            exchangeState={exchangeState}
            paymentDueAmount={amountDueNow}
            editPaymentSummary={editPaymentSummary}
            isEditingOrder={Boolean(editingOrder?.id)}
            onLookupExchangeOrder={lookupExchangeOrder}
            onApplyExchangeCredit={setExchangeState}
            onClearExchangeCredit={handleClearExchangeCredit}
            paymentAccountStatus={paymentAccountStatus}
            paymentAccountLoading={paymentAccountLoading}
            onPaymentAccountAdjusted={handlePaymentAccountAdjusted}
            invoiceNumber={invoiceNumber}
            onCheckout={handleCheckoutAction}
            onCreditSale={handleCreditSaleCheckout}
            onPaymobTerminal={handlePaymobTerminalPayment}
            paymobTerminalLoading={paymobTerminalLoading}
            checkoutLoading={checkoutLoading}
            checkoutLabel={editingOrder ? t("pos.cart.saveInvoiceEdit") : t("pos.cart.createOrder")}
            canUsePaymobTerminal={canUsePaymobTerminal}
            marketingAttribution={marketingAttribution}
            setMarketingAttribution={setMarketingAttribution}
            onItemDiscountChange={handleItemDiscount}
            invoiceDiscountType={invoiceDiscountType}
            setInvoiceDiscountType={setInvoiceDiscountType}
            invoiceDiscountValue={invoiceDiscountValue}
            setInvoiceDiscountValue={setInvoiceDiscountValue}
            invoiceDiscountReason={invoiceDiscountReason}
            setInvoiceDiscountReason={setInvoiceDiscountReason}
            invoiceDiscount={invoiceDiscount}
            setInvoiceDiscount={setInvoiceDiscount}
            serviceFee={serviceFee}
            setServiceFee={setServiceFee}
            couponCode={couponCode}
            setCouponCode={setCouponCode}
            couponValidation={couponValidation}
            couponLoading={couponLoading}
            onApplyCoupon={handleApplyCoupon}
            onRemoveCoupon={handleRemoveCoupon}
            salesEmployees={salesEmployees}
            sellersLoading={sellersLoading}
            sellerLoadError={sellerLoadError}
            selectedSalespersonId={selectedSalespersonId}
            setSelectedSalespersonId={handleSalespersonChange}
            onRefreshSellers={handleRefreshSellerUsers}
            allowSaleWithoutSalesperson={salesSettings.allow_sale_without_salesperson}
            canChangeSalesperson={canChangeSalesperson}
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            onSelectCustomer={handleSelectCustomer}
            onClearCustomer={handleClearSelectedCustomer}
            onCreateCustomerClick={openCustomerCreateModal}
            filtersModalOpen={filtersOpen}
          />
          </div>
        </div>

        {!isVariantModalOpen && !selectedProduct ? (
          <StickyMobileActionBar>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <button
                type="button"
                onClick={() => setMobileCartOpen(true)}
                className="flex min-h-14 min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 text-start text-white transition active:scale-[0.99] hover:bg-white/[0.08]"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/12 text-emerald-100">
                  <ShoppingBag className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-black text-zinc-400">{cartItemCount} {t("pos.cart.items", "items")}</span>
                  <span dir="ltr" className="block truncate text-sm font-black text-emerald-100 tabular-nums [unicode-bidi:isolate]">{formatCurrency(cartTotals.total)}</span>
                </span>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMobileCartOpen(true)}
                  className="inline-flex min-h-14 items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-white transition active:scale-[0.99] hover:bg-white/[0.08]"
                >
                  <ReceiptText className="h-4 w-4" />
                  فتح الفاتورة
                </button>
                <button
                  type="button"
                  disabled={checkoutLoading || cart.length === 0}
                  onClick={handleCheckout}
                  className="inline-flex min-h-14 items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 px-3 text-xs font-black text-black transition active:scale-[0.99] hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                  الدفع
                </button>
              </div>
            </div>
          </StickyMobileActionBar>
        ) : null}

        <MobileBottomSheet
          open={mobileCartOpen}
          title={`${t("pos.cart.title", "Cart")} · ${formatCurrency(cartTotals.total)}`}
          onClose={handleCloseMobileCart}
          className="xl:hidden"
        >
          <CartSidebar
            cart={cart}
            onIncrease={handleIncrease}
            onDecrease={handleDecrease}
            onRemove={handleRemoveCartItem}
            onClear={handleClearCart}
            catalogProducts={products}
            onVariantChange={handleCartVariantChange}
            customer={customer}
            customerCreditBalance={customerCreditBalance}
            canUseCustomerCredit={canUseCustomerCredit}
            paymentMode={paymentMode}
            setPaymentMode={setPaymentMode}
            editRefundMethod={editRefundMethod}
            setEditRefundMethod={setEditRefundMethod}
            activeSplitMethod={activeSplitMethod}
            setActiveSplitMethod={setActiveSplitMethod}
            cashAmount={cashAmount}
            setCashAmount={setCashAmount}
            cardAmount={cardAmount}
            setCardAmount={setCardAmount}
            walletAmount={walletAmount}
            setWalletAmount={setWalletAmount}
            vodafoneCashAmount={vodafoneCashAmount}
            setVodafoneCashAmount={setVodafoneCashAmount}
            customerWalletAmount={customerWalletAmount}
            setCustomerWalletAmount={setCustomerWalletAmount}
            personalSettlementType={personalSettlementType}
            setPersonalSettlementType={setPersonalSettlementType}
            personalNote={personalNote}
            setPersonalNote={setPersonalNote}
            loyaltyProfile={loyaltyProfile}
            loyaltyValidation={loyaltyValidation}
            loyaltyUnavailable={loyaltyUnavailable}
            loyaltyRedeemPoints={loyaltyRedeemPoints}
            setLoyaltyRedeemPoints={setLoyaltyRedeemPoints}
            loyaltyDiscount={loyaltyDiscountAmount}
            loyaltyPointsToEarn={loyaltyPointsToEarn}
            walletCashbackToEarn={walletCashbackToEarn}
            totals={cartTotals}
            paymentSummary={paymentSummary}
            exchangeState={exchangeState}
            paymentDueAmount={amountDueNow}
            editPaymentSummary={editPaymentSummary}
            isEditingOrder={Boolean(editingOrder?.id)}
            onLookupExchangeOrder={lookupExchangeOrder}
            onApplyExchangeCredit={setExchangeState}
            onClearExchangeCredit={handleClearExchangeCredit}
            paymentAccountStatus={paymentAccountStatus}
            paymentAccountLoading={paymentAccountLoading}
            onPaymentAccountAdjusted={handlePaymentAccountAdjusted}
            invoiceNumber={invoiceNumber}
            onCheckout={handleCheckoutAction}
            onCreditSale={handleCreditSaleCheckout}
            onPaymobTerminal={handlePaymobTerminalPayment}
            paymobTerminalLoading={paymobTerminalLoading}
            checkoutLoading={checkoutLoading}
            checkoutLabel={editingOrder ? t("pos.cart.saveInvoiceEdit") : t("pos.cart.createOrder")}
            canUsePaymobTerminal={canUsePaymobTerminal}
            marketingAttribution={marketingAttribution}
            setMarketingAttribution={setMarketingAttribution}
            onItemDiscountChange={handleItemDiscount}
            invoiceDiscountType={invoiceDiscountType}
            setInvoiceDiscountType={setInvoiceDiscountType}
            invoiceDiscountValue={invoiceDiscountValue}
            setInvoiceDiscountValue={setInvoiceDiscountValue}
            invoiceDiscountReason={invoiceDiscountReason}
            setInvoiceDiscountReason={setInvoiceDiscountReason}
            invoiceDiscount={invoiceDiscount}
            setInvoiceDiscount={setInvoiceDiscount}
            serviceFee={serviceFee}
            setServiceFee={setServiceFee}
            couponCode={couponCode}
            setCouponCode={setCouponCode}
            couponValidation={couponValidation}
            couponLoading={couponLoading}
            onApplyCoupon={handleApplyCoupon}
            onRemoveCoupon={handleRemoveCoupon}
            salesEmployees={salesEmployees}
            sellersLoading={sellersLoading}
            sellerLoadError={sellerLoadError}
            selectedSalespersonId={selectedSalespersonId}
            setSelectedSalespersonId={handleSalespersonChange}
            onRefreshSellers={handleRefreshSellerUsers}
            allowSaleWithoutSalesperson={salesSettings.allow_sale_without_salesperson}
            canChangeSalesperson={canChangeSalesperson}
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            onSelectCustomer={handleSelectCustomer}
            onClearCustomer={handleClearSelectedCustomer}
            onCreateCustomerClick={openCustomerCreateModal}
            filtersModalOpen={filtersOpen}
          />
        </MobileBottomSheet>

        {recentOperationsOpen ? (
          <Suspense fallback={null}>
            <RecentOperationsDrawer
              open={recentOperationsOpen}
              openedAt={recentOperationsOpenedAt}
              onClose={() => setRecentOperationsOpen(false)}
              onEditOrder={handleEditRecentOrder}
              onExchangeStarted={handleExchangeStarted}
              currentCartTotal={cartTotals.total}
            />
          </Suspense>
        ) : null}

        {viewportIsMobile && selectedProduct && topSelectionInfo ? (
          <MobileBottomSheet
            open
            title={activeProduct.name || t("pos.labels.variantSelection", "Variant selection")}
            onClose={() => {
              setSelectedProduct(null);
              setMobileProductQuantity(1);
            }}
            className="xl:hidden"
            footer={
              <button
                type="button"
                onClick={handleAddSelectedProductToCart}
                disabled={!activeVariant || mobileProductStock <= 0}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t("pos.labels.addToInvoiceArabic", "إضافة إلى الفاتورة")}
              </button>
            }
          >
            <div className="space-y-3 pb-2">
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  {activeVariantImageUrl ? (
                    <img
                      src={activeVariantImageUrl}
                      alt={activeProduct.name}
                      loading="eager"
                      className="h-full w-full object-contain p-1.5"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Package2 className="h-9 w-9 text-zinc-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">{t("pos.labels.variantSelection")}</div>
                  <div className="mt-1 line-clamp-2 text-sm font-black leading-tight text-white">{activeProduct.name}</div>
                  <div className="mt-1 truncate text-xs font-semibold text-zinc-400">{activeProduct.sku || activeProduct.barcode || t("common.notAvailable")}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-black text-white">
                      {formatCurrency(activeVariant?.price || activeProduct.sale_price || 0)}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-black text-white">
                      {t("pos.labels.stock")}: {mobileProductStock}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{t("pos.labels.color")}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topSelectionInfo.colors.map((color) => (
                      <button
                        key={color || "default"}
                        type="button"
                        onClick={() => {
                          setSelectedColor(color);
                          const firstForColor = (activeProduct.variants || []).find(
                            (variant) =>
                              String(variant.color || "") === String(color || "") &&
                              normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0
                          ) || (activeProduct.variants || []).find(
                            (variant) => String(variant.color || "") === String(color || "")
                          );
                          setSelectedSize(firstForColor?.size || "");
                        }}
                        className={`min-h-10 rounded-full border px-3 py-2 text-xs font-black transition ${
                          selectedColor === color
                            ? "border-emerald-400/30 bg-emerald-500 text-black"
                            : "border-white/10 bg-black/30 text-white hover:bg-white/10"
                        }`}
                      >
                        {color || t("pos.labels.default")}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{t("pos.labels.size")}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topSelectionInfo.sizes.map((size) => {
                      const sizeVariant = (activeProduct.variants || []).find(
                        (variant) =>
                          String(variant.color || "") === String(selectedColor || "") &&
                          String(variant.size || "") === String(size || "")
                      );
                      const stock = normalizeStockQuantity(sizeVariant?.stock_quantity ?? sizeVariant?.stock);
                      const disabled = !sizeVariant || stock <= 0;
                      return (
                        <button
                          key={size || "one-size"}
                          type="button"
                          onClick={() => setSelectedSize(size)}
                          disabled={disabled}
                          className={`min-h-10 rounded-full border px-3 py-2 text-xs font-black transition ${
                            selectedSize === size
                              ? "border-emerald-400/30 bg-emerald-500 text-black"
                              : disabled
                                ? "cursor-not-allowed border-white/5 bg-black/20 text-zinc-600"
                                : "border-white/10 bg-black/30 text-white hover:bg-white/10"
                          }`}
                        >
                          <span className="block leading-tight">{getPosSizeDisplayLabel(activeProduct, size) || t("pos.labels.oneSize")}</span>
                          <span className={`block text-[10px] leading-tight ${disabled ? "text-zinc-600" : "text-zinc-300"}`}>
                            {t("pos.labels.stock")}: {stock}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{t("pos.labels.quantity", "Quantity")}</div>
                      <div className="mt-0.5 text-xs font-semibold text-zinc-400">{t("pos.labels.selectQuantity", "Choose how many to add")}</div>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => setMobileProductQuantity((current) => Math.max(1, Number(current || 1) - 1))}
                        disabled={mobileProductQuantity <= 1}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-10 text-center text-base font-black text-white tabular-nums">{mobileProductQuantity}</span>
                      <button
                        type="button"
                        onClick={() => setMobileProductQuantity((current) => Math.min(mobileProductStock || Number.MAX_SAFE_INTEGER, Number(current || 1) + 1))}
                        disabled={mobileProductStock > 0 && mobileProductQuantity >= mobileProductStock}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black text-zinc-300">
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{activeVariant?.color || t("pos.labels.default")} / {activeVariantSizeLabel || t("pos.labels.oneSize")}</span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{activeVariant?.sku || activeProduct.sku || t("common.notAvailable")}</span>
                  </div>
                </div>
              </div>
            </div>
          </MobileBottomSheet>
        ) : null}

        {!viewportIsMobile && selectedProduct && topSelectionInfo ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-2 py-2 sm:px-4 sm:py-6 lg:items-center">
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 sm:rounded-[2rem]">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 p-3 sm:gap-4 sm:p-5">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{t("pos.labels.variantSelection")}</div>
                  <h3 className="mt-0.5 line-clamp-1 text-base font-black text-white sm:text-2xl">{activeProduct.name}</h3>
                  <p className="mt-0.5 hidden text-sm text-zinc-400 sm:block">
                    {t("pos.labels.chooseVariantPrompt")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProduct(null);
                    setMobileProductQuantity(1);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10 sm:rounded-2xl sm:text-sm"
                >
                  {t("common.close")}
                </button>
              </div>

              <div className="grid flex-1 gap-3 overflow-y-auto p-3 pb-24 sm:gap-5 sm:p-5 sm:pb-5 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="sm:hidden">
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/25">
                      {activeVariantImageUrl ? (
                        <img
                          src={activeVariantImageUrl}
                          alt={activeProduct.name}
                          loading="eager"
                          className="h-full w-full object-contain p-1.5"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <Package2 className="h-9 w-9 text-zinc-600" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">{t("pos.labels.variantSelection")}</div>
                      <div className="mt-1 line-clamp-2 text-sm font-black leading-tight text-white" title={activeProduct.name}>
                        {activeProduct.name}
                      </div>
                      <div className="mt-2 truncate text-xs font-semibold text-zinc-400">
                        {activeVariant?.color || t("pos.labels.default")} / {activeVariantSizeLabel || t("pos.labels.oneSize")}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 sm:space-y-4">
                  <div className="grid gap-2 sm:gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5 sm:rounded-3xl sm:p-4">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:text-xs sm:tracking-[0.18em]">{t("pos.labels.color")}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
                        {topSelectionInfo.colors.map((color) => (
                          <button
                            key={color || "default"}
                            type="button"
                          onClick={() => {
                            setSelectedColor(color);
                            const firstForColor = (activeProduct.variants || []).find(
                              (variant) =>
                                String(variant.color || "") === String(color || "") &&
                                normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0
                            ) || (activeProduct.variants || []).find(
                              (variant) => String(variant.color || "") === String(color || "")
                            );
                            setSelectedSize(firstForColor?.size || "");
                            }}
                            className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-black transition sm:px-4 sm:py-2 sm:text-sm ${
                              selectedColor === color
                                ? "bg-emerald-500 text-black"
                                : "border border-white/10 bg-black/30 text-white hover:bg-white/10"
                            }`}
                          >
                            {color || t("pos.labels.default")}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5 sm:rounded-3xl sm:p-4">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:text-xs sm:tracking-[0.18em]">{t("pos.labels.size")}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
                        {topSelectionInfo.sizes.map((size) => {
                          const sizeVariant = (activeProduct.variants || []).find(
                            (variant) =>
                              String(variant.color || "") === String(selectedColor || "") &&
                              String(variant.size || "") === String(size || "")
                          );
                          const stock = normalizeStockQuantity(sizeVariant?.stock_quantity ?? sizeVariant?.stock);
                          const disabled = !sizeVariant || stock <= 0;
                          return (
                            <button
                            key={size || "one-size"}
                            type="button"
                            onClick={() => setSelectedSize(size)}
                            disabled={disabled}
                            className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-black transition sm:px-4 sm:py-2 sm:text-sm ${
                              selectedSize === size
                                ? "bg-emerald-500 text-black"
                                : disabled
                                  ? "cursor-not-allowed border border-white/5 bg-black/20 text-zinc-600"
                                  : "border border-white/10 bg-black/30 text-white hover:bg-white/10"
                            }`}
                          >
                            <span className="block leading-tight">{getPosSizeDisplayLabel(activeProduct, size) || t("pos.labels.oneSize")}</span>
                            <span className={`block text-[10px] leading-tight ${disabled ? "text-zinc-600" : "text-zinc-300"}`}>
                              {t("pos.labels.stock")}: {stock}
                            </span>
                          </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="hidden overflow-hidden rounded-2xl border border-white/10 sm:block sm:rounded-3xl">
                    <div className="hidden grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr] bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-500 lg:grid">
                      <span>{t("pos.labels.variant")}</span>
                      <span>{t("pos.labels.sku")}</span>
                      <span>{t("pos.labels.barcode")}</span>
                      <span>{t("pos.labels.stock")}</span>
                      <span>{t("pos.labels.action")}</span>
                    </div>
                    <div className="max-h-[46vh] overflow-auto bg-zinc-950 sm:max-h-[28rem]">
                      {(activeProduct.variants || []).map((variant) => {
                        const selected =
                          String(variant.color || "") === String(selectedColor || "") &&
                          String(variant.size || "") === String(selectedSize || "");
                        const stock = normalizeStockQuantity(variant.stock_quantity ?? variant.stock);
                        const price = formatCurrency(variant.price || activeProduct.sale_price || 0);
                        const disabled = stock <= 0;
                        return (
                          <div
                            key={String(variant.variant_id || variant.id)}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-white/5 px-2.5 py-2 text-xs sm:px-4 sm:py-3 sm:text-sm lg:grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr] lg:gap-3 ${
                              selected ? "bg-emerald-500/10" : ""
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate font-black text-white sm:font-semibold">
                                {variant.color || t("pos.labels.default")} / {getPosSizeDisplayLabel(activeProduct, variant.size) || t("pos.labels.oneSize")}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-zinc-300 sm:text-xs lg:hidden">
                                <span className="rounded-full bg-white/5 px-2 py-0.5">{t("pos.labels.stock")}: {stock}</span>
                                <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-200">{t("pos.labels.price")}: {price}</span>
                                {(variant.sku || activeProduct.sku) ? <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-500">SKU: {String(variant.sku || activeProduct.sku).slice(-6)}</span> : null}
                              </div>
                              <div className="hidden text-xs text-zinc-500 lg:block">{price}</div>
                            </div>
                            <div className="hidden truncate text-zinc-300 lg:block">{variant.sku || activeProduct.sku}</div>
                            <div className="hidden truncate text-zinc-300 lg:block">{variant.barcode || activeProduct.barcode || t("common.notAvailable")}</div>
                            <div className="hidden text-zinc-300 lg:block">{stock}</div>
                            <button
                              type="button"
                              onClick={() => addVariantToCart(activeProduct, variant)}
                              disabled={disabled}
                              className="inline-flex min-h-9 items-center justify-center rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-2xl sm:px-3 sm:py-2"
                            >
                              {t("pos.labels.add")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 sm:space-y-4">
                  <div className="hidden overflow-hidden rounded-3xl border border-white/10 bg-white/5 sm:block">
                    {activeVariantImageUrl ? (
                      <img
                        src={activeVariantImageUrl}
                        alt={activeProduct.name}
                        loading="lazy"
                        className="h-64 w-full object-contain p-4"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
                        <Package2 className="h-14 w-14 text-zinc-600" />
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:rounded-3xl sm:p-4">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:text-xs sm:tracking-[0.18em]">{t("pos.labels.selectedVariant")}</div>
                    <div className="mt-1 text-base font-black text-white sm:mt-2 sm:text-xl">
                      {activeVariant?.color || t("pos.labels.default")} / {activeVariantSizeLabel || t("pos.labels.oneSize")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-black sm:mt-4 sm:grid sm:grid-cols-2 sm:gap-3 sm:text-sm">
                      <SmallCard compact label={t("pos.labels.stock")} value={String(normalizeStockQuantity(activeVariant?.stock_quantity ?? activeVariant?.stock))} />
                      <SmallCard compact label={t("pos.labels.price")} value={formatCurrency(activeVariant?.price || 0)} />
                      <SmallCard className="hidden sm:block" label={t("pos.labels.sku")} value={activeVariant?.sku || t("common.notAvailable")} />
                      <SmallCard className="hidden sm:block" label={t("pos.labels.barcode")} value={activeVariant?.barcode || t("common.notAvailable")} />
                    </div>
                    <details className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-400 sm:hidden">
                      <summary className="cursor-pointer font-bold text-zinc-300">{t("pos.labels.sku")} / {t("pos.labels.barcode")}</summary>
                      <div className="mt-2 space-y-1">
                        <div className="truncate">SKU: {activeVariant?.sku || t("common.notAvailable")}</div>
                        <div className="truncate">{t("pos.labels.barcode")}: {activeVariant?.barcode || t("common.notAvailable")}</div>
                      </div>
                    </details>
                    <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300 sm:hidden">
                      REAL_VARIANT_COMPONENT_DEBUG
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeVariant) addVariantToCart(activeProduct, activeVariant);
                        setSelectedProduct(null);
                        setMobileProductQuantity(1);
                      }}
                      disabled={!activeVariant || normalizeStockQuantity(activeVariant.stock_quantity ?? activeVariant.stock) <= 0}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-emerald-500 px-4 py-4 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden"
                    >
                      <span className="truncate">
                        {t("pos.labels.addToInvoiceArabic", "إضافة إلى الفاتورة")}
                      </span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (activeVariant) addVariantToCart(activeProduct, activeVariant);
                      setSelectedProduct(null);
                      setMobileProductQuantity(1);
                    }}
                    disabled={!activeVariant || normalizeStockQuantity(activeVariant.stock_quantity ?? activeVariant.stock) <= 0}
                    className="hidden w-full items-center justify-center gap-2 rounded-3xl bg-emerald-500 px-4 py-4 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
                  >
                    {t("pos.labels.addToCart", "Add to cart")}
                    <ChevronRight className="h-4 w-4" />
                  </button>

                  <div className="hidden rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100 sm:block">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4" />
                      {t("pos.labels.stockNote")}
                    </div>
                    <p className="mt-2 text-amber-50/80">
                      {t("pos.labels.stockNoteBody")}
                    </p>
                  </div>
                </div>
              </div>
              <div className="hidden sm:hidden" />
            </div>
          </div>
        ) : null}

        {isVariantModalOpen ? (
          <ProductAvailabilityModal
            product={liveBarcodeShopProduct}
            onClose={() => setBarcodeShopProduct(null)}
            onAddVariant={addVariantToCart}
          />
        ) : null}

        {loading ? (
          <div className="fixed bottom-4 right-4 rounded-full border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-zinc-300 shadow-2xl shadow-black/30">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            {t("pos.labels.syncingCatalog")}
          </div>
        ) : null}


        {checkoutSuccessOpen && (lastOrder || lastShareContext) ? (
          <InvoiceSuccessDialog
            order={lastOrder || lastShareContext}
            onClose={() => setCheckoutSuccessOpen(false)}
            onPrint={handlePrint}
            onWhatsapp={handleShareWhatsApp}
            onDownloadPdf={handleDownloadInvoicePdf}
          />
        ) : null}
      </div>
    </div>
  );
}

function InvoiceSuccessDialog({ order, onClose, onPrint, onWhatsapp, onDownloadPdf }) {
  const invoiceNumber = order?.invoice_number || order?.invoiceNumber || displayPublicOrderNumber(order) || "Invoice";
  const total = Number(order?.total ?? order?.totals?.total ?? 0);
  const customerName = order?.customerName || order?.customer_name || "Walk-in Customer";
  const paymentMethod = order?.payment?.method || order?.payment_method || "cash";

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-xl rounded-3xl border border-emerald-300/20 bg-zinc-950 p-5 text-white shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-100">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Checkout complete
            </div>
            <h2 className="mt-3 truncate text-2xl font-black">{invoiceNumber}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-zinc-200 transition hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <SuccessMeta label="Total" value={formatCurrency(total)} />
          <SuccessMeta label="Customer" value={customerName} />
          <SuccessMeta label="Payment" value={paymentMethod} />
          <SuccessMeta label="Status" value={order?.payment?.paymentStatus || order?.paymentStatus || "Paid"} />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <button type="button" onClick={onPrint} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 text-sm font-black text-white transition hover:bg-white/10">
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button type="button" onClick={onWhatsapp} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-3 text-sm font-black text-emerald-100 transition hover:bg-emerald-400/15">
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </button>
          <button type="button" onClick={onDownloadPdf} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-3 text-sm font-black text-cyan-100 transition hover:bg-cyan-400/15">
            <FileDown className="h-4 w-4" />
            PDF
          </button>
        </div>
      </section>
    </div>
  );
}

function SuccessMeta({ label, value }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-white" title={String(value || "")}><CurrencyText value={value} /></div>
    </div>
  );
}

function PaymobTerminalModal({ state, loading, onClose, onRetry, onChangePaymentMethod, onRetryStatus, onManualConfirm }) {
  const status = String(state?.status || "processing").toLowerCase();
  const isFailed = status === "failed" || status === "cancelled" || status === "timeout";
  const isSuccess = status === "success" || status === "success_manual_confirmed";
  const isProcessing = loading || status === "processing" || status === "waiting" || status === "sent";
  const title = isFailed
    ? "فشل الدفع"
    : isSuccess
      ? "Payment completed successfully."
      : isProcessing
      ? state?.message || "Sending payment to Paymob terminal..."
      : "Payment sent to terminal.";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${
              isFailed ? "border-rose-300/30 bg-rose-500/10 text-rose-100" : "border-cyan-300/30 bg-cyan-500/10 text-cyan-100"
            }`}>
              {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isFailed ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Paymob POS
            </div>
            <h2 className="mt-3 text-2xl font-black">{title}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-zinc-400">
              {state?.message || "Payment request sent to terminal. Complete payment on the machine."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-zinc-300 transition hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 grid gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-zinc-400">Amount</span>
            <span className="font-black text-white">{formatCurrency(state?.amount || 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-zinc-400">Terminal ID</span>
            <span className="font-black text-white">{state?.terminalId || "Configured on backend"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-zinc-400">Status</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-black ${isFailed ? "bg-rose-500/10 text-rose-200" : isProcessing ? "bg-cyan-500/10 text-cyan-100" : "bg-emerald-500/10 text-emerald-200"}`}>
              {state?.status || "processing"}
            </span>
          </div>
          {state?.transaction?.confirmation_source || state?.audit ? (
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-zinc-400">Confirmation</span>
              <span className="max-w-[12rem] truncate font-black text-white" title={state?.transaction?.confirmation_source || state?.audit?.action || ""}>
                {state?.transaction?.confirmation_source || state?.audit?.action || ""}
              </span>
            </div>
          ) : null}
        </div>
        <div className="mt-5 grid gap-2">
          {isFailed ? (
            <>
              <button
                type="button"
                onClick={onRetry}
                disabled={loading}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-60"
              >
                {loading ? "Sending..." : "إعادة المحاولة بباي موب"}
              </button>
              <button
                type="button"
                onClick={onChangePaymentMethod}
                disabled={loading}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                تغيير طريقة الدفع
              </button>
            </>
          ) : null}
          <button type="button" onClick={onClose} className="inline-flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-cyan-100">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function ShiftGate({
  currentUser,
  branch,
  attendanceLoading,
  posShiftLoading,
  openingCash,
  setOpeningCash,
  onOpenShift,
}) {
  const { t } = useTranslation();
  const branchName = branch?.name || currentUser?.branch_name || "";
  const userName = currentUser?.name || currentUser?.email || "";
  const resolvedBranchId = String(
    branch?.id ||
      currentUser?.branch_id ||
      currentUser?.branchId ||
      currentUser?.default_branch_id ||
      currentUser?.defaultBranchId ||
      ""
  ).trim();
  const hasBranch = Boolean(resolvedBranchId);
  const disabledReason = !hasBranch
    ? "missing_branch"
    : attendanceLoading
      ? "opening_shift"
      : posShiftLoading
        ? "active_shift_loading"
        : "";

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[pos-shift-gate]", {
      branch_id: resolvedBranchId || null,
      user: currentUser?.id || currentUser?.email || currentUser?.name || null,
      loading: {
        attendanceLoading: Boolean(attendanceLoading),
        posShiftLoading: Boolean(posShiftLoading),
      },
      disabledReason: disabledReason || "none",
    });
  }, [attendanceLoading, currentUser?.email, currentUser?.id, currentUser?.name, disabledReason, posShiftLoading, resolvedBranchId]);

  return (
    <div className="flex flex-1 items-center justify-center px-2 py-8">
      <section className="w-full max-w-3xl rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              {t("pos.shift.gate")}
            </div>
            <h1 className="mt-3 text-3xl font-black text-white">{t("pos.shift.openShift")}</h1>
            <p className="mt-2 text-sm text-zinc-400">
              يجب فتح الشيفت قبل البيع. سيتم فتح الشيفت باسم المستخدم المسجل دخوله.
            </p>
          </div>
          <Clock3 className="h-6 w-6 text-emerald-300" />
        </div>

        <div className="mt-6 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
                <UserCheck className="h-4 w-4" />
                المستخدم
              </div>
              <div className="mt-2 text-lg font-black text-white">{userName || "المستخدم الحالي"}</div>
              <div className="mt-1 text-xs text-zinc-500">متعلق من الحساب الحالي</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
                <Warehouse className="h-4 w-4" />
                {t("pos.shift.assignedBranch")}
              </div>
              <div className="mt-2 text-lg font-black text-white">{branchName || t("pos.shift.noBranchAssigned")}</div>
              <div className="mt-1 text-xs text-zinc-500">{t("pos.shift.readOnly")}</div>
            </div>
          </div>

          <label className="block">
            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Opening cash</div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50"
              placeholder="0.00"
            />
          </label>

          {!hasBranch ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100">
              {t("pos.shift.noBranchMessage")}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onOpenShift}
            disabled={attendanceLoading || posShiftLoading || !hasBranch}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {attendanceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
            فتح الشيفت
          </button>
        </div>
      </section>
    </div>
  );
}

function getShiftRotationLabels(language = "en") {
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  return isArabic
      ? {
        shiftClose: "إغلاق الشيفت",
        drawerSummary: "ملخص الدرج",
        expectedDrawer: "المتوقع في الدرج",
        actualDrawer: "المبلغ الفعلي",
        cancel: "إلغاء",
        closeShift: "إغلاق الشيفت",
      }
    : {
        shiftClose: "Shift close",
        drawerSummary: "Drawer summary",
        expectedDrawer: "Expected drawer",
        actualDrawer: "Actual drawer",
        cancel: "Cancel",
        closeShift: "Close shift",
      };
}

const getShiftCloseCopy = (language = "en") => {
  const ar = String(language || "").toLowerCase().startsWith("ar");
  return ar
    ? {
        title: "\u0645\u0631\u0627\u062c\u0639\u0629 \u0648\u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0634\u064a\u0641\u062a",
        subtitle: "\u0631\u0627\u062c\u0639 \u0627\u0644\u062f\u0631\u062c \u0648\u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0627\u062a \u0648\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0642\u0628\u0644 \u0627\u0644\u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0646\u0647\u0627\u0626\u064a.",
        balanced: "\u0634\u064a\u0641\u062a \u0645\u062a\u0648\u0627\u0632\u0646",
        balancedHelp: "\u0644\u0627 \u064a\u0648\u062c\u062f \u0641\u0631\u0642 \u0646\u0642\u062f\u064a \u0641\u064a \u0627\u0644\u062f\u0631\u062c",
        extra: "\u064a\u0648\u062c\u062f \u0646\u0642\u062f \u0625\u0636\u0627\u0641\u064a",
        extraHelp: "{{amount}} \u0632\u064a\u0627\u062f\u0629 \u0641\u064a \u0627\u0644\u062f\u0631\u062c",
        shortage: "\u064a\u0648\u062c\u062f \u0639\u062c\u0632 \u0646\u0642\u062f\u064a",
        shortageHelp: "{{amount}} \u0646\u0627\u0642\u0635\u0629 \u0645\u0646 \u0627\u0644\u062f\u0631\u062c",
        netRevenue: "\u0635\u0627\u0641\u064a \u0627\u0644\u0625\u064a\u0631\u0627\u062f",
        netRevenueHelp: "\u0628\u0639\u062f \u0627\u0644\u0645\u0631\u062a\u062c\u0639\u0627\u062a \u0648\u0627\u0644\u062e\u0635\u0648\u0645\u0627\u062a",
        paymentsReconciled: "\u062a\u0645\u062a \u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0627\u062a",
        paymentsNeedReview: "\u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0627\u062a \u062a\u062d\u062a\u0627\u062c \u0645\u0631\u0627\u062c\u0639\u0629",
        sellerPerformance: "\u0623\u062f\u0627\u0621 \u0627\u0644\u0628\u0627\u0626\u0639\u064a\u0646",
        closingNotes: "\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0625\u063a\u0644\u0627\u0642",
        varianceReason: "\u0633\u0628\u0628 \u0641\u0631\u0642 \u0627\u0644\u062f\u0631\u062c",
        printReport: "\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u062a\u0642\u0631\u064a\u0631",
        refreshActualDrawer: "\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0639\u062f \u0627\u0644\u0641\u0639\u0644\u064a",
        finalizeShiftClose: "\u0625\u0646\u0647\u0627\u0621 \u0627\u0644\u0648\u0631\u062f\u064a\u0629 / \u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0634\u064a\u0641\u062a \u0646\u0647\u0627\u0626\u064a\u064b\u0627",
        closeReady: "\u062c\u0627\u0647\u0632 \u0644\u0644\u0625\u063a\u0644\u0627\u0642",
        varianceDetected: "\u064a\u0648\u062c\u062f \u0641\u0631\u0642 \u064a\u062d\u062a\u0627\u062c \u0645\u0631\u0627\u062c\u0639\u0629",
        finalConfirm: "\u062a\u0623\u0643\u064a\u062f \u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0634\u064a\u0641\u062a",
        finalConfirmHelp: "\u0633\u064a\u062a\u0645 \u062a\u062b\u0628\u064a\u062a \u0627\u0644\u0625\u063a\u0644\u0627\u0642 \u0648\u0625\u0635\u062f\u0627\u0631 \u062a\u0642\u0631\u064a\u0631 \u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629.",
        confirmClose: "\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0625\u063a\u0644\u0627\u0642",
      }
    : {
        title: "Shift close reconciliation",
        subtitle: "Review drawer cash, payments, sales, and audit records before final close.",
        balanced: "Balanced Shift",
        balancedHelp: "No cash variance detected",
        extra: "Extra cash detected",
        extraHelp: "{{amount}} extra in drawer",
        shortage: "Cash shortage detected",
        shortageHelp: "{{amount}} missing from drawer",
        netRevenue: "Net Revenue",
        netRevenueHelp: "After returns and discounts",
        paymentsReconciled: "Payments reconciled",
        paymentsNeedReview: "Payments need review",
        sellerPerformance: "Seller performance",
        closingNotes: "Closing notes",
        varianceReason: "Variance reason",
        printReport: "Print report",
        refreshActualDrawer: "Update actual drawer",
        finalizeShiftClose: "Finalize shift close",
        closeReady: "Ready to close",
        varianceDetected: "Variance detected",
        finalConfirm: "Confirm shift close",
        finalConfirmHelp: "This will finalize the drawer close and issue the reconciliation report.",
        confirmClose: "Confirm close",
      };
};

const formatShiftDuration = (openedAt, closedAt = new Date()) => {
  const start = openedAt ? new Date(openedAt).getTime() : 0;
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  if (!start || Number.isNaN(start) || Number.isNaN(end) || end < start) return "";
  const minutes = Math.floor((end - start) / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const readableAuditAction = (item = {}) => {
  const raw = String(item.action || item.type || item.event_type || item.label || "").toLowerCase();
  if (raw.includes("return") || raw.includes("refund")) return "Return processed";
  if (raw.includes("employee_advance") || raw.includes("employee advance")) return "Employee advance";
  if (raw.includes("expense")) return "POS expense";
  if (raw.includes("cancel")) return "Invoice cancelled";
  if (raw.includes("wallet")) return "Wallet payment";
  if (raw.includes("card") || raw.includes("visa") || raw.includes("terminal")) return "Card payment";
  if (raw.includes("cash") || raw.includes("sale")) return "Cash sale";
  if (raw.includes("drawer") || raw.includes("adjust")) return "Drawer adjustment";
  if (raw.includes("open")) return "Shift opened";
  if (raw.includes("close")) return "Shift closed";
  return String(item.label || item.type || item.action || "Shift event").replace(/_/g, " ");
};

const auditReference = (item = {}) =>
  item.employee_name || item.invoice_number || item.public_order_number || item.order_number || item.reference || item.reference_id || item.source_id || "";

const getShiftSellerPerformance = (report = {}) => {
  const direct =
    report.seller_performance ||
    report.sellers ||
    report.sales_by_seller ||
    report.salesperson_breakdown ||
    report.seller_breakdown ||
    [];
  if (Array.isArray(direct) && direct.length) {
    return direct.map((item) => ({
      name: item.name || item.seller_name || item.salesperson_name || item.employee_name || "Seller",
      total: Number(item.total || item.sales || item.amount || item.total_sales || 0),
      count: Number(item.invoice_count || item.count || item.orders || item.invoices || 0),
    }));
  }

  const grouped = new Map();
  (report.audit_timeline || []).forEach((item) => {
    const name = item.seller_name || item.salesperson_name || item.employee_name || "";
    const amount = Number(item.amount || item.total || 0);
    if (!name || amount <= 0 || !String(item.type || item.action || "").toLowerCase().includes("sale")) return;
    const current = grouped.get(name) || { name, total: 0, count: 0 };
    current.total += amount;
    current.count += 1;
    grouped.set(name, current);
  });
  return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
};

const getPaymentReconciliationWarnings = (report = {}) => {
  const explicit = report.payment_reconciliation?.warnings || report.payment_warnings || report.reconciliation_warnings || [];
  const warnings = Array.isArray(explicit) ? explicit.map((item) => (typeof item === "string" ? item : item.message || item.label || "")).filter(Boolean) : [];
  const totals = report.totals || {};
  const breakdown = Array.isArray(report.payment_breakdown) ? report.payment_breakdown : [];
  const totalByMethod = (name) =>
    breakdown
      .filter((item) => String(item.payment_method || item.method || "").toLowerCase().includes(name))
      .reduce((sum, item) => sum + Number(item.total || item.amount || 0), 0);
  [["card", totals.card], ["wallet", totals.wallet]].forEach(([method, expected]) => {
    const expectedValue = Number(expected || 0);
    const actualValue = totalByMethod(method);
    if (expectedValue > 0 && actualValue > 0 && Math.abs(expectedValue - actualValue) > 0.01) {
      warnings.push(`${method[0].toUpperCase()}${method.slice(1)} mismatch: ${formatCurrency(Math.abs(expectedValue - actualValue))}`);
    }
  });
  const pendingTerminal = Number(totals.pending_terminal_settlements || report.pending_terminal_settlements || 0);
  const missingConfirmations = Number(totals.missing_payment_confirmations || report.missing_payment_confirmations || 0);
  if (pendingTerminal > 0) warnings.push(`${pendingTerminal} pending terminal settlement${pendingTerminal === 1 ? "" : "s"}`);
  if (missingConfirmations > 0) warnings.push(`${missingConfirmations} missing payment confirmation${missingConfirmations === 1 ? "" : "s"}`);
  return warnings;
};

const getTopProductImageUrl = (item = {}) =>
  resolvePosImageUrl(
    firstImageValue(
      item.image_url,
      item.image,
      item.product_image_url,
      item.product_image,
      item.variant_image_url,
      item.variant_image,
      item.main_image,
      item.thumbnail_url,
      item.thumbnail,
      item.product_images?.[0]?.image_url,
      item.product_images?.[0]?.url,
      item.product_images?.[0]?.path,
      item.product_images?.[0],
      item.variant_images?.[0]?.image_url,
      item.variant_images?.[0]?.url,
      item.variant_images?.[0]?.path,
      item.variant_images?.[0]
    )
  );

function ShiftCloseModal({
  report,
  actualDrawerAmount,
  onActualDrawerChange,
  closingNotes = "",
  onClosingNotesChange,
  varianceReason = "",
  onVarianceReasonChange,
  onCancel,
  onConfirm,
  submitting,
  onPrint,
}) {
  const { i18n } = useTranslation();
  const labels = getShiftRotationLabels(i18n.language);
  const copy = getShiftCloseCopy(i18n.language);
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const totals = report?.totals || {};
  const shift = report?.shift || {};
  const expectedDrawer = Number(totals.expected_cash ?? shift.expected_cash ?? report?.expectedDrawer ?? 0);
  const difference = Number(actualDrawerAmount || 0) - expectedDrawer;
  const absDifference = Math.abs(difference);
  const netRevenue = Number(totals.total_sales || 0) - Number(totals.returns || 0) - Number(totals.discounts || 0);
  const totalSoldItems = (report?.top_products || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const sellerPerformance = getShiftSellerPerformance(report);
  const paymentWarnings = getPaymentReconciliationWarnings(report);
  const shiftDuration = formatShiftDuration(shift.opened_at, shift.closed_at || new Date());
  const varianceState =
    difference === 0
      ? {
          title: copy.balanced,
          help: copy.balancedHelp,
          icon: CheckCircle2,
          className: "border-emerald-300/35 bg-emerald-400/15 text-emerald-50 shadow-[0_0_34px_rgba(16,185,129,0.22)]",
        }
      : difference > 0
        ? {
            title: copy.extra,
            help: copy.extraHelp.replace("{{amount}}", formatCurrency(absDifference)),
            icon: Banknote,
            className: "border-amber-300/35 bg-amber-400/15 text-amber-50 shadow-[0_0_34px_rgba(251,191,36,0.2)]",
          }
        : {
            title: copy.shortage,
            help: copy.shortageHelp.replace("{{amount}}", formatCurrency(absDifference)),
            icon: AlertTriangle,
            className: "border-rose-300/35 bg-rose-500/15 text-rose-50 shadow-[0_0_34px_rgba(244,63,94,0.24)]",
          };
  const VarianceIcon = varianceState.icon;
  const [confirmClose, setConfirmClose] = useState(false);

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 px-2 py-2 backdrop-blur-sm sm:items-center sm:px-3 sm:py-5">
      <div dir={isArabic ? "rtl" : "ltr"} className="max-h-[96vh] w-[94vw] max-w-[1260px] overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-3 shadow-2xl shadow-black/60 sm:max-h-[92vh] sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              {labels.shiftClose}
            </div>
            <h2 className="mt-2 text-xl font-black text-white sm:text-2xl">{copy.title}</h2>
            <p className="mt-1 text-sm font-semibold text-zinc-400">{copy.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ShiftCloseAuditLayout
          report={report}
          totals={totals}
          shift={shift}
          expectedDrawer={expectedDrawer}
          difference={difference}
          actualDrawerAmount={actualDrawerAmount}
          onActualDrawerChange={onActualDrawerChange}
          closingNotes={closingNotes}
          onClosingNotesChange={onClosingNotesChange}
          varianceReason={varianceReason}
          onVarianceReasonChange={onVarianceReasonChange}
          onPrint={onPrint}
          onCancel={onCancel}
          onConfirm={() => setConfirmClose(true)}
          submitting={submitting}
          copy={copy}
          labels={labels}
          paymentWarnings={paymentWarnings}
          shiftDuration={shiftDuration}
          totalSoldItems={totalSoldItems}
          varianceState={varianceState}
          VarianceIcon={VarianceIcon}
        />

        {confirmClose ? (
          <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
            <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl shadow-black/60">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${difference === 0 ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-amber-300/25 bg-amber-400/10 text-amber-100"}`}>
                {difference === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {difference === 0 ? copy.closeReady : copy.varianceDetected}
              </div>
              <h3 className="mt-4 text-2xl font-black">{copy.finalConfirm}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-400">{copy.finalConfirmHelp}</p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-zinc-400">Expected</span>
                  <span className="font-black">{formatCurrency(expectedDrawer)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-zinc-400">Actual</span>
                  <span className="font-black">{formatCurrency(Number(actualDrawerAmount || 0))}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-zinc-400">Variance</span>
                  <span className={difference === 0 ? "font-black text-emerald-200" : "font-black text-amber-200"}>{formatCurrency(difference)}</span>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmClose(false)} disabled={submitting} className="h-11 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-zinc-200 disabled:opacity-50">
                  {labels.cancel}
                </button>
                <button type="button" onClick={onConfirm} disabled={submitting} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-400 text-sm font-black text-zinc-950 disabled:opacity-50">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {copy.confirmClose}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ShiftCloseAuditLayout({
  report,
  totals,
  shift,
  expectedDrawer,
  difference,
  actualDrawerAmount,
  onActualDrawerChange,
  closingNotes,
  onClosingNotesChange,
  varianceReason,
  onVarianceReasonChange,
  onPrint,
  onCancel,
  onConfirm,
  submitting,
  copy,
  labels,
  paymentWarnings,
  shiftDuration,
  totalSoldItems,
  varianceState,
  VarianceIcon,
}) {
  const sellerPerformance = Array.isArray(getShiftSellerPerformance(report)) ? getShiftSellerPerformance(report) : [];
  const safeShiftDuration = shiftDuration || report?.shift_duration || report?.duration || "-";
  return (
    <>
      <section className={`mt-5 rounded-[24px] border p-4 ${varianceState.className}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-black/25">
              <VarianceIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xl font-black">{varianceState.title}</div>
              <div className="mt-0.5 text-sm font-semibold opacity-80">{varianceState.help}</div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-end">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-60">Variance</div>
            <div className="mt-1 text-2xl font-black">{formatCurrency(difference)}</div>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{labels.drawerSummary}</div>
          <div className="mt-3 grid gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{labels.expectedDrawer}</div>
              <div className="mt-2 text-2xl font-black text-white">{formatCurrency(expectedDrawer)}</div>
            </div>
            <label className="block rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-4">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{labels.actualDrawer}</span>
              <input
                type="number"
                value={actualDrawerAmount}
                onChange={(event) => onActualDrawerChange(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-base font-black text-white outline-none transition focus:border-emerald-400/60"
              />
            </label>
            <div className={`rounded-2xl border p-4 ${difference === 0 ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : difference > 0 ? "border-amber-400/25 bg-amber-500/10 text-amber-100" : "border-rose-400/25 bg-rose-500/10 text-rose-100"}`}>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] opacity-70">Variance result</div>
              <div className="mt-2 text-2xl font-black">{formatCurrency(difference)}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ShiftReportItem label="Opening cash" value={formatCurrency(totals.opening_cash ?? shift.opening_cash)} />
              <ShiftReportItem label="Shift duration" value={safeShiftDuration} />
            </div>
          </div>
          {sellerPerformance.length ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{copy.sellerPerformance}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {sellerPerformance.slice(0, 6).map((seller) => (
                  <div key={seller.name} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="truncate text-sm font-black text-white">{seller.name}</div>
                    <div className="mt-1 text-xs font-semibold text-zinc-400">{formatCurrency(seller.total)}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">{Number(seller.count || 0).toLocaleString()} invoices</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-4 grid gap-3">
            <label className={`block rounded-2xl border p-4 ${difference !== 0 ? "border-amber-400/30 bg-amber-500/10" : "border-white/10 bg-black/20"}`}>
              <span className="text-[12px] font-black uppercase tracking-[0.16em] text-zinc-500">{copy.varianceReason}</span>
              <textarea
                value={varianceReason}
                onChange={(event) => onVarianceReasonChange?.(event.target.value)}
                rows={4}
                placeholder="Cash drawer recount issue"
                className="mt-2 min-h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3.5 text-base font-semibold text-white outline-none focus:border-amber-300/50"
              />
            </label>
            <label className="block rounded-2xl border border-white/10 bg-black/20 p-4">
              <span className="text-[12px] font-black uppercase tracking-[0.16em] text-zinc-500">{copy.closingNotes}</span>
              <textarea
                value={closingNotes}
                onChange={(event) => onClosingNotesChange?.(event.target.value)}
                rows={4}
                placeholder="Terminal pending settlement"
                className="mt-2 min-h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3.5 text-base font-semibold text-white outline-none focus:border-emerald-300/50"
              />
            </label>
          </div>
        </section>

        <section className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">ملخص المراجعة</div>
              <div className="mt-1 text-sm font-semibold text-zinc-400">{shift.cashier_name || ""} / {shift.branch_name || ""}</div>
            </div>
            <button
              type="button"
              onClick={() => onPrint?.({ ...(report || {}), totals: { ...totals, closing_cash: Number(actualDrawerAmount || 0), cash_difference: difference } })}
              disabled={submitting}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 text-xs font-black text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              <ReceiptText className="h-3.5 w-3.5" />
              Print
            </button>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.08fr_1.08fr_0.88fr]">
            <AccountingLedgerSection title="ملخص الكاش" accent="amber">
              <AccountingLedgerRow label="مبيعات نقدية" value={formatCurrency(totals.cash || 0)} />
              <AccountingLedgerRow label="مرتجعات نقدية" value={formatCurrency(totals.returns || 0)} />
              <AccountingLedgerRow label="مصروفات نقدية" value={formatCurrency(Number(totals.pos_expenses_cash || 0) + Number(totals.employee_advances_cash || 0))} />
              <AccountingLedgerRow label="صافي الدرج المتوقع" value={formatCurrency(totals.net_cash_expected ?? totals.expected_cash ?? shift.expected_cash)} strong highlight />
            </AccountingLedgerSection>

            <AccountingLedgerSection title="وسائل الدفع" accent="emerald">
              <AccountingLedgerRow label="بطاقات" value={formatCurrency(totals.card || 0)} />
              <AccountingLedgerRow label="محفظة" value={formatCurrency(totals.wallet || 0)} />
              <AccountingLedgerRow label="InstaPay" value={formatCurrency(totals.wallet || 0)} />
              <AccountingLedgerRow label="Vodafone Cash" value={formatCurrency(0)} />
            </AccountingLedgerSection>

            <AccountingLedgerSection title="النشاط" accent="cyan">
              <AccountingLedgerRow label="عدد الفواتير" value={Number(totals.invoice_count || 0).toLocaleString()} />
            <AccountingLedgerRow label="الخصومات" value={formatCurrency(totals.discounts || 0)} />
            <AccountingLedgerRow label="سلف الموظفين" value={formatCurrency(totals.employee_advances || 0)} />
            <AccountingLedgerRow label="مدة الشيفت" value={safeShiftDuration} />
          </AccountingLedgerSection>
          </div>
          <div className={`mt-4 rounded-2xl border p-4 ${paymentWarnings.length ? "border-amber-400/25 bg-amber-500/10 text-amber-100" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"}`}>
            <div className="flex items-center gap-2 text-sm font-black">
              {paymentWarnings.length ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {paymentWarnings.length ? copy.paymentsNeedReview : copy.paymentsReconciled}
            </div>
            {paymentWarnings.length ? (
              <div className="mt-2 space-y-1 text-xs font-semibold opacity-85">
                {paymentWarnings.map((warning, index) => <div key={`${warning}-${index}`}>{warning}</div>)}
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Top products</div>
              <div className="space-y-2">
                {(report?.top_products || []).slice(0, 5).map((item) => (
                  <div key={item.product_name} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 text-xs font-semibold text-zinc-300">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40">
                      {getTopProductImageUrl(item) ? (
                        <img
                          src={getTopProductImageUrl(item)}
                          alt={item.product_name || "Product"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-zinc-600" />
                      )}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black leading-5 text-white">{item.product_name}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-500">
                        {Number(item.quantity || 0).toLocaleString()} sales • {totalSoldItems > 0 ? Math.round((Number(item.quantity || 0) / totalSoldItems) * 100) : 0}%
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-right text-sm font-black text-white">{formatCurrency(item.total || 0)}</span>
                  </div>
                ))}
                {!(report?.top_products || []).length ? <div className="text-xs text-zinc-500">No products</div> : null}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Audit timeline</div>
              <div className="max-h-44 space-y-2 overflow-auto pr-1">
                {(report?.audit_timeline || []).slice(-12).map((item, index) => (
                  <div key={`${item.type}-${item.source_id}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-300">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-white">{readableAuditAction(item)}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{auditReference(item) || item.label || ""}</span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-white">{formatCurrency(item.amount || 0)}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-500">{item.at ? new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span>
                    </span>
                  </div>
                ))}
                {!(report?.audit_timeline || []).length ? <div className="text-xs text-zinc-500">No events</div> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="sticky bottom-0 z-20 mt-4 rounded-2xl border border-white/10 bg-zinc-950/95 p-3 shadow-2xl shadow-black/30 backdrop-blur">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={() => onPrint?.({ ...(report || {}), totals: { ...totals, closing_cash: Number(actualDrawerAmount || 0), cash_difference: difference } })}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 text-sm font-black text-emerald-100 transition hover:bg-emerald-400/15 disabled:opacity-50"
          >
            <ReceiptText className="h-4 w-4" />
            {copy.printReport}
          </button>
          <button
            type="button"
            onClick={() => {
              const nextValue = String(expectedDrawer);
              onActualDrawerChange?.(nextValue);
            }}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 text-sm font-black text-cyan-100 transition hover:bg-cyan-400/15 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            {copy.refreshActualDrawer}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 text-sm font-black text-zinc-950 transition hover:bg-emerald-300 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {copy.finalizeShiftClose}
          </button>
        </div>
      </div>
    </>
  );
}

function ShiftReportModal({ report, onClose, onPrint }) {
  const totals = report?.totals || {};
  const shift = report?.shift || {};
  const expectedCash = Number(totals.net_cash_expected ?? totals.expected_cash ?? shift.expected_cash ?? report?.expectedDrawer ?? 0);
  const actualCashRaw = totals.closing_cash ?? report?.actual_cash ?? shift.closing_cash ?? shift.actual_cash ?? report?.actualDrawerAmount;
  const actualCash = actualCashRaw === null || actualCashRaw === undefined || actualCashRaw === "" ? null : Number(actualCashRaw);
  const varianceRaw = totals.cash_difference ?? shift.cash_difference ?? (actualCash === null ? null : actualCash - expectedCash);
  const variance = varianceRaw === null || varianceRaw === undefined || Number.isNaN(Number(varianceRaw)) ? 0 : Number(varianceRaw);
  const invoiceCount = Number(totals.invoice_count || 0);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div dir="rtl" className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">إغلاق وردية</div>
            <h2 className="mt-1 text-2xl font-black text-white">تم إغلاق الوردية بنجاح</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => onPrint?.(report)} className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm font-bold text-emerald-100">
              طباعة التقرير
            </button>
            <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300">
              إغلاق
            </button>
          </div>
        </div>
        <div className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-black text-emerald-100">
            تم إغلاق الوردية بنجاح
          </div>
          <div className="space-y-2 text-sm text-zinc-200">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
              <span className="font-semibold text-zinc-400">صافي الدرج المتوقع</span>
              <span className="font-black text-white">{formatCurrency(expectedCash)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
              <span className="font-semibold text-zinc-400">العد الفعلي</span>
              <span className="font-black text-white">{actualCash === null ? "-" : formatCurrency(actualCash)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
              <span className="font-semibold text-zinc-400">الفرق</span>
              <span className={variance === 0 ? "font-black text-emerald-200" : variance > 0 ? "font-black text-amber-200" : "font-black text-rose-200"}>
                {variance === 0 ? "✅ متوازن" : variance > 0 ? `✅ زيادة: ${formatCurrency(Math.abs(variance))}` : `⚠️ عجز: ${formatCurrency(Math.abs(variance))}`}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
              <span className="font-semibold text-zinc-400">عدد الفواتير</span>
              <span className="font-black text-white">{invoiceCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PosCameraScannerModal({ onClose, onScan, onPermissionDenied, onUnsupported, onError }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex items-end justify-center bg-black/80 p-2 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex w-full max-w-md min-w-0 flex-col overflow-hidden rounded-t-3xl border border-emerald-400/20 bg-slate-950 shadow-2xl shadow-black/70 sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-camera-scanner-title"
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">POS SCANNER</div>
            <h3 id="pos-camera-scanner-title" className="mt-1 text-lg font-black text-white">امسح الباركود أو QR بالكاميرا</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-500">وجّه الكاميرا نحو الباركود أو QR الخاص بالمنتج وسيتم التنفيذ مباشرة.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08]"
            aria-label="إغلاق ماسح الكاميرا"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/60 p-3">
            <BarcodeScanner
              onScan={onScan}
              onPermissionDenied={onPermissionDenied}
              onUnsupported={onUnsupported}
              onError={onError}
              className="overflow-hidden rounded-[1.35rem] bg-black"
              scannerClassName="min-h-[320px]"
            />
          </div>
          <div className="mt-3 text-center text-xs font-semibold text-zinc-500">
            يدعم باركود المنتج و QR الخاص بمنتجات الـ POS.
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function QuickExpenseModal({ value, onChange, onClose, onSave, saving, branchName, shiftId, employees = [] }) {
  const isEmployeeAdvance = value.category === "employee_advance";
  const expenseOptions = useMemo(() => [...quickExpenseCategories, quickExpenseEmployeeAdvanceOption], []);
  const employeeOptions = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(employees) ? employees : [])
      .map((employee) => {
        const id = String(employee.employee_id || employee.id || "");
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return {
          id,
          name: employee.pos_alias || employee.name || employee.full_name || employee.employee_name || employee.email || `Employee #${id}`,
        };
      })
      .filter(Boolean);
  }, [employees]);
  const update = (field, nextValue) => onChange((prev) => {
    const next = { ...prev, [field]: nextValue };
    if (field === "category" && nextValue !== "employee_advance") next.employee_id = "";
    return next;
  });
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center">
      <section className="w-full max-w-sm rounded-3xl border border-amber-300/20 bg-zinc-950 p-4 text-white shadow-2xl shadow-black/60" dir="auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">POS EXPENSE</div>
            <h3 className="mt-1 text-xl font-black">مصروف / Expense</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-500">
              {branchName || "الفرع الحالي"} {shiftId ? `#${shiftId}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50">
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Type</div>
            <select
              value={value.category}
              onChange={(event) => update("category", event.target.value)}
              className="h-11 w-full rounded-2xl border border-white/10 bg-black/70 px-3 text-sm font-black text-white outline-none focus:border-amber-300/50"
            >
              {expenseOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          {isEmployeeAdvance ? (
            <label className="block">
              <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Employee</div>
              <select
                value={value.employee_id || ""}
                onChange={(event) => update("employee_id", event.target.value)}
                className="h-11 w-full rounded-2xl border border-white/10 bg-black/70 px-3 text-sm font-black text-white outline-none focus:border-amber-300/50"
              >
                <option value="">Select employee</option>
                {employeeOptions.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Amount</div>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={value.amount}
              onChange={(event) => update("amount", event.target.value)}
              autoFocus
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/70 px-4 text-lg font-black tabular-nums text-white outline-none placeholder:text-zinc-600 focus:border-amber-300/50"
              placeholder="0.00"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            {["cash", "card", "wallet"].map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => update("payment_method", method)}
                className={`h-10 rounded-2xl border text-xs font-black capitalize transition ${value.payment_method === method ? "border-amber-300/40 bg-amber-300/20 text-amber-50" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"}`}
              >
                {method}
              </button>
            ))}
          </div>

          <label className="block">
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Notes</div>
            <textarea
              rows={3}
              value={value.notes}
              onChange={(event) => update("notes", event.target.value)}
              className="w-full resize-none rounded-2xl border border-white/10 bg-black/70 px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-amber-300/50"
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="h-11 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-zinc-200 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-amber-300 text-sm font-black text-zinc-950 transition hover:bg-amber-200 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
            Save
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ShiftReportItem({ label, value, subtitle = "" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-2 text-lg font-black text-white"><CurrencyText value={value} /></div>
      {subtitle ? <div className="mt-1 text-[11px] font-semibold text-zinc-500">{subtitle}</div> : null}
    </div>
  );
}

function AccountingLedgerSection({ title, accent = "amber", children }) {
  const accents = {
    amber: "border-amber-300/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] shadow-[0_18px_42px_rgba(0,0,0,0.16)]",
    emerald: "border-emerald-300/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] shadow-[0_18px_42px_rgba(0,0,0,0.16)]",
    cyan: "border-cyan-300/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] shadow-[0_18px_42px_rgba(0,0,0,0.16)]",
  };
  const accentLabel = {
    amber: "text-amber-200",
    emerald: "text-emerald-200",
    cyan: "text-cyan-200",
  };
  return (
    <section className={`rounded-[24px] border px-4 py-4 ${accents[accent] || accents.amber}`}>
      <div className={`text-[11px] font-black uppercase tracking-[0.18em] ${accentLabel[accent] || accentLabel.amber}`}>{title}</div>
      <div className="mt-3 divide-y divide-white/8 overflow-hidden rounded-[20px] border border-white/10 bg-black/18">
        {children}
      </div>
    </section>
  );
}

function AccountingLedgerRow({ label, value, subtitle = "", strong = false, highlight = false }) {
  return (
    <div className={`flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-5 ${highlight ? "bg-amber-400/10" : "bg-transparent"}`}>
      <div className="min-w-0 flex-1">
        <div className={`whitespace-normal break-words text-[12px] font-black leading-5 tracking-[0.08em] ${highlight ? "text-amber-100" : "text-zinc-500"}`}>{label}</div>
        {subtitle ? <div className="mt-1 text-[11px] font-semibold leading-4 text-zinc-500">{subtitle}</div> : null}
      </div>
      <div className={`shrink-0 text-end font-black leading-none tabular-nums ${highlight ? "text-[1.45rem] text-amber-50" : strong ? "text-xl text-white" : "text-[1.08rem] text-white"}`}>
        <CurrencyText value={value} />
      </div>
    </div>
  );
}

function SmallCard({ label, value, compact = false, className = "" }) {
  return (
    <div className={`${compact ? "rounded-full px-2.5 py-1 sm:rounded-2xl sm:px-3 sm:py-3" : "rounded-2xl px-3 py-3"} border border-white/10 bg-black/20 ${className}`}>
      <div className={`${compact ? "inline text-[10px] tracking-normal sm:block sm:uppercase sm:tracking-[0.18em]" : "text-[10px] uppercase tracking-[0.18em]"} text-zinc-500`}>{label}</div>
      <div className={`${compact ? "ml-1 inline truncate text-xs sm:ml-0 sm:mt-1 sm:block sm:text-sm" : "mt-1 truncate text-sm"} font-semibold text-white`}><CurrencyText value={value} /></div>
    </div>
  );
}

export default POSPro;
