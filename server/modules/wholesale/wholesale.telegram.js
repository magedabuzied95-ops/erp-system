import db from "../../database/db.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";
import { normalizeSettings, unitLabel } from "./wholesale.units.js";

// The wholesale Telegram channel (phase 5). Same channel machinery as retail — one post per
// model colour, edited in place, never deleted — but the post carries NO price: it says how
// the model is sold (series / carton / dozen / piece) and how many pieces of that colour are
// available, and its button opens a WhatsApp chat with the wholesale number.

const text = (value) => String(value ?? "").trim();
const colorKeyOf = (value) => text(value).toLowerCase().replace(/\s+/g, "-") || "default";
const firstImage = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = value.map(text).find(Boolean);
      if (found) return found;
    } else if (text(value)) {
      return text(value);
    }
  }
  return "";
};

/** "سيرية 6 قطع · كرتونة 24 قطعة · قطعة" — the ways this model is sold, biggest first. */
export const wholesaleUnitsLine = (raw = {}) => {
  const settings = normalizeSettings(raw);
  const parts = [];
  if (settings.sell_carton && settings.carton_pieces) parts.push(unitLabel("carton", settings));
  if (settings.sell_series && settings.series_pieces) parts.push(unitLabel("series", settings));
  if (settings.sell_dozen) parts.push(unitLabel("dozen", settings));
  if (settings.sell_piece) parts.push(unitLabel("piece", settings));
  return parts.join(" · ");
};

/** The wholesale number, for the post's order button ("" = no button). */
export const wholesaleOrderPhone = async ({ tenantId }) => {
  await ensureWholesaleSchema();
  const { rows: [row] } = await db.query("SELECT order_whatsapp FROM wholesale_settings WHERE tenant_id = $1", [tenantId]);
  return text(row?.order_whatsapp) || text(process.env.WHATSAPP_NUMBER);
};

export const setWholesaleOrderPhone = async ({ tenantId, phone }) => {
  await ensureWholesaleSchema();
  const value = text(phone).replace(/[^\d+]/g, "").slice(0, 20);
  await db.query(
    `INSERT INTO wholesale_settings (tenant_id, order_whatsapp, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET order_whatsapp = EXCLUDED.order_whatsapp, updated_at = NOW()`,
    [tenantId, value]
  );
  return { order_whatsapp: value };
};

/** wa.me wants the international number without "+": 010... -> 2010... */
export const waNumber = (phone) => {
  let digits = text(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `2${digits}`;
  return digits;
};

export const wholesaleOrderButton = ({ facts = {}, phone = "" } = {}) => {
  const number = waNumber(phone);
  if (!number) return null;
  const message = ["عايز أطلب جملة:", [facts.name, facts.color].filter(Boolean).join(" - "), facts.code ? `كود ${facts.code}` : ""]
    .filter(Boolean)
    .join("\n");
  return { inline_keyboard: [[{ text: "اطلب جملة على واتساب", url: `https://wa.me/${number}?text=${encodeURIComponent(message)}` }]] };
};

/**
 * One card per model colour with stock, shaped like the storefront listing card the publisher
 * already reads, plus the units and the pieces available. No storefront visibility here:
 * the wholesale copy has no shop window, so every active model with stock is offered.
 */
export const buildWholesaleTelegramCards = async ({ tenantId, audience = "" } = {}) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.slug, p.product_type, p.grade, p.brand, p.gender, p.product_code, v.created_at,
            p.image_url AS product_image, p.image AS product_image_alt, p.gallery_images,
            v.color, v.size, GREATEST(COALESCE(v.stock, 0), 0) AS stock, v.article_code, v.audience,
            COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, '')) AS variant_image,
            w.sell_piece, w.sell_series, w.series_pieces, w.sell_carton, w.carton_pieces, w.sell_dozen
       FROM products p
       JOIN product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL AND COALESCE(v.is_active, TRUE)
       LEFT JOIN wholesale_product_packs w ON w.tenant_id = p.tenant_id AND w.product_id = p.id
      WHERE p.tenant_id = $1
        AND COALESCE(p.is_active, TRUE)
        AND COALESCE(p.status, 'active') NOT IN ('deleted', 'archived', 'draft', 'inactive')
      ORDER BY p.id, v.color_sort_order NULLS LAST, v.id`,
    [tenantId]
  );
  const wanted = text(audience).toLowerCase();
  const cards = new Map();
  for (const row of rows) {
    const gender = text(row.gender).toLowerCase();
    const variantAudience = text(row.audience).toLowerCase();
    if (wanted && gender !== wanted && variantAudience !== wanted) continue;
    const colorKey = colorKeyOf(row.color);
    const cardId = `${row.id}:${colorKey}`;
    let card = cards.get(cardId);
    if (!card) {
      card = {
        card_id: cardId,
        parent_product_id: Number(row.id),
        color_key: colorKey,
        name: row.name,
        display_color: text(row.color),
        sizes: [],
        slug: text(row.slug),
        product_type: text(row.product_type),
        grade: text(row.grade),
        brand_name: text(row.brand),
        gender: gender,
        article_code: text(row.article_code) || text(row.product_code),
        image_url: "",
        product_image_url: firstImage(row.product_image, row.product_image_alt),
        gallery_images: Array.isArray(row.gallery_images) ? row.gallery_images : [],
        created_at: row.created_at,
        wholesale_units: wholesaleUnitsLine(row.sell_piece === null || row.sell_piece === undefined ? { sell_piece: true } : row),
        wholesale_stock: 0,
      };
      cards.set(cardId, card);
    }
    const stock = Number(row.stock) || 0;
    card.wholesale_stock += stock;
    if (!card.image_url && row.variant_image) card.image_url = text(row.variant_image);
    const size = text(row.size);
    if (stock > 0 && size && !card.sizes.includes(size)) card.sizes.push(size);
  }
  return [...cards.values()].filter((card) => card.wholesale_stock > 0);
};
