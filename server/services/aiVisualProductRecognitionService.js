import fs from "node:fs/promises";
import path from "node:path";

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

const MIME_BY_EXTENSION = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/**
 * A customer photo the gateway saved under our own /uploads, read straight off this server's disk.
 *
 * Handing the vision model the public URL instead means OpenAI has to fetch
 * api.m1store-egy.com through Cloudflare, which is free to challenge a bot — and a refused fetch
 * reads as "no product in this picture". Every visual path that already works (the storefront
 * search, Messenger/Instagram) sends the bytes; this does the same whenever the file is ours.
 * Anything that is not a readable file inside ./uploads returns null and the URL is used as before.
 */
export const readLocalUploadImage = async (imageUrl = "", { root = process.cwd() } = {}) => {
  try {
    const { pathname } = new URL(text(imageUrl));
    if (!pathname.startsWith("/uploads/")) return null;
    const mimeType = MIME_BY_EXTENSION[path.extname(pathname).toLowerCase()];
    if (!mimeType) return null;
    const uploadsRoot = path.resolve(root, "uploads");
    const filePath = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    // The path comes from a URL: never let "..", an encoded slash or a symlink-looking segment
    // walk out of ./uploads.
    if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) return null;
    const buffer = await fs.readFile(filePath);
    return buffer.length ? { buffer, mimeType } : null;
  } catch {
    return null;
  }
};

/**
 * The closest products to offer when no single one is certain enough to name.
 *
 * Only products of the brand the photo was READ as (brandScore 1): the reading is what makes a
 * shortlist honest — six grey Skechers runners are a real "which one?", a Nike next to them is noise.
 * No brand read ⇒ no shortlist, and the caller holds and asks instead. One entry per product (the
 * index holds several images per product), best-scored first, and nothing below `minScore`.
 */
export const closestBrandCandidates = (topMatches = [], { max = 4, minScore = 0.3 } = {}) => {
  const seen = new Set();
  const picked = [];
  for (const match of asArray(topMatches)) {
    const productId = text(match?.product_id || match?.productId);
    const score = Number(match?.score ?? match?.finalScore ?? 0);
    if (!productId || seen.has(productId)) continue;
    if (Number(match?.score_breakdown?.brandScore || 0) < 1) continue;
    if (!(score >= minScore)) continue;
    seen.add(productId);
    picked.push({ product_id: productId, name: text(match?.product_name || match?.sourceTitle), color: text(match?.color), score });
    if (picked.length >= max) break;
  }
  return picked;
};

/**
 * Did the visual search NAME one product, or only narrow the photo down to look-alikes?
 *
 * A score over the floor is not, on its own, a name. LIVE 2026-09-11: a grey Skechers photo scored
 * 0.69 for "Skechers Running" on brand + colour + category alone — the model the photo was read as
 * matched no product (modelScore 0) — and it was presented as THE product. It was the wrong model:
 * the catalogue holds six grey Skechers runners and brand + colour cannot tell them apart. The owner
 * had already decided what that case gets: the closest models, to pick from.
 *
 * So one product is named only with evidence for the model itself — the index's own exact match
 * (same image, or a score it calls exact), or a score over the floor WITH the model matched.
 * Anything else returns a same-brand shortlist, wide enough (6) that the right look-alike is in it.
 */
export const decideVisualMatch = ({ search = null, minScore = MIN_RECOGNITION_SCORE } = {}) => {
  const best = search?.exactMatch || asArray(search?.topMatches)[0] || null;
  const score = Number(best?.score ?? best?.finalScore ?? 0);
  if (!best?.product_id) {
    return { accept: false, reason: search?.fallbackReason || "no_visual_match", best, score, candidates: [] };
  }
  if (search?.exactMatch) return { accept: true, reason: "visual_exact_inventory_match", best, score, candidates: [] };
  const modelNamed = Number(best?.score_breakdown?.modelScore || 0) >= 1;
  if (score >= minScore && modelNamed) return { accept: true, reason: "visual_close_match", best, score, candidates: [] };
  return {
    accept: false,
    reason: score < minScore ? "below_recognition_threshold" : "model_not_confirmed",
    best,
    score,
    candidates: closestBrandCandidates(search?.topMatches, { max: 6 }),
  };
};

// Words a vision reading puts in model_guess that name no model: the brand, the kind of shoe, its
// colour. "Adidas Terrex trail running shoe" names exactly one model word — Terrex.
const MODEL_GUESS_NOISE = new Set([
  "adidas", "nike", "jordan", "air", "puma", "reebok", "skechers", "crocs", "vans", "converse", "new", "balance",
  "asics", "fila", "lacoste", "north", "face", "the", "timberland", "salomon", "brand", "unknown", "model", "style",
  "shoe", "shoes", "sneaker", "sneakers", "trainer", "trainers", "boot", "boots", "running", "runner", "trail",
  "hiking", "outdoor", "sport", "sports", "casual", "lifestyle", "basketball", "low", "mid", "high", "top", "men",
  "mens", "women", "womens", "kids", "black", "white", "grey", "gray", "blue", "red", "green", "brown", "beige",
  "navy", "pink", "orange", "yellow", "purple", "olive", "khaki", "cream", "with", "and", "similar", "like",
]);

