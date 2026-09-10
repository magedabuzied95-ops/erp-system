import db from "../database/db.js";
import { normalizeProductCards } from "./aiProductCards.js";
import { ensureSquareCardImageUrl } from "./productImageVariantService.js";

const text = (value = "") => String(value ?? "").trim();
const normalizeColorKey = (value = "") => text(value).toLowerCase().replace(/\s+/g, " ");

// ── One card per colour, expanded SERVER-side ────────────────────────────────────────────────
// The AI Inbox frontend sends one HTTP request per picked product (Phase 13.4 FE-sequential), so
// the adapter's carousel branch never saw two cards and every send left as a single image — which
// is exactly how the first live attempt went out. The expansion has to happen here, where the
// whole catalog row is one query away: a product with two or more available colour groups swells
// into the colour cards aiProductCards already knows how to build (photo, per-variant price,
// sizes, variant_id), and the adapter then carries them as one swipeable carousel. A product with
// one colour — or any failure — keeps the original single card; expansion is an upgrade, never a
// new reason a card fails to send.
//
// `leadColor` names the colour the customer actually pointed at — the colour whose photo won the
// visual match. It sorts to the front so the carousel opens on the shoe in their picture and the
// other colours follow; without it the answer to "do you have this?" could open on a colour they
// never showed. Everything else about the expansion is identical for every caller.
export const expandProductCardsByColor = async ({ tenantId, cards = [], leadColor = "" } = {}) => {
  const expanded = [];
  // The per-colour price is resolved by the canonical authority, and that rule needs the GLOBAL
  // Sale Mode state — without it every card fails safe to the normal price and a running sale
  // would be quoted higher than POS charges.
  const { loadTenantSaleModeSettings } = await import("../utils/customerDisplayPrice.js");
  const saleModeSettings = await loadTenantSaleModeSettings({ tenantId }).catch(() => ({ sale_mode_enabled: false }));
  for (const card of cards) {
    const productId = Number(card?.product_id || card?.id || 0);
    if (!Number.isFinite(productId) || productId <= 0) {
      expanded.push(card);
      continue;
    }
    try {
      const productResult = await db.query(
        `SELECT * FROM products WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) LIMIT 1`,
        [productId, tenantId || null]
      );
      const product = productResult.rows[0];
      if (!product) {
        expanded.push(card);
        continue;
      }
      // Select the RAW price columns and let the canonical resolver decide — never a fresh
      // COALESCE over them. The old `COALESCE(selling_price, price, regular_price) AS price`
      // never reached `purchase_selling_price`, which for a large part of the catalogue is the
      // ONLY normal price that exists (the purchase invoice sets it). Every colour card of such a
      // product carded with no price at all: live on Instagram 2026-08-30, product 764 priced 850
      // on each variant's purchase_selling_price, and the server's own
      // `stage=product_cards_built { cardsWithMissingPrice: 4 }` said so. Precedence lives in
      // src/shared/lib/currentSellingPrice.js (manual override → purchase_selling_price → legacy,
      // variant before product) and normalizeProductCards reaches it through
      // resolveCustomerDisplayPrice — but only if the row actually carries the columns.
      const variantsResult = await db.query(
        `SELECT id, color, size, stock,
                manual_price_override_active, manual_selling_price, purchase_selling_price,
                selling_price, price, regular_price, sale_price, sale_price_enabled,
                image_url, is_active
         FROM product_variants
         WHERE product_id = $1 AND COALESCE(is_active, TRUE) IS DISTINCT FROM FALSE AND deleted_at IS NULL`,
        [productId]
      );
      const colorCards = normalizeProductCards(
        [{ ...product, variants: variantsResult.rows, storefront_url: card.storefront_url || card.product_url || "" }],
        { limit: 30, saleModeSettings }
      );
      if (colorCards.length >= 2) {
        const leadKey = normalizeColorKey(leadColor);
        const ordered = leadKey
          ? [...colorCards].sort((left, right) => {
            const leftLead = normalizeColorKey(left.color || left.matched_variant_color || "") === leadKey ? 0 : 1;
            const rightLead = normalizeColorKey(right.color || right.matched_variant_color || "") === leadKey ? 0 : 1;
            return leftLead - rightLead;
          })
          : colorCards;
        for (const colorCard of ordered) {
          // colorCard is already ONE flat card for one colour. Spreading `...card` (the enriched
          // parent) would re-attach the product's full `variants` array, and the adapter re-runs
          // normalizeProductCards on every card it sends — so each colour card would expand AGAIN
          // into all colours: duplicated photos, inflated counts, and the overflow spilling out as
          // loose images after the carousel. Carry only the flat colour card plus the parent's URL.
          const { variants, variant, product, matched_variant, selected_variant, ...flatCard } = colorCard;
          // Put the photo on a padded white square so a square carousel frame (WhatsApp and
          // Messenger both crop to the frame) shows the whole product instead of a tall centre-crop.
          // A non-local or already-squared image passes through unchanged.
          const rawImage = String(flatCard.image_url || flatCard.image || "").trim();
          const squared = rawImage ? await ensureSquareCardImageUrl(rawImage).catch(() => "") : "";
          expanded.push({
            ...flatCard,
            image_url: squared || flatCard.image_url,
            product_id: colorCard.product_id || card.product_id || card.id,
            storefront_url: colorCard.storefront_url || card.storefront_url || card.product_url || "",
            product_url: colorCard.product_url || card.product_url || card.storefront_url || "",
          });
        }
        console.info("[ai-inbox][product-card-send] expanded to colour cards", {
          product_id: productId,
          colors: colorCards.length,
          lead_color: leadColor || "",
        });
      } else {
        expanded.push(card);
      }
    } catch (expandError) {
      console.warn("[ai-inbox][product-card-send] colour expansion failed; sending the single card", {
        product_id: productId,
        message: expandError?.message || String(expandError),
      });
      expanded.push(card);
    }
  }
  // Evolution's carousel caps at 10 cards; the adapter chunks, but a runaway expansion of a
  // multi-product batch should not multiply into dozens of cards from one click.
  // Chunked into 10-card carousels downstream, so more than 10 colours simply means more carousels.
  return expanded.slice(0, 30);
};

export default { expandProductCardsByColor };
