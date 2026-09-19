import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { extractMetaWebhookMessages } = await import("../server/services/aiChannelAdapterService.js");
const { inboundAttachmentLabel, inboundMediaExtension, sniffMediaMime } = await import(
  "../server/services/inboundMediaService.js"
);
const { isTypeNameTitle, sharedMediaBucket, sharedMediaKind } = await import(
  "../src/shared/lib/sharedInboundMedia.js"
);
const CR = String.fromCharCode(13);
const media = readFileSync("src/modules/aiSupport/components/MessageMedia.jsx", "utf8").split(CR).join("");
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));

const reelWebhook = (attachment) => ({
  object: "instagram",
  entry: [{
    id: "IGPAGE",
    messaging: [{
      sender: { id: "CUST1" },
      recipient: { id: "IGPAGE" },
      timestamp: 1755800000000,
      message: { mid: "mid.reel", attachments: [attachment] },
    }],
  }],
});

test("a forwarded reel is not titled with its own type name", async () => {
  // The whole defect: Meta keeps a reel's caption inside `payload`, so the webhook
  // fell back to the type for a title and the inbox drew a document named "ig_reel".
  const [message] = await extractMetaWebhookMessages({
    tenantId: 1,
    body: reelWebhook({
      type: "ig_reel",
      payload: {
        reel_video_id: "1789",
        title: "New Collection 🔥 Size : 41 to 45",
        url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1",
      },
    }),
  });
  const [reel] = message.attachments;
  assert.equal(reel.type, "ig_reel");
  assert.equal(reel.title, "");
  assert.equal(reel.url, "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1");
  assert.equal(reel.metadata.share_kind, "reel");
  assert.equal(reel.metadata.share_caption, "New Collection 🔥 Size : 41 to 45");
  assert.equal(reel.metadata.share_media_id, "1789");
});

test("a photo the customer took keeps the shape it always had", async () => {
  const [message] = await extractMetaWebhookMessages({
    tenantId: 1,
    body: reelWebhook({ type: "image", payload: { url: "https://cdn/photo.jpg" } }),
  });
  const [photo] = message.attachments;
  assert.equal(photo.type, "image");
  assert.equal(photo.title, "image");
  assert.equal(photo.metadata.share_kind, undefined);
});

test("what was forwarded decides the bubble, not the CDN's content type", () => {
  // Meta serves a reel as application/octet-stream as readily as video/mp4, and
  // that header was what filed a playable clip under "documents".
  assert.equal(sharedMediaBucket(sharedMediaKind({ type: "ig_reel" }), "application/octet-stream"), "video");
  assert.equal(sharedMediaBucket(sharedMediaKind({ type: "ig_reel" }), ""), "video");
  assert.equal(sharedMediaBucket(sharedMediaKind({ type: "ig_post" }), "application/octet-stream"), "image");
  assert.equal(sharedMediaBucket(sharedMediaKind({ type: "share" }), ""), "image");
  // A reel Meta handed over as its cover frame is a picture, and says so.
  assert.equal(sharedMediaBucket(sharedMediaKind({ type: "ig_reel" }), "image/jpeg"), "image");
  // A row stored before the webhook knew about reels carries only the type.
  assert.equal(sharedMediaKind({ type: "ig_reel", metadata: {} }), "reel");
  assert.equal(sharedMediaKind({ type: "video", metadata: {} }), "");
  // Nothing the customer sent themselves is touched by this rule.
  assert.equal(sharedMediaBucket(sharedMediaKind({ type: "audio" }), "audio/ogg"), "");
  assert.equal(sharedMediaBucket(sharedMediaKind({ type: "file" }), "application/pdf"), "");
  assert.equal(isTypeNameTitle("ig_reel"), true);
  assert.equal(isTypeNameTitle("invoice.pdf"), false);
});

