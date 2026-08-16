import { resolveActiveProductContext } from "./aiConversationMemoryService.js";
import { buildAiPriceGuard } from "../utils/aiProductReplyGuards.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : [value]).flat().filter(Boolean);
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

const compact = (value = "") =>
  text(value)
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const sanitizeForbiddenPhrases = (value = "") => {
  const replacements = [
    [/يسعدني مساعدتك/g, "أنا معاك"],
    [/شكراً لتواصلك/g, "تمام"],
    [/يرجى الانتظار/g, "استنى ثانية"],
    [/يمكنني مساعدتك/g, "أقدر أساعدك"],
    [/هذا المنتج متوفر/g, "الموديل ده موجود"],
    [/هذا المنتج غير متوفر/g, "الموديل ده مش موجود دلوقتي"],
    [/هذا المنتج غير متاح/g, "الموديل ده مش موجود دلوقتي"],
    [/يمكنني توفير/g, "أقدر أوفر"],
    [/يسعدني/g, "تمام"],
    [/يمكنني/g, "أقدر"],
  ];

  let output = compact(value);
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }
  return output
    // Unicode boundaries: \b is an ASCII-word-character boundary and never matches at
    // the edge of an Arabic word, so all three of these rewrites were inert and the
    // formal register they exist to strip was reaching customers untouched.
    .replace(/(?<![\p{L}\p{N}])(?:حضرتك|سيادتك)(?![\p{L}\p{N}])/gu, "إنت")
    .replace(/(?<![\p{L}\p{N}])يمكنك(?![\p{L}\p{N}])/gu, "تقدر")
    .replace(/(?<![\p{L}\p{N}])يرجى(?![\p{L}\p{N}])/gu, "لو سمحت")
    .replace(/\s+\./g, ".")
    .replace(/\s+،/g, "،")
    .replace(/\s+\?/g, "?")
    .replace(/\s+!/g, "!")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const inferProductName = (response = {}, memory = {}) => {
  const activeContext = resolveActiveProductContext({
    current: memory,
    message: "",
    metadata: {},
    suggestedProducts: asArray(response?.suggested_products),
    preferencesPatch: response?.memory_updates || response?.ai_memory_patch?.preferences || {},
  });
  const product =
    response?.product_context ||
    asArray(response?.suggested_products).find((item) => item && (item.name || item.title || item.product_name)) ||
    asArray(response?.product_cards).find((item) => item && (item.name || item.title || item.product_name)) ||
    activeContext.selected_product_context ||
    null;
  return text(product?.name || product?.title || product?.product_name || activeContext.selected_product_context?.name || activeContext.selected_product_context?.title || "");
};

const inferPrice = (response = {}, baseText = "", memory = {}) => {
  const activeContext = resolveActiveProductContext({
    current: memory,
    message: baseText,
    metadata: {},
    suggestedProducts: asArray(response?.suggested_products),
    preferencesPatch: response?.memory_updates || response?.ai_memory_patch?.preferences || {},
  });
  const product =
    response?.product_context ||
    asArray(response?.suggested_products)[0] ||
    asArray(response?.product_cards)[0] ||
    activeContext.selected_product_context ||
    null;
  const direct =
    Number(product?.final_price || product?.sale_price || product?.price || product?.regular_price || product?.product_price);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const match = text(baseText).match(/(\d{2,6})\s*(?:جنيه|جنية|EGP|LE)\b/i);
  return match ? Number(match[1]) : null;
};

const inferSize = (response = {}, message = "", memory = {}) => {
  const direct = text(response?.requested_size || response?.detected_size || response?.entities?.size);
  if (direct) return direct;
  const memorySize = text(
    memory?.preferences?.selected_size ||
      memory?.preferences?.size ||
      memory?.selected_size ||
      memory?.activeSize ||
      memory?.preferences?.last_selected_size
  );
  if (memorySize) return memorySize;
  const match = text(message).match(/\b(3[5-9]|4[0-9]|5[0-2])\b/);
  return match ? match[1] : "";
};

const pickFirstText = (...values) => asArray(values).map((value) => text(value)).find(Boolean) || "";

const productColorList = (product = {}, memory = {}) => {
  const safeProduct = product || {};
  const direct = [
    ...(Array.isArray(safeProduct.available_colors) ? safeProduct.available_colors : []),
    ...(Array.isArray(safeProduct.colors) ? safeProduct.colors : []),
    ...(Array.isArray(safeProduct.variants) ? safeProduct.variants.flatMap((variant) => [variant?.color, variant?.color_name]) : []),
    safeProduct.color,
    safeProduct.matched_variant_color,
    safeProduct.selected_variant?.color,
    safeProduct.selected_variant?.color_name,
    memory?.active_color,
    memory?.preferences?.active_color,
    memory?.preferences?.selected_color,
  ];
  return [...new Set(direct.map((value) => text(value)).filter(Boolean))];
};

const protectedProductIntents = new Set([
  "product_search",
  "PRODUCT_SEARCH",
  "more_images",
  "MORE_IMAGES",
  "size_followup",
  "SIZE_FOLLOWUP",
  "color_followup",
  "COLOR_AVAILABILITY_FROM_SIZE",
  "color_selected",
  "COLOR_SELECTED",
  "post_product_size_selected",
  "POST_PRODUCT_SIZE_SELECTED",
  "post_product_color_list",
  "POST_PRODUCT_COLOR_LIST",
  "post_product_color_selected",
  "POST_PRODUCT_COLOR_SELECTED",
  "post_product_order_confirmation",
  "POST_PRODUCT_ORDER_CONFIRMATION",
  "image_request",
  "IMAGE_REQUEST",
  "product_images",
  "PRODUCT_IMAGES",
  "product_presentation",
  "PRODUCT_PRESENTATION",
]);

const hasExplicitModelRequest = (message = "") =>
  /(\u062c\u0648\u0631\u062f\u0646\s*(?:4|\u0664|\u06f4|\u0641\u0648\u0631)|jordan\s*4|jordan4|aj4|j4)/i.test(text(message));

const hasProductPayload = ({ response = {}, activeContext = {} } = {}) =>
  asArray(response?.suggested_products).length > 0 ||
  asArray(response?.product_cards).length > 0 ||
  asArray(response?.products).length > 0 ||
  asArray(response?.channel_reply?.product_cards).length > 0 ||
  asArray(response?.images).length > 0 ||
  asArray(response?.image_cards).length > 0 ||
  asArray(response?.visual_attachments).length > 0 ||
  asArray(response?.channel_reply?.image_cards).length > 0 ||
  Boolean(response?.activeProductId || response?.active_product_id || activeContext?.active_product_id);

const shouldProtectProductReply = ({ response = {}, intent = "", message = "", activeContext = {} } = {}) => {
  const detectedIntent = text(intent?.type || intent || response?.detected_intent || response?.intent?.type || response?.intent);
  return protectedProductIntents.has(detectedIntent) ||
    protectedProductIntents.has(detectedIntent.toUpperCase()) ||
    hasProductPayload({ response, activeContext }) ||
    (hasExplicitModelRequest(message) && hasProductPayload({ response, activeContext }));
};

const isGenericOverrideText = (value = "") =>
  /(\u062a\u0642\u0635\u062f\s+\u0623?ن?ه?ي?\s+\u0645\u0648\u062f\u064a\u0644|\u0623\u0637\u0644\u0639\u0644\u0643\s+\u0628\u062f\u064a\u0644|\u0628\u062f\u064a\u0644\s+\u0634\u0628\u0647|\u062a\u062d\u0628\s+\u062a\u0633\u0623\u0644\s+\u0639\u0646\s+\u0645\u0648\u062f\u064a\u0644\s+\u0645\u0639\u064a\u0646|which\s+model|similar\s+alternative|ask\s+about\s+a\s+model)/i.test(text(value));

const hasSpecificProductDetail = (value = "") => {
  const normalized = normalizeArabic(value);
  return Boolean(
    /(?:\b3[5-9]\b|\b4[0-9]\b|\b5[0-2]\b)/.test(text(value)) ||
      /(مقاس|size|لون|الوان|الألوان|متاح|موجود|غير متاح|مش متاح|غير متوفر|مش متوفر|stock|available)/i.test(normalized)
  );
};

