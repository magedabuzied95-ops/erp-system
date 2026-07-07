import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../database/db.js";
import { sendLoginTaskDigestIfNeeded } from "../services/staffTaskEmailNotificationService.js";
import { ensureStaffTasksSchema, resolveEmployeeForUser } from "../services/staffTasksService.js";
import { ensureDefaultTenantAndBackfillUsers } from "../utils/tenantBootstrap.js";

export const ensureUsersLoginSchema = async () => {
  const before = await db.query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'last_login_at'
    LIMIT 1
    `
  );
  console.log("[schema] users.last_login_at before", {
    exists: before.rows.length > 0,
    definition: before.rows[0] || null,
  });
  await db.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL`);
  const after = await db.query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'last_login_at'
    LIMIT 1
    `
  );
  console.log("[schema] users.last_login_at after", {
    exists: after.rows.length > 0,
    definition: after.rows[0] || null,
  });
};

let usersColumnNamesPromise = null;

const getUsersColumnNames = async () => {
  if (!usersColumnNamesPromise) {
    usersColumnNamesPromise = db
      .query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
        `
      )
      .then((result) => new Set(result.rows.map((row) => String(row.column_name || "").toLowerCase())))
      .catch((error) => {
        usersColumnNamesPromise = null;
        throw error;
      });
  }
  return usersColumnNamesPromise;
};

const getReadablePasswordColumns = (userColumns) =>
  ["password", "password_hash", "hashed_password", "password_digest"].filter((column) => userColumns.has(column));

const resolveLoginTenantId = async (req) => {
  const rawTenant =
    req?.tenantId ??
    req?.tenant?.id ??
    req?.user?.tenant_id ??
    req?.user?.tenantId ??
    req?.headers?.["x-tenant-id"] ??
    req?.query?.tenant_id ??
    req?.query?.tenantId ??
    req?.body?.tenant_id ??
    req?.body?.tenantId;

  if (rawTenant !== null && rawTenant !== undefined && String(rawTenant).trim() !== "") {
    const numericTenant = Number(rawTenant);
    if (Number.isFinite(numericTenant) && numericTenant > 0) {
      return numericTenant;
    }
  }

  const workspaceHint =
    String(req?.body?.tenant_slug || req?.body?.workspace || req?.body?.tenant || "").trim();

  if (!workspaceHint) {
    return null;
  }

  const tenantResult = await db.query(
    `
    SELECT id
    FROM tenants
    WHERE LOWER(slug) = LOWER($1)
       OR LOWER(name) = LOWER($1)
    ORDER BY id ASC
    LIMIT 1
    `,
    [workspaceHint]
  );

  return tenantResult.rows[0]?.id ? Number(tenantResult.rows[0].id) : null;
};

const buildLoginUserSelect = (passwordColumns = []) => {
  const selectColumns = [
    "u.id",
    "u.tenant_id",
    "u.role_id",
    "u.name",
    "u.email",
    "u.phone",
    "u.is_active",
    "u.is_super_admin",
    "u.last_login_at",
    "u.created_at",
    "u.updated_at",
    ...passwordColumns.map((column) => `u.${column} AS ${column}`),
    "r.name AS role_name",
  ];

  return `
      SELECT
        ${selectColumns.join(",\n        ")}
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.email) = LOWER($1)
    `;
};

const resolveUserPasswordValue = (user, passwordColumns = []) => {
  for (const column of passwordColumns) {
    const value = user?.[column];
    if (typeof value === "string" && value.trim()) {
      return { column, value };
    }
  }
  return { column: null, value: null };
};

const generateToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      role: user.role,
      tenant_id: user.tenant_id ?? null,
      is_super_admin: Boolean(user.is_super_admin),
    },
    process.env.JWT_SECRET || "SECRET_KEY",
    { expiresIn: "7d" }
  );

const getUserPermissions = async (userId) => {
  const permissions = await db.query(
    `
    SELECT DISTINCT p.module, p.action
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE u.id = $1
    `,
    [userId]
  );

  return permissions.rows
    .filter(({ module, action }) => module && action)
    .map(({ module, action }) => `${module}.${action}`);
};

const getRoleName = (user = {}, fallback = "user") =>
  user.role || user.role_name || (user.is_super_admin ? "super_admin" : fallback);

