const imageValue = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.image_url || value.preview || value.url || value.src || value.image || value.photo_url || value.thumbnail_url || "").trim();
  }
  return "";
};

const dedupeImages = (sources = [], meta = {}) => {
  const seen = new Set();
  return sources.reduce((images, source) => {
    const image = imageValue(source);
    if (!image || seen.has(image)) return images;
    seen.add(image);
    images.push({ image, ...meta });
    return images;
  }, []);
};

const variantImageSources = (variant = {}) => [
  ...(Array.isArray(variant.images) ? variant.images : []),
  ...(Array.isArray(variant.color_images) ? variant.color_images : []),
  ...(Array.isArray(variant.gallery_images) ? variant.gallery_images : []),
  variant.image_url,
  variant.image,
];

const productImageSources = (product = {}) => [
  ...(Array.isArray(product.gallery_images) ? product.gallery_images : []),
  ...(Array.isArray(product.images) ? product.images : []),
  ...(Array.isArray(product.image_urls) ? product.image_urls : []),
  product.image_url,
  product.product_image_url,
  product.image,
];

export const buildProductColorGroups = ({ variants = [], colorKey, colorName, variantHasStock }) => {
  const groups = new Map();
  variants.forEach((variant) => {
    const key = colorKey(variant) || String(variant.id || variant.variant_id || "");
    if (!groups.has(key)) {
      groups.set(key, { key, colorName: colorName(variant), variants: [], images: [] });
    }
    groups.get(key).variants.push(variant);
  });

  return [...groups.values()]
    .filter((group) => group.variants.some((variant) => variantHasStock(variant)))
    .map((group) => {
      const primaryVariant = group.variants.find((variant) => variantHasStock(variant)) || group.variants[0];
      const sources = group.variants.flatMap(variantImageSources);
      const primarySources = sources.filter((source) => typeof source === "object" && source?.is_primary);
      const images = dedupeImages(
        [...primarySources, ...sources],
        { colorKey: group.key, colorName: group.colorName, variantId: String(primaryVariant?.id || primaryVariant?.variant_id || "") }
      );
      return {
        ...group,
        images,
        primaryImage: images[0] || null,
      };
    });
};

export const buildSelectedColorGallery = ({ product = {}, colorGroup = null }) => {
  if (colorGroup?.images?.length) return colorGroup.images;
  // Legacy products can lack color-linked images. Only then use untagged product images.
  return dedupeImages(productImageSources(product), {
    colorKey: colorGroup?.key || "",
    colorName: colorGroup?.colorName || "",
    variantId: String(colorGroup?.variants?.[0]?.id || colorGroup?.variants?.[0]?.variant_id || ""),
  });
};

export const colorSwatchImage = (group = {}, fallback = "") => group?.primaryImage?.image || imageValue(fallback);
