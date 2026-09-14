import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import jwt from "jsonwebtoken";

// The five critical holes the 2026-09-14 storefront audit found: a client-set checkout discount,
// saved addresses by typed phone, account takeover at registration, a forgeable Paymob success,
// and public invoices walkable by number.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

const { normalizeSignedPaymobWebhookPayload } = await import("../server/services/paymobPosService.js");
const { readOtpVerifiedStorefrontPhone } = await import("../server/middleware/storefrontCustomerAuth.js");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to > from ? to : undefined);
};

test("checkout never subtracts a discount the caller sent", () => {
  const source = read("../server/controllers/storefrontController.js");
  const checkout = between(source, "export const createWebsiteOrder", "export const createPosOnlineOrder");
  assert.match(checkout, /const manualDiscount = 0;/);
  assert.doesNotMatch(checkout, /manualDiscount = [^;]*(req\.body\?\.discount|checkout\.discount)/);
  assert.match(checkout, /const discount = Math\.max\(0, manualDiscount \+ couponDiscountAmount \+ bundleDiscountAmount\);/);
});

test("saved shipping addresses go only to a signed-in customer, keyed on the token's phone", () => {
  const source = read("../server/routes/storefront.js");
  const handler = between(source, 'router.get("/customers/latest-shipping-address"', "return latestShippingAddress(");
  assert.match(handler, /if \(!jwtPhone\) \{[\s\S]*?return res\.json\(\{ success: true, address: null, addresses: \[\] \}\);/);
  assert.doesNotMatch(handler, /resolveStorefrontCustomerPhone|req\.query\?\.email|req\.query\?\.phone/);
  const client = read("../src/storefront/Storefront.jsx");
  assert.match(client, /storefrontCustomerRequest\(`\/storefront\/customers\/latest-shipping-address\?/);
});

test("only an OTP token proves a phone; an email/password token does not", () => {
  const secret = process.env.JWT_SECRET;
  const request = (token) => ({ headers: { authorization: `Bearer ${token}` } });
  const otpToken = jwt.sign({ type: "storefront_customer", tenant_id: 1, phone: "01012345678" }, secret);
  const emailToken = jwt.sign({ type: "storefront_customer", tenant_id: 1, customer_id: 9, phone: "01012345678", auth_method: "email_password" }, secret);
  const staffToken = jwt.sign({ type: "staff", phone: "01012345678" }, secret);
  const forged = jwt.sign({ type: "storefront_customer", phone: "01012345678" }, "not-the-secret");
  assert.equal(readOtpVerifiedStorefrontPhone(request(otpToken)), "01012345678");
  assert.equal(readOtpVerifiedStorefrontPhone(request(emailToken)), "");
  assert.equal(readOtpVerifiedStorefrontPhone(request(staffToken)), "");
  assert.equal(readOtpVerifiedStorefrontPhone(request(forged)), "");
  assert.equal(readOtpVerifiedStorefrontPhone({ headers: {} }), "");
});

test("registration refuses a phone that already has a customer or an order unless OTP proved it", () => {
  const source = read("../server/services/storefrontCustomerEmailAuthService.js");
  const register = between(source, "export const registerStorefrontCustomerEmailAuth", "export const loginStorefrontCustomerEmailAuth");
  const guard = register.indexOf("throw buildPhoneAlreadyRegisteredError()");
  const persist = register.indexOf("persistCustomerPassword(client");
  assert.ok(guard > 0 && persist > guard, "the ownership check must run before any password is written");
  assert.match(register, /const phoneProven = Boolean\(otpVerifiedPhone\) && normalizeRegisterPhone\(otpVerifiedPhone\) === safePhone;/);
  assert.match(register, /if \(!phoneProven && \(phoneCustomer \|\| await phoneHasOrders\(/);
  const route = read("../server/routes/storefront.js");
  assert.match(between(route, 'router.post("/auth/register"', "});"), /otpVerifiedPhone: readOtpVerifiedStorefrontPhone\(req\)/);
});

test("a webhook's status comes from signed flags only", () => {
  const declinedSigned = { amount_cents: 15000, id: 55, order: { id: 99, merchant_order_id: "erp-1-7-1" }, success: false, pending: false, error_occured: false, is_voided: false, is_refunded: false };
  const forged = normalizeSignedPaymobWebhookPayload({
    obj: { ...declinedSigned, txn_response_code: "APPROVED", status: "approved", data: { txn_response_code: "00" } },
    local_order_id: 812,
    status: "paid",
  });
  assert.equal(forged.status, "failed");
  assert.equal(forged.invoiceOrOrderId, undefined);
  assert.equal(forged.providerOrderId, "99");
  assert.equal(forged.transactionReference, "55");

  const approved = normalizeSignedPaymobWebhookPayload({ obj: { ...declinedSigned, success: true } });
  assert.equal(approved.status, "success");
  assert.equal(approved.amountCents, 15000);

  // An unsigned sibling object is never read in place of the signed body.
  const sidecar = normalizeSignedPaymobWebhookPayload({ ...declinedSigned, transaction: { ...declinedSigned, success: true } });
  assert.equal(sidecar.status, "failed");

  assert.equal(normalizeSignedPaymobWebhookPayload({ obj: { ...declinedSigned, pending: true } }).status, "pending");
  assert.equal(normalizeSignedPaymobWebhookPayload({ obj: { ...declinedSigned, success: true, is_voided: true } }).status, "cancelled");
});

test("the webhook uses the signed normalizer and never matches through unsigned local ids", () => {
  const source = read("../server/controllers/posController.js");
  const webhook = between(source, "export const receivePaymobWebhook", "export const getPaymobTerminalPaymentStatus");
  assert.match(webhook, /const normalized = normalizeSignedPaymobWebhookPayload\(req\.body \|\| \{\}\);/);
  assert.doesNotMatch(webhook, /normalizePaymobPaymentPayload\(/);
  const finder = between(source, "const findPaymobTransaction", "const applyPaymobConfirmation");
  assert.match(finder, /\(signedWebhook \? null : numberOrNull\(normalized\.invoiceOrOrderId\)\)/);
  assert.match(finder, /if \(!referenceMatches && rowOrderId && rowOrderId !== signedOrderId\) return null;/);
});

test("a public invoice opened by anything but its token hides who and where the customer is", () => {
  const source = read("../server/controllers/ordersController.js");
  const loader = between(source, "const loadPublicInvoiceByToken", "export const");
  assert.match(loader, /const openedByToken = order\.public_lookup_matched_by === "public_token";/);
  assert.match(loader, /if \(!openedByToken\) \{\s*publicReceiptCoupon = null;/);
  assert.match(loader, /public_token: openedByToken \? order\.public_token : "",/);
  for (const field of ["customer_phone", "customer_address", "street_address", "building_number", "floor_number", "apartment_number", "landmark"]) {
    assert.doesNotMatch(loader, new RegExp(`\\n    ${field}: (customer|order\\.)`), `${field} must go through the redaction`);
  }
  assert.match(loader, /customer: \{\s*name: shownCustomerName,\s*phone: shownCustomerPhone,\s*address: shownCustomerAddress,/);
  assert.match(between(source, "const publicInvoiceIdentifier", ".trim();"), /String\(\s*invoice\.public_token \|\|/);
});
