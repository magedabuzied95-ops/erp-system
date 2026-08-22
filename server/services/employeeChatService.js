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
    m.sender_name,
    m.message_kind,
    m.ring_answered_at,
    m.ring_answered_by,
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
    m.delivered_at,
    m.edited_at,
    m.deleted_at,
    m.created_at,
    m.client_id,
    COALESCE(rx.reactions, '[]'::json) AS reactions
  FROM employee_chat_messages m
  LEFT JOIN employee_chat_messages rm ON rm.id = m.reply_to_message_id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'actor_type', r.actor_type,
      'actor_id', r.actor_id,
      'emoji', r.emoji,
      'created_at', r.created_at
    ) ORDER BY r.created_at ASC) AS reactions
    FROM employee_chat_message_reactions r
    WHERE r.message_id = m.id
  ) rx ON TRUE
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
/*
 * Branch POS channel ("كاشير فرع X"): a thread whose cashier side is whichever
 * POS device is on that branch, not an employee. Its realtime room is keyed by
 * branch, and the admin UIs see it through a synthetic, non-numeric
 * employee_id so the shared chat groups and selects it like any other row.
 */
export const BRANCH_POS_CHANNEL = "branch_pos";
export const branchPosChatRoom = (branchId) => `employee-chat:branch-pos:${branchId}`;
export const branchPosChannelKey = (branchId) => `pos-branch-${branchId}`;
export const parseBranchPosChannelKey = (value = "") => {
  const match = /^pos-branch-(\d+)$/.exec(String(value || "").trim());
  return match ? Number(match[1]) : null;
};
const isBranchPosThread = (thread = {}) => String(thread?.channel_type || "") === BRANCH_POS_CHANNEL;
const threadChannelEmployeeId = (thread = {}) =>
  isBranchPosThread(thread) ? branchPosChannelKey(thread.branch_id) : thread?.employee_id ?? null;
const threadCashierRooms = (thread = {}) =>
  isBranchPosThread(thread) ? [branchPosChatRoom(thread.branch_id)] : thread?.employee_id ? [employeeChatRoom(thread.employee_id)] : [];
const BRANCH_POS_NAME_PREFIX = "كاشير فرع ";
const threadIdentitySql = `
      t.channel_type,
      CASE WHEN t.channel_type = '${BRANCH_POS_CHANNEL}' THEN 'pos-branch-' || t.branch_id::text ELSE t.employee_id::text END AS employee_id,
      CASE WHEN t.channel_type = '${BRANCH_POS_CHANNEL}' THEN '${BRANCH_POS_NAME_PREFIX}' || COALESCE(b.name, t.branch_id::text) ELSE e.full_name END AS employee_name,
      CASE WHEN t.channel_type = '${BRANCH_POS_CHANNEL}' THEN 'POS' ELSE e.employee_code END AS employee_code`;
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
      t.branch_id,
      t.status,
      t.last_message_at,
      t.created_at,
      t.updated_at,${threadIdentitySql},
      COALESCE(e.photo_url, '') AS photo_url,
      b.name AS branch_name,
      lm.last_message,
      lm.sender_type AS last_sender_type,
      lm.created_at AS last_message_created_at,
      COALESCE(unread.unread_count, 0)::int AS unread_count
    FROM employee_chat_threads t
    LEFT JOIN employees e ON e.id = t.employee_id
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

export const DEFAULT_MESSAGE_PAGE = 60;
const MAX_MESSAGE_PAGE = 200;
const normalizePageLimit = (value) => Math.min(Math.max(Number(value) || DEFAULT_MESSAGE_PAGE, 1), MAX_MESSAGE_PAGE);
const normalizeCursor = (value) => {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
};

/*
 * Cursor pagination, newest page first: the newest `limit` rows (or the `limit`
 * rows before `beforeId`), returned in ascending order for rendering, plus
 * whether anything older exists. Opening a thread used to pull 300 rows with
 * the reaction and reply joins for every one of them.
 */
