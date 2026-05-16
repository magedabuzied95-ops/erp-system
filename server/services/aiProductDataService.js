const DEFAULT_MODEL = "gpt-4o-mini";
const FORBIDDEN_PLACEHOLDERS = [
  /\bstylish sneakers\b/gi,
  /\bfashion footwear\b/gi,
  /\bfashion shoes\b/gi,
  /\bgeneric product\b/gi,
  /\bstyle\b/gi,
];

const AR = {
  black: "\u0623\u0633\u0648\u062f",
  white: "\u0623\u0628\u064a\u0636",
  red: "\u0623\u062d\u0645\u0631",
  blue: "\u0623\u0632\u0631\u0642",
  green: "\u0623\u062e\u0636\u0631",
  gray: "\u0631\u0645\u0627\u062f\u064a",
  silver: "\u0641\u0636\u064a",
  gold: "\u0630\u0647\u0628\u064a",
  brown: "\u0628\u0646\u064a",
  beige: "\u0628\u064a\u062c",
  men: "\u0631\u062c\u0627\u0644\u064a",
  women: "\u0646\u0633\u0627\u0626\u064a",
  kids: "\u0644\u0644\u0623\u0637\u0641\u0627\u0644",
  unisex: "\u0644\u0644\u062c\u0646\u0633\u064a\u0646",
  sneaker: "\u0643\u0648\u062a\u0634\u064a",
  boot: "\u062c\u0632\u0645\u0629",
  slipper: "\u0634\u0628\u0634\u0628",
  bag: "\u0634\u0646\u0637\u0629",
  top: "\u062a\u064a\u0634\u064a\u0631\u062a",
  pants: "\u0628\u0646\u0637\u0644\u0648\u0646",
  casual: "\u0643\u0627\u062c\u0648\u0627\u0644",
  sport: "\u0631\u064a\u0627\u0636\u064a",
  streetwear: "\u0633\u062a\u0631\u064a\u062a \u0648\u064a\u0631",
  classic: "\u0643\u0644\u0627\u0633\u064a\u0643",
  modern: "\u0639\u0635\u0631\u064a",
};

const cleanText = (value = "") => {
  const text = String(value || "").trim();
  return text && !["null", "undefined", "n/a", "none"].includes(text.toLowerCase()) ? text : "";
};

const normalizeList = (value = []) => {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return Array.from(new Set(source.map(cleanText).filter(Boolean)));
};

const withoutPlaceholders = (value = "") => {
  let text = cleanText(value);
  FORBIDDEN_PLACEHOLDERS.forEach((pattern) => {
    text = text.replace(pattern, "");
  });
  return text.replace(/\s{2,}/g, " ").replace(/\s+([,.:])/g, "$1").trim();
};

const sanitizeList = (value = []) => normalizeList(value).map(withoutPlaceholders).filter(Boolean);

const clampConfidence = (value, fallback = 45) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const slugify = (value = "") =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

const translateColorAr = (value = "") => {
  const text = cleanText(value).toLowerCase();
  if (text.includes("black")) return AR.black;
  if (text.includes("white")) return AR.white;
  if (text.includes("red")) return AR.red;
  if (text.includes("blue")) return AR.blue;
  if (text.includes("green")) return AR.green;
  if (text.includes("grey") || text.includes("gray")) return AR.gray;
  if (text.includes("silver")) return AR.silver;
  if (text.includes("gold")) return AR.gold;
  if (text.includes("brown")) return AR.brown;
  if (text.includes("beige")) return AR.beige;
  return cleanText(value);
};

const translateGenderAr = (value = "") => {
  const text = cleanText(value).toLowerCase();
  if (/men|male|man|\u0631\u062c\u0627\u0644\u064a/.test(text)) return AR.men;
  if (/women|female|woman|\u0646\u0633\u0627\u0626\u064a/.test(text)) return AR.women;
  if (/kid|child|\u0623\u0637\u0641\u0627\u0644/.test(text)) return AR.kids;
  if (/unisex|\u0644\u0644\u062c\u0646\u0633\u064a\u0646/.test(text)) return AR.unisex;
  return cleanText(value);
};

const translateProductTypeAr = (value = "") => {
  const text = cleanText(value).toLowerCase();
  if (/sneaker|shoe|trainer/.test(text)) return AR.sneaker;
  if (/boot/.test(text)) return AR.boot;
  if (/slipper|slide|sandal/.test(text)) return AR.slipper;
  if (/bag|backpack|tote/.test(text)) return AR.bag;
  if (/shirt|tee|top/.test(text)) return AR.top;
  if (/pants|jeans|trouser/.test(text)) return AR.pants;
  return cleanText(value);
};

