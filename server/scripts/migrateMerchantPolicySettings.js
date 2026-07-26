import { getSetting, setSetting } from "../services/settingsService.js";
import { parseLegacyDeliveryRange } from "../../src/shared/lib/merchantPolicies.js";

const policyKeys = [
  "orders.return_exchange_window_days",
  "storefront.return_policy_enabled",
  "storefront.return_method",
  "storefront.customer_remorse_return_fees",
  "storefront.defect_return_fees",
  "storefront.return_policy_url",
  "storefront.return_policy_conditions",
];

const zones = await getSetting("storefront.shipping_zones");
if (Array.isArray(zones)) {
  const structuredZones = zones.map((zone) => {
    if (zone.delivery_min_days !== undefined && zone.delivery_max_days !== undefined) return zone;
    const range = parseLegacyDeliveryRange(zone.estimated_delivery_text || zone.estimatedDeliveryText || "");
    return range ? { ...zone, delivery_min_days: range.minValue, delivery_max_days: range.maxValue } : zone;
  });
  await setSetting("storefront.shipping_zones", structuredZones);
}

for (const key of policyKeys) {
  await setSetting(key, await getSetting(key));
}

console.log("Merchant shipping and return policy settings are structured and persisted.");
process.exit(0);
