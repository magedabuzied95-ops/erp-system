import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 20_000;

let openaiClient = null;

const cleanText = (value = "") => {
  const text = String(value ?? "").trim();
  return text && !["null", "undefined", "n/a", "none"].includes(text.toLowerCase()) ? text : "";
};

const normalizeList = (value = []) => {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return Array.from(new Set(source.map(cleanText).filter(Boolean)));
};

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getClient = () => {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: positiveNumber(process.env.OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    });
  }
  return openaiClient;
};

const productDescriptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["arabic_description", "english_description"],
  properties: {
    arabic_description: { type: "string" },
    english_description: { type: "string" },
  },
};

const compactContext = (input = {}) => {
  const current = input.current || input;
  return {
    product_name: cleanText(current.product_name || current.name || input.product_name || input.name),
    category: cleanText(current.category || input.category),
    brand: cleanText(current.brand || input.brand),
    manufacturer: cleanText(current.manufacturer || input.manufacturer),
    colors: normalizeList(current.colors || current.color_name || input.colors || input.color_name),
    sizes: normalizeList(current.sizes || input.sizes),
    style: cleanText(current.style || input.style),
    gender: cleanText(current.gender || input.gender),
    product_type: cleanText(current.productType || current.product_type || input.productType || input.product_type),
    material: cleanText(current.material || input.material),
    grade: cleanText(current.grade || input.grade),
    selling_vibe: cleanText(current.selling_vibe || current.vibe || input.selling_vibe || input.vibe),
    tone: cleanText(input.tone || input.prompt_customization || current.prompt_customization),
  };
};

const translateArabicFallbackTerm = (value = "", type = "generic") => {
  const text = cleanText(value);
  const normalized = text.toLowerCase();
  if (type === "gender") {
    if (/men|male|man/.test(normalized)) return "رجالي";
    if (/women|female|woman/.test(normalized)) return "حريمي";
    if (/kid|child|boy|girl/.test(normalized)) return "أطفال";
    if (/unisex/.test(normalized)) return "للجنسين";
  }
  if (/sneaker|shoe|trainer/.test(normalized)) return "كوتشي";
  if (/boot/.test(normalized)) return "جزمة";
  if (/slipper|slide|sandal/.test(normalized)) return "شبشب";
  if (/streetwear|street/.test(normalized)) return "ستريت وير";
  if (/sport|athletic|training|running/.test(normalized)) return "رياضي";
  if (/casual/.test(normalized)) return "كاجوال";
  return text;
};

const fallbackDescription = (context = {}) => {
  const name = cleanText(context.product_name) || "Product";
  const brand = cleanText(context.brand);
  const category = cleanText(context.category || context.product_type) || "item";
  const colors = normalizeList(context.colors).slice(0, 5);
  const sizes = normalizeList(context.sizes).slice(0, 8);
  const style = cleanText(context.style || context.selling_vibe) || "casual";
  const gender = cleanText(context.gender);
  const material = cleanText(context.material);
  const brandPrefix = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "";
  const displayName = [brandPrefix, name].filter(Boolean).join(" ");
  const genderPhrase = gender ? `${gender} ` : "";
  const colorText = colors.length ? `Available in ${colors.join(", ")}` : "Designed with versatile colorways";
  const sizeText = sizes.length ? `with sizes ${sizes.join(", ")}` : "with practical everyday sizing";
  const materialText = material ? ` ${material} material` : "";
  const englishDescription = `${displayName} is a storefront-ready ${category} for ${genderPhrase || "everyday "}customers with a ${style} look.${materialText ? ` Made with${materialText}.` : ""} ${colorText} and ${sizeText}, it is easy to style for daily outfits, streetwear looks, and confident casual wear.`
    .replace(/\s+/g, " ")
    .trim();
  const arabicCategory = translateArabicFallbackTerm(category);
  const arabicStyle = translateArabicFallbackTerm(style);
  const arabicGender = translateArabicFallbackTerm(gender, "gender");
  const arabicDescription = `${displayName} ${arabicCategory} بطابع ${arabicStyle} مناسب للبس اليومي والكاجوال في السوق المصري.${arabicGender ? ` مناسب لـ ${arabicGender}.` : ""}${material ? ` الخامة: ${material}.` : ""} متوفر بألوان ${colors.length ? colors.join("، ") : "عملية"}${sizes.length ? ` ومقاسات ${sizes.join("، ")}` : ""}، واختيار مناسب للي بيدور على شكل مميز وسهل التنسيق.`
    .replace(/\s+/g, " ")
    .trim();

  return {
    arabic_description: arabicDescription,
    english_description: englishDescription,
  };
};

