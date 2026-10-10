import crypto from "crypto";
import db from "../database/db.js";
import { buildStorefrontColorCardsForAudience } from "../controllers/storefrontController.js";
import { resolvePublicProductImageUrl } from "./aiProductCards.js";
import { storefrontBaseUrl } from "./storefrontProductUrlService.js";
import { fetchProductClassificationOptions } from "./productClassificationsService.js";
import { getSetting } from "./settingsService.js";
import { telegramDeepLinkToken, telegramDeepLinkUrl } from "./telegramBotService.js";
import {
  TELEGRAM_INDEX_CARD_ID,
  ensureTelegramCatalogSchema,
  enqueueTelegramCatalogJob,
  listTelegramCatalogPosts,
  listTelegramChannels,
  loadTelegramCatalogSettings,
  markTelegramChannelSynced,
  telegramCatalogTenantId,
  upsertTelegramCatalogPost,
} from "./telegramCatalogService.js";
import {
  TELEGRAM_BOLD_PLACEHOLDERS,
  TELEGRAM_CATALOG_DEFAULTS,
  TELEGRAM_MESSAGE_MAX,
  escapeTelegramHtml,
  telegramTagToken,
  tidyTelegramText,
  formatTelegramPrice,
  renderTelegramCaption,
  sortTelegramSizes,
  telegramCatalogTags,
} from "../../shared/telegramCatalogDefaults.js";

/*
 * What each Telegram channel SHOULD look like, and what therefore has to change.
 *
 * The desired state is read from the storefront's own listing builder, so a
 * colour that the storefront hides is a colour this never offers. The diff is
 * against telegram_catalog_posts, and it produces at most one queued job per
 * colour:
 *
 *   in the catalogue, no post yet          -> create
 *   in the catalogue, post text changed    -> update
 *   in the catalogue, post text unchanged  -> nothing (this is the whole point)
 *   gone from the catalogue, post is live  -> update, carrying the sold-out line
 *
 * Nothing is ever deleted by a sweep. A sold-out colour keeps its post, its
 * link and its forwards, and the SAME post comes back to life when the colour
 * is restocked -- which is also why the facts the caption was rendered from are
 * stored on the row: once a colour sells out it is no longer in the catalogue
 * to be read.
 */

const text = (value = "") => String(value ?? "").trim();

export const telegramPostFingerprint = ({ caption = "", replyMarkup = null, imageUrl = "" } = {}) =>
  crypto.createHash("sha1").update(JSON.stringify({ caption, replyMarkup, imageUrl })).digest("hex").slice(0, 20);

// Nothing in a card is trusted to still be there: this runs over the slimmed
// listing card, which is a different shape from the full product row.
export const telegramCardFacts = (card = {}, { audience = "" } = {}) => {
  const sizes = sortTelegramSizes(Array.isArray(card.sizes) ? card.sizes : []);
  const price = Number(card.final_price ?? card.selling_price ?? card.price ?? 0);
  const comparePrice = Number(card.compare_at_price ?? card.old_price ?? 0);
  return {
    card_id: text(card.card_id),
    product_id: Number(card.parent_product_id || card.id) || null,
    color_key: text(card.color_key || card.display_color_key),
    name: tidyTelegramText(card.name),
    color: tidyTelegramText(card.display_color || card.color),
    price,
    compare_price: comparePrice > price ? comparePrice : 0,
    sizes,
    slug: text(card.slug),
    audience: text(audience),
    product_type: text(card.product_type || card.productType),
    grade: text(card.grade),
    brand: text(card.brand_name || card.brand),
    code: text(card.article_code || card.code),
  };
};

/*
 * Hashtags are the only filter a Telegram channel gives a shopper. Tapping
 * #ميرور_اوريجينال inside the channel shows every post carrying it, so the tags
 * ARE the catalogue's filters: audience, product type, grade and brand.
 *
 * The Arabic wording comes from the shop's own classification options, not from
 * a map in this file -- the owner renames "ميرور اوريجينال" in the ERP and the
 * channel follows. Renaming one DOES rewrite every caption carrying it, which
 * the caption fingerprint turns into one edit per affected post.
 */
