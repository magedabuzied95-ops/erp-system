import fs from "node:fs/promises";
import path from "node:path";

import db from "../database/db.js";
import { normalizeProductCards } from "./aiProductCards.js";
import { expandProductCardsByColor } from "./aiProductColorCarouselService.js";
import sharp from "sharp";

import { pickSameShoeAmongCandidates, understandProductImageForSearch } from "./openaiSupportService.js";
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
 * Is the stocked product the model line the photo was read as, word for word? "Terrex Two Gore"
 * read and "Adidas Terrex Two Gore" stocked: yes. Only the family word ("Terrex") read: we cannot
 * tell the lines apart from the name, so it is the closest, and the reply says so.
 */
export const productIsReadModelLine = (detected = {}, productName = "") => {
  const name = text(productName).toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const longest = visualModelNamePhrases(detected)[0] || "";
  const words = longest.split(" ").filter(Boolean);
  if (words.length < 2) return false;
  return words.every((word) => new RegExp(`(^| )${word}( |$)`).test(name));
};

/**
 * One product out of the family the photo named: the one the indexed search ranks closest (colour,
 * shape, the photo itself), restricted to the products carrying the model name. Null when none of
 * them can be ranked — the caller then falls back to the family search.
 */
const pickModelFromFamily = async ({ tenantId, modelRead = {}, search = null, understanding = null, visualQuery = "", imageUrl = "", imageBuffer = null }) => {
  const familyIds = asArray(modelRead?.modelProductIds).map((id) => String(id));
  if (!familyIds.length) return null;
  let best = asArray(search?.topMatches).find((match) => familyIds.includes(String(match?.product_id)));
  if (!best) {
    const scoped = await searchAiVisualProductsPro({
      tenantId,
      detected: understanding?.detected || {},
      visualQuery,
      uploadedImageUrl: imageUrl,
      uploadedImageBuffer: imageBuffer,
      limit: 24,
      onlyProductIds: familyIds,
    }).catch(() => null);
    best = asArray(scoped?.topMatches)[0];
  }
  if (!best?.product_id) return null;
  const productCards = await cardsForRecognisedProduct({ tenantId, productId: best.product_id, leadColor: text(best.color) }).catch(() => []);
  if (!productCards.length) return null;
  const sameLine = productIsReadModelLine(understanding?.detected || {}, best.product_name || best.sourceTitle || productCards[0]?.name);
  console.log("[ai-visual-recognition] family pick", {
    tenant_id: tenantId || null,
    family: modelRead?.modelQuery || "",
    family_size: familyIds.length,
    product_id: best.product_id,
    color: text(best.color),
    same_line: sameLine,
  });
  return {
    matched: true,
    reason: sameLine ? "model_line_match" : "model_family_closest",
    closest: !sameLine,
    productId: best.product_id,
    matchedColor: text(best.color),
    score: Number(best.score ?? best.finalScore ?? 0),
    productCards,
  };
};

// A small JPEG data URL of a picture, so a low-detail comparison sends little and never depends on
// anyone fetching our own /uploads back through the CDN.
const thumbnailDataUrl = async ({ buffer = null, url = "", edge = 384 } = {}) => {
  try {
    const source = buffer || (await readLocalUploadImage(url))?.buffer || null;
    if (!source) return /^https?:\/\//i.test(text(url)) ? text(url) : "";
    const jpeg = await sharp(source, { animated: false }).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return /^https?:\/\//i.test(text(url)) ? text(url) : "";
  }
};

/**
 * The candidate product photos to show next to the customer's: one per product + colour, at most 8.
 * The family the photo was read as when there is one ("terrex": its own pairs, re-searched inside
 * the family when the global list missed them), otherwise the same-brand look-alikes.
 */
