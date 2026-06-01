import webPush from "web-push";
import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();
const updateCooldown = new Map();
const overdueCooldown = new Map();
const PUSH_UPDATE_COOLDOWN_MS = 60_000;
const PUSH_OVERDUE_COOLDOWN_MS = 30 * 60_000;

const endpointHost = (endpoint = "") => {
  try {
    return new URL(text(endpoint)).host;
  } catch {
    return "";
  }
};

const endpointAgeSeconds = (value = null) => {
  const time = value ? new Date(value).getTime() : 0;
  if (!Number.isFinite(time) || time <= 0) return null;
  return Math.max(0, Math.round((Date.now() - time) / 1000));
};

const hasVapidConfig = () =>
  Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY) && text(process.env.WEB_PUSH_PRIVATE_KEY) && text(process.env.WEB_PUSH_SUBJECT));

export const logEmployeePushVapidCheck = () => {
  console.info("[employee-push:vapid-check]", {
    hasPublicKey: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY)),
    hasPrivateKey: Boolean(text(process.env.WEB_PUSH_PRIVATE_KEY)),
    hasSubject: Boolean(text(process.env.WEB_PUSH_SUBJECT)),
  });
};

const configureWebPush = () => {
  if (!hasVapidConfig()) return false;
  try {
    webPush.setVapidDetails(
      text(process.env.WEB_PUSH_SUBJECT),
      text(process.env.WEB_PUSH_PUBLIC_KEY),
      text(process.env.WEB_PUSH_PRIVATE_KEY)
    );
    return true;
  } catch (error) {
    console.warn("[employee-portal-push] VAPID keys are invalid; push send skipped", {
      message: error.message,
      hasPublicKey: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY)),
      hasPrivateKey: Boolean(text(process.env.WEB_PUSH_PRIVATE_KEY)),
      hasSubject: Boolean(text(process.env.WEB_PUSH_SUBJECT)),
    });
    return false;
  }
};

const shouldSend = (map, key, cooldownMs) => {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < cooldownMs) return false;
  map.set(key, now);
  return true;
};

