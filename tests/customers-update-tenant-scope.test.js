import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("customer updates allow a super admin's null tenant scope", async () => {
  const source = await readFile(new URL("../server/controllers/customersController.js", import.meta.url), "utf8");
  const updateStart = source.indexOf("export const updateCustomer");
  const updateEnd = source.indexOf("export const getCustomerOrders", updateStart);
  const updateSource = source.slice(updateStart, updateEnd);

  assert.match(
    updateSource,
    /AND \(\$\$\{params\.length\}::bigint IS NULL OR tenant_id = \$\$\{params\.length\}::bigint\)/,
  );
  assert.doesNotMatch(updateSource, /AND tenant_id = \$\$\{params\.length\}::bigint/);
});
