/*
 * Photos a customer attaches to a product review.
 *
 * Same shape as the payment-proof upload next door: disk storage under /uploads, a filename
 * nothing from the request can steer, and an allow-list of three image types. Two differences,
 * both deliberate — a review carries up to five photos rather than one, and the name is
 * generated rather than derived from the original, because a review photo is published on a
 * public page and the file the customer chose may be called anything at all.
 */

import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";

export const REVIEW_PHOTO_DIR = path.join(process.cwd(), "uploads", "reviews");
export const REVIEW_PHOTO_MAX_FILES = 5;

if (!fs.existsSync(REVIEW_PHOTO_DIR)) {
  fs.mkdirSync(REVIEW_PHOTO_DIR, { recursive: true });
}

const extensionByType = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REVIEW_PHOTO_DIR),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extensionByType[file.mimetype] || ".jpg"}`),
});

const reviewPhotoUpload = multer({
  storage,
  fileFilter: (_req, file, cb) =>
    (extensionByType[file.mimetype] ? cb(null, true) : cb(new Error("INVALID_REVIEW_PHOTO_TYPE"))),
  limits: {
    fileSize: Number(process.env.REVIEW_PHOTO_MAX_BYTES || 8 * 1024 * 1024),
    files: REVIEW_PHOTO_MAX_FILES,
  },
});

export default reviewPhotoUpload;
