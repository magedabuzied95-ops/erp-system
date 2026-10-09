import db from "../../database/db.js";
import { isAdminAccount } from "../../middleware/authMiddleware.js";

// Who is looking at the inbox, for conversation privacy.
//
// Two shapes arrive here: a normal staff session (`req.user`, filled by protect)
// and an employee-portal inbox session, whose JWT carries
// `portal_inbox_employee_id` and borrows a hidden users row. Both resolve to the
// same answer: is this an admin, and which EMPLOYEE is it — because the privacy
// allowlist names employees, not users.
//
// The role is read from the database rather than from the token's claims: a
// demoted admin must stop seeing private threads straight away, not when their
// 12h token expires.

const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

const VIEWER_TTL_MS = 30 * 1000;
const viewerCache = new Map();

export const invalidateInboxViewerCache = () => viewerCache.clear();

const employeeIdForUser = async ({ userId, client = db }) => {
  const id = idOrNull(userId);
  if (!id) return null;
  const result = await client.query(
    `SELECT id FROM employees
     WHERE user_id = $1::bigint AND COALESCE(is_deleted, FALSE) = FALSE
     ORDER BY id
     LIMIT 1`,
    [id]
  );
  return idOrNull(result.rows[0]?.id);
};

const loadViewerForUserId = async ({ userId, client = db }) => {
  const id = idOrNull(userId);
  if (!id) return { isAdmin: false, employeeId: null, userId: null };
  const hit = viewerCache.get(id);
  if (hit && Date.now() - hit.at < VIEWER_TTL_MS) return hit.value;
  const result = await client.query(
    `SELECT u.id, u.role, u.is_super_admin, COALESCE(r.name, '') AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1::bigint
     LIMIT 1`,
    [id]
  );
  const row = result.rows[0] || null;
  const value = {
    userId: id,
    isAdmin: row ? isAdminAccount(row) : false,
    employeeId: await employeeIdForUser({ userId: id, client }),
  };
  viewerCache.set(id, { value, at: Date.now() });
  return value;
};

/**
 * `req.user` is present after protect; the boundary middleware runs earlier and
 * passes its own decoded claims instead.
 */
export const resolveInboxViewer = async ({ user = null, decoded = null, client = db } = {}) => {
  const claims = user || decoded || {};
  const portalEmployeeId = idOrNull(claims.portal_inbox_employee_id);
  if (portalEmployeeId) {
    // A portal inbox session is never an admin, whatever its borrowed role holds.
    return { isAdmin: false, employeeId: portalEmployeeId, userId: idOrNull(claims.id), portal: true };
  }
  const resolved = await loadViewerForUserId({ userId: claims.id, client });
  return { ...resolved, portal: false };
};

export default resolveInboxViewer;