const loadMessagePage = async (threadId, { beforeId = null, limit = DEFAULT_MESSAGE_PAGE } = {}, clientOrPool = db) => {
  const safeLimit = normalizePageLimit(limit);
  const cursor = normalizeCursor(beforeId);
  const result = await clientOrPool.query(
    `
    ${messageSelect}
    WHERE m.thread_id = $1
      AND ($2::bigint IS NULL OR m.id < $2::bigint)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT $3
    `,
    [threadId, cursor, safeLimit + 1]
  );
  const hasMore = result.rows.length > safeLimit;
  const rows = (hasMore ? result.rows.slice(0, safeLimit) : result.rows).reverse();
  return { messages: rows, hasMore };
};

const loadMessages = async (threadId, clientOrPool = db) => (await loadMessagePage(threadId, {}, clientOrPool)).messages;

const loadMessage = async (messageId, clientOrPool = db) => {
  const result = await clientOrPool.query(`${messageSelect} WHERE m.id = $1 LIMIT 1`, [messageId]);
  return result.rows[0] || null;
};

const normalizeClientId = (value = null) => {
  const id = clean(value).slice(0, 64);
  return /^[A-Za-z0-9_.:-]+$/.test(id) ? id : null;
};

// A retried send with the same client_id returns the row the first attempt created.
const findMessageByClientId = async (threadId, clientId) => {
  if (!clientId) return null;
  const result = await db.query(`SELECT id FROM employee_chat_messages WHERE thread_id = $1 AND client_id = $2 LIMIT 1`, [threadId, clientId]);
  return result.rows[0] ? loadMessage(result.rows[0].id) : null;
};

