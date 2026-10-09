import test from "node:test";
import assert from "node:assert/strict";

process.env.STORE_FRONT_URL = process.env.STORE_FRONT_URL || "https://shop.example.com";
process.env.PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL || "https://api.example.com";

const {
  TELEGRAM_CATALOG_DEFAULTS,
  formatTelegramPrice,
  renderTelegramCaption,
  sortTelegramSizes,
  TELEGRAM_CAPTION_MAX,
} = await import("../shared/telegramCatalogDefaults.js");

const {
  normalizeTelegramCallbackQuery,
  normalizeTelegramUpdate,
  telegramDeepLinkToken,
  telegramDeepLinkUrl,
  telegramStartPayload,
} = await import("../server/services/telegramBotService.js");

const {
  buildTelegramPostPayload,
  telegramCardFacts,
  telegramPostButtons,
  telegramPostCaption,
  telegramProductUrl,
} = await import("../server/services/telegramCatalogPublisherService.js");

const { telegramShopKeyboard } = await import("../server/services/telegramShopBotService.js");
const { processTelegramCatalogJob } = await import("../server/services/telegramCatalogWorkerService.js");

const SETTINGS = {
  enabled: true,
  bot_username: "m1_shop_bot",
  order_mode: "both",
  posts_per_minute: 12,
  caption_template: TELEGRAM_CATALOG_DEFAULTS.caption_template,
  sold_out_label: TELEGRAM_CATALOG_DEFAULTS.sold_out_label,
};

const FACTS = {
  card_id: "412:black",
  product_id: 412,
  color_key: "black",
  name: "Nike Air Force 1 - أسود",
  color: "أسود",
  price: 1250,
  compare_price: 1500,
  sizes: ["42", "40", "41"],
  slug: "nike-air-force-1",
  audience: "men",
  product_type: "سنيكرز",
  brand: "Nike",
};

// ---------------------------------------------------------------------------
// The caption
// ---------------------------------------------------------------------------

test("sizes read in a stable, human order so an unchanged post is not re-edited", () => {
  assert.deepEqual(sortTelegramSizes(["42", "40", "M", "41", "40"]), ["40", "41", "42", "M"]);
  // Same set, different arrival order -> same caption, so the same fingerprint.
  assert.deepEqual(sortTelegramSizes(["41", "42", "40"]), sortTelegramSizes(["40", "41", "42"]));
});

test("a price of zero leaves the price line empty rather than printing 0", () => {
  assert.equal(formatTelegramPrice(1250), "1,250 ج.م");
  assert.equal(formatTelegramPrice(0), "");
  assert.equal(formatTelegramPrice(null), "");
});

test("the caption carries the available sizes and no sold-out line", () => {
  const caption = telegramPostCaption({ facts: FACTS, settings: SETTINGS, soldOut: false });
  assert.match(caption, /Nike Air Force 1 - أسود/);
  assert.match(caption, /1,250 ج\.م/);
  assert.match(caption, /40 · 41 · 42/);
  assert.ok(!caption.includes(TELEGRAM_CATALOG_DEFAULTS.sold_out_label), "no sold-out line while in stock");
});

test("a sold-out colour keeps its name and price and gains the sold-out line", () => {
  const caption = telegramPostCaption({ facts: FACTS, settings: SETTINGS, soldOut: true });
  assert.match(caption, /Nike Air Force 1/);
  assert.match(caption, /1,250 ج\.م/);
  assert.ok(caption.includes(TELEGRAM_CATALOG_DEFAULTS.sold_out_label));
  assert.ok(!/40 · 41 · 42/.test(caption), "sizes are not advertised once the colour is gone");
});

test("an unknown placeholder is left alone instead of being blanked", () => {
  assert.equal(renderTelegramCaption("{name} {not_a_placeholder}", { name: "X" }), "X {not_a_placeholder}");
});

test("a caption longer than Telegram allows is clamped, because Telegram refuses the whole post", () => {
  const caption = renderTelegramCaption("{name}", { name: "ا".repeat(TELEGRAM_CAPTION_MAX + 500) });
  assert.ok(caption.length <= TELEGRAM_CAPTION_MAX, `caption is ${caption.length} characters`);
});