const TAGGED_CLASSIFICATION_GROUPS = Object.freeze(["gender", "product_type", "grade"]);

let classificationLabelCache = { at: 0, labels: null };
const CLASSIFICATION_LABEL_TTL_MS = 5 * 60_000;

export const loadTelegramClassificationLabels = async ({
  fetchOptions = fetchProductClassificationOptions,
  now = Date.now(),
} = {}) => {
  if (classificationLabelCache.labels && now - classificationLabelCache.at < CLASSIFICATION_LABEL_TTL_MS) {
    return classificationLabelCache.labels;
  }
  const labels = {};
  for (const group of TAGGED_CLASSIFICATION_GROUPS) {
    labels[group] = {};
    const options = await fetchOptions(group, { includeInactive: true }).catch(() => []);
    for (const option of Array.isArray(options) ? options : []) {
      const value = text(option?.value).toLowerCase();
      if (!value) continue;
      labels[group][value] = text(option?.label_ar) || text(option?.label_en) || value;
    }
  }
  classificationLabelCache = { at: now, labels };
  return labels;
};

export const __resetTelegramClassificationLabels = () => { classificationLabelCache = { at: 0, labels: null }; };

const classificationLabel = (labels = {}, group = "", value = "") => {
  const key = text(value).toLowerCase();
  if (!key) return "";
  return text(labels?.[group]?.[key]) || text(value);
};

export const telegramProductUrl = (facts = {}, { baseUrl = storefrontBaseUrl() } = {}) => {
  const identifier = text(facts.slug) || text(facts.product_id);
  if (!identifier) return "";
  const params = new URLSearchParams({ utm_source: "telegram", utm_medium: "channel" });
  if (facts.color_key) params.set("color", facts.color_key);
  const path = `/product/${encodeURIComponent(identifier)}?${params.toString()}`;
  return baseUrl ? `${baseUrl}${path}` : path;
};

// A channel post cannot carry a mini-app button -- Telegram allows web_app
// buttons only inside a private chat with the bot -- so "order" is either a
// deep link into the bot or a plain link to the storefront, never a web_app
// here. Getting this wrong is a 400 from Telegram on every single post.
export const telegramPostButtons = ({ facts = {}, settings = {} } = {}) => {
  const productUrl = telegramProductUrl(facts);
  const botUrl = telegramDeepLinkUrl({
    botUsername: settings.bot_username,
    token: telegramDeepLinkToken(facts.card_id),
  });
  const rows = [];
  const orderLabel = TELEGRAM_CATALOG_DEFAULTS.order_button_label;
  const siteLabel = TELEGRAM_CATALOG_DEFAULTS.site_button_label;
  const mode = text(settings.order_mode) || "both";

  if (mode === "bot" && botUrl) rows.push([{ text: orderLabel, url: botUrl }]);
  else if (mode === "mini_app" && productUrl) rows.push([{ text: orderLabel, url: productUrl }]);
  else if (mode === "both") {
    // The bot is the order path; the website is the second opinion. With no bot
    // configured the website button takes the order label rather than leaving
    // the post without a call to action.
    if (botUrl) {
      rows.push([{ text: orderLabel, url: botUrl }]);
      if (productUrl) rows.push([{ text: siteLabel, url: productUrl }]);
    } else if (productUrl) {
      rows.push([{ text: orderLabel, url: productUrl }]);
    }
  } else if (productUrl) {
    rows.push([{ text: orderLabel, url: productUrl }]);
  }
  return rows.length ? { inline_keyboard: rows } : null;
};

