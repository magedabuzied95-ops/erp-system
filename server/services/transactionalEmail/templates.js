import { emailButton, emailFooter, emailHeader, emailLayout, orderSummary, paymentPanel, productRows } from "./components.js";
import { adminEmailFooter, customerEmailFooter, customerEmailHeader, renderAdminOrderEmailBody, renderCustomerOrderEmailBody } from "./customerEmailDesign.js";
import { deliveryLabel, escapeHtml, formatCurrency, formatOrderDate, paymentLabel, statusLabel } from "./helpers.js";

const infoCell = (label, value) => `<td style="padding:10px;border:1px solid #e8e3da;border-radius:8px"><div style="color:#77736b;font:11px Arial,sans-serif">${escapeHtml(label)}</div><div style="margin-top:4px;font:700 13px/1.5 Arial,sans-serif">${escapeHtml(value || "-")}</div></td>`;
const productsTable = (items) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px"><tr><th></th><th style="text-align:right;font:11px Arial,sans-serif;color:#77736b">المنتج</th><th style="font:11px Arial,sans-serif;color:#77736b">الكمية</th><th style="text-align:left;font:11px Arial,sans-serif;color:#77736b">سعر الوحدة</th><th style="text-align:left;font:11px Arial,sans-serif;color:#77736b">الإجمالي</th></tr>${productRows(items)}</table>`;

export const renderCustomerOrderConfirmation = (data = {}) => {
  const { order = {}, items = [], links = {}, brand = {}, payment = null } = data;
  const number = order.public_order_number || order.invoice_number || order.id;
  // A cash-on-delivery order is confirmed by the customer on WhatsApp; say where it will arrive.
  const nextStep = payment?.kind === "transfer_review"
    ? "استلمنا طلبك وصورة التحويل، وهنراجع التحويل ونأكد معاك قبل الشحن."
    : order.customer_phone && String(order.status || "").toLowerCase() === "pending_confirmation"
      ? `تم استلام طلبك، وهتوصلك رسالة على واتساب على رقم <span dir="ltr">${escapeHtml(order.customer_phone)}</span> عشان تأكد الطلب.`
      : "تم استلام طلبك وسيتم مراجعته والتواصل معك لتأكيده.";
  const body = renderCustomerOrderEmailBody({ order, items, links, brand, payment, nextStep });
  return {
    subject: `تأكيد طلبك ${number} | M1 Store`,
    text: [
      `شكرًا لطلبك من M1 Store. رقم الطلب: ${number}. الإجمالي: ${formatCurrency(order.total_amount || order.total)}.`,
      payment?.kind === "advance_required" ? payment.notice : "",
      payment?.kind === "transfer_review" ? `المبلغ المحوّل (قيد المراجعة): ${formatCurrency(payment.transferred)}. الباقي عند الاستلام: ${formatCurrency(payment.collect)}.` : "",
      payment?.kind === "cod" ? `المطلوب عند الاستلام: ${formatCurrency(payment.collect)}.` : "",
      links.track ? `تتبع الطلب: ${links.track}` : "",
    ].filter(Boolean).join("\n"),
    html: emailLayout({ preheader: payment?.kind === "advance_required" ? `طلبك ${number} اتسجّل — مستنيين تحويل رسوم الشحن` : `تم استلام طلبك ${number} — هتوصلك رسالة تأكيد على واتساب`, header: customerEmailHeader(brand), body, footer: customerEmailFooter(brand) }),
  };
};

export const renderAdminOrderNotification = (data = {}) => {
  const { order = {}, items = [], links = {}, brand = {}, previousOrdersCount = 0, payment = null } = data;
  const number = order.public_order_number || order.invoice_number || order.id;
  // A till-raised online order goes through the same checkout; say which door it came in by.
  const fromTill = String(order.origin_surface || "").toLowerCase() === "pos";
  const body = renderAdminOrderEmailBody({ order, items, links, payment, previousOrdersCount, fromTill, deliveryName: deliveryLabel(order.shipping_method || order.shipping_provider) });
  return {
    subject: `${fromTill ? "أوردر أونلاين من الكاشير" : "طلب موقع جديد"} ${number} — ${formatCurrency(order.total_amount || order.total)}${payment?.kind === "advance_required" ? " — مستني دفع الشحن" : payment?.kind === "transfer_review" ? " — تحويل مستني مراجعة" : ""}`,
    text: `طلب جديد ${number}. العميل: ${order.customer_name || "-"}. الهاتف: ${order.customer_phone || "-"}. الإجمالي: ${formatCurrency(order.total_amount || order.total)}.`,
    html: emailLayout({ preheader: `طلب جديد ${number}`, header: customerEmailHeader(brand), body, footer: adminEmailFooter() }),
  };
};
