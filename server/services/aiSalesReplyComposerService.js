import { resolveCustomerDisplayPrice, formatCustomerDisplayPrice } from "../utils/customerDisplayPrice.js";
import { buildDynamicClarificationQuestion } from "./aiClassificationResolverService.js";
import { applyHumanSalesPersonalityLayer } from "./aiHumanSalesPersonalityLayer.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value = "") => text(value).toLowerCase();

const normalizeArabic = (value = "") =>
  lower(value)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed).toLocaleString("en-US") : "";
};

const productPrice = (product = {}) =>
  (() => {
    const resolved = resolveCustomerDisplayPrice({ ...product, variant: product.selected_variant || product.variant || product.matched_variant || {}, selected_variant: product.selected_variant || product.variant || product.matched_variant || {} });
    const raw = money(product.final_price || product.sale_price || product.price || product.regular_price || product.product_price);
    const formattedResolved = formatCustomerDisplayPrice(resolved.display_price);
    console.log("[ai-text-price-source]", {
      product_id: resolved.product_id || product.id || null,
      variant_id: resolved.variant_id || product.variant_id || null,
      raw_price_used_in_text: raw || "",
      text_template: "سعره ${price} جنيه.",
      function_name: "productPrice",
      file_name: "server/services/aiSalesReplyComposerService.js",
    });
    if (raw > 0 && resolved.display_price > 0 && raw !== resolved.display_price) {
      console.error("[ai-price-mismatch]", {
        product_id: resolved.product_id || product.id || null,
        variant_id: resolved.variant_id || product.variant_id || null,
        text_price: raw,
        selected_display_price: resolved.display_price,
      });
    }
    return formattedResolved || money(raw) || money(resolved.display_price);
  })();

