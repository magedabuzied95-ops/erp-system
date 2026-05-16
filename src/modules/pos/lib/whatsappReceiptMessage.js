import {
  buildArabicReceiptMessage,
  buildWhatsappDeepLink,
  formatWhatsappPhone,
  normalizePhoneNumber,
} from "../../../shared/utils/whatsapp.js";

export const buildLoyaltyReceiptMessage = ({
  invoiceUrl = "",
}) => {
  return buildArabicReceiptMessage({
    invoiceUrl,
  });
};

export const buildLoyaltyReceiptWhatsappUrl = ({
  phone,
  invoiceUrl = "",
}) => {
  const normalizedPhone = normalizePhoneNumber(phone);
  const message = buildLoyaltyReceiptMessage({
    invoiceUrl,
  });
  if (import.meta.env.DEV) {
    console.log("[whatsapp invoice url]", invoiceUrl);
    console.log("[whatsapp message]", message);
  }

  return buildWhatsappDeepLink({
    phone: normalizedPhone || formatWhatsappPhone(phone),
    message,
  });
};

export const normalizeReceiptPhone = (phone) => normalizePhoneNumber(phone);