export const getEmployeeChat = async ({ employee, beforeId = null, limit = DEFAULT_MESSAGE_PAGE } = {}) => {
  const thread = await getOrCreateEmployeeChatThread(employee);
  const readResult = beforeId ? { rowCount: 0 } : await db.query(
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
  const { messages, hasMore } = await loadMessagePage(thread.id, { beforeId, limit });
  return { thread, messages, has_more: hasMore };
};

export const sendEmployeeChatMessage = async ({ employee, body = "", file = null, replyToMessageId = null, attachmentDurationSeconds = null, clientId = null } = {}) => {
  const attachment = attachmentFromUpload(file, attachmentDurationSeconds);
  const text = validateMessageInput({ body, attachment });
  const thread = await getOrCreateEmployeeChatThread(employee);
  const safeClientId = normalizeClientId(clientId);
  const existing = await findMessageByClientId(thread.id, safeClientId);
  if (existing) return { thread: await loadThreadSummary(thread.id), message: existing, duplicate: true };
  const replyTo = normalizeReplyId(replyToMessageId);
  const result = await db.query(
    `
    INSERT INTO employee_chat_messages (
      thread_id, sender_type, sender_employee_id, sender_user_id, body,
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_mime, attachment_duration_seconds,
      reply_to_message_id, read_at, created_at, client_id
    )
    VALUES ($1, 'employee', $2, NULL, $3, $4, $5, $6, $7, $8, $9,
      (SELECT id FROM employee_chat_messages WHERE id = $10 AND thread_id = $1),
      NULL, NOW(), $11)
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
      safeClientId,
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
  const message = (await loadMessage(result.rows[0]?.id)) || result.rows[0];
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
    SELECT m.*, t.employee_id, t.tenant_id, t.channel_type, t.branch_id
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
  emitChatEvent([...threadCashierRooms(message), adminChatRoom(message.tenant_id)], eventName, {
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

const ALLOWED_CHAT_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏"]);

const reactToEmployeeChatMessage = async ({ messageId, actorType, actorId, employeeId = null, tenantId = null, emoji = "" } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const normalizedEmoji = clean(emoji);
  if (!ALLOWED_CHAT_REACTIONS.has(normalizedEmoji)) throw chatError("Unsupported reaction", 400, "reaction_invalid");
  const target = await db.query(
    `SELECT m.id, m.thread_id, t.employee_id, t.tenant_id
     FROM employee_chat_messages m
     JOIN employee_chat_threads t ON t.id = m.thread_id
     WHERE m.id = $1 AND m.deleted_at IS NULL
       AND ($2::bigint IS NULL OR t.employee_id = $2::bigint)
       AND ($3::bigint IS NULL OR t.tenant_id = $3::bigint)
     LIMIT 1`,
    [messageId, employeeId, tenantId]
  );
  const current = target.rows[0];
  if (!current) throw chatError("Message not found", 404, "message_not_found");
  const existing = await db.query(
    `SELECT emoji FROM employee_chat_message_reactions WHERE message_id = $1 AND actor_type = $2 AND actor_id = $3`,
    [messageId, actorType, actorId]
  );
  if (existing.rows[0]?.emoji === normalizedEmoji) {
    await db.query(`DELETE FROM employee_chat_message_reactions WHERE message_id = $1 AND actor_type = $2 AND actor_id = $3`, [messageId, actorType, actorId]);
  } else {
    await db.query(
      `INSERT INTO employee_chat_message_reactions (message_id, actor_type, actor_id, emoji, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (message_id, actor_type, actor_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
      [messageId, actorType, actorId, normalizedEmoji]
    );
  }
  const message = await loadMessage(messageId);
  return emitMessageMutation({ ...message, employee_id: current.employee_id, tenant_id: current.tenant_id }, "employee-chat:message-updated");
};

export const reactEmployeeChatMessage = ({ employee, messageId, emoji } = {}) =>
  reactToEmployeeChatMessage({ messageId, emoji, actorType: "employee", actorId: employee?.id, employeeId: employee?.id });

export const reactAdminEmployeeChatMessage = ({ tenantId = null, userId, messageId, emoji } = {}) =>
  reactToEmployeeChatMessage({ messageId, emoji, actorType: "admin", actorId: userId, tenantId });

const loadBranchForChannel = async ({ tenantId = null, branchId } = {}) => {
  const id = Number(branchId || 0);
  if (!id) throw chatError("Branch is required", 400, "branch_required");
  const result = await db.query(
    `SELECT id, tenant_id, name FROM branches WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) LIMIT 1`,
    [id, tenantId]
  );
  if (!result.rows[0]) throw chatError("Branch not found", 404, "branch_not_found");
  return result.rows[0];
};

const findBranchPosThread = (tenantId, branchId) =>
  db.query(
    `SELECT * FROM employee_chat_threads WHERE channel_type = $1 AND branch_id = $2 AND COALESCE(tenant_id, 0) = COALESCE($3::bigint, 0) LIMIT 1`,
    [BRANCH_POS_CHANNEL, branchId, tenantId]
  );

export const getOrCreateBranchPosThread = async ({ tenantId = null, branchId } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const branch = await loadBranchForChannel({ tenantId, branchId });
  const scopeTenantId = tenantId ?? branch.tenant_id ?? null;
  const existing = await findBranchPosThread(scopeTenantId, branch.id);
  if (existing.rows[0]) return { thread: existing.rows[0], branch };
  const created = await db.query(
    `
    INSERT INTO employee_chat_threads (tenant_id, employee_id, branch_id, channel_type, status, created_at, updated_at)
    VALUES ($1, NULL, $2, $3, 'open', NOW(), NOW())
    ON CONFLICT DO NOTHING
    RETURNING *
    `,
    [scopeTenantId, branch.id, BRANCH_POS_CHANNEL]
  );
  if (created.rows[0]) {
    // The channel appears in the manager's list the moment a POS first opens it.
    const summary = await loadThreadSummary(created.rows[0].id);
    emitChatEvent([adminChatRoom(scopeTenantId)], "employee-chat:thread-updated", { thread: summary });
    return { thread: created.rows[0], branch };
  }
  const raced = await findBranchPosThread(scopeTenantId, branch.id);
  return { thread: raced.rows[0], branch };
};

export const getBranchPosChat = async ({ tenantId = null, branchId, beforeId = null, limit = DEFAULT_MESSAGE_PAGE } = {}) => {
  const { thread, branch } = await getOrCreateBranchPosThread({ tenantId, branchId });
  const readResult = beforeId ? { rowCount: 0 } : await db.query(
    `
    UPDATE employee_chat_messages
    SET read_at = COALESCE(read_at, NOW())
    WHERE thread_id = $1 AND sender_type = 'admin' AND read_at IS NULL
    RETURNING id
    `,
    [thread.id]
  );
  if (readResult.rowCount > 0) {
    emitChatEvent([adminChatRoom(thread.tenant_id)], "employee-chat:read", {
      thread_id: thread.id,
      employee_id: branchPosChannelKey(branch.id),
      reader_type: "employee",
      read_sender_type: "admin",
      read_count: readResult.rowCount,
    });
  }
  const { messages, hasMore } = await loadMessagePage(thread.id, { beforeId, limit });
  return {
    thread: { ...thread, employee_id: branchPosChannelKey(branch.id), branch_name: branch.name, employee_name: `${BRANCH_POS_NAME_PREFIX}${branch.name}` },
    branch,
    messages,
    has_more: hasMore,
  };
};

export const sendBranchPosChatMessage = async ({ tenantId = null, branchId, userId = null, senderName = "", body = "", file = null, replyToMessageId = null, attachmentDurationSeconds = null, clientId = null } = {}) => {
  const attachment = attachmentFromUpload(file, attachmentDurationSeconds);
  const text = validateMessageInput({ body, attachment });
  const { thread } = await getOrCreateBranchPosThread({ tenantId, branchId });
  const safeClientId = normalizeClientId(clientId);
  const existing = await findMessageByClientId(thread.id, safeClientId);
  if (existing) return { thread: await loadThreadSummary(thread.id), message: existing, duplicate: true };
  const replyTo = normalizeReplyId(replyToMessageId);
  const result = await db.query(
    `
    INSERT INTO employee_chat_messages (
      thread_id, sender_type, sender_employee_id, sender_user_id, sender_name, body,
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_mime, attachment_duration_seconds,
      reply_to_message_id, read_at, created_at, client_id
    )
    VALUES ($1, 'employee', NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      (SELECT id FROM employee_chat_messages WHERE id = $11 AND thread_id = $1),
      NULL, NOW(), $12)
    RETURNING *
    `,
    [
      thread.id,
      userId,
      clean(senderName).slice(0, 160) || null,
      text,
      attachment?.attachment_url || null,
      attachment?.attachment_type || null,
      attachment?.attachment_name || null,
      attachment?.attachment_size || null,
      attachment?.attachment_mime || null,
      attachment?.attachment_duration_seconds || null,
      replyTo,
      safeClientId,
    ]
  );
  await db.query(`UPDATE employee_chat_threads SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, [thread.id]);
  const updatedThread = await loadThreadSummary(thread.id);
  const message = (await loadMessage(result.rows[0]?.id)) || result.rows[0];
  emitChatEvent([branchPosChatRoom(thread.branch_id), adminChatRoom(thread.tenant_id)], "employee-chat:new-message", {
    thread: updatedThread,
    message,
  });
  emitChatEvent([adminChatRoom(thread.tenant_id)], "employee-chat:thread-updated", { thread: updatedThread });
  // Same manager-facing fan-out as an employee message: in-app notification + portal web push.
  const channelName = updatedThread?.employee_name || `${BRANCH_POS_NAME_PREFIX}${thread.branch_id}`;
  const channelKey = branchPosChannelKey(thread.branch_id);
  await createNotification({
    tenant_id: thread.tenant_id || null,
    role_key: "manager",
    branch_id: thread.branch_id || null,
    type: "employee_chat_message",
    category: "employees",
    priority: "medium",
    title: `رسالة جديدة من ${channelName}`,
    message: chatPushPreview(message),
    action_url: "/employees/chat",
    action_label: "فتح شات الموظفين",
    entity_type: "employee_chat_thread",
    entity_id: String(thread.id),
    metadata: { channel_key: channelKey, branch_id: thread.branch_id, thread_id: thread.id, message_id: message.id },
  }).catch(() => null);
  sendManagerEmployeeChatPush({
    tenantId: thread.tenant_id || null,
    branchId: thread.branch_id || null,
    employeeName: message.sender_name ? `${channelName} (${message.sender_name})` : channelName,
    threadId: thread.id,
    message,
    channelKey,
  }).catch((error) => console.warn("[manager-push:chat-message] failed", {
    channel_key: channelKey,
    thread_id: thread.id,
    message: error?.message || String(error),
  }));
  return { thread: updatedThread || thread, message };
};

/* ------------------------------------------------------------------------
 * Ring ("نداء"): an attention call with no audio. It is a chat row of
 * message_kind 'ring', so every list and thread already shows it; answering
 * rewrites the body and fans out message-updated, so every surface refreshes
 * through the handlers it already has.
 * ---------------------------------------------------------------------- */
export const RING_PENDING_MS = 120000;
const RING_RETRY_DELAYS_MS = [30000, 60000];
const RING_BODY = "📞 نداء";
const ringError = () => chatError("A ring is already pending", 409, "ring_pending");

const ringTargetRooms = (thread, senderType) =>
  senderType === "admin" ? threadCashierRooms(thread) : [adminChatRoom(thread.tenant_id)];

const loadRingMessage = async (messageId) => {
  const result = await db.query(
    `SELECT m.*, t.tenant_id, t.employee_id AS thread_employee_id, t.branch_id, t.channel_type
     FROM employee_chat_messages m
     JOIN employee_chat_threads t ON t.id = m.thread_id
     WHERE m.id = $1 AND m.message_kind = 'ring'
     LIMIT 1`,
    [messageId]
  );
  return result.rows[0] || null;
};

const ringIsOpen = (ring) => ring && !ring.ring_answered_at && Date.now() - new Date(ring.created_at).getTime() < RING_PENDING_MS;

const scheduleRingPushRetries = (messageId, sendAttempt) => {
  RING_RETRY_DELAYS_MS.forEach((delay, index) => {
    const timer = setTimeout(async () => {
      try {
        const ring = await loadRingMessage(messageId);
        if (!ringIsOpen(ring)) return;
        await sendAttempt(index + 1);
      } catch (error) {
        console.warn("[employee-chat] ring retry failed", { messageId, message: error?.message || error });
      }
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
  });
};

const createChatRing = async ({ thread, senderType, senderUserId = null, senderEmployeeId = null, senderName = "" } = {}) => {
  const pending = await db.query(
    `SELECT id FROM employee_chat_messages
     WHERE thread_id = $1 AND sender_type = $2 AND message_kind = 'ring'
       AND ring_answered_at IS NULL AND deleted_at IS NULL
       AND created_at > NOW() - ($3::int * INTERVAL '1 millisecond')
     LIMIT 1`,
    [thread.id, senderType, RING_PENDING_MS]
  );
  if (pending.rows[0]) throw ringError();
  const inserted = await db.query(
    `INSERT INTO employee_chat_messages (thread_id, sender_type, sender_employee_id, sender_user_id, sender_name, message_kind, body, read_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'ring', $6, NULL, NOW())
     RETURNING id`,
    [thread.id, senderType, senderEmployeeId, senderUserId, clean(senderName).slice(0, 160) || null, RING_BODY]
  );
  await db.query(`UPDATE employee_chat_threads SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, [thread.id]);
  const updatedThread = await loadThreadSummary(thread.id);
  const message = await loadMessage(inserted.rows[0].id);
  const everyone = [...threadCashierRooms(thread), adminChatRoom(thread.tenant_id)];
  emitChatEvent(everyone, "employee-chat:new-message", { thread: updatedThread, message });
  emitChatEvent([adminChatRoom(thread.tenant_id)], "employee-chat:thread-updated", { thread: updatedThread });
  emitChatEvent(ringTargetRooms(thread, senderType), "employee-chat:ring", {
    thread: updatedThread,
    message,
    thread_id: thread.id,
    employee_id: updatedThread?.employee_id ?? threadChannelEmployeeId(thread),
    sender_type: senderType,
    sender_name: clean(senderName),
    expires_at: new Date(Date.now() + RING_PENDING_MS).toISOString(),
  });
  return { thread: updatedThread, message };
};

const answerChatRing = async ({ messageId, answererType, answeredBy = "", tenantId = null, employeeId = null, branchId = null } = {}) => {
  const ring = await loadRingMessage(messageId);
  if (!ring) throw chatError("Ring not found", 404, "ring_not_found");
  if (tenantId != null && ring.tenant_id != null && Number(ring.tenant_id) !== Number(tenantId)) throw chatError("Ring not found", 404, "ring_not_found");
  if (employeeId != null && Number(ring.thread_employee_id) !== Number(employeeId)) throw chatError("Ring not found", 404, "ring_not_found");
  if (branchId != null && (ring.channel_type !== BRANCH_POS_CHANNEL || Number(ring.branch_id) !== Number(branchId))) throw chatError("Ring not found", 404, "ring_not_found");
  if (ring.sender_type === answererType) throw chatError("You cannot answer your own ring", 400, "ring_own");
  const thread = { id: ring.thread_id, tenant_id: ring.tenant_id, employee_id: ring.thread_employee_id, branch_id: ring.branch_id, channel_type: ring.channel_type };
  if (ring.ring_answered_at) {
    return { thread, message: await loadMessage(ring.id), already: true };
  }
  const seconds = Math.max(0, Math.round((Date.now() - new Date(ring.created_at).getTime()) / 1000));
  const by = clean(answeredBy).slice(0, 160) || null;
  await db.query(
    `UPDATE employee_chat_messages
     SET ring_answered_at = NOW(), ring_answered_by = $2, read_at = COALESCE(read_at, NOW()),
         body = $3
     WHERE id = $1`,
    [ring.id, by, `${RING_BODY} — تم الرد${by ? ` (${by})` : ""} بعد ${seconds} ث`]
  );
  const message = await loadMessage(ring.id);
  const everyone = [...threadCashierRooms(thread), adminChatRoom(thread.tenant_id)];
  emitChatEvent(everyone, "employee-chat:ring-answered", {
    thread_id: thread.id,
    message_id: ring.id,
    message,
    answered_by: by,
    answerer_type: answererType,
    answered_at: message?.ring_answered_at || new Date().toISOString(),
    seconds,
  });
  emitChatEvent(everyone, "employee-chat:message-updated", { thread_id: thread.id, message });
  return { thread, message };
};

// Admin / manager → employee or branch cashier
export const sendAdminChatRing = async ({ tenantId = null, threadId, userId = null, senderName = "" } = {}) => {
  const { thread } = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: false, withMessages: false });
  const result = await createChatRing({ thread, senderType: "admin", senderUserId: userId, senderName });
  if (!isBranchPosThread(thread) && thread.employee_record_id) {
    const attempt = (n) =>
      sendEmployeePortalPush({
        tenantId: thread.tenant_id || thread.employee_tenant_id || tenantId || null,
        employeeId: thread.employee_record_id,
        title: "📞 نداء من الإدارة",
        body: senderName ? `${senderName} بينده عليك — افتح التطبيق للرد` : "الإدارة بتنده عليك — افتح التطبيق للرد",
        url: thread.employee_portal_token ? `/employee-app/${encodeURIComponent(thread.employee_portal_token)}?tab=chat` : "/employee-app/?tab=chat",
        tag: `employee-ring-${result.message.id}-${n}`,
        data: { event: "employee_chat_ring", thread_id: thread.id, message_id: result.message.id, tab: "chat" },
        persist: n === 0,
        deliverPush: true,
      });
    attempt(0).catch((error) => console.warn("[employee-chat] ring push failed", error?.message || error));
    scheduleRingPushRetries(result.message.id, attempt);
  }
  return result;
};
export const answerAdminChatRing = ({ tenantId = null, messageId, answeredBy = "" } = {}) =>
  answerChatRing({ messageId, answererType: "admin", answeredBy, tenantId });

