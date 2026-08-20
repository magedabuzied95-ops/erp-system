import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  ExternalLink,
  MessageCircle,
  Phone,
  Printer,
  RefreshCcw,
  Save,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import {
  formatShippingPaymentMethodLabel,
  getShippingProofRawValue,
  isInvalidShippingProofUrl,
  resolveShippingProofImageUrl,
} from "../../../shared/lib/imageUrls";
import { DEFAULT_PRODUCT_PLACEHOLDER, resolveInvoiceItemImageUrl } from "../../../shared/lib/invoiceItemImages";
import {
  buildWhatsappDeepLink,
  isValidWhatsappPhone,
  normalizePhoneNumber,
} from "../../../shared/utils/whatsapp.js";
import { buildOrderInvoiceWhatsappText, normalizeOrderInvoiceData } from "../../../shared/utils/orderInvoice";
import OrdersShell from "../components/OrdersShell";
import "./OrderDetails.css";
import StatusBadge from "../components/StatusBadge";
import AiInboxOrderLink from "../components/AiInboxOrderLink.jsx";
import OrderInvoiceCard from "../../../shared/components/invoices/OrderInvoiceCard";
import { CurrencyText } from "../../../shared/components/CurrencyAmount";
import { formatOrderPaymentMethods } from "../../../../shared/paymentMethods";
import {
  buildTimeline,
  formatCurrency,
  formatDateTime,
  normalizeOrder,
  ORDER_STATUSES,
  SHIPPING_STATUSES,
  upsertOrderMeta,
} from "../lib/ordersStore";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

const BOSTA_SUBSCRIPTION_REQUIRED_CODE = "BOSTA_SUBSCRIPTION_REQUIRED";
// Resolved at call time, not import time, so it follows a language change.
const bostaSubscriptionRequiredMessage = () => tt("orders.shipping.bostaPlanRequired");

const getAttributionLabel = (order = {}) => {
  const source = String(order.attribution_type || order.marketing_source || "").toLowerCase();
  const platform = String(order.marketing_platform || order.marketing_source || "").toLowerCase();
  if (source.includes("instagram") && source.includes("story")) return tt("orders.channels.instagramStory");
  if (source.includes("story")) return tt("orders.channels.story");
  if (platform === "facebook" || source.includes("facebook")) return tt("orders.channels.facebookPost");
  if (platform === "instagram" || source.includes("instagram")) return tt("orders.channels.instagramPost");
  if (platform === "whatsapp" || source.includes("whatsapp")) return tt("orders.channels.whatsappCampaign");
  if (platform === "tiktok" || source.includes("tiktok")) return tt("orders.channels.tiktokCampaign");
  if (order.marketing_campaign) return String(order.marketing_campaign);
  return "";
};

const whatsappConfirmationBadge = (order = {}) => {
  if (order.whatsapp_cancelled_at) {
    return {
      label: tt("orders.whatsapp.cancelled"),
      className: "border-rose-400/25 bg-rose-400/10 text-rose-200",
    };
  }
  if (order.whatsapp_confirmed_at) {
    return {
      label: tt("orders.whatsapp.confirmed"),
      className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    };
  }
  if (order.whatsapp_confirmation_sent_at && String(order.status || "").toLowerCase() === "pending_confirmation") {
    return {
      label: tt("orders.whatsapp.awaitingConfirmation"),
      className: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    };
  }
  if (order.whatsapp_payment_review_sent_at) {
    return {
      label: tt("orders.whatsapp.paymentReviewSent"),
      className: "border-primary/25 bg-primary/10 text-primary",
    };
  }
  return null;
};

const invoiceWhatsappBadge = (order = {}) => {
  if (!order.whatsapp_invoice_sent_at) return null;
  return {
    label: tt("orders.whatsapp.invoiceSent"),
    className: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  };
};

