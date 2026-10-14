// Pure wholesale unit maths. A model is sold by the piece, the سيرية (N pieces of one
// colour), the كرتونة (N pieces of one colour, or split evenly over a few colours) and
// the دستة (12 pieces of one colour). Wholesale models usually have no sizes; when one
// does, a colour's pieces are spread evenly over its sizes.

export const WHOLESALE_UNITS = Object.freeze(["piece", "series", "carton", "dozen"]);
export const DOZEN_PIECES = 12;
export const WHOLESALE_TIERS = Object.freeze(["wholesale", "half_wholesale"]);

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase();
const posInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const money = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const fail = (message, code = "WHOLESALE_INVALID") => Object.assign(new Error(message), { status: 400, code });

export const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const EMPTY_SETTINGS = Object.freeze({
  sell_piece: true,
  sell_series: false,
  series_pieces: null,
  sell_carton: false,
  carton_pieces: null,
  sell_dozen: false,
  price_wholesale: null,
  price_half_wholesale: null,
});

/** Cleans the product page's wholesale section; throws on a unit without its count. */
export const normalizeSettings = (raw = {}) => {
  const out = {
    sell_piece: raw.sell_piece !== false,
    sell_series: raw.sell_series === true,
    series_pieces: posInt(raw.series_pieces) || null,
    sell_carton: raw.sell_carton === true,
    carton_pieces: posInt(raw.carton_pieces) || null,
    sell_dozen: raw.sell_dozen === true,
    price_wholesale: money(raw.price_wholesale),
    price_half_wholesale: money(raw.price_half_wholesale),
  };
  if (out.sell_series && !out.series_pieces) throw fail("اكتب عدد قطع السيرية");
  if (out.sell_carton && !out.carton_pieces) throw fail("اكتب عدد قطع الكرتونة");
  if (Number.isNaN(out.price_wholesale) || Number.isNaN(out.price_half_wholesale)) throw fail("سعر القطعة لازم يكون رقم موجب");
  return out;
};

export const unitPieces = (unit, settings) => {
  if (unit === "series") return settings.series_pieces || 0;
  if (unit === "carton") return settings.carton_pieces || 0;
  if (unit === "dozen") return DOZEN_PIECES;
  return 1;
};

export const unitEnabled = (unit, settings) => Boolean(
  unit === "piece" ? settings.sell_piece
    : unit === "series" ? settings.sell_series && settings.series_pieces
      : unit === "carton" ? settings.sell_carton && settings.carton_pieces
        : unit === "dozen" ? settings.sell_dozen : false
);

/** The piece price of a tier; half-wholesale falls back to wholesale when not set. */
export const piecePriceFor = (settings, tier) => {
  const half = settings.price_half_wholesale;
  const whole = settings.price_wholesale;
  if (tier === "half_wholesale" && half !== null && half !== undefined) return Number(half);
  return whole === null || whole === undefined ? null : Number(whole);
};

/** variants: [{ id, color, size, stock }] -> Map(colourKey -> variants of that colour). */
export const groupVariantsByColor = (variants = []) => {
  const map = new Map();
  for (const variant of variants) {
    const k = key(variant.color);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(variant);
  }
  return map;
};

const spreadOverSizes = (colorName, count, colorVariants) => {
  if (!colorVariants?.length) throw fail(`اللون ${colorName} مش موجود في المنتج`, "WHOLESALE_VARIANT_MISSING");
  if (colorVariants.length === 1) return [{ variant: colorVariants[0], qty: count }];
  if (count % colorVariants.length !== 0) {
    throw fail(`${count} قطعة من ${colorName} مش بتتقسم بالتساوي على ${colorVariants.length} مقاسات — بيعها بالقطعة`);
  }
  const each = count / colorVariants.length;
  return colorVariants.map((variant) => ({ variant, qty: each }));
};

/** Human label: "كرتونة 24 قطعة", "سيرية 6 قطع", "دستة", "قطعة". */
export const unitLabel = (unit, settings) => {
  if (unit === "series") return `سيرية ${settings.series_pieces} قطع`;
  if (unit === "carton") return `كرتونة ${settings.carton_pieces} قطعة`;
  if (unit === "dozen") return "دستة";
  return "قطعة";
};

/**
 * One invoice line -> pieces per variant.
 * line: { unit, qty, color?, colors? (carton), size? (piece, only on a model with sizes) }
 */
export const explodeLine = (line, settings, byColor) => {
  const unit = text(line?.unit).toLowerCase();
  const qty = posInt(line?.qty);
  if (!WHOLESALE_UNITS.includes(unit)) throw fail("الوحدة لازم تكون قطعة أو سيرية أو كرتونة أو دستة");
  if (!qty) throw fail("الكمية لازم تكون رقم صحيح أكبر من صفر");
  if (!unitEnabled(unit, settings)) throw fail(`المنتج ده مش بيتباع ${unitLabel(unit, settings)}`);

  const parts = [];
  const add = (spread) => {
    for (const { variant, qty: count } of spread) parts.push({ variant_id: variant.id, color: variant.color, size: variant.size, qty: count });
  };

  if (unit === "carton") {
    const colors = [...new Set((Array.isArray(line.colors) ? line.colors : [line.color]).map(text).filter(Boolean))];
    if (!colors.length) throw fail("اختار لون الكرتونة");
    const pieces = settings.carton_pieces;
    if (pieces % colors.length !== 0) throw fail(`الكرتونة ${pieces} قطعة مش بتتقسم بالتساوي على ${colors.length} ألوان`);
    for (const color of colors) add(spreadOverSizes(color, (pieces / colors.length) * qty, byColor.get(key(color))));
  } else {
    const color = text(line.color);
    if (!color) throw fail("اختار اللون");
    const colorVariants = byColor.get(key(color));
    if (unit === "piece" && colorVariants?.length > 1) {
      const size = text(line.size);
      const variant = colorVariants.find((v) => key(v.size) === key(size));
      if (!variant) throw fail(`اختار مقاس من ${color}`);
      add([{ variant, qty }]);
    } else {
      add(spreadOverSizes(color, unitPieces(unit, settings) * qty, colorVariants));
    }
  }

  return { unit, qty, pieces: parts.reduce((sum, part) => sum + part.qty, 0), composition: parts };
};

/** Sums the pieces each variant needs across lines (for the stock check). */
export const sumByVariant = (explodedLines) => {
  const totals = new Map();
  for (const line of explodedLines) {
    for (const part of line.composition) totals.set(part.variant_id, (totals.get(part.variant_id) || 0) + part.qty);
  }
  return totals;
};

/** Pieces in stock per colour, for the picker. */
export const stockByColor = (variants = []) => {
  const out = {};
  for (const variant of variants) {
    const color = text(variant.color) || "-";
    out[color] = (out[color] || 0) + Math.max(0, Number(variant.stock || 0));
  }
  return out;
};
