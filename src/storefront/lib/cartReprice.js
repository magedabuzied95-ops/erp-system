/*
 * A saved cart remembers the price each item had when it was added. Checkout charges today's catalogue
 * price, and for a transfer it refuses any amount that disagrees — so once an offer ended, the bag showed
 * one total, the server wanted another and the shopper could not get past the error.
 *
 * The cart page and checkout therefore ask the server what the lines cost now
 * (POST /storefront/cart/reprice, priced by the same helper checkout charges with) and fold the answer in
 * here. Framework-free so the rule can be tested on its own. A line is never dropped: one that can no
 * longer be bought is flagged and shown, and the shopper decides.
 */

export const CART_REPRICE_ENDPOINT = "/storefront/cart/reprice";
// Mirrors STOREFRONT_CART_REPRICE_MAX_VARIANTS on the server; ids past it are not answered.
export const CART_REPRICE_MAX_VARIANTS = 60;

const toMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

const positiveId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export const cartRepriceVariantIds = (cart = []) => {
  const ids = [];
  const seen = new Set();
  for (const line of Array.isArray(cart) ? cart : []) {
    const id = positiveId(line?.variant_id ?? line?.variantId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.slice(0, CART_REPRICE_MAX_VARIANTS);
};

// Changes only when the set of variants does, so an effect keyed on it re-prices after an add or a
// cross-device merge but not after its own price update.
export const cartRepriceKey = (cart = []) => cartRepriceVariantIds(cart).sort((a, b) => a - b).join(",");

/**
 * Fold a re-price answer into the cart.
 * `currentPrice(line)` is the price the page shows for a line today (displayCartItemPrice), so "changed"
 * means changed for the shopper, not merely a different stored field.
 * Returns the next cart (the same array when nothing moved) and what to tell the shopper.
 */
export const applyCartReprice = (cart = [], variants = [], currentPrice = (line) => Number(line?.price || 0)) => {
  const lines = Array.isArray(cart) ? cart : [];
  const byVariantId = new Map();
  for (const entry of Array.isArray(variants) ? variants : []) {
    const id = positiveId(entry?.variant_id);
    if (id) byVariantId.set(String(id), entry);
  }
  const changed = [];
  const unavailable = [];
  let touched = false;
  const nextCart = lines.map((line) => {
    const entry = byVariantId.get(String(positiveId(line?.variant_id ?? line?.variantId)));
    // Not answered (past the cap, or a line with no variant): leave it exactly as it is.
    if (!entry) return line;
    const quantity = Math.max(1, Number(line.quantity || 1));
    const stock = Math.max(0, Number(entry.stock || 0));
    const price = toMoney(entry.price);
    const sellable = entry.available !== false && price > 0;
    // "low_stock" still sells, just not this many; the others checkout would refuse outright.
    const flag = !sellable ? entry.reason || (price <= 0 ? "no_price" : "unavailable") : stock < quantity ? "low_stock" : "";
    if (flag) unavailable.push({ lineId: line.lineId, name: line.name || "", reason: flag, stock });
    let next = line;
    if ((line.reprice_unavailable || "") !== flag) {
      next = { ...line, reprice_unavailable: flag };
      if (!flag) delete next.reprice_unavailable;
    }
    // Kept on the line so the + button stops at what can be bought (lib/cartLine.js).
    if (line.reprice_stock !== stock) next = { ...next, reprice_stock: stock };
    if (sellable) {
      const shown = toMoney(currentPrice(line));
      const compareAtPrice = toMoney(entry.compare_at_price);
      if (shown !== price || toMoney(line.compare_at_price) !== compareAtPrice) {
        if (shown !== price) changed.push({ lineId: line.lineId, name: line.name || "", from: shown, to: price });
        // Every field the display price can be read from, so no stale alias outvotes the new price.
        next = {
          ...next,
          price,
          sale_price: price,
          selling_price: price,
          current_selling_price: price,
          compare_at_price: compareAtPrice > price ? compareAtPrice : 0,
          total_amount: toMoney(price * quantity),
        };
      }
    }
    if (next !== line) touched = true;
    return next;
  });
  return { cart: touched ? nextCart : lines, changed, unavailable };
};

// The two checkout refusals a stale cart produces: a shipping fee quoted for the old subtotal (409 on
// delivery_fee) and a transfer amount that no longer matches the order total (400 on paid_amount).
export const isStaleCartCheckoutError = (error) => {
  const status = Number(error?.status || error?.response?.status || 0);
  const field = String(error?.responseBody?.field || error?.response?.data?.field || "").toLowerCase();
  return (status === 409 && field === "delivery_fee") || (status === 400 && field === "paid_amount");
};

// Checkout refusing a line: a variant that is hidden, archived or gone (items.variant_id) or more than is
// in stock (items.quantity). The message named no line, so the shopper could not tell which to fix; a
// re-price flags the line itself.
export const isCartLineCheckoutError = (error) => {
  const status = Number(error?.status || error?.response?.status || 0);
  const field = String(error?.responseBody?.field || error?.response?.data?.field || "").toLowerCase();
  return status === 400 && (field === "items.variant_id" || field === "items.quantity");
};
