const AR = {
  men: "\u0631\u062c\u0627\u0644\u064a",
  women: "\u0646\u0633\u0627\u0626\u064a",
  kids: "\u0644\u0644\u0623\u0637\u0641\u0627\u0644",
  unisex: "\u0644\u0644\u062c\u0646\u0633\u064a\u0646",
  shoe: "\u062d\u0630\u0627\u0621",
  top: "\u062a\u064a\u0634\u064a\u0631\u062a",
  pants: "\u0628\u0646\u0637\u0644\u0648\u0646",
  dress: "\u0641\u0633\u062a\u0627\u0646",
  bag: "\u062d\u0642\u064a\u0628\u0629",
  product: "\u0645\u0646\u062a\u062c",
  mirror: "\u0645\u064a\u0631\u0648\u0631",
  original: "\u0623\u0648\u0631\u064a\u062c\u064a\u0646\u0627\u0644",
  premium: "\u0628\u0631\u064a\u0645\u064a\u0648\u0645",
  modern: "\u0639\u0635\u0631\u064a",
  casual: "\u0643\u0627\u062c\u0648\u0627\u0644",
  classic: "\u0643\u0644\u0627\u0633\u064a\u0643\u064a",
  sport: "\u0631\u064a\u0627\u0636\u064a",
  comfortableMaterial: "\u062e\u0627\u0645\u0627\u062a \u0645\u0631\u064a\u062d\u0629",
  everyday: "\u0645\u0646\u0627\u0633\u0628 \u0644\u0644\u0625\u0637\u0644\u0627\u0644\u0627\u062a \u0627\u0644\u064a\u0648\u0645\u064a\u0629 \u0648\u0627\u0644\u0643\u0627\u062c\u0648\u0627\u0644",
  availableColors: "\u0645\u062a\u0648\u0641\u0631 \u0628\u0623\u0644\u0648\u0627\u0646",
  availableSizes: "\u0648\u0645\u0642\u0627\u0633\u0627\u062a",
  designedFor: "\u0645\u0635\u0645\u0645 \u0644\u064a\u0642\u062f\u0645 \u062d\u0636\u0648\u0631\u0627 \u0623\u0646\u064a\u0642\u0627 \u0648\u0633\u0647\u0648\u0644\u0629 \u0641\u064a \u0627\u0644\u062a\u0646\u0633\u064a\u0642",
};

const cleanText = (value = "") => {
  const text = String(value || "").trim();
  return text && !["null", "undefined", "n/a", "none"].includes(text.toLowerCase()) ? text : "";
};

const uniqueTextValues = (values = []) => Array.from(new Set(values.map(cleanText).filter(Boolean)));

const formatList = (values = [], locale = "en") => {
  const items = uniqueTextValues(values);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return new Intl.ListFormat(locale === "ar" ? "ar" : "en", { style: "long", type: "conjunction" }).format(items);
};

const slugify = (value = "") =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

const truncateSentence = (value = "", max = 156) => {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  return `${clipped.slice(0, clipped.lastIndexOf(" ") > 90 ? clipped.lastIndexOf(" ") : clipped.length).trim()}.`;
};

const normalizeGender = (value = "", locale = "en") => {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  if (["men", "male", "man", "رجالي"].includes(text)) return locale === "ar" ? AR.men : "men's";
  if (["women", "female", "woman", "نسائي"].includes(text)) return locale === "ar" ? AR.women : "women's";
  if (["kids", "children", "child", "أطفال"].includes(text)) return locale === "ar" ? AR.kids : "kids'";
  if (["unisex", "للجنسين"].includes(text)) return locale === "ar" ? AR.unisex : "unisex";
  return cleanText(value);
};

const inferTypeEn = (context = {}) => {
  const source = [context.productType, context.category, context.name].map(cleanText).join(" ").toLowerCase();
  if (/sneaker|shoe|footwear|boot|حذاء|كوتشي|جزمة/.test(source)) return "sneakers";
  if (/shirt|tee|t-shirt|top|قميص|تيشيرت/.test(source)) return "top";
  if (/pants|trouser|jeans|بنطلون/.test(source)) return "pants";
  if (/dress|فستان/.test(source)) return "dress";
  if (/bag|شنطة|حقيبة/.test(source)) return "bag";
  return cleanText(context.productType || context.category || "product");
};

const inferTypeAr = (context = {}) => {
  const source = [context.productType, context.category, context.name].map(cleanText).join(" ").toLowerCase();
  if (/sneaker|shoe|footwear|boot|حذاء|كوتشي|جزمة/.test(source)) return AR.shoe;
  if (/shirt|tee|t-shirt|top|قميص|تيشيرت/.test(source)) return AR.top;
  if (/pants|trouser|jeans|بنطلون/.test(source)) return AR.pants;
  if (/dress|فستان/.test(source)) return AR.dress;
  if (/bag|شنطة|حقيبة/.test(source)) return AR.bag;
  return cleanText(context.productType || context.category || AR.product);
};

const normalizeGradeEn = (value = "") => {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  if (text.includes("mirror")) return "mirror";
  if (text.includes("original")) return "original";
  if (text.includes("premium")) return "premium";
  return cleanText(value);
};

const normalizeGradeAr = (value = "") => {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  if (text.includes("mirror")) return AR.mirror;
  if (text.includes("original")) return AR.original;
  if (text.includes("premium")) return AR.premium;
  return cleanText(value);
};

