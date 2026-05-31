import {
  buildStorefrontProductUrl,
  storefrontBaseUrl,
} from "./storefrontProductUrlService.js";

export { storefrontBaseUrl } from "./storefrontProductUrlService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const trimSlashes = (value = "") => text(value).replace(/^\/+|\/+$/g, "");
const slugify = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

const firstImageValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstImageValue(...value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const nested = firstImageValue(
        value.secure_url,
        value.image_url,
        value.url,
        value.path,
        value.src,
        value.preview,
        value.image
      );
      if (nested) return nested;
      continue;
    }
    const safe = text(value);
    if (safe) return safe;
  }
  return "";
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  if (!text(value)) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return Object.values(parsed);
  } catch {
    return [];
  }
  return [];
};

export const resolvePublicProductImageUrl = (value = "", { uploads = true, baseUrl = storefrontBaseUrl() } = {}) => {
  const raw = firstImageValue(value);
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!baseUrl) return raw.startsWith("/") ? raw : `/${trimSlashes(raw)}`;
  const path = trimSlashes(raw);
  if (!path) return "";
  if (uploads && !path.startsWith("uploads/") && !path.startsWith("shop/")) {
    if (path.startsWith("products/")) return `${baseUrl}/uploads/${path}`;
    return `${baseUrl}/uploads/products/${path}`;
  }
  return `${baseUrl}/${path}`;
};

const slugBelongsToProduct = (slug = "", product = {}) => {
  const safeSlug = slugify(slug);
  if (!safeSlug) return false;
  const nameSlug = slugify(product.name || product.title || product.product_name || product.base_name);
  if (!nameSlug) return true;
  const slugTokens = new Set(safeSlug.split("-").filter((token) => token.length >= 3));
  const nameTokens = nameSlug.split("-").filter((token) => token.length >= 3);
  const overlap = nameTokens.filter((token) => slugTokens.has(token)).length;
  const conflictingBrands = ["nike", "adidas", "puma", "reebok", "asics", "balance", "converse", "vans"];
  const nameLower = ` ${nameSlug} `;
  const slugLower = ` ${safeSlug} `;
  const hasConflictingBrand = conflictingBrands.some((brand) => slugLower.includes(` ${brand} `) && !nameLower.includes(` ${brand} `));
  if (hasConflictingBrand) return false;
  return overlap >= Math.min(2, Math.max(1, nameTokens.length));
};

export const resolvePublicProductUrl = (product = {}, { baseUrl = storefrontBaseUrl() } = {}) => {
  const existing = text(product.product_url || product.productUrl || product.url);
  if (/^https?:\/\//i.test(existing)) return existing;
  if (existing && baseUrl) return `${baseUrl}/${trimSlashes(existing)}`;
  if (existing) return existing.startsWith("/") ? existing : `/${trimSlashes(existing)}`;
  return buildStorefrontProductUrl(product, { baseUrl });
};

const unique = (items = []) => [...new Set(items.map(text).filter(Boolean))];

const splitSizes = (value) => {
  if (Array.isArray(value)) return value.flatMap(splitSizes);
  return text(value)
    .split(",")
    .map(text)
    .filter(Boolean);
};

export const availableProductSizes = (product = {}) =>
  unique([
    ...splitSizes(product.available_sizes),
    ...splitSizes(product.availableSizes),
    ...splitSizes(product.sizes),
    ...splitSizes(product.size),
    ...splitSizes(product.inventory_profile?.available_sizes),
    ...splitSizes(product.inventory_profile?.sizes),
    ...asArray(product.variants).flatMap((variant) => splitSizes(variant?.size)),
  ]);

const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const numericPrice = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeColorName = (value = "") =>
  text(value)
    .replace(/\s*[/|,+]\s*/g, "/")
    .replace(/\s{2,}/g, " ")
    .trim();

const imageIdentity = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+/g, "/")
    .trim();

const variantColor = (variant = {}) =>
  normalizeColorName(
    variant.color ||
      variant.color_name ||
      variant.color_value ||
      variant.colour ||
      variant.variant_color ||
      variant.option_color ||
      ""
  );

const variantImageCandidates = (variant = {}) => [
  variant.secure_url,
  variant.primary_image_url,
  variant.main_image,
  variant.color_image_url,
  variant.variant_image_url,
  variant.image_url,
  variant.image,
  variant.thumbnail,
  ...parseJsonArray(variant.product_images || variant.images || variant.gallery_images),
];

