import test from "node:test";
import assert from "node:assert/strict";

import { colourQueueSql, doneClause, parseRefreshBefore, productQueueSql } from "../server/scripts/backfillThermalArtwork.js";

const CUTOFF = "2026-09-07T00:00:00.000Z";

test("artwork with no timestamp counts as old, not unknown, so it is redrawn", () => {
  // A NULL inside BOOL_OR hides the whole colour from the queue; the 121
  // colours drawn before the timestamp column existed vanished exactly so.
  const clause = doneClause("ready", "v.thermal_image_generated_at", CUTOFF);
  assert.match(clause, /COALESCE\(v\.thermal_image_generated_at >= \$1::timestamptz, false\)/);
  assert.equal(doneClause("ready", "v.thermal_image_generated_at", null), "(ready)");
});

test("the colour queue walks the newest product first", () => {
  const sql = colourQueueSql(CUTOFF);
  assert.match(sql, /ORDER BY MAX\(p\.created_at\) DESC, v\.product_id DESC/);
  assert.match(sql, /HAVING NOT BOOL_OR\(/);
  // One drawing per colour, never per size row.
  assert.match(sql, /GROUP BY v\.product_id, color_key, primary_image_url/);
});

test("product-level artwork is drawn only where no colour carries a photo", () => {
  const sql = productQueueSql(CUTOFF);
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1\s*FROM product_variants v/);
  assert.match(sql, /ORDER BY p\.created_at DESC, p\.id DESC/);
});

test("the cutoff must be a real date", () => {
  assert.equal(parseRefreshBefore(""), null);
  assert.equal(parseRefreshBefore("2026-09-07T00:00:00Z"), CUTOFF);
  assert.throws(() => parseRefreshBefore("yesterday"), /not a date/);
});
