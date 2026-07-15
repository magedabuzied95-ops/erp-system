import db from "../database/db.js";

const PERMISSION_SEPARATOR = /[.:]/;

const normalizeRoleLookup = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeSlug = (value = "") =>
  normalizeRoleLookup(value).replace(/[\s_]+/g, "-");

const isAdminRole = (role = {}) => {
  const values = [role.name, role.slug]
    .map((value) => normalizeRoleLookup(value).replace(/[\s-]+/g, "_"))
    .filter(Boolean);
  return values.some((value) => ["admin", "super_admin", "superadmin"].includes(value));
};

const withRolePermissions = (role = {}) => {
  const permissions = Array.isArray(role.permissions) ? role.permissions.filter(Boolean).map(String) : [];
  if (isAdminRole(role) && !permissions.includes("*")) {
    return { ...role, permissions: ["*", ...permissions] };
  }
  return { ...role, permissions };
};

const normalizePermissionKey = (value = "") => {
  const [moduleName, action] = String(value || "")
    .trim()
    .toLowerCase()
    .split(PERMISSION_SEPARATOR)
    .map((part) => part.trim());

  if (!moduleName || !action) return null;
  if (moduleName === "marketing" && action === "approve") return "marketing.publish";
  if (moduleName === "marketing" && action === "edit") return "marketing.update";
  return `${moduleName}.${action}`;
};

const normalizePermissionObject = (value = {}) => {
  const moduleName = value.module || value.moduleName || value.resource || value.key;
  const action = value.action || value.permission || value.operation;
  return normalizePermissionKey(`${moduleName || ""}.${action || ""}`);
};

const extractPermissionKeys = (body = {}) => {
  const selected = new Set();

  const add = (value) => {
    if (!value || value === "*") return;
    const key = typeof value === "string" ? normalizePermissionKey(value) : normalizePermissionObject(value);
    if (key) selected.add(key);
  };

  const addMany = (values) => {
    if (Array.isArray(values)) values.forEach(add);
  };

  addMany(body.permissions);
  addMany(body.selectedPermissions);
  addMany(body.selected);
  addMany(body.actions);

  const modules = body.modules || body.modulePermissions;
  if (modules && typeof modules === "object" && !Array.isArray(modules)) {
    Object.entries(modules).forEach(([moduleName, actions]) => {
      if (actions === true) return;
      if (Array.isArray(actions)) {
        actions.forEach((action) => add(`${moduleName}.${action}`));
      }
    });
  }

  return Array.from(selected).sort();
};

const roleSelect = `
  SELECT
    r.*,
    COALESCE(
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.module || '.' || p.action ORDER BY p.module || '.' || p.action), NULL),
      ARRAY[]::text[]
    ) AS permissions
  FROM roles r
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  LEFT JOIN permissions p ON p.id = rp.permission_id
`;

const ROLE_SEED_MODULES = [
  "dashboard",
  "products",
  "pos",
  "orders",
  "purchases",
  "suppliers",
  "customers",
  "inventory",
  "warehouses",
  "branches",
  "accounting",
  "loyalty",
  "employees",
  "reports",
  "settings",
  "marketing",
  "website",
  "roles",
  "users",
  "attendance",
];

