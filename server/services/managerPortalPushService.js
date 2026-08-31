import webPush from "web-push";
import db from "../database/db.js";
import { createNotification } from "./notificationsService.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import { attachOperationVariantLabels } from "../utils/operationVariantLabels.js";

const DEFAULT_FRONTEND_ORIGIN = "https://erp-system-ten-green.vercel.app";

const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const jsonObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const vapidPublicKey = () => text(process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY);
const vapidPrivateKey = () => text(process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_PRIVATE_KEY);
const webPushSubject = () =>
  text(process.env.VAPID_SUBJECT || process.env.WEB_PUSH_SUBJECT || getPublicAppUrl() || process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || DEFAULT_FRONTEND_ORIGIN).replace(/\/+$/, "");

const endpointHost = (endpoint = "") => {
  try {
    return new URL(text(endpoint)).host;
  } catch {
    return "";
  }
};

const endpointPrefix = (endpoint = "", length = 64) => text(endpoint).slice(0, length);

const hasVapidConfig = () => Boolean(vapidPublicKey() && vapidPrivateKey() && webPushSubject());

const configureWebPush = () => {
  if (!hasVapidConfig()) return false;
  try {
    webPush.setVapidDetails(webPushSubject(), vapidPublicKey(), vapidPrivateKey());
    return true;
  } catch (error) {
    console.warn("[manager-push:vapid-invalid]", {
      message: error?.message || String(error),
      hasPublicKey: Boolean(vapidPublicKey()),
      hasPrivateKey: Boolean(vapidPrivateKey()),
      hasSubject: Boolean(webPushSubject()),
    });
    return false;
  }
};

