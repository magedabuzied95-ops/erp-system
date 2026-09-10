import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import sharp from "sharp";

import { applyMetaReadableImages } from "../../server/services/metaCatalogFeedService.js";
import {
  metaCatalogImageUrl,
  needsCatalogJpegRendition,
} from "../../server/services/metaImageCompatService.js";

// sharp keeps the source descriptor open in its cache, and Windows will not
// unlink a file that is still held.
sharp.cache(false);

const ORIGIN = "https://api.m1store-egy.com";
const uploadsRoot = path.resolve(process.cwd(), "uploads");
const fileName = `meta-feed-test-${process.pid}.webp`;
const sourcePath = path.join(uploadsRoot, "products", fileName);
const sourceUrl = `${ORIGIN}/uploads/products/${fileName}`;

const exists = async (filePath) => {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
};

test("only the formats Meta cannot decode are rewritten", () => {
  assert.equal(needsCatalogJpegRendition(`${ORIGIN}/uploads/products/a.webp`), true);
  assert.equal(needsCatalogJpegRendition(`${ORIGIN}/uploads/products/a.avif`), true);
  // The catalogue crawler reads PNG, unlike the publish endpoints: leave it alone.
  assert.equal(needsCatalogJpegRendition(`${ORIGIN}/uploads/products/a.png`), false);
  assert.equal(needsCatalogJpegRendition(`${ORIGIN}/uploads/products/a.jpg`), false);
  assert.equal(needsCatalogJpegRendition(`${ORIGIN}/uploads/products/clip.mp4`), false);
  assert.equal(needsCatalogJpegRendition(`${ORIGIN}/uploads/meta-jpeg/a-123456789abc.jpg`), false);
  assert.equal(needsCatalogJpegRendition("https://res.cloudinary.com/demo/a.webp"), false);
  assert.equal(needsCatalogJpegRendition(""), false);
});

test("a webp with no rendition yet ships as-is, and is swapped once the rendition exists", async (t) => {
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff00ff" } })
    .webp()
    .toFile(sourcePath);

  let renditionPath = "";
  t.after(async () => {
    for (const leftover of [sourcePath, renditionPath]) {
      if (!leftover) continue;
      try {
        await rm(leftover, { force: true });
      } catch {
        // A locked temp file is not a test failure.
      }
    }
  });

  // Fails open: a crawl must never wait on sharp, so an image with no rendition
  // yet keeps its original url instead of blocking or being dropped.
  const before = [{ image_link: sourceUrl, additional_image_link: [sourceUrl] }];
  await applyMetaReadableImages(before, { warm: false });
  assert.equal(before[0].image_link, sourceUrl);

  const renditionUrl = await metaCatalogImageUrl(sourceUrl, { convert: true });
  assert.match(renditionUrl, /^https:\/\/api\.m1store-egy\.com\/uploads\/meta-jpeg\/meta-feed-test-\d+-[0-9a-f]{12}\.jpg$/);
  renditionPath = path.join(uploadsRoot, "meta-jpeg", renditionUrl.split("/").pop());
  assert.equal(await exists(renditionPath), true);
  assert.equal((await sharp(renditionPath).metadata()).format, "jpeg");

  const after = [{ image_link: sourceUrl, additional_image_link: [sourceUrl, `${ORIGIN}/uploads/products/keep.jpg`] }];
  await applyMetaReadableImages(after, { warm: false });
  assert.equal(after[0].image_link, renditionUrl);
  assert.deepEqual(after[0].additional_image_link, [renditionUrl, `${ORIGIN}/uploads/products/keep.jpg`]);
});

test("an upload that is not on this box keeps its url", async () => {
  const items = [{ image_link: `${ORIGIN}/uploads/products/does-not-exist-${process.pid}.webp`, additional_image_link: [] }];
  await applyMetaReadableImages(items, { warm: false });
  assert.match(items[0].image_link, /does-not-exist-\d+\.webp$/);
});
