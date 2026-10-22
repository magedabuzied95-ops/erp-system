import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  defaultSharePostSource,
  normalizeSharePostSource,
  persistSharePostCover,
} from "../server/services/inboxSharePostsService.js";
import { INBOX_ATTACHMENT_DIR } from "../server/config/inboxAttachmentUpload.js";
import { sharedMediaBucket, sharedMediaKind } from "../src/shared/lib/sharedInboundMedia.js";

test("the sheet opens on the conversation's own platform", () => {
  assert.equal(defaultSharePostSource("instagram"), "instagram");
  assert.equal(defaultSharePostSource("facebook_messenger"), "facebook");
  assert.equal(defaultSharePostSource("tiktok"), "tiktok");
  // WhatsApp and Telegram have no posts of their own; Instagram is the shop's shelf.
  assert.equal(defaultSharePostSource("whatsapp"), "instagram");
  assert.equal(defaultSharePostSource("telegram"), "instagram");
});

test("only the three post sources are accepted", () => {
  assert.equal(normalizeSharePostSource("IG"), "instagram");
  assert.equal(normalizeSharePostSource("messenger"), "facebook");
  assert.equal(normalizeSharePostSource("tiktok"), "tiktok");
  assert.equal(normalizeSharePostSource("whatsapp"), "");
  assert.equal(normalizeSharePostSource("../etc"), "");
});

test("a sent post renders as a forwarded-post bubble with its cover as a picture", () => {
  const attachment = { type: "image", url: "/uploads/inbox/shared-instagram-1.jpg", mime_type: "image/jpeg", metadata: { share_kind: "reel", share_link: "https://www.instagram.com/reel/x/" } };
  assert.equal(sharedMediaKind(attachment), "reel");
  // The cover is a photo even for a reel — it must not be handed to a <video>.
  assert.equal(sharedMediaBucket(sharedMediaKind(attachment), attachment.mime_type), "image");
});

test("the cover is copied to our disk, and anything that is not an image is refused", async () => {
  const image = await persistSharePostCover(
    { id: "test-cover-123", source: "instagram", thumbnail_url: "https://cdn.example/thumb.jpg" },
    { fetchImpl: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { "content-type": "image/jpeg" } }) }
  );
  assert.equal(image, "/uploads/inbox/shared-instagram-test-cover-123.jpg");
  const written = path.join(INBOX_ATTACHMENT_DIR, "shared-instagram-test-cover-123.jpg");
  assert.ok(existsSync(written));
  unlinkSync(written);

  const html = await persistSharePostCover(
    { id: "x", source: "instagram", thumbnail_url: "https://cdn.example/page" },
    { fetchImpl: async () => new Response("<html>", { headers: { "content-type": "text/html" } }) }
  );
  assert.equal(html, "");
  assert.equal(await persistSharePostCover({ id: "x", thumbnail_url: "file:///etc/passwd" }), "");
});
