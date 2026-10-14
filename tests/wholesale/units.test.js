import test from "node:test";
import assert from "node:assert/strict";
import {
  explodeLine,
  groupVariantsByColor,
  normalizeSettings,
  piecePriceFor,
  stockByColor,
  sumByVariant,
} from "../../server/modules/wholesale/wholesale.units.js";

// Wholesale models are usually colours only (no sizes), stocked in pieces per colour.
// Series / carton / dozen are piece counts set on the product page; a carton may be split
// evenly over a few colours. One piece price per customer tier for every colour.

const COLORS = ["Black", "White", "Red", "Navy"];
const plain = groupVariantsByColor(COLORS.map((color, i) => ({ id: i + 1, color, size: "", stock: 100 })));
const sized = groupVariantsByColor(["40", "41", "42"].map((size, i) => ({ id: 50 + i, color: "Black", size, stock: 30 })));

const settings = normalizeSettings({
  sell_piece: true,
  sell_series: true, series_pieces: 6,
  sell_carton: true, carton_pieces: 24,
  sell_dozen: true,
  price_wholesale: 100, price_half_wholesale: 110,
});

test("series and dozen are N pieces of one colour", () => {
  const series = explodeLine({ unit: "series", qty: 2, color: "black" }, settings, plain);
  assert.equal(series.pieces, 12);
  assert.deepEqual(series.composition.map((p) => [p.color, p.qty]), [["Black", 12]]);
  assert.equal(explodeLine({ unit: "dozen", qty: 1, color: "Red" }, settings, plain).pieces, 12);
});

test("a carton is one colour, or split evenly over the colours picked", () => {
  const one = explodeLine({ unit: "carton", qty: 1, colors: ["Navy"] }, settings, plain);
  assert.deepEqual(one.composition.map((p) => [p.color, p.qty]), [["Navy", 24]]);
  const mix = explodeLine({ unit: "carton", qty: 2, colors: COLORS }, settings, plain);
  assert.equal(mix.pieces, 48);
  assert.ok(mix.composition.every((p) => p.qty === 12));
  assert.throws(() => explodeLine({ unit: "carton", qty: 1, colors: ["Black", "White", "Red", "Navy", "Black"].slice(0, 5).concat("Green") }, settings, plain));
  const odd = normalizeSettings({ sell_carton: true, carton_pieces: 16 });
  assert.throws(() => explodeLine({ unit: "carton", qty: 1, colors: ["Black", "White", "Red"] }, odd, plain), /بالتساوي/);
});

test("a model with sizes spreads a colour's pieces evenly, or refuses an uneven split", () => {
  const series3 = normalizeSettings({ sell_series: true, series_pieces: 3 });
  const line = explodeLine({ unit: "series", qty: 2, color: "Black" }, series3, sized);
  assert.deepEqual(line.composition.map((p) => [p.size, p.qty]), [["40", 2], ["41", 2], ["42", 2]]);
  assert.throws(() => explodeLine({ unit: "series", qty: 1, color: "Black" }, normalizeSettings({ sell_series: true, series_pieces: 4 }), sized), /بالقطعة/);
  assert.throws(() => explodeLine({ unit: "piece", qty: 1, color: "Black" }, settings, sized), /مقاس/);
  assert.equal(explodeLine({ unit: "piece", qty: 2, color: "Black", size: "41" }, settings, sized).composition[0].variant_id, 51);
});

test("a unit the product does not sell, a missing count, or a bad price is refused", () => {
  const pieceOnly = normalizeSettings({});
  assert.throws(() => explodeLine({ unit: "carton", qty: 1, colors: ["Black"] }, pieceOnly, plain));
  assert.throws(() => normalizeSettings({ sell_series: true }), /السيرية/);
  assert.throws(() => normalizeSettings({ sell_carton: true }), /الكرتونة/);
  assert.throws(() => normalizeSettings({ price_wholesale: -5 }));
  assert.throws(() => explodeLine({ unit: "series", qty: 0, color: "Black" }, settings, plain));
});

test("tier price: half-wholesale falls back to wholesale when it is empty", () => {
  assert.equal(piecePriceFor(settings, "wholesale"), 100);
  assert.equal(piecePriceFor(settings, "half_wholesale"), 110);
  assert.equal(piecePriceFor(normalizeSettings({ price_wholesale: 90 }), "half_wholesale"), 90);
  assert.equal(piecePriceFor(normalizeSettings({}), "wholesale"), null);
});

test("pieces add up per variant; stock is counted per colour", () => {
  const lines = [
    explodeLine({ unit: "series", qty: 1, color: "Black" }, settings, plain),
    explodeLine({ unit: "piece", qty: 2, color: "Black" }, settings, plain),
  ];
  assert.equal(sumByVariant(lines).get(1), 8);
  assert.deepEqual(stockByColor([{ color: "Black", stock: 3 }, { color: "Black", stock: 4 }, { color: "Red", stock: -1 }]), { Black: 7, Red: 0 });
});
