import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";

import {
  renderThermalArtwork,
  normalizeThermalLocalOptions,
  thermalLocalOptionsFingerprint,
} from "../server/lib/thermalLocalEngine.js";
import { THERMAL_ARTWORK_DEFAULTS, THERMAL_ARTWORK_STYLES } from "../shared/thermalArtworkSettings.js";
import { settingsByKey } from "../shared/settingsRegistry.js";

/**
 * A stand-in product photo: a grey shape with darker internal detail, sitting
 * off-centre on a white studio background, the way supplier photos arrive.
 */
const buildProductPhoto = async ({ width = 600, height = 600, frame = false, body = 150, stripe = 30, stripeWidth = 8 } = {}) => {
  const pixels = Buffer.alloc(width * height * 3, 255);
  const put = (x, y, value) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = ((y * width) + x) * 3;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  };

  const left = 120;
  const top = 180;
  const shapeWidth = 340;
  const shapeHeight = 220;
  for (let y = top; y < top + shapeHeight; y += 1) {
    for (let x = left; x < left + shapeWidth; x += 1) {
      // A body with darker stripes, so a threshold has real detail to find.
      put(x, y, ((x - left) % 40) < stripeWidth ? stripe : body);
    }
  }

  if (frame) {
    // The faint one-pixel border some supplier photos carry.
    for (let x = 0; x < width; x += 1) { put(x, 2, 90); put(x, height - 3, 90); }
    for (let y = 0; y < height; y += 1) { put(2, y, 90); put(width - 3, y, 90); }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
};

const readPixels = async (buffer) => {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
};

test("artwork comes out pure black and white, with no greys for the print head", async () => {
  const { buffer } = await renderThermalArtwork(await buildProductPhoto(), { canvas: 512 });
  const { data } = await readPixels(buffer);
  const values = new Set();
  for (let index = 0; index < data.length; index += 1) values.add(data[index]);
  assert.deepEqual([...values].sort((a, b) => a - b), [0, 255]);
});

test("every style renders and keeps both black and white on the label", async () => {
  const photo = await buildProductPhoto();
  for (const style of THERMAL_ARTWORK_STYLES) {
    const { buffer, meta } = await renderThermalArtwork(photo, { style, canvas: 512 });
    const { data } = await readPixels(buffer);
    let black = 0;
    let white = 0;
    for (let index = 0; index < data.length; index += 1) {
      if (data[index] === 0) black += 1; else white += 1;
    }
    assert.equal(meta.style, style, `${style} reports its own style`);
    assert.ok(black > 0, `${style} burns some ink`);
    assert.ok(white > 0, `${style} leaves some paper`);
  }
});

test("the white studio background is dropped and the product is cropped tight", async () => {
  const { meta } = await renderThermalArtwork(await buildProductPhoto(), { canvas: 512 });
  assert.equal(meta.backgroundRemoved, true);
  // The stand-in product is 340x220, so the artwork must come out landscape
  // rather than inheriting the square frame of the photo.
  assert.ok(meta.outputWidth > meta.outputHeight, `expected landscape artwork, got ${meta.outputWidth}x${meta.outputHeight}`);
  assert.ok(Math.abs((meta.artWidth / meta.artHeight) - (340 / 220)) < 0.08);
});

test("a faint photo frame does not pin the crop to the full frame", async () => {
  const framed = await renderThermalArtwork(await buildProductPhoto({ frame: true }), { canvas: 512 });
  const plain = await renderThermalArtwork(await buildProductPhoto(), { canvas: 512 });
  assert.equal(framed.meta.artWidth, plain.meta.artWidth);
  assert.equal(framed.meta.artHeight, plain.meta.artHeight);
});

test("ink level moves how much of the product is burned", async () => {
  const photo = await buildProductPhoto();
  const light = await renderThermalArtwork(photo, { canvas: 512, style: "detail", inkLevel: 5, outline: false });
  const heavy = await renderThermalArtwork(photo, { canvas: 512, style: "detail", inkLevel: 95, outline: false });
  assert.ok(heavy.meta.inkRatio > light.meta.inkRatio, `expected ${heavy.meta.inkRatio} > ${light.meta.inkRatio}`);
});

