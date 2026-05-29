import { API_ORIGIN } from "../constants/app";

const trimSlashes = (value = "") => String(value).replace(/^\/+|\/+$/g, "");

const isLocalHost = (hostname = "") => /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(String(hostname || ""));

const currentWindowUrl = () => {
  if (typeof window !== "undefined") {
    return {
      protocol: window.location.protocol || "http:",
      hostname: window.location.hostname || "localhost",
      port: window.location.port || "",
      origin: window.location.origin || "",
    };
  }
  return null;
};

const normalizeReachableUrl = (url) => {
  if (!url || typeof URL === "undefined") return url || "";
  const current = currentWindowUrl();
  if (!current) return url;
  try {
    const parsed = new URL(url);
    if (isLocalHost(parsed.hostname) && !isLocalHost(current.hostname)) {
      parsed.hostname = current.hostname;
    }
    return parsed.toString();
  } catch {
    return url;
  }
};

const getBackendAssetBaseUrl = () => {
  const apiOrigin = String(API_ORIGIN || "").trim().replace(/\/+$/g, "");
  const current = currentWindowUrl();

  if (/^https?:\/\//i.test(apiOrigin)) {
    return normalizeReachableUrl(apiOrigin).replace(/\/+$/g, "");
  }

  if (!current) return "";

  return current.origin.replace(/\/+$/g, "");
};

export const resolveProductImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return normalizeReachableUrl(imageUrl);
  if (/^\/\/(?!\/*uploads(?:\/|$))/i.test(imageUrl) && typeof window !== "undefined") {
    return normalizeReachableUrl(`${window.location.protocol}${imageUrl}`);
  }

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