/**
 * The model names a photo was read as, longest first, ready to be looked up in product names.
 *
 * "Terrex Free Hiker" gives "terrex free hiker", "terrex free", "terrex": the catalogue may hold the
 * family under a different line name ("TERREX TRAILMAKER 2"), so the lookup walks back to the
 * family word. Brand, shoe-kind and colour words are dropped; a reading with no model word left
 * (or a model under 3 letters) gives nothing — a brand alone is not a model.
 */
export const visualModelNamePhrases = (detected = {}) => {
  const phrases = [];
  for (const guess of [detected?.model_guess, detected?.model_family, detected?.likely_model]) {
    const words = text(Array.isArray(guess) ? guess.join(" ") : guess)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word && !MODEL_GUESS_NOISE.has(word));
    if (!words.length || !/^[a-z][a-z0-9]{2,}$/.test(words[0])) continue;
    for (let length = Math.min(words.length, 4); length >= 1; length -= 1) {
      const phrase = words.slice(0, length).join(" ");
      if (!phrases.includes(phrase)) phrases.push(phrase);
    }
  }
  return phrases;
};

/**
 * The in-stock products whose NAME carries the model the photo was read as.
 *
 * The keyword half of photo recognition. The image index only names a product when the model is in
 * its small alias list or the photo is one of ours; a clearly read "Adidas Terrex" found nothing
 * (LIVE 2026-10-19) while seven Terrex pairs were in stock. The phrase is matched as whole words,
 * and only a product with a variant in stock counts, so "we have it" is never said about air.
 */
export const findStockedProductsNamingModel = async ({ tenantId, detected = {}, limit = 12 } = {}) => {
  for (const phrase of visualModelNamePhrases(detected)) {
    const result = await db.query(
      `SELECT p.id, p.name
       FROM products p
       WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
         -- products has no deleted_at (it is archived by status): the column made this query fail
         -- on every photo in production, so no photo ever named a stocked model.
         AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') = 'active'
         AND COALESCE(p.is_active, TRUE) = TRUE
         AND (
           lower(p.name) ~ ('(^|[^a-z0-9])' || $2 || '([^a-z0-9]|$)')
           -- "Ultraboost" read from a photo is "Ultra Boost" / "UltraBoost22" in the catalogue
           -- (LIVE 2026-10-19: a clear Ultraboost photo found nothing). Spacing-blind, but only
           -- for a long model name, so "air" never matches inside another word.
           OR (length($4) >= 6 AND regexp_replace(lower(p.name), '[^a-z0-9]+', '', 'g') LIKE '%' || $4 || '%')
         )
         AND EXISTS (
           SELECT 1 FROM product_variants v
           WHERE v.product_id = p.id
             AND v.deleted_at IS NULL
             AND COALESCE(v.is_active, TRUE) = TRUE
             AND COALESCE(v.stock, 0) > 0
         )
       ORDER BY p.id
       LIMIT $3`,
      [tenantId || null, phrase, limit, phrase.replace(/[^a-z0-9]+/g, "")]
    );
    if (result.rows.length) return { phrase, products: result.rows };
  }
  return null;
};

// What a photo sent with no words is asking. The customer's own wording when they do type it.
export const PHOTO_ONLY_CUSTOMER_QUESTION = "دا موجود؟";

/**
 * The text an uncaptioned WhatsApp PHOTO enters the auto-reply with, or "" for anything else.
 *
 * The gateway saves a caption-less photo as a media-only row and hands back `text: ""`, and the
 * webhook only called the auto-reply `if (normalized.text)` — so a photo alone was never answered
 * (LIVE 2026-10-19: two photos, no reply; the answer came only when the customer typed "دا موجود").
 * A photo alone IS that question. Voice notes, videos and stickers stay out, as do our own echoes.
 */
export const photoOnlyAutoReplyText = (normalized = {}) => {
  if (text(normalized?.text) || normalized?.fromMe === true) return "";
  if (normalized?.media_type !== "image" || normalized?.inbox?.reason !== "media_saved") return "";
  return firstInboundImageUrl(normalized?.visualAttachments || normalized?.visual_attachments) ? PHOTO_ONLY_CUSTOMER_QUESTION : "";
};

/**
 * What the customer is asking once the photo has been read as a model we stock: "عندكم terrex؟",
 * so the brain runs the same model search a typed name gets — grades split as cards. A real
 * caption rides along ("مقاس 42"); the placeholder and the photo-only question do not.
 */
