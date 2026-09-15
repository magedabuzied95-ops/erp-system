import crypto from "node:crypto";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import db from "../../database/db.js";

// الرسائل in the employee portal: the AI Inbox messages (WhatsApp / Messenger /
// Instagram DMs — never the social comments), for the employees the admin
// switched on in the employee profile.
//
// The inbox is ~40 staff routes behind protect + permit, so rather than fork them
// the portal borrows a real, hidden `users` row per employee whose role holds only
// the inbox permissions. Its session is minted from the portal token and confined
// to the message routes by portalInboxBoundary.js; password login is refused.
// Switching the employee off deactivates that user, which `protect` checks on
// every request, so the door closes immediately.
//
// Columns are created on the first admin toggle, never at boot or on a portal read
// (reads fall back to "off"), and the ensure is memoized per process.

export const PORTAL_INBOX_ROLE = "portal_inbox";
const ENABLED_COLUMN = "portal_inbox_enabled";
const USER_COLUMN = "portal_inbox_user_id";
const SESSION_TTL = "12h";

export const PORTAL_INBOX_PERMISSIONS = [
  ["ai_inbox_messenger", "view"],
  ["ai_inbox_messenger", "reply"],
  ["ai_inbox_instagram", "view"],
  ["ai_inbox_instagram", "reply"],
  ["products", "view"],
  ["customers", "view"],
];

export const isPortalInboxRole = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_") === PORTAL_INBOX_ROLE;

let columnsPromise = null;
let columnsExist = false;
let columnsKnownAt = 0;
const COLUMN_CHECK_TTL_MS = 10 * 60 * 1000;

const hasColumns = async (client = db) => {
  if (columnsExist) return true;
  if (Date.now() - columnsKnownAt < COLUMN_CHECK_TTL_MS) return false;
  const result = await client.query(
    "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'employees' AND column_name = ANY($1::text[])",
    [[ENABLED_COLUMN, USER_COLUMN]]
  );
  columnsExist = Number(result.rows[0]?.count) === 2;
  columnsKnownAt = Date.now();
  return columnsExist;
};

const ensureColumns = async (client = db) => {
  if (columnsExist) return;
  if (!columnsPromise) {
    columnsPromise = client
      .query(
        `ALTER TABLE IF EXISTS employees
           ADD COLUMN IF NOT EXISTS ${ENABLED_COLUMN} BOOLEAN NOT NULL DEFAULT FALSE,
           ADD COLUMN IF NOT EXISTS ${USER_COLUMN} BIGINT NULL`
      )
      .then(() => {
        columnsExist = true;
        columnsKnownAt = Date.now();
      })
      .catch((error) => {
        columnsPromise = null;
        throw error;
      });
  }
  await columnsPromise;
};

export const resetPortalInboxColumnCacheForTests = () => {
  columnsPromise = null;
  columnsExist = false;
  columnsKnownAt = 0;
};

const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

// Binds a session to the portal link it came from: regenerating the link (a lost
// phone) ends every session minted from the old one.
export const portalTokenFingerprint = (token = "") =>
  crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 24);

const portalInboxEmail = (employeeId) => `portal-inbox-${employeeId}@employee-portal.invalid`;

export const employeePortalInboxEnabled = async ({ employeeId, tenantId = null, client = db } = {}) => {
  const id = idOrNull(employeeId);
  if (!id || !(await hasColumns(client))) return false;
  const params = [id];
  const tenant = idOrNull(tenantId);
  const tenantClause = tenant ? (params.push(tenant), ` AND tenant_id = $${params.length}::bigint`) : "";
  const result = await client.query(
    `SELECT ${ENABLED_COLUMN} AS enabled FROM employees WHERE id = $1::bigint${tenantClause} LIMIT 1`,
    params
  );
  return result.rows[0]?.enabled === true;
};

