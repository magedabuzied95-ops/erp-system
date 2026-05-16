import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import commonAr from "../locales/ar/common.json";
import dashboardAr from "../locales/ar/dashboard.json";
import productsAr from "../locales/ar/products.json";
import posAr from "../locales/ar/pos.json";
import customersAr from "../locales/ar/customers.json";
import ordersAr from "../locales/ar/orders.json";
import inventoryAr from "../locales/ar/inventory.json";
import analyticsAr from "../locales/ar/analytics.json";
import reportsAr from "../locales/ar/reports.json";
import suppliersAr from "../locales/ar/suppliers.json";
import purchasesAr from "../locales/ar/purchases.json";
import accountingAr from "../locales/ar/accounting.json";
import expensesAr from "../locales/ar/expenses.json";
import branchesAr from "../locales/ar/branches.json";
import warehousesAr from "../locales/ar/warehouses.json";
import transfersAr from "../locales/ar/transfers.json";
import settingsAr from "../locales/ar/settings.json";
import authAr from "../locales/ar/auth.json";

import commonEn from "../locales/en/common.json";
import dashboardEn from "../locales/en/dashboard.json";
import productsEn from "../locales/en/products.json";
import posEn from "../locales/en/pos.json";
import customersEn from "../locales/en/customers.json";
import ordersEn from "../locales/en/orders.json";
import inventoryEn from "../locales/en/inventory.json";
import analyticsEn from "../locales/en/analytics.json";
import reportsEn from "../locales/en/reports.json";
import suppliersEn from "../locales/en/suppliers.json";
import purchasesEn from "../locales/en/purchases.json";
import accountingEn from "../locales/en/accounting.json";
import expensesEn from "../locales/en/expenses.json";
import branchesEn from "../locales/en/branches.json";
import warehousesEn from "../locales/en/warehouses.json";
import transfersEn from "../locales/en/transfers.json";
import settingsEn from "../locales/en/settings.json";
import authEn from "../locales/en/auth.json";

export const DEFAULT_LANGUAGE = "en";
export const LANGUAGE_STORAGE_KEY = "app_language";

export const normalizeLanguage = (language) => (String(language || "").startsWith("ar") ? "ar" : "en");

export const getStoredLanguage = () => {
  if (typeof localStorage === "undefined") return DEFAULT_LANGUAGE;
  return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE);
};

const resources = {
  ar: {
    translation: {
      common: commonAr.common || {},
      sidebar: commonAr.sidebar || {},
      language: commonAr.language || {},
      appearance: settingsAr.appearance || {},
      dashboard: dashboardAr,
      products: productsAr,
      pos: posAr,
      customers: customersAr,
      orders: ordersAr,
      inventory: inventoryAr,
      analytics: analyticsAr,
      reports: reportsAr,
      suppliers: suppliersAr,
      purchases: purchasesAr,
      accounting: accountingAr,
      expenses: expensesAr,
      branches: branchesAr,
      warehouses: warehousesAr,
      transfers: transfersAr,
      settings: settingsAr.settings || {},
      auth: authAr,
    },
  },
  en: {
    translation: {
      common: commonEn.common || {},
      sidebar: commonEn.sidebar || {},
      language: commonEn.language || {},
      appearance: settingsEn.appearance || {},
      dashboard: dashboardEn,
      products: productsEn,
      pos: posEn,
      customers: customersEn,
      orders: ordersEn,
      inventory: inventoryEn,
      analytics: analyticsEn,
      reports: reportsEn,
      suppliers: suppliersEn,
      purchases: purchasesEn,
      accounting: accountingEn,
      expenses: expensesEn,
      branches: branchesEn,
      warehouses: warehousesEn,
      transfers: transfersEn,
      settings: settingsEn.settings || {},
      auth: authEn,
    },
  },
};

const resolveFontFamily = (language) =>
  normalizeLanguage(language) === "ar"
    ? '"Cairo", "IBM Plex Sans Arabic", "Segoe UI", sans-serif'
    : '"Inter", "Segoe UI", sans-serif';

export const applyDocumentLanguage = (language) => {
  if (typeof document === "undefined") return;

  const normalized = normalizeLanguage(language);
  const dir = normalized === "ar" ? "rtl" : "ltr";
  const fontFamily = resolveFontFamily(normalized);

  document.documentElement.lang = normalized;
  document.documentElement.dir = dir;
  document.documentElement.dataset.language = normalized;
  document.documentElement.style.setProperty("--app-font", fontFamily);

  if (document.body) {
    document.body.dir = dir;
    document.body.dataset.language = normalized;
    document.body.style.setProperty("--app-font", fontFamily);
  }
};

export const persistApplicationLanguage = (language) => {
  const normalized = normalizeLanguage(language);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  applyDocumentLanguage(normalized);
  return normalized;
};

const savedLang = getStoredLanguage();

if (typeof localStorage !== "undefined") {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, savedLang);
  localStorage.removeItem("erp.language");
  localStorage.removeItem("i18nextLng");
  localStorage.removeItem("language");
  localStorage.removeItem("lang");
}

await i18n.use(initReactI18next).init({
  resources,
  lng: savedLang,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: ["ar", "en"],
  nonExplicitSupportedLngs: true,
  saveMissing: false,
  interpolation: {
    escapeValue: false,
  },
});

if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
  i18n.on("missingKey", (lngs, namespace, key) => {
    console.warn("[i18n] missing key", { lngs, namespace, key });
  });
}

await i18n.changeLanguage(savedLang);
applyDocumentLanguage(savedLang);

export { i18n };
export default i18n;
