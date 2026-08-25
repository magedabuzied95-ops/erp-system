import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeOrderLifecycleStatus, normalizeShippingLifecycleStatus } from "../shared/orderStatus.js";
import { BOSTA_STATE_CODES } from "../server/modules/shipping/providers/bosta.mapper.js";

// The tracking bar is driven by the Bosta webhook, which writes its state onto
// shipment_status/shipping_status. The bar used to test for "created" while the webhook writes
// "shipment_created", and never listed out_for_delivery at all — so two of its six stages could
// not light up no matter what the courier reported.

const controller = fs.readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8"
);
const from = controller.indexOf("const SHIPPING_STAGE_RANK");
const to = controller.indexOf("\n};", controller.indexOf("const buildOrderTimeline")) + 3;
assert.ok(from > -1 && to > from, "the timeline builder is where the test expects it");
// eslint-disable-next-line no-new-func
const buildOrderTimeline = new Function(
  "normalizeOrderLifecycleStatus", "normalizeShippingLifecycleStatus",
  `${controller.slice(from, to)}\nreturn buildOrderTimeline;`
)(normalizeOrderLifecycleStatus, normalizeShippingLifecycleStatus);

const stageIndex = (key) => buildOrderTimeline({}).findIndex((s) => s.key === key);
const reached = (order) => {
  const stages = buildOrderTimeline(order);
  let last = -1;
  stages.forEach((s, i) => { if (s.done) last = i; });
  return last;
};

test("every Bosta state the mapper can produce moves the bar", () => {
  // the states BOSTA_STATE_CODES actually maps its numeric codes onto
  const happyPath = ["shipment_created", "picked_up", "in_transit", "out_for_delivery", "delivered"];
  for (const state of happyPath) {
    assert.ok(
      Object.values(BOSTA_STATE_CODES).includes(state),
      `${state} is a state Bosta really reports`
    );
    const at = reached({ status: "confirmed", shipment_status: state });
    assert.ok(at > stageIndex("confirmed"), `${state} must move the bar past confirmed, got stage ${at}`);
  }
});

test("shipment_created lights the shipment stage — the exact wording the webhook writes", () => {
  const stages = buildOrderTimeline({ status: "confirmed", shipment_status: "shipment_created" });
  assert.equal(stages[stageIndex("shipment_created")].done, true);
  assert.equal(stages[stageIndex("out_for_delivery")].done, false, "not out for delivery yet");
});

test("out_for_delivery lights its own stage", () => {
  const stages = buildOrderTimeline({ status: "confirmed", shipment_status: "out_for_delivery" });
  assert.equal(stages[stageIndex("out_for_delivery")].done, true);
  assert.equal(stages[stageIndex("delivered")].done, false, "out for delivery is not delivered");
});

test("the bar never skips a stage — reaching one implies every earlier one", () => {
  for (const state of ["shipment_created", "picked_up", "in_transit", "out_for_delivery", "delivered"]) {
    const stages = buildOrderTimeline({ status: "confirmed", shipment_status: state });
    const lastDone = reached({ status: "confirmed", shipment_status: state });
    for (let i = 0; i <= lastDone; i += 1) {
      assert.equal(stages[i].done, true, `${state}: stage ${stages[i].key} must be done before ${stages[lastDone].key}`);
    }
  }
});

test("an order that never left confirmation shows only what it reached", () => {
  assert.equal(reached({ status: "pending_confirmation" }), stageIndex("received"));
  assert.equal(reached({ status: "confirmed" }), stageIndex("confirmed"));
});

test("a derailed parcel does not light stages it never reached", () => {
  for (const state of ["cancelled", "returned", "failed_delivery"]) {
    assert.equal(
      reached({ status: "confirmed", shipment_status: state }),
      stageIndex("received"),
      `${state} must not read as progress`
    );
  }
  assert.equal(reached({ status: "cancelled_by_customer" }), stageIndex("received"));
});

test("the stage labels are all Arabic, like the rest of the page", () => {
  for (const stage of buildOrderTimeline({})) {
    assert.ok(/[؀-ۿ]/.test(stage.label), `stage ${stage.key} has an Arabic label, got "${stage.label}"`);
  }
});
