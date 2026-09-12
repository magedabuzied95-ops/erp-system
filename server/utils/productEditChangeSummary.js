// What a product-editor save changed, in the few Arabic lines a manager reads on a
// phone notification. Pure: the controller hands it the rows it already has in hand.

const PRODUCT_FIELDS = [
  { key: "name", label: "الاسم" },
  { key: "price", label: "السعر", money: true },
  { key: "sale_price", label: "سعر العرض", money: true },
  { key: "cost_price", label: "سعر التكلفة", money: true },
  { key: "sale_price_enabled", label: "العرض", flag: true },
  { key: "status", label: "الحالة" },
  { key: "is_active", label: "التفعيل", flag: true },
  { key: "category", label: "القسم" },
  { key: "brand", label: "الماركة" },
  { key: "description", label: "الوصف", silentValue: true },
];

const text = (value) => String(value ?? "").trim();
const moneyText = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.round(parsed * 100) / 100} ج.م` : "—";
};
const flagText = (value) => (value === true || value === "true" || value === 1 ? "مفعّل" : "متوقف");

const sameValue = (field, before, after) => {
  if (field.money) {
    const a = Number(before || 0);
    const b = Number(after || 0);
    return Math.abs(a - b) < 0.005;
  }
  if (field.flag) return flagText(before) === flagText(after);
  return text(before) === text(after);
};

const describeValue = (field, value) => {
  if (field.money) return moneyText(value);
  if (field.flag) return flagText(value);
  return text(value) || "—";
};

const variantLabel = (variant = {}) => [text(variant.color), text(variant.size)].filter(Boolean).join(" / ") || `#${variant.id}`;

const listPreview = (labels = [], limit = 4) => {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length <= limit) return unique.join("، ");
  return `${unique.slice(0, limit).join("، ")} +${unique.length - limit}`;
};

export const buildProductEditChangeSummary = ({
  previousProduct = {},
  nextProduct = {},
  previousVariants = [],
  nextVariants = [],
  provisionalStockAdds = [],
} = {}) => {
  const changes = [];

  for (const field of PRODUCT_FIELDS) {
    if (!(field.key in nextProduct) && !(field.key in previousProduct)) continue;
    if (sameValue(field, previousProduct[field.key], nextProduct[field.key])) continue;
    changes.push(field.silentValue
      ? `${field.label} اتعدّل`
      : `${field.label}: ${describeValue(field, previousProduct[field.key])} ← ${describeValue(field, nextProduct[field.key])}`);
  }

  const beforeById = new Map(previousVariants.map((variant) => [String(variant.id), variant]));
  const afterById = new Map(nextVariants.map((variant) => [String(variant.id), variant]));
  const colorsBefore = new Set(previousVariants.map((variant) => text(variant.color)).filter(Boolean));
  const colorsAfter = new Set(nextVariants.map((variant) => text(variant.color)).filter(Boolean));

  const addedColors = [...colorsAfter].filter((color) => !colorsBefore.has(color));
  const removedColors = [...colorsBefore].filter((color) => !colorsAfter.has(color));
  if (addedColors.length) changes.push(`لون جديد: ${listPreview(addedColors)}`);
  if (removedColors.length) changes.push(`لون اتشال: ${listPreview(removedColors)}`);

  // Sizes added/removed inside colours that existed before (a new colour is already named above).
  const addedSizes = nextVariants
    .filter((variant) => !beforeById.has(String(variant.id)) && colorsBefore.has(text(variant.color)))
    .map(variantLabel);
  const removedSizes = previousVariants
    .filter((variant) => !afterById.has(String(variant.id)) && colorsAfter.has(text(variant.color)))
    .map(variantLabel);
  if (addedSizes.length) changes.push(`مقاس جديد: ${listPreview(addedSizes)}`);
  if (removedSizes.length) changes.push(`مقاس اتشال: ${listPreview(removedSizes)}`);

  const plannedChanges = nextVariants
    .filter((variant) => beforeById.has(String(variant.id)))
    .filter((variant) => Number(beforeById.get(String(variant.id)).default_purchase_qty || 0) !== Number(variant.default_purchase_qty || 0))
    .map((variant) => `${variantLabel(variant)} ${Number(beforeById.get(String(variant.id)).default_purchase_qty || 0)} ← ${Number(variant.default_purchase_qty || 0)}`);
  if (plannedChanges.length) changes.push(`كمية الشراء: ${listPreview(plannedChanges, 3)}`);

  if (provisionalStockAdds.length) {
    const total = provisionalStockAdds.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
    changes.push(`اتضاف للمخزون ${total} قطعة قبل فاتورة الشراء: ${listPreview(provisionalStockAdds.map((entry) => `${variantLabel(entry)} +${entry.quantity}`), 3)}`);
  }

  return changes;
};
