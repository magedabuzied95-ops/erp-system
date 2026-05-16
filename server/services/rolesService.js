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
  await client.query(`ALTER TABLE permissions ADD COLUMN IF NOT EXISTS description TEXT`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_module_action_unique ON permissions (module, action)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique ON role_permissions (role_id, permission_id)`);
};

export const getRolesWithPermissions = async ({ db, tenantId = null }) => {
  await ensureRolesSchema(db);

  const result = await db.query(
    `
    ${roleSelect}
    WHERE ($1::bigint IS NULL OR r.tenant_id = $1::bigint OR r.tenant_id IS NULL)
    GROUP BY r.id
    ORDER BY r.id DESC
    `,
    [tenantId]
  );

  return result.rows.map(withRolePermissions);
};

export const resolveRole = async (client, { roleId, tenantId = null }) => {
  const lookup = normalizeRoleLookup(roleId);
  const lookupSlug = normalizeSlug(roleId);

  const result = await client.query(
    `
    SELECT *
    FROM roles
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
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
