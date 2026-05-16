import db from "../database/db.js";
import process from "node:process";

const requiredPermissions = [
  ["products", "view"],
  ["customers", "view"],
  ["customers", "create"],
  ["attendance", "view"],
  ["pos", "view"],
  ["pos", "sell"],
  ["orders", "create"],
  ["loyalty", "view"],
  ["loyalty", "redeem"],
];

const adminRoleNames = ["admin", "super_admin"];
const cashierRoleNames = ["cashier", "pos", "pos_cashier", "sales_agent"];
const legacyRoleAliases = {
  admin: "Admin",
  super_admin: "Super Admin",
  cashier: "Cashier",
  pos: "POS",
  pos_cashier: "POS Cashier",
  sales_agent: "Sales Agent",
};

const hasColumn = async (client, tableName, columnName) => {
  const result = await client.query(
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

const ensureRole = async (client, roleName) => {
  const existing = await client.query(
    `SELECT id, name FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [roleName]
  );

  if (existing.rows[0]) return existing.rows[0];

  const fallbackName = legacyRoleAliases[roleName] || roleName;
  const hasTenantId = await hasColumn(client, "roles", "tenant_id");
  const hasSlug = await hasColumn(client, "roles", "slug");
  const hasIsSystem = await hasColumn(client, "roles", "is_system");

  if (hasTenantId && hasSlug && hasIsSystem) {
    const created = await client.query(
      `
      INSERT INTO roles (tenant_id, name, slug, is_system)
      VALUES (1, $1, $2, true)
      RETURNING id, name
      `,
      [roleName, roleName]
    );
    return created.rows[0];
  }

  const created = await client.query(
    `INSERT INTO roles (name) VALUES ($1) RETURNING id, name`,
    [fallbackName]
  );
  return created.rows[0];
};

const ensurePermission = async (client, moduleName, action) => {
  const existing = await client.query(
    `
    SELECT id
    FROM permissions
    WHERE module = $1 AND action = $2
    LIMIT 1
    `,
    [moduleName, action]
  );

  if (existing.rows[0]) return existing.rows[0].id;

  const hasDescription = await hasColumn(client, "permissions", "description");

  if (hasDescription) {
    const created = await client.query(
      `
      INSERT INTO permissions (module, action, description)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [moduleName, action, `${action} ${moduleName}`]
    );
    return created.rows[0].id;
  }

  const created = await client.query(
    `
    INSERT INTO permissions (module, action)
    VALUES ($1, $2)
    RETURNING id
    `,
    [moduleName, action]
  );
  return created.rows[0].id;
};

const grantPermission = async (client, roleId, permissionId) => {
  await client.query(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT $1, $2
    WHERE NOT EXISTS (
      SELECT 1
      FROM role_permissions
      WHERE role_id = $1 AND permission_id = $2
    )
    `,
    [roleId, permissionId]
  );
};

const assignExistingUsers = async (client, roleName, roleId) => {
  const aliases = [roleName, legacyRoleAliases[roleName]].filter(Boolean);

  await client.query(
    `
    UPDATE users
    SET role_id = $1
    WHERE role_id IS NULL
      AND LOWER(COALESCE(role, '')) = ANY($2::text[])
    `,
    [roleId, aliases.map((alias) => alias.toLowerCase())]
  );
};

const run = async () => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const roleResults = new Map();

    for (const roleName of [...adminRoleNames, ...cashierRoleNames]) {
      roleResults.set(roleName, await ensureRole(client, roleName));
    }

    const permissionIds = [];
    for (const [moduleName, action] of requiredPermissions) {
      permissionIds.push(await ensurePermission(client, moduleName, action));
    }

    for (const roleName of adminRoleNames) {
      const role = roleResults.get(roleName);
      for (const permissionId of permissionIds) {
        await grantPermission(client, role.id, permissionId);
      }
      await assignExistingUsers(client, roleName, role.id);
    }

    for (const roleName of cashierRoleNames) {
      const role = roleResults.get(roleName);
      for (const permissionId of permissionIds) {
        await grantPermission(client, role.id, permissionId);
      }
      await assignExistingUsers(client, roleName, role.id);
    }

    await client.query("COMMIT");
    console.log("POS RBAC permissions seeded.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POS RBAC seed failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

run();
