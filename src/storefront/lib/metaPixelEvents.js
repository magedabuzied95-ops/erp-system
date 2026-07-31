import { storefrontCustomerRequest } from "./storefrontCustomerAuth";
import { initMetaPixel } from "../../shared/lib/metaPixel";
import { captureMetaBrowserIdentity } from "../../shared/lib/metaBrowserAttribution";
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

const PURCHASE_STORAGE_PREFIX = "m1.meta.purchase.";

const text = (value = "") => String(value ?? "").trim();

const eventId = (eventName = "") =>
  `m1_${text(eventName).toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;


const sendCapi = (eventName, payload) =>
  storefrontCustomerRequest("/storefront/meta/events", {
    method: "POST",
    body: { event_name: eventName, ...payload },
  }).catch(() => undefined);

const eventIdFor = (eventName = "") => eventId(eventName);

const track = (eventName, payload = {}) => {
  const browserIdentity = captureMetaBrowserIdentity();
  const eventPayload = buildMetaEventPayload({
    ...payload,
    eventId: payload.eventId || eventIdFor(eventName),
    customer: payload.customer || {},
  });
  if (!eventPayload) return null;
  if (browserIdentity.fbp) eventPayload.fbp = browserIdentity.fbp;
  if (browserIdentity.fbc) eventPayload.fbc = browserIdentity.fbc;
  if (!eventPayload.external_id && browserIdentity.externalId) {
    eventPayload.external_id = browserIdentity.externalId;
  }
  const {
    event_id: id,
    email,
    phone,
    first_name,
    last_name,
    city,
    state,
    country,
    external_id,
    fbp,
    fbc,
    ...browserPayload
  } = eventPayload;
  browserPayload.event_source_url = typeof window !== "undefined" ? window.location.href : "";
  if (initMetaPixel(payload.customer || {}) && typeof window.fbq === "function") {
    window.fbq("track", eventName, browserPayload, { eventID: id });
  }
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

export const trackMetaInitiateCheckout = ({ items = [], value = 0, customer = {} } = {}) => {
  const contents = (Array.isArray(items) ? items : []).map(metaLineContent).filter(Boolean);
  if (!contents.length) return null;
  return track("InitiateCheckout", {
    contentIds: contents.map((item) => item.id),
    contents,
    numItems: contents.reduce((total, item) => total + Number(item.quantity || 0), 0),
    value: metaPurchaseValue({ value, items }),
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
