import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeGlobalHandlingTime,
  resolveZoneHandlingTime,
  validateGlobalHandlingTime,
} from "../../src/shared/lib/shippingHandlingSettings.js";
import { settingsByKey } from "../../shared/settingsRegistry.js";

const settingsSource = readFileSync(
  new URL("../../src/modules/settings/pages/SettingsCenter.jsx", import.meta.url),
  "utf8"
);
const merchantServiceSource = readFileSync(
  new URL("../../server/services/storefrontMerchantPolicyService.js", import.meta.url),
  "utf8"
);
const checkoutSource = readFileSync(
  new URL("../../server/services/storefrontShippingService.js", import.meta.url),
  "utf8"
);

test("shipping settings UI exposes the clear Arabic global handling section", () => {
  assert.match(settingsSource, /data-testid="shipping-handling-settings"/);
  assert.match(settingsSource, /مدة تجهيز الطلب قبل التسليم لشركة الشحن/);
  assert.match(settingsSource, /الحد الأدنى لمدة التجهيز بالأيام/);
  assert.match(settingsSource, /الحد الأقصى لمدة التجهيز بالأيام/);
  assert.match(settingsSource, /المدة من تسجيل الطلب حتى تسليمه لشركة الشحن، ولا تشمل مدة النقل للعميل/);
});

test("registry loads stable global defaults and persists them as shipping settings", () => {
  assert.equal(settingsByKey["storefront.shipping_handling_min_days"].category, "shipping");
  assert.equal(settingsByKey["storefront.shipping_handling_min_days"].defaultValue, 0);
  assert.equal(settingsByKey["storefront.shipping_handling_max_days"].defaultValue, 1);
});

test("handling validation accepts 0 and 1 and rejects negative, decimals, and reversed ranges", () => {
  assert.deepEqual(normalizeGlobalHandlingTime("0", "1"), {
    minDays: 0,
    maxDays: 1,
    valid: true,
  });
  assert.equal(validateGlobalHandlingTime(0, 1, "ar"), "");
  assert.match(validateGlobalHandlingTime(-1, 1, "ar"), /رقمًا صحيحًا يبدأ من صفر/);
  assert.match(validateGlobalHandlingTime(0.5, 1, "ar"), /رقمًا صحيحًا يبدأ من صفر/);
  assert.match(validateGlobalHandlingTime(2, 1, "ar"), /لا يمكن أن يقل/);
});

test("zone override stays optional and does not duplicate general values into zone records", () => {
  assert.deepEqual(resolveZoneHandlingTime({}, 0, 1), {
    minDays: 0,
    maxDays: 1,
    source: "global",
  });
  assert.deepEqual(resolveZoneHandlingTime({
    handling_time_override_enabled: true,
    handling_min_days: 2,
    handling_max_days: 4,
  }, 0, 1), {
    minDays: 2,
    maxDays: 4,
    source: "zone",
  });
});

test("Product merchant policy loader reads the same global settings while checkout pricing stays untouched", () => {
  assert.match(merchantServiceSource, /getSetting\("storefront\.shipping_handling_min_days"\)/);
  assert.match(merchantServiceSource, /getSetting\("storefront\.shipping_handling_max_days"\)/);
  assert.doesNotMatch(checkoutSource, /shipping_handling_(?:min|max)_days/);
});
