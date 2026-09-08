// Offline attendance is the one queued action in this app whose time does NOT
// come from the server, so it is the one that must never write itself.
//
// The boundary these tests defend: an employee's phone can PROPOSE a time; only
// a manager's approval can turn it into attendance. Everything else about the
// design follows from that.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  listOfflineAttendance,
  saveOfflineAttendance,
  shouldQueueAttendanceOffline,
  syncOfflineAttendance,
} from "../src/modules/employees/lib/offlineAttendanceQueue.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const readSource = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

const createIndexedDbMock = () => {
  const stores = new Map();
  const ensureStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    open() {
      const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, error: null };
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: (name) => stores.has(name) },
          createObjectStore: (name) => ensureStore(name),
          transaction(storeName) {
            const store = ensureStore(storeName);
            const tx = {
              oncomplete: null,
              onerror: null,
              objectStore: () => ({
                put(value, key) {
                  store.set(String(key), clone(value));
                  queueMicrotask(() => tx.oncomplete?.());
                },
                delete(key) {
                  store.delete(String(key));
                  queueMicrotask(() => tx.oncomplete?.());
                },
                getAll() {
                  const req = { result: [], onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    req.result = Array.from(store.values()).map(clone);
                    req.onsuccess?.();
                  });
                  return req;
                },
              }),
            };
            return tx;
          },
          close() {},
        };
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
};

const setNavigator = (value) => {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
};

const withBrowser = async (fn) => {
  const previousWindow = globalThis.window;
  const previousIndexedDb = globalThis.indexedDB;
  const previousNavigator = globalThis.navigator;
  const mock = createIndexedDbMock();
  globalThis.window = { indexedDB: mock };
  globalThis.indexedDB = mock;
  setNavigator({ onLine: true });
  try {
    await fn();
  } finally {
    globalThis.window = previousWindow;
    globalThis.indexedDB = previousIndexedDb;
    setNavigator(previousNavigator);
  }
};

test("a refusal is never queued; only a lost connection is", () => {
  setNavigator({ onLine: true });

  // These are decisions the server already made. Replaying one later just gets
  // refused again, while the employee believes they were recorded.
  const alreadyCheckedIn = { status: 409, responseBody: { code: "already_checked_in" } };
  const outsideRadius = { status: 400, responseBody: { code: "outside_branch_radius" } };
  assert.equal(shouldQueueAttendanceOffline(alreadyCheckedIn), false);
  assert.equal(shouldQueueAttendanceOffline(outsideRadius), false);

  assert.equal(shouldQueueAttendanceOffline({ message: "Failed to fetch" }), true);
  assert.equal(shouldQueueAttendanceOffline({ status: 502 }), true);
});

test("the queued record carries the time the employee pressed the button", async () => {
  await withBrowser(async () => {
    const before = Date.now();
    await saveOfflineAttendance({
      action: "check_in",
      location: { latitude: 31.04, longitude: 31.38, accuracy: 12 },
      timezone: "Africa/Cairo",
    });
    const after = Date.now();

    const [record] = await listOfflineAttendance();
    const occurred = Date.parse(record.occurred_at);
    assert.ok(occurred >= before && occurred <= after, "the captured time must be when the button was pressed");
    assert.equal(record.action, "check_in");
    assert.equal(record.location.latitude, 31.04);
    assert.ok(record.idempotency_key.startsWith("att-"));
  });
});

