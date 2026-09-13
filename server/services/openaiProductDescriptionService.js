import OpenAI from "openai";
import { composeProductDescription } from "../../src/shared/lib/productDescriptionFormat.js";
import { brandKnowledgeFeatures, brandKnowledgeFor, brandKnowledgeReference } from "../../src/shared/lib/productBrandKnowledge.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 20_000;


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

/* ------------------------------------------------------------------------- *
 * Text provider
 *
 * Every generator in this file (descriptions, SEO metadata, social captions)
 * asks for one JSON object. The provider that answers is chosen from env, so
 * the shop does not depend on an OpenAI subscription:
 *
 *   AI_TEXT_PROVIDER=ollama       Ollama on the box (open-weights models), or
 *   AI_TEXT_PROVIDER=compatible   any OpenAI-compatible server (vLLM, LM Studio,
 *                                 llama.cpp, Groq/OpenRouter free tiers ...)
 *     AI_TEXT_BASE_URL=http://ollama:11434/v1   AI_TEXT_MODEL=gemma3:4b
 *     AI_TEXT_API_KEY=...          (optional; local servers ignore it)
 *     AI_TEXT_TIMEOUT_MS=90000     (CPU inference is slow; default 90s)
 *   AI_TEXT_PROVIDER=openai       the old Responses API path (needs OPENAI_API_KEY)
 *   AI_TEXT_PROVIDER=off          local templates only
 *
 * With nothing set, an OPENAI_API_KEY still selects OpenAI, so existing
 * deployments keep working until they opt in.
 * ------------------------------------------------------------------------- */

const DEFAULT_COMPATIBLE_MODEL = "gemma3:4b";
const DEFAULT_COMPATIBLE_TIMEOUT_MS = 85_000;
const MAX_COMPATIBLE_TIMEOUT_MS = 88_000;
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

const NO_PROVIDER = Object.freeze({ kind: "none", label: "LOCAL_FALLBACK", model: "" });

export const resolveTextProvider = (env = process.env) => {
  const explicit = cleanText(env.AI_TEXT_PROVIDER).toLowerCase();
  const rawBaseUrl = cleanText(env.AI_TEXT_BASE_URL || env.OLLAMA_BASE_URL).replace(/\/+$/, "");
  const openAi = () =>
    env.OPENAI_API_KEY
      ? {
          kind: "openai",
          label: "OPENAI",
          model: env.OPENAI_PRODUCT_DESCRIPTION_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL,
          timeout: positiveNumber(env.OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        }
      : NO_PROVIDER;
  if (explicit === "off" || explicit === "none" || explicit === "local") return NO_PROVIDER;
  if (explicit === "openai") return openAi();
  if (explicit === "ollama" || explicit === "compatible" || rawBaseUrl) {
    const origin = rawBaseUrl || DEFAULT_OLLAMA_BASE_URL;
    const baseUrl = /\/v1$/i.test(origin) ? origin : `${origin}/v1`;
    const isOllama = explicit === "ollama" || /:11434(\/|$)/.test(baseUrl);
    return {
      kind: "compatible",
      label: isOllama ? "OLLAMA" : "LLM",
      baseUrl,
      apiKey: cleanText(env.AI_TEXT_API_KEY) || "local",
      model: cleanText(env.AI_TEXT_MODEL) || DEFAULT_COMPATIBLE_MODEL,
      // The HTTP route is cut at 95 s (Cloudflare allows 100 s), so the model must
      // give up before that for the template fallback to still reach the editor.
      timeout: Math.min(positiveNumber(env.AI_TEXT_TIMEOUT_MS, DEFAULT_COMPATIBLE_TIMEOUT_MS), MAX_COMPATIBLE_TIMEOUT_MS),
    };
  }
  return openAi();
};

/* Hosted free tiers meter tokens per minute; the compact Arabic prompt is a
 * quarter of the full one and keeps small models on the facts. AI_TEXT_PROMPT=full
 * restores the long brand-voice prompt for a strong hosted model. */
const usesCompactPrompt = (provider) =>
  provider.kind === "compatible" && cleanText(process.env.AI_TEXT_PROMPT).toLowerCase() !== "full";

const openAiClients = new Map();
const getOpenAiClient = (provider) => {
  const key = `openai:${provider.timeout}`;
  if (!openAiClients.has(key)) {
    openAiClients.set(key, new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: provider.timeout }));
  }
  return openAiClients.get(key);
};

const compatibleClients = new Map();
const getCompatibleClient = (provider) => {
  const key = `${provider.baseUrl}|${provider.apiKey}|${provider.timeout}`;
  if (!compatibleClients.has(key)) {
    compatibleClients.set(key, new OpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey, maxRetries: 0, timeout: provider.timeout }));
  }
  return compatibleClients.get(key);
};

/* The compact Arabic prompt is for small local models (label OLLAMA); a hosted
 * 70B-class model handles the full brand-voice prompt and writes better copy.
 * Small open models wrap JSON in prose or code fences no matter what the
 * request says; take the first balanced object rather than failing the call. */
export const extractJsonObject = (text = "") => {
  const raw = String(text ?? "").trim();
  const candidates = [];
  if (raw) {
    candidates.push(raw);
    candidates.push(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, ""));
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  const error = new Error("Model returned no JSON object");
  error.code = "INVALID_JSON";
  throw error;
};

const chatCompletionJson = async (client, { model, timeout, instructions, prompt, schema, responseFormat, maxTokens }) => {
  const keys = Object.keys(schema?.properties || {});
  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.3,
      // Free hosted tiers meter output tokens per minute against max_tokens, so
      // every call declares how little it needs instead of the server default.
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      messages: [
        { role: "system", content: instructions },
        {
          role: "user",
          content: `${prompt}\n\nReturn ONLY one JSON object with exactly these keys: ${keys.join(", ")}. No prose, no markdown, no code fences.`,
        },
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
    },
    { timeout, maxRetries: 0 }
  );
  return extractJsonObject(completion?.choices?.[0]?.message?.content || "");
};

