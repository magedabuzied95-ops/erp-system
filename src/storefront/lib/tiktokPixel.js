import {
  TIKTOK_EVENTS,
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
// The ad click id lands on the first page only; checkout is pages later, so it is kept.
const TTCLID_STORAGE_KEY = "m1.tiktok.ttclid";
const TTCLID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

const rememberClickId = () => {
  try {
    const ttclid = new URLSearchParams(window.location.search).get("ttclid") || "";
    if (ttclid) window.localStorage?.setItem(TTCLID_STORAGE_KEY, JSON.stringify({ value: ttclid.slice(0, 500), at: Date.now() }));
  } catch {
    // Blocked storage: the server event simply goes without the click id.
  }
};

const storedClickId = () => {
  try {
    const stored = JSON.parse(window.localStorage?.getItem(TTCLID_STORAGE_KEY) || "null");
    return stored?.value && Date.now() - Number(stored.at || 0) < TTCLID_MAX_AGE_MS ? String(stored.value) : "";
  } catch {
    return "";
  }
};

const cookie = (name) => {
  try {
    const part = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
  } catch {
    return "";
  }
};

/*
 * What the checkout forwards so the server's Events API copy of the order can be matched
 * to the ad: the pixel's _ttp cookie and the stored click id. The API host is another
 * origin, so neither reaches it on its own. consent:false tells the server to send
 * nothing to TikTok for this order, ever (its Purchase included).
 */
export const captureTikTokIdentity = () => {
  if (typeof window === "undefined") return { consent: false };
  if (!canTrackTikTok()) return { consent: false };
  return {
    consent: true,
    ttp: cookie("_ttp").slice(0, 200),
    ttclid: storedClickId(),
    page_url: String(window.location.href || "").slice(0, 1000),
    referrer: String(typeof document !== "undefined" ? document.referrer || "" : "").slice(0, 1000),
  };
};

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
    rememberClickId();
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

// The order exists (COD, awaiting a transfer, ...): not a payment yet. The server's
// Events API sends the same event with the same id; TikTok keeps one.
export const trackTikTokPlaceAnOrder = ({ order = {}, items = [], value = 0 } = {}) =>
  isTikTokOrderPlaced(order) ? orderEventOnce(TIKTOK_EVENTS.placeAnOrder, order, items, value) : null;

// Only when the server says the order is paid. TikTok's standard event for that is Purchase.
export const trackTikTokPurchase = ({ order = {}, items = [], value = 0 } = {}) =>
  isTikTokPaymentComplete(order) ? orderEventOnce(TIKTOK_EVENTS.purchase, order, items, value) : null;

export const trackTikTokOrder = (args = {}) => {
  const placed = trackTikTokPlaceAnOrder(args);
  const paid = trackTikTokPurchase(args);
  return { placed, paid };
};

export const __resetTikTokGuardsForTests = () => {
  lastPageViewPath = "";
  onceKeys.clear();
};