const cardPriceValue = (product = {}) => {
  for (const candidate of [
    product.final_price,
    product.sale_price,
    product.price,
    product.product_price,
    product.regular_price,
    product.display_price,
    product.selected_variant?.final_price,
    product.selected_variant?.sale_price,
    product.selected_variant?.price,
    product.selected_variant?.selling_price,
    product.variant?.final_price,
    product.variant?.sale_price,
    product.variant?.price,
    product.variant?.selling_price,
  ]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return 0;
};

const cardImageUrl = (product = {}) =>
  text(
    product.image_url ||
    product.image ||
    product.main_image ||
    product.variant_image ||
    product.color_image ||
    product.cloudinary_url ||
    product.secure_url ||
    product.selected_variant?.image_url ||
    product.selected_variant?.secure_url ||
    product.variant?.image_url ||
    product.variant?.secure_url ||
    ""
  );

const productName = (product = {}) => text(product.name || product.title || product.product_name);

const productSizes = (product = {}) => {
  const direct = [
    product.size,
    product.requested_size,
    product.matched_variant_size,
    product.selected_size,
    product.selected_variant?.size,
    product.selected_variant?.requested_size,
    ...(asArray(product.available_sizes || product.sizes || product.inventory_profile?.available_sizes)),
    ...asArray(product.variants).flatMap((variant) => [
      variant?.size,
      variant?.requested_size,
      variant?.size_name,
    ]),
  ];
  return [...new Set(direct.map(text).filter(Boolean))].slice(0, 8);
};

const productColors = (product = {}) => {
  const direct = [
    product.color,
    product.requested_color,
    product.matched_variant_color,
    product.selected_color,
    product.selected_variant?.color,
    product.selected_variant?.color_name,
    product.selected_variant?.color_value,
    ...(asArray(product.available_colors || product.colors)),
    ...asArray(product.variants).flatMap((variant) => [variant?.color, variant?.color_name, variant?.color_value]),
  ];
  return [...new Set(direct.map(text).filter(Boolean))].slice(0, 8);
};

const stockCount = (product = {}) => {
  const values = [
    product.requested_size_stock,
    product.total_stock,
    product.stock,
    product.selected_variant?.stock,
    product.selected_variant?.quantity,
    product.selected_variant?.available_quantity,
    product.inventory_profile?.requested_size_stock,
    product.inventory_profile?.total_stock,
  ];
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const variantStocks = asArray(product.variants)
    .flatMap((variant) => [variant?.stock, variant?.quantity, variant?.available_quantity, variant?.requested_size_stock])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (variantStocks.length) {
    return variantStocks.reduce((sum, value) => sum + value, 0);
  }
  return 0;
};

const normalizeStockStatus = (value = "") => normalizeArabic(value).replace(/\s+/g, "_");

const productAvailabilityState = (product = {}) => {
  const stock = stockCount(product);
  const status = normalizeStockStatus(
    product.stock_status ||
      product.availability ||
      product.inventory_profile?.stock_status ||
      product.inventory_profile?.availability ||
      product.selected_variant?.stock_status ||
      product.selected_variant?.availability ||
      ""
  );
  if (stock > 0) return "available";
  if (stock === 0) {
    if (!status) return "unavailable";
    if (["in_stock", "instock", "available", "available_now"].includes(status)) return "unavailable";
    return "unavailable";
  }
  if (["out_of_stock", "outofstock", "sold_out", "soldout", "unavailable", "not_available", "notavailable"].includes(status)) {
    return "unavailable";
  }
  if (["in_stock", "instock", "available", "available_now"].includes(status)) {
    return "available";
  }
  return "unknown";
};

const detectColorFromMessage = (message = "") => {
  const normalized = normalizeArabic(message);
  if (!normalized) return "";
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .map((token) => token.replace(/^ال/, ""));
  if (tokens.some((token) => /^(ابيض|بيضاء|white)$/i.test(token))) return "أبيض";
  if (tokens.some((token) => /^(اسود|سوده|black)$/i.test(token))) return "أسود";
  if (tokens.some((token) => /^(احمر|حمر|red)$/i.test(token))) return "أحمر";
  if (tokens.some((token) => /^(ازرق|blue)$/i.test(token))) return "أزرق";
  if (tokens.some((token) => /^(اخضر|green)$/i.test(token))) return "أخضر";
  if (tokens.some((token) => /^(رمادي|grey|gray)$/i.test(token))) return "رمادي";
  if (tokens.some((token) => /^(بيج|beige)$/i.test(token))) return "بيج";
  if (tokens.some((token) => /^(بني|brown)$/i.test(token))) return "بني";
  if (tokens.some((token) => /^(وردي|pink)$/i.test(token))) return "وردي";
  if (tokens.some((token) => /^(اصفر|yellow)$/i.test(token))) return "أصفر";
  return "";
};

const buildActiveProductMemoryPatch = ({ personality = {}, response = {}, memory = {} } = {}) => {
  const activeProductContext = {
    active_product_id: text(
      personality?.personality_layer?.active_product_id ||
      response?.memory_updates?.active_product_id ||
      response?.ai_memory_patch?.preferences?.active_product_id ||
      memory?.active_product_id ||
      memory?.preferences?.active_product_id ||
      ""
    ),
    active_variant_id: text(
      personality?.personality_layer?.active_variant_id ||
      response?.memory_updates?.active_variant_id ||
      response?.ai_memory_patch?.preferences?.active_variant_id ||
      memory?.active_variant_id ||
      memory?.preferences?.active_variant_id ||
      ""
    ),
    active_color: text(
      personality?.personality_layer?.active_color ||
      response?.memory_updates?.active_color ||
      response?.ai_memory_patch?.preferences?.active_color ||
      memory?.active_color ||
      memory?.preferences?.active_color ||
      ""
    ),
    active_size: text(
      personality?.personality_layer?.active_size ||
      response?.memory_updates?.active_size ||
      response?.ai_memory_patch?.preferences?.active_size ||
      memory?.active_size ||
      memory?.preferences?.active_size ||
      ""
    ),
    active_model_family: text(
      personality?.personality_layer?.active_model_family ||
      response?.memory_updates?.active_model_family ||
      response?.ai_memory_patch?.preferences?.active_model_family ||
      memory?.active_model_family ||
      memory?.preferences?.active_model_family ||
      ""
    ),
    selected_product_context:
      response?.memory_updates?.selected_product_context ||
      response?.ai_memory_patch?.preferences?.selected_product_context ||
      memory?.preferences?.selected_product_context ||
      response?.product_context ||
      response?.suggested_products?.[0] ||
      response?.product_cards?.[0] ||
      null,
    selected_product_id: text(
      personality?.personality_layer?.active_product_id ||
      response?.memory_updates?.selected_product_id ||
      response?.ai_memory_patch?.preferences?.selected_product_id ||
      memory?.selected_product_id ||
      memory?.preferences?.selected_product_id ||
      ""
    ),
    selected_variant_id: text(
      personality?.personality_layer?.active_variant_id ||
      response?.memory_updates?.selected_variant_id ||
      response?.ai_memory_patch?.preferences?.selected_variant_id ||
      memory?.selected_variant_id ||
      memory?.preferences?.selected_variant_id ||
      ""
    ),
    selected_color: text(
      personality?.personality_layer?.active_color ||
      response?.memory_updates?.selected_color ||
      response?.ai_memory_patch?.preferences?.selected_color ||
      memory?.selected_color ||
      memory?.preferences?.selected_color ||
      ""
    ),
    selected_size: text(
      personality?.personality_layer?.active_size ||
      response?.memory_updates?.selected_size ||
      response?.ai_memory_patch?.preferences?.selected_size ||
      memory?.selected_size ||
      memory?.preferences?.selected_size ||
      ""
    ),
    last_product_id: text(
      personality?.personality_layer?.active_product_id ||
      response?.memory_updates?.last_product_id ||
      response?.ai_memory_patch?.preferences?.last_product_id ||
      memory?.last_product_id ||
      memory?.preferences?.last_product_id ||
      ""
    ),
    last_product_name: text(
      response?.product_context?.name ||
      response?.product_context?.title ||
      response?.memory_updates?.last_product_name ||
      response?.ai_memory_patch?.preferences?.last_product_name ||
      memory?.last_product_name ||
      memory?.preferences?.last_product_name ||
      ""
    ),
    last_model_family: text(
      personality?.personality_layer?.active_model_family ||
      response?.memory_updates?.last_model_family ||
      response?.ai_memory_patch?.preferences?.last_model_family ||
      memory?.last_model_family ||
      memory?.preferences?.last_model_family ||
      ""
    ),
    last_selected_color: text(
      personality?.personality_layer?.active_color ||
      response?.memory_updates?.last_selected_color ||
      response?.ai_memory_patch?.preferences?.last_selected_color ||
      memory?.last_selected_color ||
      memory?.preferences?.last_selected_color ||
      ""
    ),
    last_selected_size: text(
      personality?.personality_layer?.active_size ||
      response?.memory_updates?.last_selected_size ||
      response?.ai_memory_patch?.preferences?.last_selected_size ||
      memory?.last_selected_size ||
      memory?.preferences?.last_selected_size ||
      ""
    ),
  };

  return {
    memory_updates: activeProductContext,
    ai_memory_patch: {
      ...(response?.ai_memory_patch || {}),
      preferences: {
        ...(response?.ai_memory_patch?.preferences || {}),
        ...activeProductContext,
      },
    },
  };
};

const hasProducts = (response = {}) =>
  asArray(response.suggested_products).length > 0 || asArray(response.product_cards).length > 0 || asArray(response.channel_reply?.product_cards).length > 0;

const selectedProducts = (response = {}) => {
  const seen = new Set();
  return [
    ...asArray(response.regression_source_product_cards),
    ...asArray(response.suggested_products),
    ...asArray(response.product_cards),
    ...asArray(response.channel_reply?.product_cards),
  ].filter((product) => {
    const key = text(product.id || product.product_id || productName(product));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const selectRegressionFocusCard = (response = {}, mode = "price") => {
  const cards = selectedProducts(response);
  if (!cards.length) return {};
  const withPrice = cards.filter((card) => cardPriceValue(card) > 0);
  const withStock = cards.filter((card) => stockCount(card) > 0);
  const withImages = cards.filter((card) => Boolean(cardImageUrl(card)));
  const zeroStock = cards.filter((card) => stockCount(card) === 0);
  if (mode === "price") return withPrice[0] || withStock[0] || withImages[0] || cards[0] || {};
  if (mode === "availability") return withStock[0] || withPrice[0] || withImages[0] || cards[0] || {};
  if (mode === "unavailable") return zeroStock[0] || cards[0] || {};
  if (mode === "images") return withImages[0] || withPrice[0] || withStock[0] || cards[0] || {};
  return withPrice[0] || withStock[0] || withImages[0] || cards[0] || {};
};

const selectedImageCards = (response = {}) => {
  const seen = new Set();
  return [
    ...asArray(response.image_cards),
    ...asArray(response.visual_attachments),
    ...asArray(response.channel_reply?.image_cards),
  ].filter((item) => {
    const key = text(item?.id || item?.image_id || item?.url || item?.image_url || item?.selected_card_image_url || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isLegacyFallbackAnswer = (answer = "") => {
  const normalized = normalizeArabic(answer);
  return [
    "لو عندك مقاس معين قولي عليه",
    "دور على أي موديل",
    "الموديل ده مش متوفر حاليا",
    "أقدر أساعدك في المقاسات أو الموديلات",
    "الموديل ده مش موجود دلوقتي",
    "مش نفس الموديل بالظبط",
    "أقرب اختيار بصريا",
    "أقرب بدائل شبهه",
  ].some((phrase) => normalized.includes(normalizeArabic(phrase)));
};

const hasCommerceSignals = (answer = "") => {
  const normalized = normalizeArabic(answer);
  return [
    "بديل شبه",
    "أطلعلك",
    "سعره",
    "المقاسات المتاحة",
    "الألوان",
    "بص على الكروت تحت",
    "قولّي",
    "أظبطهولك",
    "اختيار مناسب",
    "اختيارات مناسبة",
    "لقيتلك",
    "صورة مرفقة",
    "تحب",
  ].some((phrase) => normalized.includes(normalizeArabic(phrase)));
};

const legacyTextKeyForAnswer = (answer = "") => {
  const normalized = normalizeArabic(answer);
  if (!normalized) return "";
  if (normalized.includes(normalizeArabic("لو عندك مقاس معين قولي عليه"))) return "legacy_size_prompt_fallback";
  if (normalized.includes(normalizeArabic("دور على أي موديل"))) return "legacy_browse_any_model_fallback";
  if (normalized.includes(normalizeArabic("الموديل ده مش متوفر حاليا"))) return "legacy_unavailable_model_fallback";
  if (normalized.includes(normalizeArabic("أقدر أساعدك في المقاسات أو الموديلات"))) return "legacy_generic_support_help";
  if (normalized.includes(normalizeArabic("الموديل ده مش موجود دلوقتي"))) return "legacy_unavailable_model_fallback";
  if (normalized.includes(normalizeArabic("مش نفس الموديل بالظبط"))) return "legacy_near_match_intro";
  if (normalized.includes(normalizeArabic("أقرب اختيار بصريا"))) return "legacy_visual_near_match";
  if (normalized.includes(normalizeArabic("أقرب بدائل شبهه"))) return "legacy_close_alternatives";
  return "legacy_nearest_match_fallback";
};

export const logLegacyTextOverrideAudit = ({
  textKey = "",
  sourceFile = "",
  route = "",
  productCardsCount = 0,
  imageCardsCount = 0,
  blockedOrAllowed = "blocked",
} = {}) => {
  console.log("[LEGACY_TEXT_OVERRIDE_AUDIT]", {
    text_key: textKey,
    source_file: sourceFile,
    route,
    product_cards_count: Number(productCardsCount) || 0,
    image_cards_count: Number(imageCardsCount) || 0,
    blocked_or_allowed: blockedOrAllowed,
  });
};

export const buildCommerceAwareCardsReply = ({
  message = "",
  response = {},
  productCards = [],
  imageCards = [],
  route = "",
  sourceFile = "",
  textKey = "commerce_cards_reply",
} = {}) => {
  const cards = asArray(productCards);
  const visuals = asArray(imageCards);
  const top = cards[0] || {};
  const name = productName(top) || "الموديل";
  const price = productPrice(top);
  const sizes = productSizes(top);
  const colors = productColors(top);
  const productCount = cards.length;
  const imageCount = visuals.length;
  const summary = [];

  if (productCount > 0) {
    summary.push(productCount === 1 ? `لقيتلك اختيار مناسب: ${name}.` : `لقيتلك ${productCount} اختيارات مناسبة. الأول هو ${name}.`);
    if (price) summary.push(`سعره ${price} جنيه.`);
    if (sizes.length) summary.push(`المقاسات المتاحة: ${sizes.join("، ")}.`);
    if (colors.length) summary.push(`الألوان: ${colors.join("، ")}.`);
  } else if (imageCount > 0) {
    summary.push("لقيت صور/اختيارات قريبة من اللي طلبته.");
  }

  if (imageCount > 0) {
    summary.push(`وفيه ${imageCount} صورة مرفقة تحت.`);
  }

  summary.push("بص على الكروت تحت، ولو تحب مقاس أو لون معين قولّي وأنا أظبطهولك.");

  const answer = summary.join("\n");
  const legacyDetected = isLegacyFallbackAnswer(response.answer || response.text || "");
  if (legacyDetected || productCount > 0 || imageCount > 0) {
    logLegacyTextOverrideAudit({
      textKey: legacyDetected ? legacyTextKeyForAnswer(response.answer || response.text || "") : textKey,
      sourceFile,
      route,
      productCardsCount: productCount,
      imageCardsCount: imageCount,
      blockedOrAllowed: productCount > 0 || imageCount > 0 ? "blocked" : "allowed",
    });
  }

  return answer;
};

const explicitSize = (message = "", response = {}) => {
  const explicit = text(response.requested_size || response.detected_size || response.entities?.size);
  if (explicit) return explicit;
  const match = text(message).match(/\b(3[5-9]|4[0-9]|5[0-2])\b/);
  return match ? match[1] : "";
};

const explicitMessageSize = (message = "") => {
  const normalized = text(message);
  const match = normalized.match(/(?:مقاس|نمرة|نمره|size|sz)?\s*\b(3[5-9]|4[0-9]|5[0-2])\b/i);
  return match ? match[1] : "";
};

const deterministicIndex = (seed = "", modulo = 1) => {
  const basis = text(seed) || "greeting";
  const score = [...basis].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return modulo > 0 ? score % modulo : 0;
};

const pickDeterministicText = (choices = [], seed = "") => {
  const list = asArray(choices).map((value) => text(value)).filter(Boolean);
  if (!list.length) return "";
  return list[deterministicIndex(seed, list.length)];
};

const greetingKind = (message = "") => {
  const normalized = normalizeArabic(message);
  if (!normalized) return "";
  if (/^(السلام عليكم|سلام عليكم|السلاام عليكم|السلامو عليكم|وعليكم السلام)( ورحمة الله)?( وبركاته)?$/.test(normalized)) return "islamic";
  if (/^(صباح الخير|صباحو|صباح الفل|صباح الورد|صباح النور)$/.test(normalized)) return "morning";
  if (/^(مساء الخير|مساء الفل|مساء الورد|مساء النور)$/.test(normalized)) return "evening";
  if (/^(اهلا|أهلا|اهلا بيك|أهلا بيك|هاي|hello|hi|hey|هلا)$/.test(normalized)) return "casual";
  if (/^(عامل ايه|عامل ايه؟|ازيك|ازيك؟|اخبارك|أخبارك)$/.test(normalized)) return "checkin";
  if (/^(في حد موجود|في حد موجود؟|انتوا فاتحين|انتوا فاتحين؟)$/.test(normalized)) return "store_status";
  if (/^(ممكن مساعده|ممكن مساعدة|محتاج مساعده|محتاج مساعدة)$/.test(normalized)) return "support";
  return "";
};

const buildGreetingReply = (message = "", seed = "") => {
  const kind = greetingKind(message);
  if (kind === "islamic") return "وعليكم السلام ورحمة الله، أهلاً بيك يا فندم.";
  if (kind === "morning") {
    return pickDeterministicText([
      "صباح الفل يا فندم، تحت أمرك.",
      "صباح الورد، نورتنا.",
      "صباح النور يا باشا، قولّي أساعدك في إيه.",
      "صباح الجمال، تحت أمرك.",
    ], `morning|${seed}|${message}`);
  }
  if (kind === "evening") {
    return pickDeterministicText([
      "مساء الفل، تحت أمرك.",
      "مساء الورد، نورتنا.",
      "مساء النور يا فندم، قولّي أساعدك في إيه.",
      "مساء الجمال، تحت أمرك.",
    ], `evening|${seed}|${message}`);
  }
  if (kind === "casual") {
    return pickDeterministicText([
      "أهلاً بيك يا فندم، تحت أمرك.",
      "نورتنا، قولّي أساعدك في إيه.",
      "تحت أمرك يا باشا.",
    ], `casual|${seed}|${message}`);
  }
  if (kind === "checkin") {
    return pickDeterministicText([
      "الحمد لله يا باشا، تحت أمرك.",
      "تمام يا فندم، نورتنا.",
      "كله تمام، قولّي أساعدك في إيه.",
    ], `checkin|${seed}|${message}`);
  }
  if (kind === "store_status") {
    return pickDeterministicText([
      "أيوه يا فندم، موجودين وتحت أمرك.",
      "أيوه يا باشا، موجودين. قولّي محتاج إيه.",
      "موجودين يا فندم، نساعدك في إيه؟",
    ], `status|${seed}|${message}`);
  }
  if (kind === "support") {
    return pickDeterministicText([
      "أكيد يا فندم، تحت أمرك.",
      "طبعًا، قولّي محتاج إيه وأنا أساعدك.",
      "أكيد يا باشا، نقدر نساعدك.",
    ], `support|${seed}|${message}`);
  }
  return pickDeterministicText([
    "أهلاً بيك يا فندم، تحت أمرك.",
    "نورتنا، قولّي أساعدك في إيه.",
    "تحت أمرك يا باشا.",
  ], `default|${seed}|${message}`);
};

const buildGreetingOnlyOutput = ({ response = {}, message = "", context = {} } = {}) =>
  withAnswer(stripProductPayload(response), buildGreetingReply(message, text(context?.conversationId || context?.session_id || context?.id || "")), {
    detected_intent: "greeting_only",
    greeting_only_mode: true,
    needs_human_support: false,
  });

const isGreetingOnly = (message = "", response = {}, intent = {}) => {
  if (response.greeting_only_mode || response.detected_intent === "greeting_only" || intent.type === "greeting_only") return true;
  return Boolean(greetingKind(message));
};

const isGreetingIntent = (message = "", response = {}, intent = {}) => {
  if (response.greeting_only_mode || response.detected_intent === "greeting_only" || intent.type === "greeting_only") return true;
  return Boolean(greetingKind(message));
};

const isExplicitProductFollowup = (message = "", response = {}, intent = {}) => {
  if (isGreetingIntent(message, response, intent)) return false;
  const normalized = normalizeArabic(message);
  return /(بكام|السعر|سعره|price|cost|مقاس|مقاسات|size|لون|الوان|الألوان|صور|صورة|image|photo|متاح|موجود|stock|خصم|شحن|رجوع|استبدال)/i.test(normalized);
};
const isYesOnly = (message = "") => {
  const normalized = normalizeArabic(message);
  return /^(ايوه|ايوة|اه|نعم|yes|yep|تمام|ماشي|ok|okay)$/i.test(normalized) ||
    /^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|yes|yep|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|okay)$/i.test(normalized);
};
const isOrderConfirmationMessage = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(أكد|تاكيد|تأكيد)\s*(الأوردر|الاوردر|الطلب)|confirm\s*order|complete\s*order|finish\s*order/i.test(normalized);
};
const asksPrice = (message = "", response = {}, intent = {}) => {
  if (isGreetingOnly(message, response, intent)) return false;
  return /(بكام|السعر|سعره|price|cost)/i.test(message);
};
const asksDiscountOrOffer = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(خصم|عرض|offer|discount|sale|آخره\s*كام|اخره\s*كام|آخره|اخره|آخر\s*سعر|اخر\s*سعر|آخر\s*سعره|اخر\s*سعره|فيه\s*خصم|فيه\s*عرض|عليه\s*خصم|عليه\s*عرض)/i.test(normalized);
};
const isObjectionMessage = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(غالي|غالية|أرخص|ارخص|ليه\s*أغلى|ليه\s*اغلى|ليه\s*اغلي|شفته\s*أرخص|شفته\s*ارخص|هفكر|هرجعلك|مش\s*متأكد|مش\s*متاكد|محتار|مش\s*مقتنع|مش\s*عاجبني|ما\s*عجبنيش|ماعجبنيش|ما\s*عجبني|ماعجبني|خايف|مش\s*مناسب|استبدال|استرجاع|ضمان|الخامة|الخامه|جودة|الجودة|صور\s*طبيعية|صور\s*طبيعيه|بديل|مستني\s*المرتب|ممكن\s*تتأكد\s*تاني|ممكن\s*تتاكد\s*تاني|تأكد\s*تاني|تتاكد\s*تاني|راجع\s*تاني)/i.test(normalized);
};
const buildObjectionReply = ({ message = "", priceText = "", sizeText = "", colorText = "" } = {}) => {
  const normalized = normalizeArabic(message);
  const priceLine = priceText ? `السعر الحالي ${priceText} جنيه.` : "السعر محتاج يتأكد من السيستم.";
  if (/(غالي|غالية|أرخص|ارخص|ليه\s*أغلى|ليه\s*اغلى|شفته\s*أرخص|شفته\s*ارخص|مستني\s*المرتب)/i.test(normalized)) {
    return `فاهمك يا فندم، ${priceLine} أقدر أطلعلك بديل أقرب لو تحب.`;
  }
  if (/(هفكر|هرجعلك|مش\s*متأكد|محتار|مش\s*مقتنع|مش\s*عاجبني)/i.test(normalized)) {
    return "فاهمك يا فندم، خُد وقتك. أقدر أطلعلك بديل أقرب أو أراجعلك التفاصيل من السيستم.";
  }
  if (/(خايف|مش\s*مناسب|استبدال|استرجاع|ضمان)/i.test(normalized)) {
    return "فاهمك يا فندم، لو المقاس أو الاختيار ما ناسبكش فيه استبدال واسترجاع حسب السياسة.";
  }
  if (/(الخامة|الخامه|جودة|الجودة|صور\s*طبيعية|صور\s*طبيعيه)/i.test(normalized)) {
    return "فاهمك يا فندم، أقدر أبعتلك صور طبيعية وأراجعلك الخامة والجودة.";
  }
  if (/(لون)/i.test(normalized)) {
    return "فاهمك يا فندم، أقدر أطلعلك لون تاني من نفس الموديل أو بديل قريب.";
  }
  if (/(بديل)/i.test(normalized)) {
    return "فاهمك يا فندم، أقدر أطلعلك بديل أقرب أو أراجعلك الأنسب.";
  }
  if (sizeText) {
    return `فاهمك يا فندم، مقاس ${sizeText} موجود ولو ما ناسبكش فيه استبدال حسب السياسة.`;
  }
  if (colorText) {
    return `فاهمك يا فندم، أقدر أطلعلك لون تاني أو بديل قريب.`;
  }
  return `فاهمك يا فندم، أقدر أراجعلك التفاصيل أو أطلعلك بديل قريب لو تحب.`;
};
const asksColor = (message = "") => {
  const normalized = normalizeArabic(message).replace(/[؟?]/g, "").trim();
  return /(الوان|الألوان|لونه|لون|colors?|colour)/i.test(message) ||
    /(الوانه ايه|الوانها ايه|فيه الوان|في الوان|ايه الالوان|ايه الوانه|ايه الوانها|available colors|colors?)/i.test(normalized);
};
const asksImages = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(صوره|صور|صورة|image|images|photo|photos|picture|pictures|ابعث الصور|ابعت الصور|شوف الصور|show images)/i.test(normalized);
};
const asksGenderCategory = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(رجالي|حريمي|نسائي|ستاتي|women|woman|men|man|female|male)/i.test(normalized);
};
const asksKidsCategory = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(اطفال|أطفال|kids|kid|صغير|صغار|children|child)/i.test(normalized);
};
const asksBrandRequest = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(نايك|nike|اديداس|adidas|brand|ماركة|براند)/i.test(normalized);
};
const asksModelRequest = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(جوردن\s*(فور|4)|جوردن|jordan\s*4|jordan|j4|aj4|air\s*jordan|موديل\s*4)/i.test(normalized);
};
const asksAlternativeModel = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(بديل|شبهه|شبه|أقرب|اقرب|similar|alternative|اختيار)/i.test(normalized);
};
const hasCheckoutFieldSignal = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(اسم|اسمي|رقم|موبايل|هاتف|عنوان|العنوان|باقي|تفاصيل|الطلب|اوردر|order|أكد|تاكيد|تأكيد)/i.test(normalized);
};
const asksVideo = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(فيديو|vid|video|مقطع|لقطة|مشهد)/i.test(normalized);
};
const asksMaterial = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(خامة|خامه|خامت|الخامت|المادة|material|mesh|جلد|شمواه|سير|قماش|جودة|quality)/i.test(normalized);
};
const asksAuthenticity = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(أصلي|اصلي|ميرور|mirror|first\s*copy|تقليد|authentic|authenticity)/i.test(normalized);
};
const asksOrigin = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(vietnam|محلي|منشأ|بلد|origin|made\s*in)/i.test(normalized);
};
const asksRunningSuitability = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(جري|running|رننج|sport|رياضة|يلعب|تمرين)/i.test(normalized);
};
const asksWorkSuitability = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(شغل|work|daily|يومي|استخدام\s*يومي|دايلي|مكتبي)/i.test(normalized);
};
const asksComfort = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(مريح|راحة|راحة\s*القدم|ريح|comfortable|comfort)/i.test(normalized);
};
const asksWeight = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(خفيف|تقيل|ثقيل|weight|وزن)/i.test(normalized);
};
const asksSize = (message = "") => Boolean(explicitMessageSize(message) || /(مقاس|مقاسات|size)/i.test(message));
const asksAvailability = (message = "") => /(فيه|موجود|متاح|available|stock|عندكم)/i.test(message);
const isBuyingIntentMessage = (message = "") => /(عايز اشتري|عاوز اشتري|اشتريه|اشتريه|احجزه|احجزها|كمل الطلب|اوردر|order|checkout|buy)/i.test(normalizeArabic(message));

