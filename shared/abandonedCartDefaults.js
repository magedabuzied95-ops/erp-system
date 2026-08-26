/*
 * Defaults for the abandoned-cart WhatsApp reminder. They live in shared/ because the settings
 * registry (imported by the frontend settings screens as well as the server) needs them, and the
 * reminder service reads the same object so the two can never drift.
 */
export const ABANDONED_CART_DEFAULTS = {
  enabled: false,
  delay_minutes: 120,
  max_cards: 5,
  body: "الشوبينج مستنيك 🛒\nمنتجاتك المفضلة لسه موجودة في السلة بتاعتك\nاطلب دلوقتي واستمتع 🚚",
  button_text: "أكمل الطلب 🛒",
};
