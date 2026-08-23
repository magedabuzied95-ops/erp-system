/**
 * Hybrid product retrieval.
 *
 * The problem it solves: `searchAiSalesProducts` scores a single `LIKE '%<whole
 * message>%'`. A customer who writes "عندكم كروكس اسود مقاس ٤٤؟" produces a LIKE
 * pattern that matches no product row on earth, so retrieval falls back to whatever
 * the term-level branch happens to catch — and one typo, or the Arabic spelling the
 * catalog does not use, returns nothing at all. That is the single biggest reason the
 * assistant "doesn't find what the customer is asking for".
 *
 * What this does instead: run several cheap retrievers that fail in DIFFERENT ways,
 * then fuse their rankings. A product only has to be found by one of them.
 *
 *   A. Phrase      — the existing whole-query scorer. Best when the customer names a
 *                    model exactly. Kept because it is the most precise signal we have.
 *   B. Entity      — searches the model/category/brand the understanding pass
 *                    extracted, not the raw sentence. This is what makes a full
 *                    sentence work at all.
 *   C. Alias       — the existing alias engine's canonical forms and hints, so
 *                    "جوردن فور" reaches "Air Jordan 4".
 *   D. Token       — each meaningful token on its own, so a partial match still
 *                    surfaces something rather than nothing.
 *
 * Fusion is Reciprocal Rank Fusion: a product ranked 2nd by two weak retrievers beats
 * one ranked 1st by a single retriever. RRF needs no score calibration between
 * retrievers, which matters here because their scores are not comparable.
 *
 * Deliberately NOT vector search: this deployment has neither pgvector nor pg_trgm
 * installed, and adding an extension is a DBA action, not a code change. The
 * embedding retriever slots in as retriever E behind AI_SEMANTIC_SEARCH_ENABLED once
 * the extension exists — see docs/ai-brain-audit-and-roadmap.md, phase 3.
 */
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { buildAliasAwareSearchHints } from "../utils/aliasAwareProductSearch.js";
import { normalizeArabicForIntent } from "../utils/arabicTextNormalizer.js";
import { arabicSearchText } from "../utils/arabicSearch.js";
import { BRAND_CATALOG_NAMES } from "./aiEntityLexicon.js";
import { searchProductsSemantic } from "./aiSemanticSearchService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value = "") => text(value).toLowerCase();

/**
 * Intents where a product card is never the right answer. Deliberately does NOT
 * include greeting or smalltalk: a greeting often opens a shopping conversation, and
 * showing something is a reasonable opener. These six are different — the customer has
 * told you what they want, and it is not a product.
 */
const NON_PRODUCT_INTENTS = new Set([
  "order_status",
  "human_handoff",
  "complaint",
  "return_or_exchange",
  "shipping_question",
  "payment_question",
]);

const RRF_K = 60;
const PER_RETRIEVER_LIMIT = 12;
const MAX_TOKEN_QUERIES = 3;

/** Words that carry no product signal — searching them returns the whole catalog. */
const STOP_TOKENS = new Set([
  "عايز", "عايزه", "عايزة", "عاوز", "عاوزه", "ممكن", "لو", "سمحت", "بكام", "كام", "سعر", "السعر",
  "متاح", "متوفر", "موجود", "عندكم", "عندك", "فيه", "مقاس", "مقاسات", "لون", "الوان", "الوان",
  "حاجة", "حاجه", "ايه", "ده", "دي", "علي", "على", "من", "في", "مع", "شكرا", "شكرن",
  "اعرف", "أعرف", "اشوف", "أشوف", "قولي", "قوليلي", "ابعت", "ابعتلي", "تمام", "طيب",
  "السلام", "عليكم", "اهلا", "أهلا", "ازيك", "صباح", "مساء", "الخير", "بس", "كده",
  "price", "size", "color", "colour", "available", "have", "you", "the", "for", "and", "want",
  "please", "hello", "thanks", "need", "looking", "show", "send",
]);