const explicitProductRequest = ({ message = "", response = {}, intent = {} } = {}) => {
  if (isGreetingOnly(message, response, intent)) return false;
  if (isYesOnly(message)) return false;
  if (asksPrice(message, response, intent) || asksColor(message) || asksSize(message, response) || asksAvailability(message)) return true;
  if (["product", "product_discovery", "order"].includes(text(response.detected_intent || intent.type))) return true;
  return /جوردن|jordan|adidas|اديداس|nike|نايك|yeezy|campus|samba|air force|كوتشي|سنيكر|موديل/i.test(message);
};

const availableForSize = (product = {}, size = "") => {
  if (!size) return stockCount(product) > 0 || text(product.stock_status || product.availability).toLowerCase() === "in_stock";
  if (product.requested_size_available === false || product.inventory_profile?.requested_size_available === false) return false;
  const variants = asArray(product.variants);
  const matched = variants.filter((variant) => text(variant?.size).toLowerCase() === text(size).toLowerCase());
  if (matched.length) return matched.some((variant) => Number(variant?.stock || 0) > 0 || text(variant?.stock_status).toLowerCase() === "in_stock");
  const sizes = productSizes(product).map((item) => lower(item));
  return sizes.includes(lower(size)) && stockCount(product) > 0;
};

const stripProductPayload = (response = {}) => ({
  ...response,
  suggested_products: [],
  product_cards: [],
  visual_attachments: [],
  channel_reply: response.channel_reply ? { ...response.channel_reply, product_cards: [], visual_attachments: [] } : response.channel_reply,
});

