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

const buildM1Personality = () => {
  const profiles = {
    premium: {
      label: "Premium",
      hook: "clean, balanced, polished",
      body: "short and neat, with a calm premium feel",
    },
    luxury: {
      label: "Luxury",
      hook: "quiet, refined, elegant",
      body: "soft, confident, and premium without exaggeration",
    },
    friendly: {
      label: "Friendly",
      hook: "easy, human, everyday",
      body: "simple, warm, and natural like a local social manager",
    },
    sales: {
      label: "Sales",
      hook: "clear, direct, fast",
      body: "focus on the offer with no fake hype",
    },
    sport: {
      label: "Sport",
      hook: "energetic but still grounded",
      body: "practical, light, and ready for the product facts only",
    },
  };

  const toneGuide = Object.values(profiles)
    .map((profile) => `- ${profile.label}: hook is ${profile.hook}; body is ${profile.body}.`)
    .join("\n");

  const systemPrompt = [
    "M1 Store Voice",
    "Style Guide:",
    "Tone: simple Egyptian Arabic that sounds written by a real local social media manager.",
    "Writing Style: short, natural, human sentences. Never sound like ChatGPT or formal ad copy.",
    "Forbidden Phrases: ارتقِ، اكتشف، استمتع، خطواتك، رحلتك، مغامرتك، الخيار الأمثل، مصمم خصيصاً، يجمع بين، البرية، المغامرات، التخييم، الجبال، الرحلات، الهايكنج، العدائين، الرياضة، الأداء العالي.",
    "Allowed Phrases: بسيطة، مريحة، شكل مرتب، تصميم جديد، خفيفة، عملية، يومي، مناسبة، متوفرة الآن.",
    "CTA Library: اطلبه الآن. | اطلبه قبل نفاد المقاسات. | متوفر الآن للشحن. | ابعتلنا لو محتاج تعرف المقاس المناسب. | اطلبه مباشرة من الموقع.",
    "Hook Library: تصميم جديد بإطلالة مميزة. | خامات مريحة مع شكل عملي. | اختيار بسيط وسهل للبس اليومي. | شكل مرتب يناسب أكتر من ستايل. | لمسة هادئة تناسب أكتر من ستايل.",
    "Emoji Rules: use emojis lightly and only when they fit naturally. Do not overuse them.",
    "Sentence Length Rules: keep sentences short. Prefer one idea per line. Avoid long paragraphs.",
    "General Rules:",
    "- Start directly with the hook. Never add a fixed opener before it.",
    "- Do not invent product use cases or scenarios.",
    "- Do not assume the product is for running, adventures, wilderness, hiking, camping, travel, sports, or high performance unless those ideas appear explicitly inside description, features, product_type, or category.",
    "- If the ERP data does not support a specific use case, keep the hook generic and based only on design, shape, comfort, or look.",
    "- Use only the product facts that are explicitly present in ERP fields.",
    "- Do not repeat the product name more than once.",
    "- Do not repeat the brand name more than once.",
    "- CTA must be short and natural. Use only one CTA line.",
    "Tone Profiles:",
    toneGuide,
  ];

  return {
    name: "M1 Store Voice",
    profiles,
    systemPrompt: systemPrompt.join("\n"),
  };
};

const M1_PERSONALITY = buildM1Personality();
const BRAND_VOICE_SYSTEM_PROMPT = M1_PERSONALITY.systemPrompt;

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
    tone: cleanText(current.tone || input.tone || current.prompt_customization || input.prompt_customization),
  };
};