const translateStyleAr = (value = "") => {
  const text = cleanText(value).toLowerCase();
  const parts = [];
  if (/casual/.test(text)) parts.push(AR.casual);
  if (/sport|athletic|running|training/.test(text)) parts.push(AR.sport);
  if (/streetwear|street/.test(text)) parts.push(AR.streetwear);
  if (/classic|retro|heritage/.test(text)) parts.push(AR.classic);
  if (/modern/.test(text)) parts.push(AR.modern);
  return parts.length ? parts.join(" ") : cleanText(value);
};

const inferProductType = (context = {}) => {
  const source = [context.product_type, context.productType, context.category, context.name, context.product_name]
    .map(cleanText)
    .join(" ")
    .toLowerCase();

  if (/sneaker|shoe|trainer|footwear|boot|\u062d\u0630\u0627\u0621|\u0643\u0648\u062a\u0634\u064a|\u062c\u0632\u0645\u0629/.test(source)) return "sneaker";
  if (/slipper|slide|sandal|\u0634\u0628\u0634\u0628|\u0635\u0646\u062f\u0644/.test(source)) return "slipper";
  if (/bag|backpack|tote|\u062d\u0642\u064a\u0628\u0629|\u0634\u0646\u0637\u0629/.test(source)) return "bag";
  if (/shirt|tee|top|\u062a\u064a\u0634\u064a\u0631\u062a|\u0642\u0645\u064a\u0635/.test(source)) return "top";
  if (/pants|jeans|trouser|\u0628\u0646\u0637\u0644\u0648\u0646/.test(source)) return "pants";
  return cleanText(context.product_type || context.productType || context.category || "product");
};

const generateFallbackDescriptions = (context = {}) => {
  const name = cleanText(context.name) || "Product";
  const brand = cleanText(context.brand || context.manufacturer);
  const type = cleanText(context.productType || context.product_type || context.category) || "product";
  const style = cleanText(context.style) || "casual everyday";
  const gender = cleanText(context.gender);
  const grade = cleanText(context.grade);
  const colors = normalizeList(context.colors);
  const colorText = colors.length ? ` in ${colors.slice(0, 4).join(", ")}` : "";
  const colorPhrase = colors.length ? `${colors.slice(0, 3).join(" ")} ` : "";
  const title = withoutPlaceholders([brand, name, colorPhrase.trim(), grade, gender, type].filter(Boolean).join(" ")).slice(0, 68);
  const descriptionEn = `${[brand, name].filter(Boolean).join(" ")} ${colorText} ${gender ? `${gender} ` : ""}${type} with ${style} details${grade ? ` and ${grade} grade` : ""}. Built for casual daily outfits with a product-specific retail look.`
    .replace(/\s+/g, " ")
    .trim();
  const descriptionAr = `${translateProductTypeAr(type)} ${colors.map(translateColorAr).join(" \u0648")} ${grade ? `${grade} ` : ""}${translateGenderAr(gender)} ${brand || name} \u0628\u062a\u0641\u0627\u0635\u064a\u0644 ${translateStyleAr(style)} \u0645\u0646\u0627\u0633\u0628\u0629 \u0644\u0644\u0625\u0637\u0644\u0627\u0644\u0627\u062a \u0627\u0644\u064a\u0648\u0645\u064a\u0629 \u0648\u0627\u0644\u0643\u0627\u062c\u0648\u0627\u0644.`
    .replace(/\s+/g, " ")
    .trim();
  const seoDescription = `${name}${brand ? ` by ${brand}` : ""}: ${gender ? `${gender} ` : ""}${grade ? `${grade} ` : ""}${colorPhrase}${type} with ${style} details${colorText}.`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 156);

  return {
    description_ar: descriptionAr,
    description_en: withoutPlaceholders(descriptionEn),
    meta_title: title,
    seo_description: withoutPlaceholders(seoDescription),
    seo_keywords: sanitizeList([name, brand, context.category, gender, grade, type, style, ...colors]).join(", "),
    canonical_slug: slugify(`${brand ? `${brand} ` : ""}${name}`),
  };
};

