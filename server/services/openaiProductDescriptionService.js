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

const socialCaptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hook", "body", "cta", "hashtags"],
  properties: {
    hook: { type: "string" },
    body: { type: "string" },
    cta: { type: "string" },
    hashtags: {
      type: "array",
      items: { type: "string" },
    },
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
    gender: cleanText(current.gender || input.gender),
    product_type: cleanText(current.productType || current.product_type || input.productType || input.product_type),
    material: cleanText(current.material || input.material),
    grade: cleanText(current.grade || input.grade),
    selling_vibe: cleanText(current.selling_vibe || current.vibe || input.selling_vibe || input.vibe),
    tone: cleanText(input.tone || input.prompt_customization || current.prompt_customization),
  };
};

const compactSocialCaptionContext = (input = {}) => {
  const current = input.current || input;
  return {
    product_name: cleanText(current.product_name || current.name || input.product_name || input.name),
    brand: cleanText(current.brand || current.brand_name || current.manufacturer || input.brand || input.brand_name || input.manufacturer),
    category: cleanText(current.category || current.category_name || input.category || input.category_name),
    product_type: cleanText(current.product_type || current.productType || input.product_type || input.productType),
    gender: cleanText(current.gender || input.gender),
    audience: cleanText(current.audience || input.audience),
    description: cleanText(current.description || input.description),
    short_description: cleanText(current.short_description || current.shortDescription || input.short_description || input.shortDescription),
    features: normalizeList(current.features || current.feature_list || input.features || input.feature_list),
    materials: normalizeList(current.materials || current.material || input.materials || input.material),
    available_colors: normalizeList(current.available_colors || current.colors || current.color_list || input.available_colors || input.colors || input.color_list),
    available_sizes: normalizeList(current.available_sizes || current.sizes || input.available_sizes || input.sizes),
    base_price: cleanText(current.base_price || input.base_price),
    current_price: cleanText(current.current_price || current.sale_price || current.price || input.current_price || input.sale_price || input.price),
    original_price: cleanText(current.original_price || current.price || input.original_price || input.price),
    discount_percent: cleanText(current.discount_percent || input.discount_percent),
    sale_price: cleanText(current.sale_price || input.sale_price),
    old_crossed_price: cleanText(current.old_crossed_price || input.old_crossed_price),
    sale_active: cleanText(current.sale_active || input.sale_active),
    price_source: cleanText(current.price_source || input.price_source),
    stock_quantity: cleanText(current.stock_quantity || current.stock || input.stock_quantity || input.stock),
    product_url: cleanText(current.product_url || input.product_url),
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
  return text;
};

const fallbackDescription = (context = {}) => {
  const name = cleanText(context.product_name) || "Product";
  const brand = cleanText(context.brand);
  const category = cleanText(context.category || context.product_type) || "item";
  const colors = normalizeList(context.colors).slice(0, 5);
  const sizes = normalizeList(context.sizes).slice(0, 8);
  const tone = cleanText(context.selling_vibe) || "retail-ready";
  const gender = cleanText(context.gender);
  const material = cleanText(context.material);
  const brandPrefix = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "";
  const displayName = [brandPrefix, name].filter(Boolean).join(" ");
  const genderPhrase = gender ? `${gender} ` : "";
  const colorText = colors.length ? `Available in ${colors.join(", ")}` : "Designed with versatile colorways";
  const sizeText = sizes.length ? `with sizes ${sizes.join(", ")}` : "with practical everyday sizing";
  const materialText = material ? ` ${material} material` : "";
  const englishDescription = `${displayName} is a storefront-ready ${category} for ${genderPhrase || "everyday "}customers with a ${tone} presentation.${materialText ? ` Made with${materialText}.` : ""} ${colorText} and ${sizeText}, it is ready for clear catalog browsing and product detail pages.`
    .replace(/\s+/g, " ")
    .trim();
  const arabicCategory = translateArabicFallbackTerm(category);
  const arabicGender = translateArabicFallbackTerm(gender, "gender");
  const arabicDescription = `${displayName} ${arabicCategory} بجودة عرض واضحة للسوق المصري.${arabicGender ? ` مناسب لـ ${arabicGender}.` : ""}${material ? ` الخامة: ${material}.` : ""} متوفر بألوان ${colors.length ? colors.join("، ") : "عملية"}${sizes.length ? ` ومقاسات ${sizes.join("، ")}` : ""}، ومجهز لعرض منظم في الكتالوج وصفحة المنتج.`
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
    "Use only supplied product facts: product name, category, brand, colors, sizes, gender, material, and selling vibe.",
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

const buildSocialCaptionPrompt = (context = {}) => [
  "Write structured social media copy for a luxury footwear store.",
  "Return strict JSON only with keys hook, body, cta, hashtags.",
  "Do not include price, original price, discount, sizes, colors, stock, or link in the AI output.",
  "Those ERP fields will be inserted later by the app.",
  "Hook: one short premium line, 1 sentence maximum.",
  "Body: 2 to 4 short lines, premium and persuasive, without repeating the product name too much.",
  "CTA: one short line only.",
  "Hashtags: return 3 to 5 short hashtags as an array of strings.",
  "Use only supplied ERP product facts. Do not invent features or claims.",
  "Keep the tone premium, concise, and suitable for Facebook and Instagram.",
  "Arabic body is preferred, but keep the hook impactful and natural.",
  `Product context:\n${JSON.stringify(context, null, 2)}`,
]
  .filter(Boolean)
  .join("\n");

const normalizeGenerated = (raw = {}, fallback = {}, target = "all") => {
  const targets = requestedTargets(target);
  return {
    arabic_description: targets.arabic ? cleanText(raw.arabic_description || raw.description_ar) || fallback.arabic_description : "",
    english_description: targets.english ? cleanText(raw.english_description || raw.description_en) || fallback.english_description : "",
  };
};

const normalizeSocialCaptionArray = (value = []) => {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\n,|]+/);
  return Array.from(new Set(items.map(cleanText).filter(Boolean))).slice(0, 5);
};

