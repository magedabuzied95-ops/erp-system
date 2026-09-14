/*
 * Which colour and size the product page opens on, and what its share link carries.
 *
 * Framework-free so the rules can be tested on their own. The colour and name readers come in as
 * arguments because they live with the rest of the storefront's variant helpers.
 */

const queryValue = (value = "") => String(value || "").trim();

// The query parameters that choose a variant. Anything else in the search (utm_*, fbclid, the share
// link's v=) must not re-run the selection, or an ad click's tracking params would reset the page.
const SELECTION_PARAMS = ["variant", "variantId", "size", "color", "colorId"];

export const productSelectionSearchKey = (search = "") => {
  const params = new URLSearchParams(String(search || ""));
  return SELECTION_PARAMS.map((name) => `${name}=${queryValue(params.get(name))}`).join("&");
};

/**
 * The variant a product link asks for: ?variant= (an id or edition slug), ?colorId=, ?color= (the
 * colour key the Meta/Google feeds put in the ad link, or its name) and ?size=. In-stock rows win;
 * a colour that has sold out everywhere still opens on that colour so its restock button shows.
 * `sizeChosen` is true only when the link named the size the page landed on — a size the page
 * picked for itself is not the shopper's choice.
 */
export const resolveRequestedVariant = ({
  variants = [],
  search = "",
  colorIdentity = () => "",
  colorName = () => "",
  hasStock = () => false,
  firstDisplayVariant = (rows) => rows[0] || null,
} = {}) => {
  const productVariants = (Array.isArray(variants) ? variants : []).filter((variant) => variant && typeof variant === "object");
  const routeSearchParams = new URLSearchParams(String(search || ""));
  const requestedVariantId = queryValue(routeSearchParams.get("variant") || routeSearchParams.get("variantId"));
  const requestedSize = queryValue(routeSearchParams.get("size"));
  const requestedColor = queryValue(routeSearchParams.get("color")).toLowerCase();
  const requestedColorId = queryValue(routeSearchParams.get("colorId"));
  const matchesRequestedColor = (variant) => Boolean(requestedColor) && (
    colorIdentity(variant) === requestedColor ||
    String(colorName(variant) || "").toLowerCase() === requestedColor
  );
  const availableVariants = productVariants.filter(hasStock);
  const requested =
    availableVariants.find((variant) => requestedVariantId && String(variant?.id || "") === String(requestedVariantId)) ||
    availableVariants.find((variant) => requestedVariantId && String(variant?.edition_slug || "") === String(requestedVariantId)) ||
    availableVariants.find((variant) => requestedColorId && String(variant?.color_id || "") === String(requestedColorId)) ||
    availableVariants.find((variant) => requestedSize && matchesRequestedColor(variant) && String(variant?.size || "") === requestedSize) ||
    availableVariants.find(matchesRequestedColor) ||
    productVariants.find(matchesRequestedColor) ||
    productVariants.find(
      (variant) =>
        requestedSize &&
        String(variant?.size || "") === requestedSize &&
        (!requestedColor || matchesRequestedColor(variant)) &&
        hasStock(variant)
    ) ||
    availableVariants.find((variant) => requestedSize && String(variant?.size || "") === requestedSize) ||
    availableVariants[0] ||
    firstDisplayVariant(productVariants) ||
    null;
  const variant = requested || availableVariants[0] || firstDisplayVariant(productVariants) || null;
  return {
    variant,
    sizeChosen: Boolean(requestedSize && String(variant?.size || "") === requestedSize),
  };
};

/**
 * The colour group the page must keep even though nothing in it is in stock: the colour a link opened
 * on. Colour groups drop sold-out colours, and without its own group the page fell back to the first
 * colour's photos and size chips under the sold-out colour's name — a tap on one of those chips then
 * put the other colour in the bag.
 */
export const soldOutColorKeyToKeep = (variant = null, colorIdentity = () => "", hasStock = () => false, variants = []) => {
  if (!variant) return "";
  const key = colorIdentity(variant);
  if (!key) return "";
  const colourHasStock = (Array.isArray(variants) ? variants : []).some((row) => row && colorIdentity(row) === key && hasStock(row));
  return colourHasStock ? "" : key;
};

/**
 * What a share link names. The size (and the size row's variant id, which pins a size just the same)
 * goes in only once the shopper has chosen it: the page preselects a size so it has a price to show,
 * and sharing that default made the friend's page treat it as chosen and skip the choose-a-size step.
 * The colour always goes in — it is what the shopper was looking at.
 */
export const productShareParamEntries = (product = {}, variant = null, { sizeChosen = true } = {}) => {
  const safeProduct = product && typeof product === "object" ? product : {};
  return [
    ["variant", sizeChosen ? variant?.id || variant?.variant_id || safeProduct.selected_variant_id || safeProduct.display_variant_id || "" : ""],
    ["color", variant?.color || variant?.color_key || safeProduct.color_key || safeProduct.display_color_key || ""],
    ["size", sizeChosen ? variant?.size || safeProduct.selected_size || "" : ""],
  ];
};
