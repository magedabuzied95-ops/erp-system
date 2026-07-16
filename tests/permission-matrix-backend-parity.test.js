import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const walkJs = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkJs(target) : target.endsWith(".js") ? [target] : [];
  }));
  return nested.flat();
};

const parseMatrixPermissions = (source) => {
  const block = source.match(/export const MODULE_ACTIONS = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || "";
  const permissions = new Set();
  for (const match of block.matchAll(/^\s*(?:"([^"]+)"|([a-z_]+)):\s*\[([^\]]*)\]/gm)) {
    const moduleName = match[1] || match[2];
    for (const actionMatch of match[3].matchAll(/"([^"]+)"/g)) {
      permissions.add(`${moduleName}.${actionMatch[1]}`);
    }
  }
  return permissions;
};

test("every backend permit is represented by the permission matrix", async () => {
  const matrixSource = await readFile(new URL("../src/modules/permissions/lib/rbacStore.js", import.meta.url), "utf8");
  const matrixPermissions = parseMatrixPermissions(matrixSource);
  const serverFiles = await walkJs(path.join(root, "server"));
  const backendPermissions = new Set();

  for (const file of serverFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/permit\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)) {
      backendPermissions.add(`${match[1]}.${match[2]}`.toLowerCase());
    }
  }

  const missing = [...backendPermissions].filter((permission) => !matrixPermissions.has(permission)).sort();
  assert.deepEqual(missing, [], `Backend permissions missing from matrix: ${missing.join(", ")}`);
});

test("nested permission keys preserve dotted modules and colon actions", async () => {
  const rolesSource = await readFile(new URL("../server/services/rolesService.js", import.meta.url), "utf8");
  const authSource = await readFile(new URL("../src/shared/auth/authStorage.js", import.meta.url), "utf8");

  assert.match(rolesSource, /raw\.lastIndexOf\("\."\)/);
  assert.match(rolesSource, /const \{ moduleName, action \} = splitPermissionKey\(key\)/);
  assert.doesNotMatch(authSource, /replace\(\/:\/g, "\."\)/);
});

test("users and product mutations are protected by their matrix permissions", async () => {
  const usersRoutes = await readFile(new URL("../server/routes/users.routes.js", import.meta.url), "utf8");
  const productRoutes = await readFile(new URL("../server/routes/products.js", import.meta.url), "utf8");

  assert.match(usersRoutes, /permit\("users", "edit"\)/);
  assert.doesNotMatch(usersRoutes, /requireAdminOnly/);
  assert.match(productRoutes, /router\.post\("\/", protect, permit\("products", "create"\)/);
  assert.match(productRoutes, /router\.put\("\/:id", protect, permit\("products", "edit"\)/);
  assert.match(productRoutes, /router\.delete\("\/:id", protect, permit\("products", "delete"\)/);
});
