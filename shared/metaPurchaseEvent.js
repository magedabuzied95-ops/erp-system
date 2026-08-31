/*
 * The identity of a Purchase event, stated once for both senders.
 *
 * The browser Pixel and the server both report the same sale, and Meta collapses
 * them into one conversion only when they agree on `event_name` + `event_id`.
 * So the id is derived from the order — never from a clock or a random — and the
 * catalogue id of a line is derived the same way on both sides, or the deduped
 * event would carry product ids the catalogue cannot match.
 *
 * Keep these pure and dependency-free: the client bundles them and the server
 * imports them from the same file.
 */

const text = (value = "") => String(value ?? "").trim();

export const metaOrderReference = (order = {}) =>
  text(order.id || order.order_id || order.invoice_number || order.order_number);

export const metaPurchaseEventId = (order = {}) => `m1_purchase_order_${metaOrderReference(order)}`;

/*
 * A cancelled or failed order is not a conversion. Everything else is: an order
 * awaiting payment verification is still a sale the shop is working on, and the
 * browser has always counted it.
 */
export const isMetaPurchaseEligible = (order = {}) =>
  !["cancelled", "canceled", "failed", "payment_failed"].includes(text(order.status || order.payment_status).toLowerCase());

/* SKU first — it is what the Meta catalogue is keyed by. */
export const metaCatalogContentId = (product = {}, variant = {}) => {
  const sku = text(variant.sku || variant.SKU || variant.variant_sku || product.sku || product.variant_sku);
  if (sku) return sku;
  const productId = text(product.product_id || product.productId || product.id);
  const variantId = text(variant.variant_id || variant.variantId || variant.id);
  return productId && variantId ? `${productId}-${variantId}` : productId;
};
