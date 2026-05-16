const STORAGE_KEY = "erp.settings.currency";

export const supportedCurrencies = [
  { code: "EGP", symbol: "ج.م", locale: "ar-EG", label: "Egyptian Pound" },
  { code: "USD", symbol: "$", locale: "en-US", label: "US Dollar" },
  { code: "SAR", symbol: "ر.س", locale: "ar-SA", label: "Saudi Riyal" },
  { code: "AED", symbol: "د.إ", locale: "ar-AE", label: "UAE Dirham" },
  { code: "EUR", symbol: "€", locale: "de-DE", label: "Euro" },
];

const DEFAULT_CURRENCY = supportedCurrencies[0];
const formatterCache = new Map();
const formattedCache = new Map();

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const resolveCurrentLanguage = () => {
  const win = safeWindow();
  if (!win) return "";
  return String(
    win.document?.documentElement?.dataset?.language ||
      win.document?.body?.dataset?.language ||
      win.localStorage.getItem("app_language") ||
      win.localStorage.getItem("i18nextLng") ||
      ""
  ).trim();
};

const readJson = (key, fallback) => {
  const win = safeWindow();
  if (!win) return fallback;

  try {
    const raw = win.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.setItem(key, JSON.stringify(value));
};

const normalizeCurrency = (value = {}) => {
  const code = String(value.code || value.currencyCode || DEFAULT_CURRENCY.code).trim().toUpperCase() || DEFAULT_CURRENCY.code;
  const fallback = supportedCurrencies.find((item) => item.code === code) || DEFAULT_CURRENCY;
  return {
    code,
    symbol: String(value.symbol || fallback.symbol || code).trim() || fallback.symbol || code,
    locale: String(value.locale || fallback.locale || DEFAULT_CURRENCY.locale).trim() || fallback.locale || DEFAULT_CURRENCY.locale,
  };
};

const resolveInitialCurrency = () => {
  const stored = readJson(STORAGE_KEY, null);
  if (stored && typeof stored === "object") {
    return normalizeCurrency(stored);
  }
  return DEFAULT_CURRENCY;
};

let currentCurrency = resolveInitialCurrency();

const resolveLanguage = (languageOrOverrides) => {
  if (typeof languageOrOverrides === "string") return languageOrOverrides;
  if (languageOrOverrides && typeof languageOrOverrides === "object") {
    return String(languageOrOverrides.language || languageOrOverrides.locale || "").trim();
  }
  return resolveCurrentLanguage();
};

const resolveCurrency = (overrides = {}) => normalizeCurrency({ ...currentCurrency, ...overrides });

const getFormatter = (currency, language) => {
  const key = `${currency.locale}|${currency.code}|${currency.symbol}|${language || ""}`;
  if (formatterCache.has(key)) return formatterCache.get(key);

  const locale = language && String(language).startsWith("ar") ? "ar-EG" : currency.locale;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.code,
    currencyDisplay: currency.code === "EGP" && String(language).startsWith("ar") ? "symbol" : "narrowSymbol",
    numberingSystem: "latn",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  formatterCache.set(key, formatter);
  return formatter;
};

const formatParts = (formatter, amount) => {
  const parts = formatter.formatToParts(amount);
  return parts
    .filter((part) => part.type !== "currency")
    .map((part) => part.value)
    .join("")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200E\u200F\u061C]/g, "")
    .trim();
};

const resolveDisplaySymbol = (currency, language) => {
  if (String(language || "").startsWith("ar")) {
    if (currency.code === "EGP") return "ج.م";
    if (currency.code === "SAR") return "ر.س";
    if (currency.code === "AED") return "د.إ";
  }

  if (currency.code === "EGP") return "EGP";
  if (currency.code === "SAR") return "SAR";
  if (currency.code === "AED") return "AED";
  if (currency.code === "EUR") return "€";
  return currency.symbol || currency.code;
};

export const getCurrency = () => currentCurrency;

export const setCurrency = (nextCurrency = {}) => {
  currentCurrency = normalizeCurrency(nextCurrency);
  writeJson(STORAGE_KEY, currentCurrency);
  formatterCache.clear();
  formattedCache.clear();
  return currentCurrency;
};

export const formatCurrency = (value, languageOrOverrides = {}) => {
  const language = resolveLanguage(languageOrOverrides);
  const resolvedLanguage = String(language || "").trim();
  const overrides = typeof languageOrOverrides === "object" && languageOrOverrides !== null ? languageOrOverrides : {};
  const currency = resolveCurrency(overrides);
  const amount = Number(value || 0);
  const cacheKey = `${currency.locale}|${currency.code}|${currency.symbol}|${resolvedLanguage}|${amount}`;
  if (formattedCache.has(cacheKey)) return formattedCache.get(cacheKey);

  const formatter = getFormatter(currency, resolvedLanguage);
  const numeric = formatParts(formatter, amount);
  const symbol = resolveDisplaySymbol(currency, resolvedLanguage);
  const output = resolvedLanguage.startsWith("ar") ? `${numeric} ${symbol}`.trim() : `${symbol} ${numeric}`.trim();

  formattedCache.set(cacheKey, output);
  return output;
};

export const formatNumber = (value, language = "") => {
  const resolvedLanguage = String(language || resolveCurrentLanguage() || "").trim();
  const locale = resolvedLanguage.startsWith("ar") ? "ar-EG" : "en-US";
  return new Intl.NumberFormat(locale, {
    numberingSystem: "latn",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
};

export const formatPercent = (value, language = "") => `${formatNumber(value, language)}%`;

export const resetCurrency = () => setCurrency(DEFAULT_CURRENCY);
