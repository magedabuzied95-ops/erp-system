const text = (value = "") => String(value ?? "").trim();
const numberValue = (value = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const quantityValue = (value = 1) => Math.max(1, Math.floor(Number(value || 1) || 1));

export const createMetaEventOnceGuard = () => {
  const seen = new Set();
  return (key = "") => {
    const normalized = text(key);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  };
};

export const metaCatalogContentId = (product = {}, variant = {}) => {
  const sku = text(variant.sku || variant.SKU || variant.variant_sku || product.sku || product.variant_sku);
  if (sku) return sku;
  const productId = text(product.product_id || product.productId || product.id);
  const variantId = text(variant.variant_id || variant.variantId || variant.id);
  return productId && variantId ? `${productId}-${variantId}` : productId;
};

export const metaCurrentSellingPrice = ({ product = {}, variant = {}, line = null, value = null } = {}) =>
  numberValue(value ?? line?.price ?? line?.unit_price ?? line?.selling_price ?? variant.display_price ?? variant.final_price ?? variant.selling_price ?? variant.price ?? product.display_price ?? product.final_price ?? product.selling_price ?? product.price);

const nameParts = (customer = {}) => {
  const explicitFirst = text(customer.first_name || customer.firstName);
  const explicitLast = text(customer.last_name || customer.lastName);
  if (explicitFirst || explicitLast) return { first_name: explicitFirst, last_name: explicitLast };
  const parts = text(customer.full_name || customer.name || customer.customer_name).split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") };
};

export const buildMetaEventPayload = ({ contentIds = [], contents = [], contentName = "", value = 0, numItems = 0, eventId = "", customer = {} } = {}) => {
  const ids = [...new Set((Array.isArray(contentIds) ? contentIds : []).map(text).filter(Boolean))];
  if (!ids.length) return null;
  const names = nameParts(customer);
  return {
    content_type: "product",
    content_ids: ids,
    ...(text(contentName) ? { content_name: text(contentName) } : {}),
    ...(Array.isArray(contents) && contents.length ? { contents } : {}),
    ...(numberValue(numItems) ? { num_items: Math.floor(numberValue(numItems)) } : {}),
    currency: "EGP",
    value: numberValue(value),
    event_id: text(eventId),
    email: customer.email,
    phone: customer.phone || customer.primary_phone,
    first_name: names.first_name,
    last_name: names.last_name,
    external_id: customer.customer_id || customer.id,
  };
};

export const isMetaPurchaseEligible = (order = {}) => !["cancelled", "canceled", "failed", "payment_failed", "awaiting_verification"].includes(text(order.status || order.payment_status).toLowerCase());
export const purchaseEventId = (order = {}) => `m1_purchase_order_${text(order.id || order.order_id || order.invoice_number || order.order_number)}`;
export const canTrackMetaPurchase = (order = {}, sentOrderIds = new Set()) => {
  const orderId = text(order.id || order.order_id || order.invoice_number || order.order_number);
  return Boolean(orderId && isMetaPurchaseEligible(order) && !sentOrderIds.has(orderId));
};
export const metaLineContent = (item = {}) => {
  const product = item.product || item;
  const variant = item.variant || item.selected_variant || item;
  const id = metaCatalogContentId(product, variant);
  if (!id) return null;
  return { id, quantity: quantityValue(item.quantity || item.qty), item_price: metaCurrentSellingPrice({ product, variant, line: item }) };
};
