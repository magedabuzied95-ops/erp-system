import { repairArabicMojibakeText } from "./textEncoding.js";

const normalizeText = (value = "") => String(value ?? "").trim();

const normalizeKey = (value = "") => normalizeText(value).toLowerCase().replace(/\s+/g, " ");

const normalizeDisplayText = (value = "") => repairArabicMojibakeText(normalizeText(value));

const normalizeColorLabel = (value = "") => normalizeDisplayText(value) || "بدون لون";

const normalizeSizeLabel = (value = "") => normalizeDisplayText(value) || "مقاس واحد";

const normalizeIdValue = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value).trim();
};

const sortSizeLabels = (left = "", right = "") => {
  const leftText = normalizeText(left);
  const rightText = normalizeText(right);
  if (leftText === rightText) return 0;

  const leftNumeric = Number.parseFloat(leftText.replace(/[^\d.,-]/g, "").replace(",", "."));
  const rightNumeric = Number.parseFloat(rightText.replace(/[^\d.,-]/g, "").replace(",", "."));
  const leftIsNumeric = Number.isFinite(leftNumeric);
  const rightIsNumeric = Number.isFinite(rightNumeric);

  if (leftIsNumeric && rightIsNumeric && leftNumeric !== rightNumeric) return leftNumeric - rightNumeric;
  return leftText.localeCompare(rightText, "ar");
};

const rowImageUrl = (row = {}) =>
  normalizeText(
    row.image_url ||
      row.variant_image_url ||
      row.product_image_url ||
      row.product_image ||
      row.image ||
      row.photo_url ||
      row.thumbnail_url ||
      ""
  );

const lowStockThresholdForRow = (row = {}, fallback = 2) => {
  const threshold = Number(row.threshold ?? row.low_stock_alert ?? row.product_low_stock_threshold ?? fallback);
  return Number.isFinite(threshold) && threshold > 0 ? Math.floor(threshold) : fallback;
};

