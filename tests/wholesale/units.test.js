import test from "node:test";
import assert from "node:assert/strict";
import { availableUnits, explodeLine, indexVariants, normalizePack, sumByVariant } from "../../server/modules/wholesale/wholesale.units.js";

// Wholesale sells by the piece, the سيرية (one colour, one piece of each size) and the
// كرتونة (1, 3 or 4 colours, 15-25 pieces). Stock stays in pieces per colour+size, so
// every unit has to land on exact variant quantities.

const SIZES = ["36", "37", "38", "39", "40"];
const COLORS = ["Black", "White", "Red", "Navy"];
const variants = COLORS.flatMap((color, c) => SIZES.map((size, s) => ({ id: c * 10 + s + 1, color, size, stock: 20 })));
const index = indexVariants(variants);

const pack = normalizePack({
  series_sizes: SIZES,
  cartons: [
    { key: "c25", pieces: 25, colors: 1 },
    { key: "c20x4", pieces: 20, colors: 4 },
    { key: "c15x3", pieces: 15, colors: 3 },
    { key: "c16x4", pieces: 16, colors: 4, sizes: { 37: 1, 38: 1, 39: 1, 40: 1 } },
  ],
});

test("a series is one piece of every series size in one colour", () => {
  const line = explodeLine({ unit: "series", qty: 2, color: "black" }, pack, index);
  assert.equal(line.pieces, 10);
  assert.deepEqual(line.composition.map((p) => [p.color, p.size, p.qty]), SIZES.map((size) => ["Black", size, 2]));
});

test("a one-colour carton of 25 = five series of that colour", () => {
  const line = explodeLine({ unit: "carton", qty: 1, carton_key: "c25", colors: ["Red"] }, pack, index);
  assert.equal(line.pieces, 25);
  assert.ok(line.composition.every((p) => p.color === "Red" && p.qty === 5));
});

test("a 4-colour carton of 20 = one series per colour; qty multiplies", () => {
  const line = explodeLine({ unit: "carton", qty: 3, carton_key: "c20x4", colors: COLORS }, pack, index);
  assert.equal(line.pieces, 60);
  assert.equal(new Set(line.composition.map((p) => p.color)).size, 4);
  assert.ok(line.composition.every((p) => p.qty === 3));
});

test("a carton that is not whole series uses its explicit size split", () => {
  const line = explodeLine({ unit: "carton", qty: 1, carton_key: "c16x4", colors: COLORS }, pack, index);
  assert.equal(line.pieces, 16);
  assert.ok(!line.composition.some((p) => p.size === "36"));
});

test("a carton with the wrong number of colours, or a repeated colour, is refused", () => {
  assert.throws(() => explodeLine({ unit: "carton", qty: 1, carton_key: "c15x3", colors: ["Black", "White"] }, pack, index), /3/);
  assert.throws(() => explodeLine({ unit: "carton", qty: 1, carton_key: "c15x3", colors: ["Black", "Black", "Red"] }, pack, index));
});

test("pack validation: uneven carton split and non-series cartons without sizes are refused", () => {
  assert.throws(() => normalizePack({ series_sizes: SIZES, cartons: [{ pieces: 16, colors: 3 }] }), /بالتساوي/);
  assert.throws(() => normalizePack({ series_sizes: SIZES, cartons: [{ pieces: 16, colors: 4 }] }), /توزيع/);
  assert.throws(() => normalizePack({ series_sizes: SIZES, cartons: [{ pieces: 16, colors: 4, sizes: { 36: 1, 37: 1 } }] }), /المفروض 4/);
});

test("missing size in a colour, unknown unit and zero qty are refused", () => {
  const holey = indexVariants(variants.filter((v) => !(v.color === "Navy" && v.size === "38")));
  assert.throws(() => explodeLine({ unit: "series", qty: 1, color: "Navy" }, pack, holey), /38/);
  assert.throws(() => explodeLine({ unit: "box", qty: 1 }, pack, index));
  assert.throws(() => explodeLine({ unit: "piece", qty: 0, color: "Black", size: "36" }, pack, index));
});

test("pieces needed per variant add up across lines; availability counts whole units", () => {
  const lines = [
    explodeLine({ unit: "series", qty: 1, color: "Black" }, pack, index),
    explodeLine({ unit: "piece", qty: 2, color: "Black", size: "36" }, pack, index),
  ];
  assert.equal(sumByVariant(lines).get(1), 3);
  const avail = availableUnits(pack, index, ["Black"]);
  assert.equal(avail.series.Black, 20);
  assert.equal(avail.cartons_single_color.c25.Black, 4);
});
