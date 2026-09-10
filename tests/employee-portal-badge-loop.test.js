import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-09-11 "the shipping page is heavy and the first tap crashes": the employee home
// re-rendered forever. The display-refill badge effect listed a list rebuilt on every
// render in its deps, and every badge effect wrote a fresh counts object, so each render
// scheduled the next one (measured: the effect ran 64 times in 3s with nobody touching
// the phone). A tap on الشحن then never finished its route change and died with
// "Maximum update depth exceeded".

const home = readFileSync(new URL("../src/modules/employees/pages/EmployeePayrollPortal.jsx", import.meta.url), "utf8");

test("an unchanged badge count keeps the same state object", () => {
  assert.match(home, /setBadgeCounts\(\(current\) => \(current\[key\] === value \? current : \{ \.\.\.current, \[key\]: value \}\)\)/);
  for (const key of ["pendingNotifications", "newTasks", "unreadNotifications", "displayRefillAlerts"]) {
    assert.match(home, new RegExp(`setBadgeCount\\("${key}", activeTab === "[a-z-]+" \\? 0 : nextCount\\)`), key);
    assert.doesNotMatch(home, new RegExp(`setBadgeCounts\\(\\(current\\) => \\(\\{ \\.\\.\\.current, ${key}: activeTab`), `${key} writes a fresh object again`);
  }
});

test("the lists the badge effects depend on are stable between renders", () => {
  assert.match(home, /const pendingDisplayRefillAlerts = useMemo\(/);
  assert.match(home, /const employeeNotifications = useMemo\(\(\) => safeArray\(portal\?\.notifications\), \[portal\?\.notifications\]\);/);
});
