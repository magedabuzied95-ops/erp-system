/*
 * Grant permissions to an existing role.
 *
 * Why a script and not the role seed: `ensureBuiltinRoles` short-circuits as soon
 * as the system roles exist (rolesService.js — `existingCount >= ROLE_SEED_DEFINITIONS.length`),
 * so editing a seed list only ever reaches a fresh install. A live shop's roles
 * are data, and data is changed here or from the Roles screen.
 *
 * Why anyone needs it: `permit()` now matches the canonical `module.action` only.
 * A role shaped around the old bare-module/bare-action aliasing — where
 * `products:view` quietly satisfied `permit("products","create")` — loses those
 * privileges and starts answering `Access Denied (products:create)`. Granting the
 * permission explicitly is the fix; this script makes that one reviewable step.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   node server/scripts/grantRolePermissions.js --role=Cashier
 *   node server/scripts/grantRolePermissions.js --user=cashier@example.com --apply
 *   node server/scripts/grantRolePermissions.js --role=Cashier --permissions=products.create,products.edit --apply
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(serverDir, "..");

dotenv.config({ path: path.join(serverDir, ".env"), override: false, quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false, quiet: true });

const db = (await import("../database/db.js")).default;

const DEFAULT_PERMISSIONS = ["products.create", "products.edit", "customers.edit"];

const readFlag = (name) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
};

const apply = process.argv.includes("--apply");
const roleQuery = readFlag("role");
const userQuery = readFlag("user");
const permissionList = (readFlag("permissions") || DEFAULT_PERMISSIONS.join(","))
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

/*
 * `module.action`, `module:action` and `module action` all name the same grant in
 * this codebase's data, and role names arrive spelled with either underscores,
 * hyphens or spaces. Compare on one flattened form so a real match is not missed
 * over punctuation.
 */
const splitPermission = (value = "") => {
  const normalized = String(value).replace(/:/g, ".").trim().toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot <= 0) return null;
  return { module: normalized.slice(0, lastDot), action: normalized.slice(lastDot + 1) };
};

const parsedPermissions = permissionList.map((entry) => {
  const parsed = splitPermission(entry);
  if (!parsed) {
    console.error(`[grant-role-permissions] not a "module.action" permission: ${entry}`);
    process.exit(1);
  }
  return parsed;
});

const resolveRoles = async () => {
  if (userQuery) {
    const result = await db.query(
      `
      SELECT r.id, r.name, r.slug, r.tenant_id, u.name AS user_name, u.email AS user_email
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE LOWER(u.email) = LOWER($1)
         OR LOWER(u.name) = LOWER($1)
         OR u.name ILIKE '%' || $1 || '%'
      `,
      [userQuery]
    );
    return result.rows;
  }

  const result = await db.query(
    `
    SELECT id, name, slug, tenant_id, NULL::text AS user_name, NULL::text AS user_email
    FROM roles
    WHERE LOWER(REPLACE(REPLACE(COALESCE(name, ''), '_', ' '), '-', ' ')) = LOWER(REPLACE(REPLACE($1, '_', ' '), '-', ' '))
       OR LOWER(REPLACE(REPLACE(COALESCE(slug, ''), '_', ' '), '-', ' ')) = LOWER(REPLACE(REPLACE($1, '_', ' '), '-', ' '))
    `,
    [roleQuery]
  );
  return result.rows;
};

const main = async () => {
  if (!roleQuery && !userQuery) {
    console.error("Usage: node server/scripts/grantRolePermissions.js --role=<name> | --user=<email or name> [--permissions=a.b,c.d] [--apply]");
    process.exit(1);
  }

  const roles = await resolveRoles();
  if (!roles.length) {
    console.error(`[grant-role-permissions] no role matched ${userQuery ? `user "${userQuery}"` : `role "${roleQuery}"`}`);
    process.exit(1);
  }

  console.log(`[grant-role-permissions] ${apply ? "APPLY" : "DRY RUN — nothing will be written"}`);
  console.log("[grant-role-permissions] permissions:", parsedPermissions.map((p) => `${p.module}.${p.action}`).join(", "));

  for (const role of roles) {
    const who = role.user_email ? ` (matched user ${role.user_name || ""} <${role.user_email}>)` : "";
    console.log(`\nRole #${role.id} "${role.name}" [slug=${role.slug || "-"} tenant=${role.tenant_id ?? "-"}]${who}`);

    for (const { module, action } of parsedPermissions) {
      if (apply) {
        await db.query(
          `
          INSERT INTO permissions (module, action, description)
          VALUES ($1, $2, $3)
          ON CONFLICT (module, action) DO NOTHING
          `,
          [module, action, `${action} ${module}`]
        );
      }

      const permissionRow = await db.query(
        `SELECT id FROM permissions WHERE module = $1 AND action = $2 LIMIT 1`,
        [module, action]
      );
      const permissionId = permissionRow.rows[0]?.id;

      if (!permissionId) {
        console.log(`  - ${module}.${action}: permission row missing (would be created on --apply)`);
        continue;
      }

      const held = await db.query(
        `SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2 LIMIT 1`,
        [role.id, permissionId]
      );

      if (held.rows.length) {
        console.log(`  = ${module}.${action}: already granted`);
        continue;
      }

      if (!apply) {
        console.log(`  + ${module}.${action}: would be granted`);
        continue;
      }

      await db.query(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [role.id, permissionId]
      );
      console.log(`  + ${module}.${action}: granted`);
    }
  }

  if (!apply) {
    console.log("\nRe-run with --apply to write these grants.");
  }
};

main()
  .then(() => db.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[grant-role-permissions] failed", error);
    process.exit(1);
  });
