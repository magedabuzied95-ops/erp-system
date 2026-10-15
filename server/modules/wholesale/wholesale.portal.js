import db from "../../database/db.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";
import { buildWholesaleStatement } from "./wholesale.statement.js";
import { PAYMENT_METHODS, recordStaffPayment } from "./wholesale.payments.js";

// Manager portal, wholesale copy only: the quick "تسجيل دفعة عميل". Customers never record a
// payment themselves; the manager records it here and it is posted at once (same path as the
// payments page: a customer payment with its screenshot, if one was attached).

const text = (value) => String(value ?? "").trim();
const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: "WHOLESALE_PORTAL_PAYMENT" });

export const searchPortalCustomers = async ({ manager, search = "" }) => {
  await ensureWholesaleSchema();
  const term = text(search).slice(0, 60);
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.phone
       FROM customers c
      WHERE c.tenant_id = $1 AND COALESCE(c.status, 'active') <> 'deleted'
        AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%')
      ORDER BY (EXISTS (SELECT 1 FROM wholesale_customer_terms t WHERE t.tenant_id = c.tenant_id AND t.customer_id = c.id)) DESC, c.name
      LIMIT 12`,
    [manager.tenant_id, term]
  );
  return rows.map((row) => ({ id: Number(row.id), name: row.name, phone: row.phone }));
};

export const portalCustomerBalance = async ({ manager, customerId }) => {
  const { balance, totals } = await buildWholesaleStatement({ tenantId: manager.tenant_id, customerId: idOf(customerId) });
  return { balance, totals };
};

export const recordPortalPayment = async ({ manager, body = {}, imageUrl = "" }) => {
  await ensureWholesaleSchema();
  const tenantId = Number(manager.tenant_id);
  const customerId = idOf(body.customer_id);
  const { rows: [customer] } = await db.query("SELECT id FROM customers WHERE tenant_id = $1 AND id = $2", [tenantId, customerId]);
  if (!customer) throw fail("اختار العميل", 404);
  const method = PAYMENT_METHODS.includes(text(body.method)) ? text(body.method) : "cash";
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
  if (!(amount > 0)) throw fail("اكتب المبلغ");

  // A double tap within a minute is the same payment, not a second one.
  const { rows: [recent] } = await db.query(
    `SELECT id, customer_payment_id FROM wholesale_payment_submissions
      WHERE tenant_id = $1 AND customer_id = $2 AND amount = $3 AND method = $4 AND source = 'staff'
        AND status = 'approved' AND created_at > NOW() - INTERVAL '60 seconds'
      ORDER BY id DESC LIMIT 1`,
    [tenantId, customerId, amount, method]
  );
  if (recent) return { id: Number(recent.id), status: "approved", duplicate: true, ...(await portalCustomerBalance({ manager, customerId })) };

  // The payment endpoint is the ERP's own; it runs as the manager's linked ERP user.
  const req = {
    user: { id: manager.user_id || null, tenant_id: tenantId, role: "admin" },
    tenantId,
    headers: {},
    query: {},
    params: {},
    body: {},
    get: () => "",
  };
  const note = [text(body.note), `بوابة المدير — ${text(manager.name || manager.full_name)}`].filter(Boolean).join(" — ");
  const result = await recordStaffPayment({
    req,
    tenantId,
    customerId,
    amount,
    method,
    reference: text(body.reference),
    note,
    imageUrl,
  });
  return { ...result, ...(await portalCustomerBalance({ manager, customerId })) };
};