// Select-then-insert on purpose: not every database carries the unique
// constraints an ON CONFLICT clause needs (a local copy did not).
const ensureRole = async ({ tenantId, client }) => {
  const existingRole = await client.query(
    "SELECT id FROM roles WHERE tenant_id IS NOT DISTINCT FROM $1::bigint AND LOWER(name) = $2 ORDER BY id LIMIT 1",
    [tenantId, PORTAL_INBOX_ROLE]
  );
  const roleId = existingRole.rows[0]?.id ?? (
    await client.query(
      "INSERT INTO roles (tenant_id, name, description) VALUES ($1, $2, 'Employee portal messages (AI Inbox without comments)') RETURNING id",
      [tenantId, PORTAL_INBOX_ROLE]
    )
  ).rows[0].id;
  for (const [module, action] of PORTAL_INBOX_PERMISSIONS) {
    const existingPermission = await client.query(
      "SELECT id FROM permissions WHERE module = $1 AND action = $2 ORDER BY id LIMIT 1",
      [module, action]
    );
    const permissionId = existingPermission.rows[0]?.id ?? (
      await client.query(
        "INSERT INTO permissions (module, action, description) VALUES ($1, $2, $3) RETURNING id",
        [module, action, `${module} ${action}`]
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1::bigint, $2::bigint
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = $1::bigint AND permission_id = $2::bigint)`,
      [roleId, permissionId]
    );
  }
  return roleId;
};

const usersHasRoleColumn = async (client) => {
  const result = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'role' LIMIT 1"
  );
  return result.rows.length > 0;
};

// Creates (or reactivates) the hidden inbox user of one employee. Runs inside the
// caller's transaction.
const ensurePortalInboxUser = async ({ employee, client }) => {
  const tenantId = idOrNull(employee.tenant_id);
  const roleId = await ensureRole({ tenantId, client });
  const name = String(employee.full_name || employee.name || `Employee ${employee.id}`).trim();
  const hasRoleColumn = await usersHasRoleColumn(client);
  const roleSet = hasRoleColumn ? `, role = '${PORTAL_INBOX_ROLE}'` : "";

  const existingId = idOrNull(employee[USER_COLUMN]);
  if (existingId) {
    const updated = await client.query(
      `UPDATE users SET role_id = $1, name = $2, is_active = TRUE, is_super_admin = FALSE${roleSet}, updated_at = NOW()
       WHERE id = $3 AND LOWER(email) = LOWER($4) RETURNING id`,
      [roleId, name, existingId, portalInboxEmail(employee.id)]
    );
    if (updated.rows[0]) return Number(updated.rows[0].id);
  }

  const email = portalInboxEmail(employee.id);
  const byEmail = await client.query(
    "SELECT id FROM users WHERE tenant_id IS NOT DISTINCT FROM $1 AND LOWER(email) = LOWER($2) LIMIT 1",
    [tenantId, email]
  );
  let userId = idOrNull(byEmail.rows[0]?.id);
  if (userId) {
    await client.query(
      `UPDATE users SET role_id = $1, name = $2, is_active = TRUE, is_super_admin = FALSE${roleSet}, updated_at = NOW() WHERE id = $3`,
      [roleId, name, userId]
    );
  } else {
    // Nobody knows this password; login refuses the role anyway.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const names = ["tenant_id", "role_id", "name", "email", "password", "is_active", "is_super_admin"];
    const values = [tenantId, roleId, name, email, passwordHash, true, false];
    if (hasRoleColumn) { names.push("role"); values.push(PORTAL_INBOX_ROLE); }
    const inserted = await client.query(
      `INSERT INTO users (${names.join(", ")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
      values
    );
    userId = Number(inserted.rows[0].id);
  }
  await client.query(`UPDATE employees SET ${USER_COLUMN} = $1 WHERE id = $2`, [userId, employee.id]);
  return userId;
};

const withTransaction = async (client, work) => {
  const ownsClient = !client;
  const connection = client || (await db.connect());
  try {
    await connection.query("BEGIN");
    const result = await work(connection);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsClient) connection.release();
  }
};

export const setEmployeePortalInboxAccess = async ({ employeeId, tenantId = null, enabled, client = null } = {}) => {
  const id = idOrNull(employeeId);
  if (!id) throw httpError(400, "Employee is required");
  await ensureColumns(client || db);
  return withTransaction(client, async (connection) => {
    const params = [id];
    const tenant = idOrNull(tenantId);
    const tenantClause = tenant ? (params.push(tenant), ` AND tenant_id = $${params.length}::bigint`) : "";
    const found = await connection.query(
      `SELECT id, tenant_id, full_name, ${USER_COLUMN} FROM employees WHERE id = $1::bigint${tenantClause} LIMIT 1 FOR UPDATE`,
      params
    );
    const employee = found.rows[0];
    if (!employee) throw httpError(404, "Employee not found");

    if (enabled === true) {
      await ensurePortalInboxUser({ employee, client: connection });
    } else if (idOrNull(employee[USER_COLUMN])) {
      await connection.query("UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1", [employee[USER_COLUMN]]);
    }
    await connection.query(`UPDATE employees SET ${ENABLED_COLUMN} = $1 WHERE id = $2`, [enabled === true, employee.id]);
    invalidatePortalInboxEmployeeCache(employee.id);
    return { employee_id: Number(employee.id), enabled: enabled === true };
  });
};

export const portalInboxPermissionKeys = () =>
  PORTAL_INBOX_PERMISSIONS.map(([module, action]) => `${module}.${action}`);

// Exchanges a verified portal employee for a confined inbox session.
export const mintPortalInboxSession = async ({ employee, portalToken, client = null } = {}) => {
  if (!employee?.id) throw httpError(404, "Employee not found");
  if (!(await employeePortalInboxEnabled({ employeeId: employee.id, tenantId: employee.tenant_id, client: client || db }))) {
    throw httpError(403, "Messages are not enabled for this employee", "PORTAL_INBOX_DISABLED");
  }
  const userId = await withTransaction(client, async (connection) => {
    const found = await connection.query(
      `SELECT id, tenant_id, full_name, ${USER_COLUMN} FROM employees WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [employee.id]
    );
    if (!found.rows[0]) throw httpError(404, "Employee not found");
    return ensurePortalInboxUser({ employee: found.rows[0], client: connection });
  });
  const tenantId = idOrNull(employee.tenant_id);
  const token = jwt.sign(
    {
      id: userId,
      role: PORTAL_INBOX_ROLE,
      tenant_id: tenantId,
      is_super_admin: false,
      portal_inbox_employee_id: Number(employee.id),
      portal_token_fp: portalTokenFingerprint(portalToken),
    },
    process.env.JWT_SECRET || "SECRET_KEY",
    { expiresIn: SESSION_TTL }
  );
  return {
    token,
    user: {
      id: userId,
      name: employee.full_name || "",
      role: PORTAL_INBOX_ROLE,
      role_name: PORTAL_INBOX_ROLE,
      account_mode: PORTAL_INBOX_ROLE,
      tenant_id: tenantId,
      tenantId,
      employee_id: Number(employee.id),
      is_super_admin: false,
      permissions: portalInboxPermissionKeys(),
    },
  };
};

// Per-request check used by the boundary: the employee is still active, still
// switched on, and still on the portal link the session was minted from.
const employeeStateCache = new Map();
const EMPLOYEE_STATE_TTL_MS = 30 * 1000;

export const invalidatePortalInboxEmployeeCache = (employeeId) => {
  employeeStateCache.delete(Number(employeeId));
};

export const portalInboxSessionStillValid = async ({ employeeId, tokenFingerprint, client = db } = {}) => {
  const id = idOrNull(employeeId);
  if (!id || !tokenFingerprint) return false;
  const cached = employeeStateCache.get(id);
  let state = cached && Date.now() - cached.at < EMPLOYEE_STATE_TTL_MS ? cached.state : null;
  if (!state) {
    if (!(await hasColumns(client))) return false;
    const result = await client.query(
      `SELECT ${ENABLED_COLUMN} AS enabled, employee_portal_token, status, COALESCE(is_deleted, FALSE) AS is_deleted
       FROM employees WHERE id = $1 LIMIT 1`,
      [id]
    );
    const row = result.rows[0];
    state = row
      ? {
          enabled: row.enabled === true && row.is_deleted !== true && String(row.status || "active").toLowerCase() === "active",
          fingerprint: row.employee_portal_token ? portalTokenFingerprint(row.employee_portal_token) : "",
        }
      : { enabled: false, fingerprint: "" };
    employeeStateCache.set(id, { state, at: Date.now() });
  }
  return state.enabled && state.fingerprint === tokenFingerprint;
};