// Employee (token app) → management
export const sendEmployeeChatRing = async ({ employee } = {}) => {
  const thread = await getOrCreateEmployeeChatThread(employee);
  const name = employee.full_name || employee.employee_name || employee.employee_code || "موظف";
  const result = await createChatRing({ thread, senderType: "employee", senderEmployeeId: employee.id, senderName: name });
  const attempt = (n) =>
    sendManagerEmployeeChatPush({
      tenantId: employee.tenant_id || null,
      branchId: employee.branch_id || null,
      employee,
      employeeId: employee.id,
      employeeName: name,
      threadId: thread.id,
      message: result.message,
      kind: "ring",
      attempt: n,
    });
  attempt(0).catch((error) => console.warn("[manager-push:ring] failed", error?.message || error));
  scheduleRingPushRetries(result.message.id, attempt);
  return result;
};
export const answerEmployeeChatRing = ({ employee, messageId } = {}) =>
  answerChatRing({ messageId, answererType: "employee", answeredBy: employee?.full_name || "", employeeId: employee?.id || null });

// Branch POS cashier → management
export const sendBranchPosChatRing = async ({ tenantId = null, branchId, userId = null, senderName = "" } = {}) => {
  const { thread, branch } = await getOrCreateBranchPosThread({ tenantId, branchId });
  const channelName = `${BRANCH_POS_NAME_PREFIX}${branch.name}`;
  const result = await createChatRing({ thread, senderType: "employee", senderUserId: userId, senderName });
  const attempt = (n) =>
    sendManagerEmployeeChatPush({
      tenantId: thread.tenant_id || null,
      branchId: thread.branch_id || null,
      employeeName: senderName ? `${channelName} (${senderName})` : channelName,
      threadId: thread.id,
      message: result.message,
      channelKey: branchPosChannelKey(thread.branch_id),
      kind: "ring",
      attempt: n,
    });
  attempt(0).catch((error) => console.warn("[manager-push:ring] failed", error?.message || error));
  scheduleRingPushRetries(result.message.id, attempt);
  return result;
};
export const answerBranchPosChatRing = ({ tenantId = null, branchId, messageId, answeredBy = "" } = {}) =>
  answerChatRing({ messageId, answererType: "employee", answeredBy, tenantId, branchId: Number(branchId || 0) || null });

