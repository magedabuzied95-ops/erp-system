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

// Pinned so the helper below and the sync under test render the SAME caption.
// The real loader answers from the shop's classification options, which would
// otherwise translate the tags in one place and not the other.
const NO_LABELS = {};

const runSync = async ({ cards = [], posts = [], channel = CHANNEL } = {}) => {
  const jobs = [];
  const indexJobs = [];
  const saved = [];
  const summary = await syncTelegramChannel({
    channel,
    settings: SETTINGS,
    tenantId: 1,
    client: { query: async () => ({ rows: [] }) },
    loadCards: async () => cards,
    listPosts: async () => posts,
    savePost: async (args) => { saved.push(args); },
    // The pinned menu is queued by the same sweep but is not a post; the diff
    // assertions below are about posts, so it is kept apart.
    enqueue: async (args) => { (args.action === "index" ? indexJobs : jobs).push(args); },
    markSynced: async () => {},
    loadLabels: async () => NO_LABELS,
  });
  return { summary, jobs, indexJobs, saved };
};

const liveRowFor = (card, overrides = {}) => {
  const facts = telegramCardFacts(card, { audience: "men" });
  // Mirrors what the sync does for a gender-scoped channel, so a caption built
  // here and one built there are the same text.
  const payload = buildTelegramPostPayload({ facts, settings: SETTINGS, imageUrl: card.image_url, labels: NO_LABELS, scopedTags: CHANNEL.audience ? ["gender"] : [] });
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

// ---------------------------------------------------------------------------
// The webhook subscription. A handler for an update type Telegram was never
// asked to send is dead code that looks alive -- which is exactly what
// callback_query and my_chat_member were until this was fixed.
// ---------------------------------------------------------------------------

const { readFileSync } = await import("node:fs");

test("the webhook registers every update type the intake actually handles", () => {
  const script = readFileSync(new URL("../server/scripts/configureTelegramWebhook.mjs", import.meta.url), "utf8");
  const match = /allowed_updates:\s*(\[[^\]]*\])/.exec(script);
  assert.ok(match, "allowed_updates is declared");
  const allowed = JSON.parse(match[1].replace(/'/g, '"'));
  for (const type of ["message", "edited_message", "callback_query", "my_chat_member"]) {
    assert.ok(allowed.includes(type), `${type} must be subscribed or its handler never runs`);
  }
  // channel_post is deliberately excluded: the bot administers the catalog
  // channels, so subscribing echoes every post and every size edit back into
  // telegram_webhook_updates.
  assert.ok(!allowed.includes("channel_post"), "channel_post would echo our own catalogue back at us");
});

test("a colour the catalogue cannot price is skipped, not posted with an empty price line", async () => {
  const { summary, jobs } = await runSync({ cards: [{ ...CARD, final_price: 0, selling_price: 0, price: 0 }] });
  assert.equal(summary.skipped, 1);
  assert.equal(summary.created, 0);
  assert.deepEqual(jobs, [], "a bare 💰 earns a \"how much?\" message, not a sale");
});

test("a live post whose price goes missing keeps its caption instead of being marked sold out", async () => {
  const { summary, jobs } = await runSync({
    cards: [{ ...CARD, final_price: 0, selling_price: 0, price: 0 }],
    posts: [liveRowFor(CARD)],
  });
  assert.equal(summary.sold_out, 0, "a missing price is a data fault, not a sold-out colour");
  assert.equal(summary.skipped, 1);
  assert.deepEqual(jobs, []);
});

// ---------------------------------------------------------------------------
// Posting order. Telegram drops a visitor at the BOTTOM of a channel, so the
// last post is the first thing seen.
// ---------------------------------------------------------------------------

const { orderCardsOldestFirst } = await import("../server/services/telegramCatalogPublisherService.js");

test("the backfill runs oldest first, so the newest model is the last one posted", () => {
  const ordered = orderCardsOldestFirst([
    { card_id: "c:new", created_at: "2026-10-01T00:00:00Z" },
    { card_id: "a:old", created_at: "2024-01-01T00:00:00Z" },
    { card_id: "b:mid", created_at: "2025-06-01T00:00:00Z" },
  ]);
  assert.deepEqual(ordered.map((c) => c.card_id), ["a:old", "b:mid", "c:new"]);
});

test("a card with no date sorts to the front, and ties keep catalogue order", () => {
  const ordered = orderCardsOldestFirst([
    { card_id: "tie:1", created_at: "2025-01-01T00:00:00Z" },
    { card_id: "undated" },
    { card_id: "tie:2", created_at: "2025-01-01T00:00:00Z" },
  ]);
  assert.deepEqual(ordered.map((c) => c.card_id), ["undated", "tie:1", "tie:2"]);
});

test("the sync queues the creates oldest first", async () => {
  const { jobs } = await runSync({
    cards: [
      { ...CARD, card_id: "9:new", created_at: "2026-10-01T00:00:00Z" },
      { ...CARD, card_id: "7:old", created_at: "2024-01-01T00:00:00Z" },
      { ...CARD, card_id: "8:mid", created_at: "2025-06-01T00:00:00Z" },
    ],
  });
  assert.deepEqual(jobs.map((j) => j.cardId), ["7:old", "8:mid", "9:new"]);
});

// ---------------------------------------------------------------------------
// Hashtags. The only filter a Telegram channel gives a shopper: tapping one
// shows every post in that channel carrying it.
// ---------------------------------------------------------------------------

const { loadTelegramClassificationLabels, __resetTelegramClassificationLabels } =
  await import("../server/services/telegramCatalogPublisherService.js");

const SHOP_LABELS = {
  gender: { men: "رجالي", women: "حريمي", kids: "أطفال" },
  product_type: { sneakers: "Sneakers", crocs: "Crocs", slippers: "سليبرز", bags: "Bags" },
  grade: { mirror_original: "ميرور اوريجينال", local: "محلي", imported_from_vietnam: "مستورد فيتنامي" },
};

test("a post is tagged by audience, type, grade and brand - the four things a shopper filters by", () => {
  const caption = telegramPostCaption({
    facts: { ...FACTS, product_type: "sneakers", grade: "mirror_original", brand: "SKECHERS" },
    settings: SETTINGS,
    labels: SHOP_LABELS,
  });
  assert.match(caption, /#رجالي/);
  assert.match(caption, /#Sneakers/);
  assert.match(caption, /#ميرور_اوريجينال/, "a two-word grade must become ONE tag");
  assert.match(caption, /#SKECHERS/);
});

test("a grade label with a space becomes one tag, or Telegram keeps only the first word", () => {
  const caption = telegramPostCaption({
    facts: { ...FACTS, grade: "imported_from_vietnam", product_type: "", brand: "" },
    settings: SETTINGS,
    labels: SHOP_LABELS,
  });
  assert.match(caption, /#مستورد_فيتنامي/);
  assert.ok(!/#مستورد\s/.test(caption));
});

test("an unlabelled value still produces a tag rather than disappearing", () => {
  const caption = telegramPostCaption({
    facts: { ...FACTS, grade: "brand_new_grade", product_type: "", brand: "" },
    settings: SETTINGS,
    labels: SHOP_LABELS,
  });
  assert.match(caption, /#brand_new_grade/);
});

test("a colour with no grade or type is tagged by what it does have, with no empty tags", () => {
  const caption = telegramPostCaption({
    facts: { ...FACTS, product_type: "", grade: "", brand: "Nike" },
    settings: SETTINGS,
    labels: SHOP_LABELS,
  });
  assert.match(caption, /#رجالي #Nike/);
  assert.ok(!/##/.test(caption));
});

test("changing a grade's Arabic name in the ERP changes the tag, and therefore the post", () => {
  const facts = { ...FACTS, grade: "mirror_original", product_type: "", brand: "" };
  const before = buildTelegramPostPayload({ facts, settings: SETTINGS, imageUrl: "https://api.example.com/a.jpg", labels: SHOP_LABELS });
  const after = buildTelegramPostPayload({
    facts,
    settings: SETTINGS,
    imageUrl: "https://api.example.com/a.jpg",
    labels: { ...SHOP_LABELS, grade: { ...SHOP_LABELS.grade, mirror_original: "ميرور" } },
  });
  assert.notEqual(before.fingerprint, after.fingerprint, "the sweep has to notice and edit the posts");
  assert.match(after.caption, /#ميرور(?!_)/);
});

test("the label map is read once and cached, not once per colour", async () => {
  __resetTelegramClassificationLabels();
  let reads = 0;
  const fetchOptions = async (group) => {
    reads += 1;
    return Object.entries(SHOP_LABELS[group] || {}).map(([value, label_ar]) => ({ value, label_ar }));
  };
  const first = await loadTelegramClassificationLabels({ fetchOptions, now: 1_000 });
  assert.equal(first.grade.mirror_original, "ميرور اوريجينال");
  assert.equal(reads, 3, "one read per tagged group");
  await loadTelegramClassificationLabels({ fetchOptions, now: 2_000 });
  assert.equal(reads, 3, "served from cache");
  await loadTelegramClassificationLabels({ fetchOptions, now: 1_000 + 6 * 60_000 });
  assert.equal(reads, 6, "re-read once the cache expires");
  __resetTelegramClassificationLabels();
});

test("a classification group the ERP cannot answer for leaves the other tags intact", async () => {
  __resetTelegramClassificationLabels();
  const labels = await loadTelegramClassificationLabels({
    fetchOptions: async (group) => {
      if (group === "grade") throw new Error("db down");
      return Object.entries(SHOP_LABELS[group] || {}).map(([value, label_ar]) => ({ value, label_ar }));
    },
    now: 10_000,
  });
  assert.deepEqual(labels.grade, {});
  assert.equal(labels.gender.men, "رجالي");
  __resetTelegramClassificationLabels();
});

test("a channel does not repeat its own filter as a tag on every post", () => {
  const facts = { ...FACTS, product_type: "sneakers", grade: "mirror_original", brand: "SKECHERS" };
  const inMensChannel = telegramPostCaption({ facts, settings: SETTINGS, labels: SHOP_LABELS, scopedTags: ["gender"] });
  assert.ok(!inMensChannel.includes("#رجالي"), "every post in the men's channel is men's");
  // What still varies inside that channel keeps its tag.
  assert.match(inMensChannel, /#Sneakers/);
  assert.match(inMensChannel, /#ميرور_اوريجينال/);
  assert.match(inMensChannel, /#SKECHERS/);
});

test("an unscoped channel still tags the audience", () => {
  const facts = { ...FACTS, product_type: "", grade: "", brand: "" };
  assert.match(telegramPostCaption({ facts, settings: SETTINGS, labels: SHOP_LABELS, scopedTags: [] }), /#رجالي/);
});

test("the rule is the channel's scope, not the gender: a brand channel drops its brand tag", () => {
  const facts = { ...FACTS, product_type: "", grade: "", brand: "SKECHERS" };
  const caption = telegramPostCaption({ facts, settings: SETTINGS, labels: SHOP_LABELS, scopedTags: ["brand"] });
  assert.ok(!caption.includes("#SKECHERS"));
  assert.match(caption, /#رجالي/);
});

test("the sync drops the audience tag for a gender channel", async () => {
  __resetTelegramClassificationLabels();
  const jobs = [];
  await syncTelegramChannel({
    channel: CHANNEL,
    settings: SETTINGS,
    tenantId: 1,
    client: { query: async () => ({ rows: [] }) },
    loadCards: async () => [{ ...CARD, product_type: "sneakers", grade: "mirror_original", brand: "SKECHERS" }],
    listPosts: async () => [],
    savePost: async () => {},
    enqueue: async (args) => { jobs.push(args); },
    markSynced: async () => {},
    loadLabels: async () => SHOP_LABELS,
  });
  const posts = jobs.filter((j) => j.action !== "index");
  assert.equal(posts.length, 1);
  assert.ok(!posts[0].payload.caption.includes("#رجالي"));
  assert.match(posts[0].payload.caption, /#ميرور_اوريجينال/);
  __resetTelegramClassificationLabels();
});

// ---------------------------------------------------------------------------
// HTML. The price is bold, which means every caption is now parsed by Telegram
// rather than taken literally -- and a caption Telegram refuses leaves the
// colour with no post at all.
// ---------------------------------------------------------------------------

const { escapeTelegramHtml, TELEGRAM_BOLD_PLACEHOLDERS } = await import("../shared/telegramCatalogDefaults.js");

test("the price is bold and nothing else is", () => {
  const caption = telegramPostCaption({ facts: FACTS, settings: SETTINGS, labels: SHOP_LABELS });
  assert.match(caption, /<b>1,250 ج\.م<\/b>/);
  assert.equal((caption.match(/<b>/g) || []).length, 1);
  assert.equal((caption.match(/<\/b>/g) || []).length, 1);
});

test("a product name with an ampersand survives instead of being refused", () => {
  const caption = telegramPostCaption({
    facts: { ...FACTS, name: "Nike Air <Max> - Black & White" },
    settings: SETTINGS,
    labels: SHOP_LABELS,
  });
  assert.match(caption, /Nike Air &lt;Max&gt; - Black &amp; White/);
  assert.ok(!/<Max>/.test(caption), "an unescaped tag would be eaten by the parser");
});

test("markup typed into the caption template is shown, not executed", () => {
  const caption = telegramPostCaption({
    facts: FACTS,
    settings: { ...SETTINGS, caption_template: "<b>{name}</b> <a href='x'>link</a>" },
    labels: SHOP_LABELS,
  });
  assert.match(caption, /&lt;b&gt;/);
  assert.ok(!/<a href/.test(caption), "the owner cannot break the API call from a settings textarea");
});

test("the escaper leaves ordinary Arabic and emoji alone", () => {
  assert.equal(escapeTelegramHtml("المقاسات المتاحة: 40 · 41 💰"), "المقاسات المتاحة: 40 · 41 💰");
  assert.equal(escapeTelegramHtml("a&b<c>d"), "a&amp;b&lt;c&gt;d");
  assert.equal(escapeTelegramHtml(null), "");
});

test("a clamped caption never ends inside a tag or leaves the bold open", () => {
  const caption = renderTelegramCaption("{name} {price}", {
    name: "ا".repeat(TELEGRAM_CAPTION_MAX),
    price: "1,250 ج.م",
  }, { html: true, bold: TELEGRAM_BOLD_PLACEHOLDERS });
  assert.ok(caption.length <= TELEGRAM_CAPTION_MAX);
  assert.ok(!/<[^>]*$/.test(caption.replace(/…$/, "")), "no half-written tag at the end");
  assert.equal((caption.match(/<b>/g) || []).length, (caption.match(/<\/b>/g) || []).length);
});

test("an open bold is closed when the cut lands inside it", () => {
  const caption = renderTelegramCaption("{price}", { price: "9".repeat(TELEGRAM_CAPTION_MAX + 50) }, { html: true, bold: ["price"] });
  assert.match(caption, /<b>9+<\/b>…$/);
});

test("plain mode is untouched, so nothing outside the catalogue starts emitting markup", () => {
  const caption = renderTelegramCaption("{name} {price}", { name: "A & B", price: "10" });
  assert.equal(caption, "A & B 10");
});

test("the worker tells Telegram the caption is HTML on every path", async () => {
  const payload = buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/a.jpg", labels: SHOP_LABELS });
  const modes = [];
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "create", payload },
    channel: CHANNEL,
    client: stubClient(),
    sendPhoto: async (args) => { modes.push(["create", args.parseMode]); return { message_id: "1" }; },
  });
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "update", payload },
    channel: CHANNEL,
    client: stubClient([{ message_id: "1", image_url: "https://api.example.com/a.jpg" }]),
    editCaption: async (args) => { modes.push(["edit", args.parseMode]); return {}; },
  });
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "update", payload: { ...payload, image_url: "https://api.example.com/b.jpg", replace_media: true } },
    channel: CHANNEL,
    client: stubClient([{ message_id: "1", image_url: "https://api.example.com/a.jpg" }]),
    editPhoto: async (args) => { modes.push(["media", args.parseMode]); return {}; },
  });
  assert.deepEqual(modes, [["create", "HTML"], ["edit", "HTML"], ["media", "HTML"]]);
});

// ---------------------------------------------------------------------------
// The pinned index. Telegram's in-channel search shows a match with its
// neighbours around it rather than as a list, so a shopper who does not know
// the tags exist cannot narrow 600 posts down at all.
// ---------------------------------------------------------------------------

const { buildTelegramChannelIndex, telegramIndexFingerprint } =
  await import("../server/services/telegramCatalogPublisherService.js");

const INDEX_CARDS = [
  { product_type: "sneakers", grade: "mirror_original", brand: "SKECHERS" },
  { product_type: "sneakers", grade: "local", brand: "Nike" },
  { product_type: "sneakers", grade: "local", brand: "Nike" },
  { product_type: "slippers", grade: "imported_from_vietnam", brand: "new balance" },
  { product_type: "crocs", grade: "local", brand: "crocs" },
];

test("the index lists every tag that exists in the channel, grouped", () => {
  const body = buildTelegramChannelIndex({ cards: INDEX_CARDS, labels: SHOP_LABELS, scopedTags: ["gender"] });
  assert.match(body, /#Sneakers/);
  assert.match(body, /#سليبرز/);
  assert.match(body, /#Crocs/);
  assert.match(body, /#ميرور_اوريجينال/);
  assert.match(body, /#محلي/);
  assert.match(body, /#مستورد_فيتنامي/);
  assert.match(body, /#SKECHERS/);
  assert.match(body, /#new_balance/, "a brand with a space is one token");
});

test("the index offers nothing the channel does not contain", () => {
  const body = buildTelegramChannelIndex({ cards: INDEX_CARDS, labels: SHOP_LABELS, scopedTags: ["gender"] });
  assert.ok(!body.includes("#Bags"), "tapping a tag with no posts behind it looks broken");
  assert.ok(!body.includes("#رجالي"), "the channel's own scope is not offered as a filter");
});

test("the commonest tag is listed first", () => {
  const body = buildTelegramChannelIndex({ cards: INDEX_CARDS, labels: SHOP_LABELS, scopedTags: ["gender"] });
  const brands = body.split("\n").find((line) => line.includes("#Nike"));
  assert.ok(brands.indexOf("#Nike") < brands.indexOf("#SKECHERS"), "Nike has two cards, SKECHERS one");
});

test("an empty channel gets no menu rather than an empty one", () => {
  assert.equal(buildTelegramChannelIndex({ cards: [], labels: SHOP_LABELS, scopedTags: ["gender"] }), "");
});

test("a brand name with markup in it cannot break the pinned message", () => {
  const body = buildTelegramChannelIndex({
    cards: [{ product_type: "sneakers", brand: "A&B <x>" }],
    labels: SHOP_LABELS,
    scopedTags: ["gender"],
  });
  assert.ok(!/<x>/.test(body));
  assert.match(body, /&amp;/);
});

test("the index is only re-sent when it actually changes", async () => {
  const jobs = [];
  const run = (channel, cards) => syncTelegramChannel({
    channel,
    settings: SETTINGS,
    tenantId: 1,
    client: { query: async () => ({ rows: [] }) },
    loadCards: async () => cards,
    listPosts: async () => [],
    savePost: async () => {},
    enqueue: async (args) => { jobs.push(args); },
    markSynced: async () => {},
    loadLabels: async () => SHOP_LABELS,
  });
  const cards = [{ ...CARD, product_type: "sneakers", grade: "local", brand: "Nike" }];
  await run(CHANNEL, cards);
  const indexJob = jobs.find((j) => j.action === "index");
  assert.ok(indexJob, "a channel with no index yet gets one");
  assert.equal(indexJob.cardId, "__index__");

  // Same catalogue, and the channel now remembers that exact menu.
  jobs.length = 0;
  await run({ ...CHANNEL, index_hash: indexJob.payload.fingerprint }, cards);
  assert.ok(!jobs.some((j) => j.action === "index"), "an unchanged menu is not re-sent");

  // A new brand appears: the menu has to change.
  jobs.length = 0;
  await run({ ...CHANNEL, index_hash: indexJob.payload.fingerprint }, [...cards, { ...CARD, card_id: "9:x", brand: "PUMA", product_type: "sneakers", grade: "local" }]);
  assert.ok(jobs.some((j) => j.action === "index"));
});

test("the index is posted and pinned the first time, then only edited", async () => {
  const payload = { body: "<b>menu</b>", fingerprint: "abc123" };
  const sent = [];
  const edited = [];
  const pinned = [];
  const first = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__index__", action: "index", payload },
    channel: { ...CHANNEL, index_message_id: null },
    client: stubClient(),
    sendText: async (args) => { sent.push(args); return { message_id: "77" }; },
    pinMessage: async (args) => { pinned.push(args); return { pinned: true }; },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].parseMode, "HTML");
  assert.equal(pinned[0].messageId, "77");
  assert.equal(first.message_id, "77");

  const second = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__index__", action: "index", payload },
    channel: { ...CHANNEL, index_message_id: 77 },
    client: stubClient(),
    sendText: async () => { throw new Error("must not post a second menu"); },
    editText: async (args) => { edited.push(args); return {}; },
    pinMessage: async () => { throw new Error("must not re-pin"); },
  });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].messageId, "77");
  assert.equal(second.message_id, "77");
});

test("a menu the owner deleted by hand is replaced, not retried for ever", async () => {
  const sent = [];
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__index__", action: "index", payload: { body: "menu", fingerprint: "f" } },
    channel: { ...CHANNEL, index_message_id: 77 },
    client: stubClient(),
    editText: async () => { throw new Error("Bad Request: message to edit not found"); },
    sendText: async (args) => { sent.push(args); return { message_id: "99" }; },
    pinMessage: async () => ({ pinned: true }),
  });
  assert.equal(sent.length, 1);
  assert.equal(result.message_id, "99");
});

test("a bot without the pin right still gets its menu posted", async () => {
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__index__", action: "index", payload: { body: "menu", fingerprint: "f" } },
    channel: { ...CHANNEL, index_message_id: null },
    client: stubClient(),
    sendText: async () => ({ message_id: "100" }),
    pinMessage: async () => ({ pinned: false, reason: "not enough rights" }),
  });
  assert.equal(result.message_id, "100");
  assert.equal(result.pinned, false);
  assert.match(result.pin_error, /not enough rights/);
});

test("the index fingerprint changes with the body and not otherwise", () => {
  assert.equal(telegramIndexFingerprint("a"), telegramIndexFingerprint("a"));
  assert.notEqual(telegramIndexFingerprint("a"), telegramIndexFingerprint("b"));
});

// ---------------------------------------------------------------------------
// Combining filters. A channel cannot: tapping #Adidas shows every Adidas post
// and there is no way to narrow it to mirror sneakers from inside Telegram.
// ---------------------------------------------------------------------------

const { telegramIndexKeyboard } = await import("../server/services/telegramCatalogPublisherService.js");

test("the menu carries a button into the catalogue, where filters do stack", () => {
  const markup = telegramIndexKeyboard({ audience: "men" });
  const button = markup.inline_keyboard[0][0];
  assert.match(button.url, /^https:\/\/shop\.example\.com\/products\?/);
  assert.match(button.url, /gender=men/, "the button opens the channel's own audience");
  assert.match(button.url, /utm_medium=channel_index/);
  // A channel post cannot carry a mini app, so this is a plain URL.
  assert.ok(!("web_app" in button));
});

test("an unscoped channel's button opens the whole catalogue", () => {
  const markup = telegramIndexKeyboard({ audience: "" });
  assert.ok(!markup.inline_keyboard[0][0].url.includes("gender="));
});

test("no storefront url configured means no button rather than a broken one", () => {
  assert.equal(telegramIndexKeyboard({ audience: "men", baseUrl: "" }), null);
  assert.equal(telegramIndexKeyboard({ audience: "men", baseUrl: "http://insecure.example.com" }), null);
});

test("the menu says out loud that a hashtag is one filter at a time", () => {
  const body = buildTelegramChannelIndex({ cards: INDEX_CARDS, labels: SHOP_LABELS, scopedTags: ["gender"] });
  assert.match(body, /حاجة واحدة بس/);
});

test("changing only the button re-sends the menu", () => {
  const body = buildTelegramChannelIndex({ cards: INDEX_CARDS, labels: SHOP_LABELS, scopedTags: ["gender"] });
  const men = telegramIndexFingerprint(body, telegramIndexKeyboard({ audience: "men" }));
  const women = telegramIndexFingerprint(body, telegramIndexKeyboard({ audience: "women" }));
  assert.notEqual(men, women, "the fingerprint has to cover the button, not just the text");
  assert.equal(men, telegramIndexFingerprint(body, telegramIndexKeyboard({ audience: "men" })));
});

test("the worker sends the menu's button with it, on both the first post and an edit", async () => {
  const markup = telegramIndexKeyboard({ audience: "men" });
  const payload = { body: "menu", reply_markup: markup, fingerprint: "f1" };
  let sentMarkup = null;
  let editedMarkup = null;
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__index__", action: "index", payload },
    channel: { ...CHANNEL, index_message_id: null },
    client: stubClient(),
    sendText: async (args) => { sentMarkup = args.replyMarkup; return { message_id: "5" }; },
    pinMessage: async () => ({ pinned: true }),
  });
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__index__", action: "index", payload },
    channel: { ...CHANNEL, index_message_id: 5 },
    client: stubClient(),
    editText: async (args) => { editedMarkup = args.replyMarkup; return {}; },
  });
  assert.deepEqual(sentMarkup, markup);
  assert.deepEqual(editedMarkup, markup);
});

// ---------------------------------------------------------------------------
// Telling subscribers something changed, WITHOUT deleting and re-posting the
// model -- which would kill its link, its views and its forwards.
// ---------------------------------------------------------------------------

const {
  classifyTelegramChange,
  buildTelegramDigest,
  buildTelegramRestockAnnouncement,
  telegramPostLink,
} = await import("../server/services/telegramCatalogPublisherService.js");

const PUBLIC_CHANNEL = { ...CHANNEL, invite_url: "https://t.me/m1store_men" };

test("a colour that was gone and came back is the one change worth interrupting someone for", () => {
  assert.equal(
    classifyTelegramChange({ row: { message_id: "5", state: "sold_out", facts: { sizes: [] } }, facts: { sizes: ["42", "43"] } }),
    "restocked"
  );
});

test("a size added to an available colour is a digest line, not an interruption", () => {
  assert.equal(
    classifyTelegramChange({ row: { message_id: "5", state: "live", facts: { sizes: ["42"] } }, facts: { sizes: ["42", "43"] } }),
    "sizes_added"
  );
});

test("a size SELLING is not news at all", () => {
  assert.equal(
    classifyTelegramChange({ row: { message_id: "5", state: "live", facts: { sizes: ["42", "43"] } }, facts: { sizes: ["42"] } }),
    ""
  );
  assert.equal(
    classifyTelegramChange({ row: { message_id: "5", state: "live", facts: { sizes: ["42"] } }, facts: { sizes: ["42"] } }),
    ""
  );
});

test("a colour selling out is never announced as news", () => {
  assert.equal(classifyTelegramChange({ row: { message_id: "5", state: "live", facts: { sizes: ["42"] } }, facts: { sizes: [] }, soldOut: true }), "");
  // The discriminating case: the stored facts still carry the sizes the colour
  // HAD, so without the sold-out guard this reads as a restock and announces
  // "it is back" at the exact moment it ran out.
  assert.equal(
    classifyTelegramChange({ row: { message_id: "5", state: "sold_out", facts: { sizes: [] } }, facts: { sizes: ["42", "43"] }, soldOut: true }),
    ""
  );
});

test("a brand new colour is recorded as new - it already posts itself", () => {
  assert.equal(classifyTelegramChange({ row: null, facts: { sizes: ["42"] } }), "new");
  assert.equal(classifyTelegramChange({ row: { message_id: null, state: "pending" }, facts: { sizes: ["42"] } }), "new");
});

test("a post in a public channel is linkable, a private one is not", () => {
  assert.equal(telegramPostLink({ channel: PUBLIC_CHANNEL, messageId: 53 }), "https://t.me/m1store_men/53");
  assert.equal(telegramPostLink({ channel: { invite_url: "" }, messageId: 53 }), "");
  assert.equal(telegramPostLink({ channel: PUBLIC_CHANNEL, messageId: null }), "");
});

test("the restock announcement links to the post instead of repeating it", () => {
  const body = buildTelegramRestockAnnouncement({
    facts: { name: "SKECHERS - Grey", sizes: ["43", "41"] },
    channel: PUBLIC_CHANNEL,
    messageId: 53,
  });
  assert.match(body, /رجع تاني/);
  assert.match(body, /<a href="https:\/\/t\.me\/m1store_men\/53">SKECHERS - Grey<\/a>/);
  assert.match(body, /41 · 43/, "sizes read in order");
  assert.ok(!body.includes("<b>SKECHERS"), "it is a line, not a second product card");
});

test("an announcement with no name is not sent at all", () => {
  assert.equal(buildTelegramRestockAnnouncement({ facts: {}, channel: PUBLIC_CHANNEL, messageId: 53 }), "");
});

test("the digest groups the day into arrived / back / new sizes", () => {
  const body = buildTelegramDigest({
    channel: PUBLIC_CHANNEL,
    events: [
      { kind: "new", message_id: 60, facts: { name: "Nike Air", sizes: ["42"] } },
      { kind: "restocked", message_id: 61, facts: { name: "Adidas Run", sizes: ["43", "44"] } },
      { kind: "sizes_added", message_id: 62, facts: { name: "Puma X", sizes: ["40"] } },
    ],
  });
  assert.match(body, /جديد النهارده/);
  assert.match(body, /وصل جديد[\s\S]*Nike Air/);
  assert.match(body, /رجع تاني[\s\S]*Adidas Run/);
  assert.match(body, /مقاسات جديدة[\s\S]*Puma X/);
  assert.match(body, /https:\/\/t\.me\/m1store_men\/61/);
});

test("a quiet day produces no digest, so the shop does not spend a notification on nothing", () => {
  assert.equal(buildTelegramDigest({ channel: PUBLIC_CHANNEL, events: [] }), "");
  assert.equal(buildTelegramDigest({ channel: PUBLIC_CHANNEL, events: [{ kind: "new", facts: {} }] }), "");
});

test("a model name with markup cannot break the digest", () => {
  const body = buildTelegramDigest({
    channel: PUBLIC_CHANNEL,
    events: [{ kind: "new", message_id: 60, facts: { name: "A & B <b>", sizes: [] } }],
  });
  assert.match(body, /A &amp; B &lt;b&gt;/);
});

test("the sweep labels each queued change, so the worker knows what to record", async () => {
  const { jobs } = await runSync({ cards: [CARD] });
  assert.equal(jobs[0].payload.event, "new");

  const restocked = await runSync({
    cards: [CARD],
    posts: [liveRowFor(CARD, { state: "sold_out", caption_hash: "stale", facts: { ...telegramCardFacts(CARD, { audience: "men" }), sizes: [] } })],
  });
  assert.equal(restocked.jobs[0].payload.event, "restocked");
});

test("the event is recorded only after Telegram accepted the post", async () => {
  const payload = { ...buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/a.jpg" }), event: "restocked" };
  const client = stubClient();
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "create", payload },
    channel: CHANNEL,
    client,
    sendPhoto: async () => ({ message_id: "5150" }),
  });
  const inserted = client.queries.find((entry) => /INSERT INTO telegram_catalog_events/i.test(entry.sql));
  assert.ok(inserted, "the event row is written");
  assert.ok(inserted.params.includes("restocked"));
  assert.ok(inserted.params.includes(5150), "and it points at the post that was actually created");
});

test("a change worth no announcement writes no event", async () => {
  const payload = { ...buildTelegramPostPayload({ facts: FACTS, settings: SETTINGS, imageUrl: "https://api.example.com/a.jpg" }), event: "" };
  const client = stubClient();
  await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: FACTS.card_id, action: "create", payload },
    channel: CHANNEL,
    client,
    sendPhoto: async () => ({ message_id: "1" }),
  });
  assert.ok(!client.queries.some((entry) => /INSERT INTO telegram_catalog_events/i.test(entry.sql)));
});

