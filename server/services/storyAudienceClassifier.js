const normalizeAudienceText = (...values) =>
  values
    .flat(Infinity)
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[_-]+/g, " ");

const AUDIENCE_PATTERNS = {
  offers: /\b(offers?|sale|discount|promotion)\b|عرض|عروض|تخفيض|خصم/u,
  women: /\b(women|woman|female|ladies|lady)\b|حريمي|نسائي|نساء|سيدات|بناتي/u,
  kids: /\b(kids?|children|child|boys?|girls?)\b|اطفال|طفل|اولاد|بنات/u,
  men: /\b(men|man|male|mens)\b|رجالي|رجال|رجل/u,
};

export const classifyStoryAudience = (...values) => {
  const text = normalizeAudienceText(...values);
  if (!text) return null;
  for (const audience of ["offers", "women", "kids", "men"]) {
    if (AUDIENCE_PATTERNS[audience].test(text)) return audience;
  }
  return null;
};

