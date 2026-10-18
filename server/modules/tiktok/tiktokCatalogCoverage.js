import { tiktokContentId } from "../../../shared/tiktokPixelEvent.js";

/*
 * Does every size the shop shows exist in the TikTok catalogue under the id the pixel sends?
 *
 * TikTok's "Catalog match rate" falls whenever a ViewContent / AddToCart carries a content_id
 * the catalogue does not have. This compares the two sides directly: each size in the
 * storefront payload, its pixel content_id (the real shared function, not a copy), and the
 * feed's sku_id set. Pure — the CLI (server/scripts/tiktokCatalogCoverageCheck.js) does the
 * fetching. Reports ids and counts only, never product names or customer data.
 */

const text = (value = "") => String(value ?? "").trim();

// First column of the feed CSV (sku_id), quoted as the feed writes it.
export const parseFeedSkuIds = (csv = "") =>
  new Set(
    String(csv)
      .split("\n")
      .slice(1)
      .map((line) => (line.match(/^"((?:[^"]|"")*)"/) || [])[1])
      .filter(Boolean)
      .map((id) => id.replace(/""/g, '"'))
  );

const PRICE_FIELDS = ["price", "selling_price", "final_price", "current_selling_price", "purchase_selling_price", "sale_price"];
const hasAnyPrice = (variant = {}) => PRICE_FIELDS.some((field) => Number(variant[field]) > 0);

/*
 * Why a shown size is missing from the feed, in a fixed word:
 *   no_price    — no price anywhere: the feed drops it, yet the shop still shows it;
 *   no_id       — the pixel would send nothing usable;
 *   not_in_feed — priced and identified, still absent (a new product the feed has not
 *                 picked up yet, a filter mismatch between shop and feed).
 */
const missingReason = (variant, id) => {
  if (!id) return "no_id";
  if (!hasAnyPrice(variant)) return "no_price";
  return "not_in_feed";
};

export const compareCatalogCoverage = ({ feedIds = new Set(), products = [], maxExamples = 5 } = {}) => {
  const seenVariants = new Set();
  const report = {
    sizes_shown: 0,
    in_stock_shown: 0,
    missing: 0,
    missing_in_stock: 0,
    by_reason: {},
    products_with_missing: 0,
    examples: [],
  };
  const productsWithMissing = new Set();
  for (const product of Array.isArray(products) ? products : []) {
    for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
      const variantKey = text(variant?.id) || `${text(product?.id)}:${text(variant?.sku)}`;
      if (seenVariants.has(variantKey)) continue; // the same size on two cards counts once
      seenVariants.add(variantKey);
      report.sizes_shown += 1;
      const inStock = Number(variant?.stock || 0) > 0;
      if (inStock) report.in_stock_shown += 1;
      const id = text(tiktokContentId(product || {}, variant || {}));
      if (id && feedIds.has(id)) continue;
      const reason = missingReason(variant || {}, id);
      report.missing += 1;
      if (inStock) report.missing_in_stock += 1;
      report.by_reason[reason] = (report.by_reason[reason] || 0) + 1;
      productsWithMissing.add(text(product?.id || product?.product_id));
      if (report.examples.length < maxExamples) {
        report.examples.push({ product_id: text(product?.id || product?.product_id), variant_id: text(variant?.id), content_id: id, in_stock: inStock, reason });
      }
    }
  }
  report.products_with_missing = productsWithMissing.size;
  report.missing_ratio = report.sizes_shown ? Math.round((report.missing / report.sizes_shown) * 10000) / 10000 : 0;
  return report;
};

// A missing size in stock is what costs matches today; the ratio is over every shown size.
export const coverageIsHealthy = (report = {}, { maxMissingRatio = 0.01 } = {}) =>
  Number(report.sizes_shown || 0) > 0 && Number(report.missing_ratio || 0) <= maxMissingRatio;