const buildSocialCaptionSections = (context = {}) => {
  const name = cleanText(context.product_name) || cleanText(context.name) || "NEW COLLECTION";
  const brand = cleanText(context.brand);
  const category = cleanText(context.category || context.product_type);
  const description = cleanText(context.description || context.short_description);
  const features = normalizeList(context.features).slice(0, 4);
  const materials = normalizeList(context.materials).slice(0, 2);
  const colors = normalizeList(context.available_colors || context.colors).slice(0, 5);
  const sizes = normalizeList(context.available_sizes).slice(0, 10);
  const currentPrice = cleanText(context.current_price || context.price || "");
  const originalPrice = cleanText(context.original_price || context.old_crossed_price || "");
  const saleActive = String(context.sale_active || "").toLowerCase() === "true" || cleanText(context.price_source) === "sale_price";
  const stock = cleanText(context.stock_quantity || context.stock || "");
  const url = cleanText(context.product_url || "");
  const stockLine = Number(stock || 0) > 0 ? "متوفر الآن" : "غير متوفر حالياً";
  const hook = `✨ اكتشف ${name} الآن` + (brand ? ` من ${brand}` : "");
  const bodyParts = [];
  if (description) bodyParts.push(description);
  if (category) bodyParts.push(`مصمم ليمنحك حضوراً مميزاً داخل ${category}`);
  if (materials.length) bodyParts.push(`الخامات: ${materials.join("، ")}`);
  if (features.length) bodyParts.push(`أهم المزايا: ${features.join("، ")}`);
  if (colors.length) bodyParts.push(`ألوان مختارة: ${colors.join("، ")}`);
  if (sizes.length) bodyParts.push(`متاح بمقاسات: ${sizes.join("، ")}`);
  const body = bodyParts.slice(0, 4).join("\n");
  const cta = "اطلبه الآن قبل نفاد الكمية.";
  const hashtags = normalizeList(context.hashtags || context.tags || ["#NewCollection", "#Fashion", "#Footwear"]).slice(0, 5);
  const erpInfo = {
    name,
    brand,
    category,
    sale_active: saleActive,
    base_price: cleanText(context.base_price || ""),
    sale_price: cleanText(context.sale_price || ""),
    current_price: currentPrice,
    original_price: originalPrice,
    discount_percent: cleanText(context.discount_percent || ""),
    stock_quantity: stock,
    stock_line: stockLine,
    available_sizes: sizes,
    available_colors: colors,
    product_url: url,
    features,
  };
  return {
    hook,
    body,
    cta,
    hashtags,
    erpInfo,
  };
};