const buildProtectedProductReplyText = ({ response = {}, productName = "", baseText = "" } = {}) => {
  const safeBase = sanitizeForbiddenPhrases(baseText);
  if (looksLikeMeaningfulReply(safeBase) && !isGenericOverrideText(safeBase)) return safeBase;
  const product =
    asArray(response?.suggested_products)[0] ||
    asArray(response?.product_cards)[0] ||
    asArray(response?.products)[0] ||
    asArray(response?.channel_reply?.product_cards)[0] ||
    response?.product_context ||
    {};
  const name = text(productName || product?.name || product?.title || product?.product_name || "Jordan 4");
  const hasImages =
    asArray(response?.images).length > 0 ||
    asArray(response?.image_cards).length > 0 ||
    asArray(response?.visual_attachments).length > 0 ||
    asArray(response?.channel_reply?.image_cards).length > 0 ||
    Boolean(product?.image_url || product?.image || product?.main_image);
  return hasImages
    ? `\u0623\u064a\u0648\u0647\u060c ${name} \u0645\u062a\u0627\u062d. \u0647\u0628\u0639\u062a\u0644\u0643 \u0627\u0644\u0635\u0648\u0631 \u0648\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a.`
    : `\u0623\u064a\u0648\u0647\u060c ${name} \u0645\u062a\u0627\u062d. \u0623\u0648\u0631\u064a\u0643 \u0627\u0644\u0635\u0648\u0631 \u0648\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a\u061f`;
};

const inferBuyingIntentCloser = ({
  response = {},
  memory = {},
  message = "",
  productName = "",
  size = "",
} = {}) => {
  const draftOrder = response?.draft_order || response?.ai_order || response?.order_draft || response?.draftOrder || null;
  const selectedProduct =
    response?.product_context ||
    asArray(response?.suggested_products)[0] ||
    asArray(response?.product_cards)[0] ||
    draftOrder?.product ||
    draftOrder?.selected_product ||
    null;
  const chosenProductName = pickFirstText(
    productName,
    draftOrder?.product_name,
    draftOrder?.product?.name,
    draftOrder?.product?.title,
    draftOrder?.product?.product_name,
    selectedProduct?.name,
    selectedProduct?.title,
    selectedProduct?.product_name
  );
  const chosenSize = pickFirstText(
    size,
    draftOrder?.size,
    draftOrder?.selected_size,
    draftOrder?.requested_size,
    draftOrder?.customer_size,
    memory?.preferences?.selected_size,
    memory?.preferences?.size
  );
  const colors = productColorList(selectedProduct);
  const chosenColor = pickFirstText(
    draftOrder?.color,
    draftOrder?.selected_color,
    draftOrder?.requested_color,
    memory?.active_color,
    memory?.selected_color,
    memory?.preferences?.active_color,
    memory?.preferences?.selected_color,
    memory?.preferences?.selected_color_key
  );
  const customerName = pickFirstText(
    draftOrder?.customer_name,
    draftOrder?.name,
    draftOrder?.first_name,
    draftOrder?.customer_first_name,
    memory?.customer_name,
    memory?.preferences?.customer_name,
    memory?.preferences?.first_name
  );
  const customerPhone = pickFirstText(
    draftOrder?.customer_phone,
    draftOrder?.phone,
    draftOrder?.customer_mobile,
    memory?.customer_phone,
    memory?.preferences?.customer_phone
  );
  const customerAddress = pickFirstText(
    draftOrder?.customer_address,
    draftOrder?.address,
    draftOrder?.delivery_address,
    memory?.customer_address,
    memory?.preferences?.customer_address
  );

  const missingOrderFields = [];
  if (!chosenProductName) missingOrderFields.push("product");
  if (chosenProductName && !chosenSize) missingOrderFields.push("size");
  if (chosenProductName && chosenSize && colors.length > 1 && !chosenColor) missingOrderFields.push("color");
  if (!customerName) missingOrderFields.push("customer_name");
  if (!customerPhone) missingOrderFields.push("customer_phone");
  if (!customerAddress) missingOrderFields.push("customer_address");

  const readyToConfirmOrder = missingOrderFields.length === 0;
  const nextBestQuestion = readyToConfirmOrder
    ? "confirm_order"
    : missingOrderFields[0] === "product"
      ? "which_model"
      : missingOrderFields[0] === "size"
        ? "which_size"
        : missingOrderFields[0] === "color"
          ? "which_color"
          : missingOrderFields[0] === "customer_name"
            ? "customer_name"
            : missingOrderFields[0] === "customer_phone"
              ? "customer_phone"
              : "customer_address";

    const nextQuestionText = readyToConfirmOrder
      ? "تمام ✅ الطلب جاهز، أأكدلك الأوردر؟"
      : missingOrderFields[0] === "product"
        ? "تمام يا باشا، تقصد أنهي موديل؟"
      : missingOrderFields[0] === "size"
        ? "تمام يا باشا، محتاج المقاس بس وأجهزهولك."
        : missingOrderFields[0] === "color"
          ? "حلو يا باشا، تحب أنهي لون؟"
          : missingOrderFields[0] === "customer_name"
            ? "تمام يا باشا، ابعتلي الاسم الأول بس وأجهز الطلب."
            : missingOrderFields[0] === "customer_phone"
              ? "ابعتلي رقم الموبايل عشان نأكد الطلب."
              : "ابعتلي العنوان بالتفصيل وهجهزهولك.";

  const summaryBits = [
    chosenProductName ? `الطلب: ${chosenProductName}` : "",
    chosenSize ? `مقاس ${chosenSize}` : "",
    chosenColor ? `لون ${chosenColor}` : "",
  ].filter(Boolean);

  const readySummary = chosenProductName
    ? `تمام ✅ الطلب جاهز: ${summaryBits.join(" ").trim()}. أأكدلك الأوردر؟`
    : "تمام ✅ الطلب جاهز. أأكدلك الأوردر؟";

  return {
    closer: {
      stage: "BUYING_INTENT",
      missing_order_fields: missingOrderFields,
      next_best_question: nextBestQuestion,
      ready_to_confirm_order: readyToConfirmOrder,
      summary: readySummary,
      next_question_text: nextQuestionText,
    },
    missing_order_fields: missingOrderFields,
    next_best_question: nextBestQuestion,
    ready_to_confirm_order: readyToConfirmOrder,
    next_question_text: nextQuestionText,
    summary_text: readySummary,
    closer_text: readyToConfirmOrder ? readySummary : nextQuestionText,
    reply_variations: [
      { id: "closer_primary", text: sanitizeForbiddenPhrases(readyToConfirmOrder ? readySummary : nextQuestionText) },
      { id: "closer_secondary", text: sanitizeForbiddenPhrases(readyToConfirmOrder ? (chosenProductName ? `تمام، ${chosenProductName} ${chosenSize ? `مقاس ${chosenSize}` : ""}${chosenColor ? ` لون ${chosenColor}` : ""}. أأكدلك الطلب؟` : readySummary) : nextQuestionText) },
      { id: "closer_short", text: sanitizeForbiddenPhrases(readyToConfirmOrder ? "تمام ✅ أأكدلك الأوردر؟" : nextQuestionText) },
    ],
  };
};

