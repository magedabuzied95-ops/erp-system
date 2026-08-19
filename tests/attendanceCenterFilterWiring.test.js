import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller = readFileSync(
  new URL("../server/controllers/attendanceController.js", import.meta.url),
  "utf8"
);
const centerSource = readFileSync(
  new URL("../src/modules/attendance/components/AttendanceCenter.jsx", import.meta.url),
  "utf8"
);
const workspaceSource = readFileSync(
  new URL("../src/modules/attendance/components/AttendanceWorkspace.jsx", import.meta.url),
  "utf8"
);

// Several of these defects were invisible precisely because the surrounding
// endpoint looked correct. Asserting against a whole 6k-line file would pass on
// a match from any other handler, so every check is scoped to one body.
const handlerBody = (name) => {
  const start = controller.indexOf(`export const ${name} = async (req, res) => {`);
  assert.notEqual(start, -1, `handler ${name} not found`);
  const next = controller.indexOf("\nexport const ", start + 1);
  return controller.slice(start, next === -1 ? controller.length : next);
};

test("the employee picker and the attendance rows agree on who is active", () => {
  // The picker listed every non-deleted employee while the row builder only ever
  // counted `status = 'active'`. Picking an inactive name produced a page of
  // zeros with nothing on screen to explain it.
  const employees = handlerBody("getEmployees");
  assert.match(employees, /req\.query\.active/);
  assert.match(employees, /LOWER\(COALESCE\(e\.status, 'active'\)\) = 'active'/);
  assert.match(employees, /req\.query\.branch_id \|\| req\.query\.branchId/);
  assert.match(employees, /e\.branch_id::text = \$\$\{params\.length\}::text/);
});

test("the employee picker still lists inactive staff for the screens that manage them", () => {
  // `active` has to stay opt-in: the employee-management workspace asks for the
  // full roster and would lose every inactive record if this became implicit.
  const employees = handlerBody("getEmployees");
  assert.match(employees, /const activeOnly = \["1", "true", "yes"\]\.includes/);
  assert.match(workspaceSource, /getAttendanceEmployees\(\{ search: "" \}\)/);
  assert.match(centerSource, /getAttendanceEmployees\(\{ active: true, branch_id: filters\.branchId \}\)/);
});

test("payroll deductions are read from every attendance source, not only QR", () => {
  // Scoping this to QR meant a day fixed through the page's own manual
  // correction read as absent and cost the employee a full daily rate.
  const payroll = handlerBody("getAttendancePayrollImpact");
  assert.match(payroll, /loadAttendanceCenterRows\(filters\)/);
  assert.doesNotMatch(payroll, /qrOnly:\s*true/);
});

test("live attendance answers the employee picker and cannot show a stale open shift", () => {
  const live = handlerBody("getAttendanceLive");
  assert.match(live, /filters\.employeeId/);
  assert.match(live, /al\.employee_id::text = \$\$\{params\.length\}::text/);
  // Unbounded, an old check-in that was never closed sat here forever reading as
  // someone at work with hundreds of hours on the clock.
  assert.match(live, /al\.attendance_date >= \(\$\$\{params\.length\}::date - INTERVAL '1 day'\)/);
});

test("leaves and QR sessions answer the employee picker above them", () => {
  const leaves = handlerBody("getAttendanceLeaves");
  assert.match(leaves, /\$5::text = '' OR e\.id::text = \$5::text/);
  assert.equal(leaves.match(/\$5::text = '' OR e\.id::text = \$5::text/g).length, 2, "both halves of the UNION must be filtered");
  assert.match(leaves, /filters\.branchId, filters\.employeeId\]/);

  const qr = handlerBody("getAttendanceQrSessions");
  assert.match(qr, /\$5::text = '' OR ev\.employee_id::text = \$5::text/);
  assert.match(qr, /filters\.branchId, filters\.employeeId\]/);
});

test("the attendance status picker cannot empty the overtime approvals tab", () => {
  // The page's picker holds attendance states (present / absent / late) while
  // this column holds approval states, so feeding one into the other matched
  // nothing for every choice the user could make.
  const overtime = handlerBody("getAttendanceOvertimeApprovals");
  assert.match(overtime, /OVERTIME_APPROVAL_STATUSES\.has\(filters\.status\)/);
  assert.match(controller, /const OVERTIME_APPROVAL_STATUSES = new Set\(\["pending", "approved", "rejected"\]\)/);
});

test("a source filter hides generated rows instead of answering with absences", () => {
  assert.match(controller, /if \(!log && \(!includeGenerated \|\| filters\.source\)\) return;/);
});