export const register = async (req, res) => {
  try {
    const { name, email, password, role_id, role } = req.body;
    const defaultTenantId = await ensureDefaultTenantAndBackfillUsers();

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All Fields Required",
      });
    }

    const exists = await db.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
      `,
      [email]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email Already Exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const roleResult = await db.query(
      `
      SELECT id, name
      FROM roles
      WHERE id = $1
      `,
      [role_id || null]
    );

    const normalizedRole = roleResult.rows[0]?.name || role || "user";

    const createdUser = await db.query(
      `
      INSERT INTO users (
        tenant_id,
        name,
        email,
        password,
        role_id,
        role
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, tenant_id, name, email, role_id, role
      `,
      [defaultTenantId, name, email, hashedPassword, role_id || null, normalizedRole]
    );

    const user = createdUser.rows[0];
    const permissions = await getUserPermissions(user.id);

    const token = generateToken({
      id: user.id,
      role: getRoleName(user, normalizedRole || "user"),
      tenant_id: user.tenant_id,
      is_super_admin: Boolean(user.is_super_admin),
    });

    return res.status(201).json({
      success: true,
      message: "User Registered Successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: getRoleName(user, normalizedRole || "user"),
        role_name: getRoleName(user, normalizedRole || "user"),
        tenant_id: user.tenant_id,
        is_super_admin: Boolean(user.is_super_admin),
        permissions,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Register",
      error: error.message,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    await ensureDefaultTenantAndBackfillUsers();
    await ensureUsersLoginSchema().catch((error) => {
      console.warn("[schema] users.last_login_at ensure skipped during login", {
        message: error?.message || String(error),
      });
    });

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email And Password Required",
      });
    }

    const tenantId = await resolveLoginTenantId(req);
    const userColumns = await getUsersColumnNames();
    const passwordColumns = getReadablePasswordColumns(userColumns);
    console.log("[auth] login lookup", {
      email: String(email || "").trim().toLowerCase(),
      tenantId,
      passwordColumns,
    });

    const loginSelect = buildLoginUserSelect(passwordColumns);
    let result = { rows: [] };

    if (tenantId !== null) {
      const exactTenantSql = `
        ${loginSelect}
          AND u.tenant_id = $2
        ORDER BY
          CASE WHEN u.tenant_id = $2 THEN 0 ELSE 1 END,
          u.id ASC
        `;
      console.log("[auth] login exact tenant SQL", exactTenantSql);
      result = await db.query(
        exactTenantSql,
        [email.trim(), tenantId]
      );
      console.log("[auth] login exact tenant lookup", {
        email: String(email || "").trim().toLowerCase(),
        tenantId,
        matchCount: result.rows.length,
      });
    }

    if (result.rows.length === 0) {
      console.log("[auth] login fallback lookup", {
        email: String(email || "").trim().toLowerCase(),
        tenantId,
        reason: tenantId !== null ? "exact_tenant_miss" : "no_tenant_provided",
      });
      const fallbackSql = `
        ${loginSelect}
          AND u.is_active IS DISTINCT FROM FALSE
          AND (
            u.tenant_id IS NULL
            OR LOWER(COALESCE(t.status, 'active')) IN ('active', 'enabled', 'true', '1')
          )
        ORDER BY
          CASE WHEN u.tenant_id IS NULL THEN 1 ELSE 0 END,
          u.id ASC
        `;
      console.log("[auth] login fallback SQL", fallbackSql);
      result = await db.query(
        fallbackSql,
        [email.trim()]
      );
    }

    if (result.rows.length === 0) {
      console.log("[auth] login user not found", {
        email: String(email || "").trim().toLowerCase(),
        tenantId,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid Email Or Password",
      });
    }

    console.log("[auth] login user candidates found", {
      email: String(email || "").trim().toLowerCase(),
      tenantId,
      fallbackUsed: tenantId === null,
      candidates: result.rows.map((candidate) => ({
        id: candidate.id,
        tenant_id: candidate.tenant_id,
        is_active: candidate.is_active,
      })),
    });

    if (tenantId === null) {
      if (result.rows.length > 1) {
        console.warn("[auth] login workspace required", {
          email: String(email || "").trim().toLowerCase(),
          tenantId,
          candidateTenantIds: result.rows.map((candidate) => candidate.tenant_id ?? null),
        });
        return res.status(400).json({
          success: false,
          message: "Workspace Required",
        });
      }
    }

    let user = null;
    for (const candidate of result.rows) {
      const { column: passwordColumn, value: passwordValue } = resolveUserPasswordValue(candidate, passwordColumns);
      if (!passwordColumn || !passwordValue) {
        console.warn("[auth] login password column missing", {
          userId: candidate.id,
          tenantId: candidate.tenant_id ?? null,
          availableColumns: passwordColumns,
        });
        continue;
      }
      const isCandidateMatch = await bcrypt.compare(password, passwordValue);
      console.log("[auth] login password compare", {
        userId: candidate.id,
        tenantId: candidate.tenant_id ?? null,
        passwordColumn,
        compareResult: isCandidateMatch,
      });
      if (isCandidateMatch) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      console.log("[auth] login password mismatch", {
        email: String(email || "").trim().toLowerCase(),
        tenantId,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid Email Or Password",
      });
    }

    if (user.is_active === false) {
      console.warn("[auth] login rejected inactive user", {
        userId: user.id,
        tenantId: user.tenant_id ?? null,
        reason: "is_active_false",
      });
      return res.status(403).json({
        success: false,
        message: "Account Disabled",
      });
    }

    const permissions = await getUserPermissions(user.id, user.tenant_id);

    try {
      await db.query(
        `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
        `,
        [user.id]
      );
    } catch (loginUpdateError) {
      if (loginUpdateError.code !== "42703") {
        throw loginUpdateError;
      }
    }

    const token = generateToken({
      id: user.id,
      role: getRoleName(user),
      tenant_id: user.tenant_id,
      is_super_admin: Boolean(user.is_super_admin),
    });

    const tenantBranding = user.tenant_id
      ? await db.query(
          `
          SELECT
            t.id,
            t.slug,
            COALESCE(NULLIF(TRIM(t.company_name), ''), NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(t.name), ''), 'MONE') AS company_name,
            COALESCE(NULLIF(TRIM(t.company_logo_url), ''), NULLIF(TRIM(c.logo_url), ''), '') AS company_logo_url,
            COALESCE(NULLIF(TRIM(t.favicon_url), ''), NULLIF(TRIM(c.favicon_url), ''), '') AS favicon_url
          FROM tenants t
          LEFT JOIN company_profiles c ON c.tenant_id = t.id
          WHERE t.id = $1
          LIMIT 1
          `,
          [user.tenant_id]
        ).catch(() => ({ rows: [] }))
      : { rows: [] };
    const tenant = tenantBranding.rows[0]
      ? {
          id: tenantBranding.rows[0].id,
          slug: tenantBranding.rows[0].slug,
          name: tenantBranding.rows[0].company_name,
          companyName: tenantBranding.rows[0].company_name,
          company_logo_url: tenantBranding.rows[0].company_logo_url || "",
          companyLogoUrl: tenantBranding.rows[0].company_logo_url || "",
          favicon_url: tenantBranding.rows[0].favicon_url || "",
          faviconUrl: tenantBranding.rows[0].favicon_url || "",
        }
      : null;

    void (async () => {
      try {
        await ensureStaffTasksSchema();
        const employee = await resolveEmployeeForUser(user, user.tenant_id);
        if (employee?.id) {
          await sendLoginTaskDigestIfNeeded(user.id, employee.id, user.tenant_id);
        }
      } catch (digestError) {
        console.warn("[auth] staff task login digest skipped", digestError.message);
      }
    })();

    return res.status(200).json({
      success: true,
      message: "Login Successful",
      token,
      tenant,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: getRoleName(user),
        role_name: user.role_name || getRoleName(user),
        tenant_id: user.tenant_id,
        company_name: tenant?.companyName || "",
        company_logo_url: tenant?.companyLogoUrl || "",
        favicon_url: tenant?.faviconUrl || "",
        is_super_admin: Boolean(user.is_super_admin),
        permissions,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Login",
      error: error.message,
    });
  }
};

export const me = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const current = await db.query(
      `
      SELECT
        u.*,
        r.name AS role_name,
        u.is_super_admin
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User Not Found",
      });
    }

    const permissions = await getUserPermissions(userId);
    const tenantBranding = current.rows[0]?.tenant_id
      ? await db.query(
          `
          SELECT
            t.id,
            t.slug,
            COALESCE(NULLIF(TRIM(t.company_name), ''), NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(t.name), ''), 'MONE') AS company_name,
            COALESCE(NULLIF(TRIM(t.company_logo_url), ''), NULLIF(TRIM(c.logo_url), ''), '') AS company_logo_url,
            COALESCE(NULLIF(TRIM(t.favicon_url), ''), NULLIF(TRIM(c.favicon_url), ''), '') AS favicon_url
          FROM tenants t
          LEFT JOIN company_profiles c ON c.tenant_id = t.id
          WHERE t.id = $1
          LIMIT 1
          `,
          [current.rows[0].tenant_id]
        ).catch(() => ({ rows: [] }))
      : { rows: [] };
    const tenant = tenantBranding.rows[0]
      ? {
          id: tenantBranding.rows[0].id,
          slug: tenantBranding.rows[0].slug,
          name: tenantBranding.rows[0].company_name,
          companyName: tenantBranding.rows[0].company_name,
          company_logo_url: tenantBranding.rows[0].company_logo_url || "",
          companyLogoUrl: tenantBranding.rows[0].company_logo_url || "",
          favicon_url: tenantBranding.rows[0].favicon_url || "",
          faviconUrl: tenantBranding.rows[0].favicon_url || "",
        }
      : null;

    return res.json({
      success: true,
      user: {
        ...current.rows[0],
        company_name: tenant?.companyName || current.rows[0]?.company_name || "",
        company_logo_url: tenant?.companyLogoUrl || current.rows[0]?.company_logo_url || "",
        favicon_url: tenant?.faviconUrl || current.rows[0]?.favicon_url || "",
        permissions,
      },
      tenant,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Profile",
      error: error.message,
    });
  }
};