const ROLE_SEED_ACTIONS = ["view", "create", "edit", "update", "delete", "approve", "export", "print", "transfer", "redeem"];
const ROLE_SEED_MARKETING_ACTIONS = ["view", "create", "update", "delete", "publish", "settings"];
const ROLE_SEED_WEBSITE_ACTIONS = ["view", "orders", "settings"];
const ROLE_SEED_ATTENDANCE_PERMISSIONS = [
  "attendance.view",
  "attendance.create",
  "attendance.edit",
  "attendance.update",
  "attendance.delete",
];
const ROLE_SEED_MARKETING_PERMISSIONS = [
  "marketing.view",
  "marketing.create",
  "marketing.update",
  "marketing.delete",
  "marketing.publish",
  "marketing.settings",
];
const ROLE_SEED_WEBSITE_PERMISSIONS = ["website.view", "website.orders", "website.settings"];
const ROLE_SEED_EXTRA_PERMISSIONS = [
  { module: "products", action: "barcode_shop", description: "print product Barcode Shop QR labels" },
  { module: "pos", action: "scan_product_qr", description: "scan Barcode Shop product QR labels in POS" },
  { module: "pos", action: "sell", description: "sell through POS" },
  { module: "inventory", action: "movements:view", description: "view inventory movement history" },
  { module: "inventory", action: "movements:undo", description: "undo manual inventory stock adjustments" },
  { module: "inventory", action: "alerts:view", description: "view low stock alerts" },
];
const ROLE_SEED_DEFINITIONS = [
  {
    key: "super_admin",
    name: "Super Admin",
    slug: "super_admin",
    description: "System-wide access across every module and action.",
    is_system: true,
    permissions: [
      ...ROLE_SEED_MODULES.flatMap((moduleName) =>
        (moduleName === "marketing"
          ? ROLE_SEED_MARKETING_ACTIONS
          : moduleName === "website"
            ? ROLE_SEED_WEBSITE_ACTIONS
            : ROLE_SEED_ACTIONS
        ).map((action) => `${moduleName}.${action}`)
      ),
      ...ROLE_SEED_ATTENDANCE_PERMISSIONS,
      ...ROLE_SEED_MARKETING_PERMISSIONS,
      ...ROLE_SEED_WEBSITE_PERMISSIONS,
      ...ROLE_SEED_EXTRA_PERMISSIONS.map((permission) => `${permission.module}.${permission.action}`),
      "products.view_cost",
    ],
  },
  {
    key: "admin",
    name: "Admin",
    slug: "admin",
    description: "Full access to every module and action.",
    is_system: true,
    permissions: [
      ...ROLE_SEED_MODULES.flatMap((moduleName) =>
        (moduleName === "marketing"
          ? ROLE_SEED_MARKETING_ACTIONS
          : moduleName === "website"
            ? ROLE_SEED_WEBSITE_ACTIONS
            : ROLE_SEED_ACTIONS
        ).map((action) => `${moduleName}.${action}`)
      ),
      ...ROLE_SEED_ATTENDANCE_PERMISSIONS,
      ...ROLE_SEED_MARKETING_PERMISSIONS,
      ...ROLE_SEED_WEBSITE_PERMISSIONS,
      "products.view_cost",
      ...ROLE_SEED_EXTRA_PERMISSIONS.map((permission) => `${permission.module}.${permission.action}`),
    ],
  },
  {
    key: "manager",
    name: "Manager",
    slug: "manager",
    description: "Broad operational access with approval and reporting controls.",
    is_system: true,
    permissions: [
      "dashboard.view",
      "products.view",
      "products.create",
      "products.edit",
      "products.export",
      "products.print",
      "pos.view",
      "pos.create",
      "orders.view",
      "orders.create",
      "purchases.view",
      "purchases.create",
      "suppliers.view",
      "inventory.view",
      "warehouses.view",
      "branches.view",
      "accounting.view",
      "loyalty.view",
      "loyalty.create",
      "loyalty.edit",
      "loyalty.export",
      "attendance.view",
      "attendance.create",
      "attendance.edit",
      "attendance.export",
      "attendance.print",
      ...ROLE_SEED_MARKETING_PERMISSIONS,
      ...ROLE_SEED_WEBSITE_PERMISSIONS,
      "notifications.view",
      "staff_tasks.view",
      "staff_tasks.update",
      "expenses.view",
      "expenses.create",
      "expenses.edit",
      "expenses.delete",
      "expenses.approve",
      "expenses.pay",
      "expenses.reports",
      "expenses.advances.view",
      "expenses.advances.create",
      "expenses.advances.deduct",
      "pos.expenses.view",
      "pos.expenses.create",
      "pos.expenses.edit",
      "pos.expenses.delete",
      "pos.expenses.approve",
      "pos.expenses.pay",
      "treasury.dashboard.view",
      "employees.view",
      "employees.export",
      "employees.print",
      "settings.view",
      "users.view",
      "roles.view",
    ],
  },
  {
    key: "accountant",
    name: "Accountant",
    slug: "accountant",
    description: "Financial access for ledgers, cashbox, journal entries, and reports.",
    is_system: true,
    permissions: [
      "dashboard.view",
      "accounting.view",
      "accounting.create",
      "accounting.edit",
      "accounting.approve",
      "reports.view",
      "suppliers.view",
      "suppliers.export",
      "suppliers.print",
      "expenses.view",
      "expenses.create",
      "expenses.edit",
      "expenses.delete",
      "expenses.approve",
      "expenses.pay",
      "expenses.reports",
      "expenses.advances.view",
      "expenses.advances.create",
      "expenses.advances.deduct",
      "treasury.dashboard.view",
      "purchases.view",
      "orders.view",
      "loyalty.view",
      "attendance.view",
      "employees.view",
      "products.view_cost",
      "users.view",
      "marketing.view",
      "website.orders",
      "notifications.view",
      "staff_tasks.view",
    ],
  },
  {
    key: "cashier",
    name: "Cashier",
    slug: "cashier",
    description: "POS and order-taking access with print and cashbox actions.",
    is_system: true,
    permissions: [
      "dashboard.view",
      "products.view",
      "pos.view",
      "pos.create",
      "pos.sell",
      "orders.view",
      "orders.create",
      "orders.edit",
      "orders.delete",
      "customers.view",
      "customers.create",
      "loyalty.view",
      "loyalty.create",
      "loyalty.redeem",
      "attendance.view",
      "attendance.create",
      "accounting.view",
      "employees.view",
      "settings.view",
      "notifications.view",
      "staff_tasks.view",
      "staff_tasks.update",
      "pos.expenses.view",
      "pos.expenses.create",
      "pos.expenses.edit",
      "pos.expenses.delete",
      "pos.expenses.approve",
      "pos.expenses.pay",
    ],
  },
  {
    key: "warehouse_staff",
    name: "Warehouse Staff",
    slug: "warehouse_staff",
    description: "Inventory, warehouse, receiving, and transfer support.",
    is_system: true,
    permissions: [
      "dashboard.view",
      "products.view",
      "inventory.view",
      "inventory.edit",
      "inventory.export",
      "inventory.print",
      "warehouses.view",
      "warehouses.create",
      "warehouses.edit",
      "warehouses.approve",
      "warehouses.transfer",
      "branches.view",
      "branches.create",
      "branches.export",
      "branches.print",
      "purchases.view",
      "purchases.create",
      "suppliers.view",
      "attendance.view",
      "employees.view",
      "notifications.view",
      "staff_tasks.view",
      "staff_tasks.update",
    ],
  },
  {
    key: "sales_agent",
    name: "Sales Agent",
    slug: "sales_agent",
    description: "Sales-facing access for customers, orders, POS, and product lookup.",
    is_system: true,
    permissions: [
      "dashboard.view",
      "products.view",
      "pos.view",
      "pos.create",
      "pos.sell",
      "orders.view",
      "orders.create",
      "orders.edit",
      "orders.print",
      "customers.view",
      "customers.create",
      "loyalty.view",
      "attendance.view",
      "attendance.create",
      "reports.view",
      "employees.view",
      "settings.view",
      "marketing.view",
      "marketing.create",
      "marketing.update",
      "website.view",
      "website.orders",
      "notifications.view",
      "staff_tasks.view",
      "staff_tasks.update",
      "pos.scan_product_qr",
    ],
  },
  {
    key: "custom_role",
    name: "Custom Role",
    slug: "custom_role",
    description: "Start with a blank permission set and assign only what is needed.",
    is_system: true,
    permissions: [],
  },
];

