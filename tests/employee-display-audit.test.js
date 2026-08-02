import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = (path) => fs.readFile(path, "utf8");

test("employee display audit stays independent from display refill alerts", async () => {
  const [service, routes] = await Promise.all([
    source("server/services/employeeDisplayAuditService.js"),
    source("server/routes/employeePortal.js"),
  ]);
  assert.match(service, /is_displayed/);
  assert.match(service, /COALESCE\(p\.is_displayed, FALSE\) = FALSE/);
  assert.match(service, /COALESCE\(pv\.stock, 0\) > 0/);
  assert.match(routes, /\/:token\/display-audit/);
  assert.doesNotMatch(service, /display_refill_alerts/);
});

test("display audit groups non-empty source and audience sections", async () => {
  const service = await source("server/services/employeeDisplayAuditService.js");
  assert.match(service, /imported_vietnam/);
  assert.match(service, /mirror_original/);
  assert.match(service, /egyptian/);
  assert.match(service, /filter\(\(group\) => group\.count > 0\)/);
  assert.match(service, /filter\(\(section\) => section\.count > 0\)/);
});

test("employee portal updates display audit cards without a page reload", async () => {
  const page = await source("src/modules/employees/pages/EmployeePayrollPortal.jsx");
  assert.match(page, /markDisplayAuditProduct/);
  assert.match(page, /filter\(\(item\) => String\(item\.product_id\) !== String\(product\.product_id\)\)/);
  assert.match(page, /activeTab === "display-audit"/);
});
