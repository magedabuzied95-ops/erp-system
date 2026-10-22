import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { belowFloorDiscount, floorKeyForItem, lowestLegitimateUnitPrice } from "../server/utils/orderLinePriceFloor.js";

// The 2026-10-23 money-path review: eight ways a cashier or a shopper could move money the
// server never agreed to. The pure parts run for real; the wiring is checked in the source.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const orders = read("../server/controllers/ordersController.js");
const slice = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end marker: ${end}`);
  return source.slice(from, to);
};
// Pure helpers evaluated on their own, so the test does not boot the database the controller imports.
const pure = (name, end = "\n};\n") => new Function(`${(slice(orders, `export const ${name}`, end) + end).replace("export const", "const")}; return ${name};`)();
const local = (name, end = "\n};\n") => new Function(`${slice(orders, `const ${name}`, end) + end}; return ${name};`)();

const createOrder = slice(orders, "export const createOrder", "\nexport const ");
const editOrder = slice(orders, "export const editOrder", "\nexport const ");
const returnOrder = slice(orders, "export const returnOrder", "\nexport const ");
const createReturn = slice(orders, 'const routeName = "POST /api/orders/returns";', "\nexport const getSingleOrder");

test("a line's floor is the lowest price the shop could be charging for it", () => {
  const product = { id: 1, price: 1000 };
  assert.equal(lowestLegitimateUnitPrice({ product, variant: { id: 7, price: 1000 } }), 1000);
  // A newer purchase invoice selling it lower is a legitimate price too.
  assert.equal(lowestLegitimateUnitPrice({ product, variant: { id: 7, price: 1000 }, line: { variant_line_purchase_selling_price: 900 } }), 900);
  // A dormant sale price is no floor while no offer or Sale Mode is live…
  assert.equal(lowestLegitimateUnitPrice({ product: { ...product, sale_price: 600 }, variant: { id: 7, price: 1000 } }), 1000);
  // …but an offer's price is.
  assert.equal(lowestLegitimateUnitPrice({ product: { ...product, sale_price: 600, is_offer_story: true }, variant: { id: 7, price: 1000 } }), 600);
  assert.equal(lowestLegitimateUnitPrice({ product, variant: { id: 7, price: 1000 }, line: { variant_line_sale_price: 700 }, saleModeSettings: { sale_mode_enabled: true } }), 700);
  // A product with no price has no floor.
  assert.equal(lowestLegitimateUnitPrice({ product: { id: 2 } }), 0);
});

test("ringing a line up below its floor counts as manual discount", () => {
  const floors = new Map([["v:7", 1000], ["p:3", 200]]);
  const floorFor = (item) => floors.get(floorKeyForItem(item)) || 0;
  assert.equal(belowFloorDiscount([{ variant_id: 7, price: 1, quantity: 1 }], floorFor), 999);
  assert.equal(belowFloorDiscount([{ variant_id: 7, price: 900, quantity: 2 }, { product_id: 3, price: 150, quantity: 1 }], floorFor), 250);
  // At the floor, above it, rounding, or no floor at all: nothing.
  assert.equal(belowFloorDiscount([{ variant_id: 7, price: 1000, quantity: 1 }, { variant_id: 7, price: 1200, quantity: 1 }, { variant_id: 7, price: 999.75, quantity: 1 }, { variant_id: 9, price: 1, quantity: 1 }], floorFor), 0);
  assert.equal(floorKeyForItem({ variant_id: "7", product_id: 3 }), "v:7");
  assert.equal(floorKeyForItem({ product_id: 3 }), "p:3");
});

test("create and edit hold the price cut to the discount limit, offline replays included", () => {
  assert.match(createOrder, /grossSubtotal: computedSubtotal \+ createBelowFloorDiscount,/);
  assert.match(createOrder, /manualDiscount: itemDiscountAmount \+ normalizedInvoiceDiscountAmount \+ createBelowFloorDiscount,/);
  assert.match(editOrder, /manualDiscount: discountValue \+ editBelowFloorDiscount,/);
  // The request's offline flag no longer turns the refusal into a warning.
  assert.doesNotMatch(createOrder, /discount-limit-offline-accepted/);
  assert.match(createOrder, /code: "OFFLINE_REPLAY_DISCOUNT_LIMIT"/);
  const parked = slice(createOrder, "if (offline_origin) {\n        console.warn(\"[orders:discount-limit-offline-parked]\"", "code: \"OFFLINE_REPLAY_DISCOUNT_LIMIT\"");
  assert.match(parked, /res\.status\(409\)/);
});

test("a line's total is price x quantity - discount, never the request's figure", () => {
  const resolveInputLineTotal = local("resolveInputLineTotal");
  assert.equal(resolveInputLineTotal({ quantity: 1, line_total: 5000 }, 1), 1);
  assert.equal(resolveInputLineTotal({ quantity: 2, discount_amount: 50, total_amount: 9999 }, 300), 550);
  assert.equal(resolveInputLineTotal({ quantity: 1, discount_amount: 900 }, 100), 0);
});

test("tax and service fee can never be negative", () => {
  assert.match(createOrder, /const normalizedTaxAmount = Math\.max\(0, toFiniteNumber\(tax_amount, 0\)\);/);
  assert.match(createOrder, /const totalServiceFee = Math\.max\(0, Number\(service_fee \|\| 0\) \|\| 0\);/);
  assert.match(editOrder, /const serviceValue = Math\.max\(0, /);
  assert.match(editOrder, /const taxValue = Math\.max\(0, /);
});

test("a return pays back only what was collected; the rest clears the debt", () => {
  const splitReturnRefund = pure("splitReturnRefund");
  // A credit (آجل) sale that took nothing.
  assert.deepEqual(splitReturnRefund({ goodsRefund: 1000, collected: 0, priorRefunds: 0 }), { payable: 0, debtReduction: 1000 });
  // A paid sale.
  assert.deepEqual(splitReturnRefund({ goodsRefund: 400, collected: 1000, priorRefunds: 0 }), { payable: 400, debtReduction: 0 });
  // A deposit, part of which an earlier return already gave back.
  assert.deepEqual(splitReturnRefund({ goodsRefund: 500, collected: 300, priorRefunds: 100 }), { payable: 200, debtReduction: 300 });
  for (const path of [returnOrder, createReturn]) {
    assert.match(path, /resolveReturnRefundSplit\(client, \{/);
    assert.match(path, /reduceOrderDebtForReturn\(client, \{/);
    // A return that paid nothing posts nothing to a drawer (which refuses a zero amount).
    assert.match(path, /step: "refund:nothing_collected"/);
  }
});

test("a line named twice in one return is checked once against the stored quantity", () => {
  assert.match(returnOrder, /Number\(original\.returned_quantity \|\| 0\) \+ \(requestedSoFar\.get\(String\(original\.id\)\) \|\| 0\)/);
  // Both endpoints take the quantity with a conditional write, so a race cannot over-return.
  assert.doesNotMatch(orders, /UPDATE order_items SET returned_quantity = COALESCE\(returned_quantity, 0\) \+ \$1 WHERE id = \$2`/);
  assert.match(returnOrder, /claimReturnedQuantity\(client, \{ orderItemId: original\.id, quantity \}\)/);
  assert.match(createReturn, /claimReturnedQuantity\(client, \{ orderItemId: originalItem\.id, quantity \}\)/);
  assert.match(slice(orders, "const claimReturnedQuantity", "\n};\n"), /WHERE id = \$2 AND COALESCE\(returned_quantity, 0\) \+ \$1 <= COALESCE\(quantity, 0\)/);
});