export const visualModelQuestion = (modelQuery = "", caption = "") => {
  const model = text(modelQuery);
  if (!model) return "";
  const extra = text(caption);
  const bare = extra.replace(/[\s?؟.!]+$/u, "");
  const keep = extra
    && bare !== PHOTO_ONLY_CUSTOMER_QUESTION.replace(/؟$/u, "")
    && !/^[[(]?\s*(?:\u{1F4F7}\s*)?صور[ةه]\s*[\])]?$/u.test(bare);
  return `عندكم ${model}؟${keep ? ` ${extra}` : ""}`;
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

// No single product named: is the model the photo was read as one we stock under that name? Never
// throws — a failed lookup is just no model read, and the honest "can't tell" reply stands.
const modelReadFor = async ({ tenantId, understanding }) => {
  const read = await findStockedProductsNamingModel({ tenantId, detected: understanding?.detected || {} }).catch((error) => {
    console.warn("[ai-visual-recognition] model name lookup failed", { tenant_id: tenantId || null, message: error?.message || "lookup failed" });
    return null;
  });
  console.log("[ai-visual-recognition] model name lookup", {
    tenant_id: tenantId || null,
    model_guess: text(understanding?.detected?.model_guess),
    phrase: read?.phrase || "",
    product_ids: asArray(read?.products).map((row) => row.id),
  });
  return read ? { modelQuery: read.phrase, modelProductIds: read.products.map((row) => row.id) } : {};
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

  // Bytes first: a file we already hold never depends on anyone fetching it back through the CDN.
  const localImage = imageBuffer ? null : await readLocalUploadImage(safeImageUrl);
  const effectiveBuffer = imageBuffer || localImage?.buffer || null;
  const effectiveMime = mimeType || localImage?.mimeType || "";
  console.log("[ai-visual-recognition] image source", {
    tenant_id: tenantId || null,
    source: imageBuffer ? "caller_buffer" : localImage ? "local_upload" : "remote_url",
    bytes: effectiveBuffer?.length || 0,
  });

  let understanding;
  try {
    understanding = await understandProductImageForSearch({
      imageBuffer: effectiveBuffer || undefined,
      mimeType: effectiveMime || undefined,
      // buildVisionImageInput prefers a URL whenever one is passed, so hand it the URL only when
      // there are no bytes to send.
      imageUrl: effectiveBuffer ? "" : safeImageUrl,
      requestId: requestId || `visual-recognition:${Date.now()}`,
      // Every caller of this is a customer chat (WhatsApp, the AI inbox) — read by OpenAI first.
      chat: true,
    });
  } catch (error) {
    console.warn("[ai-visual-recognition] vision understanding failed", {
      tenant_id: tenantId || null,
      message: error?.message || "vision failed",
    });
    return { matched: false, reason: "vision_failed" };
  }

  const visualQuery = visualQueryFromUnderstanding(understanding) || text(messageText);
  if (!visualQuery) {
    // The vision helper does not throw when the provider refuses — it hands back an empty reading
    // with the provider's error attached. Report THAT, not "nothing in the picture": the first live
    // miss read `no_visual_signal` while the real cause was OpenAI `insufficient_quota`.
    const visionError = text(understanding?.openai_error?.code || understanding?.error || "");
    return { matched: false, reason: visionError ? `vision_unavailable:${visionError}` : "no_visual_signal", understanding };
  }

  let search;
  try {
    search = await searchAiVisualProductsPro({
      tenantId,
      detected: understanding?.detected || {},
      visualQuery,
      uploadedImageUrl: safeImageUrl,
      uploadedImageBuffer: effectiveBuffer,
      // Wider than the default 8: those are image rows, several per product, and a shortlist of
      // look-alikes needs enough distinct products to choose from.
      limit: 24,
    });
  } catch (error) {
    console.warn("[ai-visual-recognition] indexed search failed", {
      tenant_id: tenantId || null,
      message: error?.message || "indexed search failed",
    });
    return { matched: false, reason: "visual_index_error", understanding, visualQuery, ...(await modelReadFor({ tenantId, understanding })) };
  }

  const decision = decideVisualMatch({ search, minScore });
  const { best, score } = decision;
  console.log("[ai-visual-recognition] match", {
    tenant_id: tenantId || null,
    visual_query: visualQuery,
    searched_indexed_images: search?.searchedCount || 0,
    product_id: best?.product_id || null,
    color: best?.color || "",
    score,
    min_score: minScore,
    exact: Boolean(search?.exactMatch),
    model_named: Number(best?.score_breakdown?.modelScore || 0) >= 1,
    decision: decision.reason,
    shortlist: decision.candidates.map((item) => ({ product_id: item.product_id, score: Math.round(item.score * 1000) / 1000 })),
  });
  if (!decision.accept) {
    return {
      matched: false,
      reason: decision.reason,
      score,
      candidates: decision.candidates,
      understanding,
      visualQuery,
      search,
      ...(await modelReadFor({ tenantId, understanding })),
    };
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
    return { matched: false, reason: "recognised_product_has_no_sendable_card", productId: best.product_id, understanding, visualQuery, search, ...(await modelReadFor({ tenantId, understanding })) };
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
    reason: decision.reason,
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