test("syncing hands the capture over as a proposal, and does not retry a refusal forever", async () => {
  await withBrowser(async () => {
    await saveOfflineAttendance({
      action: "check_in",
      location: { latitude: 31.04, longitude: 31.38, accuracy: 12 },
      timezone: "Africa/Cairo",
    });

    let sent = null;
    await syncOfflineAttendance("tok", async (_token, record) => {
      sent = record;
      return { pending: true };
    });

    // The flag is what routes it to the pending table instead of attendance.
    assert.ok(sent, "the submission must be sent");
    assert.equal((await listOfflineAttendance()).length, 0, "a handed-over capture must leave the device");

    // A server refusal must not leave a queue that never empties.
    await saveOfflineAttendance({
      action: "check_out",
      location: { latitude: 31.04, longitude: 31.38, accuracy: 12 },
    });
    let attempts = 0;
    const refuse = async () => {
      attempts += 1;
      const error = new Error("already checked out");
      error.status = 409;
      throw error;
    };
    const result = await syncOfflineAttendance("tok", refuse);
    assert.equal(attempts, 1);
    assert.equal(result.failed[0].permanent, true);
    assert.equal((await listOfflineAttendance()).length, 0, "a refused capture is dropped, not retried forever");
  });
});

test("the employee route never writes attendance for an offline capture", () => {
  const route = readSource("server/routes/employeePortal.js");

  // The whole guarantee in one branch: offline_origin goes to the queue, not to
  // the recorder.
  assert.match(route, /const result = offlineOrigin\s*[\r\n]+\s*\? await queueOfflineAttendanceSubmission/);
  assert.match(route, /:\s*await recordEmployeePortalAttendance\(\{ employee, data: req\.body \|\| \{\}, audit:/);
  assert.ok(
    !/queueOfflineAttendanceSubmission[\s\S]{0,400}occurredAt/.test(route),
    "the employee route must never hand a client time to the recorder",
  );
});

test("only the manager approval path may supply a time the server did not witness", () => {
  const portalService = readSource("server/services/employeePayrollPortalService.js");
  const managerService = readSource("server/services/managerPortalService.js");

  // The recorder accepts an override...
  assert.match(portalService, /recordEmployeePortalAttendance = async \(\{ employee, data = \{\}, audit = \{\}, occurredAt = null \}\)/);
  assert.match(portalService, /const checkInAt = occurredAt instanceof Date \? occurredAt : new Date\(\)/);
  assert.match(portalService, /const checkOutAt = occurredAt instanceof Date \? occurredAt : new Date\(\)/);

  // ...and exactly one caller passes it.
  const passesOverride = [portalService, managerService, readSource("server/routes/employeePortal.js")]
    .join("\n")
    .match(/occurredAt:/g) || [];
  assert.equal(passesOverride.length, 1, "exactly one call site may supply occurredAt");
  assert.match(managerService, /occurredAt: new Date\(submission\.occurred_at\)/);
});

test("a pending submission is invisible to payroll because it is not in attendance_logs", () => {
  const portalService = readSource("server/services/employeePayrollPortalService.js");

  // The queue writes to its own table. If it ever wrote to attendance_logs, every
  // payroll and attendance aggregate would have to learn to exclude it -- and
  // the one that forgot would pay an unapproved claim.
  const queueFn = portalService.slice(
    portalService.indexOf("export const queueOfflineAttendanceSubmission"),
    portalService.indexOf("Writes a real attendance row"),
  );
  assert.ok(queueFn.includes("INSERT INTO attendance_offline_submissions"));
  assert.ok(!queueFn.includes("attendance_logs"), "a pending capture must never touch attendance_logs");
  assert.ok(queueFn.includes("'pending'"));

  // A device that retries must not become three claims for one arrival.
  assert.match(portalService, /ON CONFLICT \(tenant_id, idempotency_key\) DO UPDATE/);
  // A phone cannot invent a time outside these bounds.
  assert.ok(queueFn.includes("occurred_at_in_future"));
  assert.ok(queueFn.includes("occurred_at_too_old"));
});

test("a rejected claim is kept, because a dispute is settled from the record", () => {
  const managerService = readSource("server/services/managerPortalService.js");
  const rejectFn = managerService.slice(managerService.indexOf("export const rejectManagerPortalOfflineAttendance"));
  assert.match(rejectFn, /SET status = 'rejected'/);
  assert.ok(!/DELETE FROM attendance_offline_submissions/.test(managerService));
  // Reviewing something twice would write attendance twice.
  assert.match(managerService, /if \(String\(submission\.status\) !== "pending"\)/);
});
