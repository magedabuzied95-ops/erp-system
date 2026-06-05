const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const token = "ef327ca6793d29f68f6efd1293f66d3be0b28e7e1e9fb11d885a5b61e4e6e202";
const employeeToken = "001aa4a69cabb46824c4a670c7a41f427be9df30cdd81bad2066e43140116d4c";
const portalUrl = `http://127.0.0.1:5175/manager-portal/${token}`;

const results = [];
const pass = (name, details = "") => results.push({ name, ok: true, details });
const fail = (name, details = "") => results.push({ name, ok: false, details });

const list = await (await fetch("http://127.0.0.1:9226/json/list")).json();
const pageTarget = list.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
if (!pageTarget) throw new Error("No browser page target found");

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message || JSON.stringify(message.error)));
  else handler.resolve(message.result || {});
};

const evalExpr = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Runtime.evaluate failed");
  return response.result?.value ?? response.result?.result?.value;
};

const clickTestId = async (id) =>
  Boolean(
    await evalExpr(`(() => {
      const el = document.querySelector('[data-testid="${String(id).replace(/"/g, '\\"')}"]');
      if (!el) return false;
      el.click();
      return true;
    })()`)
  );

const setValueByTestId = async (id, value) =>
  Boolean(
    await evalExpr(`(() => {
      const el = document.querySelector('[data-testid="${String(id).replace(/"/g, '\\"')}"]');
      if (!el) return false;
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor?.set) descriptor.set.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
  );

const getBodyText = async () => String(await evalExpr('document.body.innerText || ""'));

const waitFor = async (predicateExpr, timeoutMs = 25000, intervalMs = 400) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await evalExpr(predicateExpr);
      if (result) return result;
    } catch {
      // Ignore transient evaluation errors while the UI mounts.
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${predicateExpr}`);
};

const waitForText = async (needle, timeoutMs = 25000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await getBodyText();
    if (text.includes(needle)) return text;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for text: ${needle}`);
};

const apiGet = async (path) => (await (await fetch(`http://127.0.0.1:8000${path}`)).json());
const apiJson = async (path, options = {}) =>
  (await (
    await fetch(`http://127.0.0.1:8000${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    })
  ).json());

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send("Page.bringToFront");
await send("Page.navigate", { url: portalUrl });
await send("Page.bringToFront");
await sleep(8000);
await waitFor(`Boolean(document.querySelector('[data-testid="tab-staff"]'))`, 30000);

const me = await apiGet(`/api/manager-portal/${token}/me`);
const dashboard = await apiGet(`/api/manager-portal/${token}/dashboard`);
const staffApi = await apiGet(`/api/manager-portal/${token}/staff`);
const tasksApi = await apiGet(`/api/manager-portal/${token}/tasks`);
const salesApi = await apiGet(`/api/manager-portal/${token}/sales`);
const notificationsApi = await apiGet(`/api/manager-portal/${token}/notifications?limit=40`);
const firstStaffName = staffApi?.staff?.staff?.[0]?.employee_name || "";

try {
  const bodyText = await getBodyText();
  if (bodyText.includes("بوابة المدير") || bodyText.includes("Manager Command Center") || bodyText.includes("Today")) pass("1. Portal opens", "manager portal rendered");
  else fail("1. Portal opens", "missing portal header text");
} catch (error) {
  fail("1. Portal opens", error.message);
}

try {
  if (me?.success && dashboard?.success) pass("2. Dashboard loads", `today_sales_total=${dashboard.dashboard?.today_sales_total ?? 0}`);
  else fail("2. Dashboard loads", `me=${Boolean(me?.success)} dashboard=${Boolean(dashboard?.success)}`);
} catch (error) {
  fail("2. Dashboard loads", error.message);
}

try {
  if (!(await clickTestId("tab-staff"))) throw new Error("staff tab button missing");
  await waitForText(firstStaffName || "Employee", 15000);
  const bodyText = await getBodyText();
  if (Array.isArray(staffApi?.staff?.staff) && staffApi.staff.staff.length > 0 && bodyText.includes(firstStaffName)) {
    pass("3. Staff tab loads real employees", `${staffApi.staff.staff.length} staff rows`);
  } else {
    fail("3. Staff tab loads real employees", `count=${staffApi?.staff?.staff?.length ?? 0} first=${firstStaffName || "n/a"}`);
  }
} catch (error) {
  fail("3. Staff tab loads real employees", error.message);
}

const smokeTaskTitle = `Smoke Task ${Date.now()}`;
let smokeTaskId = null;
try {
  if (!(await clickTestId("tab-tasks"))) throw new Error("tasks tab button missing");
  const created = await apiJson(`/api/manager-portal/${token}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: smokeTaskTitle,
      description: "Manager portal smoke test task",
      current_assignee_id: "9",
      priority: "medium",
    }),
  });
  const createdTaskPayload = created?.task?.task || created?.task || created?.data?.task || created?.data || created;
  smokeTaskId = createdTaskPayload?.id || createdTaskPayload?.task_id || createdTaskPayload?.task?.id || null;
  if (!smokeTaskId) {
    const fallbackTasks = await apiGet(`/api/manager-portal/${token}/tasks`);
    const foundTask = Array.isArray(fallbackTasks?.tasks?.tasks)
      ? fallbackTasks.tasks.tasks.find((task) => String(task.title || task.title_ar || "").includes(smokeTaskTitle))
      : null;
    smokeTaskId = foundTask?.id || null;
  }
  if (!smokeTaskId) throw new Error(created?.message || "task create failed");
  await waitForText(smokeTaskTitle, 15000);
  const approveButton = `task-approve-${smokeTaskId}`;
  if (!(await clickTestId(approveButton))) throw new Error("approve button missing");
  await sleep(1500);
  const refreshedTasks = await apiGet(`/api/manager-portal/${token}/tasks`);
  const updatedTask = Array.isArray(refreshedTasks?.tasks?.tasks) ? refreshedTasks.tasks.tasks.find((task) => String(task.id) === String(smokeTaskId)) : null;
  if (updatedTask?.status === "completed") pass("4. Tasks tab loads and task actions work", `task_id=${smokeTaskId} status=completed`);
  else fail("4. Tasks tab loads and task actions work", `task_id=${smokeTaskId} status=${updatedTask?.status || "unknown"}`);
} catch (error) {
  fail("4. Tasks tab loads and task actions work", error.message);
}