const portalNotificationUrl = (url = "", portalUrl = "", tab = "") => {
  const requestedUrl = text(url);
  const base = (requestedUrl && requestedUrl !== "/" ? requestedUrl : text(portalUrl) || "/employee-app/").replace("/employee-portal/", "/employee-app/");
  const safeTab = text(tab);
  if (!safeTab) return base;
  try {
    const parsed = new URL(base, "https://employee.portal");
    parsed.searchParams.set("tab", safeTab);
    return parsed.origin === "https://employee.portal" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}tab=${encodeURIComponent(safeTab)}`;
  }
};

export const buildTaskPushBody = (task = {}) => {
  const title = text(task.task_title_ar || task.title_ar || task.title);
  if (!task.due_at) return title;
  try {
    const due = new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(task.due_at));
    return `${title} - الموعد ${due}`;
  } catch {
    return title;
  }
};

const pushTagForEvent = (event = "", fallback = "") => {
  const tags = {
    task_assigned: "task-assigned",
    task_reassigned: "task-assigned",
    task_approved: "task-approved",
    payroll_generated: "payroll-generated",
    bonus_added: "bonus-added",
    penalty_added: "penalty-added",
    advance_approved: "advance-approved",
    advance_rejected: "advance-rejected",
    leave_approved: "leave-approved",
    leave_rejected: "leave-rejected",
    employee_chat_message: "employee-chat",
  };
  return tags[text(event)] || text(fallback) || "employee-portal";
};

const deactivateSubscription = async (id, statusCode = 0, reason = "") => {
  await db.query(
    `
    UPDATE employee_push_subscriptions
    SET is_active = FALSE,
        last_seen_at = NOW()
    WHERE id = $1
    `,
    [id]
  );
  console.warn("[employee-push:subscription-deactivated]", {
    subscriptionId: id,
    statusCode,
    reason,
  });
};

export const sendEmployeePortalPush = async ({ tenantId, employeeId, title, body, url = "/", tag = "", data = {} } = {}) => {
  if (!tenantId || !employeeId) return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  if (!configureWebPush()) {
    console.warn("[employee-portal-push] VAPID keys are missing; push send skipped", {
      tenantId,
      employeeId,
      hasPublicKey: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY)),
      hasPrivateKey: Boolean(text(process.env.WEB_PUSH_PRIVATE_KEY)),
      hasSubject: Boolean(text(process.env.WEB_PUSH_SUBJECT)),
    });
    return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  }

  const result = await db.query(
    `
    SELECT id, endpoint, p256dh, auth, portal_url, created_at, last_seen_at
    FROM employee_push_subscriptions
    WHERE tenant_id = $1
      AND employee_id = $2
      AND is_active = TRUE
    ORDER BY last_seen_at DESC
    `,
    [tenantId, employeeId]
  );

  console.info("[employee-push:send-start]", {
    employee_id: employeeId,
    subscription_count: result.rows.length,
    payloadKeys: ["title", "body", "tag", "url"],
    titleLength: text(title || "تنبيه جديد").length,
    bodyLength: text(body || "").length,
    url,
    tag: pushTagForEvent(data?.event, tag),
  });

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  for (const row of result.rows) {
    const notificationTag = pushTagForEvent(data?.event, tag);
    const notificationUrl = portalNotificationUrl(url, row.portal_url, data?.tab);
    const payloadObject = {
      title: title || "تنبيه جديد",
      body: body || "",
      icon: "/icons/employee-portal-192.png",
      badge: "/icons/employee-portal-192.png",
      tag: notificationTag,
      renotify: true,
      data: {
        ...(data || {}),
        url: notificationUrl,
        tag: notificationTag,
      },
    };
    if (notificationTag === "employee-chat") {
      delete payloadObject.icon;
      delete payloadObject.badge;
      delete payloadObject.renotify;
      delete payloadObject.data;
      payloadObject.title = title || "رسالة جديدة من الإدارة";
      payloadObject.body = body || "لديك رسالة جديدة في تطبيق الموظف";
      payloadObject.url = notificationUrl;
    }
    const payload = JSON.stringify(payloadObject);
    const subscription = {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    };

    try {
      await webPush.sendNotification(subscription, payload, { TTL: 60 * 60, topic: notificationTag || undefined });
      sent += 1;
      console.info("[employee-push:send-success]", {
        employee_id: employeeId,
        subscriptionId: row.id,
        endpointHost: endpointHost(row.endpoint),
      });
    } catch (error) {
      failed += 1;
      const statusCode = Number(error.statusCode || error.status || 0);
      console.warn("[employee-push:send-failed]", {
        employee_id: employeeId,
        subscriptionId: row.id,
        statusCode,
        message: error.message,
        body: text(error.body || error.response?.body || "").slice(0, 1000),
        errorBody: text(error.errorBody || "").slice(0, 1000),
        endpointHost: endpointHost(row.endpoint),
        endpointAge: endpointAgeSeconds(row.created_at),
        p256dhLength: text(row.p256dh).length,
        authLength: text(row.auth).length,
      });
      if ([400, 404, 410].includes(statusCode)) {
        deactivated += 1;
        await deactivateSubscription(row.id, statusCode, `web-push ${statusCode}`);
      } else {
        console.warn("[employee-portal-push] send failed", {
          subscriptionId: row.id,
          statusCode,
          message: error.message,
        });
      }
    }
  }

  console.info("[employee-portal-push] send summary", { tenantId, employeeId, sent, failed, deactivated, tag });
  return { sent, failed, deactivated, skipped: false };
};

export const sendTaskAssignedPush = async (task = {}, employee = {}, eventType = "task_assigned") => {
  return sendEmployeePortalPush({
    tenantId: task.tenant_id,
    employeeId: employee.id || task.current_assignee_id,
    title: "مهمة جديدة",
    body: "تم إسناد مهمة جديدة لك.",
    tag: "task-assigned",
    data: { task_id: task.id, event: eventType, tab: "tasks" },
  });
};

export const sendTaskUpdatedPush = async (task = {}, { actorEmployeeId = null, event = "task_updated" } = {}) => {
  const employeeId = task.current_assignee_id || task.assigned_employee_id;
  if (!employeeId || (actorEmployeeId && String(actorEmployeeId) === String(employeeId))) {
    return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  }
  const key = `${task.tenant_id}:${employeeId}:${task.id}:${event}`;
  if (!shouldSend(updateCooldown, key, PUSH_UPDATE_COOLDOWN_MS)) {
    return { sent: 0, failed: 0, deactivated: 0, skipped: true, cooldown: true };
  }
  const isTaskApproved = event === "status_changed" && String(task.status || "").toLowerCase() === "completed";
  return sendEmployeePortalPush({
    tenantId: task.tenant_id,
    employeeId,
    title: isTaskApproved ? "✅ تم اعتماد المهمة" : "تحديث على المهمة",
    body: isTaskApproved ? "تم اعتماد المهمة المكتملة." : text(task.task_title_ar || task.title_ar || task.title),
    tag: isTaskApproved ? "task-approved" : `staff-task-update-${task.id}`,
    data: { task_id: task.id, event: isTaskApproved ? "task_approved" : event, tab: "tasks" },
  });
};

export const sendTaskOverduePush = async (task = {}) => {
  const employeeId = task.current_assignee_id || task.assigned_employee_id;
  if (!employeeId) return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  const key = `${task.tenant_id}:${employeeId}:${task.id}:overdue`;
  if (!shouldSend(overdueCooldown, key, PUSH_OVERDUE_COOLDOWN_MS)) {
    return { sent: 0, failed: 0, deactivated: 0, skipped: true, cooldown: true };
  }
  return sendEmployeePortalPush({
    tenantId: task.tenant_id,
    employeeId,
    title: "تذكير بمهمة متأخرة",
    body: text(task.task_title_ar || task.title_ar || task.title),
    tag: `staff-task-overdue-${task.id}`,
    data: { task_id: task.id, event: "task_overdue", tab: "tasks" },
  });
};

export const sendOverdueEmployeePortalTaskPushes = async ({ tenantId = null, limit = 100 } = {}) => {
  const result = await db.query(
    `
    SELECT *
    FROM staff_task_assignments
    WHERE due_at IS NOT NULL
      AND due_at < NOW()
      AND status IN ('pending','in_progress')
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    ORDER BY due_at ASC
    LIMIT $2
    `,
    [tenantId, Math.min(Math.max(Number(limit || 100), 1), 500)]
  );
  const summaries = [];
  for (const task of result.rows) {
    summaries.push(await sendTaskOverduePush(task));
  }
  const total = summaries.reduce((acc, item) => ({
    sent: acc.sent + Number(item.sent || 0),
    failed: acc.failed + Number(item.failed || 0),
    deactivated: acc.deactivated + Number(item.deactivated || 0),
    skipped: acc.skipped + (item.skipped ? 1 : 0),
  }), { sent: 0, failed: 0, deactivated: 0, skipped: 0 });
  console.info("[employee-portal-push] overdue summary", { tenantId, tasks: result.rows.length, ...total });
  return { tasks: result.rows.length, ...total };
};
