import { storefrontCustomerRequest } from "./storefrontCustomerAuth";
import {
  buildMetaEventPayload,
  canTrackMetaPurchase,
  createMetaEventOnceGuard,
  isMetaPurchaseEligible,
  metaCatalogContentId,
  metaCurrentSellingPrice,
  metaLineContent,
  metaPurchaseValue,
  purchaseEventId,
} from "./metaPixelEventPayload";

export {
  buildMetaEventPayload,
  canTrackMetaPurchase,
  createMetaEventOnceGuard,
  isMetaPurchaseEligible,
  metaCatalogContentId,
  metaCurrentSellingPrice,
  purchaseEventId,
};

const env = import.meta.env || {};
const PIXEL_ID = String(env.VITE_M1_META_PIXEL_ID || env.VITE_META_PIXEL_ID || "2459469681170451").trim();
const TEST_EVENT_CODE = String(env.VITE_META_TEST_EVENT_CODE || "").trim();
const PURCHASE_STORAGE_PREFIX = "m1.meta.purchase.";
const META_VISITOR_ID_KEY = "m1.meta.visitor_id";

const text = (value = "") => String(value ?? "").trim();

const eventId = (eventName = "") =>
  `m1_${text(eventName).toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;


const ensurePixel = () => {
  if (typeof window === "undefined" || !PIXEL_ID) return false;
  if (typeof window.fbq === "function") return true;
  window.fbq = function fbq() {
    window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments);
  };
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.version = "2.0";
  window.fbq.queue = [];
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  window.fbq("init", PIXEL_ID);
  return true;
};

const sendCapi = (eventName, payload) =>
  storefrontCustomerRequest("/storefront/meta/events", {
    method: "POST",
    body: { event_name: eventName, test_event_code: TEST_EVENT_CODE || undefined, ...payload },
  }).catch(() => undefined);

const eventIdFor = (eventName = "") => eventId(eventName);

const cookieValue = (name = "") => {
  if (typeof document === "undefined") return "";
  return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
};

const metaVisitorId = () => {
  if (typeof window === "undefined") return "";
  try {
    const stored = String(window.localStorage.getItem(META_VISITOR_ID_KEY) || "").trim();
    if (stored) return stored;
    const created = globalThis.crypto?.randomUUID?.() || `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
    window.localStorage.setItem(META_VISITOR_ID_KEY, created);
    return created;
  } catch {
    return "";
  }
};

const metaBrowserIdentity = () => {
  if (typeof window === "undefined") return {};
  const fbclid = new URLSearchParams(window.location.search).get("fbclid") || "";
  let fbc = cookieValue("_fbc");
  if (!fbc && fbclid) {
    fbc = `fb.1.${Date.now()}.${fbclid}`;
    document.cookie = `_fbc=${encodeURIComponent(fbc)}; Max-Age=7776000; Path=/; SameSite=Lax; Secure`;
  }
  return {
    fbp: decodeURIComponent(cookieValue("_fbp") || ""),
    fbc: decodeURIComponent(fbc || ""),
    external_id: metaVisitorId(),
  };
};

const track = (eventName, payload = {}) => {
  const browserIdentity = metaBrowserIdentity();
  const eventPayload = buildMetaEventPayload({
    ...payload,
    eventId: payload.eventId || eventIdFor(eventName),
    customer: {
      ...(payload.customer || {}),
      external_id: payload.customer?.external_id || browserIdentity.external_id,
    },
  });
  if (!eventPayload) return null;
  eventPayload.fbp = browserIdentity.fbp;
  eventPayload.fbc = browserIdentity.fbc;
  const { event_id: id, email, phone, first_name, last_name, external_id, fbp, fbc, ...browserPayload } = eventPayload;
  if (ensurePixel()) window.fbq("track", eventName, browserPayload, { eventID: id });
  if (typeof window !== "undefined") {
    void sendCapi(eventName, { ...eventPayload, event_source_url: window.location.href });
  }
  return eventPayload;
};

export const trackMetaViewContent = ({ product = {}, variant = {}, value = null, customer = {} } = {}) => {
  const contentId = metaCatalogContentId(product, variant);
  return track("ViewContent", {
    contentIds: contentId ? [contentId] : [],
    contentName: product.name || product.product_name || product.title,
    value: metaCurrentSellingPrice({ product, variant, value }),
    customer,
  });
};

export const trackMetaAddToCart = ({ product = {}, variant = {}, line = null, quantity = 1, customer = {} } = {}) => {
  const contentId = metaCatalogContentId(product, variant) || text(line?.sku || line?.variant_sku);
  const safeQuantity = Math.max(1, Math.floor(Number((line?.quantity ?? line?.qty ?? quantity) || 1) || 1));
  const unitPrice = metaCurrentSellingPrice({ product, variant, line });
  return track("AddToCart", {
    contentIds: contentId ? [contentId] : [],
    contentName: product.name || product.product_name || product.title || line?.name || line?.product_name,
    contents: contentId ? [{ id: contentId, quantity: safeQuantity, item_price: unitPrice }] : [],
    value: unitPrice * safeQuantity,
    customer,
  });
};

export const trackMetaPurchase = ({ items = [], value = 0, customer = {}, order = {} } = {}) => {
  if (!isMetaPurchaseEligible(order)) return null;
  const orderId = text(order.id || order.order_id || order.invoice_number || order.order_number);
  if (!orderId) return null;
  const storageKey = `${PURCHASE_STORAGE_PREFIX}${orderId}`;
  if (typeof window !== "undefined" && window.sessionStorage?.getItem(storageKey)) return null;
  const contents = (Array.isArray(items) ? items : []).map(metaLineContent).filter(Boolean);
  const purchaseValue = metaPurchaseValue({ value, items });
  if (purchaseValue <= 0) return null;
  const payload = track("Purchase", {
    contentIds: contents.map((item) => item.id),
    contents,
    numItems: contents.reduce((total, item) => total + Number(item.quantity || 0), 0),
    value: purchaseValue,
    eventId: purchaseEventId(order),
    customer: { ...customer, external_id: customer.customer_id || customer.id || order.customer_id },
  });
  if (payload && typeof window !== "undefined") window.sessionStorage?.setItem(storageKey, "1");
  return payload;
};