test("the digest is one message, and it closes out the events it reported", async () => {
  const client = stubClient();
  const sent = [];
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__digest__", action: "digest", payload: { body: "<b>today</b>", day_key: "2026-10-10", event_ids: [1, 2, 3] } },
    channel: PUBLIC_CHANNEL,
    client,
    sendText: async (args) => { sent.push(args); return { message_id: "70" }; },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].parseMode, "HTML");
  assert.equal(result.events, 3);
  assert.ok(client.queries.some((e) => /UPDATE telegram_catalog_events SET digested_at/i.test(e.sql)), "reported events are closed");
  assert.ok(client.queries.some((e) => /last_digest_day/i.test(e.sql)), "and the day is marked done");
});

// ---------------------------------------------------------------------------
// Presentation: the things that make a channel read like a catalogue.
// ---------------------------------------------------------------------------

const { tidyTelegramText } = await import("../shared/telegramCatalogDefaults.js");
const { buildTelegramChannelDescription } = await import("../server/services/telegramCatalogPublisherService.js");

test("whatever spacing someone typed, the caption reads as one line", () => {
  assert.equal(tidyTelegramText("Nike Air Force 1  Sneakers"), "Nike Air Force 1 Sneakers");
  assert.equal(tidyTelegramText("  Adidas\tRun\n\nShoes  "), "Adidas Run Shoes");
  assert.equal(tidyTelegramText(null), "");
});

