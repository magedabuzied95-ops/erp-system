import test from "node:test";
import assert from "node:assert/strict";

import { mapOrderToBostaDeliveryPayload } from "../server/modules/shipping/providers/bosta.mapper.js";
import { resolveOpenPackagePreference } from "../server/modules/shipping/shipping.service.js";

const order = { id: 7, customer_name: "Ahmed Hasabo", customer_phone: "+201019071764", street_address: "12 El Nasr Street" };

// Bosta holds its own per-account default for this. Sending `false` when the shop
// has not decided would silently overrule that account setting for every parcel.
test("no instruction is sent when the shop has not decided", () => {
  const payload = mapOrderToBostaDeliveryPayload({ order, codAmount: 1490, allowOpenPackage: null });
  assert.equal("allowToOpenPackage" in payload, false);

  const unset = mapOrderToBostaDeliveryPayload({ order, codAmount: 1490 });
  assert.equal("allowToOpenPackage" in unset, false);
});

test("a decision is sent as Bosta's own field", () => {
  assert.equal(mapOrderToBostaDeliveryPayload({ order, codAmount: 1490, allowOpenPackage: true }).allowToOpenPackage, true);
  assert.equal(mapOrderToBostaDeliveryPayload({ order, codAmount: 1490, allowOpenPackage: false }).allowToOpenPackage, false);
});

test("the order overrules the shop default, and the operator overrules both", () => {
  assert.equal(resolveOpenPackagePreference({ order: {}, defaultMode: "allow" }), true);
  assert.equal(resolveOpenPackagePreference({ order: {}, defaultMode: "deny" }), false);
  assert.equal(resolveOpenPackagePreference({ order: {}, defaultMode: "inherit" }), null);
  assert.equal(resolveOpenPackagePreference({ order: { allow_open_package: false }, defaultMode: "allow" }), false);
  assert.equal(resolveOpenPackagePreference({ order: { allow_open_package: true }, defaultMode: "deny" }), true);
  assert.equal(resolveOpenPackagePreference({ order: { allow_open_package: true }, defaultMode: "deny", override: "deny" }), false);
});

// "inherit" has to survive every hop as null: an order that follows the account
// default must not be turned into an explicit `false` by a normalization step.
test("inherit stays inherit", () => {
  assert.equal(resolveOpenPackagePreference({ order: { allow_open_package: null }, defaultMode: "inherit", override: "" }), null);
  assert.equal(resolveOpenPackagePreference({ order: { allow_open_package: null }, defaultMode: "inherit", override: "inherit" }), null);
});

test("the collection still rides on the payload it always did", () => {
  const payload = mapOrderToBostaDeliveryPayload({ order, codAmount: 1490, allowOpenPackage: true });
  assert.equal(payload.cod, 1490);
  assert.equal(payload.type, 10);
});
