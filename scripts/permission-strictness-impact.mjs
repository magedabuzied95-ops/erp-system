#!/usr/bin/env node
/*
 * Blast radius of qualified-only permission matching.
 *
 * `permissionAliases` used to add the bare module name AND the bare action to
 * every alias set, and `permit` allows a request when the requested set and a
 * held permission's set intersect. That made two unrelated grants match:
 *
 *   orders:view      satisfies  orders:delete      (same module, any action)
 *   products:view    satisfies  customers:view     (any module, same action)
 *
 * Closing it is correct, but it re-gates every screen in the ERP at once, so the
 * change has to be measured before it ships rather than discovered by a cashier
 * who can no longer open a till.
 *
 * This script answers one question per role: which endpoints did that role reach
 * ONLY because of the loose rule? Those are the requests that will start
 * returning 403.
 *
 *   node scripts/permission-strictness-impact.mjs
 *   node scripts/permission-strictness-impact.mjs --roles roles.json
 *
 * Without --roles it uses DEFAULT_ROLES from the permission matrix, which is what
 * a freshly seeded tenant has. Real tenants edit their roles, so for a
 * production answer dump the live grants and pass them in:
 *
 *   SELECT r.name, p.module, p.action
 *   FROM roles r
 *   JOIN role_permissions rp ON rp.role_id = r.id
 *   JOIN permissions p ON p.id = rp.permission_id
 *
 * as [{"role":"Cashier","permissions":["orders.view","pos.create"]}, ...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { permissionSatisfies } from "../server/middleware/permissionMiddleware.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ADMIN_ROLES = new Set(["admin", "super admin", "superadmin", "super_admin"]);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
};

/** Every (module, action) pair guarded anywhere on the server. */
const guardedPermissions = () => {
  const found = new Map();
  for (const file of walk(path.join(root, "server"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/permit\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)) {
      const key = `${match[1].toLowerCase()}:${match[2].toLowerCase()}`;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(path.relative(root, file).replace(/\\/g, "/"));
    }
  }
  return found;
};

const loadDefaultRoles = () => {
  // The matrix is browser code (it imports lucide icons), so the role templates
  // are read as text rather than imported.
  const source = fs.readFileSync(path.join(root, "src/modules/permissions/lib/rbacStore.js"), "utf8");
  const roles = [];
  for (const match of source.matchAll(/\{\s*\n\s*id: "([a-z_]+)",\s*\n\s*name: "([^"]+)",/g)) {
    roles.push({ id: match[1], name: match[2] });
  }
  return roles;
};

const parseArgs = () => {
  const index = process.argv.indexOf("--roles");
  return index === -1 ? null : process.argv[index + 1];
};

const rolesFile = parseArgs();
let roles;
if (rolesFile) {
  roles = JSON.parse(fs.readFileSync(rolesFile, "utf8")).map((entry) => ({
    name: entry.role || entry.name,
    permissions: entry.permissions || [],
  }));
} else {
  console.log("No --roles dump given: using DEFAULT_ROLES from the permission matrix.");
  console.log("Real tenants edit their roles — pass a dump for a production answer.\n");
  const { DEFAULT_ROLES } = await import("../src/modules/permissions/lib/rbacStore.js").catch(() => ({}));
  if (!DEFAULT_ROLES) {
    console.log("The matrix could not be imported directly (it is browser code).");
    console.log("Detected role templates:", loadDefaultRoles().map((r) => r.name).join(", "));
    console.log("\nRun with --roles <dump.json> to measure real grants.");
    process.exit(0);
  }
  roles = DEFAULT_ROLES.map((role) => ({ name: role.name, permissions: role.permissions }));
}

const guarded = guardedPermissions();
console.log(`Guarded permissions found on the server: ${guarded.size}\n`);

const splitPermission = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/:/g, ".");
  const at = normalized.lastIndexOf(".");
  return at === -1 ? [normalized, ""] : [normalized.slice(0, at), normalized.slice(at + 1)];
};

let totalLosses = 0;
for (const role of roles) {
  const name = String(role.name || "").toLowerCase();
  if (ADMIN_ROLES.has(name.replace(/_/g, " ")) || role.permissions.includes("*")) {
    console.log(`${role.name}: bypasses permit() entirely (admin/wildcard) — unaffected.`);
    continue;
  }
  const held = role.permissions.map(splitPermission).filter(([m, a]) => m && a);
  const lost = [];
  for (const [key, files] of guarded) {
    const [wantModule, wantAction] = key.split(":");
    const loose = held.some(([m, a]) => permissionSatisfies(m, a, wantModule, wantAction, { legacy: true }));
    const canonical = held.some(([m, a]) => permissionSatisfies(m, a, wantModule, wantAction));
    if (loose && !canonical) lost.push({ key, files: [...files] });
  }
  totalLosses += lost.length;
  console.log(`\n${role.name}: ${lost.length} permission(s) reached ONLY through the loose rule`);
  for (const item of lost.slice(0, 40)) {
    console.log(`  - ${item.key}   (${item.files.slice(0, 2).join(", ")}${item.files.length > 2 ? ", …" : ""})`);
  }
  if (lost.length > 40) console.log(`  … and ${lost.length - 40} more`);
}

console.log(`\nTotal (role, permission) pairs that change: ${totalLosses}`);
console.log("Each one is either a grant that was never intended — most of these are —");
console.log("or a grant the shop depends on, which now has to be explicit.");
console.log("\nAfter deploying, a request denied this way logs:");
console.log('  [permission] denied by canonical matching (was allowed by the legacy alias rule)');
console.log("naming the role and the exact permission to grant. To roll back without a");
console.log("deploy: PERMISSION_LEGACY_ALIASES=true, then recreate the backend.");

if (process.argv.includes("--sql")) {
  /*
   * Turning the list into a reviewable statement.
   *
   * NOT executed and NOT auto-generated into a migration: which of these a role
   * SHOULD have is a policy decision about the shop, not something a script can
   * infer from the fact that a bug used to allow it. Read it, delete the lines
   * that were never meant to be granted, then run what is left.
   */
  console.log("\n\n-- Review each line. Delete anything the role was never meant to have.");
  console.log("-- These are the permissions the loose rule was silently supplying.");
  for (const role of roles) {
    const name = String(role.name || "").toLowerCase();
    if (ADMIN_ROLES.has(name.replace(/_/g, " ")) || role.permissions.includes("*")) continue;
    console.log(`\n-- ${role.name}`);
    const held = role.permissions.map(splitPermission).filter(([m, a]) => m && a);
    for (const [key] of guarded) {
      const [wantModule, wantAction] = key.split(":");
      const loose = held.some(([m, a]) => permissionSatisfies(m, a, wantModule, wantAction, { legacy: true }));
      const canonical = held.some(([m, a]) => permissionSatisfies(m, a, wantModule, wantAction));
      if (!loose || canonical) continue;
      console.log(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p ` +
        `WHERE LOWER(r.name) = ${JSON.stringify(String(role.name).toLowerCase()).replace(/"/g, "'")} ` +
        `AND p.module = '${wantModule}' AND p.action = '${wantAction}' ` +
        `AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);`
      );
    }
  }
}
