import webPush from "web-push";
import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";

const text = (value = "") => String(value ?? "").trim();
const updateCooldown = new Map();
const overdueCooldown = new Map();
const PUSH_UPDATE_COOLDOWN_MS = 60_000;
const PUSH_OVERDUE_COOLDOWN_MS = 30 * 60_000;
const EMPLOYEE_FRONTEND_ORIGIN = "https://erp-system-ten-green.vercel.app";
let notificationSchemaPromise = null;

const ensurePushNotificationSchema = () => {
  if (!notificationSchemaPromise) {
    notificationSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS employee_push_subscriptions (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_agent TEXT NULL,
          portal_url TEXT NOT NULL DEFAULT '',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS employee_portal_notifications (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          type VARCHAR(120) NOT NULL,
          order_id BIGINT NULL,
          invoice_number VARCHAR(160) NULL,
          amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          action_url TEXT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          read_at TIMESTAMP NULL,
          dedupe_key TEXT NULL,
          cancelled_at TIMESTAMP NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`ALTER TABLE employee_portal_notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL`);
      await db.query(`ALTER TABLE employee_portal_notifications ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`);
      await db.query(`ALTER TABLE employee_portal_notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_portal_notifications_dedupe_key
        ON employee_portal_notifications (tenant_id, employee_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS employee_push_delivery_logs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          subscription_id BIGINT NULL REFERENCES employee_push_subscriptions(id) ON DELETE SET NULL,
          tag TEXT NOT NULL DEFAULT '',
          status VARCHAR(40) NOT NULL,
          status_code INTEGER NOT NULL DEFAULT 0,
          error_message TEXT NOT NULL DEFAULT '',
          endpoint_host TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_employee_push_delivery_employee ON employee_push_delivery_logs (employee_id, created_at DESC)`);
    })().catch((error) => {
      notificationSchemaPromise = null;
      throw error;
    });
  }
  return notificationSchemaPromise;
};

const persistentPushDedupeKey = ({ tag = "", data = {} } = {}) => {
  const event = text(data.event || tag || "employee_notification");
  const entity = data.message_id || data.request_id || data.task_id || data.payroll_id || data.opportunity_id || data.thread_id || tag;
  return `${event}:${text(entity || tag || "general")}`.slice(0, 500);
};

const persistPushNotification = async ({ tenantId, employeeId, title, body, url, tag, data } = {}) => {
  await ensurePushNotificationSchema();
  const employeeResult = await db.query(
    `SELECT employee_portal_token FROM employees WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) LIMIT 1`,
    [employeeId, tenantId || null]
  );
  const token = text(employeeResult.rows[0]?.employee_portal_token);
  const tab = text(data?.tab || "notifications");
  const actionUrl = text(url) && text(url) !== "/"
    ? text(url)
    : token
      ? `/employee-app/${encodeURIComponent(token)}?tab=${encodeURIComponent(tab)}`
      : `/employee-app/?tab=${encodeURIComponent(tab)}`;
  const type = text(data?.event || tag || "employee_notification").slice(0, 120);
  const dedupeKey = persistentPushDedupeKey({ tag, data });
  const result = await db.query(
    `
    INSERT INTO employee_portal_notifications (
      tenant_id, employee_id, type, title, body, action_url, metadata, dedupe_key
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    ON CONFLICT (tenant_id, employee_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
    SET type = EXCLUDED.type,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        action_url = EXCLUDED.action_url,
        metadata = EXCLUDED.metadata,
        read_at = NULL,
        cancelled_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id, tenant_id, employee_id, type, order_id, invoice_number, amount, title, body, action_url, metadata, read_at, created_at
    `,
    [tenantId, employeeId, type, text(title), text(body), actionUrl, JSON.stringify({ ...(data || {}), tag: text(tag) }), dedupeKey]
  );
  const notification = result.rows[0] || null;
  if (notification) {
    emitToRooms([`employee:${employeeId}`], "employee_portal:notification", {
      notification,
      badge: { tag: text(tag || type), tab },
      at: new Date().toISOString(),
    });
  }
  return notification;
};

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

const webPushSubject = () => {
  const configured = text(process.env.WEB_PUSH_SUBJECT);
  if (configured && !configured.toLowerCase().startsWith("mailto:")) return configured.replace(/\/+$/g, "");
  return text(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || process.env.VITE_PUBLIC_FRONTEND_URL || EMPLOYEE_FRONTEND_ORIGIN).replace(/\/+$/g, "");
};

const hasVapidConfig = () =>
  Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY) && text(process.env.WEB_PUSH_PRIVATE_KEY) && webPushSubject());

export const logEmployeePushVapidCheck = () => {
  console.info("[employee-push:vapid-check]", {
    hasPublicKey: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY)),
    hasPrivateKey: Boolean(text(process.env.WEB_PUSH_PRIVATE_KEY)),
    hasSubject: Boolean(webPushSubject()),
  });
};

