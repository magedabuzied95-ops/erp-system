import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frontend = fs.readFileSync("src/modules/pos/pages/POSPro.jsx", "utf8");
const createCustomerHandler = frontend.slice(
  frontend.indexOf("const handleCreateCustomer = useCallback"),
  frontend.indexOf("const handleOpenShift"),
);

test("creating a POS customer does not wait for a full customer-list reload", () => {
  assert.match(createCustomerHandler, /await api\.post\("\/customers"/);
  assert.doesNotMatch(createCustomerHandler, /await loadCustomers\(/);
  assert.match(createCustomerHandler, /savePosCustomerSnapshot\(\[createdCustomer\]/);
});

test("POS customer creation prevents repeated submissions while saving", () => {
  assert.match(frontend, /if \(customerCreateSaving\) return/);
  assert.match(frontend, /disabled=\{customerCreateSaving\}/);
  assert.match(frontend, /aria-busy=\{customerCreateSaving\}/);
});
