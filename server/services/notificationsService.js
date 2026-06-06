import db from "../database/db.js";
import { io } from "../utils/socket.js";

const PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const DEFAULT_LIMIT = 30;
const DEDUPE_WINDOW_MINUTES = 10;
let notificationsSchemaEnsurePromise = null;
let notificationsSchemaEnsured = false;

const text = (value = "") => String(value ?? "").trim();
const nullableText = (value) => {
  const next = text(value);
  return next || null;
};
const nullableNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const jsonObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export const normalizeNotificationUserContext = (user = {}) => ({
  tenantId: nullableNumber(user.tenant_id ?? user.tenantId),
  userId: nullableNumber(user.id ?? user.user_id),
  roleKey: nullableText(user.role_key ?? user.role ?? user.role_name),
  branchId: nullableNumber(user.branch_id ?? user.branchId),
  isAdmin: ["admin", "super_admin", "super admin", "superadmin", "platform_admin"].includes(
    text(user.role || user.role_name || "").toLowerCase().replace(/_/g, " ")
  ) || user.is_super_admin === true,
});

const runNotificationsSchemaEnsure = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      user_id BIGINT NULL,
      role_key VARCHAR(120) NULL,
      branch_id BIGINT NULL,
      type VARCHAR(120) NOT NULL,
      category VARCHAR(80) NOT NULL DEFAULT 'system',
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      action_url TEXT NULL,
      action_label VARCHAR(160) NULL,
      entity_type VARCHAR(120) NULL,
      entity_id VARCHAR(160) NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT notifications_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical'))
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_branch_id ON notifications (branch_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications (priority)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications (entity_type, entity_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created ON notifications (tenant_id, created_at DESC)`);
};

export const ensureNotificationsSchema = async (clientOrPool = db) => {
  if (notificationsSchemaEnsured) return;

  if (!notificationsSchemaEnsurePromise) {
    notificationsSchemaEnsurePromise = runNotificationsSchemaEnsure(clientOrPool)
      .then(() => {
        notificationsSchemaEnsured = true;
        console.log("[notifications-schema] ensured");
      })
      .catch((error) => {
        notificationsSchemaEnsurePromise = null;
        throw error;
      });
  }

  await notificationsSchemaEnsurePromise;
};

const normalizeNotification = (data = {}) => ({
  tenant_id: nullableNumber(data.tenant_id ?? data.tenantId),
  user_id: nullableNumber(data.user_id ?? data.userId),
  role_key: nullableText(data.role_key ?? data.roleKey),
  branch_id: nullableNumber(data.branch_id ?? data.branchId),
  type: text(data.type || "system"),
  category: text(data.category || "system"),
  priority: PRIORITIES.has(text(data.priority).toLowerCase()) ? text(data.priority).toLowerCase() : "medium",
  title: text(data.title || "Notification"),
  message: text(data.message),
  action_url: nullableText(data.action_url ?? data.actionUrl),
  action_label: nullableText(data.action_label ?? data.actionLabel),
  entity_type: nullableText(data.entity_type ?? data.entityType),
  entity_id: nullableText(data.entity_id ?? data.entityId),
  metadata: jsonObject(data.metadata),
});

const rowToNotification = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  user_id: row.user_id,
  role_key: row.role_key,
  branch_id: row.branch_id,
  type: row.type,
  category: row.category,
  priority: row.priority,
  title: row.title,
  message: row.message,
  action_url: row.action_url,
  action_label: row.action_label,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  metadata: row.metadata || {},
  is_read: Boolean(row.is_read),
  read_at: row.read_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const scopeWhere = (context = {}, params = []) => {
  const clauses = [];
  if (context.tenantId !== null && context.tenantId !== undefined) {
    params.push(context.tenantId);
    clauses.push(`(tenant_id = $${params.length}::bigint OR tenant_id IS NULL)`);
  }

  if (!context.isAdmin) {
    const audience = ["user_id IS NULL AND role_key IS NULL AND branch_id IS NULL"];
    if (context.userId) {
      params.push(context.userId);
      audience.push(`user_id = $${params.length}::bigint`);
    }
    if (context.roleKey) {
      params.push(context.roleKey);
      audience.push(`LOWER(role_key) = LOWER($${params.length})`);
    }
    if (context.branchId) {
      params.push(context.branchId);
      audience.push(`branch_id = $${params.length}::bigint`);
    }
    clauses.push(`(${audience.join(" OR ")})`);
  }

  return clauses;
};

const emitToAudience = (notification) => {
  if (!io || !notification) return;
  const hasTargetAudience = Boolean(notification.user_id || notification.role_key || notification.branch_id || notification.tenant_id);
  const rooms = new Set(hasTargetAudience ? [] : ["notifications:all"]);
  const hasDirectAudience = Boolean(notification.user_id || notification.role_key || notification.branch_id);
  if (notification.tenant_id && !hasDirectAudience) rooms.add(`tenant:${notification.tenant_id}`);
  if (notification.user_id) rooms.add(`user:${notification.user_id}`);
  if (notification.role_key) rooms.add(`role:${String(notification.role_key).toLowerCase()}`);
  if (notification.branch_id) rooms.add(`branch:${notification.branch_id}`);
  const target = [...rooms].reduce((operator, room) => operator.to(room), io);
  target.emit("notification:new", notification);
  target.emit("notification:count:refresh", { at: new Date().toISOString() });
};

const emitCountRefresh = (context = {}, count = null) => {
  if (!io) return;
  const rooms = new Set();
  if (context.userId) rooms.add(`user:${context.userId}`);
  if (context.roleKey) rooms.add(`role:${String(context.roleKey).toLowerCase()}`);
  if (context.branchId) rooms.add(`branch:${context.branchId}`);
  if (context.tenantId !== null && context.tenantId !== undefined) rooms.add(`tenant:${context.tenantId}`);
  if (!rooms.size) rooms.add("notifications:all");
  for (const room of rooms) {
    io.to(room).emit("notification:count", { count: typeof count === "number" ? count : 0 });
    io.to(room).emit("notification:count:refresh", { at: new Date().toISOString() });
  }
};

export const createNotification = async (data = {}) => {
  await ensureNotificationsSchema();
  const notification = normalizeNotification(data);

  if (notification.entity_type && notification.entity_id) {
    const duplicate = await db.query(
      `
      SELECT *
      FROM notifications
      WHERE type = $1
        AND entity_type = $2
        AND entity_id = $3
        AND ($4::bigint IS NULL OR tenant_id = $4::bigint OR tenant_id IS NULL)
        AND created_at >= NOW() - ($5::int * INTERVAL '1 minute')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [notification.type, notification.entity_type, notification.entity_id, notification.tenant_id, DEDUPE_WINDOW_MINUTES]
    );
    if (duplicate.rows[0]) return rowToNotification(duplicate.rows[0]);
  }

  const result = await db.query(
    `
    INSERT INTO notifications (
      tenant_id, user_id, role_key, branch_id, type, category, priority, title, message,
      action_url, action_label, entity_type, entity_id, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
    RETURNING *
    `,
    [
      notification.tenant_id,
      notification.user_id,
      notification.role_key,
      notification.branch_id,
      notification.type,
      notification.category,
      notification.priority,
      notification.title,
      notification.message,
      notification.action_url,
      notification.action_label,
      notification.entity_type,
      notification.entity_id,
      JSON.stringify(notification.metadata),
    ]
  );
  const created = rowToNotification(result.rows[0]);
  emitToAudience(created);
  return created;
};

