import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { ensureCardFitImages, getCardFitImageFileName, getCardFitImagePublicUrl } from "../server/services/productImageVariantService.js";
import { CARD_FIT_ENABLED, getStorefrontResponsiveImageProps } from "../src/shared/lib/storefrontImage.js";

// The grid only asks for card-fit files once the backfill has written them, so every test that
// checks the URLs opts in explicitly. The last test pins the shipped default.
const on = { cardFit: true };

const uploadsDir = path.resolve(process.cwd(), "uploads", "products");
const variantsDir = path.join(uploadsDir, "variants");
const written = [];

/** A studio-style frame: uniform backdrop, product block deliberately off-centre. */
const offCentreShot = async (fileName, { backdrop = { r: 255, g: 255, b: 255 }, size = 600 } = {}) => {
  const block = await sharp({ create: { width: 200, height: 140, channels: 3, background: { r: 20, g: 30, b: 40 } } }).png().toBuffer();
  const buffer = await sharp({ create: { width: size, height: size, channels: 3, background: backdrop } })
    .composite([{ input: block, left: 60, top: 380 }]) // low and to the left
    .jpeg()
    .toBuffer();
  const filePath = path.join(uploadsDir, fileName);
  await writeFile(filePath, buffer);
  written.push(filePath);
  return filePath;
};

/** Where the subject's centre sits relative to the frame's, as a percentage of the frame. */
const centreOffset = async (filePath) => {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2] };
  const meta = await sharp(filePath).metadata();
  const trimmed = await sharp(filePath).trim({ background, threshold: 12 }).toBuffer({ resolveWithObject: true });
  const left = Math.abs(trimmed.info.trimOffsetLeft || 0);
  const top = Math.abs(trimmed.info.trimOffsetTop || 0);
  return {
    dx: ((left + trimmed.info.width / 2) - meta.width / 2) / meta.width * 100,
    dy: ((top + trimmed.info.height / 2) - meta.height / 2) / meta.height * 100,
    width: meta.width,
    height: meta.height,
    background,
    channels: info.channels,
  };
};

test.before(async () => {
  await mkdir(variantsDir, { recursive: true });
});

test.after(async () => {
  for (const filePath of written) await rm(filePath, { force: true });
});

test("card-fit centres a product that sits off-centre in its own photo", async () => {
  const source = await offCentreShot("cardfit-test-offcentre.jpg");
  const before = await centreOffset(source);
  assert.ok(Math.abs(before.dy) > 5, `the fixture must actually be off-centre, got dy ${before.dy.toFixed(2)}%`);

  const result = await ensureCardFitImages(source, { force: true });
  for (const entry of result.written) written.push(entry.outputPath);

  assert.equal(result.reframed, true, "a uniform white backdrop must be re-framed");
  assert.deepEqual(result.written.map((entry) => entry.width), [480, 960]);

  for (const entry of result.written) {
    const after = await centreOffset(entry.outputPath);
    assert.ok(Math.abs(after.dx) < 1, `dx ${after.dx.toFixed(2)}% should be centred at ${entry.width}w`);
    assert.ok(Math.abs(after.dy) < 1, `dy ${after.dy.toFixed(2)}% should be centred at ${entry.width}w`);
    // 0.92:1 — the card's image plate, so object-contain has no slack left to distribute.
    assert.equal(after.width, entry.width);
    assert.equal(after.height, Math.round(entry.width / 0.92));
  }
});

test("card-fit pads with the photo's own backdrop, not with white", async () => {
  const cream = { r: 244, g: 241, b: 232 };
  const source = await offCentreShot("cardfit-test-cream.jpg", { backdrop: cream });
  const result = await ensureCardFitImages(source, { force: true });
  for (const entry of result.written) written.push(entry.outputPath);
  assert.equal(result.reframed, true);

  // Padding with #ffffff would leave the photo sitting in a visibly lighter box.
  const corner = await centreOffset(result.written[0].outputPath);
  for (const channel of ["r", "g", "b"]) {
    assert.ok(
      Math.abs(corner.background[channel] - cream[channel]) <= 6,
      `padding channel ${channel} was ${corner.background[channel]}, expected the source's ${cream[channel]}`
    );
  }
});

