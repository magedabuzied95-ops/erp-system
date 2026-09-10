import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-09-10: on a phone set to English the employee portal showed its own Arabic
// buttons next to an English "Shipping orders" one (the dictionary followed the phone),
// and nobody found the page. The portal home and the shipping page pin Arabic at
// runtime, without writing the ERP's language setting.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the employee portal home and the shipping page run in Arabic", () => {
  const home = read("../src/modules/employees/pages/EmployeePayrollPortal.jsx");
  assert.match(home, /useEmployeePortalArabic\(\);/);
  const shipping = read("../src/modules/employees/pages/EmployeePortalOnlineOrders.jsx");
  assert.match(shipping, /= useEmployeePortalArabic\(\);/);
});

test("the switch is runtime only — it never persists a language choice", () => {
  const hook = read("../src/modules/employees/lib/employeePortalLanguage.js");
  assert.match(hook, /activateRuntimeLanguage\("ar"\)/);
  assert.doesNotMatch(hook, /persistApplicationLanguage|localStorage/);
});
