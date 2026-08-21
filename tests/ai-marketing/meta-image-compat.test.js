import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  buildMetaJpegFileName,
  convertToMetaJpeg,
  ensureMetaCompatibleImageUrl,
  ensureMetaCompatibleImageUrls,
  needsMetaJpegRendition,
} from "../../server/services/metaImageCompatService.js";

test("catalogue WebP masters are flagged for conversion, formats Meta reads are not", () => {
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/products/shoe.webp"), true);
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/products/shoe.avif"), true);
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/products/shoe.png"), true);

  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/products/shoe.jpg"), false);
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/products/shoe.jpeg"), false);
  // Animated, and the Page endpoints accept it: flattening would drop the motion.
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/products/shoe.gif"), false);
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/videos/reel.mp4"), false);
});

test("only our own uploads are candidates, and a rendition is never re-converted", () => {
  assert.equal(needsMetaJpegRendition("https://res.cloudinary.com/demo/image/upload/v1/shoe.webp"), false);
  assert.equal(needsMetaJpegRendition("/uploads/products/shoe.webp"), false);
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/meta-jpeg/shoe-abc123.jpg"), false);
  assert.equal(needsMetaJpegRendition("https://api.example.com/uploads/products/../../etc/passwd"), false);
});

test("the rendition name changes when the source file behind it changes", () => {
  const first = buildMetaJpegFileName("products/shoe.webp", { size: 100, mtimeMs: 1 });
  const second = buildMetaJpegFileName("products/shoe.webp", { size: 200, mtimeMs: 1 });
  const third = buildMetaJpegFileName("products/shoe.webp", { size: 100, mtimeMs: 2 });

  assert.match(first, /^shoe-[0-9a-f]{12}\.jpg$/);
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.equal(first, buildMetaJpegFileName("products/shoe.webp", { size: 100, mtimeMs: 1 }));
});

test("a transparent WebP becomes a flat JPEG Meta can decode", async (t) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-jpeg-"));
  // libvips keeps the decoded input mapped, and Windows refuses to unlink a file
  // that is still open — a cleanup that cannot run must not fail the assertion.
  sharp.cache(false);
  t.after(() => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* temp dir, the OS will reclaim it */
    }
  });

  const sourcePath = path.join(workDir, "source.webp");
  await sharp({
    create: { width: 64, height: 48, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 0 } },
  })
    .webp()
    .toFile(sourcePath);

  const outputPath = path.join(workDir, "meta-jpeg", "source.jpg");
  await convertToMetaJpeg({ sourcePath, outputPath });

  const metadata = await sharp(outputPath).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 48);
});

test("an upload under any mounted root is found, converted once, and served from /uploads", async (t) => {
  // Deliberately the SECOND mounted root: which one holds the file depends on the
  // working directory the backend was started from, and a resolver that assumes
  // the first root silently publishes the WebP it was supposed to replace.
  const uploadsRoot = path.resolve(process.cwd(), "server", "uploads");
  const sourceDir = path.join(uploadsRoot, "__meta-compat-test__");
  const sourcePath = path.join(sourceDir, "sample.webp");
  fs.mkdirSync(sourceDir, { recursive: true });

  sharp.cache(false);
  const written = [sourcePath];
  t.after(() => {
    for (const filePath of written) {
      try {
        fs.rmSync(filePath, { force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        /* both roots are gitignored scratch space */
      }
    }
    try {
      fs.rmdirSync(sourceDir);
    } catch {
      /* left behind only if the source could not be unlinked */
    }
  });

  await sharp({ create: { width: 40, height: 40, channels: 3, background: "#123456" } }).webp().toFile(sourcePath);

  const publicUrl = await ensureMetaCompatibleImageUrl("https://api.example.com/uploads/__meta-compat-test__/sample.webp");
  assert.match(publicUrl, /^https:\/\/api\.example\.com\/uploads\/meta-jpeg\/sample-[0-9a-f]{12}\.jpg$/);

  const renditionPath = path.join(uploadsRoot, "meta-jpeg", path.basename(new URL(publicUrl).pathname));
  written.push(renditionPath);
  assert.equal(fs.existsSync(renditionPath), true);
  assert.equal((await sharp(renditionPath).metadata()).format, "jpeg");

  // Second publish of the same photo reuses the rendition instead of re-encoding.
  const before = fs.statSync(renditionPath).mtimeMs;
  assert.equal(await ensureMetaCompatibleImageUrl("https://api.example.com/uploads/__meta-compat-test__/sample.webp"), publicUrl);
  assert.equal(fs.statSync(renditionPath).mtimeMs, before);
});

test("conversion fails open: an upload that is not on this box publishes as-is", async () => {
  const missing = "https://api.example.com/uploads/products/definitely-not-here-9f8e7d.webp";
  assert.equal(await ensureMetaCompatibleImageUrl(missing), missing);
});

test("album order survives the conversion pass", async () => {
  const urls = [
    "https://api.example.com/uploads/products/one.jpg",
    "https://api.example.com/uploads/products/two-missing.webp",
    "https://res.cloudinary.com/demo/image/upload/v1/three.png",
  ];
  assert.deepEqual(await ensureMetaCompatibleImageUrls(urls), urls);
  assert.deepEqual(await ensureMetaCompatibleImageUrls([]), []);
});
