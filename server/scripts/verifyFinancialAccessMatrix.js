/**
 * Ask permit()'s own decision procedure, against live data: can THIS user reach THAT
 * financial endpoint?
 *
 *   node server/scripts/verifyFinancialAccessMatrix.js
 *   node server/scripts/verifyFinancialAccessMatrix.js --json
 *
 * READ ONLY. Every statement is a SELECT.
 *
 * WHY REPRODUCE THE MIDDLEWARE RATHER THAN CALL THE API
 *
 * Proving "a cashier cannot open the P&L" by logging in as the cashier would mean
 * handling their password. This instead runs the SAME query permissionMiddleware runs and
 * applies the SAME four decisions in the SAME order — admin role name, super-admin flag,
 * wildcard row, then canonical alias matching via the exported `permissionSatisfies`. The
 * alias matcher is imported, not reimplemented, so it cannot drift from the real one.
 *
 * A row reading DENIED here means the API would answer 403 for that user on that endpoint.
 */

import process from "node:process";

import db from "../database/db.js";
import { isSuperAdminUser } from "../utils/requestScope.js";
import { permissionSatisfies } from "../middleware/permissionMiddleware.js";

const asJson = process.argv.slice(2).includes("--json");

/** Mirrors ADMIN_ROLES / normalizeRoleValue in permissionMiddleware. */
const ADMIN_ROLES = ["admin", "super_admin", "super admin", "superadmin", "owner"];
const normaliseRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
const isAdminRole = (value = "") => ADMIN_ROLES.some((role) => normaliseRole(role) === normaliseRole(value));

/**
 * The endpoints the closure audit has to speak to, each with the permission its route
 * actually declares. Read off server/routes/*.js — not guessed, and not a summary of what
 * the page looks like.
 */
const FINANCIAL_SURFACE = [
  { label: "Profit & loss", endpoint: "GET /api/accounting/financial-reports/profit-loss", module: "accounting", action: "view" },
  { label: "Trial balance", endpoint: "GET /api/accounting/financial-reports/trial-balance", module: "accounting", action: "view" },
  { label: "Balance sheet", endpoint: "GET /api/accounting/financial-reports/balance-sheet", module: "accounting", action: "view" },
  { label: "General ledger", endpoint: "GET /api/accounting/general-ledger", module: "accounting", action: "view" },
  { label: "Chart of accounts", endpoint: "GET /api/accounting/accounts", module: "accounting", action: "view" },
  { label: "Journal entries", endpoint: "GET /api/accounting/journal-entries", module: "accounting", action: "view" },
  { label: "Audit trail", endpoint: "GET /api/accounting/audit-trail", module: "accounting", action: "view" },
  { label: "Treasury dashboard", endpoint: "GET /api/accounting/treasury/*", module: "treasury.dashboard", action: "view" },
  { label: "Money accounts", endpoint: "GET /api/accounting/money-accounts", module: "money_accounts", action: "view" },
  { label: "Money transactions", endpoint: "GET /api/accounting/money-transactions", module: "money_transactions", action: "view" },
  { label: "Reconciliation", endpoint: "GET /api/analytics/v2/reconciliation", module: "reports", action: "view" },
  { label: "Executive overview", endpoint: "GET /api/analytics/v2/overview", module: "reports", action: "view" },
  { label: "Sales intelligence", endpoint: "GET /api/analytics/v2/sales/summary", module: "reports", action: "view" },
  { label: "Employee intelligence", endpoint: "GET /api/analytics/v2/employees/summary", module: "reports", action: "view" },
  { label: "Legacy reports", endpoint: "GET /api/reports/*", module: "reports", action: "view" },
  { label: "Cost columns in exports", endpoint: "(column gate inside every report)", module: "reports", action: "cost" },
  { label: "Profit columns in exports", endpoint: "(column gate inside every report)", module: "reports", action: "profit" },
];

/** Kept alongside so a denial can be read as "and the till still works". */
const POS_SURFACE = [
  { label: "Ring up a sale", endpoint: "POST /api/orders", module: "orders", action: "create" },
  { label: "Read the catalog", endpoint: "GET /api/products", module: "products", action: "view" },
  { label: "Quick customer", endpoint: "POST /api/customers", module: "customers", action: "create" },
  { label: "POS shell", endpoint: "GET /api/pos/*", module: "pos", action: "view" },
  { label: "POS expense", endpoint: "POST /api/pos/expenses", module: "pos.expenses", action: "create" },
  { label: "Attendance check-in", endpoint: "POST /api/attendance", module: "attendance", action: "create" },
];

