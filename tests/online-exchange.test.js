/*
 * The exchange arranged from a chat: what comes back, what it is worth, what the courier
 * collects, and what Bosta is told to do. All of it pure, so it runs with no database.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { planExchangeReturn, settleExchangeMoney } from "../server/modules/orders/onlineExchange.js";
import { describeExchangeReturnParcel, exchangeParcelContextOf } from "../server/modules/orders/exchangeParcel.js";
import { mapOrderToBostaDeliveryPayload } from "../server/modules/shipping/providers/bosta.mapper.js";
import { previewExchangeMoney } from "../src/shared/components/inboxCustomerOrders/exchangePreview.js";

const invoiceItems = [
  { id: 11, product_name: "Lacoste Sneakers", color: "Sky Blue", size: "41", quantity: 2, returned_quantity: 0, total_amount: 2500, unit_price: 1250, variant_id: 901 },
  { id: 12, product_name: "Crocs", color: "Black", size: "42", quantity: 1, returned_quantity: 1, total_amount: 800, unit_price: 800, variant_id: 902 },
];

test("only what the invoice still owns can come back", () => {
  const plan = planExchangeReturn({ items: invoiceItems, requestedLines: [{ order_item_id: 11, quantity: 1 }] });
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.items_count, 1);
  // One of two units: the credit is the line's own share, not the whole line.
  assert.equal(plan.gross_return_value, 1250);

  // A line that was already returned has nothing left to swap.
  assert.throws(() => planExchangeReturn({ items: invoiceItems, requestedLines: [{ order_item_id: 12, quantity: 1 }] }), /مرتجع بالكامل/);
  // More than was sold, and a line from somebody else's invoice.
  assert.throws(() => planExchangeReturn({ items: invoiceItems, requestedLines: [{ order_item_id: 11, quantity: 3 }] }), /أكبر من المتاح/);
  assert.throws(() => planExchangeReturn({ items: invoiceItems, requestedLines: [{ order_item_id: 99, quantity: 1 }] }), /مش موجود/);
  // Nothing picked is a refusal, never an empty exchange.
  assert.throws(() => planExchangeReturn({ items: invoiceItems, requestedLines: [{ order_item_id: 11, quantity: 0 }] }), /اختار القطعة/);
});

test("the courier collects the difference, and a cheaper replacement leaves credit behind", () => {
  const dearer = settleExchangeMoney({ credit: 1250, newOrderTotal: 1600 });
  assert.equal(dearer.applied_credit, 1250);
  assert.equal(dearer.collect_on_delivery, 350);
  assert.equal(dearer.remaining_credit, 0);

  const cheaper = settleExchangeMoney({ credit: 1250, newOrderTotal: 900 });
  assert.equal(cheaper.applied_credit, 900);
  // The rest is the customer's store credit - the courier must not hand out cash.
  assert.equal(cheaper.remaining_credit, 350);
  assert.equal(cheaper.collect_on_delivery, 0);

  const even = settleExchangeMoney({ credit: 1250, newOrderTotal: 1250 });
  assert.equal(even.collect_on_delivery, 0);
  assert.equal(even.remaining_credit, 0);
});

test("the sheet's preview and the server's settlement agree on what is collected", () => {
  const preview = previewExchangeMoney({
    returning: [{ unit_price: 1250, selected: 1 }],
    replacement: [{ price: 1600, quantity: 1 }],
    shippingCost: 0,
  });
  const server = settleExchangeMoney({ credit: preview.credit, newOrderTotal: preview.new_total });
  assert.equal(preview.collect_on_delivery, server.collect_on_delivery);
  assert.equal(preview.remaining_credit, server.remaining_credit);
});

test("the parcel tells the courier what he is taking back", () => {
  const parcel = describeExchangeReturnParcel([
    { product_name: "Lacoste Sneakers", color: "Sky Blue", size: "41", quantity: 2 },
  ]);
  assert.equal(parcel.items_count, 2);
  assert.match(parcel.description, /Lacoste Sneakers Sky Blue 41 x2/);

  // Read off the order itself: an ordinary order is not an exchange.
  assert.equal(exchangeParcelContextOf({ ai_agent_metadata: {} }), null);
  // Nor is one whose exchange block names nothing to collect: shipping that as a two-way
  // parcel would send the courier to ask for a piece nobody has described.
  assert.equal(exchangeParcelContextOf({ ai_agent_metadata: { exchange: { original_order_id: 77, return_lines: [] } } }), null);
  const context = exchangeParcelContextOf({
    ai_agent_metadata: {
      exchange: {
        original_order_id: 77,
        original_invoice_number: "INV-77",
        return_id: 5,
        return_lines: [{ product_name: "Lacoste Sneakers", color: "Sky Blue", size: "41", quantity: 1 }],
      },
    },
  });
  assert.equal(context.return_id, 5);
  assert.equal(context.items_count, 1);
  assert.match(context.notes, /INV-77/);
  // Metadata that arrives as a JSON string (some drivers) reads the same.
  assert.equal(exchangeParcelContextOf({ ai_agent_metadata: JSON.stringify({ exchange: { return_id: 6, return_lines: [{ product_name: "X", quantity: 1 }] } }) }).return_id, 6);
});

const deliveryArgs = {
  order: { id: 5, customer_name: "خالد صلاح", customer_phone: "01225041172", street_address: "١٥ شارع فؤاد، محطة الرمل" },
  items: [{ product_name: "Lacoste Sneakers", quantity: 1 }],
  city: { provider_city_id: "c1", name_en: "Alexandria" },
  zone: { provider_zone_id: "z1" },
  district: { provider_district_id: "d1" },
  codAmount: 350,
};

test("an exchange ships as Bosta's two-way parcel, an ordinary order does not", () => {
  const plain = mapOrderToBostaDeliveryPayload(deliveryArgs);
  assert.equal(plain.type, 10);
  assert.equal(plain.returnSpecs, undefined);
  assert.equal(plain.returnNotes, undefined);

  const exchange = mapOrderToBostaDeliveryPayload({
    ...deliveryArgs,
    exchange: { items_count: 2, description: "Lacoste Sneakers Sky Blue 41", notes: "استبدال فاتورة INV-77" },
  });
  // 30 is Bosta's exchange: deliver the replacement, collect the old piece, one visit.
  assert.equal(exchange.type, 30);
  assert.equal(exchange.returnSpecs.packageDetails.itemsCount, 2);
  assert.match(exchange.returnSpecs.packageDetails.description, /Lacoste/);
  assert.equal(exchange.returnNotes, "استبدال فاتورة INV-77");
  // The money on the parcel is still only the difference.
  assert.equal(exchange.cod, 350);
  // And everything an ordinary parcel carries survives the switch.
  assert.equal(exchange.receiver.phone, "01225041172");
  assert.equal(exchange.dropOffAddress.zoneId, "z1");
});
