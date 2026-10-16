/*
 * The shape of a TikTok event, stated once for the browser Pixel and the future
 * server Events API.
 *
 * TikTok collapses a browser event and a server event into one only when they
 * agree on `event` + `event_id`, so ids tied to an order are derived from the
 * order, never from a clock. Content ids are the catalogue feed's own per-size id
 * (metaCatalogContentId), so a future TikTok catalogue built from the same feed
 * matches every event without a second id scheme.
 *
 * Keep this pure and dependency-free beyond metaPurchaseEvent.js: the client
 * bundles it and the server can import the same file.
 */
import { metaCatalogContentId, metaOrderReference } from "./metaPurchaseEvent.js";

const text = (value = "") => String(value ?? "").trim();
const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
};
const quantity = (value) => Math.max(1, Math.floor(Number(value) || 1));

export const TIKTOK_CURRENCY = "EGP";

export const tiktokContentId = metaCatalogContentId;

/*
 * Paid means the money is in: a cash-on-delivery or awaiting-verification order is
 * a placed order (PlaceAnOrder), not a completed payment.
 */
export const isTikTokPaymentComplete = (order = {}) =>
  text(order.payment_status).toLowerCase() === "paid" &&
  !["cancelled", "canceled", "failed", "payment_failed", "rejected"].includes(text(order.status).toLowerCase());

export const isTikTokOrderPlaced = (order = {}) =>
  Boolean(metaOrderReference(order)) &&
  !["cancelled", "canceled", "failed", "payment_failed", "rejected"].includes(text(order.status || order.payment_status).toLowerCase());

// Same id on both senders for the same order; the event name keeps the two order events apart.
export const tiktokOrderEventId = (eventName = "", order = {}) =>
  `m1_tt_${text(eventName).toLowerCase()}_order_${metaOrderReference(order)}`;

export const tiktokRandomEventId = (eventName = "") =>
  `m1_tt_${text(eventName).toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;

/*
 * contents: [{ content_id, content_name?, price?, quantity }] → the properties object
 * TikTok documents for ViewContent / AddToCart / InitiateCheckout / PlaceAnOrder /
 * CompletePayment. No customer data rides here — matching data, if ever sent, goes
 * hashed through the server Events API.
 */
export const buildTikTokEventProperties = ({ contents = [], value = 0 } = {}) => {
  const lines = (Array.isArray(contents) ? contents : [])
    .map((line) => {
      const id = text(line?.content_id);
      if (!id) return null;
      const price = money(line?.price);
      const name = text(line?.content_name);
      return {
        content_id: id,
        content_type: "product",
        ...(name ? { content_name: name } : {}),
        quantity: quantity(line?.quantity),
        ...(price ? { price } : {}),
      };
    })
    .filter(Boolean);
  if (!lines.length) return null;
  const total = money(value) || money(lines.reduce((sum, line) => sum + (line.price || 0) * line.quantity, 0));
  return {
    contents: lines,
    content_type: "product",
    ...(total ? { value: total } : {}),
    currency: TIKTOK_CURRENCY,
  };
};