test("a sloppily spaced product name is tidied in the post, not in the shop's data", () => {
  const facts = telegramCardFacts({ card_id: "1:x", name: "Nike Air Force 1  Sneakers - White", display_color: "White  Ice", final_price: 100, sizes: ["42"] });
  assert.equal(facts.name, "Nike Air Force 1 Sneakers - White");
  assert.equal(facts.color, "White Ice");
});

test("the channel description says what it is, how to order and where the shop lives", () => {
  const body = buildTelegramChannelDescription({
    channel: { audience: "men", title: "M1 Store ( Men )" },
    shopName: "M1 Store",
    baseUrl: "https://m1store-egy.com",
  });
  assert.match(body, /رجالي/);
  assert.match(body, /M1 Store/);
  assert.match(body, /m1store-egy\.com/);
  assert.ok(!body.includes("https://"), "a description is not a link, and the scheme only costs characters");
  assert.ok(body.length <= 255, `Telegram's hard limit: ${body.length}`);
});

test("each audience gets its own wording, and an unscoped channel still reads", () => {
  const of = (audience) => buildTelegramChannelDescription({ channel: { audience }, shopName: "M1", baseUrl: "https://x.com" });
  assert.match(of("women"), /حريمي/);
  assert.match(of("kids"), /أطفال/);
  assert.match(of(""), /أحذية وشنط/);
});