const styleWordsEn = (context = {}) => {
  const values = uniqueTextValues([context.style, ...(Array.isArray(context.styleKeywords) ? context.styleKeywords : [])]);
  return values.length ? values : ["modern casual"];
};

const styleWordsAr = (context = {}) => {
  const joined = styleWordsEn(context).join(" ").toLowerCase();
  if (/classic/.test(joined)) return [AR.classic];
  if (/sport/.test(joined)) return [AR.sport];
  if (/casual|daily|everyday|modern/.test(joined)) return [AR.modern, AR.casual];
  return uniqueTextValues([context.style]).length ? uniqueTextValues([context.style]) : [AR.modern, AR.casual];
};

export const generateProductDescriptions = (rawContext = {}) => {
  const context = {
    name: cleanText(rawContext.name),
    brand: cleanText(rawContext.brand || rawContext.manufacturer),
    category: cleanText(rawContext.category),
    gender: cleanText(rawContext.gender),
    productType: cleanText(rawContext.productType || rawContext.product_type),
    grade: cleanText(rawContext.grade),
    material: cleanText(rawContext.material),
    colors: uniqueTextValues(rawContext.colors),
    sizes: uniqueTextValues(rawContext.sizes),
    style: cleanText(rawContext.style),
    styleKeywords: uniqueTextValues(rawContext.styleKeywords),
    sellingPoints: uniqueTextValues(rawContext.sellingPoints),
  };

  if (!context.name) {
    return {
      description_ar: "",
      description_en: "",
      meta_title: "",
      seo_description: "",
      seo_keywords: "",
      canonical_slug: "",
    };
  }

  const gradeEn = normalizeGradeEn(context.grade);
  const gradeAr = normalizeGradeAr(context.grade);
  const genderEn = normalizeGender(context.gender, "en");
  const genderAr = normalizeGender(context.gender, "ar");
  const typeEn = inferTypeEn(context);
  const typeAr = inferTypeAr(context);
  const stylesEn = styleWordsEn(context);
  const stylesAr = styleWordsAr(context);
  const colorsEn = context.colors.length ? ` Available in ${formatList(context.colors, "en")}.` : "";
  const colorsAr = context.colors.length ? ` ${AR.availableColors} ${formatList(context.colors, "ar")}.` : "";
  const sizesEn = context.sizes.length ? ` Sizes include ${formatList(context.sizes.slice(0, 8), "en")}.` : "";
  const sizesAr = context.sizes.length ? ` ${AR.availableSizes} ${formatList(context.sizes.slice(0, 8), "ar")}.` : "";
  const materialEn = context.material ? `crafted with ${context.material}` : "built for a comfortable everyday feel";
  const materialAr = context.material ? `\u0628\u062e\u0627\u0645\u0629 ${context.material}` : AR.comfortableMaterial;
  const sellingEn = context.sellingPoints.length ? ` Key details: ${formatList(context.sellingPoints, "en")}.` : "";
  const sellingAr = context.sellingPoints.length ? ` \u0645\u0632\u0627\u064a\u0627\u0647: ${formatList(context.sellingPoints, "ar")}.` : "";

  const enParts = uniqueTextValues(["Premium", genderEn, gradeEn, context.brand, typeEn]);
  const descriptionEn = `${enParts.join(" ")} with a ${formatList(stylesEn, "en")} design, ${materialEn}, and a polished look for daily outfits and casual wear.${colorsEn}${sizesEn}${sellingEn}`.replace(/\s+/g, " ").trim();

  const arParts = uniqueTextValues([typeAr, genderAr, gradeAr, context.brand]);
  const descriptionAr = `${arParts.join(" ")} \u0628\u062a\u0635\u0645\u064a\u0645 ${formatList(stylesAr, "ar")} \u0648${materialAr}، ${AR.everyday}. ${AR.designedFor}.${colorsAr}${sizesAr}${sellingAr}`.replace(/\s+/g, " ").trim();

  const titleParts = uniqueTextValues([context.brand, context.name, genderEn, gradeEn, typeEn]);
  const metaTitle = titleParts.join(" ").slice(0, 68);
  const metaDescription = truncateSentence(
    `${context.name} ${context.brand ? `by ${context.brand}` : ""}: ${genderEn ? `${genderEn} ` : ""}${gradeEn ? `${gradeEn} ` : ""}${typeEn} with ${formatList(stylesEn, "en")} details${context.colors.length ? ` in ${formatList(context.colors.slice(0, 4), "en")}` : ""}.`,
    156
  );
  const keywords = uniqueTextValues([
    context.name,
    context.brand,
    context.category,
    genderEn,
    gradeEn,
    typeEn,
    ...stylesEn,
    ...context.colors,
  ]).join(", ");

  return {
    description_ar: descriptionAr,
    description_en: descriptionEn,
    meta_title: metaTitle,
    seo_description: metaDescription,
    seo_keywords: keywords,
    canonical_slug: slugify(`${context.brand ? `${context.brand} ` : ""}${context.name}`),
  };
};

export const emptyProductDescriptions = {
  description_ar: "",
  description_en: "",
  meta_title: "",
  seo_description: "",
  seo_keywords: "",
  canonical_slug: "",
};

export const safeGenerateProductDescriptions = (rawContext = {}) => {
  try {
    return {
      ...emptyProductDescriptions,
      ...generateProductDescriptions(rawContext),
    };
  } catch (error) {
    console.error("[product-descriptions] generation failed", error);
    return { ...emptyProductDescriptions };
  }
};
