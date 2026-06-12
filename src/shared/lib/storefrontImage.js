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

const cloudinaryUploadPattern = /^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(.+)$/i;

const normalizeWidth = (value) => Math.max(1, Math.round(Number(value || 0)));

const uniqueWidths = (widths = []) => [...new Set((Array.isArray(widths) ? widths : []).map(normalizeWidth).filter(Boolean))].sort((a, b) => a - b);

export const isCloudinaryImageUrl = (value) => cloudinaryUploadPattern.test(String(value || "").trim());

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
  const unique = uniqueWidths(widths);
  if (!url || !isCloudinaryImageUrl(url) || !unique.length) return "";
  return unique
    .map((width) => `${buildCloudinaryResponsiveImageUrl(url, width)} ${width}w`)
    .join(", ");
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
