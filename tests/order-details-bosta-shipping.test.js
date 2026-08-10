import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detailsSource = readFileSync(new URL("../src/modules/orders/pages/OrderDetails.jsx", import.meta.url), "utf8");
const controllerSource = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");

test("order details uses the Bosta city, zone, and district directory", () => {
  assert.match(detailsSource, /normalizeShippingProviderKey/);
  assert.match(detailsSource, /isBostaShippingProvider/);
  assert.match(detailsSource, /resolveShippingProviderKey/);
  assert.match(detailsSource, /return supportedShippingProviders\.includes\(normalized\) \? normalized : "bosta"/);
  assert.doesNotMatch(detailsSource, /provider: prev\.provider \|\| "in_store_delivery"/);
  assert.match(detailsSource, /\/shipping\/cities\?provider=bosta&dropoff=1/);
  assert.match(detailsSource, /\/shipping\/zones\?provider=bosta&dropoff=1&cityId=/);
  assert.match(detailsSource, /\/shipping\/districts\?provider=bosta&dropoff=1&zoneId=/);
  assert.match(detailsSource, /shipping_city_id/);
  assert.match(detailsSource, /shipping_zone_id/);
  assert.match(detailsSource, /shipping_district_id/);
  assert.match(detailsSource, /building_number/);
});

test("order edit persists the Bosta address fields before shipment creation", () => {
  for (const column of [
    "shipping_city_id",
    "shipping_zone_id",
    "shipping_district_id",
    "shipping_address_line",
    "street_address",
    "building_number",
    "floor_number",
    "apartment_number",
  ]) {
    assert.match(controllerSource, new RegExp(`${column} = \\$\\d+`));
  }
});