// A channel tags what it does NOT already filter on. Every post in the men's
// channel is men's, so #رجالي there is noise on every single one; the brand, the
// type and the grade still earn their place because they vary inside it. The
// rule is stated as the channel's own scope rather than "drop the gender tag",
// so a channel scoped to a brand later drops ITS brand tag for the same reason.
export const telegramPostCaption = ({ facts = {}, settings = {}, soldOut = false, labels = {}, scopedTags = [] } = {}) => {
  const scoped = (group) => (Array.isArray(scopedTags) ? scopedTags : []).includes(group);
  const sizes = sortTelegramSizes(facts.sizes || []);
  return renderTelegramCaption(settings.caption_template || TELEGRAM_CATALOG_DEFAULTS.caption_template, {
    name: facts.name,
    color: facts.color,
    code: facts.code,
    price: formatTelegramPrice(facts.price),
    old_price: facts.compare_price ? formatTelegramPrice(facts.compare_price) : "",
    sizes: soldOut || !sizes.length ? "—" : sizes.join(" · "),
    status: soldOut ? (settings.sold_out_label || TELEGRAM_CATALOG_DEFAULTS.sold_out_label) : "",
    tags: telegramCatalogTags({
      audience_tag: scoped("gender") ? "" : classificationLabel(labels, "gender", facts.audience),
      product_type_tag: scoped("product_type") ? "" : classificationLabel(labels, "product_type", facts.product_type),
      grade_tag: scoped("grade") ? "" : classificationLabel(labels, "grade", facts.grade),
      brand_tag: scoped("brand") ? "" : facts.brand,
    }),
  }, { html: true, bold: TELEGRAM_BOLD_PLACEHOLDERS });
};

// Telegram puts the FIRST post at the top of a channel and drops a visitor at
// the BOTTOM, so the last thing posted is the first thing anyone sees. The
// catalogue is read newest-first, and posting it in that order buries the new
// arrivals at the top and greets every visitor with the oldest stock.
//
// So the backfill runs oldest-first, ordered by the product's own date rather
// than by reversing the listing array -- the listing also pushes offers to the
// end, and reversing would strand every offer at the very top where nobody
// lands. A card with no date sorts to the front; ties keep catalogue order,
// because Array.prototype.sort is stable.
const telegramCardDate = (card = {}) => {
  const parsed = Date.parse(card?.created_at || "");
  return Number.isFinite(parsed) ? parsed : 0;
};


/*
 * A school bag belongs in the kids channel and nowhere else.
 *
 * There is no field that says "school bag" -- the shop's bag-type classification
 * is empty on every one of them. What the catalogue DOES say is the audience,
 * and the split is exact: every bag carrying the kids audience is a backpack
 * (Classic / Momolly / Mile Stone / "size 16"), and every bag that does not is a
 * handbag (hand & crossbody, Chrisbella, David Jones...). Not one handbag is
 * listed for kids, and not one backpack is listed without them.
 *
 * So the rule is the audience, not a name list: a bag that is also for kids is
 * only posted in the kids channel. A school bag added next season is marked for
 * kids like the others and is excluded without anyone being told.
 */
export const isSchoolBagForAdultChannel = (card = {}, channelAudience = "") => {
  if (text(channelAudience).toLowerCase() === "kids") return false;
  if (text(card.product_type || card.productType).toLowerCase() !== "bags") return false;
  const audiences = []
    .concat(Array.isArray(card.audiences) ? card.audiences : [])
    .concat(Array.isArray(card.product_audiences) ? card.product_audiences : [])
    .map((value) => text(value).toLowerCase());
  return audiences.includes("kids");
};

export const orderCardsOldestFirst = (cards = []) =>
  [...(Array.isArray(cards) ? cards : [])].sort((a, b) => telegramCardDate(a) - telegramCardDate(b));


