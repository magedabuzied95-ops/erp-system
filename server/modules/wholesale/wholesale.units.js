// Pure wholesale unit maths: a سيرية / كرتونة becomes pieces per colour and size.
// No database here -- the service feeds it the product's pack and variants.

export const WHOLESALE_UNITS = Object.freeze(["piece", "series", "carton"]);

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase();
const posInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const fail = (message, code = "WHOLESALE_INVALID") => Object.assign(new Error(message), { status: 400, code });

/** Cleans a pack as entered on the product screen; throws on a carton that cannot be filled. */
export const normalizePack = (raw = {}) => {
  const seriesSizes = [...new Set((Array.isArray(raw.series_sizes) ? raw.series_sizes : []).map(text).filter(Boolean))];
  const cartons = (Array.isArray(raw.cartons) ? raw.cartons : []).map((carton, index) => {
    const pieces = posInt(carton?.pieces);
    const colors = posInt(carton?.colors) || 1;
    if (!pieces) throw fail(`الكرتونة رقم ${index + 1}: عدد القطع لازم يكون رقم صحيح أكبر من صفر`);
    if (pieces % colors !== 0) throw fail(`الكرتونة ${pieces} قطعة مش بتتقسم بالتساوي على ${colors} ألوان`);
    const perColor = pieces / colors;
    const explicit = carton?.sizes && typeof carton.sizes === "object" && !Array.isArray(carton.sizes)
      ? Object.fromEntries(Object.entries(carton.sizes).map(([size, qty]) => [text(size), posInt(qty)]).filter(([size, qty]) => size && qty))
      : null;
    let sizes = explicit && Object.keys(explicit).length ? explicit : null;
    if (!sizes) {
      if (!seriesSizes.length || perColor % seriesSizes.length !== 0) {
        throw fail(`الكرتونة ${pieces} قطعة: حدد توزيع المقاسات لكل لون (${perColor} قطعة)، لأنها مش عدد سيريات كامل`);
      }
      const each = perColor / seriesSizes.length;
      sizes = Object.fromEntries(seriesSizes.map((size) => [size, each]));
    }
    const total = Object.values(sizes).reduce((sum, qty) => sum + qty, 0);
    if (total !== perColor) throw fail(`توزيع مقاسات الكرتونة ${pieces} قطعة = ${total} لكل لون، والمفروض ${perColor}`);
    return {
      key: text(carton?.key) || `c${index + 1}`,
      label: text(carton?.label) || `كرتونة ${pieces} قطعة${colors > 1 ? ` (${colors} ألوان)` : ""}`,
      pieces,
      colors,
      sizes,
    };
  });
  const keys = new Set();
  for (const carton of cartons) {
    if (keys.has(carton.key)) throw fail(`مفتاح الكرتونة "${carton.key}" متكرر`);
    keys.add(carton.key);
  }
  return { series_sizes: seriesSizes, sell_piece: raw.sell_piece !== false, cartons };
};

/** variants: [{ id, color, size, stock }] -> lookup by colour+size. */
export const indexVariants = (variants = []) => {
  const map = new Map();
  for (const variant of variants) map.set(`${key(variant.color)}|${key(variant.size)}`, variant);
  return map;
};

/** Human label for a line: "3 كرتونة 24 قطعة", "2 سيرية", "5 قطعة". */
export const unitLabel = (unit, pack, cartonKey) => {
  if (unit === "series") return `سيرية ${pack.series_sizes.length} قطع`;
  if (unit === "carton") return pack.cartons.find((c) => c.key === cartonKey)?.label || "كرتونة";
  return "قطعة";
};

/**
 * One invoice line -> pieces per variant.
 * line: { unit, qty, color?, size?, carton_key?, colors? }
 * returns { pieces, composition: [{ variant_id, color, size, qty }] }
 */
export const explodeLine = (line, pack, variantIndex) => {
  const unit = text(line?.unit).toLowerCase();
  const qty = posInt(line?.qty);
  if (!WHOLESALE_UNITS.includes(unit)) throw fail("نوع الوحدة لازم يكون قطعة أو سيرية أو كرتونة");
  if (!qty) throw fail("الكمية لازم تكون رقم صحيح أكبر من صفر");

  const parts = [];
  const take = (color, size, count) => {
    const variant = variantIndex.get(`${key(color)}|${key(size)}`);
    if (!variant) throw fail(`المقاس ${size} مش موجود في اللون ${color}`, "WHOLESALE_VARIANT_MISSING");
    parts.push({ variant_id: variant.id, color: variant.color, size: variant.size, qty: count });
  };

  if (unit === "piece") {
    if (!pack.sell_piece) throw fail("المنتج ده مش بيتباع بالقطعة");
    if (!text(line.color) || !text(line.size)) throw fail("البيع بالقطعة محتاج لون ومقاس");
    take(line.color, line.size, qty);
  } else if (unit === "series") {
    if (!pack.series_sizes.length) throw fail("المنتج ده مالوش سيرية متعرفة");
    if (!text(line.color)) throw fail("السيرية محتاجة لون");
    for (const size of pack.series_sizes) take(line.color, size, qty);
  } else {
    const carton = pack.cartons.find((c) => c.key === text(line.carton_key));
    if (!carton) throw fail("اختار نوع الكرتونة");
    const colors = (Array.isArray(line.colors) ? line.colors : []).map(text).filter(Boolean);
    if (colors.length !== carton.colors || new Set(colors.map(key)).size !== colors.length) {
      throw fail(`${carton.label}: اختار ${carton.colors} ${carton.colors === 1 ? "لون" : "ألوان مختلفة"}`);
    }
    for (const color of colors) {
      for (const [size, perCarton] of Object.entries(carton.sizes)) take(color, size, perCarton * qty);
    }
  }

  const pieces = parts.reduce((sum, part) => sum + part.qty, 0);
  return { unit, qty, pieces, composition: parts };
};

/** Sums the pieces each variant needs across lines (for the stock check). */
export const sumByVariant = (explodedLines) => {
  const totals = new Map();
  for (const line of explodedLines) {
    for (const part of line.composition) totals.set(part.variant_id, (totals.get(part.variant_id) || 0) + part.qty);
  }
  return totals;
};

/** How many whole units the stock allows, for the picker ("4 كراتين أو 18 سيرية"). */
export const availableUnits = (pack, variantIndex, colors = []) => {
  const stockOf = (color, size) => Math.max(0, Number(variantIndex.get(`${key(color)}|${key(size)}`)?.stock || 0));
  const series = {};
  if (pack.series_sizes.length) {
    for (const color of colors) series[color] = Math.min(...pack.series_sizes.map((size) => stockOf(color, size)));
  }
  const cartonsSingleColor = {};
  for (const carton of pack.cartons.filter((c) => c.colors === 1)) {
    cartonsSingleColor[carton.key] = Object.fromEntries(colors.map((color) => [
      color,
      Math.min(...Object.entries(carton.sizes).map(([size, need]) => Math.floor(stockOf(color, size) / need))),
    ]));
  }
  return { series, cartons_single_color: cartonsSingleColor };
};

export const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