test("a wallet transfer credits the order with the money it carried", () => {
  const wallet = read("../server/modules/walletTransfers/walletTransfers.service.js");
  const confirm = slice(wallet, "const confirmOrderForTransfer", "\n};\n");
  assert.match(confirm, /paidAmount: Number\(order\.paid_amount \|\| 0\) \+ transferAmount,/);
  // The shipping-fee match is only for orders the courier still collects on.
  assert.match(wallet, /AND \(LOWER\(COALESCE\(payment_method, ''\)\) IN \('cod', 'cash_on_delivery'\) OR COALESCE\(cod_amount, 0\) > 0\)/);
});

test("the public checkout never takes a customer id from the shopper", () => {
  const storefront = read("../server/controllers/storefrontController.js");
  assert.match(storefront, /customerId: trustCustomerId \? checkout\.customer_id \|\| checkout\.customerId \|\| null : null,/);
  assert.match(storefront, /resolveCustomer\(client, tenantId, checkout, checkoutColumns\.customers, runCheckoutQuery, \{ trustCustomerId: posOnlineOrder \}\)/);
  assert.match(storefront, /customer_email: checkout\.email \|\| \(posOnlineOrder \? customer\?\.email : ""\) \|\| "",/);
});

test("a failing floor lookup never aborts the sale's transaction", async () => {
  const { loadOrderLineFloors } = await import("../server/utils/orderLinePriceFloor.js");
  const sent = [];
  const client = {
    query: async (sql) => {
      sent.push(String(sql).trim().split(/\s+/).slice(0, 4).join(" "));
      if (/product_variants/.test(sql)) throw new Error("boom");
      return { rows: [] };
    },
  };
  const floors = await loadOrderLineFloors(client, { items: [{ variant_id: 7, price: 1, quantity: 1 }] });
  assert.equal(floors.size, 0);
  assert.equal(sent[0], "SAVEPOINT order_line_floors");
  assert.equal(sent.at(-1), "ROLLBACK TO SAVEPOINT order_line_floors");
});
