import { normalizeMetaCustomer } from "../../../shared/metaEventMatching.js";
import {
  firstMetaMoneyValue,
  metaEventContents,
  metaMoneyValue,
  metaQuantityValue,
  metaValueFields,
} from "../../../shared/metaEventValue.js";
import {
  isMetaPurchaseEligible,
  metaCatalogContentId,
  metaOrderReference,
  metaPurchaseEventId,
} from "../../../shared/metaPurchaseEvent.js";
import { storefrontSellingPrice } from "../../shared/lib/storefrontPricing.js";

const text = (value = "") => String(value ?? "").trim();
const numberValue = metaMoneyValue;
const quantityValue = metaQuantityValue;

export const createMetaEventOnceGuard = () => {
  const seen = new Set();
  return (key = "") => {
    const normalized = text(key);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  };
};

/*
 * The price the customer is looking at, and never a zero standing in for one.
 *
 * The caller passes the price it already displayed, but a lean catalogue
 * projection can hand the page a row with no price field at all — the display
 * then resolves to 0 and used to be forwarded to Meta as `value: 0`, which is
 * exactly what Events Manager flags. So the walk takes the first candidate that
 * is a real price instead of stopping at the first one that merely exists, and
 * falls back to the canonical selling-price ladder the rest of the storefront
 * prices against.
 */
export const metaCurrentSellingPrice = ({ product = {}, variant = {}, line = null, value = null } = {}) => {
  const quoted = firstMetaMoneyValue(
    value,
    line?.price,
    line?.unit_price,
    line?.selling_price,
    line?.current_selling_price,
  );
  if (quoted > 0) return quoted;
  const lineTotal = firstMetaMoneyValue(line?.total_amount, line?.line_total, line?.total);
  if (lineTotal > 0) return lineTotal / quantityValue(line?.quantity ?? line?.qty);
  return firstMetaMoneyValue(
    variant?.display_price,
    variant?.final_price,
    variant?.current_selling_price,
    variant?.selling_price,
    variant?.price,
    product?.display_price,
    product?.final_price,
    storefrontSellingPrice(product || {}, variant || {}),
    variant?.sale_price,
    variant?.offer_price,
    product?.sale_price,
    product?.offer_price,
  );
};

export const buildMetaEventPayload = ({ contentIds = [], contents = [], contentName = "", value = 0, numItems = 0, eventId = "", customer = {} } = {}) => {
  const ids = [...new Set((Array.isArray(contentIds) ? contentIds : []).map(text).filter(Boolean))];
  if (!ids.length) return null;
  const normalizedCustomer = normalizeMetaCustomer(customer);
  const lines = metaEventContents(contents);
  return {
    content_type: "product",
    content_ids: ids,
    ...(text(contentName) ? { content_name: text(contentName) } : {}),
    ...(lines.length ? { contents: lines } : {}),
    ...(numberValue(numItems) ? { num_items: Math.floor(numberValue(numItems)) } : {}),
    ...metaValueFields({ value, currency: "EGP" }),
    event_id: text(eventId),
    ...(normalizedCustomer.email ? { email: normalizedCustomer.email } : {}),
    ...(normalizedCustomer.phone ? { phone: normalizedCustomer.phone } : {}),
    ...(normalizedCustomer.firstName ? { first_name: normalizedCustomer.firstName } : {}),
    ...(normalizedCustomer.lastName ? { last_name: normalizedCustomer.lastName } : {}),
    ...(normalizedCustomer.city ? { city: normalizedCustomer.city } : {}),
    ...(normalizedCustomer.state ? { state: normalizedCustomer.state } : {}),
    ...(normalizedCustomer.country ? { country: normalizedCustomer.country } : {}),
    ...(normalizedCustomer.externalId ? { external_id: normalizedCustomer.externalId } : {}),
  };
};

// The server sends the same Purchase with the same id, so both sides read these
// from shared/metaPurchaseEvent.js rather than each keeping its own copy.
export { isMetaPurchaseEligible, metaCatalogContentId };
export const purchaseEventId = metaPurchaseEventId;
export const canTrackMetaPurchase = (order = {}, sentOrderIds = new Set()) => {
  const orderId = metaOrderReference(order);
  return Boolean(orderId && isMetaPurchaseEligible(order) && !sentOrderIds.has(orderId));
};
export const metaLineContent = (item = {}) => {
  const product = item.product || item;
  const variant = item.variant || item.selected_variant || item;
  const id = metaCatalogContentId(product, variant);
  if (!id) return null;
  const itemPrice = metaCurrentSellingPrice({ product, variant, line: item });
  return {
    id,
    quantity: quantityValue(item.quantity || item.qty),
    ...(itemPrice > 0 ? { item_price: itemPrice } : {}),
  };
};

export const metaPurchaseValue = ({ value = 0, items = [] } = {}) => {
  const explicitValue = numberValue(value);
  if (explicitValue > 0) return explicitValue;
  return (Array.isArray(items) ? items : []).reduce((total, item) => {
    const quantity = quantityValue(item?.quantity || item?.qty);
    const lineTotal = numberValue(item?.total_amount || item?.line_total || item?.total);
    if (lineTotal > 0) return total + lineTotal;
    return total + (metaCurrentSellingPrice({ product: item?.product || item, variant: item?.variant || item?.selected_variant || item, line: item }) * quantity);
  }, 0);
};