try {
  if (!(await clickTestId("tab-chat"))) throw new Error("chat tab button missing");
  const empMessage = `Smoke chat ${Date.now()}`;
  const employeeForm = new FormData();
  employeeForm.set("body", empMessage);
  const employeeResp = await (
    await fetch(`http://127.0.0.1:8000/api/employee-portal/${employeeToken}/chat/messages`, {
      method: "POST",
      body: employeeForm,
    })
  ).json();
  if (!employeeResp?.success) throw new Error(employeeResp?.message || "employee chat send failed");
  await waitForText(empMessage, 20000);
  const chatPayload = await apiGet(`/api/manager-portal/${token}/chat`);
  const thread = chatPayload?.threads?.find((item) => String(item.last_message || "").includes(empMessage)) || chatPayload?.threads?.[0] || chatPayload?.thread || null;
  if (!thread?.id) throw new Error("chat thread not found");
  if (!(await clickTestId(`chat-thread-${thread.id}`))) throw new Error("thread button missing");
  await waitFor(`Boolean(document.querySelector('[data-testid="chat-message-input"]'))`, 15000);
  const managerReply = `Manager reply ${Date.now()}`;
  if (!(await setValueByTestId("chat-message-input", managerReply))) throw new Error("chat input missing");
  if (!(await clickTestId("chat-send-button"))) throw new Error("send button missing");
  await waitForText(managerReply, 20000);
  pass("5. Chat can send/receive messages", `thread=${thread.id}`);
} catch (error) {
  fail("5. Chat can send/receive messages", error.message);
}

try {
  if (!(await clickTestId("tab-more"))) throw new Error("more tab button missing");
  await waitFor(`Boolean(document.querySelector('[data-testid="notifications-panel"]'))`, 10000);
  const settingsPanel = await waitFor(`Boolean(document.querySelector('[data-testid="sound-unlock-button"]'))`, 10000);
  if (settingsPanel) pass("6. Manager notification drawer loads", "notifications panel rendered");
  else fail("6. Manager notification drawer loads", "notification controls missing");
} catch (error) {
  fail("6. Manager notification drawer loads", error.message);
}

