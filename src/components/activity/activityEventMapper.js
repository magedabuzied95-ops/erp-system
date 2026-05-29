const priorityMap = {
  low: "normal",
  medium: "normal",
  normal: "normal",
  high: "high",
  critical: "critical",
};

const text = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
};

const first = (...values) => values.find((value) => text(value));

const toIso = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const normalizePriority = (value) => priorityMap[String(value || "").toLowerCase()] || "normal";

const eventTypeFrom = (eventName = "", payload = {}) =>
  text(payload.type || payload.event || eventName || payload.category || "notification").toLowerCase().replace(/[:\s-]+/g, "_");

const categoryFrom = (type = "", payload = {}) => {
  const category = text(payload.category).toLowerCase();
  if (category === "payments") return "pos";
  if (category === "staff_tasks") return "staff_tasks";
  if (category) return category;
  if (type.includes("order") || type.includes("refund") || type.includes("cancel")) return "orders";
  if (type.includes("payment") || type.includes("pos") || type.includes("barcode")) return "pos";
  if (type.startsWith("ai_") || type.includes("ai_")) return "ai";
  if (type.includes("stock") || type.includes("inventory") || type.includes("product")) return "inventory";
  if (type.includes("attendance") || type.includes("check_in") || type.includes("check_out")) return "attendance";
  if (type.includes("staff_task") || type.includes("task")) return "staff_tasks";
  return "system";
};

const routeFor = (category, payload = {}) => {
  const metadata = payload.metadata || {};
  const actionUrl = first(payload.action_url, payload.actionUrl, metadata.action_url, metadata.actionUrl);
  if (actionUrl) return actionUrl;

  const orderId = first(payload.order_id, payload.orderId, payload.entity_type === "order" ? payload.entity_id : "", metadata.order_id, metadata.orderId);
  if (orderId) return `/orders/${encodeURIComponent(orderId)}`;

  const conversationId = first(payload.conversation_id, payload.conversationId, metadata.conversation_id, metadata.conversationId);
  if (conversationId) return `/admin/ai-support-console?conversation=${encodeURIComponent(conversationId)}`;
  if (category === "ai") return "/admin/ai-support-console";

  const productId = first(payload.product_id, payload.productId, payload.entity_type === "product" ? payload.entity_id : "", metadata.product_id, metadata.productId);
  if (productId) return `/products/${encodeURIComponent(productId)}`;
  if (category === "inventory") return "/inventory";

  const employeeId = first(payload.employee_id, payload.employeeId, metadata.employee_id, metadata.employeeId);
  if (employeeId) return `/attendance/employees?employee=${encodeURIComponent(employeeId)}`;
  if (category === "attendance") return "/attendance";

  const taskId = first(payload.task_id, payload.taskId, payload.entity_type === "staff_task" ? payload.entity_id : "", metadata.task_id, metadata.taskId);
  if (taskId) return `/staff/tasks?task=${encodeURIComponent(taskId)}`;
  if (category === "staff_tasks") return "/staff/tasks";

  if (category === "orders") return "/orders";
  if (category === "pos") return "/pos";
  return "/notifications";
};

const detailsFrom = (payload = {}) => {
  const metadata = payload.metadata || {};
  return {
    branch: first(payload.branch_name, payload.branchName, payload.branch, metadata.branch_name, metadata.branch),
    user: first(payload.user_name, payload.userName, payload.created_by_name, payload.cashier, metadata.user_name),
    customer: first(payload.customer_name, payload.customerName, payload.customer, metadata.customer_name),
    product: first(payload.product_name, payload.productName, payload.name, metadata.product_name),
    order: first(payload.public_order_number, payload.display_order_number, payload.invoice_number, payload.invoiceNumber, payload.order_number, metadata.public_order_number, metadata.display_order_number, metadata.invoice_number, payload.orderId, payload.order_id),
  };
};