const buildProductFacts = (context = {}) => {
  const productName = cleanText(context.product_name || context.name);
  const brand = cleanText(context.brand);
  const productType = cleanText(context.product_type || context.productType);
  const category = cleanText(context.category);
  const gender = cleanText(context.gender);
  const materials = normalizeList(context.materials).slice(0, 5);
  const features = normalizeList(context.features).slice(0, 8);
  const colors = normalizeList(context.available_colors || context.colors).map(localizeColorName).filter(Boolean).slice(0, 8);
  const availableSizes = normalizeList(context.available_sizes || context.sizes).slice(0, 12);
  const productUrl = cleanText(context.product_url);
  const currentPrice = cleanText(context.current_price || context.price || context.sale_price);
  const originalPrice = cleanText(context.original_price || context.base_price || context.price);
  const discountPercent = cleanText(context.discount_percent);
  const stockQuantity = cleanText(context.stock_quantity || context.stock || "");
  const stockStatus = Number(stockQuantity || 0) > 0 ? "متوفر الآن" : "غير متوفر حالياً";
  const joinedFeatureText = features.join(" ");
  const joinedDescriptionText = cleanText(context.description || context.short_description);
  const waterproof = /waterproof|water resistant|ضد الماء|مقاوم للماء/i.test(`${joinedFeatureText} ${joinedDescriptionText}`)
    ? true
    : undefined;
  const slipResistant = /slip resistant|non[-\s]?slip|anti[-\s]?slip|مانع للانزلاق|ضد الانزلاق/i.test(`${joinedFeatureText} ${joinedDescriptionText}`)
    ? true
    : undefined;

  return {
    ...(productName ? { product_name: productName } : {}),
    ...(brand ? { brand } : {}),
    ...(productType ? { product_type: productType } : {}),
    ...(category ? { category } : {}),
    ...(gender ? { gender } : {}),
    ...(materials.length ? { materials } : {}),
    ...(features.length ? { features } : {}),
    ...(typeof waterproof === "boolean" ? { waterproof } : {}),
    ...(typeof slipResistant === "boolean" ? { slip_resistant: slipResistant } : {}),
    ...(colors.length ? { colors } : {}),
    ...(availableSizes.length ? { available_sizes: availableSizes } : {}),
    ...(currentPrice ? { current_price: currentPrice } : {}),
    ...(originalPrice ? { original_price: originalPrice } : {}),
    ...(discountPercent ? { discount_percent: discountPercent } : {}),
    ...(stockQuantity ? { stock_quantity: stockQuantity } : {}),
    stock_status: stockStatus,
    ...(productUrl ? { product_url: productUrl } : {}),
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
  const normalizedTone = tone.toLowerCase();
  const gender = cleanText(context.gender);
  const material = cleanText(context.material);
  const brandPrefix = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "";
  const displayName = [brandPrefix, name].filter(Boolean).join(" ");
  const genderPhrase = gender ? `${gender} ` : "";
  const colorText = colors.length ? `Available in ${colors.join(", ")}` : "Designed with versatile colorways";
  const sizeText = sizes.length ? `with sizes ${sizes.join(", ")}` : "with practical everyday sizing";
  const materialText = material ? ` ${material} material` : "";
  const arabicCategory = translateArabicFallbackTerm(category);
  const arabicGender = translateArabicFallbackTerm(gender, "gender");
  const toneLeads = {
    premium: {
      ar: "شكل مرتب ولمسة هادئة.",
      en: "Clean, balanced, and polished.",
    },
    luxury: {
      ar: "لمسة أنيقة وهادية.",
      en: "Refined with a quiet premium feel.",
    },
    friendly: {
      ar: "اختيار سهل ومريح للبس اليومي.",
      en: "Easy, natural, and everyday friendly.",
    },
    sales: {
      ar: "عرض واضح وكلام مباشر.",
      en: "Clear, direct, and sales-ready.",
    },
    sport: {
      ar: "ستايل عملي وخفيف.",
      en: "Practical, light, and energetic.",
    },
  };
  const toneLead = toneLeads[normalizedTone] || toneLeads.premium;
  const englishDescription = `${toneLead.en} ${displayName} is a storefront-ready ${category} for ${genderPhrase || "everyday "}customers with a ${tone} presentation.${materialText ? ` Made with${materialText}.` : ""} ${colorText} and ${sizeText}, it is ready for clear catalog browsing and product detail pages.`
    .replace(/\s+/g, " ")
    .trim();
  const arabicDescription = `${toneLead.ar} ${displayName} ${arabicCategory} بجودة عرض واضحة للسوق المصري.${arabicGender ? ` مناسب لـ ${arabicGender}.` : ""}${material ? ` الخامة: ${material}.` : ""} متوفر بألوان ${colors.length ? colors.join("، ") : "عملية"}${sizes.length ? ` ومقاسات ${sizes.join("، ")}` : ""}، ومجهز لعرض منظم في الكتالوج وصفحة المنتج.`
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
  const selectedTone = cleanText(context.tone).toLowerCase();
  const toneProfile = selectedTone && M1_PERSONALITY.profiles[selectedTone] ? M1_PERSONALITY.profiles[selectedTone] : M1_PERSONALITY.profiles.premium;
  return [
    BRAND_VOICE_SYSTEM_PROMPT,
    "Generate ecommerce product descriptions for an ERP product editor.",
    `Selected Personality Mode: ${toneProfile.label}.`,
    `Selected Tone Guide: hook should feel ${toneProfile.hook}; body should feel ${toneProfile.body}.`,
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
  BRAND_VOICE_SYSTEM_PROMPT,
  `Selected Personality Mode: ${(M1_PERSONALITY.profiles[cleanText(context.tone).toLowerCase()] || M1_PERSONALITY.profiles.premium).label}.`,
  "Write social media copy for an Egyptian footwear store in a natural, human voice that sounds like a local social media manager.",
  "Return strict JSON only with keys hook, body, cta, hashtags.",
  "Do not add any generic opening line before the hook.",
  "Start immediately with the hook.",
  "Do not include price, original price, discount, sizes, colors, stock, or link in the AI output.",
  "Those ERP fields will be inserted later by the app.",
  "Hook: one short, natural line, 1 sentence maximum, no marketing clichés.",
  "Body: 2 to 4 short lines, simple and natural, based only on ERP facts. Do not sound robotic.",
  "CTA: one short natural line only.",
  "Hashtags: return 3 to 5 short hashtags as an array of strings.",
  "Use only supplied Product Facts. Do not invent features or claims.",
  "Keep the tone simple, local, and believable for Facebook and Instagram.",
  "Prefer Arabic. Do not use these phrases or close variants: احصل على زوجك الآن، لا تفوت الفرصة، ارتقِ بإطلالتك، اكتشف الآن، امشِ بخطى واثقة، صُمم خصيصًا لك، الخيار المثالي، مزيج من الأداء والأناقة.",
  "Do not repeat the product name more than once. Do not repeat the brand more than once.",
  "CTA examples that are acceptable: اطلبه الآن، اطلبه قبل نفاد المقاسات، ابعتلنا رسالة لو محتاج تعرف المقاس المناسب، متوفر الآن للشحن، اطلبه مباشرة من الموقع.",
  `Product facts:\n${JSON.stringify(context, null, 2)}`,
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

const COLOR_NAME_MAP = {
  black: "أسود",
  white: "أبيض",
  gray: "رمادي",
  grey: "رمادي",
  silver: "فضي",
  gold: "ذهبي",
  red: "أحمر",
  blue: "أزرق",
  navy: "كحلي",
  green: "أخضر",
  olive: "زيتي",
  yellow: "أصفر",
  orange: "برتقالي",
  pink: "وردي",
  purple: "بنفسجي",
  brown: "بني",
  beige: "بيج",
  nude: "نود",
  tan: "تان",
  maroon: "خمري",
  burgundy: "عنابي",
  cream: "كريمي",
  charcoal: "فحمي",
  offwhite: "أوف وايت",
  "off white": "أوف وايت",
};

const localizeColorName = (value = "") => {
  const text = cleanText(value);
  if (!text) return "";
  const arabicMatch = text.match(/[\u0600-\u06ff]+/);
  if (arabicMatch) return arabicMatch[0];
  const normalized = text
    .toLowerCase()
    .replace(/[(){}[\]]/g, " ")
    .replace(/[_\-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const direct = COLOR_NAME_MAP[normalized] || COLOR_NAME_MAP[normalized.replace(/\s+/g, "")];
  if (direct) return direct;
  const firstToken = normalized.split(" ")[0];
  return COLOR_NAME_MAP[firstToken] || text;
};

const EXPLICIT_USE_CASE_PATTERNS = [
  /(^|[^a-z])running([^a-z]|$)/i,
  /(^|[^a-z])jogging([^a-z]|$)/i,
  /(^|[^a-z])outdoor([^a-z]|$)/i,
  /(^|[^a-z])hiking([^a-z]|$)/i,
  /(^|[^a-z])camping([^a-z]|$)/i,
  /(^|[^a-z])travel([^a-z]|$)/i,
  /(^|[^a-z])sports?([^a-z]|$)/i,
  /(^|[^a-z])adventure([^a-z]|$)/i,
  /(^|[^a-z])wilderness([^a-z]|$)/i,
  /(^|[^a-z])trail([^a-z]|$)/i,
  /الجري/,
  /الرياضة/,
  /الهايكنج/,
  /التخييم/,
  /الرحلات/,
  /المغامرات/,
  /البرية/,
  /الأداء العالي/,
];

const hasExplicitUseCase = (value = "") => {
  const text = cleanText(value);
  return EXPLICIT_USE_CASE_PATTERNS.some((pattern) => pattern.test(text));
};

const buildGenericHook = ({ name, category, features, description } = {}) => {
  const safeHooks = [
    "تصميم جديد بإطلالة مميزة",
    "خامات مريحة مع شكل عملي",
    "اختيار بسيط وسهل للبس اليومي",
    "شكل مرتب يناسب أكتر من ستايل",
    "لمسة هادئة تناسب أكتر من ستايل",
  ];
  const textSeed = cleanText([name, category, features?.[0], description].filter(Boolean).join(" "));
  const hash = Array.from(textSeed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return safeHooks[hash % safeHooks.length] || safeHooks[0];
};

const buildSocialCaptionSections = (context = {}) => {
  const name = cleanText(context.product_name) || cleanText(context.name) || "NEW COLLECTION";
  const brand = cleanText(context.brand);
  const category = cleanText(context.category || context.product_type);
  const productType = cleanText(context.product_type || context.productType);
  const description = cleanText(context.description || context.short_description);
  const features = normalizeList(context.features).slice(0, 4);
  const materials = normalizeList(context.materials).slice(0, 2);
  const colors = normalizeList(context.available_colors || context.colors).map(localizeColorName).filter(Boolean).slice(0, 5);
  const sizes = normalizeList(context.available_sizes).slice(0, 10);
  const currentPrice = cleanText(context.current_price || context.price || "");
  const originalPrice = cleanText(context.original_price || context.old_crossed_price || "");
  const saleActive = String(context.sale_active || "").toLowerCase() === "true" || cleanText(context.price_source) === "sale_price";
  const stock = cleanText(context.stock_quantity || context.stock || "");
  const url = cleanText(context.product_url || "");
  const stockLine = Number(stock || 0) > 0 ? "متوفر الآن" : "غير متوفر حالياً";
  const useCaseBlob = [productType, category, description, features.join(" "), materials.join(" "), name].filter(Boolean).join(" ");
  const explicitUseCaseSource = hasExplicitUseCase(useCaseBlob);
  const hookSource = explicitUseCaseSource
    ? cleanText(productType) ||
      cleanText(category) ||
      cleanText(features[0]) ||
      cleanText(description.split(/[.!؟\n]/).find(Boolean) || "") ||
      cleanText(name)
    : buildGenericHook({ name, category, features, description });
  const hook = brand && hookSource && !hookSource.includes(brand) ? `${hookSource} من ${brand}` : hookSource || name;
  const bodyParts = [];
  if (description) bodyParts.push(description);
  if (category) bodyParts.push(category);
  if (materials.length) bodyParts.push(materials.join("، "));
  if (features.length) bodyParts.push(features.join("، "));
  if (colors.length) bodyParts.push(colors.join("، "));
  if (sizes.length) bodyParts.push(sizes.join("، "));
  const body = bodyParts.slice(0, 4).join("\n");
  const cta = "اطلبه الآن.";
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

const mapSocialCaptionOpenAiErrorReason = (error = {}) => {
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
    saleActive ? "عرض لفترة محدودة حتى نفاد الكمية." : "",
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
  const facts = buildProductFacts(context);
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
        input: buildSocialCaptionPrompt(facts),
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
    const errorReason = mapSocialCaptionOpenAiErrorReason(error);
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


/* ------------------------------------------------------------------------- *
 * SEO metadata (meta title, meta description, keywords, slug)
 *
 * The storefront is Arabic-first for Egypt, so the generated title and
 * description are Arabic search phrases that keep the brand and model in
 * Latin the way customers actually type them ("كوتشي Nike Air Force 1 رجالي").
 * The server-rendered product page appends " | M1 Store" itself, so the model
 * is told to leave the store name out of the title.
 * ------------------------------------------------------------------------- */

export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;
export const SEO_SLUG_MAX = 80;

const seoMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["meta_title", "meta_description", "keywords", "slug"],
  properties: {
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    slug: { type: "string" },
  },
};

const SEO_TYPE_AR = [
  [/crocs|كروكس/, "كروكس"],
  [/backpack|school bag|شنطة ظهر|شنطة مدرس/, "شنطة ظهر"],
  [/bag|handbag|حقيبة|شنطة/, "شنطة"],
  [/boot|بوت|جزمة/, "بوت"],
  [/slipper|slide|سليبر|شبشب/, "سليبر"],
  [/sandal|صندل/, "صندل"],
  [/sneaker|shoe|footwear|trainer|running|كوتشي|حذاء/, "كوتشي"],
  [/shirt|tee|t-shirt|top|تيشيرت|قميص/, "تيشيرت"],
  [/pants|trouser|jeans|بنطلون/, "بنطلون"],
];

const seoTypeAr = (context = {}) => {
  const source = [context.product_type, context.category, context.product_name].map(cleanText).join(" ").toLowerCase();
  const hit = SEO_TYPE_AR.find(([pattern]) => pattern.test(source));
  if (hit) return hit[1];
  const arabic = [context.product_type, context.category].map(cleanText).find((value) => /[؀-ۿ]/.test(value));
  return arabic || "";
};

const seoTypeEn = (context = {}) => {
  const source = [context.product_type, context.category, context.product_name].map(cleanText).join(" ").toLowerCase();
  if (/crocs/.test(source)) return "crocs";
  if (/backpack|school bag/.test(source)) return "backpack";
  if (/bag/.test(source)) return "bag";
  if (/boot/.test(source)) return "boots";
  if (/slipper|slide/.test(source)) return "slippers";
  if (/sandal/.test(source)) return "sandals";
  if (/sneaker|shoe|footwear|trainer/.test(source)) return "sneakers";
  const latin = [context.product_type, context.category].map(cleanText).find((value) => /^[a-z0-9\s-]+$/i.test(value));
  return latin ? latin.toLowerCase() : "";
};

const seoGenderEn = (value = "") => {
  const normalized = cleanText(value).toLowerCase();
  if (/women|female|woman|حريم|نساء|ستات/.test(normalized)) return "women";
  if (/men|male|man|رجال/.test(normalized)) return "men";
  if (/kid|child|boy|girl|أطفال|اطفال/.test(normalized)) return "kids";
  return "";
};

const seoGenderAr = (value = "") => {
  const gender = seoGenderEn(value);
  if (gender === "men") return "رجالي";
  if (gender === "women") return "حريمي";
  if (gender === "kids") return "أطفال";
  return "";
};

const slugifySeo = (value = "") => {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= SEO_SLUG_MAX) return slug;
  // Cut on a word boundary so the URL never ends in half a word.
  const clipped = slug.slice(0, SEO_SLUG_MAX);
  const boundary = clipped.lastIndexOf("-");
  return (boundary > SEO_SLUG_MAX * 0.5 ? clipped.slice(0, boundary) : clipped).replace(/-+$/g, "");
};

const clipAtWord = (value = "", max = 60) => {
  const clean = cleanText(value).replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max);
  const boundary = clipped.lastIndexOf(" ");
  return (boundary > max * 0.6 ? clipped.slice(0, boundary) : clipped).replace(/[\s,،:;|\-–—]+$/g, "").trim();
};

const stripStoreSuffix = (value = "") =>
  cleanText(value)
    .replace(/\s*[|\-–—]\s*M1\s*Store\s*$/i, "")
    .replace(/^\s*M1\s*Store\s*[|\-–—]\s*/i, "")
    .trim();

const uniqueKeywords = (values = [], limit = 10) => {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const item = cleanText(raw).replace(/^#/, "");
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
};

const compactSeoContext = (input = {}) => {
  const current = input.current || input;
  return {
    product_name: cleanText(current.product_name || current.name || input.product_name || input.name),
    brand: cleanText(current.brand || current.brand_name || input.brand),
    manufacturer: cleanText(current.manufacturer || input.manufacturer),
    category: cleanText(current.category || input.category),
    product_type: cleanText(current.productType || current.product_type || input.productType || input.product_type),
    gender: cleanText(current.gender || (Array.isArray(current.audiences) ? current.audiences[0] : "") || input.gender),
    grade: cleanText(current.grade || input.grade),
    material: cleanText(current.material || input.material),
    colors: normalizeList(current.colors || input.colors),
    sizes: normalizeList(current.sizes || input.sizes),
    description_ar: cleanText(current.description_ar || input.description_ar),
    description_en: cleanText(current.description_en || input.description_en),
    tone: cleanText(input.tone || input.prompt_customization || current.prompt_customization),
  };
};

export const buildSeoFallback = (context = {}) => {
  const name = cleanText(context.product_name);
  const brand = cleanText(context.brand);
  const typeAr = seoTypeAr(context);
  const typeEn = seoTypeEn(context);
  const genderAr = seoGenderAr(context.gender);
  const genderEn = seoGenderEn(context.gender);
  const nameHasBrand = Boolean(brand) && name.toLowerCase().includes(brand.toLowerCase());
  const displayName = [nameHasBrand ? "" : brand, name].filter(Boolean).join(" ");
  const colorsAr = normalizeList(context.colors).map(localizeColorName).filter(Boolean).slice(0, 4);
  const sizes = normalizeList(context.sizes).slice(0, 6);

  const metaTitle = clipAtWord([typeAr, displayName, genderAr].filter(Boolean).join(" ") || name, SEO_TITLE_MAX);

  const lead = `${[typeAr, genderAr, displayName].filter(Boolean).join(" ")}${typeAr ? " بخامات مريحة وشكل عملي يناسب اللبس اليومي." : " متوفر الآن."}`;
  const cta = "اطلبه الآن من M1 Store.";
  const optionalParts = [
    colorsAr.length ? `متوفر بألوان ${colorsAr.join("، ")}.` : "",
    sizes.length ? `مقاسات ${sizes.join("، ")}.` : "",
  ].filter(Boolean);
  // Whole sentences only: drop sizes, then colours, before ever clipping the
  // lead. A meta description that ends mid-sentence reads as broken in the SERP.
  let metaDescription = "";
  for (let keep = optionalParts.length; keep >= 0; keep -= 1) {
    const candidate = [lead, ...optionalParts.slice(0, keep), cta].join(" ");
    if (candidate.length <= SEO_DESCRIPTION_MAX) {
      metaDescription = candidate;
      break;
    }
  }
  if (!metaDescription) {
    const clippedLead = clipAtWord(lead, SEO_DESCRIPTION_MAX - cta.length - 2).replace(/[.،,]+$/, "");
    metaDescription = `${clippedLead}. ${cta}`;
  }

  const keywords = uniqueKeywords([
    name,
    brand,
    typeAr && genderAr ? `${typeAr} ${genderAr}` : typeAr,
    typeAr && brand ? `${typeAr} ${brand}` : "",
    typeAr && brand && genderAr ? `${typeAr} ${brand} ${genderAr}` : "",
    typeEn && genderEn ? `${brand ? `${brand} ` : ""}${genderEn} ${typeEn}` : typeEn,
    cleanText(context.category),
    ...colorsAr.map((color) => (typeAr ? `${typeAr} ${color}` : color)),
    "M1 Store",
  ]);

  const slug = slugifySeo([nameHasBrand ? "" : brand, name, typeEn, genderEn].filter(Boolean).join(" ")) || slugifySeo(name);

  return {
    meta_title: metaTitle,
    meta_description: metaDescription,
    keywords,
    slug,
  };
};

const buildSeoPrompt = (context = {}) => [
  "You write search-engine metadata for M1 Store, an Egyptian footwear and bags shop (m1store-egy.com).",
  "Return strict JSON only with keys meta_title, meta_description, keywords, slug.",
  "Language: Arabic-first for Egyptian shoppers. Keep the brand and model names in Latin exactly as customers type them (for example: كوتشي Nike Air Force 1 رجالي).",
  "Use the search words Egyptians actually use: كوتشي، شنطة، سليبر، كروكس، بوت، رجالي، حريمي، أطفال. Never use حذاء رياضي or formal MSA marketing phrasing.",
  `meta_title: at most ${SEO_TITLE_MAX} characters. Pattern: product type + brand/model + audience (+ one colour only if it is the defining feature). Do NOT include the store name; the site appends it.`,
  `meta_description: 120 to ${SEO_DESCRIPTION_MAX} characters, one or two natural sentences: what it is, who it is for, colours/sizes if supplied, and a short soft call to action such as اطلبه الآن من M1 Store.`,
  "keywords: 6 to 10 short search phrases mixing Arabic phrases and Latin brand/model terms. No hashtags, no duplicates, the store name at most once.",
  `slug: Latin lowercase words joined by hyphens, at most ${SEO_SLUG_MAX} characters, built from brand, model, product type and audience. No Arabic letters, no stop words.`,
  "Use only the supplied product facts. Do not invent material, technology, comfort features, authenticity, discounts, shipping promises or stock claims.",
  "No emojis, no exclamation marks, no keyword stuffing.",
  context.tone ? `Optional tone customization: ${context.tone}.` : "",
  `Product facts:\n${JSON.stringify(context, null, 2)}`,
]
  .filter(Boolean)
  .join("\n");

export const normalizeSeoGenerated = (raw = {}, fallback = {}) => {
  const metaTitle = clipAtWord(stripStoreSuffix(raw.meta_title || raw.title || ""), SEO_TITLE_MAX) || fallback.meta_title || "";
  const metaDescription = clipAtWord(raw.meta_description || raw.seo_description || raw.description || "", SEO_DESCRIPTION_MAX) || fallback.meta_description || "";
  const rawKeywords = Array.isArray(raw.keywords) ? raw.keywords : String(raw.keywords || "").split(/[,،\n]/);
  const keywords = uniqueKeywords(rawKeywords);
  const slug = slugifySeo(raw.slug || raw.canonical_slug || "")
    .replace(/[؀-ۿ]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    meta_title: metaTitle,
    meta_description: metaDescription,
    keywords: keywords.length >= 3 ? keywords : uniqueKeywords([...keywords, ...(fallback.keywords || [])]),
    slug: slug || fallback.slug || "",
  };
};

export const generateProductSeoMetadata = async (input = {}) => {
  const context = compactSeoContext(input);
  const fallback = buildSeoFallback(context);
  const requestId = cleanText(input.request_id) || `product-seo-${Date.now()}`;

  if (!context.product_name) {
    return { ...fallback, source: "LOCAL_FALLBACK", error: "PRODUCT_NAME_REQUIRED" };
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[product-seo] OPENAI_API_KEY missing; using fallback", { requestId });
    return { ...fallback, source: "LOCAL_FALLBACK" };
  }

  const startedAt = Date.now();
  const model = process.env.OPENAI_PRODUCT_DESCRIPTION_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  try {
    console.log("[product-seo] OpenAI request start", { requestId, model });
    const response = await getClient().responses.create(
      {
        model,
        instructions: "You are a senior ecommerce SEO specialist for the Egyptian market. You write concise, honest, search-friendly Arabic metadata.",
        input: buildSeoPrompt(context),
        text: {
          format: {
            type: "json_schema",
            name: "product_seo_metadata",
            strict: true,
            schema: seoMetadataSchema,
          },
          verbosity: "low",
        },
      },
      {
        timeout: positiveNumber(process.env.OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        maxRetries: 0,
      }
    );
    const parsed = JSON.parse(response.output_text || "{}");
    console.log("[product-seo] OpenAI request end", { requestId, durationMs: Date.now() - startedAt });
    return { ...normalizeSeoGenerated(parsed, fallback), source: "OPENAI" };
  } catch (error) {
    console.error("[product-seo] OpenAI request failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      status: error?.status,
      code: error?.code,
      message: error?.message,
    });
    return {
      ...fallback,
      source: "LOCAL_FALLBACK",
      error: process.env.NODE_ENV === "production" ? undefined : error?.message || "OpenAI request failed",
    };
  }
};
