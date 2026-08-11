import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("server/controllers/customersController.js", "utf8");
const lookupSource = source.slice(
  source.indexOf("const getCustomerByIdentifier"),
  source.indexOf("const getUsableCustomerOrderCounts")
);

test("customer lookup prefers the duplicate phone record linked to ERP orders", () => {
  assert.match(lookupSource, /LIMIT 25/);
  assert.match(lookupSource, /SELECT customer_id, COUNT\(\*\)::int AS order_count/);
  assert.match(lookupSource, /customer_id = ANY\(\$1::bigint\[\]\)/);
  assert.match(lookupSource, /orderCounts\.get\(String\(row\.id\)\)/);
  assert.match(lookupSource, /> \(orderCounts\.get\(String\(best\.id\)\)/);
});
