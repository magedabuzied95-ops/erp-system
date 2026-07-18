import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/modules/attendance/components/AttendanceCenter.jsx", import.meta.url),
  "utf8"
);

test("attendance center keeps successful branch and employee responses when a secondary request fails", () => {
  assert.match(source, /Promise\.allSettled\(requests\.map/);
  assert.match(source, /Object\.hasOwn\(fulfilled, "branches"\)\) setBranches/);
  assert.match(source, /Object\.hasOwn\(fulfilled, "employees"\)\) setEmployees/);
  assert.doesNotMatch(source, /await Promise\.all\(\[\s*getBranches/);
});

test("attendance center reports each failed endpoint independently", () => {
  assert.match(source, /\[attendance-center\] \$\{key\} request failed/);
});
