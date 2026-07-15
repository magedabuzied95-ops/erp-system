import { API_ORIGIN } from "../constants/app";

export const CHAT_ATTACHMENT_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".webm",
  ".m4a",
  ".mp4",
  ".mov",
  ".m4v",
  ".mp3",
  ".wav",
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
]);

const cleanText = (value = "") => String(value ?? "").trim();
const trimSlashes = (value = "") => cleanText(value).replace(/^\/+|\/+$/g, "");
const assetBase = () => cleanText(API_ORIGIN).replace(/\/+$/g, "");

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
};

const attachmentObject = (message = {}) => {
  const value = message?.attachment;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const joinAssetUrl = (path = "") => {
  const base = assetBase();
  const safePath = trimSlashes(path);
  if (!base || !safePath) return "";
  return `${base}/${safePath}`;
};

const fileNameFromUrl = (value = "") => {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text, "https://example.invalid");
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    const last = text.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
};

export const portalChatAttachmentRawUrl = (message = {}) => {
  const attachment = attachmentObject(message);
  return firstText(
    message.attachment_url,
    message.attachmentUrl,
    message.attachment_path,
    message.attachmentPath,
    message.file_url,
    message.fileUrl,
    message.file_path,
    message.filePath,
    message.media_url,
    message.mediaUrl,
    message.public_url,
    message.publicUrl,
    message.url,
    attachment.attachment_url,
    attachment.url,
    attachment.path,
    attachment.file_url,
    attachment.file_path,
    attachment.media_url,
    attachment.public_url
  );
};

export const resolvePortalChatAttachmentUrl = (value = "") => {
  const text = cleanText(value);
  if (!text) return "";
  if (/^(data|blob):/i.test(text)) return text;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/\//.test(text)) return `https:${text}`;
  if (/^(res\.cloudinary\.com|cloudinary\.com)\//i.test(text)) return `https://${text}`;

  const withoutApiPrefix = text.replace(/^\/?api\/uploads(?=\/|$)/i, "uploads");
  if (withoutApiPrefix.startsWith("/uploads/") || withoutApiPrefix.startsWith("uploads/")) return joinAssetUrl(withoutApiPrefix);
  if (withoutApiPrefix.startsWith("/products/")) return joinAssetUrl(`/uploads${withoutApiPrefix}`);
  if (withoutApiPrefix.startsWith("products/")) return joinAssetUrl(`/uploads/${withoutApiPrefix}`);
  if (withoutApiPrefix.startsWith("/product-images/") || withoutApiPrefix.startsWith("product-images/")) return joinAssetUrl(withoutApiPrefix);
  if (withoutApiPrefix.startsWith("/images/products/") || withoutApiPrefix.startsWith("images/products/")) return joinAssetUrl(withoutApiPrefix);
  if (withoutApiPrefix.startsWith("/")) return joinAssetUrl(withoutApiPrefix);
  return joinAssetUrl(`/uploads/employee-chat/${withoutApiPrefix}`);
};

export const portalChatAttachmentUrl = (message = {}) =>
  resolvePortalChatAttachmentUrl(portalChatAttachmentRawUrl(message));

export const portalChatAttachmentMime = (message = {}) => {
  const attachment = attachmentObject(message);
  return firstText(
    message.attachment_mime,
    message.attachment_mime_type,
    message.attachmentMime,
    message.attachmentMimeType,
    message.mime_type,
    message.mimeType,
    message.file_mime,
    message.fileMime,
    attachment.attachment_mime,
    attachment.attachment_mime_type,
    attachment.mime,
    attachment.mime_type,
    attachment.type
  );
};

export const portalChatAttachmentName = (message = {}) => {
  const attachment = attachmentObject(message);
  const rawUrl = portalChatAttachmentRawUrl(message);
  return firstText(
    message.attachment_name,
    message.attachmentName,
    message.file_name,
    message.fileName,
    message.name,
    attachment.attachment_name,
    attachment.file_name,
    attachment.name,
    fileNameFromUrl(rawUrl)
  );
};

const attachmentExtension = (message = {}) => {
  const source = cleanText(portalChatAttachmentName(message) || portalChatAttachmentRawUrl(message))
    .split("?")[0]
    .split("#")[0]
    .toLowerCase();
  return source.match(/\.([a-z0-9]+)$/i)?.[1] || "";
};

export const portalChatAttachmentType = (message = {}) => {
  const attachment = attachmentObject(message);
  const explicit = firstText(
    message.attachment_type,
    message.attachmentType,
    message.file_type,
    message.fileType,
    message.media_type,
    message.mediaType,
    attachment.attachment_type,
    attachment.file_type,
    attachment.media_type
  ).toLowerCase();
  if (["image", "audio", "voice", "video", "file"].includes(explicit)) return explicit === "voice" ? "audio" : explicit;

  const mime = portalChatAttachmentMime(message).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";

  const extension = attachmentExtension(message);
  if (["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension)) return "image";
  if (["m4a", "mp3", "wav", "ogg", "oga"].includes(extension)) return "audio";
  if (["webm", "mp4", "mov", "m4v"].includes(extension)) return "video";
  return portalChatAttachmentRawUrl(message) ? "file" : "";
};

export const portalChatAttachmentSize = (message = {}) => {
  const attachment = attachmentObject(message);
  return message.attachment_size ?? message.attachmentSize ?? message.file_size ?? message.fileSize ?? attachment.attachment_size ?? attachment.file_size ?? 0;
};

export const allowedPortalChatAttachment = (file) => {
  if (!file) return true;
  return ALLOWED_ATTACHMENT_TYPES.has(file.type);
};

export const formatPortalChatFileSize = (value = 0) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const portalChatMessagePreview = (message = {}, labels = {}) => {
  const body = String(message.body || message.reply_body || message.last_message || "").trim();
  if (body) return body.length > 80 ? `${body.slice(0, 77)}...` : body;
  const type = message.reply_attachment_type || portalChatAttachmentType(message);
  if (type === "image") return labels.image || "صورة";
  if (type === "audio") return labels.voice || "رسالة صوتية";
  if (type === "video") return labels.video || "فيديو";
  if (portalChatAttachmentRawUrl(message) || message.reply_attachment_name || portalChatAttachmentName(message)) return labels.file || "ملف";
  return labels.message || "رسالة";
};

export const isPortalChatAudioMessage = (message = {}) =>
  portalChatAttachmentType(message) === "audio";

export const isPortalChatImageMessage = (message = {}) =>
  portalChatAttachmentType(message) === "image";

export const isPortalChatVideoMessage = (message = {}) =>
  portalChatAttachmentType(message) === "video";