test("the conversation list names a reel, and the stored file is a clip", () => {
  assert.equal(inboundAttachmentLabel([{ type: "ig_reel" }]), "🎬 ريل من الصفحة");
  assert.equal(inboundAttachmentLabel([{ type: "share" }]), "🖼️ بوست من الصفحة");
  assert.equal(inboundAttachmentLabel([{ type: "image" }]), "📷 صورة");
  assert.equal(inboundMediaExtension("", "ig_reel"), "mp4");
  assert.equal(inboundMediaExtension("application/octet-stream", "ig_reel"), "mp4");
});

test("the file's first bytes name it when the CDN header does not", () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(16)]);
  assert.equal(sniffMediaMime(mp4), "video/mp4");
  assert.equal(sniffMediaMime(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])), "image/jpeg");
  // An expired signature answers with an error page under a 200; storing that
  // re-hosts a dead link as a file the agent can "open".
  assert.equal(sniffMediaMime(Buffer.from("\n <!DOCTYPE html><html><body>expired</body></html>")), "text/html");
  assert.equal(sniffMediaMime(Buffer.alloc(32)), "");
});

test("the transcript reads the shared rule instead of keeping its own copy", () => {
  assert.match(media, /import \{ isTypeNameTitle, sharedMediaBucket, sharedMediaKind \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/sharedInboundMedia\.js"/);
  // The forwarded kind is answered before the mime can call it a document.
  const classifier = media.slice(media.indexOf("const attachmentKind ="), media.indexOf("const attachmentUrl ="));
  assert.match(classifier, /const shared = sharedMediaBucket\(sharedMediaKind\(attachment\), mime\);\n  if \(shared\) return shared;/);
  assert.ok(classifier.indexOf("if (shared) return shared;") < classifier.indexOf('return "document"'));
  for (const key of ["sharedReel", "sharedPost", "reelUnavailable"]) {
    assert.ok(en.inbox.message[key], `en ${key}`);
    assert.ok(ar.inbox.message[key], `ar ${key}`);
    assert.match(media, new RegExp(`aiSupport\.inbox\.message\.${key}`));
  }
});

test("the reel is stored as a clip even when the CDN calls it a byte stream", async (t) => {
  // Not just that sniffing works, but that the download path uses it: the CDN's
  // `application/octet-stream` is what named the saved file `.bin`, and a `.bin`
  // is what the transcript filed under documents.
  const { materializeInboundAttachments } = await import("../server/services/inboundMediaService.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  process.env.PUBLIC_BACKEND_URL = "https://api.example.test";
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(64, 7)]);
  const written = [];
  t.mock.method(fs.default, "writeFile", async (file, bytes) => written.push({ file: String(file), bytes }));
  t.mock.method(fs.default, "mkdir", async () => undefined);
  t.mock.method(globalThis, "fetch", async () => new Response(mp4, {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  }));

  const [stored] = await materializeInboundAttachments({
    channel: "instagram",
    messageId: "mid.reel",
    attachments: [{ type: "ig_reel", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", metadata: { share_kind: "reel" } }],
  });
  assert.equal(stored.materialized, true);
  assert.equal(stored.mime_type, "video/mp4");
  assert.match(path.default.basename(stored.url), /\.mp4$/);
  assert.equal(written.length, 1);
  assert.match(written[0].file, /\.mp4$/);
});

test("an expired signature is never re-hosted as a file the agent can open", async (t) => {
  const { materializeInboundAttachments } = await import("../server/services/inboundMediaService.js");
  process.env.PUBLIC_BACKEND_URL = "https://api.example.test";
  t.mock.method(globalThis, "fetch", async () => new Response("<!DOCTYPE html><html>URL signature expired</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  }));
  const remote = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2";
  const [stored] = await materializeInboundAttachments({
    channel: "instagram",
    messageId: "mid.expired",
    attachments: [{ type: "ig_reel", url: remote, metadata: { share_kind: "reel" } }],
  });
  // The provider url is kept rather than the html page stored under it: the bubble
  // then shows "the reel is no longer available", not a 0-byte download.
  assert.equal(stored.materialized, undefined);
  assert.equal(stored.url, remote);
});
