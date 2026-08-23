import { test, expect, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The receipt voucher, rendered through the SAME call the thermal printer makes.
 *
 * `printThermalReceipt` renders `<ReceiptPreview {...props} compact />`, and `compact` does not
 * merely restyle the receipt — it returns a DIFFERENT component (ThermalReceiptFinal). A voucher
 * added to the A4/preview tree therefore printed nothing at all, which is exactly the bug this
 * guards: assert on the compact output, because that is the paper.
 */

let ReceiptPreview;

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size; },
  };
};

beforeAll(async () => {
  // The component reads the current tenant out of storage at render time.
  if (!globalThis.localStorage) globalThis.localStorage = memoryStorage();
  if (!globalThis.sessionStorage) globalThis.sessionStorage = memoryStorage();
  ({ ReceiptPreview } = await import("../src/modules/pos/components/CartSidebar.jsx"));
});

const base = {
  invoiceNumber: "INV-601",
  customer: { name: "ماجد ابوزيد", phone: "01024960585" },
  cart: [{ id: 1, name: "حذاء", quantity: 1, price: 1100 }],
  totals: { subtotal: 1100, total: 1100, itemDiscountTotal: 0, invoiceDiscount: 0, serviceFee: 0, loyaltyDiscount: 0, couponDiscount: 0 },
  paymentSummary: { paidAmount: 1100, changeAmount: 0 },
  paymentMode: "cash",
  createdAt: "2026-08-23T12:31:23.955Z",
};

const coupon = {
  code: "NV-NRCR9M",
  campaign_name: "فواتير",
  discount_type: "percentage",
  discount_value: 15,
  minimum_order_amount: 0,
  expires_at: null,
  url: "https://m1store-egy.com/checkout?coupon=NV-NRCR9M",
};

test("the PRINTED receipt carries the voucher", () => {
  const printed = renderToStaticMarkup(<ReceiptPreview {...base} receiptCoupon={coupon} compact />);
  expect(printed).toContain("NV-NRCR9M");
  expect(printed).toContain("كوبون خصم لزيارتك الجاية");
  expect(printed).toContain("15% خصم");
  expect(printed).toContain("thermal-coupon-barcode");
  // At the foot of the slip, after the thanks line.
  expect(printed.indexOf("شكرًا لزيارتكم")).toBeLessThan(printed.indexOf("NV-NRCR9M"));
});

test("an ordinary sale prints no voucher block", () => {
  const plain = renderToStaticMarkup(<ReceiptPreview {...base} compact />);
  expect(plain).not.toContain("كوبون خصم لزيارتك الجاية");
});

test("the on-screen preview agrees with the paper", () => {
  const preview = renderToStaticMarkup(<ReceiptPreview {...base} receiptCoupon={coupon} />);
  expect(preview).toContain("NV-NRCR9M");
});

test("a fixed-amount voucher prints its amount, not a percentage", () => {
  const printed = renderToStaticMarkup(
    <ReceiptPreview {...base} receiptCoupon={{ ...coupon, discount_type: "fixed", discount_value: 50 }} compact />
  );
  expect(printed).toContain("50 ج.م خصم");
  expect(printed).not.toContain("% خصم");
});
