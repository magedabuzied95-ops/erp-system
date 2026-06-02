import { resolveCustomerDisplayPrice, formatCustomerDisplayPrice } from "../utils/customerDisplayPrice.js";

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
    return formattedResolved || money(resolved.display_price);
  })();

const productName = (product = {}) => text(product.name || product.title || product.product_name);

const productSizes = (product = {}) => {
  const direct = [
    product.size,
    product.requested_size,
    product.matched_variant_size,
    ...(asArray(product.available_sizes || product.sizes || product.inventory_profile?.available_sizes)),
    ...asArray(product.variants).map((variant) => variant?.size),
  ];
  return [...new Set(direct.map(text).filter(Boolean))].slice(0, 8);
};

const productColors = (product = {}) => {
  const direct = [
    product.color,
    product.requested_color,
    product.matched_variant_color,
    ...(asArray(product.available_colors || product.colors)),
    ...asArray(product.variants).flatMap((variant) => [variant?.color, variant?.color_name]),
  ];
  return [...new Set(direct.map(text).filter(Boolean))].slice(0, 8);
};

const stockCount = (product = {}) => {
  const values = [
    product.requested_size_stock,
    product.total_stock,
    product.stock,
    product.inventory_profile?.requested_size_stock,
    product.inventory_profile?.total_stock,
  ];
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const hasProducts = (response = {}) =>
  asArray(response.suggested_products).length > 0 || asArray(response.product_cards).length > 0 || asArray(response.channel_reply?.product_cards).length > 0;

const selectedProducts = (response = {}) => {
  const seen = new Set();
  return [
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

const isGreetingOnly = (message = "", response = {}, intent = {}) => {
  const normalized = normalizeArabic(message);
  if (response.greeting_only_mode || response.detected_intent === "greeting_only" || intent.type === "greeting_only") return true;
  if (!normalized) return false;
  return /^(السلام عليكم|سلام عليكم|وعليكم السلام|اهلا|اهلا بيك|هلا|هاي|hello|hi)( ورحمه الله)?( وبركاته)?$/.test(normalized);
};

const isYesOnly = (message = "") => {
  const normalized = normalizeArabic(message);
  return /^(ايوه|ايوة|اه|نعم|yes|yep|تمام|ماشي|ok|okay)$/i.test(normalized) ||
    /^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|yes|yep|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|okay)$/i.test(normalized);
};
const asksPrice = (message = "", response = {}, intent = {}) => {
  if (isGreetingOnly(message, response, intent)) return false;
  return /(بكام|السعر|سعره|price|cost)/i.test(message);
};
const asksColor = (message = "") => {
  const normalized = normalizeArabic(message).replace(/[؟?]/g, "").trim();
  return /(الوان|الألوان|لونه|لون|colors?|colour)/i.test(message) ||
    /(الوانه ايه|الوانها ايه|فيه الوان|في الوان|ايه الالوان|ايه الوانه|ايه الوانها|available colors|colors?)/i.test(normalized);
};
const asksSize = (message = "") => Boolean(explicitMessageSize(message) || /(مقاس|مقاسات|size)/i.test(message));
const asksAvailability = (message = "") => /(فيه|موجود|متاح|available|stock|عندكم)/i.test(message);

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
      preferences.pending_action ||
      source.lastAction ||
      source.last_action ||
      inferActionFromText(lastBotMessage)
  );
  return {
    rememberedSize: text(preferences.size || preferences.preferred_size || source.preferred_size || context.customer_profile?.preferred_size),
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
  };
};

