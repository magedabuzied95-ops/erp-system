/**
 * Audit — and optionally revoke — reporting and financial-report grants held by
 * POS-facing roles.
 *
 * `reports.view` is not a small permission: it unlocks every endpoint behind
 * `permit("reports", "view")`, which is the whole Reports Center — company
 * revenue, expenses, profit, payroll/employee reports, customer intelligence
 * and the AI insights built on top of them. The server-side Cashier preset in
 * services/rolesService.js never grants it, but the browser-side preset used to,
 * so a role seeded or reset from the Roles screen could pick it up.
 *
 * `accounting.view` is audited alongside them. It is not a reporting permission by
 * name, but it gates /financial-reports/{summary,profit-loss,ledgers,trial-balance,
 * balance-sheet} — so a role holding it can pull the company P&L whether or not it
 * holds anything under `reports`. Both Cashier presets used to grant it.
 *
 * Read-only by default. Nothing is written without `--apply`.
 *
 *   node server/scripts/auditReportsGrants.js            # report only
 *   node server/scripts/auditReportsGrants.js --apply    # revoke
 *   node server/scripts/auditReportsGrants.js --apply --roles=cashier,pos_cashier
 *   node server/scripts/auditReportsGrants.js --all      # every role, not just POS ones
 */

import process from "node:process";

import db from "../database/db.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const listEveryRole = argv.includes("--all");

/**
 * What counts as a sensitive grant.
 *
 * An entry with no action covers the whole module. Kept as data so the report, the
 * DELETE and the console labels cannot end up describing different sets.
 */
const TARGET_GRANTS = [
  { module: "reports" },
  { module: "accounting", action: "view" },
];

const grantFilterSql = TARGET_GRANTS.map((grant) =>
  grant.action ? `(p.module = '${grant.module}' AND p.action = '${grant.action}')` : `p.module = '${grant.module}'`
).join(" OR ");

const grantLabel = TARGET_GRANTS.map((grant) => `${grant.module}.${grant.action || "*"}`).join(" / ");

const rolesArg = argv.find((value) => value.startsWith("--roles="));
const DEFAULT_TARGET_ROLES = ["cashier", "pos cashier", "pos"];
const targetRoles = rolesArg
  ? rolesArg
      .slice("--roles=".length)
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/[_-]+/g, " "))
      .filter(Boolean)
  : DEFAULT_TARGET_ROLES;

/* `roles` has picked up columns over time; only `name` is guaranteed. */
const hasColumn = async (tableName, columnName) => {
  const result = await db.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return result.rows.length > 0;
};

const run = async () => {
  const hasSlug = await hasColumn("roles", "slug");
  const hasTenant = await hasColumn("roles", "tenant_id");

  const slugSelect = hasSlug ? "COALESCE(r.slug, '')" : "''";
  const tenantSelect = hasTenant ? "r.tenant_id" : "NULL::bigint";

  const grants = await db.query(
    `
    SELECT
      r.id            AS role_id,
      COALESCE(r.name, '') AS role_name,
      ${slugSelect}   AS role_slug,
      ${tenantSelect} AS tenant_id,
      p.id            AS permission_id,
      p.module,
      p.action,
      (
        SELECT COUNT(*)::int
        FROM users u
        WHERE u.role_id = r.id
      ) AS user_count
    FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ${grantFilterSql}
    ORDER BY r.id, p.module, p.action
    `
  );

  if (!grants.rows.length) {
    console.log(`No role holds any of: ${grantLabel}.`);
    return;
  }

  const normalize = (value = "") =>
    String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

  const isTarget = (row) =>
    targetRoles.includes(normalize(row.role_name)) || targetRoles.includes(normalize(row.role_slug));

  const byRole = new Map();
  grants.rows.forEach((row) => {
    const entry = byRole.get(row.role_id) || { ...row, actions: [], permissionIds: [] };
    entry.actions.push(`${row.module}.${row.action}`);
    entry.permissionIds.push(row.permission_id);
    byRole.set(row.role_id, entry);
  });

  const rows = Array.from(byRole.values());
  const flagged = rows.filter(isTarget);

  console.log(`${grantLabel} grants across ${rows.length} role(s):\n`);
  rows.forEach((row) => {
    if (!listEveryRole && !isTarget(row)) return;
    const marker = isTarget(row) ? "  >>" : "    ";
    const tenant = row.tenant_id == null ? "-" : row.tenant_id;
    console.log(
      `${marker} role #${row.role_id} "${row.role_name}"${row.role_slug ? ` (${row.role_slug})` : ""}` +
        ` tenant=${tenant} users=${row.user_count} :: ${row.actions.join(", ")}`
    );
  });

  if (!listEveryRole) {
    console.log(
      `\n(${rows.length - flagged.length} other role(s) also hold one of these — re-run with --all to list them.)`
    );
  }

  if (!flagged.length) {
    console.log(`\nNone of the targeted roles (${targetRoles.join(", ")}) hold ${grantLabel}. Nothing to revoke.`);
    return;
  }

  const affectedUsers = flagged.reduce((total, row) => total + Number(row.user_count || 0), 0);

  if (!apply) {
    console.log(
      `\nDRY RUN. ${flagged.length} targeted role(s), ${affectedUsers} user(s) would lose ${grantLabel}.` +
        `\nRe-run with --apply to revoke.`
    );
    return;
  }

  const roleIds = flagged.map((row) => row.role_id);
  const result = await db.query(
    `
    DELETE FROM role_permissions rp
    USING permissions p
    WHERE rp.permission_id = p.id
      AND (${grantFilterSql})
      AND rp.role_id = ANY($1::bigint[])
    `,
    [roleIds]
  );

  console.log(
    `\nRevoked ${result.rowCount} grant(s) from ${flagged.length} role(s) (${affectedUsers} user(s)).` +
      `\nAffected users pick this up on their next page load: the app re-reads /auth/me on mount.` +
      `\nAn already-open tab keeps the stale permission list until it reloads.`
  );
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("auditReportsGrants failed:", error);
    process.exit(1);
  });
