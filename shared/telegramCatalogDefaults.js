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
  // The pinned menu of hashtags. Telegram's in-channel search shows a match
  // inside the chat rather than as a list, so a shopper who does not know the
  // tags exist has no way to narrow 600 posts down.
  index_title: "🔎 دوّر على اللي يعجبك",
  index_hint: "دوس على أي هاشتاج تحت عشان تشوف كل اللي فيه، أو اكتب اسم الموديل في بحث القناة.",
  index_group_titles: {
    product_type: "النوع",
    grade: "الخامة",
    brand: "الماركة",
    gender: "الفئة",
  },
});

// Telegram rejects a caption over 1024 characters outright (and a rejected
// sendPhoto leaves the colour with no post at all), so the renderer clamps.
export const TELEGRAM_CAPTION_MAX = 1024;
// A plain message, not a caption, so it gets the larger limit.
export const TELEGRAM_MESSAGE_MAX = 4096;

// Rendered bold. The price is the one line a shopper scans for, and it is the
// only markup in a post -- the template itself stays plain text the owner can
// edit without knowing any markup exists.
export const TELEGRAM_BOLD_PLACEHOLDERS = Object.freeze(["price"]);

const text = (value = "") => String(value ?? "").trim();

// A hashtag is one token: Telegram ends the tag at the first space, so a label
// like "ميرور اوريجينال" must be joined up or only the first word becomes the tag.
const TAG_SEPARATORS = /[#\s]+/g;

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

// A hashtag is the ONLY filter Telegram gives a shopper inside a channel:
// tapping one shows every post in the channel carrying it. So the tags are the
// catalogue's filters -- audience, product type, grade (mirror / local /
// imported) and brand. A label with a space ('ميرور اوريجينال') has to become
// one token or Telegram reads only the first word as the tag.
export const telegramTagToken = (value = "") =>
  text(value).replace(TAG_SEPARATORS, "_").replace(/^_+|_+$/g, "");

export const telegramCatalogTags = (facts = {}) => {
  // Order matters: the broadest filter first, the narrowest last.
  const raw = [facts.audience_tag, facts.product_type_tag, facts.grade_tag, facts.brand_tag];
  return raw
    .map((value) => telegramTagToken(value))
    .filter(Boolean)
    .map((value) => `#${value}`)
    .join(" ");
};

// Telegram's HTML parse mode. Only these three characters change meaning, and
// a product name really does contain them ("Black & White"), so EVERY value and
// the owner's own template text are escaped. The only markup in the result is
// what this file puts there, which is why the owner can type anything into the
// caption template without being able to break the API call.
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
export const escapeTelegramHtml = (value = "") => text(value).replace(/[&<>]/g, (char) => HTML_ESCAPES[char]);

// Cutting a caption at the limit can land in the middle of "<b>" or leave the
// bold open, and Telegram refuses the whole post for malformed HTML -- so the
// colour would end up with no post at all rather than a shortened one.
const clampTelegramCaption = (value = "", { html = false } = {}) => {
  if (value.length <= TELEGRAM_CAPTION_MAX) return value;
  let cut = value.slice(0, TELEGRAM_CAPTION_MAX - 1).trimEnd();
  if (html) {
    cut = cut.replace(/<[^>]*$/, "");
    const opened = (cut.match(/<b>/g) || []).length;
    const closed = (cut.match(/<\/b>/g) || []).length;
    if (opened > closed) cut += "</b>";
  }
  return `${cut}…`;
};

export const renderTelegramCaption = (
  template = TELEGRAM_CATALOG_DEFAULTS.caption_template,
  facts = {},
  { html = false, bold = [] } = {}
) => {
  const safeTemplate = text(template) || TELEGRAM_CATALOG_DEFAULTS.caption_template;
  const prepared = html ? escapeTelegramHtml(safeTemplate) : safeTemplate;
  const emphasised = Array.isArray(bold) ? bold : [];
  const rendered = prepared.replace(/\{(\w+)\}/g, (match, key) => {
    if (!TELEGRAM_CAPTION_PLACEHOLDERS.includes(key)) return match;
    const value = html ? escapeTelegramHtml(facts[key]) : text(facts[key]);
    if (!value) return "";
    return html && emphasised.includes(key) ? `<b>${value}</b>` : value;
  });
  // A blank placeholder (nothing sold out, no tags) must not leave a run of
  // empty lines behind: at most one blank line separates two blocks.
  const collapsed = rendered
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clampTelegramCaption(collapsed, { html });
};

export default {
  TELEGRAM_CATALOG_AUDIENCES,
  TELEGRAM_CATALOG_DEFAULTS,
  TELEGRAM_CAPTION_PLACEHOLDERS,
  TELEGRAM_CAPTION_MAX,
  escapeTelegramHtml,
  formatTelegramPrice,
  renderTelegramCaption,
  sortTelegramSizes,
  telegramCatalogTags,
  telegramTagToken,
};
