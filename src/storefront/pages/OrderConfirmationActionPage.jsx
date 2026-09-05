import { Component, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n/i18n";
import { sfText } from "../lib/sfText";
import {
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircleWarning,
  PencilLine,
  Phone,
  ShoppingBag,
  XCircle,
} from "lucide-react";

import { api } from "../../shared/api/api";

const ACTION_META = {
  confirm: {
    get label() { return sfText("storefront.confirmLink.confirm.label"); },
    get success() { return sfText("storefront.confirmLink.confirm.success"); },
    get hint() { return sfText("storefront.confirmLink.confirm.hint"); },
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-500",
  },
  edit: {
    get label() { return sfText("storefront.confirmLink.modify.label"); },
    get success() { return sfText("storefront.confirmLink.modify.success"); },
    get hint() { return sfText("storefront.confirmLink.modify.hint"); },
    icon: PencilLine,
    className: "border-amber-200 bg-amber-400 text-slate-950 hover:bg-amber-300",
  },
  cancel: {
    get label() { return sfText("storefront.confirmLink.cancel.label"); },
    get success() { return sfText("storefront.confirmLink.cancel.success"); },
    get hint() { return sfText("storefront.confirmLink.cancel.hint"); },
    icon: XCircle,
    className: "border-rose-200 bg-rose-600 text-white hover:bg-rose-500",
  },
};

const EXPIRED_CODES = new Set([
  "ORDER_CONFIRMATION_CODE_EXPIRED",
  "ORDER_CONFIRMATION_CODE_NOT_FOUND",
  "ORDER_CONFIRMATION_CODE_ALREADY_USED",
]);

// Built per call: a module-scope formatter would pin the digit system to whichever language loaded the chunk.
const moneyFormatter = { format: (value) => new Intl.NumberFormat(String(i18n.language || "ar").startsWith("ar") ? "ar-EG" : "en-EG", { maximumFractionDigits: 2 }).format(value) };

const text = (...values) => {
  for (const value of values) {
    const result = String(value ?? "").trim();
    if (result) return result;
  }
  return "";
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoney = (value = 0) => `${moneyFormatter.format(toNumber(value))} ${sfText("storefront.confirmLink.egp")}`;

const normalizeItems = (payload = {}) => {
  const order = payload?.order ?? payload?.data?.order ?? payload?.result?.order ?? payload?.data ?? payload?.result ?? payload ?? {};
  const sources = [
    order.items,
    order.order_items,
    order.orderItems,
    order.line_items,
    order.products,
    payload.items,
    payload.order_items,
    payload.orderItems,
    payload.line_items,
    payload.products,
    payload.data?.items,
    payload.data?.order_items,
    payload.data?.orderItems,
    payload.data?.line_items,
    payload.data?.products,
  ].filter(Array.isArray);

  const items = sources.find((candidate) => candidate.length > 0) || [];
  return items
    .map((item, index) => ({
      key: item?.id ?? `${index}-${text(item?.product_name, item?.name, item?.title, "item")}`,
      product_name: text(item?.resolved_product_name, item?.product_name, item?.name, item?.title, item?.product?.name, sfText("storefront.confirmLink.productFallback")),
      price: item?.price,
      unit_price: item?.unit_price,
      selling_price: item?.selling_price,
      product_price: item?.product_price,
      sale_price: item?.sale_price,
      final_price: item?.final_price,
      total_price: item?.total_price,
      total: item?.total,
      line_total: item?.line_total,
      total_amount: item?.total_amount,
      variant_name: text(item?.resolved_variant_name, item?.variant_name, item?.variant?.name, [item?.color, item?.size].filter(Boolean).join(" / ")),
      color: text(item?.color, item?.variant?.color),
      size: text(item?.size, item?.variant?.size),
      quantity: Math.max(1, toNumber(item?.quantity || item?.qty || 1)),
      image_url: text(
        item?.resolved_image_url,
        item?.image_url,
        item?.product_image,
        item?.variant_image,
        item?.primary_image_url,
        item?.public_image_url,
        item?.image,
        item?.photo_url,
        item?.thumbnail_url,
        item?.product?.image_url,
        item?.product?.product_image_url,
        item?.product?.public_image_url,
        item?.variant?.image_url,
        item?.variant?.primary_image_url,
        item?.variant?.variant_image_url,
        item?.variant?.product_image_url
      ),
    }))
    .filter((item) => item.product_name || item.image_url);
};


const getItemPrice = (item = {}) => normalizeMaybeMoney(firstDefined(item?.price, item?.unit_price, item?.selling_price, item?.product_price, item?.sale_price, item?.final_price, item?.total_price, item?.line_total));

const getItemLineTotal = (item = {}) => {
  const quantity = Math.max(1, toNumber(item?.quantity || item?.qty || 1));
  const directLineTotal = normalizeMaybeMoney(firstDefined(
    item?.total,
    item?.line_total,
    item?.total_amount,
    item?.total_price,
    item?.amount,
    item?.final_total,
  ));
  if (directLineTotal !== undefined) return directLineTotal;
  const unitPrice = normalizeMaybeMoney(firstDefined(item?.unit_price, item?.price, item?.selling_price, item?.product_price, item?.sale_price, item?.final_price));
  return unitPrice !== undefined ? unitPrice * quantity : undefined;
};

const getWhatsAppUrl = (phone = "") => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "https://wa.me/";
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");

const normalizeMaybeMoney = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatMaybeMoney = (value) => {
  const normalized = normalizeMaybeMoney(value);
  if (normalized === undefined) return sfText("storefront.confirmLink.notSpecified");
  return formatMoney(normalized);
};

const joinAddressParts = (...parts) => parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(" - ");

const getShippingFee = (order = null) => {
  const shippingValue = firstDefined(
    order?.shipping_fee,
    order?.delivery_fee,
    order?.shipping_cost,
    order?.delivery_cost,
    order?.shipping_amount
  );
  return normalizeMaybeMoney(shippingValue);
};

const getItemsSubtotal = (order = null) => normalizeMaybeMoney(firstDefined(order?.items_subtotal, order?.subtotal, order?.products_subtotal, order?.items_total, order?.items_total_amount));

const getDiscountValue = (order = null) => normalizeMaybeMoney(firstDefined(order?.discount, order?.discount_amount, order?.discount_value, order?.coupon_discount));

const getTotalValue = (order = null) => normalizeMaybeMoney(firstDefined(order?.total, order?.total_amount, order?.total_price, order?.grand_total));

const getConfirmationAddressFields = (order = null) => {
  const fields = [
    [sfText("storefront.confirmLink.fields.governorate"), firstDefined(order?.governorate, order?.governorate_name, order?.province, order?.province_name, order?.state, order?.state_name)],
    [sfText("storefront.confirmLink.fields.city"), firstDefined(order?.center, order?.center_name, order?.city, order?.city_name, order?.town, order?.town_name, order?.district, order?.district_name, order?.shipping_zone_name, order?.shipping_zone_name_ar, order?.shipping_zone_name_en)],
    [sfText("storefront.confirmLink.fields.area"), firstDefined(order?.area, order?.area_name, order?.region, order?.region_name, order?.neighborhood, order?.neighborhood_name, order?.zone, order?.zone_name, order?.shipping_district_name, order?.shipping_district_name_ar, order?.shipping_district_name_en)],
    [sfText("storefront.confirmLink.fields.street"), firstDefined(order?.street, order?.street_name, order?.street_address, order?.address_line)],
    [sfText("storefront.confirmLink.fields.building"), firstDefined(order?.building_number, order?.building_no, order?.building, order?.building_name)],
    [sfText("storefront.confirmLink.fields.floor"), firstDefined(order?.floor, order?.floor_number, order?.level, order?.level_number)],
    [sfText("storefront.confirmLink.fields.apartment"), firstDefined(order?.apartment, order?.apartment_number, order?.unit, order?.unit_number, order?.flat, order?.flat_number)],
  ];

  return fields
    .map(([label, value]) => ({ label, value: String(value ?? "").trim() }))
    .filter((field) => field.value);
};

const getAddressSummary = (order = null) => {
  const governorate = firstDefined(order?.governorate, order?.city, order?.area);
  const addressLine = firstDefined(order?.address_line, order?.street_address, order?.notes, order?.address, order?.shipping_address, order?.customer_address, order?.delivery_address);
  const fallbackAddress = firstDefined(order?.shipping_address_line, order?.shipping_address_details, order?.location);
  return {
    locationLine: joinAddressParts(governorate, firstDefined(order?.city, order?.area)),
    addressLine: joinAddressParts(addressLine, fallbackAddress),
  };
};

const getStructuredAddressFields = (order = null) => {
  const fields = [
    [sfText("storefront.confirmLink.fields.governorate"), firstDefined(order?.governorate, order?.governorate_name, order?.province, order?.province_name, order?.state, order?.state_name)],
    [sfText("storefront.confirmLink.fields.city"), firstDefined(order?.center, order?.center_name, order?.city, order?.city_name, order?.town, order?.town_name, order?.district, order?.district_name)],
    [sfText("storefront.confirmLink.fields.area"), firstDefined(order?.area, order?.area_name, order?.region, order?.region_name, order?.neighborhood, order?.neighborhood_name, order?.zone, order?.zone_name)],
    [sfText("storefront.confirmLink.fields.street"), firstDefined(order?.street, order?.street_name, order?.street_address, order?.address_line)],
    [sfText("storefront.confirmLink.fields.building"), firstDefined(order?.building_number, order?.building_no, order?.building, order?.building_name)],
    [sfText("storefront.confirmLink.fields.floor"), firstDefined(order?.floor, order?.floor_number, order?.level, order?.level_number)],
    [sfText("storefront.confirmLink.fields.apartment"), firstDefined(order?.apartment, order?.apartment_number, order?.unit, order?.unit_number, order?.flat, order?.flat_number)],
    [sfText("storefront.confirmLink.fields.landmark"), firstDefined(order?.landmark, order?.notes, order?.note, order?.delivery_notes, order?.customer_notes, order?.special_instructions)],
  ];

  return fields
    .map(([label, value]) => ({ label, value: String(value ?? "").trim() }))
    .filter((field) => field.value);
};

function InfoCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-[1.35rem] border border-white/10 bg-[#101010] p-4 shadow-[0_14px_34px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
        <Icon className="h-4 w-4 text-[#d4af37]" />
        {title}
      </div>
      {children}
    </div>
  );
}

class OrderConfirmationActionPageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[order-confirmation-action-page]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] px-4 py-8 text-white">
          <div className="mx-auto max-w-3xl rounded-[1.5rem] border border-white/10 bg-[#101010] p-5 text-white shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
            <h1 className="text-xl font-black">{sfText("storefront.confirmLink.errorTitle")}</h1>
            <p className="mt-2 text-sm leading-7 text-slate-700">{sfText("storefront.confirmLink.errorText")}</p>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export function OrderConfirmationActionPage() {
  return (
    <OrderConfirmationActionPageErrorBoundary>
      <OrderConfirmationActionPageInner />
    </OrderConfirmationActionPageErrorBoundary>
  );
}

