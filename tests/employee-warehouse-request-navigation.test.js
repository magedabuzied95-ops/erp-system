import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const payrollPortalSource = await readFile(
  new URL("../src/modules/employees/pages/EmployeePayrollPortal.jsx", import.meta.url),
  "utf8"
);
const productsSource = await readFile(
  new URL("../src/modules/employees/pages/EmployeePortalProducts.jsx", import.meta.url),
  "utf8"
);

test("warehouse request uses a cache-safe direct link and preloads its page", () => {
  assert.match(payrollPortalSource, /import\("\.\/EmployeePortalProducts"\)/);
  assert.match(payrollPortalSource, /href=\{`\/employee-portal\/\$\{encodeURIComponent\(token\)\}\/products`\}/);
  assert.match(payrollPortalSource, /data-testid="warehouse-request-link"/);
  assert.doesNotMatch(payrollPortalSource, /onClick=\{\(\) => navigate\(`\/employee-portal\/\$\{encodeURIComponent\(token\)\}\/products`\)\}/);
  assert.doesNotMatch(payrollPortalSource, /window\.location\.assign\(`\/employee-portal\/\$\{encodeURIComponent\(token\)\}\/products`\)/);
});

test("product catalog request starts without an artificial timer", () => {
  assert.match(productsSource, /void loadProducts\(\)/);
  assert.doesNotMatch(productsSource, /setTimeout\(async \(\) =>/);
});