const buildFallbackSuggestion = (input = {}, reason = "TEXT_FALLBACK") => {
  const current = input.current || input;
  const colors = normalizeList(current.colors || current.dominant_colors || current.color_name);
  const productType = inferProductType(current);
  const baseName =
    cleanText(current.name || current.product_name) ||
    cleanText([current.brand, productType].filter(Boolean).join(" ")) ||
    "Product";
  const context = {
    name: baseName,
    brand: current.brand,
    manufacturer: current.manufacturer,
    category: current.category,
    gender: current.gender,
    productType,
    style: current.style,
    grade: current.grade,
    colors,
    sizes: current.sizes,
    styleKeywords: normalizeList(current.style_keywords || current.classification),
  };
  const generated = generateFallbackDescriptions(context);
  const nameEn = withoutPlaceholders(current.name_en || current.name || current.product_name) || baseName;
  const nameAr = withoutPlaceholders(current.name_ar) || nameEn;

  return {
    source: reason,
    confidence: reason === "TEXT_FALLBACK" ? 35 : 0,
    progress: ["Analyzing image...", "Generating SEO...", "Generating descriptions..."],
    suggestions: {
      name_ar: nameAr,
      name_en: nameEn,
      description_ar: generated.description_ar,
      description_en: generated.description_en,
      meta_title_ar: nameAr,
      meta_title_en: generated.meta_title,
      seo_description_ar: generated.description_ar,
      seo_description_en: generated.seo_description,
      seo_keywords: generated.seo_keywords,
      canonical_slug: generated.canonical_slug || slugify(nameEn),
      suggested_category: cleanText(current.category),
      suggested_style: cleanText(current.style),
      suggested_product_type: productType,
      gender: cleanText(current.gender),
      grade: cleanText(current.grade),
      dominant_colors: colors,
      brand_resemblance: cleanText(current.brand || current.manufacturer),
      detected_model: cleanText(current.detected_model || current.model),
      classification: cleanText(current.style || "casual"),
      silhouette: cleanText(current.silhouette),
      fashion_category: cleanText(current.category),
      target_audience: cleanText(current.gender),
      detection_confidence: {
        colors: colors.length ? 55 : 20,
        style: cleanText(current.style) ? 50 : 25,
        product_type: productType && productType !== "product" ? 55 : 25,
      },
    },
  };
};

const extractJson = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const normalizeAiSuggestion = (raw = {}, fallback = {}) => {
  const suggestions = raw.suggestions || raw;
  const fallbackSuggestions = fallback.suggestions || {};
  const nameEn = withoutPlaceholders(suggestions.name_en || suggestions.english_name || suggestions.product_name_en) || fallbackSuggestions.name_en;
  const nameAr = withoutPlaceholders(suggestions.name_ar || suggestions.arabic_name || suggestions.product_name_ar) || fallbackSuggestions.name_ar;
  const descriptionEn = withoutPlaceholders(suggestions.description_en || suggestions.english_description) || fallbackSuggestions.description_en;
  const descriptionAr = withoutPlaceholders(suggestions.description_ar || suggestions.arabic_description) || fallbackSuggestions.description_ar;
  const seoDescriptionEn =
    withoutPlaceholders(suggestions.seo_description_en || suggestions.seo_description || suggestions.meta_description_en) ||
    fallbackSuggestions.seo_description_en;
  const seoDescriptionAr =
    withoutPlaceholders(suggestions.seo_description_ar || suggestions.meta_description_ar) || fallbackSuggestions.seo_description_ar;
  const detectionConfidence = suggestions.detection_confidence || raw.detection_confidence || {};

  return {
    source: cleanText(raw.source) || "OPENAI_VISION",
    confidence: clampConfidence(raw.confidence ?? suggestions.confidence, 78),
    progress: ["Analyzing image...", "Generating SEO...", "Generating descriptions..."],
    suggestions: {
      name_ar: nameAr,
      name_en: nameEn,
      description_ar: descriptionAr,
      description_en: descriptionEn,
      meta_title_ar: withoutPlaceholders(suggestions.meta_title_ar) || nameAr,
      meta_title_en: withoutPlaceholders(suggestions.meta_title_en || suggestions.meta_title) || fallbackSuggestions.meta_title_en,
      seo_description_ar: seoDescriptionAr || descriptionAr,
      seo_description_en: seoDescriptionEn || descriptionEn,
      seo_keywords: sanitizeList(suggestions.seo_keywords || suggestions.keywords).join(", ") || fallbackSuggestions.seo_keywords,
      canonical_slug: cleanText(suggestions.canonical_slug || suggestions.slug) || slugify(nameEn),
      suggested_category: cleanText(suggestions.suggested_category || suggestions.category) || fallbackSuggestions.suggested_category,
      suggested_style: cleanText(suggestions.suggested_style || suggestions.style) || fallbackSuggestions.suggested_style,
      suggested_product_type:
        cleanText(suggestions.suggested_product_type || suggestions.product_type) || fallbackSuggestions.suggested_product_type,
      gender: cleanText(suggestions.gender) || fallbackSuggestions.gender,
      grade: cleanText(suggestions.grade) || fallbackSuggestions.grade,
      dominant_colors: normalizeList(suggestions.dominant_colors || suggestions.colors || fallbackSuggestions.dominant_colors),
      brand_resemblance:
        cleanText(suggestions.brand_resemblance || suggestions.brand_style_resemblance) || fallbackSuggestions.brand_resemblance,
      detected_model: cleanText(suggestions.detected_model || suggestions.model) || fallbackSuggestions.detected_model,
      classification: cleanText(suggestions.classification) || fallbackSuggestions.classification,
      silhouette: cleanText(suggestions.silhouette) || fallbackSuggestions.silhouette,
      fashion_category: cleanText(suggestions.fashion_category) || fallbackSuggestions.fashion_category,
      target_audience: cleanText(suggestions.target_audience) || fallbackSuggestions.target_audience,
      detection_confidence: {
        colors: clampConfidence(detectionConfidence.colors, fallbackSuggestions.detection_confidence?.colors || 70),
        style: clampConfidence(detectionConfidence.style, fallbackSuggestions.detection_confidence?.style || 70),
        product_type: clampConfidence(
          detectionConfidence.product_type ?? detectionConfidence.productType,
          fallbackSuggestions.detection_confidence?.product_type || 70
        ),
      },
    },
  };
};

