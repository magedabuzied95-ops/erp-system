import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const centerServiceSource = read("../server/modules/shipping/shipping.center.service.js");

// Columns the `orders` table is known to have: the ones in the schema dump plus the
// ones the app adds itself at boot. Everything else is a column that exists only in
// somebody's head.
const knownOrdersColumns = () => {
  const dump = read("../schema_only.sql");
  const table = dump.match(/CREATE TABLE public\.orders \(([\s\S]*?)\n\);/);
  assert.ok(table, "the schema dump must still contain the orders table");

  const columns = new Set(
    table[1].split("\n").map((line) => line.trim().split(/\s+/)[0]).filter(Boolean)
  );

  for (const dir of ["../server/modules/shipping", "../server/controllers", "../server/services"]) {
    for (const file of readdirSync(new URL(`${dir}/`, import.meta.url))) {
      if (!file.endsWith(".js")) continue;
      const source = read(`${dir}/${file}`);
      for (const match of source.matchAll(/ALTER TABLE (?:IF EXISTS )?orders\s+ADD COLUMN IF NOT EXISTS ([a-z_]+)/g)) {
        columns.add(match[1]);
      }
    }
  }
  return columns;
};

/*
 * `COALESCE(o.payment_type, '')` took the whole Shipping Center down with a 500 —
 * "column o.payment_type does not exist". Nothing in the repo ever creates that
 * column, and every JS path tolerated its absence: `insertReturning` filters the
 * checkout payload against the real table columns, so the storefront silently
 * dropped it on write, and `order.payment_type` just read undefined everywhere.
 * Raw SQL is the one place that cannot shrug, and it was the last place to run.
 */
test("the Shipping Center only selects orders columns that actually exist", () => {
  const columns = knownOrdersColumns();
  const referenced = [...new Set([...centerServiceSource.matchAll(/\bo\.([a-z_]+)/g)].map((m) => m[1]))];
  const unaccounted = referenced.filter((column) => !columns.has(column));

  assert.ok(referenced.length > 20, "the projection should still be reading real columns");
  assert.deepEqual(unaccounted, [], `these columns are queried but never created: ${unaccounted.join(", ")}`);
});

test("payment_type stays out of the SQL, whatever the JS does with it", () => {
  assert.doesNotMatch(centerServiceSource, /o\.payment_type/);
});