test("a very long shop name cannot push the description past what Telegram accepts", () => {
  const body = buildTelegramChannelDescription({ channel: { audience: "men" }, shopName: "م".repeat(400), baseUrl: "https://x.com" });
  assert.ok(body.length <= 255);
});

test("the sweep sends the description along with the menu", async () => {
  const { indexJobs } = await runSync({ cards: [CARD] });
  assert.equal(indexJobs.length, 1);
  assert.ok(indexJobs[0].payload.description, "the menu job carries the channel's description");
});

test("a channel whose description Telegram refuses still gets its menu", async () => {
  const result = await processTelegramCatalogJob({
    job: { tenant_id: 1, channel_id: 3, card_id: "__index__", action: "index", payload: { body: "menu", fingerprint: "f", description: "about" } },
    channel: { ...CHANNEL, index_message_id: null },
    client: stubClient(),
    sendText: async () => ({ message_id: "9" }),
    pinMessage: async () => ({ pinned: true }),
    setDescription: async () => ({ updated: false, reason: "not enough rights" }),
  });
  assert.equal(result.message_id, "9");
  assert.equal(result.described, false);
  assert.match(result.describe_error, /not enough rights/);
});

// ---------------------------------------------------------------------------
// The allowed-action list. enqueueTelegramCatalogJob REFUSES an action that is
// not on it, so an action the worker handles but the list omits is a handler
// that can never run -- which is how the restock announcement and the daily
// summary shipped: both dead, both looking perfectly alive in the code.
// ---------------------------------------------------------------------------