const buildPrompt = (current = {}) => `Analyze the uploaded product image and combine it with any existing fields.

Existing fields:
${JSON.stringify(current, null, 2)}

Return strict JSON only using this shape:
{
  "confidence": 0-100,
  "suggestions": {
    "name_ar": "",
    "name_en": "",
    "description_ar": "",
    "description_en": "",
    "meta_title_ar": "",
    "meta_title_en": "",
    "seo_description_ar": "",
    "seo_description_en": "",
    "seo_keywords": ["keyword"],
    "canonical_slug": "",
    "suggested_category": "",
    "suggested_style": "",
    "suggested_product_type": "",
    "gender": "",
    "grade": "mirror/original/local/import/premium/unknown",
    "dominant_colors": ["color"],
    "brand_resemblance": "",
    "detected_model": "",
    "classification": "casual/sport/streetwear/running/classic",
    "silhouette": "low-top/high-top/slip-on/sandal/boot/bag/apparel shape",
    "fashion_category": "sneakers/shoes/apparel/bags/accessories",
    "target_audience": "men/women/kids/unisex",
    "detection_confidence": {
      "colors": 0,
      "style": 0,
      "product_type": 0
    }
  }
}

Image recognition requirements:
- Identify visible dominant colors, silhouette, product type, target gender, fashion category, and whether the look is casual, sport, streetwear, running, classic, or similar.
- Recognize brand-style resemblance from visible design cues or entered fields, but do not claim authenticity unless the existing fields explicitly say the product is original/authentic.
- For famous-inspired footwear, name the visual model only when visible or supplied, such as Superstar, Air Force, Samba, Campus, Gazelle, Jordan, Dunk, Yeezy, etc.
- Use image evidence plus existing fields. Existing brand, grade, gender, category, color, and look fields should refine the result.
- SEO titles must be specific, e.g. "Adidas Superstar Black White Mirror Sneakers For Men", never generic.
- SEO keywords must include multi-word purchase phrases from the detected image, e.g. "black white sneakers", "men's casual shoes", "shell toe sneakers".
- Arabic must sound premium for Egyptian ecommerce and include color, product type, gender, grade, and look when available.
- Never output placeholder wording: "Style", "Stylish sneakers", "Fashion footwear", "fashion shoes", or generic filler.
Keep English concise and retail-ready.`;

const getResponseText = (payload = {}) => {
  if (typeof payload.output_text === "string") return payload.output_text;
  const blocks = Array.isArray(payload.output) ? payload.output : [];
  return blocks
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text || content.output_text || "")
    .filter(Boolean)
    .join("\n");
};

const callOpenAiVision = async ({ imageUrl, imageBase64, current }) => {
  const apiKey = cleanText(process.env.OPENAI_API_KEY);
  if (!apiKey) return null;
  const image = cleanText(imageBase64 || imageUrl);
  if (!image) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cleanText(process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL) || DEFAULT_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPrompt(current) },
            { type: "input_image", image_url: image },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`OpenAI vision request failed: ${response.status} ${message}`.trim());
  }

  const payload = await response.json();
  return extractJson(getResponseText(payload));
};

export const generateAiProductData = async (input = {}) => {
  const fallback = buildFallbackSuggestion(input);
  try {
    const raw = await callOpenAiVision({
      imageUrl: input.image_url,
      imageBase64: input.image_base64_optional || input.image_base64,
      current: input.current || {},
    });
    if (!raw) return fallback;
    return normalizeAiSuggestion(raw, fallback);
  } catch (error) {
    console.error("[ai-product-data] vision generation failed", error);
    return fallback;
  }
};
