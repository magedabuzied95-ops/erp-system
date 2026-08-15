import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Invoice INV-410 printed a 900 subtotal under a 940 total with nothing between
// them, no phone, no address, and no discount — even though the seller had
// entered one. Four separate breaks, each locked down here.

const routes = readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
const orderService = readFileSync(new URL("../server/services/aiAgentOrderService.js", import.meta.url), "utf8");
const ordersController = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
const invoiceCard = readFileSync(new URL("../src/shared/components/invoices/OrderInvoiceCard.jsx", import.meta.url), "utf8");
const inbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");

// The cart branch of the create-draft-order route: the object it hands to
// createAiOrderDraftLines. A field absent from THIS object is a field the
// service never sees, however well the composer sent it.
const draftCall = routes.slice(
  routes.indexOf("const draft = await createAiOrderDraftLines({"),
  routes.indexOf("let confirmed = null;")
);

test("the composer sends the invoice discount it collected", () => {
  assert.match(inbox, /discount_type: discountType/);
  assert.match(inbox, /discount_value: Math\.max\(0, Number\(discountValue\) \|\| 0\)/);
});

test("create-draft-order forwards the discount to the pricing service", () => {
  // The regression: the service has always priced discount_type/discount_value,
  // and this route built its payload field by field without them, so every
  // discount silently became zero.
  assert.match(draftCall, /discount_type:/, "discount_type is dropped at the route");
  assert.match(draftCall, /discount_value:/, "discount_value is dropped at the route");
});

test("an AI order is linked to the customer that phone already belongs to", () => {
  assert.match(orderService, /const resolveAiOrderCustomer = async/);
  // Matching must survive 01x / +20 / 20 spellings of the same number.
  assert.match(orderService, /RIGHT\(REGEXP_REPLACE\(COALESCE\(phone, ''\), '\[\^0-9\]', '', 'g'\), 9\)/);
  // Only a real Egyptian number identifies a person; the Meta id placeholder
  // must never be registered as a customer.
  assert.match(orderService, /normalizedPhone\s*\n?\s*\? await resolveAiOrderCustomer/);
  // The resolved record is what the order is written against.
  assert.match(orderService, /customer_id: customerId,/);
  assert.match(orderService, /customer_name: customerName,/);
  // A registered customer's own name outranks the channel display name.
  assert.match(orderService, /const customerName = text\(customerRecord\?\.name\) \|\| text\(payload\.customer_name\)/);
});

test("the public invoice projection carries shipping, phone and address", () => {
  const projection = ordersController.slice(
    ordersController.indexOf("const customerName = order.customer_record_name"),
    ordersController.indexOf("const buildPublicInvoicePdfBuffer")
  );
  assert.ok(projection.length > 0, "public invoice projection not found");
  // Shipping was selected by the SQL and then never projected, which is why the
  // subtotal and the total could not be reconciled on the printed invoice.
  assert.match(projection, /shipping: normalizeInvoiceMoney\(order\.shipping_cost\)/);
  // The phone lives on the order for channels with no customer record yet.
  assert.match(projection, /const customerPhone = order\.customer_record_phone \|\| order\.customer_phone/);
  // The registered record is the identity, the order's copy is the fallback.
  assert.match(projection, /const customerName = order\.customer_record_name \|\| order\.order_customer_name/);
  assert.match(projection, /address: customerAddress,/);
  for (const part of ["street_address", "building_number", "floor_number", "apartment_number", "landmark", "city_area", "governorate"]) {
    assert.match(projection, new RegExp(`order\\.${part}`), `address part missing from the invoice: ${part}`);
  }
});

test("the invoice card prints the delivery address when the order has one", () => {
  assert.match(invoiceCard, /label=\{copy\.address\}/);
  assert.match(invoiceCard, /data\?\.customer\?\.address \? \(/);
  // An address is long: it must wrap instead of being truncated to one line.
  assert.match(invoiceCard, /wrap \? "break-words" : "truncate"/);
  for (const copy of [/address: "العنوان"/, /address: "Address"/]) {
    assert.match(invoiceCard, copy, "address label missing from a locale");
  }
});
