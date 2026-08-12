// AI Studio Phase 10.6 — AI Inbox intent accuracy + exact product/variant grounding.
// ---------------------------------------------------------------------------
// A DETERMINISTIC, failure-isolated gate that runs AFTER the existing brain composes an AI Inbox reply
// draft and BEFORE it is persisted. It fixes the Phase 10.5 failure class: a specific product request
// (e.g. "كروكس اسود مقاس 44") must never be answered with an incompatible product (Air Jordan), and an
// availability claim must never be made without exact-variant stock evidence. When the exact
// product/variant cannot be resolved, it returns a CLARIFICATION instead of a misleading answer.
//
// This is NOT a second brain and it never sends: it only corrects the draft text + product cards that the
// existing generateAiInboxReply already produced. It reuses canonical utilities (normalizeSalesText,
// normalizeProductTypeValue, getInventoryFacts) — no new taxonomies. Pure decision helpers are exported
// for testing with real catalog-shaped fixtures; the DB-touching orchestrator is failure-isolated.

import db from "../database/db.js";
import { normalizeSalesText } from "./aiSalesOrchestratorService.js";
import { normalizeProductTypeValue } from "./productClassificationsService.js";
// Phase 10.8 — reuse the EXISTING alias engine (a linguistic Arabic↔English map: جوردن→jordan, فور→4/four),
// NOT a hardcoded product list. Brand/model live in products.name on the canonical schema, so we resolve a
// free-text term to REAL catalog rows by expanding it and matching name — no new taxonomy, no famous-shoe list.
import { expandSearchAliasTerms, normalizeAliasText } from "./productAliasEngine.js";

// ---- Vocabulary (reuses the same aliases the orchestrator already uses; not a new giant taxonomy) ----
const COLOR_ALIASES = [
  ["black", ["black", "اسود", "بلاك"], "الأسود"],
  ["white", ["white", "ابيض", "وايت"], "الأبيض"],
  ["red", ["red", "احمر"], "الأحمر"],
  ["blue", ["blue", "ازرق", "بلو"], "الأزرق"],
  ["green", ["green", "اخضر", "جرين"], "الأخضر"],
  ["grey", ["gray", "grey", "رمادي", "جراي"], "الرمادي"],
  ["beige", ["beige", "بيج", "cream", "كريمي"], "البيج"],
  ["brown", ["brown", "بني"], "البني"],
  ["pink", ["pink", "بينك", "وردي", "روز"], "الوردي"],
  ["navy", ["navy", "كحلي"], "الكحلي"],
];
// Product-category terms → canonical product_type. Reuses normalizeProductTypeValue for the mapping.
const TYPE_TERMS = [
  ["كروكس", "crocs", "كروكس"], ["كروك", "crocs", "كروكس"], ["crocs", "crocs", "كروكس"], ["croc", "crocs", "كروكس"],
  ["شبشب", "slippers", "الشباشب"], ["slipper", "slippers", "الشباشب"], ["صندل", "slippers", "الصنادل"],
  ["شنطة", "bags", "الشنط"], ["شنط", "bags", "الشنط"], ["bag", "bags", "الشنط"], ["باج", "bags", "الشنط"],
  ["سنيكرز", "sneakers", "السنيكرز"], ["كوتشي", "sneakers", "الكوتشيات"], ["sneaker", "sneakers", "السنيكرز"],
];

const clean = (v) => normalizeSalesText(String(v || ""));

// Non-product noise stripped before a residual brand/model term is handed to the alias engine. These are
// greeting / availability / restock / price / size-keyword / stopword tokens — NOT product identity.
const STOPWORDS = new Set([
  "هل", "في", "فى", "من", "على", "عن", "مع", "انا", "انت", "احنا", "حضرتك", "يا", "لو", "سمحت", "ممكن",
  "عايز", "عاوز", "عايزه", "عاوزه", "محتاج", "محتاجه", "بدي", "اريد", "اطلب", "ابحث", "بدور", "دور",
  "عندكم", "عندك", "عندكو", "متوفر", "متوفره", "موجود", "موجوده", "فيه", "فيها", "available", "بتوفر", "بتتوفر", "هو", "هي",
  "السلام", "سلام", "عليكم", "وعليكم", "ورحمه", "الله", "اهلا", "اهلين", "ازيك", "ازيكم", "هاي", "هلو", "مرحبا",
  "صباح", "مساء", "الخير", "النور", "hello", "hi", "hey",
  "مقاس", "مقاسي", "المقاس", "size", "لون", "اللون", "الوان", "الالوان", "color", "colour",
  "بكام", "السعر", "سعر", "كام", "price", "الثمن",
  "بلغني", "بلغوني", "ابلغني", "لما", "تاني", "رجع", "نزل", "ينزل", "يتوفر", "يرجع", "ينزل",
  "شكرا", "تمام", "ok", "اوك", "please", "the", "a", "an", "do", "you", "have", "is", "there", "any", "of",
]);