const { TELEGRAM_JOB_ACTIONS } = await import("../server/services/telegramCatalogService.js");

test("every action the worker handles can actually be queued", () => {
  const worker = readFileSync(new URL("../server/services/telegramCatalogWorkerService.js", import.meta.url), "utf8");
  const handled = [...worker.matchAll(/job\.action === "(\w+)"/g)].map((match) => match[1]);
  assert.ok(handled.length >= 5, `found ${handled.length} handled actions`);
  for (const action of handled) {
    assert.ok(
      TELEGRAM_JOB_ACTIONS.includes(action),
      `the worker handles "${action}" but enqueueTelegramCatalogJob would refuse it`
    );
  }
});

test("every action the schedulers queue is allowed", () => {
  const worker = readFileSync(new URL("../server/services/telegramCatalogWorkerService.js", import.meta.url), "utf8");
  const publisher = readFileSync(new URL("../server/services/telegramCatalogPublisherService.js", import.meta.url), "utf8");
  const queued = [...`${worker}\n${publisher}`.matchAll(/action: "(\w+)"/g)].map((match) => match[1]);
  assert.ok(queued.length >= 3, `found ${queued.length} queued actions`);
  for (const action of queued) {
    assert.ok(TELEGRAM_JOB_ACTIONS.includes(action), `"${action}" is queued but not allowed`);
  }
});

