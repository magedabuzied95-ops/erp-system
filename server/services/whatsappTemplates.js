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

import { resolvePublicAppUrl } from "../utils/whatsapp.js";
import { getGoogleReviewUrl } from "../utils/publicUrl.js";

const text = (value, fallback = "") => String(value ?? fallback).trim();

/*
 * Buttons. A template button is frozen at approval, so a link that changes per message must be
 * ONE fixed prefix plus ONE variable at its very end — Meta accepts nothing else. Every link we
 * send (/pay, /invoice, /track, /review, /shop/product, /cart) lives on the store site, so a
 * single shape covers them all: "<site>/{{1}}", filled with whatever follows the site.
 *
 *   { type: "URL", text, value }        → that site link, value names the full url in the values bag
 *   { type: "URL", text, url }          → a fixed link (url may be a function, read at submission)
 *   { type: "COPY_CODE", value, example, text } → copies the value; Meta prints its own label,
 *                                         `text` is only what the inbox transcript shows
 *   { type: "QUICK_REPLY", text, value? } → a reply; value names a payload set per send
 */
const siteBase = () => text(resolvePublicAppUrl()).replace(/\/+$/, "");
export const templateSiteUrl = () => `${siteBase()}/{{1}}`;
export const siteUrlSuffix = (url = "") => {
  const base = siteBase();
  const value = text(url);
  return base && value.startsWith(`${base}/`) ? value.slice(base.length + 1) : "";
};
const googleReviewUrl = () => text(getGoogleReviewUrl());
const STORE_FOOTER = "M1 Store";

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
/*
 * The product carousel, for campaigns and every carousel the queue sends outside the 24h window
 * (abandoned cart, …). Meta freezes the NUMBER of cards at approval, so there is one template per
 * count, 2 to 10 (one card is not a carousel to Meta). Every card is the same shape — Meta refuses
 * a carousel whose cards differ: the product photo, its name and price, and two buttons. The
 * reply button carries choose_color:<variant_id> as its payload, so a tap starts the same
 * colour → size → order flow the session carousel starts; the link opens the product.
 */
