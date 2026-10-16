import crypto from "node:crypto";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import db from "../../database/db.js";
import { portalTokenFingerprint } from "../aiInboxPortal/portalInboxAccess.js";

// إضافة منتج from the employee portal (inside استلام بضاعة): the ERP's own Add
// Product page, unchanged, for an employee with no ERP login (owner's call:
// the portal link plus the employee's own PIN on the page is enough).
//
// Same idea as the portal's الرسائل (aiInboxPortal/portalInboxAccess.js): the
// portal borrows a hidden `users` row per employee whose role holds only the
// product permissions, mints a short session from the portal token, and
// portalProductBoundary.js confines that session to the endpoints the Add
// Product page calls — it can create a product, never open, edit or delete one.
// Password login is refused for these rows (authController).

export const PORTAL_PRODUCTS_ROLE = "portal_products";
const SESSION_TTL = "4h";

// products.edit is only reachable through the AI helper endpoints the boundary
// lets through (generate description / SEO / edition name); PATCH, PUT and
// DELETE on /products/:id are not on its allowlist.
export const PORTAL_PRODUCTS_PERMISSIONS = [
  ["products", "view"],
  ["products", "create"],
  ["products", "edit"],
];

export const isPortalProductsRole = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_") === PORTAL_PRODUCTS_ROLE;

export const PORTAL_PRODUCTS_EMAIL_RE = /^portal-products-\d+@employee-portal\.invalid$/i;

const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

const portalProductsEmail = (employeeId) => `portal-products-${employeeId}@employee-portal.invalid`;

// Select-then-insert: not every database carries the unique constraints an
// ON CONFLICT clause needs.
const ensureRole = async ({ tenantId, client }) => {
  const existingRole = await client.query(
    "SELECT id FROM roles WHERE tenant_id IS NOT DISTINCT FROM $1::bigint AND LOWER(name) = $2 ORDER BY id LIMIT 1",
    [tenantId, PORTAL_PRODUCTS_ROLE]
  );
  const roleId = existingRole.rows[0]?.id ?? (
    await client.query(
      "INSERT INTO roles (tenant_id, name, description) VALUES ($1, $2, 'Employee portal: add a product only') RETURNING id",
      [tenantId, PORTAL_PRODUCTS_ROLE]
    )
  ).rows[0].id;
  for (const [module, action] of PORTAL_PRODUCTS_PERMISSIONS) {
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

// Creates (or reactivates) the hidden product-entry user of one employee. The
// row is found by its email, so no employees column is needed.
const ensurePortalProductsUser = async ({ employee, client }) => {
  const tenantId = idOrNull(employee.tenant_id);
  const roleId = await ensureRole({ tenantId, client });
  const name = String(employee.full_name || employee.name || `Employee ${employee.id}`).trim();
  const hasRoleColumn = await usersHasRoleColumn(client);
  const roleSet = hasRoleColumn ? `, role = '${PORTAL_PRODUCTS_ROLE}'` : "";
  const email = portalProductsEmail(employee.id);

  const byEmail = await client.query(
    "SELECT id FROM users WHERE tenant_id IS NOT DISTINCT FROM $1::bigint AND LOWER(email) = LOWER($2) LIMIT 1",
    [tenantId, email]
  );
  const existingId = idOrNull(byEmail.rows[0]?.id);
  if (existingId) {
    await client.query(
      `UPDATE users SET role_id = $1, name = $2, is_active = TRUE, is_super_admin = FALSE${roleSet}, updated_at = NOW() WHERE id = $3`,
      [roleId, name, existingId]
    );
    return existingId;
  }
  // Nobody knows this password; login refuses these rows anyway.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const names = ["tenant_id", "role_id", "name", "email", "password", "is_active", "is_super_admin"];
  const values = [tenantId, roleId, name, email, passwordHash, true, false];
  if (hasRoleColumn) { names.push("role"); values.push(PORTAL_PRODUCTS_ROLE); }
  const inserted = await client.query(
    `INSERT INTO users (${names.join(", ")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
    values
  );
  return Number(inserted.rows[0].id);
};

export const mintPortalProductsSession = async ({ employee, portalToken } = {}) => {
  if (!employee?.id) throw httpError(404, "Employee not found");
  const connection = await db.connect();
  let userId;
  try {
    await connection.query("BEGIN");
    // One mint at a time per employee, so two taps never make two hidden users.
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`portal-products:${employee.id}`]);
    userId = await ensurePortalProductsUser({ employee, client: connection });
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  const tenantId = idOrNull(employee.tenant_id);
  const token = jwt.sign(
    {
      id: userId,
      role: PORTAL_PRODUCTS_ROLE,
      tenant_id: tenantId,
      is_super_admin: false,
      portal_products_employee_id: Number(employee.id),
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
      role: PORTAL_PRODUCTS_ROLE,
      role_name: PORTAL_PRODUCTS_ROLE,
      account_mode: PORTAL_PRODUCTS_ROLE,
      tenant_id: tenantId,
      tenantId,
      employee_id: Number(employee.id),
      is_super_admin: false,
      permissions: PORTAL_PRODUCTS_PERMISSIONS.map(([module, action]) => `${module}.${action}`),
    },
  };
};

// Per-request check used by the boundary: the employee is still active and still
// on the portal link the session was minted from (a regenerated link ends it).
const employeeStateCache = new Map();
const EMPLOYEE_STATE_TTL_MS = 30 * 1000;

export const portalProductsSessionStillValid = async ({ employeeId, tokenFingerprint, client = db } = {}) => {
  const id = idOrNull(employeeId);
  if (!id || !tokenFingerprint) return false;
  const cached = employeeStateCache.get(id);
  let state = cached && Date.now() - cached.at < EMPLOYEE_STATE_TTL_MS ? cached.state : null;
  if (!state) {
    const result = await client.query(
      "SELECT employee_portal_token, status, COALESCE(is_deleted, FALSE) AS is_deleted FROM employees WHERE id = $1 LIMIT 1",
      [id]
    );
    const row = result.rows[0];
    state = row
      ? {
          active: row.is_deleted !== true && String(row.status || "active").toLowerCase() === "active",
          fingerprint: row.employee_portal_token ? portalTokenFingerprint(row.employee_portal_token) : "",
        }
      : { active: false, fingerprint: "" };
    employeeStateCache.set(id, { state, at: Date.now() });
  }
  return state.active && state.fingerprint === tokenFingerprint;
};
