const clean = (value = "") => String(value ?? "").trim();

const shortenConfirmationLink = (value = "") => {
  const link = clean(value);
  if (!link) return "";

  const extractCode = (input = "") => {
    const match = String(input).match(/(?:\/shop\/confirm\/|\/confirm\/|\/c\/)([^/?#]+)/i);
    return match?.[1] ? String(match[1]).trim() : "";
  };

  try {
    const parsed = new URL(link, "https://example.com");
    const code = extractCode(parsed.pathname);
    if (!code) return link;
    if (link.startsWith("/")) return `/c/${encodeURIComponent(code)}`;
    return `${parsed.origin}/c/${encodeURIComponent(code)}`;
  } catch {
    const code = extractCode(link);
    return code ? `/c/${encodeURIComponent(code)}` : link;
  }
};

// Whole pounds read better than trailing zeros in a chat bubble; piastres still show when real.
const formatAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const hasPiastres = Math.round(amount * 100) % 100 !== 0;
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: hasPiastres ? 2 : 0,
    maximumFractionDigits: hasPiastres ? 2 : 0,
  });
};

// WhatsApp truncates a long interactive body, and a truncated body can swallow the closing line
// that tells the customer to press a button. Cap the list and say what was left out.
const PRODUCT_LINE_CAP = 5;

const productLines = (items = []) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return "";
  const shown = list.slice(0, PRODUCT_LINE_CAP).map((item) => {
    const name = clean(item?.product_name || item?.name || item?.title) || "منتج";
    const variant = [clean(item?.color), clean(item?.size)].filter(Boolean).join(" · ")
      || clean(item?.variant_name);
    const quantity = Math.max(1, Number(item?.quantity || item?.qty || 1) || 1);
    return `• ${name}${variant ? ` — ${variant}` : ""}${quantity > 1 ? ` ×${quantity}` : ""}`;
  });
  const hidden = list.length - shown.length;
  if (hidden > 0) shown.push(`• و${hidden} ${hidden === 1 ? "منتج آخر" : "منتجات أخرى"}`);
  return shown.join("\n");
};

const addressLine = (order = {}) => {
  const parts = [
    clean(order.governorate),
    clean(order.city_area || order.shipping_city_name),
    clean(order.shipping_address_line) || [
      clean(order.street_address),
      clean(order.building_number) && `عمارة ${clean(order.building_number)}`,
      clean(order.floor_number) && `دور ${clean(order.floor_number)}`,
      clean(order.apartment_number) && `شقة ${clean(order.apartment_number)}`,
    ].filter(Boolean).join("، "),
    clean(order.landmark),
  ].filter(Boolean);
  return parts.join(" - ");
};

export const buildCodOrderConfirmationMessage = ({
  customerName = "عميلنا",
  confirmationLink = "",
  order = null,
  items = [],
  invoiceUrl = "",
  withActions = false,
} = {}) => {
  const name = clean(customerName) || "عميلنا";
  const link = shortenConfirmationLink(confirmationLink);
  const source = order || {};

  const orderRef = clean(
    source.public_order_number || source.display_order_number || source.invoice_number || source.order_number || source.id
  ).replace(/^#/, "");
  const collect = formatAmount(
    Number(source.cod_amount) > 0 ? source.cod_amount : (source.total_amount ?? source.total_price ?? source.total)
  );
  const products = productLines(items.length ? items : source.items || []);
  const address = addressLine(source);

  const details = [
    orderRef && `🔢 رقم الطلب: ${orderRef}`,
    collect && `💰 مبلغ التحصيل: ${collect} جنيه`,
    products && `🛍️ المنتجات:\n${products}`,
    address && `📍 عنوان التوصيل: ${address}`,
  ].filter(Boolean).join("\n");

  const blocks = [
    `أهلاً يا ${name} 👋`,
    "⏳ تم تسجيل طلبك بنجاح من M1 Store، وحالياً بإنتظار تأكيدك.",
    details && `📦 تفاصيل طلبك\n\n${details}`,
    invoiceUrl && `🧾 فاتورتك:\n${invoiceUrl}`,
    // The buttons carry the actions, so the interactive body names none of them. Only the text
    // fallback spells them out - without buttons AND without this the customer has nothing to
    // press and nothing to type, and the keyword parser never gets a chance.
    withActions && `✅ تأكيد الطلب
✏️ تعديل الطلب
❌ إلغاء الطلب`,
    link && `اضغط على الرابط التالي لاختيار الإجراء المناسب:\n${link}`,
    "⬇️ برجاء التأكيد",
  ].filter(Boolean);

  return blocks.join("\n\n");
};
