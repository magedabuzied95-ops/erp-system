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
]);

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
  const type = message.attachment_type || message.reply_attachment_type;
  if (type === "image") return labels.image || "صورة";
  if (type === "audio") return labels.voice || "رسالة صوتية";
  if (message.attachment_url || message.reply_attachment_name || message.attachment_name) return labels.file || "ملف";
  return labels.message || "رسالة";
};

export const isPortalChatAudioMessage = (message = {}) =>
  message.attachment_type === "audio" || String(message.attachment_mime || "").startsWith("audio/");

export const isPortalChatImageMessage = (message = {}) =>
  message.attachment_type === "image" || String(message.attachment_mime || "").startsWith("image/");
