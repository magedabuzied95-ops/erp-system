import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildPortalNewOrderPush, notifyEmployeesOfNewWebOrder } from "../server/modules/shipping/portalNewOrderPush.js";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a website order push opens the shipping board with a per-order tag", () => {
  const push = buildPortalNewOrderPush({
    employee: { employee_portal_token: "tok/1" },
    order: { id: 55, public_order_number: "W-1001", customer_name: "منى", total_amount: 850 },
  });
  assert.equal(push.url, "/employee-app/tok%2F1/online-orders");
  assert.equal(push.tag, "web-order-55");
  assert.match(push.body, /W-1001/);
  assert.match(push.body, /منى/);
  assert.match(push.body, /850/);
  assert.equal(push.data.order_id, 55);
});

test("every subscribed employee of the tenant is sent the order", async () => {
  const calls = [];
  let askedTenant = null;
  const result = await notifyEmployeesOfNewWebOrder({
    order: { id: 9, tenant_id: 3, customer_name: "x", total_amount: 100 },
    loadRecipients: async ({ tenantId }) => {
      askedTenant = tenantId;
      return [{ id: 1, employee_portal_token: "a" }, { id: 2, employee_portal_token: "b" }];
    },
    send: async (payload) => {
      calls.push(payload);
      return { sent: 1 };
    },
  });
  assert.equal(askedTenant, 3);
  assert.deepEqual(calls.map((c) => [c.tenantId, c.employeeId]), [[3, 1], [3, 2]]);
  assert.equal(result.sent, 2);
});

test("one failing employee does not stop the rest", async () => {
  const sentTo = [];
  const result = await notifyEmployeesOfNewWebOrder({
    order: { id: 9, tenant_id: 3 },
    loadRecipients: async () => [{ id: 1 }, { id: 2 }],
    send: async ({ employeeId }) => {
      if (employeeId === 1) throw new Error("boom");
      sentTo.push(employeeId);
      return { sent: 1 };
    },
  });
  assert.deepEqual(sentTo, [2]);
  assert.equal(result.sent, 1);
});

test("no tenant or no order sends nothing", async () => {
  const send = async () => assert.fail("must not send");
  const loadRecipients = async () => assert.fail("must not load");
  assert.equal((await notifyEmployeesOfNewWebOrder({ order: { id: 1 }, send, loadRecipients })).reason, "no-tenant");
  assert.equal((await notifyEmployeesOfNewWebOrder({ order: { tenant_id: 1 }, send, loadRecipients })).reason, "no-order");
});

test("recipients are tenant-scoped, active, and hold a live subscription", () => {
  const module = source("server/modules/shipping/portalNewOrderPush.js");
  assert.match(module, /e\.tenant_id = \$1::bigint/);
  assert.doesNotMatch(module, /tenant_id IS NULL/);
  assert.match(module, /s\.is_active = TRUE/);
  assert.match(module, /is_deleted/);
});

test("the website checkout rings employees, a POS online order does not", () => {
  const controller = source("server/controllers/storefrontController.js");
  assert.match(controller, /if \(!posOnlineOrder\) \{\s*void notifyEmployeesOfNewWebOrder\(/);
});