test("the listing card is read into facts without trusting any field to be there", () => {
  const facts = telegramCardFacts({
    card_id: "9:red",
    parent_product_id: 9,
    color_key: "red",
    name: "Model",
    display_color: "أحمر",
    final_price: 900,
    compare_at_price: 800,
    sizes: ["41", "40"],
  }, { audience: "women" });
  assert.equal(facts.card_id, "9:red");
  assert.equal(facts.product_id, 9);
  assert.deepEqual(facts.sizes, ["40", "41"]);
  // A compare price BELOW the selling price is not a discount: it is dropped.
  assert.equal(facts.compare_price, 0);
  assert.equal(telegramCardFacts({}).card_id, "");
});

// ---------------------------------------------------------------------------
// The buttons. This is the one rule Telegram enforces with a 400 on every post.
// ---------------------------------------------------------------------------

const flatButtons = (markup) => (markup?.inline_keyboard || []).flat();

test("a CHANNEL post never carries a web_app button -- Telegram allows those only in private chats", () => {
  for (const mode of ["both", "bot", "mini_app", ""]) {
    const markup = telegramPostButtons({ facts: FACTS, settings: { ...SETTINGS, order_mode: mode } });
    const buttons = flatButtons(markup);
    assert.ok(buttons.length > 0, `mode ${mode} produced buttons`);
    for (const button of buttons) {
      assert.ok(!("web_app" in button), `mode ${mode} must not use web_app in a channel`);
      assert.match(String(button.url), /^https:\/\//);
    }
  }
});

test("the order button deep-links into the bot, and the website is the second button", () => {
  const buttons = flatButtons(telegramPostButtons({ facts: FACTS, settings: SETTINGS }));
  assert.equal(buttons.length, 2);
  assert.match(buttons[0].url, /^https:\/\/t\.me\/m1_shop_bot\?start=/);
  assert.match(buttons[1].url, /^https:\/\/shop\.example\.com\/product\//);
});

test("with no bot configured the website button takes over the order label rather than leaving none", () => {
  const buttons = flatButtons(telegramPostButtons({ facts: FACTS, settings: { ...SETTINGS, bot_username: "" } }));
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].text, TELEGRAM_CATALOG_DEFAULTS.order_button_label);
  assert.match(buttons[0].url, /^https:\/\/shop\.example\.com\/product\//);
});

test("the product link carries the tapped colour so the page opens on it", () => {
  const url = telegramProductUrl(FACTS);
  assert.match(url, /\/product\/nike-air-force-1\?/);
  assert.match(url, /color=black/);
  assert.match(url, /utm_source=telegram/);
});

test("inside the bot's private chat the checkout IS a web_app button", () => {
  const buttons = flatButtons(telegramShopKeyboard({ productUrl: "https://shop.example.com/product/x" }));
  assert.ok(buttons.length >= 1);
  assert.equal(buttons[0].web_app.url, "https://shop.example.com/product/x");
  // A sold-out colour gets no checkout button, only "browse the shop".
  const soldOut = flatButtons(telegramShopKeyboard({ productUrl: "" }));
  assert.ok(soldOut.every((button) => !String(button.web_app?.url || "").includes("/product/")));
});

// ---------------------------------------------------------------------------
// The deep link
// ---------------------------------------------------------------------------

test("the deep-link token survives an Arabic colour key, which a raw payload could not", () => {
  const token = telegramDeepLinkToken("412:أسود مطفي");
  assert.match(token, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(token, telegramDeepLinkToken("412:أسود مطفي"), "same colour, same token");
  assert.notEqual(token, telegramDeepLinkToken("412:أحمر"));
  assert.equal(telegramDeepLinkToken(""), "");
});

test("the deep-link url needs both a bot and a token", () => {
  assert.equal(telegramDeepLinkUrl({ botUsername: "@m1_shop_bot", token: "c123" }), "https://t.me/m1_shop_bot?start=c123");
  assert.equal(telegramDeepLinkUrl({ botUsername: "", token: "c123" }), "");
  assert.equal(telegramDeepLinkUrl({ botUsername: "bot", token: "" }), "");
});

test("/start is recognised with a payload, with a bot suffix, and bare", () => {
  assert.deepEqual(telegramStartPayload("/start c1a2b3"), { command: "start", payload: "c1a2b3" });
  assert.deepEqual(telegramStartPayload("/start@m1_shop_bot c1a2b3"), { command: "start", payload: "c1a2b3" });
  assert.deepEqual(telegramStartPayload("/start"), { command: "start", payload: "" });
  assert.equal(telegramStartPayload("عايز الموديل ده"), null, "an ordinary message is not a command");
  assert.equal(telegramStartPayload("/started"), null);
});

test("a button tap is read as a callback query, and an ordinary message still is not one", () => {
  const callback = normalizeTelegramCallbackQuery({
    update_id: 7,
    callback_query: { id: "cb1", data: "card:c123", from: { id: 55, first_name: "Ali" }, message: { chat: { id: 99, type: "private" } } },
  });
  assert.equal(callback.callback_query_id, "cb1");
  assert.equal(callback.is_private, true);
  assert.equal(callback.session_id, "telegram:99");
  // A tap under a CHANNEL post has no private chat to answer into.
  const fromChannel = normalizeTelegramCallbackQuery({
    callback_query: { id: "cb2", data: "card:c123", from: { id: 55 }, message: { chat: { id: -100123, type: "channel" } } },
  });
  assert.equal(fromChannel.is_private, false);
  assert.equal(normalizeTelegramCallbackQuery({ message: { chat: { id: 1 }, from: { id: 2 }, message_id: 3 } }), null);
  // The inbox path is untouched: a plain message is still a plain message.
  const message = normalizeTelegramUpdate({ update_id: 8, message: { chat: { id: 99 }, from: { id: 55 }, message_id: 4, text: "hi" } });
  assert.equal(message.session_id, "telegram:99");
});

// ---------------------------------------------------------------------------
// The fingerprint: the whole reason a 2,000-colour catalogue fits inside
// Telegram's edit rate limit.
// ---------------------------------------------------------------------------

test("an unchanged colour produces the same fingerprint, and any change moves it", () => {
  const base = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  const same = buildTelegramPostPayload({ facts: { ...FACTS, sizes: ["41", "42", "40"] }, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  assert.equal(base.fingerprint, same.fingerprint, "same sizes in another order is not a change");

  const soldSize = buildTelegramPostPayload({ facts: { ...FACTS, sizes: ["40", "41"] }, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  assert.notEqual(base.fingerprint, soldSize.fingerprint, "a size that sold out is a change");

  const newPrice = buildTelegramPostPayload({ facts: { ...FACTS, price: 1100 }, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  assert.notEqual(base.fingerprint, newPrice.fingerprint);

  const newPhoto = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/b.jpg" });
  assert.notEqual(base.fingerprint, newPhoto.fingerprint, "a new photo is a change the caption alone cannot show");

  // The bot being configured later changes the BUTTONS, not the caption: the
  // fingerprint has to notice, or the posts keep their dead buttons for ever.
  const withBot = buildTelegramPostPayload({ facts: FACTS, settings: { ...SETTINGS, bot_username: "other_bot" }, imageUrl: "https://api.example.com/uploads/a.jpg" });
  assert.notEqual(base.fingerprint, withBot.fingerprint);

  const sold = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg", soldOut: true });
  assert.notEqual(base.fingerprint, sold.fingerprint);
  assert.equal(sold.sold_out, true);
});

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

const stubClient = (rows = []) => {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT message_id/i.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [{}], rowCount: 1 };
    },
  };
};

const CHANNEL = { id: 3, chat_id: "-1001234567890", is_active: true, audience: "men" };

test("a create sends the photo and records the message id Telegram gave back", async () => {
  const payload = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  const sent = [];
  const client = stubClient();
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "create", payload },
    channel: CHANNEL,
    client,
    sendPhoto: async (args) => { sent.push(args); return { message_id: "5150" }; },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "-1001234567890");
  assert.equal(sent[0].photoUrl, "https://api.example.com/uploads/a.jpg");
  assert.match(sent[0].caption, /40 · 41 · 42/);
  assert.equal(result.message_id, "5150");
  const update = client.queries.find((entry) => /UPDATE telegram_catalog_posts/i.test(entry.sql));
  assert.ok(update, "the post row is updated with the result");
  assert.ok(update.params.includes(5150), "the message id is stored as a number");
  assert.ok(update.params.includes(payload.fingerprint), "the fingerprint is stored so the next sweep can skip it");
});

test("an update edits the caption of the post that is already there -- it never posts again", async () => {
  const payload = buildTelegramPostPayload({ facts: { ...FACTS, sizes: ["40"] }, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  const edits = [];
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "update", payload },
    channel: CHANNEL,
    client: stubClient([{ message_id: "5150", image_url: "https://api.example.com/uploads/a.jpg" }]),
    sendPhoto: async () => { throw new Error("an update must never send a new post"); },
    editCaption: async (args) => { edits.push(args); return { message_id: "5150" }; },
  });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, "5150");
  assert.match(edits[0].caption, /المقاسات المتاحة: 40$/m);
  assert.equal(result.message_id, "5150");
});

test("a changed photo is swapped with editMessageMedia, which a caption edit cannot do", async () => {
  const payload = {
    ...buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/new.jpg" }),
    replace_media: true,
  };
  const photoEdits = [];
  const captionEdits = [];
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "update", payload },
    channel: CHANNEL,
    client: stubClient([{ message_id: "5150", image_url: "https://api.example.com/uploads/old.jpg" }]),
    editCaption: async (args) => { captionEdits.push(args); return {}; },
    editPhoto: async (args) => { photoEdits.push(args); return {}; },
  });
  assert.equal(photoEdits.length, 1);
  assert.equal(captionEdits.length, 0);
  assert.equal(photoEdits[0].photoUrl, "https://api.example.com/uploads/new.jpg");
});

