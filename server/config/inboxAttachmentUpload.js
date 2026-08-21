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

if (!fs.existsSync(INBOX_ATTACHMENT_DIR)) {
  fs.mkdirSync(INBOX_ATTACHMENT_DIR, { recursive: true });
}

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

const inboxAttachmentUpload = multer({
  storage,
  fileFilter: (req, file, cb) => (isPotentialImageUpload(file) ? cb(null, true) : cb(new Error("Images only"))),
  limits: {
    // WhatsApp rejects media over 5 MB on the Evolution transport and Meta caps
    // image attachments at 8 MB, so accepting more only produces a send that
    // fails after the operator has already waited for the upload.
    fileSize: Number(process.env.INBOX_ATTACHMENT_MAX_BYTES || 5 * 1024 * 1024),
    files: 1,
  },
});

export default inboxAttachmentUpload;
