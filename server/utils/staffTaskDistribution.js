// Who takes a recurring task nobody was named for. Pure decisions only — the
// service loads the rows, these pick the person, so the rules can be tested
// without a database.
//
// Two modes:
// - Rotation ("round_robin"): every employee of the branch takes a turn. The
//   turn belongs to whoever did this routine least recently, and the task waits
//   for that person. Somebody on approved leave is skipped; somebody who simply
//   does not turn up loses the turn only once arrivals have stopped — and since
//   they still have the oldest turn, it comes back to them next time.
// - Arrival share (everything else): each employee who checks in takes one
//   task, or catches up to the busiest colleague already on shift. The first
//   person through the door used to inherit the whole day's list.
// Anything still waiting once arrivals stop goes to whoever on shift has the
// least.

export const ROTATION_MODE = "round_robin";

const idKey = (value) => String(value ?? "");
const timeOf = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};

const normalize = (value) => String(value ?? "").trim().toLowerCase();

// A task pinned to a department or role only goes to someone who matches it.
export const employeeFitsTask = (employee = {}, task = {}) => {
  const values = [employee.role, employee.role_key, employee.job_title, employee.position, employee.department]
    .map(normalize)
    .filter(Boolean);
  const department = normalize(task.department);
  const role = normalize(task.role_key);
  if (department && department !== normalize(employee.department) && !values.includes(department)) return false;
  if (role && !values.includes(role)) return false;
  return true;
};

// Least recently done first; never done comes before everyone; ties by id so
// the order is stable from one week to the next.
export const rotationOrder = (employees = [], lastDoneById = new Map()) =>
  employees.slice().sort((a, b) => {
    const aTime = timeOf(lastDoneById.get(idKey(a.id)));
    const bTime = timeOf(lastDoneById.get(idKey(b.id)));
    if (aTime === null && bTime !== null) return -1;
    if (bTime === null && aTime !== null) return 1;
    if (aTime !== null && bTime !== null && aTime !== bTime) return aTime - bTime;
    return Number(a.id || 0) - Number(b.id || 0);
  });

// order: rotationOrder output. offIds: approved leave today. presentIds: checked
// in right now. settled: arrivals have stopped (or the task is nearly due).
export const pickRotationAssignee = ({ order = [], offIds = new Set(), presentIds = new Set(), settled = false } = {}) => {
  const holder = order.find((employee) => !offIds.has(idKey(employee.id)));
  if (holder && presentIds.has(idKey(holder.id))) return { employee: holder, reason: "rotation_turn" };
  if (!settled) return null;
  const standIn = order.find((employee) => presentIds.has(idKey(employee.id)));
  return standIn ? { employee: standIn, reason: "rotation_turn_passed" } : null;
};

// How many shared tasks the arriving employee should hold: one, or as many as
// the busiest colleague already on shift.
export const arrivalTarget = ({ employeeId, present = [], loads = new Map() } = {}) => {
  const others = present
    .filter((employee) => idKey(employee.id) !== idKey(employeeId))
    .map((employee) => Number(loads.get(idKey(employee.id)) || 0));
  return Math.max(1, ...others);
};

const leastLoaded = (present = [], loads = new Map()) =>
  present.slice().sort((a, b) => {
    const aLoad = Number(loads.get(idKey(a.id)) || 0);
    const bLoad = Number(loads.get(idKey(b.id)) || 0);
    if (aLoad !== bLoad) return aLoad - bLoad;
    const aTime = timeOf(a.check_in_at || a.check_in) ?? 0;
    const bTime = timeOf(b.check_in_at || b.check_in) ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return Number(a.id || 0) - Number(b.id || 0);
  })[0] || null;

// present: checked-in employees who fit the task. arriving: the employee whose
// check-in triggered this pass, or null on the timer.
export const pickArrivalAssignee = ({ arriving = null, present = [], loads = new Map(), settled = false } = {}) => {
  if (arriving && present.some((employee) => idKey(employee.id) === idKey(arriving.id))) {
    const held = Number(loads.get(idKey(arriving.id)) || 0);
    if (held < arrivalTarget({ employeeId: arriving.id, present, loads })) {
      return { employee: arriving, reason: "arrival_share" };
    }
  }
  if (!settled) return null;
  const employee = leastLoaded(present, loads);
  return employee ? { employee, reason: "arrivals_settled" } : null;
};

// Arrivals have stopped once nobody has checked in for `settleMinutes`; a task
// due within that window does not wait for them.
export const isSettled = ({ lastCheckInAt = null, dueAt = null, now = Date.now(), settleMinutes = 60 } = {}) => {
  const windowMs = settleMinutes * 60 * 1000;
  const last = timeOf(lastCheckInAt);
  if (last !== null && now - last >= windowMs) return true;
  const due = timeOf(dueAt);
  return due !== null && due - now <= windowMs;
};
