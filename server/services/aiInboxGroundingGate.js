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
// Phase 13.5 — BUSINESS SUPPORT FACTS come from the Smart Support Knowledge Base ("قاعدة معرفة الدعم الذكي"),
// never from the LLM and never from conversation history. Same canonical module the operator page + API use.
import {
  detectSupportFactIntent,
  loadSupportKnowledgeBase,
  renderSupportFactAnswer,
} from "./aiSupportKnowledgeBaseService.js";

// ---- Phase 12.1 — Durable grounded PRODUCT SUBJECT context (bounded, deterministic) -------------------
// Reuse a recently GROUNDED product IDENTITY as conversational context for a continuation that omits the
// product ("طب مقاس 44؟", "والاسود؟"). SUBJECT only — never facts: stock/price/variant are always re-read
// fresh below. Sources are strong evidence only (an employee-approved selection, or a sent product card),
// strictly scoped to ONE canonical session, and bounded by recency. NOT chat memory / preference memory.
export const DURABLE_PRODUCT_CONTEXT_MAX_AGE_MS = (() => {
  const v = Number(process.env.AI_INBOX_PRODUCT_CONTEXT_MAX_AGE_MS);
  return Number.isFinite(v) && v > 0 ? v : 30 * 60 * 1000; // default 30 minutes
})();

// The most recent DEFINITIVE grounded product subject for THIS session, within the recency bound. Precedence:
//   1. an employee-APPROVED assisted product selection (ai_reply_corrections.product_id) — never ambiguous,
//      never a rejected/stale suggestion (corrections are only written on an assisted approve),
//   2. else the most recent SENT canonical product-card message (ai_support_messages product_cards[0]).
// Cheap: session-scoped, indexed by created_at, LIMIT 1, no catalog scan. Returns null when nothing qualifies.
export const resolveConversationProductSubject = async ({ tenantId, sessionId, maxAgeMs = DURABLE_PRODUCT_CONTEXT_MAX_AGE_MS, dbClient = db } = {}) => {
  if (!tenantId || !sessionId) return null;
  const seconds = String(Math.max(1, Math.round(maxAgeMs / 1000)));
  const corr = await dbClient.query(
    `SELECT product_id, message_id, ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)))::int AS age_s
       FROM ai_reply_corrections
      WHERE tenant_id = $1 AND conversation_id = $2 AND NULLIF(product_id::text, '') IS NOT NULL
        AND created_at > NOW() - ($3 || ' seconds')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, sessionId, seconds]
  ).catch(() => ({ rows: [] }));
  if (corr.rows[0]?.product_id) {
    return { productId: String(corr.rows[0].product_id), sourceMessageId: corr.rows[0].message_id || null, ageSeconds: Number(corr.rows[0].age_s) || 0, source: "approved_selection" };
  }
  const card = await dbClient.query(
    `SELECT id, product_cards, ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)))::int AS age_s
       FROM ai_support_messages
      WHERE tenant_id = $1 AND session_id = $2 AND message_type = 'product_card'
        AND sender_type IN ('staff', 'ai', 'agent', 'bot')
        AND COALESCE(delivery_status, '') IN ('sent', 'mock_sent', 'delivered', 'read')
        AND created_at > NOW() - ($3 || ' seconds')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, sessionId, seconds]
  ).catch(() => ({ rows: [] }));
  const cards = card.rows[0]?.product_cards;
  const pid = Array.isArray(cards) && cards.length ? (cards[0].product_id || cards[0].id) : null;
  if (pid) {
    return { productId: String(pid), sourceMessageId: card.rows[0].id || null, ageSeconds: Number(card.rows[0].age_s) || 0, source: "sent_product_card" };
  }
  return null;
};