const buildSocialCaptionFallback = (context = {}) => {
  const sections = buildSocialCaptionSections(context);
  const currentPrice = cleanText(sections.erpInfo.current_price || "");
  const originalPrice = cleanText(sections.erpInfo.original_price || "");
  const saleActive = Boolean(sections.erpInfo.sale_active);
  return {
    ...sections,
    caption: [
      "HOOK",
      sections.hook,
      "",
      "MARKETING BODY",
      sections.body,
      "",
      sections.erpInfo.features.length ? "FEATURES" : "",
      ...(Array.isArray(sections.erpInfo.features) ? sections.erpInfo.features.map((feature) => `• ${feature}`) : []),
      "",
      "ERP INFO",
      saleActive && currentPrice ? `السعر الآن: ${currentPrice}` : currentPrice ? `السعر: ${currentPrice}` : "",
      saleActive && originalPrice && originalPrice !== currentPrice ? `بدلاً من: ${originalPrice}` : "",
      saleActive ? "عرض لفترة محدودة" : "",
      sections.erpInfo.available_sizes.length ? `المقاسات المتوفرة: ${sections.erpInfo.available_sizes.join("، ")}` : "",
      sections.erpInfo.available_colors.length ? `الألوان المتوفرة: ${sections.erpInfo.available_colors.join("، ")}` : "",
      `حالة المخزون: ${sections.erpInfo.stock_line}`,
      "",
      "CTA",
      sections.cta,
      "",
      "LINK",
      sections.erpInfo.product_url,
      "",
      "HASHTAGS",
      sections.hashtags.join(" "),
    ]
      .map((line) => String(line || "").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
};

const logSocialCaptionContext = (label, context = {}) =>
  console.warn(label, {
    product_id: context.product_id || context.id || "",
    product_name: context.product_name || "",
    base_price: context.base_price || "",
    sale_price: context.sale_price || "",
    current_price: context.current_price || "",
    original_price: context.original_price || "",
    old_crossed_price: context.old_crossed_price || "",
    discount_percent: context.discount_percent || "",
    sale_active: context.sale_active || "",
    price_source: context.price_source || "",
    stock_quantity: context.stock_quantity || context.stock || "",
    available_sizes: context.available_sizes || [],
    available_colors: context.available_colors || context.colors || [],
    features: context.features || [],
    description: context.description || "",
    product_url: context.product_url || "",
  });

const mapSocialCaptionOpenAiErrorReason = (error = {}, model = "") => {
  const message = cleanText(error?.message || "");
  const code = cleanText(error?.code || error?.type || "");
  const status = Number(error?.status || error?.response?.status || 0);
  const combined = `${message} ${code}`.toLowerCase();
  if (code === "INVALID_JSON" || /invalid.*json|unexpected token|json parse|parse json/.test(combined)) return "INVALID_JSON";
  if (code === "OPENAI_TIMEOUT" || /timeout|timed out|aborterror|request aborted|signal aborted|etimedout/.test(combined)) return "OPENAI_TIMEOUT";
  if (code === "MODEL_ERROR" || /model|deployment|snapshot|not found/.test(combined)) return "MODEL_ERROR";
  if (status >= 400 || /api key|unauthorized|authentication|forbidden|invalid api key|auth/.test(combined)) return "OPENAI_API_ERROR";
  if (/model|deployment|snapshot|not found/i.test(message)) return "MODEL_ERROR";
  return "OPENAI_API_ERROR";
};

const normalizeSocialCaptionGenerated = (raw = {}, fallback = {}) => {
  const safeFallback = fallback || {};
  const hook = cleanText(raw.hook || raw.opening_hook || raw.opening || raw.title) || safeFallback.hook || "";
  const body = cleanText(raw.body || raw.marketing_body || raw.copy || raw.description) || safeFallback.body || "";
  const cta = cleanText(raw.cta || raw.call_to_action || raw.action) || safeFallback.cta || "";
  const hashtags = normalizeSocialCaptionArray(raw.hashtags || raw.tags || raw.hash_tags || raw.keywords);
  const mergedHashtags = hashtags.length ? hashtags : Array.isArray(safeFallback.hashtags) ? safeFallback.hashtags : [];
  const sections = {
    hook,
    body,
    cta,
    hashtags: mergedHashtags,
  };
  const erpInfo = safeFallback.erpInfo || {};
  const currentPrice = cleanText(erpInfo.current_price || "");
  const originalPrice = cleanText(erpInfo.original_price || "");
  const saleActive = Boolean(erpInfo.sale_active);
  const caption = [
    "HOOK",
    sections.hook,
    "",
    "MARKETING BODY",
    sections.body,
    "",
    Array.isArray(erpInfo.features) && erpInfo.features.length ? "FEATURES" : "",
    ...(Array.isArray(erpInfo.features) ? erpInfo.features.map((feature) => `• ${feature}`) : []),
    "",
    "ERP INFO",
    saleActive && currentPrice ? `السعر الآن: ${currentPrice}` : currentPrice ? `السعر: ${currentPrice}` : "",
    saleActive && originalPrice && originalPrice !== currentPrice ? `بدلاً من: ${originalPrice}` : "",
    saleActive ? "عرض لفترة محدودة" : "",
    Array.isArray(erpInfo.available_sizes) && erpInfo.available_sizes.length ? `المقاسات المتوفرة: ${erpInfo.available_sizes.join("، ")}` : "",
    Array.isArray(erpInfo.available_colors) && erpInfo.available_colors.length ? `الألوان المتوفرة: ${erpInfo.available_colors.join("، ")}` : "",
    `حالة المخزون: ${erpInfo.stock_line || ""}`,
    "",
    "CTA",
    sections.cta,
    "",
    "LINK",
    erpInfo.product_url || "",
    "",
    "HASHTAGS",
    sections.hashtags.join(" "),
  ]
    .map((line) => String(line || "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    ...sections,
    caption,
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

export const generateSocialPublisherCaption = async (input = {}) => {
  const context = compactSocialCaptionContext(input);
  const fallback = buildSocialCaptionFallback(context);
  const requestId = cleanText(input.request_id) || `social-caption-${Date.now()}`;
  logSocialCaptionContext("[ai-social-caption-fallback]", {
    ...context,
    product_id: input.product_id || input.productId || "",
  });
  console.warn("[social-caption] runtime env", {
    requestId,
    env: {
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
      OPENAI_PRODUCT_DESCRIPTION_MODEL: process.env.OPENAI_PRODUCT_DESCRIPTION_MODEL || "",
      OPENAI_MODEL: process.env.OPENAI_MODEL || "",
      OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS: process.env.OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS || "",
    },
  });

  const startedAt = Date.now();
  try {
    const model = process.env.OPENAI_PRODUCT_DESCRIPTION_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
    console.log("[social-caption] OpenAI request start", {
      requestId,
      model,
    });

    const response = await getClient().responses.create(
      {
        model,
        instructions: "You are an expert luxury ecommerce social media copywriter.",
        input: buildSocialCaptionPrompt(context),
        text: {
          format: {
            type: "json_schema",
            name: "social_caption",
            strict: true,
            schema: socialCaptionSchema,
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
    const generated = normalizeSocialCaptionGenerated(parsed, fallback);
    console.log("[social-caption] OpenAI request end", {
      requestId,
      durationMs: Date.now() - startedAt,
      status: response?.status || "completed",
    });

    return {
      ...generated,
      source: "OPENAI",
    };
  } catch (error) {
    const model = process.env.OPENAI_PRODUCT_DESCRIPTION_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const errorReason = mapSocialCaptionOpenAiErrorReason(error, model);
    console.error("[ai-social-caption-openai-error]", {
      requestId,
      message: error?.message || "",
      status: error?.status ?? error?.response?.status ?? null,
      stack: error?.stack || "",
      model,
      code: error?.code || error?.type || "",
      error_reason: errorReason,
    });
    return {
      ...fallback,
      source: "LOCAL_FALLBACK",
      error: error?.message || errorReason,
      error_reason: errorReason,
    };
  }
};

