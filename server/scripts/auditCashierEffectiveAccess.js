/**
 * Who can actually reach the financial reports, resolved the way the SERVER resolves it.
 *
 * READ ONLY. Every statement here is a SELECT. Nothing is written under any flag.
 *
 *   node server/scripts/auditCashierEffectiveAccess.js
 *   node server/scripts/auditCashierEffectiveAccess.js --json
 *
 * WHY THIS EXISTS SEPARATELY FROM auditReportsGrants.js
 *
 * That script answers "which ROLES hold a sensitive grant", joining users on
 * `users.role_id`. On production every role came back with users=0, which is not
 * plausible for a live shop — it means the link between a user and their permissions is
 * not (only) `role_id`, and a report that counts nobody is a report that proves nothing.
 *
 * So this script starts from the USER and reproduces permissionMiddleware's actual
 * resolution order, including the paths that bypass `role_permissions` entirely:
 *
 *   1. is_super_admin / an admin-shaped role name  -> everything, no grant rows needed
 *   2. a wildcard permission row                    -> everything
 *   3. role_permissions via users.role_id           -> what the other script measures
 *   4. role_permissions via users.role matched by NAME or SLUG, for installations where
 *      role_id was never populated
 *
 * A cashier who reaches the P&L through path 1 or 4 is invisible to a role-only audit.
 */

import process from "node:process";

import db from "../database/db.js";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");

/** The grants that unlock a financial report. Same set the revoke script targets. */
const SENSITIVE = [
  { module: "reports", action: null, why: "the whole Reports Center" },
  { module: "accounting", action: "view", why: "P&L, ledgers, trial balance, balance sheet" },
];

