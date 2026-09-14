/*
 * What the shopper reads when the server answers a storefront request. Server messages are for
 * logs and staff tools (the POS and the AI inbox show some of them); they are written in one
 * language and some are bare codes ("INVALID_EMAIL_OR_PASSWORD"). The storefront never toasts
 * them: each helper turns the stable parts of a response — the error code, the field, the HTTP
 * status — into a "storefront.*" copy key (plus interpolation values) and falls back to a generic
 * key for anything it does not know. Framework-free so the mapping can be tested on its own.
 */

const statusOf = (error) => Number(error?.status || error?.response?.status || 0);
const bodyOf = (error) => error?.responseBody || error?.response?.data || {};
const codeOf = (error) => {
  const body = bodyOf(error);
  return String(body.error_code || body.error || body.code || "").trim().toUpperCase();
};

// Error codes the customer auth routes answer with (error / error_code), by the copy they need.
export const STOREFRONT_AUTH_ERROR_KEYS = {
  INVALID_EMAIL_OR_PASSWORD: "storefront.auth.loginInvalid",
  INVALID_EMAIL_AUTH_LOGIN_PAYLOAD: "storefront.auth.loginFieldsRequired",
  ACCOUNT_DISABLED: "storefront.auth.accountDisabled",
  EMAIL_ALREADY_EXISTS: "storefront.auth.emailAlreadyExists",
  PHONE_ALREADY_REGISTERED: "storefront.auth.phoneAlreadyRegistered",
  INVALID_EMAIL_AUTH_REGISTER_PAYLOAD: "storefront.auth.registerFieldsRequired",
  INVALID_PASSWORD_RESET_REQUEST: "storefront.auth.emailRequired",
  INVALID_PASSWORD_RESET_PAYLOAD: "storefront.auth.resetLinkInvalid",
  INVALID_OR_EXPIRED_RESET_TOKEN: "storefront.auth.resetLinkExpired",
  INVALID_OR_EXPIRED_OTP: "storefront.auth.otpInvalid",
  OTP_SEND_FAILED: "storefront.auth.otpSendFailed",
  OTP_COOLDOWN: "storefront.auth.otpCooldown",
  OTP_RATE_LIMITED: "storefront.auth.tooManyAttempts",
};

/**
 * { key, options } for a failed /storefront/auth/* request. `fallbackKey` is the action's own
 * generic failure ("storefront.auth.registerFailed", ...), used for unknown codes and network errors.
 */
export const storefrontAuthErrorCopy = (error, fallbackKey = "storefront.auth.otpSendFailed") => {
  const code = codeOf(error);
  const key = STOREFRONT_AUTH_ERROR_KEYS[code];
  const retryAfter = Math.max(1, Math.round(Number(bodyOf(error).retry_after_seconds || 60)));
  if (key) {
    return code === "OTP_COOLDOWN" || code === "OTP_RATE_LIMITED" ? { key, options: { seconds: retryAfter } } : { key, options: {} };
  }
  // A 429 without a code: an older server's OTP cooldown, or a rate limiter in front of the route.
  if (statusOf(error) === 429) return { key: "storefront.auth.tooManyAttempts", options: { seconds: retryAfter } };
  return { key: fallbackKey, options: {} };
};

// Checkout refusals from createWebsiteOrder, by the field the server names. A function receives the
// response status for fields that carry more than one refusal.
const CHECKOUT_FIELD_KEYS = {
  items: "storefront.checkout.errors.emptyCart",
  "items.variant_id": "storefront.toasts.variantUnavailable",
  "items.price": "storefront.toasts.priceUnavailable",
  full_name: "storefront.validation.fullNameRequired",
  primary_phone: "storefront.validation.phoneRequired",
  governorate: "storefront.validation.governorateRequired",
  city_area: "storefront.validation.cityAreaRequired",
  detailed_address: "storefront.validation.addressRequired",
  street_address: "storefront.validation.streetAddressRequired",
  building_number: "storefront.validation.buildingNumberRequired",
  email: "storefront.validation.invalidEmailOptional",
  secondary_phone: "storefront.validation.invalidSecondaryPhone",
  shipping_payment_screenshot: "storefront.toasts.invalidTransferProof",
  delivery_fee: "storefront.cart.repriceCheckoutRetry",
  paid_amount: "storefront.cart.repriceCheckoutRetry",
  payment_method: (status) =>
    status === 503 ? "storefront.checkout.errors.onlinePaymentUnavailable"
      : status === 403 ? "storefront.checkout.errors.codDisabled"
        : "storefront.checkout.errors.paymentMethodUnsupported",
  shipping_method: (status) => (status === 403 ? "storefront.checkout.errors.pickupDisabled" : "storefront.checkout.errors.shippingMethodUnsupported"),
};

export const STOREFRONT_CHECKOUT_ERROR_FIELDS = Object.keys(CHECKOUT_FIELD_KEYS).concat("items.quantity");

/** { key, options } for a refused checkout; coupon refusals keep their own reason copy. */
export const storefrontCheckoutErrorCopy = (error) => {
  const body = bodyOf(error);
  const field = String(body.field || "").trim().toLowerCase();
  const details = body.details || {};
  if (field === "items.quantity") {
    const available = Math.max(0, Number(details.available_stock ?? 0) || 0);
    const product = String(details.product_name || "").trim();
    return {
      key: product ? "storefront.checkout.errors.stockShort" : "storefront.checkout.errors.stockShortUnnamed",
      options: { available: String(available), product },
    };
  }
  const entry = CHECKOUT_FIELD_KEYS[field];
  const key = typeof entry === "function" ? entry(statusOf(error)) : entry;
  return { key: key || "storefront.toasts.checkoutFailed", options: {} };
};

// The order tracking stages buildOrderTimeline sends, by key.
export const STOREFRONT_TRACKING_STAGE_KEYS = ["received", "confirmed", "ready_to_ship", "shipment_created", "out_for_delivery", "delivered"];

/** The copy key for a timeline step the server sent, or "" when the step is not a known stage. */
export const trackingStageKey = (step = {}) => {
  const key = String(step?.key || "").trim();
  return STOREFRONT_TRACKING_STAGE_KEYS.includes(key) ? `storefront.tracking.stages.${key}` : "";
};

/** The copy key for a failed image search: too big, wrong/empty image, or the service being down. */
export const visualSearchErrorKey = (error) => {
  const status = statusOf(error);
  const code = codeOf(error);
  if (status === 413 || code === "IMAGE_TOO_LARGE") return "storefront.toasts.imageTooLarge";
  if (code === "IMAGE_REQUIRED") return "storefront.toasts.emptyImage";
  if (status === 400 || code === "UNSUPPORTED_IMAGE_TYPE") return "storefront.toasts.unsupportedImageType";
  return "storefront.visualSearch.unavailableRetry";
};

/** The line under "Similar products": the error, or what the matches say about the photo. */
export const visualSearchSubtitleKey = (visualSearch = {}) => {
  const error = String(visualSearch?.error || "");
  if (error) return error.startsWith("storefront.") ? error : "storefront.visualSearch.unavailableRetry";
  const exact = Array.isArray(visualSearch?.exactMatches) ? visualSearch.exactMatches.length : 0;
  const similar = Array.isArray(visualSearch?.similarMatches) ? visualSearch.similarMatches.length : 0;
  if (exact && Number(visualSearch?.confidence || 0) >= 80) return "storefront.visualSearch.foundExact";
  if (similar) return "storefront.visualSearch.notAvailableClosest";
  if (exact) return "storefront.visualSearch.resultsFromImage";
  return "storefront.visualSearch.modelUnavailable";
};
