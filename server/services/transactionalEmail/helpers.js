import { getPublicAppUrl, getPublicBackendUrl } from "../../utils/publicUrl.js";

export const text = (value = "") => String(value ?? "").trim();

export const escapeHtml = (value = "") => text(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

export const formatCurrency = (value = 0) => `${new Intl.NumberFormat("en-EG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))} EGP`;

export const formatOrderDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(date);
};

export const statusLabel = (value = "") => ({
  pending: "قيد المراجعة",
  pending_confirmation: "بانتظار التأكيد",
  confirmed: "تم التأكيد",
  processing: "قيد التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  payment_rejected: "تم رفض الدفع",
}[text(value).toLowerCase()] || text(value) || "قيد المراجعة");

export const paymentLabel = (value = "") => ({
  cod: "الدفع عند الاستلام",
  cash: "نقدي",
  instapay: "InstaPay",
  vodafone_cash: "Vodafone Cash",
  transfer: "تحويل بنكي",
  electronic: "دفع إلكتروني",
}[text(value).toLowerCase()] || text(value) || "غير محدد");

export const deliveryLabel = (value = "") => ({
  store_pickup: "استلام من المتجر",
  bosta: "Bosta",
  in_store_delivery: "توصيل المتجر",
  manual: "توصيل المتجر",
}[text(value).toLowerCase()] || text(value) || "توصيل المتجر");

export const absoluteAssetUrl = (value = "") => {
  const url = text(value);
  if (!url) return "";
  if (/^https:\/\//i.test(url)) return url;
  if (/^http:\/\//i.test(url)) return "";
  const base = getPublicBackendUrl() || getPublicAppUrl();
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : "";
};

export const storefrontUrl = () => getPublicAppUrl() || "";

export const safeUrl = (value = "") => {
  const url = text(value);
  return /^https:\/\//i.test(url) ? url : "";
};