const MAX_RATE_LIMIT_WAIT_MS = 30_000;
// The HTTP routes wait out one window; a batch job (the backfill) raises this so a
// product is not dropped, and its finished languages re-requested, over a 2 s window.
const maxRateLimitWaits = () => positiveNumber(process.env.AI_TEXT_RATE_LIMIT_WAITS, 1);

/* Seconds the provider asks us to wait, from the Retry-After header or from
 * the message ("try again in 12.3s"); 0 when it names nothing usable. */
export const rateLimitWaitMs = (error = {}) => {
  const headers = error?.headers;
  const headerValue =
    typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"] ?? headers?.["Retry-After"];
  const fromHeader = Number(headerValue);
  const fromMessage = Number((String(error?.message || "").match(/try again in ([\d.]+)\s*s/i) || [])[1]);
  const seconds = Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : Number.isFinite(fromMessage) && fromMessage > 0 ? fromMessage : 0;
  if (!seconds) return 0;
  return Math.min(Math.ceil(seconds * 1000) + 500, MAX_RATE_LIMIT_WAIT_MS);
};

/* One JSON object from whichever provider is configured. OpenAI keeps the
 * Responses API with a strict schema. Compatible servers get Chat Completions:
 * json_schema first (Ollama >= 0.5, vLLM, Groq), then json_object, then a
 * plain request parsed leniently, so an older server still answers. */
export const requestStructuredJson = async ({
  provider,
  requestId = "",
  label = "ai-text",
  instructions = "",
  prompt = "",
  schemaName = "result",
  schema = {},
  verbosity = "medium",
  maxTokens = 500,
  client = null,
}) => {
  if (!provider || provider.kind === "none") {
    const error = new Error("No text provider configured");
    error.code = "NO_PROVIDER";
    throw error;
  }
  if (provider.kind === "openai") {
    const response = await (client || getOpenAiClient(provider)).responses.create(
      {
        model: provider.model,
        instructions,
        input: prompt,
        text: {
          format: { type: "json_schema", name: schemaName, strict: true, schema },
          verbosity,
        },
      },
      { timeout: provider.timeout, maxRetries: 0 }
    );
    return JSON.parse(response.output_text || "{}");
  }
  const chat = client || getCompatibleClient(provider);
  const formats = [
    { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    { type: "json_object" },
    null,
  ];
  let lastError = null;
  let rateLimitWaits = 0;
  for (let index = 0; index < formats.length; index += 1) {
    const responseFormat = formats[index];
    try {
      return await chatCompletionJson(chat, { ...provider, instructions, prompt, schema, responseFormat, maxTokens });
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.response?.status || 0);
      // Free hosted tiers meter output tokens per minute. When the provider says
      // how long the window is, wait it out once (bounded so the HTTP route,
      // cut at 95 s, still answers) and retry the same request format.
      if (status === 429 && rateLimitWaits < maxRateLimitWaits()) {
        const waitMs = rateLimitWaitMs(error);
        if (waitMs > 0) {
          rateLimitWaits += 1;
          console.warn(`[${label}] rate limited; waiting before retry`, { requestId, waitMs });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          index -= 1;
          continue;
        }
      }
      const retryable = status === 400 || status === 404 || status === 422 || error?.code === "INVALID_JSON";
      console.warn(`[${label}] structured output attempt failed`, {
        requestId,
        format: responseFormat?.type || "plain",
        status,
        message: error?.message,
      });
      if (!retryable) throw error;
    }
  }
  throw lastError;
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
    brand: realBrand(current.brand || input.brand),
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
    // "women" contains "men": test the women's forms first or every women's
    // product is described as رجالي.
    if (/women|female|woman|حريم|نسائي|ستات/.test(normalized)) return "حريمي";
    if (/men|male|man|رجال/.test(normalized)) return "رجالي";
    if (/kid|child|boy|girl/.test(normalized)) return "أطفال";
    if (/unisex/.test(normalized)) return "للجنسين";
  }
  if (/sneaker|shoe|trainer/.test(normalized)) return "كوتشي";
  if (/boot/.test(normalized)) return "جزمة";
  if (/slipper|slide|sandal/.test(normalized)) return "شبشب";
  return text;
};

/* Local fallback used when OpenAI is unavailable. It has to read like a real
 * listing, not like a placeholder: Arabic-first, correct audience (women's
 * products were being described as رجالي because "women" contains "men"),
 * Arabic colour names, a size range, and no catalogue noise such as
 * "Uncategorized". The tone lead follows the same profiles the model uses. */
const localizeCompoundColor = (value = "") => {
  const text = cleanText(value);
  if (!text) return "";
  const parts = text
    .split(/\s*(?:&|\/|\+|,|\band\b|\bو\b)\s*/i)
    .map((part) => cleanText(part))
    .filter(Boolean)
    .map((part) => localizeColorName(part))
    .filter(Boolean);
  return Array.from(new Set(parts)).join(" و");
};

const sortSizesForCopy = (sizes = []) => {
  const numeric = sizes.every((size) => /^\d+(\.\d+)?$/.test(size));
  return numeric ? [...sizes].sort((a, b) => Number(a) - Number(b)) : sizes;
};

/* True when the product name already carries the brand, including a brand
 * that is misspelt in one of the two fields ("Alexander Maqueen" vs
 * "Alexander Mcqueen Sneakers"): the first brand word is enough. */
const brandInName = (brand = "", name = "") => {
  const b = cleanText(brand).toLowerCase();
  const n = cleanText(name).toLowerCase();
  if (!b || !n) return false;
  if (n.includes(b)) return true;
  const firstWord = b.split(/\s+/)[0];
  return firstWord.length >= 4 && n.split(/[^a-z0-9\u0600-\u06ff]+/i).includes(firstWord);
};

/* Facts a small open model can copy verbatim. Gemma/Qwen at 4B guess the
 * Arabic product type and audience from English fields and get them wrong
 * ("شنطة ... رجالي" for women's sneakers), so the words are handed over ready. */
