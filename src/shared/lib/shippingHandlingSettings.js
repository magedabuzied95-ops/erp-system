export const SHIPPING_HANDLING_MIN_KEY = "storefront.shipping_handling_min_days";
export const SHIPPING_HANDLING_MAX_KEY = "storefront.shipping_handling_max_days";

const integerOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

export const normalizeGlobalHandlingTime = (minValue, maxValue) => {
  const minDays = integerOrNull(minValue);
  const maxDays = integerOrNull(maxValue);
  return {
    minDays,
    maxDays,
    valid: minDays !== null && maxDays !== null && maxDays >= minDays,
  };
};

export const validateGlobalHandlingTime = (minValue, maxValue, language = "ar") => {
  const normalized = normalizeGlobalHandlingTime(minValue, maxValue);
  if (normalized.minDays === null || normalized.maxDays === null) {
    return language === "ar"
      ? "مدة التجهيز يجب أن تكون رقمًا صحيحًا يبدأ من صفر."
      : "Handling time must be a whole number starting from zero.";
  }
  if (normalized.maxDays < normalized.minDays) {
    return language === "ar"
      ? "الحد الأقصى لمدة التجهيز لا يمكن أن يقل عن الحد الأدنى."
      : "Maximum handling time cannot be less than the minimum.";
  }
  return "";
};

export const resolveZoneHandlingTime = (zone = {}, globalMinDays, globalMaxDays) => {
  const global = normalizeGlobalHandlingTime(globalMinDays, globalMaxDays);
  const overrideEnabled = zone.handling_time_override_enabled === true || zone.handlingTimeOverrideEnabled === true;
  if (!overrideEnabled) {
    return global.valid ? { minDays: global.minDays, maxDays: global.maxDays, source: "global" } : null;
  }
  const override = normalizeGlobalHandlingTime(
    zone.handling_min_days ?? zone.handlingMinDays,
    zone.handling_max_days ?? zone.handlingMaxDays
  );
  return override.valid ? { minDays: override.minDays, maxDays: override.maxDays, source: "zone" } : null;
};
