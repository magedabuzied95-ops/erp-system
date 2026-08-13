import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { buildResources } from "./localeManifest";

import commonAr from "../locales/ar/common.json";
import dashboardAr from "../locales/ar/dashboard.json";
import productsAr from "../locales/ar/products.json";
import posAr from "../locales/ar/pos.json";
import customersAr from "../locales/ar/customers.json";
import ordersAr from "../locales/ar/orders.json";
import inventoryAr from "../locales/ar/inventory.json";
import analyticsAr from "../locales/ar/analytics.json";
import reportsAr from "../locales/ar/reports.json";
import overviewAr from "../locales/ar/overview.json";
import inventoryAnalyticsAr from "../locales/ar/inventoryAnalytics.json";
import salesAnalyticsAr from "../locales/ar/salesAnalytics.json";
import suppliersAr from "../locales/ar/suppliers.json";
import purchasesAr from "../locales/ar/purchases.json";
import accountingAr from "../locales/ar/accounting.json";
import expensesAr from "../locales/ar/expenses.json";
import branchesAr from "../locales/ar/branches.json";
import warehousesAr from "../locales/ar/warehouses.json";
import transfersAr from "../locales/ar/transfers.json";
import settingsAr from "../locales/ar/settings.json";
import managerPortalAr from "../locales/ar/managerPortal.json";
import employeePortalAr from "../locales/ar/employeePortal.json";
import attendanceAr from "../locales/ar/attendance.json";
import accessAr from "../locales/ar/access.json";
import authAr from "../locales/ar/auth.json";
import marketingAr from "../locales/ar/marketing.json";
import aiStudioAr from "../locales/ar/aiStudio.json";
import aiSupportAr from "../locales/ar/aiSupport.json";
import shippingAr from "../locales/ar/shipping.json";
import loyaltyAr from "../locales/ar/loyalty.json";
import saasAr from "../locales/ar/saas.json";
import storefrontAr from "../locales/ar/storefront.json";
import printAr from "../locales/ar/print.json";
import salesAr from "../locales/ar/sales.json";

import commonEn from "../locales/en/common.json";
import dashboardEn from "../locales/en/dashboard.json";
import productsEn from "../locales/en/products.json";
import posEn from "../locales/en/pos.json";
import customersEn from "../locales/en/customers.json";
import ordersEn from "../locales/en/orders.json";
import inventoryEn from "../locales/en/inventory.json";
import analyticsEn from "../locales/en/analytics.json";
import reportsEn from "../locales/en/reports.json";
import overviewEn from "../locales/en/overview.json";
import inventoryAnalyticsEn from "../locales/en/inventoryAnalytics.json";
import salesAnalyticsEn from "../locales/en/salesAnalytics.json";
import suppliersEn from "../locales/en/suppliers.json";
import purchasesEn from "../locales/en/purchases.json";
import accountingEn from "../locales/en/accounting.json";
import expensesEn from "../locales/en/expenses.json";
import branchesEn from "../locales/en/branches.json";
import warehousesEn from "../locales/en/warehouses.json";
import transfersEn from "../locales/en/transfers.json";
import settingsEn from "../locales/en/settings.json";
import managerPortalEn from "../locales/en/managerPortal.json";
import employeePortalEn from "../locales/en/employeePortal.json";
import attendanceEn from "../locales/en/attendance.json";
import accessEn from "../locales/en/access.json";
import authEn from "../locales/en/auth.json";
import marketingEn from "../locales/en/marketing.json";
import aiStudioEn from "../locales/en/aiStudio.json";
import aiSupportEn from "../locales/en/aiSupport.json";
import shippingEn from "../locales/en/shipping.json";
import loyaltyEn from "../locales/en/loyalty.json";
import saasEn from "../locales/en/saas.json";
import storefrontEn from "../locales/en/storefront.json";
import printEn from "../locales/en/print.json";
import salesEn from "../locales/en/sales.json";

export const DEFAULT_LANGUAGE = "en";
export const LANGUAGE_STORAGE_KEY = "app_language";

