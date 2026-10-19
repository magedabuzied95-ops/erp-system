import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  CLIP_MODEL_ID,
  createClipImageEmbedder,
  l2Normalize,
  preprocessClipImage,
} from "../server/lib/clipImageEmbedder.js";
import {
  FAILED_MODEL_ID,
  embedPendingImages,
  localUploadsRelativePath,
  serializeEmbedding,
} from "../server/lib/clipImageIndexWriter.js";
import { createVisualEmbeddingSearch, isEntryInStock } from "../server/services/visualEmbeddingSearchService.js";

const SIZE = 224;
const PIXELS = SIZE * SIZE;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];
const norm = (value, channel) => ((value / 255) - MEAN[channel]) / STD[channel];
const pixel = (data, x, y) => [0, 1, 2].map((channel) => data[(channel * PIXELS) + (y * SIZE) + x]);
const close = (actual, expected, label) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.03, `${label}: ${actual} vs ${expected}`));

const stripes = async () => {
  // 672×224: red | green | blue thirds. A centre crop sees only green; a squash would see all three.
  const third = (r, g, b) => sharp({ create: { width: 224, height: 224, channels: 3, background: { r, g, b } } }).png().toBuffer();
  return sharp({ create: { width: 672, height: 224, channels: 3, background: "#000" } })
    .composite([
      { input: await third(255, 0, 0), left: 0, top: 0 },
      { input: await third(0, 255, 0), left: 224, top: 0 },
      { input: await third(0, 0, 255), left: 448, top: 0 },
    ])
    .png()
    .toBuffer();
};

test("preprocess: 3×224×224 planar, shortest edge to 224 then centre crop, CLIP mean/std", async () => {
  const out = await preprocessClipImage(await stripes());
  assert.ok(out instanceof Float32Array);
  assert.equal(out.length, 3 * PIXELS);
  const green = [norm(0, 0), norm(255, 1), norm(0, 2)];
  close(pixel(out, 5, 112), green, "left edge");
  close(pixel(out, 112, 112), green, "centre");
  close(pixel(out, 218, 112), green, "right edge");
});

