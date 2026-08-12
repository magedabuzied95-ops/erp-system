import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frontend = fs.readFileSync("src/modules/pos/pages/POSPro.jsx", "utf8");
const backend = fs.readFileSync("server/controllers/ordersController.js", "utf8");

test("POS invoice editing retains the loaded customer when the lazy customer list misses it", () => {
  assert.match(frontend, /const customerSnapshotFromOrder =/);
  assert.match(frontend, /customer \|\| \(editingOrder\?\.id \? customerSnapshotFromOrder\(editingOrder\) : null\) \|\| WALK_IN_CUSTOMER/);
  assert.match(frontend, /return \[loadedCustomer, \.\.\.rows\]/);
});

test("the edit API refuses to replace a named customer with an implicit walk-in fallback", () => {
  assert.match(backend, /const preserveLoadedCustomer = req\.body\.customer_changed !== true/);
  assert.match(backend, /isDefaultWalkInCustomerName\(requestedCustomerName\)/);
  assert.match(backend, /preserveLoadedCustomer[\s\S]*loaded\.order\.customer_id/);
});