/*
 * The order a channel is filled in.
 *
 * Telegram drops a visitor at the BOTTOM of a channel, so the LAST thing posted
 * is the first thing seen. The order therefore reads backwards from what you
 * want a shopper to meet: whatever should greet them goes last.
 *
 * The shop's order for the men's channel is offers, then crocs, then slippers,
 * then local, then imported, then mirror -- which puts the offers (broken size
 * runs, end of line) at the very top where nobody lands, and the mirror line at
 * the bottom where everybody does.
 *
 * A group is "offer", "type:<product type>" or "grade:<grade>". A card joins the
 * FIRST group it matches, so a slipper that is also on offer is an offer. Cards
 * matching no group are posted with the offers, at the top: an unclassified
 * product should not be the first thing a shopper sees. Within a group the order
 * is oldest-first, which keeps a model's colours together.
 */
const cardMatchesGroup = (card = {}, group = "") => {
  const rule = text(group).toLowerCase();
  if (!rule) return false;
  if (rule === "offer") {
    return card.is_offer_story === true ||
      text(card.is_offer_story).toLowerCase() === "true" ||
      card.sale_mode_applied === true ||
      card.sale_price_enabled === true;
  }
  const [kind, ...rest] = rule.split(":");
  const value = rest.join(":").trim();
  if (!value) return false;
  if (kind === "type") return text(card.product_type || card.productType).toLowerCase() === value;
  if (kind === "grade") return text(card.grade).toLowerCase() === value;
  if (kind === "brand") return text(card.brand_name || card.brand).toLowerCase() === value;
  return false;
};

export const parseTelegramPostOrder = (value = "") =>
  text(value)
    .split(",")
    .map((group) => text(group))
    .filter(Boolean);

export const orderCardsForBackfill = (cards = [], groups = []) => {
  const list = Array.isArray(cards) ? cards : [];
  const order = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (!order.length) return orderCardsOldestFirst(list);
  const buckets = order.map(() => []);
  const leftovers = [];
  for (const card of list) {
    const index = order.findIndex((group) => cardMatchesGroup(card, group));
    if (index < 0) leftovers.push(card);
    else buckets[index].push(card);
  }
  return [...orderCardsOldestFirst(leftovers), ...buckets.flatMap((bucket) => orderCardsOldestFirst(bucket))];
};

export const telegramCardImageUrl = (card = {}) =>
  resolvePublicProductImageUrl(
    card.image_url || card.product_image_url || (Array.isArray(card.gallery_images) ? card.gallery_images[0] : "")
  );

// The whole post, ready for the worker: it carries everything needed to send or
// edit without reading the catalogue again, because by the time the queue drains
// the catalogue may have moved on.
export const buildTelegramPostPayload = ({ facts = {}, settings = {}, imageUrl = "", soldOut = false, labels = {}, scopedTags = [] } = {}) => {
  const caption = telegramPostCaption({ facts, settings, soldOut, labels, scopedTags });
  const replyMarkup = telegramPostButtons({ facts, settings });
  return {
    caption,
    reply_markup: replyMarkup,
    image_url: text(imageUrl),
    sold_out: soldOut === true,
    facts,
    fingerprint: telegramPostFingerprint({ caption, replyMarkup, imageUrl }),
  };
};


/*
 * The pinned index: the menu of hashtags a shopper filters the channel by.
 *
 * Telegram's in-channel search shows a match INSIDE the chat with its
 * neighbours around it, not as a list, so someone who types "Nike" sees Nike
 * posts next to posts that are not Nike and concludes the filter is broken.
 * The index is the fix a channel can actually have: one pinned message, always
 * at the top, listing every tag that exists in THIS channel.
 *
 * Built from the channel's own cards, so a tag is only ever offered when
 * tapping it would find something. The dimension the channel is already scoped
 * to is left out for the same reason it is left off the posts.
 */
const INDEX_BRAND_LIMIT = 14;

