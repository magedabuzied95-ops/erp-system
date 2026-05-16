export let io = null;

export const setIo = (socketServer) => {
  io = socketServer;
};

const text = (value = "") => String(value ?? "").trim();

export const normalizeSocketRoomKey = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/\s+/g, "_");

export const emitToRooms = (rooms = [], eventName, payload = {}) => {
  if (!io || !eventName) return;
  const uniqueRooms = [...new Set(rooms.filter(Boolean))];
  if (!uniqueRooms.length) {
    io.emit(eventName, payload);
    return;
  }
  uniqueRooms.reduce((target, room) => target.to(room), io).emit(eventName, payload);
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
