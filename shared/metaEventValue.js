/*
 * The money a Meta event carries.
 *
 * Events Manager does not quietly ignore a price it cannot read: it raises the
 * "Value setup method (price)" diagnostic and drops the dataset out of
 * value-based optimisation. A zero counts as unreadable — the field must be a
 * number greater than 0 — so a `value: 0` is worse than no value at all.
 *
 * Hence one rule, shared by the browser Pixel and the Conversions API sender:
 * when we resolved a real price we send `value` together with its `currency`
 * (Meta accepts a value only when it knows the currency); when we did not, we
 * send neither and the event still counts for the funnel and for retargeting.
 * Purchase is the exception both senders enforce on their own — an order with no
 * total is not a purchase, and it is never sent.
 */

const text = (value = "") => String(value ?? "").trim();

/*
 * Prices reach us as whatever the catalogue, the cart line or the customer's own
 * locale produced: "1,695.00", "١٬٦٩٥٫٥٠", "650 EGP". Everything that is not a
 * digit, a sign or the decimal mark is stripped before parsing.
 */
const normalizeNumericText = (value = "") =>
  text(value)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[,٬\s]/g, "")
    .replace(/٫/g, ".")
    .replace(/[^\d.-]/g, "");

export const metaMoneyValue = (value = 0) => {
  const parsed = Number(typeof value === "number" ? value : normalizeNumericText(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const metaQuantityValue = (value = 1) => Math.max(1, Math.floor(Number(value || 1) || 1));

/* The first candidate that resolves to a real price. A zero never stops the walk. */
export const firstMetaMoneyValue = (...candidates) => {
  for (const candidate of candidates.flat()) {
    const parsed = metaMoneyValue(candidate);
    if (parsed > 0) return parsed;
  }
  return 0;
};

export const metaValueFields = ({ value = 0, currency = "" } = {}) => {
  const amount = metaMoneyValue(value);
  return amount > 0 ? { currency: text(currency) || "EGP", value: amount } : {};
};

/*
 * `contents[].item_price` is read by the same diagnostic, so a line whose price we
 * could not resolve travels without one rather than with a zero.
 */
export const metaEventContents = (contents = []) =>
  (Array.isArray(contents) ? contents : [])
    .map((entry) => {
      const id = text(entry?.id);
      if (!id) return null;
      const itemPrice = metaMoneyValue(entry?.item_price);
      return {
        id,
        quantity: metaQuantityValue(entry?.quantity),
        ...(itemPrice > 0 ? { item_price: itemPrice } : {}),
      };
    })
    .filter(Boolean);
