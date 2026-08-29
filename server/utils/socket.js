export let io = null;

export const setIo = (socketServer) => {
  io = socketServer;
};

const text = (value = "") => String(value ?? "").trim();

export const normalizeSocketRoomKey = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/\s+/g, "_");

// `ai_inbox:message` is emitted from ~28 places (WhatsApp, Meta, Telegram, social
// comments, the agent routes...). Tapping the one emitter every one of them calls
// is the only way to guarantee no inbound message silently skips its push. The
// import is lazy so this leaf util keeps no load-order dependency on the service
// layer, and the send is fire-and-forget: a push failure must never break a socket
// emit that the live inbox UI depends on.
let aiInboxPushModule;
const notifyAiInboxPush = (payload = {}) => {
  const message = payload?.message;
  if (!message || typeof message !== "object") return;
  Promise.resolve()
    .then(async () => {
      if (!aiInboxPushModule) aiInboxPushModule = await import("../services/aiInboxPushService.js");
      if (!aiInboxPushModule.isInboundCustomerMessage(message)) return;
      await aiInboxPushModule.notifyAiInboxInboundMessage({
        tenantId: payload.tenant_id ?? payload.tenantId ?? null,
        sessionId: payload.session_id ?? payload.sessionId ?? payload.conversation_id ?? payload.conversationId ?? "",
        message,
        channel: payload.channel || message.channel || message.source || "",
      });
    })
    .catch((error) => {
      console.warn("[ai-inbox-push:tap-failed]", { message: error?.message || String(error) });
    });
};

export const emitToRooms = (rooms = [], eventName, payload = {}) => {
  if (!io || !eventName) return;
  const uniqueRooms = [...new Set(rooms.filter(Boolean))];
  if (!uniqueRooms.length) {
    io.emit(eventName, payload);
  } else {
    uniqueRooms.reduce((target, room) => target.to(room), io).emit(eventName, payload);
  }
  if (eventName === "ai_inbox:message") notifyAiInboxPush(payload);
};

export const getRoomClientCount = async (room = "") => {
  if (!io || !room) return 0;
  try {
    const sockets = await io.in(room).fetchSockets();
    return sockets.length;
  } catch {
    return 0;
  }
};

export const buildStaffTaskRooms = (task = {}, extraRooms = []) => {
  const rooms = new Set(extraRooms.filter(Boolean));
  if (task.assigned_user_id) rooms.add(`user:${task.assigned_user_id}`);
  if (task.user_id) rooms.add(`user:${task.user_id}`);
  if (task.branch_id) rooms.add(`branch:${task.branch_id}`);
  if (task.role_key) rooms.add(`role:${normalizeSocketRoomKey(task.role_key)}`);
  rooms.add("role:admin");
  rooms.add("role:super_admin");
  rooms.add("role:superadmin");
  return [...rooms];
};

export const emitStaffTaskEvent = (eventType, task = {}, options = {}) => {
  const rooms = buildStaffTaskRooms(task, options.rooms || []);
  const payload = {
    event: eventType,
    task_id: task.id,
    tenant_id: task.tenant_id || null,
    branch_id: task.branch_id || null,
    role_key: task.role_key || "",
    assigned_user_id: task.assigned_user_id || null,
    current_assignee_id: task.current_assignee_id || null,
    status: task.status || "",
    priority: task.priority || "",
    title: task.title || "Staff task",
    message: options.message || task.title || "Staff task updated",
    action_url: "/staff/tasks",
    at: new Date().toISOString(),
    metadata: options.metadata || {},
  };
  emitToRooms(rooms, `staff_tasks:${eventType}`, payload);
  emitToRooms(rooms, "staff_tasks:event", payload);
};
