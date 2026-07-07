import bcrypt from "bcryptjs";

import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const parseBooleanValue = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on", "active", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "inactive", "disabled"].includes(normalized)) return false;
  return null;
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

const getWritablePasswordColumns = (userColumns) =>
  ["password", "password_hash", "hashed_password"].filter((column) => userColumns.has(column));

const isDebugLikeUser = (user = {}) => {
  const haystack = `${user?.name || ""} ${user?.email || ""}`.toLowerCase();
  return /(^|[^a-z0-9])(qa|test|debug|demo|sample|dummy|sandbox)([^a-z0-9]|$)/i.test(haystack);
};

const resolveRoleById = async (roleId, { action = "create" } = {}) => {
  const numericRoleId = Number(roleId);
  if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
    return null;
  }

  const existenceSql = `
    SELECT id
    FROM roles
    WHERE id = $1
    LIMIT 1
  `;
  const params = [numericRoleId];

  console.log("[users] role lookup sql", {
    action,
    role_id: roleId ?? null,
    parsedRoleId: numericRoleId,
    sql: existenceSql.replace(/\s+/g, " ").trim(),
    params,
  });

  const result = await db.query(existenceSql, params);

  console.log("[users] role lookup candidates", {
    action,
    role_id: roleId ?? null,
    parsedRoleId: numericRoleId,
    rows: result.rows.map((row) => ({
      id: row.id,
    })),
  });

  if (!result.rows[0]) {
    return null;
  }

  const detailsSql = `
    SELECT id, tenant_id, name, slug
    FROM roles
    WHERE id = $1
    LIMIT 1
  `;
  const detailsResult = await db.query(detailsSql, params);

  console.log("[users] role lookup candidates", {
    action,
    role_id: roleId ?? null,
    parsedRoleId: numericRoleId,
    rows: detailsResult.rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenant_id ?? null,
      name: row.name || null,
      slug: row.slug || null,
    })),
  });

  return detailsResult.rows[0] || result.rows[0] || null;
};

const sanitizeUserBody = (body = {}) => {
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, key.toLowerCase() === "password" && value ? "[redacted]" : value])
  );
};

const normalizeRoleName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const isSuperAdminRole = (role = {}) => {
  const candidates = [role.name, role.slug, role.role, role.role_name, role.display_name, role.label, role.title]
    .map(normalizeRoleName)
    .filter(Boolean);
  return candidates.some((value) => value === "super admin" || value === "superadmin");
};