// ---------------------------------------------------------------------------
// Getting from one channel to the next. Telegram has no notion of related
// channels, so the only way across is a link -- on the pinned menu, which is
// the first thing anyone sees, rather than a row on every single post.
// ---------------------------------------------------------------------------

const SIBLINGS = [
  { audience: "men", channel_key: "men", title: "M1 Store ( Men )", invite_url: "https://t.me/m1store_men" },
  { audience: "women", channel_key: "women", title: "M1 store ( Women )", invite_url: "https://t.me/m1store_women" },
  { audience: "kids", channel_key: "kids", title: "M1 store ( Kids )", invite_url: "https://t.me/m1store_kids" },
];

test("the menu carries a button to each of the shop's OTHER channels", () => {
  const rows = telegramIndexKeyboard({ audience: "men", siblings: SIBLINGS }).inline_keyboard;
  const buttons = rows[rows.length - 1];
  assert.deepEqual(buttons.map((b) => b.url), ["https://t.me/m1store_women", "https://t.me/m1store_kids"]);
  assert.ok(buttons.every((b) => b.text.length <= 20), "a button label has to fit on a phone");
});

test("a channel never links to itself", () => {
  for (const audience of ["men", "women", "kids"]) {
    const flat = telegramIndexKeyboard({ audience, siblings: SIBLINGS }).inline_keyboard.flat();
    const self = SIBLINGS.find((c) => c.audience === audience);
    assert.ok(!flat.some((b) => b.url === self.invite_url), `${audience} links to itself`);
  }
});

