// Inbound media materialization shared by every customer channel.
//
// Providers hand us media in three incompatible shapes:
//   - Messenger / Instagram DM  -> a signed CDN URL (lookaside/scontent) that
//     expires and is not guaranteed to be loadable from our own frontend origin.
//   - WhatsApp Cloud API        -> no URL at all, only a `media_id` that has to
//     be resolved through the Graph API with the page token, then downloaded
//     with that same token.
//   - WhatsApp via Evolution    -> already materialized by whatsappGatewayService.
//
// Storing the provider URL as-is means the AI inbox shows a bare "[attachment]"
// bubble the moment the link dies (or never worked, as with Cloud API media
// ids). So every inbound attachment is downloaded once at webhook time and
// re-hosted under /uploads/inbox-media, exactly like the Evolution path already
// does. The provider URL is kept as `remote_url` for debugging, and any failure
// falls back to the original URL instead of dropping the attachment.
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
// Meta drops the webhook connection at ~20s and retries, and this runs inline in
// that request, so a stalled CDN must never eat the whole budget.
const FETCH_TIMEOUT_MS = 8000;
const MEDIA_FOLDER = "inbox-media";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const inboundMediaPublicBaseUrl = () => text(
  process.env.PUBLIC_BACKEND_URL || process.env.PUBLIC_BASE_URL || process.env.WEBHOOK_PUBLIC_URL || ""
).replace(/\/api\/?$/i, "").replace(/\/+$/g, "");

const whatsappCloudAccessToken = () => text(
  process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_ACCESS_TOKEN ||
    ""
);

const EXTENSION_BY_MIME = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const EXTENSION_BY_TYPE = {
  image: "jpg",
  sticker: "webp",
  video: "mp4",
  audio: "ogg",
  voice: "ogg",
  ptt: "ogg",
  document: "bin",
  file: "bin",
  // A story frame is a JPEG; the CDN link carries no extension and Meta's
  // response occasionally arrives without a content type.
  story: "jpg",
  story_reply: "jpg",
  story_mention: "jpg",
};

export const inboundMediaExtension = (mimeType = "", mediaType = "") => {
  const normalizedMime = text(mimeType).toLowerCase().split(";")[0];
  return EXTENSION_BY_MIME[normalizedMime] || EXTENSION_BY_TYPE[text(mediaType).toLowerCase()] || "bin";
};

const IMAGE_TYPES = ["image", "sticker", "photo"];
const VIDEO_TYPES = ["video", "animated_image", "gif"];
const AUDIO_TYPES = ["audio", "voice", "ptt"];

// Providers disagree on the field name, and Messenger nests the real link one
// level down inside `payload`.
export const inboundAttachmentUrl = (attachment = {}) => text(
  attachment.url ||
    attachment.image_url ||
    attachment.media_url ||
    attachment.attachment_url ||
    attachment.file_url ||
    attachment.link ||
    attachment.payload?.url ||
    attachment.payload?.image_url ||
    attachment.media?.url ||
    attachment.media?.image?.src ||
    ""
);

const inboundAttachmentMediaId = (attachment = {}) => text(
  attachment.media_id ||
    attachment.mediaId ||
    attachment.metadata?.media_id ||
    attachment.metadata?.mediaId ||
    attachment.payload?.media_id ||
    ""
);

const inboundAttachmentType = (attachment = {}) => text(
  attachment.type || attachment.media_type || attachment.message_type || ""
).toLowerCase() || "file";

const inboundAttachmentMime = (attachment = {}) => text(
  attachment.mime_type || attachment.mimeType || attachment.metadata?.mime_type || attachment.metadata?.mimeType || ""
);

