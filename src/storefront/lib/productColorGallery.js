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

const list = (value) => Array.isArray(value) ? value : value ? [value] : [];

const variantImageSources = (variant = {}) => {
  const safeVariant = variant && typeof variant === "object" ? variant : {};
  return [
  ...list(safeVariant.images),
  ...list(safeVariant.color_images),
  ...list(safeVariant.gallery_images),
  ...list(safeVariant.additional_images),
  safeVariant.image_url,
  safeVariant.image,
];
};

const productImageSources = (product = {}) => {
  const safeProduct = product && typeof product === "object" ? product : {};
  return [
    ...list(safeProduct.gallery_images),
    ...list(safeProduct.images),
    ...list(safeProduct.image_urls),
    ...list(safeProduct.additional_images),
    ...list(safeProduct.additional_image_urls),
    ...list(safeProduct.additionalImages),
    ...list(safeProduct.gallery),
    ...list(safeProduct.photos),
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

export const buildSelectedColorGallery = ({ product = {}, colorGroup = null, colorGroupCount = 2 }) => {
  const meta = {
    colorKey: colorGroup?.key || "",
    colorName: colorGroup?.colorName || "",
    variantId: String(colorGroup?.variants?.[0]?.id || colorGroup?.variants?.[0]?.variant_id || ""),
  };
  const colorImages = Array.isArray(colorGroup?.images) ? colorGroup.images : [];
  const generalImages = productImageSources(product);
  // With one real color, untagged product images are safely additional angles of it.
  if (Number(colorGroupCount) <= 1) return dedupeImages([...colorImages, ...generalImages], meta);
  if (colorImages.length) return colorImages;
  // A multi-color legacy product without color metadata still gets a safe general fallback.
  return dedupeImages(generalImages, meta);
};

export const colorSwatchImage = (group = {}, fallback = "") => group?.primaryImage?.image || imageValue(fallback);