const productMainImageCandidates = (product = {}) => [
  product.secure_url,
  product.matched_variant_image,
  product.matched_visual_candidate?.secure_url,
  product.matched_visual_candidate?.image_url,
  product.matched_image_url,
  product.image_url,
  product.main_image,
  product.image,
  product.thumbnail,
  product.product_image_url,
  product.variant_image_url,
  parseJsonArray(product.product_images || product.images || product.gallery_images)[0],
];

const resolveProductMainImage = (product = {}) =>
  resolvePublicProductImageUrl(firstImageValue(...productMainImageCandidates(product)));

export const resolveProductImageFromRecord = (product = {}) => {
  const variantImages = asArray(product.variants).flatMap(variantImageCandidates);
  return resolvePublicProductImageUrl(
    firstImageValue(
      product.secure_url,
      product.matched_variant_image,
      product.matched_visual_candidate?.secure_url,
      product.matched_visual_candidate?.image_url,
      product.matched_image_url,
      resolveProductMainImage(product),
      variantImages
    )
  );
};

const resolveVariantColorImage = (product = {}, variants = []) => {
  const variantImage = firstImageValue(...variants.flatMap(variantImageCandidates));
  return resolvePublicProductImageUrl(firstImageValue(variantImage, resolveProductMainImage(product)));
};

const variantAvailableSizes = (variants = []) =>
  unique(
    variants
      .filter((variant) => {
        if (variant.stock === undefined && variant.available === undefined && variant.availability === undefined && variant.stock_status === undefined) return true;
        if (numeric(variant.stock, 0) > 0) return true;
        const availability = text(variant.available ?? variant.availability ?? variant.stock_status).toLowerCase();
        return ["true", "available", "in_stock", "in stock"].includes(availability);
      })
      .flatMap((variant) => splitSizes(variant?.size))
  );

const variantIsInStock = (variant = {}) => {
  if (numeric(variant.stock, 0) > 0 || numeric(variant.quantity, 0) > 0) return true;
  const availability = text(variant.available ?? variant.availability ?? variant.stock_status ?? variant.status).toLowerCase();
  if (!availability) return variant.stock === undefined && variant.quantity === undefined;
  return ["true", "available", "in_stock", "in stock", "active"].includes(availability);
};

const variantDebugRow = (variant = {}, product = {}) => ({
  variant_id: variant.id || variant.variant_id || null,
  color_name: variantColor(variant),
  stock: numeric(variant.stock ?? variant.quantity, 0),
  active_status: text(variant.status || variant.stock_status || variant.availability || variant.available || (variantIsInStock(variant) ? "in_stock" : "out_of_stock")),
  sizes: splitSizes(variant.size),
  image_url: resolvePublicProductImageUrl(firstImageValue(...variantImageCandidates(variant), resolveProductMainImage(product))),
});