function OrderConfirmationActionPageInner() {
  useTranslation();
  const { code, token } = useParams();
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [linkState, setLinkState] = useState("loading");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const confirmationCode = String(code || token || "").trim();
    console.info("[OrderConfirmationActionPage] mounted", { confirmationCode });
  }, [code, token]);

  const resolvedCode = useMemo(() => {
    const raw = String(code || token || "").trim();
    if (!raw) return "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw;
    }
  }, [code, token]);

  const order = useMemo(() => result?.order || result?.data?.order || result?.data || null, [result]);
  const items = useMemo(() => normalizeItems(result || {}), [result]);
  const primaryItem = items[0] || null;
  const pricing = useMemo(() => {
    const subtotalSource = firstDefined(order?.items_subtotal, order?.subtotal, order?.items_total, order?.items_total_amount, order?.products_subtotal);
    const shippingSource = firstDefined(order?.shipping_fee, order?.delivery_fee, order?.shipping_cost, order?.delivery_cost, order?.shipping_amount);
    const discountSource = firstDefined(order?.discount, order?.discount_amount, order?.discount_value, order?.coupon_discount);
    const totalSource = firstDefined(order?.total, order?.grand_total, order?.total_amount, order?.total_price);
    const calculatedSubtotal = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + (getItemLineTotal(item) || 0), 0);
    const subtotalValue = normalizeMaybeMoney(subtotalSource);
    const discountValue = normalizeMaybeMoney(discountSource);
    const totalValue = normalizeMaybeMoney(totalSource);
    const subtotalFallback = calculatedSubtotal || Math.max(0, (totalValue ?? 0) - (normalizeMaybeMoney(shippingSource) ?? 0) + (discountValue ?? 0));
    const resolvedSubtotal = subtotalValue && subtotalValue > 0 ? subtotalValue : subtotalFallback || subtotalValue || 0;
    return {
      subtotal: resolvedSubtotal,
      shipping: normalizeMaybeMoney(shippingSource) ?? 0,
      discount: discountValue ?? 0,
      total: totalValue ?? 0,
      subtotalAvailable: resolvedSubtotal > 0,
      shippingAvailable: shippingSource !== undefined && shippingSource !== null && String(shippingSource).trim() !== "",
      discountAvailable: discountValue !== undefined || discountSource === 0 || discountSource === "0",
      totalAvailable: totalSource !== undefined && totalSource !== null && String(totalSource).trim() !== "",
    };
  }, [items, order, resolvedCode]);

  const orderNumber = text(order?.public_order_number, order?.display_order_number, order?.invoice_number, order?.order_number, order?.id);
  const customerName = text(order?.customer_name, sfText("storefront.confirmLink.customer"));
  const customerPhone = text(order?.customer_phone, order?.phone, order?.whatsapp, order?.mobile);
  const itemsSubtotal = pricing.subtotal;
  const shippingFee = pricing.shipping;
  const discountValue = pricing.discount;
  const totalAmount = pricing.total;
  const structuredAddressFields = getConfirmationAddressFields(order);
  const fallbackAddress = String(order?.customer_address || order?.shipping_address_line || order?.street_address || "").trim();
  const addressSummary = {
    locationLine: structuredAddressFields.map((field) => field.value).filter(Boolean).join(" - "),
    addressLine: fallbackAddress,
  };
  const hasStructuredAddressFields = structuredAddressFields.length > 0;
  const shouldUseFallbackAddress = !hasStructuredAddressFields && Boolean(fallbackAddress);
  const waUrl = getWhatsAppUrl(customerPhone);

  const isExpiredState =
    linkState === "expired" ||
    linkState === "used" ||
    EXPIRED_CODES.has(String(error || "").trim()) ||
    EXPIRED_CODES.has(String(result?.code || "").trim());

  useEffect(() => {
    if (!result) return;
    const root = result?.order ?? result?.data?.order ?? result?.data ?? result?.result?.order ?? result?.result ?? result ?? {};
    const itemSource = normalizeItems(result || {});
    console.info("[order-confirmation-api-shape]", {
      code: resolvedCode,
      root_keys: Object.keys(result || {}),
      order_keys: root && typeof root === "object" ? Object.keys(root) : [],
      items_count: itemSource.length,
      item_keys: itemSource[0] ? Object.keys(itemSource[0]) : [],
      has_primary_image: Boolean(primaryItem?.image_url || text(order?.primary_image_url, order?.image_url, order?.product_image_url, order?.public_image_url)),
      has_hostname_text: false,
    });
    console.info("[OrderConfirmationActionPage] confirmation items", {
      count: order?.items?.length,
      items: order?.items,
    });
  }, [result, resolvedCode, order, primaryItem]);

  const loadCode = async () => {
    if (!resolvedCode) {
      setError(sfText("storefront.confirmLink.invalidLink"));
      setLinkState("error");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      setLinkState("loading");
      const response = await api.get(`/public/order-confirmation/${encodeURIComponent(resolvedCode)}`);
      setResult(response?.data || response);
      setLinkState("ready");
    } catch (err) {
      const status = Number(err?.status || err?.response?.status || 0);
      const responseCode = String(err?.responseBody?.code || err?.responseBody?.error || err?.code || "");
      setError(err?.responseBody?.message || err?.message || sfText("storefront.confirmLink.loadFailed"));
      if (status === 410 || responseCode === "ORDER_CONFIRMATION_CODE_EXPIRED") setLinkState("expired");
      else if (status === 404 || responseCode === "ORDER_CONFIRMATION_CODE_NOT_FOUND") setLinkState("used");
      else setLinkState("error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCode();
  }, [resolvedCode]);

  const applyAction = async (action) => {
    if (!resolvedCode || !action || pendingAction) return;
    try {
      setPendingAction(action);
      setError("");
      const endpoint = `/public/order-confirmation/${encodeURIComponent(resolvedCode)}`;
      const payload = { action };
      if (import.meta.env.DEV) {
        console.info("[OrderConfirmationActionPage] action request", {
          action,
          confirmationCode: resolvedCode,
          endpoint,
          payload,
        });
      }
      const response = await api.post(endpoint, payload);
      const data = response?.data || response;
      if (import.meta.env.DEV) {
        console.info("[OrderConfirmationActionPage] action response", {
          action,
          status: response?.status ?? response?.data?.status ?? 200,
          data,
        });
      }
      setResult(data);
      setLinkState("ready");
    } catch (err) {
      const responseData = err?.response?.data || err?.responseBody || err?.data || null;
      const backendMessage =
        responseData?.message ||
        responseData?.error?.message ||
        responseData?.error ||
        err?.responseBody?.message ||
        err?.message ||
        "";
      setError(backendMessage || sfText("storefront.confirmLink.actionFailed"));
    } finally {
      setPendingAction("");
    }
  };

  const resultAction = String(result?.action || "").trim();
  const actionMeta = ACTION_META[resultAction];
  const isReadOnlyResult = Boolean(result?.already_used || result?.link_locked);
  const resultMessage = String(result?.message || (actionMeta ? actionMeta.success : sfText("storefront.confirmLink.actionDone"))).trim();
  const resultHeadline = isReadOnlyResult
    ? (result?.link_locked ? sfText("storefront.confirmLink.linkAlreadyUsed") : sfText("storefront.confirmLink.linkAlreadyUsed"))
    : (actionMeta ? actionMeta.success : sfText("storefront.confirmLink.actionDone"));
  const resultSubtext = isReadOnlyResult
    ? (result?.link_locked && !result?.already_used ? sfText("storefront.confirmLink.linkLocked") : resultMessage)
    : (actionMeta?.hint || sfText("storefront.confirmLink.chooseAction"));
  const ResultCardIcon = isReadOnlyResult ? MessageCircleWarning : CheckCircle2;
  const resultCardClassName = isReadOnlyResult
    ? "rounded-[1.35rem] border border-amber-200 bg-amber-50 p-4 text-slate-950 shadow-sm"
    : "rounded-[1.35rem] border border-emerald-200 bg-emerald-50 p-4 text-slate-950 shadow-sm";
  const resultCardIconClassName = isReadOnlyResult
    ? "grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-200/80 text-slate-950"
    : "grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-200/80 text-slate-950";

  return (
    <main className="sf-order-confirmation-page min-h-screen bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[100svh] max-w-3xl items-center justify-center py-3">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] text-white shadow-[0_30px_90px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
            <div className="h-1 w-full rounded-full bg-[linear-gradient(90deg,#d4af37,#e5c158)]" />

            <div className="mt-4 space-y-4">
              <div className="rounded-[1.5rem] border border-white/10 bg-[#101010] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5">
                <div className="mb-3 flex items-start gap-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-[#d4af37]/20 bg-[rgba(212,175,55,0.12)] text-[#d4af37]">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#d4af37]">{sfText("storefront.confirmLink.eyebrow")}</p>
                    <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl">{sfText("storefront.confirmLink.title")}</h1>
                    <p className="mt-2 text-sm leading-6 text-white/72">{sfText("storefront.confirmLink.orderNumberLabel")} {orderNumber || "—"}</p>
                  </div>
                </div>

                {loading ? (
                  <div className="rounded-[1.35rem] border border-white/10 bg-[#101010] px-4 py-5 text-sm font-bold text-white/72 shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-[#d4af37]" />
                      {sfText("storefront.confirmLink.loading")}
                    </div>
                  </div>
                ) : error && isExpiredState ? (
                  <div className="space-y-4 rounded-[1.35rem] border border-amber-200/35 bg-[#101010] p-4 text-white shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-200/30 bg-[rgba(212,175,55,0.12)] text-[#d4af37]">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">{sfText("storefront.confirmLink.linkExpiredTitle")}</h2>
                        <p className="mt-1 text-sm leading-7 text-white/72">{sfText("storefront.confirmLink.linkExpiredText")}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a href={waUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">
                        <Phone className="h-4 w-4" />
                        {sfText("storefront.confirmLink.contactWhatsapp")}
                      </a>
                    </div>
                  </div>
                ) : error ? (
                  <div className="space-y-4 rounded-[1.35rem] border border-rose-200/35 bg-[#101010] p-4 text-white shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-rose-200/30 bg-[rgba(244,63,94,0.12)] text-rose-200">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">{sfText("storefront.confirmLink.linkLoadFailedTitle")}</h2>
                        <p className="mt-1 text-sm leading-7 text-white/72">{error}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a href={waUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">
                        <Phone className="h-4 w-4" />
                        {sfText("storefront.confirmLink.contactWhatsapp")}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-[1.35rem] border border-white/10 bg-[#101010] p-4 shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
                      {items.length > 1 ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {items.map((item) => {
                            const itemPrice = getItemPrice(item);
                            return (
                              <div key={item.key} className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#101010]">
                                <div className="aspect-[4/3] bg-[#101010]">
                                  {item.image_url ? (
                                    <img src={item.image_url} alt={item.product_name} className="h-full w-full object-cover" loading="lazy" />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-white/24">
                                      <ImageIcon className="h-12 w-12" />
                                    </div>
                                  )}
                                </div>
                                <div className="space-y-3 p-4">
                                  <h3 className="text-lg font-black leading-snug text-white">{item.product_name || sfText("storefront.confirmLink.productFallback")}</h3>
                                  <div className="flex flex-wrap gap-2 text-xs font-bold text-white/72">
                                    {item.color ? <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.colorLabel")} {item.color}</span> : null}
                                    {item.size ? <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.sizeLabel")} {item.size}</span> : null}
                                    <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.quantityLabel")} {item.quantity || 1}</span>
                                    {itemPrice !== undefined ? <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.priceLabel")} {formatMoney(itemPrice)}</span> : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#101010]">
                          <div className="aspect-[4/3] bg-[#101010]">
                            {primaryItem?.image_url ? (
                              <img src={primaryItem.image_url} alt={primaryItem.product_name} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-white/24">
                                <ImageIcon className="h-12 w-12" />
                              </div>
                            )}
                          </div>
                          <div className="space-y-3 p-4">
                            <h3 className="text-lg font-black leading-snug text-white">{primaryItem?.product_name || sfText("storefront.confirmLink.productFallback")}</h3>
                            <div className="flex flex-wrap gap-2 text-xs font-bold text-white/72">
                              {primaryItem?.color ? <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.colorLabel")} {primaryItem.color}</span> : null}
                              {primaryItem?.size ? <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.sizeLabel")} {primaryItem.size}</span> : null}
                              <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.quantityLabel")} {primaryItem?.quantity || 1}</span>
                              {getItemPrice(primaryItem) !== undefined ? <span className="inline-flex items-center rounded-full border border-white/10 bg-[#101010] px-3 py-1">{sfText("storefront.confirmLink.priceLabel")} {formatMoney(getItemPrice(primaryItem))}</span> : null}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {false && (<div className="grid gap-4 sm:grid-cols-2">
                      <InfoCard title={sfText("storefront.confirmLink.customer")} icon={ShoppingBag}>
                        <div className="space-y-2">
                          <div className="text-sm font-black text-slate-950">{customerName || "â€”"}</div>
                          <div className="text-sm font-bold text-slate-700">{customerPhone || "â€”"}</div>
                        </div>
                      </InfoCard>

                      <InfoCard title={sfText("storefront.confirmLink.address")} icon={MapPin}>
                        <div className="space-y-4">
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                              <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.itemsPrice")}</span>
                              <span className="font-black text-slate-950">{formatMoney(itemsSubtotal)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                              <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.shipping")}</span>
                              <span className="font-black text-slate-950">{pricing.shippingAvailable ? formatMoney(shippingFee) : sfText("storefront.confirmLink.notSpecified")}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                              <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.discount")}</span>
                              <span className="font-black text-slate-950">{formatMoney(discountValue || 0)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                              <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.finalTotal")}</span>
                              <span className="font-black text-slate-950">{pricing.totalAvailable ? formatMoney(totalAmount) : sfText("storefront.confirmLink.notSpecified")}</span>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{sfText("storefront.confirmLink.locationHeading")}</div>
                            <div className="mt-1 text-sm font-bold text-slate-900">
                              {addressSummary.locationLine || sfText("storefront.confirmLink.notSpecified")}
                            </div>
                            <div className="mt-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{sfText("storefront.confirmLink.detailedAddress")}</div>
                            <div className="mt-1 text-sm leading-7 text-slate-700">
                              {addressSummary.addressLine || sfText("storefront.confirmLink.notSpecified")}
                            </div>
                          </div>
                        </div>
                      </InfoCard>
                    </div>)}

                    <div className="space-y-4">
                      <InfoCard title={sfText("storefront.confirmLink.customer")} icon={ShoppingBag}>
                        <div className="space-y-2">
                          <div className="text-sm font-black text-slate-950">{customerName || "—"}</div>
                          <div className="text-sm font-bold text-slate-700">{customerPhone || "—"}</div>
                        </div>
                      </InfoCard>

                      <InfoCard title={sfText("storefront.confirmLink.address")} icon={MapPin}>
                        <div className="space-y-3">
                          {hasStructuredAddressFields ? (
                            <div className="grid gap-2 text-sm">
                              {structuredAddressFields.map((field) => (
                                <div key={field.label} className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 px-3 py-2">
                                  <span className="min-w-0 shrink-0 font-bold text-slate-600">{field.label}</span>
                                  <span className="min-w-0 text-left font-black leading-6 text-slate-950 rtl:text-right">{field.value}</span>
                                </div>
                              ))}
                            </div>
                          ) : shouldUseFallbackAddress ? (
                            <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm leading-7 font-bold text-slate-900">
                              {fallbackAddress}
                            </div>
                          ) : (
                            <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
                              {sfText("storefront.confirmLink.notSpecified")}
                            </div>
                          )}
                        </div>
                      </InfoCard>

                      <InfoCard title={sfText("storefront.confirmLink.paymentSummary")} icon={ShoppingBag}>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                            <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.itemsPrice")}</span>
                            <span className="font-black text-slate-950">{formatMoney(itemsSubtotal)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                            <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.shipping")}</span>
                            <span className="font-black text-slate-950">{pricing.shippingAvailable ? formatMoney(shippingFee) : sfText("storefront.confirmLink.notSpecified")}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                            <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.discount")}</span>
                            <span className="font-black text-slate-950">{formatMoney(discountValue || 0)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                            <span className="font-bold text-slate-600">{sfText("storefront.confirmLink.finalTotal")}</span>
                            <span className="font-black text-slate-950">{pricing.totalAvailable ? formatMoney(totalAmount) : sfText("storefront.confirmLink.notSpecified")}</span>
                          </div>
                        </div>
                      </InfoCard>
                    </div>

                    {!(resultAction || isReadOnlyResult) ? (
                      <div className="space-y-3 pt-1">
                        <div className="grid gap-3 sm:grid-cols-3">
                          {Object.entries(ACTION_META).map(([action, meta]) => {
                            const Icon = meta.icon;
                            const isBusy = pendingAction === action;
                            const disabled = Boolean(pendingAction);
                            return (
                              <button
                                key={action}
                                type="button"
                                onClick={() => applyAction(action)}
                                disabled={disabled}
                                className={["flex min-h-[88px] items-center gap-3 rounded-[1.35rem] border px-4 py-4 text-start transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60", meta.className].join(" ")}
                              >
                                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-current">
                                  {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-base font-black leading-tight text-current">{meta.label}</div>
                                  <div className="mt-1 text-xs font-semibold leading-5 text-current opacity-90">{meta.hint}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {pendingAction ? (
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm">
                            {sfText("storefront.confirmLink.running")} {ACTION_META[pendingAction]?.label || sfText("storefront.confirmLink.theAction")}...
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <div className={resultCardClassName}>
                          <div className="flex items-start gap-3">
                            <div className={resultCardIconClassName}>
                              <ResultCardIcon className="h-5 w-5" />
                            </div>
                            <div>
                              <h2 className="text-lg font-black">{resultHeadline}</h2>
                              <p className="mt-1 text-sm leading-7 text-slate-700">{resultSubtext}</p>
                              {isReadOnlyResult ? <p className="mt-2 text-xs font-bold text-slate-700">{sfText("storefront.confirmLink.readOnly")}</p> : null}
                              {!isReadOnlyResult && result?.already_applied ? <p className="mt-2 text-xs font-bold text-slate-700">{sfText("storefront.confirmLink.alreadyApplied")}</p> : null}
                            </div>
                          </div>
                        </div>
                        {isReadOnlyResult ? (
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <a href={waUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">
                              <Phone className="h-4 w-4" />
                              {sfText("storefront.confirmLink.contactWhatsapp")}
                            </a>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default OrderConfirmationActionPage;