const configureWebPush = () => {
  if (!hasVapidConfig()) return false;
  try {
    webPush.setVapidDetails(
      webPushSubject(),
      text(process.env.WEB_PUSH_PUBLIC_KEY),
      text(process.env.WEB_PUSH_PRIVATE_KEY)
    );
    return true;
  } catch (error) {
    console.warn("[employee-portal-push] VAPID keys are invalid; push send skipped", {
      message: error.message,
      hasPublicKey: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY)),
      hasPrivateKey: Boolean(text(process.env.WEB_PUSH_PRIVATE_KEY)),
      hasSubject: Boolean(webPushSubject()),
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

const recordPushDelivery = async ({
  tenantId,
  employeeId,
  subscriptionId = null,
  tag = "",
  status,
  statusCode = 0,
  errorMessage = "",
  endpoint = "",
} = {}) => {
  await ensurePushNotificationSchema();
  await db.query(
    `
    INSERT INTO employee_push_delivery_logs (
      tenant_id, employee_id, subscription_id, tag, status, status_code, error_message, endpoint_host
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [tenantId || null, employeeId, subscriptionId, text(tag), text(status), Number(statusCode || 0), text(errorMessage).slice(0, 2000), endpointHost(endpoint)]
  );
};

export const sendEmployeePortalPush = async ({ tenantId, employeeId, title, body, url = "/", tag = "", data = {}, persist = true, deliverPush = true, markPersistedRead = false } = {}) => {
  if (!tenantId || !employeeId) return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  await ensurePushNotificationSchema();
  let persistedNotification = null;
  if (persist) {
    persistedNotification = await persistPushNotification({ tenantId, employeeId, title, body, url, tag, data }).catch((error) => {
      console.warn("[employee-portal-notification] persistence failed", { tenantId, employeeId, tag, message: error?.message || error });
      return null;
    });
  }
  if (markPersistedRead && persistedNotification?.id) {
    await db.query(
      `UPDATE employee_portal_notifications SET read_at = COALESCE(read_at, NOW()), updated_at = NOW() WHERE id = $1`,
      [persistedNotification.id]
    ).catch((error) => console.warn("[employee-portal-notification] mark-read failed", { notificationId: persistedNotification.id, message: error?.message || error }));
  }
  if (!deliverPush) {
    return { sent: 0, failed: 0, deactivated: 0, skipped: false, persisted: Boolean(persistedNotification), push_skipped: "employee_chat_active" };
  }
  if (!configureWebPush()) {
    console.warn("[employee-portal-push] VAPID keys are missing; push send skipped", {
      tenantId,
      employeeId,
      hasPublicKey: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY)),
      hasPrivateKey: Boolean(text(process.env.WEB_PUSH_PRIVATE_KEY)),
      hasSubject: Boolean(webPushSubject()),
    });
    await recordPushDelivery({ tenantId, employeeId, tag, status: "skipped", errorMessage: "VAPID configuration is missing or invalid" }).catch(() => null);
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

  const notificationTag = pushTagForEvent(data?.event, tag);
  if (result.rows.length === 0) {
    await recordPushDelivery({ tenantId, employeeId, tag: notificationTag, status: "skipped", errorMessage: "No active push subscription" }).catch(() => null);
  }
  const isEmployeeChatPush = notificationTag === "employee-chat";
  const safeTitle = isEmployeeChatPush
    ? text(title) || " رسالة جديدة من الإدارة"
    : text(title || "تنبيه جديد");
  const safeBody = isEmployeeChatPush && text(body).length <= 10
    ? "لديك رسالة جديدة في تطبيق الموظف"
    : text(body || "");
  const safeUrl = isEmployeeChatPush && (!text(url) || text(url) === "/")
    ? "/employee-app/?tab=chat"
    : url;
  const notificationTitle = isEmployeeChatPush ? text(title) || "\u0631\u0633\u0627\u0644\u0629 \u062c\u062f\u064a\u062f\u0629" : safeTitle;
  const notificationBody = isEmployeeChatPush ? text(body) || "\u0644\u062f\u064a\u0643 \u0631\u0633\u0627\u0644\u0629 \u062c\u062f\u064a\u062f\u0629 \u0645\u0646 \u0627\u0644\u0625\u062f\u0627\u0631\u0629" : safeBody;

  console.info("[employee-push:send-start]", {
    employee_id: employeeId,
    subscription_count: result.rows.length,
    payloadKeys: ["title", "body", "tag", "url"],
    titleLength: notificationTitle.length,
    bodyLength: notificationBody.length,
    url: safeUrl,
    tag: notificationTag,
  });

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  for (const row of result.rows) {
    const notificationUrl = portalNotificationUrl(safeUrl, row.portal_url, data?.tab);
    const payloadObject = {
      title: notificationTitle,
      body: notificationBody,
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
      const sendOptions = { TTL: 60 * 60 };
      if (notificationTag !== "employee-chat" && endpointHost(row.endpoint) !== "web.push.apple.com") {
        sendOptions.topic = notificationTag || undefined;
      }
      await webPush.sendNotification(subscription, payload, sendOptions);
      sent += 1;
      await recordPushDelivery({
        tenantId,
        employeeId,
        subscriptionId: row.id,
        tag: notificationTag,
        status: "sent",
        endpoint: row.endpoint,
      }).catch(() => null);
      console.info("[employee-push:send-success]", {
        employee_id: employeeId,
        subscriptionId: row.id,
        endpointHost: endpointHost(row.endpoint),
      });
    } catch (error) {
      failed += 1;
      const statusCode = Number(error.statusCode || error.status || 0);
      await recordPushDelivery({
        tenantId,
        employeeId,
        subscriptionId: row.id,
        tag: notificationTag,
        status: [400, 404, 410].includes(statusCode) ? "deactivated" : "failed",
        statusCode,
        errorMessage: error.message,
        endpoint: row.endpoint,
      }).catch(() => null);
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
