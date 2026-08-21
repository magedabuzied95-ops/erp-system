// A POS invoice edit stores the whole basket before and after, not a diff. Every
// reader that wants to show "what actually changed" — the manager portal feed, the
// manager push notification — needs the same cancellation rule, so it lives once here.

const clean = (value = "") => String(value ?? "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const round2 = (value) => Number(toNumber(value).toFixed(2));

export const operationItemKey = (item = {}) => {
  const variantId = clean(item.variant_id ?? item.variantId ?? "");
  const productId = clean(item.product_id ?? item.productId ?? "");
  const name = lower(item.product_name || item.name || item.title || "");
  return [variantId, productId, name].filter(Boolean).join("|") || name || "item";
};

export const operationItemName = (item = {}) => clean(item.product_name || item.name || item.title || "منتج");

export const operationItemPrice = (item = {}) =>
  toNumber(item.price ?? item.unit_price ?? item.sale_price ?? item.unitPrice ?? 0);

export const operationItemQuantity = (item = {}) => toNumber(item.quantity ?? item.qty ?? 0);

/**
 * Cancel the untouched lines out: the same item at the same count and price on both
 * sides disappears, and what is left is what the customer handed back (`removed`) and
 * what they walked out with (`added`).
 *
 * `comparable` is false when either side is not an item array — the safe-field edit
 * path writes an order snapshot there instead, and that carries no item change at all.
 */
export const diffOperationItems = (oldItems, newItems) => {
  if (!Array.isArray(oldItems) || !Array.isArray(newItems)) return { removed: [], added: [], comparable: false };
  const merged = new Map();
  const absorb = (list, side) => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const key = operationItemKey(raw);
      const entry = merged.get(key) || {
        name: operationItemName(raw),
        // Carried so a snapshot that stored no product_name can still be resolved to
        // a real name by whoever renders the diff — "منتج" tells a manager nothing.
        product_id: raw.product_id ?? raw.productId ?? null,
        variant_id: raw.variant_id ?? raw.variantId ?? null,
        old_quantity: 0,
        new_quantity: 0,
        old_price: 0,
        new_price: 0,
      };
      entry[`${side}_quantity`] += operationItemQuantity(raw);
      entry[`${side}_price`] = operationItemPrice(raw) || entry[`${side}_price`];
      if (!entry.name) entry.name = operationItemName(raw);
      if (!entry.product_id) entry.product_id = raw.product_id ?? raw.productId ?? null;
      if (!entry.variant_id) entry.variant_id = raw.variant_id ?? raw.variantId ?? null;
      merged.set(key, entry);
    }
  };
  absorb(oldItems, "old");
  absorb(newItems, "new");

  const removed = [];
  const added = [];
  for (const entry of merged.values()) {
    const delta = entry.new_quantity - entry.old_quantity;
    if (delta > 0.0001) {
      const price = entry.new_price || entry.old_price;
      added.push({ name: entry.name, product_id: entry.product_id, variant_id: entry.variant_id, quantity: delta, price, line_total: round2(price * delta) });
    } else if (delta < -0.0001) {
      const price = entry.old_price || entry.new_price;
      removed.push({ name: entry.name, product_id: entry.product_id, variant_id: entry.variant_id, quantity: -delta, price, line_total: round2(price * -delta) });
    } else if (Math.abs(entry.new_price - entry.old_price) > 0.009 && entry.new_quantity > 0) {
      // Same item, same count, different price — a price edit is still an edit, and
      // it is the one a manager most wants to see.
      removed.push({ name: entry.name, product_id: entry.product_id, variant_id: entry.variant_id, quantity: entry.old_quantity, price: entry.old_price, line_total: round2(entry.old_price * entry.old_quantity), price_change: true });
      added.push({ name: entry.name, product_id: entry.product_id, variant_id: entry.variant_id, quantity: entry.new_quantity, price: entry.new_price, line_total: round2(entry.new_price * entry.new_quantity), price_change: true });
    }
  }
  return { removed, added, comparable: true };
};

export default diffOperationItems;
