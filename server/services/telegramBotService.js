import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const TELEGRAM_CHANNEL = "telegram";
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const TELEGRAM_API_BASE = "https://api.telegram.org";
const FETCH_TIMEOUT_MS = 10_000;
// Telegram DOWNLOADS the photo itself before it answers, so a media call is not
// a 10-second request. An abort here is the one way a catalog post can be
// delivered without us recording its message id, which would let the next
// attempt post the colour twice.
const TELEGRAM_MEDIA_TIMEOUT_MS = Math.max(10_000, Number(process.env.TELEGRAM_MEDIA_TIMEOUT_MS || 30_000));

const ALLOWED_MIME_PREFIXES = ["image/", "audio/", "video/"];
const ALLOWED_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
  "application/octet-stream",
]);

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"],
  ["audio/ogg", "ogg"], ["audio/mpeg", "mp3"], ["audio/mp4", "m4a"], ["audio/aac", "aac"],
  ["video/mp4", "mp4"], ["video/quicktime", "mov"], ["application/pdf", "pdf"],
  ["application/zip", "zip"], ["text/plain", "txt"],
]);

const safeErrorText = (value = "") => text(value)
  .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, "[telegram-api]")
  .replace(/https:\/\/api\.telegram\.org\/file\/bot[^/\s]+/gi, "[telegram-file]")
  .slice(0, 500);

export class TelegramApiError extends Error {
  constructor(message, { status = 502, code = "TELEGRAM_API_ERROR", retryAfter = 0 } = {}) {
    super(safeErrorText(message) || "Telegram API request failed");
    this.name = "TelegramApiError";
    this.status = Number(status) || 502;
    this.code = code;
    this.retryAfter = Math.max(0, Number(retryAfter) || 0);
  }
}

