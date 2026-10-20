import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INV-2186: the shipping board filed the order under "جديد" and offered تأكيد الأوردر, then the
// engine refused it ("لا يمكن تأكيد هذا الأوردر في حالته الحالية") because its status was not one
// of the five a CUSTOMER tap may confirm. Staff confirm whatever the board calls new; only an
// order that is finished with is refused.

const service = fs.readFileSync(new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url), "utf8");
const boardSql = fs.readFileSync(new URL("../server/modules/shipping/onlineOrderSql.js", import.meta.url), "utf8");

const refusedMatch = service.match(/const STAFF_CONFIRM_REFUSED_STATUSES = new Set\(\[([\s\S]*?)\]\);/);
const refused = new Set([...(refusedMatch?.[1] || "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

test("the staff confirm gate lets a staff member past the customer-tap whitelist", () => {
  assert.ok(refusedMatch, "the staff refused set exists");
  const applyStart = service.indexOf("async function applyConfirmationAction({");
  const confirmBranch = service.slice(
    service.indexOf('if (normalizedAction === "confirm") {', applyStart),
    service.indexOf('} else if (normalizedAction === "edit") {', applyStart)
  );
  assert.match(confirmBranch, /const staffMayConfirm = actorType === "staff" && !STAFF_CONFIRM_REFUSED_STATUSES\.has\(currentStatus\);/);
  assert.match(confirmBranch, /if \(!ORDER_CONFIRMATION_ACTIONABLE_STATUSES\.has\(currentStatus\) && !staffMayConfirm\) \{/);
  // The edit branch is a customer action and keeps the narrow set.
  const editBranch = service.slice(
    service.indexOf('} else if (normalizedAction === "edit") {', applyStart),
    service.indexOf('} else if (normalizedAction === "cancel") {', applyStart)
  );
  assert.ok(!editBranch.includes("staffMayConfirm"));
});

test("every status the board files as closed or delivered is refused to staff", () => {
  const groupStart = boardSql.indexOf("const groupExpr = `(CASE");
  const finished = boardSql.slice(groupStart, boardSql.indexOf("THEN 'delivered'", groupStart));
  const statusLists = [...finished.matchAll(/\$\{statusExpr\} IN \(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(statusLists.length, 2, "closed + delivered branches");
  for (const list of statusLists) {
    for (const [, status] of list.matchAll(/'([a-z_]+)'/g)) {
      assert.ok(refused.has(status), `${status} must not be confirmable by staff`);
    }
  }
  assert.ok(refused.has("ai_draft"), "an AI draft is not an order yet");
});

test("the statuses that reach the board's new group are not refused", () => {
  for (const status of ["pending_review", "pending", "pending_confirmation", "edit_requested", "", "new", "on_hold"]) {
    assert.ok(!refused.has(status), `${status || "(empty)"} must be confirmable by staff`);
  }
});
