import { getSetting } from "./settingsService.js";
import { zonedParts } from "../utils/appTimezone.js";
import { resolveZoneHandlingTime } from "../../src/shared/lib/shippingHandlingSettings.js";
import {
  DEFAULT_ORDER_CUTOFF_TIME,
  DEFAULT_SHIPPING_DAYS_OFF,
  DELIVERY_ESTIMATE_ENABLED_KEY,
  ORDER_CUTOFF_TIME_KEY,
  SHIPPING_DAYS_OFF_KEY,
  SHIPPING_HOLIDAYS_KEY,
  computeDeliveryEstimate,
  resolveZoneTransitDays,
} from "../../src/shared/lib/deliveryEstimate.js";

/*
 * "متوقع وصول طلبك الثلاثاء 15 سبتمبر" — the day the shipping quote carries.
 *
 * Kept apart from storefrontShippingService on purpose: handling time decides
 * dates, never prices, and the checkout pricing module is guarded against reading
 * it (tests/storefront-seo/shippingHandlingSettings.test.js).
 */

export const loadDeliveryEstimateConfig = async () => {
  const [enabled, cutoffTime, daysOff, holidays, handlingMinDays, handlingMaxDays] = await Promise.all([
    getSetting(DELIVERY_ESTIMATE_ENABLED_KEY, true),
    getSetting(ORDER_CUTOFF_TIME_KEY, DEFAULT_ORDER_CUTOFF_TIME),
    getSetting(SHIPPING_DAYS_OFF_KEY, DEFAULT_SHIPPING_DAYS_OFF),
    getSetting(SHIPPING_HOLIDAYS_KEY, []),
    getSetting("storefront.shipping_handling_min_days", 0),
    getSetting("storefront.shipping_handling_max_days", 1),
  ]);
  return { settings: { enabled, cutoffTime, daysOff, holidays }, handlingMinDays, handlingMaxDays };
};

/**
 * A matched zone uses its own transit days; with no zone (no governorate chosen
 * yet, or one the table does not cover) the window spans every active zone, so the
 * promise is never tighter than the truth.
 */
export const estimateDelivery = ({ zone = null, zones = [], config, now = new Date() } = {}) => {
  if (!config) return null;
  const clock = zonedParts(now);
  const estimateFor = (item) => computeDeliveryEstimate({
    now: clock,
    handling: resolveZoneHandlingTime(item || {}, config.handlingMinDays, config.handlingMaxDays),
    transit: resolveZoneTransitDays(item || {}),
    settings: config.settings,
  });
  if (zone) return estimateFor(zone);
  const perZone = (Array.isArray(zones) ? zones : []).map(estimateFor).filter(Boolean);
  if (!perZone.length) return null;
  return perZone.reduce((span, item) => ({
    ...span,
    earliest: item.earliest < span.earliest ? item.earliest : span.earliest,
    latest: item.latest > span.latest ? item.latest : span.latest,
  }));
};

/** The quote's `delivery_estimate`, or null when there is nothing honest to promise. */
export const resolveQuoteDeliveryEstimate = async ({ zone = null, zones = [], now = new Date() } = {}) => {
  const config = await loadDeliveryEstimateConfig().catch(() => null);
  const estimate = estimateDelivery({ zone, zones, config, now });
  if (!estimate) return null;
  return {
    scope: zone ? "zone" : "store",
    today: estimate.today,
    earliest: estimate.earliest,
    latest: estimate.latest,
    ordered_today: estimate.orderedToday,
    cutoff: estimate.cutoff,
    cutoff_minutes_left: estimate.cutoffMinutesLeft,
  };
};
