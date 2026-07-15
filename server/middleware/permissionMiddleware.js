import db from "../database/db.js";
import { isSuperAdminUser } from "../utils/requestScope.js";

const MARKETING_ACTIONS = ["view", "create", "update", "delete", "publish", "settings"];
const ADMIN_ROLES = ["admin", "super_admin", "super admin", "superadmin"];
const CORE_PERMISSIONS = [
  ["suppliers", "view"],
  ["suppliers", "create"],
  ["warehouses", "view"],
  ["warehouses", "create"],
  ["warehouses", "update"],
  ["warehouses", "delete"],
  ["warehouses", "transfer"],
  ["purchases", "view"],
  ["purchases", "create"],
  ["purchases", "edit"],
  ["purchases", "delete"],
  ["orders", "edit"],
  ["orders", "delete"],
  ["products", "view"],
  ["branches", "view"],
  ["notifications", "view"],
  ["notifications", "manage"],
  ["staff_tasks", "view"],
  ["staff_tasks", "create"],
  ["staff_tasks", "update"],
  ["staff_tasks", "manage"],
  ["employees", "view"],
  ["employees", "delete"],
  ["reports", "view"],
  ["reports", "export"],
  ["expenses", "view"],
  ["expenses", "create"],
  ["expenses", "edit"],
  ["expenses", "delete"],
  ["expenses", "approve"],
  ["expenses", "pay"],
  ["expenses", "reports"],
  ["expenses.advances", "view"],
  ["expenses.advances", "create"],
  ["expenses.advances", "deduct"],
  ["pos.expenses", "create"],
  ["pos.expenses", "view_shift_total"],
  ["money_accounts", "view"],
  ["money_accounts", "manage"],
  ["money_transactions", "view"],
  ["money_transactions", "adjust"],
  ["money_transfers", "create"],
  ["treasury.dashboard", "view"],
  ["settings", "view"],
  ["settings", "edit"],
];

let corePermissionsReadyPromise = null;

const normalizePermissionKey = (moduleName = "", action = "") => {
  let moduleValue = String(moduleName || "").trim().toLowerCase();
  let actionValue = String(action || "").trim().toLowerCase();

  if (moduleValue === "purchase") moduleValue = "purchases";
  if (moduleValue === "supplier") moduleValue = "suppliers";
  if (moduleValue === "warehouse") moduleValue = "warehouses";
  if (moduleValue === "branch") moduleValue = "branches";
  if (moduleValue === "product") moduleValue = "products";

  if (moduleValue === "marketing" && actionValue === "approve") {
    return { moduleName: moduleValue, action: "publish" };
  }
  if (moduleValue === "marketing" && actionValue === "edit") {
    return { moduleName: moduleValue, action: "update" };
  }
  return { moduleName: moduleValue, action: actionValue };
};

const normalizeRoleValue = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

const isAdminRole = (value = "") => {
  const normalized = normalizeRoleValue(value);
  return ADMIN_ROLES.some((role) => normalizeRoleValue(role) === normalized);
};

const isWildcardPermission = (permission = {}) =>
  permission?.module === "*" ||
  permission?.action === "*" ||
  `${permission?.module || ""}.${permission?.action || ""}` === "*.*";

