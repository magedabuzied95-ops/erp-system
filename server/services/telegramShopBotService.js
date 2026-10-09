import db from "../database/db.js";
import { appendChannelOutboundSupportReply } from "./aiSupportLogService.js";
import { storefrontBaseUrl } from "./storefrontProductUrlService.js";
import {
  TELEGRAM_CHANNEL,
  answerTelegramCallbackQuery,
  sendTelegramChannelPhoto,
  sendTelegramChannelText,
  telegramStartPayload,
} from "./telegramBotService.js";
import {
  loadTelegramCatalogSettings,
  resolveTelegramCatalogPostByToken,
  telegramCatalogTenantId,
} from "./telegramCatalogService.js";
import {
  telegramPostCaption,
  telegramProductUrl,
} from "./telegramCatalogPublisherService.js";

/*
 * The order path.
 *
 * A channel post cannot open a mini app: Telegram allows web_app buttons only
 * in a private chat with the bot. So the post's order button is a deep link,
 * `t.me/<bot>?start=<token>`, and this is what answers it -- in a private chat,
 * where a web_app button IS allowed, carrying the colour the shopper tapped
 * straight into the storefront checkout.
 *
 * The money never moves here. The mini app is the SAME one-page checkout the
 * website serves, so the server stays the single authority on price, stock and
 * shipping, and Telegram adds no second way to pay for anything.
 */

const text = (value = "") => String(value ?? "").trim();

export const TELEGRAM_SHOP_COPY = Object.freeze({
  open_product: "🛒 اكمل الطلب",
  browse: "🛍 تصفّح المتجر",
  welcome: "أهلاً بيك في متجرنا 👋\nابعتلنا اسم الموديل أو صورة اللي عاجبك، أو افتح المتجر من الزر تحت.",
  not_found: "الموديل ده مش متاح حالياً. ابعتلنا اسم الموديل أو صورته وهنساعدك فوراً 🌹",
  sizes_hint: "اختار مقاسك من صفحة الموديل وهتكمل الطلب في ثواني.",
});

const miniAppUrl = (path = "") => {
  const base = storefrontBaseUrl();
  if (!base) return "";
  return /^https?:\/\//i.test(path) ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
};

// web_app is legal here and ONLY here: this is a private chat.
export const telegramShopKeyboard = ({ productUrl = "", includeBrowse = true } = {}) => {
  const rows = [];
  const product = text(productUrl);
  if (product && /^https:\/\//i.test(product)) {
    rows.push([{ text: TELEGRAM_SHOP_COPY.open_product, web_app: { url: product } }]);
  }
  if (includeBrowse) {
    const shopUrl = miniAppUrl("/products?utm_source=telegram&utm_medium=bot");
    if (shopUrl && /^https:\/\//i.test(shopUrl)) {
      rows.push([{ text: TELEGRAM_SHOP_COPY.browse, web_app: { url: shopUrl } }]);
    }
  }
  return rows.length ? { inline_keyboard: rows } : null;
};

const logOutbound = async ({ tenantId, chatId, message, messageType = "text" }) => {
  await appendChannelOutboundSupportReply({
    tenantId,
    sessionId: `telegram:${chatId}`,
    channel: TELEGRAM_CHANNEL,
    senderType: "system",
    message,
    messageType,
    deliveryStatus: "sent",
    source: "telegram_shop_bot",
    sourcePath: "telegram_shop_bot",
    insertSource: "telegram_shop_bot",
    remoteJid: text(chatId),
    resolvedReplyJid: text(chatId),
    resolvedPhone: "",
  }).catch(() => null);
};

// The shopper tapped "order" under a colour. The reply is that same colour --
// same photo, same caption -- with the checkout behind one button, so nothing
// about what they are buying has to be retyped or guessed.
export const sendTelegramColourCard = async ({
  tenantId = telegramCatalogTenantId(),
  chatId,
  token,
  settings = null,
  client = db,
} = {}) => {
  const config = settings || (await loadTelegramCatalogSettings());
  const post = await resolveTelegramCatalogPostByToken({ tenantId, token, client });
  const facts = post?.facts && typeof post.facts === "object" ? post.facts : null;
  if (!post || !facts || !text(facts.name)) {
    await sendTelegramChannelText({ chatId, messageText: TELEGRAM_SHOP_COPY.not_found, replyMarkup: telegramShopKeyboard({}) });
    await logOutbound({ tenantId, chatId, message: TELEGRAM_SHOP_COPY.not_found });
    return { sent: true, found: false };
  }

  const soldOut = post.state === "sold_out";
  const caption = [
    telegramPostCaption({ facts, settings: config, soldOut }),
    soldOut ? "" : TELEGRAM_SHOP_COPY.sizes_hint,
  ].filter(Boolean).join("\n\n");
  const productUrl = telegramProductUrl(facts);
  const replyMarkup = telegramShopKeyboard({ productUrl: soldOut ? "" : productUrl });

  if (text(post.image_url)) {
    await sendTelegramChannelPhoto({ chatId, photoUrl: post.image_url, caption, replyMarkup });
  } else {
    await sendTelegramChannelText({ chatId, messageText: caption, replyMarkup });
  }
  await logOutbound({ tenantId, chatId, message: caption, messageType: "product_card" });
  return { sent: true, found: true, card_id: post.card_id, sold_out: soldOut };
};

// Every /start the bot receives, with or without a payload. A bare /start is a
// shopper who found the bot on its own: they get the shop, not an apology.
export const handleTelegramStartCommand = async ({
  tenantId = telegramCatalogTenantId(),
  chatId,
  messageText = "",
  client = db,
} = {}) => {
  const start = telegramStartPayload(messageText);
  if (!start) return { handled: false };
  const settings = await loadTelegramCatalogSettings();
  if (start.payload) {
    const result = await sendTelegramColourCard({ tenantId, chatId, token: start.payload, settings, client });
    return { handled: true, ...result };
  }
  const replyMarkup = telegramShopKeyboard({});
  await sendTelegramChannelText({ chatId, messageText: TELEGRAM_SHOP_COPY.welcome, replyMarkup });
  await logOutbound({ tenantId, chatId, message: TELEGRAM_SHOP_COPY.welcome });
  return { handled: true, welcome: true };
};

// A callback_query from a CHANNEL post has no private chat to answer into --
// only the toast. The deep-link buttons are plain URLs precisely so this stays
// a corner case rather than the order path.
export const handleTelegramCallbackQuery = async ({
  tenantId = telegramCatalogTenantId(),
  callback,
  client = db,
} = {}) => {
  if (!callback?.callback_query_id) return { handled: false };
  const data = text(callback.data);
  const token = data.startsWith("card:") ? data.slice("card:".length) : "";
  if (callback.is_private && callback.chat_id && token) {
    await answerTelegramCallbackQuery({ callbackQueryId: callback.callback_query_id });
    const result = await sendTelegramColourCard({ tenantId, chatId: callback.chat_id, token, client });
    return { handled: true, ...result };
  }
  await answerTelegramCallbackQuery({
    callbackQueryId: callback.callback_query_id,
    notice: TELEGRAM_SHOP_COPY.browse,
  });
  return { handled: true, answered_only: true };
};

export default {
  handleTelegramStartCommand,
  handleTelegramCallbackQuery,
  sendTelegramColourCard,
  telegramShopKeyboard,
};
