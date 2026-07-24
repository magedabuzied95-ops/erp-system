import { buildAvailableSizeOptions, normalizeSizeComparable, normalizeStockValue } from "./displayRefillSizing.js";
import { classifyPrintProduct, PRINT_PRODUCT_KINDS } from "./productPrintClassifier.js";

export const LABEL_SPECS = Object.freeze({
  box: { key: "box", label: "Box", widthMm: 100, heightMm: 50, job: "box" },
  display: { key: "display", label: "Display", widthMm: 40, heightMm: 55, job: "display" },
  bag: { key: "bag", label: "Bags", widthMm: 40, heightMm: 55, job: "display" },
  crocs: { key: "crocs", label: "Crocs", widthMm: 25, heightMm: 35, job: "crocs" },
});

const text = (value) => String(value ?? "").trim();
const variantId = (row) => row.variant_id ?? row.variantId ?? row.id ?? "";
const canonicalVariantBarcode = (row = {}) =>
  text(row.barcode || row.variant_barcode || row.barcode_label || row.product_code || row.code);
const colorKey = (row = {}) => text(row.color || row.color_name || row.colorName || "default").toLowerCase();
const price = (product, row) => Number(row.sale_price || row.selling_price || row.price || product.sale_price || product.selling_price || product.price || 0);

const makeLabels = (type, product, row, quantity) => Array.from({ length: Math.max(0, quantity) }, (_, copy) => ({
  id: `${product.id || "product"}:${variantId(row)}:${type}:${copy}`,
  type,
  template: type,
  widthMm: LABEL_SPECS[type].widthMm,
  heightMm: LABEL_SPECS[type].heightMm,
  productId: product.id,
  variantId: variantId(row),
  productName: text(product.name || product.product_name || product.title),
  barcodeValue: canonicalVariantBarcode(row),
  price: price(product, row),
  size: type === "bag" ? "" : text(row.size || row.variant_size),
  color: text(row.color || row.color_name || row.colorName),
  fieldLabel: type === "bag" ? "اللون" : "المقاس",
  fieldValue: type === "bag" ? text(row.color || row.color_name || row.colorName) : text(row.size || row.variant_size),
}));

export function buildProductLabelPrintPlan(products = []) {
  const labels = [];
  const warnings = [];
  for (const product of Array.isArray(products) ? products : []) {
    const classification = classifyPrintProduct(product);
    if (classification.warning) warnings.push(classification.warning);
    const variants = (Array.isArray(product.variants) ? product.variants : []).filter((row) => normalizeStockValue(row) > 0);
    const printable = variants.filter((row) => {
      if (canonicalVariantBarcode(row)) return true;
      warnings.push(`تم استبعاد variant ${variantId(row) || "غير معروف"} من "${product.name || product.id || "المنتج"}" لعدم وجود barcode.`);
      return false;
    });
    if (classification.kind === PRINT_PRODUCT_KINDS.CROCS) {
      printable.forEach((row) => labels.push(...makeLabels("crocs", product, row, normalizeStockValue(row))));
      continue;
    }
    if (classification.kind === PRINT_PRODUCT_KINDS.BAGS) {
      printable.forEach((row) => labels.push(...makeLabels("bag", product, row, normalizeStockValue(row))));
      continue;
    }
    if (classification.kind === PRINT_PRODUCT_KINDS.FALLBACK) {
      printable.forEach((row) => labels.push(...makeLabels("box", product, row, normalizeStockValue(row))));
      continue;
    }
    const groups = printable.reduce((map, row) => {
      const key = colorKey(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
      return map;
    }, new Map());
    for (const rows of groups.values()) {
      const smallest = buildAvailableSizeOptions(rows)[0];
      const displayRow = smallest ? rows.find((row) => normalizeSizeComparable(row.size) === String(smallest.normalized)) : null;
      rows.forEach((row) => {
        const stock = normalizeStockValue(row);
        if (row === displayRow) {
          labels.push(...makeLabels("display", product, row, 1));
          labels.push(...makeLabels("box", product, row, Math.max(stock - 1, 0)));
        } else {
          labels.push(...makeLabels("box", product, row, stock));
        }
      });
    }
  }
  const counts = labels.reduce((acc, label) => ({ ...acc, [label.type]: (acc[label.type] || 0) + 1 }), { box: 0, display: 0, bag: 0, crocs: 0 });
  return { labels, warnings, counts: { ...counts, total: labels.length } };
}

export function groupProductLabelPdfJobs(plan = {}) {
  const labels = Array.isArray(plan.labels) ? plan.labels : [];
  return [
    { key: "box", filename: "box-labels-100x50.pdf", widthMm: 100, heightMm: 50, labels: labels.filter((x) => x.type === "box") },
    { key: "display", filename: "display-bag-labels-40x55.pdf", widthMm: 40, heightMm: 55, labels: labels.filter((x) => x.type === "display" || x.type === "bag") },
    { key: "crocs", filename: "crocs-labels-25x35.pdf", widthMm: 25, heightMm: 35, labels: labels.filter((x) => x.type === "crocs") },
  ].filter((job) => job.labels.length > 0);
}
