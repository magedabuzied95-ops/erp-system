/*
 * The message-template registry for the WhatsApp Business Platform (Cloud API).
 *
 * Why this file has to exist at all: on Evolution we send any text, to anyone, at any time. On
 * Cloud API a message sent more than 24 hours after the customer's last inbound MUST be one of
 * these — a body Meta approved in advance, filled through positional variables. Every proactive
 * automation we run is outside that window by nature (a receipt fires after a sale, a shipping
 * update days later), so every one of them needs an entry here before it can leave at all.
 *
 * Four rules Meta enforces that our own renderer never did. They are the reason these bodies are
 * not simply the current messages copied across:
 *
 *  1. A variable may not contain a line break. The order confirmation lists products one per
 *     line today; that list cannot be a variable, so it is summarised onto one line and the
 *     detail stays in the invoice link.
 *  2. A variable may not open or close the body, and two may not touch. Every {{n}} below has
 *     static text on both sides.
 *  3. A variable may not be empty. renderShipmentTemplate drops a whole line when its value is
 *     missing (so "رقم التتبع:" never ships bare); a template cannot drop anything, so every
 *     value here falls back to EMPTY_VALUE_FALLBACK instead of "".
 *  4. The category is Meta's decision, not ours, and each is priced differently. Anything not
 *     strictly about a transaction the customer already made is MARKETING — which also means it
 *     obeys the marketing opt-out and per-user frequency caps WhatsApp applies itself.
 *
 * Submitting these is a separate and slow step: templateSubmissionPayload() renders what goes to
 * Meta, and nothing can be sent through a template until Meta approved that exact body.
 */

const text = (value, fallback = "") => String(value ?? fallback).trim();

/* A template variable that is empty is rejected on send, so a missing value becomes this. */
export const EMPTY_VALUE_FALLBACK = "—";

export const TEMPLATE_CATEGORIES = Object.freeze({
  UTILITY: "UTILITY",
  MARKETING: "MARKETING",
});

export const TEMPLATE_LANGUAGE = "ar";

/*
 * Collapse anything a variable is about to carry. A newline inside a parameter is rejected by the
 * Graph API outright, and an address assembled from free-text fields is exactly where one arrives.
 */
export const oneLine = (value = "") => text(value).replace(/\s*\r?\n\s*/g, " ، ").replace(/\s{2,}/g, " ");

export const templateValue = (value = "") => oneLine(value) || EMPTY_VALUE_FALLBACK;

/*
 * One line, never more. Used wherever the current message prints a multi-line list: the products
 * on an order confirmation, which Meta will not accept inside a variable.
 */
export const summariseItems = (items = []) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return EMPTY_VALUE_FALLBACK;
  if (list.length === 1) {
    const item = list[0];
    const name = text(item?.product_name || item?.name || item?.title) || "منتج";
    const variant = [text(item?.color), text(item?.size)].filter(Boolean).join(" · ") || text(item?.variant_name);
    const quantity = Math.max(1, Number(item?.quantity || item?.qty || 1) || 1);
    return oneLine(`${name}${variant ? ` — ${variant}` : ""}${quantity > 1 ? ` ×${quantity}` : ""}`);
  }
  const units = list.reduce((sum, item) => sum + Math.max(1, Number(item?.quantity || item?.qty || 1) || 1), 0);
  return `${list.length} منتجات (${units} قطعة)`;
};

/*
 * The definitions themselves.
 *
 * `body` is the exact text submitted to Meta, {{n}} included. `variables` names each position in
 * order, so the builder and the submission payload can never drift: the sample Meta needs for
 * review is generated from the same list.
 */
