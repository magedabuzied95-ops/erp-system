import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveBostaCollection } from "../server/modules/shipping/shipping.service.js";
import { matchShippingZone, normalizeShippingZone } from "../server/services/storefrontShippingService.js";
import { couponLineNormalPrice, validateCoupon } from "../server/services/couponsService.js";
import {
  couponAutoApplyStep,
  deliveryQuoteRefreshDelayMs,
  DELIVERY_QUOTE_MAX_AGE_MS,
  fallbackPaymentMode,
  isEgyptMobile,
  normalizeEgyptMobile,
  orderDueOnDelivery,
  shippingQuoteSettled,
} from "../src/storefront/lib/checkoutGuards.js";

// Line endings folded so the multi-line assertions hold on a Windows checkout too.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const storefrontController = read("../server/controllers/storefrontController.js");
const confirmationService = read("../server/services/whatsappOrderConfirmationService.js");
const couponsSource = read("../server/services/couponsService.js");
const storefrontSource = read("../src/storefront/Storefront.jsx");
const summarySource = read("../src/storefront/components/StorefrontCheckoutSummary.jsx");
const trackingSource = read("../src/storefront/pages/StorefrontAsyncPages.jsx");
const accountSource = read("../src/storefront/pages/StorefrontAccountPage.jsx");
const arLocale = JSON.parse(read("../src/locales/ar/storefront.json"));
const enLocale = JSON.parse(read("../src/locales/en/storefront.json"));

const createWebsiteOrderSource = storefrontController.slice(
  storefrontController.indexOf("export const createWebsiteOrder"),
  storefrontController.indexOf("export const createPosOnlineOrder")
);
const checkoutPageStart = storefrontSource.indexOf("function CheckoutPage(");
const checkoutPageSource = storefrontSource.slice(
  checkoutPageStart,
  storefrontSource.indexOf("\nfunction ", checkoutPageStart + 1)
);

/* #30 — a manual transfer is not paid money until someone verifies it */

test("#30 checkout stores a manual-transfer order unpaid and awaiting verification", () => {
  assert.match(createWebsiteOrderSource, /const paidAmount = 0;/);
  assert.match(createWebsiteOrderSource, /const paymentStatus = paymentMethod === "cod" \|\| isGatewayCheckout \? "unpaid" : "awaiting_verification";/);
  assert.doesNotMatch(createWebsiteOrderSource, /remainingAmount > 0 \? "partially_paid" : "paid"/);
  // The proof still waits for review, which is what the wallet SMS matcher looks for.
  assert.match(createWebsiteOrderSource, /const transferProofStatus = paymentMethod === "cod" \|\| isGatewayCheckout \? null : "pending";/);
});

test("#30 an unverified transfer order cannot leave with Bosta collecting nothing; an approved one ships settled", () => {
  const awaiting = { payment_method: "instapay", payment_status: "awaiting_verification", transfer_proof_status: "pending", total_amount: 1500, paid_amount: 0, remaining_amount: 1500, cod_amount: 0 };
  const pending = resolveBostaCollection({ order: awaiting });
  assert.equal(pending.blocked, true);
  assert.equal(pending.amount, 0);
  // What applyTransferPaymentConfirmation writes once the proof is approved or the SMS matches.
  const approved = resolveBostaCollection({ order: { ...awaiting, payment_status: "paid", transfer_proof_status: "approved", paid_amount: 1500, remaining_amount: 0 } });
  assert.equal(approved.blocked, false);
  assert.equal(approved.source, "settled");
});

test("#30 the customer is not told to pay a sent transfer again at the door", () => {
  const awaiting = { payment_method: "vodafone_cash", payment_status: "awaiting_verification", transfer_proof_status: "pending", remaining_amount: 900 };
  assert.equal(orderDueOnDelivery(awaiting), 0);
  assert.equal(orderDueOnDelivery({ payment_method: "cod", payment_status: "unpaid", remaining_amount: 900 }), 900);
  assert.equal(orderDueOnDelivery({ payment_method: "instapay", payment_status: "paid", transfer_proof_status: "approved", remaining_amount: 0 }), 0);
  assert.match(trackingSource, /const remaining = orderDueOnDelivery\(order\);/);
  assert.match(accountSource, /const remaining = orderDueOnDelivery\(order\);/);
  // The WhatsApp payment-review message names the order total and nothing else (owner,
  // 2026-09-20): "المدفوع / المتبقي عند الاستلام" told a shopper whose transfer was still in
  // review to pay the whole total at the door, and "المبلغ المحوَّل" claimed the total had been
  // transferred when only the shipping fee had (INV-1772).
  const reviewMessage = confirmationService.slice(
    confirmationService.indexOf("const buildPaymentReviewMessage"),
    confirmationService.indexOf("const loadOrderItems")
  );
  assert.ok(reviewMessage.length > 0);
  assert.match(reviewMessage, /💰 إجمالي الاوردر : \$\{total\} ج/);
  assert.doesNotMatch(reviewMessage, /المتبقي عند الاستلام|المبلغ المحوَّل|💳 المدفوع/);
});

