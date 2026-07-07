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

const resolveRoleById = async (roleId) => {
  const numericRoleId = Number(roleId);
  if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
    return null;
  }

  const result = await db.query(
    `
    SELECT id, name, slug
    FROM roles
    WHERE id = $1
    LIMIT 1
    `,
    [numericRoleId]
  );

  return result.rows[0] || null;
};

const sanitizeUserBody = (body = {}) => {
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, key.toLowerCase() === "password" && value ? "[redacted]" : value])
  );
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

    const resolvedRole = await resolveRoleById(roleId);

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

    const resolvedRole = await resolveRoleById(roleId);

    if (!resolvedRole) {
      console.warn("[users] role resolution failed", {
        action: "update_role",
        userId: req.user?.id ?? null,
        role_id: req.body?.role_id ?? null,
        targetUserId: id,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }

    const userColumns = await getUsersColumnNames();
    const hasLegacyRoleColumn = userColumns.has("role");

    const whereClause = isSuperAdminUser(req.user) || tenantId === null
      ? `WHERE id = $${hasLegacyRoleColumn ? 3 : 2}`
      : `WHERE id = $${hasLegacyRoleColumn ? 3 : 2} AND tenant_id = $${hasLegacyRoleColumn ? 4 : 3}`;
    const params = isSuperAdminUser(req.user) || tenantId === null
      ? hasLegacyRoleColumn
        ? [resolvedRole.id, resolvedRole.slug || resolvedRole.name || null, id]
        : [resolvedRole.id, id]
      : hasLegacyRoleColumn
        ? [resolvedRole.id, resolvedRole.slug || resolvedRole.name || null, id, tenantId]
        : [resolvedRole.id, id, tenantId];
    const setClause = hasLegacyRoleColumn
      ? "role_id = $1, role = $2"
      : "role_id = $1";

    const updated =
      await db.query(

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
    const params = isSuperAdminUser(req.user) || tenantId === null ? [req.params.id] : [req.params.id, tenantId];
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
