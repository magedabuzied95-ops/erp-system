import db from "../database/db.js";
import { ensureEmployeePayrollPortalSchema } from "./employeePayrollPortalService.js";
import { sendEmployeePortalPush } from "./employeePortalPushService.js";
import { createNotification } from "./notificationsService.js";
import { sendManagerEmployeeChatPush } from "./managerPortalPushService.js";
import { emitToRooms, getRoomClientCount } from "../utils/socket.js";

const clean = (value = "") => String(value || "").trim();

const chatError = (message, status = 400, code = "") => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const messageSelect = `
  SELECT
    m.id,
    m.thread_id,
    m.sender_type,
    m.sender_employee_id,
    m.sender_user_id,
    m.body,
    m.attachment_url,
    m.attachment_type,
    m.attachment_name,
    m.attachment_size,
    m.attachment_mime,
    m.attachment_duration_seconds,
    m.attachment_duration_seconds AS duration,
    m.reply_to_message_id,
    rm.sender_type AS reply_sender_type,
    rm.body AS reply_body,
    rm.attachment_type AS reply_attachment_type,
    rm.attachment_name AS reply_attachment_name,
    m.read_at,
    m.edited_at,
    m.deleted_at,
    m.created_at
  FROM employee_chat_messages m
  LEFT JOIN employee_chat_messages rm ON rm.id = m.reply_to_message_id
`;

const attachmentLabelSql = (alias = "m") => `
  CASE
    WHEN NULLIF(TRIM(${alias}.body), '') IS NOT NULL THEN ${alias}.body
    WHEN ${alias}.attachment_type = 'image' THEN 'صورة'
    WHEN ${alias}.attachment_type = 'audio' THEN 'رسالة صوتية'
    WHEN ${alias}.attachment_type = 'video' THEN 'فيديو'
    WHEN ${alias}.attachment_url IS NOT NULL THEN 'ملف'
    ELSE ''
  END
`;

const adminChatRoom = (tenantId = null) => `employee-chat:tenant:${tenantId || "global"}`;
const employeeChatRoom = (employeeId) => `employee-chat:employee:${employeeId}`;
const employeeActiveChatRoom = (employeeId) => `employee-chat-active:employee:${employeeId}`;
const EMPLOYEE_CHAT_PUSH_TITLE = "\u0631\u0633\u0627\u0644\u0629 \u062c\u062f\u064a\u062f\u0629";
const EMPLOYEE_CHAT_PUSH_FALLBACK_BODY = "\u0644\u062f\u064a\u0643 \u0631\u0633\u0627\u0644\u0629 \u062c\u062f\u064a\u062f\u0629 \u0645\u0646 \u0627\u0644\u0625\u062f\u0627\u0631\u0629";

const chatPushPreview = (message = {}) => {
  const body = clean(message.body);
  if (body) {
    const shortText = body.length > 80 ? `${body.slice(0, 77)}...` : body;
    return `رسالة جديدة: ${shortText}`;
  }
  if (message.attachment_type === "image") return "تم إرسال صورة";
  if (message.attachment_type === "video") return "تم إرسال فيديو";
  if (message.attachment_url) return "تم إرسال ملف";
  return "لديك رسالة جديدة في تطبيق الموظف";
};

const employeeChatPushBody = (message = {}) => {
  const body = clean(message.body);
  if (body) return `رسالة جديدة: ${body.length > 80 ? `${body.slice(0, 77)}...` : body}`;
  if (message.attachment_type === "image") return "تم إرسال صورة";
  if (message.attachment_type === "audio") return "تم إرسال رسالة صوتية";
  if (message.attachment_type === "video") return "تم إرسال فيديو";
  if (message.attachment_url) return "تم إرسال ملف";
  return "لديك رسالة جديدة في تطبيق الموظف";
};

const employeeChatMessagePreview = (message = {}) => {
  const body = clean(message.body);
  if (body) return body.length > 80 ? `${body.slice(0, 77)}...` : body;
  if (message.attachment_type === "image") return "\u0635\u0648\u0631\u0629";
  if (message.attachment_type === "audio") return "\u0631\u0633\u0627\u0644\u0629 \u0635\u0648\u062a\u064a\u0629";
  if (message.attachment_type === "video") return "\u0641\u064a\u062f\u064a\u0648";
  if (message.attachment_url) return "\u0645\u0644\u0641";
  return "";
};

