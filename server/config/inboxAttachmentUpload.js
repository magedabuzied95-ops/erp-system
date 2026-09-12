import multer from "multer";
import fs from "node:fs";
import path from "node:path";

import { isPotentialImageUpload } from "../utils/imageUploadValidation.js";

/*
 * Attachments an operator sends from the AI Inbox.
 *
 * Deliberately NOT uploads/products: a conversation attachment is not a catalog
 * asset, and the product directory is watched, variant-generated, and has its
 * own recovery tooling. Mixing the two would mean a stray customer photo looks
 * like a product image that lost its row.
 *
 * Files land on disk and are sent to the channel by URL — WhatsApp, Meta and
 * Telegram all fetch the media themselves rather than accepting an upload — so
 * the directory has to be publicly served, exactly like /uploads/products.
 */
export const INBOX_ATTACHMENT_DIR = path.join(process.cwd(), "uploads", "inbox");
export const INBOX_ATTACHMENT_URL_PREFIX = "/uploads/inbox";

// Every channel takes a clip by URL, but each one names its own ceiling: the
// Evolution WhatsApp transport is the tightest at 16 MB, so that is the number
// the composer is held to rather than one that fails per-channel.
export const INBOX_ATTACHMENT_IMAGE_MAX_BYTES = Number(process.env.INBOX_ATTACHMENT_MAX_BYTES || 8 * 1024 * 1024);
export const INBOX_ATTACHMENT_VIDEO_MAX_BYTES = Number(process.env.INBOX_ATTACHMENT_VIDEO_MAX_BYTES || 16 * 1024 * 1024);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".3gp", ".3gpp", ".webm", ".mkv", ".avi"]);

/*
 * Videos an operator can send.
 *
 * Deliberately narrow. WhatsApp, Messenger and Instagram all want H.264/AAC in
 * an MP4 container; a .mkv or .avi would upload happily and then be refused by
 * the channel after the operator had waited for the whole transfer, so the ones
 * that cannot travel are turned away here where the message can say why.
 */
const SENDABLE_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
  "video/x-m4v",
]);
const SENDABLE_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".3gp", ".3gpp"]);

const extensionOf = (file = {}) => path.extname(String(file.originalname || "")).toLowerCase();
const mimeOf = (file = {}) => String(file.mimetype || "").trim().toLowerCase();

/** "image" | "video" | "" — what the operator actually picked. */
export const inboxAttachmentKind = (file = {}) => {
  const mimetype = mimeOf(file);
  const extension = extensionOf(file);
  if (mimetype.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "video";
  // isPotentialImageUpload treats an unknown mime as an image, so it is only
  // consulted AFTER video has had its say.
  return isPotentialImageUpload(file) ? "image" : "";
};

export const isSendableInboxVideo = (file = {}) =>
  SENDABLE_VIDEO_MIME_TYPES.has(mimeOf(file)) || SENDABLE_VIDEO_EXTENSIONS.has(extensionOf(file));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INBOX_ATTACHMENT_DIR),
  filename: (req, file, cb) => {
    const safeOriginal = String(file.originalname || "attachment")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120);
    cb(null, `${Date.now()}-${safeOriginal}`);
  },
});

const rejectUpload = (message, code) => Object.assign(new Error(message), { code });

const inboxAttachmentUpload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const kind = inboxAttachmentKind(file);
    if (kind === "image") return cb(null, true);
    if (kind !== "video") return cb(rejectUpload("Only images and videos can be sent from the inbox.", "ATTACHMENT_KIND_UNSUPPORTED"));
    if (!isSendableInboxVideo(file)) {
      return cb(rejectUpload("That video format cannot be sent — save it as MP4 first.", "ATTACHMENT_VIDEO_FORMAT"));
    }
    return cb(null, true);
  },
  limits: {
    // One ceiling for the transfer; the per-kind caps above are enforced in the
    // route, which knows whether it received a photo or a clip. multer only
    // learns the size as the bytes arrive, so this is the hard stop.
    fileSize: Math.max(INBOX_ATTACHMENT_IMAGE_MAX_BYTES, INBOX_ATTACHMENT_VIDEO_MAX_BYTES),
    files: 1,
  },
});

export default inboxAttachmentUpload;
