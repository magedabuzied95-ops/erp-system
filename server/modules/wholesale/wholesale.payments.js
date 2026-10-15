import { randomBytes } from "node:crypto";
import db from "../../database/db.js";
import { adjustCustomerWallet } from "../../controllers/customersController.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";
import { buildWholesaleStatement } from "./wholesale.statement.js";
import { runHandler } from "./runHandler.js";

// The credit customer's private statement link, and payments that arrive with a screenshot.
// A customer can only ever SUBMIT a payment; staff approve it, which records an ordinary
// customer payment (allocation to invoices, cash account, journal) through the same
// endpoint the customers page uses.

export const PAYMENT_METHODS = Object.freeze(["vodafone_cash", "instapay", "post", "bank_transfer", "cash"]);
// customer_payments has no Egypt Post method; the submission keeps "post" and the note says so.
const LEDGER_METHOD = { vodafone_cash: "vodafone_cash", instapay: "instapay", post: "bank_transfer", bank_transfer: "bank_transfer", cash: "cash" };
const METHOD_LABEL = { vodafone_cash: "فودافون كاش", instapay: "إنستاباي", post: "تحويل بريد", bank_transfer: "تحويل بنكي", cash: "كاش" };

const text = (value) => String(value ?? "").trim();
const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const fail = (message, status = 400, code = "WHOLESALE_PAYMENT_INVALID") => Object.assign(new Error(message), { status, code });
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const publicAppUrl = () =>
  text(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL).replace(/\/+$/, "");

export const statementUrlFor = (token) => `${publicAppUrl()}/s/${token}`;

/** The customer's link, created on first use; rotate=true issues a new one (the old dies). */
export const getStatementLink = async ({ tenantId, customerId, rotate = false }) => {
  await ensureWholesaleSchema();
  const id = idOf(customerId);
  const { rows: [customer] } = await db.query("SELECT id FROM customers WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  if (!customer) throw fail("العميل مش موجود", 404);
  if (!rotate) {
    const { rows: [row] } = await db.query("SELECT token FROM wholesale_statement_links WHERE tenant_id = $1 AND customer_id = $2", [tenantId, id]);
    if (row) return { token: row.token, url: statementUrlFor(row.token) };
  }
  const token = randomBytes(18).toString("base64url");
  await db.query(
    `INSERT INTO wholesale_statement_links (tenant_id, customer_id, token) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, customer_id) DO UPDATE SET token = EXCLUDED.token, created_at = NOW()`,
    [tenantId, id, token]
  );
  return { token, url: statementUrlFor(token) };
};

export const resolveStatementToken = async (token) => {
  await ensureWholesaleSchema();
  const clean = text(token);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clean)) throw fail("الرابط ده مش صحيح", 404, "STATEMENT_LINK_UNKNOWN");
  const { rows: [row] } = await db.query("SELECT tenant_id, customer_id FROM wholesale_statement_links WHERE token = $1", [clean]);
  if (!row) throw fail("الرابط ده مش صحيح أو اتغير", 404, "STATEMENT_LINK_UNKNOWN");
  return { tenantId: Number(row.tenant_id), customerId: Number(row.customer_id) };
};

/** What the customer sees at /s/:token -- the statement, plus their payments still waiting. */
export const loadPublicStatement = async ({ token }) => {
  const { tenantId, customerId } = await resolveStatementToken(token);
  const statement = await buildWholesaleStatement({ tenantId, customerId });
  const { rows: pending } = await db.query(
    `SELECT id, amount, method, created_at FROM wholesale_payment_submissions
      WHERE tenant_id = $1 AND customer_id = $2 AND status = 'pending' ORDER BY created_at DESC`,
    [tenantId, customerId]
  );
  const { rows: [company] } = await db.query("SELECT company_name FROM company_profiles WHERE tenant_id = $1", [tenantId]).catch(() => ({ rows: [] }));
  return {
    company: company?.company_name || "",
    ...statement,
    pending: pending.map((row) => ({ ...row, amount: Number(row.amount), method_label: METHOD_LABEL[row.method] || row.method })),
    methods: PAYMENT_METHODS.filter((m) => m !== "cash").map((m) => ({ value: m, label: METHOD_LABEL[m] })),
  };
};

