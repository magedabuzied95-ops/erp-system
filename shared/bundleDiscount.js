/**
 * "Pairs well with" bundle discount — the one calculation both sides run.
 *
 * The storefront shows the customer a total and the server charges one, and a
 * transfer checkout is REFUSED when the two differ. So the rule lives here,
 * once, and both import it: the cart summary with the prices it displays, the
 * checkout with the prices it resolved from the catalogue.
 *
 * A bundle is the cart lines that carry the same `bundle_id`. It earns the
 * discount only while it is whole: exactly two different products, each still
 * in the cart. Remove one and the other goes back to full price. Quantities
 * pair up — two of each is two bundles, three of one and one of the other is
 * one bundle, and the extra units pay full price.
 */

export const BUNDLE_DISCOUNT_MAX_PERCENT = 50;

const toMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const toQuantity = (value) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const roundMoney = (value) => Math.round(value * 100) / 100;

/** Clamp a configured percentage to a usable number; anything invalid means "off". */
export const normalizeBundleDiscountPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(number, BUNDLE_DISCOUNT_MAX_PERCENT);
};

/** A bundle id names both products, so a tampered id cannot claim other lines. */
export const buildBundleId = (productIdA, productIdB) => {
  const ids = [String(productIdA || "").trim(), String(productIdB || "").trim()];
  if (!ids[0] || !ids[1] || ids[0] === ids[1]) return "";
  return `pair:${ids.sort().join("+")}`;
};

const bundleIdProducts = (bundleId = "") => {
  const match = /^pair:([^+]+)\+([^+]+)$/.exec(String(bundleId || "").trim());
  return match ? [match[1], match[2]] : null;
};

/**
 * @param {Array<{bundle_id?: string, product_id: string|number, price: number, quantity: number}>} lines
 * @param {number} percent configured discount percentage
 * @param {(productIdA: string, productIdB: string) => boolean} [isEligiblePair]
 *   server-side check that the two products may be bundled; the client omits it
 * @returns {{ amount: number, bundles: Array<{ bundle_id: string, product_ids: string[], sets: number, base: number, amount: number }> }}
 */
export const computeBundleDiscount = (lines = [], percent = 0, isEligiblePair = () => true) => {
  const rate = normalizeBundleDiscountPercent(percent) / 100;
  if (!rate || !Array.isArray(lines)) return { amount: 0, bundles: [] };

  const groups = new Map();
  for (const line of lines) {
    const bundleId = String(line?.bundle_id || "").trim();
    const named = bundleIdProducts(bundleId);
    if (!named) continue;
    const productId = String(line?.product_id ?? "").trim();
    // A line may only sit in a bundle that names its own product.
    if (!named.includes(productId)) continue;
    const price = toMoney(line?.price);
    const quantity = toQuantity(line?.quantity);
    if (!price || !quantity) continue;
    if (!groups.has(bundleId)) groups.set(bundleId, { named, products: new Map() });
    const products = groups.get(bundleId).products;
    // Two lines of one product in a bundle (two sizes) share the product's slot:
    // units add up, and each unit is priced at its own line's price.
    const slot = products.get(productId) || { units: [] };
    for (let index = 0; index < quantity; index += 1) slot.units.push(price);
    products.set(productId, slot);
  }

  const bundles = [];
  for (const [bundleId, group] of groups) {
    const [first, second] = group.named;
    const a = group.products.get(first);
    const b = group.products.get(second);
    if (!a || !b) continue;
    if (!isEligiblePair(first, second)) continue;
    const sets = Math.min(a.units.length, b.units.length);
    if (!sets) continue;
    // Discount the cheapest units of each product first, so the amount never
    // depends on the order the lines happen to arrive in.
    const cheapest = (units) => [...units].sort((x, y) => x - y).slice(0, sets).reduce((sum, value) => sum + value, 0);
    const base = cheapest(a.units) + cheapest(b.units);
    const amount = roundMoney(base * rate);
    if (amount > 0) bundles.push({ bundle_id: bundleId, product_ids: [first, second], sets, base: roundMoney(base), amount });
  }

  const amount = roundMoney(bundles.reduce((sum, bundle) => sum + bundle.amount, 0));
  return { amount, bundles };
};