export const ensurePortalPushSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS portal_push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      portal_type VARCHAR(40) NOT NULL,
      portal_token TEXT NOT NULL DEFAULT '',
      manager_employee_id BIGINT NULL,
      user_id BIGINT NULL,
      tenant_id BIGINT NULL,
      branch_id BIGINT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL DEFAULT '',
      auth TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      portal_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMPTZ NULL,
      UNIQUE (portal_type, endpoint)
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_portal_push_subscriptions_lookup ON portal_push_subscriptions (portal_type, portal_token, revoked_at)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_portal_push_subscriptions_scope ON portal_push_subscriptions (portal_type, tenant_id, branch_id, revoked_at)`);
};

export const getManagerPortalPushPublicKey = async () => {
  await ensurePortalPushSchema(db);
  return {
    publicKey: vapidPublicKey(),
    enabled: hasVapidConfig(),
  };
};

export const subscribeManagerPortalPush = async ({ manager = {}, token = "", subscription = {}, userAgent = "", portalUrl = "" } = {}) => {
  await ensurePortalPushSchema(db);
  const endpoint = text(subscription.endpoint);
  const keys = jsonObject(subscription.keys);
  const p256dh = text(keys.p256dh);
  const auth = text(keys.auth);
  if (!endpoint || !p256dh || !auth) {
    const error = new Error("Invalid push subscription");
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `
    INSERT INTO portal_push_subscriptions (
      portal_type, portal_token, manager_employee_id, user_id, tenant_id, branch_id,
      endpoint, p256dh, auth, user_agent, portal_url, revoked_at, created_at, updated_at, last_seen_at
    )
    VALUES ('manager', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NOW(), NOW(), NOW())
    ON CONFLICT (portal_type, endpoint)
    DO UPDATE SET
      portal_token = EXCLUDED.portal_token,
      manager_employee_id = EXCLUDED.manager_employee_id,
      user_id = EXCLUDED.user_id,
      tenant_id = EXCLUDED.tenant_id,
      branch_id = EXCLUDED.branch_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      portal_url = EXCLUDED.portal_url,
      revoked_at = NULL,
      updated_at = NOW(),
      last_seen_at = NOW()
    RETURNING id, endpoint, created_at, updated_at, last_seen_at
    `,
    [
      text(token || manager.manager_portal_token),
      numberOrNull(manager.id),
      numberOrNull(manager.user_id),
      numberOrNull(manager.tenant_id),
      numberOrNull(manager.branch_id),
      endpoint,
      p256dh,
      auth,
      text(userAgent).slice(0, 1000),
      text(portalUrl).slice(0, 1000),
    ]
  );
  const row = result.rows[0] || null;
  if (row) {
    console.info("[manager-push:db-saved]", {
      subscription_id: row.id,
      portal_token: text(token || manager.manager_portal_token),
      manager_employee_id: numberOrNull(manager.id),
      user_id: numberOrNull(manager.user_id),
      endpoint_prefix: endpointPrefix(endpoint),
      endpoint_host: endpointHost(endpoint),
      revoked_at: null,
    });
  }
  return {
    subscription: row,
    endpoint_host: endpointHost(endpoint),
  };
};

export const unsubscribeManagerPortalPush = async ({ manager = {}, token = "", endpoint = "" } = {}) => {
  await ensurePortalPushSchema(db);
  const safeEndpoint = text(endpoint);
  const params = [text(token || manager.manager_portal_token)];
  let endpointClause = "";
  if (safeEndpoint) {
    params.push(safeEndpoint);
    endpointClause = `AND endpoint = $${params.length}`;
  }
  const result = await db.query(
    `
    UPDATE portal_push_subscriptions
    SET revoked_at = COALESCE(revoked_at, NOW()),
        updated_at = NOW(),
        last_seen_at = NOW()
    WHERE portal_type = 'manager'
      AND portal_token = $1
      ${endpointClause}
    RETURNING id, endpoint, revoked_at
    `,
    params
  );
  return { count: result.rowCount || 0, subscriptions: result.rows };
};

const settingAllowsPush = (settings = {}, category = "sales") => {
  const root = jsonObject(settings);
  const notifications = jsonObject(root.notifications || root);
  const categorySettings = jsonObject(notifications[category]);
  if (categorySettings.push === false) return false;
  if (root.quiet_mode === true || root.quietMode === true || notifications.quiet_mode === true || notifications.quietMode === true) return false;
  return true;
};

const loadManagerSubscriptions = async ({ tenantId = null, branchId = null, category = "sales" } = {}) => {
  await ensurePortalPushSchema(db);
  const result = await db.query(
    `
    SELECT
      s.id AS subscription_id,
      s.endpoint,
      s.p256dh,
      s.auth,
      s.portal_token,
      s.created_at,
      e.id AS manager_employee_id,
      e.user_id,
      e.full_name,
      e.branch_id AS manager_branch_id,
      e.manager_portal_settings
    FROM portal_push_subscriptions s
    JOIN employees e ON e.manager_portal_token = s.portal_token
    WHERE s.portal_type = 'manager'
      AND s.revoked_at IS NULL
      AND ($1::bigint IS NULL OR s.tenant_id = $1::bigint OR e.tenant_id = $1::bigint)
      AND COALESCE(e.is_deleted, FALSE) = FALSE
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
      AND (
        COALESCE(e.manager_portal_enabled, FALSE) = TRUE
        OR LOWER(COALESCE(e.role, '')) IN ('manager', 'admin', 'super_admin', 'superadmin')
        OR LOWER(COALESCE(e.job_title, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin')
        OR LOWER(COALESCE(e.position, '')) IN ('manager', 'branch manager', 'branch_manager', 'admin', 'super_admin', 'superadmin', 'super admin')
      )
      AND (
        $2::bigint IS NULL
        OR e.branch_id IS NULL
        OR e.branch_id = $2::bigint
        OR LOWER(COALESCE(e.manager_portal_settings->>'branch_scope', '')) = 'all'
        OR LOWER(COALESCE(e.manager_portal_settings->>'scope_all_branches', '')) IN ('true', '1', 'yes')
      )
    ORDER BY s.last_seen_at DESC
    `,
    [tenantId, branchId]
  );
  return result.rows.filter((row) => settingAllowsPush(row.manager_portal_settings || {}, category));
};

export const getManagerPortalPushSubscriptionDebug = async ({ token = "" } = {}) => {
  await ensurePortalPushSchema(db);
  const result = await db.query(
    `
    SELECT
      s.id AS subscription_id,
      s.portal_token,
      s.endpoint,
      s.p256dh,
      s.auth,
      s.revoked_at,
      s.created_at,
      s.updated_at,
      s.last_seen_at,
      s.user_id,
      s.manager_employee_id,
      e.id AS matched_employee_id,
      e.tenant_id AS employee_tenant_id,
      e.branch_id AS employee_branch_id,
      e.full_name,
      e.status,
      COALESCE(e.is_deleted, FALSE) AS is_deleted
    FROM portal_push_subscriptions s
    LEFT JOIN employees e ON e.manager_portal_token = s.portal_token
    WHERE s.portal_type = 'manager'
      AND s.portal_token = $1
    ORDER BY s.revoked_at NULLS FIRST, s.last_seen_at DESC, s.id DESC
    `,
    [text(token)]
  );
  const subscriptions = result.rows.map((row) => ({
    subscription_id: row.subscription_id,
    portal_token: row.portal_token,
    endpoint_prefix: endpointPrefix(row.endpoint),
    endpoint_host: endpointHost(row.endpoint),
    p256dh: row.p256dh,
    auth: row.auth,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_seen_at: row.last_seen_at,
    user_id: row.user_id,
    manager_employee_id: row.manager_employee_id,
    matched_employee_id: row.matched_employee_id,
    employee_tenant_id: row.employee_tenant_id,
    employee_branch_id: row.employee_branch_id,
    full_name: row.full_name,
    status: row.status,
    is_deleted: row.is_deleted,
  }));
  const active = subscriptions.filter((row) => !row.revoked_at && row.matched_employee_id && !row.is_deleted && String(row.status || "").toLowerCase() === "active");
  return {
    token: text(token),
    active_count: active.length,
    total_count: subscriptions.length,
    subscriptions,
  };
};

const deactivateSubscription = async (id, statusCode = 0, reason = "") => {
  await db.query(
    `
    UPDATE portal_push_subscriptions
    SET revoked_at = COALESCE(revoked_at, NOW()),
        updated_at = NOW(),
        last_seen_at = NOW()
    WHERE id = $1
    `,
    [id]
  );
  console.warn("[manager-push:subscription-revoked]", { subscriptionId: id, statusCode, reason });
};

const sendToManagerSubscriptions = async ({ tenantId = null, branchId = null, category = "sales", buildPayload, logLabels } = {}) => {
  const labels = logLabels || {
    attempt: "[manager-push:send-attempt]",
    success: "[manager-push:send-success]",
    failed: "[manager-push:send-failed]",
  };
  if (!configureWebPush()) {
    console.warn("[manager-push:vapid-missing]", {
      tenantId,
      branchId,
      hasPublicKey: Boolean(vapidPublicKey()),
      hasPrivateKey: Boolean(vapidPrivateKey()),
      hasSubject: Boolean(webPushSubject()),
    });
    return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  }
  const rows = await loadManagerSubscriptions({ tenantId, branchId, category });
  console.info("[manager-push:recipient-count]", {
    count: rows.length,
    tenantId,
    branchId,
    category,
    token_ref: rows[0]?.portal_token || null,
    manager_employee_id: rows[0]?.manager_employee_id || null,
  });
  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  for (const row of rows) {
    const payloadObject = buildPayload?.(row) || {};
    const payload = JSON.stringify({
      icon: "/icons/employee-portal-192.png",
      badge: "/icons/employee-portal-192.png",
      renotify: true,
      ...payloadObject,
      data: {
        ...(payloadObject.data || {}),
        url: payloadObject.data?.url || payloadObject.url || "/",
        tag: payloadObject.data?.tag || payloadObject.tag || "manager-portal",
      },
    });
    console.info(labels.attempt, {
      tenantId,
      branchId,
      portal_token: row.portal_token,
      manager_employee_id: row.manager_employee_id,
      subscriptionId: row.subscription_id,
      endpointHost: endpointHost(row.endpoint),
      endpointPrefix: endpointPrefix(row.endpoint),
      tag: payloadObject.tag || payloadObject.data?.tag || "",
    });
    try {
      const sendOptions = { TTL: 60 * 60 };
      if (endpointHost(row.endpoint) !== "web.push.apple.com") sendOptions.topic = text(payloadObject.tag || payloadObject.data?.tag).slice(0, 32) || undefined;
      await webPush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, sendOptions);
      sent += 1;
      console.info(labels.success, {
        subscriptionId: row.subscription_id,
        portal_token: row.portal_token,
        manager_employee_id: row.manager_employee_id,
      });
    } catch (error) {
      failed += 1;
      const statusCode = Number(error.statusCode || error.status || 0);
      console.warn(labels.failed, {
        subscriptionId: row.subscription_id,
        portal_token: row.portal_token,
        manager_employee_id: row.manager_employee_id,
        statusCode,
        message: error?.message || String(error),
        body: text(error?.body || error?.response?.body || error?.errorBody).slice(0, 1000),
        endpointHost: endpointHost(row.endpoint),
        endpointPrefix: endpointPrefix(row.endpoint),
      });
      if ([400, 404, 410].includes(statusCode)) {
        deactivated += 1;
        await deactivateSubscription(row.subscription_id, statusCode, `web-push ${statusCode}`);
      }
    }
  }
  return { sent, failed, deactivated, skipped: false };
};

const chatPreview = (message = {}) => {
  const body = text(message.body || message.message || message.text);
  if (body) return body.slice(0, 120);
  const type = text(message.attachment_type || message.type || message.media_type).toLowerCase();
  const mime = text(message.attachment_mime || message.attachment_mime_type || message.mime_type).toLowerCase();
  if (type.includes("image") || mime.startsWith("image/")) return "صورة";
  if (type.includes("voice") || type.includes("audio") || mime.startsWith("audio/")) return "رسالة صوتية";
  return "ملف";
};

export const sendManagerEmployeeChatPush = async ({ tenantId = null, branchId = null, employee = {}, employeeId = null, employeeName = "", threadId = null, message = {}, channelKey = "", kind = "message", attempt = 0 } = {}) => {
  const isRing = kind === "ring";
  const resolvedEmployeeId = numberOrNull(employeeId || employee.id || message.sender_employee_id);
  // A branch POS channel has no employee; the portal selects it by its "pos-branch-<id>" key.
  const selectionKey = text(channelKey) || String(resolvedEmployeeId || "");
  const resolvedThreadId = numberOrNull(threadId || message.thread_id);
  if (!isRing && resolvedThreadId) {
    try {
      const muted = await db.query(`SELECT muted_until FROM employee_chat_thread_prefs WHERE thread_id = $1 LIMIT 1`, [resolvedThreadId]);
      const until = muted.rows[0]?.muted_until;
      if (until && new Date(until).getTime() > Date.now()) {
        console.info("[manager-push:chat-muted]", { thread_id: resolvedThreadId, muted_until: until });
        return { sent: 0, muted: true };
      }
    } catch (error) {
      console.warn("[manager-push] mute lookup failed", error?.message || error);
    }
  }
  const name = text(employeeName || employee.full_name || employee.employee_name || employee.employee_code) || "موظف";
  console.info("[manager-push:chat-trigger-entered]", {
    tenantId,
    branchId,
    employee_id: resolvedEmployeeId,
    thread_id: resolvedThreadId,
    sender_type: "employee",
    message_id: message.id || null,
    attachment_type: message.attachment_type || null,
  });
  return sendToManagerSubscriptions({
    tenantId: numberOrNull(tenantId),
    branchId: numberOrNull(branchId || employee.branch_id),
    category: "messages",
    logLabels: {
      attempt: "[manager-push:send-attempt]",
      success: "[manager-push:send-success]",
      failed: "[manager-push:send-failed]",
    },
    buildPayload: (row) => {
      const url = `/manager-portal/${encodeURIComponent(row.portal_token)}?tab=chat&employee_id=${encodeURIComponent(selectionKey)}&thread_id=${encodeURIComponent(String(resolvedThreadId || ""))}`;
      return {
        title: isRing ? `📞 نداء من ${name}` : `رسالة جديدة من ${name}`,
        body: isRing ? "افتح البوابة للرد على النداء" : chatPreview(message),
        // A ring retry must surface as a NEW notification, so its tag carries the attempt.
        tag: isRing ? `manager-ring-${message.id || resolvedThreadId}-${attempt}` : `manager-chat-${resolvedThreadId || resolvedEmployeeId || "thread"}`,
        data: {
          type: isRing ? "employee_chat_ring" : "employee_chat",
          thread_id: resolvedThreadId,
          employee_id: selectionKey || resolvedEmployeeId,
          message_id: message.id || null,
          url,
        },
      };
    },
  });
};

export const sendManagerPortalTestPush = async ({ token = "", manager = null } = {}) => {
  await ensurePortalPushSchema(db);
  if (!configureWebPush()) {
    console.warn("[manager-push:vapid-missing]", {
      token_ref: text(token || manager?.manager_portal_token),
      hasPublicKey: Boolean(vapidPublicKey()),
      hasPrivateKey: Boolean(vapidPrivateKey()),
      hasSubject: Boolean(webPushSubject()),
      test: true,
    });
    return { token: text(token || manager?.manager_portal_token), active_count: 0, sent: 0, failed: 0, deactivated: 0, skipped: true };
  }
  const payloadToken = text(token || manager?.manager_portal_token);
  const debug = await getManagerPortalPushSubscriptionDebug({ token: payloadToken });
  const activeSubscriptions = debug.subscriptions.filter((row) => !row.revoked_at && row.matched_employee_id && !row.is_deleted && String(row.status || "").toLowerCase() === "active");
  console.info("[manager-push:recipient-count]", {
    count: activeSubscriptions.length,
    token_ref: payloadToken,
    manager_employee_id: manager?.id || activeSubscriptions[0]?.manager_employee_id || null,
    category: "messages",
    test: true,
  });

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  for (const row of activeSubscriptions) {
    const payload = JSON.stringify({
      title: "اختبار إشعار المدير",
      body: "لو وصلك الإشعار ده يبقى الاشتراك شغال",
      icon: "/icons/employee-portal-192.png",
      badge: "/icons/employee-portal-192.png",
      renotify: true,
      data: {
        url: `/manager-portal/${encodeURIComponent(row.portal_token)}`,
        tag: "manager-portal-test",
      },
    });
    console.info("[manager-push:send-attempt]", {
      token_ref: payloadToken,
      subscriptionId: row.subscription_id,
      portal_token: row.portal_token,
      endpointHost: row.endpoint_host,
      endpointPrefix: row.endpoint_prefix,
      test: true,
    });
    try {
      const sendOptions = { TTL: 60 * 60 };
      if (row.endpoint_host !== "web.push.apple.com") sendOptions.topic = "manager-portal-test";
      await webPush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, sendOptions);
      sent += 1;
      console.info("[manager-push:send-success]", {
        token_ref: payloadToken,
        subscriptionId: row.subscription_id,
        portal_token: row.portal_token,
        test: true,
      });
    } catch (error) {
      failed += 1;
      const statusCode = Number(error.statusCode || error.status || 0);
      console.warn("[manager-push:send-failed]", {
        token_ref: payloadToken,
        subscriptionId: row.subscription_id,
        portal_token: row.portal_token,
        statusCode,
        message: error?.message || String(error),
        body: text(error?.body || error?.response?.body || error?.errorBody).slice(0, 1000),
        endpointHost: row.endpoint_host,
        endpointPrefix: row.endpoint_prefix,
        test: true,
      });
      if ([400, 404, 410].includes(statusCode)) {
        deactivated += 1;
        await deactivateSubscription(row.subscription_id, statusCode, `web-push ${statusCode}`);
      }
    }
  }

  return {
    token: payloadToken,
    active_count: activeSubscriptions.length,
    sent,
    failed,
    deactivated,
    subscriptions: activeSubscriptions,
  };
};

export const sendManagerInvoiceCreatedPush = async ({ order = {}, source = "" } = {}) => {
  const orderId = numberOrNull(order.id || order.order_id);
  const tenantId = numberOrNull(order.tenant_id);
  const branchId = numberOrNull(order.branch_id);
  if (!orderId) return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  const invoiceNumber = text(order.invoice_number || order.public_order_number || order.display_order_number || orderId);
  const total = Number(order.total_amount ?? order.total ?? order.total_price ?? 0);
  const customerName = text(order.customer_name || order.customer_record_name) || "عميل";
  const body = `فاتورة رقم ${invoiceNumber} بقيمة ${total} - ${customerName}`;
  console.info("[manager-push:invoice-created]", { tenantId, branchId, order_id: orderId, invoice_number: invoiceNumber, source });
  createNotification({
    tenant_id: tenantId || null,
    role_key: "manager",
    branch_id: branchId || null,
    type: "invoice_created",
    category: "sales",
    priority: "high",
    title: "فاتورة جديدة",
    message: body,
    action_label: "عرض الفاتورة",
    entity_type: "order",
    entity_id: String(orderId),
    metadata: {
      type: "invoice_created",
      invoice_id: orderId,
      order_id: orderId,
      invoice_number: invoiceNumber,
      source: text(source),
      open_invoice: true,
    },
  }).catch((error) => console.warn("[manager-push:invoice-notification-failed]", { order_id: orderId, message: error?.message || String(error) }));

  return sendToManagerSubscriptions({
    tenantId,
    branchId,
    category: "sales",
    logLabels: {
      attempt: "[manager-push:invoice-send-attempt]",
      success: "[manager-push:invoice-send-success]",
      failed: "[manager-push:invoice-send-failed]",
    },
    buildPayload: (row) => {
      const url = `/manager-portal/${encodeURIComponent(row.portal_token)}?tab=sales&invoice_id=${encodeURIComponent(String(orderId))}&open_invoice=1`;
      return {
        title: "فاتورة جديدة",
        body,
        tag: `manager-invoice-${orderId}`,
        data: {
          type: "invoice_created",
          invoice_id: orderId,
          order_id: orderId,
          invoice_number: invoiceNumber,
          url,
        },
      };
    },
  });
};

const OPERATION_TITLES = {
  edit: "تعديل فاتورة",
  return: "مرتجع",
  exchange: "استبدال",
};

const OPERATION_TYPES = {
  edit: "order_edited",
  return: "order_returned",
  exchange: "order_exchanged",
};

const money = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return "0";
  return Number(parsed.toFixed(2)).toLocaleString("en-US");
};

const operationItemsPreview = (items = [], max = 2) => {
  const list = (Array.isArray(items) ? items : []).filter((item) => item && text(item.name));
  if (!list.length) return "";
  const head = list.slice(0, max).map((item) => {
    const quantity = Number(item.quantity || 0);
    const variant = text(item.variant_label);
    const label = variant ? `${text(item.name)} (${variant})` : text(item.name);
    return quantity > 1 ? `${label} ×${quantity}` : label;
  });
  const rest = list.length - head.length;
  return rest > 0 ? `${head.join("، ")} +${rest}` : head.join("، ");
};

// The manager reads the notification, not the portal. So the body carries the whole
// story — what left, what came in, the difference, and whether the till took it —
// because a push that only says "فاتورة اتعدلت" forces a trip into the app to learn
// anything at all.
const buildOperationBody = (operation = {}) => {
  const parts = [];
  const outPreview = operationItemsPreview(operation.items_out);
  const inPreview = operationItemsPreview(operation.items_in);
  if (outPreview) parts.push(`خرج: ${outPreview}`);
  if (inPreview) parts.push(`دخل: ${inPreview}`);
  const difference = Number(operation.difference || 0);
  if (Math.abs(difference) > 0.009) {
    parts.push(difference > 0 ? `فرق مدفوع +${money(difference)}` : `مرتجع ${money(Math.abs(difference))}`);
  }
  const method = text(operation.settlement_method || operation.refund_method);
  if (method) parts.push(method === "cash" ? "كاش" : method);
  if (operation.deferred_amount && Number(operation.deferred_amount) > 0.009) {
    parts.push(`آجل ${money(operation.deferred_amount)}`);
  }
  if (!parts.length) parts.push(`الإجمالي ${money(operation.old_total)} ← ${money(operation.new_total)}`);
  return parts.join(" · ");
};

export const sendManagerOrderOperationPush = async ({
  kind = "edit",
  order = {},
  operationId = null,
  operation = {},
  actorName = "",
} = {}) => {
  const orderId = numberOrNull(order.id || order.order_id);
  const tenantId = numberOrNull(order.tenant_id);
  const branchId = numberOrNull(order.branch_id);
  if (!orderId) return { sent: 0, failed: 0, deactivated: 0, skipped: true };

  const normalizedKind = OPERATION_TITLES[kind] ? kind : "edit";
  const invoiceNumber = text(order.invoice_number || order.public_order_number || orderId);
  const customerName = text(order.customer_name) || "عميل";
  const title = `${OPERATION_TITLES[normalizedKind]} · ${invoiceNumber}`;
  // Size/colour on each line, so a same-product swap reads as what it was.
  await attachOperationVariantLabels([...(operation.items_out || []), ...(operation.items_in || [])]);
  const detail = buildOperationBody(operation);
  const body = `${customerName} — ${detail}`;
  const entityId = text(operationId) || `${normalizedKind}-${orderId}`;

  console.info("[manager-push:order-operation]", {
    tenantId,
    branchId,
    order_id: orderId,
    invoice_number: invoiceNumber,
    kind: normalizedKind,
    operation_id: entityId,
  });

  createNotification({
    tenant_id: tenantId || null,
    role_key: "manager",
    branch_id: branchId || null,
    type: OPERATION_TYPES[normalizedKind],
    category: "sales",
    priority: "high",
    title,
    message: body,
    action_label: "عرض التفاصيل",
    // Keyed on the operation, not the order: two edits to the same invoice inside the
    // dedupe window are two separate events and both have to reach the manager.
    entity_type: "order_operation",
    entity_id: entityId,
    metadata: {
      type: OPERATION_TYPES[normalizedKind],
      operation_kind: normalizedKind,
      operation_id: entityId,
      order_id: orderId,
      invoice_id: orderId,
      invoice_number: invoiceNumber,
      customer_name: customerName,
      actor_name: text(actorName),
      old_total: Number(operation.old_total || 0),
      new_total: Number(operation.new_total || 0),
      difference: Number(operation.difference || 0),
      items_out: Array.isArray(operation.items_out) ? operation.items_out : [],
      items_in: Array.isArray(operation.items_in) ? operation.items_in : [],
      settlement_method: text(operation.settlement_method || operation.refund_method),
      shift_id: numberOrNull(operation.shift_id),
      open_operations: true,
    },
  }).catch((error) => console.warn("[manager-push:operation-notification-failed]", { order_id: orderId, message: error?.message || String(error) }));

  return sendToManagerSubscriptions({
    tenantId,
    branchId,
    category: "sales",
    logLabels: {
      attempt: "[manager-push:operation-send-attempt]",
      success: "[manager-push:operation-send-success]",
      failed: "[manager-push:operation-send-failed]",
    },
    buildPayload: (row) => {
      const url = `/manager-portal/${encodeURIComponent(row.portal_token)}?tab=operations&operation_id=${encodeURIComponent(entityId)}&invoice_id=${encodeURIComponent(String(orderId))}`;
      return {
        title,
        body,
        tag: `manager-operation-${entityId}`,
        data: {
          type: OPERATION_TYPES[normalizedKind],
          operation_kind: normalizedKind,
          operation_id: entityId,
          invoice_id: orderId,
          order_id: orderId,
          invoice_number: invoiceNumber,
          url,
        },
      };
    },
  });
};