/** The same query permissionMiddleware issues, for the same reason. */
const loadUser = async (userId) => {
  const result = await db.query(
    `
    SELECT DISTINCT
      p.module,
      p.action,
      COALESCE(r.name, '')              AS role_name,
      COALESCE(u.role, '')              AS user_role,
      COALESCE(u.is_super_admin, FALSE) AS is_super_admin,
      COALESCE(u.is_active, TRUE)       AS is_active,
      u.name                            AS label
    FROM users u
    LEFT JOIN roles r            ON u.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p       ON p.id = rp.permission_id
    WHERE u.id = $1
    `,
    [userId]
  );
  return result.rows;
};

const decide = (rows, want) => {
  const first = rows[0] || {};

  // authMiddleware refuses a disabled account with 403 before any route runs, so the
  // permission question never gets asked. Reported first, because it outranks everything.
  if (first.is_active === false) return { allowed: false, why: "account disabled" };

  const role = first.role_name || first.user_role || "unknown";
  if (isAdminRole(role)) return { allowed: true, why: "admin role name" };
  if (isSuperAdminUser({ is_super_admin: first.is_super_admin })) return { allowed: true, why: "is_super_admin" };
  if (rows.some((row) => row.module === "*" || row.action === "*")) return { allowed: true, why: "wildcard grant" };

  const held = rows.filter((row) => row.module && row.action);
  const match = held.find((row) => permissionSatisfies(row.module, row.action, want.module, want.action));
  return match
    ? { allowed: true, why: `grant ${match.module}.${match.action}` }
    : { allowed: false, why: `no grant for ${want.module}.${want.action}` };
};

const run = async () => {
  const targets = await db.query(
    `SELECT u.id, COALESCE(u.name, '') AS name, COALESCE(r.name, u.role, '') AS role
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE LOWER(REGEXP_REPLACE(TRIM(COALESCE(r.name, u.role, '')), '[_-]+', ' ', 'g'))
            IN ('cashier', 'pos cashier', 'pos', 'seller', 'admin', 'owner', 'super admin')
      ORDER BY u.id`
  );

  const report = [];
  for (const target of targets.rows) {
    const rows = await loadUser(target.id);
    const financial = FINANCIAL_SURFACE.map((entry) => ({ ...entry, ...decide(rows, entry) }));
    const pos = POS_SURFACE.map((entry) => ({ ...entry, ...decide(rows, entry) }));
    report.push({ ...target, active: rows[0]?.is_active !== false, financial, pos });
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  for (const user of report) {
    const denied = user.financial.filter((entry) => !entry.allowed).length;
    const posOk = user.pos.filter((entry) => entry.allowed).length;
    console.log(`\n#${user.id} ${user.name} — role "${user.role}"${user.active ? "" : "  [DISABLED]"}`);
    console.log(`  financial surface: ${user.financial.length - denied} allowed / ${denied} denied`);
    console.log(`  POS surface:       ${posOk} allowed / ${user.pos.length - posOk} denied`);
    for (const entry of user.financial) {
      console.log(`    ${entry.allowed ? "ALLOW " : "DENIED"}  ${entry.label.padEnd(24)} ${entry.why}`);
    }
    for (const entry of user.pos) {
      console.log(`    ${entry.allowed ? "ALLOW " : "DENIED"}  ${("POS: " + entry.label).padEnd(24)} ${entry.why}`);
    }
  }

  const posUsers = report.filter((user) => /cashier|pos|seller/i.test(user.role));
  const leaking = posUsers.filter((user) => user.financial.some((entry) => entry.allowed));
  const brokenTills = posUsers.filter((user) => user.active && user.pos.some((entry) => !entry.allowed));

  console.log("\n" + "=".repeat(78));
  console.log(
    leaking.length
      ? `FAIL: ${leaking.length} POS-shaped user(s) can reach a financial endpoint.`
      : `PASS: no POS-shaped user can reach any of the ${FINANCIAL_SURFACE.length} financial endpoints.`
  );
  console.log(
    brokenTills.length
      ? `WARN: ${brokenTills.length} active POS user(s) are missing a permission the till needs.`
      : "PASS: every active POS user still holds everything the till needs."
  );
  console.log("=".repeat(78));

  return leaking.length + brokenTills.length;
};

run()
  .then(async (problems) => {
    await db.end?.().catch(() => {});
    process.exit(typeof problems === "number" && problems > 0 ? 2 : 0);
  })
  .catch(async (error) => {
    console.error("verifyFinancialAccessMatrix failed:", error);
    await db.end?.().catch(() => {});
    process.exit(1);
  });
