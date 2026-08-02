import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export const SUPPORTED_LANGUAGES = ["en", "ar"];
export const DEFAULT_LANGUAGE = "en";

export const normalizeLanguage = (language) =>
  String(language || "").toLowerCase().startsWith("ar") ? "ar" : "en";

const readStoredUserLanguage = () => {
  if (typeof window === "undefined") return "";

  try {
    const user = JSON.parse(window.localStorage?.getItem("user") || "null");
    return (
      user?.language ||
      user?.preferredLanguage ||
      user?.preferred_language ||
      user?.settings?.language ||
      user?.profile?.language ||
      ""
    );
  } catch {
    return "";
  }
};

export const resolveCurrentLanguage = () => {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  return normalizeLanguage(
    window.document?.documentElement?.dataset?.language ||
      window.document?.body?.dataset?.language ||
      window.localStorage?.getItem("app_language") ||
      readStoredUserLanguage() ||
      window.navigator?.language ||
      DEFAULT_LANGUAGE
  );
};

export const getLanguageDirection = (language) => (normalizeLanguage(language) === "ar" ? "rtl" : "ltr");
export const isRtlLanguage = (language) => getLanguageDirection(language) === "rtl";
export const getLocale = (language) => (normalizeLanguage(language) === "ar" ? "ar-EG" : "en-GB");

export const numberFormatter = (language, options = {}) =>
  new Intl.NumberFormat(getLocale(language), {
    numberingSystem: "latn",
    maximumFractionDigits: 2,
    ...options,
  });

export const dateFormatter = (language, options = {}) =>
  new Intl.DateTimeFormat(getLocale(language), {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  });

export const formatLocalizedNumber = (value, language, options = {}) =>
  numberFormatter(language || resolveCurrentLanguage(), options).format(Number(value || 0));

export const formatLocalizedDate = (value, language, options = {}) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateFormatter(language || resolveCurrentLanguage(), options).format(date);
};

export const directionClass = (language, ltrClass = "", rtlClass = "") =>
  isRtlLanguage(language) ? rtlClass : ltrClass;

export function useLocale() {
  const { i18n, t } = useTranslation();
  const language = normalizeLanguage(i18n.resolvedLanguage || i18n.language || DEFAULT_LANGUAGE);
  const dir = getLanguageDirection(language);
  const locale = getLocale(language);
  const isRtl = dir === "rtl";

  return useMemo(
    () => ({
      language,
      dir,
      locale,
      isRtl,
      t,
      formatNumber: (value, options) => formatLocalizedNumber(value, language, options),
      formatDate: (value, options) => formatLocalizedDate(value, language, options),
      logical: (ltrClass = "", rtlClass = "") => directionClass(language, ltrClass, rtlClass),
    }),
    [language, dir, locale, isRtl, t]
  );
}