export const normalizeLanguage = (language) => (String(language || "").toLowerCase().startsWith("ar") ? "ar" : "en");
export const isRtlLanguage = (language) => normalizeLanguage(language) === "ar";
export const getLanguageDirection = (language) => (isRtlLanguage(language) ? "rtl" : "ltr");

const readStorage = (key) => {
  try {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const writeStorage = (key, value) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

const removeStorage = (key) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

const parseStoredJson = (key) => {
  try {
    const raw = readStorage(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const readUserLanguagePreference = () => {
  const user = parseStoredJson("user");
  return (
    user?.language ||
    user?.preferredLanguage ||
    user?.preferred_language ||
    user?.settings?.language ||
    user?.profile?.language ||
    ""
  );
};

export const getStoredLanguage = () => {
  const stored = readStorage(LANGUAGE_STORAGE_KEY);
  if (stored) return normalizeLanguage(stored);

  const userLanguage = readUserLanguagePreference();
  return userLanguage ? normalizeLanguage(userLanguage) : null;
};

export const getBrowserLanguage = () => {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  return normalizeLanguage(navigator.language || DEFAULT_LANGUAGE);
};

export const resolveInitialLanguage = () => {
  return getStoredLanguage() || getBrowserLanguage();
};

/**
 * The branch -> file wiring lives in localeManifest.js so the dictionary parity
 * guard reads exactly the same tree the runtime does. Assigning branches by
 * hand here previously allowed a duplicate `inventory` key to silently drop a
 * whole bundle.
 */
const resources = buildResources({
  ar: {
    common: commonAr,
    dashboard: dashboardAr,
    products: productsAr,
    pos: posAr,
    customers: customersAr,
    orders: ordersAr,
    inventory: inventoryAr,
    analytics: analyticsAr,
    reports: reportsAr,
    overview: overviewAr,
    inventoryAnalytics: inventoryAnalyticsAr,
    salesAnalytics: salesAnalyticsAr,
    suppliers: suppliersAr,
    purchases: purchasesAr,
    accounting: accountingAr,
    expenses: expensesAr,
    branches: branchesAr,
    warehouses: warehousesAr,
    transfers: transfersAr,
    settings: settingsAr,
    managerPortal: managerPortalAr,
    employeePortal: employeePortalAr,
    attendance: attendanceAr,
    access: accessAr,
    auth: authAr,
    marketing: marketingAr,
    aiStudio: aiStudioAr,
    aiSupport: aiSupportAr,
    shipping: shippingAr,
    loyalty: loyaltyAr,
    saas: saasAr,
    storefront: storefrontAr,
    print: printAr,
    sales: salesAr,
  },
  en: {
    common: commonEn,
    dashboard: dashboardEn,
    products: productsEn,
    pos: posEn,
    customers: customersEn,
    orders: ordersEn,
    inventory: inventoryEn,
    analytics: analyticsEn,
    reports: reportsEn,
    overview: overviewEn,
    inventoryAnalytics: inventoryAnalyticsEn,
    salesAnalytics: salesAnalyticsEn,
    suppliers: suppliersEn,
    purchases: purchasesEn,
    accounting: accountingEn,
    expenses: expensesEn,
    branches: branchesEn,
    warehouses: warehousesEn,
    transfers: transfersEn,
    settings: settingsEn,
    managerPortal: managerPortalEn,
    employeePortal: employeePortalEn,
    attendance: attendanceEn,
    access: accessEn,
    auth: authEn,
    marketing: marketingEn,
    aiStudio: aiStudioEn,
    aiSupport: aiSupportEn,
    shipping: shippingEn,
    loyalty: loyaltyEn,
    saas: saasEn,
    storefront: storefrontEn,
    print: printEn,
    sales: salesEn,
  },
});

const resolveFontFamily = (language) =>
  normalizeLanguage(language) === "ar"
    ? '"Cairo", "Tajawal", "Noto Sans Arabic", "IBM Plex Sans Arabic", "Segoe UI", sans-serif'
    : '"Inter", "Segoe UI", sans-serif';

export const applyDocumentLanguage = (language) => {
  if (typeof document === "undefined") return;

  const normalized = normalizeLanguage(language);
  const dir = getLanguageDirection(normalized);
  const fontFamily = resolveFontFamily(normalized);
  const textAlign = dir === "rtl" ? "right" : "left";
  const start = dir === "rtl" ? "right" : "left";
  const end = dir === "rtl" ? "left" : "right";

  document.documentElement.lang = normalized;
  document.documentElement.dir = dir;
  document.documentElement.dataset.language = normalized;
  document.documentElement.dataset.direction = dir;
  document.documentElement.classList.toggle("rtl", dir === "rtl");
  document.documentElement.classList.toggle("ltr", dir === "ltr");
  document.documentElement.classList.toggle("dir-rtl", dir === "rtl");
  document.documentElement.classList.toggle("dir-ltr", dir === "ltr");
  document.documentElement.style.setProperty("--app-font", fontFamily);
  document.documentElement.style.setProperty("--dir", dir);
  document.documentElement.style.setProperty("--text-align", textAlign);
  document.documentElement.style.setProperty("--start", start);
  document.documentElement.style.setProperty("--end", end);

  if (document.body) {
    document.body.dir = dir;
    document.body.dataset.language = normalized;
    document.body.dataset.direction = dir;
    document.body.classList.toggle("rtl", dir === "rtl");
    document.body.classList.toggle("ltr", dir === "ltr");
    document.body.classList.toggle("dir-rtl", dir === "rtl");
    document.body.classList.toggle("dir-ltr", dir === "ltr");
    document.body.style.setProperty("--app-font", fontFamily);
    document.body.style.setProperty("--dir", dir);
    document.body.style.setProperty("--text-align", textAlign);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp:language-changed", { detail: { language: normalized, dir } }));
  }
};

export const persistApplicationLanguage = (language) => {
  const normalized = normalizeLanguage(language);
  writeStorage(LANGUAGE_STORAGE_KEY, normalized);

  const user = parseStoredJson("user");
  if (user && typeof user === "object") {
    const nextUser = {
      ...user,
      language: normalized,
      preferredLanguage: normalized,
      settings: {
        ...(user.settings && typeof user.settings === "object" ? user.settings : {}),
        language: normalized,
      },
    };

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("user", JSON.stringify(nextUser));
      }
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }

  applyDocumentLanguage(normalized);
  return normalized;
};

const initialLanguage = resolveInitialLanguage();

const readableMissingKeyFallback = (key = "") =>
  String(Array.isArray(key) ? key[0] : key || "")
    .split(".")
    .pop()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

removeStorage("erp.language");
removeStorage("i18nextLng");
removeStorage("language");
removeStorage("lang");

await i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: ["ar", "en"],
  nonExplicitSupportedLngs: true,
  saveMissing: typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV),
  interpolation: {
    escapeValue: false,
  },
});

const originalT = i18n.t.bind(i18n);
i18n.t = (key, options, ...rest) => {
  if (typeof key !== "string" && !Array.isArray(key)) {
    if (typeof options?.defaultValue === "string") return options.defaultValue;
    if (typeof key?.label === "string") return key.label;
    if (typeof key?.title === "string") return key.title;
    if (typeof key?.name === "string") return key.name;
    if (typeof key?.value === "string") return key.value;
    return "";
  }
  const translated = originalT(key, options, ...rest);
  const primaryKey = Array.isArray(key) ? key.find((item) => typeof item === "string") : key;
  if (typeof translated === "string" && typeof primaryKey === "string" && translated === primaryKey) {
    return typeof options?.defaultValue === "string" ? options.defaultValue : readableMissingKeyFallback(primaryKey);
  }
  return translated;
};

if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
  const missingKeys = new Set();
  i18n.on("missingKey", (lngs, namespace, key) => {
    if (typeof key !== "string") {
      console.warn("[i18n] non-string missing key blocked", {
        lngs,
        namespace,
        key,
        keyType: typeof key,
        stack: new Error().stack,
      });
      return;
    }
    const id = `${namespace}:${key}`;
    if (missingKeys.has(id)) return;
    missingKeys.add(id);
    console.warn("[i18n] missing key", { lngs, namespace, key });
  });
}

i18n.on("languageChanged", (language) => {
  applyDocumentLanguage(language);
});

applyDocumentLanguage(initialLanguage);

export { i18n };
export default i18n;
