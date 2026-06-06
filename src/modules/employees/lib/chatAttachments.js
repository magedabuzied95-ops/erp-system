import { API_BASE_URL, API_ORIGIN } from "../../../shared/constants/app";
import { resolvePortalChatAttachmentUrl } from "../../../shared/chat/portalChatUtils";

const assetBase = () => String(API_ORIGIN || "").trim().replace(/\/+$/g, "");

const currentOrigin = () => {
  try {
    return typeof window !== "undefined" ? window.location.origin || "" : "";
  } catch {
    return "";
  }
};

const currentProtocol = () => {
  try {
    return typeof window !== "undefined" ? window.location.protocol || "https:" : "https:";
  } catch {
    return "https:";
  }
};

export const normalizeChatAttachmentUrl = (value = "") => {
  return resolvePortalChatAttachmentUrl(value);
};

export const resolveEmployeeChatAttachmentUrl = normalizeChatAttachmentUrl;

export const logResolvedChatImageUrl = (label, message = {}, originalValue = "", normalizedSrc = "") => {
  if (!label || !normalizedSrc) return;
  console.info(label, {
    attachment_url: originalValue || "",
    normalized_src: normalizedSrc,
    message_id: message?.id ?? null,
    API_ORIGIN: assetBase(),
    window_location_origin: currentOrigin(),
    api_base_url: String(API_BASE_URL || "").trim(),
    sender_type: message?.sender_type || "",
    protocol: currentProtocol(),
  });
};

export const normalizeAudioDuration = (value, { milliseconds = false } = {}) => {
  if (typeof value === "string" && value.includes(":")) {
    const parts = value.split(":").map((part) => Number(part));
    if (parts.every((part) => Number.isFinite(part) && part >= 0)) {
      return parts.reduce((total, part) => total * 60 + part, 0) || 0;
    }
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return milliseconds ? number / 1000 : number;
};

export const messageAttachmentDuration = (message = {}) => {
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const secondsCandidates = [
    message.duration,
    message.audio_duration,
    message.voice_duration,
    message.attachment_duration,
    message.attachment_duration_seconds,
    message.attachmentDuration,
    metadata.duration,
    metadata.audio_duration,
    metadata.voice_duration,
  ];

  for (const candidate of secondsCandidates) {
    const duration = normalizeAudioDuration(candidate);
    if (duration > 0) return duration;
  }

  const millisecondsCandidates = [
    message.duration_ms,
    message.audio_duration_ms,
    message.voice_duration_ms,
    message.attachment_duration_ms,
    metadata.duration_ms,
    metadata.audio_duration_ms,
    metadata.voice_duration_ms,
  ];

  for (const candidate of millisecondsCandidates) {
    const duration = normalizeAudioDuration(candidate, { milliseconds: true });
    if (duration > 0) return duration;
  }

  return 0;
};