const requestedTargets = (target = "all") => {
  const normalized = cleanText(target).toLowerCase();
  return {
    arabic: normalized === "all" || normalized === "ar" || normalized === "arabic",
    english: normalized === "all" || normalized === "en" || normalized === "english",
  };
};

const buildPrompt = (context = {}, target = "all") => {
  const targets = requestedTargets(target);
  return [
    "Generate ecommerce product descriptions for an ERP product editor.",
    "Return strict JSON only with keys arabic_description and english_description.",
    targets.arabic
      ? "For arabic_description: write natural Arabic for Egyptian ecommerce customers, not a robotic translation. Use common search wording customers actually use."
      : "For arabic_description: return an empty string.",
    targets.english
      ? "For english_description: write clean storefront-ready English copy with a premium ecommerce tone."
      : "For english_description: return an empty string.",
    "Use only supplied product facts: product name, category, brand, colors, sizes, style, gender, material, and selling vibe.",
    "Mention available colors and sizes naturally, without listing every color repeatedly.",
    "Do not claim material, authenticity, technology, comfort features, or performance benefits unless supplied.",
    "Avoid keyword stuffing and avoid repeating color names excessively.",
    "Do not use fake urgency, fake discounts, fake shipping claims, or unverifiable claims.",
    "Keep each description around 70-110 words.",
    context.tone ? `Optional tone customization: ${context.tone}.` : "",
    `Product context:\n${JSON.stringify(context, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const normalizeGenerated = (raw = {}, fallback = {}, target = "all") => {
  const targets = requestedTargets(target);
  return {
    arabic_description: targets.arabic ? cleanText(raw.arabic_description || raw.description_ar) || fallback.arabic_description : "",
    english_description: targets.english ? cleanText(raw.english_description || raw.description_en) || fallback.english_description : "",
  };
};

export const generateProductDescription = async (input = {}) => {
  const context = compactContext(input);
  const target = cleanText(input.target || input.language || "all").toLowerCase() || "all";
  const fallback = fallbackDescription(context);
  const requestId = cleanText(input.request_id) || `product-description-${Date.now()}`;

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[product-description] OPENAI_API_KEY missing; using fallback", { requestId });
    return {
      ...normalizeGenerated({}, fallback, target),
      source: "LOCAL_FALLBACK",
    };
  }

  const startedAt = Date.now();
  try {
    console.log("[product-description] OpenAI request start", {
      requestId,
      target,
      model: process.env.OPENAI_PRODUCT_DESCRIPTION_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    });

    const response = await getClient().responses.create(
      {
        model: process.env.OPENAI_PRODUCT_DESCRIPTION_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions: "You are an expert ecommerce copywriter for fashion, footwear, and retail catalog pages.",
        input: buildPrompt(context, target),
        text: {
          format: {
            type: "json_schema",
            name: "product_descriptions",
            strict: true,
            schema: productDescriptionSchema,
          },
          verbosity: "medium",
        },
      },
      {
        timeout: positiveNumber(process.env.OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        maxRetries: 0,
      }
    );

    const parsed = JSON.parse(response.output_text || "{}");
    console.log("[product-description] OpenAI request end", {
      requestId,
      durationMs: Date.now() - startedAt,
      status: response?.status || "completed",
    });

    return {
      ...normalizeGenerated(parsed, fallback, target),
      source: "OPENAI",
    };
  } catch (error) {
    console.error("[product-description] OpenAI request failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      name: error?.name,
      status: error?.status,
      code: error?.code,
      type: error?.type,
      message: error?.message,
    });
    return {
      ...normalizeGenerated({}, fallback, target),
      source: "LOCAL_FALLBACK",
      error: process.env.NODE_ENV === "production" ? undefined : error?.message || "OpenAI request failed",
    };
  }
};
