import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { previewBostaWebhookPayload } from "../server/modules/shipping/shipping.service.js";

const shippingServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
const settingsCenterSource = readFileSync(new URL("../src/modules/settings/pages/SettingsCenter.jsx", import.meta.url), "utf8");

const webhookBody = shippingServiceSource.slice(shippingServiceSource.indexOf("export const processBostaWebhook"));

// Rejecting an unmappable callback with 400 threw *before* the shipping_events INSERT,
// so it left no row, no last_webhook_received_at, nothing in the drawer — "no events
// yet" was indistinguishable from "Bosta never called". And a platform that keeps
// collecting 4xx throttles or drops the subscription.
test("an unmappable callback is no longer rejected", () => {
  assert.doesNotMatch(webhookBody, /BOSTA_WEBHOOK_STATUS_UNSUPPORTED/);
  assert.doesNotMatch(webhookBody, /BOSTA_WEBHOOK_IDENTIFIER_MISSING/);
});

test("an unmappable callback is recorded under its real spelling", () => {
  assert.match(shippingServiceSource, /const recordedStatus = parsed\.status \|\| normalizeKey\(parsed\.rawStatus\) \|\| "unmapped"/);
  assert.match(webhookBody, /\[order\?\.id \|\| null, recordedStatus,/);
});

// Recording it must not mean guessing what it meant.
test("an untracked status never moves the order", () => {
  const guardIndex = webhookBody.indexOf('reason: "status_not_tracked"');
  const updateIndex = webhookBody.indexOf("UPDATE orders SET");
  assert.ok(guardIndex > 0, "an untracked status must return before the order update");
  assert.ok(updateIndex > guardIndex, "the order update must come after the untracked-status return");
});

// An unauthenticated caller is still refused — that gate is the one 4xx worth keeping.
test("the auth gate still rejects", () => {
  assert.match(shippingServiceSource, /code = "BOSTA_WEBHOOK_UNAUTHORIZED"/);
  assert.match(shippingServiceSource, /error\.status = 401/);
});

test("the unhandled vocabulary is surfaced instead of being invisible", () => {
  assert.match(shippingServiceSource, /webhook_untracked_statuses: webhookStatusMix\.rows\.filter/);
  assert.match(shippingServiceSource, /tracked: ERP_SHIPPING_STATUSES\.has\(row\.status\)/);
  assert.match(settingsCenterSource, /"Unmapped Bosta Statuses"/);
});

// A state Bosta really sends, in the shape it really sends it.
test("a known state still parses and would update", () => {
  const preview = previewBostaWebhookPayload({
    event: "delivery.status_changed",
    trackingNumber: "6809691515",
    state: { code: 24, value: "Out for delivery" },
  });
  assert.equal(preview.parsed.status, "out_for_delivery");
  assert.equal(preview.would_update, true);
});

test("an unknown state parses as itself and would not update", () => {
  const preview = previewBostaWebhookPayload({
    event: "delivery.status_changed",
    trackingNumber: "6809691515",
    state: { code: 30, value: "Rescheduled" },
  });
  assert.equal(preview.parsed.status, "");
  assert.equal(preview.parsed.rawStatus, "Rescheduled");
  assert.equal(preview.would_update, false);
});
