import test from "node:test";
import assert from "node:assert/strict";

import { colourQueueSql, doneClause, parseRefreshBefore, parseTypeList, productQueueSql, queryPlan } from "../server/scripts/backfillThermalArtwork.js";

const CUTOFF = "2026-09-07T00:00:00.000Z";

test("artwork with no timestamp counts as old, not unknown, so it is redrawn", () => {
  // A NULL inside BOOL_OR hides the whole colour from the queue; the 121
  // colours drawn before the timestamp column existed vanished exactly so.
  const clause = doneClause("ready", "v.thermal_image_generated_at", CUTOFF);
  assert.match(clause, /COALESCE\(v\.thermal_image_generated_at >= \$1::timestamptz, false\)/);
  assert.equal(doneClause("ready", "v.thermal_image_generated_at", null), "(ready)");
});

test("the colour queue walks the newest product first", () => {
  const { sql, params } = colourQueueSql({ cutoff: CUTOFF, excluded: [], first: [] });
  assert.match(sql, /ORDER BY MAX\(p\.created_at\) DESC, v\.product_id DESC/);
  assert.match(sql, /HAVING NOT BOOL_OR\(/);
  // One drawing per colour, never per size row.
  assert.match(sql, /GROUP BY v\.product_id, color_key, primary_image_url/);
  assert.deepEqual(params, [CUTOFF]);
});

test("excluded product types never enter either queue, and preferred types lead it", () => {
  const colours = colourQueueSql({ cutoff: CUTOFF, excluded: ["bags"], first: ["sneakers"] });
  assert.match(colours.sql, /LOWER\(TRIM\(COALESCE\(p\.product_type, ''\)\)\) <> ALL\(\$2::text\[\]\)/);
  assert.match(colours.sql, /ORDER BY COALESCE\(array_position\(\$3::text\[\], LOWER\(TRIM\(COALESCE\(MAX\(p\.product_type\), ''\)\)\)\), 9999\), MAX\(p\.created_at\) DESC/);
  assert.deepEqual(colours.params, [CUTOFF, ["bags"], ["sneakers"]]);

  const products = productQueueSql({ cutoff: null, excluded: ["bags"], first: [] });
  assert.match(products.sql, /<> ALL\(\$1::text\[\]\)/);
  assert.doesNotMatch(products.sql, /timestamptz/);
  assert.deepEqual(products.params, [["bags"]]);
});

test("the parameter plan numbers only what is set", () => {
  assert.deepEqual(queryPlan({ cutoff: null, excluded: [], first: [] }), { params: [], cutoffPh: "", excludePh: "", firstPh: "" });
  assert.deepEqual(queryPlan({ cutoff: null, excluded: ["bags"], first: ["sneakers"] }), {
    params: [["bags"], ["sneakers"]],
    cutoffPh: "",
    excludePh: "$1",
    firstPh: "$2",
  });
  assert.deepEqual(parseTypeList(" Bags, ,SNEAKERS "), ["bags", "sneakers"]);
});

test("product-level artwork is drawn only where no colour carries a photo", () => {
  const { sql } = productQueueSql({ cutoff: CUTOFF, excluded: [], first: [] });
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1\s*FROM product_variants v/);
  assert.match(sql, /ORDER BY p\.created_at DESC, p\.id DESC/);
});

test("the cutoff must be a real date", () => {
  assert.equal(parseRefreshBefore(""), null);
  assert.equal(parseRefreshBefore("2026-09-07T00:00:00Z"), CUTOFF);
  assert.throws(() => parseRefreshBefore("yesterday"), /not a date/);
});
