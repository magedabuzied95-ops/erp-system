import { randomInt } from "node:crypto";

// The key every customer order link is signed with: the confirmation link (/c/) and the
// shipping-fee proof upload link (/pay/). One definition, so the two can never drift apart.
export const orderLinkSecret = () =>
  String(
    process.env.ORDER_CONFIRMATION_LINK_SECRET ||
      process.env.WHATSAPP_ORDER_CONFIRMATION_SECRET ||
      process.env.JWT_SECRET ||
      process.env.APP_SECRET ||
      process.env.SECRET_KEY ||
      process.env.SESSION_SECRET ||
      ""
  ).trim() || "order-confirmation-local-secret";

// Sixteen characters (about 95 bits), the width of order_confirmation_codes.code. Every character
// is drawn uniformly from the alphabet.
export const ORDER_LINK_CODE_LENGTH = 16;
const ORDER_LINK_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export const generateOrderLinkCode = () =>
  Array.from({ length: ORDER_LINK_CODE_LENGTH }, () => ORDER_LINK_CODE_ALPHABET[randomInt(ORDER_LINK_CODE_ALPHABET.length)]).join("");
