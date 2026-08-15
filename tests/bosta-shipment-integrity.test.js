import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shippingServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
const shippingControllerSource = readFileSync(new URL("../server/modules/shipping/shipping.controller.js", import.meta.url), "utf8");
const settingsCenterSource = readFileSync(new URL("../src/modules/settings/pages/SettingsCenter.jsx", import.meta.url), "utf8");
const settingsRegistrySource = readFileSync(new URL("../shared/settingsRegistry.js", import.meta.url), "utf8");

// A shipment the courier never received must never be recorded as one it did.
// The old fallback wrote a `manual-bosta-<id>` number, flipped the order to
// shipment_created, and returned success — so an unconfigured integration was
// indistinguishable from a working one.
test("an unconfigured Bosta integration never fabricates a shipment", () => {
  assert.doesNotMatch(shippingServiceSource, /manual-bosta-\$\{/);
  assert.doesNotMatch(shippingServiceSource, /markBostaShipmentCreatedFallback/);
  assert.doesNotMatch(shippingServiceSource, /fallback: true/);
});

test("missing Bosta credentials throw instead of reporting success", () => {
  assert.match(shippingServiceSource, /code = "BOSTA_NOT_CONFIGURED"/);
  assert.match(
    shippingServiceSource,
    /if \(!text\(config\.apiKey\)\) \{[\s\S]{0,200}throw bostaNotConfiguredError\("bosta_credentials_missing"\)/
  );
  assert.match(
    shippingServiceSource,
    /if \(isBostaCredentialsMissingError\(apiError\)\) \{[\s\S]{0,200}throw bostaNotConfiguredError\("bosta_credentials_rejected"\)/
  );
});

// The "Disabled" toggle used to be decoration: creation never looked at it, so a
// switched-off integration still handed real parcels to the courier.
test("a disabled integration refuses to create new deliveries but still tracks old ones", () => {
  assert.match(shippingServiceSource, /code = "BOSTA_DISABLED"/);
  assert.match(shippingServiceSource, /enabled: Boolean\(provider\.is_enabled\)/);
  assert.match(shippingServiceSource, /if \(!config\.enabled\) \{[\s\S]{0,220}throw bostaDisabledError\(\)/);

  const refreshBody = shippingServiceSource.slice(shippingServiceSource.indexOf("export const refreshBostaShipmentForOrder"));
  const cancelStart = refreshBody.indexOf("export const cancelBostaShipmentForOrder");
  assert.doesNotMatch(refreshBody.slice(0, cancelStart), /bostaDisabledError/);
});

test("the order is only marked shipped after Bosta answers", () => {
  const createBody = shippingServiceSource.slice(shippingServiceSource.indexOf("export const createBostaShipmentForOrder"));
  const responseIndex = createBody.indexOf("const response = normalizeBostaDeliveryResponse(rawBostaResponse)");
  const updateIndex = createBody.indexOf("shipping_status = $7");
  assert.ok(responseIndex > 0, "the create path must normalize a real Bosta response");
  assert.ok(updateIndex > responseIndex, "no shipment status is written before Bosta responds");
});

// Production rejects every Bosta status callback when the secret is unset, and
// until now the secret had no UI at all — only an env var nobody had set.
test("the Bosta webhook secret is settable from the shipping settings", () => {
  assert.match(shippingServiceSource, /if \(nextWebhookSecret !== undefined\) await setSetting\("orders\.bosta_webhook_secret"/);
  assert.match(shippingServiceSource, /has_webhook_secret: Boolean\(await webhookSecret\(\)\)/);
  assert.match(shippingControllerSource, /webhookSecret: req\.body\?\.webhook_secret \?\? req\.body\?\.webhookSecret/);
  assert.match(settingsRegistrySource, /"orders\.bosta_webhook_secret", "shipping", "secret"/);
  assert.match(settingsCenterSource, /webhook_secret: settings\.webhook_secret === "\*{8}" \? undefined : settings\.webhook_secret/);
  assert.match(settingsCenterSource, /\["Webhook Secret", status\?\.webhook_secret_configured\]/);
});
