import db from "../../database/db.js";

// Who may ACT on أوردرات الشحن (confirm / ready to ship / create the Bosta parcel /
// print the airway bill). Owner decision 2026-09-10: every manager-portal holder may;
// in the employee portal only employees the admin switched on (the board itself stays
// visible to everyone).
//
// The column is created on the first admin toggle, never at boot and never on a
// portal read: reads fall back to "off" while it does not exist yet. The ensure is
// memoized per process — an unguarded ALTER on a hot path starved the pool once
// (2026-08-26).

const COLUMN = "online_orders_actions_enabled";
let columnPromise = null;
let columnKnownAt = 0;
let columnExists = false;
const COLUMN_CHECK_TTL_MS = 10 * 60 * 1000;

const hasColumn = async (client = db) => {
  if (columnExists) return true;
  if (Date.now() - columnKnownAt < COLUMN_CHECK_TTL_MS) return false;
  const result = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'employees' AND column_name = $1 LIMIT 1",
    [COLUMN]
  );
  columnExists = result.rows.length > 0;
  columnKnownAt = Date.now();
  return columnExists;
};

const ensureColumn = async (client = db) => {
  if (columnExists) return;
  if (!columnPromise) {
    columnPromise = client
      .query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS ${COLUMN} BOOLEAN NOT NULL DEFAULT FALSE`)
      .then(() => {
        columnExists = true;
        columnKnownAt = Date.now();
      })
      .catch((error) => {
        columnPromise = null;
        throw error;
      });
  }
  await columnPromise;
};

const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

export const employeeCanActOnOnlineOrders = async ({ employeeId, tenantId = null, client = db } = {}) => {
  const id = idOrNull(employeeId);
  if (!id || !(await hasColumn(client))) return false;
  const params = [id];
  const tenant = idOrNull(tenantId);
  const tenantClause = tenant ? (params.push(tenant), ` AND tenant_id = $${params.length}::bigint`) : "";
  const result = await client.query(
    `SELECT ${COLUMN} AS enabled FROM employees WHERE id = $1::bigint${tenantClause} LIMIT 1`,
    params
  );
  return result.rows[0]?.enabled === true;
};

export const setEmployeeOnlineOrdersAccess = async ({ employeeId, tenantId = null, enabled, client = db } = {}) => {
  const id = idOrNull(employeeId);
  if (!id) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }
  await ensureColumn(client);
  const params = [id, enabled === true];
  const tenant = idOrNull(tenantId);
  const tenantClause = tenant ? (params.push(tenant), ` AND tenant_id = $${params.length}::bigint`) : "";
  const result = await client.query(
    `UPDATE employees SET ${COLUMN} = $2 WHERE id = $1::bigint${tenantClause} RETURNING id, ${COLUMN} AS enabled`,
    params
  );
  if (!result.rows[0]) {
    const error = new Error("Employee not found");
    error.status = 404;
    throw error;
  }
  return { employee_id: Number(result.rows[0].id), enabled: result.rows[0].enabled === true };
};
