import db from "../database/db.js";
import { isSuperAdminUser } from "../utils/requestScope.js";
import { isMetaReviewerRole } from "../services/metaReviewerAccessService.js";

const MARKETING_ACTIONS = ["view", "create", "update", "delete", "publish", "settings"];
const ADMIN_ROLES = ["admin", "super_admin", "super admin", "superadmin"];
const CORE_PERMISSIONS = [
  ["dashboard", "view"],
  ["ai_inbox_messenger", "view"],
  ["ai_inbox_messenger", "reply"],
  ["ai_inbox_instagram", "view"],
  ["ai_inbox_instagram", "reply"],
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
  // Analytics v2 financial scopes. Deliberately NOT backfilled to existing roles: the
  // Executive Overview is new, so there is no prior access to preserve and
  // deny-by-default is correct. Admin/super-admin receive them via the block below.
  ["reports", "cost"],
  ["reports", "profit"],
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

      // /api/dashboard/* previously ran on `protect` alone. Gating it on
      // dashboard:view would revoke access from every non-admin role, so grant the
      // new permission once to every role that already exists. This preserves the
      // current effective access exactly while making the endpoints revocable from
      // the Permissions screen. The NOT EXISTS guard keeps it idempotent, so an
      // admin who later removes the grant does not have it silently restored.
      await db.query(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE p.module = 'dashboard'
          AND p.action = 'view'
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.role_id = r.id
              AND rp.permission_id = p.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM system_settings s
            WHERE s.key = 'permissions.dashboard_view_backfilled'
          )
        `
      );

      await db.query(
        `
        INSERT INTO system_settings (key, value, category)
        VALUES ('permissions.dashboard_view_backfilled', 'true'::jsonb, 'permissions')
        ON CONFLICT (key) DO NOTHING
        `
      );

      // AI Inbox permission split. Every conversation route in aiAgentOrders.js
      // used to run on settings:view / settings:edit, so `settings` was in
      // practice the permission to read customer conversations and to send
      // messages as the business. Those routes now run on
      // ai_inbox_messenger:view / :reply.
      //
      // Gating them on a permission nobody holds would revoke inbox access from
      // every non-admin role, so grant the inbox permission once to every role
      // that already holds the settings permission it replaced — view maps to
      // view, edit maps to reply. Effective access is preserved exactly; from
      // here the two are independent, and the inbox can be granted or revoked
      // without touching settings. The sentinel keeps it a one-time migration,
      // so an admin who later removes the grant does not have it restored on
      // the next boot.
      await db.query(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT DISTINCT rp.role_id, target.id
        FROM role_permissions rp
        JOIN permissions source
          ON source.id = rp.permission_id
        JOIN permissions target
          ON target.module = 'ai_inbox_messenger'
         AND target.action = CASE source.action WHEN 'view' THEN 'view' ELSE 'reply' END
        WHERE source.module = 'settings'
          AND source.action IN ('view', 'edit')
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions existing
            WHERE existing.role_id = rp.role_id
              AND existing.permission_id = target.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM system_settings s
            WHERE s.key = 'permissions.ai_inbox_messenger_backfilled'
          )
        `
      );

      await db.query(
        `
        INSERT INTO system_settings (key, value, category)
        VALUES ('permissions.ai_inbox_messenger_backfilled', 'true'::jsonb, 'permissions')
        ON CONFLICT (key) DO NOTHING
        `
      );
    })().catch((error) => {
      corePermissionsReadyPromise = null;
      throw error;
    });
  }

  return corePermissionsReadyPromise;
};

/*
 * `strict` drops the unqualified fallbacks below.
 *
 * The default (non-strict) alias set includes the BARE module name and the BARE
 * action, and two permissions match when their alias sets intersect. Two rows
 * from different modules therefore intersect on the action alone: a role
 * holding products:view satisfies permit(anything, "view"), because both sides
 * contain the bare alias "view". Since dashboard:view is backfilled to every
 * role, every user passes every :view gate in the application.
 *
 * That behaviour is load-bearing for callers that pass a module or an action
 * alone, so it is not removed here — changing it silently would re-gate every
 * screen in the ERP at once. New gates that must actually hold opt in with
 * { strict: true }, which compares only the qualified `module:action` forms.
 */
/*
 * A permission's canonical form: module and action joined, with `:` and `.`
 * flattened to one separator.
 *
 * The same grant is spelled several ways across this codebase and its data —
 * `pos.expenses` + `create`, `pos` + `expenses.create`, `inventory` +
 * `movements:view`, `inventory.movements` + `view`. All of them denote one
 * permission, and all of them canonicalise to the same string, so comparing
 * canonical forms bridges the spellings without inventing matches between
 * genuinely different permissions.
 */
const canonicalPermission = (moduleName = "", action = "") => {
  const normalized = normalizePermissionKey(moduleName, action);
  if (!normalized.moduleName || !normalized.action) return "";
  return `${normalized.moduleName}.${normalized.action}`.replace(/:/g, ".");
};

