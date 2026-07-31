import assert from "node:assert/strict";
import test from "node:test";

import {
  canManagePosSalePrices,
  normalizePosRole,
} from "../src/modules/pos/lib/posSaleModeAccess.js";

test("cashier role variants cannot manage POS sale prices", () => {
  for (const role of ["cashier", "Cashier", "pos cashier", "pos_cashier", "pos-cashier", "كاشير"]) {
    assert.equal(canManagePosSalePrices({ role }), false, role);
  }
});

test("non-cashier roles retain POS sale price controls", () => {
  for (const role of ["admin", "manager", "sales", "owner"]) {
    assert.equal(canManagePosSalePrices({ role }), true, role);
  }
});

test("role_name is normalized when role is unavailable", () => {
  assert.equal(normalizePosRole({ role_name: " POS_CASHIER " }), "pos cashier");
  assert.equal(canManagePosSalePrices({ role_name: " POS_CASHIER " }), false);
});
