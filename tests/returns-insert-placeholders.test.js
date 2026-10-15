import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The returns page's create path listed 12 columns and 11 placeholders, so Postgres refused
// every return saved from /orders/returns ("INSERT has more target columns than expressions").
test("every INSERT INTO returns has one placeholder per column", () => {
  const source = fs.readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  const inserts = [...source.matchAll(/INSERT INTO returns\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/g)];
  assert.ok(inserts.length >= 2, "both return paths are checked");
  for (const [, columns, values] of inserts) {
    const columnCount = columns.split(",").map((c) => c.trim()).filter(Boolean).length;
    const valueCount = values.split(",").map((v) => v.trim()).filter(Boolean).length;
    assert.equal(valueCount, columnCount, `columns (${columns.replace(/\s+/g, " ").trim()}) vs values (${values.trim()})`);
  }
});