/*
 * LEGACY matching. Off unless PERMISSION_LEGACY_ALIASES is set.
 *
 * This used to be the only behaviour. On top of the canonical form it added the
 * bare module name and the bare action to every alias set, and `permit` allows a
 * request when two alias sets INTERSECT — so two unrelated grants matched:
 *
 *   held orders:view     satisfied  permit("orders", "delete")   (bare module)
 *   held products:view   satisfied  permit("customers", "view")  (bare action)
 *
 * Since dashboard:view is backfilled to every role, the second rule meant every
 * authenticated user passed every `:view` gate in the ERP. The first meant any
 * grant on a module was every grant on it — a Manager holding roles:view could
 * create, edit and delete roles, and reports:view carried reports:cost and
 * reports:profit, which CORE_PERMISSIONS deliberately withholds.
 *
 * Kept only as a same-day rollback: `PERMISSION_LEGACY_ALIASES=true` restores the
 * old behaviour without a code deploy. Measure before using it —
 * `node scripts/permission-strictness-impact.mjs` lists, per role, exactly which
 * permissions were reachable only this way.
 */
const legacyAliasesEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.PERMISSION_LEGACY_ALIASES || "").toLowerCase());

const permissionAliases = (moduleName = "", action = "", { legacy = false } = {}) => {
  const normalized = normalizePermissionKey(moduleName, action);
  const moduleValue = normalized.moduleName;
  const actionValue = normalized.action;
  const aliases = new Set();

  const canonical = canonicalPermission(moduleValue, actionValue);
  if (canonical) aliases.add(canonical);

  // Renamed actions. These are the SAME permission under two names, so they are
  // synonyms rather than a widening: nothing else becomes reachable.
  if (moduleValue === "marketing" && ["publish", "approve"].includes(actionValue)) {
    aliases.add("marketing.publish");
    aliases.add("marketing.approve");
  }
  if (moduleValue === "marketing" && ["update", "edit"].includes(actionValue)) {
    aliases.add("marketing.update");
    aliases.add("marketing.edit");
  }
  if (moduleValue === "customers" && ["edit", "update"].includes(actionValue)) {
    aliases.add("customers.edit");
    aliases.add("customers.update");
  }

  if (!legacy) return aliases;

  aliases.add(`${moduleValue}:${actionValue}`);
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

  action,

  options = {}

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

      // The Meta review account may read the compact product catalog only so the
      // reviewer can exercise the real AI Inbox product-card flow. The API
      // boundary still blocks every product write and every non-picker route.
      if (
        normalizedModuleName === "products" &&
        normalizedAction === "view" &&
        isMetaReviewerRole(req.user?.role || req.user?.role_name)
      ) {
        return next();
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

      /*
       * Matching is canonical `module.action` only. `options.strict` is honoured
       * for callers that opted in before this became the default, but it no
       * longer changes anything: the loose behaviour now lives behind the
       * PERMISSION_LEGACY_ALIASES rollback switch, which is off by default.
       */
      const legacy = legacyAliasesEnabled() && options?.strict !== true;
      const matches = (aliasOptions) =>
        permissions.rows.some((permission) => {
          const rowAliases = permissionAliases(permission.module, permission.action, aliasOptions);
          const requested = permissionAliases(normalized.moduleName, normalized.action, aliasOptions);
          return [...requested].some((alias) => rowAliases.has(alias));
        });

      const allowed = branchAdminAllowed || matches({ legacy });

      /*
       * A denial that the old rule would have allowed is the interesting one: it
       * is either a privilege the role never should have had, or a privilege the
       * shop depends on and now has to be granted explicitly. Name both the role
       * and the exact permission so the fix is one edit in the Roles screen
       * rather than an investigation.
       */
      if (!allowed && !legacy && matches({ legacy: true })) {
        console.warn("[permission] denied by canonical matching (was allowed by the legacy alias rule)", {
          requestId: req.id,
          userId,
          role: userRole,
          required: requiredPermission,
          hint: `Grant "${requiredPermission}" to this role, or set PERMISSION_LEGACY_ALIASES=true to roll back.`,
        });
      }

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

/**
 * True when a role holding `heldModule:heldAction` satisfies a
 * permit(wantModule, wantAction) check. This is the exact predicate `permit`
 * runs per permission row, exported so the aliasing rules are testable without
 * a database.
 */
/**
 * True when a role holding `heldModule:heldAction` satisfies a
 * permit(wantModule, wantAction) check. This is the exact predicate `permit`
 * runs per permission row, exported so the matching rules are testable without
 * a database.
 *
 * `{ legacy: true }` evaluates the pre-canonical rule, which is what
 * scripts/permission-strictness-impact.mjs compares against. `{ strict: true }`
 * is accepted for older callers and is now the default behaviour.
 */
export const permissionSatisfies = (heldModule, heldAction, wantModule, wantAction, { legacy = false } = {}) => {
  const requested = permissionAliases(wantModule, wantAction, { legacy });
  const held = permissionAliases(heldModule, heldAction, { legacy });
  return [...requested].some((alias) => held.has(alias));
};

export { canonicalPermission, permissionAliases };
export default permit;