let builtinRolesSeedPromise = null;
let builtinRolesSeeded = false;

const ensureBuiltInRolePermissions = async (client, role, permissionKeys = []) => {
  const existingRole = await client.query(
    `
    SELECT id, tenant_id
    FROM roles
    WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
    ORDER BY CASE WHEN tenant_id = 1 THEN 0 WHEN tenant_id IS NULL THEN 1 ELSE 2 END, id ASC
    LIMIT 1
    `,
    [role.name]
  );
  const roleResult = existingRole.rows[0]?.id
    ? await client.query(
        `
        UPDATE roles
        SET tenant_id = 1,
            slug = $1,
            description = $2,
            is_system = TRUE,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING id, tenant_id, name, slug, description, is_system
        `,
        [role.slug, role.description || "", existingRole.rows[0].id]
      )
    : await client.query(
        `
        INSERT INTO roles (tenant_id, name, slug, description, is_system)
        VALUES (1, $1, $2, $3, TRUE)
        RETURNING id, tenant_id, name, slug, description, is_system
        `,
        [role.name, role.slug, role.description || ""]
      );
  const roleRow = roleResult.rows[0];
  const roleId = roleRow?.id;
  if (!roleId) return null;

  await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);

  for (const permissionKey of permissionKeys) {
    const [moduleName, action] = String(permissionKey || "").split(".");
    if (!moduleName || !action) continue;
    const permissionResult = await client.query(
      `
      INSERT INTO permissions (module, action, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (module, action) DO UPDATE SET
        description = COALESCE(permissions.description, EXCLUDED.description)
      RETURNING id
      `,
      [moduleName, action, `${action} ${moduleName}`]
    );
    const permissionId = permissionResult.rows[0]?.id;
    if (!permissionId) continue;
    await client.query(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [roleId, permissionId]
    );
  }

  return roleRow;
};

