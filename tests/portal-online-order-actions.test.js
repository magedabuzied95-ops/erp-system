import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runPortalOrderAction } from "../server/modules/shipping/shipping.portal.actions.js";
import { employeeCanActOnOnlineOrders, setEmployeeOnlineOrdersAccess } from "../server/modules/shipping/shipping.portal.access.js";
import { portalOrderActionsFor } from "../src/shared/components/portalOnlineOrders/portalOrderActions.js";

// أوردرات الشحن actions: confirm → ready to ship → create the Bosta parcel → print the
// AWB. Creating a parcel books a real courier and messages the customer, so the flow
// order and the "is this even your order" check are what must never regress.

const actor = { id: 12, tenant_id: 3, full_name: "Omar" };
const orderIn = (group, extra = {}) => ({
  id: 77,
  order_number: "WEB-77",
  group,
  status: extra.status || (group === "new" ? "pending_confirmation" : group === "confirmed" ? "confirmed" : "shipment_created"),
  shipment: { provider: "manual", tracking_number: "", delivery_id: "", ...(extra.shipment || {}) },
  ...extra,
});

const makeDeps = (order, overrides = {}) => {
  const calls = { confirm: [], markReady: [], createShipment: [], fetchLabels: [], audit: [], timeline: [], loadOrder: [] };
  const deps = {
    loadOrder: async (args) => {
      calls.loadOrder.push(args);
      return order;
    },
    confirm: async (args) => {
      calls.confirm.push(args);
      return { ...order, status: "confirmed" };
    },
    markReady: async (args) => {
      calls.markReady.push(args);
      return true;
    },
    createShipment: async (id) => {
      calls.createShipment.push(id);
    },
    fetchLabels: async (ids) => {
      calls.fetchLabels.push(ids);
      return { pdf_base64: "JVBERi0=", content_type: "application/pdf" };
    },
    appendTimeline: async (entry) => {
      calls.timeline.push(entry);
    },
    audit: async (entry) => {
      calls.audit.push(entry);
    },
    ...overrides,
  };
  return { deps, calls };
};

test("every action re-reads the order through the tenant-scoped board filter first", async () => {
  const { deps, calls } = makeDeps(orderIn("new"));
  await runPortalOrderAction({ actor, orderId: "77", action: "confirm", deps });
  assert.deepEqual(calls.loadOrder[0], { tenantId: 3, orderId: "77" });

  const refused = makeDeps(null, {
    loadOrder: async () => {
      const error = new Error("Order not found");
      error.status = 404;
      throw error;
    },
  });
  await assert.rejects(runPortalOrderAction({ actor, orderId: "5", action: "create_shipment", deps: refused.deps }), { status: 404 });
  assert.equal(refused.calls.createShipment.length, 0, "an order outside the board is never shipped");
});

test("an unknown action is refused before anything is read", async () => {
  const { deps, calls } = makeDeps(orderIn("new"));
  await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action: "delete", deps }), { status: 400, code: "UNKNOWN_ACTION" });
  assert.equal(calls.loadOrder.length, 0);
});

test("confirm runs the confirmation engine as staff, named, from the portal it came from", async () => {
  const { deps, calls } = makeDeps(orderIn("new"));
  await runPortalOrderAction({ actor, surface: "manager_portal", orderId: 77, action: "confirm", deps });
  assert.deepEqual(calls.confirm, [{ orderId: 77, actorName: "Omar", source: "manager_portal" }]);
  assert.equal(calls.audit[0].action, "online_order_confirm");
});

test("confirm is refused once the order is past new, and when the engine declines", async () => {
  const past = makeDeps(orderIn("confirmed"));
  await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action: "confirm", deps: past.deps }), { status: 409, code: "ORDER_NOT_CONFIRMABLE" });
  assert.equal(past.calls.confirm.length, 0);

  const declined = makeDeps(orderIn("new", { status: "human_handoff" }), { confirm: async () => ({ status: "human_handoff" }) });
  await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action: "confirm", deps: declined.deps }), { code: "ORDER_NOT_CONFIRMABLE" });
});

test("nothing is marked ready or shipped before it is confirmed", async () => {
  for (const action of ["ready_to_ship", "create_shipment"]) {
    const { deps, calls } = makeDeps(orderIn("new"));
    await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action, deps }), { status: 409, code: "ORDER_NOT_CONFIRMED" });
    assert.equal(calls.markReady.length + calls.createShipment.length, 0, `${action} must not run on an unconfirmed order`);
  }
});

test("ready to ship pressed twice is not an error and does not write twice", async () => {
  const { deps, calls } = makeDeps(orderIn("confirmed", { status: "ready_to_ship" }));
  await runPortalOrderAction({ actor, orderId: 77, action: "ready_to_ship", deps });
  assert.equal(calls.markReady.length, 0);
});

test("a second shipment is never booked, nor one on another courier's order", async () => {
  const shipped = makeDeps(orderIn("shipping", { shipment: { provider: "bosta", tracking_number: "6473852793" } }));
  await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action: "create_shipment", deps: shipped.deps }), { code: "BOSTA_SHIPMENT_EXISTS" });
  assert.equal(shipped.calls.createShipment.length, 0);

  const other = makeDeps(orderIn("confirmed", { shipment: { provider: "mylerz" } }));
  await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action: "create_shipment", deps: other.deps }), { code: "OTHER_COURIER" });
  assert.equal(other.calls.createShipment.length, 0);
});