export const createSubmission = async ({ tenantId, customerId, amount, method, reference = "", note = "", imageUrl = "", source = "customer" }) => {
  await ensureWholesaleSchema();
  const value = round(amount);
  if (!(value > 0)) throw fail("اكتب المبلغ اللي اتحوّل");
  if (!PAYMENT_METHODS.includes(method)) throw fail("اختار طريقة التحويل");
  if (source === "customer" && !imageUrl) throw fail("ارفع صورة التحويل");
  const { rows: [row] } = await db.query(
    `INSERT INTO wholesale_payment_submissions (tenant_id, customer_id, amount, method, reference, note, image_url, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [tenantId, customerId, value, method, text(reference).slice(0, 160), text(note).slice(0, 500), imageUrl, source]
  );
  return { ...row, amount: Number(row.amount) };
};

export const listSubmissions = async ({ tenantId, status = "pending", limit = 100 }) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone
       FROM wholesale_payment_submissions s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.tenant_id = $1 AND ($2 = 'all' OR s.status = $2)
      ORDER BY s.created_at DESC
      LIMIT $3`,
    [tenantId, text(status) || "pending", Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return rows.map((row) => ({ ...row, amount: Number(row.amount), method_label: METHOD_LABEL[row.method] || row.method }));
};

/** Approving records a real customer payment; the submission keeps the screenshot. */
export const approveSubmission = async ({ req, tenantId, id, amount = null }) => {
  await ensureWholesaleSchema();
  const { rows: [submission] } = await db.query(
    "SELECT * FROM wholesale_payment_submissions WHERE tenant_id = $1 AND id = $2",
    [tenantId, idOf(id)]
  );
  if (!submission) throw fail("الدفعة مش موجودة", 404);
  if (submission.status !== "pending") throw fail("الدفعة دي اتراجعت قبل كده", 409);
  const finalAmount = amount === null || amount === undefined || amount === "" ? Number(submission.amount) : round(amount);
  if (!(finalAmount > 0)) throw fail("المبلغ لازم يكون أكبر من صفر");

  const notes = [
    `${METHOD_LABEL[submission.method] || submission.method}${submission.source === "customer" ? " — من رابط العميل" : ""}`,
    text(submission.note),
  ].filter(Boolean).join(" — ");
  const result = await runHandler(adjustCustomerWallet, req, {
    params: { id: String(submission.customer_id) },
    body: {
      transaction_type: "customer_payment",
      amount: finalAmount,
      payment_method: LEDGER_METHOD[submission.method] || "cash",
      reference: text(submission.reference) || `WSP-${submission.id}`,
      notes,
      payment_date: submission.created_at,
    },
  });
  if (result.status >= 400 || !result.body?.success) {
    throw fail(result.body?.message || "تعذر تسجيل الدفعة", result.status >= 400 ? result.status : 500, "WHOLESALE_PAYMENT_APPROVE_FAILED");
  }
  const paymentId = result.body?.payment?.id || null;
  await db.query(
    `UPDATE wholesale_payment_submissions
        SET status = 'approved', amount = $3, customer_payment_id = $4, decided_by = $5, decided_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, submission.id, finalAmount, paymentId, req.user?.id || null]
  );
  return { id: Number(submission.id), status: "approved", customer_payment_id: paymentId };
};

export const rejectSubmission = async ({ req, tenantId, id, reason = "" }) => {
  await ensureWholesaleSchema();
  const { rowCount } = await db.query(
    `UPDATE wholesale_payment_submissions
        SET status = 'rejected', reject_reason = $3, decided_by = $4, decided_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
    [tenantId, idOf(id), text(reason).slice(0, 300), req.user?.id || null]
  );
  if (!rowCount) throw fail("الدفعة مش موجودة أو اتراجعت قبل كده", 404);
  return { id: idOf(id), status: "rejected" };
};

/** Staff entering a payment they already checked: recorded at once, screenshot kept. */
export const recordStaffPayment = async ({ req, tenantId, customerId, amount, method, reference, note, imageUrl }) => {
  const submission = await createSubmission({ tenantId, customerId: idOf(customerId), amount, method, reference, note, imageUrl, source: "staff" });
  return approveSubmission({ req, tenantId, id: submission.id });
};

/** Balance + limit for the POS warning, from the wholesale ledger. */
export const customerCreditPosition = async ({ tenantId, customerId }) => {
  await ensureWholesaleSchema();
  const statement = await buildWholesaleStatement({ tenantId, customerId: idOf(customerId) });
  const { rows: [terms] } = await db.query(
    "SELECT credit_limit, due_days FROM wholesale_customer_terms WHERE tenant_id = $1 AND customer_id = $2",
    [tenantId, idOf(customerId)]
  );
  return { balance: statement.balance, credit_limit: Number(terms?.credit_limit || 0), due_days: Number(terms?.due_days || 0) };
};
