import { api } from "../../shared/api/api";
import {
  buildMetaEventPayload,
  canTrackMetaPurchase,
  createMetaEventOnceGuard,
  isMetaPurchaseEligible,
  metaCatalogContentId,
  metaCurrentSellingPrice,
  metaLineContent,
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
  api.post("/storefront/meta/events", { event_name: eventName, test_event_code: TEST_EVENT_CODE || undefined, ...payload }).catch(() => undefined);

const eventIdFor = (eventName = "") => eventId(eventName);

const track = (eventName, payload = {}) => {
  const eventPayload = buildMetaEventPayload({ ...payload, eventId: payload.eventId || eventIdFor(eventName) });
  if (!eventPayload) return null;
  const { event_id: id, email, phone, first_name, last_name, external_id, ...browserPayload } = eventPayload;
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
  const payload = track("Purchase", {
    contentIds: contents.map((item) => item.id),
    contents,
    numItems: contents.reduce((total, item) => total + Number(item.quantity || 0), 0),
    value,
    eventId: purchaseEventId(order),
    customer: { ...customer, external_id: customer.customer_id || customer.id || order.customer_id },
  });
  if (payload && typeof window !== "undefined") window.sessionStorage?.setItem(storageKey, "1");
  return payload;
};