export const groupLowStockAlerts = (rows = [], { fallbackThreshold = 2, limit = null } = {}) => {
  const groups = new Map();

  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const productId = normalizeIdValue(rawRow.product_id ?? rawRow.id ?? null);
    if (productId === null || productId === undefined || productId === "") continue;

    const variantId = normalizeIdValue(rawRow.variant_id ?? rawRow.product_variant_id ?? null);
    const hasVariant = variantId !== null && variantId !== undefined;
    const colorLabel = normalizeColorLabel(rawRow.color);
    const colorKey = normalizeKey(colorLabel) || "default";
    const groupKey = hasVariant ? `${productId}::${colorKey}` : `${productId}::model`;
    const stock = Math.max(0, Math.floor(Number(rawRow.stock ?? rawRow.total_stock ?? 0) || 0));
    const threshold = lowStockThresholdForRow(rawRow, fallbackThreshold);
    const sizeLabel = hasVariant ? normalizeSizeLabel(rawRow.size) : normalizeSizeLabel(rawRow.size || "One Size");
    const existing = groups.get(groupKey) || {
      key: groupKey,
      product_id: productId,
      product_name: normalizeDisplayText(rawRow.product_name || rawRow.name || "منتج"),
      product_sku: normalizeText(rawRow.product_sku || rawRow.sku || ""),
      color: hasVariant ? colorLabel : "",
      color_key: hasVariant ? colorKey : "model",
      has_variants: hasVariant,
      image_url: rowImageUrl(rawRow),
      threshold,
      total_stock: 0,
      low_stock_count: 0,
      low_stock_min: Number.POSITIVE_INFINITY,
      variant_ids: new Set(),
      size_map: new Map(),
      low_stock_sizes: new Set(),
      source_rows: [],
    };

    existing.has_variants = existing.has_variants || hasVariant;
    existing.source_rows.push(rawRow);
    existing.total_stock += stock;
    if (stock > 0 && stock <= threshold) {
      existing.low_stock_count += 1;
      existing.low_stock_min = Math.min(existing.low_stock_min, stock);
      existing.threshold = Math.min(existing.threshold, threshold);
      existing.low_stock_sizes.add(sizeLabel);
    }
    if (!existing.image_url) existing.image_url = rowImageUrl(rawRow);
    if (!existing.product_sku) existing.product_sku = normalizeText(rawRow.product_sku || rawRow.sku || "");
    if (variantId !== null && variantId !== undefined) existing.variant_ids.add(variantId);

    const sizeKey = normalizeKey(sizeLabel) || `size-${existing.size_map.size + 1}`;
    const sizeEntry = existing.size_map.get(sizeKey) || {
      size: sizeLabel,
      stock: 0,
      variant_ids: new Set(),
    };
    sizeEntry.stock += stock;
    if (variantId !== null && variantId !== undefined) sizeEntry.variant_ids.add(variantId);
    existing.size_map.set(sizeKey, sizeEntry);

    groups.set(groupKey, existing);
  }

  const alerts = Array.from(groups.values())
    .map((group) => {
      const sizeBreakdown = Array.from(group.size_map.values())
        .map((entry) => ({
          size: entry.size,
          stock: entry.stock,
          variant_ids: Array.from(entry.variant_ids),
        }))
        .sort((left, right) => sortSizeLabels(left.size, right.size));

      const threshold = Number.isFinite(group.threshold) && group.threshold > 0 ? group.threshold : fallbackThreshold;
      const lowStockSizes = sizeBreakdown
        .filter((entry) => entry.stock > 0 && entry.stock <= threshold)
        .map((entry) => entry.size);
      const lowStockMin = Number.isFinite(group.low_stock_min) ? group.low_stock_min : threshold;
      const critical = lowStockMin <= 1;
      const hasColorGroup = group.has_variants;
      const alertScope = hasColorGroup ? "product_color" : "product_model";
      const alertTitle = hasColorGroup ? "مطلوب إعادة طلب" : "مخزون منخفض";
      const alertReason = hasColorGroup
        ? lowStockSizes.length > 0
          ? `المقاسات ${lowStockSizes.slice(0, 3).join("، ")}${lowStockSizes.length > 3 ? "..." : ""} تحت الحد`
          : "أحد المقاسات تحت الحد"
        : "المنتج تحت حد المخزون";

      return {
        id: `${group.product_id}-${alertScope}-${group.color_key}`,
        alert_scope: alertScope,
        alert_level: critical ? "critical" : "high",
        alert_title: alertTitle,
        alert_reason: alertReason,
        alert_reasons: lowStockSizes.length ? lowStockSizes.map((size) => `مقاس ${size}`) : [alertReason],
        badge_text: "عاجل",
        product_id: group.product_id,
        product_name: group.product_name,
        name: group.product_name,
        product_sku: group.product_sku,
        sku: group.product_sku,
        color: group.color,
        size: hasColorGroup ? "" : (sizeBreakdown[0]?.size || ""),
        stock: group.total_stock,
        total_stock: group.total_stock,
        threshold,
        image_url: group.image_url,
        variant_id: hasColorGroup ? null : (Array.from(group.variant_ids)[0] || null),
        variant_ids: Array.from(group.variant_ids),
        variant_count: group.variant_ids.size,
        size_breakdown: sizeBreakdown,
        low_stock_sizes: lowStockSizes,
        low_stock_count: group.low_stock_count,
        low_stock_min: lowStockMin,
      };
    })
    .filter((alert) => (alert.alert_scope === "product_model" ? alert.stock > 0 && alert.stock <= alert.threshold : alert.low_stock_count > 0))
    .sort((left, right) => {
      const leftPriority = left.alert_scope === "product_model" ? 1 : 0;
      const rightPriority = right.alert_scope === "product_model" ? 1 : 0;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (left.total_stock !== right.total_stock) return left.total_stock - right.total_stock;
      const productCompare = String(left.product_name || "").localeCompare(String(right.product_name || ""), "ar");
      if (productCompare !== 0) return productCompare;
      return String(left.color || "").localeCompare(String(right.color || ""), "ar");
    });

  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? alerts.slice(0, limit) : alerts;
};
