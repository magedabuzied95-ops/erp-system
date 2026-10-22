const text = (value = "") => String(value ?? "").trim();

const parseArray = (value) => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const AUDIENCE_ALIASES = Object.freeze({
  men: ["men", "man", "male", "mens", "رجال", "رجالي"],
  women: ["women", "woman", "female", "ladies", "lady", "نساء", "نسائي", "حريمي"],
  kids: ["kids", "kid", "children", "child", "boys", "girls", "اطفال", "أطفال", "طفل"],
});

const audienceKey = (value = "") => {
  const raw = text(value).toLowerCase();
  return Object.keys(AUDIENCE_ALIASES).find((key) => AUDIENCE_ALIASES[key].includes(raw)) || "";
};

// A size row stores "men,women,kids" when one colour sells to all three — the storefront splits it on
// commas (productAudienceFilterSql), so the feeds must too: read whole, it matched nothing and 544
// items shipped with no gender. product_audiences arrives as a JSON array (Google) or a comma list (Meta).
const audienceList = (value) => {
  const parts = Array.isArray(value) ? value : parseArray(value).length ? parseArray(value) : text(value).split(",");
  return [...new Set(parts.map(audienceKey).filter(Boolean))];
};

/*
  Which shop sections a row belongs to (men / women / kids), by the storefront's own precedence:
  the size row's audience, else the product's audiences, else its single gender column.
*/
export const resolveProductAudiences = (row = {}) => {
  for (const source of [row.variant_audience, row.product_audiences, row.product_gender]) {
    const list = audienceList(source);
    if (list.length) return ["men", "women", "kids"].filter((key) => list.includes(key));
  }
  return [];
};

// One audience mapping for every ad feed we publish (Meta and Google read the same row).
export const resolveProductAudience = (row = {}) => {
  const audiences = resolveProductAudiences(row);
  const men = audiences.includes("men");
  const women = audiences.includes("women");
  if (!audiences.length) return { gender: "", age_group: "" };
  if (!men && !women) return { gender: "unisex", age_group: "kids" };
  return { gender: men && women ? "unisex" : men ? "male" : "female", age_group: "adult" };
};

export default resolveProductAudience;