export const listEmployeeChatThreads = async ({ tenantId = null, limit = 200 } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const safeLimit = Math.min(Math.max(Number(limit || 200), 1), 500);
  const result = await db.query(
    `
    SELECT
      t.id,
      t.tenant_id,
      t.branch_id,
      t.status,
      t.last_message_at,
      t.created_at,
      t.updated_at,${threadIdentitySql},
      COALESCE(e.photo_url, '') AS photo_url,
      b.name AS branch_name,
      lm.last_message,
      lm.sender_type AS last_sender_type,
      lm.created_at AS last_message_created_at,
      COALESCE(unread.unread_count, 0)::int AS unread_count
    FROM employee_chat_threads t
    LEFT JOIN employees e ON e.id = t.employee_id
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
      AND (t.channel_type = '${BRANCH_POS_CHANNEL}' OR e.id IS NOT NULL)
    ORDER BY COALESCE(t.last_message_at, t.updated_at, t.created_at) DESC, t.id DESC
    LIMIT $2
    `,
    [tenantId, safeLimit]
  );
  return result.rows;
};

export const getAdminEmployeeChatThread = async ({ tenantId = null, threadId, markRead = true, beforeId = null, limit = DEFAULT_MESSAGE_PAGE, withMessages = true } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const threadResult = await db.query(
    `
    SELECT
      t.*,
      t.employee_id AS employee_record_id,${threadIdentitySql},
      COALESCE(e.photo_url, '') AS photo_url,
      e.tenant_id AS employee_tenant_id,
      e.employee_portal_token,
      b.name AS branch_name
    FROM employee_chat_threads t
    LEFT JOIN employees e ON e.id = t.employee_id
    LEFT JOIN branches b ON b.id = t.branch_id
    WHERE t.id = $1
      AND ($2::bigint IS NULL OR t.tenant_id = $2::bigint)
      AND COALESCE(e.is_deleted, FALSE) = FALSE
      AND (t.channel_type = '${BRANCH_POS_CHANNEL}' OR e.id IS NOT NULL)
    LIMIT 1
    `,
    [threadId, tenantId]
  );
  const thread = threadResult.rows[0];
  if (!thread) throw chatError("Thread not found", 404, "thread_not_found");

  // Older pages never mark anything read; only the newest page counts as "seen".
  if (markRead && !beforeId) {
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
      emitChatEvent([...threadCashierRooms(thread), adminChatRoom(thread.tenant_id)], "employee-chat:read", {
        thread_id: thread.id,
        employee_id: thread.employee_id,
        reader_type: "admin",
        read_sender_type: "employee",
        read_count: readResult.rowCount,
      });
    }
  }

  if (!withMessages) return { thread, messages: [], has_more: false };
  const { messages, hasMore } = await loadMessagePage(thread.id, { beforeId, limit });
  return { thread, messages, has_more: hasMore };
};