// The transcript bubble used to read "[attachment]" in an otherwise Arabic UI,
// which told the agent nothing about what the customer actually sent.
export const inboundAttachmentLabel = (attachments = []) => {
  const types = asArray(attachments).map((attachment) => inboundAttachmentType(attachment));
  if (!types.length) return "";
  // The story label leads, because "📷 صورة" on a story reply reads in the
  // conversation list as a photo the customer sent us.
  if (types.includes("story_mention")) return "📸 منشن في استوري";
  if (types.some((type) => ["story_reply", "story"].includes(type))) return "📸 رد على استوري";
  if (types.some((type) => IMAGE_TYPES.includes(type))) return types.includes("sticker") ? "🌟 ملصق" : "📷 صورة";
  if (types.some((type) => VIDEO_TYPES.includes(type))) return "🎥 فيديو";
  if (types.some((type) => AUDIO_TYPES.includes(type))) return "🎤 رسالة صوتية";
  if (types.some((type) => ["location"].includes(type))) return "📍 موقع";
  return "📎 مرفق";
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// WhatsApp Cloud webhooks carry only `media_id`; the download URL has to be
// resolved first and is itself token-protected and short lived.
const resolveWhatsappCloudMediaUrl = async ({ mediaId = "", accessToken = "" } = {}) => {
  if (!mediaId || !accessToken) return { url: "", mimeType: "" };
  const response = await fetchWithTimeout(
    `${GRAPH_BASE_URL}/${encodeURIComponent(mediaId)}?fields=url,mime_type,file_size`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`whatsapp_media_lookup_failed_${response.status}`);
  const payload = await response.json();
  return { url: text(payload?.url), mimeType: text(payload?.mime_type) };
};

const downloadMedia = async ({ url = "", accessToken = "" } = {}) => {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const response = await fetchWithTimeout(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`media_download_failed_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
    throw new Error("media_too_large");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("media_empty");
  if (bytes.length > MAX_MEDIA_BYTES) throw new Error("media_too_large");
  return { bytes, mimeType: text(response.headers.get("content-type") || "") };
};

const storeMedia = async ({ bytes, channel = "", messageId = "", index = 0, mimeType = "", mediaType = "" } = {}) => {
  const safeChannel = text(channel).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "channel";
  const safeMessageId = text(messageId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) ||
    crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 32);
  const extension = inboundMediaExtension(mimeType, mediaType);
  const directory = path.join(process.cwd(), "uploads", MEDIA_FOLDER, safeChannel);
  await fs.mkdir(directory, { recursive: true });
  const fileName = `${safeMessageId}-${index}.${extension}`;
  await fs.writeFile(path.join(directory, fileName), bytes);
  return `/uploads/${MEDIA_FOLDER}/${safeChannel}/${fileName}`;
};

// Always returns an attachment list of the same length and ordering. Every entry
// is normalized to carry `url` + `media_url` so the inbox renderer has a single
// contract regardless of which provider produced it.
export const materializeInboundAttachments = async ({
  channel = "",
  messageId = "",
  attachments = [],
  accessToken = "",
} = {}) => {
  const list = asArray(attachments);
  if (!list.length) return list;
  const publicBaseUrl = inboundMediaPublicBaseUrl();
  const isWhatsappCloud = text(channel).toLowerCase().includes("whatsapp");
  const token = accessToken || (isWhatsappCloud ? whatsappCloudAccessToken() : "");

  // Attachments are fetched concurrently so a multi-photo message costs one
  // timeout window rather than one per file.
  return Promise.all(list.map(async (attachment, index) => {
    const raw = attachment && typeof attachment === "object" ? attachment : {};
    const type = inboundAttachmentType(raw);
    const remoteUrl = inboundAttachmentUrl(raw);
    const mediaId = inboundAttachmentMediaId(raw);
    const declaredMime = inboundAttachmentMime(raw);
    const base = {
      ...raw,
      type,
      media_type: type,
      url: remoteUrl,
      media_url: remoteUrl,
      remote_url: remoteUrl,
      mime_type: declaredMime,
    };

    if (!remoteUrl && !mediaId) return base;
    if (!publicBaseUrl) {
      // Without a public backend origin a locally stored file is unreachable
      // from the frontend, so keep the provider URL rather than break the link.
      console.warn("[inbound-media] public base url is not configured, keeping provider url", { channel, type });
      return base;
    }

    try {
      let downloadUrl = remoteUrl;
      let mimeType = declaredMime;
      if (!downloadUrl && mediaId) {
        const resolved = await resolveWhatsappCloudMediaUrl({ mediaId, accessToken: token });
        downloadUrl = resolved.url;
        mimeType = resolved.mimeType || mimeType;
      }
      if (!downloadUrl) return base;
      // The Graph download endpoint needs the token; the Messenger CDN must not
      // receive it (it answers 400 on an unexpected Authorization header).
      const downloadToken = downloadUrl.includes("lookaside.fbsbx.com/whatsapp") || (mediaId && !remoteUrl) ? token : "";
      const downloaded = await downloadMedia({ url: downloadUrl, accessToken: downloadToken });
      const localPath = await storeMedia({
        bytes: downloaded.bytes,
        channel,
        messageId,
        index,
        mimeType: downloaded.mimeType || mimeType,
        mediaType: type,
      });
      const publicUrl = `${publicBaseUrl}${localPath}`;
      console.info("[inbound-media] stored", {
        channel,
        type,
        message_id: messageId ? "present" : "",
        bytes: downloaded.bytes.length,
        path: localPath,
      });
      return {
        ...base,
        url: publicUrl,
        media_url: publicUrl,
        remote_url: remoteUrl,
        mime_type: downloaded.mimeType || mimeType,
        file_name: text(raw.file_name || raw.title || "") || path.basename(localPath),
        materialized: true,
      };
    } catch (error) {
      console.warn("[inbound-media] materialization failed, keeping provider url", {
        channel,
        type,
        has_remote_url: Boolean(remoteUrl),
        has_media_id: Boolean(mediaId),
        message: error?.message || String(error),
      });
      return base;
    }
  }));
};
