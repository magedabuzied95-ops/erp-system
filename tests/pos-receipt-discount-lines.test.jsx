import { test, expect, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveReceiptRenderTotals } from "../src/modules/pos/lib/receiptRenderTotals.js";

/**
 * One cart, two receipts: the one printed after the server answered (its order merged
 * into the receipt) and the one printed from the offline snapshot. They must print the
 * SAME discount lines.
 *
 * On the server `orders.discount_amount` is item + invoice + loyalty + coupon combined.
 * The online receipt used to put that combined figure on the "invoice discount" line
 * while the item, coupon and loyalty lines still printed from the till, so every
 * discount was printed twice.
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
  if (!globalThis.localStorage) globalThis.localStorage = memoryStorage();
  if (!globalThis.sessionStorage) globalThis.sessionStorage = memoryStorage();
  ({ ReceiptPreview } = await import("../src/modules/pos/components/CartSidebar.jsx"));
});

// The till's own totals for the sale: 50 off items, 100 off the invoice, 30 coupon, 20 loyalty.
const cartTotals = {
  subtotal: 1200,
  itemDiscountTotal: 50,
  invoiceDiscount: 100,
  couponDiscount: 30,
  loyaltyDiscount: 20,
  serviceFee: 0,
  total: 1000,
};

const offlineReceiptOrder = {
  invoice_number: "OFF-1",
  total: cartTotals.total,
  totals: cartTotals,
};

// What POSPro builds after a successful online sale: the server order spread first,
// then the till's figures on top.
const onlineReceiptOrder = {
  subtotal: "1200.00",
  discount_amount: "200.00",
  invoice_discount_amount: "100.00",
  coupon_discount_amount: "30.00",
  loyalty_discount_amount: "20.00",
  invoice_number: "INV-1",
  total: cartTotals.total,
  totals: cartTotals,
};

const discountLines = (html) =>
  (html.match(/<div class="thermal-row"><span>خصم [^<]+<\/span><strong>[^<]+<\/strong><\/div>/g) || []);

const renderReceipt = (order, fallback = {}) =>
  renderToStaticMarkup(
    <ReceiptPreview
      compact
      invoiceNumber="INV-1"
      customer={{ name: "عميل" }}
      cart={[{ id: 1, name: "حذاء", quantity: 1, price: 1200 }]}
      totals={resolveReceiptRenderTotals(order, fallback)}
      paymentSummary={{ paidAmount: 1000, changeAmount: 0 }}
      paymentMode="cash"
    />
  );

test("the invoice line never carries the server's combined discount", () => {
  expect(resolveReceiptRenderTotals(onlineReceiptOrder, {}).invoiceDiscount).toBe(100);
  // A reprint from Recent Operations has no till totals: the server's own invoice
  // discount column is used, still never discount_amount.
  const { totals: _ignored, ...serverOnly } = onlineReceiptOrder;
  expect(resolveReceiptRenderTotals(serverOnly, {}).invoiceDiscount).toBe(100);
});

test("online and offline receipts for the same cart print identical discount lines", () => {
  const online = discountLines(renderReceipt(onlineReceiptOrder, cartTotals));
  const offline = discountLines(renderReceipt(offlineReceiptOrder, cartTotals));
  expect(online.length).toBe(4);
  expect(online).toEqual(offline);
  expect(online.join("")).not.toMatch(/200/);
});