const localizedFacts = (context = {}) => {
  const typeAr = seoTypeAr({ product_type: context.product_type, category: context.category, product_name: context.product_name });
  const audienceAr = seoGenderAr(context.gender);
  const colorsAr = normalizeList(context.colors).map(localizeCompoundColor).filter(Boolean).slice(0, 5);
  const sizes = sortSizesForCopy(normalizeList(context.sizes).slice(0, 12));
  return {
    type_ar: typeAr,
    audience_ar: audienceAr,
    audience_en: seoGenderEn(context.gender),
    type_en: seoTypeEn({ product_type: context.product_type, category: context.category, product_name: context.product_name }),
    colors_ar: colorsAr,
    sizes_ar: sizes.length > 2 ? `من ${sizes[0]} إلى ${sizes[sizes.length - 1]}` : sizes.join("، "),
    sizes,
  };
};

/* Egyptians search for كوتشي, not the MSA حذاء رياضي a model reaches for. */
const egyptianiseSearchWords = (text = "") =>
  String(text ?? "")
    .replace(/أحذية رياضية|احذية رياضية|أحذية رياضة/g, "كوتشيات")
    .replace(/حذاء رياضي|حذاء رياضة|حذاء سنيكرز|حذاء/g, "كوتشي");

// Arabic words a model sometimes transliterates instead of translating.
const TRANSLITERATED_ARABIC = /\b(kutchi|kotchi|koutchi|kotshi|shanta|shantah|harimi|regali|rigali|atfal)\b/i;

const AUDIENCE_WORDS = ["رجالي", "حريمي", "نسائي", "أطفال", "اطفال"];
// SEO_TYPE_AR is declared further down; resolve the words on first use.
const EXCLUSIVE_TYPE_WORDS = ["كروكس", "شنطة ظهر", "شنطة", "بوت", "سليبر", "صندل", "كوتشي"];
const typeWords = () => EXCLUSIVE_TYPE_WORDS;

/* True when the text names a different audience or product type than the
 * facts. A wrong audience on a listing is worse than a template sentence. */
const contradictsFacts = (text = "", facts = {}, { scope = "strict" } = {}) => {
  const value = cleanText(text);
  if (!value) return false;
  // A description opens with what the product is; a wrong type there is a
  // contradiction, a bag or boot mentioned later is an outfit pairing.
  const typeScope = scope === "lead" ? value.slice(0, 40) : value;
  if (facts.audience_ar) {
    const wrongAudience = AUDIENCE_WORDS.filter((word) => word !== facts.audience_ar && !(facts.audience_ar === "أطفال" && word === "اطفال"));
    if (wrongAudience.some((word) => value.includes(word))) return true;
  }
  if (facts.type_ar) {
    const wrongTypes = typeWords().filter((word) => word !== facts.type_ar && !word.includes(facts.type_ar) && !facts.type_ar.includes(word));
    if (wrongTypes.some((word) => typeScope.includes(word))) return true;
  }
  return false;
};


const requestedTargets = (target = "all") => {
  const normalized = cleanText(target).toLowerCase();
  return {
    arabic: normalized === "all" || normalized === "ar" || normalized === "arabic",
    english: normalized === "all" || normalized === "en" || normalized === "english",
  };
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

/* ------------------------------------------------------------------------- *
 * Structured product page copy
 *
 * The page shows colours and sizes in its own selectors, so the copy never
 * lists them. It reads like a brand listing instead: a headline, an intro,
 * 4-5 titled features, why the shopper will like it, and what it suits. One
 * request per language keeps each answer under the free tier's per-minute
 * output budget and lets one language fail without the other.
 * ------------------------------------------------------------------------- */

const structuredDescriptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "intro", "features", "why", "ideal_for"],
  properties: {
    headline: { type: "string" },
    intro: { type: "string" },
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: { title: { type: "string" }, detail: { type: "string" } },
      },
    },
    why: { type: "string" },
    ideal_for: { type: "array", items: { type: "string" } },
  },
};

// Things the page already shows, or claims the shop cannot stand behind.
const OFF_LIMITS_COPY =
  /مقاس|المقاسات|\bsizes?\b|\bsized\b|متوفر\s*(ب|في)?\s*(ألوان|الوان|لون|اللون)|بألوان|باللون|\bavailable in\b|\bcolou?rs?\b|\bcolou?rways?\b|سعر|\bprice\b|خصم|\bdiscount|شحن|\bshipping\b|مخزون|\bstock\b|أصلي|اصلي|\boriginal\b|\bauthentic|ضمان|\bwarranty\b|اطلبه|اطلبيه|\border now\b|M1 Store/i;

const splitSentences = (value = "") =>
  cleanText(value)
    .split(/(?<=[.!؟?])\s+/)
    .map(cleanText)
    .filter(Boolean);

/* Colour names: the listing covers every colourway, so "black upper" or
 * "orange accents" is wrong on most of them. Arabic has no \b, so the words
 * are fenced by non-letters and may carry و / ال / بال / ب. */
const ARABIC_COLOUR_WORDS = ["أسود", "سوداء", "أبيض", "بيضاء", "أحمر", "حمراء", "أزرق", "زرقاء", "أخضر", "خضراء", "أصفر", "صفراء", "رمادي", "بيج", "كحلي", "برتقالي", "بنفسجي", "وردي", "بمبي", "ذهبي", "فضي", "زيتي", "نبيتي", "عنابي", "موف", "هافان", "بني", "أوف وايت"];
const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ENGLISH_COLOUR_WORDS = [...Object.keys(COLOR_NAME_MAP), "black", "white", "orange", "red", "blue", "green", "pink", "grey", "gray", "beige", "navy", "brown", "purple", "yellow"];
const COPY_COLOUR_SOURCE = [
  `\\b(?:${ENGLISH_COLOUR_WORDS.map(escapeRegExp).join("|")})\\b`,
  `(?<![\\u0600-\\u06ff])و?(?:بال|ال|ب)?(?:${ARABIC_COLOUR_WORDS.join("|")})(?![\\u0600-\\u06ff])`,
].join("|");
const COPY_COLOUR_WORDS = new RegExp(COPY_COLOUR_SOURCE, "i");

