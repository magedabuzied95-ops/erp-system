import {
  buildTikTokEventProperties,
  isTikTokOrderPlaced,
  isTikTokPaymentComplete,
  tiktokContentId,
  tiktokOrderEventId,
  tiktokRandomEventId,
} from "../../../shared/tiktokPixelEvent.js";
import { metaCurrentSellingPrice } from "./metaPixelEventPayload.js";

const env = import.meta.env || {};
export const TIKTOK_PIXEL_ID = String(env.VITE_TIKTOK_PIXEL_ID || "DB9980JC77UAEK31A0AG").trim();
const SDK_URL = "https://analytics.tiktok.com/i18n/pixel/events.js";
// A viewer who opted out of marketing tracking: the pixel is never loaded for them.
export const TIKTOK_CONSENT_STORAGE_KEY = "m1.tracking.consent";
const ORDER_STORAGE_PREFIX = "m1.tiktok.order.";

// Same gate as Meta and GA4: a local or preview session must not write into the live pixel.
const isLiveStorefrontHost = () => {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "m1store-egy.com" || host === "www.m1store-egy.com";
};

const consentAllowed = () => {
  if (typeof window === "undefined") return false;
  if (window.__M1_TRACKING_CONSENT__ === false) return false;
  try {
    return window.localStorage?.getItem(TIKTOK_CONSENT_STORAGE_KEY) !== "denied";
  } catch {
    return true;
  }
};

export const canTrackTikTok = () => Boolean(TIKTOK_PIXEL_ID) && isLiveStorefrontHost() && consentAllowed();

/* TikTok's official base code, minus its trailing ttq.page(): the SPA sends page views itself. */
const installBaseCode = (pixelId) => {
  /* eslint-disable */
  !(function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = (w[t] = w[t] || []);
    ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
    ttq.setAndDefer = function (t, e) {
      t[e] = function () {
        t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) {
      for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
      return e;
    };
    ttq.load = function (e, n) {
      var r = SDK_URL;
      ttq._i = ttq._i || {};
      ttq._i[e] = [];
      ttq._i[e]._u = r;
      ttq._t = ttq._t || {};
      ttq._t[e] = +new Date();
      ttq._o = ttq._o || {};
      ttq._o[e] = n || {};
      n = d.createElement("script");
      n.type = "text/javascript";
      n.async = !0;
      n.src = r + "?sdkid=" + e + "&lib=" + t;
      e = d.getElementsByTagName("script")[0];
      e.parentNode.insertBefore(n, e);
    };
    ttq.load(pixelId);
  })(window, document, "ttq");
  /* eslint-enable */
};

export const initTikTokPixel = () => {
  if (!canTrackTikTok()) return false;
  if (!window.__M1_TIKTOK_PIXEL_LOADED__) {
    // Another copy of the snippet (a tag manager, a pasted head script) already loaded this pixel.
    const alreadyLoaded = Boolean(window.ttq?._i?.[TIKTOK_PIXEL_ID]);
    if (!alreadyLoaded) installBaseCode(TIKTOK_PIXEL_ID);
    window.__M1_TIKTOK_PIXEL_LOADED__ = true;
  }
  return typeof window.ttq?.track === "function";
};

const text = (value = "") => String(value ?? "").trim();

// The last page view sent, like GA4: rerenders and effect replays of one navigation
// are dropped, a real return visit to the same page is not.
let lastPageViewPath = "";
const onceKeys = new Set();

const send = (eventName, properties, eventId) => {
  if (!properties || !initTikTokPixel()) return null;
  const id = eventId || tiktokRandomEventId(eventName);
  window.ttq.track(eventName, properties, { event_id: id });
  // Returned so a future server relay can send the same event with the same id.
  return { event: eventName, event_id: id, properties };
};

