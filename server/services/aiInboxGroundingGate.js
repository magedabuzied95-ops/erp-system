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
  return { normalized: norm, productType, productTerm, typeLabel, color, colorLabel, size, hasGreeting, wantsAvailability, wantsRestock };
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

  // Availability requires EXACT-variant stock evidence.
  if (entities.size) {
    if (variantGrounding?.exactVariant) {
      const stock = Number(variantGrounding.exactStock || 0);
      if (stock > 0) {
        return { action: "available", confidence: 0.9, cards,
          answer: `أيوه 👍 ${typeLabel}${colorTxt}${sizeTxt} متوفر حاليًا${stock <= 5 ? ` (${stock} قطع بس)` : ""}. تحب أجهزلك الطلب؟` };
      }
      return { action: "unavailable", confidence: 0.85, cards,
        answer: `${typeLabel}${colorTxt}${sizeTxt} مش متوفر حاليًا. تحب أسجلك إشعار أبلغك أول ما يرجع؟` };
    }
    // Exact variant not found — do NOT claim availability. Clarify honestly.
    if (variantGrounding && variantGrounding.requestedSizeExistsForType === false) {
      const sizesHint = Array.isArray(variantGrounding.availableSizesSample) && variantGrounding.availableSizesSample.length
        ? ` المقاسات المتاحة: ${variantGrounding.availableSizesSample.slice(0, 8).join("، ")}.` : "";
      return { action: "clarify_size", confidence: 0.4, cards,
        answer: `مقاس ${entities.size} مش متوفر في ${typeLabel} حاليًا.${sizesHint} تحب أساعدك تختار المقاس المناسب؟` };
    }
    return { action: "clarify_size", confidence: 0.4, cards,
      answer: `عشان أتأكد من التوفر بالظبط، تحب أنهي موديل ${typeLabel}؟ وأنا أشيك على${colorTxt || " اللون"}${sizeTxt}.` };
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

    const compatibleProducts = (await queryProducts(entities.productType, entities.productTerm)).filter((p) => isCompatibleProduct(p, entities));

    // Exact-variant grounding (only when a size/color was requested).
    let variantGrounding = null;
    if (compatibleProducts.length && (entities.size || entities.color)) {
      let exactVariant = null, exactStock = 0, sizeExists = false, colorExists = false;
      const sizesSample = new Set();
      for (const product of compatibleProducts.slice(0, 5)) {
        const facts = await inventoryFacts(product.id);
        const variants = Array.isArray(facts?.variant_stock) ? facts.variant_stock : [];
        for (const v of variants) {
          const sz = v.size ?? v.variant_size, col = v.color ?? v.variant_color, stk = Number(v.stock ?? v.quantity ?? 0);
          if (sz) sizesSample.add(String(sz));
          const sizeOk = matchesRequestedSize(sz, entities.size);
          const colorOk = matchesRequestedColor(col, entities.color);
          if (sizeOk) sizeExists = true;
          if (colorOk && entities.color) colorExists = true;
          if (sizeOk && colorOk && !exactVariant) { exactVariant = { productId: product.id, variantId: v.variant_id ?? v.id, size: sz, color: col }; exactStock = stk; }
        }
        if (exactVariant) break;
      }
      variantGrounding = { exactVariant, exactStock, requestedSizeExistsForType: entities.size ? sizeExists : null, requestedColorExistsForType: entities.color ? colorExists : null, availableSizesSample: [...sizesSample] };
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
        requested: { productType: entities.productType, productTerm: entities.productTerm, color: entities.color || null, size: entities.size || null },
        resolved: decision.action === "available" || decision.action === "unavailable"
          ? { productId: variantGrounding?.exactVariant?.productId || null, variantId: variantGrounding?.exactVariant?.variantId || null, size: variantGrounding?.exactVariant?.size || null, color: variantGrounding?.exactVariant?.color || null, stock: variantGrounding?.exactStock ?? null }
          : { candidates: compatibleProducts.length, exactVariantResolved: false },
        action: decision.action,
      },
    };
  } catch (e) {
    // Never break the draft pipeline; if grounding fails, leave the original draft untouched.
    console.error("[inbox-grounding-gate] failed", { err: String(e?.message || e).slice(0, 160) });
    return { changed: false, error: String(e?.message || e).slice(0, 160) };
  }
};