/* Stock phrases and quality claims the shop cannot stand behind. A term the
 * brand reference itself uses (ASICS' impact cushioning) stays allowed for
 * that brand. */
const COPY_CLICHES = [
  /يجمع بين|تجمع بين|صُمم|صُممت|مصمم خصيص|استمتع|اكتشف|ارتق|الخيار الأمثل|الخيار المثالي|الاختيار المثالي|إضافة مثالية|خزان|فائق|عالية الجودة|جودة عالية|متين|متانة|حماية|يدوم طويل|لا مثيل|فريد|فخامة/,
  /امتصاص (ال)?صدمات|يمتص (ال)?صدمات|بيمتص (ال)?(صدمات|خبط)/,
  /\b(durable|durability|high[- ]quality|premium materials?|unmatched|unparalleled|ultimate|revolutionary|elevate|seamless(ly)?|perfect addition|protection)\b/i,
  /\bshock[- ]absorb/i,
];

const copyRejects = (reference = "") => {
  const cliches = COPY_CLICHES.filter((pattern) => !pattern.test(reference));
  return (value = "") => OFF_LIMITS_COPY.test(value) || COPY_COLOUR_WORDS.test(value) || cliches.some((pattern) => pattern.test(value));
};

const keepAllowedSentences = (value = "", rejects = copyRejects()) =>
  splitSentences(value)
    .filter((sentence) => !rejects(sentence))
    .join(" ");

/* "Adidas Advantage Black Orange Sneakers For Men" -> "Adidas Advantage": the
 * type and audience are written in Arabic next to it, and the colours belong
 * to one colourway only. A name that would empty out stays as it is. */
