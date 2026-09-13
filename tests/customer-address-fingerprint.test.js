import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { customerAddressFingerprint, dedupeCustomerAddresses } from "../shared/customerAddressFingerprint.js";

test("the same flat typed differently on two orders is one saved address", () => {
  const newest = { governorate: "دمياط", city_area: "دمياط الجديدة", street_address: "شارع الجمهورية ", building_number: "١٢", floor_number: "3" };
  const older = { governorate: "دمياط", city_area: "دمياط  الجديده", street_address: "شارع الجمهوريه،", building_number: "12", floor_number: "٣" };
  assert.equal(customerAddressFingerprint(newest), customerAddressFingerprint(older));
  const unique = dedupeCustomerAddresses([newest, older]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0], newest, "the newest row wins");
});

test("a different floor or district is a different address, and empty rows are dropped", () => {
  const base = { shipping_district_id: "d-1", street_address: "Tahrir", building_number: "4", floor_number: "2" };
  const rows = [base, { ...base, floor_number: "5" }, { ...base, shipping_district_id: "d-2" }, { governorate: "", customer_address: "" }, null];
  assert.equal(dedupeCustomerAddresses(rows).length, 3);
  assert.equal(dedupeCustomerAddresses(rows, 2).length, 2, "the limit is honoured");
});

test("both address lists the storefront serves go through the dedupe", () => {
  const source = fs.readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  assert.match(source, /addresses: dedupeCustomerAddresses\(orderResult\.rows, 5\)/);
  assert.match(source, /const addresses = dedupeCustomerAddresses\(orders\.rows, 6\)/);
});