const shipmentWhatsappBadges = (order = {}) => [
  order.whatsapp_shipment_created_sent_at
    ? { label: tt("orders.whatsapp.shipmentSent"), className: "border-primary/25 bg-primary/10 text-primary" }
    : null,
  order.whatsapp_shipped_sent_at
    ? { label: tt("orders.whatsapp.shippingNotified"), className: "border-primary/25 bg-primary/10 text-primary" }
    : null,
  order.whatsapp_out_for_delivery_sent_at
    ? { label: tt("orders.whatsapp.outForDeliveryNotified"), className: "border-amber-400/25 bg-amber-400/10 text-amber-200" }
    : null,
  order.whatsapp_delivered_sent_at
    ? { label: tt("orders.whatsapp.deliveryNotified"), className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" }
    : null,
].filter(Boolean);

const PACKING_CHECKLIST_ITEMS = [
  { key: "productChecked", labelKey: "orders.details.checkProduct" },
  { key: "sizeChecked", labelKey: "orders.details.checkSize" },
  { key: "colorChecked", labelKey: "orders.details.checkColor" },
  { key: "invoiceIncluded", labelKey: "orders.details.checkInvoice" },
  { key: "packageReady", labelKey: "orders.details.checkPackage" },
];

const ORDER_DETAILS_DEBUG = String(import.meta.env.VITE_ERP_PERF_DEBUG || "").trim().toLowerCase() === "true";
const emptyPackingChecklist = PACKING_CHECKLIST_ITEMS.reduce((acc, item) => ({ ...acc, [item.key]: false }), {});

const getChecklistStorageKey = (orderId) => `erp.order.${orderId}.packingChecklist`;

const readPackingChecklist = (orderId) => {
  if (typeof window === "undefined" || !orderId) return emptyPackingChecklist;
  try {
    const raw = window.localStorage.getItem(getChecklistStorageKey(orderId));
    return raw ? { ...emptyPackingChecklist, ...JSON.parse(raw) } : emptyPackingChecklist;
  } catch {
    return emptyPackingChecklist;
  }
};

const writePackingChecklist = (orderId, value) => {
  if (typeof window === "undefined" || !orderId) return;
  window.localStorage.setItem(getChecklistStorageKey(orderId), JSON.stringify(value));
};

const normalizeComparable = (value) => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
const normalizeShippingProviderKey = (value) => normalizeComparable(value).replace(/\s+/g, "_");
const isBostaShippingProvider = (value) => normalizeShippingProviderKey(value) === "bosta";
const supportedShippingProviders = ["bosta", "mylerz", "shipblu", "in_store_delivery"];
const resolveShippingProviderKey = (value) => {
  const normalized = normalizeShippingProviderKey(value);
  return supportedShippingProviders.includes(normalized) ? normalized : "bosta";
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
const asList = (value) => Array.isArray(value) ? value : [];
const shippingLocationId = (item = {}) => String(item.id || item.provider_city_id || item.provider_zone_id || item.provider_district_id || "").trim();
const shippingLocationLabel = (item = {}) => String(item.name_ar || item.name_en || item.name || item.city_name_ar || item.zone_name_ar || item.district_name_ar || "").trim();

const resolveOrderExperience = (order = {}) => {
  const source = normalizeComparable(firstValue(order.source, order.channel, order.order_source, order.sale_channel));
  const fulfillment = normalizeComparable(firstValue(
    order.fulfillment_method,
    order.fulfillment_type,
    order.delivery_method,
    order.order_type,
  ));
  const pickupRequested = ["pickup", "store pickup", "branch pickup", tt("inventory.transfers.receiveFromBranch")]
    .some((value) => fulfillment.includes(value));
  const shippingRequested = ["shipping", "delivery", "courier", tt("orders.bulk.ship"), tt("orders.shipping.delivery")]
    .some((value) => fulfillment.includes(value));
  const websiteOrder = ["website", "storefront", "online", "web"]
    .some((value) => source === value || source.includes(value));
  const posOrder = ["pos", "point of sale", tt("orders.sources.pos")]
    .some((value) => source === value || source.includes(value));
  const hasShippingData = Boolean(
    order.customer_address ||
    order.shipping_address_line ||
    order.governorate ||
    order.city_area ||
    order.shipping_tracking_number ||
    order.tracking_number ||
    order.shipment_id ||
    Number(order.shipping_fee || order.delivery_fee || order.shipping_cost || 0) > 0 ||
    !["", "manual", "in store delivery", "in_store_delivery"].includes(normalizeComparable(order.shipping_provider))
  );

  if (pickupRequested) return { mode: "pickup", label: tt("inventory.transfers.receiveFromBranch"), requiresShipping: false, isPos: false };
  if (shippingRequested || websiteOrder || hasShippingData) {
    return { mode: "shipping", label: websiteOrder ? tt("orders.sources.onlineShipping") : tt("orders.sources.shippingOrder"), requiresShipping: true, isPos: false };
  }
  if (posOrder || !source) return { mode: "pos", label: tt("orders.sources.directPos"), requiresShipping: false, isPos: true };
  return { mode: "direct", label: tt("orders.sources.directInvoice"), requiresShipping: false, isPos: false };
};

const toMoneyNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const getOrderItemUnitPrice = (item = {}) => {
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
    item.final_price,
    item.finalPrice,
    item.storefront_price,
    item.storefrontPrice,
  ];

  const numbers = candidates
    .filter((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim() !== "")
    .map((candidate) => Number(candidate))
    .filter((number) => Number.isFinite(number));
  return numbers.find((number) => number > 0) ?? numbers[0] ?? 0;
};

const getOrderItemQuantity = (item = {}) => {
  const quantity = Number(item.quantity || item.qty || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const getOrderItemLineTotal = (item = {}) => {
  const qty = getOrderItemQuantity(item);
  const unitPrice = getOrderItemUnitPrice(item);
  const candidates = [item.line_total, item.lineTotal, item.total, item.subtotal, item.item_total, item.total_amount];
  const numbers = candidates
    .filter((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim() !== "")
    .map((candidate) => Number(candidate))
    .filter((number) => Number.isFinite(number));
  return numbers.find((number) => number > 0) ?? unitPrice * qty;
};

const isDamiettaOrder = (order = {}) => {
  const location = [
    order.governorate,
    order.city_area,
    order.customer_address,
  ].join(" ");
  return /damietta|دمياط/i.test(location);
};

const isShippingConfirmationMethod = (value = "") => {
  const normalized = normalizeComparable(value);
  return normalized.includes("shipping confirmation") ||
    normalized.includes("shipping paid") ||
    normalized.includes("shipping prepaid") ||
    normalized.includes("instapay") ||
    normalized.includes("vodafone") ||
    normalized.includes("wallet");
};

const hasPrepaidShipping = (order = {}) => {
  const paymentStatus = normalizeComparable(firstValue(order.payment_status, order.paymentStatus, ""));
  const transferStatus = normalizeComparable(order.transfer_proof_status);
  const shippingMethod = firstValue(order.shipping_payment_method, order.payment_method, "");
  const hasProof = Boolean(order.shipping_payment_screenshot) || Boolean(order.shipping_payment_verified_at);
  const shippingMethodConfirms = isShippingConfirmationMethod(shippingMethod);
  const statusConfirmsShipping = ["shipping paid", "shipping_paid"].includes(paymentStatus) ||
    ["approved", "confirmed", "paid"].includes(transferStatus) ||
    ((["confirmed", "approved", "paid"].includes(paymentStatus)) && (hasProof || shippingMethodConfirms));
  return !isDamiettaOrder(order) && (
    hasProof ||
    shippingMethodConfirms ||
    statusConfirmsShipping
  );
};

const buildOrderFinancials = (order = {}, items = []) => {
  const itemSubtotal = items.reduce((sum, item) => sum + getOrderItemLineTotal(item), 0);
  const itemDiscount = items.reduce((sum, item) => sum + toMoneyNumber(item.discount_amount || item.lineDiscount) * toMoneyNumber(item.quantity || 1), 0);
  const subtotal = toMoneyNumber(firstValue(order.subtotal, order.sub_total), itemSubtotal) || itemSubtotal;
  const discount = toMoneyNumber(firstValue(order.discount_amount, order.invoice_discount, order.discount), 0) || itemDiscount;
  const shipping = toMoneyNumber(firstValue(order.shipping_fee, order.delivery_fee, order.service_fee), 0);
  const backendTotal = toMoneyNumber(firstValue(order.total_amount, order.total_price, order.total), 0);
  const productTotal = Math.max(0, subtotal - discount);
  const grandTotal = backendTotal || Math.max(0, productTotal + shipping);
  const shippingPaidSeparately = hasPrepaidShipping(order) && shipping > 0;
  const paidAmount = toMoneyNumber(order.paid_amount, 0);
  const remainingOnDelivery = shippingPaidSeparately ? productTotal : Math.max(0, grandTotal - paidAmount);

  return {
    subtotal,
    discount,
    shipping,
    productTotal,
    grandTotal,
    paidAmount,
    remainingOnDelivery,
    shippingPaidSeparately,
    topDisplayTotal: shippingPaidSeparately ? productTotal : grandTotal,
  };
};

const getItemImageUrl = (item = {}) => {
  const imageUrl = resolveInvoiceItemImageUrl(item, "");
  return imageUrl || DEFAULT_PRODUCT_PLACEHOLDER;
};

const getInventoryQuantity = (item = {}) => {
  const raw = firstValue(
    item.available_stock,
    item.available_quantity,
    item.stock_quantity,
    item.stock,
    item.inventory_quantity,
    item.quantity_available
  );
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const getStockIndicator = (item = {}) => {
  const quantity = getInventoryQuantity(item);
  if (quantity === null) return null;
  if (quantity <= 0) return { labelKey: "orders.details.stockOut", className: "border-rose-500/25 bg-rose-500/10 text-rose-200" };
  if (quantity === 1) return { labelKey: "orders.details.stockLastPiece", className: "border-orange-500/25 bg-orange-500/10 text-orange-200" };
  if (quantity <= 3) return { labelKey: "orders.details.stockLow", className: "border-amber-500/25 bg-amber-500/10 text-amber-200" };
  return { labelKey: "orders.details.stockIn", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" };
};

const getPaymentBadge = (order = {}, fallback = "") => {
  const raw = normalizeComparable(
    firstValue(order.payment_status, order.paymentStatus, order.transfer_proof_status, order.status, fallback)
  );
  if (["partially paid", "partially_paid", "partial"].includes(raw)) {
    return { label: tt("orders.statusLabels.partiallyPaid"), className: "border-amber-500/25 bg-amber-500/10 text-amber-200" };
  }
  if (["paid", "shipping paid", "confirmed", "approved"].includes(raw)) {
    return { label: tt("orders.statusLabels.paid"), className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" };
  }
  if (["awaiting verification", "pending", "unpaid"].includes(raw)) {
    return { label: tt("inventory.transfers.pendingReview"), className: "border-amber-500/25 bg-amber-500/10 text-amber-200" };
  }
  if (raw === "rejected" || raw === "payment rejected") {
    return { label: tt("orders.statusLabels.rejected"), className: "border-rose-500/25 bg-rose-500/10 text-rose-200" };
  }
  if (raw === "refunded") {
    return { label: tt("orders.statusLabels.refunded"), className: "border-purple-500/25 bg-purple-500/10 text-purple-200" };
  }
  return { label: fallback || order.paymentStatus || tt("inventory.transfers.pendingReview"), className: "border-zinc-500/25 bg-zinc-500/10 text-zinc-200" };
};

const buildSmartInsights = (order = {}, items = [], shipping = {}) => {
  const insights = [];
  const total = Number(order.total || order.total_price || 0);
  const paidAmount = Number(order.paid_amount || 0);
  const codAmount = Number(shipping.cod_amount || order.cod_amount || 0);
  const paymentStatus = normalizeComparable(order.paymentStatus || order.payment_status);

  if (Number(order.customer_order_count || order.orders_count || 0) > 1 || order.customer_type === "repeat") {
    insights.push("Repeat customer");
  }
  if (total >= 3000) insights.push("High value order");
  if (paymentStatus === "paid" && paidAmount > 0 && Math.abs(paidAmount - total) > 1) {
    insights.push("Payment amount mismatch");
  }
  if (["shipment created", "out for delivery"].includes(normalizeComparable(shipping.shipping_status)) && !shipping.tracking_number) {
    insights.push("Missing tracking number");
  }
  if (codAmount > 0 && total > 0 && Math.abs(codAmount - total) > 1) {
    insights.push("COD amount mismatch");
  }
  if (items.some((item) => getInventoryQuantity(item) === 0)) {
    insights.push("One or more items are out of stock");
  }

  return insights;
};

function OrderDetails() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const invoiceRef = useRef(null);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pdfFormat, setPdfFormat] = useState("a4");
  const [notes, setNotes] = useState("");
  const [reviewingPayment, setReviewingPayment] = useState(false);
  const [shipping, setShipping] = useState({
    provider: "",
    shipping_status: "pending",
    shipment_status: "pending",
    shipment_id: "",
    tracking_number: "",
    tracking_url: "",
    shipping_city_id: "",
    shipping_zone_id: "",
    shipping_district_id: "",
    shipping_city_name_en: "",
    shipping_city_name_ar: "",
    shipping_zone_name_en: "",
    shipping_zone_name_ar: "",
    shipping_district_name_en: "",
    shipping_district_name_ar: "",
    shipping_provider_delivery_id: "",
    shipping_label_url: "",
    shipping_address_line: "",
    customer_phone: "",
    governorate: "",
    city_area: "",
    landmark: "",
    street_address: "",
    building_number: "",
    floor_number: "",
    apartment_number: "",
    delivery_fee: 0,
    cod_amount: 0,
    courier_notes: "",
  });
  const [bostaActionError, setBostaActionError] = useState(null);
  const [shippingTab, setShippingTab] = useState("shipment");
  const [paymentProofModalOpen, setPaymentProofModalOpen] = useState(false);
  const [paymentProofImageFailed, setPaymentProofImageFailed] = useState(false);
  const [invoicePreviewOpen, setInvoicePreviewOpen] = useState(false);
  const [statusTimelineOpen, setStatusTimelineOpen] = useState(false);
  const [packingChecklist, setPackingChecklist] = useState(emptyPackingChecklist);
  const [shippingSetupOpen, setShippingSetupOpen] = useState(false);
  const [bostaLocations, setBostaLocations] = useState({ cities: [], zones: [], districts: [], loadingCities: false, loadingZones: false, loadingDistricts: false });

  const loadOrder = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await api.get(`/orders/${id}`);
      const merged = normalizeOrder(data.order || data, { items: Array.isArray(data.items) ? data.items : [] });
      setOrder(merged);
      setNotes(merged.notes || "");
      setPackingChecklist(readPackingChecklist(merged.id || id));
      setShipping({
        provider: resolveShippingProviderKey(merged.shipping_provider || merged.shipping_provider_id),
        shipping_status: merged.shipping_status || "pending",
        shipment_status: merged.shipment_status || merged.shipping_status || "pending",
        shipment_id: merged.shipment_id || "",
        tracking_number: merged.shipping_tracking_number || merged.tracking_number || "",
        tracking_url: merged.tracking_url || "",
        shipping_city_id: merged.shipping_city_id || merged.city_id || "",
        shipping_zone_id: merged.shipping_zone_id || "",
        shipping_district_id: merged.shipping_district_id || merged.area_id || "",
        shipping_city_name_en: merged.shipping_city_name_en || "",
        shipping_city_name_ar: merged.shipping_city_name_ar || "",
        shipping_zone_name_en: merged.shipping_zone_name_en || "",
        shipping_zone_name_ar: merged.shipping_zone_name_ar || "",
        shipping_district_name_en: merged.shipping_district_name_en || "",
        shipping_district_name_ar: merged.shipping_district_name_ar || "",
        shipping_provider_delivery_id: merged.shipping_provider_delivery_id || merged.shipment_id || "",
        shipping_label_url: merged.shipping_label_url || "",
        shipping_address_line: merged.shipping_address_line || merged.customer_address || "",
        customer_phone: merged.customer_phone || merged.phone || "",
        governorate: merged.governorate || "",
        city_area: merged.city_area || "",
        landmark: merged.landmark || "",
        street_address: merged.street_address || "",
        building_number: merged.building_number || "",
        floor_number: merged.floor_number || "",
        apartment_number: merged.apartment_number || "",
        delivery_fee: merged.delivery_fee || merged.shipping_fee || 0,
        // Empty means "collect whatever is still owed". Seeding this with 0 would
        // read as a deliberate "collect nothing" the moment it was sent.
        cod_amount: Number(merged.cod_amount || 0) > 0 ? String(merged.cod_amount) : "",
        allow_open_package: merged.allow_open_package === null || merged.allow_open_package === undefined
          ? "inherit"
          : (merged.allow_open_package ? "allow" : "deny"),
        courier_notes: merged.courier_notes || "",
      });
    } catch (err) {
      console.log(err);
      setError(t("orders.details.loadFallback"));
      toast.error(t("orders.details.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOrder();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOrder]);

  useEffect(() => {
    if (!isBostaShippingProvider(shipping.provider)) return undefined;
    let active = true;
    setBostaLocations((current) => ({ ...current, loadingCities: true }));
    api.get("/shipping/cities?provider=bosta&dropoff=1", { suppressErrorStatuses: [404, 500] })
      .then((data) => active && setBostaLocations((current) => ({ ...current, cities: asList(data?.cities) })))
      .catch(() => active && setBostaLocations((current) => ({ ...current, cities: [] })))
      .finally(() => active && setBostaLocations((current) => ({ ...current, loadingCities: false })));
    return () => { active = false; };
  }, [shipping.provider]);

  useEffect(() => {
    if (!isBostaShippingProvider(shipping.provider) || !shipping.shipping_city_id) {
      setBostaLocations((current) => ({ ...current, zones: [], districts: [] }));
      return undefined;
    }
    let active = true;
    setBostaLocations((current) => ({ ...current, loadingZones: true }));
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(shipping.shipping_city_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => active && setBostaLocations((current) => ({ ...current, zones: asList(data?.zones) })))
      .catch(() => active && setBostaLocations((current) => ({ ...current, zones: [], districts: [] })))
      .finally(() => active && setBostaLocations((current) => ({ ...current, loadingZones: false })));
    return () => { active = false; };
  }, [shipping.provider, shipping.shipping_city_id]);

  useEffect(() => {
    if (!isBostaShippingProvider(shipping.provider) || !shipping.shipping_zone_id) {
      setBostaLocations((current) => ({ ...current, districts: [] }));
      return undefined;
    }
    let active = true;
    setBostaLocations((current) => ({ ...current, loadingDistricts: true }));
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(shipping.shipping_zone_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => active && setBostaLocations((current) => ({ ...current, districts: asList(data?.districts) })))
      .catch(() => active && setBostaLocations((current) => ({ ...current, districts: [] })))
      .finally(() => active && setBostaLocations((current) => ({ ...current, loadingDistricts: false })));
    return () => { active = false; };
  }, [shipping.provider, shipping.shipping_zone_id]);

  const previewItems = useMemo(() => {
    if (!order) return [];
    return Array.isArray(order.items) ? order.items : [];
  }, [order]);

  const timeline = useMemo(() => (order ? buildTimeline(order) : []), [order]);
  const paymentStatusValue = String(order?.payment_status || order?.paymentStatus || "").toLowerCase();
  const normalizedPaymentStatusValue = normalizeComparable(order?.payment_status || order?.paymentStatus);
  const isPartiallyPaid = ["partially paid", "partially_paid", "partial"].includes(normalizedPaymentStatusValue);
  const orderStatusValue = String(order?.status || "").toLowerCase();
  const transferProofStatusValue = String(order?.transfer_proof_status || "").toLowerCase();
  const isAwaitingPaymentVerification =
    paymentStatusValue === "awaiting_verification" ||
    orderStatusValue === "awaiting_verification" ||
    transferProofStatusValue === "pending";
  const isShippingPaid =
    ["paid", "shipping_paid", "confirmed", "approved"].includes(paymentStatusValue) ||
    ["confirmed", "paid"].includes(orderStatusValue) ||
    transferProofStatusValue === "approved";
  const isPaymentRejected =
    paymentStatusValue === "rejected" ||
    orderStatusValue === "payment_rejected" ||
    transferProofStatusValue === "rejected";
  const shippingProofValue = getShippingProofRawValue(order || {});
  const paymentReviewVisible =
    isAwaitingPaymentVerification ||
    isPaymentRejected ||
    Boolean(shippingProofValue);
  const shippingProofInvalid = Boolean(shippingProofValue) && isInvalidShippingProofUrl(shippingProofValue);
  const paymentProofUrl = shippingProofInvalid ? "" : resolveShippingProofImageUrl(shippingProofValue);
  const canReviewShippingProof = Boolean(paymentProofUrl);
  const paymentSummaryStatus = (() => {
    if (isPartiallyPaid) return t("orders.statusLabels.partially_paid");
    if (isAwaitingPaymentVerification) return t("orders.details.awaitingTransferReview");
    if (isShippingPaid) return t("orders.payment.confirmed");
    if (isPaymentRejected) return t("orders.details.transferProofRejected");
    if (paymentStatusValue === "cod") return t("orders.statusLabels.cod");
    return order?.paymentStatus === "Paid" ? formatCurrency(0) : t("orders.statusLabels.pending");
  })();
  const paymentReviewBadgeText = isAwaitingPaymentVerification
    ? t("orders.details.awaitingTransferReview")
    : isPartiallyPaid
      ? t("orders.statusLabels.partially_paid")
      : isShippingPaid
      ? t("orders.details.shippingPaymentConfirmed")
      : isPaymentRejected
        ? t("orders.details.transferProofRejected")
        : "";
  const paymentBadge = getPaymentBadge(order || {}, paymentReviewBadgeText || order?.paymentStatus);
  const whatsappBadge = whatsappConfirmationBadge(order || {});
  const invoiceWhatsappBadgeData = invoiceWhatsappBadge(order || {});
  const shipmentWhatsappBadgeData = shipmentWhatsappBadges(order || {});
  const smartInsights = useMemo(() => (order ? buildSmartInsights(order, previewItems, shipping) : []), [order, previewItems, shipping]);
  const bostaCityName = shipping.shipping_city_name_ar || shipping.shipping_city_name_en || order?.shipping_city_name_ar || order?.shipping_city_name_en || order?.city_area || order?.governorate || shipping.shipping_city_id || order?.city_id || "";
  const bostaZoneName = shipping.shipping_zone_name_ar || shipping.shipping_zone_name_en || order?.shipping_zone_name_ar || order?.shipping_zone_name_en || shipping.shipping_zone_id || "";
  const bostaDistrictName = shipping.shipping_district_name_ar || shipping.shipping_district_name_en || order?.shipping_district_name_ar || order?.shipping_district_name_en || shipping.shipping_district_id || order?.area_id || "";
  const financials = useMemo(() => (order ? buildOrderFinancials(order, previewItems) : buildOrderFinancials({}, [])), [order, previewItems]);
  // An empty COD box means the courier collects whatever is still owed; a typed 0 is
  // the operator saying "this one is already paid, collect nothing".
  const codOverrideProvided = String(shipping.cod_amount ?? "").trim() !== "";
  const collectionPreview = codOverrideProvided
    ? Math.max(0, Number(shipping.cod_amount) || 0)
    : financials.remainingOnDelivery;
  const orderExperience = useMemo(() => resolveOrderExperience(order || {}), [order]);
  const requiresShipping = orderExperience.requiresShipping || shippingSetupOpen;
  const normalizedShipmentState = normalizeComparable(shipping.shipment_status || shipping.shipping_status || "pending");
  const hasCreatedShipment = Boolean(shipping.shipment_id || shipping.tracking_number) || !["", "pending", "waiting"].includes(normalizedShipmentState);
  const shipmentDelivered = ["delivered", tt("orders.fulfillment.delivered")].includes(normalizedShipmentState);
  const shipmentInTransit = ["shipped", "out for delivery", "in transit", tt("orders.statusLabels.shipped"), tt("orders.statusLabels.outForDelivery")].includes(normalizedShipmentState);
  const isCodOrder = [
    order?.payment_method,
    order?.payment_status,
    order?.paymentStatus,
    order?.payment_type,
    order?.collection_method,
  ].some((value) => {
    const normalized = normalizeComparable(value);
    return normalized === "cod" ||
      normalized === "cash on delivery" ||
      normalized.includes("cash on delivery") ||
      normalized.includes("الدفع عند الاستلام");
  });
  const hasCodRemaining = (isCodOrder || financials.shippingPaidSeparately) && financials.remainingOnDelivery > 0;
  const customerPhone = order?.customer_phone || order?.phone || "";
  const normalizedCustomerPhone = normalizePhoneNumber(customerPhone);
  const canContactCustomer = isValidWhatsappPhone(normalizedCustomerPhone);
  const packingCompleteCount = PACKING_CHECKLIST_ITEMS.filter((item) => packingChecklist[item.key]).length;

  useEffect(() => {
    setPaymentProofImageFailed(false);
  }, [paymentProofUrl]);

  const saveLocalMeta = (patch) => {
    upsertOrderMeta(id, patch);
    setOrder((prev) => (prev ? normalizeOrder({ ...prev, ...patch }, { items: previewItems }) : prev));
  };

  const handleStatusChange = (status) => {
    saveLocalMeta({ status, timeline: [{ label: `Status set to ${status}`, at: new Date().toISOString() }] });
    toast.success(t("orders.details.markedAs", { status }));
  };

  const handleSaveNotes = () => {
    saveLocalMeta({ notes });
    toast.success(t("orders.details.notesSaved"));
  };

  const handleSaveShipping = async () => {
    const bostaRequiredMissing = isBostaShippingProvider(shipping.provider) && (
      !String(shipping.customer_phone || "").trim() ||
      !shipping.shipping_city_id ||
      !shipping.shipping_zone_id ||
      !shipping.shipping_district_id ||
      !String(shipping.street_address || "").trim() ||
      !String(shipping.building_number || "").trim()
    );
    if (bostaRequiredMissing) {
      toast.error(tt("orders.shipping.completeBostaFields"));
      return false;
    }
    if (shippingSetupOpen && !isBostaShippingProvider(shipping.provider) && (!String(shipping.customer_phone || "").trim() || !String(shipping.shipping_address_line || "").trim())) {
      toast.error(tt("orders.shipping.enterPhoneAndAddress"));
      return false;
    }
    try {
      const payload = {
        source: shippingSetupOpen && orderExperience.isPos ? "manual_shipping" : order.source,
        channel: shippingSetupOpen && orderExperience.isPos ? "manual_shipping" : order.channel,
        customer_phone: shipping.customer_phone,
        customer_address: shipping.street_address || shipping.shipping_address_line,
        governorate: shipping.governorate,
        city_area: shipping.city_area,
        landmark: shipping.landmark,
        shipping_city_id: shipping.shipping_city_id,
        shipping_zone_id: shipping.shipping_zone_id,
        shipping_district_id: shipping.shipping_district_id,
        shipping_address_line: shipping.street_address || shipping.shipping_address_line,
        street_address: shipping.street_address,
        building_number: shipping.building_number,
        floor_number: shipping.floor_number,
        apartment_number: shipping.apartment_number,
        shipping_provider: normalizeShippingProviderKey(shipping.provider),
        shipping_provider_id: normalizeShippingProviderKey(shipping.provider),
        shipping_status: shipping.shipment_status || shipping.shipping_status,
        shipment_status: shipping.shipment_status || shipping.shipping_status,
        shipment_id: shipping.shipment_id,
        tracking_number: shipping.tracking_number,
        tracking_url: shipping.tracking_url,
        shipping_cost: Number(shipping.delivery_fee || 0),
        cod_amount: codOverrideProvided ? Math.max(0, Number(shipping.cod_amount) || 0) : 0,
        allow_open_package: shipping.allow_open_package || "inherit",
        courier_notes: shipping.courier_notes,
        reason: "Shipping details updated",
      };
      const result = await api.patch(`/orders/${order.id}`, payload);
      const updated = normalizeOrder(result.order || { ...order, ...payload }, { items: previewItems });
      setOrder(updated);
      setShippingSetupOpen(false);
      setShipping((prev) => ({
        ...prev,
        shipping_status: updated.shipping_status || payload.shipping_status,
        shipment_status: updated.shipment_status || updated.shipping_status || payload.shipment_status,
      }));
      toast.success(t("orders.details.shippingSaved"));
      return true;
    } catch (err) {
      toast.error(err.message || t("orders.shipping.updateFailed", "Failed to save shipping"));
      return false;
    }
  };

  const handleShipmentAction = async (action) => {
    try {
      const result = await api.post(`/orders/${order.id}/shipment/${action}`, {
        provider: shipping.provider || "manual",
        shipment_id: shipping.shipment_id,
        tracking_number: shipping.tracking_number,
        tracking_url: shipping.tracking_url,
      });
      if (result.success) {
        setShipping((prev) => ({
          ...prev,
          provider: result.provider || prev.provider,
          shipping_status: result.shipping_status || prev.shipping_status,
          shipment_status: result.status || result.shipping_status || prev.shipment_status,
          shipment_id: result.shipment_id || prev.shipment_id,
          tracking_number: result.tracking_number || prev.tracking_number,
          tracking_url: result.tracking_url || prev.tracking_url,
        }));
        setOrder((prev) => (prev ? normalizeOrder({ ...prev, ...(result.order || {}), shipping_status: result.shipping_status || result.status }, { items: previewItems }) : prev));
        toast.success(t(`orders.shipping.${action}Success`, result.message || t("orders.shipping.shipmentUpdated", "Shipment updated")));
      } else {
        toast.error(result.error || result.message || t("orders.shipping.providerNotConfigured"));
      }
    } catch (err) {
      toast.error(err.message || t("orders.shipping.updateFailed", "Failed to update shipment"));
    }
  };

  const handleCreateShipment = async () => {
    if (isBostaShippingProvider(shipping.provider)) {
      const saved = await handleSaveShipping();
      if (saved) await handleBostaAction("create");
      return;
    }
    await handleShipmentAction("create");
  };

  const handleBostaAction = async (action) => {
    try {
      setBostaActionError(null);
      const body = action === "create"
        ? {
            // Sent only when the box was actually filled in — otherwise an untouched
            // field would hand the courier a 0 to collect.
            ...(codOverrideProvided ? { cod_amount: Math.max(0, Number(shipping.cod_amount) || 0) } : {}),
            allow_open_package: shipping.allow_open_package || "inherit",
          }
        : {};
      const result = await api.post(`/orders/${order.id}/shipping/bosta/${action}`, body);
      const updated = normalizeOrder(result.order || order, { items: previewItems });
      setOrder(updated);
      setShipping((prev) => ({
        ...prev,
        provider: "bosta",
        shipping_status: updated.shipping_status || result.status || prev.shipping_status,
        shipment_status: updated.shipment_status || updated.shipping_status || result.status || prev.shipment_status,
        shipment_id: updated.shipment_id || result.shipment_id || prev.shipment_id,
        shipping_provider_delivery_id: updated.shipping_provider_delivery_id || result.provider_delivery_id || prev.shipping_provider_delivery_id,
        tracking_number: updated.shipping_tracking_number || updated.tracking_number || result.tracking_number || prev.tracking_number,
        tracking_url: updated.tracking_url || result.tracking_url || prev.tracking_url,
        shipping_label_url: updated.shipping_label_url || result.label_url || prev.shipping_label_url,
        shipping_address_line: updated.shipping_address_line || prev.shipping_address_line,
        shipping_city_name_en: updated.shipping_city_name_en || prev.shipping_city_name_en,
        shipping_city_name_ar: updated.shipping_city_name_ar || prev.shipping_city_name_ar,
        shipping_zone_name_en: updated.shipping_zone_name_en || prev.shipping_zone_name_en,
        shipping_zone_name_ar: updated.shipping_zone_name_ar || prev.shipping_zone_name_ar,
        shipping_district_name_en: updated.shipping_district_name_en || prev.shipping_district_name_en,
        shipping_district_name_ar: updated.shipping_district_name_ar || prev.shipping_district_name_ar,
        street_address: updated.street_address || prev.street_address,
        building_number: updated.building_number || prev.building_number,
        floor_number: updated.floor_number || prev.floor_number,
        apartment_number: updated.apartment_number || prev.apartment_number,
      }));
      toast.success(result.message || (action === "create" ? "Bosta shipment created" : "Bosta shipment updated"));
    } catch (err) {
      const code = err?.responseBody?.code || err?.responseBody?.details?.errorCode || err?.responseBody?.details?.code || "";
      const message = code === BOSTA_SUBSCRIPTION_REQUIRED_CODE
        ? bostaSubscriptionRequiredMessage()
        : (err?.responseBody?.message || err?.responseBody?.details?.message || err.message || "Bosta shipment action failed");
      setBostaActionError({ code, message });
      toast.error(message);
    }
  };

  const handleShippingPaymentReview = async (action) => {
    try {
      setReviewingPayment(true);
      await api.post(`/orders/${order.id}/${action === "confirm" ? "confirm-payment" : "reject-payment"}`, {});
      toast.success(action === "confirm" ? t("orders.payment.confirmed") : t("orders.payment.rejected"));
      await loadOrder();
    } catch (err) {
      toast.error(err.message || t("orders.payment.updateFailed"));
    } finally {
      setReviewingPayment(false);
    }
  };

  const handleCopyPhone = async () => {
    if (!customerPhone) {
      toast.error(t("orders.fallback.noPhoneRecorded"));
      return;
    }
    try {
      await navigator.clipboard.writeText(customerPhone);
      toast.success(t("orders.details.phoneCopied"));
    } catch {
      toast.error(t("orders.details.copyPhoneFailed"));
    }
  };

  const handleCallCustomer = () => {
    if (!normalizedCustomerPhone) {
      toast.error(t("orders.fallback.noPhoneRecorded"));
      return;
    }
    window.location.href = `tel:${normalizedCustomerPhone}`;
  };

  const handleTogglePackingItem = (key) => {
    const next = { ...packingChecklist, [key]: !packingChecklist[key] };
    setPackingChecklist(next);
    writePackingChecklist(order.id || id, next);
  };

  const handlePrint = () => {
    const node = invoiceRef.current;
    if (!node) return;
    const popup = window.open("", "_blank", "width=900,height=1200");
    if (!popup) {
      toast.error(t("orders.details.popupBlocked"));
      return;
    }
    popup.document.write(`<html><head><title>${order.invoice_number}</title></head><body>${node.innerHTML}</body></html>`);
    popup.document.close();
    popup.print();
    popup.close();
  };

  const handlePdf = async () => {
    const invoice = {
      invoiceNumber: order.invoice_number,
      invoiceLabel: tt("orders.details.invoice"),
      companyName: tt("common.employeeHub.analytics.export.companyName"),
      companyTagline: tt("orders.details.enterpriseOps"),
      customerName: order.customer_name,
      customerPhone: order.customer_phone || "",
      customerEmail: order.customer_email || "",
      customerAddress: order.customer_address || "",
      createdAt: order.created_at || new Date().toISOString(),
      status: order.status,
      payment: {
        paymentStatus: order.paymentStatus,
        paidAmount: Number(order.paid_amount || 0),
        dueAmount: Number(order.due_amount || 0),
        changeAmount: Number(order.change_amount || 0),
        method: formatOrderPaymentMethods(order, i18n.language),
      },
      items: previewItems.map((item) => {
        const unitPrice = getOrderItemUnitPrice(item);
        const lineTotal = getOrderItemLineTotal(item);
        return {
          ...item,
          product_name: item.product_name || item.name,
          color: item.color,
          size: item.size,
          sku: item.sku,
          barcode: item.barcode,
          quantity: item.quantity,
          price: unitPrice,
          unit_price: unitPrice,
          line_total: lineTotal,
          discount_amount: item.discount_amount || item.lineDiscount || 0,
          tax_amount: item.tax_amount || 0,
          total_amount: lineTotal,
        };
      }),
      totals: {
        subtotal: previewItems.reduce((sum, item) => sum + getOrderItemLineTotal(item), 0),
        itemDiscountTotal: previewItems.reduce(
          (sum, item) => sum + Number(item.discount_amount || item.lineDiscount || 0) * Number(item.quantity || 0),
          0
        ),
        invoiceDiscount: Number(order.invoice_discount || 0),
        serviceFee: Number(order.service_fee || 0),
        taxAmount: 0,
        total: Number(order.total || 0),
      },
      qrValue: order.invoice_number,
      barcodeValue: order.invoice_number,
    };

    const { downloadInvoicePdf } = await import("../../../shared/utils/invoicePdf");
    const result = await downloadInvoicePdf({
      format: pdfFormat,
      invoice,
      filename: `${order.invoice_number}.pdf`,
      onFallback: ({ html }) => {
        const popup = window.open("", "_blank", "width=980,height=1200");
        if (!popup) {
          toast.error(t("orders.details.pdfPreviewBlocked"));
          return false;
        }
        popup.document.write(html);
        popup.document.close();
        popup.focus();
        popup.print();
        popup.close();
        return true;
      },
    });

    if (result?.ok) {
      toast.success(t("orders.details.pdfDownloaded"));
    } else if (result?.fallbackOpened) {
      toast.success(t("orders.details.pdfPreviewOpened"));
    } else {
      toast.error(t("orders.details.pdfGenerateFailed"));
    }
  };

  const shareWhatsApp = () => {
    const phone = normalizePhoneNumber(order.customer_phone || order.phone || "");
    const message = buildOrderInvoiceWhatsappText(normalizeOrderInvoiceData(order, previewItems, { storeName: tt("common.employeeHub.analytics.export.companyName") }));
    window.open(buildWhatsappDeepLink({ phone, message }), "_blank", "noopener,noreferrer");
  };

  const notifyCustomer = () => {
    const phone = normalizePhoneNumber(order.customer_phone || order.phone || "");
    if (!isValidWhatsappPhone(phone)) {
      toast.error(t("orders.details.whatsappPhoneRequired"));
      return;
    }

    const message = buildOrderInvoiceWhatsappText(normalizeOrderInvoiceData(order, previewItems, { storeName: tt("common.employeeHub.analytics.export.companyName") }));

    window.open(buildWhatsappDeepLink({ phone, message }), "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <OrdersShell title={t("orders.details.title")} subtitle={t("orders.details.loadingSubtitle")}>
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-10 text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary/20 border-t-blue-400" />
          <p className="mt-4 text-sm text-zinc-400">{t("orders.details.loading")}</p>
        </div>
      </OrdersShell>
    );
  }

  if (error || !order) {
    return (
      <OrdersShell title={t("orders.details.title")} subtitle={t("orders.details.unableSubtitle")}>
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-6 text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error || t("orders.details.notFound")}
          <div className="mt-4">
            <button type="button" onClick={() => navigate("/orders")} className="rounded-[var(--radius-control)] bg-white px-4 py-2 text-sm font-semibold text-black">
              {t("orders.details.backToOrders")}
            </button>
          </div>
        </div>
      </OrdersShell>
    );
  }

  return (
    <OrdersShell
      title={t("orders.details.orderTitle", { invoice: order.invoice_number })}
      subtitle={t("orders.details.subtitle")}
      actions={
        <Link
          to="/orders"
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Link>
      }
    >
      <div className="order-details-theme mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-zinc-100">
                    {order.invoice_number}
                  </span>
                  <AiInboxOrderLink order={order} />
                  {getAttributionLabel(order) ? (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                      {getAttributionLabel(order)}
                    </span>
                  ) : null}
                  <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${requiresShipping ? "border-primary/20 bg-primary/10 text-primary" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"}`}>
                    {shippingSetupOpen ? tt("orders.shipping.setUpForInvoice") : orderExperience.label}
                  </span>
                </div>
                <h2 className="m1-section-title mt-3 text-white">{order.customer_name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200">
                    {customerPhone || t("orders.fallback.noPhoneRecorded")}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("orders.details.copyPhone")}
                  </button>
                  <button
                    type="button"
                    onClick={shareWhatsApp}
                    disabled={!canContactCustomer}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    {t("orders.bulk.whatsapp")}
                  </button>
                  <button
                    type="button"
                    onClick={handleCallCustomer}
                    disabled={!normalizedCustomerPhone}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {t("orders.details.call")}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={order.status} />
                {whatsappBadge ? (
                  <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${whatsappBadge.className}`}>
                    {whatsappBadge.label}
                  </span>
                ) : null}
                {invoiceWhatsappBadgeData ? (
                  <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${invoiceWhatsappBadgeData.className}`}>
                    {invoiceWhatsappBadgeData.label}
                  </span>
                ) : null}
                {requiresShipping ? shipmentWhatsappBadgeData.map((badge) => (
                  <span key={badge.label} className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${badge.className}`}>
                    {badge.label}
                  </span>
                )) : null}
                <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${paymentBadge.className}`}>
                  {paymentBadge.label}
                </span>
              </div>
            </div>

            <div className={`mt-5 grid gap-3 sm:grid-cols-2 ${requiresShipping ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
              <Info label={t("orders.table.invoice")} value={order.invoice_number} />
              <Info label={t("orders.table.total")} value={formatCurrency(financials.topDisplayTotal)} />
              {requiresShipping ? <Info label={t("orders.drawer.shipping")} value={formatCurrency(financials.shipping)} badge={financials.shippingPaidSeparately ? t("orders.statusLabels.paid") : ""} /> : null}
              <Info label={t("orders.table.date")} value={formatDateTime(order.created_at)} />
            </div>
            {(financials.shippingPaidSeparately || hasCodRemaining) ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {financials.shippingPaidSeparately ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-200">
                    {t("orders.details.shippingPaid")}
                  </span>
                ) : null}
                {hasCodRemaining ? (
                  <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-200">
                    {t("orders.details.codRemaining")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {!requiresShipping ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-black text-emerald-100">{tt("orders.sources.directInvoiceHint")}</div>
                <div className="mt-1 text-xs font-semibold text-zinc-400">{tt("orders.sources.directInvoiceActions")}</div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" onClick={() => {
                  setShipping((prev) => ({ ...prev, provider: resolveShippingProviderKey(prev.provider) }));
                  setShippingSetupOpen(true);
                }} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-zinc-950 transition hover:bg-primary">
                  <Truck className="h-4 w-4" />
                  {tt("orders.shipping.addToInvoice")}
                </button>
                <button type="button" onClick={() => setStatusTimelineOpen(true)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10">
                  {tt("orders.details.activityLog")}
                </button>
              </div>
            </div>
          ) : null}

          {requiresShipping && (order.customer_address || order.governorate || order.city_area) ? (
            <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
              <h3 className="m1-section-title text-white">{t("orders.details.shippingData")}</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Info label={t("orders.details.governorate")} value={order.governorate || t("orders.fallback.notAvailable")} />
                <Info label={t("orders.details.cityArea")} value={order.city_area || t("orders.fallback.notAvailable")} />
                {order.landmark ? <Info label={t("orders.details.landmark")} value={order.landmark} /> : null}
                {order.delivery_notes ? <Info label={t("orders.details.deliveryNotes")} value={order.delivery_notes} /> : null}
              </div>
              <div className="mt-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.drawer.address")}</div>
                <div className="mt-2 whitespace-pre-wrap break-words text-base font-semibold leading-7 text-white" dir="auto">
                  {order.customer_address || t("orders.fallback.notAvailable")}
                </div>
              </div>
            </div>
          ) : null}

          {requiresShipping ? <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{t("orders.details.currentStatus", "Current status")}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusBadge value={order.status} />
                    <span className="text-sm font-semibold text-zinc-400">{formatDateTime(order.updated_at || order.created_at)}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={order.status || ""}
                  onChange={(event) => handleStatusChange(event.target.value)}
                  className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white outline-none"
                >
                  {ORDER_STATUSES.map((status) => (
                    <option key={status} value={status} className="bg-zinc-950 text-white">
                      {t(`orders.statusLabels.${normalizeComparable(status).replace(/\s+/g, "_")}`, status)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setStatusTimelineOpen(true)}
                  className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {t("orders.drawer.timeline")}
                </button>
              </div>
            </div>
          </div> : null}

          <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("orders.drawer.items")}</h3>
            <div className="mt-4 space-y-3">
              {previewItems.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
                  {t("orders.details.noLineItems")}
                </div>
              ) : (
                previewItems.map((item, index) => {
                  const imageUrl = getItemImageUrl(item);
                  const stock = getStockIndicator(item);
                  const qty = getOrderItemQuantity(item);
                  const unitPrice = getOrderItemUnitPrice(item);
                  const lineTotal = getOrderItemLineTotal(item);
                  if (ORDER_DETAILS_DEBUG) {
                    console.log("[order-item-price-debug]", {
                      item,
                      resolvedUnitPrice: unitPrice,
                      resolvedLineTotal: lineTotal,
                    });
                  }
                  return (
                    <div key={String(item.id || index)} className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 gap-3">
                          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/5">
                            <img
                              src={imageUrl}
                              alt={item.product_name || item.name || t("orders.fallback.item")}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                e.currentTarget.src = DEFAULT_PRODUCT_PLACEHOLDER;
                              }}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-white">{item.product_name || item.name || t("orders.fallback.item")}</div>
                            <div className="mt-1 text-sm text-zinc-400">
                              {item.color || t("orders.details.defaultVariant")} / {item.size || t("orders.details.oneSize")} - {t("orders.details.sku")} {item.sku || t("orders.fallback.notAvailable")}
                            </div>
                            {stock ? (
                              <div className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${stock.className}`}>
                                {t(stock.labelKey)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <MiniStat label={t("orders.drawer.qty")} value={qty} />
                          <MiniStat label={t("orders.edit.price")} value={formatCurrency(unitPrice)} />
                          <MiniStat label={t("orders.details.line")} value={formatCurrency(lineTotal)} />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("orders.drawer.notes")}</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder={t("orders.details.notesPlaceholder")}
              className="mt-4 w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleSaveNotes}
                className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-black"
              >
                <Save className="h-4 w-4" />
                {t("orders.details.saveNotes")}
              </button>
            </div>
          </div>

        </div>

        <div className="space-y-4 xl:col-span-4">
          {requiresShipping ? <details className="group rounded-2xl border border-white/10 bg-zinc-950/90 p-4 shadow-xl shadow-black/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{t("orders.details.packing")}</div>
                <h3 className="m1-section-title mt-1 truncate text-white">{t("orders.details.staffChecklist")}</h3>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
                {packingCompleteCount}/{PACKING_CHECKLIST_ITEMS.length}
              </span>
            </summary>
            <div className="mt-3 space-y-2">
              {PACKING_CHECKLIST_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleTogglePackingItem(item.key)}
                  className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-left text-sm font-semibold transition ${ packingChecklist[item.key] ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10" }`}
                >
                  <span>{t(item.labelKey)}</span>
                  <span className={`grid h-6 w-6 place-items-center rounded-full border ${ packingChecklist[item.key] ? "border-emerald-300/50 bg-emerald-400/20" : "border-white/15 bg-black/20" }`}>
                    {packingChecklist[item.key] ? <Check className="h-4 w-4" /> : null}
                  </span>
                </button>
              ))}
            </div>
          </details> : null}

          {smartInsights.length ? (
            <div className="rounded-2xl border border-primary/20 bg-primary/10 p-5 shadow-xl shadow-black/10">
              <div className="text-[11px] uppercase tracking-[0.2em] text-primary">{t("orders.details.smartInsights")}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {smartInsights.map((insight) => (
                  <span key={insight} className="rounded-full border border-primary/20 bg-black/20 px-3 py-1.5 text-xs font-semibold text-primary">
                    {t(`orders.details.insights.${insight}`, insight)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {paymentReviewVisible ? (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-5 shadow-xl shadow-black/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-amber-300">{t("orders.payment.proof")}</div>
                  <h3 className="m1-section-title mt-2 text-white">{t("orders.details.reviewTransferProof")}</h3>
                </div>
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${paymentBadge.className}`}>
                  {paymentBadge.label}
                </span>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/70">
                {shippingProofInvalid ? (
                  <div className="grid min-h-64 place-items-center px-4 py-10 text-center text-sm font-semibold text-rose-200">
                    <div>
                      <div>{t("orders.payment.invalidProof")}</div>
                      <div className="mt-3 max-w-full break-all rounded-xl border border-rose-400/20 bg-black/30 p-3 text-xs font-mono text-rose-100">{shippingProofValue}</div>
                    </div>
                  </div>
                ) : paymentProofUrl && !paymentProofImageFailed ? (
                  <div className="p-4">
                    <button
                      type="button"
                      onClick={() => setPaymentProofModalOpen(true)}
                      className="group block w-full overflow-hidden rounded-[var(--radius-control)] border border-white/10 bg-black/30"
                    >
                      <img
                        src={paymentProofUrl}
                        alt={t("orders.details.shippingPaymentProof")}
                        className="max-h-44 w-full object-contain bg-black/30 transition group-hover:opacity-90"
                        onError={() => setPaymentProofImageFailed(true)}
                      />
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentProofModalOpen(true)}
                        className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-amber-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200"
                      >
                        <Eye className="h-4 w-4" />
                        {t("orders.details.zoom")}
                      </button>
                      <button
                        type="button"
                        onClick={() => window.open(paymentProofUrl, "_blank", "noopener,noreferrer")}
                        className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t("orders.details.openFullImage")}
                      </button>
                    </div>
                  </div>
                ) : paymentProofUrl && paymentProofImageFailed ? (
                  <div className="grid min-h-64 place-items-center px-4 py-10 text-center text-sm font-semibold text-rose-200">
                    <div>
                      <div>{t("orders.payment.invalidProofUrl")}</div>
                      <div className="mt-3 max-w-full break-all rounded-xl border border-rose-400/20 bg-black/30 p-3 text-xs font-mono text-rose-100">{shippingProofValue || paymentProofUrl}</div>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-64 place-items-center px-4 py-10 text-center text-sm font-semibold text-zinc-500">
                    {t("orders.details.noPaymentProofImage")}
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Info label={t("orders.details.paymentMethod")} value={order.shipping_payment_method ? formatShippingPaymentMethodLabel(order.shipping_payment_method) : formatOrderPaymentMethods(order, i18n.language)} />
                <Info label={t("orders.details.productsTotal")} value={formatCurrency(financials.productTotal)} />
                <Info label={t("orders.details.shippingValue")} value={formatCurrency(financials.shipping)} badge={financials.shippingPaidSeparately ? t("orders.statusLabels.paid") : ""} />
                {hasCodRemaining ? <Info label={t("orders.details.remainingOnDelivery")} value={formatCurrency(financials.remainingOnDelivery)} badge={t("orders.details.codRemaining")} /> : null}
                <Info label={t("orders.details.transferReference")} value={order.shipping_payment_reference || t("orders.fallback.notAvailable")} />
                <Info label={t("orders.details.currentPaymentStatus")} value={paymentSummaryStatus} />
              </div>

              {isAwaitingPaymentVerification ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleShippingPaymentReview("confirm")}
                    disabled={reviewingPayment || !canReviewShippingProof}
                    className="h-[var(--control-height-md)] rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] shadow-lg shadow-emerald-950/20 transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("orders.payment.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShippingPaymentReview("reject")}
                    disabled={reviewingPayment || !canReviewShippingProof}
                    className="h-[var(--control-height-md)] rounded-[var(--radius-control)] bg-rose-500 px-4 text-sm font-black text-white shadow-lg shadow-rose-950/20 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("orders.payment.reject")}
                  </button>
                </div>
              ) : (
                <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-black ${ isShippingPaid ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-rose-500/20 bg-rose-500/10 text-rose-200" }`}>
                  {isShippingPaid ? t("orders.payment.confirmed") : t("orders.details.transferProofRejected")}
                </div>
              )}
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
            <div className="flex items-center justify-between">
              <h3 className="m1-section-title text-white">{t("orders.details.paymentSummary")}</h3>
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                {financials.shippingPaidSeparately ? <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-black text-emerald-200">{t("orders.details.shippingPaid")}</span> : null}
                {hasCodRemaining ? <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-xs font-black text-amber-200">{t("orders.details.codRemaining")}</span> : null}
                <span>{paymentSummaryStatus}</span>
              </div>
            </div>
            <div className="mt-4 inline-flex rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-1 text-xs font-semibold text-zinc-300">
              <button
                type="button"
                onClick={() => setPdfFormat("a4")}
                className={`rounded-[var(--radius-control)] px-3 py-2 transition ${ pdfFormat === "a4" ? "bg-primary text-black" : "hover:bg-white/10" }`}
              >
                {t("orders.details.a4Pdf")}
              </button>
              <button
                type="button"
                onClick={() => setPdfFormat("thermal")}
                className={`rounded-[var(--radius-control)] px-3 py-2 transition ${ pdfFormat === "thermal" ? "bg-primary text-black" : "hover:bg-white/10" }`}
              >
                {t("orders.details.thermalPdf")}
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035]">
              <FinancialRow label={t("orders.details.subtotal")} value={formatCurrency(financials.subtotal)} />
              <FinancialRow label={t("orders.details.discount")} value={formatCurrency(financials.discount)} />
              {requiresShipping ? <FinancialRow label={t("orders.drawer.shipping")} value={formatCurrency(financials.shipping)} badge={financials.shippingPaidSeparately ? t("orders.statusLabels.paid") : ""} /> : null}
              <FinancialRow
                label={t("orders.details.grandTotal")}
                value={formatCurrency(financials.grandTotal)}
                badge={financials.shippingPaidSeparately ? t("orders.details.fullOrderValue") : ""}
              />
              {hasCodRemaining ? (
                <FinancialRow
                  label={t("orders.details.remainingOnDelivery")}
                  value={formatCurrency(financials.remainingOnDelivery)}
                  badge={t("orders.details.collectionRequired")}
                  strong
                  tone="emerald"
                />
              ) : null}
            </div>
            <div className={`mt-4 grid gap-3 ${requiresShipping ? "sm:grid-cols-2" : "grid-cols-1"}`}>
              {requiresShipping ? <Info label={t("orders.details.codAmount")} value={formatCurrency(hasCodRemaining ? financials.remainingOnDelivery : order.cod_amount || 0)} /> : null}
              {requiresShipping ? <Info label={t("orders.details.refundStatus")} value={order.status === "Returned" ? t("orders.statusLabels.returned") : t("orders.details.active")} /> : null}
              <Info label={t("orders.edit.paymentStatus")} value={paymentSummaryStatus} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{t("orders.details.invoicePreview")}</div>
                <h3 className="m1-section-title mt-2 text-white">{order.invoice_number}</h3>
                <p className="mt-1 text-sm text-zinc-400">{pdfFormat === "thermal" ? t("orders.details.thermalPdf") : t("orders.details.a4Pdf")}</p>
              </div>
              <button
                type="button"
                onClick={() => setInvoicePreviewOpen(true)}
                className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Eye className="h-4 w-4" />
                {t("orders.details.preview")}
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Info label={t("orders.drawer.items")} value={String(previewItems.length)} />
              <Info label={t("orders.details.grandTotal")} value={formatCurrency(financials.grandTotal)} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <ActionButton onClick={() => setInvoicePreviewOpen(true)} icon={<Eye className="h-4 w-4" />} label={t("orders.details.preview")} />
              <ActionButton onClick={handlePrint} icon={<Printer className="h-4 w-4" />} label={t("orders.details.printInvoice")} />
              <ActionButton onClick={handlePdf} icon={<Download className="h-4 w-4" />} label={t("orders.details.downloadPdf")} />
              <ActionButton onClick={shareWhatsApp} icon={<MessageCircle className="h-4 w-4" />} label={t("orders.details.whatsappShare")} />
              <ActionButton onClick={notifyCustomer} icon={<ShieldCheck className="h-4 w-4" />} label={t("orders.details.notifyCustomer")} />
              <ActionButton danger onClick={() => navigate("/orders/returns")} icon={<RefreshCcw className="h-4 w-4" />} label={t("orders.details.returnItems")} />
            </div>
          </div>

          {requiresShipping ? <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-5 shadow-xl shadow-black/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{t("orders.details.fulfillment")}</div>
                <h3 className="m1-section-title mt-2 text-white">{t("orders.drawer.shipping")}</h3>
              </div>
              <button
                type="button"
                onClick={handleSaveShipping}
                className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-black transition hover:bg-primary"
              >
                <Truck className="h-4 w-4" />
                {t("orders.details.saveShipping")}
              </button>
              {shippingSetupOpen ? (
                <button type="button" onClick={() => setShippingSetupOpen(false)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-300 transition hover:bg-white/10">
                  {tt("orders.bulk.cancel")}
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-1">
              {[
                ["shipment", t("orders.shipping.shipment")],
                ["courier", t("orders.shipping.courier")],
                ["tracking", t("orders.shipping.tracking")],
                ["costs", t("orders.shipping.costsCod")],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setShippingTab(key)}
                  className={`rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold transition ${ shippingTab === key ? "bg-[var(--primary)] text-[var(--primary-contrast)]" : "text-zinc-300 hover:bg-white/10" }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              {shippingTab === "shipment" ? (
                <div className="grid gap-3 2xl:grid-cols-2">
                  <div className="order-details-address-panel grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 2xl:col-span-2">
                    <div className="sm:col-span-2">
                      <div className="order-details-address-title text-sm font-black">{isBostaShippingProvider(shipping.provider) ? tt("orders.shipping.bostaAddress") : tt("orders.shipping.customerDelivery")}</div>
                      <div className="order-details-address-description mt-1 text-xs font-semibold">{isBostaShippingProvider(shipping.provider) ? tt("orders.shipping.bostaDirectoryHint") : tt("orders.shipping.saveBeforeCreate")}</div>
                    </div>
                    <FieldLabel label={tt("orders.shipping.customerPhone")}>
                      <input value={shipping.customer_phone} onChange={(e) => setShipping((prev) => ({ ...prev, customer_phone: e.target.value }))} placeholder="01xxxxxxxxx" dir="ltr" className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
                    </FieldLabel>
                    {isBostaShippingProvider(shipping.provider) ? (
                      <>
                        <FieldLabel label={tt("orders.shipping.bostaCity")}>
                          <select value={shipping.shipping_city_id} disabled={bostaLocations.loadingCities} onChange={(e) => {
                            const selected = bostaLocations.cities.find((item) => shippingLocationId(item) === e.target.value);
                            const label = shippingLocationLabel(selected);
                            setShipping((prev) => ({ ...prev, shipping_city_id: e.target.value, shipping_zone_id: "", shipping_district_id: "", governorate: label, city_area: "", shipping_city_name_ar: selected?.name_ar || "", shipping_city_name_en: selected?.name_en || "", shipping_zone_name_ar: "", shipping_zone_name_en: "", shipping_district_name_ar: "", shipping_district_name_en: "" }));
                          }} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:opacity-50">
                            <option value="" className="bg-zinc-950">{bostaLocations.loadingCities ? tt("orders.shipping.loadingCities") : tt("orders.shipping.selectCity")}</option>
                            {bostaLocations.cities.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)} className="bg-zinc-950">{shippingLocationLabel(item)}</option>)}
                          </select>
                        </FieldLabel>
                        <FieldLabel label={tt("orders.shipping.zone")}>
                          <select value={shipping.shipping_zone_id} disabled={!shipping.shipping_city_id || bostaLocations.loadingZones} onChange={(e) => {
                            const selected = bostaLocations.zones.find((item) => shippingLocationId(item) === e.target.value);
                            setShipping((prev) => ({ ...prev, shipping_zone_id: e.target.value, shipping_district_id: "", city_area: shippingLocationLabel(selected), shipping_zone_name_ar: selected?.name_ar || "", shipping_zone_name_en: selected?.name_en || "", shipping_district_name_ar: "", shipping_district_name_en: "" }));
                          }} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:opacity-50">
                            <option value="" className="bg-zinc-950">{bostaLocations.loadingZones ? tt("orders.shipping.loadingZones") : tt("orders.shipping.selectZone")}</option>
                            {bostaLocations.zones.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)} className="bg-zinc-950">{shippingLocationLabel(item)}</option>)}
                          </select>
                        </FieldLabel>
                        <FieldLabel label={tt("orders.shipping.district")}>
                          <select value={shipping.shipping_district_id} disabled={!shipping.shipping_zone_id || bostaLocations.loadingDistricts} onChange={(e) => {
                            const selected = bostaLocations.districts.find((item) => shippingLocationId(item) === e.target.value);
                            setShipping((prev) => ({ ...prev, shipping_district_id: e.target.value, city_area: shippingLocationLabel(selected) || prev.city_area, shipping_district_name_ar: selected?.name_ar || "", shipping_district_name_en: selected?.name_en || "" }));
                          }} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:opacity-50">
                            <option value="" className="bg-zinc-950">{bostaLocations.loadingDistricts ? tt("orders.shipping.loadingDistricts") : tt("orders.shipping.selectDistrict")}</option>
                            {bostaLocations.districts.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)} className="bg-zinc-950">{shippingLocationLabel(item)}</option>)}
                          </select>
                        </FieldLabel>
                        <div className="sm:col-span-2">
                          <FieldLabel label={tt("orders.shipping.streetAndAddress")}>
                            <input value={shipping.street_address} onChange={(e) => setShipping((prev) => ({ ...prev, street_address: e.target.value, shipping_address_line: e.target.value }))} placeholder={tt("orders.shipping.streetPlaceholder")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
                          </FieldLabel>
                        </div>
                        <FieldLabel label={tt("orders.shipping.buildingNumber")}>
                          <input value={shipping.building_number} onChange={(e) => setShipping((prev) => ({ ...prev, building_number: e.target.value }))} placeholder={tt("orders.shipping.buildingNumberRequired")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
                        </FieldLabel>
                        <FieldLabel label={tt("common.employeeHub.analytics.table.role")}>
                          <input value={shipping.floor_number} onChange={(e) => setShipping((prev) => ({ ...prev, floor_number: e.target.value }))} placeholder={tt("common.employeeHub.analytics.table.role")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
                        </FieldLabel>
                        <FieldLabel label={tt("orders.shipping.apartmentNumber")}>
                          <input value={shipping.apartment_number} onChange={(e) => setShipping((prev) => ({ ...prev, apartment_number: e.target.value }))} placeholder={tt("orders.shipping.apartment")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
                        </FieldLabel>
                        <FieldLabel label={tt("orders.details.landmark")}>
                          <input value={shipping.landmark} onChange={(e) => setShipping((prev) => ({ ...prev, landmark: e.target.value }))} placeholder={tt("orders.shipping.landmarkPlaceholder")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
                        </FieldLabel>
                      </>
                    ) : (
                      <>
                        <FieldLabel label={tt("orders.details.governorate")}><input value={shipping.governorate} onChange={(e) => setShipping((prev) => ({ ...prev, governorate: e.target.value }))} placeholder={tt("orders.details.governorate")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" /></FieldLabel>
                        <FieldLabel label={tt("orders.shipping.cityOrZone")}><input value={shipping.city_area} onChange={(e) => setShipping((prev) => ({ ...prev, city_area: e.target.value }))} placeholder={tt("orders.details.cityArea")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" /></FieldLabel>
                        <FieldLabel label={tt("orders.details.landmark")}><input value={shipping.landmark} onChange={(e) => setShipping((prev) => ({ ...prev, landmark: e.target.value }))} placeholder={tt("orders.shipping.landmarkPlaceholder")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" /></FieldLabel>
                        <div className="sm:col-span-2"><FieldLabel label={tt("orders.shipping.fullAddress")}><textarea value={shipping.shipping_address_line} onChange={(e) => setShipping((prev) => ({ ...prev, shipping_address_line: e.target.value }))} rows={3} placeholder={tt("orders.shipping.addressPlaceholder")} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" /></FieldLabel></div>
                      </>
                    )}
                  </div>
                  {isBostaShippingProvider(shipping.provider) && hasCreatedShipment ? (
                    <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4 2xl:col-span-2">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Bosta</div>
                          <div className="mt-1 text-sm font-black text-white">{[bostaCityName, bostaZoneName, bostaDistrictName].filter(Boolean).join(" · ") || t("orders.fallback.notAvailable")}</div>
                          <div className="mt-1 text-xs font-semibold text-zinc-400">{shipping.shipping_address_line || order.customer_address || t("orders.fallback.notAvailable")}</div>
                          <div className="mt-1 text-[11px] font-semibold text-zinc-500">
                            {[shipping.street_address, shipping.building_number ? `مبنى ${shipping.building_number}` : "", shipping.floor_number ? `طابق ${shipping.floor_number}` : "", shipping.apartment_number ? `شقة ${shipping.apartment_number}` : "", order.landmark ? `بالقرب من ${order.landmark}` : ""].filter(Boolean).join(" · ") || t("orders.fallback.notAvailable")}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleBostaAction("create")} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-zinc-950">{tt("orders.shipping.createBostaShipment")}</button>
                          <button type="button" onClick={() => handleBostaAction("refresh")} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white">{tt("orders.shipping.refreshStatus")}</button>
                          <button type="button" onClick={() => handleBostaAction("cancel")} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-rose-300/30 bg-rose-400/10 px-3 text-xs font-semibold text-rose-100">{tt("orders.bulk.cancel")}</button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <Info label={tt("orders.shipping.provider")} value="Bosta" />
                        <Info label={tt("orders.shipping.city")} value={bostaCityName || t("orders.fallback.notAvailable")} />
                        <Info label={tt("orders.shipping.zone")} value={bostaZoneName || t("orders.fallback.notAvailable")} />
                        <Info label={tt("orders.shipping.district")} value={bostaDistrictName || t("orders.fallback.notAvailable")} />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <Info label={tt("orders.shipping.street")} value={shipping.street_address || t("orders.fallback.notAvailable")} />
                        <Info label={tt("orders.shipping.building")} value={shipping.building_number || t("orders.fallback.notAvailable")} />
                        <Info label={tt("orders.shipping.floor")} value={shipping.floor_number || t("orders.fallback.notAvailable")} />
                        <Info label={tt("orders.shipping.apartment")} value={shipping.apartment_number || t("orders.fallback.notAvailable")} />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        {order.landmark ? <Info label={tt("orders.details.landmark")} value={order.landmark} /> : null}
                        <Info label={tt("orders.shipping.bostaInternalId")} value={shipping.shipping_provider_delivery_id || t("orders.fallback.notAvailable")} />
                        <Info label={tt("orders.shipping.bostaTrackingNumber")} value={shipping.tracking_number || shipping.shipment_id || t("orders.fallback.notAvailable")} />
                        <Info label={tt("orders.shipping.labelLink")} value={shipping.shipping_label_url || t("orders.fallback.notAvailable")} />
                      </div>
                      {shipping.shipping_label_url ? (
                        <button type="button" onClick={() => window.open(shipping.shipping_label_url, "_blank", "noopener,noreferrer")} className="mt-3 h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 px-3 text-xs font-black text-primary transition hover:bg-primary/20">{tt("orders.shipping.printLabel")}</button>
                      ) : null}
                      {bostaActionError ? (
                        <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-bold leading-5 ${ bostaActionError.code === BOSTA_SUBSCRIPTION_REQUIRED_CODE ? "border-amber-300/35 bg-amber-400/10 text-amber-100" : "border-rose-300/30 bg-rose-400/10 text-rose-100" }`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${ bostaActionError.code === BOSTA_SUBSCRIPTION_REQUIRED_CODE ? "bg-amber-300/20 text-amber-100" : "bg-rose-300/20 text-rose-100" }`}>
                              {bostaActionError.code === BOSTA_SUBSCRIPTION_REQUIRED_CODE ? tt("orders.shipping.subscriptionRequired") : tt("orders.shipping.bostaError")}
                            </span>
                            <span>{bostaActionError.message}</span>
                          </div>
                          {bostaActionError.code === BOSTA_SUBSCRIPTION_REQUIRED_CODE ? (
                            <Link to="/settings?category=shipping" className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-200/25 bg-amber-200/10 px-2 py-1 text-[11px] font-black text-amber-50 transition hover:bg-amber-200/20">
                              {tt("orders.shipping.providerSettings")}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <FieldLabel label={t("orders.shipping.provider")}>
                    <select
                      value={shipping.provider}
                      onChange={(e) => setShipping((prev) => ({ ...prev, provider: e.target.value }))}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                    >
                      {supportedShippingProviders.map((provider) => (
                        <option key={provider} value={provider} className="bg-zinc-950 text-white">
                          {provider}
                        </option>
                      ))}
                    </select>
                  </FieldLabel>
                  <FieldLabel label={t("orders.shipping.status")}>
                    <select
                      value={shipping.shipment_status || shipping.shipping_status}
                      onChange={(e) => setShipping((prev) => ({ ...prev, shipping_status: e.target.value, shipment_status: e.target.value }))}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                    >
                      {SHIPPING_STATUSES.map((status) => (
                        <option key={status} value={status} className="bg-zinc-950 text-white">
                          {t(`orders.statusLabels.${normalizeComparable(status).replace(/\s+/g, "_")}`, status)}
                        </option>
                      ))}
                    </select>
                  </FieldLabel>
                  <FieldLabel label={isBostaShippingProvider(shipping.provider) ? tt("orders.shipping.bostaTrackingNumber") : t("orders.shipping.shipmentId")}>
                    <input
                      value={isBostaShippingProvider(shipping.provider) ? (shipping.tracking_number || shipping.shipment_id) : shipping.shipment_id}
                      onChange={(e) => setShipping((prev) => ({ ...prev, shipment_id: e.target.value }))}
                      readOnly={isBostaShippingProvider(shipping.provider)}
                      placeholder={isBostaShippingProvider(shipping.provider) ? tt("orders.shipping.appearsAfterCreate") : t("orders.shipping.shipmentId")}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 read-only:cursor-not-allowed read-only:opacity-70"
                    />
                  </FieldLabel>
                </div>
              ) : null}

              {shippingTab === "courier" ? (
                <FieldLabel label={t("orders.shipping.courierNotes")}>
                  <textarea
                    value={shipping.courier_notes}
                    onChange={(e) => setShipping((prev) => ({ ...prev, courier_notes: e.target.value }))}
                    rows={5}
                    placeholder={t("orders.shipping.courierNotes")}
                    className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </FieldLabel>
              ) : null}

              {shippingTab === "tracking" ? (
                <div className="grid gap-3">
                  <FieldLabel label={t("orders.shipping.trackingNumber")}>
                    <input
                      value={shipping.tracking_number}
                      onChange={(e) => setShipping((prev) => ({ ...prev, tracking_number: e.target.value }))}
                      placeholder={t("orders.shipping.trackingNumber")}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                  </FieldLabel>
                  <FieldLabel label={t("orders.shipping.trackingUrl")}>
                    <input
                      value={shipping.tracking_url}
                      onChange={(e) => setShipping((prev) => ({ ...prev, tracking_url: e.target.value }))}
                      placeholder={t("orders.shipping.trackingUrl")}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                  </FieldLabel>
                </div>
              ) : null}

              {shippingTab === "costs" ? (
                <div className="grid gap-3 2xl:grid-cols-2">
                  <FieldLabel label={t("orders.shipping.deliveryFee")}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={shipping.delivery_fee}
                      onChange={(e) => setShipping((prev) => ({ ...prev, delivery_fee: Number(e.target.value || 0) }))}
                      placeholder={t("orders.shipping.deliveryFee")}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                  </FieldLabel>
                  <FieldLabel label={t("orders.details.codAmount")}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={shipping.cod_amount}
                      onChange={(e) => setShipping((prev) => ({ ...prev, cod_amount: e.target.value }))}
                      placeholder={t("orders.shipping.codAutoPlaceholder", { amount: formatCurrency(financials.remainingOnDelivery) })}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                    <p className="mt-1 text-[11px] leading-5 text-zinc-400">{t("orders.shipping.codAutoHint")}</p>
                  </FieldLabel>
                  <FieldLabel label={t("orders.shipping.openPackage")}>
                    <select
                      value={shipping.allow_open_package || "inherit"}
                      onChange={(e) => setShipping((prev) => ({ ...prev, allow_open_package: e.target.value }))}
                      className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                    >
                      <option value="inherit">{t("orders.shipping.openPackageInherit")}</option>
                      <option value="allow">{t("orders.shipping.openPackageAllow")}</option>
                      <option value="deny">{t("orders.shipping.openPackageDeny")}</option>
                    </select>
                    <p className="mt-1 text-[11px] leading-5 text-zinc-400">{t("orders.shipping.openPackageHint")}</p>
                  </FieldLabel>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {!hasCreatedShipment ? (
                <div className={`flex items-center justify-between gap-3 rounded-[var(--radius-card)] border px-4 py-3 text-sm font-bold ${collectionPreview > 0 ? "border-white/10 bg-white/[0.03] text-white" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
                  <span>{t("orders.shipping.courierCollects")}</span>
                  <span className="font-black">{formatCurrency(collectionPreview)}</span>
                </div>
              ) : null}
              {!hasCreatedShipment && collectionPreview <= 0 ? (
                <p className="text-[11px] leading-5 text-amber-200/80">{t("orders.shipping.courierCollectsNothing")}</p>
              ) : null}
              {!hasCreatedShipment ? (
                <button type="button" onClick={handleCreateShipment} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-zinc-950 transition hover:bg-primary">
                  {t("orders.shipping.createShipment")}
                </button>
              ) : !shipmentDelivered && !shipmentInTransit ? (
                <button type="button" onClick={() => handleShipmentAction("mark_shipped")} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-zinc-950 transition hover:bg-primary">
                  {t("orders.shipping.markShipped", tt("orders.statusLabels.shipped"))}
                </button>
              ) : !shipmentDelivered ? (
                <button type="button" onClick={() => handleShipmentAction("mark_delivered")} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-primary">
                  {t("orders.shipping.markDelivered", tt("orders.fulfillment.delivered"))}
                </button>
              ) : (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-center text-sm font-black text-emerald-100">{tt("orders.shipping.delivered")}</div>
              )}
              {shipping.tracking_url ? (
                <button type="button" onClick={() => window.open(shipping.tracking_url, "_blank", "noopener,noreferrer")} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white transition hover:bg-white/10">
                  {t("orders.shipping.trackShipment")}
                </button>
              ) : null}
              {hasCreatedShipment && !shipmentDelivered ? (
                <details className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
                  <summary className="cursor-pointer list-none px-4 py-3 text-center text-xs font-semibold text-zinc-400">{tt("orders.details.moreActions")}</summary>
                  <div className="grid gap-2 border-t border-white/10 p-3 sm:grid-cols-2">
                    <button type="button" onClick={() => handleShipmentAction("retry")} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white transition hover:bg-white/10">{t("orders.shipping.retryShipment", tt("accounting.common.actions.retry"))}</button>
                    <button type="button" onClick={() => handleShipmentAction("cancel")} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-rose-400/20 bg-rose-400/10 px-3 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/15">{t("orders.shipping.cancelShipment", tt("orders.shipping.cancelShipment"))}</button>
                  </div>
                </details>
              ) : null}
            </div>

            <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{t("orders.shipping.timeline", "Shipment timeline")}</summary>
              <div className="mt-3 grid gap-2 border-t border-white/10 pt-3">
                {(Array.isArray(order.shipment_timeline) && order.shipment_timeline.length ? order.shipment_timeline : [{ status: shipping.shipment_status || shipping.shipping_status || "pending", action: "current", at: order.updated_at || order.created_at }]).slice().reverse().map((event, index) => (
                  <div key={`${event.status || "shipment"}-${event.at || index}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] px-3 py-2">
                    <div>
                      <StatusBadge value={event.status || "pending"} />
                      <div className="mt-0.5 text-xs text-zinc-500">{event.action || "shipment"} · {event.provider || shipping.provider || "in_store_delivery"}</div>
                    </div>
                    <div className="shrink-0 text-xs font-semibold text-zinc-400">{formatDateTime(event.at)}</div>
                  </div>
                ))}
              </div>
            </details>
          </div> : null}
        </div>
      </div>

      <div className="sr-only" aria-hidden="true">
        <div ref={invoiceRef}>
          <OrderInvoiceCard order={order} items={previewItems} compact={pdfFormat === "thermal"} />
        </div>
      </div>

      {paymentProofModalOpen && paymentProofUrl ? (
        <ModalShell title={t("orders.payment.proof")} onClose={() => setPaymentProofModalOpen(false)} closeLabel={t("common.close")}>
          <img src={paymentProofUrl} alt={t("orders.details.shippingPaymentProof")} className="max-h-[78vh] w-full object-contain" onError={() => setPaymentProofImageFailed(true)} />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => window.open(paymentProofUrl, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <ExternalLink className="h-4 w-4" />
              {t("orders.details.openFullImage")}
            </button>
          </div>
        </ModalShell>
      ) : null}

      {statusTimelineOpen ? (
        <ModalShell title={t("orders.drawer.timeline")} onClose={() => setStatusTimelineOpen(false)} closeLabel={t("common.close")}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <StatusBadge value={order.status} />
            <button type="button" onClick={loadOrder} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white transition hover:bg-white/10">
              <RefreshCcw className="h-3.5 w-3.5" />
              {t("orders.details.refresh")}
            </button>
          </div>
          <div className="max-h-[64vh] space-y-2 overflow-auto pr-1">
            {timeline.map((event, index) => (
              <div key={`${event.label}-${index}`} className="flex gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3">
                <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0">
                  <div className="font-semibold text-white">{event.label}</div>
                  <div className="mt-1 text-xs text-zinc-500">{formatDateTime(event.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {invoicePreviewOpen ? (
        <ModalShell title={t("orders.details.invoicePreviewWithFormat", { format: pdfFormat === "thermal" ? t("orders.details.thermal") : t("orders.details.a4") })} onClose={() => setInvoicePreviewOpen(false)} closeLabel={t("common.close")}>
          <div className="max-h-[80vh] overflow-auto rounded-2xl bg-white p-4">
            <div className="mx-auto w-full max-w-[920px]">
              <OrderInvoiceCard order={order} items={previewItems} compact={pdfFormat === "thermal"} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <Printer className="h-4 w-4" />
              {t("orders.details.printInvoice")}
            </button>
            <button
              type="button"
              onClick={handlePdf}
              className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-black transition hover:bg-primary"
            >
              <Download className="h-4 w-4" />
              {t("orders.details.downloadPdf")}
            </button>
          </div>
        </ModalShell>
      ) : null}

    </OrdersShell>
  );
}

function Info({ label, value, badge = "" }) {
  const badgeClassName = String(badge).toLowerCase().includes("cod")
    ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
        {badge ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${badgeClassName}`}>{badge}</span> : null}
      </div>
      <div className="mt-1 text-sm font-semibold text-white"><CurrencyText value={value} /></div>
    </div>
  );
}

function FinancialRow({ label, value, badge = "", strong = false, tone = "default" }) {
  const isEmerald = tone === "emerald";
  const badgeClassName = String(badge).toLowerCase().includes("cod")
    ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  return (
    <div className={`flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 last:border-b-0 ${strong ? (isEmerald ? "bg-emerald-400/10" : "bg-white/[0.045]") : ""}`}>
      <div className="min-w-0">
        <div className={`text-sm ${strong ? `font-black ${isEmerald ? "text-emerald-100" : "text-white"}` : "font-semibold text-zinc-300"}`}>{label}</div>
        {badge ? <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${badgeClassName}`}>{badge}</span> : null}
      </div>
      <div className={`shrink-0 text-right ${strong ? `text-lg font-black ${isEmerald ? "text-emerald-200" : "text-white"}` : "text-sm font-bold text-zinc-100"}`}><CurrencyText value={value} /></div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 font-semibold text-white"><CurrencyText value={value} /></div>
    </div>
  );
}

function FieldLabel({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function ModalShell({ title, onClose, children, closeLabel = "Close" }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-6xl rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/50">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="m1-section-title text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-[var(--control-height-md)] w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-white transition hover:bg-white/10"
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ActionButton({ onClick, icon, label, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-semibold transition ${ danger ? "border-rose-500/25 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15" : "border-white/10 bg-white/5 text-white hover:bg-white/10" }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default OrderDetails;