const meaningfulTokens = (value = "") =>
  [
    ...new Set(
      normalizeArabicForIntent(value)
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1)
        .filter((token) => !STOP_TOKENS.has(token))
        // A bare number is a size or a price, never a product name.
        .filter((token) => !/^\d+$/.test(token))
    ),
  ];

const productKey = (product = {}) => String(product?.id ?? product?.product_id ?? "");

/**
 * Reciprocal Rank Fusion. Each retriever contributes 1/(k + rank); k damps the
 * advantage of a single first place so agreement between retrievers wins.
 */
const fuseByReciprocalRank = (rankedLists = []) => {
  const scores = new Map();
  const products = new Map();
  const provenance = new Map();

  rankedLists.forEach(({ name, results, weight = 1 }) => {
    asArray(results).forEach((product, index) => {
      const key = productKey(product);
      if (!key) return;
      const contribution = weight / (RRF_K + index + 1);
      scores.set(key, (scores.get(key) || 0) + contribution);
      if (!products.has(key)) products.set(key, product);
      if (!provenance.has(key)) provenance.set(key, []);
      provenance.get(key).push(`${name}@${index + 1}`);
    });
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, score]) => ({
      ...products.get(key),
      retrieval_score: Number(score.toFixed(6)),
      retrieval_sources: provenance.get(key),
    }));
};