/*
 * "Delivered": the reader's device has the message (it arrived over the socket
 * or in a fetch), which is not yet "read". Stamps every undelivered message
 * from the OTHER side in the thread and tells the sender's rooms, so the
 * sender's single tick becomes two.
 */
export const markChatMessagesDelivered = async ({ thread, readerType, upToMessageId = null } = {}) => {
  if (!thread?.id || !readerType) return { count: 0 };
  const senderType = readerType === "admin" ? "employee" : "admin";
  const result = await db.query(
    `
    UPDATE employee_chat_messages
    SET delivered_at = NOW()
    WHERE thread_id = $1 AND sender_type = $2 AND delivered_at IS NULL AND read_at IS NULL
      AND ($3::bigint IS NULL OR id <= $3::bigint)
    RETURNING id
    `,
    [thread.id, senderType, normalizeCursor(upToMessageId)]
  );
  if (result.rowCount > 0) {
    const rooms = readerType === "admin" ? [...threadCashierRooms(thread)] : [adminChatRoom(thread.tenant_id)];
    emitChatEvent(rooms, "employee-chat:delivered", {
      thread_id: thread.id,
      employee_id: thread.employee_id,
      reader_type: readerType,
      message_ids: result.rows.map((row) => row.id),
      delivered_at: new Date().toISOString(),
    });
  }
  return { count: result.rowCount };
};

