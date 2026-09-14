import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const orders = read("../server/controllers/ordersController.js");
const accounting = read("../server/services/accountingService.js");
const pos = read("../server/controllers/posController.js");
const push = read("../server/services/managerPortalPushService.js");

const handlerBody = (source, name) => {
  const start = source.indexOf(`export const ${name} = async`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
};
const constBody = (source, name) => {
  const start = source.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\n};", start);
  return source.slice(start, next + 3);
};

// 1. A cancel leaves an audit row and tells the manager.
test("cancelOrder writes an activity log and a manager push with reason and actor", () => {
  const body = handlerBody(orders, "cancelOrder");
  assert.match(body, /logActivity\(\s*client,[\s\S]*?"CANCEL_ORDER"/);
  const log = body.slice(body.indexOf('"CANCEL_ORDER"'));
  for (const field of ["reason:", "cancelled_by:", "cancelled_by_name:", "tenant_id:", "branch_id:"]) {
    assert.ok(log.includes(field), `the cancel log must carry ${field}`);
  }
  const call = body.slice(body.indexOf("sendManagerInvoiceDeletedPush("));
  assert.ok(body.includes("sendManagerInvoiceDeletedPush("), "cancel must push to the manager");
  assert.ok(call.includes('kind: "cancel"') && call.includes("actorName:") && call.includes("reason:"));
  assert.match(push, /cancel: "order_cancelled"/, "the push service must know the cancel kind");
});

// 2. Stock and money on cancel/delete respect earlier returns.
test("cancel, delete and hard delete restore only the units never returned", () => {
  assert.match(constBody(orders, "unreturnedOrderItems"), /Number\(item\?\.quantity \|\| 0\) - Number\(item\?\.returned_quantity \|\| 0\)/);
  for (const name of ["cancelOrder", "deleteOrder"]) {
    const body = handlerBody(orders, name);
    assert.match(body, /restoreOrderInventory\(client, \{[\s\S]*?items: unreturnedOrderItems\(loaded\.items\)/, `${name} must restore net units`);
  }
  assert.match(handlerBody(orders, "permanentDeleteOrder"), /const netItems = unreturnedOrderItems\(loaded\.items\)/);
  for (const name of ["deleteOrder", "permanentDeleteOrder"]) {
    const body = handlerBody(orders, name);
    const flags = body.slice(body.indexOf("const stockAlreadyRestored"), body.indexOf(");", body.indexOf("const stockAlreadyRestored")));
    assert.doesNotMatch(flags, /returned/, `${name}: a return must not count as the whole invoice's stock being restored`);
  }
});

test("cancel and delete do not reverse money the returns already refunded", () => {
  const cancel = handlerBody(orders, "cancelOrder");
  assert.match(cancel, /orderTotal - priorRefunds\.refundTotal/);
  assert.match(cancel, /postReturnEntry\(client, \{[\s\S]*?amount: cancelReversalAmount/);
  for (const name of ["cancelOrder", "deleteOrder"]) {
    const body = handlerBody(orders, name);
    assert.match(body, /reverseMoneyTransactionsForReference\(client, \{[\s\S]*?offsets: priorRefunds\.moneyOffsets/, `${name} must offset refunds`);
  }
  const reverse = handlerBody(accounting, "reverseMoneyTransactionsForReference");
  assert.match(reverse, /data\.offsets/);
  assert.match(reverse, /amount: reversalAmount/, "the reversal must post the offset amount, not the original");
  assert.match(reverse, /if \(!\(reversalAmount > 0\)\) continue;/);
});

// 3. A partial return leaves the rest returnable.
test("a partial return keeps the status and the invoice stays returnable", () => {
  const returnable = constBody(orders, "assertOrderReturnable");
  assert.match(returnable, /isOrderFullyReturned\(items\)/);
  assert.doesNotMatch(returnable, /\["cancelled", "returned"\]\.includes\(status\)/);
  const body = handlerBody(orders, "returnOrder");
  assert.match(body, /assertOrderReturnable\(loaded\.order, loaded\.items\)/);
  assert.doesNotMatch(body, /const status = "returned";/);
  assert.match(body, /status = CASE WHEN \$2::boolean THEN 'returned' ELSE status END/);
  assert.match(body, /projectedReturnedAll \? "refunded" : "partially_refunded"/);
  // The edit lock still holds after a partial return.
  assert.match(constBody(orders, "assertOrderEditable"), /hasOrderReturnHistory\(order\)/);
  assert.match(handlerBody(orders, "cancelOrder"), /assertOrderCancellable\(loaded\.order, loaded\.items\)/);
});

// 4. Hard delete keeps history and refuses delivered orders.
test("hard delete keeps edit audits and activity logs, and refuses delivered orders", () => {
  const related = constBody(orders, "deleteOrderRelatedRows");
  assert.doesNotMatch(related, /deleteFromTableByPredicates\(client, "order_edit_audits"/);
  assert.doesNotMatch(related, /deleteFromTableByPredicates\(client, "activity_logs"/);
  const hard = handlerBody(orders, "permanentDeleteOrder");
  const deliveredAt = hard.indexOf("isDeliveredOrder(loaded.order)");
  assert.ok(deliveredAt !== -1 && deliveredAt < hard.indexOf("deleteOrderRelatedRows("), "the delivered check must run before anything is deleted");
});

// 5. Super admins act without a tenant scope; the ledgers use the invoice's tenant.
test("cancel and delete reverse money under the order's own tenant", () => {
  for (const name of ["cancelOrder", "deleteOrder"]) {
    const body = handlerBody(orders, name);
    assert.match(body, /const orderTenantId = loaded\.order\.tenant_id \?\? tenantId;/);
    assert.match(body, /reverseMoneyTransactionsForReference\(client, \{\s*tenantId: orderTenantId,/, `${name} must not pass a null tenant`);
  }
});

// 6a. The drawer loses the cancelled invoice's cash in both A and B.
test("cancel and delete write an order_cancel refund_cash drawer event, and the report agrees", () => {
  const helper = constBody(orders, "reverseOrderCashDrawer");
  assert.match(helper, /eventType: "refund_cash",\s*sourceType: "order_cancel"/);
  assert.match(helper, /LOWER\(e\.source_type\) = 'return' AND e\.event_type = 'refund_cash' THEN -e\.amount/, "cash already refunded by returns is not handed back twice");
  assert.match(handlerBody(orders, "cancelOrder"), /reverseOrderCashDrawer\(client, \{/);
  assert.match(handlerBody(orders, "deleteOrder"), /if \(!wasCancelled\) \{\s*await reverseOrderCashDrawer\(client, \{/);
  // Hard delete walks the cancel event back together with the sale.
  const related = constBody(orders, "deleteOrderRelatedRows");
  assert.equal((related.match(/'sale', 'order_cancel'\)/g) || []).length, 2);
  // B: the cancelled invoice's cash stays in the drawer math when its cash left via the event.
  const report = handlerBody(pos, "buildPosShiftReport");
  assert.match(report, /LOWER\(COALESCE\(ce\.source_type, ''\)\) = 'order_cancel'/);
  assert.match(report, /o\.cancelled_at > ds\.closed_at/);
  assert.match(report, /drawerSalesCash \+/);
  assert.match(report, /cancelledCashEventTotal -/);
  assert.match(report, /!isCancelCashEvent\(event\)/, "cancel cash must not be folded into the return-refund max()");
});

// 6b. The drawer event locks the shift and never lands on a closed one.
test("recordCashDrawerEvent locks the shift row and falls back from a closed shift", () => {
  const body = handlerBody(accounting, "recordCashDrawerEvent");
  assert.match(body, /AND status = 'open'\s*LIMIT 1\s*FOR UPDATE/);
  assert.match(body, /getCurrentCashDrawerShift\(dbClient, \{ tenantId, userId: createdBy, branchId \}\)[\s\S]*?shift = await lockOpenShift\(current\.id\)/);
});

// 7. Non-cash refunds land on today's shift.
test("returns put every refund method on the refunding user's open shift", () => {
  for (const name of ["returnOrder", "createReturn"]) {
    const body = handlerBody(orders, name);
    assert.doesNotMatch(body, /refundMethod === "cash" \? \(refundFunding\.shift\?\.id \|\| null\) : originalOrderShiftId/);
    assert.match(body, /const refundShiftId = await resolveReturnRefundShiftId\(client, \{/);
  }
  const helper = constBody(orders, "resolveReturnRefundShiftId");
  assert.match(helper, /getCurrentCashDrawerShift\(client, \{ tenantId, userId, branchId \}\)/);
  assert.match(helper, /return originalOrderShiftId \|\| null;/);
});
