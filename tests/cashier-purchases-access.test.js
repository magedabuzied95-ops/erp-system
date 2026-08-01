import assert from "node:assert/strict";
import test from "node:test";

import { isCashierUser } from "../src/shared/auth/authStorage.js";

test("cashier role variants are identified", () => {
  for (const role of ["cashier", "Cashier", "pos cashier", "pos_cashier", "pos-cashier", "كاشير"]) {
    assert.equal(isCashierUser({ role }), true, role);
  }
});

test("non-cashier accounts keep their purchase shortcut", () => {
  for (const role of ["admin", "manager", "accountant", "warehouse-staff"]) {
    assert.equal(isCashierUser({ role }), false, role);
  }
});

test("role_name is supported for cashier accounts", () => {
  assert.equal(isCashierUser({ role_name: " POS_CASHIER " }), true);
});