test("a photo with no uniform backdrop still gets its files, just un-reframed", async () => {
  // Diagonal gradient: no border ring agrees with itself, so there is nothing safe to trim.
  const size = 400;
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      raw[i] = (x * 255) / size;
      raw[i + 1] = (y * 255) / size;
      raw[i + 2] = 128;
    }
  }
  const filePath = path.join(uploadsDir, "cardfit-test-gradient.jpg");
  await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg().toFile(filePath);
  written.push(filePath);

  const result = await ensureCardFitImages(filePath, { force: true });
  for (const entry of result.written) written.push(entry.outputPath);

  assert.equal(result.reframed, false, "a gradient backdrop must not be trimmed");
  assert.match(result.reason, /non_uniform_backdrop/);
  // The storefront derives the URL without asking, so the file has to exist regardless.
  assert.deepEqual(result.written.map((entry) => entry.width), [480, 960]);
});

test("card-fit never writes over the -wN variants that back up the originals", async () => {
  const source = await offCentreShot("cardfit-test-naming.jpg");
  const result = await ensureCardFitImages(source, { force: true });
  for (const entry of result.written) written.push(entry.outputPath);

  for (const entry of result.written) {
    const name = path.basename(entry.outputPath);
    assert.match(name, /-fit\d+\.webp$/);
    assert.doesNotMatch(name, /-w\d+\.webp$/, "a card-fit file must never take a -wN name");
  }
  assert.equal(getCardFitImageFileName("shoe.jpg", 480), "shoe-fit480.webp");
});

test("the file the generator writes is the file the storefront asks for", async () => {
  // The Cloudinary migration parked most of the catalogue under products/cloudinary/, and the
  // storefront keeps that sub-path when it derives the variant URL. Writing them flat would 404
  // the majority of the grid, so the two sides are pinned to each other here.
  for (const stored of ["/uploads/products/flat-product.webp", "/uploads/products/cloudinary/nested-product.webp"]) {
    const requested = getStorefrontResponsiveImageProps(stored, "grid", on).srcSet.split(", ").map((entry) => entry.split(" ")[0]);
    for (const width of [480, 960]) {
      const generated = getCardFitImagePublicUrl(stored, width);
      assert.ok(
        requested.some((url) => url.endsWith(generated)),
        `storefront asks for ${requested.join(" | ")} but the generator writes ${generated}`
      );
    }
  }

  // And prove it on disk, not just in the naming helpers.
  const nestedDir = path.join(uploadsDir, "cardfit-test-nested");
  await mkdir(nestedDir, { recursive: true });
  const source = await offCentreShot(path.join("cardfit-test-nested", "deep.jpg"));
  const result = await ensureCardFitImages(source, { force: true });
  for (const entry of result.written) written.push(entry.outputPath);
  for (const entry of result.written) {
    assert.ok(
      entry.outputPath.includes(path.join("variants", "cardfit-test-nested")),
      `expected variants/cardfit-test-nested/, got ${entry.outputPath}`
    );
  }
  await rm(nestedDir, { recursive: true, force: true });
  await rm(path.join(variantsDir, "cardfit-test-nested"), { recursive: true, force: true });
});

test("only the grid preset asks for card-fit images", () => {
  const url = "/uploads/products/some-product.webp";

  const grid = getStorefrontResponsiveImageProps(url, "grid", on).srcSet;
  assert.match(grid, /-fit480\.webp 480w/);
  assert.match(grid, /-fit960\.webp 960w/);
  assert.doesNotMatch(grid, /-w\d+\.webp/);

  // The detail hero and the thumbnails want the photo exactly as it was shot.
  for (const preset of ["hero", "thumbnail", "small"]) {
    const srcSet = getStorefrontResponsiveImageProps(url, preset, on).srcSet;
    assert.doesNotMatch(srcSet, /-fit\d+\.webp/, `${preset} must keep the original framing`);
    assert.match(srcSet, /-w960\.webp 960w/);
  }
});

test("card-fit leaves non-local images alone", () => {
  const cloudinary = "https://res.cloudinary.com/demo/image/upload/shoe.jpg";
  const srcSet = getStorefrontResponsiveImageProps(cloudinary, "grid", on).srcSet;
  assert.doesNotMatch(srcSet, /-fit\d+\.webp/);
  assert.match(srcSet, /c_limit,f_auto,q_auto,w_\d+/);
});

test("the card-fit switch decides what the grid actually ships", () => {
  const url = "/uploads/products/some-product.webp";
  const shipped = getStorefrontResponsiveImageProps(url, "grid").srcSet;
  if (CARD_FIT_ENABLED) {
    // Only legitimate once generateCardFitImages.js has run over the catalogue on the server.
    assert.match(shipped, /-fit\d+\.webp/);
  } else {
    assert.doesNotMatch(shipped, /-fit\d+\.webp/, "with the switch off the grid must keep asking for -wN");
    assert.match(shipped, /-w960\.webp 960w/);
  }
});