const employeeManagementPushBody = (message = {}, senderName = "") => {
  const safeSenderName = clean(senderName);
  const preview = employeeChatMessagePreview(message);
  if (!safeSenderName || !preview) return EMPLOYEE_CHAT_PUSH_FALLBACK_BODY;
  return `${safeSenderName}: ${preview}`;
};

const loadAdminSenderName = async ({ userId = null, tenantId = null } = {}) => {
  if (!userId) return "";
  const result = await db.query(
    `
    SELECT name
    FROM users
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    LIMIT 1
    `,
    [userId, tenantId]
  );
  return clean(result.rows[0]?.name);
};

const loadThreadSummary = async (threadId, clientOrPool = db) => {
  const result = await clientOrPool.query(
    `
    SELECT
      t.id,
      t.tenant_id,
      t.employee_id,
      t.branch_id,
      t.status,
      t.last_message_at,
      t.created_at,
      t.updated_at,
      e.full_name AS employee_name,
      e.employee_code,
      b.name AS branch_name,
      lm.last_message,
      lm.sender_type AS last_sender_type,
      lm.created_at AS last_message_created_at,
      COALESCE(unread.unread_count, 0)::int AS unread_count
    FROM employee_chat_threads t
    JOIN employees e ON e.id = t.employee_id
    LEFT JOIN branches b ON b.id = t.branch_id
    LEFT JOIN LATERAL (
      SELECT ${attachmentLabelSql("m")} AS last_message, sender_type, created_at
      FROM employee_chat_messages m
      WHERE m.thread_id = t.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) lm ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS unread_count
      FROM employee_chat_messages m
      WHERE m.thread_id = t.id AND m.sender_type = 'employee' AND m.read_at IS NULL
    ) unread ON TRUE
    WHERE t.id = $1
    LIMIT 1
    `,
    [threadId]
  );
  return result.rows[0] || null;
};

const emitChatEvent = (rooms = [], eventName, payload = {}) => {
  emitToRooms(rooms, eventName, {
    ...payload,
    at: new Date().toISOString(),
  });
};

const parseAttachmentDuration = (value = null) => {
  const duration = Number(value || 0);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.min(Math.max(duration, 1), 24 * 60 * 60);
};

const attachmentFromUpload = (file = null, attachmentDurationSeconds = null) => {
  if (!file) return null;
  const mimetype = String(file.mimetype || "");
  const attachmentType = mimetype.startsWith("image/")
    ? "image"
    : mimetype.startsWith("audio/")
      ? "audio"
      : mimetype.startsWith("video/")
        ? "video"
        : "file";
  return {
    attachment_url: `/uploads/employee-chat/${file.filename}`,
    attachment_type: attachmentType,
    attachment_name: file.originalname || file.filename,
    attachment_size: Number(file.size || 0),
    attachment_mime: file.mimetype || "",
    attachment_duration_seconds: attachmentType === "audio" ? parseAttachmentDuration(attachmentDurationSeconds) : null,
  };
};

const normalizeReplyId = (value = null) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
};

const validateMessageInput = ({ body = "", attachment = null } = {}) => {
  const text = clean(body);
  if (!text && !attachment) throw chatError("Message or attachment is required", 400, "message_required");
  if (text.length > 4000) throw chatError("Message is too long", 400, "message_too_long");
  return text;
};

