import test from "node:test";
import assert from "node:assert/strict";
import {
  arrivalTarget,
  employeeFitsTask,
  isSettled,
  pickArrivalAssignee,
  pickRotationAssignee,
  rotationOrder,
} from "../server/utils/staffTaskDistribution.js";

const ahmed = { id: 1, full_name: "Ahmed" };
const sara = { id: 2, full_name: "Sara" };
const omar = { id: 3, full_name: "Omar" };
const ids = (...people) => new Set(people.map((person) => String(person.id)));

test("rotation: whoever did it least recently has the turn; never done goes first", () => {
  const lastDone = new Map([
    ["1", "2026-10-01T09:00:00Z"],
    ["2", "2026-09-24T09:00:00Z"],
  ]);
  assert.deepEqual(rotationOrder([ahmed, sara, omar], lastDone).map((e) => e.id), [3, 2, 1]);
  assert.deepEqual(rotationOrder([ahmed, sara], new Map()).map((e) => e.id), [1, 2], "ties break by id so the order is stable");
});

test("rotation: the task waits for the turn holder instead of going to whoever is in", () => {
  const order = [sara, ahmed, omar];
  assert.equal(pickRotationAssignee({ order, presentIds: ids(ahmed, omar), settled: false }), null);
  assert.equal(pickRotationAssignee({ order, presentIds: ids(ahmed, sara), settled: false }).employee, sara);
});

test("rotation: approved leave passes the turn straight away", () => {
  const order = [sara, ahmed, omar];
  const pick = pickRotationAssignee({ order, offIds: ids(sara), presentIds: ids(ahmed), settled: false });
  assert.equal(pick.employee, ahmed);
  assert.equal(pick.reason, "rotation_turn");
});

test("rotation: a no-show loses the turn only after arrivals stop, and keeps the oldest slot", () => {
  const order = [sara, ahmed, omar];
  const pick = pickRotationAssignee({ order, presentIds: ids(omar), settled: true });
  assert.equal(pick.employee, omar);
  assert.equal(pick.reason, "rotation_turn_passed");
  // Next week Sara still has the oldest turn, so it comes back to her.
  const lastDone = new Map([["3", "2026-10-13T09:00:00Z"], ["1", "2026-10-06T09:00:00Z"]]);
  assert.equal(rotationOrder([ahmed, sara, omar], lastDone)[0], sara);
});

test("arrival share: the first person in takes one task, not all of them", () => {
  const loads = new Map();
  const first = pickArrivalAssignee({ arriving: ahmed, present: [ahmed], loads, settled: false });
  assert.equal(first.employee, ahmed);
  loads.set("1", 1);
  assert.equal(pickArrivalAssignee({ arriving: ahmed, present: [ahmed], loads, settled: false }), null, "second task waits for the next arrival");
  assert.equal(pickArrivalAssignee({ arriving: sara, present: [ahmed, sara], loads, settled: false }).employee, sara);
});

test("arrival share: a latecomer catches up to the busiest colleague", () => {
  const loads = new Map([["1", 3], ["2", 1]]);
  assert.equal(arrivalTarget({ employeeId: omar.id, present: [ahmed, sara, omar], loads }), 3);
  assert.equal(arrivalTarget({ employeeId: ahmed.id, present: [ahmed], loads }), 1);
});

test("arrival share: once arrivals stop, leftovers go to the least loaded", () => {
  const loads = new Map([["1", 2], ["2", 1]]);
  const pick = pickArrivalAssignee({ present: [ahmed, sara], loads, settled: true });
  assert.equal(pick.employee, sara);
  assert.equal(pick.reason, "arrivals_settled");
});

test("settled: quiet for the window, or the task is nearly due", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.equal(isSettled({ lastCheckInAt: "2026-10-13T11:30:00Z", now, settleMinutes: 60 }), false);
  assert.equal(isSettled({ lastCheckInAt: "2026-10-13T10:59:00Z", now, settleMinutes: 60 }), true);
  assert.equal(isSettled({ lastCheckInAt: "2026-10-13T11:30:00Z", dueAt: "2026-10-13T12:45:00Z", now, settleMinutes: 60 }), true);
});

test("a department-pinned task only goes to that department", () => {
  assert.equal(employeeFitsTask({ department: "Warehouse" }, { department: "warehouse" }), true);
  assert.equal(employeeFitsTask({ department: "sales" }, { department: "warehouse" }), false);
  assert.equal(employeeFitsTask({ department: "sales" }, {}), true);
});