const inferConversationStage = ({ response = {}, message = "", intent = "", memory = {} } = {}) => {
  const normalizedMessage = normalizeArabic(message);
  const normalizedIntent = lower(intent || response?.detected_intent || response?.intent?.type || response?.intent || "");
  const awaitingAction = text(response?.ai_memory_patch?.preferences?.awaiting_customer_action || response?.memory_updates?.preferences?.awaiting_customer_action || "");
  const handoff = response?.needs_human_support === true || response?.handoff?.needs_human_support === true;
  const handoffRequest =
    /(بني ادم|بني آدم|بنيادم|بنى ادم|human|agent|موظف|حد من الفريق|كلم حد|كلم واحد|عايز اكلم|عايز اكلم بني ادم|كلم بني ادم)/i.test(normalizedMessage) ||
    ["human_support", "human_handoff", "handoff", "takeover", "agent_request"].some((item) => normalizedIntent.includes(item));
  const buyingIntent =
    /(?:عايز اشتري|عايز اشتريه|عاوز اشتري|اشترى|اشتري|order|checkout|عايز اخلص|كمل الطلب|احجزه|احجزها)/i.test(normalizedMessage) ||
    ["buying_intent", "checkout", "checkout_collection", "order", "close_sale"].some((item) => normalizedIntent.includes(item));
  const objection =
    /(?:غالي|سعره عالي|ارخص|خصم|ميزانيه|غاليه|مش مناسب|مش عاجبني|بدائل|بديل|غيره|alternatives?|cheaper)/i.test(normalizedMessage) ||
    ["objection", "price_objection", "handle_objection"].some((item) => normalizedIntent.includes(item));
  const greeting =
    /^(?:اهلا|أهلا|اهلا بيك|أهلا بيك|السلام عليكم|سلام عليكم|هاي|hi|hello|صباح الخير|مساء الخير)$/i.test(normalizedMessage) ||
    ["greeting", "greeting_only"].some((item) => normalizedIntent.includes(item));
  const askingSize = /(?:مقاس|size|نمرة)/i.test(normalizedMessage) || text(awaitingAction).includes("size");
  const askingColor = /(?:لون|الوان|color|colors?)/i.test(normalizedMessage);
  const askingMoreImages = /(?:صور اكتر|صور أكثر|صور تانيه|صور تانية|show me more|more images|ابعت صور)/i.test(normalizedMessage);
  const followUp = askingSize || askingColor || askingMoreImages || /(?:متاح|موجود|available|فيه|عندكم)/i.test(normalizedMessage);
  const closing = buyingIntent || text(response?.suggested_actions).includes("ask_order") || text(awaitingAction).includes("checkout");
  const stage =
    handoff || handoffRequest ? "HUMAN_HANDOFF" :
    closing ? "BUYING_INTENT" :
    objection ? "OBJECTION_HANDLING" :
    askingSize ? "SIZE_SELECTION" :
    askingColor ? "COLOR_SELECTION" :
    askingMoreImages ? "PRODUCT_PRESENTATION_FOLLOWUP" :
    greeting ? "GREETING" :
    followUp ? "DISCOVERY" :
    "PRODUCT_PRESENTATION";

  const signalSet = [
    greeting ? "greeting" : "",
    buyingIntent ? "buying_intent" : "",
    objection ? "objection" : "",
    askingSize ? "size" : "",
    askingColor ? "color" : "",
    askingMoreImages ? "more_images" : "",
    handoff ? "handoff" : "",
  ].filter(Boolean);

  return {
    stage,
    is_greeting: greeting,
    is_buying_intent: buyingIntent,
    is_objection: objection,
    is_follow_up: followUp,
    is_handoff: handoff || handoffRequest,
    is_closing: closing,
    signals: signalSet,
    memory_hint: text(memory?.preferences?.conversation_stage || memory?.conversation_stage || ""),
  };
};

const mapSalesStageToTemplateStage = (salesStage = "", fallbackStage = "PRODUCT_PRESENTATION") => {
  const normalized = text(salesStage).toUpperCase();
  if (!normalized) return fallbackStage;
  if (["HUMAN_TAKEOVER"].includes(normalized)) return "HUMAN_HANDOFF";
  if (["OBJECTION_HANDLING"].includes(normalized)) return "OBJECTION_HANDLING";
  if (["SIZE_COLLECTION"].includes(normalized)) return "SIZE_SELECTION";
  if (["COLOR_COLLECTION"].includes(normalized)) return "COLOR_SELECTION";
  if (["FOLLOW_UP_NEEDED"].includes(normalized)) return "PRODUCT_PRESENTATION_FOLLOWUP";
  if (["DISCOVERY"].includes(normalized)) return "DISCOVERY";
  if (["DRAFT_ORDER", "PAYMENT_PENDING", "CONFIRMED_ORDER"].includes(normalized)) return "BUYING_INTENT";
  return fallbackStage;
};