/** Every field worth matching a product name against, as raw text. */
const rawProductText = (product = {}) =>
  [
    product.name,
    product.product_name,
    product.title,
    product.brand,
    product.brand_name,
    product.category,
    product.category_name,
    product.product_type,
    product.style,
    product.sku,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");

const productHaystack = (product = {}) => arabicSearchText(rawProductText(product));

/** Arabic letters to their nearest Latin consonant, for skeleton matching. */
const TRANSLITERATION = Object.freeze({
  ا: "a", أ: "a", إ: "a", آ: "a", ب: "b", ت: "t", ث: "t", ج: "j", ح: "h", خ: "k",
  د: "d", ذ: "z", ر: "r", ز: "z", س: "s", ش: "s", ص: "s", ض: "d", ط: "t", ظ: "z",
  ع: "a", غ: "g", ف: "f", ق: "k", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", ة: "h",
  و: "w", ي: "y", ى: "a", ء: "", ئ: "y", ؤ: "w", پ: "b", چ: "j", ڤ: "f", گ: "g",
});

/**
 * Consonant skeleton, so an Arabic-spelled brand can match its Latin catalog name.
 *
 * The alias table only covers products someone remembered to add — it knows
 * "جوردن فور" but not "كروكس", so a customer asking for Crocs in Arabic matched
 * nothing at all. Dropping vowels and folding c/q to k makes the two spellings
 * converge on the same key:
 *
 *   كروكس -> k r w k s -> "krks"      crocs -> c r o c s -> "krks"
 *   نايك  -> n a y k   -> "nk"        nike  -> n i k e   -> "nk"
 *   اديداس -> a d y d a s -> "dds"    adidas               -> "dds"
 *
 * Arabic has no /p/ or /v/, so speakers substitute ب and ف. Folding p->b and v->f on
 * the Latin side makes both spellings converge: بوما/puma, فانز/vans.
 */
const latinSkeleton = (value = "") => {
  const transliterated = [...lower(value)]
    .map((char) => (TRANSLITERATION[char] !== undefined ? TRANSLITERATION[char] : char))
    .join("");
  return (
    transliterated
      .replace(/[^a-z0-9]/g, "")
      // Soft c first — "balance" is /s/, not /k/ — otherwise the blanket c->k below
      // turns it into "nblnk" and it stops matching "بالانس".
      .replace(/c(?=[eiy])/g, "s")
      .replace(/[ck]/g, "k")
      .replace(/q/g, "k")
      .replace(/x/g, "ks")
      .replace(/p/g, "b")
      .replace(/v/g, "f")
      // Arabic ز transliterates to z where English spells the same sound s ("vans").
      .replace(/z/g, "s")
      .replace(/[aeiouwy]/g, "")
      .replace(/(.)\1+/g, "$1")
  );
};

/**
 * Latin brand names the catalog is likely to use, keyed by consonant skeleton.
 *
 * The skeleton alone cannot be handed to SQL: `LIKE '%bm%'` does not find "Puma". The
 * skeleton is a JOIN KEY between the two spellings, so it has to resolve back to a
 * real Latin string before it can be searched. Without this step the Arabic token was
 * sent to SQL verbatim, matched nothing in a Latin catalog, and left
 * `applyEntityConstraints` with an empty list to filter — retrieval returned zero.
 *
 * Seeded from the shared lexicon because a list that only learns from the catalog
 * cannot help on the first request. `catalogBrands` overlays the tenant's real brands
 * on top, which is what covers brands nobody thought to list there.
 */
const brandSkeletonIndex = (extraBrands = []) => {
  const index = new Map();
  for (const brand of [...BRAND_CATALOG_NAMES, ...asArray(extraBrands)]) {
    const name = text(brand);
    if (name.length < 2) continue;
    // Multi-word brands are searchable whole and per word: "بالانس" alone should still
    // reach "New Balance".
    for (const variant of [name, ...name.split(/\s+/)]) {
      const skeleton = latinSkeleton(variant);
      if (skeleton.length < 2) continue;
      if (!index.has(skeleton)) index.set(skeleton, name);
    }
  }
  return index;
};

/**
 * Latin brand names whose consonant skeleton matches a token in the message.
 *
 * Exact skeleton equality only. Substring matching here was tried and rejected: the
 * skeleton alphabet is tiny, so "sk" is inside a large share of the lexicon and every
 * short Arabic token dragged in unrelated brands.
 */
const bridgeArabicBrands = (message, extraBrands = []) => {
  const index = brandSkeletonIndex(extraBrands);
  const found = new Set();
  const tokens = meaningfulTokens(message);

  for (const token of tokens) {
    // Already Latin — the phrase and token retrievers handle it.
    if (/^[a-z0-9-]+$/i.test(token)) continue;
    const skeleton = latinSkeleton(token);
    if (skeleton.length >= 2 && index.has(skeleton)) found.add(index.get(skeleton));
  }
  // Adjacent pairs, so "نيو بالانس" resolves to "New Balance" as one brand.
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const skeleton = latinSkeleton(`${tokens[i]} ${tokens[i + 1]}`);
    if (skeleton.length >= 3 && index.has(skeleton)) found.add(index.get(skeleton));
  }

  return [...found];
};

/**
 * Acceptable spellings of one entity: the folded Arabic form, the raw Latin form, the
 * alias engine's canonical form and search terms, and the consonant skeleton. Matching
 * any one of them satisfies the constraint.
 */
const constraintNeedles = (value) => {
  const needles = new Set();
  const skeletons = new Set();
  const add = (candidate) => {
    const folded = arabicSearchText(text(candidate));
    if (folded.length >= 2) needles.add(folded);
    const latin = lower(candidate).replace(/[^a-z0-9]/g, "");
    if (latin.length >= 2) needles.add(latin);
    const skeleton = latinSkeleton(candidate);
    // Short skeletons ("ks", "sd") collide with half the catalog; require real signal.
    if (skeleton.length >= 3) skeletons.add(skeleton);
  };

  add(value);
  const alias = resolveProductAlias(value);
  if (alias?.canonicalProduct) add(alias.canonicalProduct);
  for (const term of asArray(alias?.searchTerms).slice(0, 5)) add(term);

  return { needles: [...needles], skeletons: [...skeletons] };
};

