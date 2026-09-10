import db from "../database/db.js";
import { normalizeProductCards } from "./aiProductCards.js";
import { expandProductCardsByColor } from "./aiProductColorCarouselService.js";
import { understandProductImageForSearch } from "./openaiSupportService.js";
import { searchAiVisualProductsPro } from "./aiVisualSearchProService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// Below this the match is a guess, not a recognition, and a guess sent as "here is your product"
// is worse than asking. The Meta path already runs its own strict gate before it cards anything;
// this is the floor for the channels that call the recogniser directly.
const MIN_RECOGNITION_SCORE = Number(process.env.AI_VISUAL_RECOGNITION_MIN_SCORE || 0.62);

const IMAGE_ATTACHMENT_TYPES = new Set(["image", "photo", "sticker"]);

/**
 * The image a customer actually sent, out of whatever shape the channel hands us.
 * Stickers are deliberately included: people screenshot a shoe and send it as one.
 */
export const firstInboundImageUrl = (attachments = []) => {
  for (const attachment of asArray(attachments)) {
    const type = text(attachment?.type || attachment?.media_type || "").toLowerCase();
    const mime = text(attachment?.mime_type || attachment?.mimeType || "").toLowerCase();
    const url = text(attachment?.url || attachment?.media_url || attachment?.image_url || "");
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (IMAGE_ATTACHMENT_TYPES.has(type) || mime.startsWith("image/")) return url;
  }
  return "";
};

const visualQueryFromUnderstanding = (understanding = {}) =>
  [
    understanding?.detected?.brand_guess,
    understanding?.detected?.model_guess,
    understanding?.detected?.model_family,
    understanding?.detected?.product_type,
    understanding?.detected?.category,
    understanding?.detected?.colors,
    understanding?.detected?.main_colors,
    understanding?.detected?.silhouette,
    understanding?.detected?.sole_shape,
    understanding?.detected?.materials,
    understanding?.detected?.features,
  ].flat().filter(Boolean).map(text).filter(Boolean).join(" ");

// One approved product, rebuilt from the catalog row so the card carries the raw price columns the
// canonical resolver needs. `expandProductCardsByColor` then does the colour work — including the
// square-image padding and the flattening that stops a colour card from re-expanding downstream.
const cardsForRecognisedProduct = async ({ tenantId, productId, leadColor = "" }) => {
  const productResult = await db.query(
    `SELECT * FROM products WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) LIMIT 1`,
    [productId, tenantId || null]
  );
  const product = productResult.rows[0];
  if (!product) return [];
  const variantsResult = await db.query(
    `SELECT id, color, size, stock,
            manual_price_override_active, manual_selling_price, purchase_selling_price,
            selling_price, price, regular_price, sale_price, sale_price_enabled,
            image_url, is_active
     FROM product_variants
     WHERE product_id = $1 AND COALESCE(is_active, TRUE) IS DISTINCT FROM FALSE AND deleted_at IS NULL`,
    [productId]
  );
  const baseCards = normalizeProductCards([{ ...product, variants: variantsResult.rows }], { limit: 1 });
  if (!baseCards.length) return [];
  // A single-colour product legitimately answers with one card; the expander returns the card it
  // was given in that case, which is already the correct one.
  return expandProductCardsByColor({ tenantId, cards: baseCards, leadColor });
};

/**
 * Recognise the product in a customer's photo and return it as colour cards.
 *
 * This is the channel-agnostic half of "customer sends a picture, we answer with the product":
 * understand the image, match it against the indexed product photos, and rebuild the winning
 * product as one card per colour, the photographed colour first. Every card carries its own
 * photo, its own per-colour price and its own available sizes, so the channel adapter can lay
 * them out as a carousel without knowing anything about vision.
 *
 * It never throws: a channel that cannot recognise a photo must still answer the customer, so
 * every failure comes back as `{ matched: false, reason }` for the caller to fall through on.
 */
export const recogniseProductFromImage = async ({
  tenantId,
  imageUrl = "",
  imageBuffer = null,
  mimeType = "",
  messageText = "",
  requestId = "",
  minScore = MIN_RECOGNITION_SCORE,
} = {}) => {
  const safeImageUrl = text(imageUrl);
  if (!safeImageUrl && !imageBuffer) return { matched: false, reason: "missing_image" };

  let understanding;
  try {
    understanding = await understandProductImageForSearch({
      imageBuffer: imageBuffer || undefined,
      mimeType: mimeType || undefined,
      imageUrl: safeImageUrl,
      requestId: requestId || `visual-recognition:${Date.now()}`,
    });
  } catch (error) {
    console.warn("[ai-visual-recognition] vision understanding failed", {
      tenant_id: tenantId || null,
      message: error?.message || "vision failed",
    });
    return { matched: false, reason: "vision_failed" };
  }

  const visualQuery = visualQueryFromUnderstanding(understanding) || text(messageText);
  if (!visualQuery) return { matched: false, reason: "no_visual_signal", understanding };

  let search;
  try {
    search = await searchAiVisualProductsPro({
      tenantId,
      detected: understanding?.detected || {},
      visualQuery,
      uploadedImageUrl: safeImageUrl,
      uploadedImageBuffer: imageBuffer || null,
    });
  } catch (error) {
    console.warn("[ai-visual-recognition] indexed search failed", {
      tenant_id: tenantId || null,
      message: error?.message || "indexed search failed",
    });
    return { matched: false, reason: "visual_index_error", understanding, visualQuery };
  }

  const best = search?.exactMatch || asArray(search?.topMatches)[0] || null;
  const score = Number(best?.score || best?.finalScore || 0);
  console.log("[ai-visual-recognition] match", {
    tenant_id: tenantId || null,
    visual_query: visualQuery,
    searched_indexed_images: search?.searchedCount || 0,
    product_id: best?.product_id || null,
    color: best?.color || "",
    score,
    min_score: minScore,
    exact: Boolean(search?.exactMatch),
  });
  if (!best?.product_id) {
    return { matched: false, reason: search?.fallbackReason || "no_visual_match", understanding, visualQuery, search };
  }
  if (!search?.exactMatch && score < minScore) {
    return { matched: false, reason: "below_recognition_threshold", score, understanding, visualQuery, search };
  }

  const productCards = await cardsForRecognisedProduct({
    tenantId,
    productId: best.product_id,
    leadColor: text(best.color),
  }).catch((error) => {
    console.warn("[ai-visual-recognition] card build failed", {
      tenant_id: tenantId || null,
      product_id: best.product_id,
      message: error?.message || "card build failed",
    });
    return [];
  });
  if (!productCards.length) {
    return { matched: false, reason: "recognised_product_has_no_sendable_card", productId: best.product_id, understanding, visualQuery, search };
  }

  console.log("[ai-visual-recognition] colour cards built", {
    tenant_id: tenantId || null,
    product_id: best.product_id,
    lead_color: text(best.color),
    colors: productCards.length,
    sizes_per_color: productCards.map((card) => ({
      color: text(card.color || ""),
      sizes: asArray(card.sizes || card.available_sizes).length,
    })),
  });

  return {
    matched: true,
    reason: search?.exactMatch ? "visual_exact_inventory_match" : "visual_close_match",
    productId: best.product_id,
    matchedColor: text(best.color),
    score,
    productCards,
    understanding,
    visualQuery,
    search,
  };
};

export default { recogniseProductFromImage, firstInboundImageUrl };