export const debugProductColorExpansion = (product = {}, { limit = 6 } = {}) => {
  const variants = asArray(product?.variants).filter((variant) => variant && typeof variant === "object");
  const colorGroups = new Map();
  for (const variant of variants) {
    const color = variantColor(variant);
    if (!color) continue;
    const key = color.toLowerCase();
    if (!colorGroups.has(key)) colorGroups.set(key, { color, variants: [] });
    colorGroups.get(key).variants.push(variant);
  }

  const requestedColor = normalizeColorName(
    product.requested_color ||
      (product.is_visual_search_match ? product.matched_variant_color || product.matched_visual_candidate?.color : "") ||
      ""
  ).toLowerCase();
  const maxCards = Math.max(1, Number(limit) || 6);
  const seenImages = new Set();
  const groups = [...colorGroups.values()].map((group) => {
    const inStockVariants = group.variants.filter(variantIsInStock);
    const sizes = variantAvailableSizes(inStockVariants);
    const selectedImage = resolveVariantColorImage(product, inStockVariants.length ? inStockVariants : group.variants);
    const imageKey = imageIdentity(selectedImage);
    const duplicateImage = Boolean(imageKey && seenImages.has(imageKey));
    if (imageKey && !duplicateImage) seenImages.add(imageKey);
    let skipReason = "";
    if (!inStockVariants.length || !sizes.length) skipReason = "out_of_stock_or_no_available_sizes";
    else if (duplicateImage) skipReason = "duplicate_image";
    return {
      color_name: group.color,
      exact_color_match: Boolean(requestedColor && group.color.toLowerCase() === requestedColor),
      selected_image_url: selectedImage,
      image_key: imageKey,
      available_sizes: sizes,
      available_size_count: sizes.length,
      variants: group.variants.map((variant) => variantDebugRow(variant, product)),
      in_stock_variant_ids: inStockVariants.map((variant) => variant.id || variant.variant_id || null).filter(Boolean),
      sent: false,
      skipped: Boolean(skipReason),
      skip_reason: skipReason,
    };
  });

  const sendable = groups
    .filter((group) => !group.skipped)
    .sort((left, right) => {
      if (left.exact_color_match !== right.exact_color_match) return left.exact_color_match ? -1 : 1;
      const sizeDiff = right.available_size_count - left.available_size_count;
      if (sizeDiff !== 0) return sizeDiff;
      return left.color_name.localeCompare(right.color_name);
    });
  const sentColorNames = new Set(sendable.slice(0, maxCards).map((group) => group.color_name.toLowerCase()));
  const overLimitColorNames = new Set(sendable.slice(maxCards).map((group) => group.color_name.toLowerCase()));
  const rankedGroups = groups.map((group) => {
    const key = group.color_name.toLowerCase();
    if (sentColorNames.has(key)) return { ...group, sent: true, skipped: false, skip_reason: "" };
    if (overLimitColorNames.has(key)) return { ...group, sent: false, skipped: true, skip_reason: "over_reply_limit" };
    return group;
  });

  const sentGroups = rankedGroups.filter((group) => group.sent);
  const skippedGroups = rankedGroups.filter((group) => group.skipped);
  return {
    product_id: product?.id || product?.product_id || null,
    product_name: text(product?.name || product?.title || product?.product_name),
    strong_model_detected: Boolean(product?.strong_model_match || product?.exact_match_found || product?.model_match_confidence >= 0.72),
    total_variants: variants.length,
    grouped_colors_count: colorGroups.size,
    expanded_color_count: sendable.length,
    sent_count: sentGroups.length,
    skipped_count: skippedGroups.length,
    has_more_color_variants: sendable.length > maxCards,
    more_color_variants_count: Math.max(0, sendable.length - maxCards),
    color_groups: rankedGroups,
    colors_sent: sentGroups.map((group) => group.color_name),
    colors_skipped: skippedGroups.map((group) => ({ color: group.color_name, reason: group.skip_reason })),
  };
};

const buildBaseCard = (product = {}, overrides = {}) => {
  const id = product?.id || product?.product_id || null;
  const name = text(product?.name || product?.title || product?.product_name);
  const color = text(overrides.color || product.color || product.requested_color || product.matched_variant_color);
  const displayName = color && !name.toLowerCase().includes(color.toLowerCase()) ? `${name} - ${color}` : name;
  const productUrl = resolvePublicProductUrl(product);
  const slug = slugBelongsToProduct(product?.slug, product)
    ? text(product?.slug)
    : slugBelongsToProduct(product?.canonical_slug || product?.product_slug, product)
      ? text(product?.canonical_slug || product?.product_slug)
      : "";
  const cardImageUrl = overrides.image_url || resolveProductImageFromRecord(product);
  return {
    id,
    product_id: id,
    variant_id: overrides.variant_id || product?.variant_id || product?.matched_variant_id || null,
    color,
    slug,
    name: displayName,
    title: displayName,
    base_name: name,
    price: numericPrice(overrides.price) || numericPrice(product?.final_price) || numericPrice(product?.price) || numericPrice(product?.sale_price),
    available_sizes: overrides.available_sizes || availableProductSizes(product),
    sizes: overrides.sizes || overrides.available_sizes || availableProductSizes(product),
    image_url: cardImageUrl,
    product_url: productUrl,
    url: productUrl,
    availability: text(product?.stock_status || product?.availability),
    visual_confidence_score: product?.visual_confidence_score ?? product?.confidence ?? null,
    visual_score_breakdown: product?.visual_score_breakdown || null,
    matched_visual_candidate: product?.matched_visual_candidate || null,
    matched_image_url: product?.matched_image_url || "",
    matched_image_source: product?.matched_image_source || "",
    matched_variant_id: product?.matched_variant_id || null,
    matched_variant_color: product?.matched_variant_color || "",
    matched_variant_image: product?.matched_variant_image || "",
    inventory_search_query: product?.inventory_search_query || "",
    card_reply_mode: product?.card_reply_mode || product?.reply_mode || product?.replyMode || "",
  };
};