test("\"message is not modified\" is a success, not a job that retries for ever", async () => {
  const payload = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  const client = stubClient([{ message_id: "5150", image_url: "https://api.example.com/uploads/a.jpg" }]);
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "update", payload },
    channel: CHANNEL,
    client,
    editCaption: async () => { throw new Error("Bad Request: message is not modified"); },
  });
  assert.equal(result.message_id, "5150");
  assert.ok(client.queries.some((entry) => /UPDATE telegram_catalog_posts/i.test(entry.sql)), "the fingerprint is still recorded");
});

test("any other Telegram failure propagates so the job is retried rather than marked done", async () => {
  const payload = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  await assert.rejects(
    processTelegramCatalogJob({
      job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "update", payload },
      channel: CHANNEL,
      client: stubClient([{ message_id: "5150", image_url: "https://api.example.com/uploads/a.jpg" }]),
      editCaption: async () => { throw new Error("Too Many Requests"); },
    }),
    /Too Many Requests/
  );
});

test("an update for a colour with no delivered post edits nothing and waits for a create", async () => {
  const payload = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/uploads/a.jpg" });
  const edits = [];
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "update", payload },
    channel: CHANNEL,
    client: stubClient([{ message_id: null, image_url: "" }]),
    editCaption: async (args) => { edits.push(args); return {}; },
  });
  assert.equal(edits.length, 0);
  assert.equal(result.skipped, "no_message");
});