const countBy = (cards, pick) => {
  const counts = new Map();
  for (const card of cards) {
    const value = text(pick(card));
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
};

export const buildTelegramChannelIndex = ({ cards = [], labels = {}, scopedTags = [] } = {}) => {
  const scoped = (group) => (Array.isArray(scopedTags) ? scopedTags : []).includes(group);
  const titles = TELEGRAM_CATALOG_DEFAULTS.index_group_titles;
  const lines = [`<b>${escapeTelegramHtml(TELEGRAM_CATALOG_DEFAULTS.index_title)}</b>`, ""];

  const section = (title, entries) => {
    const tags = entries.map(([value]) => `#${escapeTelegramHtml(telegramTagToken(value))}`);
    if (!tags.length) return;
    lines.push(`<b>${escapeTelegramHtml(title)}</b>  ${tags.join("  ")}`);
  };

  if (!scoped("product_type")) {
    section(titles.product_type, countBy(cards, (c) => classificationLabel(labels, "product_type", c.product_type || c.productType)));
  }
  if (!scoped("grade")) {
    section(titles.grade, countBy(cards, (c) => classificationLabel(labels, "grade", c.grade)));
  }
  if (!scoped("brand")) {
    section(titles.brand, countBy(cards, (c) => c.brand_name || c.brand).slice(0, INDEX_BRAND_LIMIT));
  }
  if (!scoped("gender")) {
    section(titles.gender, countBy(cards, (c) => classificationLabel(labels, "gender", c.gender)));
  }

  // Only the heading and a hint would be left: a menu with nothing on it is
  // worse than no menu, so the channel keeps whatever it already has.
  if (lines.length <= 2) return "";

  lines.push("", escapeTelegramHtml(TELEGRAM_CATALOG_DEFAULTS.index_filter_hint));
  lines.push(escapeTelegramHtml(TELEGRAM_CATALOG_DEFAULTS.index_hint));
  const body = lines.join("\n");
  return body.length > TELEGRAM_MESSAGE_MAX ? body.slice(0, TELEGRAM_MESSAGE_MAX - 1) : body;
};


/*
 * Combining filters is the one thing a channel cannot do. Tapping #Adidas shows
 * every Adidas post and there is no way to then narrow it to mirror sneakers:
 * Telegram's hashtag search takes one tag, and its text search is not a boolean
 * AND. A composite tag per combination (#Adidas_ميرور_Sneakers) would be
 * hundreds of tags and an unreadable caption.
 *
 * The catalogue page already stacks these filters, so the pinned menu carries a
 * button into it, scoped to the channel. One filter: tap a hashtag. More than
 * one: the button.
 */

// The text under the channel name: what this channel is, how to order, where
// the shop lives. Plain text -- Telegram does not parse a description -- and
// clamped to the 255 characters it accepts.
// The shop's public name, as the storefront and the invoices already say it.
const shopDisplayName = async () => {
  const [storeName, companyName] = await Promise.all([
    getSetting("storefront.store_name", "").catch(() => ""),
    getSetting("general.company_name", "").catch(() => ""),
  ]);
  return text(storeName) || text(companyName);
};

export const buildTelegramChannelDescription = ({ channel = {}, shopName = "", baseUrl = storefrontBaseUrl() } = {}) => {
  const audiences = TELEGRAM_CATALOG_DEFAULTS.description_audiences;
  const audience = audiences[text(channel.audience).toLowerCase()] || audiences[""];
  const shop = tidyTelegramText(shopName) || tidyTelegramText(channel.title) || "متجرنا";
  const body = TELEGRAM_CATALOG_DEFAULTS.description_template
    .replace("{audience}", audience)
    .replace("{shop}", shop)
    .replace("{site}", text(baseUrl).replace(/^https?:\/\//i, ""));
  return tidyTelegramText(body).slice(0, 255);
};

export const telegramIndexKeyboard = ({ audience = "", siblings = [], baseUrl = storefrontBaseUrl() } = {}) => {
  if (!baseUrl) return null;
  const params = new URLSearchParams({ utm_source: "telegram", utm_medium: "channel_index" });
  if (text(audience)) params.set("gender", text(audience));
  const url = `${baseUrl}/products?${params.toString()}`;
  if (!/^https:\/\//i.test(url)) return null;
  const rows = [[{ text: TELEGRAM_CATALOG_DEFAULTS.index_filter_button, url }]];

  // The shop's other channels. Only ones a shopper can actually open: a channel
  // with no public link would be a button that goes nowhere.
  const labels = TELEGRAM_CATALOG_DEFAULTS.sibling_buttons;
  const siblingRow = (Array.isArray(siblings) ? siblings : [])
    .filter((channel) => text(channel?.audience) !== text(audience))
    .filter((channel) => /^https:\/\/t\.me\//i.test(text(channel?.invite_url)))
    .map((channel) => ({
      text: labels[text(channel.audience).toLowerCase()] || tidyTelegramText(channel.title) || text(channel.channel_key),
      url: text(channel.invite_url),
    }));
  if (siblingRow.length) rows.push(siblingRow);
  return { inline_keyboard: rows };
};

export const telegramIndexFingerprint = (body = "", replyMarkup = null) =>
  crypto.createHash("sha1").update(JSON.stringify({ body: text(body), replyMarkup })).digest("hex").slice(0, 20);


/*
 * What a change is worth telling a subscriber about.
 *
 * A post is edited in place when its sizes move, which keeps it accurate and
 * keeps its link, its views and its forwards -- but nobody is notified. So the
 * CHANGE is recorded as an event, and the announcement is a separate message:
 * the shop gets the notification without reposting the model and without
 * killing the link people already have.
 *
 * Note a brand new COLOUR needs none of this. It is a new card, so it is a new
 * post at the bottom of the channel with a notification of its own; it is
 * recorded only so the daily digest can name it.
 */
export const classifyTelegramChange = ({ row = null, facts = {}, soldOut = false } = {}) => {
  if (soldOut) return "";
  const sizes = Array.isArray(facts.sizes) ? facts.sizes : [];
  if (!row || !row.message_id) return "new";
  const previous = Array.isArray(row.facts?.sizes) ? row.facts.sizes : [];
  // Gone and back: the only change strong enough to interrupt a subscriber.
  if (row.state === "sold_out" && sizes.length) return "restocked";
  const before = new Set(previous.map((size) => text(size)));
  const gained = sizes.filter((size) => !before.has(text(size)));
  return gained.length ? "sizes_added" : "";
};

const eventLine = ({ event = {}, channel = {} }) => {
  const facts = event.facts && typeof event.facts === "object" ? event.facts : {};
  const name = escapeTelegramHtml(facts.name || "");
  if (!name) return "";
  const sizes = sortTelegramSizes(facts.sizes || []);
  const tail = sizes.length ? ` — ${escapeTelegramHtml(sizes.join(" · "))}` : "";
  const link = telegramPostLink({ channel, messageId: event.message_id });
  return link ? `• <a href="${link}">${name}</a>${tail}` : `• ${name}${tail}`;
};

// A public channel's post has a t.me/<username>/<id> address; a private one's
// does not, so the digest simply names the model instead of linking it.
export const telegramPostLink = ({ channel = {}, messageId = null } = {}) => {
  const id = text(messageId);
  if (!id) return "";
  const match = /t\.me\/([A-Za-z0-9_]+)\/?$/.exec(text(channel.invite_url));
  const username = match ? match[1] : "";
  return username ? `https://t.me/${username}/${id}` : "";
};

export const buildTelegramDigest = ({ events = [], channel = {} } = {}) => {
  const groups = { new: [], restocked: [], sizes_added: [] };
  for (const event of Array.isArray(events) ? events : []) {
    if (groups[event?.kind]) groups[event.kind].push(event);
  }
  const titles = TELEGRAM_CATALOG_DEFAULTS.digest_sections;
  const lines = [];
  for (const kind of ["new", "restocked", "sizes_added"]) {
    const rendered = groups[kind].map((event) => eventLine({ event, channel })).filter(Boolean);
    if (!rendered.length) continue;
    lines.push(`<b>${escapeTelegramHtml(titles[kind])}</b>`, ...rendered, "");
  }
  // Nothing happened today: a digest that says nothing is a notification the
  // shop spent for no reason.
  if (!lines.length) return "";
  const body = [`<b>${escapeTelegramHtml(TELEGRAM_CATALOG_DEFAULTS.digest_title)}</b>`, "", ...lines].join("\n").trim();
  return body.length > TELEGRAM_MESSAGE_MAX ? `${body.slice(0, TELEGRAM_MESSAGE_MAX - 2)}…` : body;
};

export const buildTelegramRestockAnnouncement = ({ facts = {}, channel = {}, messageId = null } = {}) => {
  const name = escapeTelegramHtml(facts.name || "");
  if (!name) return "";
  const sizes = sortTelegramSizes(facts.sizes || []);
  const link = telegramPostLink({ channel, messageId });
  const head = `<b>${escapeTelegramHtml(TELEGRAM_CATALOG_DEFAULTS.restock_announcement)}</b>`;
  const line = link ? `<a href="${link}">${name}</a>` : name;
  const sizeLine = sizes.length ? `
📏 ${escapeTelegramHtml(sizes.join(" · "))}` : "";
  return `${head}
${line}${sizeLine}`;
};

export const syncTelegramChannel = async ({
  channel,
  settings,
  tenantId = telegramCatalogTenantId(),
  client = db,
  // Injected so the diff can be exercised without a catalogue or a database.
  loadCards = buildStorefrontColorCardsForAudience,
  listPosts = listTelegramCatalogPosts,
  savePost = upsertTelegramCatalogPost,
  enqueue = enqueueTelegramCatalogJob,
  markSynced = markTelegramChannelSynced,
  loadLabels = loadTelegramClassificationLabels,
  listSiblings = listTelegramChannels,
} = {}) => {
  const summary = { channel_id: channel?.id || null, created: 0, updated: 0, sold_out: 0, unchanged: 0, skipped: 0 };
  if (!channel?.id || !text(channel.chat_id)) {
    summary.skipped = 1;
    return summary;
  }
  await ensureTelegramCatalogSchema(client);
  // One read per channel sweep, not one per colour.
  const labels = await loadLabels();
  // What this channel already filters on, and therefore must not repeat as a tag.
  const scopedTags = text(channel.audience) ? ["gender"] : [];

  // Oldest first: see orderCardsOldestFirst -- the last post is the first thing
  // a visitor sees, so the newest model has to be the last one in.
  const catalogue = (await loadCards({ tenantId, audience: channel.audience || "" }))
    // A school bag is a kids product wherever else it is listed.
    .filter((card) => !isSchoolBagForAdultChannel(card, channel.audience));
  const cards = orderCardsForBackfill(catalogue, parseTelegramPostOrder(settings.post_order));
  const existing = await listPosts({ tenantId, channelId: channel.id, client });
  const existingByCard = new Map(existing.map((row) => [text(row.card_id), row]));
  const seen = new Set();

  for (const card of cards) {
    const facts = telegramCardFacts(card, { audience: channel.audience });
    if (!facts.card_id) continue;
    // Two listing cards can collapse onto one colour key; the first wins rather
    // than the two fighting over the same post for ever.
    if (seen.has(facts.card_id)) continue;
    seen.add(facts.card_id);

    // A colour the catalogue cannot price is not posted: the caption would carry
    // a bare "💰" with nothing after it, which reads as broken and earns a
    // "بكام؟" message instead of a sale. It is already in `seen`, so an existing
    // post keeps its last good caption rather than being rewritten as sold out
    // over what is really a missing price.
    if (!(Number(facts.price) > 0)) {
      summary.skipped += 1;
      continue;
    }

    const imageUrl = telegramCardImageUrl(card);
    const payload = buildTelegramPostPayload({ facts, settings, imageUrl, soldOut: false, labels, scopedTags });
    const row = existingByCard.get(facts.card_id);

    if (!row) {
      // A colour with no usable photo is skipped rather than posted as text:
      // a channel of captions with no pictures is worse than a shorter channel.
      if (!imageUrl) {
        summary.skipped += 1;
        continue;
      }
      await savePost({
        tenantId,
        channelId: channel.id,
        cardId: facts.card_id,
        productId: facts.product_id,
        colorKey: facts.color_key,
        imageUrl,
        client,
      });
      await enqueue({ tenantId, channelId: channel.id, cardId: facts.card_id, action: "create", payload: { ...payload, event: "new" }, client });
      summary.created += 1;
      continue;
    }

    if (row.caption_hash === payload.fingerprint && row.state === "live" && row.message_id) {
      summary.unchanged += 1;
      continue;
    }
    // A post that was never delivered has no message to edit: it goes back
    // through create.
    const action = row.message_id ? "update" : "create";
    if (action === "create" && !imageUrl) {
      summary.skipped += 1;
      continue;
    }
    await enqueue({
      tenantId,
      channelId: channel.id,
      cardId: facts.card_id,
      action,
      payload: {
        ...payload,
        replace_media: Boolean(row.message_id) && text(row.image_url) !== imageUrl,
        event: classifyTelegramChange({ row, facts, soldOut: false }),
      },
      client,
    });
    if (action === "create") summary.created += 1;
    else summary.updated += 1;
  }

  // Everything still live in the channel that the catalogue no longer offers.
  for (const row of existing) {
    if (seen.has(text(row.card_id))) continue;
    if (!row.message_id || row.state === "sold_out" || row.state === "removed") continue;
    const facts = { ...(row.facts && typeof row.facts === "object" ? row.facts : {}), card_id: text(row.card_id) };
    // Without the stored facts the sold-out caption would overwrite a real post
    // with a nameless, priceless one. Leaving it as it is costs a shopper one
    // "is this available?" message; rewriting it costs the post.
    if (!text(facts.name)) {
      summary.skipped += 1;
      continue;
    }
    const payload = buildTelegramPostPayload({ facts, settings, imageUrl: row.image_url, soldOut: true, labels, scopedTags });
    if (row.caption_hash === payload.fingerprint) continue;
    await enqueue({ tenantId, channelId: channel.id, cardId: row.card_id, action: "update", payload, client });
    summary.sold_out += 1;
  }

  // Queued last, so the menu goes out after the posts it points at.
  const indexBody = buildTelegramChannelIndex({ cards, labels, scopedTags });
  const indexMarkup = telegramIndexKeyboard({ audience: channel.audience, siblings: await listSiblings({ tenantId, client }) });
  const description = buildTelegramChannelDescription({ channel, shopName: await shopDisplayName() });
  const indexHash = telegramIndexFingerprint(indexBody, indexMarkup);
  if (indexBody && indexHash !== text(channel.index_hash)) {
    await enqueue({
      tenantId,
      channelId: channel.id,
      cardId: TELEGRAM_INDEX_CARD_ID,
      action: "index",
      payload: { body: indexBody, reply_markup: indexMarkup, description, fingerprint: indexHash },
      client,
    });
    summary.index = 1;
  }

  await markSynced({ tenantId, channelId: channel.id, client });
  return summary;
};

export const syncAllTelegramChannels = async ({ tenantId = telegramCatalogTenantId(), client = db } = {}) => {
  const settings = await loadTelegramCatalogSettings();
  if (!settings.enabled) return { skipped: true, reason: "disabled" };
  const channels = await listTelegramChannels({ tenantId, includeInactive: false, client });
  const results = [];
  for (const channel of channels) {
    try {
      results.push(await syncTelegramChannel({ channel, settings, tenantId, client }));
    } catch (error) {
      await markTelegramChannelSynced({ tenantId, channelId: channel.id, error: error?.message || String(error), client }).catch(() => {});
      results.push({ channel_id: channel.id, error: text(error?.message || error).slice(0, 300) });
    }
  }
  return { channels: results.length, results };
};

export default { syncAllTelegramChannels, syncTelegramChannel, buildTelegramPostPayload };