export const listNotifications = async (filters = {}) => {
  await ensureNotificationsSchema();
  const params = [];
  const context = normalizeNotificationUserContext(filters.user || filters.context || {});
  const clauses = scopeWhere(context, params);

  for (const [key, column] of [
    ["category", "category"],
    ["priority", "priority"],
    ["type", "type"],
  ]) {
    if (!filters[key]) continue;
    params.push(text(filters[key]));
    clauses.push(`${column} = $${params.length}`);
  }
  if (filters.unread === true || filters.is_read === false) clauses.push("is_read = FALSE");
  if (filters.important === true) clauses.push("priority IN ('high', 'critical')");
  if (filters.search) {
    params.push(`%${text(filters.search).toLowerCase()}%`);
    clauses.push(`LOWER(CONCAT_WS(' ', title, message, category, type, entity_type, entity_id)) LIKE $${params.length}`);
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    clauses.push(`created_at >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    clauses.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const limit = Math.min(Math.max(Number(filters.limit || DEFAULT_LIMIT), 1), 100);
  const offset = Math.max(Number(filters.offset || 0), 0);
  params.push(limit, offset);
  const result = await db.query(
    `
    SELECT *
    FROM notifications
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return result.rows.map(rowToNotification);
};

export const getUnreadCount = async (userOrContext = {}) => {
  await ensureNotificationsSchema();
  const params = [];
  const context = normalizeNotificationUserContext(userOrContext);
  const clauses = [...scopeWhere(context, params), "is_read = FALSE"];
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE ${clauses.join(" AND ")}`,
    params
  );
  return Number(result.rows[0]?.count || 0);
};

export const markAsRead = async (id, userOrContext = {}) => {
  await ensureNotificationsSchema();
  const params = [id];
  const context = normalizeNotificationUserContext(userOrContext);
  const clauses = [`id = $1`];
  clauses.push(...scopeWhere(context, params));
  const result = await db.query(
    `
    UPDATE notifications
    SET is_read = TRUE, read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE ${clauses.join(" AND ")}
    RETURNING *
    `,
    params
  );
  if (result.rows[0]) {
    const count = await getUnreadCount(userOrContext);
    emitCountRefresh(context, count);
  }
  return result.rows[0] ? rowToNotification(result.rows[0]) : null;
};

export const markAllAsRead = async (userOrContext = {}) => {
  await ensureNotificationsSchema();
  const params = [];
  const context = normalizeNotificationUserContext(userOrContext);
  const clauses = [...scopeWhere(context, params), "is_read = FALSE"];
  const result = await db.query(
    `
    UPDATE notifications
    SET is_read = TRUE, read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE ${clauses.join(" AND ")}
    RETURNING id
    `,
    params
  );
  emitCountRefresh(context, 0);
  return result.rowCount || 0;
};

export const deleteNotification = async (id, userOrContext = {}) => {
  await ensureNotificationsSchema();
  const params = [id];
  const context = normalizeNotificationUserContext(userOrContext);
  const clauses = [`id = $1`];
  clauses.push(...scopeWhere(context, params));
  const result = await db.query(`DELETE FROM notifications WHERE ${clauses.join(" AND ")} RETURNING id`, params);
  return result.rowCount > 0;
};

export const createSystemNotification = async (type, payload = {}) => {
  const managerAudienceTypes = new Set([
    "website_order_created",
    "payment_proof_uploaded",
    "low_stock",
    "purchase_confirmed",
    "security_sensitive_action",
  ]);
  const presets = {
    website_order_created: {
      category: "orders",
      priority: "high",
      title: "طلب جديد من الويب سايت",
      action_label: "فتح الطلب",
    },
    payment_proof_uploaded: {
      category: "payments",
      priority: "critical",
      title: "تحويل جديد يحتاج مراجعة",
      action_label: "مراجعة الدفع",
    },
    low_stock: {
      category: "inventory",
      priority: "high",
      title: "مخزون منخفض",
      action_label: "فتح المخزون",
    },
    purchase_confirmed: {
      category: "purchases",
      priority: "medium",
      title: "تم تأكيد فاتورة شراء",
      action_label: "فتح المشتريات",
    },
    security_sensitive_action: {
      category: "security",
      priority: "critical",
      title: "تعديل حساس يحتاج مراجعة",
      action_label: "مراجعة",
    },
  };
  const preset = presets[type] || {};
  return createNotification({
    type,
    category: preset.category || "system",
    priority: preset.priority || "medium",
    title: preset.title || "System notification",
    action_label: preset.action_label || null,
    role_key: payload.role_key || (managerAudienceTypes.has(type) ? "manager" : null),
    ...payload,
    metadata: {
      ...(payload.metadata || {}),
      customer_notification_ready: Boolean(payload.customer_notification_ready),
    },
  });
};
