import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedLeadStatus,
  normalizeLeadStatus,
} from "../server/services/aiInboxLeadActionsService.js";

test("lead status defaults to new", () => {
  assert.equal(normalizeLeadStatus(""), "new");
  assert.equal(normalizeLeadStatus("unknown"), "new");
});

test("lead status validator accepts supported values", () => {
  for (const value of ["new", "contacted", "interested", "negotiation", "won", "lost"]) {
    assert.equal(isAllowedLeadStatus(value), true);
    assert.equal(normalizeLeadStatus(value), value);
  }
});

test("lead status validator rejects unsupported values", () => {
  for (const value of ["closed", "pending", "hot", ""]) {
    assert.equal(isAllowedLeadStatus(value), false);
  }
});