const ensureCorePermissions = async () => {
  if (!corePermissionsReadyPromise) {
    corePermissionsReadyPromise = (async () => {
      await db.query(`ALTER TABLE IF EXISTS permissions ADD COLUMN IF NOT EXISTS description TEXT`);

      for (const [moduleName, action] of CORE_PERMISSIONS) {
        await db.query(
          `
          INSERT INTO permissions (module, action, description)
          VALUES ($1, $2, $3)
          ON CONFLICT (module, action) DO UPDATE
          SET description = COALESCE(permissions.description, EXCLUDED.description)
          `,
          [moduleName, action, `${action} ${moduleName}`]
        );
      }

      await db.query(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE LOWER(REPLACE(COALESCE(r.name, ''), '_', ' ')) IN ('admin', 'super admin', 'superadmin')
          AND (p.module, p.action) IN (
            ${CORE_PERMISSIONS.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ")}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.role_id = r.id
              AND rp.permission_id = p.id
          )
        `,
        CORE_PERMISSIONS.flat()
      );

      await db.query(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE (
            LOWER(REPLACE(REPLACE(COALESCE(r.name, ''), '_', ' '), '-', ' ')) IN ('cashier', 'pos cashier')
            OR LOWER(REPLACE(REPLACE(COALESCE(r.slug, ''), '_', ' '), '-', ' ')) IN ('cashier', 'pos cashier')
          )
          AND p.module = 'orders'
          AND p.action IN ('edit', 'delete')
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.role_id = r.id
              AND rp.permission_id = p.id
          )
        `
      );

      await db.query(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE LOWER(REPLACE(COALESCE(r.name, ''), '_', ' ')) IN ('cashier', 'sales agent', 'manager')
          AND (p.module, p.action) IN (('pos.expenses', 'create'), ('pos.expenses', 'view_shift_total'))
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.role_id = r.id
              AND rp.permission_id = p.id
          )
        `
      );
    })().catch((error) => {
      corePermissionsReadyPromise = null;
      throw error;
    });
  }

  return corePermissionsReadyPromise;
};

const permissionAliases = (moduleName = "", action = "") => {
  const normalized = normalizePermissionKey(moduleName, action);
  const moduleValue = normalized.moduleName;
  const actionValue = normalized.action;
  const aliases = new Set();

  if (moduleValue && actionValue) {
    aliases.add(`${moduleValue}:${actionValue}`);
    aliases.add(`${moduleValue}.${actionValue}`);
  }

  if (moduleValue === "marketing" && actionValue === "publish") {
    aliases.add("marketing:approve");
    aliases.add("marketing.approve");
  }
  if (moduleValue === "marketing" && actionValue === "update") {
    aliases.add("marketing:edit");
    aliases.add("marketing.edit");
  }

  for (const value of [moduleValue, actionValue]) {
    if (!value) continue;
    aliases.add(value);
    aliases.add(value.replace(":", "."));
    aliases.add(value.replace(".", ":"));
  }

  return aliases;
};

const ensureBranchesPermissions = async () => {
  const permissions = ["view", "create", "update", "delete", "edit"];

  await db.query(`ALTER TABLE IF EXISTS permissions ADD COLUMN IF NOT EXISTS description TEXT`);

  for (const action of permissions) {
    await db.query(
      `
      INSERT INTO permissions (module, action, description)
      SELECT 'branches', $1::varchar, $2::text
      WHERE NOT EXISTS (
        SELECT 1 FROM permissions WHERE module = 'branches' AND action = $1::varchar
      )
      `,
      [action, `${action} branches`]
    );
  }

  await db.query(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE LOWER(r.name) IN ('admin', 'super_admin')
      AND p.module = 'branches'
      AND p.action IN ('view', 'create', 'update', 'delete', 'edit')
      AND NOT EXISTS (
        SELECT 1
        FROM role_permissions rp
        WHERE rp.role_id = r.id
          AND rp.permission_id = p.id
      )
    `
  );
};

const ensureAttendancePermissions = async () => {
  const permissions = ["view", "create", "update", "delete", "edit"];

  await db.query(`ALTER TABLE IF EXISTS permissions ADD COLUMN IF NOT EXISTS description TEXT`);

  for (const action of permissions) {
    await db.query(
      `
      INSERT INTO permissions (module, action, description)
      SELECT 'attendance', $1::varchar, $2::text
      WHERE NOT EXISTS (
        SELECT 1 FROM permissions WHERE module = 'attendance' AND action = $1::varchar
      )
      `,
      [action, `${action} attendance`]
    );
  }

  await db.query(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE LOWER(r.name) IN ('admin', 'super_admin')
      AND p.module = 'attendance'
      AND p.action IN ('view', 'create', 'update', 'delete', 'edit')
      AND NOT EXISTS (
        SELECT 1
        FROM role_permissions rp
        WHERE rp.role_id = r.id
          AND rp.permission_id = p.id
      )
    `
  );

};

const ensureLoyaltyPermissions = async () => {
  const permissions = ["view", "create", "redeem"];

  await db.query(`ALTER TABLE IF EXISTS permissions ADD COLUMN IF NOT EXISTS description TEXT`);

  for (const action of permissions) {
    await db.query(
      `
      INSERT INTO permissions (module, action, description)
      SELECT 'loyalty', $1::varchar, $2::text
      WHERE NOT EXISTS (
        SELECT 1 FROM permissions WHERE module = 'loyalty' AND action = $1::varchar
      )
      `,
      [action, `${action} loyalty`]
    );
  }

  await db.query(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE LOWER(r.name) IN ('admin', 'super_admin', 'owner', 'cashier', 'pos', 'pos_cashier')
      AND p.module = 'loyalty'
      AND p.action IN ('view', 'redeem')
      AND NOT EXISTS (
        SELECT 1
        FROM role_permissions rp
        WHERE rp.role_id = r.id
          AND rp.permission_id = p.id
      )
    `
  );
};

const ensureMarketingPermissions = async () => {
  await db.query(`ALTER TABLE IF EXISTS permissions ADD COLUMN IF NOT EXISTS description TEXT`);

  for (const action of MARKETING_ACTIONS) {
    await db.query(
      `
      INSERT INTO permissions (module, action, description)
      SELECT 'marketing', $1::varchar, $2::text
      WHERE NOT EXISTS (
        SELECT 1 FROM permissions WHERE module = 'marketing' AND action = $1::varchar
      )
      `,
      [action, `${action} marketing`]
    );
  }

  const legacyPermissionResult = await db.query(
    `
    SELECT id
    FROM permissions
    WHERE module = 'marketing' AND action = 'approve'
    LIMIT 1
    `
  );
  const publishPermissionResult = await db.query(
    `
    SELECT id
    FROM permissions
    WHERE module = 'marketing' AND action = 'publish'
    LIMIT 1
    `
  );

  const legacyPermissionId = legacyPermissionResult.rows[0]?.id;
  const publishPermissionId = publishPermissionResult.rows[0]?.id;

  if (legacyPermissionId && publishPermissionId) {
    await db.query(
      `
      UPDATE role_permissions rp
      SET permission_id = $2
      WHERE rp.permission_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM role_permissions rp2
          WHERE rp2.role_id = rp.role_id
            AND rp2.permission_id = $2
        )
      `,
      [legacyPermissionId, publishPermissionId]
    );

    await db.query(`DELETE FROM role_permissions WHERE permission_id = $1`, [legacyPermissionId]);
    await db.query(`DELETE FROM permissions WHERE id = $1`, [legacyPermissionId]);
  }

  await db.query(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE LOWER(REPLACE(COALESCE(r.name, ''), '_', ' ')) IN ('admin', 'super admin', 'superadmin')
      AND p.module = 'marketing'
      AND p.action IN ('view', 'create', 'update', 'delete', 'publish', 'settings')
      AND NOT EXISTS (
        SELECT 1
        FROM role_permissions rp
        WHERE rp.role_id = r.id
          AND rp.permission_id = p.id
      )
    `
  );
};

/* ======================================================
   PERMISSION MIDDLEWARE
====================================================== */

const permit = (

  moduleName,

  action

) => {

  return async (

    req,

    res,

    next

  ) => {

    try {
      const requested = normalizePermissionKey(moduleName, action);
      let normalizedModuleName = requested.moduleName;
      let normalizedAction = requested.action;

      if (normalizedModuleName === "marketing" && normalizedAction === "edit") {
        normalizedAction = "update";
      }
      if (normalizedModuleName === "marketing" && normalizedAction === "approve") {
        normalizedAction = "publish";
      }

      /* =========================
         DEBUG USER
      ========================= */

      await ensureCorePermissions();

      if (normalizedModuleName === "branches") {
        await ensureBranchesPermissions();
      }

      if (normalizedModuleName === "attendance") {
        await ensureAttendancePermissions();
      }

      if (normalizedModuleName === "loyalty") {
        await ensureLoyaltyPermissions();
      }

      if (normalizedModuleName === "marketing") {
        await ensureMarketingPermissions();
      }

      /* =========================
         USER ID
      ========================= */

      const userId =
        req.user?.id;

      if (!userId) {

        return res.status(401).json({

          success: false,

          message:
            "Unauthorized"
        });
      }

      const permissions = await db.query(
        `
        SELECT DISTINCT
          p.module,
          p.action,
          COALESCE(r.name, '') AS role_name,
          COALESCE(u.role, '') AS user_role,
          COALESCE(u.is_super_admin, FALSE) AS is_super_admin
        FROM users u
        LEFT JOIN roles r
          ON u.role_id = r.id
        LEFT JOIN role_permissions rp
          ON rp.role_id = r.id
        LEFT JOIN permissions p
          ON p.id = rp.permission_id
        WHERE u.id = $1
        `,
        [userId]
      );

      /* =========================
         CHECK PERMISSION
      ========================= */

      const userRole =
        permissions.rows[0]?.role_name ||
        permissions.rows[0]?.user_role ||
        req.user?.role_name ||
        req.user?.role ||
        "unknown";
      const normalized = normalizePermissionKey(normalizedModuleName, normalizedAction);
      const requiredPermission = `${normalized.moduleName}:${normalized.action}`;

      if (moduleName === "attendance") {
        console.log("[attendance] permission check", {
          userRole,
          requiredPermission,
        });
      }

      const isAdmin = isAdminRole(userRole);
      const isSuperAdmin =
        isSuperAdminUser(req.user) ||
        Boolean(permissions.rows[0]?.is_super_admin);
      const hasWildcard =
        permissions.rows.some(isWildcardPermission) ||
        (Array.isArray(req.user?.permissions) && req.user.permissions.includes("*"));

      if (isAdmin || isSuperAdmin || hasWildcard) {
        return next();
      }

      const branchAdminAllowed =
        normalized.moduleName === "branches" &&
        isAdmin &&
        ["view", "create", "update", "delete", "edit"].includes(normalized.action);

      const requestedAliases = permissionAliases(normalized.moduleName, normalized.action);

      const allowed =
        branchAdminAllowed ||
        permissions.rows.some((permission) => {
          const rowAliases = permissionAliases(permission.module, permission.action);
          return [...requestedAliases].some((alias) => rowAliases.has(alias));
        });

      /* =========================
         ACCESS DENIED
      ========================= */

      if (!allowed) {
        if (normalized.moduleName === "branches") {
          console.log("[branches] permission denied", userRole, requiredPermission);
        }

        return res.status(403).json({

          success: false,

          message:
            `Access Denied (${requiredPermission})`
        });
      }

      /* =========================
         SUCCESS
      ========================= */

      next();

    } catch (error) {
      console.error("[permission] check failed", {
        requestId: req.id,
        moduleName,
        action,
        userId: req.user?.id,
        message: error.message,
        code: error.code,
        stack: error.stack,
      });

      if (moduleName === "notifications" && action === "view") {
        req.permissionUnavailable = {
          moduleName,
          action,
          message: error.message,
        };
        return next();
      }

      return res.status(500).json({

        success: false,

        message:
          "Permission check failed",

        error:
          error.message
      });
    }
  };
};

export default permit;
