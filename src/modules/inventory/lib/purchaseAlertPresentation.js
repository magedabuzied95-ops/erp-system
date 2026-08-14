const GROUPED_PURCHASE_MODES = new Set(["FULL_COLOR_RUN", "FULL_CARTON"]);

const normalizePurchaseMode = (value) => String(value || "").trim().toUpperCase();

export const isGroupedPurchaseAlert = (alert = {}) =>
  GROUPED_PURCHASE_MODES.has(normalizePurchaseMode(alert.purchase_mode));

export const shouldShowSizeLevelAlertDetails = (alert = {}) =>
  !isGroupedPurchaseAlert(alert);

export const getUserFacingTriggerVariants = (alert = {}) => {
  if (isGroupedPurchaseAlert(alert)) return [];
  const suggestion = alert.purchase_suggestion || {};
  return suggestion.trigger_variants || alert.trigger_variants || [];
};

export const formatPurchaseSizeRange = (sizes = []) => {
  const values = sizes.map((size) => String(size ?? "").trim()).filter(Boolean);
  if (values.length <= 1) return values[0] || "";
  return `${values[0]}\u2013${values[values.length - 1]}`;
};

export const getGroupedPurchaseAlertPresentation = (alert = {}) => {
  if (!isGroupedPurchaseAlert(alert)) return null;

  const suggestion = alert.purchase_suggestion || {};
  const mode = normalizePurchaseMode(alert.purchase_mode);
  const colors = Array.isArray(suggestion.colors) ? suggestion.colors.filter(Boolean) : [];
  const sizes = Array.isArray(suggestion.sizes) ? suggestion.sizes.filter(Boolean) : [];

  return {
    mode,
    modeLabel: suggestion.mode_label_ar || "",
    color: suggestion.color || colors[0] || alert.color || "",
    colorCount: colors.length,
    sizeRange: formatPurchaseSizeRange(sizes),
    totalUnits: Number(suggestion.total_units || 0),
    reasonKey: mode === "FULL_CARTON" ? "fullCartonSummary" : "fullColorRunSummary",
  };
};