const buildSalesReplyReasoning = ({
  response = {},
  message = "",
  intent = "",
  memory = {},
  productName = "",
  price = null,
  size = "",
  source = "",
  conversationId = "",
  channel = "",
} = {}) => {
  const normalizedMessage = normalizeArabic(message);
  const normalizedIntent = lower(intent || response?.detected_intent || response?.intent?.type || response?.intent || "");
  const activeContext = resolveActiveProductContext({
    current: memory,
    message,
    metadata: response?.debug || {},
    suggestedProducts: asArray(response?.suggested_products).length ? asArray(response?.suggested_products) : asArray(response?.product_cards),
    preferencesPatch: response?.memory_updates || response?.ai_memory_patch?.preferences || {},
  });
  const primaryProduct = asArray(response?.suggested_products)[0] || asArray(response?.product_cards)[0] || asArray(response?.channel_reply?.product_cards)[0] || activeContext.selected_product_context || null;
  const productContextName = text(
    productName ||
      primaryProduct?.name ||
      primaryProduct?.title ||
      primaryProduct?.product_name ||
      response?.product_context?.name ||
      response?.product_context?.title ||
      response?.product_context?.product_name ||
      activeContext.selected_product_context?.name ||
      activeContext.selected_product_context?.title ||
      activeContext.selected_product_context?.product_name
  );
  const detectedColor = pickFirstText(
    response?.requested_color,
    response?.detected_color,
    response?.entities?.color,
    response?.product_context?.color,
    response?.product_context?.matched_variant_color,
    memory?.preferences?.selected_color,
    memory?.preferences?.color,
    activeContext.active_color
  );
  const productColors = productContextName ? productColorList(primaryProduct || response?.product_context || activeContext.selected_product_context || {}, memory) : [];
  const explicitProductMention = Boolean(productContextName) || /(جوردن|jordan|aj4|j4|نايك|nike|اديداس|adidas|air force|dunk|shox|samba|yeezy|campus|كوتشي|سنيكر|موديل)/i.test(normalizedMessage);
  const isPriceQuestion = /(بكام|السعر|سعره|price|cost|كام سعره|قد ايه)/i.test(normalizedMessage);
  const isSizeQuestion = /(مقاس|size|نمرة|نمره)/i.test(normalizedMessage) || Boolean(size);
  const isColorQuestion = /(لون|الوان|colors?|colour)/i.test(normalizedMessage);
  const isImageRequest = /(صورة|صور|image|photo|ابعت.*صور|more images|show.*images|صور تاني)/i.test(normalizedMessage);
  const isAlternativeRequest = /(بديل|بدائل|شبه|similar|alternative|اقرب حاجة|اقرب بديل)/i.test(normalizedMessage);
  const isComparison = /(قارن|comparison|compare|احسن|افضل|الفرق|ولا)/i.test(normalizedMessage);
  const isCorrection = /(لا مش ده|مش ده|ده مش|مش هو|غلط|قصدي|اقصد|wrong|not this|no that's not)/i.test(normalizedMessage);
  const rejectedAspect = (() => {
    if (!isCorrection) return "";
    if (/(السعر|سعره|غالي|غاليه|ارخص|خصم|price|cost|budget|ميزانية)/i.test(normalizedMessage)) return "price";
    if (/(لون|اللون|الوان|color|colour)/i.test(normalizedMessage)) return "color";
    if (/(صورة|صور|image|photo|picture|سكرين|لقطة)/i.test(normalizedMessage)) return "image";
    if (/(ستايل|style|موديل|model|شكل|تصميم)/i.test(normalizedMessage)) return "style";
    return "product";
  })();
  const isHumanHandoff = /(بني ادم|human|agent|موظف|كلم حد|حد من الفريق|ظبطها مع انسان|handoff)/i.test(normalizedMessage) || normalizedIntent.includes("human");
  const isBuyingIntent = /(عايز اشتري|عاوز اشتري|عايز اجيب|احجزه|احجزهولي|reserve|buy|order|checkout|هات|هاتهولي|طلهولي)/i.test(normalizedMessage) || normalizedIntent.includes("buying") || normalizedIntent.includes("checkout") || normalizedIntent.includes("order");
  const isPaymentQuestion = /(الدفع|payment|pay|تحويل|instapay|فودافون|visa|mastercard|bank)/i.test(normalizedMessage);
  const isObjection = /(غالي|غاليه|سعره عالي|ارخص|خصم|discount|ميزانيه|ميزانية|مش مناسب|مش عاجبني السعر|عايزه ارخص)/i.test(normalizedMessage) || normalizedIntent.includes("objection");
  const hasOrderDraft = Boolean(response?.draft_order || response?.ai_order?.status === "ai_draft" || response?.ai_order?.status === "draft");
  const closer = inferBuyingIntentCloser({ response, memory, message, productName: productContextName, size });
  const hasProductContext = Boolean(
    productContextName ||
      explicitProductMention ||
      hasOrderDraft ||
      productColors.length ||
      asArray(response?.suggested_products).length ||
      asArray(response?.product_cards).length ||
      activeContext.active_product_id
  );

  let salesStage = "DISCOVERY";
  if (isHumanHandoff) {
    salesStage = "HUMAN_TAKEOVER";
  } else if (isPaymentQuestion) {
    salesStage = "PAYMENT_PENDING";
  } else if (isCorrection) {
    salesStage = hasProductContext ? "PRODUCT_MATCHED" : "DISCOVERY";
  } else if (isPriceQuestion) {
    salesStage = "PRICE_DISCUSSION";
  } else if (isObjection) {
    salesStage = "OBJECTION_HANDLING";
  } else if (isBuyingIntent && closer.ready_to_confirm_order) {
    salesStage = "CONFIRMED_ORDER";
  } else if (isBuyingIntent && hasProductContext) {
    if ((closer.missing_order_fields || []).includes("size")) {
      salesStage = "SIZE_COLLECTION";
    } else if ((closer.missing_order_fields || []).includes("color")) {
      salesStage = "COLOR_COLLECTION";
    } else {
      salesStage = "DRAFT_ORDER";
    }
  } else if (isSizeQuestion) {
    salesStage = hasProductContext ? "SIZE_COLLECTION" : "DISCOVERY";
  } else if (isColorQuestion) {
    salesStage = hasProductContext ? "COLOR_COLLECTION" : "DISCOVERY";
  } else if (isImageRequest || isAlternativeRequest || isComparison) {
    salesStage = hasProductContext ? "PRODUCT_MATCHED" : "DISCOVERY";
  } else if (explicitProductMention || hasProductContext) {
    salesStage = "PRODUCT_MATCHED";
  } else if (/follow ?up|تابعني|رجعلي|لسه|لسه موجود|متاح دلوقتي/i.test(normalizedMessage)) {
    salesStage = "FOLLOW_UP_NEEDED";
  }

  const templateStage = mapSalesStageToTemplateStage(salesStage, inferConversationStage({ response, message, intent, memory }).stage);
  const stageAwareness = inferConversationStage({ response, message, intent, memory });

  const customerMeaning = (() => {
    if (salesStage === "HUMAN_TAKEOVER") return "العميل عايز يتكلم مع حد من الفريق.";
    if (salesStage === "PAYMENT_PENDING") return "العميل وصل لخطوة الدفع وعايز طريقة التنفيذ.";
    if (salesStage === "CONFIRMED_ORDER") return "العميل أكد الشراء وجاهز للتثبيت.";
    if (salesStage === "DRAFT_ORDER") return "العميل جاهز نكمل بيانات الطلب ونقفل البيع.";
    if (salesStage === "SIZE_COLLECTION") return "العميل مهتم بالمنتج لكن المقاس هو النقطة اللي ناقصة.";
    if (salesStage === "COLOR_COLLECTION") return "العميل مهتم بالمنتج وبيحدد اللون المناسب.";
    if (salesStage === "PRICE_DISCUSSION") return "العميل بيسأل على السعر وبيوازن قبل القرار.";
    if (salesStage === "OBJECTION_HANDLING") return "العميل شايف السعر عالي وعايز بديل أو طمأنة.";
    if (isCorrection && rejectedAspect === "price") return "العميل معترض على السعر وعايز قيمة أوضح قبل ما يكمّل.";
    if (isCorrection && rejectedAspect === "color") return "العميل مش عايز اللون ده وعايز لون تاني من نفس المنتج.";
    if (isCorrection && rejectedAspect === "image") return "العميل محتاج صورة أوضح أو زاوية تانية لنفس المنتج.";
    if (isCorrection && rejectedAspect === "style") return "العميل مش مقتنع بالستايل وعايز شكل أقرب لذوقه.";
    if (isCorrection) return "العميل بيصحح الاختيار وعايز إعادة توجيه سريعة.";
    if (isImageRequest) return "العميل عايز صور أوضح لنفس المنتج قبل ما يقرر.";
    if (isAlternativeRequest) return "العميل طلب بديل قريب أو اختيار مشابه.";
    if (isComparison) return "العميل بيقارن بين اختيارات وعايز أفضل واحد.";
    if (explicitProductMention) return "العميل ذكر منتج واضح وعايز تفاصيل أكتر عنه.";
    return "العميل محتاج توضيح سريع عشان نحدد أنسب خطوة بيع.";
  })();

  const replyGoal = (() => {
    switch (salesStage) {
      case "HUMAN_TAKEOVER":
        return "handoff_to_human";
      case "PAYMENT_PENDING":
        return "guide_payment";
      case "CONFIRMED_ORDER":
        return "confirm_purchase";
      case "DRAFT_ORDER":
        return "collect_order_fields";
      case "SIZE_COLLECTION":
        return "collect_size";
      case "COLOR_COLLECTION":
        return "collect_color";
      case "PRICE_DISCUSSION":
        return "answer_price";
      case "OBJECTION_HANDLING":
        return "reduce_objection";
      case "FOLLOW_UP_NEEDED":
        return "reengage_customer";
      case "PRODUCT_MATCHED":
        return "help_pick_product";
      default:
        return "clarify_need";
    }
  })();

  const nextBestAction = (() => {
    switch (salesStage) {
      case "HUMAN_TAKEOVER":
        return "handoff";
      case "PAYMENT_PENDING":
        return "share_payment_steps";
      case "CONFIRMED_ORDER":
        return "confirm_order";
      case "DRAFT_ORDER":
        return "collect_order_fields";
      case "SIZE_COLLECTION":
        return "ask_size";
      case "COLOR_COLLECTION":
        return "ask_color";
      case "PRICE_DISCUSSION":
        return "answer_price_then_move_forward";
      case "OBJECTION_HANDLING":
        return "reframe_value_or_offer_alternative";
      case "FOLLOW_UP_NEEDED":
        return "send_follow_up";
      case "PRODUCT_MATCHED":
        return "offer_options";
      default:
        return "ask_one_useful_question";
    }
  })();

  let confidence = 0.46;
  if (hasProductContext) confidence += 0.12;
  if (explicitProductMention) confidence += 0.08;
  if (isSizeQuestion || Boolean(size)) confidence += 0.08;
  if (isColorQuestion || detectedColor) confidence += 0.06;
  if (isPriceQuestion || isObjection) confidence += 0.08;
  if (isBuyingIntent) confidence += 0.14;
  if (isImageRequest || isAlternativeRequest || isComparison) confidence += 0.05;
  if (isHumanHandoff) confidence = 0.98;
  if (salesStage === "DISCOVERY" && !hasProductContext && !explicitProductMention) confidence = Math.min(confidence, 0.62);
  confidence = Math.max(0.2, Math.min(0.98, confidence));

  const priceLabel = Number.isFinite(Number(price)) && Number(price) > 0 ? `${Math.round(Number(price)).toLocaleString("en-US")} جنيه` : "";
  const productLabel = productContextName || "الموديل ده";
  const productColorText = productColors.length ? `الألوان المتاحة: ${productColors.slice(0, 3).join("، ")}` : "";
  const priceGuard = buildAiPriceGuard({
    productId: activeContext?.selected_product_context?.product_id || activeContext?.selected_product_context?.id || activeContext?.active_product_id || response?.product_context?.product_id || response?.product_context?.id || null,
    variantId: activeContext?.selected_product_context?.variant_id || response?.product_context?.variant_id || null,
    rawPrice: price,
    product: response?.product_context || asArray(response?.suggested_products)[0] || asArray(response?.product_cards)[0] || activeContext?.selected_product_context || {},
    productContext: activeContext,
    memory,
    messageText: message,
    route: "ai_human_sales_personality_layer_reasoning",
  });
  const safePriceFallback = priceGuard.safeReplyText || "السعر محتاج يتأكد من السيستم قبل التأكيد. ابعتلي اسمك ورقمك لو تحب نكمل.";

  const replyVariations = (() => {
    const variants = {
      HUMAN_HANDOFF: [
        "تمام، هحوّلك لحد من الفريق حالًا.",
        "حاضر يا باشا، واحد من الفريق هيتابع معاك دلوقتي.",
        "تمام، هكملها مع زميلي عشان يرد عليك مباشرة.",
      ],
      PAYMENT_PENDING: [
        "تمام يا باشا، أقولك طريقة الدفع خطوة خطوة.",
        "حاضر، هبعتلك تفاصيل الدفع ونكمل من هناك.",
        "تمام، تحب الدفع أونلاين ولا استلام؟",
      ],
      CONFIRMED_ORDER: [
        "تمام، الطلب اتثبت خلاص.",
        "ممتاز، كده الطلب جاهز للتأكيد.",
        "تمام يا باشا، كده إحنا ماشيين في السليم.",
      ],
      DRAFT_ORDER: [
        "تمام يا باشا، محتاج المقاس بس وأجهزهولك.",
        "حاضر، ابعت المقاس وأنا أكمل الطلب.",
        "تمام، نحدد المقاس ونقفّل الطلب.",
      ],
      SIZE_COLLECTION: [
        size ? `تمام، مقاس ${size} موجود. تحب أحجزهولك؟` : "تمام، مقاسك كام عشان أظبطهولك؟",
        size ? `أيوه، ${productLabel} على مقاس ${size}. تحب أكملك الحجز؟` : `محتاج المقاس بس عشان أظبط ${productLabel}.`,
        size ? `مقاس ${size} متاح. تحب أشوفلك لون معين كمان؟` : "قولي مقاسك وأنا أطلعلك المتاح.",
      ],
      COLOR_COLLECTION: [
        productColorText || "الألوان المتاحة منه هبعتهاولك حالًا.",
        productColorText ? `${productColorText}. تحب أنهي لون؟` : "تحب لون معين؟",
        productColorText ? `تمام، ${productColorText}. لو تحب أطلعلك صورة لون معين أبعتهالك.` : "أبعتلك الألوان المتاحة؟",
      ],
      PRICE_DISCUSSION: [
        priceGuard.shouldUseSafeReply
          ? safePriceFallback
          : priceLabel ? `سعره ${priceLabel}. تحب أشوفلك مقاسك؟` : `سعر ${productLabel} موجود. تحب أشوفلك المقاس؟`,
        priceGuard.shouldUseSafeReply
          ? safePriceFallback
          : priceLabel ? `أيوه، ${productLabel} سعره ${priceLabel}. لو تحب أطلعلك المقاسات كمان.` : `أيوه، ${productLabel} متاح. تحب أقولك السعر والمقاسات؟`,
        priceGuard.shouldUseSafeReply
          ? safePriceFallback
          : priceLabel ? `سعره ${priceLabel} يا باشا. لو عايز بديل أرخص أطلعلك واحد قريب.` : "أقولك أقرب بديل بسعر أهدى؟",
      ],
      OBJECTION_HANDLING: [
        priceGuard.shouldUseSafeReply
          ? safePriceFallback
          : priceLabel ? `فاهمك يا باشا، ${productLabel} سعره ${priceLabel} عشان خامته أعلى شوية. أطلعلك بديل أرخص؟` : "فاهمك يا باشا، أطلعلك بديل أقرب للمزانية؟",
        "معاك حق، لو السعر مش مناسب أقدر أرشحلك حاجة قريبة وأهدى.",
        "تمام، لو عايز سعر أهدى أطلعلك بديل شبهه جدًا.",
      ],
      FOLLOW_UP_NEEDED: [
        "لسه موجود يا باشا، تحب أكمل معاك على نفس الموديل؟",
        "لو لسه مهتم، أقدر أرجعلك على نفس الاختيار.",
        "تمام، لو تحب أطلعلك المتاح من نفس النوع.",
      ],
      PRODUCT_PRESENTATION: [
        productLabel !== "الموديل ده" ? `أيوه، ${productLabel} موجود.` : "أيوه، الموديل ده موجود.",
        productLabel !== "الموديل ده" ? `موجود يا باشا، ${productLabel}.` : "موجود يا باشا.",
        productLabel !== "الموديل ده" ? `طبعًا، ${productLabel} متاح.` : "طبعًا، متاح.",
      ],
      PRODUCT_PRESENTATION_FOLLOWUP: [
        "حاضر، أطلعلك صور أكتر من نفس الموديل.",
        "تمام، أبعتهالك بصور إضافية لنفس الشكل.",
        "أكيد، لو تحب أطلعلك صور لون تاني كمان.",
      ],
      COLOR_SELECTION: [
        productColorText || "الألوان المتاحة منه هبعتهاولك.",
        productColorText ? `${productColorText}. تحب أنهي لون؟` : "تحب لون معين؟",
        "تمام، أقولك الألوان المتاحة دلوقتي.",
      ],
      SIZE_SELECTION: [
        size ? `أيوه، مقاس ${size} موجود. تحب أحجزهولك؟` : "مقاسك كام؟",
        size ? `تمام، ${productLabel} مقاس ${size} متاح.` : "قولي المقاس وأنا أراجع المتاح.",
        size ? `مقاس ${size} موجود. نكمل الطلب؟` : "حضرلي المقاس بس.",
      ],
      DISCOVERY: [
        "تمام يا باشا، ابعتلي اللي في بالك وأنا أظبطهولك.",
        "أوكي، لو عندك موديل معين ابعتهولي.",
        "قولي بتحب حاجة للجري ولا كاجوال؟",
      ],
    };
    const selected = variants[templateStage] || variants.PRODUCT_PRESENTATION;
    return selected.map((variant, index) => ({
      id: `reasoned_${templateStage.toLowerCase()}_${index + 1}`,
      text: sanitizeForbiddenPhrases(variant),
    }));
  })();

  const whyThisReply = (() => {
    if (salesStage === "PRICE_DISCUSSION") return "العميل سأل عن السعر، فالأفضل أرد مختصر وأكمل بالمقاس أو الخطوة اللي بعدها.";
    if (salesStage === "SIZE_COLLECTION") return "المقاس هو المعلومة الناقصة اللي هتحدد لو نكمل الحجز ولا لأ.";
    if (salesStage === "COLOR_COLLECTION") return "اللون لسه ناقص، فالأفضل أوضح المتاح بدل شرح طويل.";
    if (salesStage === "OBJECTION_HANDLING") return "العميل معترض على السعر، فالأفضل أهدّي الموقف وأعرض بديل قريب.";
    if (salesStage === "DRAFT_ORDER") return "العميل جاهز للشراء، فالأفضل نطلب البيانات الناقصة بدل الرد العام.";
    if (salesStage === "PAYMENT_PENDING") return "العميل دخل مرحلة الدفع، فالأفضل أوضح الخطوة التالية مباشرة.";
    if (salesStage === "HUMAN_TAKEOVER") return "العميل طلب تدخل بشري، فلازم نحول بسرعة من غير تكرار.";
    if (salesStage === "PRODUCT_MATCHED") return "فيه منتج واضح في السياق، فالأفضل أذكره طبيعي وأعرض اختيار واحد مفيد.";
    return "المحادثة محتاجة توجيه واضح وقصير من غير حشو أو رد قالب.";
  })();

  return {
    customer_meaning: customerMeaning,
    detected_entities: {
      product_name: productContextName,
      brand: text(
        response?.product_context?.brand ||
          response?.product_context?.brand_name ||
          response?.product_context?.manufacturer ||
          response?.brand ||
          ""
      ),
      model: text(
        response?.product_context?.model ||
          response?.product_context?.model_name ||
          response?.product_context?.sku ||
          response?.product_context?.product_model ||
          ""
      ),
      size: text(size),
      color: text(detectedColor),
      price_question: isPriceQuestion,
      objection: isObjection,
      buying_intent: isBuyingIntent,
      comparison: isComparison,
      image_request: isImageRequest,
      alternative_request: isAlternativeRequest,
      confusion_or_correction: isCorrection,
      correction_target: rejectedAspect,
      human_handoff: isHumanHandoff,
      payment_question: isPaymentQuestion,
      product_context_present: hasProductContext,
      product_colors: productColors,
    },
    sales_stage: salesStage,
    template_stage: templateStage,
    reply_goal: replyGoal,
    next_best_action: nextBestAction,
    confidence,
    why_this_reply: whyThisReply,
    reply_variations: replyVariations,
    stage_awareness: stageAwareness,
    source,
    conversation_id: conversationId,
    channel,
  };
};

const buildReasoningReplyEngine = ({
  response = {},
  message = "",
  reasoning = {},
  stageAwareness = null,
  closerMeta = null,
  productName = "",
  price = null,
  size = "",
  memory = {},
} = {}) => {
  const salesStage = text(reasoning.sales_stage || stageAwareness?.stage || "DISCOVERY").toUpperCase();
  const activeContext = resolveActiveProductContext({
    current: memory,
    message,
    metadata: response?.debug || {},
    suggestedProducts: asArray(response?.suggested_products).length ? asArray(response?.suggested_products) : asArray(response?.product_cards),
    preferencesPatch: response?.memory_updates || response?.ai_memory_patch?.preferences || {},
  });
  const productLabel = text(productName || inferProductName(response, memory) || activeContext.selected_product_context?.name || activeContext.selected_product_context?.title || "الموديل ده");
  const priceLabel = Number.isFinite(Number(price)) && Number(price) > 0 ? `${Math.round(Number(price)).toLocaleString("en-US")} جنيه` : "";
  const priceGuard = buildAiPriceGuard({
    productId: activeContext?.selected_product_context?.product_id || activeContext?.selected_product_context?.id || activeContext?.active_product_id || response?.product_context?.product_id || response?.product_context?.id || null,
    variantId: activeContext?.selected_product_context?.variant_id || response?.product_context?.variant_id || null,
    rawPrice: price,
    product: response?.product_context || asArray(response?.suggested_products)[0] || asArray(response?.product_cards)[0] || activeContext?.selected_product_context || {},
    productContext: activeContext,
    memory,
    messageText: message,
    route: "ai_human_sales_personality_layer_reasoning",
  });
  const safePriceFallback = priceGuard.safeReplyText || "السعر محتاج يتأكد من السيستم قبل التأكيد. ابعتلي اسمك ورقمك لو تحب نكمل.";
  const productColors = productColorList(response?.product_context || asArray(response?.suggested_products)[0] || asArray(response?.product_cards)[0] || activeContext.selected_product_context || {}, memory);
  const selectedProduct = productLabel || text(response?.draft_order?.product_name || response?.draft_order?.product?.name || "");
  const missingFields = asArray(closerMeta?.missing_order_fields || response?.missing_order_fields || response?.closer?.missing_order_fields || []);
  const normalizedMissingFields = missingFields.map((item) => text(item)).filter(Boolean);
  const readyToConfirmOrder = Boolean(closerMeta?.ready_to_confirm_order ?? response?.ready_to_confirm_order ?? response?.closer?.ready_to_confirm_order);
  const summary = text(closerMeta?.summary || response?.closer?.summary || response?.closer?.summary_text || "");
  const nextQuestion = text(closerMeta?.next_question_text || closerMeta?.next_best_question || response?.next_best_question || response?.closer?.next_best_question || "");
  const hasAlternativeSignal = Boolean(reasoning.detected_entities?.alternative_request || reasoning.reply_goal === "help_pick_product");
  const hasImageSignal = Boolean(reasoning.detected_entities?.image_request || reasoning.reply_goal === "help_pick_product");
  const hasCorrectionSignal = Boolean(reasoning.detected_entities?.confusion_or_correction);
  const hasPriceSignal = Boolean(reasoning.detected_entities?.price_question || reasoning.reply_goal === "answer_price" || salesStage === "PRICE_DISCUSSION" || salesStage === "OBJECTION_HANDLING");
  const hasHumanSignal = Boolean(reasoning.detected_entities?.human_handoff || salesStage === "HUMAN_TAKEOVER");
  const stageSummaryBits = [
    selectedProduct && selectedProduct !== "الموديل ده" ? selectedProduct : "",
    size ? `مقاس ${size}` : "",
    productColors.length === 1 ? `لون ${productColors[0]}` : "",
  ].filter(Boolean);

  const askProduct = "تمام يا باشا، تقصد أنهي موديل بالضبط؟";
  const askSize = `تمام يا باشا، ${selectedProduct && selectedProduct !== "الموديل ده" ? selectedProduct : "الموديل"} محتاج المقاس بس. كام؟`;
  const askColor = productColors.length > 1
    ? `تمام يا باشا، تحب أنهي لون من ${productColors.slice(0, 3).join("، ")}؟`
    : "تمام يا باشا، تحب أنهي لون؟";
  const askName = "تمام يا باشا، ابعتلي الاسم الأول بس.";
  const askPhone = "ابعتلي رقم الموبايل بس عشان أكمّل.";
  const askAddress = "ابعتلي العنوان بالتفصيل وهجهزهولك.";
  const askFollowUp = productLabel && productLabel !== "الموديل ده"
    ? (priceGuard.shouldUseSafeReply ? safePriceFallback : `أيوه يا باشا، ${productLabel} موجود. تحب المقاس ولا السعر؟`)
    : (priceGuard.shouldUseSafeReply ? safePriceFallback : "أيوه يا باشا، تحب المقاس ولا السعر؟");
  const askAlternative = `تمام يا باشا، أطلعلك بديل شبه ${productLabel && productLabel !== "الموديل ده" ? productLabel : "ده"}؟`;
  const askImages = `حاضر يا باشا، أبعتلك صور أكتر لنفس ${productLabel && productLabel !== "الموديل ده" ? productLabel : "الموديل"}؟`;
  const askPriceAlternative = priceLabel
    ? `فاهمك يا باشا، ${productLabel && productLabel !== "الموديل ده" ? productLabel : "الموديل"} سعره ${priceLabel}. تحب بديل أخف ولا نكمّل على ده؟`
    : "فاهمك يا باشا، تحب بديل أخف ولا نكمّل على ده؟";
  const askHuman = "تمام يا باشا، هخلي حد من الفريق يكلمك حالًا.";
  const readyText = stageSummaryBits.length
    ? `تمام يا باشا، الطلب جاهز: ${stageSummaryBits.join(" ").trim()}. أأكدلك الأوردر؟`
    : "تمام يا باشا، الطلب جاهز. أأكدلك الأوردر؟";

  const pickMissingFieldReply = () => {
    if (normalizedMissingFields.includes("product")) return askProduct;
    if (normalizedMissingFields.includes("size")) return askSize;
    if (normalizedMissingFields.includes("color")) return askColor;
    if (normalizedMissingFields.includes("customer_name")) return askName;
    if (normalizedMissingFields.includes("customer_phone")) return askPhone;
    if (normalizedMissingFields.includes("customer_address")) return askAddress;
    return "";
  };

  let primaryText = "";
  if (hasHumanSignal) {
    primaryText = askHuman;
  } else if (readyToConfirmOrder) {
    primaryText = readyText || summary || "تمام يا باشا، الطلب جاهز. أأكدلك الأوردر؟";
  } else if (normalizedMissingFields.length) {
    primaryText = pickMissingFieldReply();
  } else if (hasCorrectionSignal) {
    if ((reasoning.detected_entities?.correction_target || "").toLowerCase() === "price") {
      primaryText = priceLabel
        ? `فاهمك يا باشا، ${productLabel && productLabel !== "الموديل ده" ? productLabel : "ده"} سعره ${priceLabel} عشان خامته أعلى وشكله أشيك. لو السعر هو المشكلة أطلعلك حاجة أهدى.`
        : `فاهمك يا باشا، لو السعر مش مناسب أشرحلك القيمة الأول، ولو تحب أطلعلك حاجة أهدى.`;
    } else if ((reasoning.detected_entities?.correction_target || "").toLowerCase() === "color") {
      primaryText = "تمام يا باشا، يبقى اللون ده مش اللي في بالك. تحب لون تاني من نفس الموديل؟";
    } else if ((reasoning.detected_entities?.correction_target || "").toLowerCase() === "image") {
      primaryText = "تمام يا باشا، هبعتلك صورة أوضح لنفس الموديل حالًا.";
    } else if ((reasoning.detected_entities?.correction_target || "").toLowerCase() === "style") {
      primaryText = "تمام يا باشا، يبقى الستايل ده مش مناسب. تحب حاجة كاجوال ولا شكل أهدى؟";
    } else {
      primaryText = `تمام يا باشا، يبقى ده مش اللي تقصده. تحب موديل تاني ولا لون مختلف من نفس الشكل؟`;
    }
  } else if (hasAlternativeSignal) {
    primaryText = askAlternative;
  } else if (hasImageSignal) {
    primaryText = askImages;
  } else if (hasPriceSignal) {
    primaryText = priceGuard.shouldUseSafeReply
      ? safePriceFallback
      : priceLabel
        ? `فاهمك يا باشا، ${productLabel && productLabel !== "الموديل ده" ? productLabel : "ده"} سعره ${priceLabel} عشان خامته أعلى وشكله أقوى شوية. لو تحب أطلعلك حاجة أهدى في السعر.`
        : "فاهمك يا باشا، لو السعر مش مناسب أشرحلك القيمة الأول، ولو تحب أطلعلك حاجة أهدى.";
  } else if (salesStage === "SIZE_COLLECTION") {
    primaryText = askSize;
  } else if (salesStage === "COLOR_COLLECTION") {
    primaryText = askColor;
  } else if (salesStage === "OBJECTION_HANDLING") {
    primaryText = priceLabel
      ? `فاهمك يا باشا، ${productLabel && productLabel !== "الموديل ده" ? productLabel : "ده"} سعره ${priceLabel} عشان خامته أعلى وشكله أقوى شوية. لو السعر هو المشكلة أقدر أطلعلك حاجة أقرب للمزانية.`
      : "فاهمك يا باشا، لو السعر مش مناسب أشرحلك ليه المنتج ده مختلف، وبعدها أطلعلك بديل قريب.";
  } else if (salesStage === "PRODUCT_MATCHED" || salesStage === "PRODUCT_PRESENTATION") {
    primaryText = priceGuard.shouldUseSafeReply ? safePriceFallback : askFollowUp;
  } else if (salesStage === "DISCOVERY") {
    primaryText = askProduct;
  } else if (salesStage === "BUYING_INTENT") {
    primaryText = nextQuestion || askSize;
  } else {
    primaryText = text(response.answer || response.text || "").trim() || askProduct;
  }

  const replyVariations = [
    primaryText,
    hasHumanSignal
      ? "تمام يا باشا، هخلي حد من الفريق يكلمك حالًا."
      : readyToConfirmOrder
        ? `تمام يا باشا، ${summary || readyText} أأكدلك الأوردر؟`
        : normalizedMissingFields.includes("size")
          ? `تمام يا باشا، محتاج المقاس بس. كام؟`
          : normalizedMissingFields.includes("customer_phone")
            ? "ابعتلي رقم الموبايل بس عشان أكمّل."
            : normalizedMissingFields.includes("customer_address")
              ? "ابعتلي العنوان بالتفصيل وهجهزهولك."
              : normalizedMissingFields.includes("customer_name")
                ? "تمام يا باشا، ابعتلي الاسم الأول بس."
                : normalizedMissingFields.includes("color")
                  ? askColor
                  : normalizedMissingFields.includes("product")
                    ? askProduct
                    : hasImageSignal
                      ? `حاضر يا باشا، أبعتلك صور أكتر لنفس ${productLabel && productLabel !== "الموديل ده" ? productLabel : "الموديل"} دلوقتي.`
                      : hasAlternativeSignal
                        ? `تمام يا باشا، أطلعلك بديل شبهه جدًا؟`
                        : hasCorrectionSignal
                          ? `تمام يا باشا، هنسيب ده. تحب أقرب حاجة شبهه؟`
                          : hasPriceSignal
                            ? `فاهمك يا باشا، تحب بديل أخف ولا نكمّل على ده؟`
                            : askFollowUp,
    hasPriceSignal
      ? (priceGuard.shouldUseSafeReply ? safePriceFallback : `سعره ${priceLabel || "موجود"} يا باشا، تحب بديل أخف؟`)
      : salesStage === "PRODUCT_MATCHED"
        ? (priceGuard.shouldUseSafeReply ? safePriceFallback : `أيوه يا باشا، ${productLabel && productLabel !== "الموديل ده" ? productLabel : "ده"} موجود. تحب المقاس ولا السعر؟`)
        : `تمام يا باشا، ابعتلي اللي ناقص وأنا أجهزهولك.`,
  ].map((item) => sanitizeForbiddenPhrases(text(item))).filter(Boolean);

  return {
    text: replyVariations[0] || sanitizeForbiddenPhrases(text(response.answer || response.text || "")),
    reply_variations: replyVariations.map((item, index) => ({ id: `reasoned_reply_${index + 1}`, text: item })),
  };
};

const deterministicPick = (variations = [], seed = "") => {
  const list = asArray(variations).filter((item) => text(item?.text || item).length > 0);
  if (!list.length) return null;
  const basis = text(seed) || list.map((item) => text(item?.id || item?.text || item)).join("|");
  const score = [...basis].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return list[score % list.length];
};

const looksLikeMeaningfulReply = (value = "") => {
  const normalized = normalizeArabic(value);
  if (!normalized) return false;
  if (normalized.length < 4) return false;
  if (/[\uFFFD]/.test(value)) return false;
  if (!/[\u0600-\u06ffa-z0-9]/i.test(value)) return false;
  return normalized.length >= 6;
};

const buildReplyVariations = ({
  stage = "PRODUCT_PRESENTATION",
  baseText = "",
  productName = "",
  price = null,
  size = "",
  response = {},
  message = "",
  memory = {},
  activeContext = {},
} = {}) => {
  const productLabel = productName || "الموديل ده";
  const priceLabel = Number.isFinite(Number(price)) && Number(price) > 0 ? `${Math.round(Number(price)).toLocaleString("en-US")} جنيه` : "";
  const priceGuard = buildAiPriceGuard({
    productId: activeContext?.selected_product_context?.product_id || activeContext?.selected_product_context?.id || activeContext?.active_product_id || response?.product_context?.product_id || response?.product_context?.id || null,
    variantId: activeContext?.selected_product_context?.variant_id || response?.product_context?.variant_id || null,
    rawPrice: price,
    product: response?.product_context || asArray(response?.suggested_products)[0] || asArray(response?.product_cards)[0] || activeContext?.selected_product_context || {},
    productContext: activeContext,
    memory,
    messageText: message,
    route: "ai_human_sales_personality_layer",
  });
  const safePriceFallback = priceGuard.safeReplyText || "السعر محتاج يتأكد من السيستم قبل التأكيد. ابعتلي اسمك ورقمك لو تحب نكمل.";
  const base = sanitizeForbiddenPhrases(baseText);

  const templates = {
    GREETING: [
      "أهلا بيك، قولّي على الموديل اللي في بالك.",
      "نورتنا، ابعت الاسم أو الصورة وأنا أظبطهولك.",
      "تمام، لو عندك موديل معين ابعته وأنا أقولك المتاح.",
    ],
      PRODUCT_PRESENTATION: [
        priceGuard.shouldUseSafeReply
          ? safePriceFallback
          : [productLabel !== "الموديل ده" ? `${productLabel} موجود` : "أيوه موجود", `سعره ${priceLabel}.`, "تحب أشوفلك الألوان والمقاسات؟"].filter(Boolean).join(" "),
        priceGuard.shouldUseSafeReply
          ? safePriceFallback
          : [productLabel !== "الموديل ده" ? `${productLabel} موجود عندي` : "أيوه، موجود عندي", `وسعره ${priceLabel}.`, "أطلعلك المتاح منه؟"].filter(Boolean).join(" "),
        priceGuard.shouldUseSafeReply
          ? safePriceFallback
          : [productLabel !== "الموديل ده" ? `تمام، ${productLabel} موجود` : "تمام، الموجود هو ده", `وسعره ${priceLabel}.`, "أبعتهولك بالألوان والمقاسات؟"].filter(Boolean).join(" "),
      ],
    PRODUCT_PRESENTATION_FOLLOWUP: [
      "حاضر يا باشا، أبعتلك صور زيادة لنفس الموديل.",
      "أهو شوية صور كمان لنفس الستايل.",
      "لو عايز أطلعلك صور لنفس اللون، قولّي.",
    ],
    COLOR_SELECTION: [
      "الألوان المتاحة منه دي.",
      "أيوه، دي الألوان اللي موجودة.",
      "تمام، هوريك الألوان المتاحة دلوقتي.",
    ],
    SIZE_SELECTION: [
      size ? `أيوه، مقاس ${size} موجود. تحب أحجزهولك؟` : "أيوه، المقاس ده موجود. تحب أحجزهولك؟",
      size ? `مقاس ${size} متاح. أكمل معاك الطلب؟` : "المقاس ده متاح. أكمل معاك الطلب؟",
      size ? `تمام، ${size} موجود. أطلعلك اللي بعده لو تحب؟` : "تمام، الموجود دلوقتي هو ده. أطلعلك اللي بعده لو تحب؟",
    ],
    OBJECTION_HANDLING: [
      [base.includes("غالي") || base.includes("السعر") ? "فاهمك يا باشا" : "تمام يا باشا", "لو السعر مش مناسب أطلعلك بديل أقرب."].join(" "),
      "لو عايز حاجة على قد الميزانية، أطلعلك بدائل أحسن.",
      "أقدر أوريك اختيارات قريبة وأرخص شوية لو تحب.",
    ],
    BUYING_INTENT: [
      "تمام يا باشا، ابعت الاسم ورقم الموبايل والعنوان والمقاس ونكمل.",
      "حاضر يا باشا، كمللي البيانات وأنا أجهز الطلب.",
      "تمام يا باشا، ابعت البيانات وأنا أظبطهولك.",
    ],
    HUMAN_HANDOFF: [
      "تمام يا باشا، هخلي حد من الفريق يكلمك حالًا.",
      "حاضر يا باشا، واحد من الشباب هيتابع معاك.",
      "تمام يا باشا، هطلعها لزميلي يكمل معاك.",
    ],
    DISCOVERY: [
      "قولّي على اللي في بالك وأنا أظبطهولك.",
      "ابعت الاسم أو الصورة وأنا أقولك المتاح.",
      "لو عندك موديل معين، ابعته وأنا أراجعهولك.",
    ],
  };

  const selected = templates[stage] || templates.PRODUCT_PRESENTATION;
  const variations = selected.map((variant, index) => ({
    id: `${stage.toLowerCase()}_${index + 1}`,
    text: sanitizeForbiddenPhrases(variant),
  }));

  if (looksLikeMeaningfulReply(base) && !variations.some((item) => normalizeArabic(item.text) === normalizeArabic(base))) {
    variations.unshift({
      id: "base",
      text: base,
    });
  }

  return variations.slice(0, 3);
};

export function applyHumanSalesPersonalityLayer({
  response = {},
  message = "",
  intent = "",
  memory = {},
  source = "",
  conversationId = "",
  channel = "",
} = {}) {
  const baseText = text(response.answer || response.text || "");
  const activeContext = resolveActiveProductContext({
    current: memory,
    message,
    metadata: response?.debug || {},
    suggestedProducts: asArray(response?.suggested_products).length ? asArray(response?.suggested_products) : asArray(response?.product_cards),
    preferencesPatch: response?.memory_updates || response?.ai_memory_patch?.preferences || {},
  });
  const productName = inferProductName(response, memory);
  const price = inferPrice(response, baseText, memory);
  const size = inferSize(response, message, memory);
  const existingCloser = response?.closer || response?.proactive_closer || {};
  const protectProductReply = shouldProtectProductReply({ response, intent, message, activeContext });
  const reasoning = buildSalesReplyReasoning({
    response,
    message,
    intent,
    memory,
    activeContext,
    productName,
    price,
    size,
    source,
    conversationId,
    channel,
  });
  const stageAwareness = reasoning.stage_awareness || inferConversationStage({ response, message, intent, memory });
  const templateStage = reasoning.template_stage || mapSalesStageToTemplateStage(stageAwareness.stage, "PRODUCT_PRESENTATION");
  const closerMeta = stageAwareness.is_buying_intent
    ? inferBuyingIntentCloser({ response, memory, message, productName, size })
    : null;
  const reasonedReply = buildReasoningReplyEngine({
    response,
    message,
    reasoning,
    stageAwareness,
    closerMeta,
    activeContext,
    productName,
    price,
    size,
    memory,
  });
  const buildReasonedVariations = reasoning.reply_variations?.length
    ? reasoning.reply_variations
    : reasonedReply.reply_variations.length
      ? reasonedReply.reply_variations
      : buildReplyVariations({
          stage: templateStage,
          baseText,
          productName,
          price,
          size,
          response,
          message,
          memory,
          activeContext,
        });
  const picked = deterministicPick(buildReasonedVariations, [conversationId, message, productName, price || "", templateStage, reasoning.reply_goal || ""].join("|"));
  let selectedText = sanitizeForbiddenPhrases(text(reasonedReply.text || picked?.text || closerMeta?.closer_text || buildReasonedVariations[0]?.text || baseText));
  if (
    looksLikeMeaningfulReply(baseText) &&
    hasSpecificProductDetail(baseText) &&
    (!hasSpecificProductDetail(selectedText) || text(selectedText).length + 12 < text(baseText).length)
  ) {
    selectedText = sanitizeForbiddenPhrases(baseText);
  }
  if (protectProductReply && (!text(selectedText) || isGenericOverrideText(selectedText))) {
    selectedText = buildProtectedProductReplyText({ response, productName, baseText });
    console.info("[AI_PERSONALITY_PRODUCT_REPLY_PRESERVED]", {
      channel,
      conversation_id: conversationId,
      intent: text(intent?.type || intent || response?.detected_intent || response?.intent?.type || response?.intent || ""),
      product_cards_count: asArray(response?.product_cards).length || asArray(response?.channel_reply?.product_cards).length,
      images_count: asArray(response?.images).length || asArray(response?.image_cards).length || asArray(response?.visual_attachments).length,
      reason: "protected_product_payload",
    });
  }
  const buyingIntentAwareness = {
    detected: stageAwareness.is_buying_intent,
    stage: templateStage,
    signals: stageAwareness.signals,
    confidence: reasoning.confidence || (stageAwareness.is_buying_intent ? 0.92 : stageAwareness.is_objection ? 0.78 : stageAwareness.is_follow_up ? 0.7 : 0.58),
    next_move: stageAwareness.is_buying_intent
      ? "collect_order_details"
      : stageAwareness.is_objection
        ? "handle_objection"
        : stageAwareness.is_handoff
          ? "handoff"
          : stageAwareness.is_greeting
            ? "greeting"
            : "continue_sales_flow",
  };

  const personalityLayer = {
    version: "v1",
    applied: true,
    source,
    channel,
    conversation_id: conversationId,
    stage: stageAwareness.stage,
    product_name: productName,
    price,
    active_product_id: activeContext.active_product_id || "",
    active_variant_id: activeContext.active_variant_id || "",
    active_color: activeContext.active_color || "",
    active_size: size || activeContext.active_size || "",
    active_model_family: activeContext.active_model_family || "",
  };
  const closer = closerMeta?.closer
    ? {
        ...existingCloser,
        ...closerMeta.closer,
      }
    : existingCloser;

  const finalText = selectedText || sanitizeForbiddenPhrases(baseText);
  const exposedVariations = reasonedReply.reply_variations?.length
    ? reasonedReply.reply_variations
    : stageAwareness.is_buying_intent && closerMeta?.reply_variations?.length
      ? closerMeta.reply_variations
      : buildReasonedVariations;

  const generatedReasoningText = text(reasonedReply.text || "");
  const fallbackReplyUsed =
    !generatedReasoningText ||
    text(finalText) === text(baseText) ||
    text(finalText).length <= 3 ||
    /^(?:أيوه|ايوه|موجود|متاح|available)/i.test(normalizeArabic(finalText));
  if (fallbackReplyUsed && !protectProductReply) {
    console.log("[REASONING_FAILURE_ROOT_CAUSE]", {
      stage: "applyHumanSalesPersonalityLayer",
      intent: text(intent?.type || intent || response?.detected_intent || response?.intent?.type || response?.intent || ""),
      active_product_id: activeContext.active_product_id || "",
      active_variant_id: activeContext.active_variant_id || "",
      generated_reasoning_text: generatedReasoningText,
      generated_product_cards_count: asArray(response?.suggested_products).length || asArray(response?.product_cards).length,
      generated_image_cards_count: asArray(response?.image_cards || response?.visual_attachments).length,
      failure_reason: !generatedReasoningText
        ? "personality_reasoning_text_empty"
        : text(finalText) === text(baseText)
          ? "personality_used_base_text"
          : "personality_degraded_to_stub",
      fallback_reply_used: true,
      message: text(message),
    });
  }

  return {
    text: finalText,
    reply_variations: exposedVariations,
    reasoning_reply_engine: reasonedReply,
    conversation_stage_awareness: stageAwareness,
    buying_intent_awareness: buyingIntentAwareness,
    personality_layer: personalityLayer,
    closer,
    missing_order_fields: closerMeta?.missing_order_fields || asArray(response?.missing_order_fields || response?.closer?.missing_order_fields).map((item) => text(item)).filter(Boolean),
    next_best_question: closerMeta?.next_best_question || text(response?.next_best_question || response?.closer?.next_best_question || ""),
    ready_to_confirm_order: closerMeta?.ready_to_confirm_order ?? Boolean(response?.ready_to_confirm_order ?? response?.closer?.ready_to_confirm_order ?? false),
    reasoning,
    customer_meaning: reasoning.customer_meaning,
    detected_entities: reasoning.detected_entities,
    sales_stage: reasoning.sales_stage,
    reply_goal: reasoning.reply_goal,
    next_best_action: reasoning.next_best_action,
    confidence: reasoning.confidence,
    why_this_reply: reasoning.why_this_reply,
  };
}

export default {
  applyHumanSalesPersonalityLayer,
};