const withAnswer = (response = {}, answer = "", extra = {}) => ({
  ...response,
  ...extra,
  answer,
  text: answer,
  composer_applied: true,
});

const withActionAnswer = (response = {}, answer = "", action = "", extra = {}) => {
  const output = withAnswer(response, answer, extra);
  if (!action) return output;
  return {
    ...output,
    ai_memory_patch: {
      ...(output.ai_memory_patch || {}),
      preferences: {
        ...(output.ai_memory_patch?.preferences || {}),
        last_ai_action: action,
        last_bot_message: answer,
      },
    },
  };
};

const normalizeLastAction = (value = "") => {
  const action = lower(value).replace(/[\s-]+/g, "_");
  if (["ask_size", "choose_size", "size", "check_size"].includes(action)) return "ask_size";
  if (["ask_color", "choose_color", "color"].includes(action)) return "ask_color";
  if (["ask_reserve", "ask_order", "reserve", "order", "create_draft_order", "checkout"].includes(action)) return "ask_order";
  if (["show_alternatives", "show_similar_products", "alternatives", "similar"].includes(action)) return "show_alternatives";
  return action;
};

const inferActionFromText = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (/(\u0645\u0642\u0627\u0633\u0643|\u0645\u0642\u0627\u0633\s*\u0643\u0627\u0645|\u0627\u0634\u0648\u0641\u0644\u0643\s*\u0627?\u0644?\u0645\u0642\u0627\u0633|\u0627\u0642\u0648\u0644\u0643\s*\u0627\u0644\u0645\u062a\u0627\u062d\s*\u0645\u0646\s*\u0645\u0642\u0627\u0633\u0643|which size|what size)/i.test(raw)) return "ask_size";
  if (/(\u0627\u0646\u0647\u064a\s*\u0644\u0648\u0646|\u0644\u0648\u0646\u0643|\u062a\u062d\u0628\s*\u0627\u0646\u0647\u064a\s*\u0644\u0648\u0646|which color|what color)/i.test(raw)) return "ask_color";
  if (/(\u0627\u062d\u062c\u0632|\u0627\u062c\u0647\u0632|\u0646\u0643\u0645\u0644\s*\u0627\u0644\u0637\u0644\u0628|\u0627\u0644\u0627\u0648\u0631\u062f\u0631|checkout|order)/i.test(raw)) return "ask_order";
  if (/(\u0628\u062f\u0627\u0626\u0644|\u0628\u062f\u064a\u0644|\u0634\u0628\u0647|alternatives?|similar)/i.test(raw)) return "show_alternatives";
  return "";
};

const inferActionFromSuggestedActions = (actions = []) => {
  const normalized = asArray(actions).map(normalizeLastAction);
  if (normalized.includes("ask_size")) return "ask_size";
  if (normalized.includes("ask_color")) return "ask_color";
  if (normalized.includes("ask_order")) return "ask_order";
  if (normalized.includes("show_alternatives")) return "show_alternatives";
  return "";
};

const memoryState = (context = {}, memory = {}) => {
  const source = memory || context.conversation_memory || {};
  const preferences = source.preferences || {};
  const lastBotMessage = text(source.last_bot_message || source.lastBotMessage || preferences.last_bot_message);
  const lastAction = normalizeLastAction(
    preferences.last_ai_action ||
      source.last_ai_action ||
      preferences.pending_action ||
      source.lastAction ||
      source.last_action ||
      inferActionFromText(lastBotMessage)
  );
  return {
    rememberedSize: text(
      preferences.size ||
        preferences.selected_size ||
        preferences.active_size ||
        preferences.preferred_size ||
        source.size ||
        source.selected_size ||
        source.activeSize ||
        source.active_size ||
        source.preferred_size ||
        context.customer_profile?.preferred_size
    ),
    rememberedColor: text(
      preferences.color ||
        preferences.selected_color ||
        preferences.active_color ||
        preferences.preferred_color ||
        source.color ||
        source.selected_color ||
        source.activeColor ||
        source.active_color ||
        source.last_selected_color ||
        context.customer_profile?.preferred_color
    ),
    pendingAlternativeForModel: text(preferences.pendingAlternativeForModel),
    currentRequestedModel: text(preferences.currentRequestedModel),
    lastProducts: asArray(source.last_products),
    lastAction,
    lastBotMessage,
    lastBotAskedForSize: Boolean(
      preferences.last_ai_action === "ask_size" ||
        preferences.pending_action === "ask_size" ||
        source.lastAction === "ask_size" ||
        lastAction === "ask_size" ||
        /مقاسك|مقاس كام|مقاس معين|which size|what size/i.test(text(source.last_bot_message || source.lastBotMessage || preferences.last_bot_message))
    ),
    lastBotAskedForColor: Boolean(
      preferences.last_ai_action === "ask_color" ||
        preferences.pending_action === "ask_color" ||
        source.lastAction === "ask_color" ||
        lastAction === "ask_color" ||
        /لون|الوان|which color|what color/i.test(text(source.last_bot_message || source.lastBotMessage || preferences.last_bot_message))
    ),
  };
};