test("preprocess: transparent pixels are laid on white", async () => {
  const png = await sharp({ create: { width: 300, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const out = await preprocessClipImage(png);
  close(pixel(out, 100, 100), [norm(255, 0), norm(255, 1), norm(255, 2)], "transparent");
});

test("preprocess: an empty or broken buffer is refused", async () => {
  await assert.rejects(() => preprocessClipImage(Buffer.alloc(0)), /clip_image_empty/);
  await assert.rejects(() => preprocessClipImage(Buffer.from("not an image")));
});

test("l2Normalize gives unit length and refuses a zero vector", () => {
  const unit = l2Normalize([3, 4]);
  assert.ok(Math.abs(unit[0] - 0.6) < 1e-6 && Math.abs(unit[1] - 0.8) < 1e-6);
  assert.throws(() => l2Normalize([0, 0]), /zero_norm/);
});

test("embedder: fake model gets a [1,3,224,224] tensor, output is unit-length 512-d, runs are serialised, session built once", async () => {
  let sessions = 0;
  let active = 0;
  let maxActive = 0;
  const seenDims = [];
  const embedder = createClipImageEmbedder({
    idleReleaseMs: 0,
    createSession: async () => {
      sessions += 1;
      return {
        session: {
          inputNames: ["pixel_values"],
          outputNames: ["image_embeds"],
          run: async (feeds) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            seenDims.push(feeds.pixel_values.dims);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return { image_embeds: { data: Float32Array.from({ length: 512 }, (_, index) => (index % 7) + 1), dims: [1, 512] } };
          },
        },
        makeTensor: (data, dims) => ({ data, dims }),
      };
    },
  });
  const png = await stripes();
  const vectors = await Promise.all([embedder.embedImage(png), embedder.embedImage(png), embedder.embedImage(png)]);
  assert.equal(sessions, 1);
  assert.equal(maxActive, 1);
  assert.deepEqual(seenDims[0], [1, 3, 224, 224]);
  for (const vector of vectors) {
    assert.equal(vector.length, 512);
    const length = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
    assert.ok(Math.abs(length - 1) < 1e-5);
  }
});

// ── search ──────────────────────────────────────────────────────────────────
const unit = (...pairs) => {
  const vector = new Array(512).fill(0);
  for (const [index, value] of pairs) vector[index] = value;
  const length = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  return vector.map((value) => value / length);
};

const fixture = () => {
  const rows = [
    { id: 1, product_id: 10, variant_id: 101, color: "Black", image_url: "/uploads/a1.jpg", product_name: "Samba", embedding_updated_at: "t1", vec: unit([0, 1]) },
    { id: 2, product_id: 10, variant_id: 101, color: "black", image_url: "/uploads/a2.jpg", product_name: "Samba", embedding_updated_at: "t1", vec: unit([0, 1], [1, 0.2]) },
    { id: 3, product_id: 10, variant_id: 102, color: "White", image_url: "/uploads/a3.jpg", product_name: "Samba", embedding_updated_at: "t1", vec: unit([0, 1], [1, 0.6]) },
    { id: 4, product_id: 10, variant_id: null, color: "", image_url: "/uploads/a4.jpg", product_name: "Samba", embedding_updated_at: "t1", vec: unit([0, 1], [1, 0.1]) },
    { id: 5, product_id: 20, variant_id: 201, color: "Red", image_url: "/uploads/b1.jpg", product_name: "Gazelle", embedding_updated_at: "t1", vec: unit([0, 1], [2, 1]) },
    { id: 6, product_id: 30, variant_id: 301, color: "Blue", image_url: "/uploads/c1.jpg", product_name: "Terrex", embedding_updated_at: "t1", vec: unit([3, 1]) },
    { id: 7, product_id: 40, variant_id: null, color: "", image_url: "/uploads/d1.jpg", product_name: "Crocs", embedding_updated_at: "t1", vec: unit([0, 1], [4, 0.3]) },
  ];
  const stock = {
    activeProducts: new Map([["10", 0], ["20", 0], ["30", 0], ["40", 0]]),
    variantProducts: new Set(["10", "20", "30"]),
    stockedProducts: new Set(["10", "30"]),
    stockedColors: new Set(["10:black", "30:blue"]),
    variantColors: new Set(["10:black", "10:white", "20:red", "30:blue"]),
  };
  const calls = { meta: 0, vectors: [], stock: 0 };
  let clock = 0;
  const search = createVisualEmbeddingSearch({
    ttlMs: 1000,
    now: () => clock,
    loadMeta: async () => {
      calls.meta += 1;
      return rows.map(({ vec, ...rest }) => rest);
    },
    loadVectors: async (ids) => {
      calls.vectors.push(ids.map(String));
      return new Map(rows.filter((row) => ids.map(String).includes(String(row.id))).map((row) => [String(row.id), JSON.stringify(row.vec)]));
    },
    loadStock: async () => {
      calls.stock += 1;
      return stock;
    },
    embed: async () => Float32Array.from(unit([0, 1])),
  });
  return { rows, stock, calls, search, tick: (ms) => { clock += ms; } };
};

test("search: cosine ranking, one row per product+colour, best photo wins, colourless dropped when a colour is listed", async () => {
  const { search } = fixture();
  const results = await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.from("x"), onlyInStock: false });
  assert.deepEqual(results.map((row) => `${row.product_id}:${row.color}`), ["10:Black", "40:", "10:White", "20:Red", "30:Blue"]);
  assert.equal(results[0].image_url, "/uploads/a1.jpg");
  assert.equal(results[0].variant_id, 101);
  assert.equal(results[0].similarity, 1);
  for (let index = 1; index < results.length; index += 1) assert.ok(results[index - 1].similarity >= results[index].similarity);
  assert.deepEqual(Object.keys(results[0]).sort(), ["color", "image_url", "product_id", "product_name", "similarity", "variant_id"]);
});

test("search: onlyInStock drops sold-out products and sold-out colours, keeps variant-less stock and unknown colour names", async () => {
  const { search, stock } = fixture();
  stock.activeProducts.set("40", 3);
  const results = await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.from("x") });
  assert.deepEqual(results.map((row) => `${row.product_id}:${row.color}`), ["10:Black", "40:", "30:Blue"]);
  assert.equal(isEntryInStock({ product_id: 10, color: "Navy" }, stock), true, "colour name the variants don't use");
  assert.equal(isEntryInStock({ product_id: 10, color: "white" }, stock), false, "known colour, no stock");
  assert.equal(isEntryInStock({ product_id: 99, color: "" }, stock), false, "inactive product");
});

test("search: limit, and empty input returns []", async () => {
  const { search } = fixture();
  assert.equal((await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.from("x"), limit: 2, onlyInStock: false })).length, 2);
  assert.deepEqual(await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.alloc(0) }), []);
  assert.deepEqual(await search.findNearestProductImages({ tenantId: 0, imageBuffer: Buffer.from("x") }), []);
});

