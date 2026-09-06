/* Product SEO audit — the score and checklist the product editor shows next to
 * the "Product Content & SEO" section.
 *
 * Pure and framework-free so the same rules run in the editor (live, as the
 * merchant types) and in node tests. Every rule reports an id, a status and the
 * measured value; the caller turns ids into translated copy. Weights sum to
 * 100 so the score is a plain percentage.
 *
 * Ranges follow what Google actually renders: ~60 characters of title on
 * desktop, ~155 characters of description before truncation. Arabic glyphs
 * are narrower than the pixel model Google uses for Latin text, so a slightly
 * generous character budget is fine for this catalogue.
 */

export const META_TITLE_MIN = 30;
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MIN = 70;
export const META_DESCRIPTION_MAX = 160;
export const SLUG_MAX = 80;
export const KEYWORDS_MIN = 3;
export const KEYWORDS_MAX = 12;
export const BODY_WORDS_MIN = 40;

const text = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();

export const countWords = (value = "") => {
  const clean = text(value);
  return clean ? clean.split(" ").filter(Boolean).length : 0;
};

export const splitKeywords = (value = "") => {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,،\n]/);
  const seen = new Set();
  const out = [];
  for (const item of source) {
    const clean = text(item);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
};

export const joinKeywords = (items = []) => splitKeywords(items).join(", ");

/* Latin lowercase, hyphen separated, no leading/trailing hyphen. Arabic letters
 * survive so an Arabic-only name still produces a slug, but Latin is preferred
 * because the catalogue URLs are Latin today. */
export const slugifyProductSlug = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);

export const isCleanSlug = (value = "") => {
  const clean = String(value ?? "");
  if (!clean) return false;
  if (clean.length > SLUG_MAX) return false;
  return clean === slugifyProductSlug(clean) && !/[A-Z\s]/.test(clean);
};

const inRange = (length, min, max) => {
  if (length === 0) return "fail";
  if (length < min || length > max) return "warn";
  return "pass";
};

const containsToken = (haystack = "", needle = "") => {
  const source = text(haystack).toLowerCase();
  const target = text(needle).toLowerCase();
  if (!source || !target) return false;
  if (source.includes(target)) return true;
  // A brand or model written in Latin inside an Arabic title still counts when
  // its first word appears (e.g. "Nike" from "Nike Air Force 1").
  const firstWord = target.split(" ")[0];
  return firstWord.length >= 3 && source.includes(firstWord);
};

const RULES = [
  {
    id: "metaTitle",
    weight: 20,
    run: (input) => {
      const length = text(input.metaTitle).length;
      return { status: inRange(length, META_TITLE_MIN, META_TITLE_MAX), value: length, min: META_TITLE_MIN, max: META_TITLE_MAX };
    },
  },
  {
    id: "metaDescription",
    weight: 20,
    run: (input) => {
      const length = text(input.seoDescription).length;
      return { status: inRange(length, META_DESCRIPTION_MIN, META_DESCRIPTION_MAX), value: length, min: META_DESCRIPTION_MIN, max: META_DESCRIPTION_MAX };
    },
  },
  {
    id: "slug",
    weight: 15,
    run: (input) => {
      const slug = text(input.canonicalSlug);
      if (!slug) return { status: "fail", value: 0 };
      return { status: isCleanSlug(slug) ? "pass" : "warn", value: slug.length, max: SLUG_MAX };
    },
  },
  {
    id: "keywords",
    weight: 10,
    run: (input) => {
      const count = splitKeywords(input.seoKeywords).length;
      return { status: inRange(count, KEYWORDS_MIN, KEYWORDS_MAX), value: count, min: KEYWORDS_MIN, max: KEYWORDS_MAX };
    },
  },
  {
    id: "descriptionAr",
    weight: 15,
    run: (input) => {
      const words = countWords(input.descriptionAr);
      return { status: words === 0 ? "fail" : words < BODY_WORDS_MIN ? "warn" : "pass", value: words, min: BODY_WORDS_MIN };
    },
  },
  {
    id: "descriptionEn",
    weight: 10,
    run: (input) => {
      const words = countWords(input.descriptionEn);
      return { status: words === 0 ? "fail" : words < BODY_WORDS_MIN ? "warn" : "pass", value: words, min: BODY_WORDS_MIN };
    },
  },
  {
    id: "coverImage",
    weight: 5,
    run: (input) => ({ status: text(input.coverImage) ? "pass" : "fail", value: text(input.coverImage) ? 1 : 0 }),
  },
  {
    id: "brandInTitle",
    weight: 5,
    run: (input) => {
      const title = text(input.metaTitle);
      if (!title) return { status: "fail", value: 0 };
      const hit = containsToken(title, input.brand) || containsToken(title, input.name);
      return { status: hit ? "pass" : "warn", value: hit ? 1 : 0 };
    },
  },
];

const STATUS_CREDIT = { pass: 1, warn: 0.5, fail: 0 };

export const auditProductSeo = (input = {}) => {
  const checks = RULES.map((rule) => {
    const result = rule.run(input) || { status: "fail", value: 0 };
    return { id: rule.id, weight: rule.weight, ...result };
  });
  const earned = checks.reduce((sum, check) => sum + check.weight * (STATUS_CREDIT[check.status] ?? 0), 0);
  const score = Math.round(earned);
  const grade = score >= 80 ? "excellent" : score >= 55 ? "good" : "weak";
  return { score, grade, checks };
};

export const seoLengthTone = (length, min, max) => {
  if (!length) return "empty";
  if (length < min) return "short";
  if (length > max) return "long";
  return "ok";
};