const getUserById = async (id, tenantId, { includeRole = true } = {}) => {
  const hasTenantFilter = tenantId !== null && tenantId !== undefined;
  const params = hasTenantFilter ? [id, tenantId] : [id];
  const whereClause = hasTenantFilter ? "WHERE u.id = $1 AND u.tenant_id = $2" : "WHERE u.id = $1";
  const roleSelect = includeRole
    ? `,
        r.id AS role_row_id,
        r.name AS role_name,
        r.slug AS role_slug`
    : "";
  const roleJoin = includeRole ? "LEFT JOIN roles r ON u.role_id = r.id" : "";

  const result = await db.query(
    `
    SELECT
      u.id,
      u.tenant_id,
      u.name,
      u.email,
      u.role_id,
      u.role,
      u.is_active
      ${roleSelect}
    FROM users u
    ${roleJoin}
    ${whereClause}
    LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
};

const countSuperAdmins = async (tenantId, { excludeUserId = null } = {}) => {
  const hasTenantFilter = tenantId !== null && tenantId !== undefined;
  const params = [];
  const clauses = [
    "LOWER(COALESCE(u.role, r.name, r.slug, '')) IN ('super admin', 'superadmin')",
  ];

  if (hasTenantFilter) {
    params.push(tenantId);
    clauses.push(`u.tenant_id = $${params.length}`);
  }

  if (excludeUserId !== null && excludeUserId !== undefined) {
    params.push(excludeUserId);
    clauses.push(`u.id <> $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE ${clauses.join(" AND ")}
    `,
    params
  );

  return Number(result.rows[0]?.count || 0);
};

const resolveRoleUpdateSafety = async ({ tenantId, currentUserId, currentUserRoleId, nextRoleId }) => {
  const resolvedNextRole = await resolveRoleById(nextRoleId, { action: "update_role" });
  if (!resolvedNextRole) {
    return { ok: false, message: "Invalid role" };
  }

  const currentUser = await getUserById(currentUserId, tenantId, { includeRole: true });
  if (!currentUser) {
    return { ok: false, message: "User not found" };
  }

  const currentRoleName = normalizeRoleName(currentUser.role_name || currentUser.role || "");
  const currentIsSuperAdmin = currentUser.is_super_admin === true || currentRoleName === "super admin" || currentRoleName === "superadmin";
  const nextIsSuperAdmin = isSuperAdminRole(resolvedNextRole);
  const superAdminCount = await countSuperAdmins(tenantId, { excludeUserId: currentUserId });

  if (currentIsSuperAdmin && !nextIsSuperAdmin && superAdminCount <= 0) {
    return {
      ok: false,
      message: "Cannot remove the last Super Admin",
    };
  }

  return {
    ok: true,
    resolvedNextRole,
    currentUser,
  };
};

const buildUserUpdatePayload = async ({ req, res, userId, tenantId, roleId, name, email }) => {
  const currentUser = await getUserById(userId, tenantId, { includeRole: true });
  if (!currentUser) {
    return { ok: false, response: res.status(404).json({ success: false, message: "User not found" }) };
  }

  const nextName = String(name ?? currentUser.name ?? "").trim();
  const nextEmail = String(email ?? currentUser.email ?? "").trim();
  if (!nextName || !nextEmail) {
    logUsersValidationFailure("update", req, "missing_required_fields", {
      targetUserId: userId,
      hasName: Boolean(nextName),
      hasEmail: Boolean(nextEmail),
    });
    return { ok: false, response: res.status(400).json({ success: false, message: "Name and email are required" }) };
  }

  const userColumns = await getUsersColumnNames();
  const hasLegacyRoleColumn = userColumns.has("role");
  const updates = [];
  const params = [];

  params.push(nextName);
  updates.push(`name = $${params.length}`);
  params.push(nextEmail);
  updates.push(`email = $${params.length}`);

  let resolvedNextRole = null;
  if (roleId !== undefined && roleId !== null && String(roleId).trim() !== "") {
    const roleSafety = await resolveRoleUpdateSafety({
      tenantId,
      currentUserId: userId,
      currentUserRoleId: currentUser.role_id,
      nextRoleId: roleId,
    });

    if (!roleSafety.ok) {
      return { ok: false, response: res.status(400).json({ success: false, message: roleSafety.message }) };
    }

    resolvedNextRole = roleSafety.resolvedNextRole;
    params.push(resolvedNextRole.id);
    updates.push(`role_id = $${params.length}`);
    if (hasLegacyRoleColumn) {
      params.push(resolvedNextRole.slug || resolvedNextRole.name || null);
      updates.push(`role = $${params.length}`);
    }
  }

  return {
    ok: true,
    currentUser,
    hasLegacyRoleColumn,
    updates,
    params,
    resolvedNextRole,
  };
};

const logUsersValidationFailure = (action, req, message, meta = {}) => {
  console.warn("[users] validation failure", {
    action,
    userId: req.user?.id ?? null,
    role: req.user?.role || req.user?.role_name || null,
    tenantId: req.user?.tenant_id ?? null,
    message,
    ...meta,
  });
};

/* ======================================================
   GET USERS
====================================================== */

export const getUsers =
async (req, res) => {

  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    console.log("[users] GET /api/users source", {
      table: "users",
      tenantId,
      actorId: req.user?.id ?? null,
    });

    const tenantFilter = isSuperAdminUser(req.user) || tenantId === null
      ? ""
      : "WHERE u.tenant_id = $1";

    const params = isSuperAdminUser(req.user) || tenantId === null ? [] : [tenantId];

    const users =
      await db.query(

        `
        SELECT

        u.id,
        u.name,
        u.email,
        u.role_id,
        u.is_active,

        r.name AS role

        FROM users u

        LEFT JOIN roles r

        ON u.role_id = r.id

        ${tenantFilter}

        ORDER BY u.id DESC
        `
        ,
        params
      );

    const visibleUsers = users.rows.filter((user) => !isDebugLikeUser(user));
    const hiddenCount = users.rows.length - visibleUsers.length;
    if (hiddenCount > 0) {
      console.log("[users] filtered non-production users", {
        tenantId,
        hiddenCount,
      });
    }

    res.status(200).json({

      success: true,

      users:
        visibleUsers
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({

      success: false,

      message:
        "Failed To Fetch Users"
    });
  }
};

/* ======================================================
   CREATE USER
====================================================== */

export const createUser =
async (req, res) => {

  try {

    const { name, email, password } = req.body;
    const roleId = Number(req.body?.role_id);
    const tenantId = getTenantId(req, req.user?.tenant_id);
    console.log("[users] create incoming body", {
      tenantId,
      actorId: req.user?.id ?? null,
      body: sanitizeUserBody(req.body),
    });
    console.log("[users] create role lookup", {
      tenantId,
      actorId: req.user?.id ?? null,
      role_id: req.body?.role_id ?? null,
      parsedRoleId: Number.isInteger(roleId) ? roleId : null,
    });

    if (
      !name ||
      !email ||
      !password
    ) {
      logUsersValidationFailure("create", req, "missing_required_fields", {
        hasName: Boolean(String(name || "").trim()),
        hasEmail: Boolean(String(email || "").trim()),
        hasPassword: Boolean(String(password || "").trim()),
      });

      return res.status(400).json({

        success: false,

        message:
          "All Fields Required"
      });
    }

    const exists =
      await db.query(

        `
        SELECT id

        FROM users

        WHERE LOWER(email) = LOWER($1)
          AND tenant_id = $2
        `,

        [email, tenantId]
      );

    if (
      exists.rows.length > 0
    ) {
      logUsersValidationFailure("create", req, "email_already_exists", {
        email: String(email || "").trim(),
        tenantId,
      });

      return res.status(400).json({

        success: false,

        message:
          "Email Already Exists"
      });
    }

    const hashedPassword =
      await bcrypt.hash(
        password,
        10
      );

    const resolvedRole = await resolveRoleById(roleId, { action: "create" });

    if (!resolvedRole) {
      console.warn("[users] role resolution failed", {
        action: "create",
        userId: req.user?.id ?? null,
        role_id: req.body?.role_id ?? null,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }

    console.log("[users] create resolved role", {
      tenantId,
      actorId: req.user?.id ?? null,
      roleId: resolvedRole.id,
      roleLabel: resolvedRole.slug || resolvedRole.name || null,
    });

    const userColumns = await getUsersColumnNames();
    const hasLegacyRoleColumn = userColumns.has("role");
    const insertColumns = ["tenant_id", "name", "email", "role_id"];
    const insertValues = [tenantId, name, email, resolvedRole.id];

    for (const passwordColumn of getWritablePasswordColumns(userColumns)) {
      insertColumns.push(passwordColumn);
      insertValues.push(hashedPassword);
    }

    if (userColumns.has("is_active")) {
      insertColumns.push("is_active");
      insertValues.push(true);
    }

    if (hasLegacyRoleColumn) {
      insertColumns.push("role");
      insertValues.push(resolvedRole.slug || resolvedRole.name || null);
    }

    const user =
      await db.query(

        `
        INSERT INTO users

        (
          ${insertColumns.join(", ")}
        )

        VALUES
        (${insertColumns.map((_, index) => `$${index + 1}`).join(",")})

        RETURNING
        id,
        tenant_id,
        name,
        email,
        role_id${hasLegacyRoleColumn ? ", role" : ""}
        `,

        insertValues
      );

    console.log("[users] create destination", {
      table: "users",
      createdUserId: user.rows[0]?.id ?? null,
      tenantId,
      email: String(email || "").trim().toLowerCase(),
    });

    res.status(201).json({

      success: true,

      message:
        "User Created Successfully",

      user:
        user.rows[0]
    });

  } catch (error) {

    console.error("[users] create failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      message: error?.message || String(error),
    });

    res.status(500).json({

      success: false,

      message:
        "Failed To Create User"
    });
  }
};

/* ======================================================
   UPDATE USER ROLE
====================================================== */

export const updateUserRole =
async (req, res) => {

  try {

    const { id } =
      req.params;

    const roleId = Number(req.body?.role_id);
    const tenantId = getTenantId(req, req.user?.tenant_id);
    console.log("[users] update role lookup", {
      tenantId,
      actorId: req.user?.id ?? null,
      targetUserId: id,
      role_id: req.body?.role_id ?? null,
      parsedRoleId: Number.isInteger(roleId) ? roleId : null,
    });

    const roleSafety = await resolveRoleUpdateSafety({
      tenantId,
      currentUserId: id,
      currentUserRoleId: null,
      nextRoleId: roleId,
    });

    if (!roleSafety.ok) {
      console.warn("[users] role resolution failed", {
        action: "update_role",
        userId: req.user?.id ?? null,
        role_id: req.body?.role_id ?? null,
        targetUserId: id,
        message: roleSafety.message,
      });
      return res.status(400).json({
        success: false,
        message: roleSafety.message,
      });
    }

    const userColumns = await getUsersColumnNames();
    const hasLegacyRoleColumn = userColumns.has("role");

    const whereClause = isSuperAdminUser(req.user) || tenantId === null
      ? `WHERE id = $${hasLegacyRoleColumn ? 3 : 2}`
      : `WHERE id = $${hasLegacyRoleColumn ? 3 : 2} AND tenant_id = $${hasLegacyRoleColumn ? 4 : 3}`;
    const params = isSuperAdminUser(req.user) || tenantId === null
      ? hasLegacyRoleColumn
        ? [roleSafety.resolvedNextRole.id, roleSafety.resolvedNextRole.slug || roleSafety.resolvedNextRole.name || null, id]
        : [roleSafety.resolvedNextRole.id, id]
      : hasLegacyRoleColumn
        ? [roleSafety.resolvedNextRole.id, roleSafety.resolvedNextRole.slug || roleSafety.resolvedNextRole.name || null, id, tenantId]
        : [roleSafety.resolvedNextRole.id, id, tenantId];
    const setClause = hasLegacyRoleColumn
      ? "role_id = $1, role = $2"
      : "role_id = $1";

    const updated = await db.query(
      `
      UPDATE users
      SET ${setClause}
      ${whereClause}
      RETURNING *
      `,
      params
    );

    res.status(200).json({

      success: true,

      message:
        "Role Updated Successfully",

      user:
      updated.rows[0]
    });

  } catch (error) {

    console.error("[users] update role failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      targetUserId: req.params.id,
      message: error?.message || String(error),
    });

    res.status(500).json({

      success: false,

      message:
        "Failed To Update Role"
    });
  }
};

/* ======================================================
   UPDATE USER
====================================================== */

export const updateUser =
async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const { name, email, role_id: roleId } = req.body || {};

    const payload = await buildUserUpdatePayload({
      req,
      res,
      userId: id,
      tenantId,
      roleId,
      name,
      email,
    });

    if (!payload.ok) {
      return payload.response;
    }

    const whereClause = isSuperAdminUser(req.user) || tenantId === null
      ? `WHERE id = $${payload.params.length + 1}`
      : `WHERE id = $${payload.params.length + 1} AND tenant_id = $${payload.params.length + 2}`;
    const params = isSuperAdminUser(req.user) || tenantId === null
      ? [...payload.params, id]
      : [...payload.params, id, tenantId];

    const updated = await db.query(
      `
      UPDATE users
      SET ${payload.updates.join(", ")}
      ${whereClause}
      RETURNING *
      `,
      params
    );

    res.status(200).json({
      success: true,
      message: "User Updated Successfully",
      user: updated.rows[0] || null,
    });
  } catch (error) {
    console.error("[users] update failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      targetUserId: req.params.id,
      message: error?.message || String(error),
    });
    res.status(500).json({
      success: false,
      message: "Failed To Update User",
    });
  }
};

/* ======================================================
   UPDATE USER PASSWORD
====================================================== */

export const updateUserPassword =
async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const nextPassword = String(req.body?.password || req.body?.new_password || "").trim();

    if (!nextPassword) {
      logUsersValidationFailure("password", req, "missing_password", { targetUserId: id });
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    const userColumns = await getUsersColumnNames();
    const passwordColumns = getWritablePasswordColumns(userColumns);
    if (!passwordColumns.length) {
      return res.status(500).json({
        success: false,
        message: "Password column unavailable",
      });
    }

    const hashedPassword = await bcrypt.hash(nextPassword, 10);
    const setClause = passwordColumns.map((column, index) => `${column} = $${index + 1}`).join(", ");
    const whereClause = isSuperAdminUser(req.user) || tenantId === null
      ? `WHERE id = $${passwordColumns.length + 1}`
      : `WHERE id = $${passwordColumns.length + 1} AND tenant_id = $${passwordColumns.length + 2}`;
    const params = [...passwordColumns.map(() => hashedPassword), id];
    if (!(isSuperAdminUser(req.user) || tenantId === null)) {
      params.push(tenantId);
    }

    await db.query(
      `
      UPDATE users
      SET ${setClause}
      ${whereClause}
      `,
      params
    );

    res.status(200).json({
      success: true,
      message: "Password Updated Successfully",
    });
  } catch (error) {
    console.error("[users] update password failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      targetUserId: req.params.id,
      message: error?.message || String(error),
    });
    res.status(500).json({
      success: false,
      message: "Failed To Update Password",
    });
  }
};

/* ======================================================
   UPDATE USER STATUS
====================================================== */

export const updateUserStatus =
async (req, res) => {

  try {

    const { id } = req.params;
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const isActive = req.body?.is_active ?? req.body?.isActive ?? req.body?.status;
    const nextStatus = parseBooleanValue(isActive);

    if (nextStatus === null) {
      logUsersValidationFailure("status", req, "missing_status", { targetUserId: id });
      return res.status(400).json({
        success: false,
        message: "is_active is required",
      });
    }

    const whereClause = isSuperAdminUser(req.user) || tenantId === null
      ? "WHERE id = $2"
      : "WHERE id = $2 AND tenant_id = $3";
    const params = isSuperAdminUser(req.user) || tenantId === null
      ? [nextStatus, id]
      : [nextStatus, id, tenantId];

    const updated = await db.query(
      `
      UPDATE users
      SET is_active = $1
      ${whereClause}
      RETURNING id, tenant_id, name, email, role_id, is_active
      `,
      params
    );

    res.status(200).json({
      success: true,
      message: "Status Updated Successfully",
      user: updated.rows[0] || null,
    });
  } catch (error) {
    console.error("[users] update status failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      targetUserId: req.params.id,
      message: error?.message || String(error),
    });
    res.status(500).json({
      success: false,
      message: "Failed To Update Status",
    });
  }
};

/* ======================================================
   DELETE USER
====================================================== */

export const deleteUser =
async (req, res) => {

  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const targetUserId = req.params.id;

    if (String(targetUserId) === String(req.user?.id ?? "")) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const targetUser = await getUserById(targetUserId, tenantId, { includeRole: true });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const targetIsSuperAdmin = targetUser.is_super_admin === true || isSuperAdminRole(targetUser);
    if (targetIsSuperAdmin) {
      const remainingSuperAdmins = await countSuperAdmins(tenantId, { excludeUserId: targetUserId });
      if (remainingSuperAdmins <= 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete the last Super Admin",
        });
      }
    }

    const params = isSuperAdminUser(req.user) || tenantId === null ? [targetUserId] : [targetUserId, tenantId];
    const whereClause = isSuperAdminUser(req.user) || tenantId === null ? "WHERE id = $1" : "WHERE id = $1 AND tenant_id = $2";

    await db.query(

      `
      DELETE FROM users

      ${whereClause}
      `,

      params
    );

    res.status(200).json({

      success: true,

      message:
        "User Deleted Successfully"
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({

      success: false,

      message:
        "Failed To Delete User"
    });
  }
};