test("a confirmed order is shipped once, and who shipped it is written on the order", async () => {
  const { deps, calls } = makeDeps(orderIn("confirmed"));
  const result = await runPortalOrderAction({ actor, orderId: 77, action: "create_shipment", deps });
  assert.deepEqual(calls.createShipment, [77]);
  assert.equal(calls.timeline[0].action, "portal_bosta_created");
  assert.equal(calls.timeline[0].actor, "Omar");
  assert.ok(result.order, "the refreshed order comes back for the screen");
});

test("Bosta's English 'missing city/zone' error becomes a code the portal can say in Arabic", async () => {
  const { deps } = makeDeps(orderIn("confirmed"), {
    createShipment: async () => {
      const error = new Error("Cannot create Bosta shipment. Missing city, zone");
      error.status = 400;
      throw error;
    },
  });
  await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action: "create_shipment", deps }), { status: 400, code: "BOSTA_ADDRESS_INCOMPLETE" });
});

test("the airway bill prints only for an order that has a parcel, and returns the PDF", async () => {
  const none = makeDeps(orderIn("confirmed"));
  await assert.rejects(runPortalOrderAction({ actor, orderId: 77, action: "print_awb", deps: none.deps }), { code: "BOSTA_NO_PRINTABLE_LABEL" });

  const parcel = makeDeps(orderIn("shipping", { shipment: { provider: "bosta", tracking_number: "6473852793" } }));
  const result = await runPortalOrderAction({ actor, orderId: 77, action: "print_awb", deps: parcel.deps });
  assert.deepEqual(parcel.calls.fetchLabels, [[77]]);
  assert.equal(result.pdf_base64, "JVBERi0=");
});

test("a failing audit log never fails the action", async () => {
  const { deps } = makeDeps(orderIn("new"), {
    audit: () => {
      throw new Error("audit table missing");
    },
  });
  await runPortalOrderAction({ actor, orderId: 77, action: "confirm", deps });
});

test("the screen offers exactly the next step of the flow", () => {
  assert.deepEqual(portalOrderActionsFor(orderIn("new")), ["confirm"]);
  assert.deepEqual(portalOrderActionsFor(orderIn("confirmed")), ["ready_to_ship", "create_shipment"]);
  assert.deepEqual(portalOrderActionsFor(orderIn("confirmed", { status: "ready_to_ship" })), ["create_shipment"]);
  assert.deepEqual(portalOrderActionsFor(orderIn("confirmed", { shipment: { provider: "mylerz" } })), ["ready_to_ship"]);
  assert.deepEqual(portalOrderActionsFor(orderIn("shipping", { shipment: { provider: "bosta", tracking_number: "1" } })), ["print_awb"]);
  assert.deepEqual(portalOrderActionsFor(orderIn("shipping", { shipment: { provider: "in_store_delivery", tracking_number: "in-store-1" } })), []);
  assert.deepEqual(portalOrderActionsFor(orderIn("closed", { status: "cancelled" })), []);
});

test("the employee switch reads 'off' without creating anything, and the first toggle creates the column once", async () => {
  const calls = [];
  let columnPresent = false;
  const client = {
    query: async (sql, params) => {
      calls.push(sql);
      if (sql.includes("information_schema.columns")) return { rows: columnPresent ? [{ "?column?": 1 }] : [] };
      if (sql.startsWith("ALTER TABLE")) {
        columnPresent = true;
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE employees")) return { rows: [{ id: params[0], enabled: params[1] }] };
      return { rows: [] };
    },
  };
  assert.equal(await employeeCanActOnOnlineOrders({ employeeId: 5, tenantId: 1, client }), false);
  assert.ok(!calls.some((sql) => sql.startsWith("ALTER")), "a portal read must never run DDL");

  await setEmployeeOnlineOrdersAccess({ employeeId: 5, tenantId: 1, enabled: true, client });
  await setEmployeeOnlineOrdersAccess({ employeeId: 5, tenantId: 1, enabled: false, client });
  assert.equal(calls.filter((sql) => sql.startsWith("ALTER")).length, 1, "the ALTER is memoized per process");
  const update = calls.find((sql) => sql.startsWith("UPDATE employees"));
  assert.match(update, /tenant_id = \$3::bigint/, "an admin can only switch employees of their own shop");
});

test("the employee route checks the switch before it acts; the manager route acts as the manager", () => {
  const employeeRoutes = readFileSync(new URL("../server/routes/employeePortal.js", import.meta.url), "utf8");
  const block = employeeRoutes.slice(employeeRoutes.indexOf('router.post("/:token/online-orders/:orderId/actions/:action"'));
  const guardAt = block.indexOf("employeeCanActOnOnlineOrders(");
  const actAt = block.indexOf("runPortalOrderAction(");
  assert.ok(guardAt > 0 && actAt > guardAt, "the permission check must come before the action");
  assert.match(block, /status\(403\)/);

  const managerRoutes = readFileSync(new URL("../server/routes/managerPortal.js", import.meta.url), "utf8");
  assert.match(managerRoutes, /runPortalOrderAction\(\{ actor: manager, surface: "manager_portal"/);
});

test("two creates racing cannot both pass the existing-parcel check", () => {
  const source = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("const loadOrderShipmentContext"), source.indexOf("export const createBostaShipmentForOrder"));
  assert.match(loader, /FROM orders WHERE id = \$1 LIMIT 1 FOR UPDATE/);
});