test("cache: loads once per TTL, then refreshes only new or re-embedded vectors and forgets deleted rows", async () => {
  const { search, calls, rows, tick } = fixture();
  await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.from("x"), onlyInStock: false });
  await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.from("x"), onlyInStock: false });
  assert.equal(calls.meta, 1);
  assert.equal(calls.vectors.length, 1);
  assert.equal(calls.vectors[0].length, 7);

  rows.find((row) => row.id === 6).embedding_updated_at = "t2";
  rows.find((row) => row.id === 6).vec = unit([0, 1]);
  rows.push({ id: 8, product_id: 50, variant_id: 501, color: "Green", image_url: "/uploads/e1.jpg", product_name: "Forum", embedding_updated_at: "t1", vec: unit([0, 1], [5, 0.05]) });
  rows.splice(rows.findIndex((row) => row.id === 5), 1);
  tick(1500);
  // Stale-while-refresh: this call is answered from the old cache and kicks the refresh.
  const stale = await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.from("x"), onlyInStock: false });
  assert.ok(stale.some((row) => row.product_id === 20));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.meta, 2);
  assert.deepEqual(calls.vectors[1].sort(), ["6", "8"]);
  const fresh = await search.findNearestProductImages({ tenantId: 1, imageBuffer: Buffer.from("x"), onlyInStock: false });
  assert.ok(!fresh.some((row) => row.product_id === 20), "deleted row is gone");
  assert.equal((await search.getState(1)).vectors.has("5"), false, "deleted row's vector is freed");
  assert.ok(fresh.some((row) => row.product_id === 50), "new row is in");
  assert.equal(fresh.find((row) => row.product_id === 30).similarity, 1, "re-embedded vector replaced");
});

// ── index writer ────────────────────────────────────────────────────────────
test("writer: only our /uploads URLs map to a local path, and never outside it", () => {
  assert.equal(localUploadsRelativePath("https://api.m1store-egy.com/uploads/products/a%20b.jpg?v=2"), "products/a b.jpg");
  assert.equal(localUploadsRelativePath("/uploads/products/x.png"), "products/x.png");
  assert.equal(localUploadsRelativePath("uploads/products/x.png"), "products/x.png");
  assert.equal(localUploadsRelativePath("/uploads/../../etc/passwd"), "");
  assert.equal(localUploadsRelativePath("/uploads/products/%2e%2e/%2e%2e/secret"), "");
  assert.equal(localUploadsRelativePath("https://res.cloudinary.com/x/image/upload/v1/a.jpg"), "");
});

test("writer: serialises 5 decimals; embeds pending images once per URL, marks unreadable photos failed", async () => {
  assert.equal(serializeEmbedding(Float32Array.from([0.123456789, -0.5])), "[0.12346,-0.5]");
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) {
        assert.match(sql, /ORDER BY in_stock DESC/);
        assert.deepEqual(params.slice(0, 2), [CLIP_MODEL_ID, FAILED_MODEL_ID]);
        return { rows: [
          { tenant_id: 1, image_key: "/uploads/good.jpg", image_url: "/uploads/good.jpg" },
          { tenant_id: 1, image_key: "/uploads/bad.jpg", image_url: "/uploads/bad.jpg" },
        ] };
      }
      return { rowCount: 3 };
    },
  };
  const summary = await embedPendingImages({
    clientOrPool: client,
    loadBytes: async (url) => {
      if (url.includes("bad")) throw new Error("image_fetch_http_404");
      return { buffer: Buffer.from("img"), source: "local" };
    },
    embed: async () => Float32Array.from({ length: 512 }, () => 1 / Math.sqrt(512)),
  });
  assert.equal(summary.embedded, 1);
  assert.equal(summary.failed, 1);
  const updates = queries.filter((query) => /UPDATE/.test(query.sql));
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.match(update.sql, /SET image_embedding = \$3::jsonb, embedding_model = \$4, embedding_updated_at = NOW\(\)\s+WHERE/);
    assert.doesNotMatch(update.sql, /updated_at = NOW\(\),|SET updated_at/);
  }
  assert.equal(updates[0].params[3], CLIP_MODEL_ID);
  assert.equal(JSON.parse(updates[0].params[2]).length, 512);
  assert.equal(updates[1].params[2], null);
  assert.equal(updates[1].params[3], FAILED_MODEL_ID);
});

test("writer: a missing model stops the batch instead of stamping photos failed", async () => {
  const client = { query: async (sql) => (/^\s*SELECT/i.test(sql) ? { rows: [{ tenant_id: 1, image_key: "a", image_url: "a" }] } : { rowCount: 1 }) };
  await assert.rejects(() => embedPendingImages({
    clientOrPool: client,
    loadBytes: async () => ({ buffer: Buffer.from("x"), source: "local" }),
    embed: async () => { throw new Error("ENOENT: no such file or directory, access '/app/server/models/clip.onnx'"); },
  }), /ENOENT/);
});