test("a photo with no clean background still renders instead of failing", async () => {
  const width = 400;
  const height = 300;
  const noisy = Buffer.alloc(width * height * 3);
  for (let index = 0; index < noisy.length; index += 1) noisy[index] = (index * 37) % 200;
  const source = await sharp(noisy, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const { buffer, meta } = await renderThermalArtwork(source, { canvas: 384 });
  assert.equal(meta.backgroundRemoved, false);
  assert.ok(buffer.length > 0);
});

test("the same photo and options always produce the same bytes", async () => {
  const photo = await buildProductPhoto();
  const first = await renderThermalArtwork(photo, { canvas: 384 });
  const second = await renderThermalArtwork(photo, { canvas: 384 });
  assert.ok(first.buffer.equals(second.buffer));
});

test("the cache fingerprint changes with every option that changes the artwork", () => {
  const base = { style: "detail", inkLevel: 50, canvas: 1024 };
  const baseline = thermalLocalOptionsFingerprint(base);
  assert.equal(thermalLocalOptionsFingerprint({ ...base }), baseline);
  assert.notEqual(thermalLocalOptionsFingerprint({ ...base, style: "halftone" }), baseline);
  assert.notEqual(thermalLocalOptionsFingerprint({ ...base, inkLevel: 70 }), baseline);
  assert.notEqual(thermalLocalOptionsFingerprint({ ...base, canvas: 768 }), baseline);
});

test("unknown options fall back to the shipped defaults", () => {
  const options = normalizeThermalLocalOptions({ style: "picasso", inkLevel: 999, canvas: -4 });
  assert.equal(options.style, THERMAL_ARTWORK_DEFAULTS.style);
  assert.equal(options.inkLevel, 100);
  assert.equal(options.canvas, 256);
});

test("automatic uses the drawing model whenever it is installed", async () => {
  const { isLineartModelAvailable } = await import("../server/lib/thermalLineartModel.js");
  if (!(await isLineartModelAvailable())) return;

  const dark = await renderThermalArtwork(await buildProductPhoto({ body: 40, stripe: 20 }), { canvas: 448 });
  assert.equal(dark.meta.style, "auto");
  assert.equal(dark.meta.modelAvailable, true);
  assert.equal(dark.meta.resolvedStyle, "lineart");
  assert.equal(dark.meta.lineartError, "");
  assert.ok(dark.meta.lineartMs > 0);
  assert.ok(["node", "web"].includes(dark.meta.lineartRuntime), `runtime ${dark.meta.lineartRuntime}`);
});

test("without the drawing model, automatic picks halftone, line art or illustration from how dark the product is", async () => {
  // Point the engine at a model file that does not exist: the fallback must be
  // the tone-based pick, not a failure.
  const previous = process.env.THERMAL_LINEART_MODEL;
  process.env.THERMAL_LINEART_MODEL = "C:/definitely/not/here/lineart.onnx";
  try {
    // A near-black product: line art would collapse to an empty outline on the label.
    const dark = await renderThermalArtwork(await buildProductPhoto({ body: 40, stripe: 20 }), { canvas: 448 });
    if (dark.meta.modelAvailable) return; // the module was already loaded with the real path
    assert.equal(dark.meta.resolvedStyle, "halftone");
    assert.ok(dark.meta.autoDarkShare > 0.6);

    // Heavy black trim on a pale body: the sketch would fill the trim as blobs,
    // the adaptive threshold keeps the texture inside it.
    const trimmed = await renderThermalArtwork(await buildProductPhoto({ body: 190, stripe: 20, stripeWidth: 18 }), { canvas: 448 });
    assert.equal(trimmed.meta.resolvedStyle, "detail");
    assert.ok(trimmed.meta.autoDarkShare >= 0.35 && trimmed.meta.autoDarkShare < 0.6, `dark share ${trimmed.meta.autoDarkShare}`);

    // A mostly pale product gets the illustrated look.
    const pale = await renderThermalArtwork(await buildProductPhoto({ body: 190, stripe: 20 }), { canvas: 448 });
    assert.equal(pale.meta.resolvedStyle, "sketch");
    assert.ok(pale.meta.autoDarkShare < 0.35, `dark share ${pale.meta.autoDarkShare}`);
  } finally {
    if (previous === undefined) delete process.env.THERMAL_LINEART_MODEL;
    else process.env.THERMAL_LINEART_MODEL = previous;
  }
});

test("the floor shadow under a product is peeled off without touching the product", async () => {
  // A pale product with a dark sole line, standing on a soft grey ellipse —
  // the studio shadow that used to print as a ring under the shoe.
  const width = 600;
  const height = 600;
  const build = async (withShadow) => {
    const pixels = Buffer.alloc(width * height * 3, 255);
    const put = (x, y, value) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = ((y * width) + x) * 3;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    };
    if (withShadow) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const dx = (x - 300) / 260;
          const dy = (y - 420) / 40;
          const d = (dx * dx) + (dy * dy);
          if (d < 1) put(x, y, Math.round(205 + (30 * d)));
        }
      }
    }
    for (let y = 180; y < 400; y += 1) {
      for (let x = 120; x < 480; x += 1) put(x, y, ((x - 120) % 40) < 8 ? 40 : 200);
    }
    for (let y = 400; y < 410; y += 1) {
      for (let x = 120; x < 480; x += 1) put(x, y, 30); // the sole's dark contact line
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  };

  const clean = await renderThermalArtwork(await build(false), { canvas: 448, style: "detail" });
  const shadowed = await renderThermalArtwork(await build(true), { canvas: 448, style: "detail" });
  // A handful of pixels at the sole's anti-aliased corners is fringe, not shadow.
  assert.ok(clean.meta.shadowRemoved < 40, `no shadow to peel, yet ${clean.meta.shadowRemoved} pixels went`);
  assert.ok(shadowed.meta.shadowRemoved > 400, `the shadow must be detected, got ${shadowed.meta.shadowRemoved}`);
  // With the shadow gone the crop is the product alone, so both renders share
  // the product's own aspect ratio.
  const cleanAspect = clean.meta.artWidth / clean.meta.artHeight;
  const shadowedAspect = shadowed.meta.artWidth / shadowed.meta.artHeight;
  assert.ok(Math.abs(cleanAspect - shadowedAspect) < 0.08, `aspect ${cleanAspect.toFixed(3)} vs ${shadowedAspect.toFixed(3)}`);
});

