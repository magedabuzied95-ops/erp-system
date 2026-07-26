const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};
const setting = (settings = {}, key, fallback = undefined) => {
  const storefront = settings.storefront && typeof settings.storefront === "object" ? settings.storefront : {};
  if (settings[key] !== undefined) return settings[key];
  if (key.startsWith("storefront.") && storefront[key.slice(11)] !== undefined) return storefront[key.slice(11)];
  if (key.startsWith("storefront.") && settings[key.slice(11)] !== undefined) return settings[key.slice(11)];
  if (key.startsWith("orders.") && settings[key.slice(7)] !== undefined) return settings[key.slice(7)];
  return fallback;
};

const normalizeArabicDigits = (value = "") =>
  text(value).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

export const parseLegacyDeliveryRange = (value = "") => {
  const matches = normalizeArabicDigits(value).match(/\d+/g)?.map(Number).filter(Number.isFinite) || [];
  if (!matches.length) return null;
  const minValue = Math.max(0, Math.round(matches[0]));
  const maxValue = Math.max(minValue, Math.round(matches[1] ?? matches[0]));
  return { minValue, maxValue };
};

export const normalizeShippingPolicyZone = (zone = {}) => {
  const legacy = parseLegacyDeliveryRange(zone.estimated_delivery_text || zone.estimatedDeliveryText || zone.eta);
  const deliveryMinDays = numberOrNull(zone.delivery_min_days ?? zone.deliveryMinDays) ?? legacy?.minValue ?? null;
  const deliveryMaxDays = numberOrNull(zone.delivery_max_days ?? zone.deliveryMaxDays) ?? legacy?.maxValue ?? null;
  return {
    ...zone,
    active: zone.active !== false,
    price: Number(zone.price ?? zone.shipping_price ?? 0),
    free_shipping_threshold: Number(zone.free_shipping_threshold ?? zone.freeShippingThreshold ?? 0),
    delivery_min_days: deliveryMinDays,
    delivery_max_days: deliveryMaxDays,
    handling_min_days: numberOrNull(zone.handling_min_days ?? zone.handlingMinDays),
    handling_max_days: numberOrNull(zone.handling_max_days ?? zone.handlingMaxDays),
    transit_min_days: numberOrNull(zone.transit_min_days ?? zone.transitMinDays),
    transit_max_days: numberOrNull(zone.transit_max_days ?? zone.transitMaxDays),
  };
};

const duration = (minValue, maxValue) => {
  if (minValue === null || maxValue === null) return null;
  return { "@type": "QuantitativeValue", minValue, maxValue, unitCode: "DAY" };
};

export const buildOfferShippingDetails = ({
  zones = [],
  currency = "",
  productPrice = 0,
  handlingMinDays = null,
  handlingMaxDays = null,
} = {}) => {
  const normalizedCurrency = text(currency).toUpperCase();
  if (!normalizedCurrency) return [];
  return (Array.isArray(zones) ? zones : [])
  .map(normalizeShippingPolicyZone)
  .filter((zone) => zone.active && text(zone.governorate || zone.city || zone.area || zone.district || zone.zone))
  .map((zone) => {
    const region = text(zone.area || zone.district || zone.zone || zone.city || zone.governorate);
    const freeForProduct = zone.free_shipping_threshold > 0 && Number(productPrice || 0) >= zone.free_shipping_threshold;
    const resolvedHandling = resolveZoneHandlingTime(zone, handlingMinDays, handlingMaxDays);
    const handlingTime = resolvedHandling ? duration(resolvedHandling.minDays, resolvedHandling.maxDays) : null;
    const configuredTransit = duration(zone.transit_min_days, zone.transit_max_days);
    const legacyTotalTransit = duration(zone.delivery_min_days, zone.delivery_max_days);
    const transitTime = configuredTransit || legacyTotalTransit;
    if (!transitTime && !handlingTime) return null;
    return {
      "@type": "OfferShippingDetails",
      shippingDestination: {
        "@type": "DefinedRegion",
        addressCountry: "EG",
        ...(region ? { addressRegion: region } : {}),
      },
      shippingRate: {
        "@type": "MonetaryAmount",
        value: freeForProduct ? 0 : Number(zone.price || 0),
        currency: normalizedCurrency,
      },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        ...(handlingTime ? { handlingTime } : {}),
        ...(transitTime ? { transitTime } : {}),
      },
    };
  })
  .filter(Boolean);
};

export const normalizeMerchantReturnPolicy = (settings = {}) => {
  const days = Number(setting(settings, "orders.return_exchange_window_days", 0));
  const enabled = Boolean(setting(settings, "storefront.return_policy_enabled", days > 0));
  if (!enabled || !Number.isFinite(days) || days <= 0) return null;
  return {
    days: Math.round(days),
    returnMethod: text(setting(settings, "storefront.return_method", "")),
    customerRemorseFees: text(setting(settings, "storefront.customer_remorse_return_fees", "")),
    defectFees: text(setting(settings, "storefront.defect_return_fees", "")),
    policyUrl: text(setting(settings, "storefront.return_policy_url", "")),
    conditions: setting(settings, "storefront.return_policy_conditions", {}),
  };
};

const schemaReturnMethod = {
  mail: "https://schema.org/ReturnByMail",
  in_store: "https://schema.org/ReturnInStore",
  kiosk: "https://schema.org/ReturnAtKiosk",
};
const schemaReturnFees = {
  customer_responsibility: "https://schema.org/ReturnFeesCustomerResponsibility",
  free: "https://schema.org/FreeReturn",
};

export const buildMerchantReturnPolicy = (settings = {}) => {
  const policy = normalizeMerchantReturnPolicy(settings);
  if (!policy) return null;
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "EG",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: policy.days,
    ...(schemaReturnMethod[policy.returnMethod] ? { returnMethod: schemaReturnMethod[policy.returnMethod] } : {}),
    ...(schemaReturnFees[policy.customerRemorseFees] ? { returnFees: schemaReturnFees[policy.customerRemorseFees] } : {}),
    ...(policy.policyUrl ? { merchantReturnLink: policy.policyUrl } : {}),
  };
};
import { resolveZoneHandlingTime } from "./shippingHandlingSettings.js";