export const getOrCreateEmployeeChatThread = async (employee, clientOrPool = db) => {
  await ensureEmployeePayrollPortalSchema(clientOrPool);
  if (!employee?.id) throw chatError("Employee is required", 400, "employee_required");
  const existing = await clientOrPool.query(
    `
    SELECT t.*
    FROM employee_chat_threads t
    WHERE t.employee_id = $1
    LIMIT 1
    `,
    [employee.id]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await clientOrPool.query(
    `
    INSERT INTO employee_chat_threads (tenant_id, employee_id, branch_id, status, created_at, updated_at)
    VALUES ($1, $2, $3, 'open', NOW(), NOW())
    RETURNING *
    `,
    [employee.tenant_id || null, employee.id, employee.branch_id || null]
  );
  return created.rows[0];
};

const loadMessages = async (threadId, clientOrPool = db) => {
  const result = await clientOrPool.query(
    `
    ${messageSelect}
    WHERE m.thread_id = $1
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 300
    `,
    [threadId]
  );
  return result.rows;
};

export const getEmployeeChat = async ({ employee } = {}) => {
  const thread = await getOrCreateEmployeeChatThread(employee);
  const readResult = await db.query(
    `
    UPDATE employee_chat_messages
    SET read_at = COALESCE(read_at, NOW())
    WHERE thread_id = $1 AND sender_type = 'admin' AND read_at IS NULL
    RETURNING id
    `,
    [thread.id]
  );
  if (readResult.rowCount > 0) {
    emitChatEvent([adminChatRoom(employee.tenant_id)], "employee-chat:read", {
      thread_id: thread.id,
      employee_id: employee.id,
      reader_type: "employee",
      read_sender_type: "admin",
      read_count: readResult.rowCount,
    });
  }
  const messages = await loadMessages(thread.id);
  return { thread, messages };
};

export const sendEmployeeChatMessage = async ({ employee, body = "", file = null, replyToMessageId = null, attachmentDurationSeconds = null } = {}) => {
  const attachment = attachmentFromUpload(file, attachmentDurationSeconds);
  const text = validateMessageInput({ body, attachment });
  const thread = await getOrCreateEmployeeChatThread(employee);
  const replyTo = normalizeReplyId(replyToMessageId);
  const result = await db.query(
    `
    INSERT INTO employee_chat_messages (
      thread_id, sender_type, sender_employee_id, sender_user_id, body,
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_mime, attachment_duration_seconds,
      reply_to_message_id, read_at, created_at
    )
    VALUES ($1, 'employee', $2, NULL, $3, $4, $5, $6, $7, $8, $9,
      (SELECT id FROM employee_chat_messages WHERE id = $10 AND thread_id = $1),
      NULL, NOW())
    RETURNING *
    `,
    [
      thread.id,
      employee.id,
      text,
      attachment?.attachment_url || null,
      attachment?.attachment_type || null,
      attachment?.attachment_name || null,
      attachment?.attachment_size || null,
      attachment?.attachment_mime || null,
      attachment?.attachment_duration_seconds || null,
      replyTo,
    ]
  );
  await db.query(
    `
    UPDATE employee_chat_threads
    SET last_message_at = NOW(), updated_at = NOW(), branch_id = COALESCE($2, branch_id), tenant_id = COALESCE($3, tenant_id)
    WHERE id = $1
    `,
    [thread.id, employee.branch_id || null, employee.tenant_id || null]
  );
  const updatedThread = await loadThreadSummary(thread.id);
  const message = (await loadMessages(thread.id)).find((item) => String(item.id) === String(result.rows[0]?.id)) || result.rows[0];
  console.info("[manager-push:chat-trigger-entered]", {
    employee_id: employee.id,
    thread_id: thread.id,
    sender_type: "employee",
    message_id: message.id || result.rows[0]?.id || null,
    attachment_type: message.attachment_type || null,
  });
  emitChatEvent([adminChatRoom(employee.tenant_id), employeeChatRoom(employee.id)], "employee-chat:new-message", {
    thread: updatedThread,
    message,
  });
  emitChatEvent([adminChatRoom(employee.tenant_id)], "employee-chat:thread-updated", {
    thread: updatedThread,
  });
  await createNotification({
    tenant_id: employee.tenant_id || null,
    role_key: "manager",
    branch_id: employee.branch_id || null,
    type: "employee_chat_message",
    category: "employees",
    priority: "medium",
    title: "رسالة جديدة من موظف",
    message: chatPushPreview(message),
    action_url: "/employees/chat",
    action_label: "فتح شات الموظفين",
    entity_type: "employee_chat_thread",
    entity_id: String(thread.id),
    metadata: { employee_id: employee.id, thread_id: thread.id, message_id: message.id },
  }).catch(() => null);
  sendManagerEmployeeChatPush({
    tenantId: employee.tenant_id || null,
    branchId: employee.branch_id || null,
    employee,
    employeeId: employee.id,
    employeeName: employee.full_name || employee.employee_name || employee.employee_code || "",
    threadId: thread.id,
    message,
  }).catch((error) => console.warn("[manager-push:chat-message] failed", {
    employee_id: employee.id,
    thread_id: thread.id,
    message: error?.message || String(error),
  }));
  return { thread: updatedThread || { ...thread, last_message_at: message.created_at }, message };
};

const loadMessageForMutation = async ({ messageId, threadId = null, employeeId = null, tenantId = null, senderType } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    SELECT m.*, t.employee_id, t.tenant_id
    FROM employee_chat_messages m
    JOIN employee_chat_threads t ON t.id = m.thread_id
    WHERE m.id = $1
      AND ($2::bigint IS NULL OR m.thread_id = $2::bigint)
      AND ($3::bigint IS NULL OR t.employee_id = $3::bigint)
      AND ($4::bigint IS NULL OR t.tenant_id = $4::bigint)
      AND m.sender_type = $5
    LIMIT 1
    `,
    [messageId, threadId, employeeId, tenantId, senderType]
  );
  const message = result.rows[0];
  if (!message) throw chatError("Message not found", 404, "message_not_found");
  if (message.deleted_at) throw chatError("Message was deleted", 409, "message_deleted");
  return message;
};

const emitMessageMutation = async (message, eventName) => {
  const thread = await loadThreadSummary(message.thread_id);
  emitChatEvent([employeeChatRoom(message.employee_id), adminChatRoom(message.tenant_id)], eventName, {
    thread,
    thread_id: message.thread_id,
    employee_id: message.employee_id,
    message,
  });
  emitChatEvent([adminChatRoom(message.tenant_id)], "employee-chat:thread-updated", { thread });
  return { thread, message };
};

const mutateChatMessage = async ({ message, body, remove = false } = {}) => {
  const normalizedBody = clean(body);
  if (!remove && !normalizedBody) throw chatError("Message text is required", 400, "message_required");
  if (!remove && normalizedBody.length > 4000) throw chatError("Message is too long", 400, "message_too_long");
  const result = await db.query(
    remove
      ? `UPDATE employee_chat_messages
         SET body = '', attachment_url = NULL, attachment_type = NULL, attachment_name = NULL,
             attachment_size = NULL, attachment_mime = NULL, attachment_duration_seconds = NULL,
             deleted_at = NOW(), edited_at = NULL
         WHERE id = $1 RETURNING *`
      : `UPDATE employee_chat_messages SET body = $2, edited_at = NOW() WHERE id = $1 RETURNING *`,
    remove ? [message.id] : [message.id, normalizedBody]
  );
  return { ...result.rows[0], employee_id: message.employee_id, tenant_id: message.tenant_id };
};

export const updateEmployeeChatMessage = async ({ employee, messageId, body } = {}) => {
  const current = await loadMessageForMutation({ messageId, employeeId: employee?.id, senderType: "employee" });
  const message = await mutateChatMessage({ message: current, body });
  return emitMessageMutation(message, "employee-chat:message-updated");
};

export const deleteEmployeeChatMessage = async ({ employee, messageId } = {}) => {
  const current = await loadMessageForMutation({ messageId, employeeId: employee?.id, senderType: "employee" });
  const message = await mutateChatMessage({ message: current, remove: true });
  return emitMessageMutation(message, "employee-chat:message-deleted");
};

export const updateAdminEmployeeChatMessage = async ({ tenantId = null, threadId, messageId, body } = {}) => {
  const current = await loadMessageForMutation({ messageId, threadId, tenantId, senderType: "admin" });
  const message = await mutateChatMessage({ message: current, body });
  return emitMessageMutation(message, "employee-chat:message-updated");
};

export const deleteAdminEmployeeChatMessage = async ({ tenantId = null, threadId, messageId } = {}) => {
  const current = await loadMessageForMutation({ messageId, threadId, tenantId, senderType: "admin" });
  const message = await mutateChatMessage({ message: current, remove: true });
  return emitMessageMutation(message, "employee-chat:message-deleted");
};

export const listEmployeeChatThreads = async ({ tenantId = null, limit = 200 } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const safeLimit = Math.min(Math.max(Number(limit || 200), 1), 500);
  const result = await db.query(
    `
    SELECT
      t.id,
      t.tenant_id,
      t.employee_id,
      t.branch_id,
      t.status,
      t.last_message_at,
      t.created_at,
      t.updated_at,
      e.full_name AS employee_name,
      e.employee_code,
      b.name AS branch_name,
      lm.last_message,
      lm.sender_type AS last_sender_type,
      lm.created_at AS last_message_created_at,
      COALESCE(unread.unread_count, 0)::int AS unread_count
    FROM employee_chat_threads t
    JOIN employees e ON e.id = t.employee_id
    LEFT JOIN branches b ON b.id = t.branch_id
    LEFT JOIN LATERAL (
      SELECT ${attachmentLabelSql("m")} AS last_message, sender_type, created_at
      FROM employee_chat_messages m
      WHERE m.thread_id = t.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) lm ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS unread_count
      FROM employee_chat_messages m
      WHERE m.thread_id = t.id AND m.sender_type = 'employee' AND m.read_at IS NULL
    ) unread ON TRUE
    WHERE ($1::bigint IS NULL OR t.tenant_id = $1::bigint)
      AND COALESCE(e.is_deleted, FALSE) = FALSE
    ORDER BY COALESCE(t.last_message_at, t.updated_at, t.created_at) DESC, t.id DESC
    LIMIT $2
    `,
    [tenantId, safeLimit]
  );
  return result.rows;
};

export const getAdminEmployeeChatThread = async ({ tenantId = null, threadId, markRead = true } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const threadResult = await db.query(
    `
    SELECT
      t.*,
      e.full_name AS employee_name,
      e.employee_code,
      e.tenant_id AS employee_tenant_id,
      e.employee_portal_token,
      b.name AS branch_name
    FROM employee_chat_threads t
    JOIN employees e ON e.id = t.employee_id
    LEFT JOIN branches b ON b.id = t.branch_id
    WHERE t.id = $1
      AND ($2::bigint IS NULL OR t.tenant_id = $2::bigint)
      AND COALESCE(e.is_deleted, FALSE) = FALSE
    LIMIT 1
    `,
    [threadId, tenantId]
  );
  const thread = threadResult.rows[0];
  if (!thread) throw chatError("Thread not found", 404, "thread_not_found");

  if (markRead) {
    const readResult = await db.query(
      `
      UPDATE employee_chat_messages
      SET read_at = COALESCE(read_at, NOW())
      WHERE thread_id = $1 AND sender_type = 'employee' AND read_at IS NULL
      RETURNING id
      `,
      [thread.id]
    );
    if (readResult.rowCount > 0) {
      emitChatEvent([employeeChatRoom(thread.employee_id), adminChatRoom(thread.tenant_id)], "employee-chat:read", {
        thread_id: thread.id,
        employee_id: thread.employee_id,
        reader_type: "admin",
        read_sender_type: "employee",
        read_count: readResult.rowCount,
      });
    }
  }

  const messages = await loadMessages(thread.id);
  return { thread, messages };
};

export const sendAdminEmployeeChatMessage = async ({ tenantId = null, threadId, userId = null, body = "", file = null, attachmentOverride = null, replyToMessageId = null, attachmentDurationSeconds = null } = {}) => {
  const attachment = attachmentOverride || attachmentFromUpload(file, attachmentDurationSeconds);
  const text = validateMessageInput({ body, attachment });
  const { thread } = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: true });
  const replyTo = normalizeReplyId(replyToMessageId);
  const result = await db.query(
    `
    INSERT INTO employee_chat_messages (
      thread_id, sender_type, sender_employee_id, sender_user_id, body,
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_mime, attachment_duration_seconds,
      reply_to_message_id, read_at, created_at
    )
    VALUES ($1, 'admin', NULL, $2, $3, $4, $5, $6, $7, $8, $9,
      (SELECT id FROM employee_chat_messages WHERE id = $10 AND thread_id = $1),
      NULL, NOW())
    RETURNING *
    `,
    [
      thread.id,
      userId,
      text,
      attachment?.attachment_url || null,
      attachment?.attachment_type || null,
      attachment?.attachment_name || null,
      attachment?.attachment_size || null,
      attachment?.attachment_mime || null,
      attachment?.attachment_duration_seconds || null,
      replyTo,
    ]
  );
  await db.query(
    `
    UPDATE employee_chat_threads
    SET last_message_at = NOW(), updated_at = NOW()
    WHERE id = $1
    `,
    [thread.id]
  );
  const updatedThread = await loadThreadSummary(thread.id);
  const message = (await loadMessages(thread.id)).find((item) => String(item.id) === String(result.rows[0]?.id)) || result.rows[0];
  emitChatEvent([employeeChatRoom(thread.employee_id), adminChatRoom(thread.tenant_id)], "employee-chat:new-message", {
    thread: updatedThread,
    message,
  });
  emitChatEvent([adminChatRoom(thread.tenant_id)], "employee-chat:thread-updated", {
    thread: updatedThread,
  });
  const activeEmployeeChatClients = await getRoomClientCount(employeeActiveChatRoom(thread.employee_id));
  const employeeChatIsActive = activeEmployeeChatClients > 0;
  const notificationTenantId = thread.tenant_id || thread.employee_tenant_id || tenantId || null;
  const senderName = await loadAdminSenderName({ userId, tenantId: notificationTenantId });
  await sendEmployeePortalPush({
    tenantId: notificationTenantId,
    employeeId: thread.employee_id,
    title: EMPLOYEE_CHAT_PUSH_TITLE,
    body: employeeManagementPushBody(message, senderName),
    url: thread.employee_portal_token ? `/employee-app/${encodeURIComponent(thread.employee_portal_token)}?tab=chat` : "/employee-app/?tab=chat",
    tag: "employee-chat",
    data: {
      event: "employee_chat_message",
      thread_id: thread.id,
      message_id: message.id,
      tab: "chat",
    },
    persist: true,
    deliverPush: !employeeChatIsActive,
    markPersistedRead: employeeChatIsActive,
  }).catch((error) => console.warn("[employee-chat] notification skipped", error?.message || error));
  return { thread: updatedThread || thread, message };
};

export const forwardAdminEmployeeChatMessage = async ({ tenantId = null, sourceMessageId, targetThreadId, userId = null } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const sourceResult = await db.query(
    `SELECT m.*
     FROM employee_chat_messages m
     JOIN employee_chat_threads t ON t.id = m.thread_id
     WHERE m.id = $1
       AND ($2::bigint IS NULL OR t.tenant_id = $2::bigint)
       AND m.deleted_at IS NULL
     LIMIT 1`,
    [sourceMessageId, tenantId]
  );
  const source = sourceResult.rows[0];
  if (!source) throw chatError("Message not found", 404, "message_not_found");
  const forwardedLabel = "↪ مُعاد توجيهها";
  const body = source.body ? `${forwardedLabel}\n${source.body}` : forwardedLabel;
  return sendAdminEmployeeChatMessage({
    tenantId,
    threadId: targetThreadId,
    userId,
    body,
    attachmentOverride: source.attachment_url ? {
      attachment_url: source.attachment_url,
      attachment_type: source.attachment_type,
      attachment_name: source.attachment_name,
      attachment_size: source.attachment_size,
      attachment_mime: source.attachment_mime,
      attachment_duration_seconds: source.attachment_duration_seconds,
    } : null,
  });
};

export const markAdminEmployeeChatThreadRead = async ({ tenantId = null, threadId } = {}) => {
  const { thread } = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: false });
  const readResult = await db.query(
    `
    UPDATE employee_chat_messages
    SET read_at = COALESCE(read_at, NOW())
    WHERE thread_id = $1 AND sender_type = 'employee' AND read_at IS NULL
    RETURNING id
    `,
    [thread.id]
  );
  if (readResult.rowCount > 0) {
    emitChatEvent([employeeChatRoom(thread.employee_id), adminChatRoom(thread.tenant_id)], "employee-chat:read", {
      thread_id: thread.id,
      employee_id: thread.employee_id,
      reader_type: "admin",
      read_sender_type: "employee",
      read_count: readResult.rowCount,
    });
  }
  return { thread };
};
