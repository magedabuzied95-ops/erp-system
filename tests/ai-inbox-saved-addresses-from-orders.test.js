import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mergeSavedAndOrderAddresses, savedAddressFromOrder } from "../server/services/aiAgentOrderService.js";

const service = readFileSync(new URL("../server/services/aiAgentOrderService.js", import.meta.url), "utf8");

// A customer who ordered on the website opened in the WhatsApp composer with no
// address at all: "my addresses" only knew what the composer itself had saved.

test("a website order with only customer_address still becomes a usable address", () => {
  const address = savedAddressFromOrder({
    id: 1637,
    customer_phone: "+201068005338",
    customer_address: "12 شارع النصر",
    governorate: "القاهرة",
    city_area: "مدينة نصر",
    shipping_city_id: "c1",
    shipping_zone_id: "z1",
    shipping_district_id: "d1",
    created_at: "2026-09-10T10:00:00Z",
  });
  assert.equal(address.id, "order-1637");
  assert.equal(address.street_address, "12 شارع النصر");
  assert.equal(address.shipping_provider, "bosta");
  assert.equal(address.shipping_district_id, "d1");
});

test("an order with no courier ids does not force a shipping provider", () => {
  assert.equal(savedAddressFromOrder({ id: 2, customer_address: "x" }).shipping_provider, "");
});

test("the same flat ordered to twice, and already saved, shows once", () => {
  const place = {
    governorate: "القاهرة",
    city_area: "مدينة نصر",
    shipping_city_id: "c1",
    shipping_zone_id: "z1",
    shipping_district_id: "d1",
    street_address: "12 شارع النصر",
    building_number: "4",
    floor_number: "",
    apartment_number: "",
  };
  const merged = mergeSavedAndOrderAddresses(
    [{ id: 9, ...place, last_used_at: "2026-09-01T00:00:00Z" }],
    [
      { id: 50, ...place, created_at: "2026-09-12T00:00:00Z" },
      { id: 51, ...place, created_at: "2026-09-13T00:00:00Z" },
      { id: 52, ...place, street_address: "", customer_address: "7 شارع الهرم", created_at: "2026-09-15T00:00:00Z" },
    ]
  );
  assert.deepEqual(merged.map((address) => address.id), ["order-52", 9]);
});

test("an order with no address text is not offered", () => {
  assert.deepEqual(mergeSavedAndOrderAddresses([], [{ id: 3, governorate: "الجيزة" }]), []);
});

test("both lookups match on the canonical phone key, not the typed spelling", () => {
  const body = service.slice(service.indexOf("export const listCustomerSavedAddresses"));
  const lookup = body.slice(0, body.indexOf("export const saveCustomerAddress"));
  assert.match(lookup, /canonicalPhoneKey\(phone\)/);
  assert.match(lookup, /canonicalPhoneSql\("customer_phone"\)/);
  assert.match(lookup, /canonicalPhoneSql\("o\.customer_phone"\)/);
  assert.doesNotMatch(lookup, /customer_phone = \$2/);
});