const colorVariantCardsForProduct = (product = {}, { limit = 6 } = {}) => {
  const expansionDebug = debugProductColorExpansion(product, { limit });
  const colorGroups = new Map();
  for (const group of expansionDebug.color_groups || []) {
    colorGroups.set(group.color_name.toLowerCase(), group);
  }

  if (!colorGroups.size) {
    const fallbackCard = buildBaseCard(product);
    console.log("[ai-product-cards] grouped color cards", {
      product_id: fallbackCard.product_id,
      grouped_colors_count: 0,
      selected_cards: [{ color: fallbackCard.color || "", selected_image: fallbackCard.image_url || "", sizes: fallbackCard.sizes || [] }],
    });
    return [fallbackCard];
  }

  const totalAvailableColors = expansionDebug.expanded_color_count;
  const cards = (expansionDebug.color_groups || []).filter((group) => group.sent).map((group) => {
    const firstVariantId = group.in_stock_variant_ids[0] || null;
    const firstVariant = asArray(product.variants).find((variant) => String(variant.id || variant.variant_id || "") === String(firstVariantId)) || {};
    return buildBaseCard(product, {
      color: group.color_name,
      variant_id: firstVariant.id || firstVariant.variant_id || null,
      image_url: group.selected_image_url,
      price: numericPrice(firstVariant.final_price) || numericPrice(firstVariant.price) || numericPrice(firstVariant.sale_price),
      available_sizes: group.available_sizes,
      sizes: group.available_sizes,
    });
  }).map((card) => ({
    ...card,
    color_variant_count: totalAvailableColors,
    has_more_color_variants: expansionDebug.has_more_color_variants,
    more_color_variants_count: expansionDebug.more_color_variants_count,
  }));

  console.log("[ai-product-cards] grouped color cards", {
    product_id: product?.id || product?.product_id || null,
    strong_model_detected: Boolean(product?.strong_model_match || product?.exact_match_found || product?.model_match_confidence >= 0.72),
    grouped_colors_count: expansionDebug.grouped_colors_count,
    expanded_color_count: expansionDebug.expanded_color_count,
    selected_cards: cards.map((card) => ({ color: card.color || "", selected_image: card.image_url || "", sizes: card.sizes || [] })),
    colors_sent: expansionDebug.colors_sent,
    colors_skipped: expansionDebug.colors_skipped,
    color_groups: expansionDebug.color_groups,
  });
  return cards;
};

export const normalizeProductCards = (products = [], { limit = 6 } = {}) =>
  asArray(products)
    .flatMap((product) => colorVariantCardsForProduct(product, { limit }))
    .filter((product) => product.name || product.product_id)
    .slice(0, Math.max(1, Number(limit) || 6))
    .map((card) => {
      console.log("[ai-product-cards] card data integrity", {
        product_id: card.product_id || card.id || null,
        name: card.name || "",
        slug: card.slug || "",
        product_url: card.product_url || card.url || "",
        image_url: card.image_url || "",
      });
      return card;
    });

const formatPrice = (price) =>
  Number(price || 0) > 0 ? `${Number(price).toLocaleString("en-US", { useGrouping: false })} \u062c` : "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f";

const formatCloserPrice = (price) =>
  Number(price || 0) > 0 ? `${Math.round(Number(price))} \u062c\u0646\u064a\u0647` : "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f";

export const productCardReplyText = (product = {}) => {
  const replyMode = text(product.card_reply_mode || product.replyMode || product.reply_mode);
  if (replyMode === "image_only") return "";
  if (replyMode === "color_only") {
    return [
      product.color ? `\u0627\u0644\u0644\u0648\u0646: ${product.color}` : "",
      product.product_url || product.url ? product.product_url || product.url : "",
    ].filter(Boolean).join("\n");
  }
  const sizes = asArray(product.available_sizes || product.sizes).map(text).filter(Boolean);
  return [
    "\u0623\u064a\u0648\u0647 \u0645\u0648\u062c\u0648\u062f \u2705",
    `\u0627\u0644\u0633\u0639\u0631: ${formatCloserPrice(product.price)}`,
    sizes.length ? `\u0627\u0644\u0645\u062a\u0627\u062d: ${sizes.join("\u060c")}` : "",
    "",
    "\u062a\u062d\u0628 \u0623\u062d\u062c\u0632\u0647\u0648\u0644\u0643\u061f",
  ].filter(Boolean).join("\n");
};
