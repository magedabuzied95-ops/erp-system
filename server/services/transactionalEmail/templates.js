import { emailButton, emailFooter, emailHeader, emailLayout, orderSummary, productRows } from "./components.js";
import { deliveryLabel, escapeHtml, formatCurrency, formatOrderDate, paymentLabel, statusLabel } from "./helpers.js";

const infoCell = (label, value) => `<td style="padding:10px;border:1px solid #e8e3da;border-radius:8px"><div style="color:#77736b;font:11px Arial,sans-serif">${escapeHtml(label)}</div><div style="margin-top:4px;font:700 13px/1.5 Arial,sans-serif">${escapeHtml(value || "-")}</div></td>`;
const productsTable = (items) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px"><tr><th></th><th style="text-align:right;font:11px Arial,sans-serif;color:#77736b">المنتج</th><th style="font:11px Arial,sans-serif;color:#77736b">الكمية</th><th style="text-align:left;font:11px Arial,sans-serif;color:#77736b">سعر الوحدة</th><th style="text-align:left;font:11px Arial,sans-serif;color:#77736b">الإجمالي</th></tr>${productRows(items)}</table>`;

export const renderCustomerOrderConfirmation = (data = {}) => {
  const { order = {}, items = [], links = {}, brand = {} } = data;
  const number = order.public_order_number || order.invoice_number || order.id;
  const body = `<div style="text-align:center"><div style="font:700 25px/1.35 Arial,sans-serif">شكرًا لطلبك، ${escapeHtml(order.customer_name || "عميلنا العزيز")}</div><p style="margin:10px 0 24px;color:#6b6861;font:14px/1.8 Arial,sans-serif">تم استلام طلبك وسيتم مراجعته والتواصل معك لتأكيده.</p></div>
  <table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>${infoCell("رقم الطلب", number)}${infoCell("تاريخ الطلب", formatOrderDate(order.created_at))}</tr><tr>${infoCell("الحالة", statusLabel(order.status))}${infoCell("طريقة الدفع", paymentLabel(order.payment_method))}</tr></table>
  <h2 style="margin:28px 0 8px;font:700 17px Arial,sans-serif">ملخص الطلب</h2>${productsTable(items)}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px">${orderSummary(order)}</table>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px"><tr><td style="vertical-align:top;width:50%;padding-left:12px"><div style="font:700 14px Arial,sans-serif">معلومات العميل</div><div style="margin-top:8px;color:#6b6861;font:13px/1.8 Arial,sans-serif">${escapeHtml(order.customer_name)}<br>${escapeHtml(order.customer_phone)}<br>${escapeHtml(order.customer_email)}</div></td><td style="vertical-align:top;width:50%"><div style="font:700 14px Arial,sans-serif">عنوان الشحن</div><div style="margin-top:8px;color:#6b6861;font:13px/1.8 Arial,sans-serif">${escapeHtml(order.shipping_address_line || order.customer_address)}<br>${escapeHtml([order.city_area, order.governorate].filter(Boolean).join("، "))}<br>${escapeHtml(deliveryLabel(order.shipping_method || order.shipping_provider))}</div></td></tr></table>
  <div style="margin-top:28px;text-align:center">${emailButton({ href: links.invoice, label: "عرض الفاتورة" })}${emailButton({ href: links.track, label: "تتبع الطلب", secondary: true })}</div>`;
  return {
    subject: `تأكيد طلبك ${number} | M1 Store`,
    text: `شكرًا لطلبك من M1 Store. رقم الطلب: ${number}. الإجمالي: ${formatCurrency(order.total_amount || order.total)}. تم استلام طلبك وسيتم مراجعته والتواصل معك لتأكيده.`,
    html: emailLayout({ preheader: `تم استلام طلبك ${number}`, header: emailHeader(brand), body, footer: emailFooter(brand) }),
  };
};

export const renderAdminOrderNotification = (data = {}) => {
  const { order = {}, items = [], links = {}, brand = {}, previousOrdersCount = 0 } = data;
  const number = order.public_order_number || order.invoice_number || order.id;
  const body = `<div style="font:700 24px/1.35 Arial,sans-serif">طلب جديد من الموقع</div><p style="color:#6b6861;font:14px Arial,sans-serif">تم إنشاء الطلب بنجاح داخل قاعدة البيانات.</p>
  <table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>${infoCell("رقم الطلب", number)}${infoCell("وقت الطلب", formatOrderDate(order.created_at))}</tr><tr>${infoCell("العميل", order.customer_name)}${infoCell("الهاتف", order.customer_phone)}</tr><tr>${infoCell("المحافظة", order.governorate)}${infoCell("طلبات سابقة", String(previousOrdersCount))}</tr><tr>${infoCell("طريقة الدفع", paymentLabel(order.payment_method))}${infoCell("طريقة التوصيل", deliveryLabel(order.shipping_method || order.shipping_provider))}</tr></table>
  <div style="margin:16px 8px;padding:12px;border-radius:10px;background:#f7f5f0;font:13px/1.8 Arial,sans-serif"><strong>العنوان:</strong> ${escapeHtml(order.shipping_address_line || order.customer_address || "-")}</div>
  ${productsTable(items)}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px">${orderSummary(order)}</table>
  <div style="margin-top:28px;text-align:center">${emailButton({ href: links.erpOrder, label: "فتح الطلب في ERP" })}${emailButton({ href: links.invoice, label: "فتح الفاتورة", secondary: true })}</div>`;
  return {
    subject: `طلب موقع جديد ${number} — ${formatCurrency(order.total_amount || order.total)}`,
    text: `طلب جديد ${number}. العميل: ${order.customer_name || "-"}. الهاتف: ${order.customer_phone || "-"}. الإجمالي: ${formatCurrency(order.total_amount || order.total)}.`,
    html: emailLayout({ preheader: `طلب جديد ${number}`, header: emailHeader(brand), body, footer: emailFooter(brand) }),
  };
};
