import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// WhatsApp buttons cannot be withdrawn once sent, so a customer can tap one at any time —
// after confirming, after cancelling, after the parcel ships. INV-659 tapped "تعديل الطلب"
// after confirming: the system replied "وصلنا طلب التعديل، الفريق بيراجعه" and recorded
// NOTHING — no status change, no timeline entry, no escalation. Never promise what did not happen.

const source = fs.readFileSync(
  new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url),
  "utf8"
);

const applyFnStart = source.indexOf("async function applyConfirmationAction({");
assert.ok(applyFnStart > -1);
const applySource = source.slice(applyFnStart, source.indexOf("\n}\n", applyFnStart));

const replyFnStart = source.indexOf("export const processConfirmationReply = async (message = {}) => {");
assert.ok(replyFnStart > -1);
const replySource = source.slice(replyFnStart);

test("an edit request is accepted after the customer already confirmed", () => {
  const editGate = applySource.slice(
    applySource.indexOf('} else if (normalizedAction === "edit") {'),
    applySource.indexOf('} else if (normalizedAction === "cancel") {')
  );
  const whitelist = editGate.match(/\[([^\]]*)\]\.includes\(currentStatus\)/);
  assert.ok(whitelist, "edit still gates on a status whitelist");
  assert.match(whitelist[1], /"confirmed"/, "confirmed must be allowed to request an edit");
  assert.match(whitelist[1], /"pending_confirmation"/);
});

test("a corrected order can be confirmed again after an edit request", () => {
  const confirmGate = applySource.slice(
    applySource.indexOf('if (normalizedAction === "confirm") {'),
    applySource.indexOf('} else if (normalizedAction === "edit") {')
  );
  const whitelist = confirmGate.match(/\[([^\]]*)\]\.includes\(currentStatus\)/);
  assert.ok(whitelist, "confirm still gates on a status whitelist");
  assert.match(whitelist[1], /"edit_requested"/, "an edited order must be confirmable again");
});

test("dispatched orders are still protected", () => {
  // the protected-status refusal must remain ahead of every action branch
  const guardIndex = applySource.indexOf("isOrderConfirmationProtectedStatus(currentStatus)");
  const confirmBranchIndex = applySource.indexOf('if (normalizedAction === "confirm")');
  assert.ok(guardIndex > -1 && guardIndex < confirmBranchIndex, "protected-status guard runs first");
  assert.match(source, /ORDER_CONFIRMATION_PROTECTED_STATUSES = new Set\(\["shipped"/);
});

test("a refused action tells the customer the truth instead of a success message", () => {
  assert.match(replySource, /refusalReason/);
  // the success notification must be unreachable when the action was refused
  const refusalBlockIndex = replySource.indexOf("if (refusalReason) {");
  const successNotificationIndex = replySource.indexOf("تم تأكيد طلبك رقم");
  assert.ok(refusalBlockIndex > -1, "there is a refusal branch");
  assert.ok(refusalBlockIndex < successNotificationIndex, "refusal returns before the success message");
  assert.match(replySource, /return \{ action: "refused", reason: refusalReason/);
});

// Execute the REAL refusal rule so neutering it fails these tests.
const refusalFnStart = source.indexOf("export const orderActionRefusalReason = ({ action = \"\", resultingStatus = \"\" } = {}) => {");
assert.ok(refusalFnStart > -1, "orderActionRefusalReason exists");
const refusalFnEnd = source.indexOf("\n};", refusalFnStart);
const refusalFnSource = source
  .slice(source.indexOf("export const ORDER_ACTION_EXPECTED_STATUS"), refusalFnEnd + 3)
  .replaceAll("export const", "const");
// eslint-disable-next-line no-new-func
const orderActionRefusalReason = new Function(`${refusalFnSource}\nreturn orderActionRefusalReason;`)();

test("an action that did not move the order is reported as refused", () => {
  // exactly the INV-659 case: edit tapped, order stayed confirmed
  assert.equal(
    orderActionRefusalReason({ action: "edit", resultingStatus: "confirmed" }),
    "status_not_applicable"
  );
  assert.equal(
    orderActionRefusalReason({ action: "cancel", resultingStatus: "confirmed" }),
    "status_not_applicable"
  );
});

test("an action that did move the order is not refused", () => {
  assert.equal(orderActionRefusalReason({ action: "confirm", resultingStatus: "confirmed" }), "");
  assert.equal(orderActionRefusalReason({ action: "edit", resultingStatus: "edit_requested" }), "");
  assert.equal(orderActionRefusalReason({ action: "cancel", resultingStatus: "cancelled_by_customer" }), "");
  assert.equal(orderActionRefusalReason({ action: "EDIT", resultingStatus: " Edit_Requested " }), "");
});

test("an unrecognised action is refused rather than assumed successful", () => {
  assert.equal(orderActionRefusalReason({ action: "", resultingStatus: "confirmed" }), "unknown_action");
  assert.equal(orderActionRefusalReason({}), "unknown_action");
});

test("the reply path uses that rule instead of trusting the call", () => {
  assert.match(replySource, /refusalReason = orderActionRefusalReason\(\{ action, resultingStatus: updatedOrder\.status \}\)/);
});

test("a dispatched-order tap is answered rather than thrown away", () => {
  assert.match(replySource, /ORDER_CONFIRMATION_LINK_LOCKED/);
  assert.match(replySource, /order_dispatched/);
  assert.match(replySource, /خرج للشحن بالفعل/);
});

test("every refusal reaches a human instead of dying silently", () => {
  const refusalBlock = replySource.slice(
    replySource.indexOf("if (refusalReason) {"),
    replySource.indexOf('return { action: "refused"')
  );
  assert.match(refusalBlock, /markAiSupportConversationEscalated/);
});

test("re-tapping a button the order already reflects is acknowledged, not ignored", () => {
  assert.match(replySource, /const alreadyInState = \{/);
  assert.match(replySource, /مؤكد بالفعل/);
  assert.match(replySource, /ملغي بالفعل/);
  assert.match(replySource, /repeated: true/);
  // and it must not fall through into the side-effecting branch. `let updatedOrder = null;` marks
  // the button-action branch specifically — an earlier applyConfirmationAction call belongs to the
  // cancel-reason path and is not what this guards.
  const repeatIndex = replySource.indexOf("if (action && alreadyInState) {");
  const buttonActionBranchIndex = replySource.indexOf("let updatedOrder = null;");
  assert.ok(repeatIndex > -1, "the repeat check exists");
  assert.ok(buttonActionBranchIndex > -1, "the button-action branch exists");
  assert.ok(repeatIndex < buttonActionBranchIndex, "the repeat check runs before the action is applied");
});