/**
 * Entity constraints are a FILTER, not a ranking hint. If the customer said "كروكس",
 * an Air Jordan ranked first by every retriever is still wrong — the same failure the
 * grounding gate was built to catch, caught one stage earlier so the gate has better
 * candidates to work with.
 *
 * Applied only when at least one candidate satisfies the constraint, so a mis-read
 * entity narrows to nothing instead of emptying the list.
 */
const applyEntityConstraints = (products, understanding) => {
  const entities = understanding?.entities || {};
  let filtered = products;

  for (const field of ["product_model", "category", "brand"]) {
    const value = text(entities[field]);
    if (!value) continue;
    const { needles, skeletons } = constraintNeedles(value);
    if (!needles.length && !skeletons.length) continue;
    const matching = filtered.filter((product) => {
      const haystack = productHaystack(product);
      if (needles.some((needle) => haystack.includes(needle))) return true;
      const haystackSkeleton = latinSkeleton(rawProductText(product));
      return skeletons.some((skeleton) => haystackSkeleton.includes(skeleton));
    });
    if (matching.length) filtered = matching;
  }

  const budget = Number(entities.budget_max);
  if (Number.isFinite(budget) && budget > 0) {
    const withinBudget = filtered.filter((product) => {
      const price = Number(product.display_price ?? product.final_price ?? product.price ?? product.sale_price ?? 0);
      // A product with no usable price is not evidence of being over budget.
      return !Number.isFinite(price) || price <= 0 || price <= budget * 1.1;
    });
    if (withinBudget.length) filtered = withinBudget;
  }

  return filtered;
};

/**
 * Builds the queries to run, in priority order. Each is labelled so the fused result
 * can explain which retriever found a product — that provenance is what makes a bad
 * recommendation debuggable instead of mysterious.
 */