const lineContent = (item = {}) => {
  const product = item.product || item;
  const variant = item.variant || item.selected_variant || item;
  const id = tiktokContentId(product, variant);
  if (!id) return null;
  return {
    content_id: id,
    content_name: text(item.name || item.product_name || product.name || product.title),
    price: metaCurrentSellingPrice({ product, variant, line: item }),
    quantity: item.quantity || item.qty,
  };
};

export const trackTikTokPageView = (path = "") => {
  const pagePath = text(path || (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : ""));
  if (!pagePath || pagePath === lastPageViewPath || !initTikTokPixel()) return false;
  lastPageViewPath = pagePath;
  window.ttq.page();
  return true;
};

export const trackTikTokViewContent = ({ product = {}, variant = {}, value = null } = {}) => {
  const id = tiktokContentId(product, variant);
  if (!id || onceKeys.has(`ViewContent:${id}`)) return null;
  const price = metaCurrentSellingPrice({ product, variant, value });
  const sent = send("ViewContent", buildTikTokEventProperties({
    contents: [{ content_id: id, content_name: product.name || product.product_name || product.title, price, quantity: 1 }],
    value: price,
  }));
  if (sent) onceKeys.add(`ViewContent:${id}`);
  return sent;
};

export const trackTikTokAddToCart = ({ product = {}, variant = {}, line = null, quantity = 1 } = {}) => {
  const id = tiktokContentId(product, variant) || text(line?.meta_content_id || line?.sku);
  if (!id) return null;
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const price = metaCurrentSellingPrice({ product, variant, line });
  return send("AddToCart", buildTikTokEventProperties({
    contents: [{ content_id: id, content_name: line?.name || product.name || product.title, price, quantity: qty }],
    value: price * qty,
  }));
};

export const trackTikTokInitiateCheckout = ({ items = [], value = 0 } = {}) => {
  const contents = (Array.isArray(items) ? items : []).map(lineContent).filter(Boolean);
  const key = `InitiateCheckout:${contents.map((line) => `${line.content_id}x${line.quantity}`).join("|")}`;
  if (!contents.length || onceKeys.has(key)) return null;
  const sent = send("InitiateCheckout", buildTikTokEventProperties({ contents, value }));
  if (sent) onceKeys.add(key);
  return sent;
};

// One order is reported once per event per browser, even across reloads of the success page.
const orderEventOnce = (eventName, order, items, value) => {
  const storageKey = `${ORDER_STORAGE_PREFIX}${eventName}.${text(order.id || order.order_id || order.invoice_number || order.order_number)}`;
  if (onceKeys.has(storageKey)) return null;
  try {
    if (window.localStorage?.getItem(storageKey)) return null;
  } catch {
    // Blocked storage: the in-memory set still stops repeats in this tab.
  }
  const contents = (Array.isArray(items) ? items : []).map(lineContent).filter(Boolean);
  const sent = send(eventName, buildTikTokEventProperties({ contents, value }), tiktokOrderEventId(eventName, order));
  if (!sent) return null;
  onceKeys.add(storageKey);
  try {
    window.localStorage?.setItem(storageKey, "1");
  } catch {
    // Tracking must never break checkout.
  }
  return sent;
};

// The order exists (COD, awaiting a transfer, ...): not a payment yet.
export const trackTikTokPlaceAnOrder = ({ order = {}, items = [], value = 0 } = {}) =>
  isTikTokOrderPlaced(order) ? orderEventOnce("PlaceAnOrder", order, items, value) : null;

// Only when the server says the order is paid.
export const trackTikTokCompletePayment = ({ order = {}, items = [], value = 0 } = {}) =>
  isTikTokPaymentComplete(order) ? orderEventOnce("CompletePayment", order, items, value) : null;

export const trackTikTokOrder = (args = {}) => {
  const placed = trackTikTokPlaceAnOrder(args);
  const paid = trackTikTokCompletePayment(args);
  return { placed, paid };
};

export const __resetTikTokGuardsForTests = () => {
  lastPageViewPath = "";
  onceKeys.clear();
};
