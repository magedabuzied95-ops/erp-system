import {
  getConversationMemory,
  updateConversationMemory,
} from "./aiConversationMemory.js";

const cleanLines = (reply = "") =>
  String(reply || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");

const appendProductLink = (reply = "", productContext = null) => {
  const productUrl = String(productContext?.productUrl || "").trim();
  if (!productUrl || String(reply || "").includes(productUrl)) return reply;
  const lines = cleanLines(reply).split("\n").filter(Boolean);
  const lastLine = lines.at(-1) || "";
  const linkLines = ["شوفه من هنا:", productUrl];
  if (/[?؟]$|طں$/.test(lastLine) && lines.length > 1) {
    return cleanLines([...lines.slice(0, -1), ...linkLines, lastLine].join("\n"));
  }
  return cleanLines([...lines, ...linkLines].join("\n"));
};

const toText = (value = "") => String(value ?? "").trim();

const firstName = (value = "") =>
  toText(value)
    .split(/\s+/)
    .filter(Boolean)[0] || "";

const titlePool = ["يا فندم", "يا باشا", "يا كابتن"];

const pickAddress = ({ customerName = "", conversationId = "" } = {}) => {
  const name = firstName(customerName);
  if (name && !/unknown|anonymous|customer|guest/i.test(name)) return `يا ${name}`;
  const seed = [...String(conversationId || Date.now())].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return titlePool[seed % titlePool.length];
};

const applyTemplate = (template = "", context = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => toText(context[key]));

const weightedEntries = (items = []) =>
  items.flatMap((item) => Array.from({ length: Math.max(1, Number(item.weight) || 1) }, () => item));

const pickWeightedTemplate = ({ category = "", previousTemplate = "" } = {}) => {
  const templates = RESPONSE_TEMPLATES[category] || [];
  const candidates = templates.filter((item) => item.id !== previousTemplate);
  const pool = weightedEntries(candidates.length ? candidates : templates);
  return pool[Math.floor(Math.random() * pool.length)] || null;
};

const availableAlternativesLine = (sizes = []) =>
  sizes.length ? `المتاح بدل منه: ${sizes.slice(0, 5).join(", ")}.` : "أشوفلك بديل قريب؟";

export const REPLY_CATEGORIES = Object.freeze({
  PRODUCT_AVAILABLE: "PRODUCT_AVAILABLE",
  SIZE_AVAILABLE: "SIZE_AVAILABLE",
  SIZE_UNAVAILABLE: "SIZE_UNAVAILABLE",
  ASK_FOR_ORDER: "ASK_FOR_ORDER",
  GREETING: "GREETING",
});

const RESPONSE_TEMPLATES = Object.freeze({
  PRODUCT_AVAILABLE: [
    { id: "product_available_yes_basha", weight: 5, text: "أيوه موجود معايا {{address}} ✅" },
    { id: "product_available_now", weight: 4, text: "متوفر حاليًا {{address}}" },
    { id: "product_available_sizes", weight: 3, text: "أيوه موجود وفيه مقاسات كمان." },
    { id: "product_available_fandem", weight: 3, text: "موجود {{address}}" },
    { id: "product_available_ready", weight: 2, text: "موجود وجاهز {{address}}." },
  ],
  SIZE_AVAILABLE: [
    { id: "size_available_yes", weight: 5, text: "أيوه مقاس {{size}} متوفر ✅" },
    { id: "size_available_tamam", weight: 4, text: "تمام، {{size}} موجود." },
    { id: "size_available_now", weight: 3, text: "مقاس {{size}} متاح حاليًا {{address}}" },
    { id: "size_available_this", weight: 3, text: "أيوه المقاس ده موجود." },
    { id: "size_available_ready", weight: 2, text: "{{size}} موجود وجاهز." },
  ],
  SIZE_UNAVAILABLE: [
    { id: "size_unavailable_sold_out", weight: 5, text: "للأسف {{size}} خلص حاليًا." },
    { id: "size_unavailable_now", weight: 4, text: "المقاس ده مش متوفر دلوقتي." },
    { id: "size_unavailable_stock", weight: 3, text: "{{size}} مش ظاهر في المخزون للأسف." },
    { id: "size_unavailable_alternatives", weight: 3, text: "{{alternatives}}" },
    { id: "size_unavailable_check_other", weight: 2, text: "للأسف {{size}} مش موجود. ممكن أطلعلك أقرب مقاس؟" },
  ],
  ASK_FOR_ORDER: [
    { id: "ask_order_reserve", weight: 5, text: "تحب أحجزهولك؟" },
    { id: "ask_order_prepare", weight: 4, text: "أجهزهولك؟" },
    { id: "ask_order_start", weight: 3, text: "أبدأ أسجل الطلب؟" },
    { id: "ask_order_continue", weight: 3, text: "تحب أكمل معاك الطلب؟" },
  ],
  GREETING: [
    { id: "greeting_salam", weight: 5, text: "وعليكم السلام {{address}}" },
    { id: "greeting_welcome", weight: 4, text: "أهلاً بيك {{address}}." },
    { id: "greeting_nawart", weight: 3, text: "نورتنا {{address}}" },
    { id: "greeting_service", weight: 3, text: "تحت أمرك {{address}}." },
  ],
});

const categoryForReply = ({ intent = "", productContext = null, detectedSize = "", sizes = [], hasSizes = false } = {}) => {
  const normalizedIntent = toText(intent).toUpperCase();
  if (normalizedIntent === "GREETING" || normalizedIntent === "GREETING_ONLY" || normalizedIntent === "GREETING_ONLY_MODE") {
    return REPLY_CATEGORIES.GREETING;
  }

  if (normalizedIntent === "ASK_FOR_ORDER" || normalizedIntent === "ORDER_CONFIRMATION" || normalizedIntent === "CLOSE_SALE") {
    return REPLY_CATEGORIES.ASK_FOR_ORDER;
  }

  if (normalizedIntent === "SIZE_INQUIRY" && detectedSize && hasSizes) {
    return sizes.map(String).includes(String(detectedSize))
      ? REPLY_CATEGORIES.SIZE_AVAILABLE
      : REPLY_CATEGORIES.SIZE_UNAVAILABLE;
  }

  if (normalizedIntent === "AVAILABILITY_INQUIRY" && productContext?.name && productContext?.inStock !== false) {
    return REPLY_CATEGORIES.PRODUCT_AVAILABLE;
  }

  return "";
};

export function buildHumanizedReply({
  intent,
  productContext,
  detectedSize,
  conversationId,
  customerName = "",
} = {}) {
  const sizes = Array.isArray(productContext?.sizes)
    ? productContext.sizes.map((size) => String(size).trim()).filter(Boolean)
    : [];
  const hasSizes = sizes.length > 0;
  const memory = conversationId ? getConversationMemory(conversationId) : null;
  const category = categoryForReply({ intent, productContext, detectedSize, sizes, hasSizes });

  if (!category) return "";

  const previousTemplate = memory?.lastReplyTemplate || "";
  const selected = pickWeightedTemplate({ category, previousTemplate });
  if (!selected) return "";

  const address = pickAddress({
    customerName: customerName || memory?.customerName || memory?.knownName || memory?.customer_name || "",
    conversationId,
  });
  const rendered = cleanLines(applyTemplate(selected.text, {
    address,
    size: detectedSize,
    alternatives: availableAlternativesLine(sizes.filter((size) => String(size) !== String(detectedSize))),
  }));

  console.log("[reply-variation] category", category);
  console.log("[reply-variation] template_selected", selected.id);
  console.log("[reply-variation] previous_template", previousTemplate || "");

  if (conversationId && rendered) {
    updateConversationMemory(conversationId, {
      lastReplyTemplate: selected.id,
      lastReplyCategory: category,
    });
  }

  return appendProductLink(rendered, productContext);
}