test("the illustration style keeps the interior seams, not just the silhouette", async () => {
  // The stroke filter once measured 4-connected components, so every diagonal
  // one-pixel Canny ridge was its own island and the whole interior vanished.
  // A photo with only a faint diagonal seam inside must still draw that seam.
  const width = 600;
  const height = 600;
  const pixels = Buffer.alloc(width * height * 3, 255);
  const put = (x, y, value) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = ((y * width) + x) * 3;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  };
  for (let y = 150; y < 450; y += 1) {
    for (let x = 100; x < 500; x += 1) {
      // A pale body split by a diagonal seam of moderate contrast.
      put(x, y, (x - 100) > (y - 150) ? 200 : 165);
    }
  }
  const photo = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const { buffer, meta } = await renderThermalArtwork(photo, { canvas: 448, style: "sketch", outline: false });
  const { data, width: outWidth, height: outHeight, channels } = await readPixels(buffer);

  // Sample the centre of the artwork, well away from the silhouette.
  let inkInsideCentre = 0;
  for (let y = Math.floor(outHeight * 0.3); y < Math.floor(outHeight * 0.7); y += 1) {
    for (let x = Math.floor(outWidth * 0.3); x < Math.floor(outWidth * 0.7); x += 1) {
      if (data[((y * outWidth) + x) * channels] === 0) inkInsideCentre += 1;
    }
  }
  assert.equal(meta.resolvedStyle, "sketch");
  assert.ok(inkInsideCentre > 40, `expected the seam to be drawn through the centre, got ${inkInsideCentre} ink pixels`);
});

test("a named style is never overridden by the automatic pick", async () => {
  const dark = await buildProductPhoto({ body: 40, stripe: 20 });
  const forced = await renderThermalArtwork(dark, { canvas: 448, style: "detail" });
  assert.equal(forced.meta.resolvedStyle, "detail");
  assert.equal(forced.meta.autoDarkShare, null);
});

test("lowering the ink level only ever lightens a halftone, never snaps it back to a solid burn", async () => {
  // Error diffusion ignores the threshold, so this exercises the tone search.
  // Ink level caps coverage rather than forcing it: above what the product
  // naturally burns it does nothing, below it the print gets lighter. The old
  // stepped search broke that — an unreachable target reverted to the
  // untouched, near-solid frame, so a lower setting burned *more*.
  // Near-black on purpose: at the lowest levels the coverage target is below
  // anything the tone curve can reach, which is the case that used to snap back.
  const dark = await buildProductPhoto({ body: 8, stripe: 3 });
  const levels = [70, 55, 40, 25, 12, 4];
  const ratios = [];
  for (const inkLevel of levels) {
    const { meta } = await renderThermalArtwork(dark, { canvas: 384, style: "halftone", inkLevel });
    ratios.push(meta.inkRatio);
  }

  for (let index = 1; index < ratios.length; index += 1) {
    assert.ok(
      ratios[index] <= ratios[index - 1] + 1e-9,
      `ink level ${levels[index]} must never burn more than ${levels[index - 1]}, got ${ratios.join(", ")}`
    );
  }
  assert.ok(ratios[ratios.length - 1] < ratios[0], `the lowest ink level must actually lighten: ${ratios.join(", ")}`);
});

test("the default canvas matches the label dot grid, not a screen-sized image", () => {
  // 47mm of label at 203 dpi is ~376 dots. Rendering far above that is thrown
  // away when the browser scales the artwork into the slot.
  const { canvas } = normalizeThermalLocalOptions({});
  assert.ok(canvas >= 320 && canvas <= 640, `expected a print-sized canvas, got ${canvas}`);
});

test("the settings registry exposes the thermal engine knobs", () => {
  const engine = settingsByKey["general.barcode_print_thermal_engine"];
  const style = settingsByKey["general.barcode_print_thermal_style"];
  const ink = settingsByKey["general.barcode_print_thermal_ink_level"];

  assert.ok(engine && style && ink, "all three thermal settings are registered");
  assert.equal(engine.category, "barcode_printing");
  assert.equal(engine.defaultValue, "local", "the system draws the artwork itself unless told otherwise");
  assert.deepEqual(engine.options.map((option) => option.value), ["local", "openai"]);
  assert.deepEqual(style.options.map((option) => option.value), [...THERMAL_ARTWORK_STYLES]);
  assert.equal(ink.defaultValue, THERMAL_ARTWORK_DEFAULTS.inkLevel);
});