export const WHATSAPP_TEMPLATE_DEFINITIONS = Object.freeze({
  order_confirmation: {
    name: "order_confirmation_cod",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["customer_name", "order_number", "cod_amount", "items_summary", "address", "invoice_url"],
    samples: ["مي", "INV-1084", "990", "حذاء رياضي — أسود · 42", "قنا - فرشوط - بجوار معهد فتيات فرشوط", "https://m1store-egy.com/i/INV-1084"],
    body: `أهلاً يا {{1}} 👋

⏳ تم تسجيل طلبك من M1 Store، وحالياً بانتظار تأكيدك.

🔢 رقم الطلب: {{2}}
💰 مبلغ التحصيل: {{3}} جنيه
🛍️ الطلب: {{4}}
📍 عنوان التوصيل: {{5}}

🧾 فاتورتك: {{6}}

برجاء اختيار الإجراء المناسب من الأزرار بالأسفل ⬇️`,
    /*
     * The three actions become REAL quick-reply buttons. A tap arrives as a webhook carrying the
     * payload, which is strictly better than today's secure /c/ link: nothing to expire, nothing
     * to copy, and no way to open the wrong order. The link machinery stays for the Evolution
     * number, which has no buttons of this kind.
     */
    buttons: [
      { type: "QUICK_REPLY", text: "✅ تأكيد الطلب", payload: "order_confirm" },
      { type: "QUICK_REPLY", text: "✏️ تعديل الطلب", payload: "order_edit" },
      { type: "QUICK_REPLY", text: "❌ إلغاء الطلب", payload: "order_cancel" },
    ],
  },

  payment_review: {
    name: "payment_under_review",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["order_number"],
    samples: ["INV-1084"],
    body: `📩 استلمنا إثبات تحويل طلبك رقم {{1}}

فريقنا بيراجعه دلوقتي، وهنأكدلك خلال وقت قصير.

شكراً لصبرك 🙏`,
    buttons: [],
  },

  invoice_receipt: {
    name: "invoice_receipt",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["customer_name", "order_number", "invoice_url"],
    samples: ["مي", "INV-1090", "https://m1store-egy.com/i/INV-1090"],
    body: `🙏 شكراً لثقتك بينا يا {{1}}

🧾 فاتورة طلبك رقم {{2}}: {{3}}

لو احتجت أي مساعدة أو استفسار، إحنا في خدمتك دايمًا 💙`,
    buttons: [],
  },

  shipment_created: {
    name: "shipment_created",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["order_number", "provider", "tracking_number"],
    samples: ["INV-1084", "بوسطة", "3216549870"],
    body: `📦 تم إنشاء شحنة طلبك رقم {{1}}

شركة الشحن: {{2}}
رقم التتبع: {{3}}

هنبعتلك تحديثات الشحنة أول بأول.`,
    buttons: [],
  },

  shipped: {
    name: "order_shipped",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["order_number", "provider", "tracking_number", "tracking_url"],
    samples: ["INV-1084", "بوسطة", "3216549870", "https://bosta.co/tracking/3216549870"],
    body: `🚚 تم شحن طلبك رقم {{1}}

شركة الشحن: {{2}}
رقم التتبع: {{3}}
تابع شحنتك من هنا: {{4}}

يوصلك في أقرب وقت إن شاء الله 🌟`,
    buttons: [],
  },

  out_for_delivery: {
    name: "out_for_delivery",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["order_number", "cod_amount"],
    samples: ["INV-1084", "990"],
    body: `🛵 المندوب خرج لتسليم طلبك رقم {{1}}

المبلغ المطلوب: {{2}} جنيه

نتمنى تكون متاح لاستلام الطلب النهاردة.`,
    buttons: [],
  },

  delivered: {
    name: "order_delivered",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["order_number", "customer_name"],
    samples: ["INV-1084", "مي"],
    body: `✅ تم تسليم طلبك رقم {{1}} بنجاح يا {{2}}

شكراً لاختيارك M1 Store ❤️`,
    buttons: [],
  },

  /*
   * Everything below is MARKETING: it is not about a transaction the customer is in the middle of.
   * That means a higher price per message, the marketing opt-out honoured by WhatsApp itself, and
   * per-user frequency capping applied by Meta regardless of what our own queue decides.
   */
  google_review_request: {
    name: "review_request",
    category: TEMPLATE_CATEGORIES.MARKETING,
    variables: ["customer_name", "review_url"],
    samples: ["مي", "https://g.page/r/m1store/review"],
    body: `😍 يا {{1}}، إيه رأيك في طلبك من M1 Store؟

تقييمك بيفرق معانا جداً، وبيساعد ناس تانية تختار صح.

قيّمنا من هنا: {{2}}

شكراً ليك ❤️`,
    buttons: [],
  },

  thank_you: {
    name: "thank_you",
    category: TEMPLATE_CATEGORIES.MARKETING,
    variables: ["customer_name"],
    samples: ["مي"],
    body: `❤️ شكراً ليك يا {{1}} على ثقتك في M1 Store

سعداء جداً بخدمتك، ومستنينك دايمًا.`,
    buttons: [],
  },

  abandoned_cart: {
    name: "abandoned_cart",
    category: TEMPLATE_CATEGORIES.MARKETING,
    variables: ["customer_name", "items_summary", "cart_url"],
    samples: ["مي", "حذاء رياضي — أسود · 42", "https://m1store-egy.com/cart"],
    body: `🛒 يا {{1}}، سلتك في M1 Store لسه مستنياك

لسه فيها {{2}}، وتقدر تكمل طلبك من هنا: {{3}}

لو محتاج أي مساعدة إحنا موجودين 💙`,
    buttons: [],
  },
});

export const templateDefinition = (automationType = "") =>
  WHATSAPP_TEMPLATE_DEFINITIONS[text(automationType)] || null;

export const hasTemplate = (automationType = "") => Boolean(templateDefinition(automationType));