export const markAdminEmployeeChatThreadDelivered = async ({ tenantId = null, threadId, upToMessageId = null } = {}) => {
  const { thread } = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: false, withMessages: false });
  return markChatMessagesDelivered({ thread, readerType: "admin", upToMessageId });
};

export const markEmployeeChatDelivered = async ({ employee, upToMessageId = null } = {}) => {
  const thread = await getOrCreateEmployeeChatThread(employee);
  return markChatMessagesDelivered({ thread, readerType: "employee", upToMessageId });
};

export const markBranchPosChatDelivered = async ({ tenantId = null, branchId, upToMessageId = null } = {}) => {
  const { thread } = await getOrCreateBranchPosThread({ tenantId, branchId });
  return markChatMessagesDelivered({ thread, readerType: "employee", upToMessageId });
};

export const sendAdminEmployeeChatMessage = async ({ tenantId = null, threadId, userId = null, body = "", file = null, attachmentOverride = null, replyToMessageId = null, attachmentDurationSeconds = null, clientId = null } = {}) => {
  const attachment = attachmentOverride || attachmentFromUpload(file, attachmentDurationSeconds);
  const text = validateMessageInput({ body, attachment });
  const { thread } = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: true, withMessages: false });
  const safeClientId = normalizeClientId(clientId);
  const existing = await findMessageByClientId(thread.id, safeClientId);
  if (existing) return { thread: await loadThreadSummary(thread.id), message: existing, duplicate: true };
  const replyTo = normalizeReplyId(replyToMessageId);
  const result = await db.query(
    `
    INSERT INTO employee_chat_messages (
      thread_id, sender_type, sender_employee_id, sender_user_id, body,
      attachment_url, attachment_type, attachment_name, attachment_size, attachment_mime, attachment_duration_seconds,
      reply_to_message_id, read_at, created_at, client_id
    )
    VALUES ($1, 'admin', NULL, $2, $3, $4, $5, $6, $7, $8, $9,
      (SELECT id FROM employee_chat_messages WHERE id = $10 AND thread_id = $1),
      NULL, NOW(), $11)
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
      safeClientId,
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
  const message = (await loadMessage(result.rows[0]?.id)) || result.rows[0];
  emitChatEvent([...threadCashierRooms(thread), adminChatRoom(thread.tenant_id)], "employee-chat:new-message", {
    thread: updatedThread,
    message,
  });
  emitChatEvent([adminChatRoom(thread.tenant_id)], "employee-chat:thread-updated", {
    thread: updatedThread,
  });
  // A branch channel has no employee to push to; the POS hears it over the socket.
  if (isBranchPosThread(thread) || !thread.employee_record_id) return { thread: updatedThread || thread, message };
  const activeEmployeeChatClients = await getRoomClientCount(employeeActiveChatRoom(thread.employee_record_id));
  const employeeChatIsActive = activeEmployeeChatClients > 0;
  const notificationTenantId = thread.tenant_id || thread.employee_tenant_id || tenantId || null;
  const senderName = await loadAdminSenderName({ userId, tenantId: notificationTenantId });
  await sendEmployeePortalPush({
    tenantId: notificationTenantId,
    employeeId: thread.employee_record_id,
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
  const { thread } = await getAdminEmployeeChatThread({ tenantId, threadId, markRead: false, withMessages: false });
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
    emitChatEvent([...threadCashierRooms(thread), adminChatRoom(thread.tenant_id)], "employee-chat:read", {
      thread_id: thread.id,
      employee_id: thread.employee_id,
      reader_type: "admin",
      read_sender_type: "employee",
      read_count: readResult.rowCount,
    });
  }
  return { thread };
};