/* #31 — client zone ids must agree with the address */

const zones = [
  normalizeShippingZone({ id: "z-cairo", governorate: "القاهرة", zone_id: "CAI-1", city_id: "C1", price: 40, requires_shipping_proof: false }),
  normalizeShippingZone({ id: "z-aswan", governorate: "أسوان", price: 120 }),
  normalizeShippingZone({ id: "z-north", governorate: "مطروح", zone_id: "NC-9", price: 90 }),
];

test("#31 a cheap zone's id sent with a far governorate prices the governorate, not the id", () => {
  const match = matchShippingZone(zones, { governorate: "أسوان", zone_id: "CAI-1", city_id: "C1" });
  assert.equal(match?.id, "z-aswan");
  assert.equal(match?.price, 120);
});

test("#31 an id that agrees with the address, or a spelling we cannot place, still matches by id", () => {
  assert.equal(matchShippingZone(zones, { governorate: "Cairo", zone_id: "CAI-1" })?.id, "z-cairo");
  // A courier's own city name (not a governorate we know) is not proof of a different governorate.
  assert.equal(matchShippingZone(zones, { governorate: "الساحل الشمالي", zone_id: "NC-9" })?.id, "z-north");
  assert.equal(matchShippingZone(zones, { governorate: "", zone_id: "CAI-1" })?.id, "z-cairo");
});

/* #51 — cancelling from the link gives the coupon back */

test("#51 the customer cancel branch releases the coupon inside the same transaction", () => {
  const cancelBranch = confirmationService.slice(
    confirmationService.indexOf('} else if (normalizedAction === "cancel") {'),
    confirmationService.indexOf('} else if (normalizedAction === "cancel_reason") {')
  );
  assert.match(confirmationService, /import \{ releaseCouponForOrder \} from "\.\/couponsService\.js";/);
  assert.match(cancelBranch, /await releaseCouponForOrder\(\{ client, orderId: current\.id, reason: "cancelled_by_customer" \}\);/);
  assert.ok(cancelBranch.indexOf("releaseCouponForOrder") > cancelBranch.indexOf("orders_update_cancelled_by_customer"));
});