try {
  if (!(await clickTestId("sound-unlock-button"))) throw new Error("sound unlock button missing");
  await waitFor(`document.querySelector('[data-testid="sound-unlock-button"]')?.dataset?.state === "enabled"`, 10000);
  pass("7. Notification sound unlock works", "sound state enabled");
} catch (error) {
  fail("7. Notification sound unlock works", error.message);
}

try {
  const createdTitle = `Smoke refill created ${Date.now()}`;
  const resolvedTitle = `Smoke refill resolved ${Date.now()}`;
  const beforeCount = await evalExpr(`document.querySelectorAll('[data-testid^="notification-"]').length`);
  const created = await apiJson(`/api/manager-portal/${token}/debug/refill-alerts/create`, {
    method: "POST",
    body: JSON.stringify({ title: createdTitle, message: "Smoke refill alert created", entity_id: `smoke:${Date.now()}` }),
  });
  if (!created?.success || !created?.notification?.id) throw new Error(created?.message || "created refill notification missing");
  await waitFor(`document.querySelectorAll('[data-testid^="notification-"]').length > ${beforeCount}`, 20000);
  const afterCreateCount = await evalExpr(`document.querySelectorAll('[data-testid^="notification-"]').length`);
  const resolved = await apiJson(`/api/manager-portal/${token}/debug/refill-alerts/resolved`, {
    method: "POST",
    body: JSON.stringify({ title: resolvedTitle, message: "Smoke refill alert resolved", entity_id: `smoke:${Date.now()}:resolved` }),
  });
  if (!resolved?.success || !resolved?.notification?.id) throw new Error(resolved?.message || "resolved refill notification missing");
  await waitFor(`Array.from(document.querySelectorAll('[data-testid^="notification-"]')).some((node) => (node.innerText || '').includes(${JSON.stringify(resolvedTitle)}))`, 20000);
  const afterResolvedCount = await evalExpr(`document.querySelectorAll('[data-testid^="notification-"]').length`);
  if (afterCreateCount > beforeCount && afterResolvedCount >= afterCreateCount) {
    pass("8. Live refill alert notifications arrive", `before=${beforeCount} after_create=${afterCreateCount} after_resolved=${afterResolvedCount}`);
  } else {
    fail("8. Live refill alert notifications arrive", `before=${beforeCount} after_create=${afterCreateCount} after_resolved=${afterResolvedCount}`);
  }
} catch (error) {
  fail("8. Live refill alert notifications arrive", error.message);
}

try {
  const db = (await import("./server/database/db.js")).default;
  const branchCountRow = await db.query(`SELECT COUNT(*)::int AS count FROM employees WHERE COALESCE(is_deleted,FALSE)=FALSE AND LOWER(COALESCE(status,'active'))='active' AND branch_id = 5`);
  const allCountRow = await db.query(`SELECT COUNT(*)::int AS count FROM employees WHERE COALESCE(is_deleted,FALSE)=FALSE AND LOWER(COALESCE(status,'active'))='active'`);
  const branchStaffCount = Array.isArray(staffApi?.staff?.staff) ? staffApi.staff.staff.length : 0;
  if (Number(branchCountRow.rows[0].count) === branchStaffCount) pass("9. Branch filtering", `branch_count=${branchCountRow.rows[0].count} all_active=${allCountRow.rows[0].count}`);
  else fail("9. Branch filtering", `expected ${branchCountRow.rows[0].count} got ${branchStaffCount}`);
} catch (error) {
  fail("9. Branch filtering", error.message);
}

try {
  const permissions = Array.isArray(me?.manager?.permissions) ? me.manager.permissions : [];
  const profitAllowed = permissions.some((permission) => ["treasury.dashboard.view", "accounting.view", "accounting.reports", "reports.view", "money_accounts.view"].includes(permission));
  const profitValue = salesApi?.overview?.today?.profit;
  if (!profitAllowed && (profitValue === null || profitValue === undefined)) pass("10. Permission filtering", "profit hidden without permission");
  else if (profitAllowed) pass("10. Permission filtering", "profit permission granted");
  else fail("10. Permission filtering", "profit visibility check failed");
} catch (error) {
  fail("10. Permission filtering", error.message);
}

for (const row of results) {
  console.log(`${row.ok ? "PASS" : "FAIL"} ${row.name}${row.details ? ` - ${row.details}` : ""}`);
}

const failed = results.filter((row) => !row.ok);
console.log(`SUMMARY: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
ws.close();
