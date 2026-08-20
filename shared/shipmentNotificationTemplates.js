/*
 * One source for the four shipment notifications: their defaults, the placeholder
 * vocabulary, and the renderer.
 *
 * The Shipping Center preview and the WhatsApp sender both call renderShipmentTemplate,
 * so what the operator previews is exactly what the customer receives. A preview with
 * its own rendering rules is a preview that lies.
 */

export const SHIPMENT_NOTIFICATION_TYPES = ["shipment_created", "shipped", "out_for_delivery", "delivered"];

export const SHIPMENT_NOTIFICATION_LABELS = {
  shipment_created: { en: "Shipment created", ar: "تم إنشاء الشحنة" },
  shipped: { en: "Picked up / in transit", ar: "تم الاستلام / في الطريق" },
  out_for_delivery: { en: "Out for delivery", ar: "خارج للتسليم" },
  delivered: { en: "Delivered", ar: "تم التسليم" },
};

/* When each one fires, so the operator is not guessing at the trigger. */
export const SHIPMENT_NOTIFICATION_TRIGGERS = {
  shipment_created: { en: "The moment the shipment is created", ar: "لحظة إنشاء الشحنة" },
  shipped: { en: "When the courier picks the parcel up", ar: "عند استلام المندوب للشحنة" },
  out_for_delivery: { en: "When the parcel goes out for delivery", ar: "عند خروج الشحنة للتسليم" },
  delivered: { en: "After the parcel is delivered", ar: "بعد تسليم الشحنة" },
};

export const SHIPMENT_TEMPLATE_PLACEHOLDERS = [
  { token: "order_number", en: "Order number", ar: "رقم الطلب" },
  { token: "customer_name", en: "Customer name", ar: "اسم العميل" },
  { token: "provider", en: "Shipping company", ar: "شركة الشحن" },
  { token: "tracking_number", en: "Tracking number", ar: "رقم التتبع" },
  { token: "tracking_url", en: "Tracking link", ar: "رابط التتبع" },
  { token: "cod_amount", en: "Amount to collect", ar: "المبلغ المطلوب" },
];

export const SHIPMENT_NOTIFICATION_DEFAULTS = {
  shipment_created: {
    enabled: true,
    template: `تم إنشاء شحنة طلبك

رقم الطلب: {{order_number}}
شركة الشحن: {{provider}}
رقم التتبع: {{tracking_number}}

سنقوم بإرسال تحديثات الشحنة تلقائياً.`,
  },
  shipped: {
    enabled: true,
    template: `تم شحن طلبك

رقم الطلب: {{order_number}}
شركة الشحن: {{provider}}
رقم التتبع: {{tracking_number}}
رابط التتبع: {{tracking_url}}`,
  },
  out_for_delivery: {
    enabled: true,
    template: `المندوب خارج للتسليم

رقم الطلب: {{order_number}}
المبلغ المطلوب: {{cod_amount}}

نتمنى أن تكون متاحاً لاستلام الطلب.`,
  },
  delivered: {
    enabled: true,
    template: `✅ تم تسليم طلبك بنجاح

شكراً لاختيارك M1 Store

نتمنى أن تكون راضياً عن المنتج
إذا احتجت أي مساعدة نحن في خدمتك دائماً.`,
  },
};

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
const valueOf = (values, name) => String(values?.[String(name).toLowerCase()] ?? "").trim();

/*
 * A line carrying a placeholder that resolves to nothing is dropped whole, its label
 * with it. Replacing in place would leave the customer a bare "رابط التتبع:" — which is
 * exactly what the old hard-coded message did, on every order, because tracking_url is
 * never populated by Bosta's create response.
 */
export const renderShipmentTemplate = (template = "", values = {}) => {
  const kept = [];
  for (const line of String(template ?? "").split(/\r?\n/)) {
    const tokens = [...line.matchAll(TOKEN_PATTERN)];
    if (tokens.length && tokens.some((match) => !valueOf(values, match[1]))) continue;
    kept.push(line.replace(TOKEN_PATTERN, (_, name) => valueOf(values, name)));
  }
  // Dropped lines leave blank runs behind; collapse them so the message stays tight.
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

/*
 * Stored config is merged over the defaults rather than trusted wholesale: a partial or
 * corrupt value must never blank a customer message. An empty template falls back to the
 * default — silencing a notification is what the `enabled` switch is for.
 */
export const normalizeShipmentNotificationConfig = (raw) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const config = {};
  for (const type of SHIPMENT_NOTIFICATION_TYPES) {
    const entry = source[type] && typeof source[type] === "object" ? source[type] : {};
    const template = typeof entry.template === "string" && entry.template.trim() ? entry.template : SHIPMENT_NOTIFICATION_DEFAULTS[type].template;
    config[type] = { enabled: entry.enabled !== false, template };
  }
  return config;
};

export default SHIPMENT_NOTIFICATION_DEFAULTS;
