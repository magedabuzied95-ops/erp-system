/*
 * Small rules for one cart line, shared by the side bag, the cart page and the cart state in
 * Storefront.jsx. Framework-free so they can be tested on their own.
 */

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * The struck-through price a line shows. The cart pricing rule only finds a compare price through the
 * product's sale flags, which a cart line does not carry, so a product sold as 800 → 500 reached the
 * bag, /cart and checkout as a plain 500 with no saving. The line does keep the compare-at price it was
 * added with (and the re-price refreshes it), so that is the fallback.
 */
export const cartLineComparePrice = (line = {}, pricedCompare = 0, price = 0) => {
  const priced = toNumber(pricedCompare);
  if (priced > 0) return priced;
  const shown = toNumber(price);
  const stored = toNumber(line?.compare_at_price);
  return shown > 0 && stored > shown ? stored : 0;
};

/**
 * How many of a line can be bought, as the last re-price reported (lib/cartReprice.js stores it as
 * `reprice_stock`). null when unknown — a line added on the product page before any re-price — in
 * which case nothing is capped here and checkout still checks stock on the server.
 */
export const cartLineStockLimit = (line = {}) => {
  const raw = line?.reprice_stock;
  if (raw === undefined || raw === null || raw === "") return null;
  const stock = Number(raw);
  return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : null;
};

/**
 * The quantity a +/− tap may set. Lowering is always allowed (that is how a shopper fixes a line that
 * is over stock); raising stops at the known stock, and never lowers a line on its own.
 */
export const clampCartLineQuantity = (line = {}, requested = 0) => {
  const next = Math.floor(toNumber(requested));
  const current = Math.max(1, Math.floor(toNumber(line?.quantity) || 1));
  if (next <= current) return next;
  const limit = cartLineStockLimit(line);
  if (limit === null) return next;
  return Math.max(current, Math.min(next, limit));
};

/**
 * The line after a +/− tap (the same object when the tap changes nothing). Lowering a line the re-price
 * flagged as over stock down to the stock clears that flag, so its warning goes with the problem.
 */
export const setCartLineQuantity = (line = {}, requested = 0) => {
  const quantity = clampCartLineQuantity(line, requested);
  if (quantity === Number(line?.quantity)) return line;
  const next = { ...line, quantity, total_amount: toNumber(line?.price) * quantity };
  const limit = cartLineStockLimit(line);
  if (next.reprice_unavailable === "low_stock" && limit !== null && quantity <= limit) delete next.reprice_unavailable;
  return next;
};

export const canIncreaseCartLine = (line = {}) => {
  const limit = cartLineStockLimit(line);
  if (limit === null) return true;
  return Math.max(1, Math.floor(toNumber(line?.quantity) || 1)) < limit;
};

// The locale key (and count) for the note under a line the re-price flagged; null for a line that sells.
export const cartLineIssue = (line = {}) => {
  const reason = String(line?.reprice_unavailable || "");
  if (!reason) return null;
  if (reason === "low_stock") return { key: "storefront.cart.lineLowStock", stock: cartLineStockLimit(line) ?? 0 };
  if (reason === "out_of_stock") return { key: "storefront.cart.lineOutOfStock", stock: 0 };
  return { key: "storefront.cart.lineUnavailable", stock: 0 };
};

/**
 * The cart another tab just saved, from a `storage` event — or null when the event is not about the
 * cart. Only the cart key counts: a full clear() (key null) is left alone, and a removed key is an
 * empty cart. A value that does not parse to a list is ignored rather than emptying the bag.
 */
export const cartFromStorageEvent = (event, cartKey) => {
  if (!event || !cartKey || event.key !== cartKey) return null;
  if (event.newValue === null || event.newValue === undefined || event.newValue === "") return [];
  try {
    const parsed = JSON.parse(event.newValue);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