const titleFor = (type, payload = {}) => {
  const explicit = first(payload.title);
  if (explicit) return explicit;
  if (type.includes("exact_product")) return "Exact product found";
  if (type.includes("no_results")) return "No AI results";
  if (type.includes("ai") && type.includes("message")) return "New AI message";
  if (type.includes("payment")) return "Payment received";
  if (type.includes("refund")) return "Refund processed";
  if (type.includes("cancel")) return "Order cancelled";
  if (type.includes("low_stock") || type.includes("stock_alert")) return "Low stock alert";
  if (type.includes("check_in")) return "Attendance check-in";
  if (type.includes("check_out")) return "Attendance check-out";
  if (type.includes("task") && type.includes("completed")) return "Staff task completed";
  if (type.includes("task")) return "Staff task update";
  if (type.includes("product") && type.includes("updated")) return "Product updated";
  if (type.includes("order")) return "New order";
  return "System notification";
};

const descriptionFor = (type, payload = {}, details = {}) => {
  const explicit = first(payload.message, payload.body, payload.description);
  if (explicit) return explicit;
  if (details.customer && details.order) return `${details.customer} · ${details.order}`;
  if (details.product) return details.product;
  if (details.user) return details.user;
  if (type.includes("payment") && first(payload.amount, payload.total)) return `Amount ${first(payload.amount, payload.total)}`;
  return "Realtime ERP activity";
};

const iconFor = (category, type) => {
  if (type.includes("payment")) return "payment";
  if (type.includes("refund") || type.includes("cancel")) return "refund";
  if (category === "orders") return "order";
  if (category === "pos") return "pos";
  if (category === "ai") return type.includes("no_results") ? "aiWarning" : "ai";
  if (category === "inventory") return type.includes("product") ? "product" : "inventory";
  if (category === "attendance") return "attendance";
  if (category === "staff_tasks") return "task";
  return "system";
};

const inferredPriorityFor = (type, payload, metadata) =>
  first(
    payload.priority,
    metadata.priority,
    type.includes("low_stock") || type.includes("stock_alert") ? "high" : "",
    type.includes("payment") ? "high" : "",
    type.includes("exact_product") ? "high" : "",
    type.includes("refund") || type.includes("cancel") ? "high" : "",
    type.includes("error") || type.includes("critical") ? "critical" : ""
  );

export const mapActivityEvent = (eventName = "notification", payload = {}, source = "socket") => {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const metadata = safePayload.metadata && typeof safePayload.metadata === "object" ? safePayload.metadata : {};
  const type = eventTypeFrom(eventName, safePayload);
  const category = categoryFrom(type, safePayload);
  const details = detailsFrom(safePayload);
  const timestamp = toIso(first(safePayload.created_at, safePayload.createdAt, safePayload.timestamp, safePayload.updated_at));
  const id = text(first(
    safePayload.feedbackId,
    safePayload.notification_id,
    safePayload.notificationId,
    safePayload.id,
    safePayload.entity_id,
    safePayload.order_id,
    safePayload.orderId,
    safePayload.task_id,
    safePayload.taskId,
    metadata.id
  ), `${source}:${type}:${timestamp}:${titleFor(type, safePayload)}`);

  return {
    id,
    dedupeKey: [type, id, text(safePayload.entity_type), text(safePayload.entity_id)].filter(Boolean).join(":"),
    source,
    rawType: type,
    category,
    priority: normalizePriority(inferredPriorityFor(type, safePayload, metadata)),
    iconKey: iconFor(category, type),
    title: titleFor(type, safePayload),
    description: descriptionFor(type, safePayload, details),
    timestamp,
    label: category === "staff_tasks" ? "Staff Tasks" : category.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    href: routeFor(category, safePayload),
    details,
    payload: safePayload,
  };
};

export const mapNotificationToActivity = (notification = {}) =>
  mapActivityEvent(`notification:${notification.type || notification.category || "system"}`, notification, "notification");
