import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("employee notification read state is persisted through public portal routes", () => {
  const routes = source("server/routes/employeePortal.js");
  const page = source("src/modules/employees/pages/EmployeePayrollPortal.jsx");

  assert.match(routes, /notifications\/read-all/);
  assert.match(routes, /notifications\/:notificationId\/read/);
  assert.match(page, /notifications\/read-all/);
  assert.match(page, /notifications\/\$\{encodeURIComponent\(item\.id\)\}\/read/);
});

test("push events are persisted and delivery attempts are auditable", () => {
  const push = source("server/services/employeePortalPushService.js");

  assert.match(push, /persistPushNotification/);
  assert.match(push, /employee_push_delivery_logs/);
  assert.match(push, /No active push subscription/);
  assert.match(push, /status:\s*"sent"/);
});

test("manager chat persists an in-app notification and only delivers web push while chat is offline", () => {
  const push = source("server/services/employeePortalPushService.js");
  const chat = source("server/services/employeeChatService.js");
  const portal = source("src/modules/employees/pages/EmployeePayrollPortal.jsx");

  assert.match(push, /data\.message_id\s*\|\|\s*data\.request_id/);
  assert.match(push, /deliverPush\s*=\s*true/);
  assert.match(chat, /persist:\s*true/);
  assert.match(chat, /deliverPush:\s*!employeePortalIsConnected/);
  assert.match(chat, /markPersistedRead:\s*employeeChatIsActive/);
  assert.match(portal, /employeeChatActive:\s*true/);
  assert.match(portal, /isChatNotification/);
  assert.match(portal, /unreadChats:\s*chatOpen\s*\?\s*0/);
});

test("shared shortage alerts use employee-specific read receipts", () => {
  const refill = source("server/services/displayRefillAlertService.js");

  assert.match(refill, /employee_display_refill_alert_reads/);
  assert.match(refill, /employee_is_read AS is_read/);
  assert.match(refill, /baseColumns\.replace\("employee_is_read AS is_read", "is_read"\)/);
  assert.match(refill, /ON CONFLICT \(alert_id, employee_id\)/);
});

test("legacy employee task portal writes to the active push subscription store", () => {
  const tasks = source("server/services/staffTasksService.js");
  const api = source("src/modules/employees/services/staffTasksApi.js");

  assert.match(tasks, /INSERT INTO employee_push_subscriptions/);
  assert.match(tasks, /stale_unassigned_overdue/);
  assert.match(api, /employeePortalPushKey/);
  assert.match(api, /subscribeEmployeePortalPush/);
});