test("the working week is counted from Saturday, not Sunday", () => {
  // Counting from Sunday with the JS weekday index handed the store Friday as a
  // work day and took Saturday off, so every Friday absence became a deduction.
  assert.match(controller, /const centerWeekOrder = \[6, 0, 1, 2, 3, 4, 5\]/);
  assert.match(controller, /centerWeekOrder\.slice\(0, perWeek\)\.includes\(date\.getUTCDay\(\)\)/);
  assert.doesNotMatch(controller, /return date\.getUTCDay\(\) < Math\.max\(1, Math\.min\(7/);

  // A six-day week must leave Friday (5) off and keep Saturday (6) working.
  const centerWeekOrder = [6, 0, 1, 2, 3, 4, 5];
  const working = centerWeekOrder.slice(0, 6);
  assert.equal(working.includes(6), true, "Saturday is a working day");
  assert.equal(working.includes(5), false, "Friday is the weekly day off");

  assert.match(workspaceSource, /working_days: "Sat,Sun,Mon,Tue,Wed,Thu"/);
  assert.doesNotMatch(workspaceSource, /working_days: "Sun,Mon,Tue,Wed,Thu"/);
});

test("the overview cards name the filtered window instead of claiming today", () => {
  // The figures are totals over the filter range; labelled "today" they were
  // read as a roll call of who is in right now.
  assert.match(centerSource, /presentDays: "أيام الحضور"/);
  assert.match(centerSource, /absentDays: "أيام الغياب"/);
  assert.doesNotMatch(centerSource, /"الحاضرون اليوم"/);
  assert.doesNotMatch(centerSource, /"دخول QR اليوم"/);
  assert.doesNotMatch(centerSource, /Present Today/);
  assert.match(centerSource, /hint=\{rangeHint\}/);
  assert.match(centerSource, /const rangeHint = filters\.startDate === filters\.endDate/);
});

test("a dead endpoint no longer renders as a page of zeros", () => {
  assert.match(centerSource, /setFailedSections\(failed\)/);
  assert.match(centerSource, /failedSections\.length \? \(/);
  assert.match(centerSource, /failedSections\.map\(\(key\) => sectionLabel\(key\)\)/);
  // An empty range and a broken one have to read differently.
  assert.match(centerSource, /!loading && !failedSections\.length && !rows\.length/);
});

test("the new banner strings are translated, not another hardcoded pair", () => {
  // Every other label on this page is a hardcoded ar/en pair, which is exactly
  // the debt the i18n guard exists to stop growing.
  assert.match(centerSource, /t\("attendance\.center\.loadFailed"\)/);
  assert.match(centerSource, /t\("attendance\.center\.emptyRange"\)/);
  assert.match(centerSource, /t\("attendance\.center\.retry"\)/);

  const sectionKeys = [
    "branches", "employees", "dashboard", "list", "live", "payroll",
    "overtime", "leaves", "schedules", "qr", "reports", "hrSettings",
  ];
  for (const locale of ["ar", "en"]) {
    const bundle = JSON.parse(readFileSync(new URL(`../src/locales/${locale}/attendance.json`, import.meta.url), "utf8"));
    for (const key of ["loadFailed", "retry", "emptyRange"]) {
      assert.equal(typeof bundle.center[key], "string", `${locale}.center.${key} is missing`);
    }
    for (const key of sectionKeys) {
      const bundleKey = `section${key[0].toUpperCase()}${key.slice(1)}`;
      assert.equal(typeof bundle.center[bundleKey], "string", `${locale}.center.${bundleKey} is missing`);
    }
  }
  // Spelled-out keys, so the audit can see them and a typo fails here.
  for (const key of sectionKeys) {
    const bundleKey = `section${key[0].toUpperCase()}${key.slice(1)}`;
    assert.match(centerSource, new RegExp(`${key}: "attendance\\.center\\.${bundleKey}"`));
  }
});

test("typing does not fire a round of requests per keystroke, and a slow round cannot win", () => {
  assert.match(centerSource, /setDebouncedSearch\(filters\.search\.trim\(\)\), 400\)/);
  assert.match(centerSource, /search: debouncedSearch,/);
  // Keying the params memo on the whole filters object would rebuild it on every
  // keystroke and undo the debounce.
  assert.doesNotMatch(centerSource, /\}\), \[filters\]\);/);
  assert.match(centerSource, /if \(loadSequence\.current !== sequence\) return;/);
  assert.match(centerSource, /if \(loadSequence\.current === sequence\) setLoading\(false\);/);
});
