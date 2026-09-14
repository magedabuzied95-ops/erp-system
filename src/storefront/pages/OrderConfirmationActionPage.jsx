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
import { releaseStorefrontColorScheme, setStorefrontColorScheme } from "../../theme/documentColorScheme";
// The /c/:code route renders outside the storefront shell (App.jsx), where
// Storefront.jsx and its stylesheets never load — so the page brings the site's
// tokens and primitives itself. Inside the shell these are already loaded.
import "../site-skin.css";
import "../catalog-skin.css";
import "./customerLinks.css";

const ACTION_META = {
  confirm: {
    get label() { return sfText("storefront.confirmLink.confirm.label"); },
    get success() { return sfText("storefront.confirmLink.confirm.success"); },
    get hint() { return sfText("storefront.confirmLink.confirm.hint"); },
    icon: CheckCircle2,
    className: "sfl-action--confirm",
  },
  edit: {
    get label() { return sfText("storefront.confirmLink.modify.label"); },
    get success() { return sfText("storefront.confirmLink.modify.success"); },
    get hint() { return sfText("storefront.confirmLink.modify.hint"); },
    icon: PencilLine,
    className: "sfl-action--edit",
  },
  cancel: {
    get label() { return sfText("storefront.confirmLink.cancel.label"); },
    get success() { return sfText("storefront.confirmLink.cancel.success"); },
    get hint() { return sfText("storefront.confirmLink.cancel.hint"); },
    icon: XCircle,
    className: "sfl-action--cancel",
  },
};

