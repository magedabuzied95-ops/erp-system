import { buildAvailableSizeOptions, normalizeSizeComparable, normalizeStockValue } from "./displayRefillSizing.js";
import { classifyPrintProduct, PRINT_PRODUCT_KINDS } from "./productPrintClassifier.js";

export const LABEL_SPECS = Object.freeze({
  box: { key: "box", label: "Box", widthMm: 100, heightMm: 50, job: "box" },
  display: { key: "display", label: "Display", widthMm: 55, heightMm: 40, job: "display" },
  bag: { key: "bag", label: "Bags", widthMm: 55, heightMm: 40, job: "bag" },
  crocs: { key: "crocs", label: "Crocs", widthMm: 25, heightMm: 35, job: "crocs" },
});

const text = (value) => String(value ?? "").trim();
const variantId = (row) => row.variant_id ?? row.variantId ?? row.id ?? "";
const canonicalVariantBarcode = (row = {}) =>
  text(row.barcode || row.variant_barcode || row.barcode_label || row.product_code || row.code);
const colorKey = (row = {}) => text(row.color || row.color_name || row.colorName || "default").toLowerCase();
// Printed stock labels always carry the normal selling price. The discounted
// sale price belongs to checkout/storefront promotions and must not become the
// permanent price printed on the physical product.
const price = (product, row) => Number(
  row.selling_price ||
  row.sellingPrice ||
  row.regular_price ||
  row.regularPrice ||
  row.retail_price ||
  row.retailPrice ||
  row.price ||
  row.variant_price ||
  product.selling_price ||
  product.sellingPrice ||
  product.regular_price ||
  product.regularPrice ||
  product.retail_price ||
  product.retailPrice ||
  product.price ||
  0
);
const variantImage = (row) => text(
  row.image_url ||
  row.variant_image_url ||
  row.color_image_url ||
  row.image
);
const productImage = (product) => text(
  product.image_url ||
  product.product_image_url ||
  product.image ||
  product.photo_url ||
  product.thumbnail_url ||
  product.primary_image_url
);
const image = (product, row) => variantImage(row) || productImage(product);
const variantThermalImage = (row) => text(
  row.color_thermal_image_url ||
  row.variant_color_thermal_image_url ||
  row.variant_thermal_image_url ||
  row.thermal_image_url ||
  row.colorThermalImageUrl ||
  row.variantColorThermalImageUrl ||
  row.variantThermalImageUrl ||
  row.thermalImageUrl
);
const productThermalImage = (product) => text(
  product.product_thermal_image_url ||
  product.productThermalImageUrl ||
  product.thermal_image_url ||
  product.thermalImageUrl
);
const variantThermalStatus = (row) => text(
  row.variant_thermal_image_status ||
  row.thermal_image_status ||
  row.variantThermalImageStatus ||
  row.thermalImageStatus
);
const productThermalStatus = (product) => text(
  product.product_thermal_image_status ||
  product.thermal_image_status ||
  product.productThermalImageStatus ||
  product.thermalImageStatus
);

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
  imageUrl: image(product, row),
  resolvedImage: image(product, row),
  image_url: image(product, row),
  colorPrimaryImageUrl: variantImage(row),
  color_image_url: variantImage(row),
  variant_image_url: variantImage(row),
  product_image_url: productImage(product),
  productImageUrl: productImage(product),
  thermal_image_url: variantThermalImage(row),
  thermalImageUrl: variantThermalImage(row),
  color_thermal_image_url: variantThermalImage(row),
  colorThermalImageUrl: variantThermalImage(row),
  variant_color_thermal_image_url: variantThermalImage(row),
  variantColorThermalImageUrl: variantThermalImage(row),
  product_thermal_image_url: productThermalImage(product),
  productThermalImageUrl: productThermalImage(product),
  thermal_image_status: variantThermalStatus(row),
  thermalImageStatus: variantThermalStatus(row),
  variant_thermal_image_status: variantThermalStatus(row),
  variantThermalImageStatus: variantThermalStatus(row),
  product_thermal_image_status: productThermalStatus(product),
  productThermalImageStatus: productThermalStatus(product),
  articleCode: text(row.color_article_code || row.colorArticleCode || row.article_code || row.articleCode),
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
    { key: "display", filename: "display-labels-55x40.pdf", widthMm: 55, heightMm: 40, labels: labels.filter((x) => x.type === "display") },
    { key: "bag", filename: "bag-labels-55x40.pdf", widthMm: 55, heightMm: 40, labels: labels.filter((x) => x.type === "bag") },
    { key: "crocs", filename: "crocs-labels-25x35.pdf", widthMm: 25, heightMm: 35, labels: labels.filter((x) => x.type === "crocs") },
  ].filter((job) => job.labels.length > 0);
}