test("a channel with no chat id is refused before anything is sent", async () => {
  await assert.rejects(
    processTelegramCatalogJob({
      job: { tenant_id: 1, channel_id: 3, card_id: "1:x", action: "create", payload: {} },
      channel: { id: 3, chat_id: "", is_active: true },
      client: stubClient(),
      sendPhoto: async () => { throw new Error("must not be called"); },
    }),
    /telegram_channel_chat_id_missing/
  );
});

// ---------------------------------------------------------------------------
// The diff. Everything above is about one post; this is about not sending the
// other 1,999.
// ---------------------------------------------------------------------------

const { syncTelegramChannel } = await import("../server/services/telegramCatalogPublisherService.js");

const CARD = {
  card_id: "412:black",
  parent_product_id: 412,
  color_key: "black",
  display_color: "أسود",
  name: "Nike Air Force 1 - أسود",
  slug: "nike-air-force-1",
  final_price: 1250,
  sizes: ["40", "41", "42"],
  image_url: "https://api.example.com/uploads/a.jpg",
  product_type: "سنيكرز",
};

const runSync = async ({ cards = [], posts = [], channel = CHANNEL } = {}) => {
  const jobs = [];
  const saved = [];
  const summary = await syncTelegramChannel({
    channel,
    settings: SETTINGS,
    tenantId: 1,
    client: { query: async () => ({ rows: [] }) },
    loadCards: async () => cards,
    listPosts: async () => posts,
    savePost: async (args) => { saved.push(args); },
    enqueue: async (args) => { jobs.push(args); },
    markSynced: async () => {},
  });
  return { summary, jobs, saved };
};

const liveRowFor = (card, overrides = {}) => {
  const facts = telegramCardFacts(card, { audience: "men" });
  const payload = buildTelegramPostPayload({ facts, settings: SETTINGS, imageUrl: card.image_url });
  return {
    card_id: card.card_id,
    message_id: "900",
    caption_hash: payload.fingerprint,
    image_url: card.image_url,
    state: "live",
    facts,
    ...overrides,
  };
};

