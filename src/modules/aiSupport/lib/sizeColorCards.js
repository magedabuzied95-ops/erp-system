// Size view of the AI Inbox "send product" pickers (the desktop ProductCardPicker and the
// phone ProductSheet). Same idea as the POS size view: once the operator narrows the list and
// picks the size(s) the customer asked about, each model becomes one card per COLOUR that has
// one of those sizes in stock, with that colour's photo. A colour without them is not shown.
//
// What leaves for the customer is one card per colour:
//   one picked size in that colour  → send_scope "color_size": the card reads "المقاس: 42" and
//                                     ordering from it already has the size;
//   several                         → send_scope "color" + picked_sizes: the card lists only
//                                     those sizes (server/services/aiProductColorCarouselService.js).
// Colours are matched by NAME, as the server's colour carousel matches them.

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase();

export const variantSizeOf = (variant = {}) => text(variant.size || variant.size_name || variant.variant_size);
export const variantColorOf = (variant = {}) => text(variant.color || variant.color_name || variant.variant_color);

const variantStockOf = (variant = {}) =>
  Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) || 0;

const variantImageOf = (variant = {}) =>
  text(variant.variant_image_url || variant.color_image_url || variant.image_url || variant.image || variant.primary_image_url);

const variantsOf = (product = {}) => (Array.isArray(product?.variants) ? product.variants : []);

// 36, 37 … 45 numerically, then 45.5 after 45, then anything that is not a number.
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

// Only sizes that are on the shelf among the products in view.
export const pickerSizeOptions = (products = []) => {
  const sizes = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    for (const variant of variantsOf(product)) {
      const size = variantSizeOf(variant);
      if (size && variantStockOf(variant) > 0 && !sizes.has(key(size))) sizes.set(key(size), size);
    }
  }
  return [...sizes.values()].sort(compareSizes);
};

export const buildSizeColorCards = (products = [], selectedSizes = []) => {
  const wanted = new Set((Array.isArray(selectedSizes) ? selectedSizes : []).map(key).filter(Boolean));
  if (!wanted.size) return [];
  const cards = [];
  for (const product of Array.isArray(products) ? products : []) {
    const all = variantsOf(product);
    const groups = new Map();
    for (const variant of all) {
      if (!wanted.has(key(variantSizeOf(variant))) || variantStockOf(variant) <= 0) continue;
      const colorKey = key(variantColorOf(variant));
      if (!groups.has(colorKey)) groups.set(colorKey, []);
      groups.get(colorKey).push(variant);
    }
    const productId = text(product.product_id ?? product.id);
    for (const [colorKey, variants] of groups) {
      const sameColor = all.filter((variant) => key(variantColorOf(variant)) === colorKey);
      // The colour's photo may sit on a size row that is sold out or was not asked about.
      const imageVariant =
        variants.find(variantImageOf) || sameColor.find(variantImageOf) || variants[0];
      const sizes = [...new Set(variants.map(variantSizeOf))].sort(compareSizes);
      cards.push({
        key: `${productId}::${colorKey}`,
        product,
        productId,
        color: variantColorOf(variants[0]),
        sizes,
        variant: variants[0],
        imageVariant,
        image: variantImageOf(imageVariant) || text(product.image_url || product.product_image_url || product.image),
        stock: variants.reduce((sum, variant) => sum + variantStockOf(variant), 0),
      });
    }
  }
  return cards;
};

// Stamp what the customer asked about onto a payload the host picker already built.
export const withPickedSizes = (payload = {}, sizes = []) => {
  const picked = (Array.isArray(sizes) ? sizes : []).map(text).filter(Boolean);
  if (picked.length === 1) {
    return {
      ...payload,
      size: picked[0],
      selected_size: picked[0],
      available_sizes: picked,
      sizes: picked,
      size_options: picked,
      send_scope: "color_size",
    };
  }
  return {
    ...payload,
    variant_id: null,
    size: "",
    selected_size: "",
    available_sizes: picked,
    sizes: picked,
    size_options: picked,
    picked_sizes: picked,
    card_reply_mode: "color_only",
    send_scope: "color",
  };
};