test("a channel with no public link is not offered as a button that goes nowhere", () => {
  const rows = telegramIndexKeyboard({
    audience: "men",
    siblings: [...SIBLINGS.slice(0, 2), { audience: "kids", channel_key: "kids", invite_url: "" }],
  }).inline_keyboard.flat();
  assert.equal(rows.filter((b) => b.url.includes("t.me")).length, 1, "only the women's channel can be opened");
});

test("only a real Telegram link becomes a button", () => {
  const rows = telegramIndexKeyboard({
    audience: "men",
    siblings: [{ audience: "women", invite_url: "javascript:alert(1)" }, { audience: "kids", invite_url: "http://t.me/x" }],
  }).inline_keyboard.flat();
  assert.ok(rows.every((b) => !b.url.startsWith("javascript:")));
  assert.ok(rows.every((b) => !b.url.startsWith("http://")));
});

test("the only channel in the shop gets a menu without a dead sibling row", () => {
  const rows = telegramIndexKeyboard({ audience: "men", siblings: [SIBLINGS[0]] }).inline_keyboard;
  assert.equal(rows.length, 1, "just the filter button");
});

test("adding a channel changes the menu, so the others re-send theirs", () => {
  const body = buildTelegramChannelIndex({ cards: INDEX_CARDS, labels: SHOP_LABELS, scopedTags: ["gender"] });
  const two = telegramIndexFingerprint(body, telegramIndexKeyboard({ audience: "men", siblings: SIBLINGS.slice(0, 2) }));
  const three = telegramIndexFingerprint(body, telegramIndexKeyboard({ audience: "men", siblings: SIBLINGS }));
  assert.notEqual(two, three);
});

