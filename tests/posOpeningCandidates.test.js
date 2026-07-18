import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPosOpeningCandidateFallback,
  readPosOpeningCandidates,
} from "../src/modules/pos/lib/posOpeningCandidates.js";

test("opening candidate fallback keeps only active eligible employees from the selected branch", () => {
  const candidates = buildPosOpeningCandidateFallback([
    { id: 1, branch_id: 5, full_name: "First Employee", is_active: true, can_open_branch: true },
    { id: 2, branch_id: 6, full_name: "Other Branch", is_active: true, can_open_branch: true },
    { id: 3, branch_id: 5, full_name: "Inactive", is_active: false, can_open_branch: true },
    { id: 4, branch_id: 5, full_name: "Blocked", is_active: true, can_open_branch: false },
  ], 5);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].employee_id, 1);
  assert.equal(candidates[0].full_name, "First Employee");
  assert.equal(candidates[0].eligible, true);
  assert.equal(candidates[0].is_recommended, true);
});

test("opening candidate payload accepts the API response shapes used by the POS", () => {
  assert.deepEqual(readPosOpeningCandidates({ candidates: [{ employee_id: 1 }] }), [{ employee_id: 1 }]);
  assert.deepEqual(readPosOpeningCandidates({ data: { candidates: [{ employee_id: 2 }] } }), [{ employee_id: 2 }]);
  assert.deepEqual(readPosOpeningCandidates({}), []);
});
