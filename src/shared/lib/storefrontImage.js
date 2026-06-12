import { API_ORIGIN } from "../constants/app";

const STOREFRONT_IMAGE_PRESETS = {
  thumbnail: {
    widths: [48, 96],
    sizes: "(max-width: 767px) 48px, 96px",
  },
  small: {
    widths: [160, 240],
    sizes: "(max-width: 1023px) 160px, 240px",
  },
  grid: {
    widths: [320, 480],
    sizes: "(max-width: 767px) 320px, 480px",
  },
  hero: {
    widths: [640, 960],
    sizes: "(max-width: 1023px) 640px, 960px",
  },
};

const LOCAL_PRODUCT_IMAGE_VARIANT_WIDTHS = [96, 240, 480, 960];

const cloudinaryUploadPattern = /^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(.+)$/i;
const localProductUploadPattern = /(^|\/)uploads\/products\/(?!variants\/)([^?#]+)$/i;

const normalizeWidth = (value) => Math.max(1, Math.round(Number(value || 0)));

const uniqueWidths = (widths = []) => [...new Set((Array.isArray(widths) ? widths : []).map(normalizeWidth).filter(Boolean))].sort((a, b) => a - b);

export const isCloudinaryImageUrl = (value) => cloudinaryUploadPattern.test(String(value || "").trim());
export const isLocalProductImageUrl = (value) => localProductUploadPattern.test(String(value || "").trim());

const getImageOrigin = (value = "") => {
  const url = String(value || "").trim();
  if (!url || typeof URL === "undefined") return "";
  try {
    return new URL(url).origin || "";
  } catch {
    return "";
  }
};

const getBackendAssetOrigin = (value = "") => {
  const currentOrigin = getImageOrigin(value);
  const configuredApiOrigin = String(API_ORIGIN || "").trim().replace(/\/+$/g, "");
  if (configuredApiOrigin) {
    try {
      const parsed = new URL(configuredApiOrigin);
      if (parsed.origin && parsed.origin !== currentOrigin) {
        return parsed.origin;
      }
    } catch {
      return configuredApiOrigin;
    }
  }

  if (typeof window !== "undefined") {
    const hostname = String(window.location.hostname || "").trim();
    const port = String(window.location.port || "").trim();
    if (/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(hostname) && port && port !== "8000") {
      return `${window.location.protocol || "http:"}//${hostname}:8000`;
    }
  }

  return currentOrigin;
};

const getLocalProductVariantUrl = (value, width) => {
  const url = String(value || "").trim();
  const targetWidth = normalizeWidth(width);
  if (!url || !targetWidth || !isLocalProductImageUrl(url)) return url;
  const match = url.match(localProductUploadPattern);
  const originalFileName = match?.[2] || "";
  const baseName = originalFileName.replace(/\.[^.?#]+$/, "");
  const variantPath = `/uploads/products/variants/${baseName}-w${targetWidth}.webp`;
  const origin = getBackendAssetOrigin(url);
  if (origin) {
    return `${origin}${variantPath}`;
  }
  return variantPath;
};

export const buildCloudinaryResponsiveImageUrl = (value, width) => {
  const url = String(value || "").trim();
  if (!isCloudinaryImageUrl(url)) return url;
  const targetWidth = normalizeWidth(width);
  if (!targetWidth) return url;
  return url.replace(
    cloudinaryUploadPattern,
    (_match, rest) => `https://res.cloudinary.com/${url.match(/^https?:\/\/res\.cloudinary\.com\/([^/]+)\/image\/upload\//i)?.[1] || ""}/image/upload/c_limit,f_auto,q_auto,w_${targetWidth}/${rest}`
  );
};

export const buildStorefrontImageSrcSet = (value, widths = []) => {
  const url = String(value || "").trim();
  const requestedWidths = isLocalProductImageUrl(url) ? LOCAL_PRODUCT_IMAGE_VARIANT_WIDTHS : widths;
  const unique = uniqueWidths(requestedWidths);
  if (!url || !unique.length) return "";
  if (isCloudinaryImageUrl(url)) {
    return unique
      .map((width) => `${buildCloudinaryResponsiveImageUrl(url, width)} ${width}w`)
      .join(", ");
  }
  if (isLocalProductImageUrl(url)) {
    return unique
      .map((width) => `${getLocalProductVariantUrl(url, width)} ${width}w`)
      .join(", ");
  }
  return "";
};

export const getStorefrontImageSizes = (preset = "grid") => STOREFRONT_IMAGE_PRESETS[preset]?.sizes || "";

export const getStorefrontImageWidths = (preset = "grid") => STOREFRONT_IMAGE_PRESETS[preset]?.widths || [];

export const getStorefrontResponsiveImageProps = (value, preset = "grid") => {
  const srcSet = buildStorefrontImageSrcSet(value, getStorefrontImageWidths(preset));
  const sizes = getStorefrontImageSizes(preset);
  return {
    srcSet: srcSet || undefined,
    sizes: sizes || undefined,
  };
};