// Phase 10.8 — expand a free-text brand/model term into meaningful matcher terms via the shared alias engine.
// Keeps only terms with a letter (drops bare numbers so a lone size/quantity can't cause a false name match).
export const buildBrandModelTerms = (term = "") =>
  expandSearchAliasTerms(term, { limit: 60 }).filter((t) => t && t.length >= 3 && /[a-z؀-ۿ]/.test(t));

// Score how SPECIFICALLY a product name matches the expanded terms. A multi-word phrase ("nike air max",
// "jordan 4") dominates a single token ("air", "jordan"); among equal word-counts the longer term wins. This
// is what lets an explicit model outrank a bare brand deterministically — no hardcoded model ranking table.
export const scoreBrandModelMatch = (productName = "", terms = []) => {
  const name = normalizeAliasText(productName);
  let best = { score: 0, matchedTerm: "" };
  if (!name) return best;
  for (const t of terms) {
    if (!t || !name.includes(t)) continue;
    const words = t.split(/\s+/).filter(Boolean).length;
    const score = words * 1000 + t.length;
    if (score > best.score) best = { score, matchedTerm: t };
  }
  return best;
};

// Rank catalog rows against a brand/model term and keep ONLY the most-specific tier (all rows sharing the top
// score). Single winner → variant grounding; several equally-specific rows → present/clarify; none → []. Pure.
export const rankBrandModelMatches = (term = "", products = []) => {
  const terms = buildBrandModelTerms(term);
  if (!terms.length) return [];
  const scored = products
    .map((p) => ({ product: p, ...scoreBrandModelMatch(p.name || p.title || p.product_name || "", terms) }))
    .filter((x) => x.score > 0);
  if (!scored.length) return [];
  const top = Math.max(...scored.map((x) => x.score));
  return scored
    .filter((x) => x.score === top)
    .map((x) => ({ ...x.product, _brandModelScore: x.score, _matchedTerm: x.matchedTerm }));
};

