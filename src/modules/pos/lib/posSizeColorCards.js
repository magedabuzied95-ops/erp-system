import { getVariantColorKey } from "./posCatalogMerge.js";

/*
 * Size view of the POS grid. Once the cashier picks one or more sizes, the grid
 * stops showing one card per model (with the model's cover) and shows one card
 * per COLOUR that has at least one of those sizes in stock, wearing that
 * colour's own photo. A colour with none of the picked sizes in stock is not
 * shown at all — that is the whole point: "what can I sell in a 42 right now".
 *
 * Colours are grouped by colour GROUP (getVariantColorKey), not by name, the
 * same identity the variant picker uses, so two "Black" articles on one model
 * stay two cards.
 */

const text = (value) => String(value ?? "").trim();

const variantStock = (variant = {}) =>
  Math.max(
    0,
    Number(
      variant.stock_quantity ??
        variant.stock ??
        variant.quantity ??
        variant.qty ??
        variant.available_quantity ??
        variant.inventory_quantity ??
        variant.current_stock ??
        0
    ) || 0
  );

const firstImage = (...values) => {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      const nested = firstImage(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === "object") {
      const nested = firstImage(value.image_url, value.image, value.url, value.path);
      if (nested) return nested;
      continue;
    }
    const url = text(value);
    if (url) return url;
  }
  return "";
};

const variantImage = (variant = {}) =>
  firstImage(variant.variant_image_url, variant.color_image_url, variant.primary_image_url, variant.image_url, variant.images);

// Numbers in numeric order (36, 37 … 45, then 45.5 after 45), anything else
// (S / M / L, "3/18") after them in natural order.
export const compareSizes = (a, b) => {
  const left = Number(text(a).replace(",", "."));
  const right = Number(text(b).replace(",", "."));
  const leftNumeric = text(a) !== "" && Number.isFinite(left);
  const rightNumeric = text(b) !== "" && Number.isFinite(right);
  if (leftNumeric && rightNumeric) return left - right;
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return text(a).localeCompare(text(b), undefined, { numeric: true });
};

// The sizes actually on the shelf among the products the grid shows now, so a
// men's filter offers 40–46 and never a size nothing in view can be sold in.
export const buildPosSizeOptions = (products = []) => {
  const sizes = new Set();
  for (const product of Array.isArray(products) ? products : []) {
    for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
      const size = text(variant?.size);
      if (size && variantStock(variant) > 0) sizes.add(size);
    }
  }
  return [...sizes].sort(compareSizes).map((size) => ({ id: size, name: size }));
};

export const expandProductsToSizeColorCards = (products = [], selectedSizes = []) => {
  const wanted = new Set((Array.isArray(selectedSizes) ? selectedSizes : []).map(text).filter(Boolean));
  if (!wanted.size) return Array.isArray(products) ? products : [];

  const cards = [];
  for (const product of Array.isArray(products) ? products : []) {
    const allVariants = Array.isArray(product?.variants) ? product.variants : [];
    const groups = new Map();
    for (const variant of allVariants) {
      if (!wanted.has(text(variant?.size)) || variantStock(variant) <= 0) continue;
      const key = getVariantColorKey(variant);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(variant);
    }

    for (const [colorKey, variants] of groups) {
      // The colour's photo may sit on a size row that is out of stock or not
      // one of the picked sizes, so look across the whole colour for it.
      const colorVariants = allVariants.filter((variant) => getVariantColorKey(variant) === colorKey);
      const image =
        firstImage(...variants.map(variantImage)) ||
        firstImage(...colorVariants.map(variantImage)) ||
        firstImage(product.image_url, product.product_image_url);
      const first = variants[0] || {};
      const sizes = [...new Set(variants.map((variant) => text(variant.size)))].sort(compareSizes);
      const stock = variants.reduce((sum, variant) => sum + variantStock(variant), 0);
      const productKey = text(product.product_id ?? product.id);

      cards.push({
        ...product,
        // product_id / id stay the model's own: the favourite star and the
        // edit pencil on the card act on the model.
        pos_card_key: `${productKey}::${colorKey}`,
        pos_size_card: { colorKey, sizes, source: product },
        employee_card_color: text(first.color),
        employee_card_sizes: sizes,
        employee_exact_variant_image: true,
        image_url: image,
        variant_image_url: image,
        product_image_url: image,
        article_code: text(first.color_article_code || first.colorArticleCode || first.article_code || product.article_code),
        total_stock: stock,
        stock,
        variants,
      });
    }
  }
  return cards;
};