export const photoCandidatePool = (rows = [], { familyIds = [], max = 8 } = {}) => {
  const family = new Set(asArray(familyIds).map((id) => String(id)));
  const seen = new Set();
  const picked = [];
  for (const row of asArray(rows)) {
    const productId = text(row?.product_id || row?.productId);
    const imageUrl = text(row?.image_url || row?.imageUrl);
    if (!productId || !imageUrl) continue;
    if (family.size ? !family.has(productId) : Number(row?.score_breakdown?.brandScore || 0) < 1) continue;
    const key = `${productId}:${text(row?.color).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(row);
    if (picked.length >= max) break;
  }
  return picked;
};

// Colour words a catalogue colour name or a description of the customer's shoe can carry, each
// mapped to one family (catalogue spellings included: "Bige", "Blak", "Baige", "D.Gray").
const COLOUR_FAMILIES = [
  ["white", /(white|ابيض|أبيض|offwhite|ivory)/],
  ["black", /(black|blak|اسود|أسود)/],
  ["grey", /(grey|gray|رمادي|رصاصي|dgray|charcoal)/],
  ["beige", /(beige|bige|baige|cream|bone|sand|تان|بيج|كريمي|camel|tan)/],
  ["brown", /(brown|بني|chocolate|mocha)/],
  ["silver", /(silver|metallic|فضي)/],
  ["navy", /(navy|كحلي)/],
  ["blue", /(blue|ازرق|أزرق|sky)/],
  ["red", /(red|احمر|أحمر|burgundy|maroon|نبيتي)/],
  ["green", /(green|olive|mint|اخضر|أخضر|زيتي)/],
  ["pink", /(pink|بمبي|وردي|mauve)/],
  ["yellow", /(yellow|اصفر|أصفر|orange|برتقالي)/],
  ["purple", /(purple|بنفسجي|lilac)/],
];
export const colourFamiliesIn = (value = "") => {
  const words = text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  return new Set(COLOUR_FAMILIES.filter(([, pattern]) => pattern.test(words)).map(([family]) => family));
};

/**
 * Which of the chosen product's colours is the one in the photo: the card whose colour name shares
 * the most colour families with what the customer's shoe was seen as (the judge's description and
 * the vision reading). LIVE 2026-10-20 a white-and-black Superstar was answered with the Brown
 * colourway of the right model. Empty when no card is a clearly better fit than `current`.
 */
export const bestColourForPhoto = (cards = [], seenAs = "", current = "") => {
  const seen = colourFamiliesIn(seenAs);
  if (!seen.size) return "";
  const score = (name) => {
    const families = colourFamiliesIn(name);
    let shared = 0;
    for (const family of families) if (seen.has(family)) shared += 1;
    return shared * 2 - (families.size - shared);
  };
  let best = "";
  let bestScore = score(current);
  for (const card of asArray(cards)) {
    const name = text(card?.color || card?.matched_variant_color);
    const value = score(name);
    if (name && value > bestScore) {
      best = name;
      bestScore = value;
    }
  }
  return best;
};

// What the reply may say about the pick: the same shoe in the same colour, the same model in other
// colours, or only the closest we have.
export const photoMatchKind = (pick = {}) =>
  pick?.sameModel ? (pick?.sameColor ? "same" : "same_model_other_color") : "closest";

/**
 * The customer's photo next to the candidates' own product photos (OpenAI picks the same shoe, or
 * the closest, or none). Null when the comparison could not run — the caller keeps the text ranking.
 */
/**
 * One candidate list from several sources, in order of trust: the shape-nearest images (CLIP), then
 * the family the photo was read as, then the same-brand look-alikes. One per product + colour.
 */
export const mergeCandidatePools = (lists = [], max = 12) => {
  const seen = new Set();
  const merged = [];
  for (const list of asArray(lists)) {
    for (const row of asArray(list)) {
      const productId = text(row?.product_id || row?.productId);
      const imageUrl = text(row?.image_url || row?.imageUrl);
      if (!productId || !imageUrl) continue;
      const key = `${productId}:${text(row?.color).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= max) return merged;
    }
  }
  return merged;
};

// Pieces built in parallel (2026-10-19): a missing module just means that layer is skipped.
const optionalModule = async (specifier) => import(specifier).catch(() => null);

const shapeNearestRows = async ({ tenantId, imageBuffer }) => {
  if (!imageBuffer) return [];
  const service = await optionalModule("./visualEmbeddingSearchService.js");
  if (typeof service?.findNearestProductImages !== "function") return [];
  const rows = await service.findNearestProductImages({ tenantId, imageBuffer, limit: 15, onlyInStock: true }).catch((error) => {
    console.warn("[ai-visual-recognition] shape search failed", { tenant_id: tenantId || null, message: error?.message });
    return [];
  });
  return asArray(rows);
};

