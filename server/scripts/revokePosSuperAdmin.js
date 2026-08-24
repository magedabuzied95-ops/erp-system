/**
 * Clear `is_super_admin` from POS-shaped user accounts.
 *
 * Dry run by default. Nothing is written without `--apply`.
 *
 *   node server/scripts/revokePosSuperAdmin.js               # report only
 *   node server/scripts/revokePosSuperAdmin.js --apply       # clear the flag
 *   node server/scripts/revokePosSuperAdmin.js --users=49    # target explicitly
 *
 * WHAT THIS FIXES, AND WHY THE ROLE AUDIT COULD NOT SEE IT
 *
 * `auditReportsGrants.js` answers "which ROLES hold a sensitive grant". On production the
 * answer was "no cashier role does" — and that was true. The Cashier role held exactly
 * its 22 POS permissions, with no `reports.*` and no `accounting.view`.
 *
 * The cashier USER still reached everything, because `users.is_super_admin` was TRUE.
 * That flag short-circuits BOTH permission layers before any grant row is consulted:
 *
 *   permissionMiddleware      -> every permit() passes
 *   analyticsScope            -> { view, cost, profit, customers } all true
 *   resolveAnalyticsTenantId  -> returns null, meaning EVERY TENANT
 *
 * So the flag did not merely expose the profit and loss: it removed tenant isolation for
 * that account. Revoking a grant would have changed nothing, because no grant was ever
 * the reason.
 *
 * SAFETY
 *
 * - Only users whose role resolves to a POS shape (cashier / pos cashier / pos) are
 *   considered. An admin-shaped user is never touched, whatever else matches.
 * - The pre-change value of every affected row is printed before the write, so the
 *   change can be reversed by hand from the transcript alone.
 * - Only the `is_super_admin` column is written. Roles, grants and every other column are
 *   left exactly as they are — the cashier's POS permissions come from their role and
 *   must keep working.
 * - Idempotent: a second run reports nothing to do.
 */

import process from "node:process";

import db from "../database/db.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const usersArg = argv.find((value) => value.startsWith("--users="));
const explicitUsers = usersArg
  ? usersArg.slice("--users=".length).split(",").map((v) => Number(v.trim())).filter(Number.isFinite)
  : null;

/** Role shapes that must never hold super-admin. */
export const POS_ROLE_SHAPES = ["cashier", "pos cashier", "pos", "seller"];
/** Role shapes that legitimately do. Checked first, so an overlap can never revoke one. */
export const ADMIN_ROLE_SHAPES = ["admin", "super admin", "superadmin", "owner"];

const normalise = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

const hasColumn = async (table, column) => {
  const result = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return result.rows.length > 0;
};

const run = async () => {
  if (!(await hasColumn("users", "is_super_admin"))) {
    console.log("users.is_super_admin does not exist on this database. Nothing to do.");
    return 0;
  }
  const hasRoleId = await hasColumn("users", "role_id");
  const hasRoleSlug = await hasColumn("roles", "slug");

  const result = await db.query(
    `SELECT u.id,
            COALESCE(u.name, u.email, '')                   AS label,
            COALESCE(u.role, '')                            AS role_text,
            ${hasRoleId ? "u.role_id" : "NULL::bigint"}      AS role_id,
            COALESCE(u.is_super_admin, FALSE)               AS is_super_admin,
            u.tenant_id,
            COALESCE(r.name, '')                            AS role_name,
            ${hasRoleSlug ? "COALESCE(r.slug, '')" : "''"}   AS role_slug
       FROM users u
       ${hasRoleId ? "LEFT JOIN roles r ON r.id = u.role_id" : "LEFT JOIN roles r ON FALSE"}
      WHERE COALESCE(u.is_super_admin, FALSE) = TRUE
      ORDER BY u.id`
  );

  const classify = (row) => {
    const shapes = [normalise(row.role_text), normalise(row.role_name), normalise(row.role_slug)].filter(Boolean);
    // Admin wins outright: an account that is admin by any of its names is never a
    // candidate, even if another of its names happens to look like a till.
    if (shapes.some((shape) => ADMIN_ROLE_SHAPES.includes(shape))) return "admin";
    if (shapes.some((shape) => POS_ROLE_SHAPES.includes(shape))) return "pos";
    return "other";
  };

  const superAdmins = result.rows.map((row) => ({ ...row, shape: classify(row) }));
  const targets = superAdmins.filter(
    (row) => row.shape === "pos" && (!explicitUsers || explicitUsers.includes(Number(row.id)))
  );

  console.log(`\n${superAdmins.length} user(s) currently hold is_super_admin:\n`);
  for (const row of superAdmins) {
    const marker = row.shape === "pos" ? "  >>" : "    ";
    console.log(
      `${marker} #${String(row.id).padEnd(4)} ${String(row.label).slice(0, 24).padEnd(25)} ` +
        `role="${row.role_text}"${row.role_name ? ` -> "${row.role_name}"` : ""} tenant=${row.tenant_id ?? "-"} [${row.shape}]`
    );
  }

  if (!targets.length) {
    console.log(`\nNo POS-shaped account holds is_super_admin. Nothing to do.`);
    if (superAdmins.some((row) => row.shape === "other")) {
      console.log(
        `\nNOTE: ${superAdmins.filter((r) => r.shape === "other").length} account(s) hold it with a role this` +
          ` script does not classify. They are reported, never touched — deciding about them is a` +
          ` judgement call, not a rule.`
      );
    }
    return 0;
  }

  console.log(`\n${targets.length} POS-shaped account(s) hold super-admin, which grants:`);
  console.log(`  - every permit() check, including accounting.view -> P&L, ledgers, trial balance, balance sheet`);
  console.log(`  - reports:view, reports:cost and reports:profit inside the Reporting Center`);
  console.log(`  - tenant scope NULL, meaning every tenant's data, not just their own`);
  console.log(`\nBefore state, for reversal:`);
  for (const row of targets) {
    console.log(`  UPDATE users SET is_super_admin = TRUE WHERE id = ${row.id};   -- was: ${row.is_super_admin}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN. Re-run with --apply to clear the flag on ${targets.length} account(s).`);
    return 0;
  }

  const ids = targets.map((row) => Number(row.id));
  const updated = await db.query(
    `UPDATE users SET is_super_admin = FALSE WHERE id = ANY($1::bigint[]) RETURNING id`,
    [ids]
  );

  console.log(`\nCleared is_super_admin on ${updated.rowCount} account(s): ${updated.rows.map((r) => `#${r.id}`).join(", ")}`);
  console.log(`Their ROLE permissions are untouched, so the till keeps working.`);
  console.log(`Affected users pick this up on their next page load — the app re-reads /auth/me on mount.`);

  const after = await db.query(
    `SELECT id, COALESCE(is_super_admin, FALSE) AS is_super_admin FROM users WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [ids]
  );
  console.log(`\nVerified after write:`);
  after.rows.forEach((row) => console.log(`  #${row.id} is_super_admin = ${row.is_super_admin}`));

  return 0;
};

run()
  .then(async (code) => {
    await db.end?.();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error("revokePosSuperAdmin failed:", error);
    await db.end?.();
    process.exit(1);
  });