export const PRODUCT_CAROUSEL_MIN_CARDS = 2;
export const PRODUCT_CAROUSEL_MAX_CARDS = 10;
export const productCarouselTemplateKey = (cards = 0) => `product_carousel_${Number(cards)}`;
const PRODUCT_CAROUSEL_CARD = Object.freeze({
  variables: ["product_name", "price"],
  samples: ["Nike Air Force 1 — أبيض", "1,250"],
  body: `👟 {{1}}
💰 السعر: {{2}} جنيه`,
  buttons: [
    { type: "QUICK_REPLY", text: "اطلب ده ✅", value: "payload", fallback: "product" },
    { type: "URL", text: "شوف المنتج 🛒", value: "product_url", fallbackSuffix: "shop", sample: "https://m1store-egy.com/shop/product/nike-air-force-1" },
  ],
});
function productCarouselDefinitions() {
  const definitions = {};
  for (let cards = PRODUCT_CAROUSEL_MIN_CARDS; cards <= PRODUCT_CAROUSEL_MAX_CARDS; cards += 1) {
    definitions[productCarouselTemplateKey(cards)] = {
      name: productCarouselTemplateKey(cards),
      category: TEMPLATE_CATEGORIES.MARKETING,
      variables: ["customer_name", "intro_text"],
      samples: ["مي", "منتجاتك المفضلة لسه موجودة في السلة"],
      fallbacks: { customer_name: "عميلنا", intro_text: "جهزنالك اختيارات حلوة" },
      body: `أهلاً يا {{1}} 👋

{{2}}

اختار اللي يعجبك 👇`,
      buttons: [],
      carousel: { cards, card: PRODUCT_CAROUSEL_CARD },
    };
  }
  return definitions;
}

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
    footer: STORE_FOOTER,
    // The Evolution receipt's button, as a fixed link.
    buttons: [{ type: "URL", text: "⭐ قيّمنا على جوجل", url: googleReviewUrl }],
  },

  /*
   * The shipping-fee card. Evolution draws "copy the number" + "upload the transfer"; a session
   * message on Cloud can carry neither a copy button nor two links, so this template is the ONLY
   * way the official number shows the same card — which is why it is preferred even inside the
   * 24h window (preferTemplate) once Meta approves it.
   */
  shipping_fee_payment_card: {
    name: "shipping_fee_payment",
    category: TEMPLATE_CATEGORIES.UTILITY,
    preferTemplate: true,
    header: { format: "TEXT", text: "💳 دفع رسوم الطلب" },
    variables: ["order_number", "advance_amount", "remaining_amount", "wallet_number"],
    samples: ["INV-1084", "75", "925 جنيه", "01012345678"],
    fallbacks: { remaining_amount: "مفيش" },
    body: `💳 لتأكيد الأوردر {{1}} حوّل {{2}} جنيه

✨ المبلغ بيتخصم من إجمالي الأوردر، والباقي عند الاستلام: {{3}}

📱 رقم التحويل: {{4}} (فودافون كاش أو انستا باي)

📸 بعد التحويل اضغط «ارفع صورة التحويل» 👇`,
    footer: STORE_FOOTER,
    buttons: [
      { type: "COPY_CODE", text: "انسخ الرقم", value: "wallet_number", example: "01012345678" },
      { type: "URL", text: "ارفع صورة التحويل", value: "upload_url", sample: "https://m1store-egy.com/pay/AB12CD34" },
    ],
  },

  payment_proof_received: {
    name: "payment_proof_received",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["advance_label", "order_number"],
    samples: ["رسوم الشحن", "INV-1084"],
    fallbacks: { advance_label: "رسوم الشحن" },
    body: `🧾 استلمنا صورة تحويل {{1}} لطلبك رقم {{2}}

⏳ طلبك دلوقتي في مراجعة الدفع، وهنأكدلك أول ما نراجعها.

شكراً لاختيارك M1 Store ❤️`,
    buttons: [],
  },

  payment_proof_approved: {
    name: "payment_approved",
    category: TEMPLATE_CATEGORIES.UTILITY,
    // Two link buttons (invoice + tracking): a Cloud session message carries one at most.
    preferTemplate: true,
    variables: ["payment_label", "order_number", "shipping_line", "collect_line"],
    samples: ["رسوم الشحن", "INV-1084", "طلبك بيتجهز للشحن دلوقتي", "المندوب هيحصّل 925 جنيه عند الاستلام"],
    fallbacks: { payment_label: "رسوم الشحن", shipping_line: "طلبك بيتجهز للشحن دلوقتي", collect_line: "هنبلغك بأي تحديث على طلبك" },
    body: `✅ وصلنا دفع {{1}} للطلب {{2}}

🚚 {{3}}
💰 {{4}}

تقدر تشوف فاتورتك وتتابع طلبك من الأزرار تحت 👇`,
    footer: STORE_FOOTER,
    buttons: [
      { type: "URL", text: "🧾 فاتورتك", value: "invoice_url", fallbackSuffix: "track", sample: "https://m1store-egy.com/invoice/INV-1084" },
      { type: "URL", text: "📍 تابع طلبك", value: "tracking_url", fallbackSuffix: "track", sample: "https://m1store-egy.com/track?order=INV-1084" },
    ],
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

المبلغ المطلوب: {{2}}

نتمنى تكون متاح لاستلام الطلب النهاردة.`,
    /*
     * A prepaid parcel renders cod_amount empty on purpose, and our own renderer drops the whole
     * line. A template cannot drop anything, so the fallback has to READ correctly rather than
     * print a dash where a sum belongs.
     */
    fallbacks: { cod_amount: "لا يوجد مبلغ للتحصيل" },
    buttons: [],
  },

  delivered: {
    name: "order_delivered",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["order_number", "customer_name"],
    samples: ["INV-1084", "مي"],
    body: `✅ تم تسليم طلبك رقم {{1}} بنجاح يا {{2}}

شكراً لاختيارك M1 Store ❤️`,
    footer: STORE_FOOTER,
    buttons: [{ type: "URL", text: "⭐ قيّمنا على جوجل", url: googleReviewUrl }],
  },

  delivery_failed: {
    name: "delivery_failed",
    category: TEMPLATE_CATEGORIES.UTILITY,
    variables: ["order_number", "failure_reason"],
    samples: ["INV-1084", "العميل مكانش موجود في العنوان"],
    fallbacks: { failure_reason: "محدش رد على المندوب" },
    body: `المندوب مقدرش يسلّم طلبك النهارده

رقم الطلب: {{1}}
السبب: {{2}}

رد علينا هنا بميعاد مناسب أو بالعنوان أو الرقم الصح، وهنبلّغ بوسطة تحاول تاني.`,
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
    // The abandoned-cart row is keyed by phone and carries no name at all.
    fallbacks: { customer_name: "عميلنا" },
    body: `🛒 يا {{1}}، سلتك في M1 Store لسه مستنياك

لسه فيها {{2}}، وتقدر تكمل طلبك من هنا: {{3}}

لو محتاج أي مساعدة إحنا موجودين 💙`,
    footer: STORE_FOOTER,
    buttons: [{ type: "URL", text: "أكمل الطلب 🛒", value: "cart_url", fallbackSuffix: "cart", sample: "https://m1store-egy.com/cart" }],
  },

  // Evolution sends this as a one-card carousel; the template is the same card: photo, name,
  // old → new price and a link to the product.
  price_drop_alert: {
    name: "price_drop_alert",
    category: TEMPLATE_CATEGORIES.MARKETING,
    header: { format: "IMAGE", value: "product_image_url" },
    variables: ["customer_name", "product_name", "old_price", "new_price"],
    samples: ["مي", "Nike Air Force 1 — أبيض", "1,450", "1,250"],
    fallbacks: { customer_name: "عميلنا" },
    body: `خبر حلو يا {{1}} 🎉
المنتج اللي بتتابعه سعره نزل.

👟 {{2}}
بدل {{3}} بقى {{4}} جنيه`,
    footer: STORE_FOOTER,
    buttons: [{ type: "URL", text: "اشتري دلوقتي 🛒", value: "product_url", sample: "https://m1store-egy.com/shop/product/nike-air-force-1" }],
  },

  product_review_request: {
    name: "product_review_request",
    category: TEMPLATE_CATEGORIES.MARKETING,
    header: { format: "TEXT", text: "رأيك يهمنا ⭐" },
    variables: ["customer_name", "product_name"],
    samples: ["مي", "Nike Air Force 1"],
    fallbacks: { customer_name: "عميلنا", product_name: "طلبك" },
    body: `أهلاً يا {{1}} 👋
إن شاء الله يكون {{2}} عجبك.
قولنا رأيك في دقيقة — تقييمك بيساعد غيرك يختار صح.`,
    footer: STORE_FOOTER,
    buttons: [{ type: "URL", text: "⭐ قيّم مشترياتك", value: "review_url", sample: "https://m1store-egy.com/review/AB12CD34" }],
  },

  ...productCarouselDefinitions(),
});

/*
 * The queue already carries a `values` bag for message-variant placeholders, and its vocabulary
 * is almost the template vocabulary — shipmentTemplateValues even uses the same six names. These
 * aliases cover the rest rather than making every enqueue site pass a second, near-identical bag.
 */
export const TEMPLATE_VALUE_ALIASES = Object.freeze({
  cod_amount: ["cod_amount", "total", "total_amount"],
  review_url: ["review_url", "google_review_url"],
  invoice_url: ["invoice_url", "public_invoice_url"],
  cart_url: ["cart_url", "checkout_url"],
  items_summary: ["items_summary", "items"],
  customer_name: ["customer_name", "name"],
  order_number: ["order_number", "invoice_number"],
});

/*
 * What actually fills a template on send.
 *
 * Explicit values win: order_confirmation builds its own six, because summarising products onto
 * one line and assembling an address are things only the order knows how to do. Everything else
 * falls back to the queue's bag through the aliases above, then to the definition's own wording
 * for a missing value, then to a dash.
 */
export const resolveTemplateValues = (automationType = "", { values = {}, templateValues = null } = {}) => {
  const definition = templateDefinition(automationType);
  if (!definition) throw new Error(`WHATSAPP_TEMPLATE_UNKNOWN:${text(automationType)}`);
  const explicit = templateValues && typeof templateValues === "object" ? templateValues : {};
  const bag = values && typeof values === "object" ? values : {};
  const resolved = {};
  for (const name of definition.variables) {
    if (text(explicit[name])) {
      resolved[name] = explicit[name];
      continue;
    }
    const candidates = TEMPLATE_VALUE_ALIASES[name] || [name];
    const found = candidates.map((key) => bag[key]).find((value) => text(value));
    resolved[name] = text(found) || text(definition.fallbacks?.[name]) || EMPTY_VALUE_FALLBACK;
  }
  // Header media, button links / codes and carousel cards are not body variables: they travel
  // as they are (no dash fallback — an empty link is decided by the button's own fallback).
  const extras = [definition.header?.value, ...(definition.buttons || []).map((button) => button.value)].filter(Boolean);
  for (const name of extras) {
    const candidates = TEMPLATE_VALUE_ALIASES[name] || [name];
    resolved[name] = text(explicit[name]) || text(candidates.map((key) => bag[key]).find((value) => text(value)));
  }
  if (definition.carousel) resolved.cards = Array.isArray(explicit.cards) ? explicit.cards : (Array.isArray(bag.cards) ? bag.cards : []);
  return resolved;
};

/*
 * The owner's own wording. The definitions above are the defaults; the template editor (inbox →
 * WhatsApp → Templates → automation templates) saves a rewrite per automation, and every reader —
 * the send, the submission to Meta, the transcript — goes through templateDefinition(), so the
 * rewrite is the template everywhere at once. Only the WORDING moves: the variables, their order,
 * the button types and the category are the code's, because the send fills them by position and
 * the inbound webhook reads the taps by payload. validateTemplateEdit() is what guarantees that.
 * The overrides are loaded from the database (server/modules/whatsappOfficial/templateOverrides.js).
 */
let TEMPLATE_OVERRIDES = new Map();
let mergedCache = new Map();
export const setTemplateOverrides = (entries = []) => {
  TEMPLATE_OVERRIDES = new Map((Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.edit && WHATSAPP_TEMPLATE_DEFINITIONS[text(entry.automation_type)])
    .map((entry) => [text(entry.automation_type), entry.edit]));
  mergedCache = new Map();
};
export const templateOverride = (automationType = "") => TEMPLATE_OVERRIDES.get(text(automationType)) || null;

// A COPY_CODE button's label is printed by Meta itself, so it is the one label nobody can edit.
export const editableButton = (button = {}) => button.type !== "COPY_CODE";

const withButtonTexts = (buttons = [], texts = null) => (Array.isArray(texts)
  ? buttons.map((button, index) => (editableButton(button) && text(texts[index]) ? { ...button, text: text(texts[index]) } : button))
  : buttons);

const mergeOverride = (base, edit) => {
  const merged = { ...base, edited: true };
  if (base.header?.format === "TEXT" && text(edit.header_text)) merged.header = { ...base.header, text: text(edit.header_text) };
  if (text(edit.body)) merged.body = String(edit.body).trim();
  if (edit.footer !== undefined && edit.footer !== null) {
    if (text(edit.footer)) merged.footer = text(edit.footer);
    else delete merged.footer;
  }
  merged.buttons = withButtonTexts(base.buttons || [], edit.button_texts);
  if (base.carousel) {
    merged.carousel = {
      ...base.carousel,
      card: {
        ...base.carousel.card,
        body: text(edit.card_body) ? String(edit.card_body).trim() : base.carousel.card.body,
        buttons: withButtonTexts(base.carousel.card.buttons, edit.card_button_texts),
      },
    };
  }
  return merged;
};

// The code's own wording, whatever the owner saved — what "restore the original" goes back to.
export const baseTemplateDefinition = (automationType = "") =>
  WHATSAPP_TEMPLATE_DEFINITIONS[text(automationType)] || null;

export const templateDefinition = (automationType = "") => {
  const key = text(automationType);
  const base = WHATSAPP_TEMPLATE_DEFINITIONS[key];
  if (!base) return null;
  const edit = TEMPLATE_OVERRIDES.get(key);
  if (!edit) return base;
  if (!mergedCache.has(key)) mergedCache.set(key, mergeOverride(base, edit));
  return mergedCache.get(key);
};

/*
 * Meta's limits on each part, and the one rule of ours: a rewrite keeps exactly the variables the
 * default has. {{3}} is "the amount to collect" because the send puts the amount third; a body
 * that loses it prints nothing where the amount belongs, and one that adds {{7}} fails every send.
 * The variables may move inside the text and appear in any order — only the set is fixed.
 */
export const TEMPLATE_EDIT_LIMITS = Object.freeze({ header: 60, body: 1024, footer: 60, button: 25, card_body: 160 });
const variableSet = (value = "") => [...new Set([...String(value).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
const sameVariables = (value = "", reference = "") => variableSet(value).join(",") === variableSet(reference).join(",");
const hasVariable = (value = "") => /\{\{/.test(String(value));

export const validateTemplateEdit = (automationType = "", edit = {}) => {
  const base = baseTemplateDefinition(automationType);
  if (!base) return { problems: [{ field: "automation_type", code: "unknown" }], edit: null };
  const problems = [];
  const input = edit && typeof edit === "object" ? edit : {};
  const normalized = {};

  // Meta reads a {{ 1 }} as a literal; the spaced spelling is normalised before anything checks it.
  const body = String(input.body ?? base.body).replace(/\{\{\s*(\d+)\s*\}\}/g, "{{$1}}").trim();
  if (!body) problems.push({ field: "body", code: "required" });
  else if (body.length > TEMPLATE_EDIT_LIMITS.body) problems.push({ field: "body", code: "too_long", max: TEMPLATE_EDIT_LIMITS.body });
  else if (!sameVariables(body, base.body)) problems.push({ field: "body", code: "variables", expected: variableSet(base.body) });
  else if (validateTemplateBody(body).length) problems.push({ field: "body", code: "variable_position" });
  normalized.body = body;

  if (base.header?.format === "TEXT") {
    const header = text(input.header_text ?? base.header.text);
    if (!header) problems.push({ field: "header_text", code: "required" });
    else if (header.length > TEMPLATE_EDIT_LIMITS.header) problems.push({ field: "header_text", code: "too_long", max: TEMPLATE_EDIT_LIMITS.header });
    else if (hasVariable(header)) problems.push({ field: "header_text", code: "no_variables" });
    normalized.header_text = header;
  }

  const footer = text(input.footer ?? base.footer ?? "");
  if (footer.length > TEMPLATE_EDIT_LIMITS.footer) problems.push({ field: "footer", code: "too_long", max: TEMPLATE_EDIT_LIMITS.footer });
  else if (hasVariable(footer)) problems.push({ field: "footer", code: "no_variables" });
  normalized.footer = footer;

  const buttonTexts = (buttons = [], given = [], field = "button_texts") => buttons.map((button, index) => {
    if (!editableButton(button)) return text(button.text);
    const value = text(Array.isArray(given) ? (given[index] ?? button.text) : button.text);
    if (!value) problems.push({ field, index, code: "required" });
    else if (value.length > TEMPLATE_EDIT_LIMITS.button) problems.push({ field, index, code: "too_long", max: TEMPLATE_EDIT_LIMITS.button });
    else if (hasVariable(value)) problems.push({ field, index, code: "no_variables" });
    return value;
  });
  normalized.button_texts = buttonTexts(base.buttons || [], input.button_texts);
  const labels = normalized.button_texts.filter((value, index) => editableButton(base.buttons[index])).map((value) => value.toLowerCase());
  if (new Set(labels).size !== labels.length) problems.push({ field: "button_texts", code: "duplicate" });

  if (base.carousel) {
    const card = base.carousel.card;
    const cardBody = String(input.card_body ?? card.body).replace(/\{\{\s*(\d+)\s*\}\}/g, "{{$1}}").trim();
    if (!cardBody) problems.push({ field: "card_body", code: "required" });
    else if (cardBody.length > TEMPLATE_EDIT_LIMITS.card_body) problems.push({ field: "card_body", code: "too_long", max: TEMPLATE_EDIT_LIMITS.card_body });
    else if (!sameVariables(cardBody, card.body)) problems.push({ field: "card_body", code: "variables", expected: variableSet(card.body) });
    else if (validateTemplateBody(cardBody).length) problems.push({ field: "card_body", code: "variable_position" });
    normalized.card_body = cardBody;
    normalized.card_button_texts = buttonTexts(card.buttons, input.card_button_texts, "card_button_texts");
  }
  return { problems, edit: problems.length ? null : normalized };
};

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
const bodyParameters = (variables = [], values = {}, fallbacks = {}) => variables.map((name) => {
  const value = templateValue(values?.[name]) === EMPTY_VALUE_FALLBACK
    ? (text(fallbacks?.[name]) || EMPTY_VALUE_FALLBACK)
    : templateValue(values?.[name]);
  const problems = validateTemplateValue(value);
  if (problems.length) throw new Error(`WHATSAPP_TEMPLATE_VALUE_INVALID:${name}:${problems[0]}`);
  return { type: "text", text: value };
});

// Only buttons whose content changes per send take a parameter; a fixed link or a plain quick
// reply is part of the approved template and is sent as nothing. `index` is the button's place.
const buttonParameters = (buttons = [], values = {}) => buttons.map((button, index) => {
  const value = text(button.value ? values?.[button.value] : "");
  if (button.type === "URL" && button.value) {
    const suffix = siteUrlSuffix(value) || text(button.fallbackSuffix);
    if (!suffix) throw new Error(`WHATSAPP_TEMPLATE_VALUE_INVALID:${button.value}:not a link on the store site`);
    return { type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: suffix }] };
  }
  if (button.type === "COPY_CODE") {
    // Meta caps a copied code at 15 characters; a wallet number is 11.
    if (!value || value === EMPTY_VALUE_FALLBACK) throw new Error(`WHATSAPP_TEMPLATE_VALUE_INVALID:${button.value}:nothing to copy`);
    return { type: "button", sub_type: "copy_code", index: String(index), parameters: [{ type: "coupon_code", coupon_code: value.slice(0, 15) }] };
  }
  if (button.type === "QUICK_REPLY" && button.value) {
    const payload = value || text(button.fallback);
    return payload ? { type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] } : null;
  }
  return null;
}).filter(Boolean);

const imageParameter = (link = "", where = "header") => {
  const url = text(link);
  if (!/^https:\/\//i.test(url)) throw new Error(`WHATSAPP_TEMPLATE_VALUE_INVALID:${where}:needs a public https image`);
  return { type: "image", image: { link: url } };
};

/*
 * The body stays the FIRST component: the inbox transcript reads the body values off index 0.
 */
export const buildTemplateComponents = (automationType = "", values = {}) => {
  const definition = templateDefinition(automationType);
  if (!definition) throw new Error(`WHATSAPP_TEMPLATE_UNKNOWN:${text(automationType)}`);
  const components = [];
  const parameters = bodyParameters(definition.variables, values, definition.fallbacks);
  if (parameters.length) components.push({ type: "body", parameters });
  if (definition.header?.format === "IMAGE") {
    components.push({ type: "header", parameters: [imageParameter(values?.[definition.header.value])] });
  }
  components.push(...buttonParameters(definition.buttons || [], values));
  if (definition.carousel) {
    const { cards: count, card } = definition.carousel;
    const cards = (Array.isArray(values?.cards) ? values.cards : []).slice(0, count);
    if (cards.length !== count) throw new Error(`WHATSAPP_TEMPLATE_VALUE_INVALID:cards:${definition.name} needs exactly ${count} cards`);
    components.push({
      type: "carousel",
      cards: cards.map((item, cardIndex) => ({
        card_index: cardIndex,
        components: [
          { type: "header", parameters: [imageParameter(item?.image_url, `card ${cardIndex + 1} image`)] },
          { type: "body", parameters: bodyParameters(card.variables, item, {}) },
          ...buttonParameters(card.buttons, item),
        ],
      })),
    });
  }
  return components;
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
const submissionButton = (button) => {
  if (button.type === "URL") {
    if (button.value) {
      return { type: "URL", text: button.text, url: templateSiteUrl(), example: [text(button.sample) || `${siteBase()}/shop`] };
    }
    return { type: "URL", text: button.text, url: text(typeof button.url === "function" ? button.url() : button.url) };
  }
  if (button.type === "COPY_CODE") return { type: "COPY_CODE", example: text(button.example) };
  return { type: "QUICK_REPLY", text: button.text };
};

const buttonsComponent = (buttons = []) =>
  buttons.length ? [{ type: "BUTTONS", buttons: buttons.map(submissionButton) }] : [];

const bodyComponent = (body = "", samples = []) => ({
  type: "BODY",
  text: body,
  ...(samples?.length ? { example: { body_text: [samples] } } : {}),
});

const imageHeader = (headerHandle = "") => {
  if (!text(headerHandle)) throw new Error("WHATSAPP_TEMPLATE_HEADER_HANDLE_REQUIRED");
  return { type: "HEADER", format: "IMAGE", example: { header_handle: [text(headerHandle)] } };
};

/*
 * `headerHandle` is a sample image uploaded to Meta (resumable upload) — required by every
 * template with an image header, and by every carousel card.
 */
export const templateNeedsImageSample = (automationType = "") => {
  const definition = templateDefinition(automationType);
  return Boolean(definition && (definition.header?.format === "IMAGE" || definition.carousel));
};

export const templateSubmissionPayload = (automationType = "", { headerHandle = "" } = {}) => {
  const definition = templateDefinition(automationType);
  if (!definition) throw new Error(`WHATSAPP_TEMPLATE_UNKNOWN:${text(automationType)}`);
  const components = [];
  if (definition.header?.format === "TEXT") components.push({ type: "HEADER", format: "TEXT", text: definition.header.text });
  if (definition.header?.format === "IMAGE") components.push(imageHeader(headerHandle));
  components.push(bodyComponent(definition.body, definition.samples));
  if (definition.footer) components.push({ type: "FOOTER", text: definition.footer });
  components.push(...buttonsComponent(definition.buttons || []));
  if (definition.carousel) {
    const { cards, card } = definition.carousel;
    const cardComponents = [imageHeader(headerHandle), bodyComponent(card.body, card.samples), ...buttonsComponent(card.buttons)];
    components.push({ type: "CAROUSEL", cards: Array.from({ length: cards }, () => ({ components: cardComponents })) });
  }
  return {
    name: definition.name,
    language: TEMPLATE_LANGUAGE,
    category: definition.category,
    components,
  };
};

export const allTemplateSubmissionPayloads = ({ headerHandle = "" } = {}) =>
  Object.keys(WHATSAPP_TEMPLATE_DEFINITIONS).map((automationType) => ({
    automation_type: automationType,
    ...templateSubmissionPayload(automationType, { headerHandle }),
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
  TEMPLATE_VALUE_ALIASES,
  resolveTemplateValues,
  templateDefinition,
  baseTemplateDefinition,
  setTemplateOverrides,
  validateTemplateEdit,
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