const ADMIN_ROLE_NAMES = ["admin", "super_admin", "super admin", "superadmin", "owner"];
const POS_ROLE_NAMES = ["cashier", "pos cashier", "pos", "seller", "sales agent"];

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
  const columns = {
    roleId: await hasColumn("users", "role_id"),
    role: await hasColumn("users", "role"),
    superAdmin: await hasColumn("users", "is_super_admin"),
    tenant: await hasColumn("users", "tenant_id"),
    active: await hasColumn("users", "is_active"),
    roleSlug: await hasColumn("roles", "slug"),
    // `users` has grown different naming columns across installations, so the label is
    // assembled from whichever exist rather than assumed.
    name: await hasColumn("users", "name"),
    username: await hasColumn("users", "username"),
    fullName: await hasColumn("users", "full_name"),
    email: await hasColumn("users", "email"),
  };

  const labelParts = ["name", "fullName", "username", "email"]
    .filter((key) => columns[key])
    .map((key) => `u.${key === "fullName" ? "full_name" : key}`);
  const labelExpr = labelParts.length ? `COALESCE(${labelParts.join(", ")}, '')` : `''`;

  const users = await db.query(
    `SELECT u.id,
            ${labelExpr}                                       AS label,
            ${columns.role ? "COALESCE(u.role, '')" : "''"}    AS role_text,
            ${columns.roleId ? "u.role_id" : "NULL::bigint"}   AS role_id,
            ${columns.superAdmin ? "COALESCE(u.is_super_admin, FALSE)" : "FALSE"} AS is_super_admin,
            ${columns.tenant ? "u.tenant_id" : "NULL::bigint"} AS tenant_id,
            ${columns.active ? "COALESCE(u.is_active, TRUE)" : "TRUE"} AS is_active
       FROM users u
      ORDER BY u.id`
  );

  const roles = await db.query(
    `SELECT r.id,
            COALESCE(r.name, '')                        AS name,
            ${columns.roleSlug ? "COALESCE(r.slug, '')" : "''"} AS slug
       FROM roles r`
  );

  const grants = await db.query(
    `SELECT rp.role_id, p.module, p.action
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id`
  );

  const grantsByRole = new Map();
  for (const row of grants.rows) {
    const list = grantsByRole.get(String(row.role_id)) || [];
    list.push(`${String(row.module).toLowerCase()}:${String(row.action).toLowerCase()}`);
    grantsByRole.set(String(row.role_id), list);
  }

  // Name and slug both index into the same role, because an installation that never
  // populated role_id still stores something recognisable in users.role.
  const roleByKey = new Map();
  for (const role of roles.rows) {
    roleByKey.set(`id:${role.id}`, role);
    if (role.name) roleByKey.set(`name:${normalise(role.name)}`, role);
    if (role.slug) roleByKey.set(`slug:${normalise(role.slug)}`, role);
  }

  const matchesSensitive = (permission) =>
    SENSITIVE.some((entry) => {
      const [module, action] = permission.split(":");
      return module === entry.module && (entry.action === null || action === entry.action);
    });

  const resolved = users.rows.map((user) => {
    const roleText = normalise(user.role_text);
    const linkedRole =
      (user.role_id != null ? roleByKey.get(`id:${user.role_id}`) : null) ||
      roleByKey.get(`slug:${roleText}`) ||
      roleByKey.get(`name:${roleText}`) ||
      null;

    const linkVia = user.role_id != null && roleByKey.get(`id:${user.role_id}`)
      ? "role_id"
      : linkedRole
        ? "role text"
        : "none";

    const rowGrants = linkedRole ? grantsByRole.get(String(linkedRole.id)) || [] : [];
    const wildcard = rowGrants.some((g) => g.startsWith("*:") || g.endsWith(":*") || g === "*:*");
    const adminShaped = user.is_super_admin || ADMIN_ROLE_NAMES.includes(roleText) ||
      (linkedRole ? ADMIN_ROLE_NAMES.includes(normalise(linkedRole.name)) : false);

    const sensitiveHeld = rowGrants.filter(matchesSensitive);

    let path = "none";
    if (adminShaped) path = "admin short-circuit";
    else if (wildcard) path = "wildcard grant";
    else if (sensitiveHeld.length) path = `role_permissions via ${linkVia}`;

    // A disabled account reaches nothing, whatever its grants say. `is_active = FALSE` is
    // enforced at login (403 before a token is issued) AND on every authenticated request
    // (403 even with a token issued earlier), so the grants below it are inert. Reporting
    // it as reaching the financial reports would overstate the exposure and bury the
    // accounts that genuinely do.
    if (user.is_active === false && path !== "none") path = `disabled (would be: ${path})`;

    return {
      userId: user.id,
      label: user.label,
      tenantId: user.tenant_id,
      active: user.is_active,
      roleText: user.role_text,
      roleId: user.role_id,
      resolvedRole: linkedRole ? `${linkedRole.name}${linkedRole.slug ? ` (${linkedRole.slug})` : ""}` : null,
      linkVia,
      isPosShaped: POS_ROLE_NAMES.includes(roleText) || (linkedRole ? POS_ROLE_NAMES.includes(normalise(linkedRole.name)) : false),
      reachesFinancialReports: path !== "none" && !path.startsWith("disabled"),
      path,
      sensitiveGrants: [...new Set(sensitiveHeld)].sort(),
    };
  });

  const posReaching = resolved.filter((u) => u.isPosShaped && u.reachesFinancialReports);
  const orphaned = resolved.filter((u) => u.linkVia === "none" && !u.isPosShaped);

  if (asJson) {
    console.log(JSON.stringify({ columns, users: resolved, posReaching }, null, 2));
    return posReaching.length;
  }

  console.log(`\nEffective financial-report access, resolved per USER (${resolved.length} user(s))\n`);
  console.log("  user                          role            link       login  reaches?  via");
  console.log("  " + "-".repeat(96));
  for (const user of resolved) {
    const mark = user.reachesFinancialReports ? (user.isPosShaped ? " >> " : "    ") : "    ";
    console.log(
      `${mark}#${String(user.userId).padEnd(4)} ${String(user.label).slice(0, 22).padEnd(23)} ` +
        `${String(user.roleText || "-").slice(0, 14).padEnd(15)} ${user.linkVia.padEnd(10)} ` +
        `${(user.active === false ? "OFF" : "on ").padEnd(6)} ` +
        `${user.reachesFinancialReports ? "YES" : "no "}       ${user.path}`
    );
  }

  const disabled = resolved.filter((user) => user.active === false);
  if (disabled.length) {
    console.log(
      `\n${disabled.length} account(s) are disabled (is_active = FALSE) and reach nothing, whatever` +
        ` their\ngrants say — the flag is enforced at login and on every authenticated request:`
    );
    for (const user of disabled) console.log(`  #${user.userId} ${user.label}`);
  }

  console.log("");
  if (posReaching.length) {
    console.log(`${posReaching.length} POS-shaped user(s) can reach the financial reports:`);
    for (const user of posReaching) {
      console.log(`  #${user.userId} ${user.label} — via ${user.path}${user.sensitiveGrants.length ? ` :: ${user.sensitiveGrants.join(", ")}` : ""}`);
    }
  } else {
    console.log("No POS-shaped user reaches the financial reports.");
  }

  if (orphaned.length) {
    console.log(
      `\n${orphaned.length} user(s) resolve to NO role at all, so they hold only what the` +
        ` admin short-circuit or a wildcard gives them. Listed for completeness:`
    );
    for (const user of orphaned.slice(0, 20)) {
      console.log(`  #${user.userId} ${user.label} (role text: "${user.roleText || "-"}") -> ${user.path}`);
    }
  }

  return posReaching.length;
};

run()
  .then(async (offenders) => {
    await db.end?.();
    process.exit(offenders ? 2 : 0);
  })
  .catch(async (error) => {
    console.error("auditCashierEffectiveAccess failed:", error);
    await db.end?.();
    process.exit(1);
  });
