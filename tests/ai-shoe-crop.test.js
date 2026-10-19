import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";

// Segmentation is pointed at a model file that does not exist, so these runs
// never load the 41 MB network: the fallback path is what they exercise.
process.env.THERMAL_SEGMENT_MODEL = "tests/__no_such_model__.onnx";
const { cropShoeFromPhoto, shoeBoxFromReading, boxFromMask } = await import("../server/lib/shoeCrop.js");

// 400x200: grey with a red "shoe" at x 100..199, y 50..149.
const busyPhoto = () => sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 120, g: 120, b: 120 } } })
  .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: { r: 220, g: 20, b: 20 } } }, left: 100, top: 50 }])
  .jpeg()
  .toBuffer();

test("a reading box crops to the shoe, padded ~8%", async () => {
  const photo = await busyPhoto();
  const result = await cropShoeFromPhoto(photo, { box: { x: 0.25, y: 0.25, width: 0.25, height: 0.5 } });
  assert.equal(result.cropped, true);
  assert.equal(result.reason, "reading-box");
  const meta = await sharp(result.buffer).metadata();
  // 100 px wide + 8% each side = 116; 100 px tall + 8% each side = 116.
  assert.equal(meta.width, 116);
  assert.equal(meta.height, 116);
  assert.ok(Math.abs(result.box.x - 92 / 400) < 0.01);
  assert.ok(Math.abs(result.box.y - 42 / 200) < 0.01);
  // The middle of the crop is the red shoe.
  const { data } = await sharp(result.buffer).extract({ left: 58, top: 58, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 180 && data[1] < 70, `centre pixel ${[...data]}`);
});

test("a vision reading's shoe_box is checked before use", () => {
  assert.deepEqual(shoeBoxFromReading({ shoe_box: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } }), { x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
  assert.deepEqual(shoeBoxFromReading({ detected: { shoe_box: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } } }), { x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
  // Percentages are read as percentages.
  assert.deepEqual(shoeBoxFromReading({ shoe_box: { x: 10, y: 20, width: 50, height: 40 } }), { x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
  // A box running off the photo is clipped to it.
  assert.deepEqual(shoeBoxFromReading({ shoe_box: { x: 0.6, y: 0, width: 0.8, height: 1 } }), { x: 0.6, y: 0, width: 0.4, height: 1 });
  assert.equal(shoeBoxFromReading(null), null);
  assert.equal(shoeBoxFromReading({ shoe_box: null }), null);
  assert.equal(shoeBoxFromReading({ shoe_box: { x: 0.1, y: 0.1, width: 0.01, height: 0.5 } }), null);
  assert.equal(shoeBoxFromReading({ shoe_box: { x: "a", y: 0, width: 0.5, height: 0.5 } }), null);
  assert.equal(shoeBoxFromReading({ brand_guess: "Nike" }), null);
});

test("a box over the whole photo leaves it uncropped", async () => {
  const photo = await busyPhoto();
  const result = await cropShoeFromPhoto(photo, { box: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } });
  assert.equal(result.cropped, false);
  assert.equal(result.reason, "box-covers-photo");
  assert.equal(result.buffer, photo);
});

test("without a box and without a mask the original comes back", async () => {
  const photo = await busyPhoto();
  const result = await cropShoeFromPhoto(photo);
  assert.equal(result.cropped, false);
  assert.equal(result.reason, "segment-model-unavailable");
  assert.equal(result.buffer, photo);
  assert.equal(result.box, null);
});

test("an invalid reading box returns the original rather than segmenting", async () => {
  const photo = await busyPhoto();
  const result = await cropShoeFromPhoto(photo, { box: { x: 0.5 } });
  assert.equal(result.cropped, false);
  assert.equal(result.reason, "box-invalid");
  assert.equal(result.buffer, photo);
});

test("it never throws", async () => {
  const garbage = Buffer.from("not an image at all");
  for (const input of [garbage, Buffer.alloc(0), null, undefined, "photo.jpg", 42]) {
    const result = await cropShoeFromPhoto(input, { box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } });
    assert.equal(result.cropped, false, String(input));
    assert.equal(result.buffer, input);
    assert.ok(result.reason);
  }
  const noOptions = await cropShoeFromPhoto(garbage, undefined);
  assert.equal(noOptions.cropped, false);
  const hostileBox = await cropShoeFromPhoto(await busyPhoto(), { box: { get x() { throw new Error("boom"); } } });
  assert.equal(hostileBox.cropped, false);
});

test("the mask's largest blob decides the box; specks and tiny masks do not", () => {
  const width = 100;
  const height = 100;
  const mask = new Uint8Array(width * height);
  for (let y = 40; y < 80; y += 1) for (let x = 20; x < 70; x += 1) mask[(y * width) + x] = 1;
  mask[(2 * width) + 97] = 1; // a stray speck in the corner
  const box = boxFromMask(mask, width, height);
  assert.deepEqual({ x: box.x, y: box.y, width: box.width, height: box.height }, { x: 0.2, y: 0.4, width: 0.5, height: 0.4 });
  assert.equal(box.edges, 0);

  const tiny = new Uint8Array(width * height);
  for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) tiny[(y * width) + x] = 1;
  assert.equal(boxFromMask(tiny, width, height), null);

  const floor = new Uint8Array(width * height);
  for (let y = 60; y < 100; y += 1) for (let x = 0; x < 100; x += 1) floor[(y * width) + x] = 1;
  assert.equal(boxFromMask(floor, width, height).edges, 3);
});

test("the vision schema asks for shoe_box and the reading keeps it", () => {
  const source = fs.readFileSync(new URL("../server/services/openaiSupportService.js", import.meta.url), "utf8");
  const schema = source.slice(source.indexOf("const imageSearchUnderstandingSchema"), source.indexOf("const normalizeSuggestedProducts"));
  assert.match(schema, /"shoe_box",\s*\]/);
  assert.match(schema, /shoe_box: \{\s*type: \["object", "null"\],\s*additionalProperties: false,\s*required: \["x", "y", "width", "height"\]/);
  assert.match(source, /shoe_box: detected\.shoe_box && typeof detected\.shoe_box === "object" \? detected\.shoe_box : null/);
  assert.match(source, /"shoe_box: the tight box around the main shoe/);
});
