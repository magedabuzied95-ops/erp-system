import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const TELEGRAM_CHANNEL = "telegram";
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const TELEGRAM_API_BASE = "https://api.telegram.org";
const FETCH_TIMEOUT_MS = 10_000;

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

const fetchWithTimeout = async (url, options = {}, fetchImpl = fetch) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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

export const telegramApiRequest = async (method, payload = {}, { token = telegramBotToken(), fetchImpl = fetch } = {}) => {
  if (!token) throw new TelegramApiError("Telegram bot token is not configured", { status: 503, code: "TELEGRAM_CONFIG_MISSING" });
  const response = await fetchWithTimeout(`${TELEGRAM_API_BASE}/bot${token}/${encodeURIComponent(text(method))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, fetchImpl);
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
  if (["voice", "audio", "ptt"].includes(normalized)) return { method: "sendVoice", field: "voice" };
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