/*
 * The rules from the file header, enforced here rather than discovered at send time. A body that
 * breaks one is rejected by Meta at submission — annoying but visible. A VALUE that breaks one is
 * rejected on every send, which is worse: it fails per customer, in production, long after the
 * template was approved and nobody is looking at it any more.
 */
export const validateTemplateBody = (body = "") => {
  const problems = [];
  const source = String(body ?? "");
  const positions = [...source.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  if (!positions.length) return problems;
  const unique = [...new Set(positions)].sort((a, b) => a - b);
  if (unique[0] !== 1 || unique[unique.length - 1] !== unique.length) {
    problems.push("variables must be numbered 1..n with no gaps");
  }
  if (/^\s*\{\{\d+\}\}/.test(source)) problems.push("a variable may not open the body");
  if (/\{\{\d+\}\}\s*$/.test(source)) problems.push("a variable may not close the body");
  if (/\{\{\d+\}\}[ \t]*\{\{\d+\}\}/.test(source)) problems.push("two variables may not touch");
  return problems;
};

export const validateTemplateValue = (value = "") => {
  const problems = [];
  const raw = String(value ?? "");
  if (!raw.trim()) problems.push("a template variable may not be empty");
  if (/[\r\n\t]/.test(raw)) problems.push("a template variable may not contain a line break or tab");
  if (/ {5,}/.test(raw)) problems.push("a template variable may not contain 5 or more consecutive spaces");
  return problems;
};

/*
 * Build the Graph API `components` for one send. Values arrive named — the same vocabulary the
 * shipment templates already use — and are placed by the definition's own variable order, so a
 * caller can never put the tracking number where the courier name goes.
 */
export const buildTemplateComponents = (automationType = "", values = {}) => {
  const definition = templateDefinition(automationType);
  if (!definition) throw new Error(`WHATSAPP_TEMPLATE_UNKNOWN:${text(automationType)}`);
  const parameters = definition.variables.map((name) => {
    const value = templateValue(values?.[name]);
    const problems = validateTemplateValue(value);
    if (problems.length) throw new Error(`WHATSAPP_TEMPLATE_VALUE_INVALID:${name}:${problems[0]}`);
    return { type: "text", text: value };
  });
  return parameters.length ? [{ type: "body", parameters }] : [];
};

export const buildTemplateMessage = ({ automationType = "", phone = "", values = {} } = {}) => {
  const definition = templateDefinition(automationType);
  if (!definition) throw new Error(`WHATSAPP_TEMPLATE_UNKNOWN:${text(automationType)}`);
  const components = buildTemplateComponents(automationType, values);
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: text(phone),
    type: "template",
    template: {
      name: definition.name,
      language: { code: TEMPLATE_LANGUAGE },
      ...(components.length ? { components } : {}),
    },
  };
};

/*
 * What gets submitted to Meta for approval, one automation at a time. Kept next to the body it
 * describes so a wording change and its resubmission are the same edit — an approved template is
 * frozen, and editing the text here without resubmitting means sending a body Meta never saw.
 */
export const templateSubmissionPayload = (automationType = "") => {
  const definition = templateDefinition(automationType);
  if (!definition) throw new Error(`WHATSAPP_TEMPLATE_UNKNOWN:${text(automationType)}`);
  const bodyComponent = {
    type: "BODY",
    text: definition.body,
    ...(definition.samples?.length ? { example: { body_text: [definition.samples] } } : {}),
  };
  const buttonsComponent = definition.buttons?.length
    ? [{
      type: "BUTTONS",
      buttons: definition.buttons.map((button) => ({ type: button.type, text: button.text })),
    }]
    : [];
  return {
    name: definition.name,
    language: TEMPLATE_LANGUAGE,
    category: definition.category,
    components: [bodyComponent, ...buttonsComponent],
  };
};

export const allTemplateSubmissionPayloads = () =>
  Object.keys(WHATSAPP_TEMPLATE_DEFINITIONS).map((automationType) => ({
    automation_type: automationType,
    ...templateSubmissionPayload(automationType),
  }));

/*
 * The quick-reply payloads a customer's tap comes back with, mapped to the actions the order
 * confirmation flow already understands. Keeping the mapping here means the webhook never has to
 * know how the buttons were worded.
 */
export const TEMPLATE_BUTTON_ACTIONS = Object.freeze({
  order_confirm: "confirm",
  order_edit: "edit",
  order_cancel: "cancel",
});

export const templateButtonAction = (payload = "") => TEMPLATE_BUTTON_ACTIONS[text(payload)] || "";

export default {
  WHATSAPP_TEMPLATE_DEFINITIONS,
  templateDefinition,
  hasTemplate,
  buildTemplateComponents,
  buildTemplateMessage,
  templateSubmissionPayload,
  allTemplateSubmissionPayloads,
  templateButtonAction,
  summariseItems,
  oneLine,
  templateValue,
  validateTemplateBody,
  validateTemplateValue,
};