// Continuation fillers — leftover words that are NOT a product mention (so a bare follow-up like "طب مقاس 44؟"
// or "والاسود؟" is recognised as continuation, not as a new/unresolvable product). Colour words are handled
// separately via the alias vocabulary below.
const CONTEXT_CONTINUATION_FILLERS = new Set([
  "طب", "طيب", "ماشي", "تمام", "اوك", "اوكي", "ok", "اه", "ايوه", "اها", "بردو", "كمان", "وكمان", "مقاس", "مقاسي",
  "size", "متاح", "متوفر", "موجود", "فيه", "بكام", "بكم", "السعر", "سعره", "كام", "وفيه", "هو", "هي", "ده", "دي",
  // conversational-only tokens (thanks / closing / farewell) — never a product name
  "شكرا", "شكرًا", "مشكور", "العفو", "خلاص", "حاضر", "سلامه", "سلامة", "السلامه", "وداعا", "باي", "bye", "مرحبا", "اهلا", "اهلين", "هلا",
]);

// True when the NEW message names a substantive product/brand term (so context must NOT override it). A bare
// continuation (only fillers / colour / size / price words) returns false → durable context may be consulted.
const hasExplicitProductMention = (entities = {}) => {
  if (entities.productType) return true;
  const colorSet = new Set(COLOR_ALIASES.flatMap(([, aliases]) => aliases.map((a) => clean(a))));
  return String(entities.brandModelTerm || "")
    .split(/\s+/)
    .map((w) => clean(w).replace(/^وال|^ال|^و/, ""))
    .filter(Boolean)
    .some((w) => w.length >= 2 && !CONTEXT_CONTINUATION_FILLERS.has(w) && !colorSet.has(w));
};

// Phase 13.4 — RECOMMENDATION vs IDENTITY DISAMBIGUATION selection semantics. When an ambiguous match set is
// present (>1 distinct product), the business meaning of the customer's turn decides whether the operator picks
// ONE (identity question — "which of these two Jordan 4s?") or MAY pick SEVERAL to send (recommendation —
// "show me options/models"). This is a DETERMINISTIC label on top of existing grounding; it changes no
// resolution logic. Default is disambiguation (single-select) — recommendation lights up ONLY on explicit
// show-me-options phrasing, so the safe/current behaviour is preserved when uncertain.
export const detectsRecommendationIntent = (text = "") => {
  const t = String(text || "");
  if (!t) return false;
  if (/موديلات|اختيارات|تشكيل|كولكشن|collection|options|models/i.test(t)) return true;
  if (/(كام|كذا|بعض|شوية|شويه)\s*موديل/i.test(t)) return true;
  if (/(ورّيني|وريني|ورينى|اعرضلي|اعرض\s*لي|هاتلي|هات\s*لي|ابعتلي|ابعت\s*لي)/i.test(t)
      && /(موديل|اختيار|حاج|كوتشي|شوز|صندل|شبشب)/i.test(t)) return true;
  if (/عندك(م|و|ن)?\s*(ايه|إيه)|(ايه|إيه)\s*(اللي\s*)?عندك/i.test(t)) return true;
  return false;
};

const defaultResolveProductById = async ({ tenantId, productId, dbClient = db } = {}) => {
  if (!tenantId || !productId) return null;
  const r = await dbClient.query(
    `SELECT id, name, product_type FROM products
       WHERE tenant_id = $1 AND id = $2 AND COALESCE(is_storefront_visible, TRUE) = TRUE LIMIT 1`,
    [tenantId, productId]
  ).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
};

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
  const wantsAvailability = /(عندكم|عندك|متوفر|متاح|موجود|فيه|في\s|available|هل\s*في|بتوفر)/.test(norm);
  const wantsRestock = /(بلغني|بلغوني|ابلغني|نزل\s*تاني|رجع\s*تاني)/.test(norm) || /لما.*(ينزل|يتوفر|يرجع|ينزّل)/.test(norm);
  // Phase 10.8 — residual brand/model term: the message minus greeting/availability/size/color/stopwords.
  // Brand & model live in products.name (no products.brand/model column), so this is fed to the alias engine
  // to resolve real catalog rows by name. The matched SIZE token is dropped, but other digits (a model number
  // like the "4" in "Jordan 4") are preserved so an explicit model still resolves.
  const colorTokens = new Set(COLOR_ALIASES.flatMap(([, aliases]) => aliases.map((a) => clean(a))));
  const sizeTokens = new Set([size].filter(Boolean));
  // Availability/ask words must not pollute the brand/model term ("متاح اديداس اديستار" → "اديداس اديستار").
  const availabilityWords = new Set(["متاح", "متاحه", "متاحة", "متوفر", "متوفره", "موجود", "موجوده", "عندكم", "عندك", "فيه", "هل", "بتوفر", "available", "عايز", "عاوز", "محتاج"]);
  const brandModelTerm = norm
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((w) => w && !STOPWORDS.has(w) && !colorTokens.has(w) && !sizeTokens.has(w) && !availabilityWords.has(w) && w !== clean(productTerm))
    .join(" ")
    .trim();
  return { normalized: norm, productType, productTerm, typeLabel, color, colorLabel, size, sizeIsExplicit: Boolean(sizeExplicit), hasGreeting, wantsAvailability, wantsRestock, brandModelTerm };
};