export const telegramBotToken = () => text(process.env.TELEGRAM_BOT_TOKEN);
export const telegramWebhookSecret = () => text(process.env.TELEGRAM_WEBHOOK_SECRET);
export const telegramTenantId = () => {
  const value = Number.parseInt(text(process.env.TELEGRAM_TENANT_ID), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

export const validateTelegramWebhookSecret = ({ provided = "", expected = telegramWebhookSecret() } = {}) => {
  const supplied = Buffer.from(text(provided));
  const configured = Buffer.from(text(expected));
  if (!configured.length || supplied.length !== configured.length) return false;
  return crypto.timingSafeEqual(supplied, configured);
};

const fetchWithTimeout = async (url, options = {}, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || FETCH_TIMEOUT_MS));
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const classifyTelegramError = ({ status = 502, description = "", retryAfter = 0 } = {}) => {
  const lower = text(description).toLowerCase();
  if (Number(status) === 429) return new TelegramApiError("Telegram rate limit reached", { status: 429, code: "TELEGRAM_RATE_LIMITED", retryAfter });
  if (Number(status) === 401) return new TelegramApiError("Telegram credentials are invalid", { status: 502, code: "TELEGRAM_INVALID_TOKEN" });
  if (Number(status) === 403 && lower.includes("blocked")) return new TelegramApiError("The customer blocked the Telegram bot", { status: 409, code: "TELEGRAM_BOT_BLOCKED" });
  if (lower.includes("chat not found")) return new TelegramApiError("Telegram chat was not found", { status: 409, code: "TELEGRAM_CHAT_NOT_FOUND" });
  return new TelegramApiError(description || "Telegram API request failed", { status: Number(status) >= 400 ? Number(status) : 502 });
};

export const telegramApiRequest = async (method, payload = {}, { token = telegramBotToken(), fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) => {
  if (!token) throw new TelegramApiError("Telegram bot token is not configured", { status: 503, code: "TELEGRAM_CONFIG_MISSING" });
  const response = await fetchWithTimeout(`${TELEGRAM_API_BASE}/bot${token}/${encodeURIComponent(text(method))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, fetchImpl, timeoutMs);
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok || body?.ok !== true) {
    throw classifyTelegramError({
      status: response.status,
      description: body?.description,
      retryAfter: body?.parameters?.retry_after,
    });
  }
  return body.result;
};

export const sendTelegramText = async ({ chatId, messageText, token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeMessage = text(messageText);
  if (!safeChatId) throw new TelegramApiError("Telegram chat id is missing", { status: 409, code: "TELEGRAM_CHAT_ID_MISSING" });
  if (!safeMessage) throw new TelegramApiError("Telegram message is empty", { status: 400, code: "TELEGRAM_MESSAGE_EMPTY" });
  const result = await telegramApiRequest("sendMessage", { chat_id: safeChatId, text: safeMessage }, { token, fetchImpl });
  return { sent: true, delivery_status: "sent", message_id: text(result?.message_id), result };
};

const telegramMediaMethod = (type = "") => {
  const normalized = text(type).toLowerCase();
  if (["photo", "image", "sticker"].includes(normalized)) return { method: "sendPhoto", field: "photo" };
  if (["voice", "ptt"].includes(normalized)) return { method: "sendVoice", field: "voice" };
  // sendVoice is OGG/OPUS only. A Safari m4a or a re-encoded wav is still audio,
  // so it goes through sendAudio rather than being refused by the API.
  if (["audio", "music", "sound"].includes(normalized)) return { method: "sendAudio", field: "audio" };
  // Without this a clip fell through to sendDocument and arrived as a file the
  // customer had to download rather than a player they could tap.
  if (["video", "clip", "animation"].includes(normalized)) return { method: "sendVideo", field: "video" };
  return { method: "sendDocument", field: "document" };
};

export const sendTelegramMedia = async ({ chatId, mediaUrl, mediaType = "document", caption = "", token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeUrl = text(mediaUrl);
  if (!safeChatId || !safeUrl) throw new TelegramApiError("Telegram media target is incomplete", { status: 400, code: "TELEGRAM_MEDIA_REQUIRED" });
  const { method, field } = telegramMediaMethod(mediaType);
  const result = await telegramApiRequest(method, { chat_id: safeChatId, [field]: safeUrl, ...(text(caption) ? { caption: text(caption) } : {}) }, { token, fetchImpl });
  return { sent: true, delivery_status: "sent", message_id: text(result?.message_id), result };
};

// --------------------------------------------------------------------------
// Channel posts (catalog channels).
//
// A channel post is written once with sendPhoto and from then on only edited:
// editMessageCaption keeps the available sizes current without pushing a new
// post, so the link, the view count and the forwards all survive a restock.
// Telegram puts no expiry on a bot editing its own channel post.
// --------------------------------------------------------------------------

// parse_mode is opt-in per call, never a default: the AI Inbox sends whatever a
// member of staff typed, and an unescaped "<" in their reply would be refused by
// Telegram or silently eat the rest of the message. Only the catalog senders,
// whose text this codebase builds and escapes itself, pass "HTML".
export const sendTelegramChannelPhoto = async ({ chatId, photoUrl, caption = "", replyMarkup = null, parseMode = "", token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safePhoto = text(photoUrl);
  if (!safeChatId) throw new TelegramApiError("Telegram chat id is missing", { status: 409, code: "TELEGRAM_CHAT_ID_MISSING" });
  if (!safePhoto) throw new TelegramApiError("Telegram photo url is missing", { status: 400, code: "TELEGRAM_PHOTO_REQUIRED" });
  const result = await telegramApiRequest("sendPhoto", {
    chat_id: safeChatId,
    photo: safePhoto,
    ...(text(caption) ? { caption: text(caption) } : {}),
    ...(text(parseMode) ? { parse_mode: text(parseMode) } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, { token, fetchImpl, timeoutMs: TELEGRAM_MEDIA_TIMEOUT_MS });
  return { message_id: text(result?.message_id), result };
};

export const sendTelegramChannelText = async ({ chatId, messageText, replyMarkup = null, disablePreview = false, parseMode = "", token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeMessage = text(messageText);
  if (!safeChatId) throw new TelegramApiError("Telegram chat id is missing", { status: 409, code: "TELEGRAM_CHAT_ID_MISSING" });
  if (!safeMessage) throw new TelegramApiError("Telegram message is empty", { status: 400, code: "TELEGRAM_MESSAGE_EMPTY" });
  const result = await telegramApiRequest("sendMessage", {
    chat_id: safeChatId,
    text: safeMessage,
    ...(disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
    ...(text(parseMode) ? { parse_mode: text(parseMode) } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, { token, fetchImpl });
  return { message_id: text(result?.message_id), result };
};

export const editTelegramMessageCaption = async ({ chatId, messageId, caption = "", replyMarkup = null, parseMode = "", token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeMessageId = text(messageId);
  if (!safeChatId || !safeMessageId) throw new TelegramApiError("Telegram edit target is incomplete", { status: 400, code: "TELEGRAM_EDIT_TARGET_REQUIRED" });
  const result = await telegramApiRequest("editMessageCaption", {
    chat_id: safeChatId,
    message_id: Number(safeMessageId),
    ...(text(caption) ? { caption: text(caption) } : {}),
    ...(text(parseMode) ? { parse_mode: text(parseMode) } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, { token, fetchImpl });
  return { message_id: text(result?.message_id) || safeMessageId, result };
};

// Only reached when the colour's PHOTO changed. editMessageCaption cannot swap
// the image, and a post showing last season's photo under this season's caption
// is worse than a new post.
export const editTelegramMessagePhoto = async ({ chatId, messageId, photoUrl, caption = "", replyMarkup = null, parseMode = "", token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeMessageId = text(messageId);
  const safePhoto = text(photoUrl);
  if (!safeChatId || !safeMessageId || !safePhoto) throw new TelegramApiError("Telegram media edit target is incomplete", { status: 400, code: "TELEGRAM_MEDIA_EDIT_TARGET_REQUIRED" });
  const result = await telegramApiRequest("editMessageMedia", {
    chat_id: safeChatId,
    message_id: Number(safeMessageId),
    media: { type: "photo", media: safePhoto, ...(text(caption) ? { caption: text(caption) } : {}), ...(text(parseMode) ? { parse_mode: text(parseMode) } : {}) },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, { token, fetchImpl, timeoutMs: TELEGRAM_MEDIA_TIMEOUT_MS });
  return { message_id: text(result?.message_id) || safeMessageId, result };
};


// The pinned index is a TEXT message, not a photo caption, so it needs its own
// edit call: editMessageCaption refuses a message that has no caption.
export const editTelegramMessageText = async ({ chatId, messageId, messageText, replyMarkup = null, parseMode = "", disablePreview = true, token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeMessageId = text(messageId);
  const safeMessage = text(messageText);
  if (!safeChatId || !safeMessageId || !safeMessage) throw new TelegramApiError("Telegram text edit target is incomplete", { status: 400, code: "TELEGRAM_TEXT_EDIT_TARGET_REQUIRED" });
  const result = await telegramApiRequest("editMessageText", {
    chat_id: safeChatId,
    message_id: Number(safeMessageId),
    text: safeMessage,
    ...(text(parseMode) ? { parse_mode: text(parseMode) } : {}),
    ...(disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, { token, fetchImpl });
  return { message_id: text(result?.message_id) || safeMessageId, result };
};

// Pinning needs its own channel right, which the other three do not imply. A
// refusal here must not lose the index message that was just posted, so the
// caller treats it as a warning rather than a failure.
export const pinTelegramMessage = async ({ chatId, messageId, token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeMessageId = text(messageId);
  if (!safeChatId || !safeMessageId) return { pinned: false, reason: "incomplete_target" };
  try {
    await telegramApiRequest("pinChatMessage", {
      chat_id: safeChatId,
      message_id: Number(safeMessageId),
      disable_notification: true,
    }, { token, fetchImpl });
    return { pinned: true };
  } catch (error) {
    return { pinned: false, reason: text(error?.message).slice(0, 200) };
  }
};

export const deleteTelegramMessage = async ({ chatId, messageId, token, fetchImpl } = {}) => {
  const safeChatId = text(chatId);
  const safeMessageId = text(messageId);
  if (!safeChatId || !safeMessageId) throw new TelegramApiError("Telegram delete target is incomplete", { status: 400, code: "TELEGRAM_DELETE_TARGET_REQUIRED" });
  await telegramApiRequest("deleteMessage", { chat_id: safeChatId, message_id: Number(safeMessageId) }, { token, fetchImpl });
  return { deleted: true };
};

export const answerTelegramCallbackQuery = async ({ callbackQueryId, notice = "", token, fetchImpl } = {}) => {
  const safeId = text(callbackQueryId);
  if (!safeId) return { answered: false };
  await telegramApiRequest("answerCallbackQuery", {
    callback_query_id: safeId,
    ...(text(notice) ? { text: text(notice) } : {}),
  }, { token, fetchImpl }).catch(() => null);
  return { answered: true };
};

// The chat's own button, so a shopper who opened the bot from any post can
// browse the whole shop without going back to a channel.
export const setTelegramChatMenuWebApp = async ({ label = "", url = "", token, fetchImpl } = {}) => {
  const safeUrl = text(url);
  if (!safeUrl) return { updated: false };
  await telegramApiRequest("setChatMenuButton", {
    menu_button: { type: "web_app", text: text(label) || "Shop", web_app: { url: safeUrl } },
  }, { token, fetchImpl });
  return { updated: true };
};

// --------------------------------------------------------------------------
// Deep links.
//
// A channel post CANNOT carry a mini-app button: Telegram allows web_app
// buttons only in a private chat with the bot. So the order button is a plain
// URL into the bot (`t.me/<bot>?start=<payload>`), and the bot answers with the
// mini app. The payload is limited to 64 characters of [A-Za-z0-9_-], which an
// Arabic colour key would blow straight through -- hence an opaque token
// derived from the card id and stored next to the post.
// --------------------------------------------------------------------------

export const TELEGRAM_PARSE_MODE_HTML = "HTML";

export const TELEGRAM_DEEPLINK_PREFIX = "c";

export const telegramDeepLinkToken = (cardId = "") => {
  const safeCardId = text(cardId);
  if (!safeCardId) return "";
  return `${TELEGRAM_DEEPLINK_PREFIX}${crypto.createHash("sha1").update(safeCardId).digest("hex").slice(0, 12)}`;
};

export const telegramDeepLinkUrl = ({ botUsername = "", token = "" } = {}) => {
  const bot = text(botUsername).replace(/^@+/, "");
  const payload = text(token);
  if (!bot || !payload) return "";
  return `https://t.me/${bot}?start=${encodeURIComponent(payload)}`;
};

// "/start c1a2b3", "/start@shop_bot c1a2b3" and a bare "/start" all land here.
export const telegramStartPayload = (messageText = "") => {
  // The lookahead is what keeps an ordinary word starting with "/start"
  // ("/started") from being read as the command and swallowing a real message.
  const match = /^\/start(?:@[\w_]+)?(?=\s|$)(?:\s+(\S+))?/i.exec(text(messageText));
  if (!match) return null;
  return { command: "start", payload: text(match[1]) };
};

export const normalizeTelegramCallbackQuery = (update = {}) => {
  const query = update?.callback_query;
  if (!query || typeof query !== "object") return null;
  const callbackQueryId = text(query.id);
  const userId = text(query.from?.id);
  const chatId = text(query.message?.chat?.id);
  if (!callbackQueryId || !userId) return null;
  const firstName = text(query.from?.first_name);
  const lastName = text(query.from?.last_name);
  const username = text(query.from?.username);
  return {
    update_id: Number(update.update_id),
    channel: TELEGRAM_CHANNEL,
    callback_query_id: callbackQueryId,
    data: text(query.data),
    chat_id: chatId,
    user_id: userId,
    // A callback from a CHANNEL post has no private chat to reply into: the bot
    // can only answer the query itself until the shopper opens the bot.
    is_private: text(query.message?.chat?.type) === "private",
    session_id: chatId ? `telegram:${chatId}` : "",
    customer_name: [firstName, lastName].filter(Boolean).join(" ") || (username ? `@${username}` : `Telegram ${userId}`),
    first_name: firstName,
    last_name: lastName,
    username,
  };
};

// Our own catalog posts, echoed back because the bot is an administrator of the
// channel. They are NOT conversations and must never reach the inbox -- but the
// chat id in them is the one thing that is otherwise awkward to find, so the
// intake surfaces it once per channel instead of dropping the update silently.
export const normalizeTelegramChannelPost = (update = {}) => {
  const post = update?.channel_post || update?.edited_channel_post;
  if (!post || typeof post !== "object") return null;
  const chatId = text(post.chat?.id);
  if (!chatId) return null;
  return {
    update_id: Number(update.update_id),
    chat_id: chatId,
    chat_title: text(post.chat?.title),
    chat_username: text(post.chat?.username),
    message_id: text(post.message_id),
    edited: Boolean(update?.edited_channel_post),
  };
};

// The bot being added to, promoted in, demoted from or removed from a chat.
// Two jobs: it is how a catalog channel's chat id is discovered during setup,
// and it is the only warning we get when someone strips the bot's rights and a
// channel quietly stops updating its sizes.
export const normalizeTelegramMembershipChange = (update = {}) => {
  const change = update?.my_chat_member;
  if (!change || typeof change !== "object") return null;
  const chatId = text(change.chat?.id);
  if (!chatId) return null;
  const status = text(change.new_chat_member?.status);
  const rights = change.new_chat_member || {};
  return {
    update_id: Number(update.update_id),
    chat_id: chatId,
    chat_title: text(change.chat?.title),
    chat_type: text(change.chat?.type),
    chat_username: text(change.chat?.username),
    status,
    // Posting is the one right the catalogue cannot work without; editing is
    // what keeps the sizes current after the post exists.
    can_post: rights.can_post_messages === true,
    can_edit: rights.can_edit_messages === true,
    can_delete: rights.can_delete_messages === true,
    lost_access: ["left", "kicked", "restricted"].includes(status),
  };
};

const telegramMessage = (update = {}) => update?.message || update?.edited_message || null;

const chooseTelegramFile = (message = {}) => {
  const photos = asArray(message.photo);
  if (photos.length) return { ...photos[photos.length - 1], type: "photo", mime_type: "image/jpeg", file_name: "photo.jpg" };
  for (const type of ["document", "voice", "video", "sticker"]) {
    if (message[type]?.file_id) return { ...message[type], type };
  }
  return null;
};

export const normalizeTelegramUpdate = (update = {}) => {
  const message = telegramMessage(update);
  if (!message || typeof message !== "object") return null;
  const chatId = text(message.chat?.id);
  const userId = text(message.from?.id);
  const messageId = text(message.message_id);
  if (!chatId || !userId || !messageId) return null;
  const firstName = text(message.from?.first_name);
  const lastName = text(message.from?.last_name);
  const username = text(message.from?.username);
  const customerName = [firstName, lastName].filter(Boolean).join(" ") || (username ? `@${username}` : `Telegram ${userId}`);
  const file = chooseTelegramFile(message);
  return {
    update_id: Number(update.update_id),
    channel: TELEGRAM_CHANNEL,
    session_id: `telegram:${chatId}`,
    chat_id: chatId,
    user_id: userId,
    message_id: messageId,
    provider_message_id: messageId,
    text: text(message.text || message.caption),
    caption: text(message.caption),
    customer_name: customerName,
    first_name: firstName,
    last_name: lastName,
    username,
    timestamp: Number(message.date) > 0 ? new Date(Number(message.date) * 1000).toISOString() : new Date().toISOString(),
    file,
  };
};

const isAllowedMime = (mime = "", type = "") => {
  const normalized = text(mime).toLowerCase().split(";")[0];
  if (!normalized) return ["document", "sticker"].includes(text(type).toLowerCase());
  return ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || ALLOWED_DOCUMENT_MIMES.has(normalized);
};

const safeFilePath = (value = "") => {
  const candidate = text(value).replace(/\\/g, "/");
  if (!candidate || candidate.includes("..") || candidate.startsWith("/") || !/^[a-zA-Z0-9_./-]+$/.test(candidate)) return "";
  return candidate.split("/").filter(Boolean).map(encodeURIComponent).join("/");
};

const storeTelegramFile = async ({ bytes, messageId, type, mimeType, storageRoot = process.cwd() } = {}) => {
  const safeMessageId = text(messageId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || crypto.randomUUID();
  const safeType = text(type).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "file";
  const extension = MIME_EXTENSIONS.get(text(mimeType).toLowerCase().split(";")[0]) || (safeType === "sticker" ? "webp" : "bin");
  const directory = path.join(storageRoot, "uploads", "inbox-media", TELEGRAM_CHANNEL);
  await fs.mkdir(directory, { recursive: true });
  const fileName = `${safeMessageId}-${safeType}.${extension}`;
  await fs.writeFile(path.join(directory, fileName), bytes);
  return `/uploads/inbox-media/${TELEGRAM_CHANNEL}/${fileName}`;
};

export const materializeTelegramFile = async ({ normalizedMessage, token = telegramBotToken(), fetchImpl = fetch, storageRoot = process.cwd(), publicBaseUrl = process.env.PUBLIC_BACKEND_URL || "" } = {}) => {
  const file = normalizedMessage?.file;
  if (!file?.file_id) return [];
  const base = { type: file.type, media_type: file.type, file_id: text(file.file_id), file_unique_id: text(file.file_unique_id), file_name: text(file.file_name), mime_type: text(file.mime_type), file_size: Number(file.file_size) || 0 };
  if (base.file_size > TELEGRAM_MAX_DOWNLOAD_BYTES) return [{ ...base, download_status: "failed", download_error: "media_too_large" }];
  if (!isAllowedMime(base.mime_type, base.type)) return [{ ...base, download_status: "failed", download_error: "media_type_not_allowed" }];
  try {
    const fileInfo = await telegramApiRequest("getFile", { file_id: base.file_id }, { token, fetchImpl });
    const filePath = safeFilePath(fileInfo?.file_path);
    const fileSize = Number(fileInfo?.file_size || base.file_size || 0);
    if (!filePath) throw new TelegramApiError("Telegram returned an invalid file path", { code: "TELEGRAM_FILE_PATH_INVALID" });
    if (fileSize > TELEGRAM_MAX_DOWNLOAD_BYTES) throw new TelegramApiError("Telegram media exceeds the download limit", { status: 413, code: "TELEGRAM_MEDIA_TOO_LARGE" });
    const response = await fetchWithTimeout(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`, {}, fetchImpl);
    if (!response.ok) throw new TelegramApiError("Telegram media download failed", { status: 502, code: "TELEGRAM_MEDIA_DOWNLOAD_FAILED" });
    const declaredLength = Number(response.headers?.get?.("content-length") || 0);
    if (declaredLength > TELEGRAM_MAX_DOWNLOAD_BYTES) throw new TelegramApiError("Telegram media exceeds the download limit", { status: 413, code: "TELEGRAM_MEDIA_TOO_LARGE" });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > TELEGRAM_MAX_DOWNLOAD_BYTES) throw new TelegramApiError("Telegram media has an invalid size", { status: 413, code: "TELEGRAM_MEDIA_SIZE_INVALID" });
    const responseMime = text(response.headers?.get?.("content-type") || base.mime_type).split(";")[0];
    if (!isAllowedMime(responseMime, base.type)) throw new TelegramApiError("Telegram media type is not allowed", { status: 415, code: "TELEGRAM_MEDIA_TYPE_INVALID" });
    const localPath = await storeTelegramFile({ bytes, messageId: `${normalizedMessage.chat_id}-${normalizedMessage.message_id}`, type: base.type, mimeType: responseMime, storageRoot });
    const origin = text(publicBaseUrl).replace(/\/+$/g, "");
    return [{ ...base, url: origin ? `${origin}${localPath}` : localPath, media_url: origin ? `${origin}${localPath}` : localPath, mime_type: responseMime, file_size: bytes.length, download_status: "stored", materialized: true }];
  } catch (error) {
    return [{ ...base, download_status: "failed", download_error: safeErrorText(error?.code || error?.message || "media_download_failed") }];
  }
};

export const telegramAttachmentLabel = (attachments = []) => {
  const type = text(asArray(attachments)[0]?.type).toLowerCase();
  if (["photo", "image"].includes(type)) return "صورة";
  if (type === "voice") return "رسالة صوتية";
  if (type === "video") return "فيديو";
  if (type === "sticker") return "ملصق";
  if (type === "document") return "مستند";
  return "مرفق";
};
