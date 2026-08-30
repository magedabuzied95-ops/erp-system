import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const tasksService = read("server/services/staffTasksService.js");
const walletService = read("server/services/employeePayrollPortalService.js");
const adminTasksPage = read("src/modules/employees/pages/StaffTasks.jsx");

// Slice a named function body out of the service so a guard cannot be satisfied
// by a match somewhere else in a 3900-line file.
const functionBody = (source, declaration) => {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `could not find ${declaration}`);
  const next = source.indexOf("\nexport const ", start + declaration.length);
  const alt = source.indexOf("\nconst ", start + declaration.length);
  const end = [next, alt].filter((index) => index > 0).sort((a, b) => a - b)[0] ?? source.length;
  return source.slice(start, end);
};

test("an unowned task is never shown to the whole branch", () => {
  // It used to be. Every employee saw the same unassigned row, and the status
  // endpoint requires ownership, so all of them got a 404 on Start/Complete.
  assert.ok(
    !/include_branch_unassigned/.test(tasksService),
    "the employee portal must not fold unassigned branch tasks into one employee's list"
  );
  assert.ok(
    !/include_branch_unassigned/.test(walletService),
    "the employee wallet/hub surface must not fold in unassigned branch tasks either"
  );

  const listBody = functionBody(tasksService, "export const listStaffTasks =");
  assert.ok(
    !/current_assignee_id IS NULL AND sta\.branch_id/.test(listBody),
    "listStaffTasks must not offer an 'or unassigned in my branch' escape hatch"
  );
});

test("the portal fetches only this employee's own work", () => {
  const portalBody = functionBody(tasksService, "export const getEmployeePortal =");
  assert.match(portalBody, /employee_id: session\.employee_id/, "must filter by the session employee");
  assert.match(
    portalBody,
    /assigned_date: "today"/,
    "completed work must be scoped to today rather than replaying the full history"
  );
});

test("auto-assignment never lands on somebody who is not checked in", () => {
  const eligibleBody = functionBody(tasksService, "export const findEligibleEmployees =");
  assert.match(
    eligibleBody,
    /presentOnly = true/,
    "findEligibleEmployees must exclude absent employees by default"
  );
  assert.match(
    eligibleBody,
    /IS FALSE OR COALESCE\(ta\.attendance_status, 'absent'\) = 'checked_in'/,
    "absence must be filtered in SQL — ordering checked-in first still returns absentees when nobody is present"
  );
});

test("redistribution only moves work that already has an owner", () => {
  const redistributeBody = functionBody(tasksService, "export const redistributeTasks =");
  assert.match(
    redistributeBody,
    /sta\.current_assignee_id IS NOT NULL/,
    "a never-assigned task must not be swept into 'reassigned' by the five-minute timer"
  );
});

test("a weekly routine is stamped with the day it is due, not the start of its week", () => {
  const generatorBody = functionBody(tasksService, "export const generateDueTaskInstancesFromTemplates =");
  assert.match(
    generatorBody,
    /const scheduleDate = dateKey\(dueDate\);/,
    "the instance must carry the real day — stamping the week start made it born days overdue"
  );
  assert.match(
    generatorBody,
    /const dedupeKey = templateKind === "weekly" && !pinnedWeekdays\.length \? weekKey : scheduleDate;/,
    "the week start may only decide the dedupe key, never assigned_date or due_at"
  );
  assert.match(generatorBody, /assigned_date: scheduleDate/, "assigned_date must be the real day");
});

test("the weekly check-in assigner searches the day the instance is stamped with", () => {
  const weeklyBody = functionBody(tasksService, "const assignWeeklyAttendanceTasksForCheckIn =");
  assert.match(
    weeklyBody,
    /sta\.assigned_date = ANY\(\$3::date\[\]\)/,
    "searching a single week-start date orphaned every weekly routine that was not a Monday routine"
  );
  assert.match(
    weeklyBody,
    /\[\.\.\.new Set\(\[attendanceDate, weekStart\]\)\]/,
    "the search must cover today (new stamping) and the week start (rows written before the fix)"
  );
});

test("the boot-time inventory sweep stands down when nobody is on shift", () => {
  const inventoryBody = functionBody(tasksService, "export const assignDailyInventoryCountTasks =");
  assert.match(
    inventoryBody,
    /if \(!eligibleEmployees\.length\)/,
    "restarting the server at night must not mint inventory tasks for absent staff"
  );
  const guardIndex = inventoryBody.indexOf("if (!eligibleEmployees.length)");
  assert.ok(
    guardIndex < inventoryBody.indexOf("const candidates = await db.query"),
    "the stand-down has to happen before any task is created"
  );
});

test("an unowned task raises a manager alert instead of reaching employees", () => {
  assert.match(
    tasksService,
    /const countUnassignedBranchTasks = async/,
    "somebody has to be told when a task ends the check-in with no owner"
  );
  const notifyBody = functionBody(tasksService, "const notifyManagerAttendanceTaskState =");
  assert.match(notifyBody, /type: "staff_tasks_unassigned"/, "the alert must be addressed to the manager");
  assert.match(notifyBody, /role_key: "manager"/);
});

test("the admin task template form can pin weekdays, a due time and an owner", () => {
  // This page used to hard-code auto_assign_enabled:false and send no schedule,
  // so every template saved from it generated instances nobody owned.
  assert.ok(
    !/auto_assign_enabled: false,/.test(adminTasksPage),
    "auto-assign must follow whether an employee was named, not be pinned off"
  );
  assert.match(adminTasksPage, /auto_assign_enabled: !fixedEmployeeId/);
  for (const field of ["weekdays", "due_time", "fixed_employee_id"]) {
    assert.match(
      adminTasksPage,
      new RegExp(`${field}[,:]`),
      `the template form must carry ${field} to the server`
    );
  }
  assert.match(
    adminTasksPage,
    /templateKind === "weekly" && !weekdays\.length/,
    "a weekly template with no pinned day must be rejected, not saved to fire on an arbitrary day"
  );
});
