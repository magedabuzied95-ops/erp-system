import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 2026-09-14 storefront audit, two leaks of the same rule — "hidden on the shop means not for sale":
//  A. checkout locked the size row only, so a product the owner switched off, drafted, archived or
//     hid still sold to an old saved cart or to anyone posting its variant ids;
//  B. the Google and Meta feeds ignored the per-size colour hide, so ads kept promoting a colour
//     whose landing page no longer shows it.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const squash = (value) => value.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return source.slice(from, to);
};

const controller = read("../server/controllers/storefrontController.js");

// Resolve the module-level SQL constants a query splices, so the assertions read the SQL that
// actually runs rather than the names it is assembled from.
const sqlConstant = (name) => {
  const match = controller.match(new RegExp(`const ${name} = (?:"([^"]*)"|\`([^\`]*)\`);`));
  assert.ok(match, `missing SQL constant ${name}`);
  return match[1] ?? match[2];
};
const expandConstants = (sql) =>
  sql.replace(/\$\{(storefront\w+ConditionSql|catalogVariantJoinSql)\}/g, (_, name) => expandConstants(sqlConstant(name)));

const PRODUCT_ON_SALE = [
  "p.is_active IS DISTINCT FROM FALSE",
  "COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')",
];
const PRODUCT_VISIBLE = "COALESCE(p.is_storefront_visible, TRUE) = TRUE";
const VARIANT_SELLABLE = [
  "pv.is_active IS DISTINCT FROM FALSE",
  "COALESCE(pv.is_storefront_visible, TRUE) = TRUE",
  "pv.deleted_at IS NULL",
];

// Checkout and the cart re-price both read sizes through storefrontCartVariantSql; checkout asks it
// for one id with FOR UPDATE.
const cartVariantSqlSource = () => between(controller, "const storefrontCartVariantSql =", "\n};\n");
const checkoutLockSql = () => {
  const lock = between(cartVariantSqlSource(), "FROM product_variants pv\n        JOIN products p ON p.id = pv.product_id", "FOR UPDATE");
  return squash(expandConstants(lock));
};

test("checkout locks a size only when its product is still on sale and visible", () => {
  const sql = checkoutLockSql();
  const where = sql.slice(sql.indexOf("WHERE ${idClause}"));
  for (const condition of [...VARIANT_SELLABLE, ...PRODUCT_ON_SALE, PRODUCT_VISIBLE]) {
    assert.ok(where.includes(condition), `checkout lock no longer requires: ${condition}`);
  }
  assert.match(where, /\$\{productDeletedClause\}/, "a soft-deleted product must not be lockable");
  assert.match(
    controller,
    /const productDeletedClause = productColumns\.has\("deleted_at"\) \? "AND p\.deleted_at IS NULL" : "";/
  );
  const checkout = between(controller, "export const createWebsiteOrder", "export const createPosOnlineOrder");
  assert.match(checkout, /storefrontCartVariantSql\(\{[\s\S]*?idClause: "pv\.id = \$1",\s*forUpdate: true,/);
});

test("the catalog and checkout splice one product-on-sale definition, so they cannot drift", () => {
  const catalog = between(controller, "const buildCatalogQuery =", "candidate_purchase_items AS MATERIALIZED (");
  assert.match(catalog, /AND \$\{storefrontProductOnSaleConditionSql\}/);
  assert.match(catalog, /AND \$\{storefrontVisibilityConditionSql\}/);
  assert.match(catalog, /LEFT JOIN product_variants pv ON pv\.product_id = p\.id\$\{catalogVariantJoinSql\}/);
  const helper = cartVariantSqlSource();
  assert.match(helper, /WHERE \$\{idClause\}\$\{catalogVariantJoinSql\}/);
  assert.match(helper, /AND \$\{storefrontProductOnSaleConditionSql\}/);
  const expanded = squash(expandConstants("${storefrontProductOnSaleConditionSql}"));
  for (const condition of PRODUCT_ON_SALE) assert.ok(expanded.includes(condition), `shared definition lost: ${condition}`);
});

test("an unavailable product answers with the checkout's own 4xx, not a sale", () => {
  const checkout = between(controller, "export const createWebsiteOrder", "export const createPosOnlineOrder");
  assert.match(
    checkout,
    /if \(!variant\) throw checkoutValidationError\("Selected variant is unavailable", "items\.variant_id", \{ variant_id: variantId \}\);/
  );
  // The shelf-price fallback runs only for a size the lock returned, so it can no longer resurrect one.
  assert.ok(checkout.indexOf("if (!variant) throw checkoutValidationError") < checkout.indexOf("priceStorefrontVariantRows("));
});

test("the till's online order runs the same lock — no visibility bypass for posOnlineOrder", () => {
  const sql = between(controller, "export const createWebsiteOrder", "export const createPosOnlineOrder");
  const lockStart = sql.indexOf("select variant for update");
  const loop = sql.slice(sql.indexOf("for (const item of items)"), lockStart);
  assert.doesNotMatch(loop, /posOnlineOrder/, "the lock query must not branch on the till flag");
  assert.match(read("../server/controllers/storefrontController.js"), /req\.posOnlineOrder = true;\n  return createWebsiteOrder\(req, res\);/);
});

const google = read("../server/services/googleMerchantFeedService.js");
const meta = read("../server/services/metaCatalogFeedService.js");

test("Google feed drops a colour hidden on the storefront", () => {
  const rows = squash(between(google, "const googleRowsSql = `", "LIMIT $1 OFFSET $2"));
  const join = rows.slice(rows.indexOf("LEFT JOIN product_variants pv"), rows.indexOf("LEFT JOIN categories c"));
  for (const condition of VARIANT_SELLABLE) assert.ok(join.includes(condition), `Google variant join lost: ${condition}`);
  // A product whose every size is hidden has no joined row and existing sizes, so it drops out.
  assert.match(rows, /pv\.id IS NOT NULL OR NOT EXISTS \(SELECT 1 FROM product_variants pv_any WHERE pv_any\.product_id = p\.id\)/);
});

test("Meta feed drops hidden colours and counts SKU uniqueness over the same rows", () => {
  const query = squash(between(meta, "const queryMetaCatalogRows = async", "return result.rows"));
  const counts = query.slice(query.indexOf("variant_sku_counts AS ("), query.indexOf("color_images AS ("));
  for (const condition of ["v.is_active IS DISTINCT FROM FALSE", "COALESCE(v.is_storefront_visible, TRUE) = TRUE", "v.deleted_at IS NULL"]) {
    assert.ok(counts.includes(condition), `SKU count lost: ${condition}`);
  }
  const where = query.slice(query.lastIndexOf("WHERE p.is_active"));
  for (const condition of VARIANT_SELLABLE) assert.ok(where.includes(condition), `Meta rows lost: ${condition}`);
});

test("both feeds already hold back products the shop hides, at least as strictly as the catalog", () => {
  const google_ = squash(between(google, "const googleRowsSql = `", "LIMIT $1 OFFSET $2"));
  const meta_ = squash(between(meta, "const queryMetaCatalogRows = async", "return result.rows"));
  for (const [name, sql] of [["google", google_], ["meta", meta_]]) {
    const where = sql.slice(sql.lastIndexOf("WHERE p.is_active"));
    assert.ok(where.includes("p.is_active IS DISTINCT FROM FALSE"), `${name}: inactive products`);
    // Only 'active' passes — stricter than the catalog's deny-list, never looser.
    assert.ok(where.includes("COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') = 'active'"), `${name}: status`);
    assert.ok(where.includes("p.is_storefront_visible IS DISTINCT FROM FALSE"), `${name}: hidden products`);
  }
});
