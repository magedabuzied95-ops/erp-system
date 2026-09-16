import db from "../../database/db.js";
import { sendEmployeePortalPush } from "../../services/employeePortalPushService.js";

// A new WEBSITE order rings the employee portal. Every employee sees the
// أوردرات الشحن board (owner decision), so every active employee whose installed
// portal holds a live push subscription gets it; tapping opens that board.
// Employees without a subscription are skipped up front so a busy checkout does
// not write a "No active push subscription" log row per employee per order.

const text = (value = "") => String(value ?? "").trim();

const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

const formatAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `${Math.round(amount * 100) / 100} ج.م`;
};

export const buildPortalNewOrderPush = ({ employee = {}, order = {} } = {}) => {
  const orderId = idOrNull(order.id || order.order_id);
  const number = text(order.public_order_number || order.invoice_number || orderId);
  const customerName = text(order.customer_name) || "عميل";
  const amount = formatAmount(order.total_amount ?? order.total);
  const token = encodeURIComponent(text(employee.employee_portal_token));
  return {
    title: "🛒 أوردر جديد من الموقع",
    body: [`#${number}`, customerName, amount].filter(Boolean).join(" · "),
    url: `/employee-app/${token}/online-orders`,
    // One tag per order: the bell list dedupes on it and a retry replaces, never doubles.
    tag: `web-order-${orderId}`,
    data: { event: "web_order_created", order_id: orderId, order_number: number },
  };
};

const loadSubscribedEmployees = async ({ tenantId, client = db }) => {
  const result = await client.query(
    `SELECT e.id, e.employee_portal_token
     FROM employees e
     WHERE e.tenant_id = $1::bigint
       AND COALESCE(e.is_deleted, FALSE) = FALSE
       AND LOWER(COALESCE(e.status, 'active')) = 'active'
       AND COALESCE(e.employee_portal_token, '') <> ''
       AND EXISTS (
         SELECT 1 FROM employee_push_subscriptions s
         WHERE s.employee_id = e.id AND s.tenant_id = e.tenant_id AND s.is_active = TRUE
       )`,
    [tenantId]
  );
  return result.rows;
};

export const notifyEmployeesOfNewWebOrder = async ({
  order = {},
  client = db,
  send = sendEmployeePortalPush,
  loadRecipients = loadSubscribedEmployees,
} = {}) => {
  const tenantId = idOrNull(order.tenant_id);
  const orderId = idOrNull(order.id || order.order_id);
  if (!tenantId) return { sent: 0, skipped: true, reason: "no-tenant" };
  if (!orderId) return { sent: 0, skipped: true, reason: "no-order" };
  const employees = await loadRecipients({ tenantId, client }).catch((error) => {
    // Table missing on a fresh DB means nobody has subscribed yet.
    if (error?.code !== "42P01") console.warn("[portal-new-order-push] recipients failed", { message: error?.message || String(error) });
    return [];
  });
  if (!employees.length) return { sent: 0, skipped: true, reason: "nobody-subscribed" };
  let sent = 0;
  for (const employee of employees) {
    const push = buildPortalNewOrderPush({ employee, order });
    const result = await send({ tenantId, employeeId: Number(employee.id), ...push }).catch((error) => {
      console.warn("[portal-new-order-push] send failed", { employeeId: employee.id, message: error?.message || String(error) });
      return { sent: 0 };
    });
    sent += Number(result?.sent || 0);
  }
  console.info("[portal-new-order-push]", { tenantId, orderId, recipients: employees.length, sent });
  return { sent, recipients: employees.length, skipped: false };
};