// ---- Pure: extract the customer's REQUESTED entities (deterministic; Arabic digits already normalized) ----
export const extractRequestedEntities = (message = "") => {
  const norm = clean(message);
  let productType = "", productTerm = "", typeLabel = "";
  for (const [term, type, label] of TYPE_TERMS) {
    if (norm.includes(clean(term))) { productType = normalizeProductTypeValue(type, type); productTerm = term; typeLabel = label; break; }
  }
  let color = "", colorLabel = "";
  for (const [c, aliases, label] of COLOR_ALIASES) {
    if (aliases.some((a) => norm.includes(clean(a)))) { color = c; colorLabel = label; break; }
  }
  // Size: prefer an explicit "مقاس <n>"/"size <n>", else a standalone plausible footwear size (20–50).
  const sizeExplicit = norm.match(/(?:مقاس|مقاسي|size)\s*[:#]?\s*(\d{2,3})/);
  const sizeStandalone = norm.match(/\b([2-5]\d)\b/);
  const size = sizeExplicit ? sizeExplicit[1] : (sizeStandalone ? sizeStandalone[1] : "");
  // "سلام" is embedded in "السلام" (no word boundary), so match greetings as substrings for Arabic and
  // with word boundaries for Latin (avoid matching "hi" inside other words).
  const hasGreeting = /سلام|اهلا|أهلا|ازيك|هاي|صباح|مساء|وعليكم/.test(norm) || /\b(hello|hi|hey)\b/.test(norm);
  const wantsAvailability = /(عندكم|عندك|متوفر|موجود|فيه|في\s|available|هل\s*في|بتوفر)/.test(norm);
  const wantsRestock = /(بلغني|بلغوني|ابلغني|نزل\s*تاني|رجع\s*تاني)/.test(norm) || /لما.*(ينزل|يتوفر|يرجع|ينزّل)/.test(norm);
  // Phase 10.8 — residual brand/model term: the message minus greeting/availability/size/color/stopwords.
  // Brand & model live in products.name (no products.brand/model column), so this is fed to the alias engine
  // to resolve real catalog rows by name. The matched SIZE token is dropped, but other digits (a model number
  // like the "4" in "Jordan 4") are preserved so an explicit model still resolves.
  const colorTokens = new Set(COLOR_ALIASES.flatMap(([, aliases]) => aliases.map((a) => clean(a))));
  const sizeTokens = new Set([size].filter(Boolean));
  const brandModelTerm = norm
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((w) => w && !STOPWORDS.has(w) && !colorTokens.has(w) && !sizeTokens.has(w) && w !== clean(productTerm))
    .join(" ")
    .trim();
  return { normalized: norm, productType, productTerm, typeLabel, color, colorLabel, size, hasGreeting, wantsAvailability, wantsRestock, brandModelTerm };
};

// ---- Pure: substantive business intent beats a leading greeting ----
export const resolveRequestedIntent = (message = "") => {
  const e = extractRequestedEntities(message);
  const t = e.normalized;
  const hasOrder = /(اوردر|أوردر|order|طلبي|طلبيتي|شحنتي|تراكينج|tracking|وصل\s*فين|فين\s*طلب)/.test(t);
  const hasReturn = /(استبدال|استرجاع|ارجاع|return|refund|ريفند)/.test(t);
  const hasPrice = /(بكام|السعر|كام|price|سعر)/.test(t);
  if (e.wantsRestock && (e.productType || e.size || e.color)) return "RESTOCK_REQUEST";
  if (hasReturn) return "RETURN_POLICY";
  if (hasOrder && !e.productType) return "ORDER_STATUS";
  if (e.productType || e.wantsAvailability || e.size || e.color) return "PRODUCT_AVAILABILITY";
  if (hasPrice) return "PRICE_INQUIRY";
  if (e.hasGreeting) return "GREETING";
  return "GENERAL";
};

// ---- Pure: compatibility + variant matching ----
export const isCompatibleProduct = (product = {}, entities = {}) => {
  if (!entities.productType) return true; // no specific category requested → anything is compatible
  const pt = normalizeProductTypeValue(product.product_type || product.productType || "", "");
  if (pt && pt === entities.productType) return true;
  const name = clean(product.name || product.title || product.product_name || "");
  return name.includes(clean(entities.productTerm)) || (entities.productType === "crocs" && name.includes("croc"));
};
export const matchesRequestedColor = (variantColor, requested) => {
  if (!requested) return true;
  const vc = clean(variantColor);
  const alias = COLOR_ALIASES.find(([c]) => c === requested);
  return alias ? alias[1].some((a) => vc.includes(clean(a))) : vc.includes(clean(requested));
};
export const matchesRequestedSize = (variantSize, requested) => {
  if (!requested) return true;
  const vs = clean(variantSize).replace(/\s+/g, "");
  // Exact numeric match or embedded (handles "44", "eu44", "44/45"); Crocs M/W sizes will NOT match a numeric request.
  return new RegExp(`(^|[^0-9])${requested}([^0-9]|$)`).test(vs);
};

// ---- Pure: decide the grounded outcome from resolved catalog facts (unit-testable, no DB) ----
// compatibleProducts: [{ id, name, product_type }]; variantGrounding: { exactVariant, exactStock,
// requestedSizeExistsForType, requestedColorExistsForType, availableSizesSample }
export const decideGrounding = ({ entities, compatibleProducts = [], variantGrounding = null } = {}) => {
  const typeLabel = entities.typeLabel || "المنتج";
  const colorTxt = entities.colorLabel ? ` باللون ${entities.colorLabel}` : "";
  const sizeTxt = entities.size ? ` مقاس ${entities.size}` : "";
  const cards = compatibleProducts.slice(0, 3);

  if (!entities.productType) return { action: "noop" };

  if (compatibleProducts.length === 0) {
    return { action: "no_match", confidence: 0.4, cards: [],
      answer: `للأسف مش لاقي ${typeLabel}${colorTxt} بالمواصفات دي حاليًا. ممكن تبعتلي اسم أو صورة الموديل اللي تقصده وأساعدك؟` };
  }

  // Availability requires EXACT-variant stock evidence, using the canonical size resolver (Phase 10.7).
  if (entities.size) {
    const sr = variantGrounding?.sizeResolution || null;
    const dispSizes = Array.isArray(variantGrounding?.availableSizesDisplay) ? variantGrounding.availableSizesDisplay.slice(0, 8) : [];
    const sizesHint = dispSizes.length ? ` المقاسات المتاحة${colorTxt}: ${dispSizes.join("، ")}.` : "";
    if (variantGrounding?.exactVariant) {
      const stock = Number(variantGrounding.exactStock || 0);
      if (stock > 0) {
        return { action: "available", confidence: 0.9, cards,
          answer: `أيوه 👍 ${typeLabel}${colorTxt}${sizeTxt} متوفر حاليًا${stock <= 5 ? ` (${stock} قطع بس)` : ""}. تحب أجهزلك الطلب؟` };
      }
      return { action: "unavailable", confidence: 0.85, cards,
        answer: `${typeLabel}${colorTxt}${sizeTxt} مش متوفر حاليًا. تحب أسجلك إشعار أبلغك أول ما يرجع؟` };
    }
    // Genuinely ambiguous for the requested color (maps to >1 real variant size) — do NOT guess.
    if (variantGrounding?.ambiguousInColor) {
      return { action: "clarify_size", confidence: 0.4, cards,
        answer: `مقاس ${entities.size} في ${typeLabel}${colorTxt} ليه أكتر من اختيار (${sr?.euSize || "M/W"}). تحب تحدد المقاس المكتوب M/W على الكروكس؟` };
    }
    // Size resolves and exists, but not in the requested color — no availability claim for that color.
    if (variantGrounding?.sizeAvailableOtherColor) {
      return { action: "clarify_color", confidence: 0.45, cards,
        answer: `مقاس ${entities.size} متوفر بس مش باللون ${entities.colorLabel || "المطلوب"}.${sizesHint} تحب لون تاني؟` };
    }
    // No matching variant for the requested size (valid size not on this product, or no mapping) — clarify.
    return { action: "clarify_size", confidence: 0.4, cards,
      answer: `مقاس ${entities.size} مش متوفر حاليًا في ${typeLabel}${colorTxt}.${sizesHint} تحب أساعدك تختار المقاس المناسب؟` };
  }

  // Product/category resolved, no explicit size — present compatible options + ask.
  return { action: "soft_match", confidence: 0.55, cards,
    answer: `عندنا ${typeLabel}${colorTxt} بالفعل 👇 بص على الاختيارات، ولو تحب مقاس أو لون معين قولّي وأنا أظبطهولك.` };
};

const CANONICAL_LABELS = { PRODUCT_AVAILABILITY: "PRODUCT_AVAILABILITY", RESTOCK_REQUEST: "RESTOCK_REQUEST", ORDER_STATUS: "ORDER_STATUS", RETURN_POLICY: "RETURN_POLICY", PRICE_INQUIRY: "PRICE_INQUIRY", GREETING: "GREETING", GENERAL: "GENERAL" };

// ---- Impure orchestrator: resolve compatible catalog products + exact variant, then decide. Failure-isolated. ----
export const applyInboxGroundingGate = async ({ tenantId, message, deps = {} } = {}) => {
  try {
    const entities = extractRequestedEntities(message);
    const requestedIntent = resolveRequestedIntent(message);

    // Phase 10.8 — brand/model grounding. If NO product-category term matched but the customer named a
    // brand/model ("جوردن فور", "Jordan 4", "نايك Air Max"), resolve it to REAL catalog rows by name via the
    // shared alias engine, then treat those rows as the compatible set (deriving product_type from them so the
    // existing size/variant/availability machinery + labels apply). No match → fall through to clarify (never
    // hallucinate a product). Failure-isolated by the outer try/catch.
    let brandModelProducts = null;
    if (!entities.productType && entities.brandModelTerm && (requestedIntent === "PRODUCT_AVAILABILITY" || entities.wantsRestock)) {
      const resolveByBrandModel = deps.resolveByBrandModel || (async (term) => {
        const terms = buildBrandModelTerms(term);
        if (!terms.length) return [];
        const likeTerms = terms.slice(0, 24).map((t) => `%${t}%`);
        const r = await db.query(
          `SELECT id, name, product_type FROM products
             WHERE tenant_id = $1 AND COALESCE(is_storefront_visible, TRUE) = TRUE
               AND LOWER(name) LIKE ANY($2::text[])
             ORDER BY id DESC LIMIT 40`,
          [tenantId, likeTerms]
        ).catch(() => ({ rows: [] }));
        return rankBrandModelMatches(term, r.rows || []);
      });
      const matched = await resolveByBrandModel(entities.brandModelTerm);
      if (Array.isArray(matched) && matched.length) {
        brandModelProducts = matched;
        // Dominant product_type from the matched rows so labels + the footwear size resolver stay type-aware.
        const types = matched.map((m) => normalizeProductTypeValue(m.product_type || "", "")).filter(Boolean);
        const derivedType = types.slice().sort((a, b) => types.filter((t) => t === b).length - types.filter((t) => t === a).length)[0] || "";
        entities.productType = derivedType || "resolved"; // sentinel keeps decideGrounding out of the noop branch
        entities.productTerm = entities.brandModelTerm;
        entities.typeLabel = matched.length === 1 ? String(matched[0].name || "المنتج") : (entities.typeLabel || "المنتج");
      }
    }

    const typeLabel = entities.typeLabel || "المنتج";
    const colorTxt = entities.colorLabel ? ` باللون ${entities.colorLabel}` : "";
    const sizeTxt = entities.size ? ` مقاس ${entities.size}` : "";

    // Restock request → SUGGEST (ask) only; never autonomously create a restock intent (Phase 7.5 rule).
    if (entities.wantsRestock && (entities.productType || entities.size || entities.color)) {
      return { changed: true, entities, requestedIntent: "RESTOCK_REQUEST", action: "restock_suggestion", confidence: 0.6, suggested_products: [],
        answer: `تمام 👍 تحب أسجلك إشعار أبلغك أول ما ${typeLabel}${colorTxt}${sizeTxt} يرجع يتوفر؟`,
        grounding: { requested: { productType: entities.productType || null, color: entities.color || null, size: entities.size || null }, resolved: { note: "restock_suggestion_pending_human" }, action: "restock_suggestion" } };
    }

    // No specific product/category named. If a size/color availability question was asked without a
    // product, ask WHICH product instead of guessing (no unrelated product substitution).
    if (!entities.productType) {
      if ((entities.size || entities.color) && entities.wantsAvailability) {
        return { changed: true, entities, requestedIntent: "PRODUCT_AVAILABILITY", action: "clarify_product", confidence: 0.4, suggested_products: [],
          answer: `تقصد أنهي منتج؟ قولّي اسم أو نوع المنتج${sizeTxt}${colorTxt} وأنا أشيكلك على التوفر بالظبط.`,
          grounding: { requested: { productType: null, color: entities.color || null, size: entities.size || null }, resolved: { note: "no_product_specified" }, action: "clarify_product" } };
      }
      return { changed: false, entities, requestedIntent };
    }

    const queryProducts = deps.queryProducts || (async (type, term) => {
      const r = await db.query(
        `SELECT id, name, product_type FROM products
          WHERE tenant_id = $1 AND COALESCE(is_storefront_visible, TRUE) = TRUE
            AND (LOWER(TRIM(COALESCE(product_type,''))) = $2 OR LOWER(name) LIKE $3)
          ORDER BY id DESC LIMIT 8`,
        [tenantId, type, `%${clean(term).replace(/[^a-z؀-ۿ0-9]/g, "").slice(0, 12) || term}%`]
      ).catch(() => ({ rows: [] }));
      return r.rows || [];
    });
    const inventoryFacts = deps.inventoryFacts || (async (productId) => {
      const { getInventoryFacts } = await import("./aiBusinessToolsService.js");
      return getInventoryFacts({ tenantId, productId });
    });

    // In brand/model mode the ranked catalog rows ARE the compatible set (already name-matched + tier-filtered);
    // otherwise resolve by category and apply the category-compatibility gate.
    const compatibleProducts = brandModelProducts
      ? brandModelProducts
      : (await queryProducts(entities.productType, entities.productTerm)).filter((p) => isCompatibleProduct(p, entities));

    // Exact-variant grounding via the canonical size resolver (Phase 10.7). Available variants authoritative.
    let variantGrounding = null;
    if (compatibleProducts.length && (entities.size || entities.color)) {
      const allVariants = [];
      for (const product of compatibleProducts.slice(0, 5)) {
        const facts = await inventoryFacts(product.id);
        for (const v of (Array.isArray(facts?.variant_stock) ? facts.variant_stock : [])) {
          allVariants.push({ productId: product.id, variantId: v.variant_id ?? v.id, size: v.size ?? v.variant_size, color: v.color ?? v.variant_color, stock: Number(v.stock ?? v.quantity ?? 0) });
        }
      }
      const { resolveFootwearSize, toDisplaySize } = await import("./footwearSizeResolver.js");
      const colorVariants = entities.color ? allVariants.filter((v) => matchesRequestedColor(v.color, entities.color)) : allVariants;
      const hintSource = entities.color ? colorVariants : allVariants;
      const availableSizesDisplay = [...new Set(hintSource.map((v) => toDisplaySize(v.size, entities.productType)).filter(Boolean))];
      if (entities.size) {
        const sizeResolution = resolveFootwearSize({ productType: entities.productType, requestedSize: entities.size, availableVariantSizes: [...new Set(allVariants.map((v) => v.size).filter(Boolean))] });
        let exactVariant = null, exactStock = 0, sizeAvailableOtherColor = false, ambiguousInColor = false;
        if (sizeResolution.canonicalMatches.length) {
          const sizeMatched = allVariants.filter((v) => sizeResolution.canonicalMatches.includes(v.size));
          const colorSizeMatched = entities.color ? sizeMatched.filter((v) => matchesRequestedColor(v.color, entities.color)) : sizeMatched;
          const distinctColorSizes = [...new Set(colorSizeMatched.map((v) => v.size))];
          if (colorSizeMatched.length && distinctColorSizes.length === 1) {
            // Unambiguous within the requested color → exact variant, best-stock representative.
            const best = colorSizeMatched.reduce((a, b) => (b.stock > (a?.stock ?? -1) ? b : a), null);
            exactVariant = { productId: best.productId, variantId: best.variantId, size: best.size, color: best.color, displaySize: toDisplaySize(best.size, entities.productType) };
            exactStock = best.stock;
          } else if (colorSizeMatched.length && distinctColorSizes.length > 1) {
            ambiguousInColor = true; // genuinely ambiguous for the requested color → clarify, never guess
          } else if (entities.color && sizeMatched.length) {
            sizeAvailableOtherColor = true; // size exists but not in the requested color
          }
        }
        variantGrounding = { sizeResolution, exactVariant, exactStock, sizeAvailableOtherColor, ambiguousInColor, availableSizesDisplay };
      } else {
        variantGrounding = { sizeResolution: null, exactVariant: null, colorExists: colorVariants.length > 0, availableSizesDisplay };
      }
    }

    const decision = decideGrounding({ entities, compatibleProducts, variantGrounding });
    if (decision.action === "noop") return { changed: false, entities, requestedIntent };

    // Build grounded product cards from compatible catalog products only (never incompatible ones).
    const groundedCards = (decision.cards || []).map((p) => ({ id: p.id, product_id: p.id, name: p.name, product_type: p.product_type, grounded: true }));
    const detectedIntent = CANONICAL_LABELS[requestedIntent] || "PRODUCT_AVAILABILITY";
    return {
      changed: true,
      entities,
      requestedIntent: detectedIntent,
      action: decision.action,
      answer: decision.answer,
      confidence: decision.confidence,
      suggested_products: groundedCards,
      grounding: {
        requested: { productType: entities.productType, productTerm: entities.productTerm, color: entities.color || null, size: entities.size || null, brandModel: Boolean(brandModelProducts) },
        resolved: (decision.action === "available" || decision.action === "unavailable")
          ? { productId: variantGrounding?.exactVariant?.productId || null, variantId: variantGrounding?.exactVariant?.variantId || null, erpSize: variantGrounding?.exactVariant?.size || null, displaySize: variantGrounding?.exactVariant?.displaySize || entities.size || null, color: variantGrounding?.exactVariant?.color || null, stock: variantGrounding?.exactStock ?? null, matchType: variantGrounding?.sizeResolution?.matchType || null }
          : { candidates: compatibleProducts.length, exactVariantResolved: false, matchType: variantGrounding?.sizeResolution?.matchType || null, euSize: variantGrounding?.sizeResolution?.euSize || null },
        action: decision.action,
      },
    };
  } catch (e) {
    // Never break the draft pipeline; if grounding fails, leave the original draft untouched.
    console.error("[inbox-grounding-gate] failed", { err: String(e?.message || e).slice(0, 160) });
    return { changed: false, error: String(e?.message || e).slice(0, 160) };
  }
};
