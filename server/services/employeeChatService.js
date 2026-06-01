import db from "../database/db.js";
import { ensureEmployeePayrollPortalSchema } from "./employeePayrollPortalService.js";
import { emitToRooms } from "../utils/socket.js";

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
    m.read_at,
    m.created_at
  FROM employee_chat_messages m
`;

const attachmentLabelSql = (alias = "m") => `
  CASE
    WHEN NULLIF(TRIM(${alias}.body), '') IS NOT NULL THEN ${alias}.body
    WHEN ${alias}.attachment_type = 'image' THEN 'صورة'
    WHEN ${alias}.attachment_url IS NOT NULL THEN 'ملف'
    ELSE ''
  END
`;

const adminChatRoom = (tenantId = null) => `employee-chat:tenant:${tenantId || "global"}`;
const employeeChatRoom = (employeeId) => `employee-chat:employee:${employeeId}`;

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

const attachmentFromUpload = (file = null) => {
  if (!file) return null;
  return {
    attachment_url: `/uploads/employee-chat/${file.filename}`,
    attachment_type: String(file.mimetype || "").startsWith("image/") ? "image" : "file",
    attachment_name: file.originalname || file.filename,
    attachment_size: Number(file.size || 0),
    attachment_mime: file.mimetype || "",
  };
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

export const sendEmployeeChatMessage = async ({ employee, body = "", file = null } = {}) => {
  const attachment = attachmentFromUpload(file);
  const text = validateMessageInput({ body, attachment });
  const thread = await getOrCreateEmployeeChatThread(employee);
  const result = await db.query(
    `
    INSERT INTO employee_chat_messages (
      thread_id, sender_type, sender_employee_id, sender_user_id, body,
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_mime,
      read_at, created_at
    )
    VALUES ($1, 'employee', $2, NULL, $3, $4, $5, $6, $7, $8, NULL, NOW())
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
  const message = result.rows[0];
  emitChatEvent([adminChatRoom(employee.tenant_id), employeeChatRoom(employee.id)], "employee-chat:new-message", {
    thread: updatedThread,
    message,
  });
  emitChatEvent([adminChatRoom(employee.tenant_id)], "employee-chat:thread-updated", {
    thread: updatedThread,
  });
  return { thread: updatedThread || { ...thread, last_message_at: message.created_at }, message };
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

export const sendAdminEmployeeChatMessage = async ({ tenantId = null, threadId, userId = null, body = "", file = null } = {}) => {
  const attachment = attachmentFromUpload(file);
  const text = validateMessageInput({ body, attachment });
  const { thread } = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: true });
  const result = await db.query(
    `
    INSERT INTO employee_chat_messages (
      thread_id, sender_type, sender_employee_id, sender_user_id, body,
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_mime,
      read_at, created_at
    )
    VALUES ($1, 'admin', NULL, $2, $3, $4, $5, $6, $7, $8, NULL, NOW())
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
  const message = result.rows[0];
  emitChatEvent([employeeChatRoom(thread.employee_id), adminChatRoom(thread.tenant_id)], "employee-chat:new-message", {
    thread: updatedThread,
    message,
  });
  emitChatEvent([adminChatRoom(thread.tenant_id)], "employee-chat:thread-updated", {
    thread: updatedThread,
  });
  return { thread: updatedThread || thread, message };
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
