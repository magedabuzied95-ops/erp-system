import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { sendCartCarouselMessage } from "./whatsappGatewayService.js";
import { resolvePublicAppUrl } from "../utils/whatsapp.js";
import { ABANDONED_CART_DEFAULTS } from "../../shared/abandonedCartDefaults.js";

/*
 * The abandoned-cart reminder. A signed-in storefront customer's cart is saved server-side per
 * phone (storefront_customer_carts); when it sits untouched past the configured delay, they get
 * ONE WhatsApp carousel — the shared nudge text, then a card per product with its photo, price
 * and an "أكمل الطلب" button opening the cart, which restores itself from the same saved rows.
 *
 * Send-once discipline is a claim on reminder_sent_at, the same shape as the shipping
 * notifications' once-only columns: claim first, send after, so a crash between the two costs one
 * reminder rather than sending two. Editing the cart moves updated_at past the claim, which
 * re-arms the reminder for the NEXT abandonment — that is deliberate, not an oversight.
 */

const text = (value = "") => String(value ?? "").trim();

export const ABANDONED_CART_SETTING_KEY = "marketing.abandoned_cart_reminder";

export { ABANDONED_CART_DEFAULTS };

export const normalizeAbandonedCartConfig = (raw) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    enabled: source.enabled === true,
    delay_minutes: Math.max(15, Number(source.delay_minutes) || ABANDONED_CART_DEFAULTS.delay_minutes),
    max_cards: Math.min(10, Math.max(1, Number(source.max_cards) || ABANDONED_CART_DEFAULTS.max_cards)),
    body: text(source.body) || ABANDONED_CART_DEFAULTS.body,
    button_text: text(source.button_text) || ABANDONED_CART_DEFAULTS.button_text,
  };
};

let schemaReady = null;
const ensureAbandonedCartSchema = () => {
  if (!schemaReady) {
    schemaReady = db
      .query(`ALTER TABLE IF EXISTS storefront_customer_carts ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP NULL`)
      .catch((error) => {
        schemaReady = null; // a failed ensure must not become a cached rejection
        throw error;
      });
  }
  return schemaReady;
};

const cardFromItem = (item = {}, { url, buttonText }) => {
  const name = text(item.name || item.product_name || item.title);
  const price = Number(item.sale_price || item.price || 0);
  const priceLine = price > 0 ? `EGP ${price.toLocaleString("en-US")}` : "";
  const image = text(
    item.image_url || item.image || item.product_image || item.photo_url || item.thumbnail_url || ""
  );
  if (!name) return null;
  return {
    imageUrl: image,
    body: priceLine ? `${name}\n${priceLine}` : name,
    buttonText,
    url,
  };
};

export const buildAbandonedCartCarousel = (cart = [], config = ABANDONED_CART_DEFAULTS, baseUrl = resolvePublicAppUrl()) => {
  const cartUrl = `${String(baseUrl || "").replace(/\/+$/, "")}/cart`;
  const items = Array.isArray(cart) ? cart : [];
  const cards = items
    .map((item) => cardFromItem(item, { url: cartUrl, buttonText: config.button_text }))
    .filter(Boolean)
    .slice(0, config.max_cards);
  const fallbackText = `${config.body}\n\n${cartUrl}`;
  return { body: config.body, cards, fallbackText, cartUrl };
};

const claimCart = async (row) => {
  const result = await db.query(
    `
    UPDATE storefront_customer_carts
    SET reminder_sent_at = NOW()
    WHERE id = $1
      AND (reminder_sent_at IS NULL OR reminder_sent_at < updated_at)
    RETURNING id
    `,
    [row.id]
  );
  return result.rowCount > 0;
};

export const runAbandonedCartReminderTick = async () => {
  const config = normalizeAbandonedCartConfig(await getSetting(ABANDONED_CART_SETTING_KEY, undefined));
  if (!config.enabled) return { sent: 0, reason: "disabled" };
  await ensureAbandonedCartSchema();

  const due = await db.query(
    `
    SELECT id, tenant_id, customer_phone, cart
    FROM storefront_customer_carts
    WHERE jsonb_array_length(cart) > 0
      AND updated_at < NOW() - make_interval(mins => $1)
      AND (reminder_sent_at IS NULL OR reminder_sent_at < updated_at)
    ORDER BY updated_at ASC
    LIMIT 10
    `,
    [config.delay_minutes]
  );

  let sent = 0;
  for (const row of due.rows) {
    const { body, cards, fallbackText } = buildAbandonedCartCarousel(row.cart, config);
    if (!cards.length) {
      // nothing renderable (nameless items) — claim anyway so it is not retried forever
      await claimCart(row).catch(() => {});
      continue;
    }
    // Claim BEFORE sending: a crash after the send but before the claim would remind twice,
    // and a duplicate marketing nudge is worse than a missed one.
    const claimed = await claimCart(row).catch(() => false);
    if (!claimed) continue;
    try {
      await sendCartCarouselMessage({ phone: row.customer_phone, body, cards, fallbackText });
      sent += 1;
      console.info("[abandoned-cart] reminder sent", {
        cart_id: row.id,
        phoneSuffix: String(row.customer_phone || "").slice(-4),
        cards: cards.length,
      });
    } catch (error) {
      console.warn("[abandoned-cart] reminder failed", {
        cart_id: row.id,
        phoneSuffix: String(row.customer_phone || "").slice(-4),
        message: error?.message || String(error),
        code: error?.code || "",
      });
    }
  }
  return { sent, due: due.rowCount };
};
