/*
 * WhatsApp catalogue "order" messages, read out of a Cloud API webhook body.
 *
 * Pure on purpose — no db, no network — so the shape Meta sends can be tested on its own:
 *
 *   entry[].changes[].value = {
 *     metadata: { phone_number_id, display_phone_number },
 *     contacts: [{ wa_id, profile: { name } }],
 *     messages: [{ from, id, timestamp, type: "order",
 *                  order: { catalog_id, text, product_items: [{ product_retailer_id, quantity, item_price, currency }] } }]
 *   }
 *
 * A cart sent from the WhatsApp catalogue arrives exactly once per message id; the caller stores
 * it under that id so a webhook retry cannot write the same cart twice.
 */

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

export const normalizeOrderItems = (productItems = []) =>
  asArray(productItems)
    .map((item) => {
      const quantity = Math.max(0, Math.trunc(Number(item?.quantity) || 0));
      const price = money(item?.item_price);
      return {
        product_retailer_id: text(item?.product_retailer_id),
        quantity,
        item_price: price,
        currency: text(item?.currency).toUpperCase(),
        line_total: money(price * quantity),
      };
    })
    .filter((item) => item.product_retailer_id && item.quantity > 0);

export const orderTotal = (items = []) => money(asArray(items).reduce((sum, item) => sum + money(item?.item_price) * (Number(item?.quantity) || 0), 0));

export const extractWhatsappOrders = (body = {}) => {
  const orders = [];
  asArray(body?.entry).forEach((entry) => {
    asArray(entry?.changes).forEach((change) => {
      const value = change?.value || {};
      const contacts = new Map(asArray(value.contacts).map((contact) => [text(contact?.wa_id), contact]));
      asArray(value.messages).forEach((message) => {
        if (text(message?.type).toLowerCase() !== "order" || !message?.order) return;
        const waMessageId = text(message.id);
        const phone = text(message.from);
        if (!waMessageId || !phone) return;
        const items = normalizeOrderItems(message.order.product_items);
        const seconds = Number(message.timestamp);
        orders.push({
          wa_message_id: waMessageId,
          customer_phone: phone,
          customer_name: text(contacts.get(phone)?.profile?.name),
          // The inbox keys a WhatsApp thread as whatsapp:<wa_id> (extractWhatsAppWebhookMessages).
          conversation_id: `whatsapp:${phone}`,
          catalog_id: text(message.order.catalog_id),
          note: text(message.order.text),
          phone_number_id: text(value.metadata?.phone_number_id),
          items,
          total: orderTotal(items),
          currency: items.find((item) => item.currency)?.currency || "",
          ordered_at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
        });
      });
    });
  });
  return orders;
};

// The id the Meta feed publishes a size under: its SKU when unique, else "<productId>-<variantId>"
// (shared/metaPurchaseEvent.js metaCatalogItemId). This splits the second shape back apart.
export const parseCompositeRetailerId = (retailerId = "") => {
  const match = /^(\d+)-(\d+)$/.exec(text(retailerId));
  return match ? { productId: Number(match[1]), variantId: Number(match[2]) } : null;
};
