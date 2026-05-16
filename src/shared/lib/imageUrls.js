import { API_BASE_URL } from "../constants/app";

const trimSlashes = (value = "") => String(value).replace(/^\/+|\/+$/g, "");

const getBackendAssetBaseUrl = () => {
  const apiBase = String(API_BASE_URL || "").replace(/\/api\/?$/i, "").replace(/\/+$/g, "");
  if (/^https?:\/\//i.test(apiBase)) {
    if (!import.meta.env.DEV && /localhost|127\.0\.0\.1/i.test(apiBase) && typeof window !== "undefined") {
      return window.location.origin;
    }
    return apiBase;
  }

  if (typeof window !== "undefined") {
    if (import.meta.env.DEV || ["5173", "4173"].includes(window.location.port)) {
      return "http://localhost:8000";
    }
    return window.location.origin;
  }

  return "";
};

export const resolveProductImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

  const baseUrl = getBackendAssetBaseUrl();
  const joinAssetUrl = (path) => `${baseUrl}/${trimSlashes(path)}`;

  if (imageUrl.startsWith("/uploads/")) return joinAssetUrl(imageUrl);
  if (imageUrl.startsWith("uploads/")) return joinAssetUrl(imageUrl);
  if (imageUrl.startsWith("products/")) return joinAssetUrl(`/uploads/${imageUrl}`);
  if (imageUrl.startsWith("/products/")) return joinAssetUrl(`/uploads${imageUrl}`);
  if (imageUrl.startsWith("/")) return joinAssetUrl(imageUrl);

  return joinAssetUrl(`/uploads/products/${imageUrl}`);
};

export const isInvalidShippingProofUrl = (value) => {
  const proofUrl = String(value || "").trim();
  if (!proofUrl) return true;
  if (proofUrl.startsWith("data:image")) return true;
  if (proofUrl.startsWith("blob:")) return true;
  return false;
};

export const resolveShippingProofImageUrl = (value) => {
  const proofUrl = String(value || "").trim();
  if (isInvalidShippingProofUrl(proofUrl)) return "";
  return resolveProductImageUrl(proofUrl);
};

export const formatShippingPaymentMethodLabel = (value) => {
  const method = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (method === "instapay") return "InstaPay";
  if (method === "vodafone_cash" || method === "vodafonecash") return "Vodafone Cash";
  if (method === "shipping_confirmation") return "تأكيد الشحن";
  if (method === "cod") return "الدفع عند الاستلام";
  return value ? String(value) : "n/a";
};