export const buildRetrievalQueries = ({ message = "", understanding = null, catalogBrands = [] } = {}) => {
  const queries = [];
  const seen = new Set();
  const push = (name, query, weight) => {
    const value = text(query);
    if (!value || value.length < 2) return;
    const dedupeKey = `${name}:${lower(value)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    queries.push({ name, query: value, weight });
  };

  push("phrase", message, 1);

  const entities = understanding?.entities || {};
  // Weighted above the raw phrase: what the customer MEANT beats what they typed.
  push("entity", entities.product_model, 1.4);
  push("entity", [entities.brand, entities.category].filter(Boolean).join(" "), 1.2);
  push("entity", entities.category, 1);

  const aliasSource = text(entities.product_model) || message;
  const aliasResult = resolveProductAlias(aliasSource);
  const hints = buildAliasAwareSearchHints({ text: aliasSource, aliasResult });
  // Only when the alias engine actually recognised a product: `searchTerms` is empty
  // otherwise, and `productQueryHints` degenerates to the normalized sentence, which
  // the phrase retriever already covers.
  if (hints?.hasAliasHint) {
    push("alias", hints.canonicalProduct, 1.3);
    for (const hint of asArray(hints.searchTerms).slice(0, 3)) push("alias", hint, 1.3);
  }

  // Above the raw tokens: a resolved Latin brand is a far stronger signal than the
  // Arabic token it came from, which SQL cannot match at all.
  for (const brand of bridgeArabicBrands([message, entities.brand, entities.product_model].filter(Boolean).join(" "), catalogBrands)) {
    push("brand", brand, 1.25);
  }

  for (const token of meaningfulTokens(message).slice(0, MAX_TOKEN_QUERIES)) {
    push("token", token, 0.7);
  }

  return queries;
};

/**
 * Keeps the strongest `max` retrievers.
 *
 * Needed because callers whose `runQuery` is expensive cannot afford ten of them. The
 * queries are built in construction order, not weight order, so slicing the array
 * directly would drop the entity and brand retrievers — the two that carry the most
 * signal — and keep the single-token ones, which are the weakest. Sorting first means
 * a bound costs recall gracefully instead of catastrophically.
 *
 * The sort is stable on ties, so equally-weighted retrievers keep their original order.
 */
const strongestQueries = (queries, max) => {
  if (!Number.isFinite(max) || max <= 0 || queries.length <= max) return queries;
  return [...queries]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.weight - a.entry.weight || a.index - b.index)
    .slice(0, max)
    .map((item) => item.entry);
};

/**
 * Runs the retrievers and returns one fused, entity-constrained list.
 *
 * @param {Function} runQuery async ({ tenantId, query, limit }) => product[] — injected
 *        so this composes with the existing SQL scorer instead of duplicating it, and
 *        so tests can drive it without a database.
 */
export const searchProductsHybrid = async ({
  tenantId,
  message = "",
  understanding = null,
  limit = 8,
  runQuery,
  catalogBrands = [],
  maxQueries = Infinity,
} = {}) => {
  if (typeof runQuery !== "function") throw new TypeError("runQuery is required");

  // Some questions are not shopping questions, and answering them with product cards
  // is worse than answering them with nothing. Measured against the live catalog:
  //   "عايز اكلم حد من الموظفين"        -> Classic Bag, David Jones Crossbody
  //   "الأوردر بتاعي رقم 4412 وصل فين؟" -> Crocs, SKECHERS SLIP INS
  // The token retriever latches onto incidental words ("حد", "رقم") and the ranker
  // happily returns its best match for them, because retrieval had no idea the
  // customer was asking for a human or chasing a delivery.
  if (NON_PRODUCT_INTENTS.has(text(understanding?.primary_intent))) {
    console.log("ai_hybrid_search_skipped", {
      tenant_id: tenantId,
      intent: understanding?.primary_intent,
      reason: "non_product_intent",
    });
    return [];
  }

  const queries = strongestQueries(buildRetrievalQueries({ message, understanding, catalogBrands }), maxQueries);
  if (!queries.length) return [];

  // One retriever failing must not fail the search — that is the whole point of
  // running several.
  const rankedLists = await Promise.all(
    queries.map(async ({ name, query, weight }) => {
      try {
        const results = await runQuery({ tenantId, query, limit: PER_RETRIEVER_LIMIT });
        return { name, weight, results: asArray(results) };
      } catch (error) {
        console.warn("[ai-hybrid-search] retriever failed", { retriever: name, message: error?.message });
        return { name, weight, results: [] };
      }
    })
  );

  // Semantic retrieval joins the fusion as one more ranked list rather than replacing
  // anything. It answers the queries the lexical retrievers structurally cannot — "حاجة
  // تناسب فرح" names no brand, model or category, so every LIKE-based retriever returns
  // nothing — while the lexical lists stay authoritative for the exact names customers
  // do use. Weighted just above a raw token and below a resolved entity: similarity is
  // a good way to FIND a product and a poor way to be certain about one.
  //
  // Inert unless pgvector is installed AND the flag is on; it returns [] otherwise, and
  // an empty list contributes nothing to the fusion.
  const semanticResults = await searchProductsSemantic({ tenantId, query: message, limit: PER_RETRIEVER_LIMIT }).catch(
    (error) => {
      console.warn("[ai-hybrid-search] semantic retriever failed", { message: error?.message });
      return [];
    }
  );
  if (semanticResults.length) rankedLists.push({ name: "semantic", weight: 0.9, results: semanticResults });

  const fused = fuseByReciprocalRank(rankedLists);
  const constrained = applyEntityConstraints(fused, understanding);

  console.log("ai_hybrid_search", {
    tenant_id: tenantId,
    retrievers: queries.map((entry) => entry.name),
    query_count: queries.length,
    fused_count: fused.length,
    after_constraints: constrained.length,
    returned: Math.min(constrained.length, limit),
  });

  return constrained.slice(0, Math.max(1, limit));
};

export const __testing = { fuseByReciprocalRank, applyEntityConstraints, meaningfulTokens, productHaystack, latinSkeleton };