test("#51 a cancelled_by_customer order is not a prior order for first-order coupons", async () => {
  const orders = [
    { id: 1, customer_id: 42, status: "cancelled_by_customer" },
    { id: 2, customer_id: 42, status: "pending_confirmation" },
  ];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (/FROM coupons cp\s+JOIN coupon_campaigns/.test(text)) {
        return { rowCount: 1, rows: [{ id: 11, campaign_id: 7, code: "WELCOME", usage_count: 0, usage_limit: 1, is_active: true, campaign_is_active: true, discount_type: "percentage", discount_value: 10, minimum_order_amount: 0, channel: "all", scope: null, stack_policy: "all", budget_cap: null, usage_limit_per_customer: null, first_order_only: true, apply_to_single_item: false }] };
      }
      if (/FROM orders\s+WHERE customer_id = \$1/.test(text)) {
        // Honour the SQL's own exclusion list, so the test proves what the query leaves out.
        const excluded = [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
        const hits = orders.filter((order) => order.customer_id === params[0] && !excluded.includes(order.status) && order.id !== params[1]);
        return { rowCount: hits.length ? 1 : 0, rows: hits.length ? [{}] : [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const result = await validateCoupon({ code: "WELCOME", orderTotal: 1000, customerId: 42, currentOrderId: 2, items: [{ product_id: 5, price: 1000, quantity: 1 }], client });
  assert.equal(result.valid, true, result.reason);
  assert.match(couponsSource, /const NOT_A_PLACED_ORDER_SQL = "'cancelled', 'canceled', 'cancelled_by_customer', 'void'";/);
  const issueSource = couponsSource.slice(couponsSource.indexOf("export const issueFirstOrderCoupons"));
  assert.match(issueSource.slice(0, 900), /NOT IN \(\$\{NOT_A_PLACED_ORDER_SQL\}\)/);
});

/* #52 — "exclude sale items" compares with the canonical normal price */

const scopedCouponClient = ({ product, variant }) => ({
  async query(sql) {
    const text = String(sql);
    if (/FROM coupons cp\s+JOIN coupon_campaigns/.test(text)) {
      return { rowCount: 1, rows: [{ id: 21, campaign_id: 9, code: "NOSALE", usage_count: 0, usage_limit: 100, is_active: true, campaign_is_active: true, discount_type: "percentage", discount_value: 10, minimum_order_amount: 0, channel: "all", scope: { exclude_on_sale: true }, stack_policy: "all", budget_cap: null, usage_limit_per_customer: null, first_order_only: false, apply_to_single_item: false }] };
    }
    if (/FROM products p WHERE id = ANY/.test(text)) return { rowCount: 1, rows: [{ id: 5, category_id: 1, brand_id: 1, pricing: product }] };
    if (/FROM product_variants pv WHERE id = ANY/.test(text)) return { rowCount: variant ? 1 : 0, rows: variant ? [{ id: 50, product_id: 5, pricing: variant }] : [] };
    return { rowCount: 0, rows: [] };
  },
});

test("#52 a line priced only by purchase invoice is on sale when it sells below that price", async () => {
  const product = { selling_price: 0, price: 0, regular_price: 0, purchase_selling_price: 1200 };
  const result = await validateCoupon({ code: "NOSALE", orderTotal: 900, items: [{ product_id: 5, variant_id: 50, price: 900, quantity: 1 }], client: scopedCouponClient({ product, variant: { selling_price: 0 } }) });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Coupon does not apply to the items in this order");
});

test("#52 an active manual override is the normal price, not a stale selling_price above it", async () => {
  const product = { selling_price: 1200, manual_price_override_active: true, manual_selling_price: 900 };
  const result = await validateCoupon({ code: "NOSALE", orderTotal: 900, items: [{ product_id: 5, variant_id: 50, price: 900, quantity: 1 }], client: scopedCouponClient({ product, variant: {} }) });
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.discount_amount, 90);
  // Variant before product, exactly as resolveCurrentSellingPrice ranks it.
  assert.equal(couponLineNormalPrice({ product: { selling_price: 1000 }, variant: { purchase_selling_price: 800 } }), 800);
  assert.doesNotMatch(couponsSource, /COALESCE\(NULLIF\(selling_price, 0\), NULLIF\(price, 0\), NULLIF\(regular_price, 0\), 0\)::numeric AS list_price/);
});

/* #33 — cash on delivery switched off */

test("#33 a disabled COD moves the shopper to an accepted method and is not offered", () => {
  assert.equal(fallbackPaymentMode({ paymentMode: "cod", codAvailable: false, onlineAvailable: true }), "online");
  assert.equal(fallbackPaymentMode({ paymentMode: "cod", codAvailable: false, onlineAvailable: false }), "electronic");
  assert.equal(fallbackPaymentMode({ paymentMode: "cod", codAvailable: true, onlineAvailable: false }), "cod");
  assert.equal(fallbackPaymentMode({ paymentMode: "online", codAvailable: false, onlineAvailable: false }), "electronic");
  assert.match(checkoutPageSource, /if \(normalizedPaymentMethod === "cod" && !codAvailable\) \{/);
  assert.match(checkoutPageSource, /\{codAvailable \? \(\s*<CheckoutChoice active=\{paymentMode === "cod"\}/);
  // The server's 403 becomes a localized message pointing at the payment section.
  assert.match(checkoutPageSource, /=== 403 && field === "payment_method"/);
  assert.match(checkoutPageSource, /sfText\("storefront\.checkout\.codUnavailableChooseAnother"\)/);
});

/* #34 / #50 — a failed shipping quote */

test("#34/#50 a failed quote is not a settled fee, shows a retry, and submit asks for a new quote", () => {
  assert.equal(shippingQuoteSettled({ governorate: "القاهرة", quote: { match_level: "zone", price: 50 } }), true);
  assert.equal(shippingQuoteSettled({ governorate: "القاهرة", quote: { match_level: "", price: 0, failed: true } }), false);
  assert.equal(shippingQuoteSettled({ governorate: "القاهرة", quote: { match_level: "zone", price: 50, failed: true } }), false);
  assert.equal(shippingQuoteSettled({ governorate: "القاهرة", quote: { match_level: "zone", loading: true } }), false);
  assert.equal(shippingQuoteSettled({ governorate: "", quote: { match_level: "zone" } }), false);
  assert.match(checkoutPageSource, /if \(!cancelled\) setShippingQuote\(\{ \.\.\.normalizeShippingQuote\(\), failed: true \}\);/);
  assert.doesNotMatch(checkoutPageSource, /setShippingQuote\(\(prev\) => \(\{ \.\.\.prev, loading: false \}\)\)/);
  assert.match(checkoutPageSource, /if \(form\.governorate && shippingQuote\.failed\) \{\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+setShippingRequoteToken/);
  assert.match(checkoutPageSource, /sfText\("storefront\.checkout\.shippingQuoteRetry"\)/);
  assert.match(summarySource, /shippingQuote\.failed\s+\? t\("storefront\.checkout\.shippingQuoteUnavailable"\)/);
  // The 409 on delivery_fee already re-quotes (04a838f); it must stay wired.
  assert.match(checkoutPageSource, /isStaleCartCheckoutError\(error\)[\s\S]{0,600}setShippingRequoteToken\(\(token\) => token \+ 1\)/);
});

/* #49 — delivery estimate goes stale */

test("#49 the delivery quote refreshes at the cut-off and at least every 15 minutes", () => {
  assert.equal(deliveryQuoteRefreshDelayMs(null), null);
  assert.equal(deliveryQuoteRefreshDelayMs({ ordered_today: true, cutoff_minutes_left: 10 }), 10 * 60_000 + 5_000);
  assert.equal(deliveryQuoteRefreshDelayMs({ ordered_today: true, cutoff_minutes_left: 300 }), DELIVERY_QUOTE_MAX_AGE_MS);
  assert.equal(deliveryQuoteRefreshDelayMs({ ordered_today: false, cutoff_minutes_left: 0 }), DELIVERY_QUOTE_MAX_AGE_MS);
  assert.match(checkoutPageSource, /const delay = deliveryQuoteRefreshDelayMs\(shippingQuote\.delivery_estimate\);/);
  assert.match(createWebsiteOrderSource, /delivery_estimate: shippingQuote\.delivery_estimate \|\| null,/);
  assert.match(checkoutPageSource, /delivery_estimate: data\.delivery_estimate \|\| shippingQuote\.delivery_estimate \|\| null,/);
});

/* #94 — QR coupon waits for the governorate's quote */

test("#94 the link coupon auto-applies only once the fee is quoted, once per state", () => {
  const base = { armed: true, code: "freeship", subtotal: 800, couponLoading: false, deliveryFee: 0, lastKey: "" };
  assert.equal(couponAutoApplyStep({ ...base, quoted: false }).run, false);
  const first = couponAutoApplyStep({ ...base, quoted: true, deliveryFee: 60 });
  assert.equal(first.run, true);
  assert.equal(first.key, "FREESHIP::800.00::60.00");
  assert.equal(couponAutoApplyStep({ ...base, quoted: true, deliveryFee: 60, lastKey: first.key }).run, false);
  assert.equal(couponAutoApplyStep({ ...base, quoted: true, deliveryFee: 75, lastKey: first.key }).run, true);
  assert.equal(couponAutoApplyStep({ ...base, armed: false, quoted: true, deliveryFee: 60 }).run, false);
  assert.match(checkoutPageSource, /quoted: shippingQuoted,/);
  assert.match(checkoutPageSource, /\}, \[form\.coupon, subtotal, couponLoading, shippingQuoted, deliveryFee\]\);/);
});

/* #87 — phone formats */

test("#87 +20, dashes, spaces and Arabic-Indic digits are the same Egyptian mobile", () => {
  const arabicIndic = String.fromCharCode(0x660, 0x661, 0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667, 0x668);
  const persian = String.fromCharCode(0x6f0, 0x6f1, 0x6f1, 0x6f1, 0x6f2, 0x6f3, 0x6f4, 0x6f5, 0x6f6, 0x6f7, 0x6f8);
  assert.equal(normalizeEgyptMobile("+20 101 234 5678"), "01012345678");
  assert.equal(normalizeEgyptMobile("0020 101 234 5678"), "01012345678");
  assert.equal(normalizeEgyptMobile("010-1234-5678"), "01012345678");
  assert.equal(normalizeEgyptMobile(arabicIndic), "01012345678");
  assert.equal(normalizeEgyptMobile(persian), "01112345678");
  assert.equal(isEgyptMobile("1012345678"), true);
  assert.equal(isEgyptMobile("01312345678"), false);
  assert.equal(isEgyptMobile("0101234567"), false);
  assert.match(checkoutPageSource, /const phone = normalizeEgyptMobile\(form\.primary_phone\);/);
  assert.match(checkoutPageSource, /const cleanPhone = normalizeEgyptMobile\(form\.primary_phone\);/);
  assert.doesNotMatch(checkoutPageSource, /form\.primary_phone\.replace\(\/\\s\/g, ""\)/);
});

test("new checkout copy exists in both storefront locales", () => {
  for (const key of ["codUnavailableChooseAnother", "shippingQuoteFailed", "shippingQuoteRetry", "shippingQuoteUnavailable"]) {
    assert.ok(String(arLocale.checkout?.[key] || "").trim(), `ar storefront.checkout.${key}`);
    assert.ok(String(enLocale.checkout?.[key] || "").trim(), `en storefront.checkout.${key}`);
  }
});
