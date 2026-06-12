import test from "node:test";
import assert from "node:assert/strict";

import { isLikelyMessageLikeName, resolveMessengerConversationDisplayName } from "../server/services/aiChannelAdapterService.js";

const safeProfile = {
  name: "MMA Comp",
  first_name: "MMA",
  last_name: "Comp",
};

test("Messenger name validation rejects message fragments", () => {
  for (const value of ["عايز", "غالي", "Comp غالي", "السلام عليكم"]) {
    assert.equal(isLikelyMessageLikeName(value), true, `expected ${value} to be rejected`);
  }
});

test("Messenger name validation accepts clean names", () => {
  assert.equal(isLikelyMessageLikeName("MMA Comp"), false);
  assert.equal(isLikelyMessageLikeName("Comp"), false);
});

test("Messenger display name falls back to Meta profile when stored name is dirty", () => {
  assert.equal(
    resolveMessengerConversationDisplayName({
      customerName: "عايز",
      customerProfile: safeProfile,
      metadata: { messenger_profile: safeProfile },
      externalCustomerId: "PSID-123",
    }),
    "MMA Comp"
  );

  assert.equal(
    resolveMessengerConversationDisplayName({
      customerName: "Comp غالي",
      customerProfile: safeProfile,
      metadata: { messenger_profile: safeProfile },
      externalCustomerId: "PSID-123",
    }),
    "MMA Comp"
  );
});

test("Messenger display name allows a clean stored customer_name", () => {
  assert.equal(
    resolveMessengerConversationDisplayName({
      customerName: "Comp",
      customerProfile: {},
      metadata: {},
      externalCustomerId: "PSID-123",
    }),
    "Comp"
  );
});
