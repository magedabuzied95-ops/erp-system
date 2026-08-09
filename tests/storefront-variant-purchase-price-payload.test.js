import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveCurrentSellingPrice } from "../server/services/currentSellingPriceResolver.js";

const controller = readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8",
);

// Collapse runtime whitespace so these assertions pin SEMANTICS, not indentation.
const squash = (value) => value.replace(/\s+/g, " ").trim();

// Extract a named region of the catalog query builder. Anchoring each assertion to a
// region matters: this controller is ~270 KB and contains several unrelated LATERAL
// joins over purchase data, so an unanchored match can be satisfied by code that has
// nothing to do with storefront purchase-price resolution.
const region = (startMarker, endMarker) => {
  const start = controller.indexOf(startMarker);
  assert.notEqual(start, -1, `missing region start: ${startMarker}`);
  const end = controller.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing region end: ${endMarker}`);
  return squash(controller.slice(start, end));
};

const candidateRowsSql = region("WITH candidate_rows AS MATERIALIZED (", "candidate_purchase_items AS MATERIALIZED (");
const candidateItemsSql = region("candidate_purchase_items AS MATERIALIZED (", "candidate_purchase_matches AS (");
const matchesSql = region("candidate_purchase_matches AS (", "last_color_purchase_price AS (");
const resolverSql = region("last_color_purchase_price AS (", "${catalogSelectListSql}");
const projectionSql = region("${catalogSelectListSql}", "${trailing}");

const matchBranches = matchesSql.split(" UNION ALL ");

test("storefront catalog payload preserves each variant purchase selling price", () => {
  assert.match(controller, /'purchase_selling_price', COALESCE\(last_color_purchase_price\.purchase_selling_price, pv\.purchase_selling_price\)/);
  assert.match(controller, /'sale_price', COALESCE\(last_color_purchase_price\.purchase_sale_price, pv\.sale_price\)/);
  assert.match(controller, /'manual_selling_price', pv\.manual_selling_price/);
  assert.match(controller, /'manual_price_override_active', pv\.manual_price_override_active/);
});

test("an unresolved variant falls back to its own stored purchase and sale prices", () => {
  // The resolver is LEFT JOINed, so a variant with no qualifying purchase item must
  // yield NULL and fall through to the variant's own columns rather than to zero.
  assert.match(projectionSql, /LEFT JOIN last_color_purchase_price ON last_color_purchase_price\.variant_pk = pv\.id/);
  assert.doesNotMatch(
    controller,
    /'purchase_selling_price', COALESCE\(last_color_purchase_price\.purchase_selling_price, 0\)/,
    "the fallback must be the variant column, never a zero literal",
  );
  assert.equal(
    (controller.match(/COALESCE\(last_color_purchase_price\./g) || []).length,
    2,
    "exactly two payload fields may be fed by the purchase-price resolver",
  );
});

test("purchase price matches on variant id OR normalized color, with no precedence between them", () => {
  // Both match modes must be alternatives inside ONE candidate set. A tiered design
  // (exact variant first, color only as a fallback) would silently change prices,
  // because a newer color-matched purchase legitimately outranks an older
  // variant-id-matched one.
  assert.equal(matchBranches.length, 2, "the two match modes must form exactly one UNION ALL");
  assert.doesNotMatch(matchesSql, /\bUNION\b(?!\s+ALL)/, "UNION ALL is required; UNION would collapse distinct candidates");
  assert.doesNotMatch(matchesSql, /NOT EXISTS/, "no branch may be gated on the absence of the other");

  const [variantBranch, colorBranch] = matchBranches;

  // Variant-id mode: keyed on the purchase item's variant, scoped to the same product.
  assert.match(variantBranch, /ON cr_variant\.variant_id = cpi\.pi_variant_id AND cr_variant\.product_id = cpi\.product_id/);
  assert.doesNotMatch(variantBranch, /match_color/, "the variant-id branch must not depend on color");

  // Color mode: keyed on normalized color, scoped to the same product.
  assert.match(colorBranch, /JOIN candidate_rows cr_color ON cr_color\.product_id = cpi\.product_id/);
  assert.match(colorBranch, /cpi\.match_color = LOWER\(TRIM\(pv_color\.color\)\)/);
  assert.doesNotMatch(colorBranch, /cpi\.pi_variant_id/, "the color branch must not depend on the variant id");

  // Both branches must project the identical ordering key, which is what makes them
  // compete on equal terms in the resolver below.
  for (const branch of matchBranches) {
    assert.match(branch, /cpi\.pu_created_at/);
    assert.match(branch, /cpi\.pi_id/);
  }
});

test("color matching is LOWER/TRIM normalized on both sides and ignores empty metadata color", () => {
  assert.match(
    candidateItemsSql,
    /COALESCE\(LOWER\(TRIM\(pi\.metadata->>'color'\)\), ''\) AS match_color/,
    "the purchase-item color must be lowercased, trimmed, and null-collapsed to empty",
  );
  const colorBranch = matchBranches[1];
  assert.match(colorBranch, /cpi\.match_color <> ''/, "an empty or missing metadata color must never match");
  assert.match(colorBranch, /LOWER\(TRIM\(pv_color\.color\)\)/, "the variant color must be normalized the same way");
});

test("the newest qualifying purchase item wins, with a deterministic tie-break", () => {
  assert.match(resolverSql, /SELECT DISTINCT ON \(variant_pk\)/, "exactly one row per variant");
  assert.match(
    resolverSql,
    /ORDER BY variant_pk, pu_created_at DESC NULLS LAST, pi_id DESC/,
    "recency first, then a unique-key tie-break",
  );
  assert.doesNotMatch(
    resolverSql,
    /created_at DESC(?! NULLS LAST)/,
    "NULLS LAST must stay explicit; DESC defaults to NULLS FIRST and would promote undated purchases",
  );
});

test("tenant and null-tenant rules are applied to both the purchase item and the purchase", () => {
  for (const [name, branch] of [["variant", matchBranches[0]], ["color", matchBranches[1]]]) {
    const product = name === "variant" ? "p_variant" : "p_color";
    assert.match(
      branch,
      new RegExp(`\\(cpi\\.pi_tenant_id = ${product}\\.tenant_id OR cpi\\.pi_tenant_id IS NULL\\)`),
      `${name} branch must accept a purchase item whose tenant matches the product or is null`,
    );
    assert.match(
      branch,
      new RegExp(`\\(cpi\\.pu_tenant_id = ${product}\\.tenant_id OR cpi\\.pu_tenant_id IS NULL\\)`),
      `${name} branch must accept a purchase whose tenant matches the product or is null`,
    );
  }
  // The tenant rules compare against the product, so they cannot be hoisted into the
  // product-free candidate_purchase_items CTE.
  assert.doesNotMatch(candidateItemsSql, /tenant_id =/, "tenant comparison needs a product in scope");
});

test("cancelled-style purchases and zero-priced purchase items are excluded", () => {
  assert.match(
    candidateItemsSql,
    /COALESCE\(NULLIF\(LOWER\(TRIM\(pu\.status\)\), ''\), 'received'\) NOT IN \('cancelled', 'canceled', 'void', 'deleted', 'draft'\)/,
  );
  assert.match(
    candidateItemsSql,
    /COALESCE\(NULLIF\(pi\.selling_price, 0\), NULLIF\(pi\.regular_price, 0\)\) > 0 OR NULLIF\(pi\.sale_price, 0\) > 0/,
    "an item qualifies only if it carries a positive selling/regular price or a positive sale price",
  );
  assert.match(candidateItemsSql, /COALESCE\(NULLIF\(pi\.selling_price, 0\), NULLIF\(pi\.regular_price, 0\)\) AS purchase_selling_price/);
  assert.match(candidateItemsSql, /NULLIF\(pi\.sale_price, 0\) AS purchase_sale_price/);
});

test("the resolver only considers rows in the storefront candidate set", () => {
  assert.match(
    candidateItemsSql,
    /AND EXISTS \(SELECT 1 FROM candidate_rows cr_pi WHERE cr_pi\.product_id = pi\.product_id\)/,
    "purchase items must be restricted to candidate products before matching",
  );
  for (const branch of matchBranches) {
    assert.match(branch, /JOIN candidate_rows /, "each match branch must be restricted to candidate rows");
  }
  assert.match(projectionSql, /FROM candidate_rows cr/);
  assert.match(projectionSql, /LEFT JOIN product_variants pv ON pv\.id = cr\.variant_id/);
});

test("the candidate predicate is defined once and never string-mutated", () => {
  assert.equal(
    (controller.match(/candidate_rows AS MATERIALIZED \(/g) || []).length,
    1,
    "candidate_rows must have a single definition, so the storefront WHERE is evaluated once",
  );
  assert.match(candidateRowsSql, /\$\{where\}/, "caller predicates are injected into the candidate CTE");
  assert.doesNotMatch(projectionSql, /\$\{where\}/, "the outer query must read the candidate set, not re-derive it");

  assert.match(controller, /const buildCatalogQuery = \(\{ where = "", trailing = "", productVisibility = true \} = \{\} \) =>|const buildCatalogQuery = \(\{ where = "", trailing = "", productVisibility = true \} = \{\}\) =>/);
  assert.doesNotMatch(controller, /\$\{catalogQuery\}/, "no caller may interpolate a raw catalog query fragment");

  // The relaxed-visibility fallback must be built from the same source of truth, not
  // produced by replacing text out of an already-assembled query (String.replace
  // substitutes only the first occurrence and would desynchronize the two copies).
  assert.match(
    controller,
    /const storefrontProductsSqlWithoutVisibility = buildCatalogQuery\(\{[\s\S]{0,200}?productVisibility: false,[\s\S]{0,20}?\}\);/,
  );
  assert.doesNotMatch(controller, /storefrontProductsSql\.replace\(/);
  assert.equal(
    (controller.match(/storefrontProductsWhereSql/g) || []).length,
    3,
    "one definition plus exactly two references: the base query and the relaxed-visibility fallback",
  );
});

test("different color variants resolve their own purchase-derived prices", () => {
  const product = { selling_price: 1200 };
  const navy = { color: "Navy", purchase_selling_price: 1350, selling_price: 1200 };
  const olive = { color: "Olive", purchase_selling_price: 1500, selling_price: 1200 };

  assert.equal(resolveCurrentSellingPrice({ product, variant: navy }).value, 1350);
  assert.equal(resolveCurrentSellingPrice({ product, variant: olive }).value, 1500);
});
