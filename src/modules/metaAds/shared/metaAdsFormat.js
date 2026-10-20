// Number / money / date formatting shared by every Meta Ads screen.
// Latin digits in both languages (the shop reads Latin digits everywhere else too).

export const localeFor = (language) => (String(language || "").startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB");

const isBlank = (value) => value === null || value === undefined || value === "";

export const formatMoney = (value, currency = "USD", locale = "en-GB") => {
  if (isBlank(value)) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ""}`.trim();
};

// 29700 → "29.7 ألف" / "29.7K"; small numbers stay as they are.
export const formatCompact = (value, t, locale = "en-GB") => {
  if (isBlank(value)) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  const one = (n) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  const isArabic = locale.startsWith("ar");
  if (abs >= 1_000_000) return isArabic ? `${one(amount / 1_000_000)} ${t("metaAds.common.million")}` : `${one(amount / 1_000_000)}${t("metaAds.common.million")}`;
  if (abs >= 1_000) return isArabic ? `${one(amount / 1_000)} ${t("metaAds.common.thousand")}` : `${one(amount / 1_000)}${t("metaAds.common.thousand")}`;
  return amount.toLocaleString(locale, { maximumFractionDigits: 2 });
};

export const formatNumber = (value, locale = "en-GB", digits = 0) => {
  if (isBlank(value)) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const formatDate = (value, locale = "en-GB") => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Cairo" });
};

export const formatDateTime = (value, locale = "en-GB") => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Cairo" });
};

// Delivery dot colour for a status / effective_status.
export const deliveryTone = (status, isDraft = false) => {
  if (isDraft) return "neutral";
  const value = String(status || "").toUpperCase();
  if (value === "ACTIVE") return "success";
  if (["DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO"].includes(value)) return "danger";
  if (["PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED"].includes(value)) return "warning";
  return "neutral";
};
