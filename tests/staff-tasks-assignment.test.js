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

test("the waiting-task search covers today and legacy week-start weekly rows only", () => {
  const dateBody = functionBody(tasksService, "const waitingTaskDateSql =");
  assert.match(dateBody, /sta\.assigned_date = \$\{dateParam\}::date/, "today's instances must be found by their own day");
  assert.match(
    dateBody,
    /sta\.assigned_date = \$\{weekStartParam\}::date AND sta\.source_ref_type = 'weekly_task_template'/,
    "rows stamped with the week start are legacy WEEKLY rows — an old daily row must not be dragged into today"
  );
  const loadBody = functionBody(tasksService, "const loadWaitingBranchTasks =");
  assert.match(loadBody, /weekStartKey\(attendanceDate\)/);
});

test("a check-in hands out one share, not the whole day's list", () => {
  const checkInBody = functionBody(tasksService, "export const handleBranchQrCheckInStaffTasks =");
  assert.match(checkInBody, /distributeWaitingBranchTasks\(\{/, "check-in must go through the single distributor");
  assert.match(checkInBody, /arrivingEmployeeId: safeEmployeeId/, "the distributor must know who just arrived");
  for (const removed of ["assignWaitingRecurringTasksForCheckIn", "assignDailyAttendanceTasksForCheckIn", "assignWeeklyAttendanceTasksForCheckIn", "rebalanceBranchAttendanceTasks"]) {
    assert.ok(!tasksService.includes(removed), `${removed} gave every waiting task to whoever was present — it must not come back`);
  }
  const distributeBody = functionBody(tasksService, "const distributeWaitingBranchTasks =");
  assert.match(distributeBody, /pickRotationAssignee\(/);
  assert.match(distributeBody, /pickArrivalAssignee\(/);
  assert.match(distributeBody, /FOR UPDATE|loadWaitingBranchTasks\(client/, "claims must run inside the locked transaction");
});

test("a late task stays with its owner", () => {
  const overdueBody = functionBody(tasksService, "export const reassignOverdueTasks =");
  assert.ok(!/redistributeTasks\(/.test(overdueBody), "the owner decided overdue work is not moved to somebody else");
  assert.match(overdueBody, /SET status = 'overdue'/, "late work is still marked overdue");
});

test("the five-minute timer settles waiting tasks", () => {
  const server = read("server/server.js");
  assert.match(server, /void settleWaitingStaffTasks\(\)/);
});

test("a branch-less routine materialises once per active branch", () => {
  // A single branch-less instance was unreachable: every check-in assigner and
  // the manager alert filter on branch_id, so nothing could ever see it.
  const resolverBody = functionBody(tasksService, "const resolveTemplateBranches =");
  assert.match(resolverBody, /if \(templateBranchId\) return \[templateBranchId\];/, "a pinned branch stays a single instance");
  assert.match(
    resolverBody,
    /FROM branches/,
    "a template with no branch must expand over the tenant's branches"
  );
  assert.match(resolverBody, /is_active IS DISTINCT FROM FALSE/, "closed branches must not receive routines");
  assert.match(
    resolverBody,
    /if \(fixedEmployeeId\)/,
    "a named employee pins the routine to their branch — fanning out would hand them the same task once per branch"
  );

  const generatorBody = functionBody(tasksService, "export const generateDueTaskInstancesFromTemplates =");
  assert.match(generatorBody, /for \(const branchId of targetBranches\)/, "generation must loop over the resolved branches");
  assert.match(generatorBody, /branch_id: branchId/, "each instance must carry the branch it was made for");
  assert.match(
    generatorBody,
    /templateBranchId \? `\$\{template\.id\}:\$\{dedupeKey\}` : `\$\{template\.id\}:\$\{dedupeKey\}:b\$\{branchId\}`/,
    "the fan-out key needs the branch or the first branch consumes the whole day; pinned templates keep the historical key"
  );
  assert.ok(
    !/branch_id: template\.branch_id,/.test(generatorBody),
    "the instance must take the resolved branch, not the template's possibly-null one"
  );
});

test("the per-day dedupe index counts the branch", () => {
  // Verified against Postgres: with the branch missing from the key, a fan-out
  // over three branches inserted ONE row — ON CONFLICT DO NOTHING swallowed the
  // other two and the fan-out silently collapsed to a single task.
  assert.match(
    tasksService,
    /ON staff_task_assignments \(template_id, source_ref_date, COALESCE\(branch_id, 0\)\)/,
    "the unique key must include the branch or per-branch instances are dropped on insert"
  );
  assert.ok(
    !/CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tasks_template_due_dedupe\b/.test(tasksService),
    "the old branch-blind unique index must not be recreated"
  );
  const createAt = tasksService.indexOf("idx_staff_tasks_template_due_branch_dedupe");
  const dropAt = tasksService.indexOf("DROP INDEX IF EXISTS idx_staff_tasks_template_due_dedupe");
  assert.ok(dropAt > createAt, "create the wider index before dropping the narrower one — a failure here bricks boot");
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
  const notifyBody = functionBody(tasksService, "const notifyManagerUnassignedTasks =");
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
