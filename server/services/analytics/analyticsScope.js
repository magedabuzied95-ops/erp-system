/**
 * Permission resolution for Analytics v2.
 *
 * The route middleware enforces `reports:view` — without it the request never reaches a
 * service. The finer financial permissions are resolved HERE and handed to the metric
 * services, which omit the corresponding columns from their SELECT lists.
 *
 * That distinction matters: hiding a value in React still ships it in the JSON. A user
 * without `reports:cost` must never receive a cost figure at all.
 *
 * Permission names are the real ones registered in permissionMiddleware.CORE_PERMISSIONS
 * and mirrored in the frontend matrix (rbacStore MODULE_ACTIONS.reports).
 */

import db from "../../database/db.js";
import { isSuperAdminUser } from "../../utils/requestScope.js";

export const REPORTS_MODULE = "reports";
export const COST_ACTION = "cost";
export const PROFIT_ACTION = "profit";

/**
 * Customer identity is resolved here too, from the SAME row set as reports:*, so the
 * reporting layer never grows a second way of asking "may this caller see who a customer
 * is". R6 uses it to decide whether the top-customer list carries names or ranks; contact
 * details are never returned to anybody regardless of this flag.
 */
export const CUSTOMERS_MODULE = "customers";

const ADMIN_ROLES = ["admin", "super_admin", "super admin", "superadmin", "owner"];

const normalizeRole = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

const isAdminRole = (value = "") => ADMIN_ROLES.some((role) => normalizeRole(role) === normalizeRole(value));

/**
 * Load the caller's reports:* permissions from the database.
 *
 * Mirrors permissionMiddleware's resolution order so the two cannot disagree:
 * admin / super-admin / wildcard short-circuit to full access, everyone else needs an
 * explicit grant.
 */
export const resolveAnalyticsPermissions = async (req, { client = db } = {}) => {
  const userId = req?.user?.id;

  if (isSuperAdminUser(req?.user)) {
    return { view: true, cost: true, profit: true, customers: true, source: "super_admin" };
  }

  if (!userId) {
    return { view: false, cost: false, profit: false, customers: false, source: "anonymous" };
  }

  const result = await client.query(
    `
    SELECT DISTINCT
      p.module,
      p.action,
      COALESCE(r.name, '')            AS role_name,
      COALESCE(u.role, '')            AS user_role,
      COALESCE(u.is_super_admin, FALSE) AS is_super_admin
    FROM users u
    LEFT JOIN roles r            ON u.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p       ON p.id = rp.permission_id
    WHERE u.id = $1
    `,
    [userId]
  );

  const rows = result.rows || [];
  const roleName = rows[0]?.role_name || rows[0]?.user_role || req?.user?.role_name || req?.user?.role || "";

  if (rows[0]?.is_super_admin || isAdminRole(roleName)) {
    return { view: true, cost: true, profit: true, customers: true, source: "admin" };
  }

  const hasWildcard =
    rows.some((row) => row.module === "*" || row.action === "*") ||
    (Array.isArray(req?.user?.permissions) && req.user.permissions.includes("*"));

  if (hasWildcard) {
    return { view: true, cost: true, profit: true, customers: true, source: "wildcard" };
  }

  const granted = new Set(
    rows
      .filter((row) => row.module && row.action)
      .map((row) => `${String(row.module).toLowerCase()}:${String(row.action).toLowerCase()}`)
  );

  const has = (action) => granted.has(`${REPORTS_MODULE}:${action}`);

  return {
    view: has("view"),
    cost: has(COST_ACTION),
    // Profit is meaningless without cost, and granting it alone would leak margin.
    profit: has(PROFIT_ACTION) && has(COST_ACTION),
    // Customer identity is a separate grant from reporting access: a manager may be
    // trusted with the shape of the customer base without being trusted with the names.
    customers: granted.has(`${CUSTOMERS_MODULE}:view`),
    source: "granted",
  };
};

/**
 * Strip every cost/profit-bearing field from a payload for callers who may not see it.
 * A defensive second line behind service-level column omission, not a substitute for it.
 */
export const RESTRICTED_COST_FIELDS = Object.freeze(["cogs", "unitCost", "inventoryValue", "cogsCoverage"]);
export const RESTRICTED_PROFIT_FIELDS = Object.freeze(["grossProfit", "grossMargin", "netProfit", "profitContribution"]);

/**
 * Find any restricted metric that still carries a real numeric value.
 *
 * A masked KPI keeps its key so the UI can distinguish "restricted" from "unavailable"
 * from "zero" — the key itself is not a leak. Only a numeric value is. Objects are
 * therefore descended into rather than flagged.
 */
export const assertNoRestrictedFields = (payload, permissions) => {
  const forbidden = [
    ...(permissions.cost ? [] : RESTRICTED_COST_FIELDS),
    ...(permissions.profit ? [] : RESTRICTED_PROFIT_FIELDS),
  ];
  const found = [];
  const isNumericLeak = (value) => typeof value === "number" && Number.isFinite(value);

  const walk = (node, path = "") => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const here = `${path}${key}`;
      if (forbidden.includes(key)) {
        if (isNumericLeak(value)) {
          found.push(here);
        } else if (value && typeof value === "object") {
          // A masked KPI object: current/previous/delta must all be null.
          for (const field of ["current", "previous", "delta", "deltaPercent"]) {
            if (isNumericLeak(value[field])) found.push(`${here}.${field}`);
          }
        }
        continue;
      }
      if (value && typeof value === "object") walk(value, `${here}.`);
    }
  };

  walk(payload);
  return found;
};