// ---- Pure: substantive business intent beats a leading greeting (operates on entities — single or merged turn) ----
export const resolveIntentFromEntities = (e = {}) => {
  const t = e.normalized || "";
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
export const resolveRequestedIntent = (message = "") => resolveIntentFromEntities(extractRequestedEntities(message));

// ---- Pure: merge the entities of a fragmented customer turn (oldest→newest) into one composite request.
// Latest message wins per dimension; a dimension the latest message omits is backfilled from the most-recent
// prior fragment that has it (so "عندكم جوردن فور" → "احمر" → "مقاس ٤١" reconstructs Jordan 4 / red / 41).
// Intent-signal flags are OR'd across the turn. Single-message input is returned unchanged (backward-compatible).
export const mergeTurnEntities = (entitiesList = []) => {
  const list = (entitiesList || []).filter(Boolean);
  if (list.length <= 1) return list[0] || extractRequestedEntities("");
  const merged = { ...list[list.length - 1] };
  const priorNewestFirst = list.slice(0, -1).reverse();
  // product identity is a group: keep productType+productTerm+typeLabel together, else a brandModelTerm.
  if (!merged.productType && !merged.brandModelTerm) {
    for (const e of priorNewestFirst) {
      if (e.productType) { merged.productType = e.productType; merged.productTerm = e.productTerm; merged.typeLabel = e.typeLabel; break; }
      if (e.brandModelTerm) { merged.brandModelTerm = e.brandModelTerm; break; }
    }
  }
  if (!merged.color) { const p = priorNewestFirst.find((e) => e.color); if (p) { merged.color = p.color; merged.colorLabel = p.colorLabel; } }
  if (!merged.size) { const p = priorNewestFirst.find((e) => e.size); if (p) { merged.size = p.size; merged.sizeIsExplicit = p.sizeIsExplicit; } }
  merged.wantsAvailability = list.some((e) => e.wantsAvailability);
  merged.wantsRestock = list.some((e) => e.wantsRestock);
  merged.hasGreeting = list.some((e) => e.hasGreeting);
  merged.normalized = list.map((e) => e.normalized).filter(Boolean).join(" ");
  return merged;
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

// Phase 12.2 — ONE deterministic helper for customer-facing Arabic stock-count wording (presentation only;
// never changes the fact/number/decision). 1 → "قطعة واحدة", 2 → "قطعتين", else "N قطع" (0, 3..10, …).
export const formatArabicPieces = (count) => {
  const c = Math.max(0, Math.trunc(Number(count) || 0));
  if (c === 1) return "قطعة واحدة";
  if (c === 2) return "قطعتين";
  return `${c} قطع`;
};

// ---- Pure: decide the grounded outcome from resolved catalog facts (unit-testable, no DB) ----
// compatibleProducts: [{ id, name, product_type }]; variantGrounding: { exactVariant, exactStock,
// requestedSizeExistsForType, requestedColorExistsForType, availableSizesSample }
// Phase 11.2 — STYLE-AWARE RENDERING: the FACT (available/stock) is decided by grounding; only the WORDING is
// shaped by the tenant style profile. Neutral phrasing unless a STABLE concise preference is learned. Never
// hardcodes a tenant phrase and never changes the fact. `styleProfile` is the bounded PRODUCT_AVAILABILITY profile.
export const renderGroundedAvailability = ({ typeLabel = "المنتج", colorTxt = "", sizeTxt = "", stock = null, styleProfile = null } = {}) => {
  const st = Number(stock);
  const neutral = `أيوه 👍 ${typeLabel}${colorTxt}${sizeTxt} متوفر حاليًا${st > 0 && st <= 5 ? ` (${formatArabicPieces(st)} بس)` : ""}. تحب أجهزلك الطلب؟`;
  const p = styleProfile?.PRODUCT_AVAILABILITY || null;
  const concise = p?.brevity?.status === "stable" && p.brevity.value === "concise";
  if (!concise) return neutral;
  const omitStock = p.exact_stock_count?.status === "stable" && p.exact_stock_count.value === "usually_omit";
  const emoji = (p.emoji?.status === "stable" && p.emoji.value && p.emoji.value !== "none") ? " 🌹" : "";
  const stockPart = omitStock ? "" : (st > 0 && st <= 5 ? ` (${formatArabicPieces(st)})` : "");
  // Concise wording that STILL asserts the verified availability fact — structural style only (no tenant phrase
  // hardcoded; the specific "إن شاء الله" wording would come from a future learned availability-phrasing signal).
  return `أيوه متاح حاليًا${stockPart}${emoji}`.replace(/\s+/g, " ").trim();
};

// Deterministic post-render guard: style rendering may NEVER assert availability for a non-available fact.
export const guardNoFalseAvailability = (action = "", rendered = "", neutral = "") => {
  if (action === "available") return rendered;
  const s = String(rendered || "");
  const claimsAvailable = /(^|\s)متاح(\s|$)|متوفر/.test(s) && !/(مش|غير|لا)\s*(متاح|متوفر)/.test(s);
  return claimsAvailable ? neutral : rendered;
};

export const decideGrounding = ({ entities, compatibleProducts = [], variantGrounding = null, styleProfile = null } = {}) => {
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
    // Phase 12.2 — the requested size is available in >1 colour and none was requested: confirm availability but
    // require a colour before a specific variant/card is definitive (no silent highest-stock pick).
    if (Array.isArray(variantGrounding?.colorChoices) && variantGrounding.colorChoices.length > 1) {
      const colorsList = variantGrounding.colorChoices.map((c) => String(c.color || "").trim()).filter(Boolean).join("، ");
      return { action: "color_choice_required", confidence: 0.6, cards, color_choices: variantGrounding.colorChoices,
        answer: `أيوه مقاس ${entities.size} متاح إن شاء الله 🌹 موجود بالألوان: ${colorsList}. تحب أنهي لون؟` };
    }
    if (variantGrounding?.exactVariant) {
      const stock = Number(variantGrounding.exactStock || 0);
      if (stock > 0) {
        return { action: "available", confidence: 0.9, cards,
          answer: renderGroundedAvailability({ typeLabel, colorTxt, sizeTxt, stock, styleProfile }) };
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
export const applyInboxGroundingGate = async ({ tenantId, message, contextMessages = null, sessionId = "", styleProfile = null, reply = null, deps = {} } = {}) => {
  let productContextResolution = null;
  try {
    // Phase 11.1 — ground on the current unanswered customer TURN, not just the latest message. A fragmented
    // request ("عندكم جوردن فور" / "احمر" / "مقاس ٤١") merges to one composite (latest wins, missing dims
    // backfilled). Single-message callers/tests pass no contextMessages → identical single-message behavior.
    const contextTexts = Array.isArray(contextMessages) && contextMessages.length ? contextMessages : [message];
    const entities = mergeTurnEntities(contextTexts.map((m) => extractRequestedEntities(m)));
    const requestedIntent = resolveIntentFromEntities(entities);

    // Phase 13.5 — SUPPORT-FACT PRECEDENCE. An explicit business-support question (address / hours / phone /
    // WhatsApp / payment / shipping / returns / warranty) is answered from the canonical Smart Support
    // Knowledge Base and OUTRANKS any product context. This runs FIRST — before the conversational guard,
    // before brand/model resolution, and before durable product context — so a stale product topic (the
    // production "العنوان ايه؟ → Jordan" bug) can never leak into a support answer. Detection reads ONLY the
    // customer's current message; the KB fields are the facts, the LLM never supplies them. A same-message
    // product/category mention still wins (that turn genuinely is about a product), so existing product
    // grounding is untouched. Never sends; only replaces the already-composed draft text + clears cards.
    const supportFactIntent = entities.productType ? "" : detectSupportFactIntent(message);
    if (supportFactIntent) {
      const loadKb = deps.loadSupportKnowledgeBase || loadSupportKnowledgeBase;
      const knowledge = await loadKb({ tenantId }).catch(() => null);
      if (knowledge) {
        const rendered = renderSupportFactAnswer({ intent: supportFactIntent, ...knowledge });
        if (String(rendered.answer || "").trim()) {
          return {
            changed: true,
            entities,
            requestedIntent: supportFactIntent,
            action: "support_fact",
            answer: rendered.answer,
            confidence: 0.95,
            suggested_products: [],
            send_ready_card: null,
            card_choices: [],
            color_choices: [],
            product_ambiguous: false,
            color_choice_required: false,
            selection_semantics: null,
            // Surfaced to the operator (draft metadata) so an empty canonical field is visible and fixable
            // on the Knowledge Base page instead of being silently invented by the model.
            kb_missing_fields: rendered.missing_fields,
            grounding: {
              requested: { supportFactIntent },
              resolved: { source: "smart_support_knowledge_base", fields_used: rendered.fields_used, missing_fields: rendered.missing_fields },
              action: "support_fact",
              product_resolution: { source: "none" },
            },
          };
        }
      }
    }

    // Phase 13.1 — CONVERSATIONAL-ONLY guard. A greeting / acknowledgement / thanks / closing with NO
    // product-dependent request AND NO explicit product mention must never carry product facts or cards, and must
    // NEVER consult durable context (that is only a fallback for an ELLIPTICAL product follow-up). The raw brain
    // sometimes answers a greeting with a product listing from its own history; neutralise that leak
    // deterministically. A product request in the SAME active turn makes this false (productDependentRequest),
    // so "السلام عليكم + عندكم جوردن" still grounds normally.
    // A product-dependent REQUEST = a size/colour/availability/price/restock ask (an elliptical follow-up). A bare
    // residual brandModelTerm is NOT a request — whether it is a real product NAME is decided by
    // hasExplicitProductMention (which ignores fillers/greetings/farewells), so a conversational word like "ماشي"
    // is not mistaken for a product here.
    const priceAsk = /بكام|بكم|السعر|سعره|كام\s*سعر|price/i.test(String(message || ""));
    const productDependentRequest = Boolean(entities.productType || entities.size || entities.color || entities.wantsAvailability || entities.wantsRestock || priceAsk);
    if (!hasExplicitProductMention(entities) && !productDependentRequest) {
      const rp = reply || {};
      const rawLeak = (Array.isArray(rp.suggested_products) && rp.suggested_products.length > 0)
        || (Array.isArray(rp.product_cards) && rp.product_cards.length > 0)
        || /\d[\d,]*\s*جنيه|المقاسات المتاحة|الألوان\s*:/.test(String(rp.answer || ""));
      if (rawLeak) {
        const answer = entities.hasGreeting
          ? "وعليكم السلام ورحمة الله 🌹 أهلاً بيك، تحب أساعدك في إيه؟"
          : "تحت أمرك 🌹 لو محتاج أي حاجة قولّي.";
        return { changed: true, entities, requestedIntent, action: "conversational", answer,
          suggested_products: [], send_ready_card: null, card_choices: [], color_choices: [], product_ambiguous: false, color_choice_required: false,
          grounding: { requested: {}, resolved: { note: "conversational_only_no_product" }, action: "conversational", product_resolution: { source: "none" } } };
      }
    }

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

    // Phase 12.1 — durable grounded PRODUCT SUBJECT continuation. When the NEW message is continuation-shaped
    // (explicit size / colour / availability ask) but names NO product AND NO brand/model, reuse the most
    // recent deterministically-grounded product SUBJECT for THIS session as CONTEXT ONLY. Gated on
    // !productType && !brandModelTerm so an explicit new product/brand ALWAYS wins (brand/model already ran
    // above). The resolved product then flows through the SAME fresh grounding below — stock/price/variant are
    // re-read from current ERP, never inherited from the remembered turn. Ambiguous/rejected/stale prior turns
    // never produce a subject (only approved selections / sent cards qualify).
    if (!entities.productType && !hasExplicitProductMention(entities) && sessionId) {
      // Phase 13.1 — durable context is a FALLBACK for an elliptical PRODUCT follow-up only (size/colour/price/
      // availability). needsProductContext excludes greeting/ack-only messages (already neutralised above).
      const needsProductContext = Boolean(entities.color || (entities.size && (entities.sizeIsExplicit || entities.wantsAvailability)) || entities.wantsAvailability || priceAsk);
      const continuationShaped = needsProductContext;
      if (continuationShaped) {
        const resolveSubject = deps.resolveProductSubject || resolveConversationProductSubject;
        const subject = await resolveSubject({ tenantId, sessionId, maxAgeMs: DURABLE_PRODUCT_CONTEXT_MAX_AGE_MS }).catch(() => null);
        if (subject && subject.productId) {
          const resolveById = deps.resolveProductById || defaultResolveProductById;
          const row = await resolveById({ tenantId, productId: subject.productId }).catch(() => null);
          if (row && row.id) {
            brandModelProducts = [row]; // reuse the exact-catalog-row path (labels + variant machinery apply)
            entities.productType = normalizeProductTypeValue(row.product_type || "", "") || "resolved";
            entities.productTerm = String(row.name || "");
            entities.typeLabel = String(row.name || "المنتج");
            productContextResolution = { source: "conversation_context", product_id: String(row.id), context_age_seconds: subject.ageSeconds ?? null, source_message_id: subject.sourceMessageId ?? null, evidence: subject.source || null };
          }
        }
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
      // Phase 11.1 — a size/color fragment that resolves to NO product must ask which product, never let the
      // raw ungrounded draft (remembered/popular items) pass through. Bounded to an EXPLICIT size marker
      // (مقاس/size), an availability ask, or a color, so a stray number ("خصم ٣٠") does not trigger a clarify.
      const colorOrExplicit = entities.color || (entities.size && (entities.sizeIsExplicit || entities.wantsAvailability));
      // FAIL CLOSED (Adistar regression): the customer EXPLICITLY named a product/model we could not resolve to a
      // real catalog row. Never let the raw brain leak a generic "أطلعلك بديل شبه ده؟" — ask which product
      // instead. No invented availability, no arbitrary alternatives, no durable-context reuse (explicit mention).
      // Require a REAL availability/restock ask (not a stray number like "خصم ٣٠" that only makes the intent
      // look product-shaped) so an explicit named product with an availability signal fails closed, but noise does not.
      const explicitUnresolved = hasExplicitProductMention(entities) && (entities.wantsAvailability || entities.wantsRestock);
      if (colorOrExplicit || explicitUnresolved) {
        const answer = explicitUnresolved
          ? `مش لاقي المنتج ده عندنا بالظبط${sizeTxt}${colorTxt}. ممكن تبعتلي اسم المنتج أو الموديل بالظبط وأنا أشيكلك على التوفر من المخزون؟`
          : `تقصد أنهي منتج؟ قولّي اسم أو نوع المنتج${sizeTxt}${colorTxt} وأنا أشيكلك على التوفر بالظبط.`;
        return { changed: true, entities, requestedIntent: "PRODUCT_AVAILABILITY", action: "clarify_product", confidence: 0.4, suggested_products: [],
          answer,
          grounding: { requested: { productType: null, productTerm: entities.brandModelTerm || null, color: entities.color || null, size: entities.size || null }, resolved: { note: explicitUnresolved ? "product_not_found" : "no_product_specified" }, action: "clarify_product", product_resolution: { source: "explicit_message" } } };
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
        let exactVariant = null, exactStock = 0, sizeAvailableOtherColor = false, ambiguousInColor = false, colorChoices = null;
        if (sizeResolution.canonicalMatches.length) {
          const sizeMatched = allVariants.filter((v) => sizeResolution.canonicalMatches.includes(v.size));
          const colorSizeMatched = entities.color ? sizeMatched.filter((v) => matchesRequestedColor(v.color, entities.color)) : sizeMatched;
          const distinctColorSizes = [...new Set(colorSizeMatched.map((v) => v.size))];
          if (colorSizeMatched.length && distinctColorSizes.length === 1) {
            // Phase 12.2 — MULTI-COLOR SIZE DISAMBIGUATION. When NO colour was requested and the requested size has
            // >1 DISTINCT in-stock colour, do NOT silently pick the highest-stock one — surface grounded colour
            // choices (deterministic, deduped by normalised colour, representative = best-stock per colour). 0
            // in-stock → falls through to unavailable; exactly 1 in-stock colour → keep the proven auto-select.
            const inStock = colorSizeMatched.filter((v) => Number(v.stock) > 0);
            const byColor = new Map();
            for (const v of inStock) { const key = clean(String(v.color || "")).toLowerCase(); if (!key) continue; const cur = byColor.get(key); if (!cur || v.stock > cur.stock) byColor.set(key, v); }
            if (!entities.color && byColor.size > 1) {
              colorChoices = [...byColor.values()].map((v) => ({ product_id: v.productId, variant_id: v.variantId, color: v.color, size: v.size, stock: v.stock, displaySize: toDisplaySize(v.size, entities.productType) }));
            } else {
              // Unambiguous (requested colour, or ≤1 in-stock colour) → exact variant, best-stock representative.
              const best = colorSizeMatched.reduce((a, b) => (b.stock > (a?.stock ?? -1) ? b : a), null);
              exactVariant = { productId: best.productId, variantId: best.variantId, size: best.size, color: best.color, displaySize: toDisplaySize(best.size, entities.productType) };
              exactStock = best.stock;
            }
          } else if (colorSizeMatched.length && distinctColorSizes.length > 1) {
            ambiguousInColor = true; // genuinely ambiguous for the requested color → clarify, never guess
          } else if (entities.color && sizeMatched.length) {
            sizeAvailableOtherColor = true; // size exists but not in the requested color
          }
        }
        variantGrounding = { sizeResolution, exactVariant, exactStock, sizeAvailableOtherColor, ambiguousInColor, colorChoices, availableSizesDisplay };
      } else {
        variantGrounding = { sizeResolution: null, exactVariant: null, colorExists: colorVariants.length > 0, availableSizesDisplay };
      }
    }

    const decision = decideGrounding({ entities, compatibleProducts, variantGrounding, styleProfile });
    if (decision.action === "noop") return { changed: false, entities, requestedIntent };
    // Deterministic safety net: style rendering can never assert availability for a non-available decision.
    // color_choice_required IS an availability state (size available in multiple colours) — exclude it.
    if (decision.answer && decision.action !== "available" && decision.action !== "color_choice_required") {
      const neutralUnavail = `${entities.typeLabel || "المنتج"}${entities.colorLabel ? ` باللون ${entities.colorLabel}` : ""}${entities.size ? ` مقاس ${entities.size}` : ""} مش متوفر حاليًا.`;
      decision.answer = guardNoFalseAvailability(decision.action, decision.answer, neutralUnavail);
    }

    // Build grounded product cards from compatible catalog products only (never incompatible ones).
    const groundedCards = (decision.cards || []).map((p) => ({ id: p.id, product_id: p.id, name: p.name, product_type: p.product_type, grounded: true }));
    const detectedIntent = CANONICAL_LABELS[requestedIntent] || "PRODUCT_AVAILABILITY";

    // Phase 11.2 — SEND-READY CARD vs DISAMBIGUATION (identity only; image/price/url enriched downstream from
    // the canonical services). Grounding is authoritative: a card may be auto-attached ONLY when EXACTLY ONE
    // catalog product resolved. When the term matched >1 distinct product (e.g. "Jordan 4" → 208 + 39), we do
    // NOT silently attach one — we surface choices for the employee to pick. Never attach remembered/popular.
    const distinctProductIds = [...new Set(compatibleProducts.map((p) => p.id))];
    const productAmbiguous = distinctProductIds.length > 1;
    // Phase 13.4.1 — VARIANT OPTIONS mode. Identity counts as GROUNDED when the in-stock colour choices for the
    // requested size all belong to ONE product — that is the variant evidence resolving identity, which is
    // stronger than the name query (a term like "جوردن فور" legitimately matches >1 catalog row while only one of
    // them actually stocks the requested size). If the choices span >1 product, identity is genuinely unresolved
    // and the operator must pick ONE product first (§15) — never a colour batch across different products.
    const colorChoiceProductIds = [...new Set((decision.color_choices || []).map((c) => String(c.product_id)))];
    const variantOptionsMode = decision.action === "color_choice_required"
      && !entities.color
      && colorChoiceProductIds.length === 1
      && (decision.color_choices || []).length > 1;
    const ev = variantGrounding?.exactVariant || null;
    let sendReadyCard = null;
    let cardChoices = [];
    if (productAmbiguous) {
      cardChoices = compatibleProducts.slice(0, 6).map((p) => ({ product_id: p.id, id: p.id, name: p.name, product_type: p.product_type, grounded: true }));
    } else if (compatibleProducts.length === 1 && ["available", "unavailable", "soft_match"].includes(decision.action)) {
      const p = compatibleProducts[0];
      sendReadyCard = {
        product_id: p.id, id: p.id, name: p.name, product_type: p.product_type, grounded: true,
        variant_id: ev?.variantId || null,
        size: ev?.displaySize || entities.size || null,
        color: ev?.color || entities.colorLabel || entities.color || null,
        in_stock: decision.action === "available" || decision.action === "soft_match",
        action: decision.action,
      };
    }
    return {
      changed: true,
      entities,
      requestedIntent: detectedIntent,
      action: decision.action,
      answer: decision.answer,
      confidence: decision.confidence,
      suggested_products: groundedCards,
      send_ready_card: sendReadyCard,
      card_choices: cardChoices,
      product_ambiguous: productAmbiguous,
      // Phase 13.4 — selection semantics for the ambiguous card set. "recommendation" ⇒ operator may multi-select
      // and send several; "identity_disambiguation" ⇒ pick exactly one (safe default); null when not ambiguous.
      // Phase 13.4.1 — "multi_variant_options": product identity is ALREADY grounded BY THE VARIANT EVIDENCE (all
      // in-stock colour choices for the requested size belong to one product), the customer requested a size but
      // NO colour, and >1 canonical colour is in stock. That is not a disambiguation question ("which one do you
      // mean?") — it is an OPTIONS question ("here is what's available"), so the operator may tick several grounded
      // variants of the SAME product. Choices spanning >1 product remain single-select identity resolution (§15).
      selection_semantics: variantOptionsMode
        ? "multi_variant_options"
        : (productAmbiguous
            ? ((decision.action === "soft_match" || detectsRecommendationIntent(message)) ? "recommendation" : "identity_disambiguation")
            : null),
      color_choices: Array.isArray(decision.color_choices) ? decision.color_choices : [],
      color_choice_required: decision.action === "color_choice_required",
      grounding: {
        requested: { productType: entities.productType, productTerm: entities.productTerm, color: entities.color || null, size: entities.size || null, brandModel: Boolean(brandModelProducts) },
        resolved: (decision.action === "available" || decision.action === "unavailable")
          ? { productId: variantGrounding?.exactVariant?.productId || null, variantId: variantGrounding?.exactVariant?.variantId || null, erpSize: variantGrounding?.exactVariant?.size || null, displaySize: variantGrounding?.exactVariant?.displaySize || entities.size || null, color: variantGrounding?.exactVariant?.color || null, stock: variantGrounding?.exactStock ?? null, matchType: variantGrounding?.sizeResolution?.matchType || null }
          : { candidates: compatibleProducts.length, exactVariantResolved: false, matchType: variantGrounding?.sizeResolution?.matchType || null, euSize: variantGrounding?.sizeResolution?.euSize || null },
        action: decision.action,
        // Phase 12.1 — provenance: how the product SUBJECT was chosen (explicit new mention vs recalled context).
        product_resolution: productContextResolution || { source: "explicit_message" },
      },
    };
  } catch (e) {
    // Never break the draft pipeline; if grounding fails, leave the original draft untouched.
    console.error("[inbox-grounding-gate] failed", { err: String(e?.message || e).slice(0, 160) });
    return { changed: false, error: String(e?.message || e).slice(0, 160) };
  }
};
