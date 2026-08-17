const imageValue = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.image_url || value.preview || value.url || value.src || value.image || value.photo_url || value.thumbnail_url || "").trim();
  }
  return "";
};

const normalizedImageUrl = (value = "") => {
  const raw = imageValue(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://m1store-egy.com");
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return raw.split(/[?#]/)[0].trim().replace(/\/{2,}/g, "/").replace(/\/$/, "").toLowerCase();
  }
};

const imageId = (value = {}) => typeof value === "object" && value
  ? String(value.image_id || value.imageId || value.media_id || value.mediaId || value.asset_id || value.assetId || value.id || "").trim()
  : "";

const dedupeImages = (sources = [], meta = {}) => {
  const seenIds = new Set();
  const seenUrls = new Set();
  return sources.reduce((images, source) => {
    const image = imageValue(source);
    const id = imageId(source);
    const url = normalizedImageUrl(source);
    if (!image || (id && seenIds.has(id)) || (url && seenUrls.has(url))) return images;
    if (id) seenIds.add(id);
    if (url) seenUrls.add(url);
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
  ...list(safeVariant.image_urls),
  safeVariant.image_url,
  safeVariant.image,
];
};

const colorEntrySources = (entry = {}) => {
  const safeEntry = entry && typeof entry === "object" ? entry : {};
  return [
    ...list(safeEntry.images),
    ...list(safeEntry.color_images),
    ...list(safeEntry.gallery_images),
    ...list(safeEntry.additional_images),
    safeEntry.primary_image_url,
    safeEntry.color_image_url,
    safeEntry.colorPrimaryImageUrl,
    safeEntry.image_url,
    safeEntry.image,
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

const normalized = (value = "") => String(value ?? "").trim().toLowerCase();

const entryGroupKey = (entry = {}) => normalized(entry?.color_group_key ?? entry?.colorGroupKey ?? "");

const entryColorNames = (entry = {}) => [entry?.color, entry?.color_name, entry?.colorName, entry?.name].map(normalized).filter(Boolean);

// A colour entry belongs to exactly one colour group. Matching it by the visible
// name merges two independently saved colours that happen to share a label — two
// different shoes both called "Grey" would show each other's photos. So the
// durable colour key wins, and the name is only a fallback for legacy entries
// that carry no key and whose name is unique on this product.
const matchingColorEntries = (product = {}, group = {}, { groupKeys = new Set(), nameIsAmbiguous = false } = {}) => {
  const entries = [...list(product?.color_images), ...list(product?.colors)].filter((entry) => entry && typeof entry === "object");
  const groupKey = normalized(group?.key);
  const keyed = groupKey ? entries.filter((entry) => entryGroupKey(entry) === groupKey) : [];
  if (keyed.length) return keyed;
  if (nameIsAmbiguous) return [];
  const legacyKeys = new Set([groupKey, normalized(group?.colorName)].filter(Boolean));
  return entries.filter((entry) => {
    const key = entryGroupKey(entry);
    // An entry keyed to another group is that group's, never this one's.
    if (key && groupKeys.has(key)) return false;
    return entryColorNames(entry).some((name) => legacyKeys.has(name));
  });
};

export const buildProductColorGroups = ({ product = {}, variants = [], colorKey, colorName, variantHasStock }) => {
  const groups = new Map();
  const safeVariants = (Array.isArray(variants) ? variants : []).filter((variant) => variant && typeof variant === "object");
  safeVariants.forEach((variant) => {
    const key = colorKey(variant) || String(variant.id || variant.variant_id || "");
    if (!groups.has(key)) {
      groups.set(key, { key, colorName: colorName(variant), variants: [], images: [] });
    }
    groups.get(key).variants.push(variant);
  });

  const groupKeys = new Set([...groups.keys()].map(normalized).filter(Boolean));
  const nameCounts = [...groups.values()].reduce((counts, group) => {
    const name = normalized(group.colorName);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map());

  return [...groups.values()]
    .filter((group) => group.variants.some((variant) => variantHasStock(variant)))
    .map((group) => {
      const primaryVariant = group.variants.find((variant) => variantHasStock(variant)) || group.variants[0];
      const nameIsAmbiguous = (nameCounts.get(normalized(group.colorName)) || 0) > 1;
      const sources = [
        ...matchingColorEntries(product, group, { groupKeys, nameIsAmbiguous }).flatMap(colorEntrySources),
        ...group.variants.flatMap(variantImageSources),
      ];
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

export const resolveColorGroup = (colorGroups = [], requestedColor = "") => {
  const groups = Array.isArray(colorGroups) ? colorGroups.filter(Boolean) : [];
  const requested = normalized(requestedColor);
  // An exact colour-key hit outranks a name hit anywhere in the list, otherwise an
  // earlier group sharing the requested name would steal the keyed group's slot.
  return groups.find((group) => normalized(group?.key) === requested) ||
    groups.find((group) => normalized(group?.colorName) === requested) ||
    groups[0] || null;
};

export const buildSelectedColorGallery = ({ product = {}, colorGroup = null }) => {
  const meta = {
    colorKey: colorGroup?.key || "",
    colorName: colorGroup?.colorName || "",
    variantId: String(colorGroup?.variants?.[0]?.id || colorGroup?.variants?.[0]?.variant_id || ""),
  };
  const colorImages = Array.isArray(colorGroup?.images) ? colorGroup.images : [];
  if (colorImages.length) return dedupeImages(colorImages, meta);
  // Product-level images are only a fallback when this color has no linked image at all.
  return dedupeImages(productImageSources(product), meta);
};

export const colorSwatchImage = (group = {}, fallback = "") => group?.primaryImage?.image || imageValue(fallback);