export const composeAiSalesReply = ({
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
  console.info("[ai-reply-composer:input]", {
    source,
    detectedIntent,
    messageLength: text(message).length,
    productCount: products.length,
    hasProductPayload: hasProducts(response),
  });

  if (response.sales_engine && ["sales_discovery", "sales_checkout"].includes(detectedIntent)) {
    console.info("[ai-reply-composer:decision]", {
      source,
      decision: "keep_sales_engine_reply",
      productCardsBlocked: false,
      outputProductCount: selectedProducts(response).length,
    });
    return response;
  }

  let output = response;
  let decision = "keep_existing";

  if (isGreetingOnly(message, response, intent)) {
    decision = "greeting_only";
    output = withAnswer(stripProductPayload(response), "وعليكم السلام يا فندم  تحب أساعدك في موديل معين أو مقاس معين؟", {
      detected_intent: "greeting_only",
      greeting_only_mode: true,
      needs_human_support: false,
    });
  } else if (isYesOnly(message)) {
    const suggestedAction = inferActionFromSuggestedActions(response.suggested_actions || response.suggestedActions);
    const yesLastAction = state.lastAction || suggestedAction;
    const usedProductContext = Boolean(products.length || state.currentRequestedModel || state.lastProducts.length);
    let resolvedReplyAction = "clarify";
    if (yesLastAction === "ask_size") {
      decision = "yes_after_ask_size";
      resolvedReplyAction = "ask_size";
      output = withActionAnswer(stripProductPayload(response), "تمام يا فندم، مقاسك كام؟", "ask_size", {
        suggested_actions: ["ask_size"],
      });
    } else if (yesLastAction === "ask_color") {
      const colors = products.length ? productColors(top) : [];
      decision = "yes_after_ask_color";
      resolvedReplyAction = colors.length ? "show_colors" : "ask_color";
      output = withActionAnswer(stripProductPayload(response), colors.length
        ? `تمام يا فندم، الألوان المتاحة منه: ${colors.join("، ")}. تحب أنهي لون؟`
        : "تمام يا فندم، تحب أنهي لون؟", "ask_color", {
        suggested_actions: ["ask_color"],
      });
    } else if (yesLastAction === "ask_order") {
      decision = "yes_after_ask_order";
      resolvedReplyAction = "start_checkout";
      output = withActionAnswer(stripProductPayload(response), "تمام يا فندم، ابعتلي الاسم ورقم الموبايل والعنوان والمقاس عشان أجهز الطلب.", "ask_order", {
        detected_intent: "checkout_collection",
        suggested_actions: ["collect_order_details"],
      });
    } else if (yesLastAction === "show_alternatives") {
      decision = products.length && usedProductContext ? "yes_show_pending_alternatives" : "yes_pending_alternatives_missing";
      resolvedReplyAction = products.length && usedProductContext ? "show_alternatives" : "clarify";
      output = products.length && usedProductContext
        ? withActionAnswer(response, "تمام يا فندم، دي أقرب بدائل شبهه جدًا.", "show_alternatives")
        : withAnswer(stripProductPayload(response), "تمام يا فندم، تقصد موديل معين ولا مقاس معين؟");
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
      output = withAnswer(stripProductPayload(response), "تمام يا فندم، تقصد موديل معين ولا مقاس معين؟");
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
        ? withAnswer(response, "تمام يا فندم، دي أقرب بدائل شبهه جدًا.")
        : withAnswer(stripProductPayload(response), "تمام يا فندم، تحب أدورلك على نفس الستايل ولا سعر قريب؟");
    } else if (false && (state.currentRequestedModel || state.lastProducts.length)) {
      decision = "yes_with_context_ask_size";
      output = withAnswer(stripProductPayload(response), "تمام يا فندم  تحب أشوفلك مقاس كام؟");
    } else if (false) {
      decision = "yes_without_context";
      output = withAnswer(stripProductPayload(response), "تمام يا فندم، تقصد موديل معين ولا مقاس معين؟");
    }
  } else if (!explicitProductRequest({ message, response, intent }) && ["general", "conversational", ""].includes(detectedIntent)) {
    decision = "block_general_product_cards";
    output = withAnswer(stripProductPayload(response), "تحب أساعدك في موديل معين أو مقاس معين يا فندم؟", {
      needs_human_support: false,
    });
  } else if (
    products.length &&
    explicitProductRequest({ message, response, intent }) &&
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
    const colors = productColors(top);
    decision = "color_question";
    output = withAnswer(response, colors.length ? `الألوان المتاحة منه: ${colors.join("، ")}. تحب أبعتلك صور كل لون؟` : "الألوان محتاجة تتأكد من المخزون يا فندم. تحب أحددلك لون معين؟");
  } else if (asksSize(message, response) && products.length) {
    decision = "size_question";
    output = withAnswer(response, availableForSize(top, size)
      ? `أيوه مقاس ${size || productSizes(top)[0] || ""} موجود  تحب أحجزهولك؟`.replace(/\s+/g, " ").trim()
      : "المقاس ده مش متوفر حاليًا، تحب أشوفلك أقرب مقاس أو موديل شبهه؟");
  } else if (asksPrice(message, response, intent) && products.length) {
    const price = productPrice(top);
    const sizes = productSizes(top);
    decision = "price_question";
    output = withAnswer(response, price
      ? `سعره ${price} جنيه يا فندم، والمقاسات المتاحة منه ${sizes.length ? sizes.join("، ") : "هأكدها لك"}. تحب أحجزهولك؟`
      : "السعر محتاج يتأكد يا فندم. تحب أراجعلك السعر والمقاسات؟");
  } else if ((asksAvailability(message) || detectedIntent === "product" || detectedIntent === "product_discovery") && products.length) {
    const price = productPrice(top);
    decision = "exact_product_available";
    output = withAnswer(response, price
      ? `أيوه موجود يا فندم  سعره ${price} جنيه، تحب أشوفلك ${sizePrompt}؟`.replace(/\s+\؟/, "؟")
      : `أيوه موجود يا فندم  تحب أشوفلك ${sizePrompt}؟`);
    output = withActionAnswer(output, output.answer || output.text, "ask_size", {
      suggested_actions: ["ask_size"],
    });
  } else if ((detectedIntent === "product" || detectedIntent === "product_discovery") && !products.length) {
    const fallback = text(response.fallback_reason);
    const hasCloseAlternatives = /alternative|similar|close|بدائل|شبه/i.test(fallback);
    decision = hasCloseAlternatives ? "unavailable_close_alternatives" : "unavailable_no_close_alternatives";
    output = withAnswer(stripProductPayload(response), hasCloseAlternatives
      ? "الموديل ده مش متوفر حاليًا، بس عندي أقرب بدائل شبهه جدًا. تحب أبعتهم؟"
      : "الموديل ده مش متوفر حاليًا للأسف، ومش هبعتلك بديل بعيد عن اللي طلبته. تحب أدورلك على نفس الستايل أو سعر قريب؟");
  } else if (/adidas|اديداس/i.test(message) && !/(running|رننج|جري|casual|كاجوال)/i.test(message) && products.length > 1) {
    decision = "ambiguous_adidas";
    output = withAnswer(stripProductPayload(response), "تقصد Adidas running ولا casual يا فندم؟ والمقاس كام؟");
  }

  console.info("[ai-reply-composer:decision]", {
    source,
    decision,
    productCardsBlocked: hasProducts(response) && !hasProducts(output),
    outputProductCount: selectedProducts(output).length,
  });
  console.info("[ai-reply-composer:output]", {
    source,
    decision,
    answerLength: text(output.answer || output.text).length,
  });
  return output;
};

export default {
  composeAiSalesReply,
};
