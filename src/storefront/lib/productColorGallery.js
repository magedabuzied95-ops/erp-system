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

const variantImageSources = (variant = {}) => {
  const safeVariant = variant && typeof variant === "object" ? variant : {};
  return [
  ...(Array.isArray(safeVariant.images) ? safeVariant.images : []),
  ...(Array.isArray(safeVariant.color_images) ? safeVariant.color_images : []),
  ...(Array.isArray(safeVariant.gallery_images) ? safeVariant.gallery_images : []),
  safeVariant.image_url,
  safeVariant.image,
];
};

const productImageSources = (product = {}) => {
  const safeProduct = product && typeof product === "object" ? product : {};
  return [
    ...(Array.isArray(safeProduct.gallery_images) ? safeProduct.gallery_images : []),
    ...(Array.isArray(safeProduct.images) ? safeProduct.images : []),
    ...(Array.isArray(safeProduct.image_urls) ? safeProduct.image_urls : []),
    safeProduct.image_url,
    safeProduct.product_image_url,
    safeProduct.image,
  ];
};

export const buildProductColorGroups = ({ variants = [], colorKey, colorName, variantHasStock }) => {
  const groups = new Map();
  const safeVariants = (Array.isArray(variants) ? variants : []).filter((variant) => variant && typeof variant === "object");
  safeVariants.forEach((variant) => {
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

const normalized = (value = "") => String(value ?? "").trim().toLowerCase();

export const resolveColorGroup = (colorGroups = [], requestedColor = "") => {
  const groups = Array.isArray(colorGroups) ? colorGroups.filter(Boolean) : [];
  const requested = normalized(requestedColor);
  return groups.find((group) => normalized(group?.key) === requested || normalized(group?.colorName) === requested) || groups[0] || null;
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
