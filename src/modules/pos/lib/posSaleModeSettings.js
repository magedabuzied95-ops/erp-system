import { normalizeSaleModeSettings } from "../../../shared/lib/saleMode.js";

// Device-persisted copy of the admin's last sale-mode toggle, used only when no
// settings endpoint is reachable (offline warm opens).
const POS_USE_SALE_PRICES_KEY = "pos.useSalePrices";

export const parseSaleModeEnabled = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

// Default is SALE OFF, not ON. A device that never saw an admin toggle must not
// invent a storewide sale: a wrong OFF charges the normal price, a wrong ON
// silently undercharges every walk-in (this is how cashier machines rang sale
// prices for two days after the permission-alias fix turned their
// GET /website/settings into a 403).
export const readUseSalePrices = () => {
  try {
    const saved = window.localStorage.getItem(POS_USE_SALE_PRICES_KEY);
    if (saved === "false" || saved === "0") return false;
    if (saved === "true" || saved === "1") return true;
  } catch {
    // Persisted POS preferences are best-effort only.
  }
  return false;
};

export const writeUseSalePrices = (value) => {
  try {
    window.localStorage.setItem(POS_USE_SALE_PRICES_KEY, String(Boolean(value)));
  } catch {
    // Persisted POS preferences are best-effort only.
  }
};

export const persistPosSaleModeEnabled = (value) => writeUseSalePrices(value);

const hasSaleModeKey = (settings) =>
  settings && settings.sale_mode_enabled !== undefined && settings.sale_mode_enabled !== null && settings.sale_mode_enabled !== "";

// Decide the sale-mode settings the POS catalog is priced with, in authority order:
//   1) GET /website/settings — the full settings row, but gated on the
//      website.settings permission, which cashier roles do not hold.
//   2) GET /settings/public — no permission needed; carries the same
//      sale_mode_* subset, so cashier machines still track the real toggle.
//   3) The device's last persisted admin toggle, defaulting to SALE OFF.
// Failing to load settings must never turn the sale on — every shared resolver
// fails safe to Sale OFF (see effectiveCustomerPrice.js), and the POS has to
// agree with them or the cashier charges a price the storefront refuses.
export const resolvePosSaleModeForLoad = ({ websiteSettings = null, publicSettings = null } = {}) => {
  const adminSettings = websiteSettings?.settings || null;
  if (hasSaleModeKey(adminSettings)) {
    return {
      source: "backend",
      saleModeSettings: normalizeSaleModeSettings({
        ...adminSettings,
        sale_mode_enabled: parseSaleModeEnabled(adminSettings.sale_mode_enabled, false),
      }),
    };
  }
  const sharedSettings = publicSettings?.settings || null;
  if (hasSaleModeKey(sharedSettings)) {
    return {
      source: "public",
      saleModeSettings: normalizeSaleModeSettings({
        ...sharedSettings,
        sale_mode_enabled: parseSaleModeEnabled(sharedSettings.sale_mode_enabled, false),
      }),
    };
  }
  return {
    source: "localStorage_fallback",
    saleModeSettings: normalizeSaleModeSettings({ sale_mode_enabled: readUseSalePrices() }),
  };
};
