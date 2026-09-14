import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Storefront audit group 6 (language): the shopper reads server refusals, tracking stages, image-search
// status, colour names, product types and prices in one language — never a raw code or the other one.

const {
  STOREFRONT_AUTH_ERROR_KEYS,
  STOREFRONT_CHECKOUT_ERROR_FIELDS,
  STOREFRONT_TRACKING_STAGE_KEYS,
  storefrontAuthErrorCopy,
  storefrontCheckoutErrorCopy,
  trackingStageKey,
  visualSearchErrorKey,
  visualSearchSubtitleKey,
} = await import("../src/storefront/lib/serverCopy.js");
const { localizeColorName } = await import("../src/storefront/lib/displayCopy.js");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to > from ? to : undefined);
};
const locales = {
  ar: JSON.parse(read("../src/locales/ar/storefront.json")),
  en: JSON.parse(read("../src/locales/en/storefront.json")),
};
const lookup = (lang, key) => key.replace(/^storefront\./, "").split(".").reduce((node, part) => node?.[part], locales[lang]);
const ARABIC = /[؀-ۿ]/;
const placeholders = (value) => [...String(value).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();

const assertKeyInBothLanguages = (key) => {
  const ar = lookup("ar", key);
  const en = lookup("en", key);
  assert.equal(typeof ar, "string", `${key} missing in ar`);
  assert.equal(typeof en, "string", `${key} missing in en`);
  assert.ok(ar.trim() && en.trim(), `${key} is empty`);
  assert.match(ar, ARABIC, `${key} (ar) has no Arabic letters`);
  assert.doesNotMatch(en, ARABIC, `${key} (en) has Arabic letters`);
  assert.deepEqual(placeholders(ar), placeholders(en), `${key} placeholders differ between languages`);
};

const error = (status, body = {}) => ({ status, responseBody: body, message: body.message || body.error || "Request failed" });

const NEW_KEYS = [
  "storefront.auth.accountDisabled",
  "storefront.auth.emailAlreadyExists",
  "storefront.auth.phoneAlreadyRegistered",
  "storefront.auth.resetLinkExpired",
  "storefront.auth.otpCooldown",
  "storefront.auth.tooManyAttempts",
  "storefront.checkout.errors.emptyCart",
  "storefront.checkout.errors.stockShort",
  "storefront.checkout.errors.stockShortUnnamed",
  "storefront.checkout.errors.onlinePaymentUnavailable",
  "storefront.checkout.errors.codDisabled",
  "storefront.checkout.errors.paymentMethodUnsupported",
  "storefront.checkout.errors.pickupDisabled",
  "storefront.checkout.errors.shippingMethodUnsupported",
  ...STOREFRONT_TRACKING_STAGE_KEYS.map((key) => `storefront.tracking.stages.${key}`),
];

test("every new key exists in both languages, in the right script, with the same placeholders", () => {
  NEW_KEYS.forEach(assertKeyInBothLanguages);
  assert.match(lookup("en", "storefront.checkout.errors.stockShort"), /\{\{available\}\}.*\{\{product\}\}/);
  assert.match(lookup("en", "storefront.auth.otpCooldown"), /\{\{seconds\}\}/);
});

test("every key a server response can map to resolves in both languages", () => {
  const keys = new Set(Object.values(STOREFRONT_AUTH_ERROR_KEYS));
  ["storefront.auth.otpSendFailed", "storefront.auth.otpInvalid", "storefront.auth.registerFailed", "storefront.auth.loginInvalid", "storefront.auth.resetSendFailed", "storefront.auth.passwordUpdateFailed", "storefront.toasts.accountUnavailable"].forEach((key) => keys.add(key));
  for (const field of STOREFRONT_CHECKOUT_ERROR_FIELDS) {
    for (const status of [400, 403, 409, 422, 503]) {
      keys.add(storefrontCheckoutErrorCopy(error(status, { field, details: { available_stock: 1, product_name: "X" } })).key);
      keys.add(storefrontCheckoutErrorCopy(error(status, { field, details: {} })).key);
    }
  }
  keys.add(storefrontCheckoutErrorCopy(error(500, {})).key);
  [413, 400, 500, 0].forEach((status) => keys.add(visualSearchErrorKey(error(status, {}))));
  keys.add(visualSearchErrorKey(error(400, { error_code: "IMAGE_REQUIRED" })));
  [
    {},
    { exactMatches: [{}], confidence: 90 },
    { exactMatches: [{}], confidence: 40 },
    { similarMatches: [{}] },
    { error: "not a key" },
  ].forEach((state) => keys.add(visualSearchSubtitleKey(state)));
  for (const key of keys) assertKeyInBothLanguages(key);
});

test("auth: every code the customer auth service and routes answer with has copy, and no raw message leaks", () => {
  const service = read("../server/services/storefrontCustomerEmailAuthService.js");
  const routes = between(read("../server/routes/storefront.js"), 'router.post("/auth/request-otp"', 'router.get("/settings"');
  const codes = new Set([
    ...[...service.matchAll(/error\.code = "([A-Z_]+)"/g)].map((match) => match[1]),
    ...[...routes.matchAll(/\berror: "([A-Z_]+)"/g)].map((match) => match[1]),
  ]);
  assert.ok(codes.has("INVALID_EMAIL_OR_PASSWORD") && codes.has("INVALID_OR_EXPIRED_OTP") && codes.has("OTP_COOLDOWN"));
  for (const code of codes) {
    assert.ok(STOREFRONT_AUTH_ERROR_KEYS[code], `no copy for ${code}`);
    const copy = storefrontAuthErrorCopy(error(400, { error: code, message: code }), "storefront.auth.loginInvalid");
    assert.equal(copy.key, STOREFRONT_AUTH_ERROR_KEYS[code]);
  }
  assert.deepEqual(storefrontAuthErrorCopy(error(429, { error: "OTP_COOLDOWN", retry_after_seconds: 42 })), { key: "storefront.auth.otpCooldown", options: { seconds: 42 } });
  assert.equal(storefrontAuthErrorCopy(error(429, { message: "محاولات كثيرة" })).key, "storefront.auth.tooManyAttempts");
  assert.equal(storefrontAuthErrorCopy(error(500, { message: "boom" }), "storefront.auth.registerFailed").key, "storefront.auth.registerFailed");
  assert.equal(storefrontAuthErrorCopy(new TypeError("Failed to fetch"), "storefront.auth.otpInvalid").key, "storefront.auth.otpInvalid");

  const page = read("../src/storefront/pages/StorefrontAccountPage.jsx");
  assert.doesNotMatch(page, /toast\.error\(\s*error\??\.message/);
  assert.equal((page.match(/toastAuthError\(error, "storefront\.auth\.\w+"\)/g) || []).length, 6);
});

test("checkout: every field createWebsiteOrder refuses on has copy; the toast never shows the server message", () => {
  const controller = between(read("../server/controllers/storefrontController.js"), "export const createWebsiteOrder", "export const createPosOnlineOrder");
  const fields = new Set([
    ...[...controller.matchAll(/checkoutValidationResponse\(\d+, (?:"[^"]*"|[^,]+), "([\w.]+)"/g)].map((match) => match[1]),
    ...[...controller.matchAll(/checkoutValidationError\((?:"[^"]*"|`[^`]*`), "([\w.]+)"/g)].map((match) => match[1]),
    ...JSON.parse(between(controller, "const missingFields = ", "].filter").slice("const missingFields = ".length) + "]"),
  ]);
  fields.delete("coupon_code");
  assert.ok(fields.size >= 15, `only found ${fields.size} fields`);
  for (const field of fields) {
    assert.ok(STOREFRONT_CHECKOUT_ERROR_FIELDS.includes(field), `no copy for checkout field ${field}`);
    assert.notEqual(storefrontCheckoutErrorCopy(error(400, { field })).key, "storefront.toasts.checkoutFailed", field);
  }
  assert.deepEqual(
    storefrontCheckoutErrorCopy(error(400, { field: "items.quantity", message: "Only 0 left from Air Jordan 4", details: { available_stock: 0, product_name: "Air Jordan 4" } })),
    { key: "storefront.checkout.errors.stockShort", options: { available: "0", product: "Air Jordan 4" } }
  );
  assert.equal(storefrontCheckoutErrorCopy(error(503, { field: "payment_method" })).key, "storefront.checkout.errors.onlinePaymentUnavailable");
  assert.equal(storefrontCheckoutErrorCopy(error(403, { field: "payment_method" })).key, "storefront.checkout.errors.codDisabled");
  assert.equal(storefrontCheckoutErrorCopy(error(403, { field: "shipping_method" })).key, "storefront.checkout.errors.pickupDisabled");
  assert.equal(storefrontCheckoutErrorCopy(error(400, { message: "Checkout failed while confirming the order." })).key, "storefront.toasts.checkoutFailed");

  const storefront = read("../src/storefront/Storefront.jsx");
  assert.doesNotMatch(storefront, /backendMessage \|\| sfText\("storefront\.toasts\.checkoutFailed"\)/);
  assert.match(storefront, /sfText\(checkoutCopy\.key, undefined, checkoutCopy\.options\)/);
});

test("tracking: the stage keys match the server's timeline and both pages read the label by key", () => {
  const controller = between(read("../server/controllers/storefrontController.js"), "const TIMELINE_STAGES = [", "];");
  assert.deepEqual([...controller.matchAll(/key: "(\w+)"/g)].map((match) => match[1]), STOREFRONT_TRACKING_STAGE_KEYS);
  assert.equal(trackingStageKey({ key: "out_for_delivery", label: "خرج للتسليم" }), "storefront.tracking.stages.out_for_delivery");
  assert.equal(trackingStageKey({ key: "0", label: "Order received" }), "");
  assert.equal(lookup("en", trackingStageKey({ key: "delivered" })), "Delivered");

  const tracking = read("../src/storefront/pages/StorefrontAsyncPages.jsx");
  assert.match(tracking, /data\.timeline\.map\(\(step\) => \(trackingStageKey\(step\) \? \{ \.\.\.step, label: sfText\(trackingStageKey\(step\), step\.label\) \}/);
  assert.match(tracking, /localizeColorName\(item\.color, lang\), localizeSizeLabel\(item\.size, lang\)/);
  const account = read("../src/storefront/pages/StorefrontAccountPage.jsx");
  assert.match(account, /trackingStageKey\(step\) \? sfText\(trackingStageKey\(step\), step\.label\) : step\.label/);
});

test("image search: status and errors come from copy keys, never the server's Arabic message", () => {
  assert.equal(visualSearchErrorKey(error(413, { message: "حجم الصورة كبير" })), "storefront.toasts.imageTooLarge");
  assert.equal(visualSearchErrorKey(error(400, { error_code: "UNSUPPORTED_IMAGE_TYPE" })), "storefront.toasts.unsupportedImageType");
  assert.equal(visualSearchErrorKey(error(400, { error_code: "IMAGE_REQUIRED" })), "storefront.toasts.emptyImage");
  assert.equal(visualSearchErrorKey(error(500, { message: "تعذر البحث بالصورة الآن" })), "storefront.visualSearch.unavailableRetry");
  assert.equal(visualSearchErrorKey(new TypeError("Failed to fetch")), "storefront.visualSearch.unavailableRetry");
  assert.equal(visualSearchSubtitleKey({ exactMatches: [{}], confidence: 85, message: "لقينا الموديل ده" }), "storefront.visualSearch.foundExact");
  assert.equal(visualSearchSubtitleKey({ similarMatches: [{}], message: "الموديل مش متوفر" }), "storefront.visualSearch.notAvailableClosest");
  assert.equal(visualSearchSubtitleKey({ error: "storefront.toasts.imageTooLarge" }), "storefront.toasts.imageTooLarge");

  const component = read("../src/storefront/components/StorefrontVisualSearchResults.jsx");
  assert.doesNotMatch(component, /visualSearch\?\.message/);
  const storefront = read("../src/storefront/Storefront.jsx");
  assert.match(storefront, /const message = visualSearchErrorKey\(error\);/);
});

test("localizeColorName translates off-white and mustard, alone and in a pair", () => {
  assert.equal(localizeColorName("أوف وايت", "en"), "Off White");
  assert.equal(localizeColorName("اوف وايت", "en"), "Off White");
  assert.equal(localizeColorName("مستردة", "en"), "Mustard");
  assert.equal(localizeColorName("مسترده", "en"), "Mustard");
  assert.equal(localizeColorName("أسود وأوف وايت", "en"), "Black & Off White");
  assert.equal(localizeColorName("أوف وايت وأسود", "en"), "Off White & Black");
  assert.equal(localizeColorName("أسود و أبيض", "en"), "Black & White");
  assert.equal(localizeColorName("Black & Off White", "ar"), "أسود وأوف وايت");
  assert.equal(localizeColorName("Off White", "ar"), "أوف وايت");
  assert.equal(localizeColorName("أسود وموديل", "en"), "أسود وموديل");
  assert.equal(localizeColorName("Air Max - Black", "ar"), "Air Max - Black");
});

test("the Arabic product-type labels are Arabic", () => {
  const block = between(read("../src/storefront/Storefront.jsx"), "const PRODUCT_TYPE_LABELS = {", "\n};");
  const labels = [...block.matchAll(/^\s+(\w+): \{ ar: "([^"]+)", en: "([^"]+)"/gm)];
  assert.ok(labels.length >= 7);
  for (const [, key, ar, en] of labels) {
    assert.match(ar, ARABIC, `${key} ar label is "${ar}"`);
    assert.doesNotMatch(en, ARABIC, `${key} en label is "${en}"`);
  }
});

test("the order confirmation link formats money in Latin digits in Arabic too", () => {
  const page = read("../src/storefront/pages/OrderConfirmationActionPage.jsx");
  const formatter = between(page, "const moneyFormatter", "\n");
  assert.match(formatter, /numberingSystem: "latn"/);
  assert.equal(new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2, numberingSystem: "latn" }).format(1250.5), "1,250.5");
});
