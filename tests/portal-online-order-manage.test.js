import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PORTAL_EDITABLE_FIELDS, deletePortalOnlineOrder, editPortalOnlineOrder } from "../server/modules/shipping/shipping.portal.manage.js";

// The manager portal's ⋮ on a shipping card (owner request 2026-09-10). Edit and delete
// run the ERP's own editOrder / deleteOrder with a request built on the server — so the
// three things that must never regress are: the field whitelist, the tenant on that
// request, and the refusal once a Bosta parcel exists.

const actor = { id: 37, tenant_id: 4, full_name: "Omar" };
const orderIn = (group, shipment = {}) => ({ id: 88, order_number: "WEB-88", group, shipment: { provider: "bosta", tracking_number: "", delivery_id: "", ...shipment } });

const makeDeps = (order, overrides = {}) => {
  const calls = { edit: [], remove: [], loadOrder: [], timeline: [], audit: [] };
  const deps = {
    loadOrder: async (args) => { calls.loadOrder.push(args); return order; },
    editHandler: async (req) => { calls.edit.push(req); return { statusCode: 200, payload: { success: true } }; },
    deleteHandler: async (req) => { calls.remove.push(req); return { statusCode: 200, payload: { success: true, restored_items: [{}, {}], stock_already_restored: false } }; },
    appendTimeline: async (entry) => { calls.timeline.push(entry); },
    audit: async (entry) => { calls.audit.push(entry); },
    ...overrides,
  };
  return { deps, calls };
};

test("edit sends only the whitelisted customer / address / notes fields", async () => {
  const { deps, calls } = makeDeps(orderIn("new"));
  await editPortalOnlineOrder({
    actor,
    orderId: "88",
    fields: { landmark: "  near the mosque ", status: "cancelled", payment_status: "paid", tenant_id: 1, shipping_cost: 0, customer_name: "Mona" },
    deps,
  });
  const body = calls.edit[0].body;
  assert.equal(body.landmark, "near the mosque");
  assert.equal(body.customer_name, "Mona");
  for (const forbidden of ["status", "payment_status", "tenant_id", "shipping_cost"]) assert.ok(!(forbidden in body), `${forbidden} must never reach editOrder`);
  assert.match(body.reason, /بوابة المدير — Omar/);
  assert.ok(!PORTAL_EDITABLE_FIELDS.includes("status") && !PORTAL_EDITABLE_FIELDS.includes("shipping_cost"));
  assert.equal(calls.timeline[0].action, "portal_edited");
});

test("the request handed to the ERP handler is scoped to the token holder's shop", async () => {
  const { deps, calls } = makeDeps(orderIn("confirmed"));
  await deletePortalOnlineOrder({ actor, orderId: 88, reason: "duplicate", deps });
  const req = calls.remove[0];
  assert.equal(req.tenantId, 4);
  assert.equal(req.user.tenant_id, 4);
  assert.notEqual(req.user.role, "super_admin", "a super-admin role would drop tenant scoping");
  assert.notEqual(req.user.role, "platform_admin");
  assert.equal(req.user.id, null, "no users row behind a portal token");
  assert.deepEqual(req.params, { id: "88" });
  assert.deepEqual(Object.keys(req.body), ["reason"]);
  assert.match(req.body.reason, /Omar: duplicate$/);
  assert.deepEqual(calls.loadOrder[0], { tenantId: 4, orderId: 88 });
});

test("nothing is edited or deleted once a Bosta parcel exists, or past preparation", async () => {
  for (const order of [orderIn("confirmed", { tracking_number: "6473852793" }), orderIn("shipping"), orderIn("delivered"), orderIn("closed")]) {
    const { deps, calls } = makeDeps(order);
    await assert.rejects(editPortalOnlineOrder({ actor, orderId: 88, fields: { landmark: "x" }, deps }), { status: 409 });
    await assert.rejects(deletePortalOnlineOrder({ actor, orderId: 88, deps }), { status: 409 });
    assert.equal(calls.edit.length + calls.remove.length, 0);
  }
});

test("edit refuses an empty save, a blank name and a bad phone", async () => {
  const { deps } = makeDeps(orderIn("new"));
  await assert.rejects(editPortalOnlineOrder({ actor, orderId: 88, fields: { status: "cancelled" }, deps }), { code: "NOTHING_TO_SAVE" });
  await assert.rejects(editPortalOnlineOrder({ actor, orderId: 88, fields: { customer_name: "  " }, deps }), { code: "CUSTOMER_NAME_REQUIRED" });
  await assert.rejects(editPortalOnlineOrder({ actor, orderId: 88, fields: { customer_phone: "01" }, deps }), { code: "CUSTOMER_PHONE_INVALID" });
});

test("a refusal from the ERP handler comes back with its own reason, never as a 5xx", async () => {
  const { deps } = makeDeps(orderIn("new"), { deleteHandler: async () => ({ statusCode: 500, payload: { message: "Query read timeout" } }) });
  await assert.rejects(deletePortalOnlineOrder({ actor, orderId: 88, deps }), { status: 409, code: "DELETE_REFUSED", message: "Query read timeout" });
});

test("delete reports how much stock went back", async () => {
  const { deps } = makeDeps(orderIn("new"));
  const result = await deletePortalOnlineOrder({ actor, orderId: 88, deps });
  assert.deepEqual(result, { deleted: true, order_id: 88, restored_items: 2, stock_already_restored: false });
});

test("edit and delete exist in the manager portal only", () => {
  const manager = readFileSync(new URL("../server/routes/managerPortal.js", import.meta.url), "utf8");
  const employee = readFileSync(new URL("../server/routes/employeePortal.js", import.meta.url), "utf8");
  assert.match(manager, /router\.post\("\/:token\/online-orders\/:orderId\/edit"/);
  assert.match(manager, /router\.post\("\/:token\/online-orders\/:orderId\/delete"/);
  assert.doesNotMatch(employee, /editPortalOnlineOrder|deletePortalOnlineOrder/);
});

test("delete warms the accounting schema before running deleteOrder", () => {
  // Its first-ever ALTER TABLE orders deadlocks against deleteOrder's own row lock.
  const source = readFileSync(new URL("../server/modules/shipping/shipping.portal.manage.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("deleteHandler: async"), source.indexOf("appendTimeline: async"));
  assert.ok(handler.indexOf("ensureAccountingSchema()") > 0 && handler.indexOf("ensureAccountingSchema()") < handler.indexOf("deleteOrder, req"));
});
