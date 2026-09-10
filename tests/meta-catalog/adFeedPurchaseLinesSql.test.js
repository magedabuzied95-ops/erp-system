import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AD_FEED_PURCHASE_COLUMNS,
  AD_FEED_PURCHASE_CTES,
  AD_FEED_PURCHASE_JOINS,
} from "../../server/services/adFeedPurchaseLinesSql.js";

const squash = (value) => value.replace(/\s+/g, " ").trim();
const ctes = squash(AD_FEED_PURCHASE_CTES);
const columns = squash(AD_FEED_PURCHASE_COLUMNS);
const joins = squash(AD_FEED_PURCHASE_JOINS);

test("a size's own newest line wins even when it carries no sale price", () => {
  // Product 51: the newest invoice for the size recorded no sale price; an older one said 500.
  // The feed used to filter on sale_price > 0 and so resurrected the older 500 while the shop
  // charged 550.
  const own = ctes.slice(ctes.indexOf("ad_variant_own_line AS ("), ctes.indexOf("ad_color_any_line AS ("));
  assert.match(own, /WHERE variant_id IS NOT NULL ORDER BY variant_id, created_at DESC NULLS LAST, pi_id DESC/);
  assert.doesNotMatch(own, /sale_price\s*(>|IS NOT NULL)/, "the own line must not be chosen by whether it has a sale price");
});

test("colour lines: any line for a priceless size, only colour-level lines otherwise", () => {
  const any = ctes.slice(ctes.indexOf("ad_color_any_line AS ("), ctes.indexOf("ad_color_only_line AS ("));
  const only = ctes.slice(ctes.indexOf("ad_color_only_line AS ("));
  assert.match(any, /WHERE match_color <> '' ORDER BY product_id, match_color, created_at DESC NULLS LAST, pi_id DESC/);
  assert.match(only, /WHERE match_color <> '' AND variant_id IS NULL/);
  assert.match(joins, /aca\.product_id = pv\.product_id AND aca\.match_color = LOWER\(TRIM\(pv\.color\)\)/);
  assert.match(joins, /aco\.product_id = pv\.product_id AND aco\.match_color = LOWER\(TRIM\(pv\.color\)\)/);
});

test("the winning line is own, then colour-for-priceless, then colour-level — and falls back to the columns", () => {
  for (const field of ["purchase_selling_price", "purchase_sale_price"]) {
    assert.match(
      columns,
      new RegExp(`CASE WHEN avo\\.variant_id IS NOT NULL THEN avo\\.${field} WHEN \\( COALESCE\\(.+?\\) IS NULL AND COALESCE\\(.+?\\) IS NULL \\) THEN aca\\.${field} ELSE aco\\.${field} END`),
    );
  }
  assert.match(columns, /, NULLIF\(pv\.purchase_selling_price, 0\)\) AS variant_line_purchase_selling_price/);
  assert.match(columns, /, NULLIF\(pv\.sale_price, 0\)\) AS variant_line_sale_price/);
});

test("the feeds qualify invoice lines exactly as the storefront does", () => {
  // Drift between the two definitions is how the ads came to quote prices checkout did not.
  const controller = squash(readFileSync(new URL("../../server/controllers/storefrontController.js", import.meta.url), "utf8"));
  const storefront = controller.slice(controller.indexOf("candidate_purchase_items AS MATERIALIZED ("), controller.indexOf("candidate_purchase_matches AS ("));
  for (const clause of [
    "COALESCE(NULLIF(LOWER(TRIM(pu.status)), ''), 'received') NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')",
    "COALESCE(LOWER(TRIM(pi.metadata->>'color')), '') AS match_color",
    "COALESCE(NULLIF(pi.selling_price, 0), NULLIF(pi.regular_price, 0)) AS purchase_selling_price",
    "NULLIF(pi.sale_price, 0) AS purchase_sale_price",
  ]) {
    assert.ok(storefront.includes(clause), `storefront no longer has: ${clause}`);
    assert.ok(ctes.includes(clause), `feeds no longer have: ${clause}`);
  }
});

test("both feeds splice the shared definition instead of carrying their own", () => {
  for (const file of ["metaCatalogFeedService.js", "googleMerchantFeedService.js"]) {
    const source = readFileSync(new URL(`../../server/services/${file}`, import.meta.url), "utf8");
    for (const part of ["${AD_FEED_PURCHASE_CTES}", "${AD_FEED_PURCHASE_COLUMNS}", "${AD_FEED_PURCHASE_JOINS}"]) {
      assert.ok(source.includes(part), `${file} must splice ${part}`);
    }
    assert.doesNotMatch(source, /FROM purchase_items/, `${file} must not hand-roll its own purchase-line query`);
  }
});
