import { buildOrderInvoiceWhatsappText, normalizeOrderInvoiceData } from "./orderInvoice.js";
import { displayPublicOrderNumber } from "./publicOrderNumber.js";

const DEFAULT_PROVIDER = "web";
const DEFAULT_PUBLIC_APP_URL = "https://erp-system-ten-green.vercel.app";

export const normalizePhoneNumber = (value, defaultCountryCode = "20") => {
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

export const buildInvoiceMessageTemplate = ({ invoiceNumber, customerName, total, paymentStatus, items = [], companyName = "ERP Store", order = null, invoice = null }) => {
  const normalized = invoice || normalizeOrderInvoiceData(order || {
    invoice_number: invoiceNumber,
    customer_name: customerName,
    total,
    payment_status: paymentStatus,
    items,
    company_name: companyName,
  }, items, { storeName: companyName });
  return buildOrderInvoiceWhatsappText(normalized);
};

export const resolvePublicAppUrl = () =>
  String(
    process.env.FRONTEND_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.STORE_FRONT_URL ||
      process.env.CLIENT_URL ||
      process.env.APP_URL ||
      process.env.VITE_PUBLIC_APP_URL ||
      DEFAULT_PUBLIC_APP_URL
  )
    .trim()
    .replace(/\/+$/, "");

export const buildPublicInvoiceUrl = (invoiceNumber, baseUrl = resolvePublicAppUrl()) => {
  const code = String(invoiceNumber || "").trim();
  if (!code || !baseUrl) return "";
  return `${String(baseUrl).replace(/\/+$/, "")}/invoice/${encodeURIComponent(code)}`;
};

export const buildArabicReceiptMessage = ({ invoiceUrl = "" } = {}) =>
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

export const buildInvoiceReceiptWhatsappMessage = ({ invoiceNumber, invoiceUrl } = {}) =>
  buildArabicReceiptMessage({ invoiceUrl: invoiceUrl || buildPublicInvoiceUrl(invoiceNumber) });

export const buildOrderStatusMessageTemplate = ({ invoiceNumber, customerName, status, paymentStatus, trackingNumber, deliveryStatus, total, companyName = "ERP Store" }) =>
  [
    `*${companyName}*`,
    `Order update`,
    `Order: ${displayPublicOrderNumber(invoiceNumber) || invoiceNumber || "n/a"}`,
    `Customer: ${customerName || "Walk-in Customer"}`,
    `Status: ${status || "Pending"}`,
    `Payment: ${paymentStatus || "Pending"}`,
    `Total: ${total ?? 0}`,
    trackingNumber ? `Tracking: ${trackingNumber}` : "",
    deliveryStatus ? `Delivery: ${deliveryStatus}` : "",
  ]
    .filter(Boolean)
    .join("\n");

export const buildWhatsappDeepLink = ({ phone, message }) => {
  const normalizedPhone = normalizePhoneNumber(phone).replace(/[^\d]/g, "");
  const encoded = encodeURIComponent(message || "");
  return normalizedPhone ? `https://wa.me/${normalizedPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
};

export const buildWhatsappProviderPayload = ({
  provider = process.env.WHATSAPP_PROVIDER || DEFAULT_PROVIDER,
  phone,
  message,
  invoiceNumber,
  orderId,
}) => ({
  provider,
  phone: normalizePhoneNumber(phone),
  message,
  invoiceNumber,
  orderId,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  deepLink: buildWhatsappDeepLink({ phone, message }),
});

export const sendWhatsappNotification = async (payload) => {
  const provider = String(payload?.provider || process.env.WHATSAPP_PROVIDER || DEFAULT_PROVIDER).toLowerCase();

  if (provider === "web" || provider === "fallback" || !payload?.phone) {
    return {
      ok: false,
      provider: "web",
      fallbackUrl: buildWhatsappDeepLink({ phone: payload?.phone, message: payload?.message }),
      message: "WhatsApp Web fallback only",
    };
  }

  return {
    ok: false,
    provider,
    message: "WhatsApp provider integration placeholder",
    payload: {
      ...payload,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    },
  };
};
