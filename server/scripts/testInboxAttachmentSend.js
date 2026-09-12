#!/usr/bin/env node
/*
 * Send one real photo and one real clip to a number, down the exact road the AI
 * Inbox composer uses.
 *
 * Not a unit test — the whole point is the parts a unit test cannot reach: the
 * file has to land in uploads/inbox, the relative URL has to resolve to a public
 * backend origin, Evolution has to be able to FETCH that URL back off our own
 * server, and it has to be told a mediatype and a mimetype that make the
 * recipient's phone draw a photo or a player rather than a broken bubble.
 *
 * It messages a real person, so the number is required and never defaulted:
 *
 *   node server/scripts/testInboxAttachmentSend.js --phone 01xxxxxxxxx
 *   node server/scripts/testInboxAttachmentSend.js --phone 01xxxxxxxxx --only image
 *   node server/scripts/testInboxAttachmentSend.js --phone 01xxxxxxxxx --video /path/to/clip.mp4
 *   node server/scripts/testInboxAttachmentSend.js --phone 0 --dry-run
 *
 * --dry-run stages the files and prints what WOULD be sent, touching no channel.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import {
  INBOX_ATTACHMENT_DIR,
  INBOX_ATTACHMENT_URL_PREFIX,
  INBOX_ATTACHMENT_VIDEO_MAX_BYTES,
  inboxAttachmentKind,
  isSendableInboxVideo,
} from "../config/inboxAttachmentUpload.js";
import { sendWhatsappMediaMessage } from "../services/whatsappGatewayService.js";

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
};

const phone = argValue("--phone");
const only = argValue("--only").toLowerCase();
const videoOverride = argValue("--video");
const instance = argValue("--instance");
const dryRun = process.argv.includes("--dry-run");

if (!phone) {
  console.error("A --phone is required. This sends real WhatsApp messages.");
  process.exit(1);
}

/*
 * A 4-colour PNG built here rather than committed, so the test image is never
 * something that could be mistaken for a catalog asset and cannot rot on disk.
 */
const buildTestPng = (size = 640) => {
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(typed) >>> 0 : crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  // Node exposes zlib.crc32 only from 22.x; keep our own so the script runs on
  // whatever the container happens to be.
  function crc32(buffer) {
    let c = ~0;
    for (const byte of buffer) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const half = size / 2;
      const quadrant = (x < half ? 0 : 1) + (y < half ? 0 : 2);
      const colour = [[194, 65, 12], [14, 165, 233], [22, 163, 74], [234, 179, 8]][quadrant];
      raw[offset] = colour[0];
      raw[offset + 1] = colour[1];
      raw[offset + 2] = colour[2];
      offset += 3;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const stage = (fileName, buffer) => {
  fs.mkdirSync(INBOX_ATTACHMENT_DIR, { recursive: true });
  const staged = `${Date.now()}-${fileName}`;
  fs.writeFileSync(path.join(INBOX_ATTACHMENT_DIR, staged), buffer);
  return { fileName: staged, url: `${INBOX_ATTACHMENT_URL_PREFIX}/${staged}`, bytes: buffer.length };
};

const resolveSampleVideo = () => {
  if (videoOverride) return videoOverride;
  // Ships with the repo, so it is already on the server the deploy pulled to.
  const bundled = path.join(process.cwd(), "public", "media", "hero-walk.mp4");
  return fs.existsSync(bundled) ? bundled : "";
};

const run = async () => {
  const results = [];

  if (only !== "video") {
    const image = stage("inbox-attachment-test.png", buildTestPng());
    console.log(`[image] staged ${image.url} (${Math.round(image.bytes / 1024)} KB)`);
    if (dryRun) {
      results.push({ kind: "image", ok: true, url: image.url, id: "dry-run" });
    } else try {
      const sent = await sendWhatsappMediaMessage({
        phone,
        mediaUrl: image.url,
        mediaType: "image",
        caption: "اختبار إرسال صورة من الإنبوكس ✅",
        instance,
      });
      results.push({ kind: "image", ok: true, url: sent?.mediaUrl || image.url, id: sent?.result?.key?.id || "" });
    } catch (error) {
      results.push({ kind: "image", ok: false, error: error?.message || String(error), code: error?.code || "" });
    }
  }

  if (only !== "image") {
    const source = resolveSampleVideo();
    if (!source) {
      results.push({ kind: "video", ok: false, error: "No sample video found; pass --video /path/to/clip.mp4" });
    } else {
      const buffer = fs.readFileSync(source);
      const descriptor = { originalname: path.basename(source), mimetype: "" };
      if (inboxAttachmentKind(descriptor) !== "video" || !isSendableInboxVideo(descriptor)) {
        results.push({ kind: "video", ok: false, error: `${path.basename(source)} is not a container the channels carry` });
      } else if (buffer.length > INBOX_ATTACHMENT_VIDEO_MAX_BYTES) {
        results.push({ kind: "video", ok: false, error: `${Math.round(buffer.length / (1024 * 1024))} MB is over the ${Math.round(INBOX_ATTACHMENT_VIDEO_MAX_BYTES / (1024 * 1024))} MB ceiling` });
      } else {
        const video = stage(path.basename(source), buffer);
        console.log(`[video] staged ${video.url} (${Math.round(video.bytes / 1024)} KB)`);
        if (dryRun) {
          results.push({ kind: "video", ok: true, url: video.url, id: "dry-run" });
        } else try {
          const sent = await sendWhatsappMediaMessage({
            phone,
            mediaUrl: video.url,
            mediaType: "video",
            caption: "اختبار إرسال فيديو من الإنبوكس ✅",
            instance,
          });
          results.push({ kind: "video", ok: true, url: sent?.mediaUrl || video.url, id: sent?.result?.key?.id || "" });
        } catch (error) {
          results.push({ kind: "video", ok: false, error: error?.message || String(error), code: error?.code || "" });
        }
      }
    }
  }

  console.log("\n=== inbox attachment send ===");
  for (const result of results) {
    console.log(result.ok
      ? `  ${result.kind.padEnd(5)} SENT   ${result.url}${result.id ? `  id=${result.id}` : ""}`
      : `  ${result.kind.padEnd(5)} FAILED ${result.error}${result.code ? `  [${result.code}]` : ""}`);
  }
  process.exit(results.every((result) => result.ok) ? 0 : 1);
};

run().catch((error) => {
  console.error("inbox attachment test crashed:", error?.message || error);
  process.exit(1);
});
