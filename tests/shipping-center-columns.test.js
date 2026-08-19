import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const centerServiceSource = read("../server/modules/shipping/shipping.center.service.js");
const shippingServiceSource = read("../server/modules/shipping/shipping.service.js");

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
      for (const match of read(`${dir}/${file}`).matchAll(/ALTER TABLE (?:IF EXISTS )?orders\s+ADD COLUMN IF NOT EXISTS ([a-z_]+)/g)) {
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
test("the shipping queries only select orders columns that actually exist", () => {
  const columns = knownOrdersColumns();
  // Both files alias the orders table as `o`, which is what makes this auditable at
  // all: an unprefixed name in a query is indistinguishable from an output alias.
  const sources = {
    "shipping.center.service.js": centerServiceSource,
    "shipping.service.js": shippingServiceSource,
  };

  let total = 0;
  for (const [name, source] of Object.entries(sources)) {
    const referenced = [...new Set([...source.matchAll(/\bo\.([a-z_]+)/g)].map((m) => m[1]))];
    total += referenced.length;
    const unaccounted = referenced.filter((column) => !columns.has(column));
    assert.deepEqual(unaccounted, [], `${name} queries columns that are never created: ${unaccounted.join(", ")}`);
  }
  assert.ok(total > 20, "the projections should still be reading real columns");
});

test("payment_type stays out of the SQL, whatever the JS does with it", () => {
  assert.doesNotMatch(centerServiceSource, /o\.payment_type/);
});

/*
 * `order_number` is the second half of the same lesson, and it cost a second 500:
 * it is an ALIAS the Shipping Center builds out of public_order_number /
 * display_order_number / invoice_number, not a column. Selecting it bare failed with
 * the identical 42703. An unprefixed column is invisible to the audit above, so the
 * rule these queries follow is that the table gets aliased and columns get qualified.
 */
test("the label query names orders the same way the list does", () => {
  const start = shippingServiceSource.indexOf("export const fetchBostaShipmentLabels");
  const end = shippingServiceSource.indexOf("export const refreshBostaShipmentForOrder");
  assert.ok(start > 0 && end > start, "fetchBostaShipmentLabels must still be there to audit");
  const labelQuery = shippingServiceSource.slice(start, end);

  assert.match(labelQuery, /FROM orders o\b/, "the table must be aliased so the column audit can see it");
  assert.doesNotMatch(labelQuery, /COALESCE\(order_number/, "order_number is an alias, not a column");

  const canonical = /COALESCE\(o\.public_order_number, o\.display_order_number, o\.invoice_number/;
  assert.match(labelQuery, canonical, "a skipped order must be named the way the row the user selected is named");
  assert.match(centerServiceSource, canonical, "and that naming must stay the same expression the list uses");
});
