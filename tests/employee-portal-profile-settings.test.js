import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const portalSource = await readFile(new URL("../src/modules/employees/pages/EmployeePayrollPortal.jsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../server/routes/employeePortal.js", import.meta.url), "utf8");
const uploadSource = await readFile(new URL("../server/config/employeeProfileUpload.js", import.meta.url), "utf8");

test("employee portal exposes self-service profile settings", () => {
  assert.match(portalSource, /إعدادات الملف الشخصي/);
  assert.match(portalSource, /profile_photo/);
  assert.match(portalSource, /api\.patch\(`\/employee-portal\/\$\{encodeURIComponent\(token\)\}\/profile`/);
  assert.match(portalSource, /\^01\[0125\]\\d\{8\}\$/);
});

test("profile update is token-scoped and accepts safe image formats only", () => {
  assert.match(routeSource, /router\.patch\("\/:token\/profile", verifyEmployeePortalToken, uploadEmployeeProfilePhoto/);
  assert.match(routeSource, /WHERE id = \$3 AND tenant_id = \$4/);
  assert.match(uploadSource, /image\/jpeg/);
  assert.match(uploadSource, /image\/png/);
  assert.match(uploadSource, /image\/webp/);
  assert.match(uploadSource, /5 \* 1024 \* 1024/);
});
