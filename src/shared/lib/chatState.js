const toDateValue = (value) => {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
};

const normalizeKeyPart = (value = "") => String(value ?? "").trim().replace(/\s+/g, " ");

const threadKey = (item = {}) => {
  const id = item?.id || item?.thread_id;
  if (id) return `thread:${String(id)}`;
  const employeeId = item?.employee_id;
  if (employeeId) return `employee:${String(employeeId)}`;
  return `fallback:${normalizeKeyPart(item?.employee_code || item?.employee_name || "")}`;
};

const messageKey = (item = {}, fallbackThread = null) => {
  const id = item?.id || item?.message_id;
  if (id) return `message:${String(id)}`;
  const sender = normalizeKeyPart(item?.sender_type || item?.sender || "");
  const body = normalizeKeyPart(item?.body || item?.attachment_name || "");
  const createdAt = normalizeKeyPart(item?.created_at || "");
  const employeeId = normalizeKeyPart(item?.employee_id || fallbackThread?.employee_id || "");
  return `fallback:${sender}|${body}|${createdAt}|${employeeId}`;
};

const mergeByKey = (current = [], incoming = [], getKey) => {
  const rows = [];
  const indexByKey = new Map();

  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = getKey(item);
    if (!key) continue;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, rows.length);
      rows.push(item);
      continue;
    }
    rows[existingIndex] = { ...rows[existingIndex], ...item };
  }

  return rows;
};

const sortThreadRows = (rows = []) =>
  [...rows].sort((left, right) => {
    const delta =
      toDateValue(right.last_message_created_at || right.last_message_at || right.updated_at || right.created_at) -
      toDateValue(left.last_message_created_at || left.last_message_at || left.updated_at || left.created_at);
    if (delta !== 0) return delta;
    return String(right.id || right.employee_id || "").localeCompare(String(left.id || left.employee_id || ""));
  });

const sortMessageRows = (rows = []) =>
  [...rows].sort((left, right) => {
    const delta = toDateValue(left.created_at) - toDateValue(right.created_at);
    if (delta !== 0) return delta;
    const leftId = String(left.id || left.message_id || "");
    const rightId = String(right.id || right.message_id || "");
    return leftId.localeCompare(rightId);
  });

export const dedupeChatThreads = (rows = []) => sortThreadRows(mergeByKey([], rows, threadKey));

export const mergeChatThreads = (current = [], incoming = []) =>
  sortThreadRows(mergeByKey(current, incoming, threadKey));

export const dedupeChatMessages = (rows = [], fallbackThread = null) =>
  sortMessageRows(mergeByKey([], rows, (item) => messageKey(item, fallbackThread)));

export const mergeChatMessages = (current = [], incoming = [], fallbackThread = null) =>
  sortMessageRows(mergeByKey(current, incoming, (item) => messageKey(item, fallbackThread)));