// ---------------------------------------------------------------------------
// What goes in a channel, and in what order.
// ---------------------------------------------------------------------------

const {
  isSchoolBagForAdultChannel,
  orderCardsForBackfill,
  parseTelegramPostOrder,
} = await import("../server/services/telegramCatalogPublisherService.js");

const bag = (audiences) => ({ card_id: "b:1", product_type: "bags", audiences });

test("a bag listed for kids is a school bag, and belongs only in the kids channel", () => {
  assert.equal(isSchoolBagForAdultChannel(bag(["men", "women", "kids"]), "men"), true);
  assert.equal(isSchoolBagForAdultChannel(bag(["men", "women", "kids"]), "women"), true);
  assert.equal(isSchoolBagForAdultChannel(bag(["men", "women", "kids"]), "kids"), false, "it IS the kids channel's product");
});

test("a handbag is never listed for kids, so it stays", () => {
  assert.equal(isSchoolBagForAdultChannel(bag(["women"]), "women"), false);
});

test("a shoe is never a school bag, whoever it is for", () => {
  assert.equal(isSchoolBagForAdultChannel({ product_type: "sneakers", audiences: ["men", "kids"] }, "men"), false);
  assert.equal(isSchoolBagForAdultChannel({ product_type: "slippers", audiences: ["kids"] }, "men"), false);
});

test("the audience is read from either field the listing may carry", () => {
  assert.equal(isSchoolBagForAdultChannel({ product_type: "bags", product_audiences: ["kids"] }, "men"), true);
  assert.equal(isSchoolBagForAdultChannel({ product_type: "bags" }, "men"), false);
});

const ORDER = parseTelegramPostOrder("offer,type:crocs,type:slippers,grade:local,grade:imported_from_vietnam,grade:mirror_original");

const card = (id, extra) => ({ card_id: id, created_at: "2025-01-01T00:00:00Z", ...extra });

test("the groups are posted in the order the shop asked for", () => {
  const ordered = orderCardsForBackfill([
    card("mirror", { grade: "mirror_original", product_type: "sneakers" }),
    card("local", { grade: "local", product_type: "sneakers" }),
    card("crocs", { grade: "local", product_type: "crocs" }),
    card("vietnam", { grade: "imported_from_vietnam", product_type: "sneakers" }),
    card("slipper", { grade: "local", product_type: "slippers" }),
    card("offer", { grade: "mirror_original", product_type: "sneakers", is_offer_story: true }),
  ], ORDER);
  assert.deepEqual(ordered.map((c) => c.card_id), ["offer", "crocs", "slipper", "local", "vietnam", "mirror"]);
});

test("an offer is an offer whatever section it came from — it goes to the top", () => {
  const ordered = orderCardsForBackfill([
    card("plain", { grade: "local", product_type: "sneakers" }),
    card("offer-slipper", { grade: "local", product_type: "slippers", sale_mode_applied: true }),
  ], ORDER);
  assert.equal(ordered[0].card_id, "offer-slipper", "a slipper on offer is an offer first");
});

test("the LAST group posted is the one a visitor meets, so mirror ends up on top of the view", () => {
  const ordered = orderCardsForBackfill([
    card("a", { grade: "mirror_original" }),
    card("b", { grade: "local" }),
  ], ORDER);
  assert.equal(ordered[ordered.length - 1].grade, "mirror_original");
});

test("a card matching nothing is buried at the top, never left to greet a shopper", () => {
  const ordered = orderCardsForBackfill([
    card("mirror", { grade: "mirror_original" }),
    card("ungrouped", {}),
    card("offer", { grade: "local", is_offer_story: true }),
  ], ORDER);
  assert.equal(ordered[0].card_id, "ungrouped", "an unclassified product goes above even the offers");
  assert.equal(ordered[ordered.length - 1].card_id, "mirror", "and the last group still greets the shopper");
});

test("within a group, a model's colours stay together and oldest goes first", () => {
  const ordered = orderCardsForBackfill([
    card("new", { grade: "local", created_at: "2026-01-01T00:00:00Z" }),
    card("old", { grade: "local", created_at: "2024-01-01T00:00:00Z" }),
  ], ORDER);
  assert.deepEqual(ordered.map((c) => c.card_id), ["old", "new"]);
});

test("no order configured falls back to plain oldest-first", () => {
  const ordered = orderCardsForBackfill([
    card("new", { created_at: "2026-01-01T00:00:00Z" }),
    card("old", { created_at: "2024-01-01T00:00:00Z" }),
  ], []);
  assert.deepEqual(ordered.map((c) => c.card_id), ["old", "new"]);
});

test("every card is posted exactly once, whatever the groups", () => {
  const cards = [
    card("1", { grade: "local" }), card("2", { grade: "mirror_original", is_offer_story: true }),
    card("3", { product_type: "crocs", grade: "local" }), card("4", {}), card("5", { grade: "imported_from_vietnam" }),
  ];
  const ordered = orderCardsForBackfill(cards, ORDER);
  assert.equal(ordered.length, cards.length);
  assert.equal(new Set(ordered.map((c) => c.card_id)).size, cards.length);
});

test("the sweep itself drops a school bag from an adult channel", async () => {
  const schoolBag = { ...CARD, card_id: "b:1", product_type: "bags", audiences: ["men", "women", "kids"] };
  const { jobs, summary } = await runSync({ cards: [schoolBag, CARD] });
  assert.equal(jobs.length, 1, "only the shoe is queued");
  assert.equal(jobs[0].cardId, CARD.card_id);
  assert.equal(summary.created, 1);
});

test("the kids channel still gets its school bags", async () => {
  const schoolBag = { ...CARD, card_id: "b:1", product_type: "bags", audiences: ["men", "women", "kids"] };
  const { jobs } = await runSync({
    cards: [schoolBag],
    channel: { ...CHANNEL, audience: "kids" },
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].cardId, "b:1");
});
