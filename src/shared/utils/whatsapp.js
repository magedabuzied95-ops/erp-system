import { buildOrderInvoiceWhatsappText, normalizeOrderInvoiceData } from "./orderInvoice.js";
import { displayPublicOrderNumber } from "./publicOrderNumber.js";
import { formatCurrency } from "../lib/currency";

const DEFAULT_COUNTRY_CODE = "20";
const DEFAULT_MESSAGE_LANGUAGE = "ar";
export const DEFAULT_GOOGLE_REVIEW_URL =
  "https://g.page/r/Ccj4YSNAoHbVEAE/review";

export const getGoogleReviewUrl = () =>
  String(
    import.meta.env.VITE_GOOGLE_REVIEW_URL ||
      import.meta.env.GOOGLE_REVIEW_URL ||
      DEFAULT_GOOGLE_REVIEW_URL
  ).trim() || DEFAULT_GOOGLE_REVIEW_URL;

const resolveMessageLanguage = (language = DEFAULT_MESSAGE_LANGUAGE) =>
  String(language || DEFAULT_MESSAGE_LANGUAGE).toLowerCase().startsWith("ar") ? "ar" : "en";

const formatMessageCurrency = (amount, language = DEFAULT_MESSAGE_LANGUAGE) => {
  return formatCurrency(amount, { language });
};

const resolvePaymentStatusLabel = (paymentStatus, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const resolved = String(paymentStatus || "").trim().toLowerCase();
  const isPartial = resolved === "partially paid" || resolved === "partially_paid" || resolved === "partial";
  if (resolveMessageLanguage(language) === "ar") {
    if (resolved === "paid") return "مدفوعة";
    if (resolved === "partially paid" || resolved === "partial") return "مدفوعة جزئياً";
    return "غير مدفوعة";
  }

  if (resolved === "paid") return "Paid";
  if (isPartial) return "Partially paid";
  return "Unpaid";
};

export const normalizePhoneNumber = (value, defaultCountryCode = DEFAULT_COUNTRY_CODE) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const digitsOnly = raw.replace(/[^\d+]/g, "");
  if (!digitsOnly) return "";

  if (digitsOnly.startsWith("+")) {
    return `+${digitsOnly.replace(/[^\d]/g, "")}`;
  }

  if (digitsOnly.startsWith("00")) {
    return `+${digitsOnly.slice(2).replace(/[^\d]/g, "")}`;
  }

  const plainDigits = digitsOnly.replace(/[^\d]/g, "");

  if (plainDigits.startsWith(defaultCountryCode)) {
    return `+${plainDigits}`;
  }

  if (plainDigits.startsWith("0")) {
    return `+${defaultCountryCode}${plainDigits.slice(1)}`;
  }

  return `+${plainDigits}`;
};

export const isValidWhatsappPhone = (value) => {
  const normalized = normalizePhoneNumber(value);
  const digits = normalized.replace(/[^\d]/g, "");
  return digits.length >= 8;
};

export const formatWhatsappPhone = (value) => normalizePhoneNumber(value).replace(/[^\d]/g, "");

export const buildInvoiceMessageTemplate = ({
  invoiceNumber,
  customerName,
  total,
  paymentStatus,
  items = [],
  companyName = "ERP Store",
  invoiceUrl = "",
  language = DEFAULT_MESSAGE_LANGUAGE,
  order = null,
  invoice = null,
}) => {
  const publicNumber = displayPublicOrderNumber(invoiceNumber) || invoiceNumber;
  if (order || invoice) {
    const normalized = invoice || normalizeOrderInvoiceData(order, items, {
      storeName: companyName,
      publicUrl: invoiceUrl,
    });
    return buildOrderInvoiceWhatsappText(normalized);
  }

  const isArabic = resolveMessageLanguage(language) === "ar";
  const lines = isArabic
    ? [
        `فاتورة شراء من ${companyName}`,
        `رقم الطلب: ${publicNumber || "n/a"}`,
        `العميل: ${customerName || "عميل بدون اسم"}`,
        `الإجمالي المدفوع: ${formatMessageCurrency(total, "ar")}`,
        `الحالة: ${resolvePaymentStatusLabel(paymentStatus, "ar")}`,
      ]
    : [
        `Purchase invoice from ${companyName}`,
        `Order number: ${publicNumber || "n/a"}`,
        `Customer: ${customerName || "Walk-in Customer"}`,
        `Paid total: ${formatMessageCurrency(total, "en")}`,
        `Status: ${resolvePaymentStatusLabel(paymentStatus, "en")}`,
      ];

  if (invoiceUrl) {
    lines.push(isArabic ? "رابط الفاتورة:" : "Invoice link:");
    lines.push(invoiceUrl);
  }

  if (!isArabic && Array.isArray(items) && items.length > 0) {
    lines.push("");
    lines.push("Items");
    items.slice(0, 10).forEach((item, index) => {
      const qty = Number(item.quantity || 0);
      const name = item.product_name || item.name || `Item ${index + 1}`;
      const variant = [item.color, item.size].filter(Boolean).join(" / ");
      lines.push(`- ${name}${variant ? ` (${variant})` : ""} x${qty}`);
    });
  }

  return lines.join("\n");
};

export const buildArabicReceiptMessage = ({ invoiceUrl = "" }) =>
  [
    "شكراً لثقتكم بنا",
    "",
    "عرض الفاتورة:",
    invoiceUrl || "",
    "",
    "إذا احتجت أي مساعدة أو استفسار نحن في خدمتك دائمًا",
    "",
    "نتمنى لك تجربة ممتعة",
  ].join("\n");

export const buildOrderStatusMessageTemplate = ({
  invoiceNumber,
  customerName,
  status,
  paymentStatus,
  trackingNumber,
  deliveryStatus,
  total,
  companyName = "ERP Store",
}) => {
  const lines = [
    `*${companyName}*`,
    "Order update",
    `Order: ${displayPublicOrderNumber(invoiceNumber) || invoiceNumber || "n/a"}`,
    `Customer: ${customerName || "Walk-in Customer"}`,
    `Status: ${status || "Pending"}`,
    `Payment: ${paymentStatus || "Pending"}`,
    `Total: ${total ?? 0}`,
  ];

  if (trackingNumber) lines.push(`Tracking: ${trackingNumber}`);
  if (deliveryStatus) lines.push(`Delivery: ${deliveryStatus}`);

  return lines.join("\n");
};

export const buildWhatsappDeepLink = ({ phone, message }) => {
  const normalizedPhone = formatWhatsappPhone(phone);
  const encodedMessage = encodeURIComponent(message || "");

  if (normalizedPhone) {
    return `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
  }

  return `https://wa.me/?text=${encodedMessage}`;
};

export const buildWhatsappFallbackUrl = buildWhatsappDeepLink;

export const shareViaWhatsappWeb = ({ phone, message }) => {
  const url = buildWhatsappDeepLink({ phone, message });
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return url;
};
