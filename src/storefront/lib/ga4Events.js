import {
  buildGa4Item,
  buildGa4PurchasePayload,
  ga4CartPayload,
  ga4OrderId,
  isGa4PurchaseEligible,
} from "./ga4EventPayload.js";

const env = import.meta.env || {};
export const GA4_MEASUREMENT_ID = String(
  env.VITE_GA4_MEASUREMENT_ID || env.VITE_GOOGLE_ANALYTICS_ID || "G-J47KZ3W60P"
).trim();
const SCRIPT_ID = "m1-ga4-google-tag";
const PURCHASE_STORAGE_PREFIX = "m1.ga4.purchase.";
const pageViews = new Set();
const onceEvents = new Set();

const isPublicStorefrontHost = () => {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "m1store-egy.com" || host === "www.m1store-egy.com" || host === "localhost" || host === "127.0.0.1";
};

export const ensureGoogleTag = () => {
  if (typeof window === "undefined" || typeof document === "undefined" || !GA4_MEASUREMENT_ID || !isPublicStorefrontHost()) return false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  if (!window.__M1_GA4_CONFIGURED__) {
    window.gtag("js", new Date());
    window.gtag("config", GA4_MEASUREMENT_ID, { send_page_view: false });
    window.__M1_GA4_CONFIGURED__ = true;
  }
  const existing =
    document.getElementById(SCRIPT_ID) ||
    document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}"]`);
  if (!existing) {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`;
    document.head.appendChild(script);
  }
  return true;
};

const send = (eventName, payload = {}) => {
  if (!ensureGoogleTag()) return null;
  window.gtag("event", eventName, payload);
  return payload;
};

const sendOnce = (eventName, key, payload) => {
  const signature = `${eventName}:${String(key || "").trim()}`;
  if (!key || onceEvents.has(signature)) return null;
  onceEvents.add(signature);
  return send(eventName, payload);
};

export const trackGa4PageView = ({ path = "", title = "", location = "" } = {}) => {
  const pagePath = String(path || (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "")).trim();
  if (!pagePath || pageViews.has(pagePath)) return null;
  pageViews.add(pagePath);
  return send("page_view", {
    page_path: pagePath,
    page_title: title || (typeof document !== "undefined" ? document.title : ""),
    page_location: location || (typeof window !== "undefined" ? window.location.href : ""),
  });
};

export const trackGa4ViewItem = ({ product = {}, variant = {}, price = null } = {}) => {
  const item = buildGa4Item({ product, variant, price });
  if (!item) return null;
  return sendOnce("view_item", item.item_id, { currency: "EGP", value: item.price, items: [item] });
};

export const trackGa4AddToCart = ({ product = {}, variant = {}, line = null, quantity = 1 } = {}) => {
  const item = buildGa4Item({ product, variant, line, quantity });
  if (!item) return null;
  return send("add_to_cart", { currency: "EGP", value: item.price * item.quantity, items: [item] });
};

export const trackGa4ViewCart = (items = []) => {
  const payload = ga4CartPayload(items);
  return payload.items.length ? send("view_cart", payload) : null;
};

export const trackGa4BeginCheckout = (items = [], extras = {}) => {
  const payload = ga4CartPayload(items, extras);
  const key = payload.items.map((item) => `${item.item_id}:${item.quantity}`).join("|");
  return payload.items.length ? sendOnce("begin_checkout", key, payload) : null;
};

export const trackGa4ShippingInfo = (items = [], extras = {}) => {
  const payload = ga4CartPayload(items, extras);
  const shippingTier = String(extras.shipping_tier || extras.shippingTier || "").trim();
  const key = `${payload.items.map((item) => item.item_id).join("|")}:${shippingTier}:${Number(extras.shipping || 0)}`;
  return payload.items.length
    ? sendOnce("add_shipping_info", key, { ...payload, ...(shippingTier ? { shipping_tier: shippingTier } : {}) })
    : null;
};

export const trackGa4PaymentInfo = (items = [], extras = {}) => {
  const payload = ga4CartPayload(items, extras);
  const paymentType = String(extras.payment_type || extras.paymentType || "").trim();
  const key = `${payload.items.map((item) => item.item_id).join("|")}:${paymentType}`;
  return payload.items.length
    ? sendOnce("add_payment_info", key, { ...payload, ...(paymentType ? { payment_type: paymentType } : {}) })
    : null;
};

export const trackGa4Purchase = ({ order = {}, items = [], checkout = {}, value = null } = {}) => {
  if (!isGa4PurchaseEligible(order)) return null;
  const orderId = ga4OrderId(order);
  const storageKey = `${PURCHASE_STORAGE_PREFIX}${orderId}`;
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage?.getItem(storageKey)) return null;
    } catch {
      // Storage may be blocked; the in-memory guard below still prevents render duplicates.
    }
  }
  const payload = buildGa4PurchasePayload({ order, items, checkout, value });
  if (!payload) return null;
  const sent = sendOnce("purchase", orderId, payload);
  if (sent && typeof window !== "undefined") {
    try {
      window.localStorage?.setItem(storageKey, "1");
    } catch {
      // Tracking must not break checkout in restricted storage modes.
    }
  }
  return sent;
};

export const __resetGa4GuardsForTests = () => {
  pageViews.clear();
  onceEvents.clear();
};
