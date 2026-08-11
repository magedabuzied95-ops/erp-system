import { API_ORIGIN } from "../constants/app.js";

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

const FRONTEND_PUBLIC_ASSET_PREFIXES = [
  "/storefront/category-posters/",
];

const isFrontendPublicAsset = (value = "") => {
  const path = String(value || "").trim();
  return FRONTEND_PUBLIC_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix));
};

const resolveFrontendPublicAsset = (value = "") => {
  const path = String(value || "").trim();
  const current = currentWindowUrl();
  return current?.origin ? `${current.origin}${path}` : path;
};

export const resolveProductImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return normalizeReachableUrl(imageUrl);
  // Files shipped from Vite's public directory belong to the storefront
  // origin. Sending these paths to the API returns a non-image response,
  // which browsers correctly block through OpaqueResponseBlocking.
  if (isFrontendPublicAsset(imageUrl)) return resolveFrontendPublicAsset(imageUrl);
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

export const resolveBrandImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (/^\/?branding\//i.test(imageUrl) || /^\/?favicon(?:\.|\/)/i.test(imageUrl)) {
    const frontendPath = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
    return resolveFrontendPublicAsset(frontendPath);
  }
  return resolveProductImageUrl(imageUrl);
};

export const resolveEmployeeProfileImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return normalizeReachableUrl(imageUrl);
  if (/^(res\.cloudinary\.com|cloudinary\.com)\//i.test(imageUrl)) return `https://${imageUrl}`;
  if (/^\/\//.test(imageUrl) && typeof window !== "undefined") {
    return normalizeReachableUrl(`${window.location.protocol}${imageUrl}`);
  }

  const baseUrl = getBackendAssetBaseUrl();
  const joinAssetUrl = (path) => `${baseUrl}/${trimSlashes(path)}`;

  if (imageUrl.startsWith("/uploads/")) return joinAssetUrl(imageUrl);
  if (imageUrl.startsWith("uploads/")) return joinAssetUrl(imageUrl);
  if (imageUrl.startsWith("/")) return joinAssetUrl(imageUrl);
  if (imageUrl.includes("/")) return joinAssetUrl(`/${imageUrl}`);

  return joinAssetUrl(`/uploads/${imageUrl}`);
};

export const isInvalidShippingProofUrl = (value) => {
  const proofUrl = String(value || "").trim();
  if (!proofUrl) return false;
  if (proofUrl.startsWith("data:image")) return true;
  if (proofUrl.startsWith("blob:")) return true;
  return false;
};

export const resolveShippingProofImageUrl = (value) => {
  const proofUrl = String(value || "").trim();
  if (isInvalidShippingProofUrl(proofUrl)) return "";
  if (!proofUrl) return "";
  if (proofUrl.startsWith("data:") || proofUrl.startsWith("blob:")) return proofUrl;
  if (/^https?:\/\//i.test(proofUrl)) return normalizeReachableUrl(proofUrl);
  if (/^\/\/(?!\/*uploads(?:\/|$))/i.test(proofUrl) && typeof window !== "undefined") {
    return normalizeReachableUrl(`${window.location.protocol}${proofUrl}`);
  }

  const baseUrl = getBackendAssetBaseUrl();
  const joinAssetUrl = (path) => `${baseUrl}/${trimSlashes(path)}`;
  if (proofUrl.startsWith("/uploads/")) return joinAssetUrl(proofUrl);
  if (proofUrl.startsWith("uploads/")) return joinAssetUrl(proofUrl);
  if (proofUrl.startsWith("payment-proofs/")) return joinAssetUrl(`/uploads/${proofUrl}`);
  if (proofUrl.startsWith("/payment-proofs/")) return joinAssetUrl(`/uploads${proofUrl}`);
  if (proofUrl.startsWith("/")) return joinAssetUrl(proofUrl);
  return joinAssetUrl(`/uploads/payment-proofs/${proofUrl}`);
};

export const getShippingProofRawValue = (order = {}) => {
  const direct = [
    order.shipping_payment_screenshot,
    order.payment_proof_url,
    order.shipping_proof_url,
    order.proof_image_url,
    order.payment_screenshot_url,
    order.payment_screenshot,
    order.shipping_payment_proof_url,
  ].find((value) => String(value || "").trim());
  if (direct) return String(direct).trim();

  const metadata = order.metadata || order.meta || {};
  if (metadata && typeof metadata === "object") {
    const metaValue = [
      metadata.shipping_payment_screenshot,
      metadata.payment_proof_url,
      metadata.shipping_proof_url,
      metadata.proof_image_url,
      metadata.payment_screenshot_url,
      metadata.proof,
    ].find((value) => String(value || "").trim());
    if (metaValue) return String(metaValue).trim();
  }

  const attachments = Array.isArray(order.attachments) ? order.attachments : [];
  const attachment = attachments.find((item) => {
    const type = String(item?.type || item?.kind || item?.name || item?.label || "").toLowerCase();
    const url = String(item?.url || item?.path || item?.image_url || item?.href || "").trim();
    return url && (type.includes("proof") || type.includes("payment") || type.includes("shipping") || type.includes("screenshot"));
  }) || attachments.find((item) => String(item?.url || item?.path || item?.image_url || item?.href || "").trim());

  return attachment ? String(attachment.url || attachment.path || attachment.image_url || attachment.href || "").trim() : "";
};

export const formatShippingPaymentMethodLabel = (value) => {
  const method = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (method === "instapay") return "InstaPay";
  if (method === "vodafone_cash" || method === "vodafonecash") return "Vodafone Cash";
  if (method === "shipping_confirmation") return "تأكيد الشحن";
  if (method === "cod") return "الدفع عند الاستلام";
  return value ? String(value) : "n/a";
};