export const cleanModelName = (name = "") => {
  const original = cleanText(name);
  const cleaned = original
    .replace(new RegExp(COPY_COLOUR_SOURCE, "gi"), " ")
    .replace(/\b(sneakers?|shoes?|trainers?|for\s+(men|women|kids|boys|girls)|men'?s|women'?s|kids'?|unisex)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—/&,]+|[\s\-–—/&,]+$/g, "")
    .trim();
  return cleaned || original;
};

const wordCount = (value = "") => cleanText(value).split(/\s+/).filter(Boolean).length;

const structuredSubject = (context = {}, language = "ar") => {
  const facts = localizedFacts(context);
  const name = cleanModelName(context.product_name);
  const brandField = cleanText(context.brand);
  // A name that already carries a known brand keeps it alone ("Nike Adidas Running").
  const nameBrand = brandKnowledgeFor({ name });
  const brand = nameBrand && !nameBrand.brand.toLowerCase().includes(brandField.toLowerCase().split(/\s+/)[0] || " ") ? "" : brandField;
  const displayName = [brandInName(brand, name) ? "" : brand, name].filter(Boolean).join(" ");
  if (language === "en") return displayName;
  return [facts.type_ar, displayName, facts.audience_ar].filter(Boolean).join(" ");
};

export const buildStructuredDescriptionPrompt = (context = {}, language = "ar") => {
  const facts = localizedFacts(context);
  const subject = structuredSubject(context, language);
  const material = cleanText(context.material);
  const reference = brandKnowledgeReference(brandKnowledgeFor({ brand: context.brand, name: context.product_name }), language);
  if (language === "en") {
    return [
      "Write a professional product page description for M1 Store, an Egyptian footwear and bags shop, in the style of a global brand listing.",
      "Facts:",
      facts.type_en ? `Type: ${facts.type_en}` : "",
      facts.audience_en ? `Audience: ${facts.audience_en} (never write another audience)` : "",
      cleanText(context.brand) ? `Brand: ${cleanText(context.brand)}` : "",
      `Model: ${cleanModelName(context.product_name)}`,
      material ? `Material: ${material}` : "",
      reference ? `Brand reference (draw on the parts that fit this model; do not copy it word for word):\n${reference}` : "",
      "Return JSON only with keys headline, intro, features, why, ideal_for.",
      `headline: one line of 6 to 14 words naming "${subject}" and its two strongest points, separated by " • ".`,
      "intro: one paragraph, 2 to 3 sentences (35 to 55 words): how it feels and what it is made for.",
      "features: 4 or 5 items, each {title: 2 to 4 words, detail: one sentence of 8 to 16 words}.",
      "why: one paragraph, 2 to 3 sentences (30 to 45 words).",
      "ideal_for: 3 or 4 short phrases (2 to 5 words each).",
      "Rules:",
      "- Never mention colours, sizes, price, discounts, shipping, stock or ordering: the page shows those itself.",
      "- Never claim the product is original, authentic or under warranty.",
      "- If you know this exact model well (for example Nike Air Force 1 or Skechers Slip-ins), describe its well-known design features. If you are not sure, write only about design, comfort in wear and how easy it is to style. Never invent technology or material names.",
      "- Never mention durability, material quality, protection or shock absorption unless the brand reference or the material says so.",
      "- Confident, clean retail English. Complete sentences, no emojis, no exclamation marks, no filler such as elevate, seamless, ultimate, unparalleled or perfect addition to your wardrobe.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const women = facts.audience_en === "women";
  return [
    "أنت كاتب محتوى محترف لمتجر M1 Store (أحذية وشنط في مصر). اكتب وصف صفحة منتج احترافي ومنظم بأسلوب المتاجر العالمية.",
    women ? "المنتج حريمي: خاطبي العميلة بصيغة المؤنث لو خاطبتها." : "",
    "الحقائق:",
    facts.type_ar ? `النوع: ${facts.type_ar}` : "",
    facts.audience_ar ? `الفئة: ${facts.audience_ar} (استخدمها بالضبط ولا تكتب فئة أخرى)` : "",
    cleanText(context.brand) ? `الماركة: ${cleanText(context.brand)}` : "",
    `الموديل: ${cleanModelName(context.product_name)}`,
    material ? `الخامة: ${material}` : "",
    reference ? `مرجع عن الماركة (استعين باللي يناسب الموديل ده بس، ومتنقلوش حرفيًا):\n${reference}` : "",
    "أرجع JSON فقط بالمفاتيح headline, intro, features, why, ideal_for.",
    `headline: سطر واحد من 6 إلى 14 كلمة يبدأ بـ "${subject}" ثم أهم ميزتين مفصولين بـ " • ".`,
    "intro: فقرة واحدة من 2 إلى 3 جمل (35 إلى 55 كلمة): الإحساس في اللبس ولإيه معمول.",
    "features: 4 أو 5 عناصر، كل عنصر {title: من 2 إلى 4 كلمات، detail: جملة واحدة من 8 إلى 16 كلمة}.",
    "why: فقرة من 2 إلى 3 جمل (30 إلى 45 كلمة).",
    "ideal_for: 3 أو 4 عبارات قصيرة (من 2 إلى 5 كلمات).",
    "القواعد:",
    "- ممنوع تذكر الألوان أو المقاسات أو السعر أو الخصومات أو الشحن أو المخزون أو الطلب: الصفحة بتعرضهم لوحدها.",
    "- ممنوع تقول إن المنتج أصلي أو original أو عليه ضمان.",
    "- لو عارف الموديل ده بالظبط (زي Nike Air Force 1 أو Skechers Slip-ins) اذكر مميزات تصميمه المعروفة. لو مش متأكد، اتكلم عن التصميم والراحة في اللبس وسهولة التنسيق بس، ولا تخترع أسماء تقنيات أو خامات.",
    "- ممنوع تتكلم عن المتانة أو جودة الخامات أو الحماية أو امتصاص الصدمات إلا لو مذكورة في المرجع أو الخامة.",
    "- اكتب بعربي بسيط وواضح قريب من كلام المصريين المحترم، مش فصحى تقيلة ولا عامية سوقية. جمل كاملة، بدون إيموجي وبدون علامات تعجب. اسم الماركة والموديل بالإنجليزي زي ما هو.",
    "- ممنوع العبارات المستهلكة: يجمع بين، صُمم، استمتع، اكتشف، الخيار الأمثل، إضافة مثالية لخزانتك، فائقة، عالية الجودة، فريد.",
    "- استخدم كلمات المصريين: كوتشي، شنطة، سليبر، كروكس، بوت. لا تكتب حذاء رياضي.",
  ]
    .filter(Boolean)
    .join("\n");
};

/* Model sections survive only when they are complete and agree with the facts;
 * sentences about colours, sizes, price or authenticity are dropped. */
export const normalizeStructuredSections = (raw = {}, context = {}, language = "ar") => {
  const facts = localizedFacts(context);
  const rejects = copyRejects(brandKnowledgeReference(brandKnowledgeFor({ brand: context.brand, name: context.product_name }), language));
  const polish = (value = "") => {
    const textValue = dropPlaceholderBrand(value);
    return language === "ar" ? egyptianiseSearchWords(textValue) : textValue;
  };
  const intro = polish(keepAllowedSentences(raw.intro, rejects));
  const why = polish(keepAllowedSentences(raw.why, rejects));
  const features = (Array.isArray(raw.features) ? raw.features : [])
    .map((item) => ({ title: polish(item?.title).replace(/[:：.]+$/, ""), detail: polish(item?.detail) }))
    .filter((item) => item.title && item.detail && wordCount(item.title) <= 6 && !rejects(`${item.title} ${item.detail}`))
    .slice(0, 5);
  const idealFor = (Array.isArray(raw.ideal_for) ? raw.ideal_for : [])
    .map((item) => polish(item).replace(/[.،,]+$/, ""))
    .filter((item) => item && wordCount(item) <= 8 && !rejects(item))
    .slice(0, 4);
  if (wordCount(intro) < 8 || features.length < 3) return null;
  // A headline that repeats the raw catalogue name, names a colour or leans on
  // a stock phrase is rebuilt from the subject and the first two features.
  const rawHeadline = polish(raw.headline);
  const catalogueName = cleanText(context.product_name).toLowerCase();
  const nameWasCleaned = catalogueName !== cleanModelName(context.product_name).toLowerCase();
  const headlineUsable = rawHeadline && !rejects(rawHeadline) && !(nameWasCleaned && rawHeadline.toLowerCase().includes(catalogueName));
  const headline = headlineUsable ? rawHeadline : [structuredSubject(context, language), features[0].title, features[1].title].join(" • ");
  if (language === "ar" && contradictsFacts(`${headline} ${intro} ${why}`, facts, { scope: "lead" })) return null;
  return { headline, intro, features, why, ideal_for: idealFor };
};

/* Honest generic sections for when no model answers: design, wear, styling. */
export const fallbackStructuredSections = (context = {}, language = "ar") => {
  const generic = genericStructuredSections(context, language);
  const known = brandKnowledgeFeatures(brandKnowledgeFor({ brand: context.brand, name: context.product_name }), language).slice(0, 3);
  if (!known.length) return generic;
  const knownTitles = new Set(known.map((item) => item.title));
  // Brand features lead; the generic styling line always closes the list.
  const styling = generic.features[generic.features.length - 1];
  const filler = generic.features.slice(0, -1).filter((item) => !knownTitles.has(item.title));
  const features = [...known, ...filler].slice(0, 4);
  return { ...generic, features: [...features, styling] };
};

const genericStructuredSections = (context = {}, language = "ar") => {
  const facts = localizedFacts(context);
  const subject = structuredSubject(context, language);
  const material = cleanText(context.material);
  const isBag = /bag|backpack/.test(facts.type_en);
  const women = facts.audience_en === "women";
  if (language === "en") {
    const what = [facts.audience_en ? `${facts.audience_en}'s` : "", facts.type_en || "style"].filter(Boolean).join(" ");
    return {
      headline: `${subject} • Clean Modern Design • Everyday Comfort`,
      intro: `The ${subject} brings a clean, modern shape to ${what} made for daily wear. It keeps your look neat and pairs easily with casual and smart-casual outfits.`,
      features: [
        { title: "Modern Design", detail: "Clean lines and a balanced shape that look sharp from every angle." },
        isBag
          ? { title: "Practical Everyday Use", detail: "Easy to carry and ready for the essentials you take out every day." }
          : { title: "Everyday Comfort", detail: "Comfortable to wear through long days in and out of the house." },
        material ? { title: "Material", detail: `Made with ${material} for a finished, reliable feel.` } : { title: "Neat Finish", detail: "Tidy details that keep the piece looking polished with regular wear." },
        { title: "Easy to Style", detail: "Works with jeans, chinos and casual looks without extra effort." },
      ],
      why: `It gives you a polished look without giving up comfort. A simple, versatile pick that fits into your daily routine and works with more than one style.`,
      ideal_for: ["Everyday wear", "Casual outings", "Work and university", "Weekend looks"],
    };
  }
  return {
    headline: `${subject} • تصميم عصري • راحة في اللبس اليومي`,
    intro: `${subject} بتصميم عصري وخطوط نظيفة معمول للاستخدام اليومي. شكله مرتب وبيتنسق بسهولة مع اللبس الكاجوال والسمارت كاجوال.`,
    features: [
      { title: "تصميم عصري", detail: "خطوط نظيفة وشكل متوازن بيبان شيك من كل الزوايا." },
      isBag
        ? { title: "عملية في الاستخدام", detail: "سهلة في الحمل ومناسبة لحاجاتك الأساسية كل يوم." }
        : { title: "راحة في اللبس", detail: "مريح في الاستخدام اليومي حتى مع الأيام الطويلة برا البيت." },
      material ? { title: "الخامة", detail: `مصنوع من ${material} بإحساس متقن في الإيد واللبس.` } : { title: "تشطيب مرتب", detail: "تفاصيل مظبوطة بتحافظ على شكله الشيك مع الاستخدام." },
      { title: "سهل التنسيق", detail: women ? "بيمشي مع الجينز والفساتين واللبس الكاجوال من غير مجهود." : "بيمشي مع الجينز والبنطلونات القماش واللبس الكاجوال من غير مجهود." },
    ],
    why: women
      ? "هيديكي شكل شيك من غير ما تتنازلي عن الراحة. اختيار بسيط ومتعدد الاستخدامات بيناسب يومك وأكتر من ستايل."
      : "بيديك شكل شيك من غير ما تتنازل عن الراحة. اختيار بسيط ومتعدد الاستخدامات بيناسب يومك وأكتر من ستايل.",
    ideal_for: ["اللبس اليومي", "الخروجات الكاجوال", "الشغل والجامعة", "إطلالات الويك إند"],
  };
};

const descriptionFailure = (error) => ({
  status: Number(error?.status || error?.response?.status || 0) || undefined,
  message: error?.message || "text provider request failed",
});

export const generateProductDescription = async (input = {}) => {
  const context = compactContext(input);
  const target = cleanText(input.target || input.language || "all").toLowerCase() || "all";
  const targets = requestedTargets(target);
  const requestId = cleanText(input.request_id) || `product-description-${Date.now()}`;
  const facts = localizedFacts(context);
  const languages = [targets.arabic ? "ar" : "", targets.english ? "en" : ""].filter(Boolean);
  const compose = (sections, language) => composeProductDescription(sections, language, { audience: facts.audience_en });
  const keyFor = (language) => (language === "ar" ? "arabic_description" : "english_description");
  const result = { arabic_description: "", english_description: "" };

  const provider = resolveTextProvider();
  if (provider.kind === "none") {
    console.warn("[product-description] no text provider configured; using fallback", { requestId });
    languages.forEach((language) => {
      result[keyFor(language)] = compose(fallbackStructuredSections(context, language), language);
    });
    return { ...result, source: "LOCAL_FALLBACK" };
  }

  let failure = null;
  for (const language of languages) {
    const startedAt = Date.now();
    try {
      console.log("[product-description] text provider request start", { requestId, language, model: provider.model });
      const parsed = await requestStructuredJson({
        provider,
        requestId,
        label: "product-description",
        instructions:
          language === "ar"
            ? "You are a senior ecommerce copywriter writing professional Arabic product pages for an Egyptian footwear and bags store."
            : "You are a senior ecommerce copywriter writing professional English product pages for a footwear and bags store.",
        prompt: buildStructuredDescriptionPrompt(context, language),
        schemaName: "product_page_description",
        schema: structuredDescriptionSchema,
        verbosity: "medium",
        maxTokens: language === "ar" ? 720 : 560,
      });
      console.log("[product-description] text provider request end", { requestId, language, durationMs: Date.now() - startedAt });
      const sections = normalizeStructuredSections(parsed, context, language);
      if (!sections) {
        failure = failure || { message: `model copy for ${language} was incomplete or contradicted the product facts` };
        result[keyFor(language)] = compose(fallbackStructuredSections(context, language), language);
        continue;
      }
      result[keyFor(language)] = compose(sections, language);
    } catch (error) {
      console.error("[product-description] text provider request failed", {
        requestId,
        language,
        durationMs: Date.now() - startedAt,
        status: error?.status,
        code: error?.code,
        message: error?.message,
      });
      failure = failure || descriptionFailure(error);
      result[keyFor(language)] = compose(fallbackStructuredSections(context, language), language);
    }
  }

  if (!failure) return { ...result, source: provider.label };
  return {
    ...result,
    source: "LOCAL_FALLBACK",
    // The status is not a secret: a batch job needs it to wait out a 429.
    error_status: failure.status,
    error: process.env.NODE_ENV === "production" ? undefined : failure.message,
  };
};

export const generateSocialPublisherCaption = async (input = {}) => {
  const context = compactSocialCaptionContext(input);
  const facts = buildProductFacts(context);
  const fallback = buildSocialCaptionFallback(context);
  const requestId = cleanText(input.request_id) || `social-caption-${Date.now()}`;
  const provider = resolveTextProvider();
  if (provider.kind === "none") {
    console.warn("[social-caption] no text provider configured; using fallback", { requestId });
    return { ...fallback, source: "LOCAL_FALLBACK" };
  }
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
    const model = provider.model;
    console.log("[social-caption] text provider request start", {
      requestId,
      model,
    });

    const parsed = await requestStructuredJson({
      provider,
      requestId,
      label: "social-caption",
      instructions: "You are an expert luxury ecommerce social media copywriter.",
      prompt: buildSocialCaptionPrompt(facts),
      schemaName: "social_caption",
      schema: socialCaptionSchema,
      verbosity: "medium",
      maxTokens: 300,
    });
    const generated = normalizeSocialCaptionGenerated(parsed, fallback);
    console.log("[social-caption] text provider request end", {
      requestId,
      durationMs: Date.now() - startedAt,
    });

    return {
      ...generated,
      source: provider.label,
    };
  } catch (error) {
    const model = provider.model;
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

// The products API fills a missing brand with "Unbranded"; that is a placeholder,
// not a brand, and must never reach a search title or keyword.
const PLACEHOLDER_BRAND = /^(unbranded|no[\s-]?brand|generic|none|n\/?a|-+|بدون\s*(ماركة|براند))$/i;
const realBrand = (value = "") => {
  const brand = cleanText(value);
  return PLACEHOLDER_BRAND.test(brand) ? "" : brand;
};

const dropPlaceholderBrand = (value = "") =>
  cleanText(value).replace(/(\s+من)?\s*\b(unbranded|no[\s-]?brand)\b/gi, " ").replace(/\s{2,}/g, " ").trim();

export const localizeSeoColor =(value = "") => localizeColorName(value);

const compactSeoContext = (input = {}) => {
  const current = input.current || input;
  return {
    // One listing covers every colourway: the search title names the model, not
    // the colours baked into the catalogue name.
    product_name: cleanModelName(current.product_name || current.name || input.product_name || input.name),
    brand: realBrand(current.brand || current.brand_name || input.brand),
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
  const nameHasBrand = brandInName(brand, name);
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

  // "Puma Sneakers" + "sneakers" must not become puma-sneakers-sneakers.
  const nameHasType = Boolean(typeEn) && name.toLowerCase().includes(typeEn.toLowerCase());
  const slug = slugifySeo([nameHasBrand ? "" : brand, name, nameHasType ? "" : typeEn, genderEn].filter(Boolean).join(" ")) || slugifySeo(name);

  return {
    meta_title: metaTitle,
    meta_description: metaDescription,
    keywords,
    slug,
  };
};

const buildCompactSeoPrompt = (context = {}) => {
  const facts = localizedFacts(context);
  const brand = cleanText(context.brand);
  const name = cleanText(context.product_name);
  const subject = [facts.type_ar, brandInName(brand, name) ? "" : brand, name, facts.audience_ar].filter(Boolean).join(" ");
  return [
    "أنت متخصص SEO لمتجر M1 Store (أحذية وشنط في مصر). أرجع JSON فقط بالمفاتيح meta_title, meta_description, keywords, slug.",
    "الحقائق:",
    facts.type_ar ? `النوع: ${facts.type_ar}` : "",
    facts.audience_ar ? `الفئة: ${facts.audience_ar} (استخدمها بالضبط، لا تكتب فئة أخرى)` : "",
    cleanText(context.brand) ? `الماركة: ${cleanText(context.brand)}` : "",
    `الاسم: ${cleanText(context.product_name)}`,
    facts.colors_ar.length ? `الألوان: ${facts.colors_ar.join("، ")}` : "",
    facts.sizes_ar ? `المقاسات: ${facts.sizes_ar}` : "",
    `meta_title: بالضبط "${subject}" مع لون واحد فقط لو مهم، أقل من ${SEO_TITLE_MAX} حرف، بدون اسم المتجر.`,
    `meta_description: جملتان طبيعيتان بالعربي بين 110 و${SEO_DESCRIPTION_MAX} حرف: ما هو المنتج ولمن، الألوان والمقاسات، ثم "اطلبه الآن من M1 Store."`,
    "keywords: 6 إلى 8 عبارات بحث قصيرة (عربي + اسم الماركة بالإنجليزي). بدون أرقام مقاسات وبدون هاشتاج.",
    "استخدم كلمات البحث المصرية: كوتشي، شنطة، سليبر، كروكس، بوت. لا تكتب حذاء رياضي أو أحذية رياضية.",
    `slug: كلمات إنجليزية صغيرة مفصولة بشرطة من الماركة والاسم والنوع بالإنجليزي (${[facts.type_en, facts.audience_en].filter(Boolean).join(", ") || "بدون فئة"}). لا تكتب كلمات عربية بحروف لاتينية مثل kutchi.`,
    "لا تخترع خامات أو مزايا أو خصومات.",
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildSeoPrompt = (context = {}, { compact = false } = {}) => {
  if (compact) return buildCompactSeoPrompt(context);
  const facts = localizedFacts(context);
  return [
    "You write search-engine metadata for M1 Store, an Egyptian footwear and bags shop (m1store-egy.com).",
    "Return strict JSON only with keys meta_title, meta_description, keywords, slug.",
    "Language: Arabic-first for Egyptian shoppers. Keep the brand and model names in Latin exactly as customers type them (for example: كوتشي Nike Air Force 1 رجالي).",
    "Use the search words Egyptians actually use: كوتشي، شنطة، سليبر، كروكس، بوت، رجالي، حريمي، أطفال. Never use حذاء رياضي or formal MSA marketing phrasing.",
    facts.type_ar || facts.audience_ar
      ? `Arabic words to use verbatim: ${[facts.type_ar, facts.audience_ar].filter(Boolean).join("، ")}. Never swap the audience word.`
      : "",
    `meta_title: at most ${SEO_TITLE_MAX} characters. Pattern: product type + brand/model + audience (+ one colour only if it is the defining feature). Do NOT include the store name; the site appends it.`,
    `meta_description: 120 to ${SEO_DESCRIPTION_MAX} characters, one or two natural sentences: what it is, who it is for, colours/sizes if supplied, and a short soft call to action such as اطلبه الآن من M1 Store.`,
    "keywords: 6 to 10 short search phrases mixing Arabic phrases and Latin brand/model terms. No hashtags, no duplicates, no bare size numbers, the store name at most once.",
    `slug: Latin lowercase words joined by hyphens, at most ${SEO_SLUG_MAX} characters, built from brand, model, product type and audience. No Arabic letters, no stop words.`,
    "Use only the supplied product facts. Do not invent material, technology, comfort features, authenticity, discounts, shipping promises or stock claims.",
    "No emojis, no exclamation marks, no keyword stuffing.",
    context.tone ? `Optional tone customization: ${context.tone}.` : "",
    `Product facts:\n${JSON.stringify({ ...context, ...facts }, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const OPPOSITE_SLUG_TOKENS = { men: ["women", "kids"], women: ["men", "kids"], kids: ["men", "women"] };

/* Model output is merged with the deterministic template field by field: a
 * field survives only when it is well-formed AND agrees with the product facts
 * (audience, product type). Anything else takes the template value, so a
 * weak model can only ever make the metadata better, never wrong. */
export const normalizeSeoGenerated = (raw = {}, fallback = {}, context = {}) => {
  const facts = localizedFacts(context);
  const titleCandidate = clipAtWord(egyptianiseSearchWords(stripStoreSuffix(dropPlaceholderBrand(raw.meta_title || raw.title || ""))), SEO_TITLE_MAX);
  const titleAgrees =
    titleCandidate &&
    !contradictsFacts(titleCandidate, facts) &&
    (!facts.type_ar || titleCandidate.includes(facts.type_ar)) &&
    (!facts.audience_ar || titleCandidate.includes(facts.audience_ar));
  const metaTitle = titleAgrees ? titleCandidate : fallback.meta_title || titleCandidate || "";

  const descriptionCandidate = clipAtWord(egyptianiseSearchWords(dropPlaceholderBrand(raw.meta_description || raw.seo_description || raw.description || "").replace(/\s+([.،,])/g, "$1")), SEO_DESCRIPTION_MAX);
  const descriptionAgrees = descriptionCandidate.length >= 60 && !contradictsFacts(descriptionCandidate, facts, { scope: "lead" });
  const metaDescription = descriptionAgrees ? descriptionCandidate : fallback.meta_description || descriptionCandidate || "";

  const rawKeywords = Array.isArray(raw.keywords) ? raw.keywords : String(raw.keywords || "").split(/[,،\n]/);
  const cleanKeywords = uniqueKeywords(
    rawKeywords.filter((keyword) => !/\b(unbranded|no[\s-]?brand)\b/i.test(String(keyword || ""))).map(egyptianiseSearchWords)
  ).filter(
    (keyword) => keyword.length >= 3 && !/^[\d\s.,/-]+$/.test(keyword) && !contradictsFacts(keyword, facts) && !TRANSLITERATED_ARABIC.test(keyword)
  );
  const keywords = uniqueKeywords([...cleanKeywords, ...(fallback.keywords || [])], 10);

  const slugCandidate = slugifySeo(raw.slug || raw.canonical_slug || "")
    .replace(/[؀-ۿ]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const slugTokens = slugCandidate.split("-").filter((token) => !TRANSLITERATED_ARABIC.test(token));
  const cleanedSlug = slugTokens.join("-");
  const slugAgrees =
    slugCandidate && !(OPPOSITE_SLUG_TOKENS[facts.audience_en] || []).some((token) => slugTokens.includes(token));
  return {
    meta_title: metaTitle,
    meta_description: metaDescription,
    keywords,
    slug: slugAgrees ? cleanedSlug : fallback.slug || cleanedSlug || "",
  };
};

export const generateProductSeoMetadata = async (input = {}) => {
  const context = compactSeoContext(input);
  const fallback = buildSeoFallback(context);
  const requestId = cleanText(input.request_id) || `product-seo-${Date.now()}`;

  if (!context.product_name) {
    return { ...fallback, source: "LOCAL_FALLBACK", error: "PRODUCT_NAME_REQUIRED" };
  }

  const provider = resolveTextProvider();
  if (provider.kind === "none") {
    console.warn("[product-seo] no text provider configured; using fallback", { requestId });
    return { ...fallback, source: "LOCAL_FALLBACK" };
  }

  const startedAt = Date.now();
  const model = provider.model;
  try {
    console.log("[product-seo] text provider request start", { requestId, model });
    const parsed = await requestStructuredJson({
      provider,
      requestId,
      label: "product-seo",
      instructions: "You are a senior ecommerce SEO specialist for the Egyptian market. You write concise, honest, search-friendly Arabic metadata.",
      prompt: buildSeoPrompt(context, { compact: usesCompactPrompt(provider) }),
      schemaName: "product_seo_metadata",
      schema: seoMetadataSchema,
      verbosity: "low",
      maxTokens: 260,
    });
    console.log("[product-seo] text provider request end", { requestId, durationMs: Date.now() - startedAt });
    return { ...normalizeSeoGenerated(parsed, fallback, context), source: provider.label };
  } catch (error) {
    console.error("[product-seo] text provider request failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      status: error?.status,
      code: error?.code,
      message: error?.message,
    });
    return {
      ...fallback,
      source: "LOCAL_FALLBACK",
      error_status: Number(error?.status || 0) || undefined,
      error: process.env.NODE_ENV === "production" ? undefined : error?.message || "text provider request failed",
    };
  }
};