export const ensureBuiltinRoles = async (client = db) => {
  const runEnsure = async () => {
    await ensureRolesSchema(client);
    const existing = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM roles
      WHERE is_system = TRUE
      `
    );
    const existingCount = Number(existing.rows[0]?.count || 0);
    if (existingCount >= ROLE_SEED_DEFINITIONS.length) return true;

    for (const role of ROLE_SEED_DEFINITIONS) {
      await ensureBuiltInRolePermissions(client, role, role.permissions);
    }
    return true;
  };

  if (client !== db) return runEnsure();
  if (builtinRolesSeeded) return true;
  if (!builtinRolesSeedPromise) {
    builtinRolesSeedPromise = runEnsure()
      .then(() => {
        builtinRolesSeeded = true;
      })
      .catch((error) => {
        builtinRolesSeedPromise = null;
        throw error;
      });
  }
  return builtinRolesSeedPromise;
};

export const ensureRolesSchema = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(120),
      description TEXT,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id BIGSERIAL PRIMARY KEY,
      module VARCHAR(100) NOT NULL,
      action VARCHAR(50) NOT NULL,
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (module, action)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    )
  `);

  await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS slug VARCHAR(120)`);
  await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS description TEXT`);
  await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE permissions ADD COLUMN IF NOT EXISTS description TEXT`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_module_action_unique ON permissions (module, action)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique ON role_permissions (role_id, permission_id)`);
};

export const getRolesWithPermissions = async ({ db, tenantId = null }) => {
  await ensureRolesSchema(db);
  await ensureBuiltinRoles(db);

  const result = await db.query(
    `
    ${roleSelect}
    WHERE ($1::bigint IS NULL OR r.tenant_id = $1::bigint OR r.tenant_id IS NULL OR r.is_system = TRUE)
    GROUP BY r.id
    ORDER BY r.is_system DESC, r.id ASC
    `,
    [tenantId]
  );

  return result.rows.map(withRolePermissions);
};

export const resolveRole = async (client, { roleId, tenantId = null }) => {
  await ensureBuiltinRoles(client);
  const lookup = normalizeRoleLookup(roleId);
  const lookupSlug = normalizeSlug(roleId);

  const result = await client.query(
    `
    SELECT *
    FROM roles
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL OR is_system = TRUE)
      AND (
        id::text = $2
        OR LOWER(COALESCE(slug, '')) = $3
        OR LOWER(name) = $3
        OR LOWER(REPLACE(COALESCE(slug, ''), '_', '-')) = $4
        OR LOWER(REPLACE(name, '_', '-')) = $4
        OR LOWER(REPLACE(name, ' ', '-')) = $4
      )
    ORDER BY tenant_id NULLS LAST, id
    LIMIT 1
    `,
    [tenantId, String(roleId || "").trim(), lookup, lookupSlug]
  );

  return result.rows[0] || null;
};

export const getRolePermissions = async ({ db, roleId, tenantId = null }) => {
  await ensureRolesSchema(db);
  await ensureBuiltinRoles(db);
  const role = await resolveRole(db, { roleId, tenantId });
  if (!role) return null;

  const result = await db.query(
    `
    ${roleSelect}
    WHERE r.id = $1
    GROUP BY r.id
    `,
    [role.id]
  );

  return withRolePermissions(result.rows[0] || { ...role, permissions: [] });
};

export const replaceRolePermissions = async ({ client, roleId, tenantId = null, body = {} }) => {
  await ensureRolesSchema(client);
  await ensureBuiltinRoles(client);

  const role = await resolveRole(client, { roleId, tenantId });
  if (!role) return null;

  const permissionKeys = extractPermissionKeys(body);

  const permissionIds = [];
  for (const key of permissionKeys) {
    const [moduleName, action] = key.split(".");
    const permission = await client.query(
      `
      INSERT INTO permissions (module, action, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (module, action) DO UPDATE
      SET description = COALESCE(permissions.description, EXCLUDED.description)
      RETURNING id
      `,
      [moduleName, action, `${action} ${moduleName}`]
    );
    permissionIds.push(permission.rows[0].id);
  }

  await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [role.id]);

  for (const permissionId of permissionIds) {
    await client.query(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES ($1, $2)
      ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [role.id, permissionId]
    );
  }

  return getRolePermissions({ db: client, roleId: role.id, tenantId });
};