// Same key and JSON encoding as Storefront.jsx; the shop defaults to dark.
const STOREFRONT_THEME_KEY = "storefront.theme";
const readStorefrontTheme = () => {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(STOREFRONT_THEME_KEY);
    return raw && JSON.parse(raw) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

const isInsideStorefrontShell = () =>
  typeof document !== "undefined" && Boolean(document.body?.classList?.contains("storefront-shell"));

// Outside the shell nobody else claims the root colour scheme for the shop's
// theme; `only light|dark` also stops force-dark phones repainting the page.
// Inside the shell the storefront owns it, so stay out of its way.
const useOutOfShellColorScheme = (theme) => {
  useEffect(() => {
    if (isInsideStorefrontShell()) return undefined;
    setStorefrontColorScheme(theme, theme === "dark" ? "#070707" : "#f3f3f1");
    return () => releaseStorefrontColorScheme();
  }, [theme]);
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
    <section className="sfx-surface">
      <h2 className="sfx-h3 sfl-block-title">
        <Icon aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
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
        <main className="sf-order-confirmation-page sfx-scope sfl" data-theme={readStorefrontTheme()}>
          <div className="sfx-wrap sfx-wrap--sm sfx-section">
            <div className="sfx-empty">
              <span className="sfx-empty__icon">
                <MessageCircleWarning className="h-7 w-7" aria-hidden="true" />
              </span>
              <h1 className="sfx-empty__title">{sfText("storefront.confirmLink.errorTitle")}</h1>
              <p className="sfx-empty__text">{sfText("storefront.confirmLink.errorText")}</p>
            </div>
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
  const [theme] = useState(readStorefrontTheme);
  useOutOfShellColorScheme(theme);
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
  const resultNoticeClassName = isReadOnlyResult ? "sfx-notice sfx-notice--accent" : "sfx-notice sfx-notice--success";
  const displayItems = items.length > 1 ? items : [primaryItem || { key: "fallback" }];

  const whatsappButton = (
    <a href={waUrl} target="_blank" rel="noreferrer" className="sfx-btn sfx-btn--whatsapp sfx-btn--lg sfx-btn--block">
      <Phone className="h-4 w-4" aria-hidden="true" />
      {sfText("storefront.confirmLink.contactWhatsapp")}
    </a>
  );

  return (
    <main className="sf-order-confirmation-page sfx-scope sfl" data-theme={theme}>
      <div className="sfx-wrap sfx-wrap--sm sfx-section sfl-page">
        <header className="sfl-head">
          <span className="sfl-icon" aria-hidden="true">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <div className="sfx-page-head__text">
            <p className="sfx-kicker">{sfText("storefront.confirmLink.eyebrow")}</p>
            <h1 className="sfx-title">{sfText("storefront.confirmLink.title")}</h1>
            <p className="sfx-subtitle">
              {sfText("storefront.confirmLink.orderNumberLabel")}{" "}
              <span className="sfx-badge sfx-badge--accent" dir="ltr">{orderNumber || "—"}</span>
            </p>
          </div>
        </header>

        {loading ? (
          <div className="sfx-surface sfl-loading" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {sfText("storefront.confirmLink.loading")}
          </div>
        ) : error && isExpiredState ? (
          <div className="sfx-stack">
            <div className="sfx-notice sfx-notice--accent" role="alert">
              <MessageCircleWarning aria-hidden="true" />
              <div className="sfl-notice-body">
                <h2 className="sfx-h3">{sfText("storefront.confirmLink.linkExpiredTitle")}</h2>
                <p className="sfl-text">{sfText("storefront.confirmLink.linkExpiredText")}</p>
              </div>
            </div>
            {whatsappButton}
          </div>
        ) : error ? (
          <div className="sfx-stack">
            <div className="sfx-notice sfx-notice--danger" role="alert">
              <MessageCircleWarning aria-hidden="true" />
              <div className="sfl-notice-body">
                <h2 className="sfx-h3">{sfText("storefront.confirmLink.linkLoadFailedTitle")}</h2>
                <p className="sfl-text">{error}</p>
              </div>
            </div>
            {whatsappButton}
          </div>
        ) : (
          <div className="sfx-stack">
            <div className={`sfl-items${displayItems.length > 1 ? " sfl-items--multi" : ""}`}>
              {displayItems.map((item) => {
                const itemPrice = getItemPrice(item);
                return (
                  <article key={item.key} className="sfx-surface sfx-surface--flush">
                    <div className="sfl-item__media">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.product_name} loading="lazy" />
                      ) : (
                        <ImageIcon className="h-12 w-12" aria-hidden="true" />
                      )}
                    </div>
                    <div className="sfl-item__body">
                      <h3 className="sfl-item__name">{item.product_name || sfText("storefront.confirmLink.productFallback")}</h3>
                      <div className="sfl-badges">
                        {item.color ? <span className="sfx-badge">{sfText("storefront.confirmLink.colorLabel")} {item.color}</span> : null}
                        {item.size ? <span className="sfx-badge">{sfText("storefront.confirmLink.sizeLabel")} {item.size}</span> : null}
                        <span className="sfx-badge">{sfText("storefront.confirmLink.quantityLabel")} {item.quantity || 1}</span>
                        {itemPrice !== undefined ? <span className="sfx-badge sfx-badge--accent">{sfText("storefront.confirmLink.priceLabel")} {formatMoney(itemPrice)}</span> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <InfoCard title={sfText("storefront.confirmLink.customer")} icon={ShoppingBag}>
              <div className="sfx-stack" style={{ gap: "var(--m1h-s1)" }}>
                <p className="sfl-text sfl-text--strong">{customerName || "—"}</p>
                <p className="sfl-text" dir="ltr" style={{ textAlign: "start" }}>{customerPhone || "—"}</p>
              </div>
            </InfoCard>

            <InfoCard title={sfText("storefront.confirmLink.address")} icon={MapPin}>
              {hasStructuredAddressFields ? (
                <dl className="sfx-summary">
                  {structuredAddressFields.map((field) => (
                    <div key={field.label} className="sfx-summary__row">
                      <dt>{field.label}</dt>
                      <dd style={{ margin: 0 }}>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : shouldUseFallbackAddress ? (
                <p className="sfl-text sfl-text--strong">{fallbackAddress}</p>
              ) : (
                <p className="sfl-text sfl-text--muted">{sfText("storefront.confirmLink.notSpecified")}</p>
              )}
            </InfoCard>

            <InfoCard title={sfText("storefront.confirmLink.paymentSummary")} icon={ShoppingBag}>
              <dl className="sfx-summary">
                <div className="sfx-summary__row">
                  <dt>{sfText("storefront.confirmLink.itemsPrice")}</dt>
                  <dd style={{ margin: 0 }}>{formatMoney(itemsSubtotal)}</dd>
                </div>
                <div className="sfx-summary__row">
                  <dt>{sfText("storefront.confirmLink.shipping")}</dt>
                  <dd style={{ margin: 0 }}>{pricing.shippingAvailable ? formatMoney(shippingFee) : sfText("storefront.confirmLink.notSpecified")}</dd>
                </div>
                <div className={`sfx-summary__row${discountValue ? " sfx-summary__row--discount" : ""}`}>
                  <dt>{sfText("storefront.confirmLink.discount")}</dt>
                  <dd style={{ margin: 0 }}>{formatMoney(discountValue || 0)}</dd>
                </div>
                <div className="sfx-summary__row sfx-summary__row--total">
                  <dt>{sfText("storefront.confirmLink.finalTotal")}</dt>
                  <dd style={{ margin: 0 }}>{pricing.totalAvailable ? formatMoney(totalAmount) : sfText("storefront.confirmLink.notSpecified")}</dd>
                </div>
              </dl>
            </InfoCard>

            {!(resultAction || isReadOnlyResult) ? (
              <div className="sfx-stack">
                <div className="sfl-actions">
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
                        aria-busy={isBusy || undefined}
                        className={`sfl-action ${meta.className}`}
                      >
                        <span className="sfl-action__icon" aria-hidden="true">
                          {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="sfl-action__label">{meta.label}</span>
                          <span className="sfl-action__hint">{meta.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {pendingAction ? (
                  <div className="sfx-notice" role="status">
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    <p className="sfl-text sfl-text--strong">
                      {sfText("storefront.confirmLink.running")} {ACTION_META[pendingAction]?.label || sfText("storefront.confirmLink.theAction")}...
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className={resultNoticeClassName} role="status">
                  <ResultCardIcon aria-hidden="true" />
                  <div className="sfl-notice-body">
                    <h2 className="sfx-h3">{resultHeadline}</h2>
                    <p className="sfl-text">{resultSubtext}</p>
                    {isReadOnlyResult ? <p className="sfl-text sfl-text--sm sfl-text--strong">{sfText("storefront.confirmLink.readOnly")}</p> : null}
                    {!isReadOnlyResult && result?.already_applied ? <p className="sfl-text sfl-text--sm sfl-text--strong">{sfText("storefront.confirmLink.alreadyApplied")}</p> : null}
                  </div>
                </div>
                {isReadOnlyResult ? whatsappButton : null}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default OrderConfirmationActionPage;
