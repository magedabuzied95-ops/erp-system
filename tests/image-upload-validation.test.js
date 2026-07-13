import test from "node:test";
import assert from "node:assert/strict";

import {
  detectImageFormat,
  getImageFormatDetails,
  isPotentialImageUpload,
} from "../server/utils/imageUploadValidation.js";

test("accepts common browser and phone image declarations for content inspection", () => {
  assert.equal(isPotentialImageUpload({ originalname: "photo.jfif", mimetype: "image/jpeg" }), true);
  assert.equal(isPotentialImageUpload({ originalname: "IMG_1001.HEIC", mimetype: "application/octet-stream" }), true);
  assert.equal(isPotentialImageUpload({ originalname: "pasted-image", mimetype: "image/png" }), true);
  assert.equal(isPotentialImageUpload({ originalname: "payload.exe", mimetype: "application/x-msdownload" }), false);
});

test("detects supported formats from their bytes instead of trusting the filename", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");
  const gif = Buffer.from("GIF89a000000", "ascii");
  const avif = Buffer.from("0000ftypavif00000000", "ascii");
  const heic = Buffer.from("0000ftypheic00000000", "ascii");

  assert.equal(detectImageFormat(jpeg), "jpeg");
  assert.equal(detectImageFormat(png), "png");
  assert.equal(detectImageFormat(webp), "webp");
  assert.equal(detectImageFormat(gif), "gif");
  assert.equal(detectImageFormat(avif), "avif");
  assert.equal(detectImageFormat(heic), "heif");
  assert.equal(detectImageFormat(Buffer.from("not an image")), null);
});

test("returns canonical delivery metadata for detected formats", () => {
  assert.deepEqual(getImageFormatDetails("jpeg"), { extension: ".jpg", mimetype: "image/jpeg" });
  assert.equal(getImageFormatDetails("unknown"), null);
});
