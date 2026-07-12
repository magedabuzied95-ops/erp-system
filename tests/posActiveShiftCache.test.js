import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCachedActivePosShift,
  isPosOfflineNetworkError,
  readCachedActivePosShift,
  validateCachedActivePosShiftForContext,
  writeCachedActivePosShift,
} from "../src/modules/pos/lib/posShiftCache.js";

const createStorageMock = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };
};

const withWindow = async (fn) => {
  const previousWindow = global.window;
  global.window = {
    localStorage: createStorageMock(),
    sessionStorage: createStorageMock(),
  };

  try {
    await fn();
  } finally {
    global.window = previousWindow;
  }
};

test("POS active shift cache round-trips cached shift metadata", async () => {
  await withWindow(async () => {
    const shift = {
      id: 41,
      branch_id: 7,
      cashier_user_id: 91,
      opened_at: "2026-07-08T10:00:00.000Z",
      opening_cash: 250,
      status: "open",
    };

    const written = writeCachedActivePosShift({
      shift,
      branch: { id: 7, name: "Main Branch" },
      currentUser: { id: 91, tenant_id: 3 },
    });

    assert.equal(written, true);

    const cached = readCachedActivePosShift();
    assert.ok(cached);
    assert.equal(cached.shift_id, 41);
    assert.equal(cached.branch_id, 7);
    assert.equal(cached.user_id, 91);
    assert.equal(cached.cashier_user_id, 91);
    assert.equal(cached.tenant_id, 3);
    assert.equal(cached.opened_at, "2026-07-08T10:00:00.000Z");
    assert.equal(cached.opening_cash, 250);
    assert.equal(cached.shift.id, 41);
    assert.equal(cached.branch.id, 7);

    clearCachedActivePosShift();
    assert.equal(readCachedActivePosShift(), null);
  });
});

test("POS offline network detection accepts network and timeout errors but rejects server errors", () => {
  assert.equal(isPosOfflineNetworkError(new Error("NetworkError when attempting to fetch /api")), true);
  assert.equal(isPosOfflineNetworkError({ message: "Failed to fetch" }), true);
  assert.equal(isPosOfflineNetworkError({ status: 404, message: "Not found" }), false);
  assert.equal(isPosOfflineNetworkError({ name: "AbortError", message: "aborted" }), true);
  assert.equal(isPosOfflineNetworkError({ name: "TimeoutError", message: "request timed out" }), true);
});

test("POS active shift cache validation rejects mismatched user or branch", () => {
  const cachedShiftState = {
    shift: { id: 41, branch_id: 7 },
    shift_id: 41,
    branch_id: 7,
    user_id: 91,
    tenant_id: 3,
  };

  assert.equal(
    validateCachedActivePosShiftForContext(cachedShiftState, {
      currentUser: { id: 91, tenant_id: 3, branch_id: 7 },
      currentTenant: { id: 3 },
      resolvedPosBranchId: "7",
    }).valid,
    true
  );

  assert.equal(
    validateCachedActivePosShiftForContext(cachedShiftState, {
      currentUser: { id: 92, tenant_id: 3, branch_id: 7 },
      currentTenant: { id: 3 },
      resolvedPosBranchId: "7",
    }).reason,
    "user_mismatch"
  );

  assert.equal(
    validateCachedActivePosShiftForContext(cachedShiftState, {
      currentUser: { id: 91, tenant_id: 3, branch_id: 8 },
      currentTenant: { id: 3 },
      resolvedPosBranchId: "8",
    }).reason,
    "branch_mismatch"
  );
});