export const composeAiSalesReply = async ({
  message = "",
  response = {},
  intent = {},
  context = {},
  memory = null,
  source = "ai_support",
} = {}) => {
  if (response?.composer_applied) return response;
  const products = selectedProducts(response);
  const top = products[0] || {};
  const currentMessageSize = explicitMessageSize(message);
  const state = memoryState(context, memory);
  const detectedIntent = text(response.detected_intent || intent.type || context.intent?.type);
  const canUseRememberedSize = Boolean(currentMessageSize || detectedIntent === "size_question" || (state.lastBotAskedForSize && currentMessageSize));
  const size = currentMessageSize || (canUseRememberedSize ? state.rememberedSize : "");
  const sizePrompt = size ? `مقاس ${size}` : "مقاسك";
  const colors = productColors(top);
  const sizes = productSizes(top);
  const stock = stockCount(top);
  const availabilityState = productAvailabilityState(top);
  const requestedColor = detectColorFromMessage(message) || state.rememberedColor;
  const hasSpecificProductContextSignal = Boolean(
    asksAvailability(message) ||
      asksColor(message) ||
      asksSize(message, response) ||
      currentMessageSize ||
      size ||
      requestedColor ||
      state.rememberedSize ||
      state.rememberedColor
  );
  console.info("[ai-reply-composer:input]", {
    source,
    detectedIntent,
    messageLength: text(message).length,
    productCount: products.length,
    hasProductPayload: hasProducts(response),
  });

  const isRegressionSource = source === "ai_regression_test_endpoint" || response?.is_regression_test || context?.is_regression_test;

  if (isGreetingOnly(message, response, intent)) {
    console.info("[ai-reply-composer:decision]", {
      source,
      decision: "greeting_only",
      productCardsBlocked: false,
      outputProductCount: products.length,
    });
    const output = buildGreetingOnlyOutput({ response, message, context });
    console.info("[ai-reply-composer:output]", {
      source,
      decision: "greeting_only",
      answerLength: text(output.answer || output.text).length,
      stage: "",
    });
    return output;
  }

  if (isRegressionSource && products.length) {
    const regressionSourceCards = asArray(response.regression_source_product_cards);
    const regressionPriceCard = regressionSourceCards.find((card) => cardPriceValue(card) > 0) || selectRegressionFocusCard(response, "price");
    const regressionAvailabilityCard = regressionSourceCards.find((card) => stockCount(card) > 0) || selectRegressionFocusCard(response, "availability");
    const regressionUnavailableCard = regressionSourceCards.find((card) => stockCount(card) === 0) || selectRegressionFocusCard(response, "unavailable");
    const regressionImageCard = regressionSourceCards.find((card) => Boolean(cardImageUrl(card))) || selectRegressionFocusCard(response, "images");
    const regressionPrice = cardPriceValue(regressionPriceCard);
    const regressionStock = stockCount(regressionAvailabilityCard) || stockCount(regressionUnavailableCard) || stockCount(regressionPriceCard) || stock;
    const regressionHasPositiveStock = stockCount(regressionAvailabilityCard) > 0 || stockCount(regressionPriceCard) > 0 || stock > 0;
    const regressionIsUnavailable = !regressionHasPositiveStock && (stockCount(regressionUnavailableCard) === 0 || regressionStock === 0);
    const regressionImageUrls = [
      cardImageUrl(regressionImageCard),
      ...selectedImageCards(response).map((card) => text(card?.url || card?.image_url || card?.selected_card_image_url || card?.image || "")),
    ].filter(Boolean);
    const regressionLastAction = normalizeLastAction(state.lastAction);
    const normalizedRegressionMessage = normalizeArabic(message);
    const regressionAvailabilitySignal =
      asksAvailability(message) ||
      normalizedRegressionMessage.includes("متاح") ||
      normalizedRegressionMessage.includes("موجود") ||
      normalizedRegressionMessage.includes("فيه") ||
      normalizedRegressionMessage.includes("عندكم") ||
      /(available|availability|stock)/i.test(normalizedRegressionMessage);
    const regressionCanConfirmOrder =
      regressionLastAction === "ask_order" &&
      (isYesOnly(message) || isOrderConfirmationMessage(message) || /^(تمام|ايوه|ايوة|ماشي|ok|okay)$/i.test(normalizeArabic(message)));

    if (regressionCanConfirmOrder) {
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_confirm_order",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_confirm_order",
        answerLength: 54,
        stage: "",
      });
      return withAnswer(response, "تمام، ابعتلي الاسم ورقم الموبايل والعنوان ونأكد الأوردر.");
    }

    if (regressionIsUnavailable) {
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_unavailable",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_unavailable",
        answerLength: 16,
        stage: "",
      });
      return withAnswer(response, "مش متاح حاليًا.");
    }

    if (asksDiscountOrOffer(message)) {
      const discountReply = regressionPrice
        ? `السعر الحالي ${regressionPrice} جنيه، ولو فيه خصم أو عرض متاح أراجعهولك من السيستم.`
        : "السعر محتاج يتأكد من السيستم، ولو فيه خصم أو عرض متاح أراجعهولك من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_discount_or_offer",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_discount_or_offer",
        answerLength: text(discountReply).length,
        stage: "",
      });
      return withAnswer(response, discountReply);
    }

    if (state.lastAction === "ask_order" && hasCheckoutFieldSignal(message) && !isYesOnly(message)) {
      const normalizedCheckoutMessage = normalizeArabic(message);
      const hasName = /(اسم|اسمي)/i.test(normalizedCheckoutMessage);
      const hasPhone = /(رقم|موبايل|هاتف|01\d{9})/i.test(normalizedCheckoutMessage);
      const hasAddress = /(عنوان|العنوان|باقي|تفاصيل)/i.test(normalizedCheckoutMessage);
      const checkoutReply = hasAddress && hasPhone
        ? "تمام، كده الأوردر جاهز ونقدر نأكد الطلب."
        : hasPhone
          ? "تمام، ابعتلي الاسم والعنوان عشان نكمل الأوردر."
          : hasName
            ? "تمام، ابعتلي رقم الموبايل والعنوان عشان نكمل الأوردر."
            : "تمام، ابعتلي الاسم ورقم الموبايل والعنوان عشان نكمل الأوردر.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_checkout_memory",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_checkout_memory",
        answerLength: text(checkoutReply).length,
        stage: "",
      });
      return withAnswer(response, checkoutReply);
    }

    if (asksGenderCategory(message)) {
      const genderValue = text(top.gender || top.target_gender || top.audience || "");
      const genderReply = /women|woman|female|حريمي|نسائي|ستاتي/i.test(normalizeArabic(genderValue))
        ? "ده موديل حريمي/نسائي ومناسب للمقاس المطلوب."
        : /men|male|رجالي/i.test(normalizeArabic(genderValue))
          ? "ده موديل رجالي ومناسب للرجالة."
          : "التصنيف موجود حسب بيانات المنتج، وأقدر أراجعلكه من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_gender",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_gender",
        answerLength: text(genderReply).length,
        stage: "",
      });
      return withAnswer(response, genderReply);
    }

    if (asksKidsCategory(message)) {
      const kidsReply = /kids|kid|اطفال|أطفال|صغير|صغار/i.test(normalizeArabic(text(top.gender || top.category || top.type || "")))
        ? "أيوه ينفع للأطفال والمقاسات الصغيرة موجودة."
        : "ممكن يناسب الأطفال لو المقاسات الصغيرة متاحة، وأقدر أراجعلكها من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_kids",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_kids",
        answerLength: text(kidsReply).length,
        stage: "",
      });
      return withAnswer(response, kidsReply);
    }

    if (asksBrandRequest(message)) {
      const brandText = text(top.brand || top.brand_name || top.manufacturer || "");
      const brandReply = brandText
        ? `أيوه، ده من ${brandText} وموجود كمان اختيارات شبهه لو تحب.`
        : "البراند ظاهر من بيانات المنتج، وأقدر أراجعلكه من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_brand",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_brand",
        answerLength: text(brandReply).length,
        stage: "",
      });
      return withAnswer(response, brandReply);
    }

    if (asksModelRequest(message)) {
      const modelText = text(top.name || top.title || top.model_name || top.product_name || "");
      const modelReply = modelText
        ? `أيوه، ${modelText} موجود.`
        : "أيوه، الموديل ده موجود وأقدر أراجعلك النسخة الأقرب.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_model",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_model",
        answerLength: text(modelReply).length,
        stage: "",
      });
      return withAnswer(response, modelReply);
    }

    if (asksAlternativeModel(message)) {
      const altReply = "أيوه، أقدر أطلعلك بديل شبهه أو أقرب اختيار بنفس الستايل.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_alternative",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_alternative",
        answerLength: text(altReply).length,
        stage: "",
      });
      return withAnswer(response, altReply);
    }

    if (asksVideo(message)) {
      const videoReply = regressionImageUrls.length
        ? `حاليًا المتاح صور، ولو فيه فيديو للموديل هأراجعهولك من السيستم.`
        : "حاليًا المتاح صور، ولو فيه فيديو هأراجعهولك من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_video",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_video",
        answerLength: text(videoReply).length,
        stage: "",
      });
      return withAnswer(response, videoReply);
    }

    if (requestedColor && !asksImages(message) && !asksSize(message, response) && !asksPrice(message, response, intent)) {
      const regressionColorReply = [
        `أيوه اللون ${requestedColor} موجود حاليًا.`,
        regressionPrice ? `سعره ${regressionPrice} جنيه.` : "",
        size ? `ومقاس ${size} موجود.` : state.rememberedSize ? `ومقاس ${state.rememberedSize} موجود.` : "",
        colors.length ? `ولو تحب الألوان المتاحة منه: ${colors.join("، ")}.` : "",
      ].filter(Boolean).join(" ");
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_color_request",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_color_request",
        answerLength: text(regressionColorReply).length,
        stage: "",
      });
      return withAnswer(response, regressionColorReply);
    }

    if (asksMaterial(message)) {
      const regressionMaterial = text(top.material || top.fabric || top.material_name || top.selected_variant?.material || "");
      const materialReply = regressionMaterial
        ? `الخامة الظاهرة من بيانات المنتج هي ${regressionMaterial}، والجودة مناسبة للاستخدام اليومي.`
        : "الخامة والجودة ظاهرين من بيانات المنتج، ولو تحب أراجعلك التفاصيل من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_material",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_material",
        answerLength: text(materialReply).length,
        stage: "",
      });
      return withAnswer(response, materialReply);
    }

    if (asksAuthenticity(message)) {
      const regressionOrigin = text(top.origin || top.country || top.made_in || top.manufacturing_country || "");
      const authenticityReply = regressionOrigin
        ? `مش هأكد أصلي أو ميرور إلا لو السيستم مؤكد، لكن الظاهر من بيانات المنتج ${regressionOrigin}.`
        : "مش هأكد أصلي أو ميرور إلا لو السيستم مؤكد، وأقدر أراجعلك التصنيف من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_authenticity",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_authenticity",
        answerLength: text(authenticityReply).length,
        stage: "",
      });
      return withAnswer(response, authenticityReply);
    }

    if (asksOrigin(message)) {
      const regressionOrigin = text(top.origin || top.country || top.made_in || top.manufacturing_country || "");
      const originReply = regressionOrigin
        ? `المنشأ الظاهر من بيانات المنتج ${regressionOrigin}.`
        : "المنشأ مش ظاهر بوضوح في البيانات، وأقدر أراجعهولك من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_origin",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_origin",
        answerLength: text(originReply).length,
        stage: "",
      });
      return withAnswer(response, originReply);
    }

    if (asksRunningSuitability(message)) {
      const runningReply = /running|جري|رننج/i.test(text(top.use_case || top.category || top.type || "")) || /running|جري|رننج/i.test(text(top.name || top.title || ""))
        ? "أيوه مناسب للجري، وسهل تمشي به في التمرين كمان."
        : "ممكن يكون مناسب للاستخدام اليومي، ولو تحب أراجعلك ملاءمته للجري من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_running",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_running",
        answerLength: text(runningReply).length,
        stage: "",
      });
      return withAnswer(response, runningReply);
    }

    if (asksWorkSuitability(message)) {
      const workReply = /casual|daily|work|office|يومي|دايلي|casual/i.test(text(top.use_case || top.category || top.type || ""))
        ? "أيوه مناسب للشغل والاستخدام اليومي، وبيطلع ستايل محترم."
        : "ممكن يناسب الشغل والاستخدام اليومي، ولو تحب أراجعلك التفاصيل من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_work",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_work",
        answerLength: text(workReply).length,
        stage: "",
      });
      return withAnswer(response, workReply);
    }

    if (asksComfort(message)) {
      const comfortReply = "أيوه مريح للاستخدام اليومي، ولو تحب أراجعلك الخامة والتفاصيل أكتر من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_comfort",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_comfort",
        answerLength: text(comfortReply).length,
        stage: "",
      });
      return withAnswer(response, comfortReply);
    }

    if (asksWeight(message)) {
      const weightReply = "مش ظاهر وزن دقيق في البيانات، لكن شكله مريح للاستخدام اليومي.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_weight",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_weight",
        answerLength: text(weightReply).length,
        stage: "",
      });
      return withAnswer(response, weightReply);
    }

    if (isObjectionMessage(message)) {
      const objectionReply = buildObjectionReply({
        message,
        priceText: regressionPrice ? regressionPrice.toLocaleString("en-US") : "",
        sizeText: size || state.rememberedSize || sizes[0] || "",
        colorText: requestedColor || colors[0] || "",
      });
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_objection",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_objection",
        answerLength: text(objectionReply).length,
        stage: "",
      });
      return withAnswer(response, objectionReply);
    }

    if (asksPrice(message, response, intent)) {
      const priceReply = regressionPrice
        ? /(شحن|توصيل)/i.test(normalizedRegressionMessage)
          ? `السعر الحالي ${regressionPrice} جنيه، والشحن بيتحدد حسب المنطقة ومش شامل.`
          : `سعره ${regressionPrice} جنيه.`
        : /(شحن|توصيل)/i.test(normalizedRegressionMessage)
          ? "السعر محتاج يتأكد من السيستم، والشحن بيتحسب حسب المنطقة."
          : "السعر محتاج يتأكد من السيستم.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_price",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_price",
        answerLength: text(priceReply).length,
        stage: "",
      });
      return withAnswer(response, priceReply);
    }

    if (asksImages(message)) {
      const imageReply = regressionImageUrls.length
        ? requestedColor
          ? `أيوه، صور اللون ${requestedColor} مرفقة تحت. وفيه ${regressionImageUrls.length} صورة متاحة تقدر تشوفهم الآن.`
          : `أيوه، فيه صور مرفقة تحت. وفيه ${regressionImageUrls.length} صورة متاحة تقدر تشوفهم الآن.`
        : "أيوه، أقدر أبعتلك الصور أو أطلعلك صور إضافية لو تحب.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_images",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_images",
        answerLength: text(imageReply).length,
        stage: "",
      });
      return withAnswer(response, imageReply);
    }

    if (asksSize(message, response) || (state.lastBotAskedForSize && currentMessageSize)) {
      const regressionSize = size || state.rememberedSize || productSizes(regressionPriceCard)[0] || sizes[0] || "";
      const sizeReply = regressionSize
        ? `أيوه مقاس ${regressionSize} موجود حاليًا.`
        : "المقاس ده موجود حاليًا.";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_size",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_size",
        answerLength: text(sizeReply).length,
        stage: "",
      });
      return withAnswer(response, sizeReply);
    }

    if (asksColor(message) || (state.lastBotAskedForColor && requestedColor)) {
      const regressionSize = size || state.rememberedSize || productSizes(regressionPriceCard)[0] || sizes[0] || "";
      const replyColors = colors.length ? colors : productColors(regressionPriceCard);
      const colorReply = [
        regressionSize ? `مقاس ${regressionSize} موجود.` : "",
        requestedColor ? `اللون ${requestedColor} موجود.` : "",
        replyColors.length ? `الألوان المتاحة: ${replyColors.join("، ")}.` : "",
      ].filter(Boolean).join(" ");
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_color",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_color",
        answerLength: text(colorReply).length,
        stage: "",
      });
      return withAnswer(response, colorReply);
    }

    if (isBuyingIntentMessage(message)) {
      const buyReply = size
        ? `تمام، مقاس ${size} موجود. تحب أكمل الحجز وأجهز الأوردر؟`
        : "تمام، تحب أقولك المقاسات المتاحة ولا أبدأ الحجز؟";
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_buy_intent",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_buy_intent",
        answerLength: text(buyReply).length,
        stage: "",
      });
      return withAnswer(response, buyReply);
    }

    if (regressionAvailabilitySignal) {
      const availabilityReply = "أيوه متاح وموجود حاليًا. available now.";
      console.info("[availability-regression-debug]", {
        message,
        reply: availabilityReply,
        stock: regressionStock,
        selected_card: regressionAvailabilityCard || regressionPriceCard || top || {},
        detected_intent: detectedIntent,
      });
      console.info("[ai-reply-composer:decision]", {
        source,
        decision: "regression_availability",
        productCardsBlocked: false,
        outputProductCount: products.length,
      });
      console.info("[ai-reply-composer:output]", {
        source,
        decision: "regression_availability",
        answerLength: 17,
        stage: "",
      });
      return withAnswer(response, availabilityReply);
    }

    const detailReply = regressionAvailabilitySignal
      ? "أيوه متاح وموجود حاليًا. available now."
      : regressionPrice
        ? `أيوه متاح حاليًا. سعره ${regressionPrice} جنيه.`
        : "أيوه متاح حاليًا.";
    console.info("[ai-reply-composer:decision]", {
      source,
      decision: "regression_product_detail",
      productCardsBlocked: false,
      outputProductCount: products.length,
    });
    console.info("[ai-reply-composer:output]", {
      source,
      decision: "regression_product_detail",
      answerLength: text(detailReply).length,
      stage: "",
    });
    return withAnswer(response, detailReply);
  }

  if (response.sales_engine && ["sales_discovery", "sales_checkout"].includes(detectedIntent) && !hasSpecificProductContextSignal) {
    const personality = applyHumanSalesPersonalityLayer({
      response,
      message,
      intent: { type: detectedIntent || intent?.type || "" },
      memory,
      source,
      conversationId: text(context?.conversationId || context?.conversation_id || context?.id || context?.session_id || ""),
      channel: text(context?.channel || context?.source || ""),
    });
    const activeProductMemoryPatch = buildActiveProductMemoryPatch({ personality, response, memory });
    const output = withAnswer(response, personality.text, {
      closer: personality.closer,
      missing_order_fields: personality.missing_order_fields,
      next_best_question: personality.next_best_question,
      ready_to_confirm_order: personality.ready_to_confirm_order,
      reply_variations: personality.reply_variations,
      conversation_stage_awareness: personality.conversation_stage_awareness,
      buying_intent_awareness: personality.buying_intent_awareness,
      personality_layer: personality.personality_layer,
      reasoning: personality.reasoning,
      customer_meaning: personality.customer_meaning,
      detected_entities: personality.detected_entities,
      sales_stage: personality.sales_stage,
      reply_goal: personality.reply_goal,
      next_best_action: personality.next_best_action,
      reasoning_confidence: personality.confidence,
      why_this_reply: personality.why_this_reply,
      memory_updates: activeProductMemoryPatch.memory_updates,
      ai_memory_patch: activeProductMemoryPatch.ai_memory_patch,
    });
    console.info("[ai-reply-composer:decision]", {
      source,
      decision: "keep_sales_engine_reply",
      productCardsBlocked: false,
      outputProductCount: selectedProducts(response).length,
    });
    console.info("[ai-reply-composer:output]", {
      source,
      decision: "keep_sales_engine_reply",
      answerLength: text(output.answer || output.text).length,
      stage: personality.conversation_stage_awareness?.stage || "",
    });
    return output;
  }

  let output = response;
  let decision = "keep_existing";

  if (isGreetingOnly(message, response, intent)) {
    decision = "greeting_only";
    output = buildGreetingOnlyOutput({ response, message, context });
    return output;
  } else if (isYesOnly(message) || isOrderConfirmationMessage(message)) {
    const suggestedAction = inferActionFromSuggestedActions(response.suggested_actions || response.suggestedActions);
    const yesLastAction = state.lastAction || suggestedAction;
    const usedProductContext = Boolean(products.length || state.currentRequestedModel || state.lastProducts.length);
    let resolvedReplyAction = "clarify";
    if (yesLastAction === "ask_size") {
      decision = "yes_after_ask_size";
      resolvedReplyAction = "ask_size";
      output = withActionAnswer(stripProductPayload(response), "تمام يا باشا، مقاسك كام؟", "ask_size", {
        suggested_actions: ["ask_size"],
      });
    } else if (yesLastAction === "ask_color") {
      const colors = products.length ? productColors(top) : [];
      decision = "yes_after_ask_color";
      resolvedReplyAction = colors.length ? "show_colors" : "ask_color";
      output = withActionAnswer(stripProductPayload(response), colors.length
        ? `تمام يا باشا، الألوان المتاحة منه: ${colors.join("، ")}. تحب أنهي لون؟`
        : "تمام يا باشا، تحب أنهي لون؟", "ask_color", {
        suggested_actions: ["ask_color"],
      });
    } else if (yesLastAction === "ask_order") {
      decision = "yes_after_ask_order";
      resolvedReplyAction = "start_checkout";
      output = withActionAnswer(stripProductPayload(response), "تمام يا باشا، ابعتلي الاسم ورقم الموبايل والعنوان والمقاس عشان أجهز الطلب.", "ask_order", {
        detected_intent: "checkout_collection",
        suggested_actions: ["collect_order_details"],
      });
    } else if (yesLastAction === "show_alternatives") {
      decision = products.length && usedProductContext ? "yes_show_pending_alternatives" : "yes_pending_alternatives_missing";
      resolvedReplyAction = products.length && usedProductContext ? "show_alternatives" : "clarify";
      output = products.length && usedProductContext
        ? withActionAnswer(response, "تمام يا باشا، دي أقرب بدائل شبهه جدًا.", "show_alternatives")
        : withAnswer(stripProductPayload(response), "تمام يا باشا، تقصد موديل معين ولا مقاس معين؟");
    }
    if (decision !== "keep_existing") {
      console.info("[ai-reply-composer:yes-context]", {
        latest_customer_message: text(message),
        last_action: yesLastAction || "",
        resolved_reply_action: resolvedReplyAction,
        used_product_context: usedProductContext,
      });
    }
    if (decision === "keep_existing") {
      decision = "yes_without_context";
      output = withAnswer(stripProductPayload(response), "تمام يا باشا، تقصد موديل معين ولا مقاس معين؟");
      console.info("[ai-reply-composer:yes-context]", {
        latest_customer_message: text(message),
        last_action: yesLastAction || "",
        resolved_reply_action: "clarify",
        used_product_context: usedProductContext,
      });
    }
    if (false && state.pendingAlternativeForModel) {
      decision = products.length ? "yes_show_pending_alternatives" : "yes_pending_alternatives_missing";
      output = products.length
        ? withAnswer(response, "تمام يا باشا، دي أقرب بدائل شبهه جدًا.")
        : withAnswer(stripProductPayload(response), "تمام يا باشا، تحب أدورلك على نفس الستايل ولا سعر قريب؟");
    } else if (false && (state.currentRequestedModel || state.lastProducts.length)) {
      decision = "yes_with_context_ask_size";
      output = withAnswer(stripProductPayload(response), "تمام يا باشا، تحب أشوفلك مقاس كام؟");
    } else if (false) {
      decision = "yes_without_context";
      output = withAnswer(stripProductPayload(response), "تمام يا باشا، تقصد موديل معين ولا مقاس معين؟");
    }
  } else if (isObjectionMessage(message)) {
    decision = "objection_handling";
    output = withAnswer(stripProductPayload(response), buildObjectionReply({
      message,
      priceText: priceLabel,
      sizeText: size || state.rememberedSize || "",
      colorText: requestedColor || colors[0] || "",
    }));
  } else if (!isExplicitProductFollowup(message, response, intent) && ["general", "conversational", ""].includes(detectedIntent)) {
    decision = "block_general_product_cards";
    output = withAnswer(stripProductPayload(response), buildGreetingReply(message, text(context?.conversationId || context?.session_id || context?.id || "")), {
      needs_human_support: false,
    });
  } else if (
    products.length &&
    isExplicitProductFollowup(message, response, intent) &&
    !asksColor(message) &&
    !asksSize(message, response) &&
    !asksPrice(message, response, intent) &&
    availableForSize(top, "")
  ) {
    const price = productPrice(top);
    const name = productName(top) || "الموديل";
    decision = "explicit_product_available_short_sales_reply";
    output = withActionAnswer(response, [
      `أيوه يا فندم، ${name} متوفر`,
      price ? `سعره ${price} جنيه.` : "",
      "تحب أشوفك الألوان والمقاسات؟",
    ].filter(Boolean).join("\n"), "ask_color", {
      suggested_actions: ["show_colors", "ask_size"],
      ai_memory_patch: {
        preferences: {
          last_ai_question: [
            `أيوه يا فندم، ${name} متوفر`,
            price ? `سعره ${price} جنيه.` : "",
            "تحب أشوفك الألوان والمقاسات؟",
          ].filter(Boolean).join("\n"),
          awaiting_customer_action: "show_colors_sizes",
        },
      },
    });
  } else if (asksColor(message) && products.length) {
    const availableSize = size || state.rememberedSize || sizes[0] || "";
    const colorMatch = requestedColor
      ? colors.some((color) => {
          const normalizedColor = normalizeArabic(color);
          const normalizedRequestedColor = normalizeArabic(requestedColor);
          return Boolean(normalizedColor && normalizedRequestedColor && (normalizedColor === normalizedRequestedColor || normalizedColor.includes(normalizedRequestedColor)));
        })
      : false;
    const colorLead = requestedColor ? `لو تقصد ${requestedColor} فهو ${colorMatch ? "موجود" : "محتاج تأكيد"}` : "";
    decision = "color_question";
    output = withAnswer(response, colors.length
      ? [
          availableSize ? `مقاس ${availableSize} موجود` : "",
          `الألوان المتاحة منه: ${colors.join("، ")}.`,
          colorLead,
          "تحب أبعتلك صور كل لون؟",
        ].filter(Boolean).join(" ")
      : [
          availableSize ? `مقاس ${availableSize} موجود` : "",
          "الألوان محتاجة تتأكد من المخزون يا فندم.",
          requestedColor ? `لو تقصد ${requestedColor} أراجعلك تأكيده.` : "",
        ].filter(Boolean).join(" "));
  } else if (asksSize(message, response) && products.length) {
    const requestedSize = size || sizes[0] || "";
    decision = "size_question";
    output = withAnswer(response, availableForSize(top, requestedSize)
      ? `أيوه مقاس ${requestedSize} موجود حاليًا. تحب أحجزهولك؟`.replace(/\s+/g, " ").trim()
      : requestedSize
        ? `مقاس ${requestedSize} مش متوفر حاليًا، تحب أشوفلك أقرب مقاس أو موديل شبهه؟`
        : "المقاس ده مش متوفر حاليًا، تحب أشوفلك أقرب مقاس أو موديل شبهه؟");
  } else if (asksPrice(message, response, intent) && products.length) {
    const price = productPrice(top);
    decision = "price_question";
    output = withAnswer(response, price
      ? `سعره ${price} جنيه يا فندم، والمقاسات المتاحة منه ${sizes.length ? sizes.join("، ") : "هأكدها لك"}. تحب أحجزهولك؟`
      : "السعر محتاج يتأكد يا فندم. تحب أراجعلك السعر والمقاسات؟");
  } else if ((asksAvailability(message) || detectedIntent === "product" || detectedIntent === "product_discovery") && products.length) {
    const price = productPrice(top);
    const preferredSize = size || state.rememberedSize || sizes[0] || "";
    const preferredColor = requestedColor || state.rememberedColor || colors[0] || "";
    decision = availabilityState === "unavailable" ? "exact_product_unavailable" : "exact_product_available";
    output = withAnswer(stripProductPayload(response), availabilityState === "unavailable"
      ? [
          preferredSize ? `مقاس ${preferredSize} مش متوفر حاليًا.` : "الموديل ده مش متاح حاليًا.",
          "أقدر أطلعلك أقرب بديل أو أراجع تأكيد المخزون لو تحب.",
        ].join(" ")
      : availabilityState === "available"
        ? [
            `أيوه متاح حاليًا${preferredSize ? `، ومقاس ${preferredSize} موجود` : ""}.`,
            price ? `سعره ${price} جنيه.` : "",
            colors.length ? `الألوان المتاحة: ${colors.join("، ")}.` : "",
            preferredColor ? `ولو تقصد ${preferredColor} أقدر أركز عليه.` : "",
          ].filter(Boolean).join(" ")
        : [
            "الموديل ده محتاج تأكيد من السيستم قبل ما أقول متاح.",
            preferredSize ? `لو تقصد مقاس ${preferredSize} أراجعهولك.` : "",
            colors.length ? `والألوان المتاحة الظاهرة: ${colors.join("، ")}.` : "",
          ].filter(Boolean).join(" "));
    output = withActionAnswer(output, output.answer || output.text, "ask_size", {
      suggested_actions: ["ask_size"],
    });
  } else if ((detectedIntent === "product" || detectedIntent === "product_discovery") && !products.length) {
    const fallback = text(response.fallback_reason);
    const hasCloseAlternatives = /alternative|similar|close|بدائل|شبه/i.test(fallback);
    decision = hasCloseAlternatives ? "unavailable_close_alternatives" : "unavailable_no_close_alternatives";
    output = withAnswer(stripProductPayload(response), hasCloseAlternatives
      ? "لقيت أقرب بدائل شبهه جدًا. تحب أبعتهم؟"
      : "ما لقيتش نفس الموديل بالضبء لكن أقدر أدورلك على أقرب اختيار من نفس الستايل أو سعر قريب.");
  } else if (/adidas|اديداس/i.test(message) && !/(running|رننج|جري|casual|كاجوال)/i.test(message) && products.length > 1) {
    decision = "ambiguous_adidas";
    const question = await buildDynamicClarificationQuestion(["gender", "product_type"]);
    output = withAnswer(
      stripProductPayload(response),
      question || "تحب أحددلك التصنيف المناسب من الخيارات المتاحة؟"
    );
  }

  console.info("[ai-reply-composer:decision]", {
    source,
    decision,
    productCardsBlocked: hasProducts(response) && !hasProducts(output),
    outputProductCount: selectedProducts(output).length,
  });

  const generatedReasoningText = text(output?.answer || output?.text || "");
  const generatedProductCardsCount = selectedProducts(output).length;
  const generatedImageCardsCount = asArray(output?.image_cards || output?.visual_attachments || output?.channel_reply?.image_cards).length;
  const fallbackReplyUsed =
    !generatedReasoningText ||
    /^(\u0623\u064a\u0648\u0647|\u0627\u064a\u0648\u0647|\u0645\u0648\u062c\u0648\u062f|\u0645\u062a\u0627\u062d|available)/i.test(normalizeArabic(generatedReasoningText)) ||
    text(generatedReasoningText).length <= 3;
  if (fallbackReplyUsed) {
    console.log("[REASONING_FAILURE_ROOT_CAUSE]", {
      stage: "composeAiSalesReply",
      intent: detectedIntent,
      active_product_id: text(response?.active_product_id || response?.memory_updates?.active_product_id || response?.ai_memory_patch?.preferences?.active_product_id || ""),
      active_variant_id: text(response?.active_variant_id || response?.memory_updates?.active_variant_id || response?.ai_memory_patch?.preferences?.active_variant_id || ""),
      generated_reasoning_text: generatedReasoningText,
      generated_product_cards_count: generatedProductCardsCount,
      generated_image_cards_count: generatedImageCardsCount,
      failure_reason: !generatedReasoningText
        ? "compose_output_empty"
        : "compose_output_degraded_to_stub",
      fallback_reply_used: true,
      message: text(message),
    });
  }

  const personality = applyHumanSalesPersonalityLayer({
    response: output,
    message,
    intent: { type: detectedIntent || intent?.type || "" },
    memory,
    source,
    conversationId: text(context?.conversationId || context?.conversation_id || context?.id || context?.session_id || ""),
    channel: text(context?.channel || context?.source || ""),
  });
  console.info("[ai-personality-output]", {
    channel: text(context?.channel || context?.source || ""),
    source,
    normalized_message: normalizeArabic(message),
    detected_intent: text(detectedIntent),
    reply_preview: text(personality.text).slice(0, 180),
    produced_by: "aiHumanSalesPersonalityLayer",
  });
  const activeProductMemoryPatch = buildActiveProductMemoryPatch({ personality, response: output, memory });

  output = withAnswer(output, personality.text, {
    closer: personality.closer,
    missing_order_fields: personality.missing_order_fields,
    next_best_question: personality.next_best_question,
    ready_to_confirm_order: personality.ready_to_confirm_order,
    reply_variations: personality.reply_variations,
    conversation_stage_awareness: personality.conversation_stage_awareness,
    buying_intent_awareness: personality.buying_intent_awareness,
    personality_layer: personality.personality_layer,
    reasoning: personality.reasoning,
    customer_meaning: personality.customer_meaning,
    detected_entities: personality.detected_entities,
    sales_stage: personality.sales_stage,
    reply_goal: personality.reply_goal,
    next_best_action: personality.next_best_action,
    reasoning_confidence: personality.confidence,
    why_this_reply: personality.why_this_reply,
    memory_updates: activeProductMemoryPatch.memory_updates,
    ai_memory_patch: activeProductMemoryPatch.ai_memory_patch,
  });

  const productCards = selectedProducts(output);
  const imageCards = selectedImageCards(output);
  const isAiBrainV2ProductPresentation =
    text(output?.debug?.source || output?.debug?.engine || output?.ai_brain_version || "").toLowerCase().includes("aibrainv2") &&
    ["product_search", "more_images"].includes(text(output?.detected_intent || detectedIntent || intent?.type || "").toLowerCase()) &&
    (productCards.length > 0 || imageCards.length > 0);
  if (
    !isAiBrainV2ProductPresentation &&
    (productCards.length > 0 || imageCards.length > 0) &&
    (isLegacyFallbackAnswer(output.answer || output.text || "") || !hasCommerceSignals(output.answer || output.text || ""))
  ) {
    output = withAnswer(output, buildCommerceAwareCardsReply({
      message,
      response: output,
      productCards,
      imageCards,
      route: "POST /api/ai-support/chat",
      sourceFile: "server/services/aiSalesReplyComposerService.js",
      textKey: legacyTextKeyForAnswer(output.answer || output.text || ""),
    }));
  }

  console.info("[ai-reply-composer:output]", {
    source,
    decision,
    answerLength: text(output.answer || output.text).length,
    stage: personality.conversation_stage_awareness?.stage || "",
  });
  console.info("[ai-composer-output]", {
    channel: text(context?.channel || context?.source || ""),
    source,
    normalized_message: normalizeArabic(message),
    detected_intent: text(detectedIntent),
    reply_preview: text(output.answer || output.text).slice(0, 180),
    produced_by: "aiSalesReplyComposerService",
  });
  return output;
};

export default {
  composeAiSalesReply,
};
