const env = import.meta.env || {};
export const GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID = Number(
  env.VITE_GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID || 5829421968
);
export const GOOGLE_CUSTOMER_REVIEWS_SCRIPT_ID = "m1-google-customer-reviews-platform";
export const GOOGLE_CUSTOMER_REVIEWS_SCRIPT_URL = "https://apis.google.com/js/platform.js?onload=renderOptIn";

const renderedOrders = new Set();
const inFlightOrders = new Map();
let scriptPromise = null;
const blockedOrderStatuses = new Set(["cancelled", "canceled", "failed", "payment_failed", "draft", "incomplete", "abandoned"]);

const text = (value = "") => String(value ?? "").trim();
export const isValidSurveyEmail = (value = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value).toLowerCase());
export const isCustomerReviewOrderEligible = (order = {}) =>
  Boolean(text(order.id || order.invoice_number || order.public_order_number)) &&
  !blockedOrderStatuses.has(text(order.status).toLowerCase());

const storageKey = (orderId) => `m1.google-customer-reviews.opt-in.${text(orderId)}`;
const wasRendered = (orderId) => {
  if (renderedOrders.has(text(orderId))) return true;
  try {
    return window.localStorage.getItem(storageKey(orderId)) === "rendered";
  } catch {
    return false;
  }
};
const markRendered = (orderId) => {
  renderedOrders.add(text(orderId));
  try {
    window.localStorage.setItem(storageKey(orderId), "rendered");
  } catch {
    // In-memory deduplication remains active when storage is unavailable.
  }
};

export const isCustomerReviewPayloadValid = (payload = {}) =>
  Number(payload.merchant_id) === GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID &&
  text(payload.order_id) &&
  isValidSurveyEmail(payload.email) &&
  payload.delivery_country === "EG" &&
  /^\d{4}-\d{2}-\d{2}$/.test(text(payload.estimated_delivery_date));

const waitForGapi = (timeoutMs = 15000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (window.gapi?.load) return resolve(window.gapi);
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error("Google Customer Reviews script did not become ready"));
      window.setTimeout(check, 50);
    };
    check();
  });

export const loadGoogleCustomerReviewsScript = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new Error("Browser unavailable"));
  if (window.gapi?.load) return Promise.resolve(window.gapi);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const previousCallback = window.renderOptIn;
    window.renderOptIn = () => {
      if (typeof previousCallback === "function") previousCallback();
      waitForGapi().then(resolve).catch(reject);
    };
    const existing = document.getElementById(GOOGLE_CUSTOMER_REVIEWS_SCRIPT_ID) ||
      document.querySelector('script[src^="https://apis.google.com/js/platform.js"]');
    if (existing) {
      waitForGapi().then(resolve).catch(reject);
      return;
    }
    const script = document.createElement("script");
    script.id = GOOGLE_CUSTOMER_REVIEWS_SCRIPT_ID;
    script.src = GOOGLE_CUSTOMER_REVIEWS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Google Customer Reviews script failed to load"));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
};

export const renderGoogleCustomerReviewOptIn = (payload = {}) => {
  if (typeof window === "undefined" || !isCustomerReviewPayloadValid(payload)) return Promise.resolve(false);
  const orderId = text(payload.order_id);
  if (wasRendered(orderId)) return Promise.resolve(false);
  if (inFlightOrders.has(orderId)) return inFlightOrders.get(orderId);

  const task = loadGoogleCustomerReviewsScript()
    .then((gapi) => new Promise((resolve, reject) => {
      gapi.load("surveyoptin", () => {
        try {
          if (!window.gapi?.surveyoptin?.render) throw new Error("Google Customer Reviews survey module unavailable");
          markRendered(orderId);
          window.gapi.surveyoptin.render({
            merchant_id: GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID,
            order_id: orderId,
            email: text(payload.email).toLowerCase(),
            delivery_country: "EG",
            estimated_delivery_date: text(payload.estimated_delivery_date),
            ...(Array.isArray(payload.products) && payload.products.length ? { products: payload.products } : {}),
            opt_in_style: "CENTER_DIALOG",
          });
          resolve(true);
        } catch (error) {
          renderedOrders.delete(orderId);
          try {
            window.localStorage.removeItem(storageKey(orderId));
          } catch {
            // No-op.
          }
          reject(error);
        }
      });
    }))
    .catch(() => false)
    .finally(() => inFlightOrders.delete(orderId));
  inFlightOrders.set(orderId, task);
  return task;
};

export const __resetGoogleCustomerReviewsForTests = () => {
  renderedOrders.clear();
  inFlightOrders.clear();
  scriptPromise = null;
};
