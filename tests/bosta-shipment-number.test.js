import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeBostaDeliveryResponse } from "../server/modules/shipping/providers/bosta.mapper.js";

const shippingServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
const orderDetailsSource = readFileSync(new URL("../src/modules/orders/pages/OrderDetails.jsx", import.meta.url), "utf8");

test("Bosta tracking number is the ERP shipment number while the delivery id remains available", () => {
  const result = normalizeBostaDeliveryResponse({
    success: true,
    data: {
      _id: "bosta-internal-delivery-id",
      trackingNumber: "BOSTA-123456",
      status: "created",
    },
  });

  assert.equal(result.provider_delivery_id, "bosta-internal-delivery-id");
  assert.equal(result.shipment_id, "BOSTA-123456");
  assert.equal(result.tracking_number, "BOSTA-123456");
});

test("Bosta delivery id remains a safe fallback when no tracking number is returned", () => {
  const result = normalizeBostaDeliveryResponse({ data: { _id: "bosta-delivery-only" } });

  assert.equal(result.provider_delivery_id, "bosta-delivery-only");
  assert.equal(result.shipment_id, "bosta-delivery-only");
  assert.equal(result.tracking_number, "");
});

test("Bosta delivery id and customer-facing shipment number are persisted separately", () => {
  assert.match(shippingServiceSource, /shipping_provider_delivery_id = \$2,[\s\S]*shipment_id = \$3,/);
  assert.match(shippingServiceSource, /const bostaShipmentNumber = response\.tracking_number/);
  assert.match(shippingServiceSource, /shipment_id = COALESCE\(NULLIF\(\$4, ''\), NULLIF\(\$3, ''\), shipment_id\)/);
});

test("Bosta shipment number is read-only and filled automatically in order details", () => {
  assert.match(orderDetailsSource, /label=\{isBostaShippingProvider\(shipping\.provider\) \? "رقم شحنة Bosta"/);
  assert.match(orderDetailsSource, /readOnly=\{isBostaShippingProvider\(shipping\.provider\)\}/);
  assert.match(orderDetailsSource, /shipping\.tracking_number \|\| shipping\.shipment_id/);
});