// The shoe cut out of a busy screenshot (feet, floor, captions); the original when that cannot be done.
export const cropForMatching = async ({ imageBuffer = null, box = null } = {}) => {
  if (!imageBuffer) return { buffer: imageBuffer, cropped: false };
  const crop = await optionalModule("../lib/shoeCrop.js");
  if (typeof crop?.cropShoeFromPhoto !== "function") return { buffer: imageBuffer, cropped: false };
  const result = await Promise.resolve(crop.cropShoeFromPhoto(imageBuffer, { box })).catch(() => null);
  if (!result?.buffer?.length || !result.cropped) return { buffer: imageBuffer, cropped: false };
  // Whatever format the crop came back in, hand the vision call a JPEG it can name.
  const jpeg = await sharp(result.buffer).jpeg({ quality: 88 }).toBuffer().catch(() => null);
  return jpeg ? { buffer: jpeg, cropped: true, box: result.box || null, mimeType: "image/jpeg" } : { buffer: imageBuffer, cropped: false };
};

const pickByComparingPhotos = async ({ tenantId, search = null, modelRead = {}, understanding = null, visualQuery = "", imageUrl = "", imageBuffer = null, requestId = "", shapeRows = [] }) => {
  const familyIds = asArray(modelRead?.modelProductIds).map((id) => String(id));
  // Shape-nearest first (CLIP is what tells colourways and lines apart), but always room for the
  // read family and the brand look-alikes too.
  let pool = mergeCandidatePools([asArray(shapeRows).slice(0, 10), photoCandidatePool(search?.topMatches, { familyIds }).slice(0, 6)], 16);
  if (familyIds.length && pool.length < 2) {
    const scoped = await searchAiVisualProductsPro({
      tenantId,
      detected: understanding?.detected || {},
      visualQuery,
      uploadedImageUrl: imageUrl,
      uploadedImageBuffer: imageBuffer,
      limit: 24,
      onlyProductIds: familyIds,
    }).catch(() => null);
    pool = mergeCandidatePools([asArray(shapeRows).slice(0, 10), photoCandidatePool(scoped?.topMatches, { familyIds }).slice(0, 6)], 16);
  }
  if (!pool.length) return null;
  const [customerImage, ...candidateImages] = await Promise.all([
    thumbnailDataUrl({ buffer: imageBuffer, url: imageUrl, edge: 512 }),
    ...pool.map((row) => thumbnailDataUrl({ url: row.image_url || row.imageUrl })),
  ]);
  const usable = pool.map((row, index) => ({ row, image: candidateImages[index] })).filter((item) => item.image);
  if (!customerImage || !usable.length) return null;
  const pick = await pickSameShoeAmongCandidates({
    customerImage,
    candidateImages: usable.map((item) => item.image),
    candidateLabels: usable.map((item) => [text(item.row.product_name || item.row.sourceTitle), text(item.row.color) && `colour: ${text(item.row.color)}`].filter(Boolean).join(" — ")),
    requestId,
  });
  if (!pick) return null;
  if (pick.index < 0) return { matched: false, reason: "photo_compare_no_match" };
  const chosen = usable[pick.index].row;
  let productCards = await cardsForRecognisedProduct({ tenantId, productId: chosen.product_id, leadColor: text(chosen.color) }).catch(() => []);
  if (!productCards.length) return null;
  // The right model with the wrong colourway in front: put the colour the photo shows first.
  const seenAs = [pick.customerShoe, ...asArray(understanding?.detected?.colors), ...asArray(understanding?.detected?.secondary_colors)].join(" ");
  const betterColour = bestColourForPhoto(productCards, seenAs, text(chosen.color));
  let leadColour = text(chosen.color);
  if (betterColour) {
    leadColour = betterColour;
    const rebuilt = await cardsForRecognisedProduct({ tenantId, productId: chosen.product_id, leadColor: betterColour }).catch(() => []);
    if (rebuilt.length) productCards = rebuilt;
  }
  // The lead colour now carries only colours the shoe was seen in: it IS the photographed colourway.
  const seenFamilies = colourFamiliesIn(seenAs);
  const leadFamilies = colourFamiliesIn(leadColour);
  const leadIsSeen = leadFamilies.size > 0 && [...leadFamilies].every((family) => seenFamilies.has(family));
  const photoMatch = photoMatchKind({ ...pick, sameColor: pick.sameColor || (pick.sameModel && leadIsSeen) });
  console.log("[ai-visual-recognition] photo comparison pick", {
    tenant_id: tenantId || null,
    candidates: usable.length,
    family: modelRead?.modelQuery || "",
    product_id: chosen.product_id,
    color: text(chosen.color),
    lead_colour: leadColour,
    seen_as: text(pick.customerShoe).slice(0, 120),
    photo_match: photoMatch,
    confidence: pick.confidence,
  });
  return {
    matched: true,
    reason: `photo_compare_${photoMatch}`,
    photoMatch,
    closest: photoMatch === "closest",
    productId: chosen.product_id,
    matchedColor: leadColour,
    score: pick.confidence,
    productCards,
  };
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

  // Screenshots from other pages and videos: match the shoe, not the feet and captions. The vision
  // reading already returns the shoe's box, so the crop normally comes from it (milliseconds); the
  // on-server segmenter costs 6-8s a photo on this CPU (LIVE 2026-10-20) and is opt-in only.
  let matchCrop = { buffer: effectiveBuffer, cropped: false };
  if (["1", "true", "yes", "on"].includes(text(process.env.AI_VISUAL_SEGMENT_CROP).toLowerCase())) {
    matchCrop = { ...(await cropForMatching({ imageBuffer: effectiveBuffer })), segmenterTried: true };
  }

  let understanding;
  try {
    understanding = await understandProductImageForSearch({
      imageBuffer: matchCrop.buffer || effectiveBuffer || undefined,
      // buildVisionImageInput prefers a URL whenever one is passed, so hand it the URL only when
      // there are no bytes to send.
      imageUrl: effectiveBuffer ? "" : safeImageUrl,
      mimeType: matchCrop.cropped ? matchCrop.mimeType : effectiveMime || undefined,
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
  // The owner (2026-10-19): look at the candidates' own photos and pick the same model and colour,
  // or the closest and say it is the closest. The keyword ranking above cannot see shape or colour
  // — a white Terrex went to a black-and-grey line, a white/black Superstar led with burgundy.
  // The reading may carry the shoe's box when the segmenter could not find it.
  const readBox = understanding?.detected?.shoe_box || understanding?.shoe_box || null;
  // Measured 2026-10-20 on the owner's photos: the reading's box is too rough to crop by (it cut
  // shoes in half), so it is used only when the segmenter is switched on and found nothing.
  if (matchCrop.segmenterTried && !matchCrop.cropped && readBox) matchCrop = await cropForMatching({ imageBuffer: effectiveBuffer, box: readBox });
  if (matchCrop.cropped) console.log("[ai-visual-recognition] shoe cropped", { tenant_id: tenantId || null, box: matchCrop.box || null });
  const [readForCompare, shapeRows] = await Promise.all([
    modelReadFor({ tenantId, understanding }),
    shapeNearestRows({ tenantId, imageBuffer: matchCrop.buffer || effectiveBuffer }),
  ]);
  if (shapeRows.length) {
    console.log("[ai-visual-recognition] shape nearest", {
      tenant_id: tenantId || null,
      top: shapeRows.slice(0, 5).map((row) => ({ product_id: row.product_id, color: row.color, similarity: Math.round(Number(row.similarity || 0) * 1000) / 1000 })),
    });
  }
  const compared = await pickByComparingPhotos({
    tenantId,
    search,
    modelRead: readForCompare,
    understanding,
    visualQuery,
    imageUrl: safeImageUrl,
    imageBuffer: matchCrop.buffer || effectiveBuffer,
    requestId,
    shapeRows,
  });
  if (compared?.matched) return { ...compared, understanding, visualQuery, search, ...readForCompare };
  // Compared and nothing in the shop looks like it: an honest no-match, never the whole family.
  if (compared) return { matched: false, reason: compared.reason, score, candidates: [], understanding, visualQuery, search };

  if (!decision.accept) {
    const modelRead = readForCompare;
    // The photo was read as a model family we stock ("Terrex": seven pairs). The owner: show THE
    // model in the photo, and if it is not the same, the closest one — said as the closest — not
    // every Terrex in the shop (LIVE 2026-10-19, 18 cards for one photo).
    const familyPick = await pickModelFromFamily({
      tenantId,
      modelRead,
      search,
      understanding,
      visualQuery,
      imageUrl: safeImageUrl,
      imageBuffer: effectiveBuffer,
    });
    if (familyPick) return { ...familyPick, understanding, visualQuery, search, ...modelRead };
    return {
      matched: false,
      reason: decision.reason,
      score,
      candidates: decision.candidates,
      understanding,
      visualQuery,
      search,
      ...modelRead,
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
