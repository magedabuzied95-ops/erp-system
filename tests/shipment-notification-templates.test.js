import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeShipmentNotificationConfig,
  renderShipmentTemplate,
  SHIPMENT_NOTIFICATION_DEFAULTS,
  SHIPMENT_NOTIFICATION_TYPES,
} from "../shared/shipmentNotificationTemplates.js";

const whatsappServiceSource = readFileSync(new URL("../server/services/whatsappShippingService.js", import.meta.url), "utf8");
const shippingCenterPageSource = readFileSync(new URL("../src/modules/shipping/pages/ShippingCenter.jsx", import.meta.url), "utf8");
const settingsRegistrySource = readFileSync(new URL("../shared/settingsRegistry.js", import.meta.url), "utf8");

// The old hard-coded message printed "رابط التتبع:" and then a blank line, on every
// single order, because Bosta's create response carries no tracking URL and the column
// is therefore always empty.
test("a line whose field is empty is dropped whole, label included", () => {
  const rendered = renderShipmentTemplate(SHIPMENT_NOTIFICATION_DEFAULTS.shipped.template, {
    order_number: "INV-539",
    provider: "Bosta",
    tracking_number: "8844678114",
    tracking_url: "",
  });
  assert.doesNotMatch(rendered, /رابط التتبع/);
  assert.match(rendered, /رقم التتبع: 8844678114/);
});

test("a line whose field is present is kept", () => {
  const rendered = renderShipmentTemplate(SHIPMENT_NOTIFICATION_DEFAULTS.shipped.template, {
    order_number: "INV-539",
    provider: "Bosta",
    tracking_number: "8844678114",
    tracking_url: "https://bosta.co/t/8844678114",
  });
  assert.match(rendered, /رابط التتبع: https:\/\/bosta\.co\/t\/8844678114/);
});

// A prepaid parcel must never carry a line telling the customer to have 0 ready.
test("nothing to collect means no collection line", () => {
  const prepaid = renderShipmentTemplate(SHIPMENT_NOTIFICATION_DEFAULTS.out_for_delivery.template, { order_number: "INV-539", cod_amount: "" });
  assert.doesNotMatch(prepaid, /المبلغ المطلوب/);
  const cod = renderShipmentTemplate(SHIPMENT_NOTIFICATION_DEFAULTS.out_for_delivery.template, { order_number: "INV-539", cod_amount: "1,895 ج.م" });
  assert.match(cod, /المبلغ المطلوب: 1,895 ج\.م/);
});

test("dropped lines do not leave blank runs behind", () => {
  const rendered = renderShipmentTemplate("أول\n\n{{missing}}\n\n\nأخير", {});
  assert.equal(rendered, "أول\n\nأخير");
});

test("a template with no fields renders verbatim", () => {
  assert.equal(renderShipmentTemplate("نص ثابت\nسطر تاني", {}), "نص ثابت\nسطر تاني");
});

test("whitespace-only values count as empty", () => {
  assert.equal(renderShipmentTemplate("رقم: {{order_number}}", { order_number: "   " }), "");
});

// A partial or corrupt stored value must never blank a customer message.
test("stored config is merged over the defaults, never trusted wholesale", () => {
  const merged = normalizeShipmentNotificationConfig({ shipped: { enabled: false } });
  assert.deepEqual(Object.keys(merged), SHIPMENT_NOTIFICATION_TYPES);
  assert.equal(merged.shipped.enabled, false);
  assert.equal(merged.shipped.template, SHIPMENT_NOTIFICATION_DEFAULTS.shipped.template, "a missing template falls back to the default");
  assert.equal(merged.delivered.enabled, true, "untouched types stay on");
});

test("an empty template falls back to the default rather than silencing the message", () => {
  const merged = normalizeShipmentNotificationConfig({ delivered: { template: "   " } });
  assert.equal(merged.delivered.template, SHIPMENT_NOTIFICATION_DEFAULTS.delivered.template);
});

test("garbage config still yields four usable messages", () => {
  for (const garbage of [null, undefined, "nope", 42, [], { shipped: "not an object" }]) {
    const merged = normalizeShipmentNotificationConfig(garbage);
    assert.deepEqual(Object.keys(merged), SHIPMENT_NOTIFICATION_TYPES);
    for (const type of SHIPMENT_NOTIFICATION_TYPES) assert.ok(merged[type].template.trim(), `${type} template`);
  }
});

// Claiming the once-only column before deciding to send would burn it on a message that
// never went out, and the customer would never receive it at all.
test("a disabled message is refused before the once-only column is claimed", () => {
  const disabledIndex = whatsappServiceSource.indexOf('? "disabled"');
  const claimIndex = whatsappServiceSource.indexOf("UPDATE orders");
  assert.ok(disabledIndex > 0, "the sender must honour the enabled switch");
  assert.ok(claimIndex > disabledIndex, "the enabled check must run before the claim");
});

test("the sender renders the stored template, not a hard-coded string", () => {
  assert.match(whatsappServiceSource, /renderShipmentTemplate\(settings\.template/);
  assert.doesNotMatch(whatsappServiceSource, /const buildShipment\w+Message/);
});

// A preview with its own rendering rules is a preview that lies, and these messages go
// to customers.
test("the Shipping Center preview renders through the same module as the sender", () => {
  assert.match(shippingCenterPageSource, /import \{[\s\S]{0,400}renderShipmentTemplate[\s\S]{0,400}\} from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/shipmentNotificationTemplates"/);
  assert.match(shippingCenterPageSource, /renderShipmentTemplate\(entry\.template, previewValues\)/);
});

test("the setting is registered, so setSetting will accept it", () => {
  assert.match(settingsRegistrySource, /"orders\.shipment_notifications", "shipping", "json", SHIPMENT_NOTIFICATION_DEFAULTS/);
});
