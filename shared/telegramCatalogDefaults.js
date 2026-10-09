// Telegram catalog channels: the shape of a channel post.
//
// One post per product colour -- the same unit the storefront card, the AI Inbox
// product card and the Meta catalogue all use (item_group_id = product + colour).
// A post is created once and then only ever EDITED: the caption carries the
// available sizes, so a sale changes the caption of the post that is already
// there instead of pushing a new one. That is why the caption is rendered from a
// template in one place -- the publisher hashes the rendered text to decide
// whether an edit is owed at all.

export const TELEGRAM_CATALOG_AUDIENCES = Object.freeze(["men", "women", "kids"]);

// Caption placeholders the owner may use in the template. Anything else is left
// untouched rather than blanked, so a stray brace in a product name survives.
export const TELEGRAM_CAPTION_PLACEHOLDERS = Object.freeze([
  "name",
  "color",
  "price",
  "old_price",
  "sizes",
  "status",
  "tags",
  "code",
]);

export const TELEGRAM_CATALOG_DEFAULTS = Object.freeze({
  caption_template: "{name}\n\n💰 {price}\n📏 المقاسات المتاحة: {sizes}\n{status}\n{tags}",
  sold_out_label: "⚠️ خلص مؤقتًا — ابعتلنا وهنبلّغك أول ما يرجع",
  order_button_label: "🛒 اطلب الآن",
  site_button_label: "🔗 شوفه على الموقع",
  currency_label: "ج.م",
});

// Telegram rejects a caption over 1024 characters outright (and a rejected
// sendPhoto leaves the colour with no post at all), so the renderer clamps.
export const TELEGRAM_CAPTION_MAX = 1024;

const text = (value = "") => String(value ?? "").trim();

const isNumericSize = (value = "") => /^\d+(\.\d+)?$/.test(text(value));

// Sizes arrive in whatever order the variants came back in. A shopper reads
// "40 41 42", never "42 40 41", and the order has to be STABLE or the caption
// hash changes on every sweep and every post gets edited for nothing.
export const sortTelegramSizes = (sizes = []) => {
  const unique = [...new Set((Array.isArray(sizes) ? sizes : []).map((size) => text(size)).filter(Boolean))];
  const numeric = unique.filter(isNumericSize).sort((a, b) => Number(a) - Number(b));
  const lettered = unique.filter((size) => !isNumericSize(size)).sort((a, b) => a.localeCompare(b, "en"));
  return [...numeric, ...lettered];
};

export const formatTelegramPrice = (value, currencyLabel = TELEGRAM_CATALOG_DEFAULTS.currency_label) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const rounded = Math.round(amount * 100) / 100;
  const whole = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  const [intPart, fraction] = whole.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${fraction ? `${grouped}.${fraction}` : grouped} ${text(currencyLabel)}`.trim();
};

// A channel hashtag is the only search Telegram gives a shopper inside a
// channel, so the audience and the product type are worth spending two lines on.
export const telegramCatalogTags = (facts = {}) => {
  const raw = [facts.audience_tag, facts.product_type_tag, facts.brand_tag];
  return raw
    .map((value) => text(value).replace(/[#\s]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .map((value) => `#${value}`)
    .join(" ");
};

export const renderTelegramCaption = (template = TELEGRAM_CATALOG_DEFAULTS.caption_template, facts = {}) => {
  const safeTemplate = text(template) || TELEGRAM_CATALOG_DEFAULTS.caption_template;
  const rendered = safeTemplate.replace(/\{(\w+)\}/g, (match, key) =>
    TELEGRAM_CAPTION_PLACEHOLDERS.includes(key) ? text(facts[key]) : match
  );
  // A blank placeholder (nothing sold out, no tags) must not leave a run of
  // empty lines behind: at most one blank line separates two blocks.
  const collapsed = rendered
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return collapsed.length > TELEGRAM_CAPTION_MAX
    ? `${collapsed.slice(0, TELEGRAM_CAPTION_MAX - 1).trimEnd()}…`
    : collapsed;
};

export default {
  TELEGRAM_CATALOG_AUDIENCES,
  TELEGRAM_CATALOG_DEFAULTS,
  TELEGRAM_CAPTION_PLACEHOLDERS,
  TELEGRAM_CAPTION_MAX,
  formatTelegramPrice,
  renderTelegramCaption,
  sortTelegramSizes,
  telegramCatalogTags,
};