test("a colour with no post yet is remembered first, then queued as a create", async () => {
  const { summary, jobs, saved } = await runSync({ cards: [CARD] });
  assert.equal(summary.created, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].action, "create");
  assert.equal(jobs[0].cardId, "412:black");
  // The row exists BEFORE the job, or a delivered post would have nowhere to
  // record its message id.
  assert.equal(saved.length, 1);
  assert.equal(saved[0].cardId, "412:black");
});

test("a colour whose post already says the right thing queues NOTHING", async () => {
  const { summary, jobs } = await runSync({ cards: [CARD], posts: [liveRowFor(CARD)] });
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.updated, 0);
  assert.deepEqual(jobs, [], "this is the whole rate-limit story");
});

test("a size that sold out queues one caption update, not a new post", async () => {
  const sold = { ...CARD, sizes: ["40", "41"] };
  const { summary, jobs } = await runSync({ cards: [sold], posts: [liveRowFor(CARD)] });
  assert.equal(summary.updated, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].action, "update");
  assert.match(jobs[0].payload.caption, /المقاسات المتاحة: 40 · 41$/m);
  assert.equal(jobs[0].payload.sold_out, false);
});

test("a colour that left the catalogue keeps its post and gains the sold-out line", async () => {
  const { summary, jobs } = await runSync({ cards: [], posts: [liveRowFor(CARD)] });
  assert.equal(summary.sold_out, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].action, "update", "never 'delete' -- the post and its link survive");
  assert.equal(jobs[0].payload.sold_out, true);
  assert.ok(jobs[0].payload.caption.includes(TELEGRAM_CATALOG_DEFAULTS.sold_out_label));
});

test("a colour already marked sold out is not re-marked on every sweep", async () => {
  const row = liveRowFor(CARD, { state: "sold_out" });
  const { summary, jobs } = await runSync({ cards: [], posts: [row] });
  assert.equal(summary.sold_out, 0);
  assert.deepEqual(jobs, []);
});

test("a restocked colour comes back through the SAME post", async () => {
  const row = liveRowFor(CARD, { state: "sold_out", caption_hash: "stale" });
  const { summary, jobs } = await runSync({ cards: [CARD], posts: [row] });
  assert.equal(summary.updated, 1);
  assert.equal(jobs[0].action, "update");
  assert.equal(jobs[0].payload.sold_out, false);
  assert.match(jobs[0].payload.caption, /40 · 41 · 42/);
});

test("a post that never reached Telegram is retried as a create, not edited into nothing", async () => {
  const row = liveRowFor(CARD, { message_id: null, state: "pending", caption_hash: "" });
  const { summary, jobs } = await runSync({ cards: [CARD], posts: [row] });
  assert.equal(summary.created, 1);
  assert.equal(jobs[0].action, "create");
});

test("a colour with no usable photo is skipped rather than posted bare", async () => {
  const { summary, jobs } = await runSync({ cards: [{ ...CARD, image_url: "" }] });
  assert.equal(summary.skipped, 1);
  assert.deepEqual(jobs, []);
});

test("a live post with no stored facts is left alone rather than overwritten by a nameless caption", async () => {
  const row = liveRowFor(CARD, { facts: {} });
  const { summary, jobs } = await runSync({ cards: [], posts: [row] });
  assert.equal(summary.sold_out, 0);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(jobs, []);
});

test("a changed photo asks for a media swap, not just a caption edit", async () => {
  const repainted = { ...CARD, image_url: "https://api.example.com/uploads/new.jpg" };
  const { jobs } = await runSync({ cards: [repainted], posts: [liveRowFor(CARD)] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].payload.replace_media, true);
});

test("a channel with no chat id pasted in yet reads nothing and queues nothing", async () => {
  const { summary, jobs } = await runSync({ cards: [CARD], channel: { id: 3, chat_id: "", is_active: true } });
  assert.equal(summary.skipped, 1);
  assert.deepEqual(jobs, []);
});

test("two listing cards collapsing onto one colour produce one post, not two", async () => {
  const { summary, jobs } = await runSync({ cards: [CARD, { ...CARD, name: "Nike Air Force 1 - اسود" }] });
  assert.equal(summary.created, 1);
  assert.equal(jobs.length, 1);
});
